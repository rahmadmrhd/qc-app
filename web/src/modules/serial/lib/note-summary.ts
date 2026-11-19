import { markdownToPlain } from '@shared/markdown-plain';

/**
 * Ringkasan satu baris dari catatan Markdown untuk tabel dan kartu draft: sintaks dibuang (`markdownToPlain`), baris
 * baru dan spasi beruntun menjadi satu spasi. Catatan lama yang berupa teks biasa tidak berubah.
 */
export function noteSummary(note: string): string {
  return markdownToPlain(note).text.replace(/\s+/g, ' ').trim();
}
