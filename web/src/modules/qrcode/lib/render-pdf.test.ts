// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULT_QR_LAYOUT, layoutLabel, PT_PER_MM } from '@shared/qrcode';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from 'vitest';
import { qrMatrix } from './qr-matrix';
import { buildSheetPdf } from './render-pdf';

const require = createRequire(import.meta.url);
const font = (name: string) =>
  readFileSync(require.resolve(`@fontsource/poppins/files/${name}.woff`));
const fonts = { regular: font('poppins-latin-400-normal'), bold: font('poppins-latin-600-normal') };

test('PDF lembar: 1 halaman 300 × 420 mm, ukuran kecil karena label dipakai ulang 140 kali', async () => {
  const matrix = qrMatrix('https://contoh.com/panduan-instalasi-usw-pro-max-48-poe');
  const layout = layoutLabel(
    {
      title: 'Panduan Instalasi',
      subtitle: 'USW PRO MAX 48 PoE',
      footer: 'www.contoh.com',
      hasLogo: false,
      layout: DEFAULT_QR_LAYOUT,
      qrModules: matrix.length,
    },
    (text, size) => text.length * size * 0.2,
  );
  const bytes = await buildSheetPdf(layout, matrix, null, fonts);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  const { width, height } = doc.getPage(0).getSize();
  expect(width).toBeCloseTo(300 * PT_PER_MM, 2);
  expect(height).toBeCloseTo(420 * PT_PER_MM, 2);
  expect(bytes.length).toBeLessThan(300_000);
});
