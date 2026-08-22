import type { Configuration } from 'webpack';

import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';

export const rendererConfig: Configuration = {
  devtool: process.env.NODE_ENV === 'development' ? 'inline-source-map' : 'source-map',
  module: {
    rules: [
      ...rules,
      {
        test: /\.css$/,
        use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
      },
    ],
  },
  plugins,
  resolve: { extensions: ['.js', '.ts', '.tsx', '.json'] },
};
