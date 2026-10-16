import jsQR from 'jsqr';
import { expect, test } from 'vitest';
import { qrMatrix } from './qr-matrix';

/** Merender matriks ke piksel RGBA (quiet zone 4 modul) untuk didecode jsQR. */
function pixels(matrix: boolean[][], scale = 6, quiet = 4, maskPercent = 0) {
  const n = matrix.length;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const mask = (maskPercent / 100) * n;
  const lo = (n - mask) / 2;
  const hi = (n + mask) / 2;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r]?.[c]) continue;
      if (maskPercent > 0 && r >= lo && r < hi && c >= lo && c < hi) continue; // logo menutupi tengah
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: size, height: size };
}

test('matriks persegi, minimal 21 modul, dan dapat dibaca kembali (link 300 karakter)', () => {
  const link = `https://contoh.com/${'a'.repeat(281)}`;
  const matrix = qrMatrix(link);
  expect(matrix.length).toBe(matrix[0]?.length);
  expect(matrix.length).toBeGreaterThanOrEqual(21);
  const { data, width, height } = pixels(matrix);
  expect(jsQR(data, width, height)?.data).toBe(link);
});

test('tetap terbaca dengan logo menutupi tengah (sisi 34% = logo 30% + latar 15%): koreksi galat H', () => {
  const link = 'https://contoh.com/panduan-instalasi';
  const { data, width, height } = pixels(qrMatrix(link), 6, 4, 34);
  expect(jsQR(data, width, height)?.data).toBe(link);
});
