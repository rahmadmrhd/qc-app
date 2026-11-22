import type { AuditInput } from '@server/core/audit';
import { writeAudit } from '@server/core/audit';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { type PlanOutcome, runRecordBatch, runSingleRecord } from '@server/core/record-batch';
import {
  type LifecycleSpec,
  planRestore,
  planSoftDelete,
  planStatusChange,
} from '@server/core/record-lifecycle';
import type { UserContext } from '@server/modules/access/context';
import { batchWrite } from '@server/modules/access/repo';
import type {
  BatchResult,
  IdBatchInput,
  ListStatusFilter,
  RemoveBatchResult,
  RemoveResult,
  StatusBatchInput,
} from '@shared/batch';
import type {
  CustomerDto,
  GetCustomerInput,
  ListCustomersInput,
  RenameCustomerInput,
  SetCustomerStatusInput,
} from '@shared/contract';
import { customerKey } from '@shared/handover';
import { hasLevel } from '@shared/permissions';
import type { CustomerRecord } from './repo';
import {
  customerByIdStmt,
  customersFromResult,
  findCustomerByKey,
  insertCustomerStmt,
  listCustomers,
  listDeletedCustomers,
  renameCustomerStmt,
} from './repo';

function toCustomerDto(customer: CustomerRecord): CustomerDto {
  return {
    id: customer.id,
    name: customer.name,
    status: customer.status,
    updatedAt: customer.updatedAt,
    ...(customer.deletedAt === ''
      ? {}
      : { deleted: { deletedAt: customer.deletedAt, deletedBy: customer.deletedBy } }),
  };
}

export function customerSnapshot(customer: CustomerRecord): Record<string, unknown> {
  return { name: customer.name, status: customer.status };
}

const CUSTOMER_CONFLICTS = {
  customers_key: { field: 'name', message: 'Nama customer sudah dipakai' },
};

const NAME_TAKEN = 'Nama customer sudah dipakai';
const CUSTOMER_NOT_FOUND = 'Customer tidak ditemukan';
const CUSTOMER_STALE = 'Customer diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

/** Melihat customer terhapus butuh `item: manage` (izin yang sama dengan hapus dan pulihkan). */
function canSeeDeleted(actor: UserContext | undefined): boolean {
  return actor !== undefined && hasLevel(actor.permissions.item, 'manage');
}

function assertCanListDeleted(filter: ListStatusFilter | undefined, actor?: UserContext): void {
  if (filter === 'deleted' && !canSeeDeleted(actor)) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat customer terhapus');
  }
}

/** Daftar customer: bawaan hidup (aktif + nonaktif); `deleted` hanya bagi `item: manage`. */
export async function listCustomerDtos(
  env: Env,
  input?: ListCustomersInput | null,
  actor?: UserContext,
): Promise<CustomerDto[]> {
  const filter = input?.status;
  assertCanListDeleted(filter, actor);
  const records = filter === 'deleted' ? await listDeletedCustomers(env) : await listCustomers(env);
  return records
    .filter((customer) => filter !== 'active' || customer.status === 'active')
    .filter((customer) => filter !== 'inactive' || customer.status === 'inactive')
    .map(toCustomerDto)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Satu customer menurut id. Terhapus hanya bagi `item: manage`; selain itu `NOT_FOUND`. */
export async function getCustomerDto(
  env: Env,
  input: GetCustomerInput,
  actor: UserContext,
): Promise<CustomerDto> {
  const customer = await loadCustomerAny(env, input.id);
  if (!customer || (customer.deletedAt !== '' && !canSeeDeleted(actor))) {
    throw appError('NOT_FOUND', CUSTOMER_NOT_FOUND);
  }
  return toCustomerDto(customer);
}

/** Customer (hidup atau terhapus) menurut id; `null` bila id tak dikenal. */
async function loadCustomerAny(env: Env, id: string): Promise<CustomerRecord | null> {
  const result = await customerByIdStmt(env.DB, id).all();
  return customersFromResult(result)[0] ?? null;
}

/** Hasil pencarian customer untuk penulisan task: yang sudah ada, atau customer baru beserta entri auditnya. */
export interface CustomerLookup {
  customer: CustomerRecord;
  /** Entri audit `customer.create`; ada hanya bila `customer` baru dan belum disisipkan. */
  created: AuditInput | null;
}

/**
 * Mencari customer HIDUP menurut nama (kunci ternormalisasi; ejaan resmi yang tersimpan menang); bila belum ada,
 * menyusun customer baru dan entri audit `customer.create`-nya (belum ditulis). Customer terhapus diabaikan (nama yang
 * sama membuat customer baru; task lama tetap menyimpan `customer_name`-nya). Customer nonaktif ditolak kecuali
 * `currentId` (task yang sudah memakainya).
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
    id: newId(),
    name,
    key,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  return {
    customer,
    created: {
      ts: now,
      actor: actor.email,
      action: 'customer.create',
      target: customer.name,
      targetId: customer.id,
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
  if (!existing) throw appError('NOT_FOUND', CUSTOMER_NOT_FOUND);
  const key = customerKey(input.name);
  if (customers.some((customer) => customer.id !== input.id && customer.key === key)) {
    throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
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
        targetId: updated.id,
        before: customerSnapshot(existing),
        after: customerSnapshot(updated),
      }),
    ],
    CUSTOMER_CONFLICTS,
  );
  return toCustomerDto(updated);
}

const CUSTOMER_SPEC: LifecycleSpec<CustomerRecord, CustomerDto> = {
  table: 'customers',
  audit: 'customer',
  noun: 'customer',
  auditTarget: (customer) => customer.name,
  snapshot: customerSnapshot,
  toDto: toCustomerDto,
};

function customerPlanners(env: Env, actor: ActorRef) {
  const options = { conflicts: CUSTOMER_CONFLICTS, stale: CUSTOMER_STALE };
  /** Dua customer terhapus berkunci sama dipulihkan sekaligus: bentrok antar record satu permintaan. */
  const restoreOptions = {
    ...options,
    verify: (restored: CustomerDto[]) => {
      const seen = new Set<string>();
      for (const customer of restored) {
        const key = customerKey(customer.name);
        if (seen.has(key)) throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
        seen.add(key);
      }
    },
  };
  const load = async (id: string): Promise<CustomerRecord> => {
    const customer = await loadCustomerAny(env, id);
    if (!customer) throw appError('NOT_FOUND', CUSTOMER_NOT_FOUND);
    return customer;
  };
  return {
    options,
    restoreOptions,
    status:
      (status: 'active' | 'inactive') =>
      async (id: string): Promise<PlanOutcome<CustomerDto>> => {
        const customer = await load(id);
        if (customer.deletedAt !== '') throw appError('NOT_FOUND', CUSTOMER_NOT_FOUND);
        return planStatusChange(env, CUSTOMER_SPEC, customer, status, actor);
      },
    remove: async (id: string): Promise<PlanOutcome<RemoveResult>> =>
      planSoftDelete(env, CUSTOMER_SPEC, await load(id), actor),
    restore: async (id: string): Promise<PlanOutcome<CustomerDto>> => {
      const customer = await load(id);
      if (customer.deletedAt !== '' && (await findCustomerByKey(env, customer.key))) {
        throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
      }
      return planRestore(env, CUSTOMER_SPEC, customer, actor);
    },
  };
}

/**
 * Ubah status satu customer: perencana yang sama dengan batch. Penjaga versi (`updated_at`) menggantikan penjaga nama
 * lama: ganti nama yang menyela menaikkan `updated_at`, sehingga batch dibatalkan dan keadaan dimuat ulang.
 */
export function setCustomerStatus(
  env: Env,
  input: SetCustomerStatusInput,
  actor: ActorRef,
): Promise<CustomerDto> {
  const planners = customerPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.status(input.status), planners.options);
}

export function setCustomerStatusBatch(
  env: Env,
  input: StatusBatchInput,
  actor: ActorRef,
): Promise<BatchResult<CustomerDto>> {
  const planners = customerPlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.status(input.status), planners.options);
}

export function removeCustomer(
  env: Env,
  input: GetCustomerInput,
  actor: ActorRef,
): Promise<RemoveResult> {
  const planners = customerPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.remove, planners.options);
}

export async function removeCustomerBatch(
  env: Env,
  input: IdBatchInput,
  actor: ActorRef,
): Promise<RemoveBatchResult> {
  const planners = customerPlanners(env, actor);
  const { items } = await runRecordBatch(env, input.ids, planners.remove, planners.options);
  return { ids: items.map((item) => item.id) };
}

export function restoreCustomer(
  env: Env,
  input: GetCustomerInput,
  actor: ActorRef,
): Promise<CustomerDto> {
  const planners = customerPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.restore, planners.restoreOptions);
}

export function restoreCustomerBatch(
  env: Env,
  input: IdBatchInput,
  actor: ActorRef,
): Promise<BatchResult<CustomerDto>> {
  const planners = customerPlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.restore, planners.restoreOptions);
}
