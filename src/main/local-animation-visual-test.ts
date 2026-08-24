import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ScopedLocalAnimationVisualTestInput {
  exercise?: string;
  capturePath?: string;
  userDataPath?: string;
  animationPath?: string;
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
 * Allows the packaged interruption harness to bypass only the native file
 * chooser and only inside one uniquely named OS-temp subtree. Ordinary app
 * launches continue through explicit user selection.
 */
export function readScopedLocalAnimationVisualTestFile(
  input: ScopedLocalAnimationVisualTestInput,
): string | undefined {
  if (input.exercise !== 'vrma-interruption'
    || !input.capturePath
    || !input.userDataPath
    || !input.animationPath) return undefined;

  const testRoot = resolve(dirname(input.userDataPath));
  const temporaryRoot = resolve(input.temporaryRoot);
  const capturePath = resolve(input.capturePath);
  const animationPath = resolve(input.animationPath);
  if (!basename(testRoot).startsWith('desky-vrma-ui-')
    || !animationPath.toLowerCase().endsWith('.vrma')
    || !isProperDescendant(temporaryRoot, testRoot)
    || !isProperDescendant(testRoot, resolve(input.userDataPath))
    || !isProperDescendant(testRoot, capturePath)
    || !isProperDescendant(testRoot, animationPath)) {
    throw new Error('Invalid packaged local-animation test file.');
  }
  return animationPath;
}
