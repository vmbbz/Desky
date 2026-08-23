import {
  VRMHumanBoneName,
  type VRMHumanBoneName as VRMHumanBoneNameType,
} from '@pixiv/three-vrm';

export const sourceRigProfiles = ['mixamo', 'quaternius-uam-v1'] as const;

export type SourceRigProfile = (typeof sourceRigProfiles)[number];

const mixamoRigMap: Readonly<Record<string, VRMHumanBoneNameType>> = {
  mixamorighips: VRMHumanBoneName.Hips,
  mixamorigspine: VRMHumanBoneName.Spine,
  mixamorigspine1: VRMHumanBoneName.Chest,
  mixamorigspine2: VRMHumanBoneName.UpperChest,
  mixamorigneck: VRMHumanBoneName.Neck,
  mixamorighead: VRMHumanBoneName.Head,
  mixamorigleftshoulder: VRMHumanBoneName.LeftShoulder,
  mixamorigleftarm: VRMHumanBoneName.LeftUpperArm,
  mixamorigleftforearm: VRMHumanBoneName.LeftLowerArm,
  mixamoriglefthand: VRMHumanBoneName.LeftHand,
  mixamoriglefthandthumb1: VRMHumanBoneName.LeftThumbMetacarpal,
  mixamoriglefthandthumb2: VRMHumanBoneName.LeftThumbProximal,
  mixamoriglefthandthumb3: VRMHumanBoneName.LeftThumbDistal,
  mixamoriglefthandindex1: VRMHumanBoneName.LeftIndexProximal,
  mixamoriglefthandindex2: VRMHumanBoneName.LeftIndexIntermediate,
  mixamoriglefthandindex3: VRMHumanBoneName.LeftIndexDistal,
  mixamoriglefthandmiddle1: VRMHumanBoneName.LeftMiddleProximal,
  mixamoriglefthandmiddle2: VRMHumanBoneName.LeftMiddleIntermediate,
  mixamoriglefthandmiddle3: VRMHumanBoneName.LeftMiddleDistal,
  mixamoriglefthandring1: VRMHumanBoneName.LeftRingProximal,
  mixamoriglefthandring2: VRMHumanBoneName.LeftRingIntermediate,
  mixamoriglefthandring3: VRMHumanBoneName.LeftRingDistal,
  mixamoriglefthandpinky1: VRMHumanBoneName.LeftLittleProximal,
  mixamoriglefthandpinky2: VRMHumanBoneName.LeftLittleIntermediate,
  mixamoriglefthandpinky3: VRMHumanBoneName.LeftLittleDistal,
  mixamorigrightshoulder: VRMHumanBoneName.RightShoulder,
  mixamorigrightarm: VRMHumanBoneName.RightUpperArm,
  mixamorigrightforearm: VRMHumanBoneName.RightLowerArm,
  mixamorigrighthand: VRMHumanBoneName.RightHand,
  mixamorigrighthandthumb1: VRMHumanBoneName.RightThumbMetacarpal,
  mixamorigrighthandthumb2: VRMHumanBoneName.RightThumbProximal,
  mixamorigrighthandthumb3: VRMHumanBoneName.RightThumbDistal,
  mixamorigrighthandindex1: VRMHumanBoneName.RightIndexProximal,
  mixamorigrighthandindex2: VRMHumanBoneName.RightIndexIntermediate,
  mixamorigrighthandindex3: VRMHumanBoneName.RightIndexDistal,
  mixamorigrighthandmiddle1: VRMHumanBoneName.RightMiddleProximal,
  mixamorigrighthandmiddle2: VRMHumanBoneName.RightMiddleIntermediate,
  mixamorigrighthandmiddle3: VRMHumanBoneName.RightMiddleDistal,
  mixamorigrighthandring1: VRMHumanBoneName.RightRingProximal,
  mixamorigrighthandring2: VRMHumanBoneName.RightRingIntermediate,
  mixamorigrighthandring3: VRMHumanBoneName.RightRingDistal,
  mixamorigrighthandpinky1: VRMHumanBoneName.RightLittleProximal,
  mixamorigrighthandpinky2: VRMHumanBoneName.RightLittleIntermediate,
  mixamorigrighthandpinky3: VRMHumanBoneName.RightLittleDistal,
  mixamorigleftupleg: VRMHumanBoneName.LeftUpperLeg,
  mixamorigleftleg: VRMHumanBoneName.LeftLowerLeg,
  mixamorigleftfoot: VRMHumanBoneName.LeftFoot,
  mixamoriglefttoebase: VRMHumanBoneName.LeftToes,
  mixamorigrightupleg: VRMHumanBoneName.RightUpperLeg,
  mixamorigrightleg: VRMHumanBoneName.RightLowerLeg,
  mixamorigrightfoot: VRMHumanBoneName.RightFoot,
  mixamorigrighttoebase: VRMHumanBoneName.RightToes,
};

const quaterniusUniversalRigMap: Readonly<Record<string, VRMHumanBoneNameType>> = {
  pelvis: VRMHumanBoneName.Hips,
  spine01: VRMHumanBoneName.Spine,
  spine02: VRMHumanBoneName.Chest,
  spine03: VRMHumanBoneName.UpperChest,
  neck01: VRMHumanBoneName.Neck,
  head: VRMHumanBoneName.Head,
  claviclel: VRMHumanBoneName.LeftShoulder,
  upperarml: VRMHumanBoneName.LeftUpperArm,
  lowerarml: VRMHumanBoneName.LeftLowerArm,
  handl: VRMHumanBoneName.LeftHand,
  thumb01l: VRMHumanBoneName.LeftThumbMetacarpal,
  thumb02l: VRMHumanBoneName.LeftThumbProximal,
  thumb03l: VRMHumanBoneName.LeftThumbDistal,
  index01l: VRMHumanBoneName.LeftIndexProximal,
  index02l: VRMHumanBoneName.LeftIndexIntermediate,
  index03l: VRMHumanBoneName.LeftIndexDistal,
  middle01l: VRMHumanBoneName.LeftMiddleProximal,
  middle02l: VRMHumanBoneName.LeftMiddleIntermediate,
  middle03l: VRMHumanBoneName.LeftMiddleDistal,
  ring01l: VRMHumanBoneName.LeftRingProximal,
  ring02l: VRMHumanBoneName.LeftRingIntermediate,
  ring03l: VRMHumanBoneName.LeftRingDistal,
  pinky01l: VRMHumanBoneName.LeftLittleProximal,
  pinky02l: VRMHumanBoneName.LeftLittleIntermediate,
  pinky03l: VRMHumanBoneName.LeftLittleDistal,
  clavicler: VRMHumanBoneName.RightShoulder,
  upperarmr: VRMHumanBoneName.RightUpperArm,
  lowerarmr: VRMHumanBoneName.RightLowerArm,
  handr: VRMHumanBoneName.RightHand,
  thumb01r: VRMHumanBoneName.RightThumbMetacarpal,
  thumb02r: VRMHumanBoneName.RightThumbProximal,
  thumb03r: VRMHumanBoneName.RightThumbDistal,
  index01r: VRMHumanBoneName.RightIndexProximal,
  index02r: VRMHumanBoneName.RightIndexIntermediate,
  index03r: VRMHumanBoneName.RightIndexDistal,
  middle01r: VRMHumanBoneName.RightMiddleProximal,
  middle02r: VRMHumanBoneName.RightMiddleIntermediate,
  middle03r: VRMHumanBoneName.RightMiddleDistal,
  ring01r: VRMHumanBoneName.RightRingProximal,
  ring02r: VRMHumanBoneName.RightRingIntermediate,
  ring03r: VRMHumanBoneName.RightRingDistal,
  pinky01r: VRMHumanBoneName.RightLittleProximal,
  pinky02r: VRMHumanBoneName.RightLittleIntermediate,
  pinky03r: VRMHumanBoneName.RightLittleDistal,
  thighl: VRMHumanBoneName.LeftUpperLeg,
  calfl: VRMHumanBoneName.LeftLowerLeg,
  footl: VRMHumanBoneName.LeftFoot,
  balll: VRMHumanBoneName.LeftToes,
  thighr: VRMHumanBoneName.RightUpperLeg,
  calfr: VRMHumanBoneName.RightLowerLeg,
  footr: VRMHumanBoneName.RightFoot,
  ballr: VRMHumanBoneName.RightToes,
};

const rigMaps: Readonly<Record<SourceRigProfile, Readonly<Record<string, VRMHumanBoneNameType>>>> = {
  mixamo: mixamoRigMap,
  'quaternius-uam-v1': quaterniusUniversalRigMap,
};

export function normalizeMixamoNodeName(value: string): string {
  const leaf = value.split(/[|/\\]/).at(-1) ?? value;
  return leaf.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function resolveMixamoBone(value: string): VRMHumanBoneNameType | undefined {
  return resolveSourceBone(value, 'mixamo');
}

export function resolveSourceBone(
  value: string,
  profile: SourceRigProfile,
): VRMHumanBoneNameType | undefined {
  return rigMaps[profile][normalizeMixamoNodeName(value)];
}
