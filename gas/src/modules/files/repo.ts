import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';

export const FILES_TABLE: TableSchema = {
  sheetName: 'files',
  columns: [
    'id',
    'drive_id',
    'mime',
    'size',
    'width',
    'height',
    'owner_type',
    'owner_id',
    'created_at',
    'created_by',
  ],
};

export interface FileRecord {
  rowNumber: number;
  id: string;
  driveId: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  ownerType: string;
  ownerId: string;
  createdAt: string;
  createdBy: string;
}
export type NewFileRecord = Omit<FileRecord, 'rowNumber'>;

function toFileRecord_(rowNumber: number, data: RowData): FileRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    driveId: (data.drive_id ?? '').trim(),
    mime: (data.mime ?? '').trim(),
    size: Number(data.size) || 0,
    width: Number(data.width) || 0,
    height: Number(data.height) || 0,
    ownerType: (data.owner_type ?? '').trim(),
    ownerId: (data.owner_id ?? '').trim(),
    createdAt: data.created_at ?? '',
    createdBy: data.created_by ?? '',
  };
}

function fromFileRecord_(file: NewFileRecord): RowData {
  return {
    id: file.id,
    drive_id: file.driveId,
    mime: file.mime,
    size: String(file.size),
    width: String(file.width),
    height: String(file.height),
    owner_type: file.ownerType,
    owner_id: file.ownerId,
    created_at: file.createdAt,
    created_by: file.createdBy,
  };
}

export function listFiles_(): FileRecord[] {
  return readTable_(FILES_TABLE)
    .rows.map(({ rowNumber, data }) => toFileRecord_(rowNumber, data))
    .filter((file) => file.id !== '' && file.driveId !== '');
}

export function insertFile_(file: NewFileRecord): void {
  insertRow_(FILES_TABLE, fromFileRecord_(file));
}

export function updateFile_(file: FileRecord): void {
  updateRow_(FILES_TABLE, file.rowNumber, fromFileRecord_(file));
}
