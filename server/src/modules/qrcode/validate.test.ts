import { expect, test } from 'bun:test';
import { bytesOfBase64 } from '@server-test/bytes';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import {
  validateClonePreset,
  validateExportQrDesign,
  validateQrFile,
  validateSaveQrDesign,
  validateSaveQrPreset,
  validateUploadQrPdf,
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
  expect(validateSaveQrDesign(url)).toMatchObject({
    title: 'Panduan',
    link: 'https://contoh.com/a',
  });
  expect(
    validateSaveQrDesign({ ...url, id: 'q1', expectedUpdatedAt: '2026-10-16T00:00:00.000Z' }),
  ).toMatchObject({
    id: 'q1',
    expectedUpdatedAt: '2026-10-16T00:00:00.000Z',
  });
});

test('simpan: link wajib http(s) ≤ 300 untuk sumber url; sumber pdf wajib documentId dan mengabaikan link', () => {
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, link: 'ftp://x' })).link).toBeDefined();
  expect(
    fieldsOf(() => validateSaveQrDesign({ ...url, link: `https://a.co/${'x'.repeat(300)}` })).link,
  ).toContain('300');
  expect(
    fieldsOf(() => validateSaveQrDesign({ ...url, linkSource: 'pdf', link: '' })).documentId,
  ).toBeDefined();
  expect(
    validateSaveQrDesign({ ...url, linkSource: 'pdf', link: 'abaikan', documentId: 'd1' }),
  ).toMatchObject({
    linkSource: 'pdf',
    link: '',
    documentId: 'd1',
  });
});

test('simpan: batas teks, karakter yang tak didukung font, dan layout di luar rentang', () => {
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, title: '' })).title).toBeDefined();
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, title: 'x'.repeat(61) })).title).toContain(
    '60',
  );
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, subtitle: '中文' })).subtitle).toContain(
    'Karakter',
  );
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, footer: 'a\nb' })).footer).toContain(
    'Karakter',
  );
  expect(
    fieldsOf(() => validateSaveQrDesign({ ...url, layout: { ...DEFAULT_QR_LAYOUT, qrSize: 99 } }))
      .layout,
  ).toBeDefined();
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, layout: null })).layout).toBeDefined();
});

test('unggah PDF: nama, byte, tanda %PDF-, dan batas 10 MB', () => {
  const pdf = bytesOfBase64('JVBERi0xLjQK'); // "%PDF-1.4" + baris baru
  expect(validateUploadQrPdf({ name: 'a.pdf', bytes: pdf })).toEqual({ name: 'a.pdf', bytes: pdf });
  expect(
    fieldsOf(() => validateUploadQrPdf({ name: 'a.pdf', bytes: bytesOfBase64('QUJDRA==') })).bytes,
  ).toContain('PDF');
  expect(fieldsOf(() => validateUploadQrPdf({ name: '', bytes: pdf })).name).toBeDefined();
  expect(fieldsOf(() => validateUploadQrPdf({ name: 'a.pdf', bytes: '***' })).bytes).toBeDefined();
  expect(
    fieldsOf(() => validateUploadQrPdf({ name: 'a.pdf', bytes: new Uint8Array() })).bytes,
  ).toBeDefined();
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big.set(pdf);
  expect(fieldsOf(() => validateUploadQrPdf({ name: 'a.pdf', bytes: big })).bytes).toContain(
    '10 MB',
  );
});

test('ekspor dan unduh: tanda PDF/PNG, batas gabungan 8 MB, jenis berkas', () => {
  const pdf = bytesOfBase64('JVBERi0xLjQK');
  const png = bytesOfBase64('iVBORw0KGgoAAAANSUhEUg==');
  expect(validateExportQrDesign({ id: 'q', expectedUpdatedAt: 't', pdf, png })).toMatchObject({
    id: 'q',
  });
  expect(
    fieldsOf(() => validateExportQrDesign({ id: 'q', expectedUpdatedAt: 't', pdf: png, png })).pdf,
  ).toBeDefined();
  expect(
    fieldsOf(() => validateExportQrDesign({ id: 'q', expectedUpdatedAt: 't', pdf, png: pdf })).png,
  ).toBeDefined();
  expect(
    fieldsOf(() => validateExportQrDesign({ id: 'q', expectedUpdatedAt: '', pdf, png }))
      .expectedUpdatedAt,
  ).toBeDefined();
  const huge = new Uint8Array(8 * 1024 * 1024);
  huge.set(pdf);
  expect(
    fieldsOf(() => validateExportQrDesign({ id: 'q', expectedUpdatedAt: 't', pdf: huge, png })).pdf,
  ).toContain('8 MB');
  expect(validateQrFile({ id: 'q', kind: 'png' })).toEqual({ id: 'q', kind: 'png' });
  expect(fieldsOf(() => validateQrFile({ id: 'q', kind: 'zip' })).kind).toBeDefined();
});

const preset = {
  name: 'Standar',
  title: '',
  subtitle: '',
  footer: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: 'bu-a',
  namePlacement: 'title',
};

test('preset: BU dan penempatan nama wajib; penempatan hanya title, subtitle, footer', () => {
  expect(validateSaveQrPreset(preset)).toMatchObject({ buId: 'bu-a', namePlacement: 'title' });
  for (const placement of ['title', 'subtitle', 'footer'] as const) {
    expect(validateSaveQrPreset({ ...preset, namePlacement: placement }).namePlacement).toBe(
      placement,
    );
  }
  expect(
    fieldsOf(() => validateSaveQrPreset({ ...preset, namePlacement: 'logo' })).namePlacement,
  ).toBeDefined();
  expect(
    fieldsOf(() => validateSaveQrPreset({ ...preset, namePlacement: '' })).namePlacement,
  ).toBeDefined();
  expect(fieldsOf(() => validateSaveQrPreset({ ...preset, buId: '' })).buId).toBeDefined();
  const { buId: _buId, ...noBu } = preset;
  expect(fieldsOf(() => validateSaveQrPreset(noBu)).buId).toBeDefined();
});

test('kloning preset: id, BU, dan nama wajib; nama maks. 60', () => {
  expect(validateClonePreset({ id: 'p1', buId: 'bu-b', name: 'Salinan' })).toEqual({
    id: 'p1',
    buId: 'bu-b',
    name: 'Salinan',
  });
  expect(
    fieldsOf(() => validateClonePreset({ id: 'p1', buId: 'bu-b', name: ' ' })).name,
  ).toBeDefined();
  expect(fieldsOf(() => validateClonePreset({ id: 'p1', buId: '', name: 'S' })).buId).toBeDefined();
  expect(
    fieldsOf(() => validateClonePreset({ id: 'p1', buId: 'b', name: 'x'.repeat(61) })).name,
  ).toBeDefined();
});
