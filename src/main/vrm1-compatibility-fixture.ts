import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { SelectedAvatarAsset } from '../shared/avatar-assets';
import type { AdmittedAvatarRevision } from './marketplace-catalog';

const registryCommit = '821c11b250d8c70d5804ee13431e42bee56ea9c0';

/**
 * A provenance-pinned compatibility fixture, not a marketplace offer. The
 * binary remains external and is admitted only by the packaged test harness.
 */
export const vrm1CompatibilityRevision: AdmittedAvatarRevision = {
  avatar: {
    avatarId: 'compatibility.seed-san',
    productId: 'compatibility.seed-san',
    revisionId: 'seed-san-624d0d55-v1',
    name: 'Seed-san',
    description: 'Official VRM 1.0 compatibility fixture.',
    creator: 'VirtualCast, Inc.',
    projectId: 'vrm-c-vrm-specification',
    projectName: 'VRM Specification Samples',
    sourceUrl: `https://github.com/vrm-c/vrm-specification/tree/${registryCommit}/samples/Seed-san`,
    licenseId: 'VRM-Public-License-1.0',
    licenseUrl: 'https://vrm.dev/licenses/1.0/',
    attribution: 'Seed-san by VirtualCast, Inc. · VRM Public License 1.0',
    modelSha256: '624d0d554bc205bbdc33e22a68a2c3c20edebb3e573011ead8878a65e5329b23',
    animationProfileId: 'desky-humanoid-standard-v1',
    vrmVersion: '1.0',
    performanceClass: 'standard',
    admissionStatus: 'candidate',
    availability: 'unavailable',
  },
  registryCommit,
  sourceRecordSha256: 'f0fdc21cf26437d9becd90a64d350bc0307fcfa172e1caea5aa39c52a5b3b9b6',
  modelUrl: `https://raw.githubusercontent.com/vrm-c/vrm-specification/${registryCommit}/samples/Seed-san/vrm/Seed-san.vrm`,
  thumbnailUrl: `https://raw.githubusercontent.com/vrm-c/vrm-specification/${registryCommit}/samples/Seed-san/screenshot/screenshot.png`,
  thumbnailSha256: 'c516bc73cb5bd158c2258cbb772f877d56badf343ee89bd7c452c3520f1dab37',
  thumbnailBytes: 51_693,
  modelBytes: 10_917_800,
  sourceUpdatedAt: '2022-09-28T08:36:52.000Z',
};

export interface ScopedVrm1CompatibilityInput {
  exercise?: string;
  capturePath?: string;
  userDataPath?: string;
  avatarPath?: string;
  temporaryRoot: string;
}

const admittedExercises = new Set([
  'vrm1-compatibility',
  'vrm1-jump',
  'vrm1-state-cycle',
]);

function isProperDescendant(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot.length > 0
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

export function readScopedVrm1CompatibilityFile(
  input: ScopedVrm1CompatibilityInput,
): string | undefined {
  if (!input.exercise
    || !admittedExercises.has(input.exercise)
    || !input.capturePath
    || !input.userDataPath
    || !input.avatarPath) return undefined;

  const testRoot = resolve(dirname(input.userDataPath));
  const temporaryRoot = resolve(input.temporaryRoot);
  const capturePath = resolve(input.capturePath);
  const avatarPath = resolve(input.avatarPath);
  if (!basename(testRoot).startsWith('desky-vrm1-ui-')
    || !avatarPath.toLowerCase().endsWith('.vrm')
    || !isProperDescendant(temporaryRoot, testRoot)
    || !isProperDescendant(testRoot, resolve(input.userDataPath))
    || !isProperDescendant(testRoot, capturePath)
    || !isProperDescendant(testRoot, avatarPath)) {
    throw new Error('Invalid packaged VRM 1.0 compatibility fixture path.');
  }
  return avatarPath;
}

export function admitVrm1CompatibilityFixture(bytes: Uint8Array): SelectedAvatarAsset {
  const revision = vrm1CompatibilityRevision;
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== revision.modelBytes || digest !== revision.avatar.modelSha256) {
    throw new Error('Packaged VRM 1.0 compatibility fixture does not match its pinned identity.');
  }
  const isolatedBytes = Uint8Array.from(bytes).buffer;
  return {
    avatar: {
      avatarId: revision.avatar.avatarId,
      revisionId: revision.avatar.revisionId,
      animationProfileId: revision.avatar.animationProfileId,
      name: revision.avatar.name,
      projectId: revision.avatar.projectId,
      projectName: revision.avatar.projectName,
      licenseId: revision.avatar.licenseId,
      modelUrl: revision.modelUrl,
    },
    bytes: isolatedBytes,
  };
}
