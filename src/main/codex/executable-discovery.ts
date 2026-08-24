import { execFile } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, isAbsolute, posix, win32 } from 'node:path';
import { promisify } from 'node:util';

import schemaBaseline from './schema-baseline.json';

const execFileAsync = promisify(execFile);

export const CODEX_SCHEMA_BASELINE_VERSION = schemaBaseline.codexCliVersion;

export interface CodexExecutableAdmission {
  executablePath: string;
  cliVersion: string;
  schemaVersion: string;
  source: 'path';
}

export function codexExecutableCandidates(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const executableName = platform === 'win32' ? 'codex.exe' : 'codex';
  const pathDelimiter = platform === 'win32' ? win32.delimiter : posix.delimiter;
  const pathJoin = platform === 'win32' ? win32.join : posix.join;
  const entries = (environment.PATH ?? environment.Path ?? environment.path ?? '')
    .split(pathDelimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  return [...new Set(entries.map((entry) => pathJoin(entry, executableName)))];
}

export function parseCodexVersion(output: string): string | undefined {
  const match = /^codex-cli\s+([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\s*$/m.exec(output);
  return match?.[1];
}

export function admitCodexVersion(output: string): string {
  const version = parseCodexVersion(output);
  if (!version) throw new Error('The discovered Codex executable returned an invalid version.');
  if (version !== CODEX_SCHEMA_BASELINE_VERSION) {
    throw new Error(
      `Codex ${version} is not admitted by Desky's ${CODEX_SCHEMA_BASELINE_VERSION} schema baseline.`,
    );
  }
  return version;
}

export function buildCodexEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = [
    'PATH', 'Path', 'SystemRoot', 'ComSpec',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'TEMP', 'TMP', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy',
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return environment;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  if (!isAbsolute(candidate)
    || !['codex', 'codex.exe'].includes(basename(candidate).toLowerCase())) return false;
  try {
    const resolved = await realpath(candidate);
    const metadata = await stat(resolved);
    if (!metadata.isFile()) return false;
    await access(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function discoverCodexExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<CodexExecutableAdmission> {
  for (const candidate of codexExecutableCandidates(environment, platform)) {
    if (!await isExecutableFile(candidate)) continue;
    const executablePath = await realpath(candidate);
    try {
      const result = await execFileAsync(executablePath, ['--version'], {
        encoding: 'utf8',
        env: buildCodexEnvironment(environment),
        timeout: 5_000,
        windowsHide: true,
        maxBuffer: 4_096,
      });
      const cliVersion = admitCodexVersion(`${result.stdout}\n${result.stderr}`);
      return {
        executablePath,
        cliVersion,
        schemaVersion: CODEX_SCHEMA_BASELINE_VERSION,
        source: 'path',
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not admitted')) throw error;
    }
  }
  throw new Error('No admitted Codex CLI executable was found on the application PATH.');
}
