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

/** Jenis pengeluaran Gudang: `order` = Penjualan (keluar ke SO), `ready` = Ready Stock (tanpa SO). */
export type WarehouseDispatchKind = 'order' | 'ready';

export const WAREHOUSE_KIND_LABEL: Record<WarehouseDispatchKind, string> = {
  order: 'Penjualan',
  ready: 'Ready Stock',
};

/** Awalan nomor riwayat: `OUT` (Penjualan) dan `RS` (Ready Stock). */
export function dispatchNumberPrefix(kind: WarehouseDispatchKind): 'OUT' | 'RS' {
  return kind === 'ready' ? 'RS' : 'OUT';
}

/**
 * Nomor riwayat Gudang `<OUT|RS>/<kode BU>/<YYMM>-<urutan>`: urutan per (awalan, BU, bulan WIB hari dibuat), minimal 4
 * digit (lebih dari 9999 menjadi lebih panjang). Kode BU tak dapat diubah dan berpola `^[A-Z0-9-]+$`.
 */
export function dispatchNumber(
  kind: WarehouseDispatchKind,
  buCode: string,
  period: string,
  sequence: number,
): string {
  return `${dispatchNumberPrefix(kind)}/${buCode}/${period}-${String(sequence).padStart(4, '0')}`;
}

/** Batas Stok Ready per kardus: pcs per kardus (`items.box_size`) dan nomor kardus. */
/** `pickMax` = batas "Pilih N unit" (`pickCount`) dan batas oper ke draf form Catat Serial WH. */
export const WAREHOUSE_BOX_LIMITS = { sizeMax: 1000, numberMax: 999999, pickMax: 5000 } as const;

/**
 * Membagi `count` serial berurutan ke kardus: lebih dulu mengisi kardus terbuka `carry` (sudah berisi `used` unit),
 * lalu kardus baru bernomor naik mulai `startNumber`. `take` = jumlah serial per kardus.
 */
export function assignBoxes(input: {
  startNumber: number;
  size: number;
  carry?: { number: number; used: number };
  count: number;
}): { number: number; take: number }[] {
  const { startNumber, size, carry, count } = input;
  const out: { number: number; take: number }[] = [];
  let left = count;
  if (left <= 0 || size <= 0) return out;
  if (carry && carry.used < size) {
    const take = Math.min(left, size - carry.used);
    out.push({ number: carry.number, take });
    left -= take;
  }
  let number = startNumber;
  while (left > 0) {
    const take = Math.min(left, size);
    out.push({ number, take });
    left -= take;
    number += 1;
  }
  return out;
}

/** `full` = kardus terisi penuh (sisa >= kapasitas), selain itu `loose` (ecer). */
export function boxKindOf(remaining: number, capacity: number): 'full' | 'loose' {
  return remaining >= capacity ? 'full' : 'loose';
}

/** Memilih `count` serial menurut nomor kardus naik; kardus `full` lebih dulu, lalu `loose`. */
export function pickByOrder(
  boxes: readonly {
    id: string;
    number: number;
    kind: 'full' | 'loose';
    serialIds: readonly string[];
  }[],
  count: number,
): string[] {
  const ordered = [...boxes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'full' ? -1 : 1;
    return a.number - b.number;
  });
  const out: string[] = [];
  for (const box of ordered) {
    for (const id of box.serialIds) {
      if (out.length >= count) return out;
      out.push(id);
    }
  }
  return out;
}

/** Teks clipboard Stok Ready: `Kardus<TAB>Serial` per baris (`\n`, tanpa CRLF). */
export function readyStockClipboard(rows: readonly { box: number; serial: string }[]): string {
  // Serial berawalan rumus (`=`, `+`, `-`, `@`) diberi apostrof agar tidak dijalankan sebagai rumus di spreadsheet.
  const safe = (serial: string): string => (/^[=+\-@]/.test(serial) ? `'${serial}` : serial);
  return ['Kardus\tSerial', ...rows.map((r) => `${r.box}\t${safe(r.serial)}`)].join('\n');
}
