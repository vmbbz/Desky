import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import webpack from 'webpack';

import { resolveBuildReleaseManifest } from './release.config';

export const activeBuildReleaseManifest = resolveBuildReleaseManifest(
  process.env.DESKY_RELEASE_PROFILE,
  process.platform,
);

export function createWebpackPlugins(): webpack.WebpackPluginInstance[] {
  const plugins: webpack.WebpackPluginInstance[] = [
    new ForkTsCheckerWebpackPlugin({ logger: 'webpack-infrastructure' }),
    new webpack.DefinePlugin({
      __DESKY_RELEASE_MANIFEST__: JSON.stringify(activeBuildReleaseManifest),
    }),
  ];
  if (activeBuildReleaseManifest.distributionProfile === 'store') {
    plugins.push(new webpack.NormalModuleReplacementPlugin(
      /profile-runtimes$/,
      (resource) => {
        resource.request = resource.request.replace(/profile-runtimes$/, 'profile-runtimes.store');
      },
    ));
  } else if (activeBuildReleaseManifest.packageClass === 'release-candidate') {
    plugins.push(new webpack.NormalModuleReplacementPlugin(
      /profile-runtimes$/,
      (resource) => {
        resource.request = resource.request.replace(
          /profile-runtimes$/,
          'profile-runtimes.release-direct',
        );
      },
    ));
  }
  return plugins;
}
