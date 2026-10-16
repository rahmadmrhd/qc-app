import { expect, test } from 'bun:test';
import {
  clampQrStyle,
  DEFAULT_QR_LAYOUT,
  DEFAULT_QR_STYLE,
  frameDashPattern,
  isQrStyle,
  isRenderableLabelText,
  labelFileName,
  layoutLabel,
  QR_FRAME_LINES,
  qrContentHash,
} from './qrcode';

const measure = (text: string, sizePt: number) => text.length * sizePt * 0.2;
const base = {
  title: 'Panduan',
  subtitle: '',
  footer: '',
  hasLogo: false,
  layout: { ...DEFAULT_QR_LAYOUT, qrSize: 14 },
  qrModules: 33,
};
const framed = (patch: Record<string, number | string>) => ({
  ...DEFAULT_QR_STYLE,
  frame: { ...DEFAULT_QR_STYLE.frame, kind: 'corners' as const, ...patch },
});

test('glyph: hanya karakter yang ADA di keempat varian font Poppins latin yang diizinkan', () => {
  // ada di font
  for (const ok of ['Café © 2026', 'a–b', 'a—b', '‘x’ “y” „z”', '• …', '€ ™ −', 'ʼ', 'ı', 'Œœ']) {
    expect(isRenderableLabelText(ok)).toBe(true);
  }
  // tidak ada di font (hasil pemeriksaan cmap): tanda hubung tak-putus, belati, modifier ʻ, dsb.
  for (const bad of ['USW‑48', '†', '‡', 'ʻ', '‗', '‑', '‒', '―', '‥', '‧', '中', 'a\nb']) {
    expect(isRenderableLabelText(bad)).toBe(false);
  }
});

test('glyph: karakter yang menjadi di luar font setelah HURUF KAPITAL (µ, ÿ) ditolak; ß, ı aman', () => {
  expect(isRenderableLabelText('µm')).toBe(false);
  expect(isRenderableLabelText('ÿ')).toBe(false);
  expect(isRenderableLabelText('Straße')).toBe(true);
  expect(isRenderableLabelText('ı')).toBe(true);
});

test('bingkai membulat tidak pernah masuk ke area QR: radius dibatasi oleh jarak dan tebal', () => {
  // QR 14 mm, gap 0, tebal 0.5, radius 4 diminta: batas = (√2·d0 − t/2)/(√2 − 1), d0 = gap + t/2 = 0.25
  const out = layoutLabel(
    { ...base, style: framed({ gap: 0, thickness: 0.5, radius: 4 }) },
    measure,
  );
  const frame = out.elements.find((e) => e.kind === 'frame');
  if (frame?.kind !== 'frame') throw new Error('frame hilang');
  const d0 = 0 + 0.5 / 2;
  const limit = (Math.SQRT2 * d0 - 0.25) / (Math.SQRT2 - 1);
  expect(frame.radiusMm).toBeCloseTo(limit, 6);
  expect(frame.radiusMm).toBeLessThan(4);
  // jarak lebar: radius yang diminta tetap dipakai (tidak dibatasi)
  const roomy = layoutLabel(
    { ...base, style: framed({ gap: 2, thickness: 0.5, radius: 1.5 }) },
    measure,
  );
  const roomyFrame = roomy.elements.find((e) => e.kind === 'frame');
  expect(roomyFrame).toMatchObject({ radiusMm: 1.5 });
});

test('bingkai hasil pembatasan: titik terdekat goresan ke sudut QR tidak lebih dekat dari tepi dalam goresan', () => {
  const out = layoutLabel(
    { ...base, style: framed({ gap: 0.3, thickness: 0.6, radius: 4 }) },
    measure,
  );
  const frame = out.elements.find((e) => e.kind === 'frame');
  const qr = out.elements.find((e) => e.kind === 'qr');
  if (frame?.kind !== 'frame' || qr?.kind !== 'qr') throw new Error('elemen hilang');
  // pusat busur sudut kiri-atas dan sudut QR kiri-atas
  const r = frame.radiusMm;
  const cx = frame.xMm + r;
  const cy = frame.yMm + r;
  const distance = Math.hypot(qr.xMm - cx, qr.yMm - cy);
  // sudut QR harus berada di dalam lingkaran tepi dalam goresan (r − tebal/2), atau radius 0
  if (r > 1e-9) expect(distance).toBeLessThanOrEqual(r - frame.thicknessMm / 2 + 1e-9);
});

test('frameTight: jarak bingkai ke QR di bawah 0,5 mm ditandai; 0,5 mm ke atas tidak', () => {
  const tight = layoutLabel({ ...base, style: framed({ gap: 0.49 }) }, measure);
  expect(tight.frameTight).toBe(true);
  const edge = layoutLabel({ ...base, style: framed({ gap: 0.5 }) }, measure);
  expect(edge.frameTight).toBe(false);
  const roomy = layoutLabel({ ...base, style: framed({ gap: 2 }) }, measure);
  expect(roomy.frameTight).toBe(false);
  expect(layoutLabel({ ...base }, measure).frameTight).toBe(false);
});

test('gaya garis bingkai: solid, putus-putus, titik-titik; bawaan solid; nilai tak dikenal dipulihkan ke solid', () => {
  expect(QR_FRAME_LINES).toEqual(['solid', 'dashed', 'dotted']);
  expect(DEFAULT_QR_STYLE.frame.line).toBe('solid');
  expect(
    isQrStyle({ ...DEFAULT_QR_STYLE, frame: { ...DEFAULT_QR_STYLE.frame, line: 'dashed' } }),
  ).toBe(true);
  expect(
    isQrStyle({ ...DEFAULT_QR_STYLE, frame: { ...DEFAULT_QR_STYLE.frame, line: 'zigzag' } }),
  ).toBe(false);
  const { line: _omit, ...withoutLine } = DEFAULT_QR_STYLE.frame;
  expect(isQrStyle({ ...DEFAULT_QR_STYLE, frame: withoutLine })).toBe(false);
  // data tersimpan lama tanpa "line" tetap terbaca (bawaan solid)
  expect(clampQrStyle({ frame: { kind: 'box', thickness: 0.5 } }).frame.line).toBe('solid');
  expect(clampQrStyle({ frame: { line: 'zigzag' } }).frame.line).toBe('solid');
  expect(clampQrStyle({ frame: { line: 'dotted' } }).frame.line).toBe('dotted');
});

test('elemen bingkai membawa gaya garis; pola putus-putus mengikuti tebal garis; hash ikut berubah', () => {
  const dashed = framed({ kind: 'box', line: 'dashed', thickness: 0.4 });
  const el = layoutLabel({ ...base, style: dashed }, measure).elements.find(
    (e) => e.kind === 'frame',
  );
  expect(el).toMatchObject({ line: 'dashed' });
  expect(frameDashPattern('solid', 0.4)).toEqual([]);
  const dash = frameDashPattern('dashed', 0.4);
  expect(dash).toHaveLength(2);
  expect(dash[0]).toBeGreaterThan(dash[1] as number); // garis lebih panjang daripada celah
  const dot = frameDashPattern('dotted', 0.4);
  expect(dot[0]).toBeLessThan(0.05); // titik hampir nol panjangnya (digambar bulat oleh ujung garis)
  expect(dot[1]).toBeGreaterThan(0.4);
  const content = {
    linkSource: 'url' as const,
    link: 'https://a.co',
    title: 'T',
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
  };
  expect(qrContentHash({ ...content, style: framed({ kind: 'box', line: 'dashed' }) })).not.toBe(
    qrContentHash({ ...content, style: framed({ kind: 'box', line: 'solid' }) }),
  );
});

test('nama berkas dari title dan subtitle: huruf kecil, tanda hubung, dibatasi 60 karakter; subtitle kosong = hanya title', () => {
  expect(labelFileName('Panduan Instalasi', 'USW PRO MAX 48 PoE')).toBe(
    'panduan-instalasi-usw-pro-max-48-poe',
  );
  expect(labelFileName('Panduan Instalasi', '')).toBe('panduan-instalasi');
  expect(labelFileName('Café & Bar!', 'Édisi #2')).toBe('caf-bar-disi-2');
  expect(labelFileName('***', '???')).toBe('label');
  const long = labelFileName('a'.repeat(50), 'b'.repeat(50));
  expect(long.length).toBeLessThanOrEqual(60);
  expect(long.endsWith('-')).toBe(false);
});
