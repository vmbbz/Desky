import { describe, expect, it } from 'vitest';
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { Group } from 'three';

import builtInAnimationLibrary from '../src/assets/animations/quaternius-uam-standard-v1.library.json';
import {
  admitAnimationLibrary,
  selectActionProgram,
} from '../src/renderer/avatar/animation-library-runtime';
import { parseAnimationLibrary } from '../src/shared/animation-library';
import { createVrmAnimationClip } from '../src/renderer/avatar/create-vrm-animation-clip';
import { AvatarMotionController } from '../src/renderer/avatar/avatar-motion-controller';

function targetVrm(metaVersion: '0' | '1'): VRM {
  const scene = new Group();
  const bones = new Map<string, Group>();
  for (const boneName of Object.values(VRMHumanBoneName)) {
    const node = new Group();
    node.name = `${metaVersion}-${boneName}`;
    bones.set(boneName, node);
    scene.add(node);
  }
  return {
    scene,
    meta: { metaVersion },
    humanoid: {
      normalizedRestPose: { hips: { position: [0, 1.5, 0] } },
      getNormalizedBoneNode: (boneName: string) => bones.get(boneName) ?? null,
    },
  } as VRM;
}

describe('built-in CC0 animation library', () => {
  it('contains the complete reviewed Standard inventories without authoring poses', () => {
    const library = parseAnimationLibrary(builtInAnimationLibrary);

    expect(library.sourceArchives.map((source) => source.clipCount)).toEqual([43, 43]);
    expect(library.clips).toHaveLength(84);
    expect(library.clips.some((clip) => clip.label === 'A TPose')).toBe(false);
    expect(library.states.map((state) => state.mode)).toEqual(['idle', 'speaking', 'working']);
    expect(library.programs).toHaveLength(15);
  });

  it('keeps filenames and autonomous policy in the asset file, including rich edge cases', () => {
    const library = parseAnimationLibrary(builtInAnimationLibrary);
    const labels = new Set(library.clips.map((clip) => clip.label));
    for (const expected of [
      'Idle FoldArms Loop',
      'Idle TalkingPhone Loop',
      'Walk Loop',
      'Sprint Loop',
      'Sitting Enter',
      'Sitting Idle Loop',
      'LayToIdle',
      'Swim Fwd Loop',
      'Crouch Fwd Loop',
      'Spell Simple Shoot',
      'Sword Idle',
      'Driving Loop',
    ]) {
      expect(labels.has(expected), expected).toBe(true);
    }

    const ambient = library.programs.filter((program) => program.trigger.kind === 'ambient');
    expect(ambient.length).toBeGreaterThanOrEqual(10);
    expect(ambient.every((program) => program.trigger.kind === 'ambient' &&
      program.trigger.modes.includes('idle'))).toBe(true);
    expect(ambient.some((program) => program.programId === 'sit-and-chat' && program.steps.length === 4)).toBe(true);
    expect(library.programs.find((program) => program.programId === 'sleep-transition-candidate')?.trigger.kind).toBe('catalog');
  });

  it('cryptographically admits every clip and resolves Jump as a two-file action program', async () => {
    const library = await admitAnimationLibrary(builtInAnimationLibrary);
    const jump = selectActionProgram(library, 'jump');

    expect(library.clipCount).toBe(84);
    expect(library.stateRegistrations).toHaveLength(3);
    expect(jump?.steps.map((step) => step.clip.label)).toEqual(['Jump Start', 'Jump Land']);
  });

  it('binds all 84 canonical clips to structural VRM 0.x and 1.0 targets', async () => {
    const library = await admitAnimationLibrary(builtInAnimationLibrary);
    for (const version of ['0', '1'] as const) {
      const vrm = targetVrm(version);
      for (const definition of library.clips.values()) {
        const clip = createVrmAnimationClip(definition.canonical, vrm);
        expect(clip.duration, `${version}:${definition.clipId}`).toBeGreaterThan(0);
        expect(clip.tracks.length, `${version}:${definition.clipId}`).toBeGreaterThan(0);
      }
    }
  });

  it('executes and settles the real two-step Jump program through the single body owner', async () => {
    const library = await admitAnimationLibrary(builtInAnimationLibrary);
    const vrm = targetVrm('1');
    const controller = new AvatarMotionController(vrm, vrm.scene, library.stateRegistrations, {
      animationLibrary: library,
    });

    expect(controller.queueMotionCue('jump', 'agent')).toBe(true);
    controller.update(0.016, 0);
    expect(controller.activeMotionCue?.programId).toBe('jump');

    for (let frame = 1; frame <= 50; frame += 1) {
      controller.update(0.1, frame / 10);
    }
    expect(controller.activeMotionCue).toBeUndefined();
    expect(controller.currentPlan.mode).toBe('idle');
    expect(controller.lastClipError).toBeUndefined();
    controller.dispose();
  });
});
