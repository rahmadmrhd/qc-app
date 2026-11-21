import type { DbStatement, Preparer } from '@server/core/db';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { deletedWhere, liveWhere } from '@server/core/soft-delete';
import { ensurePostelType } from '@server/modules/sticker/postel';
import {
  insertStickerStmt,
  listStickerTypeRecords,
  type StickerRecord,
  type StickerTypeRecord,
} from '@server/modules/sticker/repo';
import { postelName } from '@shared/postel';
import { postelStickerName } from '@shared/stickers';
import { listItemsOfPostels, type PostelItem } from './items';
import { linkPostelStickerStmt, listPostelNumbers, listPostelRecords } from './repo';

/**
 * Stiker katalog per catatan Postel (keputusan pemilik 2026-11-12; spek 4b §7): tiap catatan punya satu stiker jenis
 * sistem `postel` (`postels.sticker_id`) bernama `Postel - <nama Postel turunan>`. Stiker lahir bersama catatan (satu
 * `batch()`), namanya mengikuti nama turunan saat catatan disimpan (penambahan/pengurangan item), dan menjadi nonaktif
 * atau usang saat catatannya dihapus (stiker tidak pernah dihapus).
 */

/** Nama turunan catatan dari model SEMUA itemnya (yang tak terlihat pun, seperti `name` pada DTO). */
export function postelStickerBase(items: readonly PostelItem[]): string {
  return postelName(items.map((item) => item.model));
}

const DELETED_HOLDER_RESTORABLE =
  'Nama stiker Postel ini masih dipegang Postel yang dihapus; pulihkan Postel itu dari daftar Terhapus, atau ubah pilihan item';
const DELETED_HOLDER_GENERIC = 'Nama stiker Postel bentrok dengan catatan lain';

/** Perlakuan nama yang dipegang stiker milik Postel TERHAPUS saat memilih nama (keputusan pemilik soft delete 13). */
export interface DeletedHolderPolicy {
  /** Penyimpan berhak memulihkan: pesan menyarankan memulihkan Postel lama; selain itu pesan generik. */
  canRestore: boolean;
}

/**
 * Nama stiker yang belum dipakai stiker Postel lain (tanpa beda huruf besar, setara `name_key`). Bentrok (mis. model
 * yang sama pada merk berbeda) dibedakan dengan nomor sertifikat Aktif, lalu dengan angka urut bila masih bentrok.
 * `exceptStickerId` = stiker catatan ini sendiri (tak dihitung sebagai pemakai). Dengan `onDeletedHolder`, nama yang
 * dipegang stiker Postel TERHAPUS tidak dibedakan melainkan ditolak (`CONFLICT` pada `itemIds`: Postel baru bernama
 * sama tak boleh lahir selama yang lama masih di Terhapus); tanpa itu (pengisi saat start) nama itu dilewati.
 */
export async function pickPostelStickerName(
  db: Preparer,
  typeId: string,
  base: string,
  activeNumber: string,
  exceptStickerId: string,
  onDeletedHolder?: DeletedHolderPolicy,
): Promise<string> {
  const rows = await db
    .prepare(
      `SELECT LOWER(name) AS name_key, EXISTS (SELECT 1 FROM postels p WHERE p.sticker_id = stickers.id AND ${deletedWhere('p')}) AS of_deleted FROM stickers WHERE type_id = ? AND id <> ?`,
    )
    .bind(typeId, exceptStickerId)
    .all<{ name_key: string; of_deleted: number | string }>();
  const taken = new Map(rows.results.map((row) => [row.name_key, Number(row.of_deleted) === 1]));
  const free = (name: string): boolean => {
    const heldByDeleted = taken.get(name.toLowerCase());
    if (heldByDeleted === undefined) return true;
    if (heldByDeleted && onDeletedHolder) {
      const message = onDeletedHolder.canRestore
        ? DELETED_HOLDER_RESTORABLE
        : DELETED_HOLDER_GENERIC;
      throw appError('CONFLICT', message, { itemIds: message });
    }
    return false;
  };
  const plain = postelStickerName(base);
  if (free(plain)) return plain;
  const numbered = activeNumber === '' ? plain : postelStickerName(base, ` (${activeNumber})`);
  if (free(numbered)) return numbered;
  for (let n = 2; ; n += 1) {
    const candidate = postelStickerName(
      base,
      ` (${activeNumber === '' ? '' : `${activeNumber} `}${n})`,
    );
    if (free(candidate)) return candidate;
  }
}

/** Stiker baru bagi sebuah catatan: aktif, minimum awal = minimum bawaan jenis, tanpa gambar. */
export function newPostelStickerStmt(
  db: Preparer,
  type: StickerTypeRecord,
  name: string,
  actor: string,
  now: string,
): { stickerId: string; statement: DbStatement } {
  const sticker: StickerRecord = {
    id: crypto.randomUUID(),
    typeId: type.id,
    name,
    alias: '',
    fileId: '',
    minQty: type.defaultMinQty,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
    deletedAt: '',
    deletedBy: '',
  };
  return { stickerId: sticker.id, statement: insertStickerStmt(db, sticker) };
}

/** Mengganti nama stiker bila berbeda (tidak menyentuh `updated_at` bila sudah sama). */
export function renameStickerStmt(
  db: Preparer,
  stickerId: string,
  name: string,
  actor: string,
  now: string,
): DbStatement {
  return db
    .prepare(
      'UPDATE stickers SET name = ?, updated_at = ?, updated_by = ? WHERE id = ? AND name <> ?',
    )
    .bind(name, now, actor, stickerId, name);
}

/**
 * Stiker catatan yang dihapus lunak: `inactive` bila total stok semua lokasinya <= 0 (stok dapat negatif akibat serial),
 * selain itu `deprecated` (tak menerima stok masuk, tak dihitung menipis, hanya dapat menjadi `inactive`; pola Manual
 * Book versi lama). Pernyataan untuk `batch()` hapus, dengan urutan kunci sama seperti penulis stok: baris catatan
 * (dikunci pernyataan sebelumnya), baris stiker, lalu baris stok (kunci bersama); jumlah dihitung SQL sesudah kunci.
 */
export function retirePostelStickerStmts(
  db: Preparer,
  stickerId: string,
  now: string,
  actor: string,
): DbStatement[] {
  if (stickerId === '') return [];
  return [
    db
      .prepare(`SELECT s.id FROM stickers s WHERE ${liveWhere('s')} AND s.id = ? FOR UPDATE`)
      .bind(stickerId),
    db
      .prepare('SELECT 1 AS locked FROM sticker_stock WHERE sticker_id = ? LOCK IN SHARE MODE')
      .bind(stickerId),
    db
      .prepare(
        "UPDATE stickers SET status = CASE WHEN (SELECT COALESCE(SUM(qty), 0) FROM sticker_stock WHERE sticker_id = stickers.id) <= 0 THEN 'inactive' ELSE 'deprecated' END, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'active'",
      )
      .bind(now, actor, stickerId),
  ];
}

/**
 * Pulihkan catatan: stikernya yang `deprecated` karena penghapusan kembali `inactive` (dapat diaktifkan lagi lewat
 * katalog; Pulihkan sendiri tidak mengaktifkan apa pun; keputusan pemilik soft delete 13).
 */
export function restorePostelStickerStmts(
  db: Preparer,
  stickerId: string,
  now: string,
  actor: string,
): DbStatement[] {
  if (stickerId === '') return [];
  return [
    db
      .prepare(
        "UPDATE stickers SET status = 'inactive', updated_at = ?, updated_by = ? WHERE id = ? AND status = 'deprecated'",
      )
      .bind(now, actor, stickerId),
  ];
}

/**
 * Pengisi saat start (idempoten; catatan Postel yang lahir sebelum rilis ini belum bersiker, dan stiker "Postel" bersama
 * yang lama harus diselamatkan bersama stoknya):
 *  1. catatan tanpa stiker, dari yang tertua: yang PERTAMA mengadopsi stiker jenis Postel yang belum dimiliki catatan mana
 *     pun (stiker bersama lama, stok dan riwayatnya ikut; keputusan pemilik 2026-11-12), yang lain mendapat stiker baru
 *     berstok 0;
 *  2. semua stiker Postel disamakan namanya dengan nama turunan catatannya (nama berubah karena item diganti model di luar
 *     modul Postel, atau awalan baru).
 * Berhenti pada galat tak terduga dengan melemparkannya; pemanggil mencatatnya tanpa menggagalkan start.
 */
export async function backfillPostelStickers(env: Env, actor = 'system'): Promise<void> {
  const records = await listPostelRecords(env.DB);
  if (records.length === 0) return;
  const itemsOf = await listItemsOfPostels(env.DB);
  const numbers = await listPostelNumbers(env.DB);
  const activeNumberOf = new Map<string, string>();
  for (const entry of numbers) activeNumberOf.set(entry.postelId, entry.number); // terurut seq: terakhir = Aktif

  const needsSticker = records.filter((record) => record.stickerId === '');
  let type: StickerTypeRecord | undefined = (await listStickerTypeRecords(env.DB)).find(
    (row) => row.systemKind === 'postel',
  );
  if (needsSticker.length > 0) type = await ensurePostelType(env, { email: actor });
  if (!type) return;
  const typeId = type.id;
  const now = nowIso(env);

  needsSticker.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const legacy = await env.DB.prepare(
    'SELECT id FROM stickers WHERE type_id = ? AND id NOT IN (SELECT sticker_id FROM postels WHERE sticker_id IS NOT NULL) ORDER BY created_at, id LIMIT 1',
  )
    .bind(typeId)
    .first<{ id: string }>();
  let legacyId = legacy?.id.trim() ?? '';

  for (const record of needsSticker) {
    const base = postelStickerBase(itemsOf.get(record.id) ?? []);
    const active = activeNumberOf.get(record.id) ?? '';
    try {
      if (legacyId !== '') {
        const name = await pickPostelStickerName(env.DB, typeId, base, active, legacyId);
        await env.DB.batch([
          renameStickerStmt(env.DB, legacyId, name, actor, now),
          linkPostelStickerStmt(env.DB, record.id, legacyId),
        ]);
        legacyId = '';
      } else {
        const name = await pickPostelStickerName(env.DB, typeId, base, active, '');
        const created = newPostelStickerStmt(env.DB, type, name, actor, now);
        await env.DB.batch([
          created.statement,
          linkPostelStickerStmt(env.DB, record.id, created.stickerId),
        ]);
      }
    } catch (error) {
      if (!(error instanceof DbError && error.kind === 'duplicate')) throw error;
    }
  }

  // Penyelarasan nama: stiker tiap catatan = `Postel - <nama turunan>` (dengan pembeda bila bentrok).
  for (const record of await listPostelRecords(env.DB)) {
    if (record.stickerId === '') continue;
    const base = postelStickerBase(itemsOf.get(record.id) ?? []);
    const name = await pickPostelStickerName(
      env.DB,
      typeId,
      base,
      activeNumberOf.get(record.id) ?? '',
      record.stickerId,
    );
    try {
      await renameStickerStmt(env.DB, record.stickerId, name, actor, now).run();
    } catch (error) {
      if (!(error instanceof DbError && error.kind === 'duplicate')) throw error;
    }
  }
}
