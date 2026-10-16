import { expect, test } from 'bun:test';
import { DEFAULT_QR_LAYOUT } from '@shared/qrcode';
import {
  validateExportQrDesign_,
  validateQrFile_,
  validateSaveQrDesign_,
  validateUploadQrPdf_,
} from './validate';

const url = {
  title: 'Panduan',
  linkSource: 'url',
  link: 'https://contoh.com/a',
  documentId: '',
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
};
const fieldsOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { fields?: Record<string, string> }).fields ?? {};
  }
  return {};
};

test('simpan: sumber url valid diterima; id dan expectedUpdatedAt opsional', () => {
  expect(validateSaveQrDesign_(url)).toMatchObject({
    title: 'Panduan',
    link: 'https://contoh.com/a',
  });
  expect(
    validateSaveQrDesign_({ ...url, id: 'q1', expectedUpdatedAt: '2026-10-16T00:00:00.000Z' }),
  ).toMatchObject({
    id: 'q1',
    expectedUpdatedAt: '2026-10-16T00:00:00.000Z',
  });
});

test('simpan: link wajib http(s) ≤ 300 untuk sumber url; sumber pdf wajib documentId dan mengabaikan link', () => {
  expect(fieldsOf(() => validateSaveQrDesign_({ ...url, link: 'ftp://x' })).link).toBeDefined();
  expect(
    fieldsOf(() => validateSaveQrDesign_({ ...url, link: `https://a.co/${'x'.repeat(300)}` })).link,
  ).toContain('300');
  expect(
    fieldsOf(() => validateSaveQrDesign_({ ...url, linkSource: 'pdf', link: '' })).documentId,
  ).toBeDefined();
  expect(
    validateSaveQrDesign_({ ...url, linkSource: 'pdf', link: 'abaikan', documentId: 'd1' }),
  ).toMatchObject({
    linkSource: 'pdf',
    link: '',
    documentId: 'd1',
  });
});

test('simpan: batas teks, karakter yang tak didukung font, dan layout di luar rentang', () => {
  expect(fieldsOf(() => validateSaveQrDesign_({ ...url, title: '' })).title).toBeDefined();
  expect(fieldsOf(() => validateSaveQrDesign_({ ...url, title: 'x'.repeat(61) })).title).toContain(
    '60',
  );
  expect(fieldsOf(() => validateSaveQrDesign_({ ...url, subtitle: '中文' })).subtitle).toContain(
    'Karakter',
  );
  expect(fieldsOf(() => validateSaveQrDesign_({ ...url, footer: 'a\nb' })).footer).toContain(
    'Karakter',
  );
  expect(
    fieldsOf(() => validateSaveQrDesign_({ ...url, layout: { ...DEFAULT_QR_LAYOUT, qrSize: 99 } }))
      .layout,
  ).toBeDefined();
  expect(fieldsOf(() => validateSaveQrDesign_({ ...url, layout: null })).layout).toBeDefined();
});

test('unggah PDF: nama, base64, tanda %PDF-, dan batas 10 MB', () => {
  const pdf = 'JVBERi0xLjQK'; // "%PDF-1.4\n"
  expect(validateUploadQrPdf_({ name: 'a.pdf', base64: pdf })).toEqual({
    name: 'a.pdf',
    base64: pdf,
  });
  expect(
    fieldsOf(() => validateUploadQrPdf_({ name: 'a.pdf', base64: 'QUJDRA==' })).base64,
  ).toContain('PDF');
  expect(fieldsOf(() => validateUploadQrPdf_({ name: '', base64: pdf })).name).toBeDefined();
  expect(
    fieldsOf(() => validateUploadQrPdf_({ name: 'a.pdf', base64: '***' })).base64,
  ).toBeDefined();
  const big = `JVBERi0${'A'.repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 8)}`;
  expect(
    fieldsOf(() =>
      validateUploadQrPdf_({ name: 'a.pdf', base64: big.slice(0, big.length - (big.length % 4)) }),
    ).base64,
  ).toContain('10 MB');
});

test('ekspor dan unduh: tanda PDF/PNG, batas gabungan 8 MB, jenis berkas', () => {
  const pdf = 'JVBERi0xLjQK';
  const png = 'iVBORw0KGgoAAAANSUhEUg==';
  expect(
    validateExportQrDesign_({ id: 'q', expectedUpdatedAt: 't', pdfBase64: pdf, pngBase64: png }),
  ).toMatchObject({ id: 'q' });
  expect(
    fieldsOf(() =>
      validateExportQrDesign_({ id: 'q', expectedUpdatedAt: 't', pdfBase64: png, pngBase64: png }),
    ).pdfBase64,
  ).toBeDefined();
  expect(
    fieldsOf(() =>
      validateExportQrDesign_({ id: 'q', expectedUpdatedAt: '', pdfBase64: pdf, pngBase64: png }),
    ).expectedUpdatedAt,
  ).toBeDefined();
  expect(validateQrFile_({ id: 'q', kind: 'png' })).toEqual({ id: 'q', kind: 'png' });
  expect(fieldsOf(() => validateQrFile_({ id: 'q', kind: 'zip' })).kind).toBeDefined();
});
