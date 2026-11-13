import type { ActorRef } from '@server/core/context';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { insertStickerTypeStmt, listStickerTypeRecords, type StickerTypeRecord } from './repo';

/**
 * Jenis sistem "Postel" (tahap 4b). Jenis `postel` (aturan `group`) dibuat otomatis saat catatan Postel pertama disimpan;
 * stikernya lahir SATU PER CATATAN (`postels.sticker_id`, keputusan pemilik 2026-11-12; `postel/stickers.ts`) dan
 * berlaku bagi item yang tertaut ke catatan itu, bukan menurut BU.
 */

export const POSTEL_TYPE_NAME = 'Postel';

const RENAME_FIRST_MESSAGE =
  "Jenis stiker bernama 'Postel' sudah berisi stiker biasa; ganti namanya lebih dulu agar jenis sistem Postel dapat dibuat";

/**
 * Jenis sistem Postel. Bila belum ada: pakai jenis bernama "Postel" yang belum punya stiker (diubah menjadi jenis sistem
 * beraturan `group` dan selalu aktif, seperti semua jenis sistem, juga bila sebelumnya nonaktif); bila namanya ada
 * tetapi sudah berstiker, ditolak agar namanya diganti; selain itu jenis baru dibuat. Aman dipanggil serentak (indeks
 * unik `kind_key` dan nama): pemenang dipakai semua pemanggil.
 */
export async function ensurePostelType(env: Env, actor: ActorRef): Promise<StickerTypeRecord> {
  const types = await listStickerTypeRecords(env.DB);
  const existing = types.find((type) => type.systemKind === 'postel');
  if (existing) return existing;
  const find = async (): Promise<StickerTypeRecord | undefined> =>
    (await listStickerTypeRecords(env.DB)).find((type) => type.systemKind === 'postel');
  const now = nowIso(env);
  const sameName = types.find(
    (type) => type.systemKind === '' && type.name.toLowerCase() === POSTEL_TYPE_NAME.toLowerCase(),
  );
  try {
    if (sameName) {
      if (sameName.stickerCount > 0) {
        // Pemanggil serentak lain mungkin sudah membuat jenis sistem: pakai pemenangnya, bukan galat palsu.
        const winner = await find();
        if (winner) return winner;
        throw appError('VALIDATION', RENAME_FIRST_MESSAGE);
      }
      await env.DB.prepare(
        "UPDATE sticker_types SET rule = 'group', system_kind = 'postel', status = 'active', updated_at = ?, updated_by = ? WHERE id = ? AND system_kind = '' AND (SELECT COUNT(*) FROM stickers WHERE type_id = ?) = 0",
      )
        .bind(now, actor.email, sameName.id, sameName.id)
        .run();
    } else {
      await env.DB.batch([
        insertStickerTypeStmt(env.DB, {
          id: crypto.randomUUID(),
          name: POSTEL_TYPE_NAME,
          rule: 'group',
          status: 'active',
          systemKind: 'postel',
          defaultMinQty: 0,
          stickerCount: 0,
          createdAt: now,
          updatedAt: now,
          updatedBy: actor.email,
        }),
      ]);
    }
  } catch (error) {
    // Pemanggil serentak lain yang menang membuat jenis itu lebih dulu: pakai miliknya.
    if (!(error instanceof DbError && error.kind === 'duplicate')) throw error;
  }
  const created = await find();
  if (!created) throw appError('VALIDATION', RENAME_FIRST_MESSAGE);
  return created;
}
