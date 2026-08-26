import { describe, expect, it } from 'vitest';

import builtInAnimationProfile from '../src/assets/animations/desky-humanoid-standard-v1.profile.json';
import {
  assertAnimationProfileBones,
  parseAvatarAnimationProfile,
} from '../src/shared/avatar-animation-profile';

describe('avatar animation profile', () => {
  it('admits the reviewed file-defined humanoid profile', () => {
    const profile = parseAvatarAnimationProfile(builtInAnimationProfile);
    expect(profile.profileId).toBe('desky-humanoid-standard-v1');
    expect(profile.rootMotion).toBe('forbidden');
    expect(profile.stateModes).toEqual(['idle', 'thinking', 'speaking', 'working']);
    expect(profile.programs.map((program) => program.programId)).toEqual([
      'phone-check',
      'dance-break',
      'formal-walk',
      'jump',
    ]);
  });

  it('rejects duplicate program ownership and unapproved review data', () => {
    const duplicate = structuredClone(builtInAnimationProfile);
    duplicate.programs.push(duplicate.programs[0]);
    expect(() => parseAvatarAnimationProfile(duplicate)).toThrow(/unique/);

    const pending = structuredClone(builtInAnimationProfile) as unknown as {
      review: { status: string; reviewer: string; reviewedAt: string };
    };
    pending.review.status = 'pending';
    expect(() => parseAvatarAnimationProfile(pending)).toThrow(/not approved/);
  });

  it('fails before playback when an avatar lacks a profile-required bone', () => {
    const profile = parseAvatarAnimationProfile(builtInAnimationProfile);
    expect(() => assertAnimationProfileBones(
      profile,
      profile.requiredBones.filter((bone) => bone !== 'rightHand'),
    )).toThrow(/rightHand/);
    expect(() => assertAnimationProfileBones(profile, profile.requiredBones)).not.toThrow();
  });
});
