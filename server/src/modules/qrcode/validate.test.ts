import { expect, test } from 'bun:test';
import { bytesOfBase64 } from '@server-test/bytes';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import {
  validateClonePreset,
  validateExportQrDesign,
  validateListQrItemOptions,
  validateQrFile,
  validateSaveQrDesign,
  validateSaveQrPreset,
  validateUploadQrPdf,
} from './validate';

const url = {
  name: 'Panduan',
  presetId: '',
  itemIds: ['i1'],
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

test('simpan: nama maks. 60, itemIds berupa daftar id unik maks. 100, presetId opsional', () => {
  expect(validateSaveQrDesign({ ...url, itemIds: ['a', 'b', 'a'] }).itemIds).toEqual(['a', 'b']);
  expect(validateSaveQrDesign({ ...url, itemIds: [] }).itemIds).toEqual([]);
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, name: 'x'.repeat(61) })).name).toBeDefined();
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, name: '😀' })).name).toBeDefined();
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, itemIds: 'a' })).itemIds).toBeDefined();
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, itemIds: [''] })).itemIds).toBeDefined();
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, itemIds: [1] })).itemIds).toBeDefined();
  const many = Array.from({ length: 101 }, (_, i) => `i${i}`);
  expect(fieldsOf(() => validateSaveQrDesign({ ...url, itemIds: many })).itemIds).toContain('100');
  const { itemIds: _omit, ...noItems } = url;
  expect(fieldsOf(() => validateSaveQrDesign(noItems)).itemIds).toBeDefined();
  expect(validateSaveQrDesign({ ...url, presetId: 'p1' }).presetId).toBe('p1');
});

test('opsi item: input boleh kosong; limit 1-50 bulat; kursor tak boleh kosong', () => {
  expect(validateListQrItemOptions(null)).toEqual({});
  expect(validateListQrItemOptions({ query: ' a7 ', limit: 5, cursor: 'k' })).toEqual({
    query: 'a7',
    limit: 5,
    cursor: 'k',
  });
  expect(fieldsOf(() => validateListQrItemOptions({ limit: 0 })).limit).toBeDefined();
  expect(fieldsOf(() => validateListQrItemOptions({ limit: 51 })).limit).toBeDefined();
  expect(fieldsOf(() => validateListQrItemOptions({ limit: 1.5 })).limit).toBeDefined();
  expect(fieldsOf(() => validateListQrItemOptions({ cursor: '' })).cursor).toBeDefined();
});

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2]);
const exportRaw = {
  id: 'q1',
  expectedUpdatedAt: '2026-11-10T00:00:00.000Z',
  pdf: PDF_BYTES,
  png: PNG_BYTES,
};

test('ekspor: preview opsional (kosong bila tak ada), harus PNG sah dan maks. 512 KB; reason maks. 500', () => {
  expect(validateExportQrDesign(exportRaw)).toMatchObject({ reason: '' });
  expect(validateExportQrDesign(exportRaw).preview).toHaveLength(0);
  expect(
    validateExportQrDesign({ ...exportRaw, preview: PNG_BYTES, reason: ' Logo ' }),
  ).toMatchObject({
    reason: 'Logo',
  });
  expect(
    fieldsOf(() => validateExportQrDesign({ ...exportRaw, preview: new Uint8Array([1, 2, 3]) }))
      .preview,
  ).toBeDefined();
  expect(
    fieldsOf(() => validateExportQrDesign({ ...exportRaw, preview: 'x' })).preview,
  ).toBeDefined();
  const big = new Uint8Array(512 * 1024 + 1);
  big.set(PNG_BYTES, 0);
  expect(fieldsOf(() => validateExportQrDesign({ ...exportRaw, preview: big })).preview).toContain(
    '512',
  );
  expect(
    fieldsOf(() => validateExportQrDesign({ ...exportRaw, reason: 'x'.repeat(501) })).reason,
  ).toBeDefined();
});
