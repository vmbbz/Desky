import { describe, expect, it } from 'vitest';

import {
  defaultMotionPersonality,
  motionCategoryForTags,
  motionPersonalityForPreset,
  motionQuietIntervalScale,
  normalizeMotionPersonalityPolicy,
  parseMotionPersonalityPolicy,
} from '../src/shared/motion-personality';

describe('motion personality policy', () => {
  it('creates deterministic human-facing presets', () => {
    expect(motionPersonalityForPreset('paused').categories).toEqual({
      presence: 0,
      conversation: 0,
      reactions: 0,
      playful: 0,
      locomotion: 0,
    });
    expect(motionPersonalityForPreset('balanced')).toEqual(defaultMotionPersonality);
    expect(motionQuietIntervalScale(motionPersonalityForPreset('quiet'))).toBeGreaterThan(2);
    expect(motionQuietIntervalScale(motionPersonalityForPreset('lively'))).toBeLessThan(1);
  });

  it('requires preset category values to match their declared preset', () => {
    expect(() => parseMotionPersonalityPolicy({
      ...motionPersonalityForPreset('quiet'),
      categories: { ...motionPersonalityForPreset('quiet').categories, playful: 3 },
    })).toThrow(/preset categories/);
  });

  it('accepts bounded custom categories and normalizes malformed persistence', () => {
    const custom = parseMotionPersonalityPolicy({
      schemaVersion: 1,
      preset: 'custom',
      categories: {
        presence: 3,
        conversation: 2,
        reactions: 1,
        playful: 0,
        locomotion: 0,
      },
    });
    expect(custom.categories.presence).toBe(3);
    expect(normalizeMotionPersonalityPolicy({ preset: 'lively' })).toEqual(defaultMotionPersonality);
  });

  it('maps semantic tags to categories without animation filenames', () => {
    expect(motionCategoryForTags(['ambient', 'phone'])).toBe('presence');
    expect(motionCategoryForTags(['ambient', 'dance'])).toBe('playful');
    expect(motionCategoryForTags(['ambient', 'locomotion', 'walk'])).toBe('locomotion');
    expect(motionCategoryForTags(['affirmation', 'nod'])).toBe('reactions');
  });
});
