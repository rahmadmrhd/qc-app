/**
 * Tabel hasil scan di dalam dialog kamera: fungsi murni (tanpa DOM). Aturan serial TIDAK ditulis ulang: pemecahan,
 * normalisasi, dan validasi memakai `splitSerialInput`/`normalizeSerial`/`serialProblem` dari `@shared/serials`
 * (sama dengan penambahan ke draft), dan batas jumlah baris = batas baris draft.
 */
import { normalizeSerial, SERIAL_LIMITS, serialProblem, splitSerialInput } from '@shared/serials';
import type { ScanFeedback } from './scan-feedback';

export interface ScanRow {
  id: string;
  /** Teks yang tampil/diedit (belum tentu ternormalisasi saat sedang diketik). */
  text: string;
}

export const SCAN_TABLE_LIMIT = SERIAL_LIMITS.tableRows;

export type RowProblemKind = 'empty' | 'invalid' | 'duplicate' | 'known';

export interface RowProblem {
  kind: RowProblemKind;
  message: string;
}

/** Penanda "serial ini sudah ada di draft pemakai" (menerima serial ternormalisasi). */
export type IsKnown = (serial: string) => boolean;

const PROBLEM_MESSAGE = {
  empty: 'Isi serial dulu, atau hapus baris ini.',
  tooLong: `Terlalu panjang (maks. ${SERIAL_LIMITS.serialMax} karakter).`,
  controlChars: 'Ada karakter yang tidak boleh dipakai.',
  duplicate: 'Sama dengan baris lain di atas.',
  known: 'Sudah ada di draft.',
} as const;

/**
 * Menambah hasil bacaan (satu serial, atau banyak serial satu per baris) di akhir tabel. Serial yang sudah ada di
 * tabel atau di draft (`isKnown`) tidak ditambahkan. Umpan balik: `added` bila semua yang baru masuk, `duplicate`
 * bila tak ada yang baru, `rejected` bila tak ada serial sah atau tabel penuh (yang masih muat tetap masuk).
 * `maxRows` lebih kecil dari batas draft = mode ganti (lihat di bawah).
 */
export function addScanned(
  rows: readonly ScanRow[],
  payload: string,
  isKnown: IsKnown,
  newId: () => string,
  maxRows: number = SCAN_TABLE_LIMIT,
): { rows: readonly ScanRow[]; feedback: ScanFeedback; added: string[] } {
  const split = splitSerialInput(payload);
  if (split.serials.length === 0) return { rows, feedback: 'rejected', added: [] };
  const existing = new Set(rows.map((row) => normalizeSerial(row.text)));
  const fresh = split.serials.filter((serial) => !existing.has(serial) && !isKnown(serial));
  if (fresh.length === 0) return { rows, feedback: 'duplicate', added: [] };
  // Batas lebih kecil dari batas draft (pemakai satu-serial, mis. `maxRows` 1): baris baru MENGGANTIKAN yang lama
  // (yang terbaru dipertahankan), bukan ditolak. Batas draft penuh = ditolak.
  const replacing = maxRows < SCAN_TABLE_LIMIT;
  const room = replacing ? maxRows : Math.max(0, SCAN_TABLE_LIMIT - rows.length);
  const accepted = fresh.slice(0, room);
  if (accepted.length === 0) return { rows, feedback: 'rejected', added: [] };
  const created = accepted.map((serial) => ({ id: newId(), text: serial }));
  return {
    rows: replacing ? [...rows, ...created].slice(-maxRows) : [...rows, ...created],
    feedback: accepted.length === fresh.length ? 'added' : 'rejected',
    added: created.map((row) => row.id),
  };
}

/**
 * Masalah tiap baris (null = sah), satu lewatan (O(n)). Duplikat ditandai pada kemunculan kedua dan seterusnya, jadi
 * yang pertama tetap sah dan cukup satu yang diperbaiki atau dihapus.
 */
export function rowProblems(rows: readonly ScanRow[], isKnown: IsKnown): (RowProblem | null)[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const serial = normalizeSerial(row.text);
    const problem = serialProblem(serial);
    if (problem === 'empty') return { kind: 'empty', message: PROBLEM_MESSAGE.empty };
    if (problem === 'too_long') return { kind: 'invalid', message: PROBLEM_MESSAGE.tooLong };
    if (problem === 'control_chars') {
      return { kind: 'invalid', message: PROBLEM_MESSAGE.controlChars };
    }
    if (seen.has(serial)) return { kind: 'duplicate', message: PROBLEM_MESSAGE.duplicate };
    seen.add(serial);
    if (isKnown(serial)) return { kind: 'known', message: PROBLEM_MESSAGE.known };
    return null;
  });
}

export function hasProblem(rows: readonly ScanRow[], isKnown: IsKnown): boolean {
  return rowProblems(rows, isKnown).some((problem) => problem !== null);
}

export function editRow(rows: readonly ScanRow[], id: string, text: string): ScanRow[] {
  return rows.map((row) => (row.id === id ? { ...row, text } : row));
}

/** Serial ternormalisasi menurut urutan tabel, yang dikirim ke pemakai saat Simpan. */
export function rowsToScan(rows: readonly ScanRow[]): string[] {
  return rows.map((row) => normalizeSerial(row.text));
}
