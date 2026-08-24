import type {
  AssetGrant,
  CommerceOrder,
  EntitlementEvent,
  PaymentAttempt,
  VerifiedCommerceQuote,
} from '../../shared/commerce';
import type { CommerceReconciliationSnapshot } from '../../shared/commerce-recovery';
import type {
  PaymentAuthorizationEvidence,
  PaymentSettlementObservation,
} from '../../shared/commerce-settlement';

export interface CommerceRefreshSessionRecord {
  sessionId: string;
  accountId: string;
  installationId: string;
  credentialDigest: string;
  previousCredentialDigest?: string;
  generation: number;
  lastRotationId?: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommerceAuditEvent {
  eventId: string;
  eventType: string;
  accountId?: string;
  subjectId: string;
  occurredAt: string;
  correlationId: string;
  detail: Record<string, string | number | boolean>;
}

export interface CommerceRepositoryReader {
  getQuote(quoteId: string): Promise<VerifiedCommerceQuote | undefined>;
  getOrder(orderId: string): Promise<CommerceOrder | undefined>;
  getPaymentAttempt(attemptId: string): Promise<PaymentAttempt | undefined>;
  getPaymentAuthorization(authorizationId: string): Promise<PaymentAuthorizationEvidence | undefined>;
  getSettlementObservation(
    observationId: string,
  ): Promise<PaymentSettlementObservation | undefined>;
  getLatestSettlementObservation(
    authorizationId: string,
  ): Promise<PaymentSettlementObservation | undefined>;
  getRefreshSession(sessionId: string): Promise<CommerceRefreshSessionRecord | undefined>;
  getReconciliationSnapshot(accountId: string): Promise<CommerceReconciliationSnapshot>;
  listEntitlementEvents(accountId: string, productId?: string): Promise<EntitlementEvent[]>;
  listAssetGrants(accountId: string): Promise<AssetGrant[]>;
}

export interface CommerceRepositoryTransaction extends CommerceRepositoryReader {
  insertQuote(quote: VerifiedCommerceQuote): Promise<'inserted' | 'exact-replay'>;
  insertOrder(order: CommerceOrder): Promise<'inserted' | 'exact-replay'>;
  updateOrder(expected: CommerceOrder, next: CommerceOrder): Promise<void>;
  insertPaymentAttempt(attempt: PaymentAttempt): Promise<'inserted' | 'exact-replay'>;
  updatePaymentAttempt(expected: PaymentAttempt, next: PaymentAttempt): Promise<void>;
  insertPaymentAuthorization(
    evidence: PaymentAuthorizationEvidence,
  ): Promise<'inserted' | 'exact-replay'>;
  appendSettlementObservation(
    observation: PaymentSettlementObservation,
  ): Promise<'inserted' | 'exact-replay'>;
  appendEntitlementEvent(event: EntitlementEvent): Promise<'inserted' | 'exact-replay'>;
  insertAssetGrant(grant: AssetGrant): Promise<'inserted' | 'exact-replay'>;
  insertRefreshSession(session: CommerceRefreshSessionRecord): Promise<void>;
  rotateRefreshSession(
    expectedGeneration: number,
    expectedCredentialDigest: string,
    rotationId: string,
    next: CommerceRefreshSessionRecord,
  ): Promise<void>;
  revokeRefreshSession(sessionId: string, revokedAt: string): Promise<void>;
  appendAuditEvent(event: CommerceAuditEvent): Promise<void>;
}

export interface CommerceRepository extends CommerceRepositoryReader {
  transaction<T>(operation: (transaction: CommerceRepositoryTransaction) => Promise<T>): Promise<T>;
  healthCheck(): Promise<{ writable: boolean; migrationVersion: number }>;
}

/**
 * Hosted adapters must satisfy this contract using a production-supported transactional database.
 * Plaintext refresh credentials, access tokens, offline leases, wallet secrets, and agent content
 * are deliberately absent from persistent records.
 */
export type CommerceProductionRepository = CommerceRepository;
