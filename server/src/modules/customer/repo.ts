import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { deletedWhere, liveWhere } from '@server/core/soft-delete';
import type { ItemStatus } from '@shared/contract';

export interface CustomerRecord {
  id: string;
  name: string;
  /** `customerKey(name)`; unik. */
  key: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** ISO UTC; `''` = hidup (soft delete). */
  deletedAt: string;
  deletedBy: string;
}

interface CustomerRow {
  id: string;
  name: string;
  key: string;
  status: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  deleted_at: string;
  deleted_by: string;
}

/** Kolom yang ditulis saat menyisipkan customer baru (kolom `deleted_*` memakai bawaan = hidup). */
const CUSTOMER_COLUMNS = 'id, name, `key`, status, created_at, updated_at, updated_by';
/** Kolom yang dibaca: kolom tulis + jejak penghapusan. */
const CUSTOMER_READ_COLUMNS = `${CUSTOMER_COLUMNS}, deleted_at, deleted_by`;

function toCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id.trim(),
    name: row.name.trim(),
    key: row.key.trim(),
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
  };
}

/**
 * Kueri customer HIDUP untuk digabung ke `batch()` pemanggil (langsung dari MariaDB, tanpa cache); lihat
 * `customersFromResult`. Customer terhapus tidak ikut: saran, keunikan, dan penulisan task memperlakukannya tak ada.
 */
export function customersStatement(env: Env): DbStatement {
  return env.DB.prepare(`SELECT ${CUSTOMER_READ_COLUMNS} FROM customers WHERE ${liveWhere()}`);
}

/** Customer TERHAPUS (halaman Customer, tampilan "Terhapus"). */
export async function listDeletedCustomers(env: Env): Promise<CustomerRecord[]> {
  return customersFromResult(
    await env.DB.prepare(
      `SELECT ${CUSTOMER_READ_COLUMNS} FROM customers WHERE ${deletedWhere()}`,
    ).all<CustomerRow>(),
  );
}

/** Hasil `customersStatement` sebagai rekaman customer. */
export function customersFromResult(result: { results: unknown[] }): CustomerRecord[] {
  return (result.results as CustomerRow[])
    .map(toCustomer)
    .filter((c) => c.id !== '' && c.key !== '');
}

/**
 * Seluruh customer HIDUP, dibaca langsung dari MariaDB (tanpa cache). `options.fresh` diabaikan (tersisa agar pemanggil
 * di modul yang belum dipindah tetap terkompilasi; dibuang bersama cache di T13).
 */
export async function listCustomers(
  env: Env,
  _options: { fresh?: boolean } = {},
): Promise<CustomerRecord[]> {
  return customersFromResult(await customersStatement(env).all<CustomerRow>());
}

/** Customer HIDUP menurut kunci; customer terhapus diabaikan (nama yang sama membuat customer baru). */
export async function findCustomerByKey(env: Env, key: string): Promise<CustomerRecord | null> {
  const row = await env.DB.prepare(
    `SELECT ${CUSTOMER_READ_COLUMNS} FROM customers WHERE \`key\` = ? AND ${liveWhere()}`,
  )
    .bind(key)
    .first<CustomerRow>();
  return row ? toCustomer(row) : null;
}

export function insertCustomerStmt(db: Preparer, customer: CustomerRecord): DbStatement {
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
  db: Preparer,
  customers: readonly CustomerRecord[],
): DbStatement[] {
  const perStatement = 14;
  const statements: DbStatement[] = [];
  for (let from = 0; from < customers.length; from += perStatement) {
    const chunk = customers.slice(from, from + perStatement);
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

/** Hanya ganti nama (`name`/`key`): tidak menulis `status`, sehingga perubahan status serentak tidak tertimpa (I2). */
export function renameCustomerStmt(
  db: Preparer,
  customer: Pick<CustomerRecord, 'id' | 'name' | 'key' | 'updatedAt' | 'updatedBy'>,
): DbStatement {
  return db
    .prepare(
      'UPDATE customers SET name = ?, `key` = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(customer.name, customer.key, customer.updatedAt, customer.updatedBy, customer.id);
}

/** Hanya status: tidak menulis ulang `name`/`key`, sehingga ganti nama serentak tidak tertimpa (I2). */
export function setCustomerStatusStmt(
  db: Preparer,
  customer: Pick<CustomerRecord, 'id' | 'status' | 'updatedAt' | 'updatedBy'>,
): DbStatement {
  return db
    .prepare('UPDATE customers SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(customer.status, customer.updatedAt, customer.updatedBy, customer.id);
}

/** Baris customer (hidup atau terhapus) menurut id: pemanggil menilai `deletedAt` sendiri. */
export function customerByIdStmt(db: Preparer, id: string): DbStatement {
  return db.prepare(`SELECT ${CUSTOMER_READ_COLUMNS} FROM customers WHERE id = ?`).bind(id);
}

export function updateCustomerStmt(db: Preparer, customer: CustomerRecord): DbStatement {
  return db
    .prepare(
      'UPDATE customers SET name = ?, `key` = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
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
