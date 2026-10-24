import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { HandoverStoredStatus } from '@shared/handover';
import type { CheckState } from '@shared/handover-checklist';
import type { HandoverCommentDto } from '@shared/rpc';

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
    'checks',
    'comments',
    'completed_at',
    'completed_by',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
};

export type StoredComment = Omit<HandoverCommentDto, 'stale'>;

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
  /** Centang QC pada butir checklist (JSON di sheet). */
  checks: CheckState[];
  comments: StoredComment[];
  /** Penanda Selesai untuk task tanpa checklist (Mark done). */
  completedAt: string;
  completedBy: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewHandoverRecord = Omit<HandoverRecord, 'rowNumber'>;

function parseJsonArray_(text: string | undefined): unknown[] {
  if (!text || text.trim() === '') return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function asObject_(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str_(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseChecks_(text: string | undefined): CheckState[] {
  const out: CheckState[] = [];
  for (const entry of parseJsonArray_(text)) {
    const o = asObject_(entry);
    if (!o || typeof o.text !== 'string') continue;
    const occurrence =
      typeof o.occurrence === 'number' && Number.isInteger(o.occurrence) && o.occurrence >= 0
        ? o.occurrence
        : 0;
    out.push({ text: o.text, by: str_(o.by), at: str_(o.at), occurrence });
  }
  return out;
}

function parseComments_(text: string | undefined): StoredComment[] {
  const out: StoredComment[] = [];
  for (const entry of parseJsonArray_(text)) {
    const o = asObject_(entry);
    if (!o || typeof o.id !== 'string' || typeof o.quote !== 'string') continue;
    out.push({
      id: o.id,
      quote: o.quote,
      before: str_(o.before),
      after: str_(o.after),
      body: str_(o.body),
      author: str_(o.author),
      at: str_(o.at),
    });
  }
  return out;
}

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
    checks: parseChecks_(data.checks),
    comments: parseComments_(data.comments),
    completedAt: data.completed_at ?? '',
    completedBy: data.completed_by ?? '',
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
    checks: JSON.stringify(handover.checks),
    comments: JSON.stringify(handover.comments),
    completed_at: handover.completedAt,
    completed_by: handover.completedBy,
    created_at: handover.createdAt,
    created_by: handover.createdBy,
    updated_at: handover.updatedAt,
    updated_by: handover.updatedBy,
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
