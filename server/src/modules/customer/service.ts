import type { AuditInput } from '@server/core/audit';
import { writeAudit } from '@server/core/audit';
import { nameGuardStmt, runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { batchWrite } from '@server/modules/access/repo';
import type { CustomerDto, RenameCustomerInput, SetCustomerStatusInput } from '@shared/contract';
import { customerKey } from '@shared/handover';
import type { CustomerRecord } from './repo';
import {
  customerByIdStmt,
  customersFromResult,
  findCustomerByKey,
  insertCustomerStmt,
  listCustomers,
  renameCustomerStmt,
  setCustomerStatusStmt,
} from './repo';

function toCustomerDto(customer: CustomerRecord): CustomerDto {
  return {
    id: customer.id,
    name: customer.name,
    status: customer.status,
    updatedAt: customer.updatedAt,
  };
}

export function customerSnapshot(customer: CustomerRecord): Record<string, unknown> {
  return { name: customer.name, status: customer.status };
}

const CUSTOMER_CONFLICTS = {
  customers_key: { field: 'name', message: 'Nama customer sudah dipakai' },
};

export async function listCustomerDtos(env: Env): Promise<CustomerDto[]> {
  return (await listCustomers(env)).map(toCustomerDto).sort((a, b) => a.name.localeCompare(b.name));
}

/** Hasil pencarian customer untuk penulisan task: yang sudah ada, atau customer baru beserta entri auditnya. */
export interface CustomerLookup {
  customer: CustomerRecord;
  /** Entri audit `customer.create`; ada hanya bila `customer` baru dan belum disisipkan. */
  created: AuditInput | null;
}

/**
 * Mencari customer menurut nama (kunci ternormalisasi; ejaan resmi yang tersimpan menang); bila belum ada,
 * menyusun customer baru dan entri audit `customer.create`-nya (belum ditulis). Customer nonaktif ditolak
 * kecuali `currentId` (task yang sudah memakainya).
 */
export async function lookupCustomerForWrite(
  env: Env,
  name: string,
  actor: ActorRef,
  currentId?: string,
): Promise<CustomerLookup> {
  const key = customerKey(name);
  const found = await findCustomerByKey(env, key);
  if (found) {
    if (found.status === 'inactive' && found.id !== currentId) {
      const message = 'Customer dinonaktifkan; aktifkan dulu di halaman Customer';
      throw appError('VALIDATION', message, { customerName: message });
    }
    return { customer: found, created: null };
  }
  const now = nowIso(env);
  const customer: CustomerRecord = {
    id: crypto.randomUUID(),
    name,
    key,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
  return {
    customer,
    created: {
      ts: now,
      actor: actor.email,
      action: 'customer.create',
      target: customer.name,
      before: null,
      after: customerSnapshot(customer),
    },
  };
}

/**
 * Rencana "buat langsung saat mengetik" (FC2) untuk penyimpanan task: `lookupCustomerForWrite` beserta
 * pernyataan penyisipan + audit untuk digabung ke `batch()` penyimpanan task (kosong bila customer sudah ada).
 */
export async function planCustomerByName(
  env: Env,
  name: string,
  actor: ActorRef,
  currentId?: string,
): Promise<{ customer: CustomerRecord; statements: DbStatement[] }> {
  const { customer, created } = await lookupCustomerForWrite(env, name, actor, currentId);
  return {
    customer,
    statements: created ? [insertCustomerStmt(env.DB, customer), writeAudit(env.DB, created)] : [],
  };
}

/**
 * Versi mandiri `planCustomerByName`: menulis sendiri dan, bila dua permintaan membuat customer yang sama
 * bersamaan (indeks unik menolak yang kedua), memakai baris pemenang.
 */
export async function resolveCustomerByName(
  env: Env,
  name: string,
  actor: ActorRef,
  currentId?: string,
): Promise<CustomerRecord> {
  const plan = await planCustomerByName(env, name, actor, currentId);
  if (plan.statements.length === 0) return plan.customer;
  try {
    await env.DB.batch(plan.statements);
    return plan.customer;
  } catch (error) {
    const winner = await findCustomerByKey(env, plan.customer.key);
    if (winner) return winner;
    throw error;
  }
}

export async function renameCustomer(
  env: Env,
  input: RenameCustomerInput,
  actor: ActorRef,
): Promise<CustomerDto> {
  const customers = await listCustomers(env);
  const existing = customers.find((customer) => customer.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'Customer tidak ditemukan');
  const key = customerKey(input.name);
  if (customers.some((customer) => customer.id !== input.id && customer.key === key)) {
    throw appError('CONFLICT', 'Nama customer sudah dipakai', {
      name: 'Nama customer sudah dipakai',
    });
  }
  if (existing.name === input.name) return toCustomerDto(existing);
  const now = nowIso(env);
  const updated: CustomerRecord = {
    ...existing,
    name: input.name,
    key,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await batchWrite(
    env.DB,
    [
      renameCustomerStmt(env.DB, updated),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'customer.rename',
        target: updated.name,
        before: customerSnapshot(existing),
        after: customerSnapshot(updated),
      }),
    ],
    CUSTOMER_CONFLICTS,
  );
  return toCustomerDto(updated);
}

export async function setCustomerStatus(
  env: Env,
  input: SetCustomerStatusInput,
  actor: ActorRef,
): Promise<CustomerDto> {
  // Penjaga nama: ganti nama yang menyela membatalkan batch dan keadaan dimuat ulang (audit memakai nama terkini).
  return runCas(() => setCustomerStatusOnce(env, input, actor), CUSTOMER_STALE_MESSAGE);
}

const CUSTOMER_STALE_MESSAGE =
  'Customer diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

async function setCustomerStatusOnce(
  env: Env,
  input: SetCustomerStatusInput,
  actor: ActorRef,
): Promise<CustomerDto> {
  const existing = (await listCustomers(env)).find((customer) => customer.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'Customer tidak ditemukan');
  if (existing.status === input.status) return toCustomerDto(existing);
  const now = nowIso(env);
  const updated: CustomerRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  // Hanya status yang ditulis; baris terkini dibaca di akhir batch untuk DTO (nama bisa baru diganti orang lain).
  const results = await env.DB.batch([
    nameGuardStmt(env.DB, 'customers', existing.id, existing.name),
    setCustomerStatusStmt(env.DB, updated),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'customer.activate' : 'customer.deactivate',
      target: updated.name,
      before: customerSnapshot(existing),
      after: customerSnapshot(updated),
    }),
    customerByIdStmt(env.DB, updated.id),
  ]);
  const fresh = customersFromResult(results[3] as { results: unknown[] })[0];
  return toCustomerDto(fresh ?? updated);
}
