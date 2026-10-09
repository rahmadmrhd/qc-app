export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

/** Sisi terpanjang gambar setelah dikecilkan klien. */
export const MAX_IMAGE_SIDE = 1600;
/** Ukuran maksimum berkas hasil kompresi (byte). */
export const MAX_IMAGE_BYTES = 1_048_576;
/** Batas wajar lebar/tinggi yang diterima server. */
export const MAX_IMAGE_DIMENSION = 4000;
export const MARKDOWN_MAX_LENGTH = 20_000;

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

/** Tanda tangan berkas (magic bytes dalam base64) harus cocok dengan MIME yang diklaim. */
export function matchesImageSignature(mime: ImageMime, base64: string): boolean {
  return base64.startsWith(SIGNATURE_PREFIX[mime]);
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
