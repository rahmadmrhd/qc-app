import { FILE_SCHEME } from './files';

/** Batas field item (PRD FI7). */
export const ITEM_LIMITS = {
  brand: 60,
  model: 100,
  alias: 100,
  aliases: 10,
  stickerName: 100,
  stickerNote: 300,
  stickers: 30,
  accessoryName: 100,
  accessoryQty: 999,
  accessories: 30,
  attachments: 10,
  /** Batas panjang JSON per kolom sheet (sel Sheets maks. 50.000 karakter). */
  jsonCell: 40_000,
} as const;

/**
 * Kunci pencocokan: huruf kecil, semua karakter selain huruf dan angka menjadi satu spasi, tepi dirapikan.
 * Dipakai untuk keunikan (merk+tipe, nama lain), pencarian, dan auto-suggest.
 */
export function normalizeKey(text: string): string {
  let result = '';
  let pendingSpace = false;
  for (const ch of text.toLowerCase()) {
    const isDigit = ch >= '0' && ch <= '9';
    const isLetter = ch.toUpperCase() !== ch.toLowerCase();
    if (isDigit || isLetter) {
      if (pendingSpace && result !== '') result += ' ';
      result += ch;
      pendingSpace = false;
    } else {
      pendingSpace = true;
    }
  }
  return result;
}

export function itemKey(brand: string, model: string): string {
  return `${normalizeKey(brand)} ${normalizeKey(model)}`.trim();
}

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

/** CRLF dan CR sendirian menjadi LF agar perbandingan dan penyimpanan konsisten. */
export function normalizeNewlines(text: string): string {
  return text
    .split(CR + LF)
    .join(LF)
    .split(CR)
    .join(LF);
}

/** Hash FNV-1a 32-bit (8 digit heksa); hanya untuk deteksi perubahan di audit, bukan kriptografi. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function isFileIdChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_' ||
    ch === '-'
  );
}

/**
 * Id berkas dari setiap kemunculan "qcfile:<id>" di Markdown (bentuk apa pun yang dirender: judul, kurung sudut,
 * gaya referensi); unik, urutan kemunculan. Sengaja longgar: klaim berlebih berarti simpan ditolak (aman),
 * klaim kurang berarti berkas milik entitas lain bisa lolos.
 */
export function extractFileRefs(markdown: string): string[] {
  const found: string[] = [];
  let from = 0;
  while (from < markdown.length) {
    const at = markdown.indexOf(FILE_SCHEME, from);
    if (at < 0) break;
    let end = at + FILE_SCHEME.length;
    while (end < markdown.length && isFileIdChar(markdown.charAt(end))) end++;
    const id = markdown.slice(at + FILE_SCHEME.length, end);
    const before = at > 0 ? markdown.charAt(at - 1) : '';
    const boundary = before === '' || !isFileIdChar(before);
    if (boundary && id !== '' && !found.includes(id)) found.push(id);
    from = Math.max(end, at + 1);
  }
  return found;
}
