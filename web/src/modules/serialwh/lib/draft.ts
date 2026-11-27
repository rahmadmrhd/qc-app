import type { WarehouseSerialDto, WarehouseSubmitRow } from '@shared/contract';
import { newUuid } from '@/lib/uuid';
import { trimSnapshot, type WarehouseDraft, type WarehouseDraftRow } from './draft-store';
import { rowTestDate } from './warnings';

/** Kunci baris di tabel/pilihan: id serial (sudah ada) atau `new:<clientId>` (draf baru). */
export function rowKey(row: WarehouseDraftRow): string {
  return row.kind === 'existing' ? row.id : `new:${row.clientId}`;
}

export function makeExistingRow(snapshot: WarehouseSerialDto): WarehouseDraftRow {
  return {
    kind: 'existing',
    id: snapshot.id,
    serial: snapshot.serial,
    snapshot: trimSnapshot(snapshot),
  };
}

export interface NewRowDefaults {
  serial: string;
  itemId: string;
  buId: string;
  locationId: string;
  testDate: string;
}

/** Baris baru: `clientId` dibuat SEKALI di sini dan dipakai ulang selamanya (kunci idempoten server). */
export function makeNewRow(defaults: NewRowDefaults): WarehouseDraftRow {
  return { kind: 'new', clientId: newUuid(), ...defaults };
}

/** Tambah baris di AKHIR (urutan scan = urutan `seq` dan clipboard); serial yang sudah ada diabaikan. */
export function addRow(
  rows: readonly WarehouseDraftRow[],
  row: WarehouseDraftRow,
): readonly WarehouseDraftRow[] {
  if (rows.some((existing) => existing.serial === row.serial)) return rows;
  return [...rows, row];
}

export function removeRows(
  rows: readonly WarehouseDraftRow[],
  keys: ReadonlySet<string>,
): WarehouseDraftRow[] {
  return rows.filter((row) => !keys.has(rowKey(row)));
}

export type MissingField = 'item' | 'bu' | 'location' | 'testDate';

/** Isian bawaan yang masih kosong untuk membuat serial baru dari scan. */
export function missingDefaults(
  itemId: string,
  filters: WarehouseDraft['filters'],
): MissingField[] {
  const missing: MissingField[] = [];
  if (itemId === '') missing.push('item');
  if (filters.buId === '') missing.push('bu');
  if (filters.locationId === '') missing.push('location');
  if (filters.testDate === '') missing.push('testDate');
  return missing;
}

export function missingMessage(missing: readonly MissingField[]): string {
  if (missing.includes('item')) return 'Pilih Item dulu';
  const names = missing.map((name) =>
    name === 'bu' ? 'BU' : name === 'location' ? 'Lokasi' : 'Tanggal uji',
  );
  if (names.length === 0) return '';
  if (names.length === 1) return `Isi ${names[0]} dulu`;
  return `Isi ${names.slice(0, -1).join(', ')} dan ${names[names.length - 1]} dulu`;
}

export interface DraftSummary {
  total: number;
  newCount: number;
  existingCount: number;
  /** Rentang tanggal uji (kosong bila tak ada baris). */
  testDateFrom: string;
  testDateTo: string;
}

export function summarizeRows(rows: readonly WarehouseDraftRow[]): DraftSummary {
  let newCount = 0;
  let from = '';
  let to = '';
  for (const row of rows) {
    if (row.kind === 'new') newCount += 1;
    const date = rowTestDate(row);
    if (date === '') continue;
    if (from === '' || date < from) from = date;
    if (to === '' || date > to) to = date;
  }
  return {
    total: rows.length,
    newCount,
    existingCount: rows.length - newCount,
    testDateFrom: from,
    testDateTo: to,
  };
}

/** Baris kiriman server, urutan draf (= `seq`). */
export function toSubmitRows(rows: readonly WarehouseDraftRow[]): WarehouseSubmitRow[] {
  return rows.map((row) =>
    row.kind === 'existing'
      ? { kind: 'existing', serialId: row.id, serial: row.serial }
      : {
          kind: 'new',
          clientId: row.clientId,
          serial: row.serial,
          locationId: row.locationId,
          testDate: row.testDate,
        },
  );
}

/** Pengeluaran sedang berjalan: baris dan urutannya dibekukan (mengubahnya merusak `total` dan `header_hash`). */
export function isFrozen(draft: Pick<WarehouseDraft, 'submission'>): boolean {
  return draft.submission !== undefined;
}
