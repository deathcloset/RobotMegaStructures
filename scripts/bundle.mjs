// Bundles a Node package (server or bot) into a single self-contained ESM file
// for a dead-simple single-box deploy: `node dist/index.js`, no node_modules.
//
//   node scripts/bundle.mjs <server|bot>
//
// `ws` is bundled; its optional native accelerators (bufferutil, utf-8-validate)
// are left external so the build stays clean — ws falls back to its JS impl.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const target = process.argv[2];
if (target !== 'server' && target !== 'bot') {
  console.error('usage: node scripts/bundle.mjs <server|bot>');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = resolve(root, 'packages', target);

await build({
  entryPoints: [resolve(pkgDir, 'src/index.ts')],
  outfile: resolve(pkgDir, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

console.log(`bundled ${target} -> packages/${target}/dist/index.js`);
