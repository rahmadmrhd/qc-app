import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  C_CENTER,
  faviconSvg,
  PWA_ICON_SPECS,
  Q_CENTER,
  RING_OUTER,
  renderIconPng,
  renderIconRgba,
  STROKE,
} from './make-pwa-icons';
import { ROOT_DIR } from './paths';
import { readPngSize } from './png';

const BG = [0x0a, 0x0a, 0x0a];
const FG = [0xfa, 0xfa, 0xfa];

function pixel(rgba: Uint8Array, size: number, x: number, y: number): number[] {
  const offset = (y * size + x) * 4;
  return [
    rgba[offset] ?? -1,
    rgba[offset + 1] ?? -1,
    rgba[offset + 2] ?? -1,
    rgba[offset + 3] ?? -1,
  ];
}

/** Dekoder PNG minimal (hanya filter 0, yang ditulis enkoder kita) untuk uji putar-balik. */
function decodePng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const size = readPngSize(bytes);
  if (!size) throw new Error('bukan PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let at = 8;
  while (at < bytes.byteLength) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = size.width * 4 + 1;
  const rgba = new Uint8Array(size.width * size.height * 4);
  for (let y = 0; y < size.height; y++) {
    expect(raw[y * stride]).toBe(0);
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * size.width * 4);
  }
  return { ...size, rgba };
}

test('readPngSize membaca ukuran keluaran renderIconPng dan menolak byte acak', () => {
  expect(readPngSize(renderIconPng(192, 'any'))).toEqual({ width: 192, height: 192 });
  expect(readPngSize(Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 251))).toBeNull();
  expect(readPngSize(new Uint8Array(3))).toBeNull();
});

test('enkoder PNG: dekode ulang menghasilkan raster yang sama', () => {
  const rgba = renderIconRgba(64, 'any');
  const decoded = decodePng(renderIconPng(64, 'any'));
  expect(decoded.width).toBe(64);
  expect(Buffer.from(decoded.rgba).equals(Buffer.from(rgba))).toBe(true);
});

test('maskable: latar penuh dan semua piksel di luar lingkaran 0.4 berwarna latar yang sama', () => {
  const size = 192;
  const rgba = renderIconRgba(size, 'maskable');
  expect(pixel(rgba, size, 0, 0)).toEqual([...BG, 255]);
  let glyphPixels = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const outside = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) >= 0.4 * size;
      const p = pixel(rgba, size, x, y);
      expect(p[3]).toBe(255);
      if (outside) expect(p.slice(0, 3)).toEqual(BG);
      else if (p[0] !== BG[0]) glyphPixels++;
    }
  }
  expect(glyphPixels).toBeGreaterThan(size * size * 0.03); // huruf benar-benar tergambar
});

test('any: sudut transparan, tengah opak, goresan huruf berwarna huruf', () => {
  const size = 192;
  const rgba = renderIconRgba(size, 'any');
  expect(pixel(rgba, size, 0, 0)[3]).toBe(0);
  expect(pixel(rgba, size, size - 1, size - 1)[3]).toBe(0);
  expect(pixel(rgba, size, size / 2, size / 2)[3]).toBe(255);
  // Tengah goresan kiri "Q" dan goresan kiri "C" berwarna huruf; ruang di dalam cincin berwarna latar.
  const strokeMid = RING_OUTER - STROKE / 2;
  const qLeft = pixel(rgba, size, Math.round((Q_CENTER.x - strokeMid) * size), size / 2);
  const cLeft = pixel(rgba, size, Math.round((C_CENTER.x - strokeMid) * size), size / 2);
  const qInside = pixel(rgba, size, Math.round(Q_CENTER.x * size - 10), size / 2);
  expect(qLeft.slice(0, 3)).toEqual(FG);
  expect(cLeft.slice(0, 3)).toEqual(FG);
  expect(qInside.slice(0, 3)).toEqual(BG);
  // Pojok kanvas yang opak (di dalam sudut membulat) berwarna latar.
  expect(pixel(rgba, size, 24, 24).slice(0, 3)).toEqual(BG);
});

test('apple: 180x180 tanpa piksel transparan', () => {
  const size = 180;
  const rgba = renderIconRgba(size, 'apple');
  expect(readPngSize(renderIconPng(size, 'apple'))).toEqual({ width: 180, height: 180 });
  for (let i = 3; i < rgba.byteLength; i += 4) expect(rgba[i]).toBe(255);
  expect(pixel(rgba, size, 0, 0)).toEqual([...BG, 255]);
});

test('berkas ikon di web/public/icons ada dan berukuran sesuai PWA_ICON_SPECS', () => {
  for (const [name, { size }] of Object.entries(PWA_ICON_SPECS)) {
    const file = path.join(ROOT_DIR, 'web', 'public', 'icons', name);
    expect(existsSync(file)).toBe(true);
    expect(readPngSize(new Uint8Array(readFileSync(file)))).toEqual({ width: size, height: size });
  }
});

test('favicon.svg ada, tanpa <text>, dan sama dengan keluaran pembangkit', () => {
  const svg = readFileSync(path.join(ROOT_DIR, 'web', 'public', 'favicon.svg'), 'utf8');
  expect(svg).toBe(faviconSvg());
  expect(svg).not.toContain('<text');
  expect(svg).toContain('<svg');
});
