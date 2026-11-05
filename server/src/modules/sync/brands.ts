import { writeAudit } from '@server/core/audit';
import type { ActorRef } from '@server/core/context';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { touchCache } from '@server/core/mem-cache';
import type { BrandRecord } from '@server/modules/brand/repo';
import { listBrands } from '@server/modules/brand/repo';
import { brandSnapshot, saveBrand, setBrandStatus } from '@server/modules/brand/service';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';
import type { SyncEntryResult, SyncWireBrand } from '@shared/sync';
import { SYNC_ACTOR } from '@shared/sync';
import { isStaleWrite, syncFailureResult } from './conflict';
import { paginateByRev, validateSyncPull } from './pull';
import type { SyncPushEnvelope, WireCheck } from './wire';
import {
  asSyncObject,
  readSyncBaseRev,
  readSyncBool,
  readSyncId,
  rejectUnknownSyncFields,
} from './wire';

export interface SyncBrandInput {
  uid?: string;
  id?: string;
  name?: string;
  active?: boolean;
  baseRev?: number;
}

const SYNC_ACTOR_REF: ActorRef = { email: SYNC_ACTOR };

export function toWireBrand(brand: BrandRecord): SyncWireBrand {
  return {
    uid: brand.id,
    id: brand.externalId === '' ? null : brand.externalId,
    name: brand.name,
    active: brand.status === 'active',
    rev: brand.syncRev,
  };
}

const SYNC_BRAND_ENTRY_FIELDS = ['uid', 'id', 'name', 'active', 'baseRev'] as const;

export function checkSyncBrand(raw: unknown): WireCheck<SyncBrandInput> {
  const source = asSyncObject(raw);
  if (!source) return { ok: false, fields: { _: 'Entri harus berupa objek' } };
  const fields: Record<string, string> = {};
  const value: SyncBrandInput = {};
  rejectUnknownSyncFields(source, SYNC_BRAND_ENTRY_FIELDS, fields);
  const uid = readSyncId(source, 'uid', fields);
  if (uid !== undefined) value.uid = uid;
  const id = readSyncId(source, 'id', fields);
  if (id !== undefined) value.id = id;
  if (source.name !== undefined) {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (name === '') fields.name = 'Wajib diisi';
    else if (name.length > ITEM_LIMITS.brand)
      fields.name = `Maksimal ${ITEM_LIMITS.brand} karakter`;
    else if (normalizeKey(name) === '') fields.name = 'Nama merk harus memuat huruf atau angka';
    else value.name = name;
  }
  const active = readSyncBool(source, 'active', fields);
  if (active !== undefined) value.active = active;
  const baseRev = readSyncBaseRev(source, fields);
  if (baseRev !== undefined) value.baseRev = baseRev;
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

export async function pullBrands(
  env: Env,
  raw: unknown,
): Promise<{ brands: SyncWireBrand[]; nextRev: number; hasMore: boolean }> {
  const input = validateSyncPull(raw, []);
  const { page, nextRev, hasMore } = paginateByRev(
    await listBrands(env, { fresh: true }),
    input.sinceRev,
    input.limit,
  );
  return { brands: page.map(toWireBrand), nextRev, hasMore };
}

async function brandConflict(
  env: Env,
  index: number,
  existing: BrandRecord,
  proposed: { name: string; status: string },
  extraFields?: Record<string, string>,
): Promise<SyncEntryResult<SyncWireBrand>> {
  await env.DB.batch([
    writeAudit(env.DB, {
      ts: nowIso(env),
      actor: SYNC_ACTOR,
      action: 'brand.sync.conflict',
      target: existing.name,
      before: brandSnapshot(existing),
      after: proposed,
    }),
  ]);
  return {
    index,
    status: 'conflict',
    uid: existing.id,
    rev: existing.syncRev,
    current: toWireBrand(existing),
    ...(extraFields ? { fields: extraFields } : {}),
  };
}

async function freshBrand(env: Env, id: string): Promise<BrandRecord> {
  return (await listBrands(env, { fresh: true })).find((brand) => brand.id === id) as BrandRecord;
}

async function mapExternalId(env: Env, id: string, externalId: string): Promise<void> {
  // Pemetaan id MySQL adalah pembukuan: tidak menaikkan revisi dan tidak diaudit.
  touchCache('brands');
  await env.DB.prepare('UPDATE brands SET external_id = ? WHERE id = ?').bind(externalId, id).run();
}

async function upsertBrand(
  env: Env,
  entry: SyncBrandInput,
  index: number,
  overwrite: boolean,
): Promise<SyncEntryResult<SyncWireBrand>> {
  const brands = await listBrands(env, { fresh: true });
  const byUid =
    entry.uid === undefined ? undefined : brands.find((brand) => brand.id === entry.uid);
  if (entry.uid !== undefined && !byUid) {
    return { index, status: 'invalid', fields: { uid: 'Merk tidak ditemukan' } };
  }
  const byId =
    entry.id === undefined ? undefined : brands.find((brand) => brand.externalId === entry.id);
  if (byUid && byId && byUid.id !== byId.id) {
    return brandConflict(
      env,
      index,
      byUid,
      { name: byUid.name, status: byUid.status },
      { id: 'uid dan id mengarah ke merk berbeda' },
    );
  }
  let existing = byUid ?? byId;
  if (!existing && entry.name !== undefined) {
    const key = normalizeKey(entry.name);
    existing = brands.find((brand) => brand.key === key);
  }
  if (
    existing &&
    entry.id !== undefined &&
    existing.externalId !== '' &&
    existing.externalId !== entry.id
  ) {
    return brandConflict(
      env,
      index,
      existing,
      { name: entry.name ?? existing.name, status: existing.status },
      { id: 'Merk sudah terpetakan ke id MySQL lain' },
    );
  }

  if (!existing) {
    if (entry.name === undefined) {
      return { index, status: 'invalid', fields: { name: 'Wajib diisi untuk merk baru' } };
    }
    const created = await saveBrand(env, { name: entry.name }, SYNC_ACTOR_REF);
    if (entry.id !== undefined) await mapExternalId(env, created.id, entry.id);
    if (entry.active === false) {
      await setBrandStatus(env, { id: created.id, status: 'inactive' }, SYNC_ACTOR_REF);
    }
    const final = await freshBrand(env, created.id);
    return { index, status: 'created', uid: final.id, rev: final.syncRev };
  }

  // Nama dianggap sama bila kunci ternormalisasinya sama (migrasi dari Desktop tidak boleh jadi konflik karena huruf besar/kecil).
  const nameChanged = entry.name !== undefined && normalizeKey(entry.name) !== existing.key;
  const wantStatus =
    entry.active === undefined ? existing.status : entry.active ? 'active' : 'inactive';
  const statusChanged = wantStatus !== existing.status;
  const mapChanged = entry.id !== undefined && existing.externalId === '';
  if (!nameChanged && !statusChanged) {
    if (mapChanged) {
      await mapExternalId(env, existing.id, entry.id as string);
      return { index, status: 'updated', uid: existing.id, rev: existing.syncRev };
    }
    return { index, status: 'unchanged', uid: existing.id, rev: existing.syncRev };
  }
  if (isStaleWrite(entry.baseRev, existing.syncRev, overwrite)) {
    return brandConflict(env, index, existing, {
      name: nameChanged ? (entry.name as string) : existing.name,
      status: wantStatus,
    });
  }
  if (nameChanged) {
    await saveBrand(env, { id: existing.id, name: entry.name as string }, SYNC_ACTOR_REF);
  }
  if (statusChanged) {
    await setBrandStatus(env, { id: existing.id, status: wantStatus }, SYNC_ACTOR_REF);
  }
  if (mapChanged) await mapExternalId(env, existing.id, entry.id as string);
  const fresh = await freshBrand(env, existing.id);
  return { index, status: 'updated', uid: fresh.id, rev: fresh.syncRev };
}

export async function pushBrands(
  env: Env,
  envelope: SyncPushEnvelope,
): Promise<{ results: Array<SyncEntryResult<SyncWireBrand>> }> {
  const results: Array<SyncEntryResult<SyncWireBrand>> = [];
  for (const [index, raw] of envelope.entries.entries()) {
    const check = checkSyncBrand(raw);
    if (!check.ok) {
      results.push({ index, status: 'invalid', fields: check.fields });
      continue;
    }
    try {
      results.push(await upsertBrand(env, check.value, index, envelope.overwrite));
    } catch (error) {
      results.push(syncFailureResult(error, index));
    }
  }
  return { results };
}
