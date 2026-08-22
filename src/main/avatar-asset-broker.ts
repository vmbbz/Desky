import {
  fetchFeaturedCc0Avatar,
  type AvatarCatalogFetcher,
} from '../shared/avatar-catalog';
import type { FeaturedAvatarAsset } from '../shared/avatar-assets';

const maxModelBytes = 100 * 1024 * 1024;
const allowedModelHosts = new Set([
  'arweave.net',
  'dweb.link',
  'gateway.pinata.cloud',
  'raw.githubusercontent.com',
]);

function assertAllowedModelUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLocaleLowerCase();
  const allowed = allowedModelHosts.has(hostname) || hostname.endsWith('.ipfs.w3s.link');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) {
    throw new Error('The avatar registry returned an unapproved model host.');
  }
  return url;
}

async function fetchModel(url: URL, fetcher: AvatarCatalogFetcher): Promise<ArrayBuffer> {
  const response = await fetcher(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Avatar download failed (${response.status})`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > maxModelBytes) throw new Error('Avatar exceeds the 100 MB limit');

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxModelBytes) throw new Error('Avatar exceeds the 100 MB limit');
  return bytes;
}

export async function loadFeaturedAvatarAsset(
  fetcher: AvatarCatalogFetcher = fetch,
): Promise<FeaturedAvatarAsset> {
  const boundedFetcher: AvatarCatalogFetcher = (input, init) => fetcher(input, {
    ...init,
    signal: AbortSignal.timeout(60_000),
  });
  const avatar = await fetchFeaturedCc0Avatar(boundedFetcher);
  const modelUrl = assertAllowedModelUrl(avatar.modelUrl);
  const bytes = await fetchModel(modelUrl, boundedFetcher);
  return { avatar, bytes };
}
