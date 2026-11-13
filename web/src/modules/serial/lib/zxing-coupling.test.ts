import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from 'barcode-detector/ponyfill';
import { expect, test } from 'vitest';

/**
 * Glue emscripten dibundel DI DALAM `barcode-detector`, sedangkan berkas `.wasm` diambil dari paket terpisah
 * `zxing-wasm`. Keduanya harus versi yang sama; kalau tidak, galat baru tampak saat runtime. Tes ini gagal bila
 * salah satu paket dinaikkan tanpa yang lain.
 */
const webPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const require = createRequire(join(process.cwd(), 'package.json'));
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

test('barcode-fallback mengimpor .wasm dari zxing-wasm/reader (bukan salinan atau URL lain)', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/modules/serial/lib/barcode-fallback.ts'),
    'utf8',
  );
  expect(source).toContain("from 'zxing-wasm/reader/zxing_reader.wasm?url'");
});
