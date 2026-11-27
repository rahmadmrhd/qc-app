import type { WarehouseSerialDto } from '@shared/contract';
import { makeExistingRow } from './draft';
import {
  EMPTY_FILTERS,
  readWarehouseDraft,
  type WarehouseDraft,
  writeWarehouseDraft,
} from './draft-store';

/** Baris draf form Catat Serial WH paling banyak (draf 5.000 baris masih jauh di bawah kuota penyimpanan). */
export const HAND_OFF_ROWS_MAX = 5000;

export interface HandOffRow {
  serialId: string;
  serial: string;
  itemId: string;
  buId: string;
  /** Rujukan terbaru serial (hasil `serialWarehouse.lookup`); tanpa ini dibuat rujukan minimal. */
  snapshot?: WarehouseSerialDto;
}

function minimalSnapshot(row: HandOffRow): WarehouseSerialDto {
  return {
    id: row.serialId,
    serial: row.serial,
    itemId: row.itemId,
    itemLabel: '',
    buId: row.buId,
    buCode: '',
    locationId: '',
    locationName: '',
    testDate: '',
    status: 'good',
    custody: 'qc',
    whCreated: false,
    needsProof: false,
    dispatches: [],
    recorded: true,
  };
}

/**
 * Menulis serial Stok Ready yang dipilih ke draf form Catat Serial WH (`qc.serialwh.draft:<email>`) sebagai baris
 * `existing`. Draf yang sudah ada tidak ditimpa: baris ditambahkan di akhir dan serial ganda dilewati. Melempar `Error`
 * berpesan bagi pengguna bila draf sedang dikirim, Tipe atau BU campur, batas baris terlampaui, atau draf tak dapat
 * ditulis. Pemanggil menavigasi ke `/serial/gudang` setelahnya.
 */
export function handOffToDispatch(rows: readonly HandOffRow[], email: string): void {
  const draft = readWarehouseDraft(email);
  if (draft?.submission) {
    throw new Error(
      'Ada pengeluaran yang belum selesai di form Catat Serial WH. Selesaikan atau batalkan dulu.',
    );
  }
  const current = draft?.rows ?? [];
  const known = new Set(current.map((row) => row.serial));
  const fresh: HandOffRow[] = [];
  for (const row of rows) {
    if (known.has(row.serial)) continue;
    known.add(row.serial);
    fresh.push(row);
  }
  if (fresh.length === 0) return;

  const first = fresh[0] as HandOffRow;
  if (fresh.some((row) => row.itemId !== first.itemId)) {
    throw new Error('Pilih serial dari satu Tipe saja untuk satu pengeluaran.');
  }
  if (fresh.some((row) => row.buId !== first.buId)) {
    throw new Error('Pilih serial dari satu BU saja untuk satu pengeluaran.');
  }
  const keepDraftItem = current.length > 0 && draft !== null && draft.itemId !== '';
  if (keepDraftItem && draft.itemId !== first.itemId) {
    throw new Error('Tipe serial berbeda dari draf di form Catat Serial WH.');
  }
  if (current.length + fresh.length > HAND_OFF_ROWS_MAX) {
    throw new Error('Terlalu banyak serial untuk satu pengeluaran');
  }

  const base = draft?.filters ?? EMPTY_FILTERS;
  const next: WarehouseDraft = {
    v: 1,
    itemId: keepDraftItem ? draft.itemId : first.itemId,
    filters: base.buId === '' ? { ...base, buId: first.buId } : base,
    rows: [
      ...current,
      ...fresh.map((row) => makeExistingRow(row.snapshot ?? minimalSnapshot(row))),
    ],
    ...(draft?.skipped ? { skipped: draft.skipped } : {}),
  };
  if (!writeWarehouseDraft(email, next)) {
    throw new Error('Draf tidak dapat disimpan di perangkat ini.');
  }
}
