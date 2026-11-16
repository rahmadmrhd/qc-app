import type { SerialRowInput, SerialRowResult } from '@shared/contract';
import type { QcsnRow } from '@shared/serial-file';
import { normalizeSerial, SERIAL_LIMITS, splitSerialInput } from '@shared/serials';
import type { ProofPhotoRef } from './proof-source';

export interface StagingSticker {
  stickerId: string;
  name: string;
  qty: number;
}

export interface StagingRow {
  clientId: string;
  serial: string;
  itemId: string;
  itemLabel: string;
  buId: string;
  buLabel: string;
  testDate: string;
  locationId: string;
  locationLabel: string;
  sample: boolean;
  note: string;
  /** Waktu baris ditambahkan (ISO); ikut ke berkas `.qcsn`. */
  capturedAt: string;
  source: 'manual' | 'countrylock';
  /** `null` = bawaan semua stiker yang berlaku; diisi klien saat opsi stiker dimuat. */
  stickers: StagingSticker[] | null;
  /** Foto bukti QC yang sudah diunggah (`draft` di server); hanya id yang dikirim saat Simpan. Tidak ikut `.qcsn`. */
  proofPhotos: ProofPhotoRef[];
  result?: 'duplicate' | 'invalid' | 'error';
  message?: string;
  selected: boolean;
  /** Rujukan hasil impor yang tidak ditemukan; wajib dipilih ulang sebelum simpan. */
  unresolved?: ('item' | 'location' | 'stickers')[];
}

/** Nilai bawaan "rombongan" yang dipakai baris-baris baru. */
export interface Defaults {
  itemId: string;
  itemLabel: string;
  buId: string;
  buLabel: string;
  testDate: string;
  locationId: string;
  locationLabel: string;
  sample: boolean;
  note: string;
  /** Pilihan stiker bawaan; `null`/tidak ada = semua yang berlaku (diselesaikan saat simpan). Disalin ke tiap baris. */
  stickers?: StagingSticker[] | null;
}

export interface AddReport {
  added: number;
  duplicates: number;
  rejected: string[];
  truncated: boolean;
}

export type BulkPatch = Partial<
  Pick<
    StagingRow,
    | 'itemId'
    | 'itemLabel'
    | 'buId'
    | 'buLabel'
    | 'testDate'
    | 'locationId'
    | 'locationLabel'
    | 'sample'
    | 'note'
  >
>;

/**
 * Menambah baris dari teks (satu serial per baris; tempelan atau isi QR yang memuat banyak serial dipecah pada baris
 * baru). Serial yang sudah ada di tabel (bentuk ternormalisasi, termasuk varian MAC) dilewati dan dihitung sebagai
 * duplikat; tabel dibatasi `SERIAL_LIMITS.tableRows`.
 */
export function addSerials(
  rows: readonly StagingRow[],
  text: string,
  defaults: Defaults,
  newId: () => string,
  nowIso: () => string,
): { rows: StagingRow[]; report: AddReport } {
  const split = splitSerialInput(text);
  const existing = new Set(rows.map((row) => normalizeSerial(row.serial)));
  const next = [...rows];
  let duplicates = split.duplicates;
  let truncated = split.truncated;
  let added = 0;
  for (const serial of split.serials) {
    if (existing.has(serial)) {
      duplicates++;
      continue;
    }
    if (next.length >= SERIAL_LIMITS.tableRows) {
      truncated = true;
      continue;
    }
    existing.add(serial);
    next.push({
      clientId: newId(),
      serial,
      itemId: defaults.itemId,
      itemLabel: defaults.itemLabel,
      buId: defaults.buId,
      buLabel: defaults.buLabel,
      testDate: defaults.testDate,
      locationId: defaults.locationId,
      locationLabel: defaults.locationLabel,
      sample: defaults.sample,
      note: defaults.note,
      capturedAt: nowIso(),
      source: 'manual',
      stickers: defaults.stickers ? defaults.stickers.map((sticker) => ({ ...sticker })) : null,
      proofPhotos: [],
      selected: false,
    });
    added++;
  }
  return { rows: next, report: { added, duplicates, rejected: split.rejected, truncated } };
}

/** Mengubah baris terpilih saja; mengganti item atau BU mengosongkan pilihan stiker (`null`, dimuat ulang). */
export function applyBulk(
  rows: readonly StagingRow[],
  ids: ReadonlySet<string>,
  patch: BulkPatch,
): StagingRow[] {
  const resetStickers = patch.itemId !== undefined || patch.buId !== undefined;
  return rows.map((row) => {
    if (!ids.has(row.clientId)) return row;
    const unresolved = row.unresolved?.filter(
      (key) =>
        !(
          (key === 'item' && patch.itemId !== undefined) ||
          (key === 'location' && patch.locationId !== undefined) ||
          (key === 'stickers' && resetStickers)
        ),
    );
    const { unresolved: _drop, ...rest } = row;
    return {
      ...rest,
      ...patch,
      ...(resetStickers ? { stickers: null } : {}),
      ...(unresolved && unresolved.length > 0 ? { unresolved } : {}),
    };
  });
}

export function removeRows(rows: readonly StagingRow[], ids: ReadonlySet<string>): StagingRow[] {
  return rows.filter((row) => !ids.has(row.clientId));
}

/**
 * Penolakan foto oleh server saat Simpan (foto sudah disapu, milik orang lain, atau sudah dipakai entri lain): foto
 * baris tak berguna lagi dan dibuang dari baris; pesan server dipertahankan agar pengguna tahu harus mengunggah ulang.
 */
export function isProofRejection(message: string): boolean {
  return (
    message.startsWith('Foto sudah kedaluwarsa') ||
    message.startsWith('Ada foto yang tidak dikenal')
  );
}

/** Id semua foto bukti pada baris-baris ini (untuk dibuang di server saat baris atau draft dibuang). */
export function proofIdsOf(rows: readonly StagingRow[]): string[] {
  return rows.flatMap((row) => row.proofPhotos.map((photo) => photo.id));
}

/** `created` dibuang dari tabel; hasil lain ditandai pada barisnya; urutan dipertahankan. */
export function applyResults(
  rows: readonly StagingRow[],
  results: readonly SerialRowResult[],
): StagingRow[] {
  const byId = new Map(results.map((entry) => [entry.clientId, entry]));
  const next: StagingRow[] = [];
  for (const row of rows) {
    const entry = byId.get(row.clientId);
    if (!entry) {
      next.push(row);
      continue;
    }
    if (entry.result === 'created') continue;
    next.push({
      ...row,
      result: entry.result,
      message: entry.message,
      ...(entry.result === 'invalid' && isProofRejection(entry.message) ? { proofPhotos: [] } : {}),
    });
  }
  return next;
}

/** Bentuk kiriman server; pemanggil harus sudah mengisi `stickers` (tidak boleh `null`). */
export function toRowInput(row: StagingRow): SerialRowInput {
  if (row.stickers === null) {
    throw new Error('Pilihan stiker baris belum dimuat');
  }
  return {
    clientId: row.clientId,
    serial: row.serial,
    itemId: row.itemId,
    buId: row.buId,
    testDate: row.testDate,
    locationId: row.locationId,
    sample: row.sample,
    note: row.note,
    // `countrylock` ikut dicatat (bawaan `manual` tak perlu dikirim).
    ...(row.source === 'countrylock' ? { source: 'countrylock' as const } : {}),
    stickers: row.stickers.map((sticker) => ({ stickerId: sticker.stickerId, qty: sticker.qty })),
    ...(row.proofPhotos.length > 0
      ? { proofPhotoIds: row.proofPhotos.map((photo) => photo.id) }
      : {}),
  };
}

export function toBatches<T>(rows: readonly T[], size: number = SERIAL_LIMITS.batchRows): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }
  return batches;
}

/** Baris hasil impor `.qcsn` menjadi baris tabel; serial yang sudah ada di tabel dilewati. */
export function fromQcsnRows(
  rows: readonly StagingRow[],
  imported: readonly QcsnRow[],
): { rows: StagingRow[]; added: number; skipped: number; truncated: boolean } {
  const existing = new Set(rows.map((row) => normalizeSerial(row.serial)));
  const existingIds = new Set(rows.map((row) => row.clientId));
  const next = [...rows];
  let added = 0;
  let skipped = 0;
  let truncated = false;
  for (const entry of imported) {
    if (existing.has(entry.serial) || existingIds.has(entry.clientId)) {
      skipped++;
      continue;
    }
    if (next.length >= SERIAL_LIMITS.tableRows) {
      truncated = true;
      skipped++;
      continue;
    }
    existing.add(entry.serial);
    next.push({
      clientId: entry.clientId,
      serial: entry.serial,
      itemId: entry.itemId,
      itemLabel: entry.itemLabel,
      buId: entry.buId,
      buLabel: entry.buLabel,
      testDate: entry.testDate,
      locationId: entry.locationId,
      locationLabel: entry.locationLabel,
      sample: entry.sample,
      note: entry.note,
      capturedAt: entry.capturedAt,
      source: entry.source,
      stickers: entry.stickers
        ? entry.stickers.map((sticker) => ({
            stickerId: sticker.stickerId,
            name: sticker.stickerLabel,
            qty: sticker.qty,
          }))
        : null,
      proofPhotos: [],
      selected: false,
    });
    added++;
  }
  return { rows: next, added, skipped, truncated };
}
