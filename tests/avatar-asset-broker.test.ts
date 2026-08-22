import { describe, expect, it, vi } from 'vitest';

import { loadFeaturedAvatarAsset } from '../src/main/avatar-asset-broker';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe('main-process avatar asset broker', () => {
  it('returns bounded bytes only for an admitted registry model host', async () => {
    const model = new Uint8Array([1, 2, 3, 4]);
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.endsWith('/projects.json')) {
        return jsonResponse([{
          id: 'collection',
          name: 'Collection',
          is_public: true,
          license: 'CC0',
          avatar_data_file: 'avatars/collection.json',
        }]);
      }
      if (url.endsWith('/avatars/collection.json')) {
        return jsonResponse([{
          id: 'milk',
          name: 'Milk',
          project_id: 'collection',
          model_file_url: 'https://arweave.net/model-id',
          thumbnail_url: 'https://arweave.net/thumbnail-id',
          is_public: true,
        }]);
      }
      return new Response(model, { status: 200 });
    });

    const asset = await loadFeaturedAvatarAsset(fetcher);
    expect(asset.avatar).toMatchObject({ id: 'milk', license: 'CC0' });
    expect(new Uint8Array(asset.bytes)).toEqual(model);
  });

  it('rejects registry-controlled model URLs outside the explicit host policy', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.endsWith('/projects.json')) {
        return jsonResponse([{
          id: 'collection', name: 'Collection', is_public: true, license: 'CC0',
          avatar_data_file: 'avatars/collection.json',
        }]);
      }
      return jsonResponse([{
        id: 'avatar', name: 'Avatar', project_id: 'collection', is_public: true,
        model_file_url: 'https://127.0.0.1/private.vrm',
        thumbnail_url: 'https://example.com/avatar.png',
      }]);
    });

    await expect(loadFeaturedAvatarAsset(fetcher)).rejects.toThrow('unapproved model host');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
