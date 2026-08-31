export const maximumVoiceAudioBase64Length = 16_384;

export interface VoiceInputSession {
  sessionId: string;
  inputEncoding: 'g711_ulaw';
  inputSampleRateHz: 8000;
}

export interface VoiceInputAudioChunk {
  sessionId: string;
  audioBase64: string;
}

export interface VoiceInputStopCommand {
  sessionId: string;
  discard: boolean;
}

export type VoiceInputEvent =
  | {
      type: 'transcript';
      sessionId: string;
      text: string;
      final: boolean;
    }
  | {
      type: 'error';
      sessionId: string;
      message: string;
    }
  | {
      type: 'closed';
      sessionId: string;
      reason: 'complete' | 'cancelled' | 'error' | 'disconnected';
    };

export interface VoiceInputBridge {
  start(): Promise<VoiceInputSession>;
  append(input: VoiceInputAudioChunk): Promise<void>;
  stop(input: VoiceInputStopCommand): Promise<void>;
  onEvent(listener: (event: VoiceInputEvent) => void): () => void;
}

export function isBoundedVoiceAudioBase64(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumVoiceAudioBase64Length
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
