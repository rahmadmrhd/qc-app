import type { DbStatement } from '@server/core/db';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { insertFileStmt } from '@server/modules/files/repo';
import type { QrDesignRecord } from '@server/modules/qrcode/repo';
import type { QrVersionDto } from '@shared/contract';
import type { QrContent } from '@shared/qrcode';
import { manualBookStickerName } from '@shared/stickers';
import {
  insertManualBookVersionStmt,
  insertStickerStmt,
  insertStickerTypeStmt,
  listManualBookVersions,
  listStickerTypeRecords,
  type StickerRecord,
  type StickerTypeRecord,
  toStickerStatus,
} from './repo';
import { lockStickerRowStmt } from './stock-repo';

/**
 * Stiker Manual Book (tahap 4a): lahir dari ekspor konfigurasi QR dan berversi. Jenis sistem `manual_book` (aturan
 * `group`) dibuat otomatis saat ekspor pertama; stiker baru dibuat, versinya dicatat, dan stiker lama
 * di-`deprecated`-kan (atau langsung `inactive` bila stoknya 0) dalam SATU batch komit ekspor.
 */

export const MANUAL_BOOK_TYPE_NAME = 'Manual Book';

const RENAME_FIRST_MESSAGE =
  "Jenis stiker bernama 'Manual Book' sudah berisi stiker biasa; ganti namanya lebih dulu agar jenis sistem Manual Book dapat dibuat";

/**
 * Jenis sistem Manual Book. Bila belum ada: pakai jenis bernama "Manual Book" yang belum punya stiker (diubah menjadi
 * jenis sistem beraturan `group`); bila namanya ada tetapi sudah berstiker, ekspor ditolak agar namanya diganti;
 * selain itu jenis baru dibuat. Aman dipanggil serentak (indeks unik `kind_key`).
 */
export async function ensureManualBookType(env: Env, actor: string): Promise<StickerTypeRecord> {
  const find = async (): Promise<StickerTypeRecord | undefined> =>
    (await listStickerTypeRecords(env.DB)).find((type) => type.systemKind === 'manual_book');
  const existing = await find();
  if (existing) return existing;
  const now = nowIso(env);
  const types = await listStickerTypeRecords(env.DB);
  const sameName = types.find(
    (type) => type.name.toLowerCase() === MANUAL_BOOK_TYPE_NAME.toLowerCase(),
  );
  try {
    if (sameName) {
      if (sameName.stickerCount > 0) throw appError('VALIDATION', RENAME_FIRST_MESSAGE);
      await env.DB.prepare(
        "UPDATE sticker_types SET rule = 'group', system_kind = 'manual_book', updated_at = ?, updated_by = ? WHERE id = ? AND system_kind = '' AND (SELECT COUNT(*) FROM stickers WHERE type_id = ?) = 0",
      )
        .bind(now, actor, sameName.id, sameName.id)
        .run();
    } else {
      await env.DB.batch([
        insertStickerTypeStmt(env.DB, {
          id: crypto.randomUUID(),
          name: MANUAL_BOOK_TYPE_NAME,
          rule: 'group',
          status: 'active',
          systemKind: 'manual_book',
          defaultMinQty: 0,
          stickerCount: 0,
          createdAt: now,
          updatedAt: now,
          updatedBy: actor,
        }),
      ]);
    }
  } catch (error) {
    // Ekspor serentak lain yang menang membuat jenis itu lebih dulu: pakai miliknya.
    if (!(error instanceof DbError && error.kind === 'duplicate')) throw error;
  }
  const created = await find();
  if (!created) throw appError('VALIDATION', RENAME_FIRST_MESSAGE);
  return created;
}

export interface ManualBookCommitInput {
  design: QrDesignRecord;
  /** `qrContentHash` isi label saat ini. */
  hash: string;
  /** Isi label saat ini (untuk `content_snapshot`). */
  content: QrContent;
  /** Alasan ekspor ulang ('' untuk versi pertama). */
  reason: string;
  actor: string;
  now: string;
  /** Gambar contoh (berkas Drive yang sudah dibuat); wajib bila versi baru lahir. */
  preview: {
    fileId: string;
    driveId: string;
    size: number;
    width: number;
    height: number;
  } | null;
}

/**
 * Pernyataan komit versi Manual Book untuk digabung ke batch komit ekspor. `[]` bila hash sama dengan versi terbaru
 * (ekspor ulang tanpa perubahan label: tanpa stiker atau versi baru). Selain itu: stiker baru `"<nama> v<n>"` aktif
 * (minimum = milik versi sebelumnya, atau default jenis untuk v1), baris versi (`UNIQUE (design_id, version)` menolak
 * dua ekspor serentak yang membuat versi sama), berkas gambar contoh milik stiker itu, dan stiker versi sebelumnya
 * menjadi `deprecated` (atau `inactive` bila total stok semua lokasi 0).
 */
export async function manualBookCommitStatements(
  env: Env,
  input: ManualBookCommitInput,
): Promise<DbStatement[]> {
  const { design } = input;
  const versions = await listManualBookVersions(env, design.id);
  const latest = versions[0];
  if (latest && latest.contentHash === input.hash) return [];
  if (!input.preview) {
    // Job yang diantrekan sebelum rilis ini (tanpa blob gambar contoh) dan belum pernah berversi: komit tanpa versi,
    // bukan galat; konfigurasi menjadi Manual Book pada ekspor ulang berikutnya. Konfigurasi yang sudah berversi
    // tidak pernah sampai ke sini tanpa gambar contoh (rute mewajibkannya), jadi itu galat sungguhan.
    if (!latest) return [];
    throw appError('INTERNAL', 'Gambar contoh ekspor tidak ditemukan; ulangi ekspor dari awal');
  }
  const type = await ensureManualBookType(env, input.actor);
  const version = (latest?.version ?? 0) + 1;
  let minQty = type.defaultMinQty;
  if (latest) {
    const previous = await env.DB.prepare('SELECT min_qty FROM stickers WHERE id = ?')
      .bind(latest.stickerId)
      .first<{ min_qty: number | string }>();
    if (previous) minQty = Number(previous.min_qty) || 0;
  }
  const stickerId = crypto.randomUUID();
  const sticker: StickerRecord = {
    id: stickerId,
    typeId: type.id,
    name: manualBookStickerName(design.name, version),
    alias: '',
    fileId: input.preview.fileId,
    minQty,
    status: 'active',
    createdAt: input.now,
    updatedAt: input.now,
    updatedBy: input.actor,
  };
  const { content } = input;
  const statements: DbStatement[] = [];
  if (latest) {
    // Urutan kunci sama dengan penulis stok (`lockStickerRowStmt`: baris stiker dulu, baru baris stok): tanpa ini
    // kunci bersama di baris stok di bawah dapat berbalik dengan penulis stok dan menjadi deadlock.
    statements.push(lockStickerRowStmt(env.DB, latest.stickerId));
  }
  statements.push(
    // Baris versi PERTAMA: `UNIQUE (design_id, version)` menolak ekspor serentak yang membuat versi sama dengan
    // galat duplikat tepat di sini (dipetakan menjadi basi), sebelum insert stiker menabrak nama unik yang sama.
    insertManualBookVersionStmt(env.DB, {
      stickerId,
      designId: design.id,
      version,
      contentHash: input.hash,
      contentSnapshot: JSON.stringify({
        title: content.title,
        subtitle: content.subtitle,
        footer: content.footer,
        logoFileId: content.logoFileId,
        layout: content.layout,
        style: content.style,
        link: content.link,
      }),
      reason: input.reason,
      createdAt: input.now,
      createdBy: input.actor,
    }),
    insertStickerStmt(env.DB, sticker),
    insertFileStmt(env.DB, {
      id: input.preview.fileId,
      driveId: input.preview.driveId,
      mime: 'image/png',
      size: input.preview.size,
      width: input.preview.width,
      height: input.preview.height,
      ownerType: 'sticker',
      ownerId: stickerId,
      createdAt: input.now,
      createdBy: input.actor,
      status: 'active',
    }),
  );
  if (latest) {
    statements.push(
      // Kunci bersama baris stok agar total dibaca setelah penulis stok serentak komit (keluar/koreksi/opname
      // yang menyentuh 0 memakai pernyataan penonaktifan yang sama pada stiker `deprecated`).
      env.DB.prepare(
        'SELECT 1 AS locked FROM sticker_stock WHERE sticker_id = ? LOCK IN SHARE MODE',
      ).bind(latest.stickerId),
      env.DB.prepare(
        "UPDATE stickers SET status = CASE WHEN (SELECT COALESCE(SUM(qty), 0) FROM sticker_stock WHERE sticker_id = ?) = 0 THEN 'inactive' ELSE 'deprecated' END, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'active'",
      ).bind(latest.stickerId, input.now, input.actor, latest.stickerId),
    );
  }
  return statements;
}

/** Riwayat versi satu konfigurasi QR, terbaru dahulu (nama, status, dan gambar contoh tiap stiker; tanpa stok, keputusan pemilik 2026-11-11). */
export async function listQrVersions(env: Env, designId: string): Promise<QrVersionDto[]> {
  const rows = await env.DB.prepare(
    'SELECT mv.sticker_id, mv.version, mv.reason, mv.created_at, mv.created_by, s.name, s.status, s.file_id FROM manual_book_versions mv JOIN stickers s ON s.id = mv.sticker_id WHERE mv.design_id = ? ORDER BY mv.version DESC',
  )
    .bind(designId)
    .all<{
      sticker_id: string;
      version: number | string;
      reason: string;
      created_at: string;
      created_by: string;
      name: string;
      status: string;
      file_id: string;
    }>();
  return rows.results.map((row) => ({
    stickerId: row.sticker_id.trim(),
    version: Number(row.version) || 0,
    name: row.name.trim(),
    status: toStickerStatus(row.status),
    reason: row.reason,
    createdAt: row.created_at,
    createdBy: row.created_by,
    fileId: row.file_id.trim() === '' ? null : row.file_id.trim(),
  }));
}
