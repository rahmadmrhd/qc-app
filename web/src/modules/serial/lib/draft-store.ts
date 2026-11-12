import { SERIAL_LIMITS } from '@shared/serials';
import type { StagingRow, StagingSticker } from './draft';

const PREFIX = 'qc.serial.draft:';

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
  const stickers = readStickers(Object.hasOwn(raw, 'stickers') ? raw.stickers : null);
  if (stickers === undefined) return null;
  const row: StagingRow = { ...values, sample, source, stickers, selected: false };
  const result = text(raw, 'result');
  if (result === 'duplicate' || result === 'invalid' || result === 'error') {
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

/** Draf tersimpan milik `ownerKey`; JSON rusak atau storage tak tersedia = tabel kosong. */
export function loadDraft(ownerKey: string): StagingRow[] {
  try {
    const raw = localStorage.getItem(key(ownerKey));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
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
