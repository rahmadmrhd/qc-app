// Keluar Gudang (WH): batas dan fungsi murni bersama server dan web. Murni, tanpa API runtime/DOM.

import { hasControlChars } from './text';

export const WAREHOUSE_LIMITS = {
  orderNumberMax: 40,
  noteMax: 1000,
  /** Sama dengan `SERIAL_LIMITS.batchRows` (dijaga tes paritas). */
  chunkMax: 200,
  handoverLinksMax: 20,
  lookupMax: 200,
  candidatesDefault: 5,
  candidatesMax: 20,
  listDefault: 50,
  listMax: 100,
  /** Serial per halaman detail pengeluaran. */
  dispatchSerialsMax: 500,
  staleDays: 7,
  itemOptionsMax: 50,
} as const;

export type WarehouseDispatchStatus = 'pending' | 'done' | 'cancelled';
export type WarehouseDispatchMode = 'clipboard';
/** Tujuan pencatatan WH: `order` = keluar ke satu SO (bawaan), `ready` = hanya mencapai target barang ready (tanpa SO). */
export type WarehouseSubmitMode = 'order' | 'ready';

/** Nilai `data.source` pada kejadian `recorded` serial yang dibuat dari Keluar Gudang. */
export const WAREHOUSE_SOURCE = 'warehouse';

/** No SO: spasi pinggir dibuang, isi tidak diubah. */
export function normalizeOrderNumber(raw: string): string {
  return raw.trim();
}

export function orderNumberProblem(
  normalized: string,
): 'empty' | 'too_long' | 'control_chars' | null {
  if (normalized === '') return 'empty';
  if ([...normalized].length > WAREHOUSE_LIMITS.orderNumberMax) return 'too_long';
  if (hasControlChars(normalized)) return 'control_chars';
  return null;
}

/** Kunci keunikan No SO (tanpa beda huruf besar/kecil). */
export function orderKey(normalized: string): string {
  return normalizeOrderNumber(normalized).toLowerCase();
}

/** Jumlah potongan; total 0 = 0. */
export function chunkCountOf(total: number, chunkSize: number): number {
  if (total <= 0 || chunkSize <= 0) return 0;
  return Math.ceil(total / chunkSize);
}

/** Jumlah baris pada potongan ke-`index` (0 bila di luar jangkauan). */
export function chunkRowsOf(total: number, chunkSize: number, index: number): number {
  if (index < 0 || index >= chunkCountOf(total, chunkSize)) return 0;
  return Math.min(chunkSize, total - index * chunkSize);
}

/** Teks clipboard: satu SN per baris, tanpa baris kosong di akhir. */
export function clipboardText(serials: readonly string[]): string {
  return serials.join('\n');
}

/** Pesan kejadian serial yang dibuat dari Keluar Gudang mode ready. */
export const WAREHOUSE_READY_NOTE = 'Dicatat Gudang · Ready';

/** Pesan kejadian serial yang dibuat dari Keluar Gudang. */
export function warehouseRecordedNote(orderNumber: string): string {
  return `Dicatat Gudang · SO ${orderNumber}`;
}
