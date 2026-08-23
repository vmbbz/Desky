import { describe, expect, it } from 'vitest';

import { motionPreferences, resolveReducedMotion } from '../src/shared/runtime';

describe('avatar motion preference', () => {
  it('follows the system by default and permits explicit full/reduced session overrides', () => {
    expect(motionPreferences).toEqual(['system', 'full', 'reduced']);
    expect(resolveReducedMotion('system', true)).toBe(true);
    expect(resolveReducedMotion('system', false)).toBe(false);
    expect(resolveReducedMotion('full', true)).toBe(false);
    expect(resolveReducedMotion('reduced', false)).toBe(true);
  });
});
