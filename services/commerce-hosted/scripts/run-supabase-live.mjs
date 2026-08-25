import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist', 'verification', 'supabase-live.mjs');
await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(root, 'scripts', 'supabase-live.ts')],
  outfile: output,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  sourcemap: false,
});
await import(`${pathToFileURL(output).href}?run=${Date.now()}`);
