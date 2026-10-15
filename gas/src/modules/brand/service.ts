import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { listItems_, updateItem_ } from '@gas/modules/item/repo';
import { itemKey, normalizeKey } from '@shared/items';
import type { BrandDto, SaveBrandInput, SetBrandStatusInput } from '@shared/rpc';
import type { BrandRecord, NewBrandRecord } from './repo';
import { insertBrand_, listBrands_, updateBrand_ } from './repo';

function toBrandDto_(brand: NewBrandRecord, itemCount: number): BrandDto {
  return {
    id: brand.id,
    externalId: brand.externalId,
    name: brand.name,
    status: brand.status,
    itemCount,
    updatedAt: brand.updatedAt,
  };
}

function brandSnapshot_(brand: NewBrandRecord): Record<string, unknown> {
  return { name: brand.name, status: brand.status };
}

function countItemsByBrand_(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of listItems_()) counts.set(item.brandId, (counts.get(item.brandId) ?? 0) + 1);
  return counts;
}

function newBrandRecord_(name: string, actor: UserContext): NewBrandRecord {
  const now = nowIso_();
  return {
    id: platform_().uuid(),
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

function insertBrandWithAudit_(brand: NewBrandRecord, actor: UserContext): void {
  insertBrand_(brand);
  appendAudit_({
    ts: brand.createdAt,
    actor: actor.email,
    action: 'brand.create',
    target: brand.name,
    before: null,
    after: brandSnapshot_(brand),
  });
}

export function listBrandDtos_(): BrandDto[] {
  const counts = countItemsByBrand_();
  return listBrands_()
    .map((brand) => toBrandDto_(brand, counts.get(brand.id) ?? 0))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Cari merk menurut nama (kunci ternormalisasi); bila belum ada, buat dan catat audit.
 * Dipanggil DI DALAM lock penyimpanan item (tidak mengunci sendiri). Inilah "buat merk langsung
 * saat mengetik": tanpa form tambahan.
 */
export function resolveBrandByName_(name: string, actor: UserContext): NewBrandRecord {
  const key = normalizeKey(name);
  const found = listBrands_().find((brand) => brand.key === key);
  if (found) return found;
  const created = newBrandRecord_(name, actor);
  insertBrandWithAudit_(created, actor);
  return created;
}

export function saveBrand_(input: SaveBrandInput, actor: UserContext): BrandDto {
  return platform_().withLock(() => {
    const brands = listBrands_();
    const existing = input.id ? brands.find((brand) => brand.id === input.id) : undefined;
    if (input.id && !existing) throw appError_('NOT_FOUND', 'Merk tidak ditemukan');
    const key = normalizeKey(input.name);
    if (brands.some((brand) => brand.id !== input.id && brand.key === key)) {
      throw appError_('CONFLICT', 'Nama merk sudah dipakai', { name: 'Nama merk sudah dipakai' });
    }

    if (!existing) {
      const created = newBrandRecord_(input.name, actor);
      insertBrandWithAudit_(created, actor);
      return toBrandDto_(created, 0);
    }

    if (existing.name === input.name) {
      return toBrandDto_(existing, countItemsByBrand_().get(existing.id) ?? 0);
    }

    // Kunci item = merk + tipe, jadi ganti nama menghitung ulang kunci item merk ini; tolak bila bentrok.
    const items = listItems_();
    const own = items.filter((item) => item.brandId === existing.id);
    const recomputed = own.map((item) => ({ item, next: itemKey(input.name, item.model) }));
    const taken = new Set(
      items.filter((item) => item.brandId !== existing.id).map((item) => item.key),
    );
    // Kunci baru juga tidak boleh sama dengan nama lain (alias) item mana pun, termasuk milik item itu sendiri.
    const aliasKeys = new Set(
      items.flatMap((item) => item.aliases.map((alias) => normalizeKey(alias))),
    );
    if (recomputed.some(({ next }) => aliasKeys.has(next))) {
      const message = 'Nama baru bentrok dengan nama lain item';
      throw appError_('CONFLICT', message, { name: message });
    }
    if (recomputed.some(({ next }) => taken.has(next))) {
      const message = 'Nama baru membuat merk dan tipe dua item bentrok';
      throw appError_('CONFLICT', message, { name: message });
    }
    const now = nowIso_();
    const updated: BrandRecord = {
      ...existing,
      name: input.name,
      key,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateBrand_(updated);
    for (const { item, next } of recomputed) {
      if (item.key !== next) updateItem_({ ...item, key: next });
    }
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'brand.update',
      target: updated.name,
      before: brandSnapshot_(existing),
      after: brandSnapshot_(updated),
    });
    return toBrandDto_(updated, own.length);
  });
}

export function setBrandStatus_(input: SetBrandStatusInput, actor: UserContext): BrandDto {
  return platform_().withLock(() => {
    const existing = listBrands_().find((brand) => brand.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Merk tidak ditemukan');
    const count = countItemsByBrand_().get(existing.id) ?? 0;
    if (existing.status === input.status) return toBrandDto_(existing, count);
    const now = nowIso_();
    const updated: BrandRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateBrand_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'brand.activate' : 'brand.deactivate',
      target: updated.name,
      before: brandSnapshot_(existing),
      after: brandSnapshot_(updated),
    });
    return toBrandDto_(updated, count);
  });
}
