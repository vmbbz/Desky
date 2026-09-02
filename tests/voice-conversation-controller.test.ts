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

class FakeScriptProcessorNode extends FakeAudioNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;

  emitInput(samples: Float32Array): void {
    this.onaudioprocess?.({
      inputBuffer: { getChannelData: () => samples },
    } as unknown as AudioProcessingEvent);
  }
}

class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48_000;
  state: AudioContextState = 'running';
  readonly destination = new FakeAudioNode() as unknown as AudioDestinationNode;
  readonly sources: FakeAudioBufferSourceNode[] = [];
  readonly processor = new FakeScriptProcessorNode();

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
    return this.processor as unknown as ScriptProcessorNode;
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

function bargeInSpeechFrame(): Float32Array {
  const samples = new Float32Array(4096);
  samples.fill(0.03);
  samples[0] = 0.09;
  return samples;
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

  it('uses provider clear for speech barge-in without an explicit cancel RPC', async () => {
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
    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();
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
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-follow-up',
      role: 'user',
      text: 'Actually, stop.',
      final: false,
    });

    await expect(harness.controller.interrupt()).resolves.toBe('applied');
    expect(harness.bridge.cancelOutput).toHaveBeenCalledWith({
      sessionId: 'voice-1',
      turnId: 'turn-interrupted',
      reason: 'internal-fallback',
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

  it('keeps the live session and microphone active during natural speech barge-in', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-speaking',
      audioBase64: audiblePcm16Frame(),
    });

    audioContext.processor.emitInput(bargeInSpeechFrame());
    await Promise.resolve();
    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();

    audioContext.processor.emitInput(bargeInSpeechFrame());
    await vi.waitFor(() => expect(harness.bridge.append).toHaveBeenCalledTimes(2));

    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();
    expect(harness.controller.phase).toBe('hearing');
    expect(harness.errors).toEqual([]);
    await harness.controller.stop();
  });

  it('dispatches microphone frames without waiting for prior Gateway acknowledgements', async () => {
    const harness = createHarness();
    const releases: Array<() => void> = [];
    vi.mocked(harness.bridge.append).mockImplementation(() => new Promise<void>((resolve) => {
      releases.push(resolve);
    }));
    await harness.controller.start();

    audioContext.processor.emitInput(new Float32Array(4096));
    audioContext.processor.emitInput(new Float32Array(4096));
    audioContext.processor.emitInput(new Float32Array(4096));

    expect(harness.bridge.append).toHaveBeenCalledTimes(3);
    expect(harness.controller.phase).toBe('listening');
    releases.forEach((release) => release());
    await Promise.resolve();
    await harness.controller.stop();
  });

  it('uses the monotonic media clock and surfaces local speech before provider transcription', async () => {
    const harness = createHarness();
    audioContext.currentTime = 12.345;
    await harness.controller.start();

    audioContext.processor.emitInput(bargeInSpeechFrame());
    audioContext.processor.emitInput(bargeInSpeechFrame());

    expect(harness.bridge.append).toHaveBeenLastCalledWith(expect.objectContaining({
      timestamp: 12_345,
    }));
    expect(harness.controller.phase).toBe('hearing');

    await vi.advanceTimersByTimeAsync(701);
    expect(harness.controller.phase).toBe('listening');
    await harness.controller.stop();
  });

  it('releases capture without waiting for stale audio acknowledgements', async () => {
    const harness = createHarness();
    vi.mocked(harness.bridge.append).mockImplementation(() => new Promise<void>(() => undefined));
    await harness.controller.start();
    audioContext.processor.emitInput(new Float32Array(4096));

    await harness.controller.stop();

    expect(harness.bridge.stop).toHaveBeenCalledWith({ sessionId: 'voice-1' });
    expect(harness.controller.phase).toBe('idle');
  });

  it('fails at the four-send ownership bound instead of buffering stale speech', async () => {
    const harness = createHarness();
    vi.mocked(harness.bridge.append).mockImplementation(() => new Promise<void>(() => undefined));
    await harness.controller.start();

    for (let index = 0; index < 5; index += 1) {
      audioContext.processor.emitInput(new Float32Array(4096));
    }
    await vi.waitFor(() => expect(harness.controller.phase).toBe('idle'));

    expect(harness.bridge.append).toHaveBeenCalledTimes(4);
    expect(harness.errors).toEqual([
      'Voice conversation stopped because the Gateway could not accept audio in time.',
    ]);
  });

  it('keeps the microphone active after an isolated audio-append failure', async () => {
    const harness = createHarness();
    vi.mocked(harness.bridge.append)
      .mockRejectedValueOnce(new Error('transient append failure'))
      .mockResolvedValue(undefined);
    await harness.controller.start();

    audioContext.processor.emitInput(new Float32Array(4096));
    await vi.waitFor(() => expect(harness.bridge.append).toHaveBeenCalledTimes(1));
    audioContext.processor.emitInput(new Float32Array(4096));
    await vi.waitFor(() => expect(harness.bridge.append).toHaveBeenCalledTimes(2));

    expect(harness.controller.phase).toBe('listening');
    expect(harness.errors).toEqual([]);
    await harness.controller.stop();
  });

  it('does not mistake noise or one speech-like frame for barge-in', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'audio',
      sessionId: 'voice-1',
      turnId: 'turn-speaking',
      audioBase64: audiblePcm16Frame(),
    });

    audioContext.processor.emitInput(bargeInSpeechFrame());
    audioContext.processor.emitInput(new Float32Array(4096).fill(0.005));
    audioContext.processor.emitInput(bargeInSpeechFrame());
    await Promise.resolve();

    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();
    expect(harness.controller.phase).toBe('speaking');
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

  it('ends a session whose provider-heard transcript never finalizes', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-stalled-input',
      role: 'user',
      text: 'Check my skills',
      final: false,
    });

    expect(harness.controller.phase).toBe('hearing');
    await vi.advanceTimersByTimeAsync(11_999);
    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();
    expect(harness.bridge.stop).toHaveBeenCalledWith({ sessionId: 'voice-1' });
    expect(harness.controller.phase).toBe('idle');
    expect(harness.errors).toEqual([
      'The voice provider stopped before finishing your sentence. Deskii ended that live session safely; start voice and try again.',
    ]);
  });

  it('cancels the input watchdog when the provider finalizes normally', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-complete-input',
      role: 'user',
      text: 'Check my',
      final: false,
    });
    harness.emit({
      type: 'transcript',
      sessionId: 'voice-1',
      turnId: 'turn-complete-input',
      role: 'user',
      text: 'Check my skills',
      final: true,
    });

    expect(harness.controller.phase).toBe('thinking');
    await vi.advanceTimersByTimeAsync(13_000);
    expect(harness.bridge.cancelOutput).not.toHaveBeenCalled();
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
