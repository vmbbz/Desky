import { describe, expect, it } from 'vitest';

import { fetchFeaturedCc0Avatar } from '../src/shared/avatar-catalog';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchFeaturedCc0Avatar', () => {
  it('joins project-level licence metadata onto an avatar', async () => {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.endsWith('/projects.json')) {
        return jsonResponse([
          {
            id: 'collection',
            name: 'Collection',
            is_public: true,
            license: 'CC0',
            avatar_data_file: 'avatars/collection.json',
          },
        ]);
      }
      return jsonResponse([
        {
          id: 'avatar',
          name: 'Avatar',
          project_id: 'collection',
          model_file_url: 'https://example.com/avatar.vrm',
          thumbnail_url: 'https://example.com/avatar.png',
          is_public: true,
        },
      ]);
    };

    await expect(fetchFeaturedCc0Avatar(fetcher)).resolves.toEqual({
      id: 'avatar',
      name: 'Avatar',
      projectId: 'collection',
      projectName: 'Collection',
      license: 'CC0',
      modelUrl: 'https://example.com/avatar.vrm',
      thumbnailUrl: 'https://example.com/avatar.png',
    });
  });

  it('rejects unsafe collection paths', async () => {
    const fetcher = async (): Promise<Response> =>
      jsonResponse([
        {
          id: 'unsafe',
          name: 'Unsafe',
          is_public: true,
          license: 'CC0',
          avatar_data_file: '../private.json',
        },
      ]);

    await expect(fetchFeaturedCc0Avatar(fetcher)).rejects.toThrow(
      'No public CC0 avatar collection is available',
    );
  });
});
