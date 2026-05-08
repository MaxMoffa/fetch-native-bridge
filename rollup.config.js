import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const tsPlugin = () =>
  typescript({
    tsconfig: './tsconfig.build.json',
    declaration: false,
  });

const entries = [
  { input: 'src/web/index.ts', dir: 'dist/web' },
  { input: 'src/native/index.ts', dir: 'dist/native' },
];

/** @type {import('rollup').RollupOptions[]} */
const config = entries.flatMap(({ input, dir }) => [
  {
    input,
    output: { file: `${dir}/index.mjs`, format: 'esm', sourcemap: true },
    plugins: [resolve(), tsPlugin()],
  },
  {
    input,
    output: { file: `${dir}/index.cjs`, format: 'cjs', sourcemap: true },
    plugins: [resolve(), tsPlugin()],
  },
  {
    input,
    output: { file: `${dir}/index.d.ts`, format: 'esm' },
    plugins: [dts()],
  },
]);

export default config;
