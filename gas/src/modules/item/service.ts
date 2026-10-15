import type { ActorRef } from '@gas/core/actor';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import type { NewBrandRecord } from '@gas/modules/brand/repo';
import { listBrands_ } from '@gas/modules/brand/repo';
import { resolveBrandByName_ } from '@gas/modules/brand/service';
import { listFiles_ } from '@gas/modules/files/repo';
import { attachFiles_ } from '@gas/modules/files/service';
import { nextRev_ } from '@gas/modules/sync/state';
import { extractFileRefs, hashText, itemKey, normalizeKey } from '@shared/items';
import type {
  GetItemInput,
  ItemAccessoryDto,
  ItemDto,
  ItemStatus,
  ItemStickerDto,
  ItemSummaryDto,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/rpc';
import type { ItemRecord, NewItemRecord } from './repo';
import { insertItem_, listItems_, updateItem_ } from './repo';

/** Record item beserta nama merk (dari tabel merk) untuk DTO dan audit. */
export type ItemView = NewItemRecord & { brand: string };

export function brandNameMap_(): Map<string, string> {
  return new Map(listBrands_().map((brand) => [brand.id, brand.name]));
}

export function toItemView_(item: NewItemRecord, names: Map<string, string>): ItemView {
  return { ...item, brand: names.get(item.brandId) ?? '' };
}

function toItemSummaryDto_(item: ItemView): ItemSummaryDto {
  return {
    id: item.id,
    externalId: item.externalId,
    brandId: item.brandId,
    brand: item.brand,
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: [...item.aliases],
    imageCount: item.attachments.length,
    updatedAt: item.updatedAt,
  };
}

function toItemDto_(item: ItemView): ItemDto {
  return {
    ...toItemSummaryDto_(item),
    stickers: item.stickers.map((sticker) => ({ ...sticker })),
    accessories: item.accessories.map((accessory) => ({ ...accessory })),
    attachments: [...item.attachments],
    detail: item.detail,
    createdAt: item.createdAt,
    updatedBy: item.updatedBy,
  };
}

/** Snapshot audit ringkas: teks Markdown tidak disimpan, hanya panjang dan hash (sel audit maks. 50.000 karakter). */
export function itemSnapshot_(item: ItemView): Record<string, unknown> {
  return {
    brand: item.brand,
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: [...item.aliases],
    stickers: item.stickers.map(
      (sticker) =>
        `${sticker.name}${sticker.note ? ` — ${sticker.note}` : ''}${sticker.fileId ? ' · bergambar' : ''}`,
    ),
    accessories: item.accessories.map((accessory) => `${accessory.name} ×${accessory.qty}`),
    attachments: [...item.attachments],
    detailLength: item.detail.length,
    detailHash: hashText(item.detail),
  };
}

export function itemLabel_(item: { brand: string; model: string }): string {
  return `${item.brand} ${item.model}`;
}

export function listItemSummaries_(): ItemSummaryDto[] {
  const names = brandNameMap_();
  return listItems_()
    .map((item) => toItemSummaryDto_(toItemView_(item, names)))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

export function getItemDto_(input: GetItemInput): ItemDto {
  const found = listItems_().find((item) => item.id === input.id);
  if (!found) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
  return toItemDto_(toItemView_(found, brandNameMap_()));
}

/** Merk+tipe dan nama lain harus unik terhadap item lain (kunci ternormalisasi). */
function assertItemNamesFree_(
  input: SaveItemInput,
  key: string,
  others: readonly ItemRecord[],
  names: Map<string, string>,
): void {
  if (others.some((other) => other.key === key)) {
    throw appError_('CONFLICT', 'Merk dan tipe sudah dipakai item lain', {
      model: 'Merk dan tipe sudah dipakai item lain',
    });
  }
  const holder = others.find((other) => other.aliases.some((alias) => normalizeKey(alias) === key));
  if (holder) {
    throw appError_('CONFLICT', 'Merk dan tipe sama dengan nama lain item lain', {
      model: `Sama dengan nama lain item ${itemLabel_(toItemView_(holder, names))}`,
    });
  }
  for (const alias of input.aliases) {
    const aliasKey = normalizeKey(alias);
    if (aliasKey === key) {
      throw appError_('VALIDATION', 'Nama lain sama dengan merk dan tipe', {
        aliases: 'Nama lain tidak boleh sama dengan merk dan tipe item ini',
      });
    }
    const owner = others.find(
      (other) => other.key === aliasKey || other.aliases.some((x) => normalizeKey(x) === aliasKey),
    );
    if (owner) {
      const message = `Nama lain "${alias}" sudah dipakai item ${itemLabel_(toItemView_(owner, names))}`;
      throw appError_('CONFLICT', message, { aliases: message });
    }
  }
}

/** Semua berkas yang dirujuk item: galeri, contoh stiker, dan gambar di dalam Markdown. */
function referencedFileIds_(input: SaveItemInput): string[] {
  const ids: string[] = [...input.attachments];
  for (const sticker of input.stickers) {
    if (sticker.fileId !== null) ids.push(sticker.fileId);
  }
  ids.push(...extractFileRefs(input.detail));
  return [...new Set(ids)];
}

/**
 * Memeriksa rujukan berkas SEBELUM menulis dan melaporkannya di field yang sesuai (lampiran, stiker, detail):
 * tidak dikenal → VALIDATION, sudah dipakai entitas lain → CONFLICT. `attachFiles_` tetap menjadi pagar atomik.
 */
function assertItemFilesUsable_(input: SaveItemInput, ownerId: string): void {
  const files = new Map(listFiles_().map((file) => [file.id, file]));
  const problem = (fileId: string): 'unknown' | 'taken' | null => {
    const file = files.get(fileId);
    if (!file) return 'unknown';
    if (file.ownerType !== '' && !(file.ownerType === 'item' && file.ownerId === ownerId)) {
      return 'taken';
    }
    return null;
  };
  const fail = (kind: 'unknown' | 'taken', field: string, subject: string): never => {
    const message =
      kind === 'unknown'
        ? `${subject} tidak dikenal; unggah ulang`
        : `${subject} sudah dipakai item lain`;
    throw appError_(kind === 'unknown' ? 'VALIDATION' : 'CONFLICT', message, { [field]: message });
  };
  for (const fileId of input.attachments) {
    const kind = problem(fileId);
    if (kind) fail(kind, 'attachments', 'Ada gambar lampiran');
  }
  input.stickers.forEach((sticker, index) => {
    if (sticker.fileId === null) return;
    const kind = problem(sticker.fileId);
    if (kind) fail(kind, 'stickers', `Stiker ${index + 1}: gambar`);
  });
  for (const fileId of extractFileRefs(input.detail)) {
    const kind = problem(fileId);
    if (kind) fail(kind, 'detail', 'Ada gambar di detail');
  }
}

/** Field yang disinkronkan ke Desktop (FS7). Alias TIDAK termasuk: mengubahnya tidak menaikkan revisi. */
export function itemSyncSignature_(item: {
  brandId: string;
  model: string;
  isCountryLock: boolean;
  attachments: readonly string[];
  detail: string;
  stickers: readonly ItemStickerDto[];
  accessories: readonly ItemAccessoryDto[];
  status: ItemStatus;
}): string {
  return JSON.stringify([
    item.brandId,
    item.model,
    item.isCountryLock,
    item.attachments,
    item.detail,
    item.stickers,
    item.accessories,
    item.status,
  ]);
}

export interface WriteItemOptions {
  existing?: ItemRecord | undefined;
  /** Hanya item baru: id yang sudah dipakai pemanggil (mis. untuk menautkan berkas sebelum menulis). */
  id?: string | undefined;
  actor: ActorRef;
  /** Hanya sinkronisasi: id MySQL yang dipetakan ke item ini. */
  externalId?: string | undefined;
  /** Hanya sinkronisasi: status yang diminta (default: tetap; item baru aktif). */
  status?: ItemStatus | undefined;
}

/**
 * Menulis item (baru atau ubah): keunikan, penautan berkas atomik, merk dibuat bila belum ada, kenaikan sync_rev,
 * dan audit. Dipakai form web (`saveItem_`) dan sinkronisasi. PEMANGGIL WAJIB memegang lock.
 */
export function writeItem_(input: SaveItemInput, options: WriteItemOptions): NewItemRecord {
  const { existing, actor } = options;
  const items = listItems_();
  const key = itemKey(input.brand, input.model);
  // Merk dinonaktifkan tidak boleh dipakai item baru (atau item yang pindah merk).
  const brandKey = normalizeKey(input.brand);
  const knownBrand = listBrands_().find((brand) => brand.key === brandKey);
  if (knownBrand && knownBrand.status === 'inactive' && existing?.brandId !== knownBrand.id) {
    const message = 'Merk dinonaktifkan; aktifkan dulu di halaman Merk';
    throw appError_('VALIDATION', message, { brand: message });
  }
  assertItemNamesFree_(
    input,
    key,
    items.filter((item) => item.id !== existing?.id),
    brandNameMap_(),
  );
  const id = existing?.id ?? options.id ?? platform_().uuid();
  // Atomik: bila ada rujukan berkas yang tak sah, tidak ada pemilik yang berubah dan item tidak disimpan.
  assertItemFilesUsable_(input, id);
  attachFiles_(referencedFileIds_(input), 'item', id);
  // Merk baru dibuat langsung dari isian (tanpa form tambahan); setelah semua validasi lolos.
  const brand: NewBrandRecord = resolveBrandByName_(input.brand, actor);
  const now = nowIso_();
  const status = options.status ?? existing?.status ?? 'active';
  const fields = {
    brandId: brand.id,
    model: input.model,
    key,
    isCountryLock: input.isCountryLock,
    aliases: [...input.aliases],
    stickers: input.stickers.map((sticker) => ({ ...sticker })),
    accessories: input.accessories.map((accessory) => ({ ...accessory })),
    attachments: [...input.attachments],
    detail: input.detail,
    updatedAt: now,
    updatedBy: actor.email,
  };

  if (existing) {
    const merged: ItemRecord = {
      ...existing,
      ...fields,
      status,
      externalId: options.externalId ?? existing.externalId,
    };
    const changed = itemSyncSignature_(existing) !== itemSyncSignature_(merged);
    const updated: ItemRecord = {
      ...merged,
      syncRev: changed ? nextRev_('items') : existing.syncRev,
    };
    updateItem_(updated);
    const names = brandNameMap_();
    const after = toItemView_(updated, names);
    const onlyStatus =
      existing.status !== status &&
      itemSyncSignature_({ ...existing, status }) === itemSyncSignature_(merged);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: onlyStatus
        ? status === 'active'
          ? 'item.activate'
          : 'item.deactivate'
        : 'item.update',
      target: itemLabel_(after),
      before: itemSnapshot_(toItemView_(existing, names)),
      after: itemSnapshot_(after),
    });
    return updated;
  }

  const created: NewItemRecord = {
    id,
    externalId: options.externalId ?? '',
    status,
    syncRev: nextRev_('items'),
    createdAt: now,
    ...fields,
  };
  insertItem_(created);
  const createdView = toItemView_(created, brandNameMap_());
  appendAudit_({
    ts: now,
    actor: actor.email,
    action: 'item.create',
    target: itemLabel_(createdView),
    before: null,
    after: itemSnapshot_(createdView),
  });
  return created;
}

export function saveItem_(input: SaveItemInput, actor: ActorRef): ItemDto {
  return platform_().withLock(() => {
    const existing = input.id ? listItems_().find((item) => item.id === input.id) : undefined;
    if (input.id && !existing) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
    const record = writeItem_(input, { existing, actor });
    return toItemDto_(toItemView_(record, brandNameMap_()));
  });
}

export function setItemStatus_(input: SetItemStatusInput, actor: ActorRef): ItemDto {
  return platform_().withLock(() => {
    const existing = listItems_().find((item) => item.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
    const names = brandNameMap_();
    if (existing.status === input.status) return toItemDto_(toItemView_(existing, names));
    const now = nowIso_();
    const updated: ItemRecord = {
      ...existing,
      status: input.status,
      syncRev: nextRev_('items'),
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateItem_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'item.activate' : 'item.deactivate',
      target: itemLabel_(toItemView_(existing, names)),
      before: itemSnapshot_(toItemView_(existing, names)),
      after: itemSnapshot_(toItemView_(updated, names)),
    });
    return toItemDto_(toItemView_(updated, names));
  });
}
