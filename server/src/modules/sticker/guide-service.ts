import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import type {
  FileContentDto,
  GetStickerGuideThumbInput,
  ListStickerGuidesInput,
  StickerGuideDto,
  StickerGuidePageDto,
} from '@shared/contract';
import { hasLevel } from '@shared/permissions';
import { GUIDE_LIMITS } from '@shared/stickers';
import type { GuideRow } from './guide-repo';
import {
  encodeGuideCursor,
  guideThumbStatement,
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
