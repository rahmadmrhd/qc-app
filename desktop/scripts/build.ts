// Bundel proses utama (dan preload bila ada) ke desktop/dist dengan Bun.build; `--spike` hanya
// membundel harness spike perangkat nyata ke desktop/dist/spike.
// Paket yang tidak boleh dibundel dibiarkan external dan dibawa electron-builder dari node_modules.

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const external = ['electron', 'ssh2', 'node:sqlite'];

const spikeOnly = process.argv.includes('--spike');
if (!spikeOnly) await rm(`${root}dist`, { recursive: true, force: true });

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

if (spikeOnly) {
  // Harness spike perangkat nyata: dijalankan dengan Node (runtime yang sama dengan Electron),
  // bukan Bun, supaya perilaku ssh2 mewakili aplikasi. Tidak ikut dikemas (electron-builder).
  await bundle('spike/hardware-spike.ts', 'dist/spike', 'esm');
} else {
  // Proses utama: ESM (package.json "type": "module").
  await bundle('src/main/index.ts', 'dist/main', 'esm');
  // Preload harus CommonJS agar dapat berjalan di renderer ter-sandbox; ada sejak Task 14.
  if (existsSync(`${root}src/preload/index.ts`)) {
    await bundle('src/preload/index.ts', 'dist/preload', 'cjs', '[dir]/[name].cjs');
  }
}
