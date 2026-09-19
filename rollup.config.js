import { nodeResolve } from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import terser from '@rollup/plugin-terser';
import serve from 'rollup-plugin-serve';

const dev = process.env.ROLLUP_WATCH;

const serveOpts = {
  contentBase: ['./dist'],
  host: '0.0.0.0',
  port: 5000,
  allowCrossOrigin: true,
  headers: {
    'Access-Control-Allow-Origin': '*',
  },
};

const plugins = [
  nodeResolve(),
  esbuild({
    target: 'es2021',
    minify: false,
    tsconfig: './tsconfig.json',
  }),
  dev && serve(serveOpts),
  !dev && terser(),
].filter(Boolean);

const onwarn = (warning, warn) => {
  // Lit / decorators occasionally trip THIS_IS_UNDEFINED inside node_modules.
  if (warning.code === 'THIS_IS_UNDEFINED' && warning.id?.includes('/node_modules/')) {
    return;
  }
  warn(warning);
};

export default {
  input: 'src/weight-tracker-cr-card.ts',
  output: {
    file: 'dist/weight-tracker-cr-card.js',
    format: 'es',
    inlineDynamicImports: true,
    sourcemap: dev ? true : false,
  },
  plugins,
  onwarn,
};
