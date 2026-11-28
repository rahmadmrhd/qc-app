import { createHash } from 'node:crypto';
import type { DriveRange } from '@server/core/bridge-client';
import { getBridge, viaBridge } from '@server/core/bridge-client';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { ensureNamedFolder } from '@server/modules/files/service';

/**
 * Penyimpanan biner bundel Country Lock di Google Drive, dinamai menurut sha256 isinya (satu salinan untuk semua berkas
 * dan bundel yang memakainya). Katalognya tabel `cl_blobs`. Folder = subfolder di bawah folder induk Google (otomatis
 * diizinkan penjaga folder klien Google) dan idnya dicatat di tabel `settings`: tanpa variabel `.env` baru.
 */

export const BLOB_FOLDER_SETTING = 'COUNTRYLOCK_FOLDER_ID';
export const BLOB_FOLDER_NAME = 'QC App Country Lock';
export const BLOB_MIME = 'application/octet-stream';
const LIST_PAGE_SIZE = 50;
/**
 * Berkas Drive sehat hanya dipakai ulang bila `createdTime`-nya lebih muda dari ini. HARUS di bawah masa tenggang
 * penyapu (`BLOB_ORPHAN_GRACE_MS` = 7 hari, `sweep.ts`): penyapu hanya menghapus berkas lebih tua dari itu, jadi berkas
 * yang kita pakai ulang tak pernah sedang dihapus penyapu (review perbaikan m1). Berkas lebih tua atau tanpa
 * `createdTime` dianggap tak ada: berkas baru diunggah dan yang lama dibiarkan untuk penyapu.
 */
export const BLOB_REUSE_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;

export function ensureBlobFolder(env: Env): Promise<string> {
  return ensureNamedFolder(env, BLOB_FOLDER_SETTING, BLOB_FOLDER_NAME);
}

export interface BlobRef {
  sha256: string;
  size: number;
  driveFileId: string;
  md5: string;
}

export async function getBlob(env: Env, sha256: string): Promise<BlobRef | null> {
  const row = await env.DB.prepare(
    'SELECT sha256, size, drive_file_id, md5 FROM cl_blobs WHERE sha256 = ?',
  )
    .bind(sha256)
    .first<{ sha256: string; size: number | string; drive_file_id: string; md5: string }>();
  return row === null
    ? null
    : {
        sha256: row.sha256,
        size: Number(row.size),
        driveFileId: row.drive_file_id,
        md5: row.md5,
      };
}

/**
 * Menyimpan biner ke Drive bila belum ada (idempoten): blob yang sudah tercatat tidak diunggah ulang; berkas Drive
 * bernama sama yang MD5 dan ukurannya cocok (sisa percobaan yang gagal setelah unggah) dipakai ulang; yang tak cocok
 * (cacat) dibuang; setelah unggah, MD5 dan ukuran dari Drive HARUS sama dengan hitungan lokal, kalau tidak berkas Drive
 * dibuang dan galat dilempar (pemanggil tidak menulis baris apa pun yang merujuk blob ini).
 *
 * Berkas kembar yang SEHAT (MD5 cocok) TIDAK pernah dibuang di sini: bisa jadi salah satunya sudah dirujuk `cl_blobs`
 * oleh unggahan serentak yang baru menyisip barisnya (balapan tiga arah, review akhir M4). Kembaran itu hanya
 * membuang ruang dan disapu `sweepOrphanBlobs` setelah masa tenggang.
 */
export async function storeBlob(
  env: Env,
  blob: { sha256: string; bytes: Uint8Array },
): Promise<void> {
  if ((await getBlob(env, blob.sha256)) !== null) return;
  const folderId = await ensureBlobFolder(env);
  const bridge = getBridge(env);
  const md5 = createHash('md5').update(blob.bytes).digest('hex');
  const size = blob.bytes.length;

  const existing = [];
  let pageToken: string | undefined;
  do {
    const page = await viaBridge(() =>
      bridge.listFolder(folderId, {
        name: blob.sha256,
        pageSize: LIST_PAGE_SIZE,
        ...(pageToken === undefined ? {} : { pageToken }),
      }),
    );
    existing.push(...page.files.filter((entry) => entry.name === blob.sha256));
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);

  const healthy = (entry: { md5Checksum?: string; size: number }) =>
    entry.md5Checksum === md5 && entry.size === size;
  // Hanya berkas CACAT (MD5/ukuran tak cocok) yang dibuang; barisnya tak mungkin ada karena baris hanya ditulis setelah
  // verifikasi MD5, jadi menghapusnya tak dapat memutus rujukan yang sah.
  for (const entry of existing) {
    if (!healthy(entry)) await viaBridge(() => bridge.deleteFile(entry.id));
  }
  // Unggahan serentak mungkin sudah mencatat blob ini selagi kita membaca isi folder: pakai catatan itu.
  if ((await getBlob(env, blob.sha256)) !== null) return;
  const now = nowOf(env);
  const reusable = existing.find(
    (entry) =>
      healthy(entry) &&
      entry.createdTime !== undefined &&
      now - Date.parse(entry.createdTime) < BLOB_REUSE_MAX_AGE_MS,
  );
  let driveFileId = reusable?.id;
  if (driveFileId === undefined) {
    const result = await viaBridge(() =>
      bridge.uploadFile(folderId, blob.sha256, BLOB_MIME, blob.bytes, {
        appProperties: { sha256: blob.sha256, app: 'qc' },
      }),
    );
    if (result.md5Checksum !== md5 || result.size !== size) {
      try {
        await viaBridge(() => bridge.deleteFile(result.id));
      } catch (error) {
        console.error(
          `countrylock: berkas Drive cacat ${result.id} belum dapat dibuang: ${String(error)}`,
        );
      }
      throw appError('INTERNAL', 'Checksum biner di Drive tidak sama dengan berkas yang diunggah');
    }
    driveFileId = result.id;
  }
  await env.DB.prepare(
    'INSERT INTO cl_blobs (sha256, size, drive_file_id, md5, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE sha256 = sha256',
  )
    .bind(blob.sha256, size, driveFileId, md5, nowIso(env))
    .run();
}

export interface OpenedBlob {
  stream: ReadableStream<Uint8Array>;
  /** Ukuran SELURUH biner. */
  size: number;
  /** Rentang yang dialirkan (akhir dijepit ke ukuran) bila diminta. */
  range?: DriveRange;
}

/** Mengalirkan biner (seluruhnya atau satu rentang byte inklusif) dari Drive; tak tercatat/tak ada = `NOT_FOUND`. */
export async function openBlob(env: Env, sha256: string, range?: DriveRange): Promise<OpenedBlob> {
  const blob = await getBlob(env, sha256);
  if (blob === null) throw appError('NOT_FOUND', 'Biner tidak ditemukan');
  if (
    range !== undefined &&
    (!Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.start >= blob.size)
  ) {
    throw appError('VALIDATION', 'Rentang byte tidak valid');
  }
  const folderId = await ensureBlobFolder(env);
  const bridge = getBridge(env);
  const download = await viaBridge(() => bridge.downloadFile(blob.driveFileId, folderId, range));
  if (download === null) throw appError('NOT_FOUND', 'Biner tidak ditemukan');
  return {
    stream: download.body,
    size: blob.size,
    ...(download.range === undefined ? {} : { range: download.range }),
  };
}
