import { isKeyChar } from './items';

/** Batas task serah terima (PRD FH2). */
export const HANDOVER_LIMITS = {
  note: 5000,
  customerName: 100,
  comment: 1000,
  comments: 50,
  batch: 30,
  checklistItems: 300,
  stateJson: 40000,
} as const;

export type HandoverStoredStatus = 'open' | 'cancelled';
export type HandoverStatus = 'new' | 'in_progress' | 'done' | 'cancelled';

/**
 * Baru/Dikerjakan/Selesai diturunkan dari progres checklist; Dibatalkan disimpan.
 * Tanpa butir checklist (total 0), Selesai ditentukan penanda `completed` (tombol Mark done).
 */
export function deriveHandoverStatus(
  stored: HandoverStoredStatus,
  progress: { total: number; done: number; completed: boolean },
): HandoverStatus {
  if (stored === 'cancelled') return 'cancelled';
  if (progress.total > 0 && progress.done === progress.total) return 'done';
  if (progress.total === 0 && progress.completed) return 'done';
  if (progress.done > 0) return 'in_progress';
  return 'new';
}

const HANDOVER_WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Tanggal `YYYYMMDD` menurut WIB (UTC+7), zona proyek (`appsscript.json`). */
export function dateKeyOf(epochMs: number): string {
  const date = new Date(epochMs + HANDOVER_WIB_OFFSET_MS);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function handoverNumber(dateKey: string, sequence: number): string {
  return `ST-${dateKey}-${String(sequence).padStart(3, '0')}`;
}

/** Urutan berikutnya untuk hari itu: maksimum urutan yang ada + 1 (nomor rusak diabaikan). */
export function nextHandoverSequence(numbers: readonly string[], dateKey: string): number {
  const prefix = `ST-${dateKey}-`;
  let max = 0;
  for (const number of numbers) {
    if (!number.startsWith(prefix)) continue;
    const tail = number.slice(prefix.length);
    if (tail === '' || [...tail].some((ch) => ch < '0' || ch > '9')) continue;
    max = Math.max(max, Number(tail));
  }
  return max + 1;
}

/**
 * Kunci customer (FC1): huruf kecil, TANDA BACA DIBUANG (bukan jadi spasi), spasi dirapikan. Sehingga
 * "C.V. Abadi" = "CV Abadi" dan "A.B.C" = "ABC". Khusus customer; `normalizeKey` (item/merk) tidak berubah.
 */
export function customerKey(name: string): string {
  let out = '';
  let pendingSpace = false;
  for (const ch of name.toLowerCase()) {
    if (isKeyChar(ch)) {
      if (pendingSpace && out !== '') out += ' ';
      out += ch;
      pendingSpace = false;
    } else if (ch.trim() === '') {
      pendingSpace = true;
    }
  }
  return out;
}

/** Karakter kontrol U+0000–U+001F selain \n, \r, \t (ditolak validator; menggelembungkan JSON audit). */
export function hasHandoverControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 && code !== 0x0a && code !== 0x0d && code !== 0x09) return true;
  }
  return false;
}
