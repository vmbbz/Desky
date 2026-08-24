import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ScopedCodexVisualTestWorkspaceInput {
  sandbox: unknown;
  exercise?: string;
  capturePath?: string;
  userDataPath?: string;
  workspacePath?: string;
  temporaryRoot: string;
}

function isProperDescendant(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot.length > 0
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

/**
 * Admits the packaged Codex UI harness only inside one uniquely named OS-temp
 * subtree. Production callers without the complete harness contract receive no
 * bypass and continue through the native folder-consent dialog.
 */
export function readScopedCodexVisualTestWorkspace(
  input: ScopedCodexVisualTestWorkspaceInput,
): string | undefined {
  if (input.sandbox !== 'read-only'
    || input.exercise !== 'codex-ui'
    || !input.capturePath
    || !input.userDataPath
    || !input.workspacePath) return undefined;

  const testRoot = resolve(dirname(input.userDataPath));
  const capturePath = resolve(input.capturePath);
  const workspace = resolve(input.workspacePath);
  const temporaryRoot = resolve(input.temporaryRoot);
  if (!basename(testRoot).startsWith('desky-codex-ui-')
    || !isProperDescendant(temporaryRoot, testRoot)
    || !isProperDescendant(testRoot, resolve(input.userDataPath))
    || !isProperDescendant(testRoot, capturePath)
    || !isProperDescendant(testRoot, workspace)) {
    throw new Error('Invalid packaged Codex test workspace.');
  }
  return workspace;
}
