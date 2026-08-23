import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  LocalAnimationPreviewHost,
  validateLocalAnimationAsset,
} from '../src/main/local-animation-preview';

function vrmaBytes(overrides: Record<string, unknown> = {}): Uint8Array {
  const document = {
    asset: { version: '2.0' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones: { hips: { node: 0 } } },
      },
    },
    nodes: [{}],
    animations: [{ channels: [{ target: { node: 0, path: 'rotation' } }] }],
    ...overrides,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(encoded, 20);
  return bytes;
}

describe('local VRM Animation admission', () => {
  it('keeps only bounded metadata and exact bytes from a valid local VRMA', () => {
    const bytes = vrmaBytes();
    const asset = validateLocalAnimationAsset('C:\\private\\motion\\Wave.VRMA', bytes);

    expect(asset.fileName).toBe('Wave.VRMA');
    expect(asset.sizeBytes).toBe(bytes.byteLength);
    expect(asset.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(new Uint8Array(asset.bytes)).toEqual(bytes);
    expect(JSON.stringify(asset)).not.toContain('private');
  });

  it('rejects mislabeled files, missing VRMA declarations, and external resources', () => {
    expect(() => validateLocalAnimationAsset('wave.glb', vrmaBytes())).toThrow(/\.vrma/i);
    expect(() => validateLocalAnimationAsset('wave.vrma', vrmaBytes({
      extensionsUsed: [],
    }))).toThrow(/VRMC_vrm_animation/);
    expect(() => validateLocalAnimationAsset('wave.vrma', vrmaBytes({
      buffers: [{ uri: 'https://example.invalid/motion.bin' }],
    }))).toThrow(/inside the selected file/i);
    expect(() => validateLocalAnimationAsset('wave.vrma', vrmaBytes({
      extensions: {
        VRMC_vrm_animation: {
          specVersion: '1.0',
          humanoid: { humanBones: {} },
        },
      },
    }))).toThrow(/humanoid bone map/i);
  });
});

describe('LocalAnimationPreviewHost', () => {
  it('issues monotonic play requests, ignores stale reports, and clears session memory', () => {
    const host = new LocalAnimationPreviewHost();
    const asset = validateLocalAnimationAsset('wave.vrma', vrmaBytes());
    const first = host.select(asset);

    expect(first.requestId).toBe('local-vrma-preview-1');
    expect(host.getState()).toMatchObject({ status: 'loading', selection: { fileName: 'wave.vrma' } });
    expect(host.getCurrentCommand()?.requestId).toBe(first.requestId);

    const second = host.requestPlay();
    host.report({ requestId: first.requestId, status: 'error', message: 'stale' });
    expect(host.getState().requestId).toBe(second.requestId);
    host.report({ requestId: second.requestId, status: 'completed', message: 'Finished.' });
    expect(host.getState().status).toBe('completed');
    expect(host.getCurrentCommand()).toBeUndefined();

    expect(host.clear().status).toBe('empty');
    expect(host.getState().selection).toBeUndefined();
    expect(() => host.requestPlay()).toThrow(/choose/i);
  });
});
