import { createPublicKey } from 'node:crypto';

import type { AssetGrant } from '../../shared/commerce';
import type {
  CleanDeviceRestoreRequest,
  CommerceSessionMaterial,
} from '../../shared/commerce-recovery';
import { verifyCommerceAccessTokenWithAuthority } from './access-authority';
import {
  evaluateCommerceOfflineLeaseWithKeys,
  readCommerceOfflineLeaseKeyId,
  verifyCommerceOfflineLease,
  type CommerceOfflineLeaseEvaluation,
} from './offline-lease';
import type {
  CommerceRefreshVault,
  CommerceTrustedTimeCheckpoint,
  StoredCommerceSession,
} from './refresh-vault';
import type { CommerceServiceClient } from './service-client';
import type { RotatingCommerceJwks } from './jwks';

export interface CommerceRecoveryCoordinatorOptions {
  client: CommerceServiceClient;
  vault: CommerceRefreshVault;
  jwks: RotatingCommerceJwks;
  issuer: string;
}

export interface VerifiedCommerceRecovery {
  accessToken: string;
  accountId: string;
  grants: AssetGrant[];
  pendingOrderIds: string[];
  revokedGrantIds: string[];
  refreshExpiresAt: string;
}

interface VerifiedCommerceMaterial {
  result: VerifiedCommerceRecovery;
  leaseKeyId: string;
  leasePublicKey: string;
}

function compareStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function expectedActiveGrants(material: CommerceSessionMaterial): AssetGrant[] {
  return material.reconciliation.grants.filter((grant) => grant.state === 'active'
    && (!grant.expiresAt || Date.parse(grant.expiresAt) > material.serverTimeSeconds * 1_000));
}

function expectedOfflineGrantShape(grant: AssetGrant): Record<string, unknown> {
  return {
    grantId: grant.grantId,
    productId: grant.productId,
    productRevision: grant.productRevision,
    avatarRevisionIds: [...grant.avatarRevisionIds],
    catalogVersion: grant.catalogVersion,
    expiresAt: grant.expiresAt === undefined
      ? undefined : Math.floor(Date.parse(grant.expiresAt) / 1_000),
  };
}

function checkpoint(
  material: CommerceSessionMaterial,
  wallTimeSeconds: number,
  monotonicMilliseconds: number,
): CommerceTrustedTimeCheckpoint {
  return {
    version: 1,
    serverTimeSeconds: material.serverTimeSeconds,
    wallTimeSeconds,
    monotonicMilliseconds,
  };
}

function storedSession(
  serviceOrigin: string,
  material: CommerceSessionMaterial,
  trustedTime: CommerceTrustedTimeCheckpoint,
  leaseKeyId: string,
  leasePublicKey: string,
): StoredCommerceSession {
  return {
    version: 1,
    serviceOrigin,
    accountId: material.accountId,
    sessionId: material.sessionId,
    installationId: material.installationId,
    refreshCredential: material.refreshCredential,
    refreshGeneration: material.refreshGeneration,
    refreshExpiresAt: material.refreshExpiresAt,
    reconciliationCursor: material.reconciliation.cursor,
    offlineLease: material.offlineLease,
    offlineLeaseKeyId: leaseKeyId,
    offlineLeasePublicKey: leasePublicKey,
    trustedTime,
  };
}

export class CommerceRecoveryCoordinator {
  private readonly client: CommerceServiceClient;
  private readonly vault: CommerceRefreshVault;
  private readonly jwks: RotatingCommerceJwks;
  private readonly issuer: string;

  constructor(options: CommerceRecoveryCoordinatorOptions) {
    this.client = options.client;
    this.vault = options.vault;
    this.jwks = options.jwks;
    this.issuer = options.issuer;
    if (this.issuer !== this.client.serviceOrigin) {
      throw new Error('Commerce recovery issuer must equal the service origin.');
    }
  }

  async restoreCleanDevice(
    request: CleanDeviceRestoreRequest,
    wallTimeSeconds: number,
    monotonicMilliseconds: number,
  ): Promise<VerifiedCommerceRecovery> {
    const material = await this.client.restoreCleanDevice(request);
    if (material.installationId !== request.installationId || material.refreshGeneration !== 1) {
      throw new Error('Clean-device commerce response does not match the installation.');
    }
    const verified = await this.verifyMaterial(material);
    this.vault.replaceFromAuthenticatedRestore(storedSession(
      this.client.serviceOrigin,
      material,
      checkpoint(material, wallTimeSeconds, monotonicMilliseconds),
      verified.leaseKeyId,
      verified.leasePublicKey,
    ));
    return verified.result;
  }

  async refresh(
    wallTimeSeconds: number,
    monotonicMilliseconds: number,
  ): Promise<VerifiedCommerceRecovery> {
    const current = this.vault.load();
    if (!current) throw new Error('Commerce recovery session is not available.');
    if (current.serviceOrigin !== this.client.serviceOrigin) {
      throw new Error('Stored commerce session belongs to another service origin.');
    }
    const material = await this.client.refreshSession({
      schemaVersion: 1,
      sessionId: current.sessionId,
      installationId: current.installationId,
      refreshCredential: current.refreshCredential,
      refreshGeneration: current.refreshGeneration,
      rotationId: `rotate:${current.sessionId}:${current.refreshGeneration + 1}`,
      reconciliationCursor: current.reconciliationCursor,
    });
    if (material.accountId !== current.accountId
      || material.sessionId !== current.sessionId
      || material.installationId !== current.installationId
      || material.refreshGeneration !== current.refreshGeneration + 1
      || material.refreshCredential === current.refreshCredential
      || material.serverTimeSeconds < current.trustedTime.serverTimeSeconds) {
      throw new Error('Commerce refresh response does not match the stored session.');
    }
    const verified = await this.verifyMaterial(material);
    this.vault.commitRotation(current.refreshGeneration, storedSession(
      this.client.serviceOrigin,
      material,
      checkpoint(material, wallTimeSeconds, monotonicMilliseconds),
      verified.leaseKeyId,
      verified.leasePublicKey,
    ));
    return verified.result;
  }

  async evaluateOfflineAccess(
    wallTimeSeconds: number,
    monotonicMilliseconds: number,
  ): Promise<CommerceOfflineLeaseEvaluation> {
    const current = this.vault.load();
    if (!current) throw new Error('Commerce recovery session is not available.');
    if (current.serviceOrigin !== this.client.serviceOrigin) {
      throw new Error('Stored commerce session belongs to another service origin.');
    }
    try {
      const key = createPublicKey({
        key: Buffer.from(current.offlineLeasePublicKey, 'base64url'),
        format: 'der',
        type: 'spki',
      });
      return evaluateCommerceOfflineLeaseWithKeys(
        current.offlineLease,
        current.installationId,
        { issuer: this.issuer, keys: new Map([[current.offlineLeaseKeyId, key]]) },
        current.trustedTime,
        wallTimeSeconds,
        monotonicMilliseconds,
      );
    } catch {
      return {
        status: 'reconnect-required',
        reason: 'invalid-lease',
        trustedNowSeconds: Math.max(wallTimeSeconds, current.trustedTime.serverTimeSeconds),
      };
    }
  }

  private async verifyMaterial(material: CommerceSessionMaterial): Promise<VerifiedCommerceMaterial> {
    const accessClaims = await verifyCommerceAccessTokenWithAuthority(material.accessToken, {
      issuer: this.issuer,
      audience: 'desky-assets',
      jwks: this.jwks,
    }, material.serverTimeSeconds);
    const leaseKeyId = readCommerceOfflineLeaseKeyId(material.offlineLease);
    const keys = await this.jwks.getKeys(leaseKeyId, material.serverTimeSeconds);
    const leaseKey = keys.get(leaseKeyId);
    if (!leaseKey) throw new Error('Commerce offline lease key is not admitted.');
    const leaseClaims = verifyCommerceOfflineLease(material.offlineLease, material.installationId, {
      issuer: this.issuer,
      audience: 'desky-offline',
      keys,
    }, material.serverTimeSeconds);
    const activeGrants = expectedActiveGrants(material);
    const productIds = [...new Set(activeGrants.map((grant) => grant.productId))];
    const catalogVersions = [...new Set(activeGrants.map((grant) => grant.catalogVersion))];
    const expectedLeaseGrants = activeGrants
      .map((grant) => expectedOfflineGrantShape(grant))
      .sort((left, right) => String(left.grantId).localeCompare(String(right.grantId)));
    const actualLeaseGrants = leaseClaims.grants
      .map((grant) => ({ ...grant, avatarRevisionIds: [...grant.avatarRevisionIds] }))
      .sort((left, right) => left.grantId.localeCompare(right.grantId));
    if (accessClaims.sub !== material.accountId
      || leaseClaims.sub !== material.accountId
      || !compareStrings(accessClaims.grants, productIds)
      || !compareStrings(accessClaims.catalogVersions, catalogVersions)
      || JSON.stringify(actualLeaseGrants) !== JSON.stringify(expectedLeaseGrants)) {
      throw new Error('Commerce authorization material does not match reconciliation.');
    }
    return {
      leaseKeyId,
      leasePublicKey: Buffer.from(leaseKey.export({ format: 'der', type: 'spki' })).toString('base64url'),
      result: {
        accessToken: material.accessToken,
        accountId: material.accountId,
        grants: structuredClone(activeGrants),
        pendingOrderIds: [...material.reconciliation.pendingOrderIds],
        revokedGrantIds: [...material.reconciliation.revokedGrantIds],
        refreshExpiresAt: material.refreshExpiresAt,
      },
    };
  }
}
