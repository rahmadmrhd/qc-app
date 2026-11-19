import type { PendingEntry } from '@countrylock/pending';
import { normalizeSerial, SERIAL_LIMITS } from '@shared/serials';
import type { StagingRow } from '@/modules/serial/lib/draft';

/**
 * Entri pending lama (sebelum Catat Serial Number bersama) menjadi baris draft. `clientId` lama dipakai ulang agar
 * simpan ulang tetap idempoten; entri tanpa Tipe/lokasi ditandai `unresolved` dan dilengkapi pengguna di tabel.
 */
export function pendingToRow(entry: PendingEntry, newId: () => string): StagingRow {
  const itemId = entry.itemId ?? '';
  const locationId = entry.locationId ?? '';
  const unresolved: ('item' | 'location')[] = [];
  if (itemId === '') unresolved.push('item');
  if (locationId === '') unresolved.push('location');
  return {
    clientId: entry.clientId ?? newId(),
    serial: normalizeSerial(entry.serial),
    itemId,
    itemLabel: entry.tipe,
    buId: entry.buId ?? '',
    buLabel: entry.buLabel ?? '',
    testDate: entry.date,
    locationId,
    locationLabel: entry.locationLabel ?? '',
    sample: false,
    note: '',
    capturedAt: entry.timestamp,
    source: 'countrylock',
    stickers: null,
    proofPhotos: [],
    selected: false,
    ...(unresolved.length > 0 ? { unresolved } : {}),
  };
}

/**
 * Menggabungkan entri pending ke draft. Entri yang serial atau `clientId`-nya sudah ada di draft tidak ditambah tetapi
 * tetap `absorbed` (aman dihapus dari pending); yang tak muat (batas draft) tidak `absorbed` dan tetap di pending.
 */
export function mergePending(
  rows: readonly StagingRow[],
  entries: readonly PendingEntry[],
  newId: () => string,
): { rows: StagingRow[]; absorbed: PendingEntry[] } {
  const serials = new Set(rows.map((row) => normalizeSerial(row.serial)));
  const ids = new Set(rows.map((row) => row.clientId));
  const next = [...rows];
  const absorbed: PendingEntry[] = [];
  for (const entry of entries) {
    const row = pendingToRow(entry, newId);
    if (serials.has(row.serial) || ids.has(row.clientId)) {
      absorbed.push(entry);
      continue;
    }
    if (next.length >= SERIAL_LIMITS.tableRows) continue;
    serials.add(row.serial);
    ids.add(row.clientId);
    next.push(row);
    absorbed.push(entry);
  }
  return { rows: next, absorbed };
}
