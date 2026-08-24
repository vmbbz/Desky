import {
  fetchFeaturedCc0Avatar,
  type AvatarCatalogFetcher,
} from '../shared/avatar-catalog';
import type { FeaturedAvatarAsset } from '../shared/avatar-assets';
import type { AdmittedAvatarRevision } from './marketplace-catalog';

const maxModelBytes = 100 * 1024 * 1024;
const maxThumbnailBytes = 5 * 1024 * 1024;
const allowedModelHosts = new Set([
  'arweave.net',
  'dweb.link',
  'gateway.pinata.cloud',
  'raw.githubusercontent.com',
]);

export function assertAllowedModelUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLocaleLowerCase();
  const allowed = allowedModelHosts.has(hostname) || hostname.endsWith('.ipfs.w3s.link');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) {
    throw new Error('The avatar registry returned an unapproved model host.');
  }
  return url;
}

export async function downloadAdmittedAvatarRevision(
  revision: AdmittedAvatarRevision,
  fetcher: AvatarCatalogFetcher = fetch,
): Promise<ArrayBuffer> {
  const boundedFetcher: AvatarCatalogFetcher = (input, init) => fetcher(input, {
    ...init,
    signal: AbortSignal.timeout(60_000),
  });
  return fetchModel(assertAllowedModelUrl(revision.modelUrl), boundedFetcher);
}

export async function downloadAdmittedAvatarThumbnail(
  revision: AdmittedAvatarRevision,
  fetcher: AvatarCatalogFetcher = fetch,
): Promise<ArrayBuffer> {
  const boundedFetcher: AvatarCatalogFetcher = (input, init) => fetcher(input, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  return fetchBounded(
    assertAllowedModelUrl(revision.thumbnailUrl),
    boundedFetcher,
    maxThumbnailBytes,
    'Avatar thumbnail',
  );
}

async function fetchModel(url: URL, fetcher: AvatarCatalogFetcher): Promise<ArrayBuffer> {
  return fetchBounded(url, fetcher, maxModelBytes, 'Avatar');
}

async function fetchBounded(
  url: URL,
  fetcher: AvatarCatalogFetcher,
  maximumBytes: number,
  label: string,
): Promise<ArrayBuffer> {
  const response = await fetcher(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`${label} download failed (${response.status})`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > maximumBytes) throw new Error(`${label} exceeds its size limit.`);

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds its size limit.`);
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
