export const motionPersonalityPresets = [
  'paused',
  'quiet',
  'balanced',
  'lively',
  'custom',
] as const;

export type MotionPersonalityPreset = (typeof motionPersonalityPresets)[number];

export const motionCategories = [
  'presence',
  'conversation',
  'reactions',
  'playful',
  'locomotion',
] as const;

export type MotionCategory = (typeof motionCategories)[number];
export type MotionCategoryLevel = 0 | 1 | 2 | 3;

export interface MotionPersonalityPolicy {
  schemaVersion: 1;
  preset: MotionPersonalityPreset;
  categories: Record<MotionCategory, MotionCategoryLevel>;
}

const presetCategories: Record<Exclude<MotionPersonalityPreset, 'custom'>, MotionPersonalityPolicy['categories']> = {
  paused: {
    presence: 0,
    conversation: 0,
    reactions: 0,
    playful: 0,
    locomotion: 0,
  },
  quiet: {
    presence: 1,
    conversation: 1,
    reactions: 1,
    playful: 0,
    locomotion: 0,
  },
  balanced: {
    presence: 2,
    conversation: 2,
    reactions: 2,
    playful: 1,
    locomotion: 1,
  },
  lively: {
    presence: 3,
    conversation: 3,
    reactions: 3,
    playful: 2,
    locomotion: 2,
  },
};

export const defaultMotionPersonality: MotionPersonalityPolicy = {
  schemaVersion: 1,
  preset: 'balanced',
  categories: { ...presetCategories.balanced },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCategoryLevel(value: unknown): value is MotionCategoryLevel {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 3;
}

export function motionPersonalityForPreset(
  preset: Exclude<MotionPersonalityPreset, 'custom'>,
): MotionPersonalityPolicy {
  return {
    schemaVersion: 1,
    preset,
    categories: { ...presetCategories[preset] },
  };
}

export function parseMotionPersonalityPolicy(value: unknown): MotionPersonalityPolicy {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.preset !== 'string'
    || !motionPersonalityPresets.includes(value.preset as MotionPersonalityPreset)
    || !isRecord(value.categories)) {
    throw new Error('Invalid motion personality policy.');
  }
  const categories = {} as MotionPersonalityPolicy['categories'];
  for (const category of motionCategories) {
    const level = value.categories[category];
    if (!isCategoryLevel(level)) throw new Error('Invalid motion personality category level.');
    categories[category] = level;
  }
  const preset = value.preset as MotionPersonalityPreset;
  if (preset !== 'custom') {
    const expected = presetCategories[preset];
    if (motionCategories.some((category) => categories[category] !== expected[category])) {
      throw new Error('Motion personality preset categories do not match the preset.');
    }
  }
  return { schemaVersion: 1, preset, categories };
}

export function normalizeMotionPersonalityPolicy(value: unknown): MotionPersonalityPolicy {
  try {
    return parseMotionPersonalityPolicy(value);
  } catch {
    return structuredClone(defaultMotionPersonality);
  }
}

export function motionCategoryForTags(tags: readonly string[]): MotionCategory {
  const set = new Set(tags);
  if (set.has('locomotion') || set.has('walk') || set.has('run')) return 'locomotion';
  if (set.has('dance') || set.has('magic') || set.has('celebration')) return 'playful';
  if (set.has('affirmation') || set.has('nod') || set.has('reaction')) return 'reactions';
  if (set.has('conversation') || set.has('speaking') || set.has('thinking')) return 'conversation';
  return 'presence';
}

export function motionQuietIntervalScale(policy: MotionPersonalityPolicy): number {
  if (policy.preset === 'quiet') return 2.25;
  if (policy.preset === 'lively') return 0.58;
  if (policy.preset !== 'custom') return 1;
  const average = motionCategories.reduce(
    (sum, category) => sum + policy.categories[category],
    0,
  ) / motionCategories.length;
  if (average <= 0.5) return 2.5;
  if (average <= 1.5) return 1.65;
  if (average >= 2.5) return 0.68;
  return 1;
}
