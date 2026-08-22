import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'production',
  target: 'node22',
  entry: resolve(root, 'src/tools/animation/cli.ts'),
  output: {
    path: resolve(root, 'out/tools'),
    filename: 'desky-animation-converter.cjs',
  },
  devtool: false,
  stats: 'errors-warnings',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            compilerOptions: { noEmit: false },
          },
        },
      },
    ],
  },
  optimization: { minimize: false },
  resolve: { extensions: ['.js', '.ts'] },
};
