import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, parse } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CodexWorkspaceGrantBroker } from '../src/main/codex/workspace-grants';
import {
  codexSandboxDisclosures,
  codexSandboxModes,
} from '../src/shared/codex-workspace';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'desky-workspace-grant-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Codex workspace grants', () => {
  it('issues only opaque renderer metadata and resolves the canonical directory in main', async () => {
    const directory = await temporaryDirectory();
    const broker = new CodexWorkspaceGrantBroker({
      createGrantId: () => 'grant-1',
      now: () => 1_000,
    });
    const grant = await broker.issue(directory, 'read-only');
    expect(grant).toEqual({
      schemaVersion: 1,
      grantId: 'codex-workspace:grant-1',
      label: basename(directory),
      expiresAt: 901_000,
      maximumSandbox: 'read-only',
    });
    expect(JSON.stringify(grant)).not.toContain(directory);
    await expect(broker.resolve(grant.grantId, 'read-only')).resolves.toBe(directory);
  });

  it('expires and evicts bounded grants, and revalidates the folder before use', async () => {
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();
    let now = 1_000;
    let id = 0;
    const broker = new CodexWorkspaceGrantBroker({
      createGrantId: () => `grant-${++id}`,
      now: () => now,
      grantTtlMs: 10_000,
      maximumGrants: 1,
    });
    const firstGrant = await broker.issue(first, 'read-only');
    const secondGrant = await broker.issue(second, 'read-only');
    await expect(broker.resolve(firstGrant.grantId, 'read-only')).rejects.toThrow('expired');
    await rm(second, { recursive: true, force: true });
    await expect(broker.resolve(secondGrant.grantId, 'read-only')).rejects.toThrow('unavailable');

    const third = await temporaryDirectory();
    const thirdGrant = await broker.issue(third, 'read-only');
    now = thirdGrant.expiresAt;
    await expect(broker.resolve(thirdGrant.grantId, 'read-only')).rejects.toThrow('expired');
  });

  it('rejects filesystem roots and broad writable grants while allowing explicit read-only access', async () => {
    const protectedRoot = await temporaryDirectory();
    const child = join(protectedRoot, 'project');
    await mkdir(child);
    const broker = new CodexWorkspaceGrantBroker({
      protectedWritableRoots: [protectedRoot],
      createGrantId: () => 'protected',
    });
    const broadGrant = await broker.issue(protectedRoot, 'workspace-write');
    await expect(broker.resolve(broadGrant.grantId, 'read-only')).resolves.toBe(protectedRoot);
    await expect(broker.resolve(broadGrant.grantId, 'workspace-write'))
      .rejects.toThrow('narrower folder');

    const projectGrant = await broker.issue(child, 'workspace-write');
    await expect(broker.resolve(projectGrant.grantId, 'workspace-write')).resolves.toBe(child);
    await expect(broker.issue(parse(protectedRoot).root, 'read-only')).rejects.toThrow('filesystem root');
  });

  it('cannot upgrade a read-only grant without a new main-process approval', async () => {
    const directory = await temporaryDirectory();
    const broker = new CodexWorkspaceGrantBroker({ createGrantId: () => 'read-only' });
    const grant = await broker.issue(directory, 'read-only');
    await expect(broker.resolve(grant.grantId, 'read-only')).resolves.toBe(directory);
    await expect(broker.resolve(grant.grantId, 'workspace-write'))
      .rejects.toThrow('approve workspace-write');
    broker.revoke(grant.grantId);
    await expect(broker.resolve(grant.grantId, 'read-only')).rejects.toThrow('expired');
  });

  it('publishes a finite, read-only-first permission disclosure', () => {
    expect(codexSandboxModes).toEqual(['read-only', 'workspace-write']);
    expect(codexSandboxDisclosures['read-only']).toMatchObject({ recommended: true });
    expect(codexSandboxDisclosures['workspace-write']).toMatchObject({ recommended: false });
    expect(JSON.stringify(codexSandboxDisclosures)).not.toContain('danger-full-access');
  });
});
