import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import type { FileRecord } from '@server/modules/files/repo';
import { findActiveFile, findActiveFiles } from '@server/modules/files/repo';
import {
  EXTENSIONS,
  planAttachFiles,
  purgePendingFilesById,
  readFile,
  uploadFile,
} from '@server/modules/files/service';
import type {
  GetPostelFileInput,
  PostelAttachmentDto,
  PostelFileContentDto,
  UploadPostelFileInput,
} from '@shared/contract';
import { isImageMime, readImageDimensions } from '@shared/files';
import { hasLevel } from '@shared/permissions';
import { findPostelRecord } from './repo';

/**
 * Lampiran catatan Postel (gambar dan PDF): berkas biasa di tabel `files` dengan pemilik `postel` (`owner_id` =
 * catatan), disimpan di folder lampiran Drive yang sama dengan gambar item dan TIDAK pernah dibagikan "siapa saja yang
 * punya link". Unggahan lewat `postelFiles.upload` (belum bertuan, hanya terbaca pengunggahnya) lalu dipasang oleh
 * `postels.save` di batch yang sama dengan penulisan catatan.
 */

const UNKNOWN_ATTACHMENT_MESSAGE = 'Ada lampiran yang tidak dikenal';
const NOT_FOUND_MESSAGE = 'Berkas tidak ditemukan';

/**
 * Nama unduhan turunan: `lampiran-<8 karakter akhir id>.<ekstensi>` (tanpa nama asli klien, jadi tak perlu disanitasi).
 * Yang dipakai karakter AKHIR (bagian acak ULID): 8 karakter awal ULID hanyalah bit waktu teratas yang sama untuk berkas
 * yang diunggah serentak, sehingga nama-namanya akan kembar.
 */
export function postelAttachmentFilename(id: string, mime: string): string {
  return `lampiran-${id.slice(-8)}.${EXTENSIONS[mime] ?? 'bin'}`;
}

export function toAttachmentDto(
  file: Pick<FileRecord, 'id' | 'mime' | 'size'>,
): PostelAttachmentDto {
  return {
    id: file.id,
    mime: file.mime,
    size: file.size,
    filename: postelAttachmentFilename(file.id, file.mime),
  };
}

/** Lampiran menurut urutan `ids` (urutan tampil); berkas yang sudah tak aktif dilewati. */
export async function loadAttachmentDtos(
  env: Env,
  ids: readonly string[],
): Promise<PostelAttachmentDto[]> {
  if (ids.length === 0) return [];
  const byId = new Map((await findActiveFiles(env, ids)).map((file) => [file.id, file] as const));
  return ids.flatMap((id) => {
    const file = byId.get(id);
    return file ? [toAttachmentDto(file)] : [];
  });
}

/**
 * Unggah lampiran: tanda tangan byte sudah dicek validator; header gambar harus terbaca (tidak terbaca = ditolak), tanpa
 * batas dimensi; lebar dan tinggi disimpan 0 untuk semua lampiran. Drive dulu lalu baris database (lihat `uploadFile`).
 */
export async function uploadPostelFile(
  env: Env,
  input: UploadPostelFileInput,
  actor: UserContext,
): Promise<PostelAttachmentDto> {
  // Lampiran hanya diunduh (tak pernah dirender di halaman atau dikecilkan), jadi dimensinya tidak dipakai dan tidak
  // dibatasi: kolom `files.width/height` diisi 0 seperti PDF (tanpa risiko luapan INT dari header yang menipu).
  // Header yang tak terbaca tetap ditolak sebagai pemeriksaan keutuhan gambar.
  if (isImageMime(input.mime) && readImageDimensions(input.mime, input.bytes) === null) {
    const message = 'Dimensi gambar tidak terbaca';
    throw appError('VALIDATION', message, { bytes: message });
  }
  const file = await uploadFile(
    env,
    { mime: input.mime, bytes: input.bytes, width: 0, height: 0 },
    actor,
    'Terlalu banyak lampiran yang belum dipakai. Simpan catatan Postel yang sedang diedit terlebih dulu.',
  );
  return toAttachmentDto(file);
}

/**
 * Unduh lampiran: hanya berkas aktif berpemilik `postel` atau unggahan tertunda milik pemanggil; selain itu (berkas jenis
 * lain, unggahan orang lain, id tak dikenal) `NOT_FOUND` yang sama. Aturan akses diperiksa di `readFile` SEBELUM cache isi
 * berkas dibaca.
 */
export async function readPostelFile(
  env: Env,
  input: GetPostelFileInput,
  user: UserContext,
): Promise<PostelFileContentDto> {
  const record = await findActiveFile(env, input.id);
  const own = record !== null && record.ownerType === '' && record.createdBy === user.email;
  if (!record || (record.ownerType !== 'postel' && !own)) {
    throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
  }
  // Lampiran catatan terhapus tetap utuh (berkas tidak dibuang), tetapi hanya terbaca pemegang izin Pulihkan
  // (`sticker: edit`); pembaca lain dijawab `NOT_FOUND` SEBELUM isi berkas dibaca.
  if (record.ownerType === 'postel') {
    const owner = await findPostelRecord(env.DB, record.ownerId);
    if (owner && owner.deletedAt !== '' && !hasLevel(user.permissions.sticker, 'edit')) {
      throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
    }
  }
  const content = await readFile(
    env,
    { id: record.id },
    {
      email: user.email,
      itemBuIds: null,
      canReadStickerFiles:
        hasLevel(user.permissions.sticker, 'view') || hasLevel(user.permissions.item, 'view'),
      canReadPostelFiles: true,
    },
    record,
  );
  return { ...content, filename: postelAttachmentFilename(record.id, record.mime) };
}

export interface AttachmentPlan {
  /** Lepas yang dibuang, pasang yang baru, lalu penjaga: digabung ke `batch()` penyimpanan catatan. */
  statements: DbStatement[];
  /** Berkas yang dilepas dari catatan (dibuang SETELAH komit lewat `purgeReleasedAttachments`). */
  released: string[];
  /** Berkas belum bertuan yang dipasang oleh simpanan ini. */
  claimedIds: string[];
}

/** Menandai lampiran milik catatan sebagai `pending_delete` (hanya yang memang miliknya); berkas langsung tak terbaca. */
export function releaseAttachmentStmts(
  db: Preparer,
  postelId: string,
  ids: readonly string[],
): DbStatement[] {
  return ids.map((id) =>
    db
      .prepare(
        "UPDATE files SET status = 'pending_delete' WHERE id = ? AND owner_type = 'postel' AND owner_id = ?",
      )
      .bind(id, postelId),
  );
}

/**
 * Memeriksa dan merencanakan lampiran sebuah simpanan: tiap id harus berkas aktif ber-MIME lampiran dan (unggahan
 * belum bertuan milik penyimpan, atau sudah milik catatan ini). Berkas lain (milik catatan lain, jenis lain, unggahan
 * orang lain, id tak dikenal) dijawab SAMA, `VALIDATION` pada `attachmentIds`, tanpa membuka keberadaannya. Pemasangan
 * memakai `planAttachFiles` (penjaga `owner_type = ''`) ditambah penjaga hitungan yang membatalkan batch bila ada berkas
 * yang direbut simpanan serentak lain.
 */
export async function planPostelAttachments(
  env: Env,
  postelId: string,
  requested: readonly string[],
  existingIds: readonly string[],
  actor: UserContext,
): Promise<AttachmentPlan> {
  const files = requested.length === 0 ? [] : await findActiveFiles(env, requested);
  const byId = new Map(files.map((file) => [file.id, file] as const));
  for (const id of requested) {
    const file = byId.get(id);
    const usable =
      file !== undefined &&
      (file.mime === 'application/pdf' || isImageMime(file.mime)) &&
      ((file.ownerType === '' && file.createdBy === actor.email) ||
        (file.ownerType === 'postel' && file.ownerId === postelId));
    if (!usable) {
      throw appError('VALIDATION', UNKNOWN_ATTACHMENT_MESSAGE, {
        attachmentIds: UNKNOWN_ATTACHMENT_MESSAGE,
      });
    }
  }
  const requestedSet = new Set(requested);
  const released = existingIds.filter((id) => !requestedSet.has(id));
  const claimedIds = files.filter((file) => file.ownerType === '').map((file) => file.id);
  const claim = await planAttachFiles(env, requested, 'postel', postelId, files, actor.email);
  const guard: DbStatement[] =
    claimedIds.length === 0
      ? []
      : [
          env.DB.prepare(
            `SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE id IN (${claimedIds
              .map(() => '?')
              .join(
                ',',
              )}) AND status = 'active' AND owner_type = 'postel' AND owner_id = ?) <> ? THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
          ).bind(...claimedIds, postelId, claimedIds.length),
        ];
  return {
    statements: [...releaseAttachmentStmts(env.DB, postelId, released), ...claim, ...guard],
    released,
    claimedIds,
  };
}

/**
 * Membuang berkas Drive lampiran yang sudah ditandai `pending_delete` (SETELAH komit; tidak boleh di dalam transaksi yang
 * dapat diulang). Kegagalan Drive tidak menggagalkan simpan: berkas tetap `pending_delete` (tak terbaca) dan dibuang
 * penjadwal pembersihan.
 */
export async function purgeReleasedAttachments(env: Env, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await purgePendingFilesById(env, ids);
  } catch (error) {
    console.error(`Pembuangan lampiran Postel tertunda: ${String(error)}`);
  }
}
