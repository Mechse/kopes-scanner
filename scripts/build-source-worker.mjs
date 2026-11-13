import { build } from 'esbuild';
await build({ entryPoints: ['scripts/source-worker/main.ts'], outfile: '.source-worker/worker.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
