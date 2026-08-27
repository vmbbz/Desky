import { isAbsolute, resolve } from 'node:path';

import type { MakerMSIXConfig } from '@electron-forge/maker-msix';
import type { SquirrelWindowsOptions } from 'electron-winstaller';

import type { ReleaseManifest } from './src/shared/release-manifest';

export type WindowsReleaseMode = 'development' | 'production';

export interface WindowsMakerPolicy {
  kind: 'msix' | 'squirrel';
  releaseMode: WindowsReleaseMode;
  msix?: MakerMSIXConfig;
  squirrel?: Omit<SquirrelWindowsOptions, 'appDirectory' | 'outputDirectory'>;
}

const developmentPublisher = 'CN=Desky Development';
const developmentPublisherDisplayName = 'Desky Development';
const developmentPackageIdentity = 'Desky.Companion.Development';

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  purpose: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for ${purpose}.`);
  }
  return value;
}

function resolveReleaseMode(environment: NodeJS.ProcessEnv): WindowsReleaseMode {
  const value = environment.DESKY_RELEASE_MODE ?? 'development';
  if (value !== 'development' && value !== 'production') {
    throw new Error(`Unknown DESKY_RELEASE_MODE: ${value}`);
  }
  return value;
}

function toMsixVersion(version: string): string {
  const segments = version.split('.');
  if (segments.length > 4 || segments.some((segment) => !/^\d+$/.test(segment))) {
    throw new Error(`Desky version ${version} cannot be represented as an MSIX version.`);
  }
  return [...segments, ...Array(4 - segments.length).fill('0')].join('.');
}

export function resolveWindowsMakerPolicy(
  releaseManifest: ReleaseManifest,
  version: string,
  environment: NodeJS.ProcessEnv = process.env,
): WindowsMakerPolicy {
  if (releaseManifest.targetPlatform !== 'win32') {
    throw new Error(`Windows makers cannot package ${releaseManifest.profileId}.`);
  }

  const releaseMode = resolveReleaseMode(environment);
  const windowsAssetRoot = resolve('branding', 'logo', 'platform', 'windows');
  const iconPath = resolve(windowsAssetRoot, 'desky.ico');

  if (releaseManifest.profileId === 'windows-store-free') {
    const production = releaseMode === 'production';
    const packageVersion = production
      ? toMsixVersion(version)
      : environment.DESKY_DEVELOPMENT_MSIX_VERSION?.trim() || toMsixVersion(version);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(packageVersion)) {
      throw new Error(`Development MSIX version ${packageVersion} is invalid.`);
    }
    const packageIdentity = production
      ? requiredEnvironment(environment, 'DESKY_STORE_PACKAGE_IDENTITY', 'the production Store MSIX')
      : developmentPackageIdentity;
    const publisher = production
      ? requiredEnvironment(environment, 'DESKY_STORE_PUBLISHER', 'the production Store MSIX')
      : developmentPublisher;
    const publisherDisplayName = production
      ? requiredEnvironment(environment, 'DESKY_STORE_PUBLISHER_DISPLAY_NAME', 'the production Store MSIX')
      : developmentPublisherDisplayName;

    if (!/^CN=.+/.test(publisher)) {
      throw new Error('DESKY_STORE_PUBLISHER must be the exact Partner Center subject beginning with CN=.');
    }

    return {
      kind: 'msix',
      releaseMode,
      msix: {
        packageAssets: windowsAssetRoot,
        // electron-windows-msix treats packageName as the complete filename;
        // omitting the extension makes its own SignTool input point at a
        // non-existent file.
        packageName: production ? 'Desky-Store.msix' : 'Desky-Store-Development.msix',
        createPri: true,
        // Partner Center applies the production Store signature. Development
        // packages use the maker's isolated self-signed certificate and the
        // lifecycle harness removes its trust/private-key material afterward.
        sign: !production,
        logLevel: 'warn',
        manifestVariables: {
          packageIdentity,
          publisher,
          publisherDisplayName,
          packageVersion,
          packageDisplayName: 'Desky',
          packageDescription: 'An expressive desktop companion for the AI agent you already use.',
          packageBackgroundColor: '#0A0E17',
          appExecutable: 'Desky.exe',
          appDisplayName: 'Desky',
          targetArch: 'x64',
          packageMinOSVersion: '10.0.19041.0',
          packageMaxOSVersionTested: '10.0.26100.0',
        },
      },
    };
  }

  if (releaseManifest.profileId !== 'windows-direct') {
    throw new Error(`No Windows maker is admitted for ${releaseManifest.profileId}.`);
  }

  const production = releaseMode === 'production';
  const publisherDisplayName = production
    ? requiredEnvironment(environment, 'DESKY_WINDOWS_PUBLISHER_DISPLAY_NAME', 'the signed website installer')
    : developmentPublisherDisplayName;
  const certificateFile = production
    ? requiredEnvironment(environment, 'DESKY_WINDOWS_CERTIFICATE_FILE', 'the signed website installer')
    : undefined;
  const certificatePassword = production
    ? requiredEnvironment(environment, 'DESKY_WINDOWS_CERTIFICATE_PASSWORD', 'the signed website installer')
    : undefined;

  if (certificateFile && !isAbsolute(certificateFile)) {
    throw new Error('DESKY_WINDOWS_CERTIFICATE_FILE must be an absolute path outside the repository.');
  }

  return {
    kind: 'squirrel',
    releaseMode,
    squirrel: {
      name: production ? 'desky' : 'desky_development',
      title: production ? 'Desky' : 'Desky Development',
      authors: publisherDisplayName,
      owners: publisherDisplayName,
      description: 'An expressive desktop companion for the AI agent you already use.',
      exe: 'Desky.exe',
      setupExe: production ? `Desky-${version}-Setup.exe` : `Desky-${version}-Development-Setup.exe`,
      setupIcon: iconPath,
      noMsi: true,
      noDelta: false,
      certificateFile,
      certificatePassword,
    },
  };
}
