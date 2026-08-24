import { describe, expect, it, vi } from 'vitest';

import { AvatarAssetHost, type PersistedAvatarSelection } from '../src/main/avatar-asset-host';

const milk = 'milk-99e32f15-v1';
const bananaId = 'c47d2c68-80ae-4131-802a-b1bf12f30398';
const banana = 'cool-banana-4d316549-v1';

describe('transactional avatar activation', () => {
  it('does not persist a selection until the ambient runtime accepts it', async () => {
    let persisted: PersistedAvatarSelection = {
      activeRevisionId: milk,
      fallbackRevisionId: milk,
    };
    const write = vi.fn((next: PersistedAvatarSelection) => { persisted = next; });
    const host = new AvatarAssetHost(
      { get: vi.fn(async () => new ArrayBuffer(8)) },
      () => persisted,
      write,
    );

    const pending = await host.activate(bananaId);
    expect(pending).toMatchObject({ status: 'activating', pendingRevisionId: banana });
    expect(write).not.toHaveBeenCalled();

    const committed = await host.reportLoad({ revisionId: banana, status: 'ready' });
    expect(committed).toMatchObject({ status: 'ready', activeRevisionId: banana });
    expect(persisted).toEqual({ activeRevisionId: banana, fallbackRevisionId: milk });
  });

  it('rolls back to the previous companion when runtime admission fails', async () => {
    let persisted: PersistedAvatarSelection = {
      activeRevisionId: milk,
      fallbackRevisionId: milk,
    };
    const host = new AvatarAssetHost(
      { get: vi.fn(async () => new ArrayBuffer(8)) },
      () => persisted,
      (next) => { persisted = next; },
    );

    await host.activate(bananaId);
    const state = await host.reportLoad({
      revisionId: banana,
      status: 'error',
      message: 'Humanoid admission failed.',
    });
    expect(state).toMatchObject({
      status: 'error',
      activeRevisionId: milk,
      error: 'Humanoid admission failed.',
    });
    expect(persisted.activeRevisionId).toBe(milk);
  });

  it('rejects unknown avatar IDs before cache or selection mutation', async () => {
    const get = vi.fn(async () => new ArrayBuffer(8));
    const host = new AvatarAssetHost(
      { get },
      () => ({ activeRevisionId: milk, fallbackRevisionId: milk }),
      vi.fn(),
    );
    await expect(host.activate('unknown-avatar')).rejects.toThrow('not available');
    expect(get).not.toHaveBeenCalled();
  });

  it('previews verified bytes without mutating or publishing selection state', async () => {
    const bytes = new ArrayBuffer(8);
    const get = vi.fn(async () => bytes);
    const write = vi.fn();
    const host = new AvatarAssetHost(
      { get },
      () => ({ activeRevisionId: milk, fallbackRevisionId: milk }),
      write,
    );
    const listener = vi.fn();
    host.onState(listener);

    const preview = await host.getPreview(bananaId);

    expect(preview).toMatchObject({
      avatar: { revisionId: banana },
      bytes,
    });
    expect(host.getState()).toMatchObject({ activeRevisionId: milk, status: 'ready' });
    expect(write).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('protects active, fallback, and pending revisions from cache eviction', async () => {
    const host = new AvatarAssetHost(
      { get: vi.fn(async () => new ArrayBuffer(8)) },
      () => ({ activeRevisionId: milk, fallbackRevisionId: milk }),
      vi.fn(),
    );
    await host.activate(bananaId);
    expect([...host.getProtectedRevisionIds()].sort()).toEqual([banana, milk].sort());
    expect(host.getCacheProtection().get(milk)).toEqual(['active', 'rollback']);
    expect(host.getCacheProtection().get(banana)).toEqual(['pending']);
  });

  it('protects an acquiring revision before cache verification completes', async () => {
    let release: (() => void) | undefined;
    const host = new AvatarAssetHost(
      { get: vi.fn(() => new Promise<ArrayBuffer>((resolve) => {
        release = () => resolve(new ArrayBuffer(8));
      })) },
      () => ({ activeRevisionId: milk, fallbackRevisionId: milk }),
      vi.fn(),
    );

    const activation = host.activate(bananaId);
    expect(host.getCacheProtection().get(banana)).toEqual(['pending']);
    release?.();
    await activation;
  });
});
