import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultManifestPath = resolve(scriptDirectory, '../src/main/codex/schema-baseline.json');
const maximumFiles = 512;
const maximumRawBytes = 16 * 1024 * 1024;
const maximumFileBytes = 2 * 1024 * 1024;

function parseArguments(argv) {
  const options = {
    manifestPath: defaultManifestPath,
    schemaDirectory: undefined,
    writeBaseline: false,
  };
  const readValue = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') options.manifestPath = resolve(readValue(index++, argument));
    else if (argument === '--schema-dir') options.schemaDirectory = resolve(readValue(index++, argument));
    else if (argument === '--write-baseline') options.writeBaseline = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readBaseline(value) {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.codexCliVersion !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.codexCliVersion)
    || !isRecord(value.generator)
    || value.generator.experimental !== false
    || typeof value.generator.command !== 'string'
    || typeof value.canonicalization !== 'string'
    || !Number.isSafeInteger(value.fileCount)
    || !Number.isSafeInteger(value.totalCanonicalBytes)
    || typeof value.bundleSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.bundleSha256)
    || !isRecord(value.consumedSchemas)
    || Object.keys(value.consumedSchemas).length === 0) {
    throw new Error('Invalid Codex schema baseline manifest.');
  }
  for (const [schemaPath, entry] of Object.entries(value.consumedSchemas)) {
    if (!schemaPath.endsWith('.json')
      || schemaPath.includes('..')
      || isAbsolute(schemaPath)
      || !isRecord(entry)
      || !Number.isSafeInteger(entry.canonicalBytes)
      || typeof entry.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid consumed schema baseline: ${schemaPath}`);
    }
  }
  return value;
}

async function collectJsonFiles(root, directory = root, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Schema output must not contain symbolic links.');
    if (entry.isDirectory()) await collectJsonFiles(root, absolutePath, output);
    else if (entry.isFile()) {
      if (!entry.name.endsWith('.json')) throw new Error('Schema output contains a non-JSON file.');
      output.push(relative(root, absolutePath).split(sep).join('/'));
      if (output.length > maximumFiles) throw new Error('Schema output contains too many files.');
    } else throw new Error('Schema output contains an unsupported filesystem entry.');
  }
  return output;
}

async function snapshotSchemas(root) {
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Schema output must be a real directory.');
  }
  const paths = (await collectJsonFiles(root)).sort();
  if (paths.length === 0) throw new Error('Schema output is empty.');
  let rawBytes = 0;
  const files = {};
  for (const schemaPath of paths) {
    const absolutePath = join(root, ...schemaPath.split('/'));
    const bytes = await readFile(absolutePath);
    rawBytes += bytes.byteLength;
    if (bytes.byteLength > maximumFileBytes || rawBytes > maximumRawBytes) {
      throw new Error('Schema output exceeds its size limit.');
    }
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error(`Schema output is invalid JSON: ${schemaPath}`);
    }
    const canonical = JSON.stringify(canonicalize(parsed));
    files[schemaPath] = {
      canonicalBytes: Buffer.byteLength(canonical),
      sha256: hash(canonical),
    };
  }
  const bundleInput = Object.entries(files)
    .map(([schemaPath, entry]) => `${schemaPath}\0${entry.canonicalBytes}\0${entry.sha256}\n`)
    .join('');
  return {
    fileCount: paths.length,
    totalCanonicalBytes: Object.values(files).reduce((total, entry) => total + entry.canonicalBytes, 0),
    bundleSha256: hash(bundleInput),
    files,
  };
}

function reviewedEnvironment(source, codexHome) {
  const allowed = [
    'PATH', 'Path', 'SystemRoot', 'ComSpec',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'TEMP', 'TMP', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy',
  ];
  const environment = {};
  if (codexHome) environment.CODEX_HOME = codexHome;
  for (const name of allowed) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return environment;
}

async function discoverCodex(environment, expectedVersion) {
  const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const entries = (environment.PATH ?? environment.Path ?? environment.path ?? '')
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  for (const entry of [...new Set(entries)]) {
    const candidate = join(entry, executableName);
    try {
      const resolved = await realpath(candidate);
      if (!isAbsolute(resolved) || basename(resolved).toLowerCase() !== executableName) continue;
      const metadata = await lstat(resolved);
      if (!metadata.isFile()) continue;
      await access(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      const result = await execFileAsync(resolved, ['--version'], {
        encoding: 'utf8',
        env: reviewedEnvironment(environment),
        timeout: 5_000,
        windowsHide: true,
        maxBuffer: 4_096,
      });
      const match = /^codex-cli\s+([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\s*$/m
        .exec(`${result.stdout}\n${result.stderr}`);
      if (!match) continue;
      if (match[1] !== expectedVersion) {
        throw new Error(`Codex ${match[1]} does not match schema baseline ${expectedVersion}.`);
      }
      return resolved;
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not match schema baseline')) throw error;
    }
  }
  throw new Error('No admitted Codex CLI executable was found on PATH.');
}

async function generateSchemas(baseline) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'desky-codex-schema-'));
  const schemaDirectory = join(temporaryRoot, 'schemas');
  const codexHome = join(temporaryRoot, 'codex-home');
  await mkdir(schemaDirectory);
  await mkdir(codexHome);
  try {
    const executable = await discoverCodex(process.env, baseline.codexCliVersion);
    await execFileAsync(executable, ['app-server', 'generate-json-schema', '--out', schemaDirectory], {
      encoding: 'utf8',
      env: reviewedEnvironment(process.env, codexHome),
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    return await snapshotSchemas(schemaDirectory);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function updatedBaseline(baseline, snapshot) {
  const consumedSchemas = {};
  for (const schemaPath of Object.keys(baseline.consumedSchemas)) {
    const entry = snapshot.files[schemaPath];
    if (!entry) throw new Error(`Required consumed schema is missing: ${schemaPath}`);
    consumedSchemas[schemaPath] = entry;
  }
  return {
    ...baseline,
    fileCount: snapshot.fileCount,
    totalCanonicalBytes: snapshot.totalCanonicalBytes,
    bundleSha256: snapshot.bundleSha256,
    consumedSchemas,
  };
}

function verifySnapshot(baseline, snapshot) {
  const mismatches = [];
  if (snapshot.fileCount !== baseline.fileCount) mismatches.push('file count');
  if (snapshot.totalCanonicalBytes !== baseline.totalCanonicalBytes) mismatches.push('canonical byte count');
  if (snapshot.bundleSha256 !== baseline.bundleSha256) mismatches.push('bundle SHA-256');
  for (const [schemaPath, expected] of Object.entries(baseline.consumedSchemas)) {
    const actual = snapshot.files[schemaPath];
    if (!actual) mismatches.push(`missing ${schemaPath}`);
    else if (actual.canonicalBytes !== expected.canonicalBytes || actual.sha256 !== expected.sha256) {
      mismatches.push(schemaPath);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Codex schema baseline drift: ${mismatches.slice(0, 8).join(', ')}`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const baseline = readBaseline(JSON.parse(await readFile(options.manifestPath, 'utf8')));
  const snapshot = options.schemaDirectory
    ? await snapshotSchemas(options.schemaDirectory)
    : await generateSchemas(baseline);
  if (options.writeBaseline) {
    const next = updatedBaseline(baseline, snapshot);
    await writeFile(options.manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    process.stdout.write(`Updated Codex schema baseline ${baseline.codexCliVersion}.\n`);
    return;
  }
  verifySnapshot(baseline, snapshot);
  process.stdout.write(
    `Verified Codex ${baseline.codexCliVersion}: ${snapshot.fileCount} schemas, ${snapshot.bundleSha256}.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Codex schema verification failed.'}\n`);
  process.exitCode = 1;
});
