import { getBridge, viaBridge } from '@server/core/bridge-client';
import { bytesToBase64 } from '@server/core/bytes';
import { isGuardFailure } from '@server/core/cas';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, isAppError } from '@server/core/errors';
import { dropCachedFile } from '@server/core/file-cache';
import { folderIdOf, SETTING_DRIVE_FOLDER_ID } from '@server/core/settings';
import type { UserContext } from '@server/modules/access/context';
import { insertFileStmt } from '@server/modules/files/repo';
import { EXTENSIONS, ensureDriveFolder } from '@server/modules/files/service';
import type {
  FileContentDto,
  GetStickerGuideThumbInput,
  ListStickerGuidesInput,
  StickerGuideDto,
  StickerGuidePageDto,
  UploadStickerGuideInput,
} from '@shared/contract';
import { hasLevel } from '@shared/permissions';
import { GUIDE_LIMITS } from '@shared/stickers';
import type { GuideRow } from './guide-repo';
import {
  encodeGuideCursor,
  ensureLibraryLockStatement,
  guideThumbStatement,
  insertGuideStmt,
  libraryLimitGuardStmts,
  listGuidesStatement,
  parseGuideCursor,
} from './guide-repo';

/** Nama tampilan pengunggah bila akunnya tak ditemukan atau namanya kosong (email TIDAK PERNAH dikirim ke klien). */
const UNKNOWN_UPLOADER = 'Pengguna';

/**
 * Hak mengganti nama dan menghapus: pengunggah yang masih berizin `item: edit`, atau pemegang `item: manage`.
 * Dipakai daftar (untuk tombol di UI) dan servis tulis (penegak sebenarnya).
 */
export function canManageGuide(actor: UserContext, uploaderEmail: string): boolean {
  if (hasLevel(actor.permissions.item, 'manage')) return true;
  return hasLevel(actor.permissions.item, 'edit') && uploaderEmail === actor.email;
}

export function toGuideDto(row: GuideRow, actor: UserContext): StickerGuideDto {
  const can = canManageGuide(actor, row.created_by);
  return {
    id: row.id.trim(),
    name: row.name,
    mime: row.mime.trim(),
    size: Number(row.size) || 0,
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    uploadedBy: (row.uploader_name ?? '').trim() || UNKNOWN_UPLOADER,
    uploadedByMe: row.created_by === actor.email,
    createdAt: row.created_at,
    usageCount: Number(row.usage_count) || 0,
    canRename: can,
    canRemove: can,
  };
}

/** Halaman daftar pustaka: paginasi kunci; kursor yang tak terurai = halaman pertama. */
export async function listGuides(
  env: Env,
  input: ListStickerGuidesInput,
  actor: UserContext,
): Promise<StickerGuidePageDto> {
  const sort = input.sort ?? 'newest';
  const limit = input.limit ?? GUIDE_LIMITS.pageDefault;
  const cursor = input.cursor === undefined ? null : parseGuideCursor(sort, input.cursor);
  const result = await listGuidesStatement(env.DB, {
    search: input.search ?? '',
    sort,
    mine: input.mine === true ? actor.email : null,
    unused: input.unused === true,
    cursor,
    limit,
  }).all<GuideRow>();
  const page = result.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toGuideDto(row, actor)),
    nextCursor: result.results.length > limit && last ? encodeGuideCursor(sort, last) : null,
  };
}

const THUMB_MIMES: readonly string[] = ['image/webp', 'image/jpeg'];

/** Thumbnail dengan tipe tetap hasil validasi unggah; bukan gambar pustaka aktif = `NOT_FOUND`. */
export async function readGuideThumb(
  env: Env,
  input: GetStickerGuideThumbInput,
): Promise<FileContentDto> {
  const row = await guideThumbStatement(env.DB, input.id).first<{
    id: string;
    thumb_mime: string;
    thumb: Uint8Array;
  }>();
  const mime = row?.thumb_mime.trim() ?? '';
  if (!row || !THUMB_MIMES.includes(mime)) {
    throw appError('NOT_FOUND', 'Gambar tidak ditemukan');
  }
  return { id: row.id.trim(), mime, bytes: new Uint8Array(row.thumb) };
}

/** `2000` -> `2.000` (pesan pustaka penuh; satu sumber angka: `GUIDE_LIMITS.libraryMax`). */
function formatThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const LIBRARY_FULL_MESSAGE = `Pustaka gambar penuh (${formatThousands(GUIDE_LIMITS.libraryMax)} gambar)`;

/** Percobaan tulis bila deadlock lolos dari ulang sekali di `Db.batch` (penulis serentak pada baris kunci). */
const UPLOAD_DB_ATTEMPTS = 3;

/**
 * Unggah ke pustaka. Urutan seperti `uploadFile`: Drive DULU, lalu SATU `batch()` (penjaga batas, baris `files`
 * berpemilik `stickerguide` = id berkasnya sendiri, baris pustaka). Gagal setelah Drive (basis data atau batas penuh):
 * berkas Drive dibuang best-effort. Berkas pustaka tercatat sejak unggah, jadi tidak masuk hitungan "unggahan yatim"
 * (`MAX_UNATTACHED_UPLOADS` tidak berlaku); batas globalnya `GUIDE_LIMITS.libraryMax`, kebal balapan lewat kunci
 * baris di dalam `batch()` (`libraryLimitGuardStmts`).
 */
export async function uploadGuide(
  env: Env,
  input: UploadStickerGuideInput,
  actor: UserContext,
): Promise<StickerGuideDto> {
  const folderId =
    (await folderIdOf(env, SETTING_DRIVE_FOLDER_ID)) || (await ensureDriveFolder(env));
  const id = crypto.randomUUID();
  const bridge = getBridge(env);
  const driveId = await viaBridge(() =>
    bridge.createFile(
      folderId,
      `${id}.${EXTENSIONS[input.mime] ?? 'bin'}`,
      input.mime,
      bytesToBase64(input.image),
    ),
  );
  const now = nowIso(env);
  try {
    await ensureLibraryLockStatement(env.DB).run();
    for (let attempt = 1; ; attempt++) {
      try {
        await env.DB.batch([
          ...libraryLimitGuardStmts(env.DB, GUIDE_LIMITS.libraryMax),
          insertFileStmt(env.DB, {
            id,
            driveId,
            mime: input.mime,
            size: input.image.length,
            width: input.width,
            height: input.height,
            ownerType: 'stickerguide',
            ownerId: id,
            createdAt: now,
            createdBy: actor.email,
            status: 'active',
          }),
          insertGuideStmt(env.DB, {
            id,
            name: input.name,
            thumbMime: input.thumbMime,
            thumb: input.thumbnail,
            updatedAt: now,
          }),
        ]);
        break;
      } catch (error) {
        if (isGuardFailure(error)) throw appError('CONFLICT', LIBRARY_FULL_MESSAGE);
        if (error instanceof DbError && error.kind === 'deadlock' && attempt < UPLOAD_DB_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    try {
      await bridge.trashFile(driveId);
      await dropCachedFile(env, driveId);
    } catch (trashError) {
      console.error(`Berkas Drive ${driveId} yatim (gagal dibuang): ${String(trashError)}`);
    }
    if (isAppError(error)) throw error;
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`Pencatatan gambar pustaka gagal setelah unggah ke Drive: ${detail}`);
    throw appError('INTERNAL', 'Gambar gagal disimpan. Coba unggah lagi.');
  }
  return toGuideDto(
    {
      id,
      name: input.name,
      name_key: input.name.toLowerCase(),
      mime: input.mime,
      size: input.image.length,
      width: input.width,
      height: input.height,
      created_at: now,
      created_by: actor.email,
      uploader_name: actor.name,
      usage_count: 0,
    },
    actor,
  );
}
