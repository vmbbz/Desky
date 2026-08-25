import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist', 'site');
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(output, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'src', 'browser.ts')],
  bundle: true,
  entryNames: 'assets/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  outdir: output,
  platform: 'browser',
  format: 'esm',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  metafile: true,
});

const outputs = Object.entries(result.metafile.outputs);
const script = outputs.find(([, value]) => value.entryPoint?.endsWith('src/browser.ts'))?.[0];
const stylesheet = outputs.find(([path]) => path.endsWith('.css'))?.[0];
if (!script || !stylesheet) throw new Error('Hosted checkout build did not emit exact assets.');

const relativeAsset = (path) => `/${relative(output, resolve(path)).replaceAll('\\', '/')}`;
const template = await readFile(resolve(root, 'src', 'index.html'), 'utf8');
const document = template
  .replace('__DESKY_CHECKOUT_SCRIPT__', relativeAsset(script))
  .replace('__DESKY_CHECKOUT_STYLES__', relativeAsset(stylesheet));
if (document.includes('__DESKY_CHECKOUT_')) throw new Error('Hosted checkout template is incomplete.');
await writeFile(resolve(output, 'index.html'), document, 'utf8');
