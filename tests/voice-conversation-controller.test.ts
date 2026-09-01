import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VoiceConversationController,
  type VoiceConversationPhase,
} from '../src/renderer/voice-conversation-controller';
import type {
  VoiceConversationBridge,
  VoiceConversationEvent,
} from '../src/shared/voice-conversation';

class FakeAudioNode {
  connect(): this {
    return this;
  }

  disconnect(): void {}
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  startedAt?: number;

  start(when?: number): void {
    this.startedAt = when;
  }

  stop(): void {}

  finish(): void {
    this.onended?.();
  }
}

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48_000;
  state: AudioContextState = 'running';
  readonly destination = new FakeAudioNode() as unknown as AudioDestinationNode;
  readonly sources: FakeAudioBufferSourceNode[] = [];

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    return new FakeAudioNode() as unknown as MediaStreamAudioSourceNode;
  }

  createScriptProcessor(): ScriptProcessorNode {
    return Object.assign(new FakeAudioNode(), { onaudioprocess: null }) as unknown as ScriptProcessorNode;
  }

  createGain(): GainNode {
    return Object.assign(new FakeAudioNode(), { gain: { value: 1 } }) as unknown as GainNode;
  }

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    return {
      duration: length / sampleRate,
      length,
      numberOfChannels: 1,
      sampleRate,
      copyToChannel: vi.fn(),
    } as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeAudioBufferSourceNode();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
}

function audiblePcm16Frame(sampleCount = 480): string {
  const bytes = new Uint8Array(sampleCount * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(index * 2, index % 2 === 0 ? 8_000 : -8_000, true);
  }
  return Buffer.from(bytes).toString('base64');
}

function silentPcm16Frame(sampleCount: number): string {
  return Buffer.alloc(sampleCount * 2).toString('base64');
}

function createHarness() {
  let listener: ((event: VoiceConversationEvent) => void) | undefined;
  const bridge: VoiceConversationBridge = {
    start: vi.fn(async () => ({
      sessionId: 'voice-1',
      input: { encoding: 'pcm16' as const, sampleRateHz: 24_000, channels: 1 as const },
      output: { encoding: 'pcm16' as const, sampleRateHz: 24_000, channels: 1 as const },
      supportsBargeIn: true,
    })),
    append: vi.fn(async () => undefined),
    cancelOutput: vi.fn(async () => 'applied' as const),
    acknowledgeMark: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    onEvent: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    }),
  };
  const phases: VoiceConversationPhase[] = [];
  const errors: string[] = [];
  const controller = new VoiceConversationController(bridge, {
    onPhase: (phase) => phases.push(phase),
    onTranscript: vi.fn(),
    onError: (message) => errors.push(message),
  });
  return {
    bridge,
    controller,
    errors,
    phases,
    emit: (event: VoiceConversationEvent) => listener?.(event),
  };
}

describe('VoiceConversationController playback lifecycle', () => {
  let audioContext: FakeAudioContext;

  beforeEach(() => {
    vi.useFakeTimers();
    audioContext = new FakeAudioContext();
    function AudioContextMock(): FakeAudioContext {
      return audioContext;
    }
    vi.stubGlobal('AudioContext', AudioContextMock);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    });
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps one speaking phase across normal gaps between realtime audio frames', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-1',
      role: 'user',
      text: 'Hello',
      final: true,
    });
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-1',
      audioBase64: audiblePcm16Frame(),
    });

    audioContext.sources[0]?.finish();
    expect(harness.controller.phase).toBe('speaking');

    await vi.advanceTimersByTimeAsync(100);
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-1',
      audioBase64: audiblePcm16Frame(),
    });
    harness.emit({ type: 'audio-done', sessionId: 'voice-1', turnId: 'turn-1' });
    audioContext.sources[1]?.finish();

    expect(harness.controller.phase).toBe('speaking');
    await vi.advanceTimersByTimeAsync(400);
    expect(harness.controller.phase).toBe('listening');
    expect(harness.phases.filter((phase) => phase === 'speaking')).toHaveLength(1);
    expect(harness.errors).toEqual([]);
    await harness.controller.stop();
  });

  it('leaves speaking and reports an output-device failure if playback never ends', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-stalled',
      audioBase64: audiblePcm16Frame(),
    });

    expect(harness.controller.phase).toBe('speaking');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(harness.controller.phase).toBe('thinking');
    expect(harness.errors).toEqual([
      'Voice playback stalled. Check the Windows output device and try voice again.',
    ]);
    await harness.controller.stop();
  });

  it('fully resets playback on clear and ignores late audio from the cancelled turn', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-cancelled',
      audioBase64: audiblePcm16Frame(),
    });
    expect(harness.controller.phase).toBe('speaking');

    harness.emit({ type: 'clear', sessionId: 'voice-1', turnId: 'turn-cancelled' });
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-cancelled',
      audioBase64: audiblePcm16Frame(),
    });
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      audioBase64: audiblePcm16Frame(),
    });

    expect(harness.controller.phase).toBe('listening');
    expect(audioContext.sources).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.controller.phase).toBe('listening');
    expect(harness.errors).toEqual([]);
    await harness.controller.stop();
  });

  it('interrupts audible output and admits a second turn in the same session', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-interrupted',
      audioBase64: audiblePcm16Frame(),
    });

    await expect(harness.controller.interrupt()).resolves.toBe('applied');
    expect(harness.bridge.cancelOutput).toHaveBeenCalledWith({
      sessionId: 'voice-1',
      turnId: 'turn-interrupted',
    });
    expect(harness.controller.phase).toBe('listening');

    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-interrupted',
      audioBase64: audiblePcm16Frame(),
    });
    expect(audioContext.sources).toHaveLength(1);

    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-recovered',
      role: 'user',
      text: 'Reply again.',
      final: true,
    });
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-recovered',
      audioBase64: audiblePcm16Frame(),
    });
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-recovered',
      role: 'assistant',
      text: 'Recovered.',
      final: true,
    });
    expect(audioContext.sources).toHaveLength(2);
    audioContext.sources[1]?.finish();
    await vi.advanceTimersByTimeAsync(400);

    expect(harness.controller.phase).toBe('listening');
    expect(harness.errors).toEqual([]);
    await harness.controller.stop();
  });

  it('returns to listening when a response completes without any playable audio', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-text-only',
      role: 'user',
      text: 'Can you hear me?',
      final: true,
    });
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-text-only',
      role: 'assistant',
      text: 'Yes.',
      final: true,
    });

    expect(harness.controller.phase).toBe('thinking');
    await vi.advanceTimersByTimeAsync(400);
    expect(harness.controller.phase).toBe('listening');
    expect(harness.errors).toEqual([]);
    await harness.controller.stop();
  });

  it('ignores leading transport silence and plays later audible output without cancelling', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-delayed-audio',
      role: 'user',
      text: 'Can you hear me?',
      final: true,
    });
    for (let index = 0; index < 500; index += 1) {
      harness.emit({
        type: 'audio',
        sessionId: 'voice-1',
        turnId: 'turn-delayed-audio',
        audioBase64: silentPcm16Frame(480),
      });
    }

    expect(audioContext.sources).toHaveLength(0);
    expect(harness.controller.phase).toBe('thinking');
    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();
    expect(harness.errors).toEqual([]);

    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-delayed-audio',
      audioBase64: audiblePcm16Frame(),
    });

    expect(audioContext.sources).toHaveLength(1);
    expect(harness.controller.phase).toBe('speaking');
    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();
    expect(harness.errors).toEqual([]);
    await harness.controller.stop();
  });

  it('bounds continuous trailing comfort silence and settles after the final transcript', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-with-comfort-tail',
      audioBase64: audiblePcm16Frame(),
    });
    for (let index = 0; index < 100; index += 1) {
      harness.emit({
        type: 'audio',
        sessionId: 'voice-1',
        turnId: 'turn-with-comfort-tail',
        audioBase64: silentPcm16Frame(480),
      });
    }
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-with-comfort-tail',
      role: 'assistant',
      text: 'Finished speaking.',
      final: true,
    });

    expect(audioContext.sources.length).toBeGreaterThan(1);
    expect(audioContext.sources.length).toBeLessThan(30);
    for (const source of audioContext.sources) source.finish();
    await vi.advanceTimersByTimeAsync(400);

    expect(harness.controller.phase).toBe('listening');
    expect(harness.errors).toEqual([]);
    await harness.controller.stop();
  });
});
