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
const outputJitterBufferSeconds = 0.12;
const outputGapGraceMs = 300;
const outputPlaybackWatchdogSlackMs = 2_000;
const minimumAudibleOutputAmplitude = 1 / 1_024;
const maximumScheduledConsecutiveSilenceSeconds = 0.5;
const inputFinalizationWatchdogMs = 12_000;
const bargeInRmsThreshold = 0.02;
const bargeInPeakThreshold = 0.08;
const bargeInConsecutiveFrames = 2;

export type VoiceConversationPhase =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'hearing'
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

function hasAudibleOutput(samples: Float32Array): boolean {
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index] ?? 0) >= minimumAudibleOutputAmplitude) return true;
  }
  return false;
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
  private outputTurnId?: string;
  private ignoredOutputTurnId?: string;
  private ignoreUnscopedOutput = false;
  private outputDoneReceived = false;
  private outputTranscriptDoneReceived = false;
  private audibleOutputObserved = false;
  private scheduledConsecutiveSilenceSeconds = 0;
  private outputGapTimer?: number;
  private playbackWatchdogTimer?: number;
  private inputFinalizationWatchdogTimer?: number;
  private speechFramesDuringPlayback = 0;
  private outputCancellationPending = false;
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

  async interrupt(
    reason: 'barge-in' | 'playback-overflow' | 'internal-fallback' = 'internal-fallback',
  ): Promise<'applied' | 'stale' | 'idle'> {
    const session = this.session;
    if (!session || this.outputCancellationPending) return 'idle';
    this.cancelInputFinalizationWatchdog();
    const cancelledOutputTurnId = this.outputTurnId ?? this.currentTurnId;
    this.outputCancellationPending = true;
    this.ignoreCurrentOutputTurn();
    this.clearPlayback();
    this.resetOutputLifecycle();
    if (this.phaseValue !== 'stopping') this.setPhase('listening');
    try {
      return await this.bridge.cancelOutput({
        sessionId: session.sessionId,
        ...(cancelledOutputTurnId ? { turnId: cancelledOutputTurnId } : {}),
        reason,
      });
    } finally {
      if (this.session?.sessionId === session.sessionId) this.outputCancellationPending = false;
    }
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
    if (this.detectBargeInSpeech(samples)) {
      void this.interrupt('barge-in').catch((error: unknown) => {
        this.callbacks.onError(safeVoiceError(error));
        void this.stop(false);
      });
      return;
    }
    if (this.outputCancellationPending) return;
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

  private detectBargeInSpeech(samples: Float32Array): boolean {
    if (!this.session?.supportsBargeIn || this.outputCancellationPending
      || this.playbackSources.size === 0 || !this.outputTurnId) {
      this.speechFramesDuringPlayback = 0;
      return false;
    }
    let sumSquares = 0;
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const magnitude = Math.abs(samples[index] ?? 0);
      sumSquares += magnitude * magnitude;
      if (magnitude > peak) peak = magnitude;
    }
    const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
    if (rms >= bargeInRmsThreshold && peak >= bargeInPeakThreshold) {
      this.speechFramesDuringPlayback += 1;
    } else {
      this.speechFramesDuringPlayback = 0;
    }
    return this.speechFramesDuringPlayback >= bargeInConsecutiveFrames;
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
      if (event.role === 'user' && event.final) {
        this.cancelInputFinalizationWatchdog();
        if (event.turnId !== this.ignoredOutputTurnId) this.ignoredOutputTurnId = undefined;
        this.ignoreUnscopedOutput = false;
        this.beginOutputTurn(event.turnId);
        this.setPhase('thinking');
      } else if (event.role === 'user') {
        this.scheduleInputFinalizationWatchdog();
        this.setPhase('hearing');
      } else if (event.role === 'assistant' && event.final) {
        this.cancelInputFinalizationWatchdog();
        if ((!event.turnId && this.ignoreUnscopedOutput)
          || (event.turnId && event.turnId === this.ignoredOutputTurnId)) return;
        this.observeOutputTurn(event.turnId);
        this.outputTranscriptDoneReceived = true;
        if (this.playbackSources.size === 0) this.scheduleOutputSettled();
      }
      return;
    }
    if (event.type === 'audio') {
      if ((!event.turnId && this.ignoreUnscopedOutput)
        || (event.turnId && event.turnId === this.ignoredOutputTurnId)) return;
      this.observeOutputTurn(event.turnId);
      this.scheduleAudio(event.audioBase64);
      return;
    }
    if (event.type === 'audio-done') {
      if ((!event.turnId && this.ignoreUnscopedOutput)
        || (event.turnId && event.turnId === this.ignoredOutputTurnId)) return;
      if (this.outputTurnId && event.turnId && event.turnId !== this.outputTurnId) return;
      this.observeOutputTurn(event.turnId);
      this.outputDoneReceived = true;
      if (this.playbackSources.size === 0) this.scheduleOutputSettled();
      return;
    }
    if (event.type === 'clear') {
      this.ignoredOutputTurnId = event.turnId ?? this.outputTurnId ?? this.currentTurnId;
      this.ignoreUnscopedOutput = true;
      this.clearPlayback();
      this.resetOutputLifecycle();
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
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const samples = decodeOutput(base64ToBytes(audioBase64), session.output.encoding);
    const duration = samples.length / session.output.sampleRateHz;
    const audible = hasAudibleOutput(samples);
    // Some realtime transports publish zero-amplitude comfort frames before the
    // provider has produced a response. They are transport keepalive, not an
    // assistant turn: do not let them own the Speaking state, consume the
    // bounded playback queue, or cancel a session that may still answer.
    if (!audible && !this.audibleOutputObserved) return;
    if (audible) {
      this.cancelInputFinalizationWatchdog();
      this.audibleOutputObserved = true;
      this.scheduledConsecutiveSilenceSeconds = 0;
    } else {
      // GPT-Live's WebRTC media peer is continuous: after a spoken response it
      // can keep publishing exact-zero comfort frames without an audio-done
      // event. Preserve ordinary pauses inside speech, but do not turn an
      // unbounded transport tail into queued playback or a stuck Speaking UI.
      if (this.scheduledConsecutiveSilenceSeconds + duration
        > maximumScheduledConsecutiveSilenceSeconds) return;
      this.scheduledConsecutiveSilenceSeconds += duration;
    }
    const startAt = Math.max(context.currentTime + outputJitterBufferSeconds, this.nextPlaybackAt);
    if (startAt + duration - context.currentTime > maximumScheduledOutputSeconds) {
      this.callbacks.onError('Voice playback was stopped because the output queue exceeded 8 seconds.');
      void this.interrupt('playback-overflow').catch(() => undefined);
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
        && this.phaseValue !== 'stopping') this.scheduleOutputSettled();
    };
    this.playbackSources.add(source);
    this.nextPlaybackAt = startAt + duration;
    source.start(startAt);
    this.cancelOutputGapTimer();
    this.schedulePlaybackWatchdog();
    if (audible) this.setPhase('speaking');
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
    this.cancelOutputGapTimer();
    this.cancelPlaybackWatchdog();
    for (const source of this.playbackSources) {
      source.onended = null;
      try { source.stop(); } catch { /* The source may already be terminal. */ }
      source.disconnect();
    }
    this.playbackSources.clear();
    this.speechFramesDuringPlayback = 0;
    for (const timer of this.markTimers) window.clearTimeout(timer);
    this.markTimers.clear();
    if (this.context) this.nextPlaybackAt = this.context.currentTime;
  }

  private beginOutputTurn(turnId?: string): void {
    this.outputTurnId = turnId;
    this.outputDoneReceived = false;
    this.outputTranscriptDoneReceived = false;
    this.audibleOutputObserved = false;
    this.scheduledConsecutiveSilenceSeconds = 0;
    this.cancelOutputGapTimer();
  }

  private observeOutputTurn(turnId?: string): void {
    if (!turnId) return;
    if (this.outputTurnId === turnId) return;
    this.beginOutputTurn(turnId);
  }

  private ignoreCurrentOutputTurn(): void {
    this.ignoredOutputTurnId = this.outputTurnId ?? this.currentTurnId;
    this.ignoreUnscopedOutput = true;
  }

  private resetOutputLifecycle(): void {
    this.outputTurnId = undefined;
    this.outputDoneReceived = false;
    this.outputTranscriptDoneReceived = false;
    this.audibleOutputObserved = false;
    this.scheduledConsecutiveSilenceSeconds = 0;
    this.cancelOutputGapTimer();
  }

  private scheduleOutputSettled(): void {
    this.cancelOutputGapTimer();
    const generation = this.playbackGeneration;
    this.outputGapTimer = window.setTimeout(() => {
      this.outputGapTimer = undefined;
      if (generation !== this.playbackGeneration || this.playbackSources.size > 0
        || this.phaseValue === 'stopping' || this.phaseValue === 'idle') return;
      if (this.outputDoneReceived || this.outputTranscriptDoneReceived) {
        this.resetOutputLifecycle();
        this.setPhase('listening');
      } else if (this.phaseValue === 'speaking') {
        this.setPhase('thinking');
      }
    }, outputGapGraceMs);
  }

  private cancelOutputGapTimer(): void {
    if (this.outputGapTimer === undefined) return;
    window.clearTimeout(this.outputGapTimer);
    this.outputGapTimer = undefined;
  }

  private schedulePlaybackWatchdog(): void {
    const context = this.context;
    if (!context) return;
    this.cancelPlaybackWatchdog();
    const generation = this.playbackGeneration;
    const expectedQueueMs = Math.max(0, (this.nextPlaybackAt - context.currentTime) * 1_000);
    this.playbackWatchdogTimer = window.setTimeout(() => {
      this.playbackWatchdogTimer = undefined;
      if (generation !== this.playbackGeneration || this.playbackSources.size === 0
        || this.phaseValue === 'stopping' || this.phaseValue === 'idle') return;
      const completed = this.outputDoneReceived;
      this.clearPlayback();
      this.resetOutputLifecycle();
      this.setPhase(completed ? 'listening' : 'thinking');
      this.callbacks.onError('Voice playback stalled. Check the Windows output device and try voice again.');
    }, expectedQueueMs + outputPlaybackWatchdogSlackMs);
  }

  private cancelPlaybackWatchdog(): void {
    if (this.playbackWatchdogTimer === undefined) return;
    window.clearTimeout(this.playbackWatchdogTimer);
    this.playbackWatchdogTimer = undefined;
  }

  private scheduleInputFinalizationWatchdog(): void {
    this.cancelInputFinalizationWatchdog();
    const generation = this.generation;
    const sessionId = this.session?.sessionId;
    this.inputFinalizationWatchdogTimer = window.setTimeout(() => {
      this.inputFinalizationWatchdogTimer = undefined;
      if (generation !== this.generation || !sessionId
        || this.session?.sessionId !== sessionId
        || this.phaseValue === 'stopping' || this.phaseValue === 'idle') return;
      void this.stop(false).then(() => {
        this.callbacks.onError(
          'The voice provider stopped before finishing your sentence. Deskiii ended that live session safely; start voice and try again.',
        );
      }).catch((error: unknown) => {
        this.callbacks.onError(safeVoiceError(error));
      });
    }, inputFinalizationWatchdogMs);
  }

  private cancelInputFinalizationWatchdog(): void {
    if (this.inputFinalizationWatchdogTimer === undefined) return;
    window.clearTimeout(this.inputFinalizationWatchdogTimer);
    this.inputFinalizationWatchdogTimer = undefined;
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
    this.outputCancellationPending = false;
    this.speechFramesDuringPlayback = 0;
    this.pendingStartEvents = [];
    this.pendingStartEventsOverflowed = false;
    this.currentTurnId = undefined;
    this.ignoredOutputTurnId = undefined;
    this.ignoreUnscopedOutput = false;
    this.resetOutputLifecycle();
    this.setPhase('idle');
  }

  private stopLocalMedia(): void {
    this.cancelInputFinalizationWatchdog();
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
