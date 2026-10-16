import { expect, test } from 'bun:test';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, isRenderableLabelText, layoutLabel } from './qrcode';

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

test('frameTight: bingkai lebih dekat dari ~2 modul ke QR (quiet zone hilang) ditandai; jarak cukup tidak', () => {
  const tight = layoutLabel({ ...base, style: framed({ gap: 0.2 }) }, measure);
  expect(tight.frameTight).toBe(true);
  const roomy = layoutLabel({ ...base, style: framed({ gap: 2 }) }, measure);
  expect(roomy.frameTight).toBe(false);
  expect(layoutLabel({ ...base }, measure).frameTight).toBe(false);
});
