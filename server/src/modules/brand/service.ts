import { writeAudit } from '@server/core/audit';
import { isGuardFailure, nameGuardStmt, runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement, DbTx } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { batchWrite, mapDuplicateError } from '@server/modules/access/repo';
import type { BrandDto, SaveBrandInput, SetBrandStatusInput } from '@shared/contract';
import { itemKey, normalizeKey } from '@shared/items';
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
    id: crypto.randomUUID(),
    name,
    key: normalizeKey(name),
    status: 'active',
    itemCount: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
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
      before: null,
      after: brandSnapshot(brand, codesOf(businessUnitIds, bus)),
    }),
  ];
}

/** Daftar merk beserta BU bawaan: dua kueri dalam SATU `batch()` (satu kueri tambahan, bukan N+1). */
export async function listBrandDtos(env: Env): Promise<BrandDto[]> {
  const [brandResult, defaultResult] = await env.DB.batch([
    brandsStatement(env),
    brandDefaultsStatement(env.DB),
  ]);
  const defaults = brandDefaultsFromResult(defaultResult ?? { results: [] });
  return brandsFromResult(brandResult ?? { results: [] })
    .map((brand) => toBrandDto(brand, defaults.get(brand.id) ?? []))
    .sort((a, b) => a.name.localeCompare(b.name));
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
      .prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE id = ? FOR UPDATE`)
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
    let own: Array<{ id: string; next: string }> = [];
    if (nameChanged) {
      const clash = await tx
        .prepare('SELECT 1 AS hit FROM brands WHERE `key` = ? AND id <> ? LIMIT 1')
        .bind(key, id)
        .first();
      if (clash) throw appError('CONFLICT', NAME_TAKEN_MESSAGE, { name: NAME_TAKEN_MESSAGE });
      own = (
        await tx
          .prepare('SELECT id, model FROM items WHERE brand_id = ? ORDER BY id FOR UPDATE')
          .bind(id)
          .all<{ id: string; model: string }>()
      ).results.map((item) => ({ id: item.id, next: itemKey(name, item.model) }));
      if (
        await aliasCollides(
          tx,
          own.map((item) => item.next),
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

export async function setBrandStatus(
  env: Env,
  input: SetBrandStatusInput,
  actor: ActorRef,
): Promise<BrandDto> {
  // Penjaga nama: ganti nama yang menyela membatalkan batch dan keadaan dimuat ulang (audit memakai nama terkini).
  return runCas(() => setBrandStatusOnce(env, input, actor), BRAND_STALE_MESSAGE);
}

const BRAND_STALE_MESSAGE = 'Merk diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

async function setBrandStatusOnce(
  env: Env,
  input: SetBrandStatusInput,
  actor: ActorRef,
): Promise<BrandDto> {
  const [brandResult, defaultResult] = await env.DB.batch([
    brandsStatement(env),
    brandDefaultsOfStatement(env.DB, input.id),
  ]);
  const existing = brandsFromResult(brandResult ?? { results: [] }).find(
    (brand) => brand.id === input.id,
  );
  if (!existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
  const buIds = brandDefaultsFromResult(defaultResult ?? { results: [] }).get(existing.id) ?? [];
  if (existing.status === input.status) return toBrandDto(existing, buIds);
  const now = nowIso(env);
  const updated: BrandRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  // Hanya kolom status yang ditulis; baris terkini dibaca di akhir batch untuk DTO (nama bisa baru diganti orang lain).
  const results = await env.DB.batch([
    nameGuardStmt(env.DB, 'brands', existing.id, existing.name),
    ...setBrandStatusStmts(env.DB, updated),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'brand.activate' : 'brand.deactivate',
      target: updated.name,
      before: brandSnapshot(existing),
      after: brandSnapshot(updated),
    }),
  ]);
  const fresh = brandsFromResult(results[2] as { results: unknown[] })[0];
  return toBrandDto(fresh ?? updated, buIds);
}
