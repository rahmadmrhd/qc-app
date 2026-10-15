import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import type { BrandRecord } from '@gas/modules/brand/repo';
import { listBrands_, updateBrand_ } from '@gas/modules/brand/repo';
import { applyBrandSave_, applyBrandStatus_, brandSnapshot_ } from '@gas/modules/brand/service';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';
import type { SyncEntryResult, SyncWireBrand } from '@shared/sync';
import { SYNC_ACTOR } from '@shared/sync';
import { isStaleWrite_, syncFailureResult_ } from './conflict';
import { paginateByRev_, validateSyncPull_ } from './pull';
import type { SyncPushEnvelope, WireCheck } from './wire';
import { asSyncObject_, readSyncBaseRev_, readSyncBool_, readSyncId_ } from './wire';

export interface SyncBrandInput {
  uid?: string;
  id?: string;
  name?: string;
  active?: boolean;
  baseRev?: number;
}

const SYNC_ACTOR_REF = { email: SYNC_ACTOR };

export function toWireBrand_(brand: BrandRecord): SyncWireBrand {
  return {
    uid: brand.id,
    id: brand.externalId === '' ? null : brand.externalId,
    name: brand.name,
    active: brand.status === 'active',
    rev: brand.syncRev,
  };
}

export function checkSyncBrand_(raw: unknown): WireCheck<SyncBrandInput> {
  const source = asSyncObject_(raw);
  if (!source) return { ok: false, fields: { _: 'Entri harus berupa objek' } };
  const fields: Record<string, string> = {};
  const value: SyncBrandInput = {};
  const uid = readSyncId_(source, 'uid', fields);
  if (uid !== undefined) value.uid = uid;
  const id = readSyncId_(source, 'id', fields);
  if (id !== undefined) value.id = id;
  if (source.name !== undefined) {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (name === '') fields.name = 'Wajib diisi';
    else if (name.length > ITEM_LIMITS.brand)
      fields.name = `Maksimal ${ITEM_LIMITS.brand} karakter`;
    else if (normalizeKey(name) === '') fields.name = 'Nama merk harus memuat huruf atau angka';
    else value.name = name;
  }
  const active = readSyncBool_(source, 'active', fields);
  if (active !== undefined) value.active = active;
  const baseRev = readSyncBaseRev_(source, fields);
  if (baseRev !== undefined) value.baseRev = baseRev;
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

export function pullBrands_(raw: unknown): {
  brands: SyncWireBrand[];
  nextRev: number;
  hasMore: boolean;
} {
  const input = validateSyncPull_(raw, []);
  const { page, nextRev, hasMore } = paginateByRev_(listBrands_(), input.sinceRev, input.limit);
  return { brands: page.map(toWireBrand_), nextRev, hasMore };
}

function brandConflict_(
  index: number,
  existing: BrandRecord,
  proposed: { name: string; status: string },
  extraFields?: Record<string, string>,
): SyncEntryResult<SyncWireBrand> {
  appendAudit_({
    ts: nowIso_(),
    actor: SYNC_ACTOR,
    action: 'brand.sync.conflict',
    target: existing.name,
    before: brandSnapshot_(existing),
    after: proposed,
  });
  return {
    index,
    status: 'conflict',
    uid: existing.id,
    rev: existing.syncRev,
    current: toWireBrand_(existing),
    ...(extraFields ? { fields: extraFields } : {}),
  };
}

/** Di dalam lock. */
function upsertBrandInLock_(
  entry: SyncBrandInput,
  index: number,
  overwrite: boolean,
): SyncEntryResult<SyncWireBrand> {
  const brands = listBrands_();
  const byUid =
    entry.uid === undefined ? undefined : brands.find((brand) => brand.id === entry.uid);
  if (entry.uid !== undefined && !byUid) {
    return { index, status: 'invalid', fields: { uid: 'Merk tidak ditemukan' } };
  }
  const byId =
    entry.id === undefined ? undefined : brands.find((brand) => brand.externalId === entry.id);
  if (byUid && byId && byUid.id !== byId.id) {
    return brandConflict_(
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
    return brandConflict_(
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
    const created = applyBrandSave_({ name: entry.name }, SYNC_ACTOR_REF);
    const fresh = listBrands_().find((brand) => brand.id === created.id) as BrandRecord;
    updateBrand_({ ...fresh, externalId: entry.id ?? '' });
    if (entry.active === false)
      applyBrandStatus_({ id: created.id, status: 'inactive' }, SYNC_ACTOR_REF);
    const final = listBrands_().find((brand) => brand.id === created.id) as BrandRecord;
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
      // Pemetaan id MySQL adalah pembukuan, bukan perubahan data: tanpa kenaikan rev dan tanpa audit.
      updateBrand_({ ...existing, externalId: entry.id as string });
      return { index, status: 'updated', uid: existing.id, rev: existing.syncRev };
    }
    return { index, status: 'unchanged', uid: existing.id, rev: existing.syncRev };
  }
  if (isStaleWrite_(entry.baseRev, existing.syncRev, overwrite)) {
    return brandConflict_(index, existing, {
      name: nameChanged ? (entry.name as string) : existing.name,
      status: wantStatus,
    });
  }
  if (nameChanged) applyBrandSave_({ id: existing.id, name: entry.name as string }, SYNC_ACTOR_REF);
  if (statusChanged) applyBrandStatus_({ id: existing.id, status: wantStatus }, SYNC_ACTOR_REF);
  const fresh = listBrands_().find((brand) => brand.id === existing.id) as BrandRecord;
  if (mapChanged) updateBrand_({ ...fresh, externalId: entry.id as string });
  return { index, status: 'updated', uid: fresh.id, rev: fresh.syncRev };
}

export function pushBrands_(envelope: SyncPushEnvelope): {
  results: Array<SyncEntryResult<SyncWireBrand>>;
} {
  const results = envelope.entries.map((raw, index): SyncEntryResult<SyncWireBrand> => {
    const check = checkSyncBrand_(raw);
    if (!check.ok) return { index, status: 'invalid', fields: check.fields };
    try {
      return platform_().withLock(() => upsertBrandInLock_(check.value, index, envelope.overwrite));
    } catch (error) {
      return syncFailureResult_(error, index);
    }
  });
  return { results };
}
