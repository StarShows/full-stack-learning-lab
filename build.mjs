import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/app.jsx'], bundle: true, minify: true,
  outfile: 'dist/app.js', target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'css' },
});
await build({
  entryPoints: ['src/runner.js'], bundle: true, minify: true,
  outfile: 'dist/runner.js', target: 'es2020',
  define: { 'process.env.NODE_ENV': '"development"' },
});
await copyFile('src/index.html', 'dist/index.html');
console.log('Built local application and isolated exercise runner.');
