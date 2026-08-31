import type {
  VoiceConversationAudioEncoding,
  VoiceConversationBridge,
  VoiceConversationEvent,
  VoiceConversationSession,
} from '../shared/voice-conversation';
import { bytesToBase64, floatToG711Ulaw } from './voice-input-controller';

const maximumPendingAppends = 20;
const maximumScheduledOutputSeconds = 8;
const maximumPendingStartEvents = 8;

export type VoiceConversationPhase =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'stopping';

export interface VoiceConversationControllerCallbacks {
  onPhase(phase: VoiceConversationPhase): void;
  onTranscript(role: 'user' | 'assistant', text: string, final: boolean): void;
  onError(message: string): void;
}

export function floatToPcm16LittleEndian(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
  }
  return bytes;
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function g711UlawToFloat(bytes: Uint8Array): Float32Array {
  const samples = new Float32Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = ~(bytes[index] ?? 0) & 0xff;
    const sign = value & 0x80;
    const exponent = (value >> 4) & 0x07;
    const mantissa = value & 0x0f;
    const magnitude = ((mantissa << 3) + 0x84) << exponent;
    const pcm16 = sign ? 0x84 - magnitude : magnitude - 0x84;
    samples[index] = Math.max(-1, Math.min(1, pcm16 / 0x8000));
  }
  return samples;
}

export function pcm16LittleEndianToFloat(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 2 !== 0) throw new Error('Realtime PCM16 audio has an invalid byte length.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return samples;
}

export function resampleLinear(
  samples: Float32Array,
  sourceRateHz: number,
  targetRateHz: number,
): Float32Array {
  if (sourceRateHz === targetRateHz) return new Float32Array(samples);
  const targetLength = Math.max(1, Math.round(samples.length * targetRateHz / sourceRateHz));
  const output = new Float32Array(targetLength);
  const ratio = sourceRateHz / targetRateHz;
  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    const weight = position - left;
    output[index] = (samples[left] ?? 0) * (1 - weight) + (samples[right] ?? 0) * weight;
  }
  return output;
}

function safeVoiceError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Microphone access was not allowed.';
    if (error.name === 'NotFoundError') return 'No microphone was found.';
    if (error.name === 'NotReadableError') return 'The microphone is busy in another app.';
  }
  return error instanceof Error ? error.message.slice(0, 240) : 'Voice conversation failed.';
}

function encodeInput(samples: Float32Array, encoding: VoiceConversationAudioEncoding): Uint8Array {
  return encoding === 'g711_ulaw' ? floatToG711Ulaw(samples) : floatToPcm16LittleEndian(samples);
}

function decodeOutput(bytes: Uint8Array, encoding: VoiceConversationAudioEncoding): Float32Array {
  return encoding === 'g711_ulaw' ? g711UlawToFloat(bytes) : pcm16LittleEndianToFloat(bytes);
}

export class VoiceConversationController {
  private phaseValue: VoiceConversationPhase = 'idle';
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private sink?: GainNode;
  private session?: VoiceConversationSession;
  private appendChain: Promise<void> = Promise.resolve();
  private pendingAppends = 0;
  private generation = 0;
  private playbackGeneration = 0;
  private nextPlaybackAt = 0;
  private readonly playbackSources = new Set<AudioBufferSourceNode>();
  private readonly markTimers = new Set<number>();
  private currentTurnId?: string;
  private removeEventListener?: () => void;
  private stopPromise?: Promise<void>;
  private pendingStartEvents: VoiceConversationEvent[] = [];
  private pendingStartEventsOverflowed = false;

  constructor(
    private readonly bridge: VoiceConversationBridge,
    private readonly callbacks: VoiceConversationControllerCallbacks,
  ) {}

  get phase(): VoiceConversationPhase {
    return this.phaseValue;
  }

  async start(): Promise<void> {
    if (this.phaseValue !== 'idle') return;
    const generation = ++this.generation;
    this.setPhase('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is unavailable on this system.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      await context.resume();
      this.pendingStartEvents = [];
      this.pendingStartEventsOverflowed = false;
      this.removeEventListener = this.bridge.onEvent((event) => this.receiveEvent(event));
      const session = await this.bridge.start();
      if (generation !== this.generation) {
        await this.bridge.stop({ sessionId: session.sessionId }).catch(() => undefined);
        return;
      }
      this.session = session;
      if (this.pendingStartEventsOverflowed) {
        throw new Error('Voice conversation emitted too many events while starting.');
      }
      const pendingEvents = this.pendingStartEvents;
      this.pendingStartEvents = [];
      const terminalEvent = pendingEvents.find((event) => (
        event.sessionId === session.sessionId && (event.type === 'error' || event.type === 'closed')
      ));
      if (terminalEvent?.type === 'error') throw new Error(terminalEvent.message);
      if (terminalEvent?.type === 'closed') throw new Error(
        terminalEvent.reason === 'disconnected'
          ? 'Voice conversation stopped because the agent disconnected.'
          : 'The realtime voice session closed while starting.',
      );
      this.startPump(stream, context);
      this.nextPlaybackAt = context.currentTime;
      this.setPhase('listening');
      for (const event of pendingEvents) this.handleEvent(event);
    } catch (error) {
      if (generation !== this.generation) return;
      await this.stop(false);
      this.callbacks.onError(safeVoiceError(error));
    }
  }

  async interrupt(): Promise<'applied' | 'stale' | 'idle'> {
    const session = this.session;
    if (!session) return 'idle';
    const result = await this.bridge.cancelOutput({
      sessionId: session.sessionId,
      ...(this.currentTurnId ? { turnId: this.currentTurnId } : {}),
    });
    this.clearPlayback();
    if (this.phaseValue !== 'stopping') this.setPhase('listening');
    return result;
  }

  async stop(reportError = true): Promise<void> {
    if (this.phaseValue === 'idle') return;
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal(reportError).finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  private startPump(stream: MediaStream, context: AudioContext): void {
    this.source = context.createMediaStreamSource(stream);
    this.processor = context.createScriptProcessor(4096, 1, 1);
    this.sink = context.createGain();
    this.sink.gain.value = 0;
    this.processor.onaudioprocess = (event) => this.queueSamples(event.inputBuffer.getChannelData(0));
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
    this.sink.connect(context.destination);
  }

  private queueSamples(samples: Float32Array): void {
    const session = this.session;
    const context = this.context;
    if (!session || !context || this.phaseValue === 'requesting' || this.phaseValue === 'stopping') return;
    if (this.pendingAppends >= maximumPendingAppends) {
      this.callbacks.onError('Voice conversation stopped because the Gateway could not accept audio in time.');
      void this.stop(false);
      return;
    }
    const normalized = resampleLinear(samples, context.sampleRate, session.input.sampleRateHz);
    const audioBase64 = bytesToBase64(encodeInput(normalized, session.input.encoding));
    this.pendingAppends += 1;
    this.appendChain = this.appendChain
      .then(() => this.bridge.append({
        sessionId: session.sessionId,
        audioBase64,
        timestamp: Date.now(),
      }))
      .catch((error: unknown) => {
        if (this.session?.sessionId === session.sessionId) {
          this.callbacks.onError(safeVoiceError(error));
          void this.stop(false);
        }
      })
      .finally(() => {
        this.pendingAppends = Math.max(0, this.pendingAppends - 1);
      });
  }

  private handleEvent(event: VoiceConversationEvent): void {
    const session = this.session;
    if (!session || event.sessionId !== session.sessionId) return;
    if ('turnId' in event && event.turnId) this.currentTurnId = event.turnId;
    if (event.type === 'ready') {
      this.setPhase('listening');
      return;
    }
    if (event.type === 'transcript') {
      this.callbacks.onTranscript(event.role, event.text, event.final);
      if (event.role === 'user' && event.final) this.setPhase('thinking');
      return;
    }
    if (event.type === 'audio') {
      this.scheduleAudio(event.audioBase64);
      return;
    }
    if (event.type === 'audio-done') {
      if (this.playbackSources.size === 0) this.setPhase('listening');
      return;
    }
    if (event.type === 'clear') {
      this.clearPlayback();
      this.setPhase('listening');
      return;
    }
    if (event.type === 'mark') {
      this.scheduleMark(event.markName);
      return;
    }
    if (event.type === 'error') {
      this.callbacks.onError(event.message);
      void this.stop(false);
      return;
    }
    if (event.type === 'closed' && this.phaseValue !== 'stopping') {
      if (event.reason === 'error' || event.reason === 'disconnected') {
        this.callbacks.onError(event.reason === 'disconnected'
          ? 'Voice conversation stopped because the agent disconnected.'
          : 'The realtime voice session closed with an error.');
      }
      void this.stop(false);
    }
  }

  private receiveEvent(event: VoiceConversationEvent): void {
    if (!this.session) {
      if (this.pendingStartEvents.length >= maximumPendingStartEvents) {
        this.pendingStartEventsOverflowed = true;
      } else {
        this.pendingStartEvents.push(event);
      }
      return;
    }
    this.handleEvent(event);
  }

  private scheduleAudio(audioBase64: string): void {
    const context = this.context;
    const session = this.session;
    if (!context || !session) return;
    const samples = decodeOutput(base64ToBytes(audioBase64), session.output.encoding);
    const duration = samples.length / session.output.sampleRateHz;
    const startAt = Math.max(context.currentTime + 0.015, this.nextPlaybackAt);
    if (startAt + duration - context.currentTime > maximumScheduledOutputSeconds) {
      this.callbacks.onError('Voice playback was stopped because the output queue exceeded 8 seconds.');
      void this.interrupt().catch(() => undefined);
      return;
    }
    const buffer = context.createBuffer(1, samples.length, session.output.sampleRateHz);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const generation = this.playbackGeneration;
    source.onended = () => {
      source.disconnect();
      this.playbackSources.delete(source);
      if (generation === this.playbackGeneration && this.playbackSources.size === 0
        && this.phaseValue !== 'stopping') this.setPhase('listening');
    };
    this.playbackSources.add(source);
    this.nextPlaybackAt = startAt + duration;
    source.start(startAt);
    this.setPhase('speaking');
  }

  private scheduleMark(markName: string): void {
    const context = this.context;
    const session = this.session;
    if (!context || !session) return;
    const generation = this.playbackGeneration;
    const delayMs = Math.max(0, (this.nextPlaybackAt - context.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      this.markTimers.delete(timer);
      if (generation !== this.playbackGeneration || this.session?.sessionId !== session.sessionId) return;
      void this.bridge.acknowledgeMark({ sessionId: session.sessionId, markName })
        .catch((error: unknown) => this.callbacks.onError(safeVoiceError(error)));
    }, delayMs);
    this.markTimers.add(timer);
  }

  private clearPlayback(): void {
    this.playbackGeneration += 1;
    for (const source of this.playbackSources) {
      source.onended = null;
      try { source.stop(); } catch { /* The source may already be terminal. */ }
      source.disconnect();
    }
    this.playbackSources.clear();
    for (const timer of this.markTimers) window.clearTimeout(timer);
    this.markTimers.clear();
    if (this.context) this.nextPlaybackAt = this.context.currentTime;
  }

  private async stopInternal(reportError: boolean): Promise<void> {
    ++this.generation;
    this.setPhase('stopping');
    this.stopLocalMedia();
    const session = this.session;
    this.session = undefined;
    await this.appendChain;
    if (session) {
      await this.bridge.stop({ sessionId: session.sessionId }).catch((error: unknown) => {
        if (reportError) this.callbacks.onError(safeVoiceError(error));
      });
    }
    this.removeEventListener?.();
    this.removeEventListener = undefined;
    this.appendChain = Promise.resolve();
    this.pendingAppends = 0;
    this.pendingStartEvents = [];
    this.pendingStartEventsOverflowed = false;
    this.currentTurnId = undefined;
    this.setPhase('idle');
  }

  private stopLocalMedia(): void {
    this.clearPlayback();
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = undefined;
    }
    this.sink?.disconnect();
    this.sink = undefined;
    this.source?.disconnect();
    this.source = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    void this.context?.close();
    this.context = undefined;
  }

  private setPhase(phase: VoiceConversationPhase): void {
    if (this.phaseValue === phase) return;
    this.phaseValue = phase;
    this.callbacks.onPhase(phase);
  }
}
