import { describe, expect, it } from 'vitest';

import { shouldDisableAvatarNetwork } from '../src/main/visual-test-policy';

describe('visual-test avatar network policy', () => {
  it('keeps explicit avatar offline exercises isolated', () => {
    expect(shouldDisableAvatarNetwork('1', 'activate-avatar')).toBe(true);
  });

  it('does not contaminate the authenticated Codex exercise with an avatar failure', () => {
    expect(shouldDisableAvatarNetwork('1', 'codex-ui')).toBe(false);
  });

  it('allows ordinary live avatar acquisition', () => {
    expect(shouldDisableAvatarNetwork(undefined, undefined)).toBe(false);
  });
});
