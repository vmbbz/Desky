import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerMSIX } from '@electron-forge/maker-msix';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { resolve } from 'node:path';

import packageMetadata from './package.json';
import { resolveBuildReleaseManifest } from './release.config';
import { resolveWindowsMakerPolicy } from './release.maker.config';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import { developmentRendererContentSecurityPolicy } from './src/shared/content-security-policy';

const claudeAdmissionResources = process.env.DESKY_CLAUDE_ADMISSION_PACKAGE === '1'
  ? [`node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${process.platform === 'win32' ? 'claude.exe' : 'claude'}`]
  : [];

const releaseManifest = resolveBuildReleaseManifest(process.env.DESKY_RELEASE_PROFILE, process.platform);
const windowsMakerPolicy = releaseManifest.targetPlatform === 'win32'
  ? resolveWindowsMakerPolicy(releaseManifest, packageMetadata.version)
  : undefined;

const makers: ForgeConfig['makers'] = process.platform === 'win32'
  ? windowsMakerPolicy?.kind === 'msix'
    ? [new MakerMSIX(windowsMakerPolicy.msix)]
    : [new MakerSquirrel(windowsMakerPolicy?.squirrel ?? {
        name: 'desky_development',
        authors: 'Desky Development',
        setupExe: `Desky-${packageMetadata.version}-Development-Setup.exe`,
        setupIcon: resolve('branding', 'logo', 'platform', 'windows', 'desky.ico'),
        noMsi: true,
      })]
  : [new MakerZIP({}, ['darwin'])];

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'com.desky.companion',
    appCategoryType: 'public.app-category.productivity',
    asar: true,
    executableName: 'Desky',
    extraResource: claudeAdmissionResources,
    icon: process.platform === 'win32'
      ? resolve('branding', 'logo', 'platform', 'windows', 'desky.ico')
      : undefined,
  },
  rebuildConfig: {},
  makers,
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      devContentSecurityPolicy: developmentRendererContentSecurityPolicy,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/index.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
            },
          },
        ],
      },
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};

export default config;
