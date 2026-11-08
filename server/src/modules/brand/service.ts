import { writeAudit } from '@server/core/audit';
import { nameGuardStmt, runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement, DbTx } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { batchWrite, mapDuplicateError } from '@server/modules/access/repo';
import type { BrandDto, SaveBrandInput, SetBrandStatusInput } from '@shared/contract';
import { itemKey, normalizeKey } from '@shared/items';
import type { BrandRecord, BrandRow } from './repo';
import {
  BRAND_COLUMNS,
  brandsFromResult,
  findBrandByKey,
  insertBrandStmts,
  listBrands,
  setBrandStatusStmts,
  updateBrandStmts,
} from './repo';

function toBrandDto(brand: BrandRecord): BrandDto {
  return {
    id: brand.id,
    name: brand.name,
    status: brand.status,
    itemCount: brand.itemCount,
    updatedAt: brand.updatedAt,
  };
}

export function brandSnapshot(brand: BrandRecord): Record<string, unknown> {
  return { name: brand.name, status: brand.status };
}

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

/** Pernyataan penyisipan merk baru + audit `brand.create` (digabung ke `batch()` pemanggil). */
export function createBrandStmts(env: Env, brand: BrandRecord, actor: ActorRef): DbStatement[] {
  return [
    ...insertBrandStmts(env.DB, brand),
    writeAudit(env.DB, {
      ts: brand.createdAt,
      actor: actor.email,
      action: 'brand.create',
      target: brand.name,
      before: null,
      after: brandSnapshot(brand),
    }),
  ];
}

export async function listBrandDtos(env: Env): Promise<BrandDto[]> {
  return (await listBrands(env)).map(toBrandDto).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Rencana "buat merk langsung saat mengetik" untuk penyimpanan item: bila merk (kunci ternormalisasi)
 * sudah ada, kembalikan tanpa pernyataan; jika belum, kembalikan merk baru beserta pernyataan
 * penyisipan + audit untuk digabung ke `batch()` penyimpanan item (atomik).
 */
export async function planBrandByName(
  env: Env,
  name: string,
  actor: ActorRef,
  /** Hasil `findBrandByKey` yang sudah dimuat pemanggil (hindari kueri ganda); `undefined` = muat di sini. */
  known?: BrandRecord | null,
): Promise<{ brand: BrandRecord; statements: DbStatement[] }> {
  const found = known === undefined ? await findBrandByKey(env, normalizeKey(name)) : known;
  if (found) return { brand: found, statements: [] };
  const created = newBrandRecord(env, name, actor);
  return { brand: created, statements: createBrandStmts(env, created, actor) };
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
async function renameBrand(env: Env, id: string, name: string, actor: ActorRef): Promise<BrandDto> {
  return env.DB.transaction(async (tx) => {
    const row = await tx
      .prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE id = ? FOR UPDATE`)
      .bind(id)
      .first<BrandRow>();
    const existing = row ? brandsFromResult({ results: [row] })[0] : undefined;
    if (!existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
    if (existing.name === name) return toBrandDto(existing);
    const key = normalizeKey(name);
    const clash = await tx
      .prepare('SELECT 1 AS hit FROM brands WHERE `key` = ? AND id <> ? LIMIT 1')
      .bind(key, id)
      .first();
    if (clash) throw appError('CONFLICT', NAME_TAKEN_MESSAGE, { name: NAME_TAKEN_MESSAGE });

    const own = (
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

    const now = nowIso(env);
    const updated: BrandRecord = { ...existing, name, key, updatedAt: now, updatedBy: actor.email };
    for (const statement of updateBrandStmts(tx, updated)) await statement.run();
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
      before: brandSnapshot(existing),
      after: brandSnapshot(updated),
    }).run();
    return toBrandDto(updated);
  });
}

export async function saveBrand(
  env: Env,
  input: SaveBrandInput,
  actor: ActorRef,
): Promise<BrandDto> {
  if (input.id) {
    try {
      return await renameBrand(env, input.id, input.name, actor);
    } catch (error) {
      throw mapDuplicateError(error, BRAND_RENAME_CONFLICTS);
    }
  }
  if (await findBrandByKey(env, normalizeKey(input.name))) {
    throw appError('CONFLICT', NAME_TAKEN_MESSAGE, { name: NAME_TAKEN_MESSAGE });
  }
  const created = newBrandRecord(env, input.name, actor);
  await batchWrite(env.DB, createBrandStmts(env, created, actor), BRAND_CONFLICTS);
  return toBrandDto(created);
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
  const brands = await listBrands(env);
  const existing = brands.find((brand) => brand.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
  if (existing.status === input.status) return toBrandDto(existing);
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
  return toBrandDto(fresh ?? updated);
}
