import { itemKey, normalizeKey } from '@shared/items';
import type { BrandDto, SaveBrandInput, SetBrandStatusInput } from '@shared/rpc';
import { writeAudit } from '@worker/core/audit';
import type { ActorRef } from '@worker/core/context';
import type { Env } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { batchWrite } from '@worker/modules/access/repo';
import { nextSyncRev, syncRevExpr } from '@worker/modules/sync/state';
import type { BrandRecord } from './repo';
import {
  countItemsByBrand,
  findBrandByKey,
  insertBrandStmts,
  listBrands,
  updateBrandStmts,
} from './repo';

function toBrandDto(brand: BrandRecord, itemCount: number): BrandDto {
  return {
    id: brand.id,
    externalId: brand.externalId,
    name: brand.name,
    status: brand.status,
    itemCount,
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
  const [brands, counts] = await Promise.all([listBrands(env), countItemsByBrand(env)]);
  return brands
    .map((brand) => toBrandDto(brand, counts.get(brand.id) ?? 0))
    .sort((a, b) => a.name.localeCompare(b.name));
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
): Promise<{ brand: BrandRecord; statements: D1PreparedStatement[] }> {
  const found = await findBrandByKey(env, normalizeKey(name));
  if (found) return { brand: found, statements: [] };
  const created = newBrandRecord(env, name, actor);
  return { brand: created, statements: createBrandStmts(env, created, actor) };
}

interface ItemKeyRow {
  id: string;
  brand_id: string;
  model: string;
  key: string;
  aliases: string;
}

function readAliasKeys(text: string): string[] {
  if (text.trim() === '' || text.trim() === '[]') return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string').map((v) => normalizeKey(v))
      : [];
  } catch {
    return [];
  }
}

export async function saveBrand(
  env: Env,
  input: SaveBrandInput,
  actor: ActorRef,
): Promise<BrandDto> {
  const brands = await listBrands(env);
  const existing = input.id ? brands.find((brand) => brand.id === input.id) : undefined;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
  const key = normalizeKey(input.name);
  if (brands.some((brand) => brand.id !== input.id && brand.key === key)) {
    throw appError('CONFLICT', 'Nama merk sudah dipakai', { name: 'Nama merk sudah dipakai' });
  }

  if (!existing) {
    const created = newBrandRecord(env, input.name, actor);
    await batchWrite(env.DB, createBrandStmts(env, created, actor), BRAND_CONFLICTS);
    return toBrandDto(created, 0);
  }

  const counts = await countItemsByBrand(env);
  if (existing.name === input.name) {
    return toBrandDto(existing, counts.get(existing.id) ?? 0);
  }

  // Kunci item = merk + tipe, jadi ganti nama menghitung ulang kunci item merk ini; tolak bila bentrok.
  const rows = await env.DB.prepare(
    'SELECT id, brand_id, model, key, aliases FROM items',
  ).all<ItemKeyRow>();
  const items = rows.results;
  const own = items.filter((item) => item.brand_id === existing.id);
  const recomputed = own.map((item) => ({ item, next: itemKey(input.name, item.model) }));
  const taken = new Set(items.filter((item) => item.brand_id !== existing.id).map((i) => i.key));
  // Kunci baru juga tidak boleh sama dengan nama lain (alias) item mana pun, termasuk milik item itu sendiri.
  const aliasKeys = new Set(items.flatMap((item) => readAliasKeys(item.aliases)));
  if (recomputed.some(({ next }) => aliasKeys.has(next))) {
    const message = 'Nama baru bentrok dengan nama lain item';
    throw appError('CONFLICT', message, { name: message });
  }
  if (recomputed.some(({ next }) => taken.has(next))) {
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
  for (const { item, next } of recomputed) {
    // Nama merk ikut tersinkron di setiap item (`merk`), jadi revisi item naik walau kunci sama.
    statements.push(
      nextSyncRev(env.DB, 'items', now),
      env.DB.prepare(
        `UPDATE items SET key = ?, sync_rev = ${syncRevExpr('items')} WHERE id = ?`,
      ).bind(next, item.id),
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
  await batchWrite(env.DB, statements, BRAND_CONFLICTS);
  return toBrandDto(updated, own.length);
}

export async function setBrandStatus(
  env: Env,
  input: SetBrandStatusInput,
  actor: ActorRef,
): Promise<BrandDto> {
  const brands = await listBrands(env);
  const existing = brands.find((brand) => brand.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'Merk tidak ditemukan');
  const count = (await countItemsByBrand(env)).get(existing.id) ?? 0;
  if (existing.status === input.status) return toBrandDto(existing, count);
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
  return toBrandDto(updated, count);
}
