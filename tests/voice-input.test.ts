import { describe, expect, it } from 'vitest';

import { isAdmittedMicrophonePermission } from '../src/main/microphone-permission';
import {
  bytesToBase64,
  floatToG711Ulaw,
  mergeVoiceTranscript,
} from '../src/renderer/voice-input-controller';
import { isBoundedVoiceAudioBase64, maximumVoiceAudioBase64Length } from '../src/shared/voice-input';

describe('voice input boundaries', () => {
  it('encodes the admitted G.711 mu-law reference values', () => {
    expect([...floatToG711Ulaw(new Float32Array([0, 1, -1, 0.5, -0.5]))])
      .toEqual([255, 128, 0, 143, 15]);
    expect(bytesToBase64(new Uint8Array([255, 128, 0]))).toBe('/4AA');
  });

  it('merges transcript text without damaging an existing draft', () => {
    expect(mergeVoiceTranscript('', ' hello ')).toBe('hello');
    expect(mergeVoiceTranscript('Ask Deskiii', 'to wave')).toBe('Ask Deskiii to wave');
    expect(mergeVoiceTranscript('Ask Deskiii ', 'to jump')).toBe('Ask Deskiii to jump');
  });

  it('accepts only bounded canonical base64 audio chunks', () => {
    expect(isBoundedVoiceAudioBase64('/4AA')).toBe(true);
    expect(isBoundedVoiceAudioBase64('not base64')).toBe(false);
    expect(isBoundedVoiceAudioBase64('A'.repeat(maximumVoiceAudioBase64Length + 4))).toBe(false);
  });

  it('admits only audio from a main-frame Deskiii renderer', () => {
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
