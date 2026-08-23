import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  motionIntents,
  motionLayers,
  parseAnimationAssetManifest,
  playbackKinds,
  type MotionIntent,
  type MotionLayer,
  type PlaybackKind,
} from '../../shared/animation-manifest';
import {
  createAssetProvenance,
  sha256Hex,
} from '../../shared/asset-provenance';
import { serializeCanonicalAnimationClip } from '../../shared/canonical-animation';
import { convertMixamoAnimation } from './convert-mixamo';
import { buildAnimationLibrary } from './build-library';
import { listFbxAnimationClips, parseMixamoFbx } from './mixamo-source';
import {
  sourceRigProfiles,
  type SourceRigProfile,
} from './mixamo-rig';

const converterVersion = '1.1.0';

interface Arguments {
  command?: string;
  values: Map<string, string>;
  flags: Set<string>;
}

const sourceSelectionOptions = ['source-profile', 'source-clip'] as const;
const inspectOptions = new Set(['input', 'sample-rate', 'clip-id', ...sourceSelectionOptions]);
const listOptions = new Set(['input']);
const buildLibraryOptions = new Set(['plan', 'output', 'workspace-root']);
const convertOptions = new Set([
  'input',
  'output-dir',
  'clip-id',
  'clip-version',
  'intent',
  'layer',
  'playback',
  'sample-rate',
  'source-url',
  'source-license',
  'source-creator',
  'source-fetched-at',
  'source-project',
  'source-attribution',
  'converted-at',
  'rights-reviewer',
  'reviewed-at',
  'reduced-motion-alternative',
  ...sourceSelectionOptions,
]);

function usage(): string {
  return `Desky animation converter ${converterVersion}

Inspect an FBX without writing output:
  npm run animation:converter -- inspect -- --input <animation.fbx>
    [--source-profile <mixamo|quaternius-uam-v1>] [--source-clip <exact-name>]

List every animation in a multi-clip FBX:
  npm run animation:converter -- list -- --input <animation.fbx>

Build the reviewed built-in catalogue from an exact plan:
  npm run animation:converter -- build-library -- --plan <plan.json>
    --output <library.json> [--workspace-root <repo-root>]

Convert an approved source:
  npm run animation:converter -- convert -- --input <animation.fbx> --output-dir <dir>
    --clip-id <id> --clip-version <integer> --intent <intent> --layer <layer>
    --playback <loop|one-shot> --sample-rate <1-120>
    --source-url <https-url> --source-license <id> --source-creator <name>
    --source-fetched-at <ISO-UTC> --converted-at <ISO-UTC>
    --rights-reviewer <name> --reviewed-at <ISO-UTC>
    [--source-project <name>] [--source-attribution <text>]
    [--source-profile <mixamo|quaternius-uam-v1>] [--source-clip <exact-name>]
    [--reduced-motion-alternative <clip-id>] [--include-root-motion] [--force]

Conversion refuses to emit an admitted manifest without an explicit approved-rights
review identity and deterministic timestamps. --force is required to replace output.`;
}

function parseArguments(argv: string[]): Arguments {
  const [command, ...tokens] = argv;
  const values = new Map<string, string>();
  const flags = new Set<string>();
  if (command === '--help') {
    flags.add('help');
    return { values, flags };
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument ${token}`);
    if (token === '--force' || token === '--include-root-motion' || token === '--help') {
      flags.add(token.slice(2));
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    if (values.has(token.slice(2))) throw new Error(`Duplicate option ${token}`);
    values.set(token.slice(2), value);
    index += 1;
  }
  return { command, values, flags };
}

function required(args: Arguments, name: string): string {
  const value = args.values.get(name)?.trim();
  if (!value) throw new Error(`Missing required option --${name}`);
  return value;
}

function rejectUnknownOptions(
  args: Arguments,
  allowedValues: ReadonlySet<string>,
  allowedFlags: ReadonlySet<string>,
): void {
  const unknownValue = [...args.values.keys()].find((name) => !allowedValues.has(name));
  const unknownFlag = [...args.flags].find((name) => !allowedFlags.has(name));
  if (unknownValue) throw new Error(`Unknown option --${unknownValue}`);
  if (unknownFlag) throw new Error(`Unknown flag --${unknownFlag}`);
}

function positiveInteger(args: Arguments, name: string): number {
  const value = Number(required(args, name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function enumValue<T extends string>(
  args: Arguments,
  name: string,
  allowed: readonly T[],
): T {
  const value = required(args, name);
  if (!allowed.includes(value as T)) {
    throw new Error(`--${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function sourceSelection(args: Arguments): {
  sourceRigProfile: SourceRigProfile;
  sourceClip?: string;
} {
  const sourceRigProfile = args.values.get('source-profile') ?? 'mixamo';
  if (!sourceRigProfiles.includes(sourceRigProfile as SourceRigProfile)) {
    throw new Error(`--source-profile must be one of: ${sourceRigProfiles.join(', ')}`);
  }
  return {
    sourceRigProfile: sourceRigProfile as SourceRigProfile,
    sourceClip: args.values.get('source-clip'),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeBundle(
  outputDirectory: string,
  clipId: string,
  clipBytes: Uint8Array,
  manifestBytes: Uint8Array,
  force: boolean,
): Promise<{ clipPath: string; manifestPath: string }> {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const clipPath = resolve(directory, `${clipId}.json`);
  const manifestPath = resolve(directory, `${clipId}.manifest.json`);
  const relativeClipPath = relative(directory, clipPath);
  if (relativeClipPath.startsWith('..') || isAbsolute(relativeClipPath)) {
    throw new Error('Resolved clip output escapes the output directory');
  }
  if (!force && (await exists(clipPath) || await exists(manifestPath))) {
    throw new Error('Output exists; pass --force to replace both generated files');
  }

  const suffix = `${process.pid}-${Date.now()}.tmp`;
  const clipTemporary = `${clipPath}.${suffix}`;
  const manifestTemporary = `${manifestPath}.${suffix}`;
  try {
    await writeFile(clipTemporary, clipBytes, { flag: 'wx' });
    await writeFile(manifestTemporary, manifestBytes, { flag: 'wx' });
    if (force) {
      await rm(clipPath, { force: true });
      await rm(manifestPath, { force: true });
    }
    await rename(clipTemporary, clipPath);
    await rename(manifestTemporary, manifestPath);
    return { clipPath, manifestPath };
  } catch (error) {
    await Promise.all([
      rm(clipTemporary, { force: true }),
      rm(manifestTemporary, { force: true }),
    ]);
    throw error;
  }
}

async function inspect(args: Arguments): Promise<void> {
  rejectUnknownOptions(args, inspectOptions, new Set(['include-root-motion']));
  const inputPath = resolve(required(args, 'input'));
  const input = await readFile(inputPath);
  const source = parseMixamoFbx(exactArrayBuffer(input), sourceSelection(args));
  const sampleRateValue = Number(args.values.get('sample-rate') ?? '30');
  if (!Number.isSafeInteger(sampleRateValue) || sampleRateValue < 1 || sampleRateValue > 120) {
    throw new Error('--sample-rate must be an integer from 1 to 120');
  }
  const canonical = convertMixamoAnimation(source, {
    clipId: args.values.get('clip-id') ?? 'inspection-only',
    sampleRate: sampleRateValue,
    includeRootMotion: args.flags.has('include-root-motion'),
  });
  const canonicalBytes = serializeCanonicalAnimationClip(canonical);
  const summary = {
    inputPath,
    bytes: input.byteLength,
    sha256: await sha256Hex(exactArrayBuffer(input)),
    sourceClip: source.sourceClipName,
    sourceRigProfile: source.sourceRigProfile,
    durationSeconds: source.durationSeconds,
    sourceHipsHeight: source.sourceHipsHeight,
    supportedTracks: source.tracks.length,
    ignoredTracks: source.ignoredTrackCount,
    canonicalTracks: canonical.tracks.length,
    canonicalSampleRate: canonical.sampleRate,
    canonicalSha256: await sha256Hex(exactArrayBuffer(canonicalBytes)),
    bones: [...new Set(source.tracks.map((track) => track.bone))].sort(),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function list(args: Arguments): Promise<void> {
  rejectUnknownOptions(args, listOptions, new Set());
  const inputPath = resolve(required(args, 'input'));
  const input = await readFile(inputPath);
  const clips = listFbxAnimationClips(exactArrayBuffer(input));
  process.stdout.write(`${JSON.stringify({
    inputPath,
    bytes: input.byteLength,
    sha256: await sha256Hex(exactArrayBuffer(input)),
    clipCount: clips.length,
    clips,
  }, null, 2)}\n`);
}

async function buildLibrary(args: Arguments): Promise<void> {
  rejectUnknownOptions(args, buildLibraryOptions, new Set());
  const result = await buildAnimationLibrary({
    planPath: required(args, 'plan'),
    outputPath: required(args, 'output'),
    workspaceRoot: args.values.get('workspace-root') ?? process.cwd(),
    converterVersion,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function convert(args: Arguments): Promise<void> {
  rejectUnknownOptions(args, convertOptions, new Set(['include-root-motion', 'force']));
  const inputPath = resolve(required(args, 'input'));
  const input = await readFile(inputPath);
  const inputBuffer = exactArrayBuffer(input);
  const clipId = required(args, 'clip-id');
  const clipVersion = positiveInteger(args, 'clip-version');
  const sampleRate = positiveInteger(args, 'sample-rate');
  const intent = enumValue<MotionIntent>(args, 'intent', motionIntents);
  const layer = enumValue<MotionLayer>(args, 'layer', motionLayers);
  const playback = enumValue<PlaybackKind>(args, 'playback', playbackKinds);
  const convertedAt = required(args, 'converted-at');
  const reviewedAt = required(args, 'reviewed-at');
  const licenseId = required(args, 'source-license');
  const sourceCreator = required(args, 'source-creator');

  const source = parseMixamoFbx(inputBuffer, sourceSelection(args));
  const canonical = convertMixamoAnimation(source, {
    clipId,
    sampleRate,
    includeRootMotion: args.flags.has('include-root-motion'),
  });
  const clipBytes = serializeCanonicalAnimationClip(canonical);
  const sourceProvenance = await createAssetProvenance({
    assetId: `animation:source/${clipId}`,
    kind: 'animation',
    sourceUrl: required(args, 'source-url'),
    sourceProject: args.values.get('source-project'),
    creator: sourceCreator,
    licenseId,
    attribution: args.values.get('source-attribution'),
    bytes: inputBuffer,
    fetchedAt: new Date(required(args, 'source-fetched-at')),
  });
  const outputProvenance = await createAssetProvenance({
    assetId: `animation:canonical/${clipId}:v${clipVersion}`,
    kind: 'animation',
    sourceUrl: `desky-asset://animations/${clipId}.json`,
    sourceProject: 'Desky animation pipeline',
    creator: sourceCreator,
    licenseId,
    attribution: args.values.get('source-attribution'),
    bytes: exactArrayBuffer(clipBytes),
    fetchedAt: new Date(convertedAt),
  });
  const manifest = parseAnimationAssetManifest({
    schemaVersion: 1,
    clipId,
    clipVersion,
    intent,
    layer,
    playback,
    source: sourceProvenance,
    output: outputProvenance,
    conversion: {
      tool: 'desky-animation-converter',
      toolVersion: converterVersion,
      convertedAt,
      retargetProfile: 'mixamo-vrm-normalized-v1',
      rotationSpace: 'parent-rest-world',
      translationScale: 'hips-height-ratio',
      sampleRate,
      includeRootMotion: args.flags.has('include-root-motion'),
      sourceRigProfile: source.sourceRigProfile,
      sourceClip: source.sourceClipName,
    },
    rightsReview: {
      status: 'approved',
      reviewer: required(args, 'rights-reviewer'),
      reviewedAt,
    },
    reducedMotionAlternative: args.values.get('reduced-motion-alternative'),
  });
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const paths = await writeBundle(
    required(args, 'output-dir'),
    clipId,
    clipBytes,
    manifestBytes,
    args.flags.has('force'),
  );
  process.stdout.write(`${JSON.stringify({
    ...paths,
    clipSha256: outputProvenance.sha256,
    sourceSha256: sourceProvenance.sha256,
    trackCount: canonical.tracks.length,
  }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.flags.has('help') || !args.command) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args.command === 'inspect') await inspect(args);
  else if (args.command === 'list') await list(args);
  else if (args.command === 'build-library') await buildLibrary(args);
  else if (args.command === 'convert') await convert(args);
  else throw new Error(`Unknown command ${args.command}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Animation conversion failed';
  process.stderr.write(`Desky animation converter: ${message}\n`);
  process.exitCode = 1;
});
