import type { RowData, TableSchema } from '@gas/core/db';
import { deleteRow_, insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { HandoverStoredStatus } from '@shared/handover';

export const HANDOVERS_TABLE: TableSchema = {
  sheetName: 'handovers',
  columns: [
    'id',
    'number',
    'location_id',
    'customer_id',
    'customer_name',
    'note',
    'status',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
};

export const HANDOVER_LINES_TABLE: TableSchema = {
  sheetName: 'handover_lines',
  columns: ['id', 'handover_id', 'item_id', 'item_label', 'qty', 'done_qty', 'done_at', 'done_by'],
};

export interface HandoverRecord {
  rowNumber: number;
  id: string;
  number: string;
  locationId: string;
  customerId: string;
  /** Salinan nama customer saat task disimpan. */
  customerName: string;
  note: string;
  status: HandoverStoredStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewHandoverRecord = Omit<HandoverRecord, 'rowNumber'>;

export interface HandoverLineRecord {
  rowNumber: number;
  id: string;
  handoverId: string;
  itemId: string;
  /** Salinan "merk tipe" saat baris dibuat (FH9). */
  itemLabel: string;
  qty: number;
  doneQty: number;
  doneAt: string;
  doneBy: string;
}
export type NewHandoverLineRecord = Omit<HandoverLineRecord, 'rowNumber'>;

function toHandoverRecord_(rowNumber: number, data: RowData): HandoverRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    number: (data.number ?? '').trim(),
    locationId: (data.location_id ?? '').trim(),
    customerId: (data.customer_id ?? '').trim(),
    customerName: data.customer_name ?? '',
    note: data.note ?? '',
    status: (data.status ?? '').trim() === 'cancelled' ? 'cancelled' : 'open',
    createdAt: data.created_at ?? '',
    createdBy: data.created_by ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromHandoverRecord_(handover: NewHandoverRecord): RowData {
  return {
    id: handover.id,
    number: handover.number,
    location_id: handover.locationId,
    customer_id: handover.customerId,
    customer_name: handover.customerName,
    note: handover.note,
    status: handover.status,
    created_at: handover.createdAt,
    created_by: handover.createdBy,
    updated_at: handover.updatedAt,
    updated_by: handover.updatedBy,
  };
}

function toHandoverLineRecord_(rowNumber: number, data: RowData): HandoverLineRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    handoverId: (data.handover_id ?? '').trim(),
    itemId: (data.item_id ?? '').trim(),
    itemLabel: data.item_label ?? '',
    qty: Number(data.qty) || 0,
    doneQty: Number(data.done_qty) || 0,
    doneAt: data.done_at ?? '',
    doneBy: data.done_by ?? '',
  };
}

function fromHandoverLineRecord_(line: NewHandoverLineRecord): RowData {
  return {
    id: line.id,
    handover_id: line.handoverId,
    item_id: line.itemId,
    item_label: line.itemLabel,
    qty: String(line.qty),
    done_qty: String(line.doneQty),
    done_at: line.doneAt,
    done_by: line.doneBy,
  };
}

export function listHandovers_(): HandoverRecord[] {
  return readTable_(HANDOVERS_TABLE)
    .rows.map(({ rowNumber, data }) => toHandoverRecord_(rowNumber, data))
    .filter((handover) => handover.id !== '' && handover.number !== '');
}

export function insertHandover_(handover: NewHandoverRecord): void {
  insertRow_(HANDOVERS_TABLE, fromHandoverRecord_(handover));
}

export function updateHandover_(handover: HandoverRecord): void {
  updateRow_(HANDOVERS_TABLE, handover.rowNumber, fromHandoverRecord_(handover));
}

export function listHandoverLines_(): HandoverLineRecord[] {
  return readTable_(HANDOVER_LINES_TABLE)
    .rows.map(({ rowNumber, data }) => toHandoverLineRecord_(rowNumber, data))
    .filter((line) => line.id !== '' && line.handoverId !== '');
}

export function insertHandoverLine_(line: NewHandoverLineRecord): void {
  insertRow_(HANDOVER_LINES_TABLE, fromHandoverLineRecord_(line));
}

export function updateHandoverLine_(line: HandoverLineRecord): void {
  updateRow_(HANDOVER_LINES_TABLE, line.rowNumber, fromHandoverLineRecord_(line));
}

/**
 * Menghapus baris sheet: nomor baris di bawahnya bergeser, jadi hapus beberapa baris dari nomor TERBESAR ke
 * terkecil (urutkan menurun) dan jangan memakai `rowNumber` hasil baca sebelumnya setelah ada penghapusan.
 */
export function deleteHandoverLine_(line: HandoverLineRecord): void {
  deleteRow_(HANDOVER_LINES_TABLE, line.rowNumber);
}
