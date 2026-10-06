import esbuild from 'esbuild'
import process from 'process'
import { builtinModules as builtins } from 'module'

const prod = process.argv[2] === 'production'

await esbuild.build({
  banner: { js: '/*\nTHIS IS A GENERATED/COMPILED FILE AND NOT MEANT TO BE EDITED.\n*/\n' },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtins],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  minify: prod,
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
})
