import type { SerialExistingDto, SerialRowInput, SerialRowResult } from '@shared/contract';
import type { QcsnRow } from '@shared/serial-file';
import {
  normalizeSerial,
  SERIAL_LIMITS,
  type SerialStatus,
  splitSerialInput,
} from '@shared/serials';
import type { ProofPhotoRef } from './proof-source';

/** Pesan bila draft sudah memuat `SERIAL_LIMITS.tableRows` baris (jalur item wajib foto menolak dari awal). */
export const DRAFT_FULL_NOTE = `Draft sudah penuh (maks. ${SERIAL_LIMITS.tableRows} baris). Simpan dulu atau hapus beberapa baris sebelum menambah serial.`;

export interface StagingSticker {
  stickerId: string;
  name: string;
  qty: number;
}

/** Pesan baris Cek ulang yang serialnya sedang punya laporan aktif (tidak dapat disimpan dari Catat). */
export const EXISTING_OPEN_CASE_MESSAGE =
  'Serial ini sedang ada laporan aktif; selesaikan lewat halaman laporannya.';
/** Pesan baris Cek ulang yang unitnya sudah dinyatakan Rusak (tidak dapat disimpan dari Catat). */
export const EXISTING_BROKEN_MESSAGE = 'Unit ini sudah dinyatakan rusak.';

/**
 * Serial yang sudah tercatat (hasil `serials.lookupMany`): baris draft-nya menjadi baris Cek ulang. Hanya info yang
 * diungkap server lintas BU (item, BU saat ini, status) dan pilihan BU target; bukan kebenaran akhir (server menilai
 * ulang saat Simpan).
 */
export interface StagingExisting {
  id: string;
  itemId: string;
  itemLabel: string;
  /** BU saat ini serial itu. */
  buId: string;
  buCode: string;
  status: SerialStatus;
  hasOpenCase: boolean;
  /** BU yang boleh dipilih pengguna sebagai BU target cek ulang. */
  recheckBuIds: string[];
  /** Minimum foto bukti item (0 = tidak wajib foto). */
  proofMin: number;
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
  /**
   * Minimum foto bukti item baris ini (0 atau tidak ada = item tidak wajib foto). Diisi dari opsi item saat baris
   * dibuat atau item diganti; draft lama tanpa nilai ini berarti 0 (server tetap menegakkan aturan saat Simpan).
   */
  proofMin?: number;
  /**
   * Terisi bila serial ini sudah tercatat: baris menjadi Cek ulang (item mengikuti catatan, BU dibatasi
   * `recheckBuIds`, stiker bawaan kosong, Sample tidak berlaku). Draf lama tanpa field ini = baris biasa.
   */
  existing?: StagingExisting;
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
  /** Minimum foto bukti item bawaan (0/tidak ada = tidak wajib); disalin ke tiap baris. */
  proofMin?: number;
}

/** Label field Default yang masih kosong (menurut urutan form); kosong = Default siap dipakai untuk scan. */
export function missingDefaults(d: {
  itemId: string;
  buId: string;
  locationId: string;
  testDate: string;
}): string[] {
  const missing: string[] = [];
  if (d.locationId === '') missing.push('Lokasi');
  if (d.testDate === '') missing.push('Tanggal uji');
  if (d.itemId === '') missing.push('Item');
  if (d.buId === '') missing.push('Business Unit');
  return missing;
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
    | 'proofMin'
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
      ...(defaults.proofMin ? { proofMin: defaults.proofMin } : {}),
      proofPhotos: [],
      selected: false,
    });
    added++;
  }
  return { rows: next, report: { added, duplicates, rejected: split.rejected, truncated } };
}

/**
 * Mengubah baris terpilih saja; mengganti item atau BU mengosongkan pilihan stiker (`null`, dimuat ulang). Baris Cek
 * ulang (`existing`) mengabaikan item, minimum foto, dan Sample (item mengikuti catatan serial; Sample tidak berlaku),
 * dan pilihan stikernya dikosongkan (`[]`, bukan bawaan semua) bila BU-nya diganti. BU yang tidak boleh dipakai cek
 * ulang tetap diterapkan, tetapi ditandai bermasalah oleh `rowStatus` sampai dipilih ulang.
 */
export function applyBulk(
  rows: readonly StagingRow[],
  ids: ReadonlySet<string>,
  patch: BulkPatch,
): StagingRow[] {
  const {
    itemId: _item,
    itemLabel: _label,
    proofMin: _proof,
    sample: _sample,
    ...recheckPatch
  } = patch;
  return rows.map((row) => {
    if (!ids.has(row.clientId)) return row;
    const recheck = row.existing !== undefined;
    const effective: BulkPatch = recheck ? recheckPatch : patch;
    const resetStickers = effective.itemId !== undefined || effective.buId !== undefined;
    const unresolved = row.unresolved?.filter(
      (key) =>
        !(
          (key === 'item' && effective.itemId !== undefined) ||
          (key === 'location' && effective.locationId !== undefined) ||
          (key === 'stickers' && resetStickers)
        ),
    );
    const { unresolved: _drop, ...rest } = row;
    return {
      ...rest,
      ...effective,
      ...(resetStickers ? { stickers: recheck ? [] : null } : {}),
      ...(unresolved && unresolved.length > 0 ? { unresolved } : {}),
    };
  });
}

/** Bentuk `StagingExisting` dari jawaban `serials.lookupMany` (minimum foto 0 bila item tidak wajib foto). */
export function toExisting(dto: SerialExistingDto): StagingExisting {
  return {
    id: dto.id,
    itemId: dto.itemId,
    itemLabel: dto.itemLabel,
    buId: dto.buId,
    buCode: dto.buCode,
    status: dto.status,
    hasOpenCase: dto.hasOpenCase,
    recheckBuIds: [...dto.recheckBuIds],
    proofMin: dto.proofRequired ? dto.proofMin : 0,
  };
}

/** Alasan baris Cek ulang tidak dapat disimpan dari Catat (laporan aktif atau Rusak); `null` = tidak ada. */
export function existingProblem(row: StagingRow): string | null {
  const existing = row.existing;
  if (!existing) return null;
  if (existing.hasOpenCase) return EXISTING_OPEN_CASE_MESSAGE;
  if (existing.status === 'broken') return EXISTING_BROKEN_MESSAGE;
  return null;
}

/** BU baris Cek ulang yang tidak sah menurut `recheckBuIds` (BU kosong ditangani pemeriksaan kolom wajib); `null` = sah. */
export function existingBuProblem(row: StagingRow): string | null {
  const existing = row.existing;
  if (!existing) return null;
  if (existing.recheckBuIds.length === 0) {
    return 'Kamu belum punya akses ke Business Unit yang boleh dipakai untuk cek ulang serial ini';
  }
  if (row.buId !== '' && !existing.recheckBuIds.includes(row.buId)) {
    return 'Business Unit ini tidak bisa dipakai untuk cek ulang serial ini';
  }
  return null;
}

/** Baris yang tidak boleh dikirim saat Simpan karena serialnya sudah tercatat dan tidak dapat dicek ulang dari Catat. */
export function isExistingBlocked(row: StagingRow): boolean {
  return existingProblem(row) !== null || existingBuProblem(row) !== null;
}

function sameExisting(a: StagingExisting, b: StagingExisting): boolean {
  return (
    a.id === b.id &&
    a.itemId === b.itemId &&
    a.itemLabel === b.itemLabel &&
    a.buId === b.buId &&
    a.buCode === b.buCode &&
    a.status === b.status &&
    a.hasOpenCase === b.hasOpenCase &&
    a.proofMin === b.proofMin &&
    a.recheckBuIds.length === b.recheckBuIds.length &&
    a.recheckBuIds.every((id, index) => id === b.recheckBuIds[index])
  );
}

/**
 * Menjadikan (atau menyegarkan) baris sebagai Cek ulang. Konversi pertama: item dikunci ke item catatan, BU bawaan =
 * BU saat ini bila termasuk `recheckBuIds` (selain itu kosong), stiker bawaan KOSONG (pengguna mencentang yang
 * ditempel), Sample dimatikan, hasil/pesan lama dibuang. Penyegaran (draf dimuat ulang): pilihan pengguna (BU, stiker,
 * Sample, hasil) dipertahankan; BU yang tak lagi sah dikembalikan ke bawaan.
 */
function becomeRecheck(row: StagingRow, existing: StagingExisting): StagingRow {
  const refresh = row.existing !== undefined;
  const { unresolved, proofMin: _stale, existing: _old, result, message, ...rest } = row;
  const keepsBu = refresh && row.buId !== '' && existing.recheckBuIds.includes(row.buId);
  const defaultBu = existing.recheckBuIds.includes(existing.buId);
  const kept = unresolved?.filter((key) => key === 'location');
  return {
    ...rest,
    ...(refresh && result ? { result } : {}),
    ...(refresh && message !== undefined ? { message } : {}),
    existing,
    itemId: existing.itemId,
    itemLabel: existing.itemLabel,
    buId: keepsBu ? row.buId : defaultBu ? existing.buId : '',
    buLabel: keepsBu ? row.buLabel : defaultBu ? existing.buCode : '',
    ...(existing.proofMin > 0 ? { proofMin: existing.proofMin } : {}),
    ...(refresh ? {} : { sample: false, stickers: [] }),
    ...(kept && kept.length > 0 ? { unresolved: kept } : {}),
  };
}

/**
 * Menerapkan hasil `serials.lookupMany` atas serial yang ditanyakan (`queried`, bentuk ternormalisasi): serial yang
 * sudah ada menjadikan barisnya Cek ulang atau menyegarkan datanya; serial yang tak ada lagi membuang penanda
 * `existing`. Mengembalikan larik yang SAMA bila tak ada yang berubah.
 */
export function applyLookup(
  rows: readonly StagingRow[],
  queried: ReadonlySet<string>,
  found: readonly SerialExistingDto[],
): StagingRow[] {
  const byKey = new Map(found.map((dto) => [normalizeSerial(dto.serial), toExisting(dto)]));
  let changed = false;
  const next = rows.map((row) => {
    const key = normalizeSerial(row.serial);
    if (!queried.has(key)) return row;
    const existing = byKey.get(key);
    if (!existing) {
      if (!row.existing) return row;
      changed = true;
      const { existing: _gone, ...rest } = row;
      return rest;
    }
    if (row.existing && sameExisting(row.existing, existing)) return row;
    changed = true;
    return becomeRecheck(row, existing);
  });
  return changed ? next : (rows as StagingRow[]);
}

/** Kunci "baris + serialnya": baris baru (id baru) atau serial yang diganti = pasangan baru yang perlu ditanyakan. */
export function lookupKeyOf(row: StagingRow): string {
  return `${row.clientId} ${normalizeSerial(row.serial)}`;
}

/** Baris yang pasangan (id, serial)-nya belum ada di `done` (belum ditanyakan ke `serials.lookupMany`). */
export function rowsToLookup(rows: readonly StagingRow[], done: ReadonlySet<string>): StagingRow[] {
  return rows.filter((row) => normalizeSerial(row.serial) !== '' && !done.has(lookupKeyOf(row)));
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

/** `created` dan `rechecked` (sudah tersimpan) dibuang dari tabel; hasil lain ditandai pada barisnya; urutan dipertahankan. */
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
    if (entry.result === 'created' || entry.result === 'rechecked') continue;
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
