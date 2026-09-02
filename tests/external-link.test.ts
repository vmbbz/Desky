import { describe, expect, it } from 'vitest';

import { normalizeSafeExternalUrl } from '../src/shared/external-link';

describe('external response links', () => {
  it('admits credential-free web links', () => {
    expect(normalizeSafeExternalUrl('https://example.com/docs?q=deskii'))
      .toBe('https://example.com/docs?q=deskii');
  });

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'https://user:secret@example.com/',
    'openclaw://chat',
  ])('rejects untrusted external protocol input: %s', (value) => {
    expect(() => normalizeSafeExternalUrl(value)).toThrow();
  });
});
