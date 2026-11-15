import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from 'barcode-detector/ponyfill';
import { expect, test } from 'vitest';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { ZXING_OVERRIDES } from './barcode-fallback';

/**
 * Glue emscripten dibundel DI DALAM `barcode-detector`, sedangkan berkas `.wasm` diambil dari paket terpisah
 * `zxing-wasm`. Keduanya harus versi yang sama; kalau tidak, galat baru tampak saat runtime. Tes ini gagal bila
 * salah satu paket dinaikkan tanpa yang lain.
 */
// Jalur diturunkan dari lokasi berkas tes ini (web/src/modules/serial/lib), bukan dari direktori kerja.
const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const webPackage = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const require = createRequire(join(webDir, 'package.json'));
const wasmFile = require.resolve('zxing-wasm/reader/zxing_reader.wasm');

test('zxing-wasm dipatok persis dan sama dengan versi yang dipakai glue barcode-detector', () => {
  const pinned = webPackage.dependencies['zxing-wasm'];
  expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  expect(webPackage.dependencies['barcode-detector']).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pinned).toBe(ZXING_WASM_VERSION);
  const installed = JSON.parse(
    readFileSync(join(dirname(wasmFile), '..', '..', 'package.json'), 'utf8'),
  ) as { version: string };
  expect(installed.version).toBe(ZXING_WASM_VERSION);
});

test('berkas .wasm berasal dari paket zxing-wasm dan hash-nya sama dengan yang diharapkan glue', () => {
  const file = wasmFile;
  expect(file.split(sep)).toContain('zxing-wasm');
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  expect(hash).toBe(ZXING_WASM_SHA256);
});

test('barcode-fallback menunjuk ke .wasm paket zxing-wasm/reader (bukan salinan atau URL lain)', () => {
  // Nilai ekspor, bukan teks sumber: URL yang dipakai pemuat harus sama dengan hasil impor `?url` dari paket yang dijaga
  // dua tes di atas; mengganti impor di barcode-fallback ke berkas lain membuat tes ini gagal.
  expect(ZXING_OVERRIDES.locateFile('zxing_reader.wasm', 'https://cdn.example/')).toBe(wasmUrl);
});
