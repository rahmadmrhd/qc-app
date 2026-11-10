import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import type {
  ItemStickerMarkView,
  ItemStickerPhotoDto,
  ResolvedStickerDto,
} from '@shared/contract';
import { type MatchSticker, stickersForType } from '@shared/stickers';
import type { StoredPhoto } from './instruction-repo';

interface GuideRow {
  id: string;
  name: string;
  width: number | string | null;
  height: number | string | null;
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
}

interface StickerBuRow {
  sticker_id: string;
  bu_id: string;
}

interface BuRow {
  id: string;
  code: string;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * Membangun tampilan instruksi item (tahap 3b-2) dari foto tersimpan: nama dan dimensi gambar pustaka, nama sasaran
 * penanda, dan stiker hasil penerjemahan (`resolved`). Satu pembacaan `batch()` untuk gambar, stiker, jenis, tautan BU
 * stiker, dan kode BU; tanpa foto tidak ada kueri.
 *
 * - Penanda ke stiker tertentu: `resolved` = stiker itu sendiri (tidak disaring BU, tetap tampil walau nonaktif dengan
 *   `inactive: true`); `targetName` = alias bila ada, selain itu nama stiker.
 * - Penanda jenis: `resolved` = `stickersForType` (stiker aktif jenis itu menurut aturan jenis dan BU item;
 *   status jenis tidak berpengaruh); `targetName` = nama jenis; tanpa kecocokan = `unresolved: true`.
 * - `buCodes` = kode BU irisan BU stiker dan BU item (terurut kode); kosong bila tak beririsan.
 * Dihitung ulang tiap dibaca, jadi perubahan BU item atau katalog sesudah simpan langsung tercermin.
 */
export async function buildInstructionViews(
  env: Env,
  _itemId: string,
  itemBuIds: readonly string[],
  photos: readonly StoredPhoto[],
): Promise<ItemStickerPhotoDto[]> {
  if (photos.length === 0) return [];
  const stickerIds = new Set<string>();
  const typeIds = new Set<string>();
  for (const photo of photos) {
    for (const mark of photo.marks) {
      if (mark.target.kind === 'sticker') stickerIds.add(mark.target.stickerId);
      else typeIds.add(mark.target.typeId);
    }
  }
  const guideIds = photos.map((photo) => photo.guideId);
  const reads: DbStatement[] = [
    env.DB.prepare(
      `SELECT g.id, g.name, f.width, f.height FROM sticker_guide_images g LEFT JOIN files f ON f.id = g.id WHERE g.id IN (${placeholders(guideIds.length)})`,
    ).bind(...guideIds),
  ];
  const slots = { stickers: -1, types: -1, stickerBus: -1, bus: -1 };
  if (stickerIds.size > 0 || typeIds.size > 0) {
    const conditions: string[] = [];
    const binds: string[] = [];
    if (stickerIds.size > 0) {
      conditions.push(`s.id IN (${placeholders(stickerIds.size)})`);
      binds.push(...stickerIds);
    }
    if (typeIds.size > 0) {
      conditions.push(`s.type_id IN (${placeholders(typeIds.size)})`);
      binds.push(...typeIds);
    }
    const where = conditions.join(' OR ');
    slots.stickers = reads.length;
    reads.push(
      env.DB.prepare(
        `SELECT s.id, s.type_id, s.name, s.alias, s.file_id, s.status FROM stickers s WHERE ${where} ORDER BY s.name_key, s.id`,
      ).bind(...binds),
    );
    slots.stickerBus = reads.length;
    reads.push(
      env.DB.prepare(
        `SELECT sb.sticker_id, sb.bu_id FROM sticker_business_units sb JOIN stickers s ON s.id = sb.sticker_id WHERE ${where}`,
      ).bind(...binds),
    );
    slots.bus = reads.length;
    reads.push(env.DB.prepare('SELECT id, code FROM business_units'));
  }
  if (typeIds.size > 0) {
    slots.types = reads.length;
    reads.push(
      env.DB.prepare(
        `SELECT id, name, rule FROM sticker_types WHERE id IN (${placeholders(typeIds.size)})`,
      ).bind(...typeIds),
    );
  }
  const results = await env.DB.batch(reads);
  const rowsOf = <T>(slot: number): T[] =>
    slot < 0 ? [] : ((results[slot]?.results ?? []) as T[]);

  const guides = new Map(rowsOf<GuideRow>(0).map((row) => [row.id, row]));
  const stickers = new Map(rowsOf<StickerRow>(slots.stickers).map((row) => [row.id, row]));
  const stickersByType = new Map<string, StickerRow[]>();
  for (const row of stickers.values()) {
    const list = stickersByType.get(row.type_id) ?? [];
    list.push(row);
    stickersByType.set(row.type_id, list);
  }
  const types = new Map(rowsOf<TypeRow>(slots.types).map((row) => [row.id, row]));
  const buIdsOfSticker = new Map<string, string[]>();
  for (const row of rowsOf<StickerBuRow>(slots.stickerBus)) {
    const list = buIdsOfSticker.get(row.sticker_id) ?? [];
    list.push(row.bu_id);
    buIdsOfSticker.set(row.sticker_id, list);
  }
  const buCode = new Map(rowsOf<BuRow>(slots.bus).map((row) => [row.id, row.code]));
  const itemBus = new Set(itemBuIds);

  const resolve = (row: StickerRow): ResolvedStickerDto => ({
    id: row.id,
    name: row.name,
    alias: row.alias,
    fileId: row.file_id === '' ? null : row.file_id,
    buCodes: (buIdsOfSticker.get(row.id) ?? [])
      .filter((buId) => itemBus.has(buId))
      .map((buId) => buCode.get(buId) ?? '')
      .filter((code) => code !== '')
      .sort(),
    inactive: row.status !== 'active',
  });

  return photos.map((photo): ItemStickerPhotoDto => {
    const guide = guides.get(photo.guideId);
    const marks = photo.marks.map((mark): ItemStickerMarkView => {
      if (mark.target.kind === 'sticker') {
        const row = stickers.get(mark.target.stickerId);
        return {
          ...mark,
          targetName: row ? row.alias || row.name : '',
          resolved: row ? [resolve(row)] : [],
          unresolved: row === undefined,
        };
      }
      const type = types.get(mark.target.typeId);
      if (!type) return { ...mark, targetName: '', resolved: [], unresolved: true };
      const candidates: MatchSticker[] = (stickersByType.get(type.id) ?? []).map((row) => ({
        id: row.id,
        typeId: row.type_id,
        status: row.status === 'active' ? 'active' : 'inactive',
        buIds: buIdsOfSticker.get(row.id) ?? [],
      }));
      const matched = stickersForType(
        { id: type.id, rule: type.rule === 'none' ? 'none' : 'bu' },
        candidates,
        itemBuIds,
        // Sementara (Task 4 mengisinya dari `items.manual_book_design_id`): aturan `group` belum dipakai.
        new Set<string>(),
      );
      const resolved = matched.flatMap((match) => {
        const row = stickers.get(match.id);
        return row ? [resolve(row)] : [];
      });
      return { ...mark, targetName: type.name, resolved, unresolved: resolved.length === 0 };
    });
    return {
      guideId: photo.guideId,
      guideName: guide?.name ?? '',
      width: Number(guide?.width ?? 0),
      height: Number(guide?.height ?? 0),
      caption: photo.caption,
      buId: photo.buId,
      marks,
    };
  });
}
