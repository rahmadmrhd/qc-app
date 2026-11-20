import { describe, expect, test } from 'bun:test';
import {
  base64ByteLength,
  fileRef,
  IMAGE_TARGET_BYTES,
  isBase64Text,
  isImageMime,
  isPostelFileMime,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  matchesImageSignature,
  parseFileRef,
  readImageDimensions,
} from './files';
import { POSTEL_LIMITS } from './postel';
import { QR_LIMITS } from './qrcode';

describe('batas ukuran berkas seragam (spek dialog unggah seragam 5.5)', () => {
  test('semua batas unggahan sama dengan MAX_FILE_BYTES (10 MB)', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_IMAGE_BYTES).toBe(MAX_FILE_BYTES);
    expect(POSTEL_LIMITS.attachmentMaxBytes).toBe(MAX_FILE_BYTES);
    expect(QR_LIMITS.documentMaxBytes).toBe(MAX_FILE_BYTES);
  });
});

describe('batas ukuran gambar (T30a, keputusan pemilik 2026-11-06)', () => {
  test('batas terima server (tepi) 10 MB; target pengecilan gambar di klien TIDAK ikut naik (tetap 1 MB)', () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(IMAGE_TARGET_BYTES).toBe(1024 * 1024);
    expect(IMAGE_TARGET_BYTES).toBeLessThan(MAX_IMAGE_BYTES);
  });
});

describe('isImageMime', () => {
  test('hanya JPEG, PNG, dan WebP', () => {
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/webp')).toBe(true);
    for (const value of ['image/gif', 'image/svg+xml', 'text/html', '', 42, null]) {
      expect(isImageMime(value)).toBe(false);
    }
  });
});

describe('isBase64Text', () => {
  test('menerima base64 baku dan menolak yang rusak', () => {
    expect(isBase64Text('QUJD')).toBe(true);
    expect(isBase64Text('QUI=')).toBe(true);
    expect(isBase64Text('QQ==')).toBe(true);
    for (const value of [
      '',
      'QUJ',
      'QU JD',
      'QUJD\n',
      'QUJD!',
      'Q===',
      'data:image/png;base64,QUJD',
    ]) {
      expect(isBase64Text(value)).toBe(false);
    }
  });
});

describe('base64ByteLength', () => {
  test('menghitung ukuran byte hasil decode', () => {
    expect(base64ByteLength('QUJD')).toBe(3);
    expect(base64ByteLength('QUI=')).toBe(2);
    expect(base64ByteLength('QQ==')).toBe(1);
    expect(base64ByteLength('QUJDREVG')).toBe(6);
  });
});

describe('matchesImageSignature', () => {
  test('awalan base64 harus cocok dengan MIME yang diklaim', () => {
    expect(matchesImageSignature('image/png', 'iVBORw0KGgoAAAANSUhEUg==')).toBe(true);
    expect(matchesImageSignature('image/jpeg', '/9j/4AAQSkZJRg==')).toBe(true);
    expect(matchesImageSignature('image/webp', 'UklGRhwAAABXRUJQ')).toBe(true);
    expect(matchesImageSignature('image/webp', 'UklGRhwAAABXQVZF')).toBe(false); // WAV: RIFF tetapi bukan WEBP
    expect(matchesImageSignature('image/webp', 'UklGR')).toBe(false); // terlalu pendek
    expect(matchesImageSignature('image/png', '/9j/4AAQSkZJRg==')).toBe(false);
    expect(matchesImageSignature('image/jpeg', 'PHNjcmlwdD4=')).toBe(false);
  });
});

describe('referensi berkas', () => {
  test('fileRef dan parseFileRef saling berbalik; yang lain ditolak', () => {
    expect(fileRef('abc-123')).toBe('qcfile:abc-123');
    expect(parseFileRef('qcfile:abc-123')).toBe('abc-123');
    for (const value of [
      'qcfile:',
      'https://x.test/a.png',
      'QCFILE:abc',
      'qcfile:a b',
      'qcfile:a/b',
      '',
    ]) {
      expect(parseFileRef(value)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Dimensi dari header byte (validasi thumbnail pustaka gambar stiker, 3b-1)
// ---------------------------------------------------------------------------------------------------------------

const u16be = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const u16le = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const u24le = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
const u32le = (value: number) => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];
const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

/** JPEG minimal: SOI, APP0 (untuk dilewati), lalu segmen SOF dengan `marker` tertentu. */
function jpegWith(width: number, height: number, marker = 0xc0): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...u16be(6),
    1,
    2,
    3,
    4,
    0xff,
    marker,
    ...u16be(11),
    8,
    ...u16be(height),
    ...u16be(width),
    1,
    1,
    0x11,
    0,
  ]);
}

const riff = (chunk: number[]) => [
  ...ascii('RIFF'),
  ...u32le(4 + chunk.length),
  ...ascii('WEBP'),
  ...chunk,
];

function webpLossy(width: number, height: number): Uint8Array {
  const payload = [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height), 0, 0];
  return Uint8Array.from(riff([...ascii('VP8 '), ...u32le(payload.length), ...payload]));
}

function webpLossless(width: number, height: number): Uint8Array {
  const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;
  const payload = [0x2f, ...u32le(bits), 0, 0];
  return Uint8Array.from(riff([...ascii('VP8L'), ...u32le(payload.length), ...payload]));
}

function webpExtended(width: number, height: number): Uint8Array {
  const payload = [0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
  return Uint8Array.from(riff([...ascii('VP8X'), ...u32le(payload.length), ...payload]));
}

describe('readImageDimensions', () => {
  test('JPEG: SOF0, SOF2 (progresif), dan SOF dengan marker lain terbaca; APP0 dilewati', () => {
    expect(readImageDimensions('image/jpeg', jpegWith(320, 240))).toEqual({
      width: 320,
      height: 240,
    });
    expect(readImageDimensions('image/jpeg', jpegWith(800, 600, 0xc2))).toEqual({
      width: 800,
      height: 600,
    });
    expect(readImageDimensions('image/jpeg', jpegWith(10, 20, 0xcf))).toEqual({
      width: 10,
      height: 20,
    });
  });

  test('JPEG: DHT (C4), JPG (C8), dan DAC (CC) bukan SOF dan dilewati sebagai segmen berpanjang', () => {
    const skipped = (marker: number) => [0xff, marker, ...u16be(4), 0, 0];
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      const base = jpegWith(320, 240);
      const bytes = Uint8Array.from([...base.slice(0, 2), ...skipped(marker), ...base.slice(2)]);
      expect(readImageDimensions('image/jpeg', bytes), marker.toString(16)).toEqual({
        width: 320,
        height: 240,
      });
    }
  });

  test('JPEG: header terpotong, tanpa SOF (SOS/EOI lebih dulu), atau dimensi 0 = null', () => {
    const full = jpegWith(320, 240);
    for (let cut = 0; cut < full.length - 1; cut++) {
      if (cut >= 19) continue; // lebar (byte 17-18) sudah utuh
      expect(readImageDimensions('image/jpeg', full.slice(0, cut)), `cut ${cut}`).toBeNull();
    }
    expect(
      readImageDimensions('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2])),
    ).toBeNull();
    expect(readImageDimensions('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readImageDimensions('image/jpeg', jpegWith(0, 240))).toBeNull();
    expect(readImageDimensions('image/jpeg', new Uint8Array(0))).toBeNull();
  });

  test('WebP VP8 (lossy), VP8L (lossless), dan VP8X (extended) terbaca', () => {
    expect(readImageDimensions('image/webp', webpLossy(320, 240))).toEqual({
      width: 320,
      height: 240,
    });
    expect(readImageDimensions('image/webp', webpLossless(320, 240))).toEqual({
      width: 320,
      height: 240,
    });
    expect(readImageDimensions('image/webp', webpExtended(320, 240))).toEqual({
      width: 320,
      height: 240,
    });
    expect(readImageDimensions('image/webp', webpExtended(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
    expect(readImageDimensions('image/webp', webpLossless(16384, 1))).toEqual({
      width: 16384,
      height: 1,
    });
  });

  test('WebP: header terpotong, chunk tak dikenal, atau kode awal VP8 salah = null', () => {
    for (const bytes of [webpLossy(320, 240), webpLossless(320, 240), webpExtended(320, 240)]) {
      for (let cut = 0; cut < 25; cut++) {
        expect(readImageDimensions('image/webp', bytes.slice(0, cut)), `cut ${cut}`).toBeNull();
      }
    }
    const unknown = Uint8Array.from(
      riff([...ascii('ABCD'), ...u32le(10), ...new Array(10).fill(0)]),
    );
    expect(readImageDimensions('image/webp', unknown)).toBeNull();
    const badStart = webpLossy(320, 240);
    badStart[23] = 0;
    expect(readImageDimensions('image/webp', badStart)).toBeNull();
    const notWebp = webpLossy(320, 240);
    notWebp[8] = 0x41;
    expect(readImageDimensions('image/webp', notWebp)).toBeNull();
  });

  test('PNG: lebar dan tinggi dari IHDR', () => {
    const png = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      ...ascii('IHDR'),
      0,
      0,
      1,
      64,
      0,
      0,
      0,
      240,
      8,
      6,
      0,
      0,
      0,
    ]);
    expect(readImageDimensions('image/png', png)).toEqual({ width: 320, height: 240 });
    expect(readImageDimensions('image/png', png.slice(0, 20))).toBeNull();
  });
});

describe('isPostelFileMime', () => {
  test('menerima gambar dan PDF saja', () => {
    expect(isPostelFileMime('application/pdf')).toBe(true);
    expect(isPostelFileMime('image/png')).toBe(true);
    expect(isPostelFileMime('image/gif')).toBe(false);
    expect(isPostelFileMime('text/html')).toBe(false);
    expect(isPostelFileMime(undefined)).toBe(false);
  });
});
