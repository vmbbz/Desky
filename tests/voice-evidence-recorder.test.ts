import { describe, expect, it } from 'vitest';

import {
  readRendererVoiceEvidence,
  VoiceEvidenceRecorder,
} from '../src/main/voice-evidence-recorder';

describe('VoiceEvidenceRecorder', () => {
  it('is enabled only for the explicit voice-observation exercise', () => {
    expect(VoiceEvidenceRecorder.forExercise(undefined)).toBeUndefined();
    expect(VoiceEvidenceRecorder.forExercise('performance-lifecycle')).toBeUndefined();
    expect(VoiceEvidenceRecorder.forExercise('voice-observation')).toBeInstanceOf(
      VoiceEvidenceRecorder,
    );
  });

  it('records ordering and bounded metadata without retaining voice content', () => {
    const recorder = new VoiceEvidenceRecorder();
    recorder.record('session.start.requested');
    recorder.recordSession({
      sessionId: 'sensitive-session-id',
      input: { encoding: 'pcm16', sampleRateHz: 24_000, channels: 1 },
      output: { encoding: 'pcm16', sampleRateHz: 24_000, channels: 1 },
      supportsBargeIn: true,
    });
    const input = Buffer.alloc(960);
    input.writeInt16LE(6_000, 0);
    recorder.recordInput({
      sessionId: 'sensitive-session-id',
      audioBase64: input.toString('base64'),
    });
    recorder.recordProviderEvent({
      type: 'transcript',
      sessionId: 'sensitive-session-id',
      role: 'user',
      text: 'private transcript words',
      final: true,
      turnId: 'sensitive-turn-id',
    });
    const output = Buffer.alloc(960);
    output.writeInt16LE(8_000, 0);
    for (let index = 0; index < 1_500; index += 1) {
      recorder.recordProviderEvent({
        type: 'audio',
        sessionId: 'sensitive-session-id',
        audioBase64: output.toString('base64'),
        turnId: 'sensitive-turn-id',
      });
    }
    recorder.recordProviderEvent({
      type: 'audio-done',
      sessionId: 'sensitive-session-id',
      turnId: 'sensitive-turn-id',
    });

    const snapshot = recorder.snapshot([]);
    expect(snapshot.provider.inputChunkCount).toBe(1);
    expect(snapshot.provider.inputAudioBytes).toBe(960);
    expect(snapshot.provider.inputAudibleChunkCount).toBe(1);
    expect(snapshot.provider.inputPeakPcm16).toBe(6_000);
    expect(snapshot.provider.outputChunkCount).toBe(1_500);
    expect(snapshot.provider.outputAudioBytes).toBe(1_440_000);
    expect(snapshot.provider.outputAudibleChunkCount).toBe(1_500);
    expect(snapshot.provider.outputPeakPcm16).toBe(8_000);
    expect(snapshot.provider.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sequence: 2,
        type: 'session.started',
        inputEncoding: 'pcm16',
        outputEncoding: 'pcm16',
        supportsBargeIn: true,
      }),
      expect.objectContaining({
        type: 'provider.transcript',
        role: 'user',
        final: true,
        textLength: 24,
        turnScoped: true,
      }),
      expect.objectContaining({
        type: 'provider.audio.started',
        audioBytes: 960,
        turnScoped: true,
      }),
      expect.objectContaining({ type: 'provider.audio-done', turnScoped: true }),
    ]));
    expect(snapshot.provider.entries.filter((entry) => (
      entry.type === 'provider.audio.started'
    ))).toHaveLength(1);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('sensitive');
  });

  it('validates a bounded renderer phase timeline', () => {
    expect(readRendererVoiceEvidence([{
      elapsedMs: 125,
      phase: 'speaking',
      voiceActive: true,
      bubbleVisible: true,
      bubbleStatus: 'Speaking',
      bubbleTextLength: 42,
      companionMode: 'speaking',
    }])).toEqual([{
      elapsedMs: 125,
      phase: 'speaking',
      voiceActive: true,
      bubbleVisible: true,
      bubbleStatus: 'Speaking',
      bubbleTextLength: 42,
      companionMode: 'speaking',
    }]);
    expect(() => readRendererVoiceEvidence([{
      elapsedMs: 125,
      phase: 'invented',
      voiceActive: true,
      bubbleVisible: true,
      bubbleStatus: 'Speaking',
      bubbleTextLength: 42,
      companionMode: 'speaking',
    }])).toThrow('Invalid renderer voice-evidence entry.');
  });

  it('admits bounded capture-finalization overhead after a 180-second observation', () => {
    expect(readRendererVoiceEvidence([{
      elapsedMs: 180_750,
      phase: 'listening',
      voiceActive: true,
      bubbleVisible: false,
      bubbleStatus: '',
      bubbleTextLength: 0,
      companionMode: 'idle',
    }])).toHaveLength(1);
    expect(() => readRendererVoiceEvidence([{
      elapsedMs: 190_001,
      phase: 'listening',
      voiceActive: true,
      bubbleVisible: false,
      bubbleStatus: '',
      bubbleTextLength: 0,
      companionMode: 'idle',
    }])).toThrow('Invalid renderer voice-evidence entry.');
  });
});
