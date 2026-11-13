export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

/** Sisi terpanjang gambar setelah dikecilkan klien. */
export const MAX_IMAGE_SIDE = 1600;
/** Batas TERIMA di server (byte; batas tepi 10 MB, keputusan pemilik 2026-11-06, spek §19 butir 5). */
export const MAX_IMAGE_BYTES = 10_485_760;
/** Target ukuran hasil kompresi gambar di klien (byte): TETAP 1 MB, bukan batas terima server. */
export const IMAGE_TARGET_BYTES = 1_048_576;
/** Batas wajar lebar/tinggi yang diterima server. */
export const MAX_IMAGE_DIMENSION = 4000;
export const MARKDOWN_MAX_LENGTH = 20_000;
/** Batas berkas yang sudah diunggah tetapi belum ditautkan ke entitas, per user (mencegah penumpukan di Drive). */
export const MAX_UNATTACHED_UPLOADS = 50;

/** Skema rujukan gambar di dalam Markdown: `![alt](qcfile:<id>)`. */
export const FILE_SCHEME = 'qcfile:';

/** Jenis entitas pemilik berkas. */
export type FileOwnerType = 'item' | 'qrlogo' | 'sticker' | 'stickerguide' | 'postel' | 'serial';

/** Lampiran Postel (stiker 4b): gambar dan PDF. */
export const POSTEL_FILE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export function isPostelFileMime(value: unknown): value is (typeof POSTEL_FILE_MIME_TYPES)[number] {
  return typeof value === 'string' && (POSTEL_FILE_MIME_TYPES as readonly string[]).includes(value);
}

export function isImageMime(value: unknown): value is ImageMime {
  return typeof value === 'string' && (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function isBase64Text(text: string): boolean {
  return text.length > 0 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}

export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const SIGNATURE_PREFIX: Record<ImageMime, string> = {
  'image/jpeg': '/9j/',
  'image/png': 'iVBORw0KGgo',
  'image/webp': 'UklGR',
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Dekode `count` byte pertama dari base64 (tanpa atob; `shared/` murni); null bila terlalu pendek/rusak. */
function base64Head(base64: string, count: number): number[] | null {
  const chars = Math.ceil((count * 4) / 3);
  if (base64.length < chars) return null;
  const bytes: number[] = [];
  for (let i = 0; i < chars; i += 4) {
    const group = base64.slice(i, i + 4);
    let bits = 0;
    for (let j = 0; j < 4; j++) {
      const index = BASE64_ALPHABET.indexOf(group[j] ?? 'A');
      if (index < 0) return null;
      bits = bits * 64 + index;
    }
    bytes.push(Math.floor(bits / 65536) % 256, Math.floor(bits / 256) % 256, bits % 256);
  }
  return bytes.slice(0, count);
}

function bytesAreText(bytes: readonly number[], start: number, text: string): boolean {
  return [...text].every((ch, index) => bytes[start + index] === ch.charCodeAt(0));
}

/** Tanda tangan berkas (magic bytes dalam base64) harus cocok dengan MIME yang diklaim. */
export function matchesImageSignature(mime: ImageMime, base64: string): boolean {
  if (!base64.startsWith(SIGNATURE_PREFIX[mime])) return false;
  if (mime !== 'image/webp') return true;
  // WebP = kontainer RIFF; byte 8–11 harus "WEBP" (WAV/AVI juga berawalan RIFF).
  const head = base64Head(base64, 12);
  return head !== null && bytesAreText(head, 0, 'RIFF') && bytesAreText(head, 8, 'WEBP');
}

export function fileRef(id: string): string {
  return `${FILE_SCHEME}${id}`;
}

/** Id berkas dari `qcfile:<id>`; `null` bila bukan rujukan berkas yang sah. */
export function parseFileRef(url: string): string | null {
  if (!url.startsWith(FILE_SCHEME)) return null;
  const id = url.slice(FILE_SCHEME.length);
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** True bila `bytes` diawali `signature` (mulai dari `offset`). */
function bytesHaveSignature(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const PNG_FILE_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP"
const PDF_FILE_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // "%PDF-"

/** Tanda tangan byte berkas gambar harus cocok dengan MIME yang diklaim (padanan `matchesImageSignature` untuk byte mentah). */
export function matchesImageBytesSignature(mime: ImageMime, bytes: Uint8Array): boolean {
  if (mime === 'image/jpeg') return bytesHaveSignature(bytes, JPEG_SIGNATURE);
  if (mime === 'image/png') return bytesHaveSignature(bytes, PNG_FILE_SIGNATURE);
  // WebP = kontainer RIFF; byte 8-11 harus "WEBP" (WAV/AVI juga berawalan RIFF).
  return bytesHaveSignature(bytes, RIFF_SIGNATURE) && bytesHaveSignature(bytes, WEBP_SIGNATURE, 8);
}

export interface ImageDimensions {
  width: number;
  height: number;
}

const u16be = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const u16le = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const u24le = (bytes: Uint8Array, at: number): number =>
  u16le(bytes, at) | ((bytes[at + 2] ?? 0) << 16);

/** JPEG: segmen SOF (C0-CF kecuali DHT C4, JPG C8, DAC CC) memuat tinggi lalu lebar; segmen lain dilewati lewat panjangnya. */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!bytesHaveSignature(bytes, JPEG_SIGNATURE)) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // byte pengisi
      continue;
    }
    // Penanda tanpa panjang: TEM, RSTn, SOI.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // EOI atau SOS sebelum SOF: tak ada dimensi yang dapat dibaca.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(bytes, at + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (at + 9 > bytes.length) return null;
      const height = u16be(bytes, at + 5);
      const width = u16be(bytes, at + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/** WebP: chunk pertama VP8 (lossy), VP8L (lossless), atau VP8X (extended) memuat dimensi. */
function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!matchesImageBytesSignature('image/webp', bytes) || bytes.length < 16) return null;
  const fourcc = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0,
  );
  let width = 0;
  let height = 0;
  if (fourcc === 'VP8 ') {
    if (bytes.length < 30) return null;
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    width = u16le(bytes, 26) & 0x3fff;
    height = u16le(bytes, 28) & 0x3fff;
  } else if (fourcc === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const bits = u16le(bytes, 21) | (u16le(bytes, 23) << 16);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else if (fourcc === 'VP8X') {
    if (bytes.length < 30) return null;
    width = u24le(bytes, 24) + 1;
    height = u24le(bytes, 27) + 1;
  } else {
    return null;
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

/** PNG: IHDR (lebar lalu tinggi, 32 bit big-endian) langsung setelah tanda tangan. */
function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!bytesHaveSignature(bytes, PNG_FILE_SIGNATURE) || bytes.length < 24) return null;
  const word = (at: number) => (u16be(bytes, at) * 65536 + u16be(bytes, at + 2)) >>> 0;
  const width = word(16);
  const height = word(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Lebar dan tinggi dari HEADER byte gambar (tanpa mendekode piksel);  bila header terpotong atau tak terbaca.
 * Pemanggil memeriksa tanda tangan (matchesImageBytesSignature) terlebih dahulu bila perlu membedakan alasan galat.
 */
export function readImageDimensions(mime: ImageMime, bytes: Uint8Array): ImageDimensions | null {
  if (mime === 'image/jpeg') return jpegDimensions(bytes);
  if (mime === 'image/png') return pngDimensions(bytes);
  return webpDimensions(bytes);
}

/** Berkas diawali "%PDF-". */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytesHaveSignature(bytes, PDF_FILE_SIGNATURE);
}

/** Berkas diawali tanda tangan PNG. */
export function isPngBytes(bytes: Uint8Array): boolean {
  return bytesHaveSignature(bytes, PNG_FILE_SIGNATURE);
}
