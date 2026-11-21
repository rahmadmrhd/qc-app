import type { AdjustStockBatchInput, RecordStockBatchInput } from '@shared/contract';
import { piecesOfCount, STICKER_LIMITS, type StockCount } from '@shared/stickers';
import { cleanCount, emptyCount } from '../components/count-input';

/** Mode halaman "Entri stok": masuk, keluar, atau koreksi (selisih bertanda). */
export type EntryMode = 'in' | 'out' | 'adjust';

/** Isian satu stiker pada entri batch: hitungan (masuk/keluar) atau selisih bertanda (koreksi, teks apa adanya). */
export interface EntryRow {
  count: StockCount;
  delta: string;
}

export function emptyEntryRow(): EntryRow {
  return { count: emptyCount(), delta: '' };
}

/**
 * Kunci idempoten satu entri (K1, `clientId`): UUID v4 huruf kecil. Dibuat saat baris ditambah dan dibuat ulang tiap
 * isian berubah, sehingga menekan Simpan lagi pada isian yang sama (mis. setelah respons hilang) tidak menggandakan stok.
 */
export function newEntryClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().toLowerCase();
    }
  } catch {
    // Konteks tak aman: pakai cadangan.
  }
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

/** Baris yang belum diisi sama sekali (hitungan kosong dan selisih kosong): bukan isian yang belum disimpan. */
export function isEmptyRow(row: EntryRow): boolean {
  return row.delta.trim() === '' && piecesOfCount(cleanCount(row.count)) === 0;
}

/** Jumlah butir baris masuk/keluar (hitungan lembar x isi + butir); koreksi = selisih bertanda, `null` bila belum sah. */
export function rowPieces(mode: EntryMode, row: EntryRow): number | null {
  if (mode === 'adjust') {
    const text = row.delta.trim();
    if (text === '') return null;
    const value = Number(text);
    return Number.isInteger(value) ? value : null;
  }
  return piecesOfCount(cleanCount(row.count));
}

/** Pesan galat satu baris (kosong = sah). Peringatan stok melebihi tercatat ada di `rowWarning`, bukan galat. */
export function rowError(mode: EntryMode, row: EntryRow): string | null {
  if (mode === 'adjust') {
    const text = row.delta.trim();
    if (text === '' || Number(text) === 0) return 'Perubahan wajib diisi (bukan 0)';
    if (!Number.isInteger(Number(text))) return 'Perubahan harus bilangan bulat';
    if (Math.abs(Number(text)) > STICKER_LIMITS.qtyMax) {
      return `Perubahan maksimal ${STICKER_LIMITS.qtyMax} (boleh negatif)`;
    }
    return null;
  }
  const pieces = rowPieces(mode, row) ?? 0;
  if (pieces < 1) return 'Hitungan minimal 1 butir';
  if (pieces > STICKER_LIMITS.qtyMax) return `Jumlah butir maksimal ${STICKER_LIMITS.qtyMax}`;
  return null;
}

/** Peringatan (bukan galat) bagi baris keluar yang melebihi stok tercatat di lokasi; server tetap penentu. */
export function rowWarning(mode: EntryMode, row: EntryRow, recorded: number): string | null {
  if (mode !== 'out') return null;
  const pieces = rowPieces(mode, row) ?? 0;
  return pieces > recorded ? `Melebihi stok tercatat (${recorded} butir)` : null;
}

/** Ringkasan di atas Simpan: jumlah stiker dan total butir (koreksi: jumlah bersih selisih bertanda). */
export function summarize(
  mode: EntryMode,
  rows: readonly EntryRow[],
): { stickers: number; total: number } {
  let total = 0;
  for (const row of rows) total += rowPieces(mode, row) ?? 0;
  return { stickers: rows.length, total };
}

/** Menyusun masukan rute batch dari isian halaman (isian harus sudah lolos `rowError`). */
export function buildBatchInput(
  mode: EntryMode,
  locationId: string,
  reason: string,
  entries: readonly { stickerId: string; row: EntryRow; clientId?: string }[],
): RecordStockBatchInput | AdjustStockBatchInput {
  const trimmed = reason.trim();
  if (mode === 'adjust') {
    return {
      reason: trimmed,
      rows: entries.map(({ stickerId, row, clientId }) => ({
        stickerId,
        locationId,
        delta: Number(row.delta.trim()),
        ...(clientId ? { clientId } : {}),
      })),
    };
  }
  return {
    kind: mode,
    reason: trimmed,
    rows: entries.map(({ stickerId, row, clientId }) => ({
      stickerId,
      locationId,
      count: cleanCount(row.count),
      ...(clientId ? { clientId } : {}),
    })),
  };
}
