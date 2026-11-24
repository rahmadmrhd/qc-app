import { isKeyChar } from './items';
import { wibParts } from './wib';

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

/**
 * Maksimum task per permintaan `handovers.saveBatch` (server Bun di VPS): 30. Formulir bulk
 * mengirim SATU permintaan atomik. Keputusan pemilik 2026-11-05: batas 5 peninggalan platform sebelumnya (2026-10-26/30)
 * dibuang karena tak berlaku di VPS.
 */
export const HANDOVER_BATCH_MAX = HANDOVER_LIMITS.batch;

const HANDOVER_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `clientId` komentar/task baru: UUID huruf kecil 36 karakter (`crypto.randomUUID()`). */
export function isHandoverClientId(value: string): boolean {
  return HANDOVER_CLIENT_ID.test(value);
}

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

/** Tanggal `YYYYMMDD` menurut WIB (UTC+7), zona proyek. */
export function dateKeyOf(epochMs: number): string {
  const { year, month, day } = wibParts(epochMs);
  return `${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

export function handoverNumber(dateKey: string, sequence: number): string {
  return `ST-${dateKey}-${String(sequence).padStart(3, '0')}`;
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
