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

describe('built-in admitted animation library', () => {
  it('contains the complete reviewed Standard inventories and the exact look-around idle', () => {
    const library = parseAnimationLibrary(builtInAnimationLibrary);

    expect(library.licenseId).toBe('MIXED');
    expect(library.sourceArchives.map((source) => source.clipCount)).toEqual([43, 43, 1]);
    expect(library.clips).toHaveLength(85);
    expect(library.clips.some((clip) => clip.label === 'A TPose')).toBe(false);
    expect(library.states.map((state) => state.mode)).toEqual(['idle', 'thinking', 'speaking', 'working']);
    expect(library.states.find((state) => state.mode === 'idle')?.clipId)
      .toBe('mixamo-look-around-mixamo-com-v1');
    const lookingAround = library.clips.find((clip) => clip.label === 'Looking Around');
    expect(lookingAround?.canonical.durationSeconds).toBe(11.4);
    expect(lookingAround?.manifest.source.licenseId).toBe('LicenseRef-Adobe-Mixamo');
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
    expect(ambient).toHaveLength(3);
    expect(ambient.every((program) => program.trigger.kind === 'ambient' &&
      program.trigger.modes.includes('idle') &&
      program.trigger.modes.includes('disconnected'))).toBe(true);
    expect(ambient.map((program) => program.programId).sort()).toEqual([
      'dance-break',
      'formal-walk',
      'phone-check',
    ].sort());
    expect(ambient.every((program) => program.trigger.kind === 'ambient' &&
      program.trigger.cycle === undefined)).toBe(true);
    expect(library.programs.find((program) => program.programId === 'head-shake-candidate')?.trigger.kind)
      .toBe('catalog');
    expect(library.programs.find((program) => program.programId === 'celebration-fist-pump')?.trigger.kind)
      .toBe('catalog');
    expect(library.programs.find((program) => program.programId === 'crouch-search')?.trigger.kind)
      .toBe('catalog');
    const sitAndChat = library.programs.find((program) => program.programId === 'sit-and-chat');
    expect(sitAndChat?.steps).toHaveLength(4);
    expect(sitAndChat?.trigger.kind).toBe('catalog');
    expect(library.programs.find((program) => program.programId === 'sleep-transition-candidate')?.trigger.kind).toBe('catalog');
  });

  it('rejects incomplete or mixed ambient cadence policy', () => {
    type MutableLibrary = {
      programs: Array<{ programId: string; trigger: Record<string, unknown> }>;
    };
    const incomplete = structuredClone(builtInAnimationLibrary) as unknown as MutableLibrary;
    const dance = incomplete.programs.find((program) => program.programId === 'dance-break')!;
    dance.trigger.cycle = { id: 'primary-idle', length: 3, slots: [] };
    expect(() => parseAnimationLibrary(incomplete)).toThrow('ambient cycle slots');

    const mixed = structuredClone(builtInAnimationLibrary) as unknown as MutableLibrary;
    const bored = mixed.programs.find((program) => program.programId === 'bored-fold-arms')!;
    bored.trigger = {
      kind: 'ambient',
      modes: ['idle', 'disconnected'],
      weight: 1,
      minimumQuietSeconds: 4,
      maximumQuietSeconds: 7,
      cooldownSeconds: 0,
      cycle: { id: 'primary-idle', length: 3, slots: [0, 1, 2] },
    };
    expect(() => parseAnimationLibrary(mixed)).toThrow('mixes cycled and weighted programs');
  });

  it('rejects a false single-licence label for the mixed built-in sources', () => {
    const mislabeled = structuredClone(builtInAnimationLibrary) as unknown as {
      licenseId: string;
    };
    mislabeled.licenseId = 'CC0-1.0';
    expect(() => parseAnimationLibrary(mislabeled)).toThrow(
      'cannot contain a differently licensed source',
    );
  });

  it('cryptographically admits every clip and resolves Jump as a two-file action program', async () => {
    const library = await admitAnimationLibrary(builtInAnimationLibrary);
    const jump = selectActionProgram(library, 'jump');

    expect(library.clipCount).toBe(85);
    expect(library.stateRegistrations).toHaveLength(4);
    expect(library.stateRegistrations.find((binding) => binding.mode === 'thinking')).toMatchObject({
      hipsTranslation: 'preserve-target',
      playback: 'loop',
    });
    expect(jump?.steps.map((step) => step.clip.label)).toEqual(['Jump Start', 'Jump Land']);
  });

  it('binds all 85 canonical clips to structural VRM 0.x and 1.0 targets', async () => {
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

  it('keeps standing state clips on the target avatar floor plane', async () => {
    const library = await admitAnimationLibrary(builtInAnimationLibrary);
    const vrm = targetVrm('1');
    for (const mode of ['idle', 'thinking', 'speaking'] as const) {
      const registration = library.stateRegistrations.find((candidate) => candidate.mode === mode);
      expect(registration?.hipsTranslation).toBe('preserve-target');
      const clip = createVrmAnimationClip(registration!.canonical, vrm, {
        hipsTranslation: registration!.hipsTranslation,
      });
      expect(clip.tracks.some((track) => track.name.endsWith('.position')), mode).toBe(false);
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
