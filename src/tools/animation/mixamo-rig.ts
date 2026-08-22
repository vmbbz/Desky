import {
  VRMHumanBoneName,
  type VRMHumanBoneName as VRMHumanBoneNameType,
} from '@pixiv/three-vrm';

const rigMap: Readonly<Record<string, VRMHumanBoneNameType>> = {
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

export function normalizeMixamoNodeName(value: string): string {
  const leaf = value.split(/[|/\\]/).at(-1) ?? value;
  return leaf.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function resolveMixamoBone(value: string): VRMHumanBoneNameType | undefined {
  return rigMap[normalizeMixamoNodeName(value)];
}
