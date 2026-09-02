import { createHash } from 'node:crypto';
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
const brandingRoot = resolve(root, '..', '..', 'branding', 'logo');
const copyBrandedAsset = async (source, stem) => {
  const bytes = await readFile(source);
  const extension = source.slice(source.lastIndexOf('.'));
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 10).toUpperCase();
  const filename = `${stem}-${digest}${extension}`;
  await writeFile(resolve(output, 'assets', filename), bytes);
  return `/assets/${filename}`;
};
const brandLockup = await copyBrandedAsset(
  resolve(brandingRoot, 'desky-lockup-on-dark.svg'),
  'desky-lockup-on-dark',
);
const marketingLockup = await copyBrandedAsset(
  resolve(brandingRoot, 'desky-lockup-on-light.svg'),
  'desky-lockup-on-light',
);
const faviconSvg = await copyBrandedAsset(
  resolve(brandingRoot, 'desky-app-icon.svg'),
  'desky-favicon',
);
const faviconPng = await copyBrandedAsset(
  resolve(brandingRoot, 'raster', 'desky-app-icon-32.png'),
  'desky-favicon-32',
);
const touchIcon = await copyBrandedAsset(
  resolve(brandingRoot, 'raster', 'desky-app-icon-256.png'),
  'desky-touch-icon',
);
const icon = await copyBrandedAsset(
  resolve(brandingRoot, 'desky-app-icon-512.png'),
  'desky-app-icon',
);
const postersRoot = resolve(root, '..', '..', 'branding', 'poster');
const heroPoster = await copyBrandedAsset(
  resolve(postersRoot, 'desky-school-desk-x.png'),
  'desky-hero-school-desk',
);
const screenPoster = await copyBrandedAsset(
  resolve(postersRoot, 'desky-through-the-screen-x.png'),
  'desky-through-the-screen',
);
const schoolPoster = await copyBrandedAsset(
  resolve(postersRoot, 'desky-school-desk-x.png'),
  'desky-school-desk',
);
const signalPoster = await copyBrandedAsset(
  resolve(postersRoot, 'desky-first-signal-x.png'),
  'desky-first-signal',
);
const marketingStyles = await copyBrandedAsset(
  resolve(root, 'src', 'marketing.css'),
  'marketing',
);
const legalStyles = await copyBrandedAsset(
  resolve(root, 'src', 'legal.css'),
  'legal',
);
const checkoutTemplate = await readFile(resolve(root, 'src', 'checkout.html'), 'utf8');
const checkoutDocument = checkoutTemplate
  .replace('__DESKY_CHECKOUT_SCRIPT__', relativeAsset(script))
  .replace('__DESKY_CHECKOUT_STYLES__', relativeAsset(stylesheet))
  .replace('__DESKY_BRAND_LOCKUP__', brandLockup)
  .replace('__DESKY_FAVICON_SVG__', faviconSvg)
  .replace('__DESKY_FAVICON_PNG__', faviconPng)
  .replace('__DESKY_TOUCH_ICON__', touchIcon);
if (checkoutDocument.includes('__DESKY_CHECKOUT_')) throw new Error('Hosted checkout template is incomplete.');
await writeFile(resolve(output, 'checkout.html'), checkoutDocument, 'utf8');

const marketingTemplate = await readFile(resolve(root, 'src', 'marketing.html'), 'utf8');
const marketingDocument = marketingTemplate
  .replaceAll('__DESKY_MARKETING_STYLES__', marketingStyles)
  .replaceAll('__DESKY_MARKETING_LOCKUP__', marketingLockup)
  .replaceAll('__DESKY_BRAND_LOCKUP__', brandLockup)
  .replaceAll('__DESKY_FAVICON_SVG__', faviconSvg)
  .replaceAll('__DESKY_FAVICON_PNG__', faviconPng)
  .replaceAll('__DESKY_TOUCH_ICON__', touchIcon)
  .replaceAll('__DESKY_ICON__', icon)
  .replaceAll('__DESKY_HERO_POSTER__', heroPoster)
  .replaceAll('__DESKY_SCREEN_POSTER__', screenPoster)
  .replaceAll('__DESKY_SCHOOL_POSTER__', schoolPoster)
  .replaceAll('__DESKY_SIGNAL_POSTER__', signalPoster);
if (marketingDocument.includes('__DESKY_')) throw new Error('Marketing template is incomplete.');
await writeFile(resolve(output, 'index.html'), marketingDocument, 'utf8');

// --- Legal and support pages ---
const legalTokens = {
  '__DESKY_MARKETING_STYLES__': marketingStyles,
  '__DESKY_LEGAL_STYLES__': legalStyles,
  '__DESKY_MARKETING_LOCKUP__': marketingLockup,
  '__DESKY_FAVICON_SVG__': faviconSvg,
  '__DESKY_FAVICON_PNG__': faviconPng,
  '__DESKY_TOUCH_ICON__': touchIcon,
};
const buildLegalPage = async (srcFile, destPath) => {
  let doc = await readFile(resolve(root, 'src', srcFile), 'utf8');
  for (const [token, value] of Object.entries(legalTokens)) {
    doc = doc.replaceAll(token, value);
  }
  if (doc.includes('__DESKY_')) throw new Error(`Legal page ${srcFile} has unfilled tokens.`);
  const destDir = resolve(output, destPath);
  await mkdir(destDir, { recursive: true });
  await writeFile(resolve(destDir, 'index.html'), doc, 'utf8');
};

await Promise.all([
  buildLegalPage('privacy.html',            'privacy'),
  buildLegalPage('support.html',            'support'),
  buildLegalPage('security.html',           'security'),
  buildLegalPage('terms.html',              'terms'),
  buildLegalPage('licenses.html',           'licenses'),
  buildLegalPage('report-ai-content.html',  'report-ai-content'),
  buildLegalPage('account-delete.html',     'account/delete'),
]);

// --- security.txt (RFC 9116) ---
const wellKnownDir = resolve(output, '.well-known');
await mkdir(wellKnownDir, { recursive: true });
await writeFile(resolve(wellKnownDir, 'security.txt'), [
  'Contact: mailto:security@desky.app',
  'Expires: 2027-09-01T00:00:00.000Z',
  'Preferred-Languages: en',
  'Canonical: https://desky.app/.well-known/security.txt',
  'Policy: https://desky.app/security',
  '',
].join('\n'), 'utf8');
