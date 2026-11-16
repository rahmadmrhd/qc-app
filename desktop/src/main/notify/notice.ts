// Notifikasi dari aliran server: validasi ketat sebelum menyentuh API notifikasi OS. Isi berasal dari server
// (tepercaya, tetapi teks pengguna seperti komentar ikut), jadi panjang dibatasi dan tautan hanya boleh jalur
// dalam aplikasi.

export interface StreamNotice {
  id: string;
  title: string;
  body: string;
  /** Jalur dalam aplikasi (mis. `/handover/...`), selalu diawali satu `/`. */
  url: string;
  tag: string;
  createdAt: string;
}

const TITLE_MAX = 200;
const BODY_MAX = 500;
const URL_MAX = 300;
const ID_MAX = 64;

/** Jalur dalam aplikasi yang aman: diawali `/` tunggal, tanpa `//`, `\`, karakter kontrol, atau skema. */
export function safeAppPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > URL_MAX) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: justru menolak karakter kontrol.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: karakter kontrol dibuang dari teks notifikasi.
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Data bingkai `notification` -> notifikasi sah, atau `null` bila bentuknya salah. */
export function parseStreamNotice(data: string): StreamNotice | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const id = text(v.id, ID_MAX);
  const title = text(v.title, TITLE_MAX);
  const body = text(v.body, BODY_MAX);
  const tag = text(v.tag, ID_MAX * 2);
  const url = safeAppPath(v.url);
  const createdAt = text(v.createdAt, 40);
  if (!id || title === null || body === null || tag === null || url === null || !createdAt) {
    return null;
  }
  if (title === '') return null;
  return { id, title, body, url, tag, createdAt };
}
