import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { attachFiles_ } from '@gas/modules/files/service';
import { extractFileRefs, hashText, itemKey, normalizeKey } from '@shared/items';
import type {
  GetItemInput,
  ItemDto,
  ItemSummaryDto,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/rpc';
import type { ItemRecord, NewItemRecord } from './repo';
import { insertItem_, listItems_, updateItem_ } from './repo';

function toItemSummaryDto_(item: NewItemRecord): ItemSummaryDto {
  return {
    id: item.id,
    externalId: item.externalId,
    brand: item.brand,
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: [...item.aliases],
    imageCount: item.attachments.length,
    updatedAt: item.updatedAt,
  };
}

function toItemDto_(item: NewItemRecord): ItemDto {
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
function itemSnapshot_(item: NewItemRecord): Record<string, unknown> {
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

function itemLabel_(item: { brand: string; model: string }): string {
  return `${item.brand} ${item.model}`;
}

export function listItemSummaries_(): ItemSummaryDto[] {
  return listItems_()
    .map(toItemSummaryDto_)
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
}

export function getItemDto_(input: GetItemInput): ItemDto {
  const found = listItems_().find((item) => item.id === input.id);
  if (!found) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
  return toItemDto_(found);
}

/** Merk+tipe dan nama lain harus unik terhadap item lain (kunci ternormalisasi). */
function assertItemNamesFree_(
  input: SaveItemInput,
  key: string,
  others: readonly ItemRecord[],
): void {
  if (others.some((other) => other.key === key)) {
    throw appError_('CONFLICT', 'Merk dan tipe sudah dipakai item lain', {
      model: 'Merk dan tipe sudah dipakai item lain',
    });
  }
  const holder = others.find((other) => other.aliases.some((alias) => normalizeKey(alias) === key));
  if (holder) {
    throw appError_('CONFLICT', 'Merk dan tipe sama dengan nama lain item lain', {
      model: `Sama dengan nama lain item ${itemLabel_(holder)}`,
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
      const message = `Nama lain "${alias}" sudah dipakai item ${itemLabel_(owner)}`;
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

export function saveItem_(input: SaveItemInput, actor: UserContext): ItemDto {
  return platform_().withLock(() => {
    const items = listItems_();
    const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
    if (input.id && !existing) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
    const key = itemKey(input.brand, input.model);
    assertItemNamesFree_(
      input,
      key,
      items.filter((item) => item.id !== input.id),
    );
    const id = existing?.id ?? platform_().uuid();
    // Atomik: bila ada rujukan berkas yang tak sah, tidak ada pemilik yang berubah dan item tidak disimpan.
    attachFiles_(referencedFileIds_(input), 'item', id);
    const now = nowIso_();
    const fields = {
      brand: input.brand,
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
      const updated: ItemRecord = { ...existing, ...fields };
      updateItem_(updated);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'item.update',
        target: itemLabel_(updated),
        before: itemSnapshot_(existing),
        after: itemSnapshot_(updated),
      });
      return toItemDto_(updated);
    }

    const created: NewItemRecord = {
      id,
      externalId: '',
      status: 'active',
      syncRev: 0,
      createdAt: now,
      ...fields,
    };
    insertItem_(created);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'item.create',
      target: itemLabel_(created),
      before: null,
      after: itemSnapshot_(created),
    });
    return toItemDto_(created);
  });
}

export function setItemStatus_(input: SetItemStatusInput, actor: UserContext): ItemDto {
  return platform_().withLock(() => {
    const existing = listItems_().find((item) => item.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
    if (existing.status === input.status) return toItemDto_(existing);
    const now = nowIso_();
    const updated: ItemRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateItem_(updated);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'item.activate' : 'item.deactivate',
      target: itemLabel_(existing),
      before: itemSnapshot_(existing),
      after: itemSnapshot_(updated),
    });
    return toItemDto_(updated);
  });
}
