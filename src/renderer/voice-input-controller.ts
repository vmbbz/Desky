import type { VoiceInputBridge, VoiceInputEvent } from '../shared/voice-input';

const inputSampleRateHz = 8000;
const maximumPendingAppends = 20;

export type VoiceInputPhase = 'idle' | 'requesting' | 'listening' | 'stopping';

export interface VoiceInputControllerCallbacks {
  onPhase(phase: VoiceInputPhase): void;
  onTranscript(text: string): void;
  onError(message: string): void;
}

export function floatToG711Ulaw(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const pcm16 = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
    const sign = pcm16 < 0 ? 0x80 : 0;
    const magnitude = Math.min(Math.abs(pcm16), 32635) + 0x84;
    let exponent = 7;
    let mask = 0x4000;
    while ((magnitude & mask) === 0 && exponent > 0) {
      exponent -= 1;
      mask >>= 1;
    }
    const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
    bytes[index] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x2000));
  }
  return btoa(binary);
}

export function mergeVoiceTranscript(base: string, transcript: string): string {
  const spoken = transcript.trim();
  if (!spoken) return base;
  if (!base) return spoken;
  return `${base}${/\s$/.test(base) ? '' : ' '}${spoken}`;
}

function safeVoiceError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Microphone access was not allowed.';
    if (error.name === 'NotFoundError') return 'No microphone was found.';
    if (error.name === 'NotReadableError') return 'The microphone is busy in another app.';
  }
  return error instanceof Error ? error.message.slice(0, 240) : 'Voice input failed.';
}

export class VoiceInputController {
  private phaseValue: VoiceInputPhase = 'idle';
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private sink?: GainNode;
  private sessionId?: string;
  private appendChain: Promise<void> = Promise.resolve();
  private pendingAppends = 0;
  private finalTranscripts: string[] = [];
  private partialTranscript = '';
  private generation = 0;
  private removeEventListener?: () => void;
  private stopPromise?: Promise<string>;

  constructor(
    private readonly bridge: VoiceInputBridge,
    private readonly callbacks: VoiceInputControllerCallbacks,
  ) {}

  get phase(): VoiceInputPhase {
    return this.phaseValue;
  }

  get transcript(): string {
    return [...this.finalTranscripts, this.partialTranscript].filter(Boolean).join(' ').trim();
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
      const context = new AudioContext({ sampleRate: inputSampleRateHz });
      if (context.sampleRate !== inputSampleRateHz) {
        await context.close();
        throw new Error('This audio device cannot provide the required 8 kHz input format.');
      }
      this.context = context;
      const session = await this.bridge.start();
      if (generation !== this.generation) {
        await this.bridge.stop({ sessionId: session.sessionId, discard: true }).catch(() => undefined);
        return;
      }
      if (session.inputEncoding !== 'g711_ulaw' || session.inputSampleRateHz !== inputSampleRateHz) {
        await this.bridge.stop({ sessionId: session.sessionId, discard: true }).catch(() => undefined);
        throw new Error('The active agent returned an unsupported microphone format.');
      }
      this.sessionId = session.sessionId;
      this.removeEventListener = this.bridge.onEvent((event) => this.handleEvent(event));
      this.startPump(stream, context);
      this.setPhase('listening');
    } catch (error) {
      if (generation !== this.generation) return;
      await this.stop(true, false);
      this.callbacks.onError(safeVoiceError(error));
    }
  }

  async finish(): Promise<string> {
    return this.stop(false, true);
  }

  async cancel(): Promise<void> {
    await this.stop(true, false);
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
    const sessionId = this.sessionId;
    if (!sessionId || this.phaseValue !== 'listening') return;
    if (this.pendingAppends >= maximumPendingAppends) {
      this.callbacks.onError('Voice input stopped because the agent could not accept audio in time.');
      void this.stop(true, false);
      return;
    }
    const audioBase64 = bytesToBase64(floatToG711Ulaw(samples));
    this.pendingAppends += 1;
    this.appendChain = this.appendChain
      .then(() => this.bridge.append({ sessionId, audioBase64 }))
      .catch((error: unknown) => {
        if (this.sessionId === sessionId) {
          this.callbacks.onError(safeVoiceError(error));
          void this.stop(true, false);
        }
      })
      .finally(() => {
        this.pendingAppends = Math.max(0, this.pendingAppends - 1);
      });
  }

  private handleEvent(event: VoiceInputEvent): void {
    if (event.sessionId !== this.sessionId) return;
    if (event.type === 'transcript') {
      if (event.final) {
        if (event.text.trim()) this.finalTranscripts.push(event.text.trim());
        this.partialTranscript = '';
      } else {
        this.partialTranscript = event.text.trim();
      }
      this.callbacks.onTranscript(this.transcript);
      return;
    }
    if (event.type === 'error') {
      this.callbacks.onError(event.message);
      void this.stop(true, false);
      return;
    }
    if (event.type === 'closed' && this.phaseValue !== 'stopping') {
      if (event.reason === 'error' || event.reason === 'disconnected') {
        this.callbacks.onError(event.reason === 'disconnected'
          ? 'Voice input stopped because the agent disconnected.'
          : 'The transcription session closed with an error.');
      }
      void this.stop(event.reason !== 'complete', false);
    }
  }

  private async stop(discard: boolean, notifyTranscript: boolean): Promise<string> {
    if (this.phaseValue === 'idle') return this.transcript;
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal(discard, notifyTranscript).finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  private async stopInternal(discard: boolean, notifyTranscript: boolean): Promise<string> {
    ++this.generation;
    this.setPhase('stopping');
    this.stopLocalCapture();
    const sessionId = this.sessionId;
    this.sessionId = undefined;
    await this.appendChain;
    if (sessionId) {
      await this.bridge.stop({ sessionId, discard }).catch((error: unknown) => {
        if (!discard) this.callbacks.onError(safeVoiceError(error));
      });
    }
    const transcript = discard ? '' : this.transcript;
    if (notifyTranscript) this.callbacks.onTranscript(transcript);
    this.finalTranscripts = [];
    this.partialTranscript = '';
    this.appendChain = Promise.resolve();
    this.pendingAppends = 0;
    this.setPhase('idle');
    return transcript;
  }

  private stopLocalCapture(): void {
    this.removeEventListener?.();
    this.removeEventListener = undefined;
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

  private setPhase(phase: VoiceInputPhase): void {
    this.phaseValue = phase;
    this.callbacks.onPhase(phase);
  }
}
