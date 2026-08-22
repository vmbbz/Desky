const registryBase =
  'https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data';
const maxCatalogBytes = 5 * 1024 * 1024;

interface RegistryProject {
  id: string;
  name: string;
  is_public: boolean;
  license: string;
  avatar_data_file: string;
}

interface RegistryAvatar {
  id: string;
  name: string;
  project_id: string;
  model_file_url: string;
  thumbnail_url: string;
  is_public: boolean;
  is_draft?: boolean;
}

export interface CatalogAvatar {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  license: string;
  modelUrl: string;
  thumbnailUrl: string;
}

export type AvatarCatalogFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseProject(value: unknown): RegistryProject | undefined {
  if (!isRecord(value)) return undefined;
  const avatarFile = value.avatar_data_file;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    value.is_public !== true ||
    typeof value.license !== 'string' ||
    typeof avatarFile !== 'string' ||
    !/^avatars\/[a-zA-Z0-9._-]+\.json$/.test(avatarFile)
  ) {
    return undefined;
  }

  return {
    id: value.id,
    name: value.name,
    is_public: true,
    license: value.license,
    avatar_data_file: avatarFile,
  };
}

function parseAvatar(value: unknown): RegistryAvatar | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.project_id !== 'string' ||
    !isHttpsUrl(value.model_file_url) ||
    !isHttpsUrl(value.thumbnail_url) ||
    value.is_public !== true
  ) {
    return undefined;
  }

  return {
    id: value.id,
    name: value.name,
    project_id: value.project_id,
    model_file_url: value.model_file_url,
    thumbnail_url: value.thumbnail_url,
    is_public: true,
    is_draft: value.is_draft === true,
  };
}

async function fetchJson(url: string, fetcher: AvatarCatalogFetcher): Promise<unknown> {
  const response = await fetcher(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);

  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > maxCatalogBytes) throw new Error('Catalog response is too large');

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxCatalogBytes) {
    throw new Error('Catalog response is too large');
  }
  return JSON.parse(text) as unknown;
}

export async function fetchFeaturedCc0Avatar(
  fetcher: AvatarCatalogFetcher = fetch,
  preferredName = 'Milk',
): Promise<CatalogAvatar> {
  const projectsValue = await fetchJson(`${registryBase}/projects.json`, fetcher);
  if (!Array.isArray(projectsValue)) throw new Error('Invalid project catalog');

  const project = projectsValue
    .map(parseProject)
    .find((entry) => entry?.license.toUpperCase() === 'CC0');
  if (!project) throw new Error('No public CC0 avatar collection is available');

  const avatarsValue = await fetchJson(
    `${registryBase}/${project.avatar_data_file}`,
    fetcher,
  );
  if (!Array.isArray(avatarsValue)) throw new Error('Invalid avatar catalog');

  const publicAvatars = avatarsValue
    .map(parseAvatar)
    .filter(
      (entry): entry is RegistryAvatar =>
        entry?.project_id === project.id && entry.is_draft !== true,
    );
  const avatar =
    publicAvatars.find(
      (entry) => entry.name.toLocaleLowerCase() === preferredName.toLocaleLowerCase(),
    ) ?? publicAvatars[0];
  if (!avatar) throw new Error('No public avatar is available in the collection');

  return {
    id: avatar.id,
    name: avatar.name,
    projectId: project.id,
    projectName: project.name,
    license: project.license,
    modelUrl: avatar.model_file_url,
    thumbnailUrl: avatar.thumbnail_url,
  };
}
