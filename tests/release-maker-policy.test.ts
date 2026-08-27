import { describe, expect, it } from 'vitest';

import { resolveWindowsMakerPolicy } from '../release.maker.config';
import { resolveBuildReleaseManifest } from '../release.config';

describe('Windows maker release policy', () => {
  const store = resolveBuildReleaseManifest('windows-store-free', 'win32');
  const direct = resolveBuildReleaseManifest('windows-direct', 'win32');

  it('uses a visibly isolated self-signed development Store identity', () => {
    const policy = resolveWindowsMakerPolicy(store, '0.1.0', {
      DESKY_RELEASE_MODE: 'development',
    });

    expect(policy.kind).toBe('msix');
    expect(policy.msix?.sign).toBe(true);
    expect(policy.msix?.packageName).toBe('Desky-Store-Development.msix');
    expect(policy.msix?.manifestVariables).toMatchObject({
      packageIdentity: 'Desky.Companion.Development',
      publisher: 'CN=Desky Development',
      packageVersion: '0.1.0.0',
    });
  });

  it('fails closed when Partner Center identity is unavailable', () => {
    expect(() => resolveWindowsMakerPolicy(store, '0.1.0', {
      DESKY_RELEASE_MODE: 'production',
    })).toThrow('DESKY_STORE_PACKAGE_IDENTITY');
  });

  it('permits an isolated development version override for real update testing', () => {
    const policy = resolveWindowsMakerPolicy(store, '0.1.0', {
      DESKY_RELEASE_MODE: 'development',
      DESKY_DEVELOPMENT_MSIX_VERSION: '0.1.1.0',
    });

    expect(policy.msix?.manifestVariables?.packageVersion).toBe('0.1.1.0');
  });

  it('uses exact Partner Center identity and leaves Store signing to Partner Center', () => {
    const policy = resolveWindowsMakerPolicy(store, '0.1.0', {
      DESKY_RELEASE_MODE: 'production',
      DESKY_STORE_PACKAGE_IDENTITY: 'Example.Desky',
      DESKY_STORE_PUBLISHER: 'CN=01234567-89ab-cdef-0123-456789abcdef',
      DESKY_STORE_PUBLISHER_DISPLAY_NAME: 'Example Publisher',
    });

    expect(policy.msix?.sign).toBe(false);
    expect(policy.msix?.manifestVariables).toMatchObject({
      packageIdentity: 'Example.Desky',
      publisher: 'CN=01234567-89ab-cdef-0123-456789abcdef',
      publisherDisplayName: 'Example Publisher',
    });
  });

  it('fails closed when the direct website installer lacks its signing identity', () => {
    expect(() => resolveWindowsMakerPolicy(direct, '0.1.0', {
      DESKY_RELEASE_MODE: 'production',
    })).toThrow('DESKY_WINDOWS_PUBLISHER_DISPLAY_NAME');
  });

  it('requires an absolute certificate path for production direct distribution', () => {
    expect(() => resolveWindowsMakerPolicy(direct, '0.1.0', {
      DESKY_RELEASE_MODE: 'production',
      DESKY_WINDOWS_PUBLISHER_DISPLAY_NAME: 'Example Publisher',
      DESKY_WINDOWS_CERTIFICATE_FILE: 'relative.pfx',
      DESKY_WINDOWS_CERTIFICATE_PASSWORD: 'not-a-real-secret',
    })).toThrow('must be an absolute path');
  });

  it('keeps the development direct installer visibly separate and unsigned', () => {
    const policy = resolveWindowsMakerPolicy(direct, '0.1.0', {
      DESKY_RELEASE_MODE: 'development',
    });

    expect(policy.kind).toBe('squirrel');
    expect(policy.squirrel).toMatchObject({
      name: 'desky_development',
      title: 'Desky Development',
      authors: 'Desky Development',
      setupExe: 'Desky-0.1.0-Development-Setup.exe',
    });
    expect(policy.squirrel?.certificateFile).toBeUndefined();
  });
});
