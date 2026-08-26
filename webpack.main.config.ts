import type { Configuration } from 'webpack';

import { createWebpackPlugins } from './webpack.plugins';
import { rules } from './webpack.rules';

export const mainConfig: Configuration = {
  entry: './src/main/index.ts',
  module: { rules },
  plugins: createWebpackPlugins(),
  resolve: { extensions: ['.js', '.ts', '.json'] },
};
