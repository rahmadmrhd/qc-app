import { listFiles_ } from '@gas/modules/files/repo';
import type { ItemRecord } from '@gas/modules/item/repo';
import { listItems_ } from '@gas/modules/item/repo';
import { brandNameMap_ } from '@gas/modules/item/service';
import { FILE_SCHEME } from '@shared/files';
import { DRIVE_REF_SCHEME, mapMarkdownRefs } from '@shared/items';
import type { SyncWireItem } from '@shared/sync';
import { paginateByRev_, validateSyncPull_ } from './pull';

/** Field berat yang hanya dikirim bila diminta lewat `include`. */
export const SYNC_ITEM_INCLUDABLE = ['detail', 'stickers', 'accessories'] as const;

export function toWireItem_(
  item: ItemRecord,
  names: ReadonlyMap<string, string>,
  driveByFile: ReadonlyMap<string, string>,
  include: readonly string[],
): SyncWireItem {
  const wire: SyncWireItem = {
    uid: item.id,
    id: item.externalId === '' ? null : item.externalId,
    merk: names.get(item.brandId) ?? '',
    tipe: item.model,
    isCountryLock: item.isCountryLock,
    images: item.attachments.flatMap((fileId) => {
      const driveId = driveByFile.get(fileId);
      return driveId === undefined ? [] : [driveId];
    }),
    active: item.status === 'active',
    rev: item.syncRev,
  };
  if (include.includes('detail')) {
    wire.detail = mapMarkdownRefs(
      item.detail,
      FILE_SCHEME,
      DRIVE_REF_SCHEME,
      (id) => driveByFile.get(id) ?? null,
    );
  }
  if (include.includes('stickers')) {
    wire.stickers = item.stickers.map((sticker) => ({
      name: sticker.name,
      note: sticker.note,
      image: sticker.fileId === null ? null : (driveByFile.get(sticker.fileId) ?? null),
    }));
  }
  if (include.includes('accessories')) {
    wire.accessories = item.accessories.map((accessory) => ({
      name: accessory.name,
      qty: accessory.qty,
    }));
  }
  return wire;
}

export function driveIdsByFile_(): Map<string, string> {
  return new Map(listFiles_().map((file) => [file.id, file.driveId]));
}

export function pullItems_(raw: unknown): {
  items: SyncWireItem[];
  nextRev: number;
  hasMore: boolean;
} {
  const input = validateSyncPull_(raw, SYNC_ITEM_INCLUDABLE);
  const { page, nextRev, hasMore } = paginateByRev_(listItems_(), input.sinceRev, input.limit);
  const names = brandNameMap_();
  const driveByFile = driveIdsByFile_();
  return {
    items: page.map((item) => toWireItem_(item, names, driveByFile, input.include)),
    nextRev,
    hasMore,
  };
}
