export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

/** Sisi terpanjang gambar setelah dikecilkan klien. */
export const MAX_IMAGE_SIDE = 1600;
/** Ukuran maksimum berkas hasil kompresi (byte). */
export const MAX_IMAGE_BYTES = 1_048_576;
/** Batas wajar lebar/tinggi yang diterima server. */
export const MAX_IMAGE_DIMENSION = 4000;
export const MARKDOWN_MAX_LENGTH = 20_000;
/** Batas berkas yang sudah diunggah tetapi belum ditautkan ke entitas, per user (mencegah penumpukan di Drive). */
export const MAX_UNATTACHED_UPLOADS = 50;

/** Skema rujukan gambar di dalam Markdown: `![alt](qcfile:<id>)`. */
export const FILE_SCHEME = 'qcfile:';

/** Jenis entitas pemilik berkas. */
export type FileOwnerType = 'item';

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

/** Dekode `count` byte pertama dari base64 (tanpa atob, yang tidak ada di GAS); null bila terlalu pendek/rusak. */
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
