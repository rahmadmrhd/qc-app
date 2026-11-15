import { deflate, inflate } from 'node:zlib';
import { appError } from '@server/core/errors';

/**
 * Pembaca dan penulis PNG minimal untuk cap foto bukti (rancangan 2026-11-16 §6.3), tanpa dependensi. `Bun.Image`
 * selalu menghasilkan PNG 8-bit RGBA tidak berinterlasi; selain itu ditolak. Pembaca membuka kelima jenis filter baris
 * dan membatasi ukuran hasil inflate (anti bom kompresi). zlib dijalankan asinkron (kumpulan utas) agar permintaan lain
 * tidak tertahan oleh foto besar.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** Piksel RGBA berurutan baris demi baris (`width * height * 4` byte). */
  rgba: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const BYTES_PER_PIXEL = 4;

function inflateAsync(data: Uint8Array, maxOutputLength: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    inflate(data, { maxOutputLength }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function deflateAsync(data: Uint8Array, level: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    deflate(data, { level }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function invalid(message: string): never {
  throw appError('VALIDATION', message);
}

/** Predikator Paeth (spesifikasi PNG §9.4). */
function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upLeft;
}

/**
 * Membuka filter satu baris. `raw` = data terfilter (setelah byte jenis filter), `out` = hasil pada `outOffset`,
 * `prior` = offset baris sebelumnya di `out` (-1 pada baris pertama).
 */
function unfilterRow(
  type: number,
  raw: Uint8Array,
  rawOffset: number,
  out: Uint8Array,
  outOffset: number,
  prior: number,
  length: number,
): void {
  for (let i = 0; i < length; i++) {
    const value = raw[rawOffset + i] as number;
    const left = i >= BYTES_PER_PIXEL ? (out[outOffset + i - BYTES_PER_PIXEL] as number) : 0;
    const up = prior >= 0 ? (out[prior + i] as number) : 0;
    const upLeft =
      prior >= 0 && i >= BYTES_PER_PIXEL ? (out[prior + i - BYTES_PER_PIXEL] as number) : 0;
    let predicted: number;
    switch (type) {
      case 0:
        predicted = 0;
        break;
      case 1:
        predicted = left;
        break;
      case 2:
        predicted = up;
        break;
      case 3:
        predicted = (left + up) >> 1;
        break;
      case 4:
        predicted = paeth(left, up, upLeft);
        break;
      default:
        invalid('Jenis filter PNG tidak dikenal');
    }
    out[outOffset + i] = (value + predicted) & 0xff;
  }
}

/**
 * Membaca PNG 8-bit RGBA tidak berinterlasi menjadi piksel mentah. Galat berbentuk `VALIDATION`. `maxPixels` diperiksa
 * dari IHDR SEBELUM inflate, dan hasil inflate dibatasi persis ukuran yang diharapkan.
 */
export async function decodePngRgba(bytes: Uint8Array, maxPixels: number): Promise<RgbaImage> {
  if (bytes.length < SIGNATURE.length + 12 || SIGNATURE.some((value, i) => bytes[i] !== value)) {
    return invalid('Berkas bukan PNG yang sah');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  const parts: Uint8Array[] = [];
  let idatLength = 0;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] as number,
      bytes[offset + 5] as number,
      bytes[offset + 6] as number,
      bytes[offset + 7] as number,
    );
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) return invalid('PNG terpotong');
    if (type === 'IHDR') {
      if (length !== 13) return invalid('IHDR PNG tidak sah');
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      const bitDepth = bytes[start + 8];
      const colorType = bytes[start + 9];
      const compression = bytes[start + 10];
      const filter = bytes[start + 11];
      const interlace = bytes[start + 12];
      if (
        bitDepth !== 8 ||
        colorType !== 6 ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        return invalid('Format PNG tidak didukung (hanya RGBA 8-bit tanpa interlace)');
      }
      sawHeader = true;
    } else if (type === 'IDAT') {
      if (!sawHeader) return invalid('PNG tidak berurutan');
      parts.push(bytes.subarray(start, end));
      idatLength += length;
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }
  if (!sawHeader || idatLength === 0) return invalid('PNG tidak memuat data gambar');
  if (width < 1 || height < 1 || width * height > maxPixels) {
    return invalid('Dimensi gambar di luar batas');
  }
  const stride = width * BYTES_PER_PIXEL;
  const expected = (stride + 1) * height;
  const joined = new Uint8Array(idatLength);
  let cursor = 0;
  for (const part of parts) {
    joined.set(part, cursor);
    cursor += part.length;
  }
  let raw: Uint8Array;
  try {
    raw = await inflateAsync(joined, expected);
  } catch {
    return invalid('Data PNG rusak');
  }
  if (raw.length !== expected) return invalid('Data PNG rusak');
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    unfilterRow(
      raw[rowStart] as number,
      raw,
      rowStart + 1,
      rgba,
      y * stride,
      y === 0 ? -1 : (y - 1) * stride,
      stride,
    );
  }
  return { width, height, rgba };
}

let crcTable: Uint32Array | null = null;

function crc32(...parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Menulis PNG 8-bit RGBA (semua baris berfilter 0). `level` zlib bawaan 4: seimbang untuk footer polos. */
export async function encodePngRgba(image: RgbaImage, level = 4): Promise<Uint8Array> {
  const { width, height, rgba } = image;
  const stride = width * BYTES_PER_PIXEL;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflateAsync(raw, level)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
