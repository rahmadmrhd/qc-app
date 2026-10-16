import { expect, test } from 'bun:test';
import {
  clampQrLayout,
  clampQrStyle,
  DEFAULT_QR_LAYOUT,
  DEFAULT_QR_STYLE,
  driveShareUrl,
  framePolylines,
  isHttpUrl,
  isQrLayout,
  isQrStyle,
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
    style: DEFAULT_QR_STYLE,
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

// --- gaya teks dan bingkai QR ---
const plain = { bold: false, italic: false, underline: false, strike: false, uppercase: false };

test('gaya bawaan: hanya title tebal; subtitle/footer polos; bingkai mati', () => {
  expect(DEFAULT_QR_STYLE.title).toEqual({ ...plain, bold: true });
  expect(DEFAULT_QR_STYLE.subtitle).toEqual(plain);
  expect(DEFAULT_QR_STYLE.footer).toEqual(plain);
  expect(DEFAULT_QR_STYLE.frame.kind).toBe('none');
  expect(isQrStyle(DEFAULT_QR_STYLE)).toBe(true);
});

test('isQrStyle/clampQrStyle: struktur salah ditolak; nilai tersimpan dipulihkan dan dijepit', () => {
  expect(isQrStyle(null)).toBe(false);
  expect(isQrStyle({ ...DEFAULT_QR_STYLE, title: { ...plain, bold: 'ya' } })).toBe(false);
  expect(
    isQrStyle({ ...DEFAULT_QR_STYLE, frame: { ...DEFAULT_QR_STYLE.frame, kind: 'bulat' } }),
  ).toBe(false);
  expect(
    isQrStyle({ ...DEFAULT_QR_STYLE, frame: { ...DEFAULT_QR_STYLE.frame, thickness: 99 } }),
  ).toBe(false);
  expect(clampQrStyle(null)).toEqual(DEFAULT_QR_STYLE);
  expect(clampQrStyle('rusak')).toEqual(DEFAULT_QR_STYLE);
  const restored = clampQrStyle({
    title: { italic: true, bold: 'x' },
    frame: { kind: 'corners', thickness: 99, gap: -3, radius: 'a', arm: 5, line: 'dashed' },
  });
  expect(restored.title).toEqual({ ...DEFAULT_QR_STYLE.title, italic: true });
  expect(restored.frame).toEqual({
    kind: 'corners',
    thickness: 1.5,
    gap: 0,
    radius: DEFAULT_QR_STYLE.frame.radius,
    arm: 10,
    line: 'dashed',
  });
  expect(clampQrStyle({ frame: { kind: 'aneh' } }).frame.kind).toBe('none');
});

test('gaya teks diteruskan ke tiap baris teks; uppercase mengubah teks sebelum diukur', () => {
  const style = {
    ...DEFAULT_QR_STYLE,
    title: { bold: false, italic: true, underline: true, strike: false, uppercase: true },
    footer: { ...plain, strike: true },
  };
  const widths: string[] = [];
  const spy = (text: string, size: number) => {
    widths.push(text);
    return text.length * size * 0.2;
  };
  const out = layoutLabel({ ...base, style }, spy);
  const title = out.elements.find((e) => e.kind === 'text' && e.role === 'title');
  const sub = out.elements.find((e) => e.kind === 'text' && e.role === 'subtitle');
  const foot = out.elements.find((e) => e.kind === 'text' && e.role === 'footer');
  if (title?.kind !== 'text' || sub?.kind !== 'text' || foot?.kind !== 'text')
    throw new Error('teks hilang');
  expect(title).toMatchObject({
    text: 'PANDUAN INSTALASI',
    bold: false,
    italic: true,
    underline: true,
    strike: false,
  });
  expect(sub).toMatchObject({
    text: 'USW PRO MAX 48 PoE',
    bold: false,
    italic: false,
    underline: false,
  });
  expect(foot).toMatchObject({ strike: true, underline: false });
  expect(widths).toContain('PANDUAN INSTALASI');
});

test('tanpa style: perilaku lama (title tebal, lainnya polos, tanpa bingkai)', () => {
  const out = layoutLabel(base, measure);
  const title = out.elements.find((e) => e.kind === 'text' && e.role === 'title');
  expect(title).toMatchObject({ bold: true, italic: false });
  expect(out.elements.some((e) => e.kind === 'frame')).toBe(false);
});

test('bingkai QR: ada elemen frame mengelilingi QR; ruang yang dipakai ikut dihitung (overflow bila tak muat)', () => {
  const framed = {
    ...DEFAULT_QR_STYLE,
    frame: {
      kind: 'corners' as const,
      line: 'solid' as const,
      thickness: 0.5,
      gap: 1,
      radius: 1.5,
      arm: 25,
    },
  };
  const compact = { ...base, subtitle: '', footer: '', style: framed };
  const out = layoutLabel(compact, measure);
  const qr = out.elements.find((e) => e.kind === 'qr');
  const frame = out.elements.find((e) => e.kind === 'frame');
  if (qr?.kind !== 'qr' || frame?.kind !== 'frame') throw new Error('qr/frame hilang');
  expect(frame.variant).toBe('corners');
  // sisi garis tengah = QR + 2 × jarak + tebal; terpusat pada QR
  expect(frame.sideMm).toBeCloseTo(qr.sizeMm + 2 * 1 + 0.5, 6);
  expect(frame.xMm + frame.sideMm / 2).toBeCloseTo(qr.xMm + qr.sizeMm / 2, 6);
  expect(frame.yMm + frame.sideMm / 2).toBeCloseTo(qr.yMm + qr.sizeMm / 2, 6);
  expect(out.overflow).toBe(false);
  // title + subtitle + footer + QR 17 + bingkai (≈3 mm) tidak muat di 30 mm
  expect(layoutLabel({ ...base, style: framed }, measure).overflow).toBe(true);
  // bingkai lebih lebar dari kanvas → overflow
  expect(
    layoutLabel({ ...compact, layout: { ...DEFAULT_QR_LAYOUT, qrSize: 26, padding: 0 } }, measure)
      .overflow,
  ).toBe(true);
});

test('framePolylines: corners = 4 siku dalam batas bingkai; box = 1 jalur tertutup; radius 0 = siku tajam', () => {
  const el = {
    kind: 'frame' as const,
    variant: 'corners' as const,
    line: 'solid' as const,
    xMm: 5,
    yMm: 5,
    sideMm: 20,
    thicknessMm: 0.5,
    radiusMm: 0,
    armMm: 5,
  };
  const sharp = framePolylines(el);
  expect(sharp).toHaveLength(4);
  expect(sharp[0]).toEqual([
    { x: 10, y: 5 },
    { x: 5, y: 5 },
    { x: 5, y: 10 },
  ]);
  const rounded = framePolylines({ ...el, radiusMm: 2 });
  expect(rounded).toHaveLength(4);
  for (const line of rounded) {
    expect(line.length).toBeGreaterThan(3);
    for (const p of line) {
      expect(p.x).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(25 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(25 + 1e-9);
    }
  }
  const box = framePolylines({ ...el, variant: 'box', radiusMm: 2 });
  expect(box).toHaveLength(1);
  expect(box[0]?.[0]).toEqual(box[0]?.at(-1));
});

test('hash isi berubah bila gaya teks atau bingkai berubah', () => {
  const content = {
    linkSource: 'url' as const,
    link: 'https://a.co',
    title: 'T',
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
  };
  const hash = qrContentHash(content);
  expect(
    qrContentHash({
      ...content,
      style: { ...DEFAULT_QR_STYLE, footer: { ...plain, italic: true } },
    }),
  ).not.toBe(hash);
  expect(
    qrContentHash({
      ...content,
      style: { ...DEFAULT_QR_STYLE, frame: { ...DEFAULT_QR_STYLE.frame, kind: 'box' } },
    }),
  ).not.toBe(hash);
  expect(qrContentHash({ ...content })).toBe(hash);
});

test('tiap baris teks membawa lebar terukur (untuk garis bawah/coret yang identik di semua keluaran)', () => {
  const out = layoutLabel(base, measure);
  for (const el of out.elements) {
    if (el.kind !== 'text') continue;
    expect(el.widthMm).toBeCloseTo(measure(el.text, el.sizePt), 6);
  }
});
