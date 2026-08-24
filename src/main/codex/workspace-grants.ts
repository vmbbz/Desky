import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, parse, relative, resolve } from 'node:path';

import type {
  CodexSandboxMode,
  CodexWorkspaceGrantSummary,
} from '../../shared/codex-workspace';

interface WorkspaceGrantRecord extends CodexWorkspaceGrantSummary {
  selectedDirectory: string;
  canonicalDirectory: string;
  issuedAt: number;
}

export interface CodexWorkspaceGrantBrokerOptions {
  now?: () => number;
  createGrantId?: () => string;
  grantTtlMs?: number;
  maximumGrants?: number;
  protectedWritableRoots?: string[];
}

const defaultGrantTtlMs = 15 * 60 * 1_000;
const defaultMaximumGrants = 8;

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function cloneSummary(record: WorkspaceGrantRecord): CodexWorkspaceGrantSummary {
  return {
    schemaVersion: 1,
    grantId: record.grantId,
    label: record.label,
    expiresAt: record.expiresAt,
    maximumSandbox: record.maximumSandbox,
  };
}

function safeDirectoryLabel(directory: string): string {
  return basename(directory)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 100) || 'Codex workspace';
}

async function canonicalDirectory(directory: string): Promise<string> {
  if (!directory || directory.length > 2_048 || !isAbsolute(directory)) {
    throw new Error('The selected Codex workspace is invalid.');
  }
  try {
    const canonical = await realpath(directory);
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) throw new Error('not-directory');
    return resolve(canonical);
  } catch {
    throw new Error('The selected Codex workspace is unavailable.');
  }
}

function containsPath(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === ''
    || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

export class CodexWorkspaceGrantBroker {
  private readonly grants = new Map<string, WorkspaceGrantRecord>();
  private readonly now: () => number;
  private readonly createGrantId: () => string;
  private readonly grantTtlMs: number;
  private readonly maximumGrants: number;
  private readonly protectedWritableRoots: string[];

  constructor(options: CodexWorkspaceGrantBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createGrantId = options.createGrantId ?? randomUUID;
    this.grantTtlMs = options.grantTtlMs ?? defaultGrantTtlMs;
    this.maximumGrants = options.maximumGrants ?? defaultMaximumGrants;
    this.protectedWritableRoots = [...(options.protectedWritableRoots ?? [])];
    if (!Number.isSafeInteger(this.grantTtlMs) || this.grantTtlMs < 10_000
      || !Number.isSafeInteger(this.maximumGrants) || this.maximumGrants < 1
      || this.maximumGrants > 32) {
      throw new Error('Invalid Codex workspace grant policy.');
    }
  }

  async issue(
    directory: string,
    maximumSandbox: CodexSandboxMode,
  ): Promise<CodexWorkspaceGrantSummary> {
    if (maximumSandbox !== 'read-only' && maximumSandbox !== 'workspace-write') {
      throw new Error('Invalid Codex workspace sandbox approval.');
    }
    const canonical = await canonicalDirectory(directory);
    if (samePath(canonical, parse(canonical).root)) {
      throw new Error('Choose a specific folder instead of a filesystem root.');
    }
    this.pruneExpired();
    while (this.grants.size >= this.maximumGrants) {
      const oldest = [...this.grants.values()]
        .sort((left, right) => left.issuedAt - right.issuedAt)[0];
      if (!oldest) break;
      this.grants.delete(oldest.grantId);
    }
    const issuedAt = this.now();
    const grantNonce = this.createGrantId();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(grantNonce)) {
      throw new Error('Could not create a Codex workspace grant.');
    }
    const record: WorkspaceGrantRecord = {
      schemaVersion: 1,
      grantId: `codex-workspace:${grantNonce}`,
      label: safeDirectoryLabel(canonical),
      issuedAt,
      expiresAt: issuedAt + this.grantTtlMs,
      selectedDirectory: resolve(directory),
      canonicalDirectory: canonical,
      maximumSandbox,
    };
    this.grants.set(record.grantId, record);
    return cloneSummary(record);
  }

  async resolve(grantId: string, sandbox: CodexSandboxMode): Promise<string> {
    if (!grantId || grantId.length > 160) throw new Error('Invalid Codex workspace grant.');
    this.pruneExpired();
    const grant = this.grants.get(grantId);
    if (!grant) throw new Error('The Codex workspace approval expired. Choose the folder again.');
    const canonical = await canonicalDirectory(grant.selectedDirectory);
    if (!samePath(canonical, grant.canonicalDirectory)) {
      this.grants.delete(grantId);
      throw new Error('The selected Codex workspace changed. Choose the folder again.');
    }
    if (sandbox === 'workspace-write' && grant.maximumSandbox !== 'workspace-write') {
      throw new Error('Choose the folder again to approve workspace-write access.');
    }
    if (sandbox === 'workspace-write') {
      for (const protectedRoot of this.protectedWritableRoots) {
        const protectedCanonical = await canonicalDirectory(protectedRoot);
        if (containsPath(canonical, protectedCanonical)) {
          throw new Error('Choose a narrower folder for workspace-write access.');
        }
      }
    }
    return canonical;
  }

  revoke(grantId: string): void {
    if (typeof grantId === 'string') this.grants.delete(grantId);
  }

  clear(): void {
    this.grants.clear();
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [grantId, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(grantId);
    }
  }
}
