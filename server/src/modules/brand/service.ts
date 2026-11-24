import { writeAudit } from '@server/core/audit';
import { isGuardFailure } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement, DbTx } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { type PlanOutcome, runRecordBatch, runSingleRecord } from '@server/core/record-batch';
import {
  liveWhere,
  restoreStmt,
  softDeleteStmt,
  stampStmt,
  versionGuardStmt,
} from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { batchWrite, mapDuplicateError } from '@server/modules/access/repo';
import type {
  BatchResult,
  IdBatchInput,
  RemoveBatchResult,
  RemoveResult,
  StatusBatchInput,
} from '@shared/batch';
import type {
  BrandDto,
  GetBrandInput,
  ListBrandsInput,
  SaveBrandInput,
  SetBrandStatusInput,
} from '@shared/contract';
import { itemKey, normalizeKey } from '@shared/items';
import { hasLevel } from '@shared/permissions';
import type { BrandBuBrief, BrandRecord, BrandRow } from './repo';
import {
  activeBuGuardStmt,
  BRAND_COLUMNS,
  brandDefaultsFromResult,
  brandDefaultsOfStatement,
  brandDefaultsStatement,
  brandsFromResult,
  brandsStatement,
  findBrandByKey,
  insertBrandStmts,
  listBuBriefs,
  setBrandStatusStmts,
  syncBrandDefaultsStmts,
  updateBrandStmts,
} from './repo';

/** Id BU diurutkan menurut kode BU (id tak dikenal di belakang, menurut id). */
function sortByBuCode(ids: readonly string[], bus: readonly BrandBuBrief[]): string[] {
  const code = new Map(bus.map((bu) => [bu.id, bu.code] as const));
  return [...ids].sort((a, b) => {
    const ca = code.get(a);
    const cb = code.get(b);
    if (ca !== undefined && cb !== undefined) return ca.localeCompare(cb);
    if (ca !== undefined) return -1;
    if (cb !== undefined) return 1;
    return a.localeCompare(b);
  });
}

function toBrandDto(brand: BrandRecord, businessUnitIds: readonly string[]): BrandDto {
  return {
    id: brand.id,
    name: brand.name,
    status: brand.status,
    itemCount: brand.itemCount,
    updatedAt: brand.updatedAt,
    businessUnitIds: [...businessUnitIds],
    ...(brand.deletedAt === ''
      ? {}
      : { deleted: { deletedAt: brand.deletedAt, deletedBy: brand.deletedBy } }),
  };
}

/** `businessUnits` (kode BU terurut) hanya dimuat oleh audit buat/ubah merk; status tidak menyentuhnya. */
export function brandSnapshot(
  brand: BrandRecord,
  businessUnits?: readonly string[],
): Record<string, unknown> {
  return businessUnits === undefined
    ? { name: brand.name, status: brand.status }
    : { name: brand.name, status: brand.status, businessUnits: [...businessUnits] };
}

const codesOf = (ids: readonly string[], bus: readonly BrandBuBrief[]): string[] =>
  sortByBuCode(ids, bus).map((id) => bus.find((bu) => bu.id === id)?.code ?? id);

const inactiveBuError = () =>
  appError('VALIDATION', 'BU tidak dikenal atau tidak aktif', {
    businessUnitIds: 'BU tidak dikenal atau tidak aktif',
  });

/**
 * BU bawaan yang DITAMBAH (tidak ada di `current`) harus ada dan aktif; BU lama (termasuk nonaktif) boleh
 * dipertahankan. Tidak memberi hak apa pun: siapa pun yang boleh `brands.save` boleh mengaturnya.
 */
function assertDefaultBusinessUnits(
  bus: readonly BrandBuBrief[],
  current: readonly string[],
  requested: readonly string[],
): void {
  const known = new Map(bus.map((bu) => [bu.id, bu] as const));
  for (const id of requested) {
    if (current.includes(id)) continue;
    const bu = known.get(id);
    if (bu?.status !== 'active') throw inactiveBuError();
  }
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

const BRAND_CONFLICTS = { brands_key: { field: 'name', message: 'Nama merk sudah dipakai' } };

function newBrandRecord(env: Env, name: string, actor: ActorRef): BrandRecord {
  const now = nowIso(env);
  return {
    id: newId(),
    name,
    key: normalizeKey(name),
    status: 'active',
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
}

/**
 * Pernyataan penyisipan merk baru + BU bawaan + audit `brand.create` (digabung ke `batch()` pemanggil).
 * `bus` = semua BU (untuk kode di audit).
 */
export function createBrandStmts(
  env: Env,
  brand: BrandRecord,
  businessUnitIds: readonly string[],
  bus: readonly BrandBuBrief[],
  actor: ActorRef,
): DbStatement[] {
  return [
    ...insertBrandStmts(env.DB, brand),
    ...syncBrandDefaultsStmts(env.DB, brand.id, businessUnitIds, true),
    writeAudit(env.DB, {
      ts: brand.createdAt,
      actor: actor.email,
      action: 'brand.create',
      target: brand.name,
      targetId: brand.id,
      before: null,
      after: brandSnapshot(brand, codesOf(businessUnitIds, bus)),
    }),
  ];
}

/**
 * Daftar merk beserta BU bawaan: dua kueri dalam SATU `batch()` (satu kueri tambahan, bukan N+1). Bawaan = merk hidup
 * (`status` `active`/`inactive` menyaring lagi; `all` sama dengan bawaan). `deleted` = hanya merk terhapus, hanya bagi
 * `item: manage` (selain itu `FORBIDDEN`).
 */
export async function listBrandDtos(
  env: Env,
  input: ListBrandsInput | null,
  user: UserContext,
): Promise<BrandDto[]> {
  const filter = input?.status;
  if (filter === 'deleted' && !hasLevel(user.permissions.item, 'manage')) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat merk terhapus');
  }
  const [brandResult, defaultResult] = await env.DB.batch([
    brandsStatement(env, filter === 'deleted' ? 'deleted' : 'live'),
    brandDefaultsStatement(env.DB),
  ]);
  const defaults = brandDefaultsFromResult(defaultResult ?? { results: [] });
  return brandsFromResult(brandResult ?? { results: [] })
    .filter((brand) => filter !== 'active' || brand.status === 'active')
    .filter((brand) => filter !== 'inactive' || brand.status === 'inactive')
    .map((brand) => toBrandDto(brand, defaults.get(brand.id) ?? []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Satu merk menurut id. Merk terhapus hanya bagi `item: manage`; selain itu `NOT_FOUND` (seperti merk tak dikenal). */
export async function getBrandDto(
  env: Env,
  input: GetBrandInput,
  user: UserContext,
): Promise<BrandDto> {
  const found = await readableBrand(env, input.id, user);
  return toBrandDto(found.brand, found.buIds);
}

/** Merk menurut id bagi pembaca: terhapus hanya untuk `item: manage`, selain itu (dan id tak dikenal) `NOT_FOUND`. */
async function readableBrand(env: Env, id: string, user: UserContext): Promise<LoadedBrand> {
  const found = await loadBrandAny(env, id);
  if (!found || (found.brand.deletedAt !== '' && !hasLevel(user.permissions.item, 'manage'))) {
    throw appError('NOT_FOUND', 'Merk tidak ditemukan');
  }
  return found;
}

/** Gerbang baca untuk `activity.list`: aturan yang sama dengan `brands.get`. */
export async function assertBrandReadable(env: Env, id: string, user: UserContext): Promise<void> {
  await readableBrand(env, id, user);
}

/** Item per pernyataan `UPDATE` ganti nama (2 nilai terikat per item; driver tanpa batas parameter). */
const RENAME_ITEMS_PER_STATEMENT = 200;
/** Kunci nama lain per pernyataan `SELECT ... IN (...)`. */
const KEY_CHUNK = 500;

/**
 * Tabrakan kunci merk+tipe dua item akibat ganti nama: dijaga indeks unik `items_key` pada `UPDATE` item di
 * transaksi yang sama (galat duplikat membatalkan seluruh transaksi), dan nama merk kembar oleh `brands_key`.
 */
const BRAND_RENAME_CONFLICTS = {
  ...BRAND_CONFLICTS,
  items_key: {
    field: 'name',
    message: 'Nama baru membuat merk dan tipe dua item bentrok',
  },
};

const RENAME_ALIAS_MESSAGE = 'Nama baru bentrok dengan nama lain item';
const NAME_TAKEN_MESSAGE = 'Nama merk sudah dipakai';

/** True bila salah satu kunci dipegang sebagai nama lain (alias) item mana pun (dibaca di dalam transaksi). */
async function aliasCollides(tx: DbTx, keys: readonly string[]): Promise<boolean> {
  const unique = [...new Set(keys)];
  for (let from = 0; from < unique.length; from += KEY_CHUNK) {
    const chunk = unique.slice(from, from + KEY_CHUNK);
    const hit = await tx
      .prepare(
        `SELECT 1 AS hit FROM item_alias_keys WHERE \`key\` IN (${chunk.map(() => '?').join(',')}) LIMIT 1`,
      )
      .bind(...chunk)
      .first();
    if (hit) return true;
  }
  return false;
}

/**
 * Ganti nama merk dalam SATU transaksi: baris merk dan item milik merk dikunci (`SELECT ... FOR UPDATE`) sehingga
 * penulis lain (item baru/pindah merk/ubah tipe, ganti nama serentak) menunggu sampai COMMIT dan membaca hasil
 * akhir; tidak ada percobaan ulang optimistik.
 *  1. kunci semua item merk diberi kunci sementara unik per item (U+0001 + `id`; kunci asli tak pernah memuatnya),
 *     supaya tabrakan SEMENTARA antar item merk ini (kunci baru satu item = kunci lama item lain di merk yang sama)
 *     tidak ditolak indeks unik `items_key` yang diperiksa per baris;
 *  2. `UPDATE ... JOIN (SELECT ... UNION ALL ...)` per 200 item memasang kunci akhir tiap item.
 * Bentrok sungguhan dengan merk+tipe item merk lain ditolak `items_key` (CONFLICT); dengan nama lain (alias) item
 * mana pun ditolak pemeriksaan alias di transaksi yang sama.
 */
async function updateBrand(
  env: Env,
  id: string,
  name: string,
  requestedBuIds: readonly string[],
  actor: ActorRef,
): Promise<BrandDto> {
  return env.DB.transaction(async (tx) => {
    const row = await tx
      .prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE id = ? AND ${liveWhere()} FOR UPDATE`)
      .bind(id)
      .first<BrandRow>();
    const existing = row ? brandsFromResult({ results: [row] })[0] : undefined;
    if (!existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
    const bus = await listBuBriefs(tx);
    const currentBuIds =
      brandDefaultsFromResult(await brandDefaultsOfStatement(tx, id).all()).get(id) ?? [];
    assertDefaultBusinessUnits(bus, currentBuIds, requestedBuIds);
    const nameChanged = existing.name !== name;
    const setChanged = !sameSet(currentBuIds, requestedBuIds);
    if (!nameChanged && !setChanged) return toBrandDto(existing, sortByBuCode(currentBuIds, bus));
    // Pemeriksaan di atas membaca tanpa kunci: ulangi untuk BU yang ditambah dengan kunci bersama di transaksi tulis.
    const added = requestedBuIds.filter((buId) => !currentBuIds.includes(buId));
    if (added.length > 0) {
      try {
        await activeBuGuardStmt(tx, added).all();
      } catch (error) {
        throw isGuardFailure(error) ? inactiveBuError() : error;
      }
    }
    const key = normalizeKey(name);
    let own: Array<{ id: string; next: string; live: boolean }> = [];
    if (nameChanged) {
      const clash = await tx
        .prepare(
          `SELECT 1 AS hit FROM brands WHERE \`key\` = ? AND id <> ? AND ${liveWhere()} LIMIT 1`,
        )
        .bind(key, id)
        .first();
      if (clash) throw appError('CONFLICT', NAME_TAKEN_MESSAGE, { name: NAME_TAKEN_MESSAGE });
      own = (
        await tx
          .prepare(
            'SELECT id, model, deleted_at FROM items WHERE brand_id = ? ORDER BY id FOR UPDATE',
          )
          .bind(id)
          .all<{ id: string; model: string; deleted_at: string }>()
      ).results.map((item) => ({
        id: item.id,
        next: itemKey(name, item.model),
        live: item.deleted_at === '',
      }));
      // Kunci SEMUA item merk (termasuk yang terhapus) tetap diperbarui, tetapi bentrok nama lain (alias) hanya
      // dinilai untuk item HIDUP: item terhapus tak boleh menggagalkan ganti nama (pemulihannya diperiksa sendiri
      // oleh `planItemRestore`).
      if (
        await aliasCollides(
          tx,
          own.filter((item) => item.live).map((item) => item.next),
        )
      ) {
        throw appError('CONFLICT', RENAME_ALIAS_MESSAGE, { name: RENAME_ALIAS_MESSAGE });
      }
    }

    const now = nowIso(env);
    const updated: BrandRecord = { ...existing, name, key, updatedAt: now, updatedBy: actor.email };
    for (const statement of updateBrandStmts(tx, updated)) await statement.run();
    for (const statement of syncBrandDefaultsStmts(tx, id, requestedBuIds, false)) {
      await statement.run();
    }
    if (own.length > 0) {
      await tx
        .prepare('UPDATE items SET `key` = CONCAT(CHAR(1 USING utf8mb4), id) WHERE brand_id = ?')
        .bind(id)
        .run();
      for (let from = 0; from < own.length; from += RENAME_ITEMS_PER_STATEMENT) {
        const chunk = own.slice(from, from + RENAME_ITEMS_PER_STATEMENT);
        const values = chunk.map(() => 'SELECT ? AS id, ? AS k').join(' UNION ALL ');
        await tx
          .prepare(`UPDATE items i JOIN (${values}) j ON i.id = j.id SET i.\`key\` = j.k`)
          .bind(...chunk.flatMap((item) => [item.id, item.next]))
          .run();
      }
    }
    await writeAudit(tx, {
      ts: now,
      actor: actor.email,
      action: 'brand.update',
      target: updated.name,
      targetId: updated.id,
      before: brandSnapshot(existing, codesOf(currentBuIds, bus)),
      after: brandSnapshot(updated, codesOf(requestedBuIds, bus)),
    }).run();
    return toBrandDto(updated, sortByBuCode(requestedBuIds, bus));
  });
}

export async function saveBrand(
  env: Env,
  input: SaveBrandInput,
  actor: ActorRef,
): Promise<BrandDto> {
  if (input.id) {
    try {
      return await updateBrand(env, input.id, input.name, input.businessUnitIds, actor);
    } catch (error) {
      throw mapDuplicateError(error, BRAND_RENAME_CONFLICTS);
    }
  }
  if (await findBrandByKey(env, normalizeKey(input.name))) {
    throw appError('CONFLICT', NAME_TAKEN_MESSAGE, { name: NAME_TAKEN_MESSAGE });
  }
  const bus = await listBuBriefs(env.DB);
  assertDefaultBusinessUnits(bus, [], input.businessUnitIds);
  const created = newBrandRecord(env, input.name, actor);
  // Penjaga BU aktif (kunci bersama) berada di batch yang sama dengan penulisan: BU yang dinonaktifkan di antara
  // pemeriksaan di atas dan tulis membatalkan batch.
  const guard =
    input.businessUnitIds.length > 0 ? [activeBuGuardStmt(env.DB, input.businessUnitIds)] : [];
  try {
    await batchWrite(
      env.DB,
      [...guard, ...createBrandStmts(env, created, input.businessUnitIds, bus, actor)],
      BRAND_CONFLICTS,
    );
  } catch (error) {
    throw isGuardFailure(error) ? inactiveBuError() : error;
  }
  return toBrandDto(created, sortByBuCode(input.businessUnitIds, bus));
}

const BRAND_STALE_MESSAGE = 'Merk diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';
const BRAND_NOT_FOUND = 'Merk tidak ditemukan';

type LoadedBrand = { brand: BrandRecord; buIds: string[] };

/** Merk (hidup atau terhapus) menurut id beserta id BU bawaannya; `null` bila id tak dikenal. */
async function loadBrandAny(env: Env, id: string): Promise<LoadedBrand | null> {
  const [brandResult, defaultResult] = await env.DB.batch([
    env.DB.prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE id = ?`).bind(id),
    brandDefaultsOfStatement(env.DB, id),
  ]);
  const brand = brandsFromResult(brandResult ?? { results: [] })[0];
  if (!brand) return null;
  return { brand, buIds: brandDefaultsFromResult(defaultResult ?? { results: [] }).get(id) ?? [] };
}

/** Pemuat perencana: merk menurut id, harus ada (selain itu `NOT_FOUND`). `live` menolak merk terhapus. */
async function loadBrandForAction(
  env: Env,
  id: string,
  state: 'live' | 'any',
): Promise<LoadedBrand> {
  const found = await loadBrandAny(env, id);
  if (!found || (state === 'live' && found.brand.deletedAt !== '')) {
    throw appError('NOT_FOUND', BRAND_NOT_FOUND);
  }
  return found;
}

/** Perencana ubah status (merk HIDUP). Status sama = `unchanged`. Penjaga versi membatalkan batch bila merk berubah. */
export function planBrandStatus(
  env: Env,
  found: LoadedBrand,
  status: 'active' | 'inactive',
  actor: ActorRef,
): PlanOutcome<BrandDto> {
  const { brand, buIds } = found;
  if (brand.status === status) return { unchanged: toBrandDto(brand, buIds) };
  const now = nowIso(env);
  const updated: BrandRecord = { ...brand, status, updatedAt: now, updatedBy: actor.email };
  const [update] = setBrandStatusStmts(env.DB, updated);
  return {
    dto: toBrandDto(updated, buIds),
    stmts: [
      versionGuardStmt(env.DB, 'brands', brand.id, brand.updatedAt, 'live'),
      update as DbStatement,
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: status === 'active' ? 'brand.activate' : 'brand.deactivate',
        target: updated.name,
        targetId: updated.id,
        before: brandSnapshot(brand),
        after: brandSnapshot(updated),
      }),
    ],
  };
}

/** Perencana hapus lunak: hanya merk Nonaktif; sudah terhapus = `unchanged` (tanpa audit; `deleted_at` asli utuh). */
export function planBrandRemove(
  env: Env,
  found: LoadedBrand,
  actor: ActorRef,
): PlanOutcome<RemoveResult> {
  const { brand } = found;
  if (brand.deletedAt !== '') return { unchanged: { id: brand.id } };
  if (brand.status !== 'inactive') {
    throw appError('CONFLICT', 'Nonaktifkan merk dulu sebelum dihapus');
  }
  const now = nowIso(env);
  return {
    dto: { id: brand.id },
    stmts: [
      versionGuardStmt(env.DB, 'brands', brand.id, brand.updatedAt, 'live'),
      softDeleteStmt(env.DB, 'brands', brand.id, actor.email, now),
      stampStmt(env.DB, 'brands', brand.id, now, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'brand.delete',
        target: brand.name,
        targetId: brand.id,
        before: brandSnapshot(brand),
        after: { ...brandSnapshot(brand), deleted: true },
      }),
    ],
  };
}

/**
 * Perencana pulihkan: kembali Nonaktif; belum terhapus = `unchanged`. Nama yang kini dipakai merk hidup lain ditolak
 * (`CONFLICT`); indeks unik `_live` tetap menjadi pagar bila ada balapan.
 */
export async function planBrandRestore(
  env: Env,
  found: LoadedBrand,
  actor: ActorRef,
): Promise<PlanOutcome<BrandDto>> {
  const { brand, buIds } = found;
  if (brand.deletedAt === '') return { unchanged: toBrandDto(brand, buIds) };
  if (await findBrandByKey(env, brand.key)) {
    throw appError('CONFLICT', NAME_TAKEN_MESSAGE, { name: NAME_TAKEN_MESSAGE });
  }
  const now = nowIso(env);
  const restored: BrandRecord = {
    ...brand,
    status: 'inactive',
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  return {
    dto: toBrandDto(restored, buIds),
    stmts: [
      versionGuardStmt(env.DB, 'brands', brand.id, brand.updatedAt, 'deleted'),
      restoreStmt(env.DB, 'brands', brand.id),
      env.DB.prepare("UPDATE brands SET status = 'inactive' WHERE id = ?").bind(brand.id),
      stampStmt(env.DB, 'brands', brand.id, now, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'brand.restore',
        target: brand.name,
        targetId: brand.id,
        before: { ...brandSnapshot(brand), deleted: true },
        after: brandSnapshot(restored),
      }),
    ],
  };
}

const BRAND_BATCH = { conflicts: BRAND_CONFLICTS, stale: BRAND_STALE_MESSAGE };

const statusPlanner =
  (env: Env, status: 'active' | 'inactive', actor: ActorRef) =>
  async (id: string): Promise<PlanOutcome<BrandDto>> =>
    planBrandStatus(env, await loadBrandForAction(env, id, 'live'), status, actor);

const removePlanner =
  (env: Env, actor: ActorRef) =>
  async (id: string): Promise<PlanOutcome<RemoveResult>> =>
    planBrandRemove(env, await loadBrandForAction(env, id, 'any'), actor);

const restorePlanner =
  (env: Env, actor: ActorRef) =>
  async (id: string): Promise<PlanOutcome<BrandDto>> =>
    planBrandRestore(env, await loadBrandForAction(env, id, 'any'), actor);

export function setBrandStatusBatch(
  env: Env,
  input: StatusBatchInput,
  actor: ActorRef,
): Promise<BatchResult<BrandDto>> {
  return runRecordBatch(env, input.ids, statusPlanner(env, input.status, actor), BRAND_BATCH);
}

export function setBrandStatus(
  env: Env,
  input: SetBrandStatusInput,
  actor: ActorRef,
): Promise<BrandDto> {
  return runSingleRecord(env, input.id, statusPlanner(env, input.status, actor), BRAND_BATCH);
}

export async function removeBrandBatch(
  env: Env,
  input: IdBatchInput,
  actor: ActorRef,
): Promise<RemoveBatchResult> {
  const { items } = await runRecordBatch(env, input.ids, removePlanner(env, actor), BRAND_BATCH);
  return { ids: items.map((item) => item.id) };
}

export function removeBrand(
  env: Env,
  input: GetBrandInput,
  actor: ActorRef,
): Promise<RemoveResult> {
  return runSingleRecord(env, input.id, removePlanner(env, actor), BRAND_BATCH);
}

export function restoreBrandBatch(
  env: Env,
  input: IdBatchInput,
  actor: ActorRef,
): Promise<BatchResult<BrandDto>> {
  return runRecordBatch(env, input.ids, restorePlanner(env, actor), BRAND_BATCH);
}

export function restoreBrand(env: Env, input: GetBrandInput, actor: ActorRef): Promise<BrandDto> {
  return runSingleRecord(env, input.id, restorePlanner(env, actor), BRAND_BATCH);
}
