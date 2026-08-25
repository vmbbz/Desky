import {
  VRMExpressionPresetName,
  VRMHumanBoneName,
  type VRMHumanBoneName as VRMHumanBoneNameType,
} from '@pixiv/three-vrm';
import { describe, expect, it } from 'vitest';

import {
  assertCoreHumanoid,
  assertVrmUsageCompatible,
  coreRetargetBones,
  inspectVrmCapabilities,
  reviewVrmUsage,
  type VrmCapabilitySource,
  type VrmSpecVersion,
} from '../src/renderer/avatar/vrm-capabilities';

function representativeFixture(
  version: VrmSpecVersion,
  bones: readonly VRMHumanBoneNameType[] = coreRetargetBones,
): VrmCapabilitySource {
  const availableBones = new Set(bones);
  return {
    meta: version === '0'
      ? {
          metaVersion: '0',
          author: 'VRM 0 Artist',
          allowedUserName: 'Everyone',
          commercialUssageName: 'Allow',
          licenseName: 'CC0',
        }
      : {
          metaVersion: '1',
          authors: ['VRM 1 Artist'],
          avatarPermission: 'everyone',
          commercialUsage: 'corporation',
          allowRedistribution: true,
          creditNotation: 'unnecessary',
          licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        },
    humanoid: {
      getNormalizedBoneNode: (boneName) => availableBones.has(boneName) ? {} : null,
    },
    expressionManager: {
      presetExpressionMap: {
        [VRMExpressionPresetName.Aa]: {},
        [VRMExpressionPresetName.Ih]: {},
        [VRMExpressionPresetName.Ou]: {},
        [VRMExpressionPresetName.Ee]: {},
        [VRMExpressionPresetName.Oh]: {},
        [VRMExpressionPresetName.BlinkLeft]: {},
        [VRMExpressionPresetName.BlinkRight]: {},
      },
    },
    lookAt: {},
    springBoneManager: { joints: { size: version === '0' ? 4 : 6 } },
  };
}

describe('VRM capability inspection', () => {
  it.each([
    ['0', 'VRM 0.x', true, 4],
    ['1', 'VRM 1.0', false, 6],
  ] as const)(
    'describes representative VRM %s metadata and normalized humanoid capabilities',
    (version, label, requiresLegacyRotation, springBoneJointCount) => {
      const capabilities = inspectVrmCapabilities(representativeFixture(version));

      expect(capabilities).toMatchObject({
        specVersion: version,
        specLabel: label,
        requiresLegacyRotation,
        missingCoreBones: [],
        supportsBlink: true,
        supportsLookAt: true,
        springBoneJointCount,
      });
      expect(capabilities.availableVisemes).toHaveLength(5);
      expect(() => assertCoreHumanoid(capabilities)).not.toThrow();
    },
  );

  it('fails with the exact missing retarget bones', () => {
    const bones = coreRetargetBones.filter(
      (boneName) => boneName !== VRMHumanBoneName.LeftFoot,
    );
    const capabilities = inspectVrmCapabilities(representativeFixture('1', bones));

    expect(capabilities.missingCoreBones).toEqual([VRMHumanBoneName.LeftFoot]);
    expect(() => assertCoreHumanoid(capabilities)).toThrow(
      'Avatar is missing required humanoid bones: leftFoot',
    );
  });
});

describe('embedded VRM usage review', () => {
  it('preserves compatible creator and credit metadata', () => {
    expect(
      reviewVrmUsage(
        {
          metaVersion: '1',
          authors: ['Avatar Author'],
          avatarPermission: 'everyone',
          commercialUsage: 'corporation',
          allowRedistribution: true,
          creditNotation: 'required',
          licenseUrl: 'https://example.com/license',
        },
        'CC-BY-4.0',
      ),
    ).toEqual({
      status: 'compatible',
      reasons: [],
      creator: 'Avatar Author',
      embeddedLicense: 'https://example.com/license',
      requiresCredit: true,
    });
  });

  it('blocks catalog and embedded-permission conflicts', () => {
    const review = reviewVrmUsage(
      {
        metaVersion: '0',
        author: 'Avatar Author',
        allowedUserName: 'OnlyAuthor',
        commercialUssageName: 'Disallow',
        licenseName: 'CC_BY_NC',
      },
      'CC0',
    );

    expect(review.status).toBe('blocked');
    expect(review.reasons).toEqual(expect.arrayContaining([
      'Embedded VRM permissions do not allow everyone to use the avatar',
      'Embedded VRM permissions prohibit commercial use',
      'Catalog licence CC0 conflicts with embedded licence CC_BY_NC',
    ]));
    expect(() => assertVrmUsageCompatible(review)).toThrow(
      'Embedded VRM permissions do not allow everyone to use the avatar',
    );
  });

  it('blocks a VRM 1.0 licence URL that contradicts catalog CC0', () => {
    const review = reviewVrmUsage(
      {
        metaVersion: '1',
        authors: ['Avatar Author'],
        avatarPermission: 'everyone',
        commercialUsage: 'corporation',
        allowRedistribution: true,
        creditNotation: 'unnecessary',
        licenseUrl: 'https://example.com/restricted-license',
      },
      'CC0',
    );

    expect(review).toMatchObject({ status: 'blocked' });
    expect(review.reasons).toContain(
      'Catalog licence CC0 conflicts with embedded licence URL https://example.com/restricted-license',
    );
  });

  it('treats the SPDX CC0-1.0 identifier as the same strict licence declaration', () => {
    expect(reviewVrmUsage({
      metaVersion: '0', allowedUserName: 'Everyone', commercialUssageName: 'Allow',
      licenseName: 'CC_BY_NC',
    }, 'CC0-1.0')).toMatchObject({ status: 'blocked' });
  });
});
