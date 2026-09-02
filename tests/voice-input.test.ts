import { describe, expect, it } from 'vitest';

import { isAdmittedMicrophonePermission } from '../src/main/microphone-permission';
import {
  bytesToBase64,
  floatToG711Ulaw,
  mergeVoiceTranscript,
} from '../src/renderer/voice-input-controller';
import { isBoundedVoiceAudioBase64, maximumVoiceAudioBase64Length } from '../src/shared/voice-input';
import {
  base64ToBytes,
  floatToPcm16LittleEndian,
  g711UlawToFloat,
  pcm16LittleEndianToFloat,
  resampleLinear,
} from '../src/renderer/voice-conversation-controller';
import {
  isBoundedVoiceConversationInputBase64,
  isBoundedVoiceConversationOutputBase64,
  maximumVoiceConversationOutputBase64Length,
} from '../src/shared/voice-conversation';

describe('voice input boundaries', () => {
  it('encodes the admitted G.711 mu-law reference values', () => {
    expect([...floatToG711Ulaw(new Float32Array([0, 1, -1, 0.5, -0.5]))])
      .toEqual([255, 128, 0, 143, 15]);
    expect(bytesToBase64(new Uint8Array([255, 128, 0]))).toBe('/4AA');
  });

  it('merges transcript text without damaging an existing draft', () => {
    expect(mergeVoiceTranscript('', ' hello ')).toBe('hello');
    expect(mergeVoiceTranscript('Ask Deskii', 'to wave')).toBe('Ask Deskii to wave');
    expect(mergeVoiceTranscript('Ask Deskii ', 'to jump')).toBe('Ask Deskii to jump');
  });

  it('accepts only bounded canonical base64 audio chunks', () => {
    expect(isBoundedVoiceAudioBase64('/4AA')).toBe(true);
    expect(isBoundedVoiceAudioBase64('not base64')).toBe(false);
    expect(isBoundedVoiceAudioBase64('A'.repeat(maximumVoiceAudioBase64Length + 4))).toBe(false);
  });

  it('encodes and decodes the admitted realtime PCM16 and mu-law audio formats', () => {
    const pcm = floatToPcm16LittleEndian(new Float32Array([0, 1, -1, 0.5, -0.5]));
    expect([...pcm]).toEqual([0, 0, 255, 127, 0, 128, 0, 64, 0, 192]);
    expect([...pcm16LittleEndianToFloat(pcm)]).toEqual([0, 32767 / 32768, -1, 0.5, -0.5]);
    const ulaw = floatToG711Ulaw(new Float32Array([0, 1, -1]));
    expect(g711UlawToFloat(ulaw)[0]).toBe(0);
    expect(g711UlawToFloat(ulaw)[1]).toBeGreaterThan(0.9);
    expect(g711UlawToFloat(ulaw)[2]).toBeLessThan(-0.9);
    expect([...base64ToBytes('/4AA')]).toEqual([255, 128, 0]);
  });

  it('resamples capture frames and keeps both realtime IPC directions bounded', () => {
    expect([...resampleLinear(new Float32Array([0, 1, 0, -1]), 4, 2)]).toEqual([0, 0]);
    expect(isBoundedVoiceConversationInputBase64('/4AA')).toBe(true);
    expect(isBoundedVoiceConversationInputBase64('bad input')).toBe(false);
    expect(isBoundedVoiceConversationOutputBase64('AAAA')).toBe(true);
    expect(isBoundedVoiceConversationOutputBase64(
      'A'.repeat(maximumVoiceConversationOutputBase64Length + 4),
    )).toBe(false);
  });

  it('admits only audio from a main-frame Deskii renderer', () => {
    const admitted = {
      surface: 'ambient' as const,
      requestingUrl: 'desky://app/main_window/index.html?surface=ambient',
      securityOrigin: 'desky://app',
      isMainFrame: true,
      mediaTypes: ['audio'],
      packaged: true,
    };
    expect(isAdmittedMicrophonePermission(admitted)).toBe(true);
    expect(isAdmittedMicrophonePermission({
      ...admitted,
      securityOrigin: 'desky://app/',
    })).toBe(true);
    expect(isAdmittedMicrophonePermission({ ...admitted, mediaTypes: ['video'] })).toBe(false);
    expect(isAdmittedMicrophonePermission({ ...admitted, isMainFrame: false })).toBe(false);
    expect(isAdmittedMicrophonePermission({
      ...admitted,
      securityOrigin: 'desky://attacker/',
    })).toBe(false);
    expect(isAdmittedMicrophonePermission({
      ...admitted,
      requestingUrl: 'https://attacker.example/',
      securityOrigin: 'https://attacker.example',
    })).toBe(false);
  });
});
