import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { ItemStatus } from '@shared/rpc';

export const BRANDS_TABLE: TableSchema = {
  sheetName: 'brands',
  sharedCache: true,
  columns: [
    'id',
    'external_id',
    'name',
    'key',
    'status',
    'sync_rev',
    'created_at',
    'updated_at',
    'updated_by',
  ],
};

export interface BrandRecord {
  rowNumber: number;
  id: string;
  /** Id MySQL (diisi sinkronisasi di Fase B2). */
  externalId: string;
  name: string;
  /** `normalizeKey(name)`; unik. */
  key: string;
  status: ItemStatus;
  syncRev: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewBrandRecord = Omit<BrandRecord, 'rowNumber'>;

function toBrandRecord_(rowNumber: number, data: RowData): BrandRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    externalId: (data.external_id ?? '').trim(),
    name: (data.name ?? '').trim(),
    key: (data.key ?? '').trim(),
    status: (data.status ?? '').trim() === 'inactive' ? 'inactive' : 'active',
    syncRev: Number(data.sync_rev) || 0,
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromBrandRecord_(brand: NewBrandRecord): RowData {
  return {
    id: brand.id,
    external_id: brand.externalId,
    name: brand.name,
    key: brand.key,
    status: brand.status,
    sync_rev: String(brand.syncRev),
    created_at: brand.createdAt,
    updated_at: brand.updatedAt,
    updated_by: brand.updatedBy,
  };
}

export function listBrands_(): BrandRecord[] {
  return readTable_(BRANDS_TABLE)
    .rows.map(({ rowNumber, data }) => toBrandRecord_(rowNumber, data))
    .filter((brand) => brand.id !== '' && brand.key !== '');
}

export function insertBrand_(brand: NewBrandRecord): void {
  insertRow_(BRANDS_TABLE, fromBrandRecord_(brand));
}

export function updateBrand_(brand: BrandRecord): void {
  updateRow_(BRANDS_TABLE, brand.rowNumber, fromBrandRecord_(brand));
}
