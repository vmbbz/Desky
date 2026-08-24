import { describe, expect, it } from 'vitest';

import {
  admitCodexVersion,
  buildCodexEnvironment,
  CODEX_SCHEMA_BASELINE_VERSION,
  codexExecutableCandidates,
  parseCodexVersion,
} from '../src/main/codex/executable-discovery';

describe('Codex executable admission', () => {
  it('derives bounded platform executable candidates only from main process PATH', () => {
    const candidates = codexExecutableCandidates({
      PATH: [`C:\\Program Files\\Codex`, 'C:\\Tools', 'C:\\Tools'].join(';'),
    }, 'win32');
    expect(candidates).toEqual([
      'C:\\Program Files\\Codex\\codex.exe',
      'C:\\Tools\\codex.exe',
    ]);
    expect(codexExecutableCandidates({ PATH: '/opt/codex/bin:/usr/local/bin' }, 'linux'))
      .toEqual(['/opt/codex/bin/codex', '/usr/local/bin/codex']);
  });

  it('admits only the exact generated-schema CLI baseline', () => {
    expect(parseCodexVersion(`codex-cli ${CODEX_SCHEMA_BASELINE_VERSION}`))
      .toBe(CODEX_SCHEMA_BASELINE_VERSION);
    expect(admitCodexVersion(`codex-cli ${CODEX_SCHEMA_BASELINE_VERSION}\n`))
      .toBe(CODEX_SCHEMA_BASELINE_VERSION);
    expect(() => admitCodexVersion('codex-cli 0.145.0'))
      .toThrow('not admitted');
    expect(() => admitCodexVersion('something else'))
      .toThrow('invalid version');
  });

  it('constructs an explicit minimal environment without ambient API secrets', () => {
    const environment = buildCodexEnvironment({
      PATH: 'path',
      USERPROFILE: 'profile',
      APPDATA: 'appdata',
      OPENAI_API_KEY: 'secret',
      RANDOM_SECRET: 'also-secret',
      HTTPS_PROXY: 'proxy',
    });
    expect(environment).toEqual({
      PATH: 'path',
      USERPROFILE: 'profile',
      APPDATA: 'appdata',
      HTTPS_PROXY: 'proxy',
    });
  });
});
