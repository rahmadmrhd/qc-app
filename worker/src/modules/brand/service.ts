import { itemKey, normalizeKey } from '@shared/items';
import type { BrandDto, SaveBrandInput, SetBrandStatusInput } from '@shared/rpc';
import { writeAudit } from '@worker/core/audit';
import { CAS_FAIL_SQL, isGuardFailure } from '@worker/core/cas';
import type { ActorRef } from '@worker/core/context';
import type { Env } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { batchWrite } from '@worker/modules/access/repo';
import { reserveSyncRevs } from '@worker/modules/sync/state';
import type { BrandRecord } from './repo';
import {
  brandsFromResult,
  brandsStatement,
  findBrandByKey,
  insertBrandStmts,
  listBrands,
  updateBrandStmts,
} from './repo';

function toBrandDto(brand: BrandRecord): BrandDto {
  return {
    id: brand.id,
    externalId: brand.externalId,
    name: brand.name,
    status: brand.status,
    itemCount: brand.itemCount,
    updatedAt: brand.updatedAt,
  };
}

export function brandSnapshot(brand: BrandRecord): Record<string, unknown> {
  return { name: brand.name, status: brand.status };
}

const BRAND_CONFLICTS = { 'brands.key': { field: 'name', message: 'Nama merk sudah dipakai' } };

function newBrandRecord(env: Env, name: string, actor: ActorRef): BrandRecord {
  const now = nowIso(env);
  return {
    id: crypto.randomUUID(),
    externalId: '',
    name,
    key: normalizeKey(name),
    status: 'active',
    itemCount: 0,
    syncRev: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
}

/** Pernyataan penyisipan merk baru + audit `brand.create` (digabung ke `batch()` pemanggil). */
export function createBrandStmts(
  env: Env,
  brand: BrandRecord,
  actor: ActorRef,
): D1PreparedStatement[] {
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
): Promise<{ brand: BrandRecord; statements: D1PreparedStatement[] }> {
  const found = known === undefined ? await findBrandByKey(env, normalizeKey(name)) : known;
  if (found) return { brand: found, statements: [] };
  const created = newBrandRecord(env, name, actor);
  return { brand: created, statements: createBrandStmts(env, created, actor) };
}

/** Batas parameter terikat D1 per kueri (100) dikurangi sisa parameter tetap. */
const KEY_CHUNK = 90;
/** Item per pernyataan `UPDATE ... FROM json_each` ganti nama (satu parameter JSON, ±90 byte per item). */
const RENAME_ITEMS_PER_STATEMENT = 500;

/**
 * Tabrakan kunci merk+tipe dua item akibat ganti nama: dijaga indeks unik `items.key` pada `UPDATE` item
 * di batch yang sama (bukan kueri pemeriksaan terpisah), jadi pemeriksaan dan penulisan atomik.
 */
const BRAND_RENAME_CONFLICTS = {
  ...BRAND_CONFLICTS,
  'items.key': {
    field: 'name',
    message: 'Nama baru membuat merk dan tipe dua item bentrok',
  },
};

const RENAME_ALIAS_MESSAGE = 'Nama baru bentrok dengan nama lain item';

/**
 * Penjaga di batch ganti nama: kunci item baru tidak boleh sama dengan nama lain (alias) item mana pun, termasuk
 * milik item itu sendiri. Satu `SELECT` per potongan kunci yang melempar `integer overflow` bila ada bentrok
 * (dipetakan ke CONFLICT di `saveBrand`), sehingga seluruh batch batal.
 */
function aliasCollisionGuards(env: Env, keys: readonly string[]): D1PreparedStatement[] {
  const guards: D1PreparedStatement[] = [];
  for (let from = 0; from < keys.length; from += KEY_CHUNK) {
    const chunk = keys.slice(from, from + KEY_CHUNK);
    guards.push(
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM item_alias_keys WHERE key IN (${chunk.map(() => '?').join(',')})) THEN ${CAS_FAIL_SQL} ELSE 1 END`,
      ).bind(...chunk),
    );
  }
  return guards;
}

/**
 * Menghitung ulang kunci SELURUH item merk ini sekaligus (satu `UPDATE ... FROM json_each` per 500 item, bukan
 * satu pernyataan per item) dan memberi tiap item revisi sinkronnya sendiri dari jatah yang dipesan
 * `reserveSyncRevs` di batch yang sama: item ke-`i` dari `count` memakai `seq - (count - 1 - i)`.
 */
function renameItemStatements(
  env: Env,
  own: ReadonlyArray<{ id: string; next: string }>,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let from = 0; from < own.length; from += RENAME_ITEMS_PER_STATEMENT) {
    const chunk = own.slice(from, from + RENAME_ITEMS_PER_STATEMENT);
    const rows = JSON.stringify(chunk.map((item, offset) => [item.id, item.next, from + offset]));
    statements.push(
      env.DB.prepare(
        `UPDATE items SET key = j.k, sync_rev = (SELECT seq FROM sync_state WHERE resource = 'items') - ${own.length - 1} + j.i FROM (SELECT json_extract(value, '$[0]') AS id, json_extract(value, '$[1]') AS k, json_extract(value, '$[2]') AS i FROM json_each(?)) AS j WHERE items.id = j.id`,
      ).bind(rows),
    );
  }
  return statements;
}

export async function saveBrand(
  env: Env,
  input: SaveBrandInput,
  actor: ActorRef,
): Promise<BrandDto> {
  // Satu round trip baca: daftar merk (langsung dari D1) dan, untuk merk yang ada, item milik merk itu
  // (indeks `items_brand`; dipakai hanya bila nama berubah).
  const [brandsResult, ownRows] = await env.DB.batch([
    brandsStatement(env),
    ...(input.id
      ? [
          env.DB.prepare('SELECT id, model FROM items WHERE brand_id = ? ORDER BY id').bind(
            input.id,
          ),
        ]
      : []),
  ]);
  const brands = brandsFromResult(brandsResult as { results: unknown[] });
  const existing = input.id ? brands.find((brand) => brand.id === input.id) : undefined;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
  const key = normalizeKey(input.name);
  if (brands.some((brand) => brand.id !== input.id && brand.key === key)) {
    throw appError('CONFLICT', 'Nama merk sudah dipakai', { name: 'Nama merk sudah dipakai' });
  }

  if (!existing) {
    const created = newBrandRecord(env, input.name, actor);
    await batchWrite(env.DB, createBrandStmts(env, created, actor), BRAND_CONFLICTS);
    return toBrandDto(created);
  }

  if (existing.name === input.name) return toBrandDto(existing);

  // Kunci item = merk + tipe, jadi ganti nama menghitung ulang kunci item merk ini. Tabrakan dengan nama lain
  // (alias) dijaga penjaga di batch tulis; tabrakan dengan merk+tipe item lain dijaga indeks unik `items.key`.
  // Hanya item merk ini (indeks `items_brand`) dan kunci baru yang disentuh; tidak ada pemindaian `items`.
  const own = ((ownRows?.results ?? []) as Array<{ id: string; model: string }>).map((item) => ({
    id: item.id,
    next: itemKey(input.name, item.model),
  }));
  const now = nowIso(env);
  const updated: BrandRecord = {
    ...existing,
    name: input.name,
    key,
    updatedAt: now,
    updatedBy: actor.email,
  };
  const statements: D1PreparedStatement[] = [
    ...aliasCollisionGuards(env, [...new Set(own.map((item) => item.next))]),
    ...updateBrandStmts(env.DB, updated),
  ];
  if (own.length > 0) {
    // Nama merk ikut tersinkron di setiap item (`merk`), jadi revisi item naik walau kunci sama. Satu
    // pernyataan memesan N revisi unik berurutan; tiap item mengambil jatahnya sendiri.
    statements.push(
      reserveSyncRevs(env.DB, 'items', own.length, now),
      ...renameItemStatements(env, own),
    );
  }
  statements.push(
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: 'brand.update',
      target: updated.name,
      before: brandSnapshot(existing),
      after: brandSnapshot(updated),
    }),
  );
  try {
    await batchWrite(env.DB, statements, BRAND_RENAME_CONFLICTS);
  } catch (error) {
    if (isGuardFailure(error)) {
      throw appError('CONFLICT', RENAME_ALIAS_MESSAGE, { name: RENAME_ALIAS_MESSAGE });
    }
    throw error;
  }
  return toBrandDto(updated);
}

export async function setBrandStatus(
  env: Env,
  input: SetBrandStatusInput,
  actor: ActorRef,
): Promise<BrandDto> {
  const brands = await listBrands(env, { fresh: true });
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
  await env.DB.batch([
    ...updateBrandStmts(env.DB, updated),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'brand.activate' : 'brand.deactivate',
      target: updated.name,
      before: brandSnapshot(existing),
      after: brandSnapshot(updated),
    }),
  ]);
  return toBrandDto(updated);
}
