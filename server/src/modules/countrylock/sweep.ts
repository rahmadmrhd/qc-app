import { getBridge, viaBridge } from '@server/core/bridge-client';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { BLOB_FOLDER_SETTING } from './blob-store';

/** Sesi unggah biner yang tak disentuh selama ini dibuang (sesi `open` yang ditinggalkan, juga `done`/`aborted` lama). */
export const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Penyapu per jam (`schedulerTick`): membuang sesi unggah Country Lock yang `updated_at`-nya lebih tua dari 24 jam
 * beserta potongannya. Sesi dibuang LEBIH DULU lalu potongan yatim, sehingga sesi yang tersentuh di tengah penyapuan
 * tak pernah kehilangan potongan dengan sesinya tetap ada. Mengembalikan jumlah sesi yang dibuang.
 */
export async function sweepCountryLockUploads(env: Env): Promise<{ removed: number }> {
  const cutoff = new Date(nowOf(env) - UPLOAD_MAX_AGE_MS).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM cl_uploads WHERE updated_at < ?').bind(cutoff),
    env.DB.prepare(
      'DELETE FROM cl_upload_chunks WHERE upload_id NOT IN (SELECT id FROM cl_uploads)',
    ),
  ]);
  return { removed: results[0]?.meta.changes ?? 0 };
}

/** Masa tenggang sebelum biner yang tak dirujuk apa pun disapu (spek §5.2). */
export const BLOB_ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const BLOB_SWEEP_BATCH = 50;
const BLOB_LIST_PAGE = 100;
// Tahap 2 menelusuri SELURUH folder (pageToken sampai habis) dalam satu putaran, dibatasi jumlah halaman dan waktu agar
// putaran jam-an tak menggantung pada folder yang sangat besar; sisanya diteruskan putaran berikutnya (Drive mengurutkan
// tetap, jadi yang dihapus tak muncul lagi dan penelusuran maju).
const BLOB_LIST_MAX_PAGES = 100;
export const BLOB_SWEEP_BUDGET_MS = 60_000;
const SHA256_NAME = /^[0-9a-f]{64}$/;

// Biner dirujuk bila sha256-nya ada di revisi mana pun (termasuk revisi lama dan berkas yang sudah dihapus) atau di
// berkas bundel terbit mana pun. Satu definisi untuk pemilihan kandidat dan penghapusan bersyarat.
const UNREFERENCED_SQL =
  'NOT EXISTS (SELECT 1 FROM cl_bundle_files f WHERE f.sha256 = {sha}) AND {sha} NOT IN (SELECT sha256 FROM cl_revisions)';

/**
 * Penyapu biner yatim (spek §5.2; `schedulerTick` per jam). Konservatif dan idempoten, dua tahap:
 *  1. Baris `cl_blobs` berumur > 7 hari yang tak dirujuk revisi mana pun maupun berkas bundel mana pun: baris dibuang
 *     LEBIH DULU lewat DELETE bersyarat (syarat "tak dirujuk" diperiksa ulang di pernyataan yang sama; penyimpanan
 *     revisi menguncinya lewat penjaga di `finishClUpload`), baru berkas Drive-nya dihapus.
 *  2. Berkas di folder biner Drive yang bernama sha256, berumur > 7 hari (`createdTime` tak dikenal = dilewati), dan
 *     tidak ditunjuk baris `cl_blobs` mana pun (kembaran unggahan serentak, sisa gagal hapus tahap 1).
 * Biner yang dirujuk bundel terbit atau revisi mana pun tak pernah disentuh. Paling banyak 50 baris, 100 halaman Drive (@100
 * entri), dan 60 detik per putaran; sisanya ikut putaran berikutnya. Mengembalikan jumlah baris dan berkas Drive yang dibuang.
 */
export async function sweepOrphanBlobs(env: Env): Promise<{ blobs: number; driveFiles: number }> {
  const cutoff = new Date(nowOf(env) - BLOB_ORPHAN_GRACE_MS).toISOString();
  const bridge = getBridge(env);
  let blobs = 0;
  let driveFiles = 0;

  const candidates = await env.DB.prepare(
    `SELECT b.sha256, b.drive_file_id FROM cl_blobs b WHERE b.created_at < ? AND ${UNREFERENCED_SQL.replaceAll('{sha}', 'b.sha256')} ORDER BY b.created_at LIMIT ${BLOB_SWEEP_BATCH}`,
  )
    .bind(cutoff)
    .all<{ sha256: string; drive_file_id: string }>();
  for (const candidate of candidates.results) {
    const deleted = await env.DB.prepare(
      `DELETE FROM cl_blobs WHERE sha256 = ? AND created_at < ? AND ${UNREFERENCED_SQL.replaceAll('{sha}', 'cl_blobs.sha256')}`,
    )
      .bind(candidate.sha256, cutoff)
      .run();
    if (deleted.meta.changes !== 1) continue;
    blobs++;
    try {
      await viaBridge(() => bridge.deleteFile(candidate.drive_file_id));
      driveFiles++;
    } catch (error) {
      // Berkas Drive-nya jadi yatim tanpa baris: disapu tahap 2 pada putaran berikutnya.
      console.error(
        `penyapu biner Country Lock: berkas Drive ${candidate.drive_file_id} gagal dibuang: ${String(error)}`,
      );
    }
  }

  const folder = await env.DB.prepare('SELECT value FROM settings WHERE `key` = ?')
    .bind(BLOB_FOLDER_SETTING)
    .first<{ value: string }>();
  if (folder === null) return { blobs, driveFiles };
  const startedAt = Date.now();
  // Fase 1: telusuri folder sampai habis (atau batas halaman/waktu) TANPA menghapus apa pun, karena menghapus saat
  // menelusuri dapat menggeser halaman dan melewatkan entri.
  const old: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < BLOB_LIST_MAX_PAGES; page++) {
    const listed = await viaBridge(() =>
      bridge.listFolder(folder.value, {
        pageSize: BLOB_LIST_PAGE,
        ...(pageToken === undefined ? {} : { pageToken }),
      }),
    );
    for (const entry of listed.files) {
      if (
        SHA256_NAME.test(entry.name) &&
        entry.createdTime !== undefined &&
        entry.createdTime < cutoff
      ) {
        old.push({ id: entry.id, name: entry.name });
      }
    }
    pageToken = listed.nextPageToken;
    if (pageToken === undefined || Date.now() - startedAt > BLOB_SWEEP_BUDGET_MS) break;
  }
  // Fase 2: buang yang tak ditunjuk baris katalog, satu kueri per 100 entri. Aman terhadap `storeBlob` karena
  // berkas setua ini (> 7 hari) tak pernah dipakai ulang olehnya (batas 6 hari, `BLOB_REUSE_MAX_AGE_MS`).
  for (let from = 0; from < old.length; from += BLOB_LIST_PAGE) {
    if (Date.now() - startedAt > 2 * BLOB_SWEEP_BUDGET_MS) break;
    const chunk = old.slice(from, from + BLOB_LIST_PAGE);
    const rows = await env.DB.prepare(
      `SELECT drive_file_id FROM cl_blobs WHERE sha256 IN (${chunk.map(() => '?').join(', ')})`,
    )
      .bind(...chunk.map((entry) => entry.name))
      .all<{ drive_file_id: string }>();
    const referencedIds = new Set(rows.results.map((row) => row.drive_file_id));
    for (const entry of chunk) {
      if (referencedIds.has(entry.id)) continue;
      try {
        await viaBridge(() => bridge.deleteFile(entry.id));
        driveFiles++;
      } catch (error) {
        console.error(
          `penyapu biner Country Lock: berkas Drive ${entry.id} gagal dibuang: ${String(error)}`,
        );
      }
    }
  }
  return { blobs, driveFiles };
}
