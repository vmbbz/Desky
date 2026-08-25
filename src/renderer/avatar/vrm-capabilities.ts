import {
  VRMExpressionPresetName,
  VRMHumanBoneName,
  type VRMHumanBoneName as VRMHumanBoneNameType,
} from '@pixiv/three-vrm';

export type VrmSpecVersion = '0' | '1';

export interface VrmUsageMetadata {
  metaVersion: VrmSpecVersion;
  author?: string;
  authors?: string[];
  allowedUserName?: 'Everyone' | 'ExplicitlyLicensedPerson' | 'OnlyAuthor';
  avatarPermission?: 'onlyAuthor' | 'onlySeparatelyLicensedPerson' | 'everyone';
  commercialUssageName?: 'Allow' | 'Disallow';
  commercialUsage?: 'personalNonProfit' | 'personalProfit' | 'corporation';
  licenseName?: string;
  licenseUrl?: string;
  allowRedistribution?: boolean;
  creditNotation?: 'required' | 'unnecessary';
}

export interface VrmCapabilitySource {
  meta: VrmUsageMetadata;
  humanoid: {
    getNormalizedBoneNode(name: VRMHumanBoneNameType): unknown;
  };
  expressionManager?: {
    presetExpressionMap: Record<string, unknown>;
  };
  lookAt?: unknown;
  springBoneManager?: {
    joints: { readonly size: number };
  };
}

export interface VrmCapabilities {
  specVersion: VrmSpecVersion;
  specLabel: 'VRM 0.x' | 'VRM 1.0';
  requiresLegacyRotation: boolean;
  availableBones: VRMHumanBoneNameType[];
  missingCoreBones: VRMHumanBoneNameType[];
  availableExpressions: string[];
  availableVisemes: string[];
  supportsBlink: boolean;
  supportsLookAt: boolean;
  springBoneJointCount: number;
}

export interface VrmUsageReview {
  status: 'compatible' | 'blocked';
  reasons: string[];
  creator?: string;
  embeddedLicense?: string;
  requiresCredit: boolean;
}

export const coreRetargetBones = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftUpperLeg,
  VRMHumanBoneName.LeftLowerLeg,
  VRMHumanBoneName.LeftFoot,
  VRMHumanBoneName.RightUpperLeg,
  VRMHumanBoneName.RightLowerLeg,
  VRMHumanBoneName.RightFoot,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
] as const satisfies readonly VRMHumanBoneNameType[];

const speechVisemes = [
  VRMExpressionPresetName.Aa,
  VRMExpressionPresetName.Ih,
  VRMExpressionPresetName.Ou,
  VRMExpressionPresetName.Ee,
  VRMExpressionPresetName.Oh,
] as const;

export function inspectVrmCapabilities(source: VrmCapabilitySource): VrmCapabilities {
  const availableBones = (Object.values(VRMHumanBoneName) as VRMHumanBoneNameType[])
    .filter((boneName) => Boolean(source.humanoid.getNormalizedBoneNode(boneName)));
  const availableSet = new Set(availableBones);
  const availableExpressions = Object.entries(
    source.expressionManager?.presetExpressionMap ?? {},
  )
    .filter(([, expression]) => Boolean(expression))
    .map(([name]) => name)
    .sort();
  const expressionSet = new Set(availableExpressions);

  return {
    specVersion: source.meta.metaVersion,
    specLabel: source.meta.metaVersion === '0' ? 'VRM 0.x' : 'VRM 1.0',
    requiresLegacyRotation: source.meta.metaVersion === '0',
    availableBones,
    missingCoreBones: coreRetargetBones.filter((boneName) => !availableSet.has(boneName)),
    availableExpressions,
    availableVisemes: speechVisemes.filter((name) => expressionSet.has(name)),
    supportsBlink:
      expressionSet.has(VRMExpressionPresetName.Blink) ||
      (expressionSet.has(VRMExpressionPresetName.BlinkLeft) &&
        expressionSet.has(VRMExpressionPresetName.BlinkRight)),
    supportsLookAt: Boolean(source.lookAt),
    springBoneJointCount: source.springBoneManager?.joints.size ?? 0,
  };
}

export function assertCoreHumanoid(capabilities: VrmCapabilities): void {
  if (capabilities.missingCoreBones.length === 0) return;
  throw new Error(
    `Avatar is missing required humanoid bones: ${capabilities.missingCoreBones.join(', ')}`,
  );
}

export function reviewVrmUsage(
  metadata: VrmUsageMetadata,
  declaredLicenseId: string,
): VrmUsageReview {
  const reasons: string[] = [];
  let creator: string | undefined;
  let embeddedLicense: string | undefined;
  let requiresCredit = false;

  if (metadata.metaVersion === '0') {
    creator = metadata.author?.trim() || undefined;
    embeddedLicense = metadata.licenseName;
    if (
      metadata.allowedUserName === 'OnlyAuthor' ||
      metadata.allowedUserName === 'ExplicitlyLicensedPerson'
    ) {
      reasons.push('Embedded VRM permissions do not allow everyone to use the avatar');
    }
    if (metadata.commercialUssageName === 'Disallow') {
      reasons.push('Embedded VRM permissions prohibit commercial use');
    }
    if (
      metadata.licenseName === 'Redistribution_Prohibited' ||
      metadata.licenseName?.includes('_NC')
    ) {
      reasons.push(`Embedded VRM licence is incompatible: ${metadata.licenseName}`);
    }
    if (
      isDeclaredCc0(declaredLicenseId) &&
      metadata.licenseName &&
      metadata.licenseName !== 'CC0'
    ) {
      reasons.push(
        `Catalog licence CC0 conflicts with embedded licence ${metadata.licenseName}`,
      );
    }
    requiresCredit = metadata.licenseName === 'CC_BY';
  } else {
    creator = metadata.authors?.map((author) => author.trim()).filter(Boolean).join(', ') || undefined;
    embeddedLicense = metadata.licenseUrl;
    if (
      metadata.avatarPermission === 'onlyAuthor' ||
      metadata.avatarPermission === 'onlySeparatelyLicensedPerson'
    ) {
      reasons.push('Embedded VRM permissions do not allow everyone to use the avatar');
    }
    if (metadata.commercialUsage === 'personalNonProfit') {
      reasons.push('Embedded VRM permissions do not allow commercial use');
    }
    if (metadata.allowRedistribution === false) {
      reasons.push('Embedded VRM permissions prohibit redistribution');
    }
    if (
      isDeclaredCc0(declaredLicenseId) &&
      metadata.licenseUrl &&
      !isRecognizedCc0Url(metadata.licenseUrl)
    ) {
      reasons.push(
        `Catalog licence CC0 conflicts with embedded licence URL ${metadata.licenseUrl}`,
      );
    }
    requiresCredit = metadata.creditNotation === 'required';
  }

  return {
    status: reasons.length === 0 ? 'compatible' : 'blocked',
    reasons,
    creator,
    embeddedLicense,
    requiresCredit,
  };
}

function isDeclaredCc0(value: string): boolean {
  return value.trim().toUpperCase() === 'CC0' || value.trim().toUpperCase() === 'CC0-1.0';
}

function isRecognizedCc0Url(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return (
      (host === 'creativecommons.org' && path.startsWith('/publicdomain/zero/1.0')) ||
      (host === 'spdx.org' && path.startsWith('/licenses/cc0-1.0'))
    );
  } catch {
    return false;
  }
}

export function assertVrmUsageCompatible(review: VrmUsageReview): void {
  if (review.status === 'compatible') return;
  throw new Error(review.reasons[0] ?? 'Avatar usage permissions are incompatible');
}
