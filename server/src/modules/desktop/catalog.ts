import { createHash } from 'node:crypto';
import type { Db } from '@server/core/db';
import { type Env, nowOf } from '@server/core/env';
import {
  itemBusinessUnitsOf,
  manualBookDesignIdsOf,
  parseStrings,
  postelStickerIdsOf,
} from '@server/modules/item/repo';
import { loadItemInstructions } from '@server/modules/sticker/instruction-repo';
import { buildInstructionViews } from '@server/modules/sticker/instruction-service';
import { latestManualBookStickerIds } from '@server/modules/sticker/repo';
import {
  type CatalogFileDto,
  type CatalogItemDto,
  type CatalogStickerDto,
  type CatalogStickerTypeDto,
  catalogFileIds,
  DESKTOP_CATALOG_VERSION,
  type DesktopCatalogDto,
} from '@shared/desktop-catalog';
import {
  type MatchSticker,
  type StickerRule,
  type StickerStatus,
  type StickerSystemKind,
  stickersForType,
} from '@shared/stickers';

/**
 * Penyusun katalog Tipe offline desktop (spek desktop §6.6, keputusan pemilik 2026-11-16): SEMUA item aktif dengan
 * `isCountryLock` yang punya minimal satu BU (tanpa saringan menurut penugasan BU: tanpa login tidak ada penugasan; item
 * tanpa BU dikecualikan karena tak terlihat di web, keputusan pemilik 2026-11-18) beserta instruksi penempelan stiker yang
 * diselesaikan di sini (`buildInstructionViews`, termasuk aturan `group` Manual Book/Postel), jenis dan stiker yang
 * dirujuk, dan daftar berkas gambar. Keluaran deterministik (urutan tetap, tanpa stempel waktu) agar ETag stabil.
 */

const IN_CHUNK = 500;
/** Item yang instruksinya dibangun serentak (tiap item beberapa kueri kecil; batas melindungi pool koneksi). */
const VIEW_CONCURRENCY = 6;

interface ItemRow {
  id: string;
  brand: string;
  model: string;
  aliases: string;
}

interface StickerRow {
  id: string;
  type_id: string;
  name: string;
  alias: string;
  file_id: string;
  status: string;
}

interface TypeRow {
  id: string;
  name: string;
  rule: string;
  system_kind: string;
}

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

const toStatus = (value: string): StickerStatus => {
  const trimmed = value.trim();
  return trimmed === 'active' || trimmed === 'deprecated' ? trimmed : 'inactive';
};

const toRule = (value: string): StickerRule => {
  const trimmed = value.trim();
  return trimmed === 'none' || trimmed === 'group' ? trimmed : 'bu';
};

async function filesOf(db: Db, ids: readonly string[]): Promise<CatalogFileDto[]> {
  const result: CatalogFileDto[] = [];
  const unique = [...new Set(ids)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT id, mime, size FROM files WHERE id IN (${placeholders(chunk.length)}) AND status = 'active' AND drive_id <> ''`,
      )
      .bind(...chunk)
      .all<{ id: string; mime: string; size: number | string }>();
    for (const row of rows.results) {
      result.push({ id: row.id.trim(), mime: row.mime.trim(), size: Number(row.size) || 0 });
    }
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function buildDesktopCatalog(env: Env): Promise<DesktopCatalogDto> {
  const db = env.DB;
  const itemRows = (
    await db
      .prepare(
        "SELECT i.id, b.name AS brand, i.model, i.aliases FROM items i JOIN brands b ON b.id = i.brand_id WHERE i.is_country_lock = 'true' AND i.status = 'active' AND EXISTS (SELECT 1 FROM item_business_units ibu WHERE ibu.item_id = i.id) ORDER BY b.name, i.model, i.id",
      )
      .all<ItemRow>()
  ).results;
  const itemIds = itemRows.map((row) => row.id.trim());

  const [typeRows, stickerRows, stickerBuRows, itemBus, instructions, designIds, postelStickers] =
    await Promise.all([
      db
        .prepare('SELECT id, name, rule, system_kind FROM sticker_types ORDER BY name, id')
        .all<TypeRow>(),
      db
        .prepare('SELECT id, type_id, name, alias, file_id, status FROM stickers ORDER BY name, id')
        .all<StickerRow>(),
      db
        .prepare('SELECT sticker_id, bu_id FROM sticker_business_units')
        .all<{ sticker_id: string; bu_id: string }>(),
      itemBusinessUnitsOf(db, itemIds),
      loadItemInstructions(db, itemIds),
      manualBookDesignIdsOf(db, itemIds),
      postelStickerIdsOf(db, itemIds),
    ]);
  const latestManualBook = await latestManualBookStickerIds(db, [...designIds.values()]);

  const buIdsOfSticker = new Map<string, string[]>();
  for (const row of stickerBuRows.results) {
    const list = buIdsOfSticker.get(row.sticker_id.trim()) ?? [];
    list.push(row.bu_id.trim());
    buIdsOfSticker.set(row.sticker_id.trim(), list);
  }
  const matchStickers: MatchSticker[] = stickerRows.results.map((row) => ({
    id: row.id.trim(),
    typeId: row.type_id.trim(),
    status: toStatus(row.status),
    buIds: buIdsOfSticker.get(row.id.trim()) ?? [],
  }));
  const types = typeRows.results.map((row) => ({
    id: row.id.trim(),
    name: row.name,
    rule: toRule(row.rule),
    systemKind: row.system_kind.trim() as StickerSystemKind,
  }));

  /** Stiker yang berlaku bagi item: gabungan `stickersForType` atas semua jenis (aturan `group` menurut jenis sistem). */
  const applicableTo = (itemId: string, buIds: readonly string[]): string[] => {
    const designId = designIds.get(itemId) ?? '';
    const latest = designId === '' ? undefined : latestManualBook.get(designId);
    const postel = postelStickers.get(itemId);
    const found = new Set<string>();
    for (const type of types) {
      const group =
        type.rule !== 'group'
          ? new Set<string>()
          : type.systemKind === 'manual_book'
            ? new Set(latest === undefined ? [] : [latest])
            : type.systemKind === 'postel'
              ? new Set(postel === undefined ? [] : [postel])
              : new Set<string>();
      for (const sticker of stickersForType(type, matchStickers, buIds, group)) {
        found.add(sticker.id);
      }
    }
    // Urutan = urutan nama stiker (daftar `stickerRows` sudah terurut).
    return matchStickers.filter((sticker) => found.has(sticker.id)).map((sticker) => sticker.id);
  };

  const items: CatalogItemDto[] = [];
  for (let from = 0; from < itemRows.length; from += VIEW_CONCURRENCY) {
    const slice = itemRows.slice(from, from + VIEW_CONCURRENCY);
    const built = await Promise.all(
      slice.map(async (row): Promise<CatalogItemDto> => {
        const id = row.id.trim();
        const businessUnits = itemBus.get(id) ?? [];
        const buIds = businessUnits.map((unit) => unit.id);
        return {
          id,
          brand: row.brand,
          model: row.model.trim(),
          aliases: parseStrings(row.aliases),
          businessUnits,
          stickerIds: applicableTo(id, buIds),
          stickerPhotos: await buildInstructionViews(env, id, buIds, instructions.get(id) ?? []),
        };
      }),
    );
    items.push(...built);
  }

  // Stiker yang dirujuk: berlaku bagi minimal satu item atau terselesaikan pada sebuah penanda.
  const referenced = new Set<string>();
  for (const item of items) {
    for (const id of item.stickerIds) referenced.add(id);
    for (const photo of item.stickerPhotos) {
      for (const mark of photo.marks) {
        for (const sticker of mark.resolved) referenced.add(sticker.id);
      }
    }
  }
  const fileIdWanted = new Set<string>();
  for (const item of items) for (const photo of item.stickerPhotos) fileIdWanted.add(photo.guideId);
  for (const row of stickerRows.results) {
    if (referenced.has(row.id.trim()) && row.file_id.trim() !== '') {
      fileIdWanted.add(row.file_id.trim());
    }
  }
  const files = await filesOf(db, [...fileIdWanted]);
  const present = new Set(files.map((file) => file.id));

  const stickers: CatalogStickerDto[] = stickerRows.results
    .filter((row) => referenced.has(row.id.trim()))
    .map((row) => ({
      id: row.id.trim(),
      typeId: row.type_id.trim(),
      name: row.name,
      alias: row.alias,
      fileId: present.has(row.file_id.trim()) ? row.file_id.trim() : null,
      status: toStatus(row.status),
    }));
  const typeIds = new Set(stickers.map((sticker) => sticker.typeId));
  const stickerTypes: CatalogStickerTypeDto[] = types
    .filter((type) => typeIds.has(type.id))
    .map((type) => ({
      id: type.id,
      name: type.name,
      rule: type.rule,
      systemKind: type.systemKind,
    }));

  return { version: DESKTOP_CATALOG_VERSION, items, stickerTypes, stickers, files };
}

export interface ServedCatalog {
  json: string;
  etag: string;
  /** Id berkas yang boleh diunduh lewat rute berkas (yang dirujuk katalog DAN ada di `files`). */
  fileIds: ReadonlySet<string>;
}

/** Katalog yang sama dipakai ulang sebentar: satu desktop mengunduh banyak berkas berturut-turut. */
export const CATALOG_TTL_MS = 30_000;

let cache = new WeakMap<Db, { at: number; pending: Promise<ServedCatalog> }>();

/** Hanya tes: koneksi DB tes dipakai bersama banyak tes (dan jam terkendali selalu mulai dari waktu yang sama). */
export function resetDesktopCatalogCache(): void {
  cache = new WeakMap();
}

/**
 * Katalog siap saji, di-memo per koneksi DB selama `CATALOG_TTL_MS` (permintaan serentak berbagi satu pembangunan;
 * galat tidak di-memo). ETag = sha256 isi JSON.
 */
export function getServedCatalog(env: Env): Promise<ServedCatalog> {
  const now = nowOf(env);
  const known = cache.get(env.DB);
  if (known && now - known.at < CATALOG_TTL_MS && now >= known.at) return known.pending;
  const pending = buildDesktopCatalog(env).then((catalog): ServedCatalog => {
    const json = JSON.stringify(catalog);
    const present = new Set(catalog.files.map((file) => file.id));
    return {
      json,
      etag: createHash('sha256').update(json).digest('hex'),
      fileIds: new Set([...catalogFileIds(catalog)].filter((id) => present.has(id))),
    };
  });
  const entry = { at: now, pending };
  cache.set(env.DB, entry);
  pending.catch(() => {
    if (cache.get(env.DB) === entry) cache.delete(env.DB);
  });
  return pending;
}
