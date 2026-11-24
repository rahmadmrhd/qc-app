// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, QR_LIMITS } from '@shared/qrcode';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const font = (name: string) =>
  readFileSync(require.resolve(`@fontsource/poppins/files/${name}.woff`));

vi.mock('./fonts', () => ({
  LABEL_FONT_FAMILY: 'QRLabelPoppins',
  loadLabelFonts: async () => ({
    regular: font('poppins-latin-400-normal'),
    bold: font('poppins-latin-600-normal'),
    italic: font('poppins-latin-400-italic'),
    boldItalic: font('poppins-latin-600-italic'),
  }),
  registerCanvasFonts: async () => undefined,
}));

import { renderExportFiles } from './export-files';

const base64ToBytes = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

// PNG 1×1 sah (dipakai sebagai "hasil canvas" dan sebagai logo yang disematkan ke PDF).
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Call = [string, ...unknown[]];
let calls: Call[];
let bitmapBlobs: Blob[];
/** Jumlah `ImageBitmap` logo yang sudah ditutup (`close()`). */
let bitmapsClosed = 0;
/** Bila > 0, `toBlob` panggilan KEDUA dst. (gambar contoh; yang pertama = PNG label) menghasilkan blob sebesar ini. */
let oversizeAfterFirst = 0;
let blobCalls = 0;

function fakeContext() {
  return new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 50 });
      if (key in target) return target[key];
      return (...args: unknown[]) => calls.push([key, ...args]);
    },
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
}

beforeEach(() => {
  calls = [];
  bitmapBlobs = [];
  bitmapsClosed = 0;
  oversizeAfterFirst = 0;
  blobCalls = 0;
  const pixel = base64ToBytes(PIXEL_PNG);
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => fakeContext(),
      toBlob: (done: (blob: Blob) => void) => {
        blobCalls += 1;
        done(
          oversizeAfterFirst > 0 && blobCalls > 1
            ? new Blob([new Uint8Array(oversizeAfterFirst)], { type: 'image/png' })
            : new Blob([pixel], { type: 'image/png' }),
        );
      },
    }),
  });
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    bitmapBlobs.push(blob);
    return {
      width: 120,
      height: 40,
      close: () => {
        bitmapsClosed += 1;
      },
    };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const design = {
  title: 'Panduan Instalasi',
  subtitle: 'USW PRO MAX 48 PoE',
  footer: 'www.contoh.com',
  link: 'https://contoh.com/panduan',
  layout: { ...DEFAULT_QR_LAYOUT, qrSize: 14 },
  style: DEFAULT_QR_STYLE,
};

test('isi melebihi kanvas: menolak dengan pesan jelas sebelum membuat berkas apa pun', async () => {
  await expect(renderExportFiles({ ...design, title: 'x'.repeat(60) }, null)).rejects.toThrow(
    'melebihi kanvas',
  );
  expect(calls.some((c) => c[0] === 'drawImage')).toBe(false);
});

test('tanpa logo: PDF 1 halaman dan PNG ber-pHYs; logo tidak didekode', async () => {
  const out = await renderExportFiles(design, null);
  expect([...out.pdf.slice(0, 5)]).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
  expect((await PDFDocument.load(out.pdf)).getPageCount()).toBe(1);
  const png = out.png;
  expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(Buffer.from(png).includes(Buffer.from('pHYs'))).toBe(true);
  expect(bitmapBlobs).toHaveLength(0);
  // gambar contoh stiker: PNG sah dari kanvas yang sama, tanpa pHYs 600 dpi, di bawah batas server
  expect([...out.preview.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(out.preview.length).toBeGreaterThan(0);
  expect(out.preview.length).toBeLessThanOrEqual(QR_LIMITS.previewMaxBytes);
});

test('dengan logo WebP: didekode dari tipe aslinya, digambar ke PNG, dan disematkan ke PDF sebagai PNG', async () => {
  const webp = new Uint8Array(Buffer.from('RIFFxxxxWEBPVP8 ')); // isi tak didekode: bitmap dipalsukan
  const out = await renderExportFiles(design, { mime: 'image/webp', bytes: webp });
  expect(bitmapBlobs).toHaveLength(1);
  expect(bitmapBlobs[0]?.type).toBe('image/webp');
  // Bitmap logo dilepas segera setelah dipakai (ekspor massal tak menumpuknya).
  expect(bitmapsClosed).toBe(1);
  // logo digambar ke label PNG (latar putih + gambar) lewat canvas
  expect(calls.some((c) => c[0] === 'drawImage')).toBe(true);
  const doc = await PDFDocument.load(out.pdf);
  expect(doc.getPageCount()).toBe(1);
  expect(out.pdf.length).toBeGreaterThan(1000);
});

test('gambar contoh tetap melebihi batas server setelah sisi terkecil: galat jelas, bukan byte kebesaran', async () => {
  oversizeAfterFirst = QR_LIMITS.previewMaxBytes + 1;
  await expect(renderExportFiles(design, null)).rejects.toThrow(/gambar contoh/i);
});

test('bitmap logo tetap ditutup bila ekspor gagal di tengah jalan (isi melebihi kanvas)', async () => {
  const webp = new Uint8Array(Buffer.from('RIFFxxxxWEBPVP8 '));
  await expect(
    renderExportFiles({ ...design, title: 'x'.repeat(60) }, { mime: 'image/webp', bytes: webp }),
  ).rejects.toThrow('melebihi kanvas');
  expect(bitmapBlobs).toHaveLength(1);
  expect(bitmapsClosed).toBe(1);
});
