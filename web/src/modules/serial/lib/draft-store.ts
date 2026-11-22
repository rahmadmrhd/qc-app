import {
  SERIAL_LIMITS,
  SERIAL_PROOF_LIMITS,
  SERIAL_STATUSES,
  type SerialStatus,
} from '@shared/serials';
import type { StagingExisting, StagingRow, StagingSticker } from './draft';
import { type ProofPhotoRef, proofThumbUrl } from './proof-source';

const PREFIX = 'qc.serial.draft:';

/** Pesan baris draf 5b yang berstatus selain Lolos (pengguna diarahkan ke Lapor Rusak). */
export const NOT_GOOD_MESSAGE =
  'Draf lama berstatus bukan Lolos: Serial Number bermasalah dicatat lewat Lapor Rusak. Hapus baris ini lalu laporkan di sana.';

const key = (ownerKey: string) => `${PREFIX}${ownerKey}`;

/**
 * Setelah `clearAllDrafts` (keluar), penulisan draf dihentikan sampai `resumeDraftWrites`: halaman Catat Serial yang
 * dilepas oleh navigasi keluar akan menyimpan isi terakhirnya di cleanup, dan itu tidak boleh menghidupkan draf lagi.
 */
let writesSuspended = false;

/** Memulai sesi kerja baru (halaman Catat Serial dibuka): penulisan draf kembali diizinkan. */
export function resumeDraftWrites(): void {
  writesSuspended = false;
}

/** `true` setelah keluar (draf dibuang dan penulisan ditahan) sampai halaman Catat Serial dibuka lagi. */
export function draftWritesSuspended(): boolean {
  return writesSuspended;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(source: Record<string, unknown>, name: string): string | null {
  const value = Object.hasOwn(source, name) ? source[name] : undefined;
  return typeof value === 'string' ? value : null;
}

function readStickers(value: unknown): StagingSticker[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const list: StagingSticker[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const stickerId = text(entry, 'stickerId');
    const name = text(entry, 'name');
    const qty = Object.hasOwn(entry, 'qty') ? entry.qty : undefined;
    if (stickerId === null || name === null || typeof qty !== 'number' || !Number.isInteger(qty)) {
      return undefined;
    }
    list.push({ stickerId, name, qty });
  }
  return list;
}

/** Foto bukti tersimpan: entri rusak dibuang satu per satu, maksimum `perEntryMax`; tanpa field (draf lama) = tanpa foto. */
function readProofPhotos(value: unknown): ProofPhotoRef[] {
  if (!Array.isArray(value)) return [];
  const photos: ProofPhotoRef[] = [];
  for (const entry of value) {
    if (photos.length >= SERIAL_PROOF_LIMITS.perEntryMax) break;
    if (!isRecord(entry)) continue;
    const id = text(entry, 'id');
    const mime = text(entry, 'mime');
    const size = Object.hasOwn(entry, 'size') ? entry.size : undefined;
    if (id === null || id === '' || mime === null) continue;
    if (typeof size !== 'number' || !Number.isFinite(size)) continue;
    // `thumbUrl` tersimpan diabaikan: selalu diturunkan dari id (draf yang diubah tak boleh menunjuk ke URL lain).
    photos.push({ id, mime, size, thumbUrl: proofThumbUrl(id) });
  }
  return photos;
}

function isSerialStatus(value: unknown): value is SerialStatus {
  return typeof value === 'string' && (SERIAL_STATUSES as readonly string[]).includes(value);
}

/**
 * Penanda Cek ulang tersimpan (`existing`). Draf lama tidak punya field ini (= baris biasa); bentuk yang rusak
 * dibuang seluruhnya (baris dipulihkan sebagai baris biasa dan dicek ulang ke server saat halaman dibuka).
 */
function readExisting(value: unknown): StagingExisting | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value, 'id');
  const itemId = text(value, 'itemId');
  const itemLabel = text(value, 'itemLabel');
  const buId = text(value, 'buId');
  const buCode = text(value, 'buCode');
  const status = Object.hasOwn(value, 'status') ? value.status : undefined;
  const hasOpenCase = Object.hasOwn(value, 'hasOpenCase') ? value.hasOpenCase : undefined;
  const recheckBuIds = Object.hasOwn(value, 'recheckBuIds') ? value.recheckBuIds : undefined;
  const proofMin = Object.hasOwn(value, 'proofMin') ? value.proofMin : undefined;
  if (id === null || itemId === null || itemLabel === null || buId === null || buCode === null) {
    return undefined;
  }
  if (!isSerialStatus(status) || typeof hasOpenCase !== 'boolean') return undefined;
  if (!Array.isArray(recheckBuIds) || !recheckBuIds.every((entry) => typeof entry === 'string')) {
    return undefined;
  }
  if (typeof proofMin !== 'number' || !Number.isInteger(proofMin) || proofMin < 0 || proofMin > 5) {
    return undefined;
  }
  return {
    id,
    itemId,
    itemLabel,
    buId,
    buCode,
    status,
    hasOpenCase,
    recheckBuIds: [...recheckBuIds],
    proofMin,
  };
}

const TEXT_FIELDS = [
  'clientId',
  'serial',
  'itemId',
  'itemLabel',
  'buId',
  'buLabel',
  'testDate',
  'locationId',
  'locationLabel',
  'note',
  'capturedAt',
] as const;

/** Memulihkan satu baris dari JSON tersimpan: hanya kolom dikenal dan bertipe benar; selain itu dibuang. */
function readRow(raw: unknown): StagingRow | null {
  if (!isRecord(raw)) return null;
  const values: Record<(typeof TEXT_FIELDS)[number], string> = {
    clientId: '',
    serial: '',
    itemId: '',
    itemLabel: '',
    buId: '',
    buLabel: '',
    testDate: '',
    locationId: '',
    locationLabel: '',
    note: '',
    capturedAt: '',
  };
  for (const name of TEXT_FIELDS) {
    const value = text(raw, name);
    if (value === null) return null;
    values[name] = value;
  }
  const sample = Object.hasOwn(raw, 'sample') ? raw.sample : undefined;
  if (typeof sample !== 'boolean') return null;
  const source = text(raw, 'source');
  if (source !== 'manual' && source !== 'countrylock') return null;
  // Draf 5b yang masih memuat baris berstatus selain Lolos: JANGAN dibuang diam-diam, pulihkan sebagai baris bermasalah
  // (sejalan dengan `.qcsn`/`saveBatch`: Serial Number bermasalah kini dicatat lewat Lapor Rusak). Draf lama tanpa
  // kunci `status` tetap dipulihkan sebagai Lolos.
  const notGood = Object.hasOwn(raw, 'status') && raw.status !== 'good';
  const stickers = readStickers(Object.hasOwn(raw, 'stickers') ? raw.stickers : null);
  if (stickers === undefined) return null;
  const row: StagingRow = {
    ...values,
    sample,
    source,
    stickers,
    proofPhotos: readProofPhotos(Object.hasOwn(raw, 'proofPhotos') ? raw.proofPhotos : undefined),
    selected: false,
  };
  const proofMin = Object.hasOwn(raw, 'proofMin') ? raw.proofMin : undefined;
  if (typeof proofMin === 'number' && Number.isInteger(proofMin) && proofMin > 0 && proofMin <= 5) {
    row.proofMin = proofMin;
  }
  const existing = readExisting(Object.hasOwn(raw, 'existing') ? raw.existing : undefined);
  if (existing) row.existing = existing;
  const result = text(raw, 'result');
  if (notGood) {
    row.result = 'invalid';
    row.message = NOT_GOOD_MESSAGE;
  } else if (result === 'duplicate' || result === 'invalid' || result === 'error') {
    row.result = result;
    const message = text(raw, 'message');
    if (message !== null) row.message = message;
  }
  const unresolved = Object.hasOwn(raw, 'unresolved') ? raw.unresolved : undefined;
  if (Array.isArray(unresolved)) {
    const kept = unresolved.filter(
      (entry): entry is 'item' | 'location' | 'stickers' =>
        entry === 'item' || entry === 'location' || entry === 'stickers',
    );
    if (kept.length > 0) row.unresolved = kept;
  }
  return row;
}

/**
 * Memulihkan baris draft dari data mentah (JSON hasil `localStorage` atau snapshot SQLite desktop): bukan array = kosong,
 * entri rusak dibuang satu per satu, `clientId` ganda dibuang, dan dibatasi `SERIAL_LIMITS.tableRows`. Satu aturan untuk
 * semua penyimpanan draft.
 */
export function parseDraftRows(parsed: unknown): StagingRow[] {
  if (!Array.isArray(parsed)) return [];
  const rows: StagingRow[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (rows.length >= SERIAL_LIMITS.tableRows) break;
    const row = readRow(entry);
    if (row === null || seen.has(row.clientId)) continue;
    seen.add(row.clientId);
    rows.push(row);
  }
  return rows;
}

/** Draf tersimpan milik `ownerKey`; JSON rusak atau storage tak tersedia = tabel kosong. */
export function loadDraft(ownerKey: string): StagingRow[] {
  try {
    const raw = localStorage.getItem(key(ownerKey));
    if (raw === null) return [];
    return parseDraftRows(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** `false` bila gagal menyimpan (kuota penuh atau storage diblokir); tidak pernah melempar. */
export function saveDraft(ownerKey: string, rows: readonly StagingRow[]): boolean {
  if (writesSuspended) return true;
  try {
    if (rows.length === 0) {
      localStorage.removeItem(key(ownerKey));
      return true;
    }
    localStorage.setItem(key(ownerKey), JSON.stringify(rows.slice(0, SERIAL_LIMITS.tableRows)));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(ownerKey: string): void {
  try {
    localStorage.removeItem(key(ownerKey));
  } catch {
    // Storage diblokir.
  }
}

/** Membuang draf semua pemilik di perangkat ini (keluar dari aplikasi). */
export function clearAllDrafts(): void {
  writesSuspended = true;
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index);
      if (name?.startsWith(PREFIX)) keys.push(name);
    }
    for (const name of keys) localStorage.removeItem(name);
  } catch {
    // Storage diblokir.
  }
}
