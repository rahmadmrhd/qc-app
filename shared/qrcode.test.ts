import { expect, test } from 'bun:test';
import {
  clampQrLayout,
  DEFAULT_QR_LAYOUT,
  driveShareUrl,
  isHttpUrl,
  isQrLayout,
  isRenderableLabelText,
  LABEL_MM,
  labelFileSlug,
  layoutLabel,
  qrContentHash,
  qrExportStatus,
  sheetCells,
} from './qrcode';

// Lebar teks tiruan: 0,2 mm per karakter per pt (deterministik).
const measure = (text: string, sizePt: number) => text.length * sizePt * 0.2;
const base = {
  title: 'Panduan Instalasi',
  subtitle: 'USW PRO MAX 48 PoE',
  footer: 'www.contoh.com',
  hasLogo: true,
  layout: DEFAULT_QR_LAYOUT,
  qrModules: 29,
};

test('tata letak bawaan: title, subtitle, QR di tengah ruang tersisa, footer di dasar; tidak overflow', () => {
  const out = layoutLabel(base, measure);
  expect(out.overflow).toBe(false);
  const roles = out.elements
    .filter((e) => e.kind === 'text')
    .map((e) => (e.kind === 'text' ? e.role : ''));
  expect(roles).toEqual(['title', 'subtitle', 'footer']);
  const qr = out.elements.find((e) => e.kind === 'qr');
  expect(qr).toMatchObject({ sizeMm: 17, xMm: 6.5 });
  const footer = out.elements.find((e) => e.kind === 'text' && e.role === 'footer');
  const title = out.elements.find((e) => e.kind === 'text' && e.role === 'title');
  if (qr?.kind !== 'qr' || footer?.kind !== 'text' || title?.kind !== 'text')
    throw new Error('elemen hilang');
  expect(title.baselineMm).toBeLessThan(qr.yMm);
  expect(qr.yMm + qr.sizeMm).toBeLessThan(footer.baselineMm);
  expect(footer.baselineMm).toBeLessThanOrEqual(LABEL_MM - DEFAULT_QR_LAYOUT.padding);
});

test('logo: ada hanya bila hasLogo, terpusat di QR, sisi terpanjang = persen sisi QR, latar putih lebih besar', () => {
  const withLogo = layoutLabel(base, measure).elements.find((e) => e.kind === 'logo');
  expect(withLogo).toMatchObject({ widthMm: 17 * 0.22, heightMm: 17 * 0.22 });
  if (withLogo?.kind !== 'logo') throw new Error('logo hilang');
  expect(withLogo.xMm + withLogo.widthMm / 2).toBeCloseTo(15, 5);
  expect(withLogo.backdropWidthMm).toBeGreaterThan(withLogo.widthMm);
  expect(withLogo.backdropHeightMm).toBeGreaterThan(withLogo.heightMm);
  expect(
    layoutLabel({ ...base, hasLogo: false }, measure).elements.some((e) => e.kind === 'logo'),
  ).toBe(false);
});

test('logo mengikuti rasio file: landscape lebar = persen sisi QR, portrait tinggi = persen sisi QR; tetap terpusat', () => {
  const find = (aspect: number) => {
    const logo = layoutLabel({ ...base, logoAspect: aspect }, measure).elements.find(
      (e) => e.kind === 'logo',
    );
    if (logo?.kind !== 'logo') throw new Error('logo hilang');
    return logo;
  };
  const wide = find(3);
  expect(wide.widthMm).toBeCloseTo(17 * 0.22, 6);
  expect(wide.heightMm).toBeCloseTo((17 * 0.22) / 3, 6);
  const tall = find(0.5);
  expect(tall.heightMm).toBeCloseTo(17 * 0.22, 6);
  expect(tall.widthMm).toBeCloseTo((17 * 0.22) / 2, 6);
  const qr = layoutLabel(base, measure).elements.find((e) => e.kind === 'qr');
  if (qr?.kind !== 'qr') throw new Error('qr hilang');
  for (const logo of [wide, tall]) {
    expect(logo.xMm + logo.widthMm / 2).toBeCloseTo(qr.xMm + qr.sizeMm / 2, 6);
    expect(logo.yMm + logo.heightMm / 2).toBeCloseTo(qr.yMm + qr.sizeMm / 2, 6);
  }
});

test('rasio logo tidak sah (0, negatif, NaN, Infinity) diperlakukan persegi', () => {
  for (const aspect of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const logo = layoutLabel({ ...base, logoAspect: aspect }, measure).elements.find(
      (e) => e.kind === 'logo',
    );
    expect(logo).toMatchObject({ widthMm: 17 * 0.22, heightMm: 17 * 0.22 });
  }
});

test('subtitle dan footer kosong dilewati; QR tetap terpusat vertikal', () => {
  const out = layoutLabel({ ...base, subtitle: '', footer: '' }, measure);
  expect(out.elements.filter((e) => e.kind === 'text')).toHaveLength(1);
  expect(out.overflow).toBe(false);
});

test('teks panjang dibungkus per kata; terlalu banyak baris → overflow', () => {
  const long = Array.from({ length: 40 }, () => 'kata').join(' ');
  const out = layoutLabel({ ...base, title: long }, measure);
  expect(out.overflow).toBe(true);
  const wrapped = layoutLabel({ ...base, title: 'Panduan Instalasi Perangkat Jaringan' }, measure);
  expect(
    wrapped.elements.filter((e) => e.kind === 'text' && e.role === 'title').length,
  ).toBeGreaterThan(1);
});

test('satu kata tanpa spasi yang lebih lebar dari kanvas → overflow', () => {
  const out = layoutLabel({ ...base, title: 'x'.repeat(60) }, measure);
  expect(out.overflow).toBe(true);
});

test('QR lebih besar dari ruang dalam → overflow', () => {
  const out = layoutLabel(
    { ...base, layout: { ...DEFAULT_QR_LAYOUT, qrSize: 26, padding: 5 } },
    measure,
  );
  expect(out.overflow).toBe(true);
});

test('QR terlalu padat: modul < 0,30 mm menandai tooDense (bukan overflow)', () => {
  const dense = layoutLabel({ ...base, qrModules: 97 }, measure);
  expect(dense.moduleMm).toBeCloseTo(17 / 97, 5);
  expect(dense.tooDense).toBe(true);
  expect(layoutLabel(base, measure).tooDense).toBe(false);
});

test('sheetCells: 10 × 14 = 140 sel 30 mm tanpa margin', () => {
  const cells = sheetCells();
  expect(cells).toHaveLength(140);
  expect(cells[0]).toEqual({ xMm: 0, yMm: 0 });
  expect(cells[139]).toEqual({ xMm: 270, yMm: 390 });
});

test('validasi: link http(s), layout dalam rentang, teks yang dapat dirender', () => {
  expect(isHttpUrl('https://a.co/x?y=1')).toBe(true);
  expect(isHttpUrl('http://a.co')).toBe(true);
  expect(isHttpUrl('ftp://a.co')).toBe(false);
  expect(isHttpUrl('https://a b')).toBe(false);
  expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  expect(isQrLayout(DEFAULT_QR_LAYOUT)).toBe(true);
  expect(isQrLayout({ ...DEFAULT_QR_LAYOUT, qrSize: 99 })).toBe(false);
  expect(isQrLayout({ ...DEFAULT_QR_LAYOUT, gap: Number.NaN })).toBe(false);
  expect(clampQrLayout({ qrSize: 99, titleSize: 'x' })).toEqual({
    ...DEFAULT_QR_LAYOUT,
    qrSize: 26,
  });
  expect(isRenderableLabelText('Café © 2026 — ok')).toBe(true);
  expect(isRenderableLabelText('中文')).toBe(false);
  expect(isRenderableLabelText('baris\nbaru')).toBe(false);
  expect(driveShareUrl('abc')).toBe('https://drive.google.com/file/d/abc/view');
  expect(labelFileSlug('Panduan Instalasi USW PRO!')).toBe('panduan-instalasi-usw-pro');
  expect(labelFileSlug('***')).toBe('label');
});

test('hash isi dan status ekspor: Belum / Sudah / Berubah', () => {
  const content = {
    linkSource: 'url' as const,
    link: 'https://a.co',
    title: 'T',
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
  };
  const hash = qrContentHash(content);
  expect(hash).toMatch(/^[0-9a-f]{8}$/);
  expect(qrExportStatus('', content)).toBe('none');
  expect(qrExportStatus(hash, content)).toBe('current');
  expect(qrExportStatus(hash, { ...content, title: 'T2' })).toBe('stale');
  expect(qrExportStatus(hash, { ...content, layout: { ...DEFAULT_QR_LAYOUT, gap: 2 } })).toBe(
    'stale',
  );
});
