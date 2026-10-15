import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { ItemStatus } from '@shared/rpc';

export const CUSTOMERS_TABLE: TableSchema = {
  sheetName: 'customers',
  columns: ['id', 'name', 'key', 'status', 'created_at', 'updated_at', 'updated_by'],
};

export interface CustomerRecord {
  rowNumber: number;
  id: string;
  name: string;
  /** `customerKey(name)`; unik. */
  key: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewCustomerRecord = Omit<CustomerRecord, 'rowNumber'>;

function toCustomerRecord_(rowNumber: number, data: RowData): CustomerRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    name: (data.name ?? '').trim(),
    key: (data.key ?? '').trim(),
    status: (data.status ?? '').trim() === 'inactive' ? 'inactive' : 'active',
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromCustomerRecord_(customer: NewCustomerRecord): RowData {
  return {
    id: customer.id,
    name: customer.name,
    key: customer.key,
    status: customer.status,
    created_at: customer.createdAt,
    updated_at: customer.updatedAt,
    updated_by: customer.updatedBy,
  };
}

export function listCustomers_(): CustomerRecord[] {
  return readTable_(CUSTOMERS_TABLE)
    .rows.map(({ rowNumber, data }) => toCustomerRecord_(rowNumber, data))
    .filter((customer) => customer.id !== '' && customer.key !== '');
}

export function insertCustomer_(customer: NewCustomerRecord): void {
  insertRow_(CUSTOMERS_TABLE, fromCustomerRecord_(customer));
}

export function updateCustomer_(customer: CustomerRecord): void {
  updateRow_(CUSTOMERS_TABLE, customer.rowNumber, fromCustomerRecord_(customer));
}
