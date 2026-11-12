/**
 * Pembangkit ikon PWA sementara: monogram "QC" (latar #0a0a0a, huruf #fafafa), tanpa dependensi (rasterisasi
 * supersampling 4x4 atas bentuk geometris + enkoder PNG `node:zlib`).
 *
 * Ganti PNG dan `favicon.svg` hasilnya dengan logo resmi bila tersedia (berkas di `web/public/icons/` dan
 * `web/public/favicon.svg`; nama berkas dan ukuran harus tetap sama, dijaga `scripts/verify-dist.ts`).
 *
 * Jalankan: `bun run scripts/make-pwa-icons.ts` (menulis ke `web/public/`).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { ROOT_DIR } from './paths';

export type IconKind = 'any' | 'maskable' | 'apple';

/** Nama berkas (relatif ke `web/public/icons/`) -> ukuran dan jenis. */
export const PWA_ICON_SPECS: Record<string, { size: number; kind: IconKind }> = {
  'icon-192.png': { size: 192, kind: 'any' },
  'icon-512.png': { size: 512, kind: 'any' },
  'icon-maskable-512.png': { size: 512, kind: 'maskable' },
  'apple-touch-icon-180.png': { size: 180, kind: 'apple' },
};

const BG: [number, number, number] = [0x0a, 0x0a, 0x0a];
const FG: [number, number, number] = [0xfa, 0xfa, 0xfa];

// Geometri monogram dalam satuan kanvas (0..1). Lebar total 0.6 (maks. 60%); jarak terjauh dari pusat 0.3 < 0.4
// sehingga seluruh huruf berada di zona aman maskable (lingkaran radius 40%).
export const RING_OUTER = 0.14;
export const STROKE = 0.065;
const RING_MID = RING_OUTER - STROKE / 2;
export const Q_CENTER = { x: 0.34, y: 0.5 };
export const C_CENTER = { x: 0.66, y: 0.5 };
/** "C" terbuka di sisi kanan: sudut dalam +-OPENING (radian) dari arah kanan dibuang. */
const OPENING = Math.PI / 4;
const TAIL_FROM = 0.06;
const TAIL_TO = 0.17;
const DIAG = Math.SQRT1_2;
/** Radius sudut membulat ikon `any`. */
const CORNER = 0.22;

function inGlyph(x: number, y: number): boolean {
  // "Q": cincin + ekor diagonal (kapsul dengan ujung bulat).
  const qx = x - Q_CENTER.x;
  const qy = y - Q_CENTER.y;
  const qr = Math.hypot(qx, qy);
  if (qr <= RING_OUTER && qr >= RING_OUTER - STROKE) return true;
  // Ekor: segmen sepanjang diagonal kanan-bawah; `along` = proyeksi titik pada arah diagonal.
  const along = (qx + qy) * DIAG;
  const clamped = Math.max(TAIL_FROM, Math.min(TAIL_TO, along));
  const across = (qx - qy) * DIAG;
  if (Math.hypot(along - clamped, across) <= STROKE / 2) return true;
  // "C": cincin yang terbuka di kanan.
  const cx = x - C_CENTER.x;
  const cy = y - C_CENTER.y;
  const cr = Math.hypot(cx, cy);
  if (cr <= RING_OUTER && cr >= RING_OUTER - STROKE) {
    return Math.abs(Math.atan2(cy, cx)) > OPENING;
  }
  return false;
}

/** True bila titik di dalam persegi bersudut membulat satu satuan. */
function inRoundedSquare(x: number, y: number): boolean {
  const dx = Math.max(CORNER - x, 0, x - (1 - CORNER));
  const dy = Math.max(CORNER - y, 0, y - (1 - CORNER));
  return dx * dx + dy * dy <= CORNER * CORNER;
}

const SUPERSAMPLE = 4;

/** Raster RGBA (tidak premultiplied) ukuran `size` x `size`. */
export function renderIconRgba(size: number, kind: IconKind): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let shape = 0;
      let glyph = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (kind === 'any' && !inRoundedSquare(x, y)) continue;
          shape++;
          if (inGlyph(x, y)) glyph++;
        }
      }
      if (shape === 0) continue; // transparan penuh
      const offset = (py * size + px) * 4;
      const mix = glyph / shape;
      for (let channel = 0; channel < 3; channel++) {
        out[offset + channel] = Math.round(
          (BG[channel] as number) * (1 - mix) + (FG[channel] as number) * mix,
        );
      }
      out[offset + 3] = Math.round((shape / samples) * 255);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
}

/** Enkoder PNG RGBA 8-bit (filter 0 per baris). */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // kedalaman bit
  header[9] = 6; // RGBA
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export function renderIconPng(size: number, kind: IconKind): Uint8Array {
  return encodePng(renderIconRgba(size, kind), size, size);
}

/** Favicon SVG dengan monogram yang sama (path/circle, tanpa `<text>` agar tidak bergantung font). */
export function faviconSvg(): string {
  const n = (value: number) => Number((value * 100).toFixed(2)).toString();
  const ring = n(RING_MID);
  const stroke = n(STROKE);
  const offset = RING_MID * DIAG;
  const arcX = n(C_CENTER.x + offset);
  const arcTop = n(C_CENTER.y - offset);
  const arcBottom = n(C_CENTER.y + offset);
  const tail = (radius: number) =>
    `${n(Q_CENTER.x + radius * DIAG)} ${n(Q_CENTER.y + radius * DIAG)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${n(CORNER)}" fill="#0a0a0a"/>
  <g fill="none" stroke="#fafafa" stroke-width="${stroke}">
    <circle cx="${n(Q_CENTER.x)}" cy="${n(Q_CENTER.y)}" r="${ring}"/>
    <path d="M${tail(TAIL_FROM)}L${tail(TAIL_TO)}" stroke-linecap="round"/>
    <path d="M${arcX} ${arcTop}A${ring} ${ring} 0 1 0 ${arcX} ${arcBottom}"/>
  </g>
</svg>
`;
}

if (import.meta.main) {
  const publicDir = path.join(ROOT_DIR, 'web', 'public');
  const iconsDir = path.join(publicDir, 'icons');
  mkdirSync(iconsDir, { recursive: true });
  for (const [name, { size, kind }] of Object.entries(PWA_ICON_SPECS)) {
    await Bun.write(path.join(iconsDir, name), renderIconPng(size, kind));
  }
  await Bun.write(path.join(publicDir, 'favicon.svg'), faviconSvg());
  console.log(`Ikon PWA ditulis ke ${publicDir}`);
}
