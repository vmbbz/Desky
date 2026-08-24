import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readScopedCodexVisualTestWorkspace } from '../src/main/codex/visual-test-workspace';

function input(temporaryRoot = resolve(tmpdir(), 'desky-harness-tests')) {
  const testRoot = join(temporaryRoot, 'desky-codex-ui-1234');
  return {
    sandbox: 'read-only',
    exercise: 'codex-ui',
    capturePath: join(testRoot, 'capture.png'),
    userDataPath: join(testRoot, 'profile'),
    workspacePath: join(testRoot, 'workspace'),
    temporaryRoot,
  };
}

describe('packaged Codex visual-test workspace admission', () => {
  it('admits a read-only workspace within one named temporary test root', () => {
    const candidate = input();
    expect(readScopedCodexVisualTestWorkspace(candidate)).toBe(candidate.workspacePath);
  });

  it('does not activate without the complete test contract', () => {
    expect(readScopedCodexVisualTestWorkspace({ ...input(), exercise: undefined })).toBeUndefined();
    expect(readScopedCodexVisualTestWorkspace({ ...input(), sandbox: 'workspace-write' })).toBeUndefined();
  });

  it.each([
    ['ordinary root name', { userDataPath: join(input().temporaryRoot, 'ordinary', 'profile') }],
    ['workspace traversal', { workspacePath: resolve(input().temporaryRoot, '..', 'outside') }],
    ['capture traversal', { capturePath: resolve(input().temporaryRoot, '..', 'outside.png') }],
  ])('rejects %s', (_label, override) => {
    expect(() => readScopedCodexVisualTestWorkspace({ ...input(), ...override })).toThrow(
      'Invalid packaged Codex test workspace.',
    );
  });

  it.skipIf(process.platform !== 'win32')('rejects a cross-drive workspace on Windows', () => {
    const candidate = input();
    const currentDrive = parse(candidate.temporaryRoot).root.slice(0, 1).toUpperCase();
    const otherDrive = currentDrive === 'C' ? 'D' : 'C';
    expect(() => readScopedCodexVisualTestWorkspace({
      ...candidate,
      workspacePath: `${otherDrive}:\\outside`,
    })).toThrow('Invalid packaged Codex test workspace.');
  });
});
