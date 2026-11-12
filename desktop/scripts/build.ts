// Bundel proses utama (dan preload bila ada) ke desktop/dist dengan Bun.build.
// Paket yang tidak boleh dibundel dibiarkan external dan dibawa electron-builder dari node_modules.

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const external = ['electron', 'ssh2', 'node:sqlite'];

await rm(`${root}dist`, { recursive: true, force: true });

async function bundle(entry: string, outdir: string, format: 'esm' | 'cjs', naming?: string) {
  const result = await Bun.build({
    entrypoints: [`${root}${entry}`],
    outdir: `${root}${outdir}`,
    target: 'node',
    format,
    external,
    sourcemap: 'linked',
    minify: false,
    ...(naming ? { naming } : {}),
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  for (const output of result.outputs) {
    console.log(`${outdir}/${basename(output.path)} (${output.size} B)`);
  }
}

// Proses utama: ESM (package.json "type": "module").
await bundle('src/main/index.ts', 'dist/main', 'esm');
// Preload harus CommonJS agar dapat berjalan di renderer ter-sandbox; ada sejak Task 14.
if (existsSync(`${root}src/preload/index.ts`)) {
  await bundle('src/preload/index.ts', 'dist/preload', 'cjs', '[dir]/[name].cjs');
}
