import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(process.env.DAYTRIP_TOOLCHAIN ? join(resolve(process.env.DAYTRIP_TOOLCHAIN), 'package.json') : import.meta.url);
const { build } = require('esbuild');
await build({ entryPoints: ['src/App.jsx'], bundle: true, minify: true, outfile: 'public/app.js', format: 'esm', target: ['es2022'], alias: { 'react': require.resolve('react'), 'react-dom/client': require.resolve('react-dom/client') }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
const sourcePath = resolve('src/App.jsx').replaceAll('\\', '/');
const cssPath = require.resolve('tailwindcss/index.css').replaceAll('\\', '/');
const css = (await readFile('src/styles.css', 'utf8')).replace('@import "tailwindcss";', `@import "${cssPath}";`).replace('@source "./App.jsx";', `@source "${sourcePath}";`);
const temporary = join(tmpdir(), `daytrip-tailwind-${process.pid}.css`);
try {
  await writeFile(temporary, css);
  const cli = join(dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
  const result = spawnSync(process.execPath, [cli, '-i', temporary, '-o', 'public/styles.css', '--minify'], { stdio: 'inherit' });
  if (result.status !== 0) throw Error('Tailwind build failed.');
} finally { await unlink(temporary); }
console.log('Built React and Tailwind into public/.');
