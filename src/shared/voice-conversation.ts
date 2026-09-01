export const maximumVoiceConversationInputBase64Length = 16_384;
export const maximumVoiceConversationOutputBase64Length = 699_052;

export type VoiceConversationAudioEncoding = 'g711_ulaw' | 'pcm16';

export interface VoiceConversationAudioFormat {
  encoding: VoiceConversationAudioEncoding;
  sampleRateHz: number;
  channels: 1;
}

export interface VoiceConversationSession {
  sessionId: string;
  input: VoiceConversationAudioFormat;
  output: VoiceConversationAudioFormat;
  supportsBargeIn: boolean;
}

export interface VoiceConversationAudioChunk {
  sessionId: string;
  audioBase64: string;
  timestamp?: number;
}

export interface VoiceConversationCancelOutputCommand {
  sessionId: string;
  turnId?: string;
  reason?: 'barge-in' | 'playback-overflow' | 'internal-fallback';
}

export interface VoiceConversationMarkCommand {
  sessionId: string;
  markName: string;
}

export interface VoiceConversationStopCommand {
  sessionId: string;
}

export type VoiceConversationEvent =
  | { type: 'ready'; sessionId: string }
  | {
      type: 'transcript';
      sessionId: string;
      role: 'user' | 'assistant';
      text: string;
      final: boolean;
      turnId?: string;
    }
  | {
      type: 'audio';
      sessionId: string;
      audioBase64: string;
      turnId?: string;
    }
  | { type: 'audio-done'; sessionId: string; turnId?: string }
  | { type: 'clear'; sessionId: string; turnId?: string }
  | { type: 'mark'; sessionId: string; markName: string; turnId?: string }
  | { type: 'error'; sessionId: string; message: string }
  | {
      type: 'closed';
      sessionId: string;
      reason: 'complete' | 'cancelled' | 'error' | 'disconnected';
    };

export interface VoiceConversationBridge {
  start(): Promise<VoiceConversationSession>;
  append(input: VoiceConversationAudioChunk): Promise<void>;
  cancelOutput(input: VoiceConversationCancelOutputCommand): Promise<'applied' | 'stale' | 'idle'>;
  acknowledgeMark(input: VoiceConversationMarkCommand): Promise<void>;
  stop(input: VoiceConversationStopCommand): Promise<void>;
  onEvent(listener: (event: VoiceConversationEvent) => void): () => void;
}

export function isVoiceConversationAudioFormat(value: unknown): value is VoiceConversationAudioFormat {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.encoding === 'g711_ulaw' || candidate.encoding === 'pcm16')
    && Number.isSafeInteger(candidate.sampleRateHz)
    && Number(candidate.sampleRateHz) >= 8_000
    && Number(candidate.sampleRateHz) <= 48_000
    && candidate.channels === 1;
}

export function isBoundedVoiceConversationInputBase64(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumVoiceConversationInputBase64Length
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function isBoundedVoiceConversationOutputBase64(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumVoiceConversationOutputBase64Length
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
