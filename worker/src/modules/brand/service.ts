import { itemKey, normalizeKey } from '@shared/items';
import type { BrandDto, SaveBrandInput, SetBrandStatusInput } from '@shared/rpc';
import { writeAudit } from '@worker/core/audit';
import type { ActorRef } from '@worker/core/context';
import type { Env } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { batchWrite } from '@worker/modules/access/repo';
import { reserveSyncRevs, syncRevAtExpr } from '@worker/modules/sync/state';
import type { BrandRecord } from './repo';
import { findBrandByKey, insertBrandStmts, listBrands, updateBrandStmts } from './repo';

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

export async function saveBrand(
  env: Env,
  input: SaveBrandInput,
  actor: ActorRef,
): Promise<BrandDto> {
  const brands = await listBrands(env, { fresh: true });
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

  // Kunci item = merk + tipe, jadi ganti nama menghitung ulang kunci item merk ini; tolak bila bentrok.
  // Hanya item merk ini (indeks `items_brand`) dan kunci baru (indeks `items_key` / `item_alias_keys`)
  // yang disentuh; tidak ada pemindaian seluruh tabel `items`.
  const ownRows = await env.DB.prepare('SELECT id, model FROM items WHERE brand_id = ? ORDER BY id')
    .bind(existing.id)
    .all<{ id: string; model: string }>();
  const own = ownRows.results.map((item) => ({
    id: item.id,
    next: itemKey(input.name, item.model),
  }));
  const nextKeys = [...new Set(own.map((item) => item.next))];
  const checks: D1PreparedStatement[] = [];
  for (let from = 0; from < nextKeys.length; from += KEY_CHUNK) {
    const chunk = nextKeys.slice(from, from + KEY_CHUNK);
    const marks = chunk.map(() => '?').join(',');
    checks.push(
      env.DB.prepare(`SELECT key FROM item_alias_keys WHERE key IN (${marks}) LIMIT 1`).bind(
        ...chunk,
      ),
      env.DB.prepare(
        `SELECT key FROM items WHERE brand_id <> ? AND key IN (${marks}) LIMIT 1`,
      ).bind(existing.id, ...chunk),
    );
  }
  const found = checks.length > 0 ? await env.DB.batch(checks) : [];
  // Kunci baru tidak boleh sama dengan nama lain (alias) item mana pun, termasuk milik item itu sendiri.
  if (found.some((result, index) => index % 2 === 0 && result.results.length > 0)) {
    const message = 'Nama baru bentrok dengan nama lain item';
    throw appError('CONFLICT', message, { name: message });
  }
  if (found.some((result, index) => index % 2 === 1 && result.results.length > 0)) {
    const message = 'Nama baru membuat merk dan tipe dua item bentrok';
    throw appError('CONFLICT', message, { name: message });
  }
  const now = nowIso(env);
  const updated: BrandRecord = {
    ...existing,
    name: input.name,
    key,
    updatedAt: now,
    updatedBy: actor.email,
  };
  const statements: D1PreparedStatement[] = [...updateBrandStmts(env.DB, updated)];
  if (own.length > 0) {
    // Nama merk ikut tersinkron di setiap item (`merk`), jadi revisi item naik walau kunci sama. Satu
    // pernyataan memesan N revisi unik berurutan; tiap item mengambil jatahnya sendiri.
    statements.push(reserveSyncRevs(env.DB, 'items', own.length, now));
    for (const [index, item] of own.entries()) {
      statements.push(
        env.DB.prepare(
          `UPDATE items SET key = ?, sync_rev = ${syncRevAtExpr('items', own.length, index)} WHERE id = ?`,
        ).bind(item.next, item.id),
      );
    }
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
  await batchWrite(env.DB, statements, BRAND_CONFLICTS);
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
