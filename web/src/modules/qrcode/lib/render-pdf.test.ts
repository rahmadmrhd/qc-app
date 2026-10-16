// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, layoutLabel, PT_PER_MM } from '@shared/qrcode';
import { decodePDFRawStream, PDFDocument, PDFRawStream } from 'pdf-lib';
import { expect, test } from 'vitest';
import { qrMatrix } from './qr-matrix';
import { buildSheetPdf } from './render-pdf';

const require = createRequire(import.meta.url);
const font = (name: string) =>
  readFileSync(require.resolve(`@fontsource/poppins/files/${name}.woff`));
const fonts = {
  regular: font('poppins-latin-400-normal'),
  bold: font('poppins-latin-600-normal'),
  italic: font('poppins-latin-400-italic'),
  boldItalic: font('poppins-latin-600-italic'),
};

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

test('PDF dengan gaya miring, garis bawah/coret, dan bingkai: tetap 1 halaman kecil dan memuat font miring', async () => {
  const matrix = qrMatrix('https://contoh.com/gaya');
  const style = {
    title: { bold: true, italic: true, underline: true, strike: false, uppercase: true },
    subtitle: { bold: false, italic: true, underline: false, strike: true, uppercase: false },
    footer: { bold: false, italic: false, underline: false, strike: false, uppercase: false },
    frame: { ...DEFAULT_QR_STYLE.frame, kind: 'corners' as const },
  };
  const layout = layoutLabel(
    {
      title: 'Panduan',
      subtitle: 'Sub',
      footer: '',
      hasLogo: false,
      layout: { ...DEFAULT_QR_LAYOUT, qrSize: 14 },
      style,
      qrModules: matrix.length,
    },
    (text, size) => text.length * size * 0.2,
  );
  expect(layout.overflow).toBe(false);
  const bytes = await buildSheetPdf(layout, matrix, null, fonts);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  expect(bytes.length).toBeLessThan(300_000);
  expect(Buffer.from(bytes).toString('latin1')).toContain('Italic');
});

test('daftar karakter yang diizinkan hanya memuat glyph yang ADA di keempat varian font (cmap)', async () => {
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const faces = [fonts.regular, fonts.bold, fonts.italic, fonts.boldItalic].map((bytes) =>
    fontkit.create(bytes),
  );
  const { isRenderableLabelText } = await import('@shared/qrcode');
  const missing: string[] = [];
  for (let code = 0x20; code <= 0x2300; code++) {
    const char = String.fromCodePoint(code);
    if (!isRenderableLabelText(char)) continue;
    // Bentuk HURUF KAPITAL juga harus ada di font.
    for (const shown of new Set([char, char.toUpperCase()])) {
      for (const face of faces) {
        for (const ch of shown) {
          if (!face.hasGlyphForCodePoint(ch.codePointAt(0) ?? 0))
            missing.push(`U+${code.toString(16)}`);
        }
      }
    }
  }
  expect([...new Set(missing)]).toEqual([]);
});

test('PDF: bingkai putus-putus memakai operator dash; solid tidak; keduanya tetap 1 halaman', async () => {
  const matrix = qrMatrix('https://contoh.com/garis');
  const make = async (line: 'solid' | 'dashed' | 'dotted') => {
    const style = {
      ...DEFAULT_QR_STYLE,
      frame: { ...DEFAULT_QR_STYLE.frame, kind: 'corners' as const, line },
    };
    const layout = layoutLabel(
      {
        title: '',
        subtitle: '',
        footer: '',
        hasLogo: false,
        layout: { ...DEFAULT_QR_LAYOUT, qrSize: 14 },
        style,
        qrModules: matrix.length,
      },
      (text, size) => text.length * size * 0.2,
    );
    const bytes = await buildSheetPdf(layout, matrix, null, fonts);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // Stream konten terkompresi: dekode dulu agar operator gambar (mis. dash "d") terlihat.
    let text = '';
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (object instanceof PDFRawStream) {
        text += `${Buffer.from(decodePDFRawStream(object).decode()).toString('latin1')}
`;
      }
    }
    return text;
  };
  const dashOperator = /\[[^\]]+\]\s+[0-9.]+\s+d\b/;
  expect(dashOperator.test(await make('solid'))).toBe(false);
  expect(dashOperator.test(await make('dashed'))).toBe(true);
  expect(dashOperator.test(await make('dotted'))).toBe(true);
});
