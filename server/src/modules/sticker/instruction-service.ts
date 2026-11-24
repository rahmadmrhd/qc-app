import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { manualBookDesignIdsOf, postelStickerIdsOf } from '@server/modules/item/repo';
import type {
  ItemStickerMarkView,
  ItemStickerPhotoDto,
  ResolvedStickerDto,
} from '@shared/contract';
import {
  type MatchSticker,
  type StickerRule,
  type StickerStatus,
  stickersForType,
} from '@shared/stickers';
import type { StoredPhoto } from './instruction-repo';
import { latestManualBookStickerIds } from './repo';

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
  deleted_at: string;
}

interface TypeRow {
  id: string;
  name: string;
  rule: string;
  system_kind: string;
  deleted_at: string;
}

interface StickerBuRow {
  sticker_id: string;
  bu_id: string;
}

interface BuRow {
  id: string;
  code: string;
}

function toMatchStatus(status: string): StickerStatus {
  return status === 'active' || status === 'deprecated' ? status : 'inactive';
}

function toMatchRule(rule: string): StickerRule {
  const trimmed = rule.trim();
  return trimmed === 'none' || trimmed === 'group' ? trimmed : 'bu';
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
 *   status jenis tidak berpengaruh); `targetName` = nama jenis; tanpa kecocokan = `unresolved: true`. Aturan `group`
 *   menurut jenis sistemnya. Manual Book (tahap 4a): stiker versi TERBARU konfigurasi QR yang ditunjuk
 *   `items.manual_book_design_id` item ini, bila aktif; item tanpa konfigurasi, atau versi terbaru yang nonaktif,
 *   = `unresolved` (tidak jatuh ke versi `deprecated`). Postel (tahap 4b): stiker MILIK catatan Postel item ini (satu per
 *   catatan, `postels.sticker_id`), bila aktif; item tanpa Postel = `unresolved`. Jenis `group` tanpa jenis sistem tak pernah cocok.
 * - `buCodes` = kode BU irisan BU stiker dan BU item (terurut kode); kosong bila tak beririsan.
 * Dihitung ulang tiap dibaca, jadi perubahan BU item atau katalog sesudah simpan langsung tercermin.
 */
export async function buildInstructionViews(
  env: Env,
  itemId: string,
  itemBuIds: readonly string[],
  photos: readonly StoredPhoto[],
): Promise<ItemStickerPhotoDto[]> {
  if (photos.length === 0) return [];
  const context = await loadInstructionContext(env, [{ itemId, photos }]);
  return resolveInstructionViews(context, itemId, itemBuIds, photos);
}

/**
 * Data bersama untuk menerjemahkan instruksi SEKUMPULAN item sekaligus (katalog desktop memuat ratusan item: satu
 * pemuatan untuk semuanya, bukan satu transaksi per item). Hanya dibaca; `resolveInstructionViews` murni di atasnya.
 */
export interface InstructionContext {
  guides: ReadonlyMap<string, GuideRow>;
  stickers: ReadonlyMap<string, StickerRow>;
  stickersByType: ReadonlyMap<string, readonly StickerRow[]>;
  types: ReadonlyMap<string, TypeRow>;
  buIdsOfSticker: ReadonlyMap<string, readonly string[]>;
  buCode: ReadonlyMap<string, string>;
  /** Id konfigurasi QR (Manual Book) tiap item, hanya bila ada penanda ke jenis group Manual Book. */
  designOf: ReadonlyMap<string, string>;
  /** Stiker versi terbaru tiap konfigurasi QR (`latestManualBookStickerIds`). */
  latestByDesign: ReadonlyMap<string, string>;
  /** Stiker milik catatan Postel tiap item, hanya bila ada penanda ke jenis group Postel. */
  postelOf: ReadonlyMap<string, string>;
}

export async function loadInstructionContext(
  env: Env,
  inputs: readonly { itemId: string; photos: readonly StoredPhoto[] }[],
): Promise<InstructionContext> {
  const stickerIds = new Set<string>();
  const typeIds = new Set<string>();
  const guideIds = new Set<string>();
  for (const input of inputs) {
    for (const photo of input.photos) {
      guideIds.add(photo.guideId);
      for (const mark of photo.marks) {
        if (mark.target.kind === 'sticker') stickerIds.add(mark.target.stickerId);
        else typeIds.add(mark.target.typeId);
      }
    }
  }
  const reads: DbStatement[] = [];
  const slots = { guides: -1, stickers: -1, types: -1, stickerBus: -1, bus: -1 };
  if (guideIds.size > 0) {
    slots.guides = reads.length;
    reads.push(
      env.DB.prepare(
        `SELECT g.id, g.name, f.width, f.height FROM sticker_guide_images g LEFT JOIN files f ON f.id = g.id WHERE g.id IN (${placeholders(guideIds.size)})`,
      ).bind(...guideIds),
    );
  }
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
        `SELECT s.id, s.type_id, s.name, s.alias, s.file_id, s.status, s.deleted_at FROM stickers s WHERE ${where} ORDER BY s.name_key, s.id`,
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
        `SELECT id, name, rule, system_kind, deleted_at FROM sticker_types WHERE id IN (${placeholders(typeIds.size)})`,
      ).bind(...typeIds),
    );
  }
  const results = reads.length === 0 ? [] : await env.DB.batch(reads);
  const rowsOf = <T>(slot: number): T[] =>
    slot < 0 ? [] : ((results[slot]?.results ?? []) as T[]);

  const stickers = new Map(rowsOf<StickerRow>(slots.stickers).map((row) => [row.id, row]));
  const stickersByType = new Map<string, StickerRow[]>();
  for (const row of stickers.values()) {
    // Stiker terhapus bukan kandidat penerjemahan jenis; ia hanya tampil sebagai sasaran langsung (rujukan tersimpan).
    if (row.deleted_at !== '') continue;
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

  // Aturan `group` per jenis sistem (kueri kecil, hanya bila ada penanda jenis group yang bersangkutan, satu kali untuk
  // semua item): Manual Book = stiker versi terbaru konfigurasi item; Postel = stiker milik catatan Postel item.
  const groupTypes = [...types.values()].filter((type) => type.rule.trim() === 'group');
  const itemIds = inputs.map((input) => input.itemId);
  let designOf: Map<string, string> = new Map();
  let latestByDesign: Map<string, string> = new Map();
  if (groupTypes.some((type) => type.system_kind.trim() === 'manual_book')) {
    designOf = await manualBookDesignIdsOf(env.DB, itemIds);
    latestByDesign = await latestManualBookStickerIds(env.DB, [...new Set(designOf.values())]);
  }
  let postelOf: Map<string, string> = new Map();
  if (groupTypes.some((type) => type.system_kind.trim() === 'postel')) {
    postelOf = await postelStickerIdsOf(env.DB, itemIds);
  }

  return {
    guides: new Map(rowsOf<GuideRow>(slots.guides).map((row) => [row.id, row])),
    stickers,
    stickersByType,
    types,
    buIdsOfSticker,
    buCode: new Map(rowsOf<BuRow>(slots.bus).map((row) => [row.id, row.code])),
    designOf,
    latestByDesign,
    postelOf,
  };
}

/** Murni: menerjemahkan foto tersimpan satu item dari data bersama `loadInstructionContext`. */
export function resolveInstructionViews(
  context: InstructionContext,
  itemId: string,
  itemBuIds: readonly string[],
  photos: readonly StoredPhoto[],
): ItemStickerPhotoDto[] {
  if (photos.length === 0) return [];
  const { guides, stickers, stickersByType, types, buIdsOfSticker, buCode } = context;
  const itemBus = new Set(itemBuIds);
  const designId = context.designOf.get(itemId) ?? '';
  const latestSticker = designId === '' ? undefined : context.latestByDesign.get(designId);
  const ownPostel = context.postelOf.get(itemId);
  const groupStickerIdsOf = (type: TypeRow): ReadonlySet<string> => {
    const kind = type.system_kind.trim();
    if (type.rule.trim() !== 'group') return new Set();
    if (kind === 'manual_book') return new Set(latestSticker === undefined ? [] : [latestSticker]);
    if (kind === 'postel') return new Set(ownPostel === undefined ? [] : [ownPostel]);
    return new Set();
  };

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
    inactive: row.status !== 'active' || row.deleted_at !== '',
    ...(row.deleted_at === '' ? {} : { deleted: true as const }),
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
          ...(row !== undefined && row.deleted_at !== '' ? { targetDeleted: true as const } : {}),
        };
      }
      const type = types.get(mark.target.typeId);
      if (!type) return { ...mark, targetName: '', resolved: [], unresolved: true };
      // Jenis terhapus: namanya tetap tampil sebagai rujukan, tetapi tak menghasilkan stiker apa pun.
      if (type.deleted_at !== '') {
        return {
          ...mark,
          targetName: type.name,
          resolved: [],
          unresolved: true,
          targetDeleted: true as const,
        };
      }
      const candidates: MatchSticker[] = (stickersByType.get(type.id) ?? []).map((row) => ({
        id: row.id,
        typeId: row.type_id,
        status: toMatchStatus(row.status.trim()),
        buIds: [...(buIdsOfSticker.get(row.id) ?? [])],
      }));
      const matched = stickersForType(
        { id: type.id, rule: toMatchRule(type.rule) },
        candidates,
        itemBuIds,
        groupStickerIdsOf(type),
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
