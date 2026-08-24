import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readScopedLocalAnimationVisualTestFile } from '../src/main/local-animation-visual-test';

function input() {
  const testRoot = resolve(tmpdir(), 'desky-vrma-ui-1234');
  return {
    exercise: 'vrma-interruption',
    capturePath: join(testRoot, 'capture.png'),
    userDataPath: join(testRoot, 'profile'),
    animationPath: join(testRoot, 'fixture.vrma'),
    temporaryRoot: tmpdir(),
  };
}

describe('packaged local-animation visual-test file admission', () => {
  it('admits one VRMA inside the complete named temporary harness root', () => {
    const candidate = input();
    expect(readScopedLocalAnimationVisualTestFile(candidate)).toBe(candidate.animationPath);
  });

  it('does not activate without the exact exercise contract', () => {
    expect(readScopedLocalAnimationVisualTestFile({ ...input(), exercise: undefined }))
      .toBeUndefined();
  });

  it.each([
    ['ordinary root', { userDataPath: join(tmpdir(), 'ordinary', 'profile') }],
    ['capture traversal', { capturePath: resolve(tmpdir(), '..', 'outside.png') }],
    ['animation traversal', { animationPath: resolve(tmpdir(), '..', 'outside.vrma') }],
    ['wrong extension', { animationPath: join(resolve(tmpdir(), 'desky-vrma-ui-1234'), 'fixture.glb') }],
  ])('rejects %s', (_label, override) => {
    expect(() => readScopedLocalAnimationVisualTestFile({ ...input(), ...override }))
      .toThrow('Invalid packaged local-animation test file.');
  });
});
