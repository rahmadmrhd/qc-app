// Bundel proses utama (dan preload bila ada) ke desktop/dist dengan Bun.build; `--spike` hanya
// membundel harness spike perangkat nyata ke desktop/dist/spike.
// Paket yang tidak boleh dibundel dibiarkan external dan dibawa electron-builder dari node_modules.

import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveUiPublicKey } from './ui-public-key';

const root = fileURLToPath(new URL('..', import.meta.url));
const external = ['electron', 'ssh2', 'node:sqlite'];

const spikeOnly = process.argv.includes('--spike');
// Kunci publik tanda tangan UI disuntikkan dari env `UI_PUBLIC_KEY_PEM` (bukan ditulis di source). `--require-ui-key`
// (skrip `dist`, build rilis) menggagalkan build bila kosong: tanpa kunci pembaruan UI mati diam-diam.
function resolveKeyOrExit(): ReturnType<typeof resolveUiPublicKey> {
  try {
    return resolveUiPublicKey(process.env, process.argv.includes('--require-ui-key'));
  } catch (error) {
    // Pesan sudah generik (tanpa isi kunci); tanpa stack trace agar log CI mudah dibaca.
    console.error(`build desktop gagal: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
const uiKey = resolveKeyOrExit();
if (!spikeOnly) {
  console.log(
    uiKey.fingerprint
      ? `kunci publik tanda tangan UI ditanam (sidik SHA-256: ${uiKey.fingerprint})`
      : 'UI_PUBLIC_KEY_PEM kosong: kunci publik tidak ditanam, pembaruan UI desktop nonaktif (UI dasar saja)',
  );
}
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
    // `typeof __UI_PUBLIC_KEY_PEM__` di src/main/ui/public-key.ts menjadi literal; tanpa kunci = tak didefinisikan.
    define: { __UI_PUBLIC_KEY_PEM__: JSON.stringify(uiKey.pem) },
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
