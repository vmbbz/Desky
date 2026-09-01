import type {
  VoiceConversationAudioChunk,
  VoiceConversationEvent,
  VoiceConversationSession,
} from '../shared/voice-conversation';

const maximumProviderEntries = 1_000;
const maximumRendererEntries = 1_000;
const maximumObservationMs = 180_000;
const minimumAudiblePcm16 = 32;

type VoiceEvidenceEntry = {
  sequence: number;
  elapsedMs: number;
  type: string;
  role?: 'user' | 'assistant';
  final?: boolean;
  textLength?: number;
  audioBytes?: number;
  turnScoped?: boolean;
  reason?: 'complete' | 'cancelled' | 'error' | 'disconnected';
  result?: 'applied' | 'stale' | 'idle';
  inputEncoding?: 'g711_ulaw' | 'pcm16';
  outputEncoding?: 'g711_ulaw' | 'pcm16';
  inputSampleRateHz?: number;
  outputSampleRateHz?: number;
  supportsBargeIn?: boolean;
};

export interface RendererVoiceEvidenceEntry {
  elapsedMs: number;
  phase: 'absent' | 'requesting' | 'listening' | 'thinking' | 'speaking' | 'stopping';
  voiceActive: boolean;
  bubbleVisible: boolean;
  bubbleStatus: string;
  bubbleTextLength: number;
  companionMode: string;
}

export interface VoiceEvidenceSnapshot {
  schemaVersion: 1;
  elapsedMs: number;
  provider: {
    inputChunkCount: number;
    inputAudioBytes: number;
    outputChunkCount: number;
    outputAudioBytes: number;
    outputAudibleChunkCount: number;
    outputPeakPcm16: number;
    entries: VoiceEvidenceEntry[];
  };
  renderer: RendererVoiceEvidenceEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error('Invalid renderer voice-evidence text.');
  }
  return value;
}

function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

function pcm16Peak(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let peak = 0;
  for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
  }
  return peak;
}

function g711UlawPeak(bytes: Uint8Array): number {
  let peak = 0;
  for (const byte of bytes) {
    const value = ~byte & 0xff;
    const sign = value & 0x80;
    const exponent = (value >> 4) & 0x07;
    const mantissa = value & 0x0f;
    const magnitude = ((mantissa << 3) + 0x84) << exponent;
    const pcm16 = sign ? 0x84 - magnitude : magnitude - 0x84;
    peak = Math.max(peak, Math.abs(pcm16));
  }
  return peak;
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

export function readRendererVoiceEvidence(value: unknown): RendererVoiceEvidenceEntry[] {
  if (!Array.isArray(value) || value.length > maximumRendererEntries) {
    throw new Error('Invalid renderer voice-evidence timeline.');
  }
  const phases = new Set<RendererVoiceEvidenceEntry['phase']>([
    'absent', 'requesting', 'listening', 'thinking', 'speaking', 'stopping',
  ]);
  return value.map((entry) => {
    if (!isRecord(entry)
      || typeof entry.elapsedMs !== 'number'
      || !Number.isSafeInteger(entry.elapsedMs)
      || entry.elapsedMs < 0
      || entry.elapsedMs > maximumObservationMs
      || !phases.has(entry.phase as RendererVoiceEvidenceEntry['phase'])
      || typeof entry.voiceActive !== 'boolean'
      || typeof entry.bubbleVisible !== 'boolean'
      || typeof entry.bubbleTextLength !== 'number'
      || !Number.isSafeInteger(entry.bubbleTextLength)
      || entry.bubbleTextLength < 0
      || entry.bubbleTextLength > 100_000) {
      throw new Error('Invalid renderer voice-evidence entry.');
    }
    return {
      elapsedMs: entry.elapsedMs,
      phase: entry.phase as RendererVoiceEvidenceEntry['phase'],
      voiceActive: entry.voiceActive,
      bubbleVisible: entry.bubbleVisible,
      bubbleStatus: boundedText(entry.bubbleStatus, 80),
      bubbleTextLength: entry.bubbleTextLength,
      companionMode: boundedText(entry.companionMode, 80),
    };
  });
}

export class VoiceEvidenceRecorder {
  private readonly startedAt = Date.now();
  private readonly entries: VoiceEvidenceEntry[] = [];
  private inputChunkCount = 0;
  private inputAudioBytes = 0;
  private outputChunkCount = 0;
  private outputAudioBytes = 0;
  private outputAudibleChunkCount = 0;
  private outputPeakPcm16 = 0;
  private outputEncoding?: VoiceConversationSession['output']['encoding'];
  private outputSpanTurn?: string;

  static forExercise(exercise: string | undefined): VoiceEvidenceRecorder | undefined {
    return exercise === 'voice-observation' ? new VoiceEvidenceRecorder() : undefined;
  }

  record(type: string, details: Omit<VoiceEvidenceEntry, 'sequence' | 'elapsedMs' | 'type'> = {}): void {
    if (this.entries.length >= maximumProviderEntries) return;
    this.entries.push({
      sequence: this.entries.length + 1,
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
      type: type.slice(0, 80),
      ...details,
    });
  }

  recordSession(session: VoiceConversationSession): void {
    this.outputEncoding = session.output.encoding;
    this.record('session.started', {
      inputEncoding: session.input.encoding,
      outputEncoding: session.output.encoding,
      inputSampleRateHz: session.input.sampleRateHz,
      outputSampleRateHz: session.output.sampleRateHz,
      supportsBargeIn: session.supportsBargeIn,
    });
  }

  recordInput(chunk: VoiceConversationAudioChunk): void {
    this.inputChunkCount += 1;
    this.inputAudioBytes += decodedBase64Bytes(chunk.audioBase64);
    if (this.inputChunkCount === 1) this.record('input.audio.started');
  }

  recordProviderEvent(event: VoiceConversationEvent): void {
    if (event.type === 'transcript') {
      this.record('provider.transcript', {
        role: event.role,
        final: event.final,
        textLength: event.text.length,
        turnScoped: Boolean(event.turnId),
      });
      return;
    }
    if (event.type === 'audio') {
      const bytes = decodeBase64(event.audioBase64);
      const peak = this.outputEncoding === 'g711_ulaw'
        ? g711UlawPeak(bytes)
        : pcm16Peak(bytes);
      this.outputChunkCount += 1;
      this.outputAudioBytes += bytes.byteLength;
      this.outputPeakPcm16 = Math.max(this.outputPeakPcm16, peak);
      if (peak >= minimumAudiblePcm16) this.outputAudibleChunkCount += 1;
      const turn = event.turnId ?? '';
      if (this.outputSpanTurn !== turn) {
        this.outputSpanTurn = turn;
        this.record('provider.audio.started', {
          audioBytes: bytes.byteLength,
          turnScoped: Boolean(event.turnId),
        });
      }
      return;
    }
    if (event.type === 'audio-done') this.outputSpanTurn = undefined;
    if (event.type === 'closed') {
      this.record('provider.closed', { reason: event.reason });
      return;
    }
    if ('turnId' in event) {
      this.record(`provider.${event.type}`, { turnScoped: Boolean(event.turnId) });
      return;
    }
    this.record(`provider.${event.type}`);
  }

  snapshot(renderer: RendererVoiceEvidenceEntry[]): VoiceEvidenceSnapshot {
    return {
      schemaVersion: 1,
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
      provider: {
        inputChunkCount: this.inputChunkCount,
        inputAudioBytes: this.inputAudioBytes,
        outputChunkCount: this.outputChunkCount,
        outputAudioBytes: this.outputAudioBytes,
        outputAudibleChunkCount: this.outputAudibleChunkCount,
        outputPeakPcm16: this.outputPeakPcm16,
        entries: this.entries.map((entry) => ({ ...entry })),
      },
      renderer: renderer.map((entry) => ({ ...entry })),
    };
  }
}
