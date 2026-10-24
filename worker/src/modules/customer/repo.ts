import type { ItemStatus } from '@shared/rpc';
import type { Env } from '@worker/core/env';

export interface CustomerRecord {
  id: string;
  name: string;
  /** `customerKey(name)`; unik. */
  key: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

interface CustomerRow {
  id: string;
  name: string;
  key: string;
  status: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

const CUSTOMER_COLUMNS = 'id, name, key, status, created_at, updated_at, updated_by';

function toCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id.trim(),
    name: row.name.trim(),
    key: row.key.trim(),
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function listCustomers(env: Env): Promise<CustomerRecord[]> {
  const result = await env.DB.prepare(
    `SELECT ${CUSTOMER_COLUMNS} FROM customers`,
  ).all<CustomerRow>();
  return result.results.map(toCustomer).filter((c) => c.id !== '' && c.key !== '');
}

export async function findCustomerByKey(env: Env, key: string): Promise<CustomerRecord | null> {
  const row = await env.DB.prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE key = ?`)
    .bind(key)
    .first<CustomerRow>();
  return row ? toCustomer(row) : null;
}

export function insertCustomerStmt(db: D1Database, customer: CustomerRecord): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO customers (${CUSTOMER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      customer.id,
      customer.name,
      customer.key,
      customer.status,
      customer.createdAt,
      customer.updatedAt,
      customer.updatedBy,
    );
}

export function updateCustomerStmt(db: D1Database, customer: CustomerRecord): D1PreparedStatement {
  return db
    .prepare(
      'UPDATE customers SET name = ?, key = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(
      customer.name,
      customer.key,
      customer.status,
      customer.updatedAt,
      customer.updatedBy,
      customer.id,
    );
}
