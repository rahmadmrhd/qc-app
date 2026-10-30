import type { ItemStatus } from '@shared/rpc';
import type { Env } from '@worker/core/env';
import { cached, touchCache } from '@worker/core/mem-cache';

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

/**
 * Seluruh customer. Bawaan memakai cache memori isolate (`mem-cache.ts`, TTL <= 15 dtk); `fresh: true`
 * membaca langsung dari D1 dan dipakai jalur yang memutuskan penulisan (ganti nama/status).
 */
/** Kueri seluruh customer untuk digabung ke `batch()` pemanggil (tanpa cache); lihat `customersFromResult`. */
export function customersStatement(env: Env): D1PreparedStatement {
  return env.DB.prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers`);
}

/** Hasil `customersStatement` sebagai rekaman customer. */
export function customersFromResult(result: { results: unknown[] }): CustomerRecord[] {
  return (result.results as CustomerRow[])
    .map(toCustomer)
    .filter((c) => c.id !== '' && c.key !== '');
}

export async function listCustomers(
  env: Env,
  options: { fresh?: boolean } = {},
): Promise<CustomerRecord[]> {
  const load = async (): Promise<CustomerRecord[]> => {
    return customersFromResult(await customersStatement(env).all<CustomerRow>());
  };
  return options.fresh ? load() : cached(env, 'customers:all', load);
}

export async function findCustomerByKey(env: Env, key: string): Promise<CustomerRecord | null> {
  const row = await env.DB.prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE key = ?`)
    .bind(key)
    .first<CustomerRow>();
  return row ? toCustomer(row) : null;
}

export function insertCustomerStmt(db: D1Database, customer: CustomerRecord): D1PreparedStatement {
  touchCache('customers');
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

/** Beberapa customer baru dalam `INSERT` banyak-baris (7 parameter per baris, maks. 14 baris per pernyataan). */
export function insertCustomerStmts(
  db: D1Database,
  customers: readonly CustomerRecord[],
): D1PreparedStatement[] {
  const perStatement = 14;
  const statements: D1PreparedStatement[] = [];
  for (let from = 0; from < customers.length; from += perStatement) {
    const chunk = customers.slice(from, from + perStatement);
    touchCache('customers');
    statements.push(
      db
        .prepare(
          `INSERT INTO customers (${CUSTOMER_COLUMNS}) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        )
        .bind(
          ...chunk.flatMap((customer) => [
            customer.id,
            customer.name,
            customer.key,
            customer.status,
            customer.createdAt,
            customer.updatedAt,
            customer.updatedBy,
          ]),
        ),
    );
  }
  return statements;
}

export function updateCustomerStmt(db: D1Database, customer: CustomerRecord): D1PreparedStatement {
  touchCache('customers');
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
