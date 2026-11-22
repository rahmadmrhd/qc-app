import { getBridge, viaBridge } from '@server/core/bridge-client';
import { base64ToBytes, bytesToBase64 } from '@server/core/bytes';
import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { cachedFileContent, dropCachedFile } from '@server/core/file-cache';
import { newId } from '@server/core/id';
import { folderIdOf, SETTING_DRIVE_FOLDER_ID, setSettingIfAbsent } from '@server/core/settings';
import type { UserContext } from '@server/modules/access/context';
import { involvedBuIds, readableSerialSql } from '@server/modules/serial/bu-history';
import type { FileContentDto, FileDto, GetFileInput, UploadFileInput } from '@shared/contract';
import type { FileOwnerType } from '@shared/files';
import { isImageMime, MAX_UNATTACHED_UPLOADS } from '@shared/files';
import type { FileRecord } from './repo';
import {
  countUnattached,
  FILE_COLUMNS,
  findActiveFile,
  findActiveFiles,
  insertFileStmt,
  toFile,
} from './repo';

export const DRIVE_FOLDER_NAME = 'QC App Files';

/** Ekstensi nama berkas Drive per MIME gambar (juga dipakai pustaka gambar stiker). */
export const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // Lampiran Postel (4b); `files.upload` biasa tetap hanya menerima gambar.
  'application/pdf': 'pdf',
};

/**
 * Idempoten. Membuat folder **hanya bila setting kosong**. Bila terisi tetapi foldernya tak dapat diakses
 * (dihapus, tempat sampah, atau akun pemilik tak punya akses), melempar galat dan TIDAK menimpa setting:
 * menimpa akan memutus semua gambar yang sudah tercatat (FS13).
 */
export async function ensureNamedFolder(
  env: Env,
  settingKey: string,
  name: string,
): Promise<string> {
  // Id dari `.env` (ATTACHMENTS_FOLDER_ID, dst.) hanya diverifikasi: tidak pernah dibuat otomatis atau ditimpa.
  const existing = await folderIdOf(env, settingKey);
  const bridge = getBridge(env);
  if (existing) {
    if (await viaBridge(() => bridge.folderExists(existing))) return existing;
    throw appError(
      'INTERNAL',
      `Folder Drive ${existing} tidak dapat diakses (dihapus, ada di tempat sampah, atau service account Google belum punya akses Editor).`,
    );
  }
  const id = await viaBridge(() => bridge.createFolder(name));
  // Permintaan serentak: yang pertama menyimpan menang; folder kedua menjadi yatim kosong (tak berbahaya).
  return setSettingIfAbsent(env, settingKey, id);
}

/** Folder lampiran (berkas di tabel `files`); perilaku FS13 ada di `ensureNamedFolder`. */
export function ensureDriveFolder(env: Env): Promise<string> {
  return ensureNamedFolder(env, SETTING_DRIVE_FOLDER_ID, DRIVE_FOLDER_NAME);
}

function toFileDto(file: FileRecord): FileDto {
  return { id: file.id, mime: file.mime, size: file.size, width: file.width, height: file.height };
}

/**
 * Unggah gambar. Urutan (Spek 8.2): Drive DULU lewat jembatan, lalu baris database. Bila database gagal setelah Drive
 * sukses, berkas Drive dibuang (best effort; yang tersisa dibersihkan cron) dan pengguna melihat galat jelas.
 * Bila jembatan gagal, tidak ada baris database sama sekali. Aman diulang.
 */
export async function uploadFile(
  env: Env,
  input: UploadFileInput,
  actor: UserContext,
  /** Pesan batas unggahan tertunda yang sesuai formulir pemanggil (bawaan: pesan gambar item). */
  limitMessage = 'Terlalu banyak gambar yang belum dipakai. Simpan item yang sedang diedit terlebih dulu.',
): Promise<FileDto> {
  // Batas berkas yatim per user: yang belum ditautkan ke entitas tidak boleh menumpuk tanpa batas.
  if ((await countUnattached(env, actor.email)) >= MAX_UNATTACHED_UPLOADS) {
    throw appError('CONFLICT', limitMessage);
  }
  const folderId =
    (await folderIdOf(env, SETTING_DRIVE_FOLDER_ID)) || (await ensureDriveFolder(env));
  const id = newId();
  const name = `${id}.${EXTENSIONS[input.mime] ?? 'bin'}`;
  const bridge = getBridge(env);
  const driveId = await viaBridge(() =>
    bridge.createFile(folderId, name, input.mime, bytesToBase64(input.bytes)),
  );
  const record: FileRecord = {
    id,
    driveId,
    mime: input.mime,
    size: input.bytes.length,
    width: input.width,
    height: input.height,
    ownerType: '',
    ownerId: '',
    createdAt: nowIso(env),
    createdBy: actor.email,
    status: 'active',
  };
  try {
    await insertFileStmt(env.DB, record).run();
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`Pencatatan berkas gagal setelah unggah ke Drive: ${detail}`);
    try {
      await bridge.trashFile(driveId);
      await dropCachedFile(env, driveId);
    } catch (trashError) {
      console.error(`Berkas Drive ${driveId} yatim (gagal dibuang): ${String(trashError)}`);
    }
    throw appError('INTERNAL', 'Gambar gagal disimpan. Coba unggah lagi.');
  }
  return toFileDto(record);
}

/**
 * Pemanggil pembaca berkas. `itemBuIds`: `null` = tak punya izin `item` global (hanya logo bersama `qrlogo` dan
 * unggahan miliknya yang belum terpasang); array = BU yang boleh dilihat user (berkas milik item hanya terbaca bila
 * item pemiliknya beririsan dengan himpunan ini; jenis pemilik lain tak dibatasi BU). `canReadStickerFiles`: boleh
 * membaca gambar contoh stiker (pemilik `sticker`) dan gambar pustaka stiker (pemilik `stickerguide`): pemegang
 * `sticker: view` atau izin `item` (katalog bersama; tanpa batas BU).
 */
export interface FileViewer {
  email: string;
  itemBuIds: readonly string[] | null;
  canReadStickerFiles: boolean;
  /** Hanya rute lampiran Postel (`sticker: view`): boleh membaca berkas berpemilik `postel`; `files.get` tidak. */
  canReadPostelFiles?: boolean;
  /**
   * BU yang boleh dibaca modul serial (`readableBuIds`: `serial`/`serialservice: view`). Berkas berpemilik `serial`
   * (gambar pada pesan kejadian) hanya terbaca bila BU serial pemiliknya ada di sini; izin `item`, `sticker`, atau
   * `qrcode` tidak pernah membukanya. Kosong/tak diisi = tak terbaca.
   */
  serialBuIds?: readonly string[];
  /**
   * Hak Pulihkan serial atas himpunan BU riwayatnya (`canManageSerial`): berkas milik serial TERHAPUS hanya terbaca
   * bila fungsi ini ada dan menyetujui (soft delete §4.2); tanpa itu serial terhapus tak terbaca.
   */
  serialManage?: (involvedBuIds: readonly string[]) => boolean;
}

/** Serial pemilik berkas terlihat bagi viewer (BU serial ada di himpunan)? SATU kueri; himpunan kosong tanpa kueri. */
async function serialFileVisible(
  env: Env,
  serialId: string,
  serialBuIds: readonly string[],
  serialManage?: (involvedBuIds: readonly string[]) => boolean,
): Promise<boolean> {
  if (serialBuIds.length === 0) return false;
  // BU saat ini ATAU BU di riwayat serial (baca; spek serial unik se-sistem §5.3).
  const row = await env.DB.prepare(
    `SELECT s.deleted_at FROM serials s WHERE s.id = ? AND ${readableSerialSql('s', serialBuIds.length)}`,
  )
    .bind(serialId, ...serialBuIds, ...serialBuIds)
    .first<{ deleted_at: string }>();
  if (row === null) return false;
  if (row.deleted_at === '') return true;
  // Serial terhapus: hanya pemegang hak Pulihkan (soft delete §4.2).
  return serialManage?.(await involvedBuIds(env.DB, serialId)) ?? false;
}

/** Item pemilik berkas terlihat bagi viewer? SATU kueri (`LIMIT 1`); himpunan kosong tanpa kueri. */
async function itemFileVisible(
  env: Env,
  itemId: string,
  itemBuIds: readonly string[],
): Promise<boolean> {
  if (itemBuIds.length === 0) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM item_business_units WHERE item_id = ? AND bu_id IN (${itemBuIds.map(() => '?').join(',')}) LIMIT 1`,
  )
    .bind(itemId, ...itemBuIds)
    .first<{ ok: number }>();
  return row !== null;
}

/**
 * Membaca berkas: hanya berkas aktif yang tercatat di tabel `files` yang dapat dibaca (id Drive tidak
 * pernah datang dari klien), dan hanya yang induknya folder aplikasi. Isi dibaca dari cache/jembatan (base64)
 * lalu didekode menjadi byte untuk respons mentah. Aturan akses (`FileViewer`) diperiksa SEBELUM cache isi dibaca;
 * berkas di luar hak = `NOT_FOUND` yang sama dengan berkas tak ada.
 */
export async function readFile(
  env: Env,
  input: GetFileInput,
  viewer: FileViewer,
  /** Baris berkas yang sudah dimuat pemanggil (hindari kueri ganda); `undefined` = muat di sini. */
  preloaded?: FileRecord | null,
): Promise<FileContentDto> {
  const record = preloaded === undefined ? await findActiveFile(env, input.id) : preloaded;
  if (!record) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  // Berkas non-gambar (PDF lampiran Postel) tidak pernah disajikan lewat rute gambar (`files.get`): hanya rute lampiran.
  if (!isImageMime(record.mime) && viewer.canReadPostelFiles !== true) {
    throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  }
  // Lampiran Postel hanya lewat rutenya sendiri (izin `sticker: view`), bukan `files.get`.
  const isPostel = record.ownerType === 'postel';
  if (isPostel && viewer.canReadPostelFiles !== true) {
    throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  }
  // Gambar pesan serial dan foto bukti QC (`serialproof`): SEBELUM cabang `itemBuIds` (yang membiarkan pemilik lain
  // lolos); hanya lewat BU serial pemiliknya (`owner_id` = id serial).
  const isSerial = record.ownerType === 'serial' || record.ownerType === 'serialproof';
  if (
    isSerial &&
    !(await serialFileVisible(env, record.ownerId, viewer.serialBuIds ?? [], viewer.serialManage))
  ) {
    throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  }
  if (viewer.itemBuIds === null) {
    const isLogo = record.ownerType === 'qrlogo';
    const isOwnPending = record.ownerType === '' && record.createdBy === viewer.email;
    const isSticker = record.ownerType === 'sticker' && viewer.canReadStickerFiles;
    // Gambar pustaka stiker (3b-1): pemegang `sticker: view` atau `item: view`, tanpa batas BU.
    const isGuide = record.ownerType === 'stickerguide' && viewer.canReadStickerFiles;
    if (!isLogo && !isOwnPending && !isSticker && !isGuide && !isPostel && !isSerial)
      throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  } else if (
    record.ownerType === 'item' &&
    !(await itemFileVisible(env, record.ownerId, viewer.itemBuIds))
  ) {
    throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  }
  // Unggahan yang belum terpasang hanya terbaca pengunggahnya (keputusan pemilik 2026-11-09), apa pun izin `item`-nya.
  if (record.ownerType === '' && record.createdBy !== viewer.email) {
    throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  }
  const folderId = await folderIdOf(env, SETTING_DRIVE_FOLDER_ID);
  if (folderId === '') throw appError('NOT_FOUND', 'Isi berkas tidak ditemukan di Drive');
  // Cache memori proses terikat folder aktif; dibaca SETELAH aturan akses di atas.
  const bridge = getBridge(env);
  const content = await cachedFileContent(env, folderId, record.driveId, async () => {
    const read = await viaBridge(() => bridge.readFile(record.driveId, folderId));
    return read ? { mime: record.mime, base64: read.base64 } : null;
  });
  if (!content) throw appError('NOT_FOUND', 'Isi berkas tidak ditemukan di Drive');
  return { id: record.id, mime: record.mime, bytes: base64ToBytes(content.base64) };
}

/**
 * Rencana penetapan pemilik berkas (dipakai simpan item/logo): memvalidasi seluruh batch dulu, lalu
 * mengembalikan pernyataan UPDATE untuk digabung ke `batch()` penyimpanan entitas (atomik). Berkas yang
 * sudah dimiliki entitas lain ditolak; pemilik yang sama aman diulang. Unggahan yang belum terpasang hanya boleh dipasang
 * pengunggahnya (`claimant`; milik orang lain dijawab seperti berkas tak dikenal). Pernyataan memakai penjaga
 * `owner_type = ''` sehingga rebutan berkas yang sama tidak menimpa pemilik.
 */
export async function planAttachFiles(
  env: Env,
  ids: readonly string[],
  ownerType: FileOwnerType,
  ownerId: string,
  /** Hasil `findActiveFiles` untuk `ids` yang sudah dimuat pemanggil (hindari kueri ganda). */
  preloaded?: readonly FileRecord[],
  /** Email pemasang: unggahan belum terpasang milik orang lain = `VALIDATION` (sama dengan berkas tak dikenal). */
  claimant?: string,
): Promise<DbStatement[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const files = preloaded ?? (await findActiveFiles(env, unique));
  const byId = new Map(files.map((file) => [file.id, file] as const));
  const toClaim: FileRecord[] = [];
  for (const id of unique) {
    const file = byId.get(id);
    if (!file) throw appError('VALIDATION', 'Ada berkas yang tidak dikenal');
    // Hanya lampiran Postel yang boleh berupa non-gambar (PDF); pemilik lain (item, contoh stiker, logo QR) wajib gambar.
    if (ownerType !== 'postel' && !isImageMime(file.mime)) {
      throw appError('VALIDATION', 'Ada berkas yang tidak dikenal');
    }
    if (file.ownerType === '') {
      if (claimant !== undefined && file.createdBy !== claimant) {
        throw appError('VALIDATION', 'Ada berkas yang tidak dikenal');
      }
      toClaim.push(file);
    } else if (
      (file.ownerType === 'item' && ownerType !== 'item') ||
      (file.ownerType === 'postel' && ownerType !== 'postel') ||
      // Gambar serial hanya boleh dipakai ulang pada serial pemiliknya; jalur lain atau serial lain dijawab generik
      // (tanpa membuka bahwa berkas itu ada dan milik serial/BU lain).
      (file.ownerType === 'serial' && (ownerType !== 'serial' || file.ownerId !== ownerId)) ||
      // Foto bukti QC dibuat langsung berpemilik oleh job `serial_proof`; tak pernah dipasang lewat jalur mana pun.
      file.ownerType === 'serialproof'
    ) {
      // Berkas item, Postel, atau serial yang dikirim ke jalur lain (logo QR, stiker): jawab seperti berkas tak dikenal,
      // tanpa membuka keberadaannya (pemilik Postel hanya terlihat bagi pembaca modul Postel).
      throw appError('VALIDATION', 'Ada berkas yang tidak dikenal');
    } else if (file.ownerType !== ownerType || file.ownerId !== ownerId) {
      throw appError('CONFLICT', 'Berkas sudah dipakai di tempat lain');
    }
  }
  const claims = toClaim.map((file) =>
    env.DB.prepare(
      "UPDATE files SET owner_type = ?, owner_id = ? WHERE id = ? AND status = 'active' AND owner_type = ''",
    ).bind(ownerType, ownerId, file.id),
  );
  // Gambar serial: dua aksi serentak oleh pengunggah yang sama tidak boleh memasang unggahan yang sama ke dua serial
  // (BU berbeda). `UPDATE ... AND owner_type = ''` hanya membuat pemasang kedua tak mengubah baris; penjaga hitungan ini
  // membatalkan seluruh batch bila ada berkas yang tidak berakhir milik serial ini (pola penjaga lampiran Postel).
  if (ownerType === 'serial' && toClaim.length > 0) {
    claims.push(
      env.DB.prepare(
        `SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE id IN (${toClaim
          .map(() => '?')
          .join(
            ',',
          )}) AND status = 'active' AND owner_type = 'serial' AND owner_id = ?) <> ? THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
      ).bind(...toClaim.map((file) => file.id), ownerId, toClaim.length),
    );
  }
  return claims;
}

export async function attachFiles(
  env: Env,
  ids: readonly string[],
  ownerType: FileOwnerType,
  ownerId: string,
  claimant?: string,
): Promise<void> {
  const statements = await planAttachFiles(env, ids, ownerType, ownerId, undefined, claimant);
  if (statements.length > 0) await env.DB.batch(statements);
}

/** Langkah 1 penghapusan (Spek 8.2): tandai `pending_delete` di database; berkas langsung tak terbaca. */
export function markFilesPendingDelete(env: Env, ids: readonly string[]): DbStatement[] {
  return ids.map((id) =>
    env.DB.prepare("UPDATE files SET status = 'pending_delete' WHERE id = ?").bind(id),
  );
}

/**
 * Langkah 2-3: buang berkas `pending_delete` di Drive lalu hapus barisnya. Kegagalan jembatan pada satu
 * berkas membiarkannya tetap `pending_delete` (diulang cron). Mengembalikan jumlah baris yang terhapus.
 */
export async function purgePendingFiles(env: Env, limit = 20): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT ${FILE_COLUMNS} FROM files WHERE status = 'pending_delete' LIMIT ?`,
  )
    .bind(limit)
    .all<Parameters<typeof toFile>[0]>();
  return purgeRows(env, rows.results);
}

/** Seperti `purgePendingFiles` tetapi hanya untuk `ids` (yang berstatus `pending_delete`): pembuangan terarah sesudah komit. */
export async function purgePendingFilesById(env: Env, ids: readonly string[]): Promise<number> {
  let purged = 0;
  for (let from = 0; from < ids.length; from += 90) {
    const chunk = ids.slice(from, from + 90);
    const rows = await env.DB.prepare(
      `SELECT ${FILE_COLUMNS} FROM files WHERE status = 'pending_delete' AND id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<Parameters<typeof toFile>[0]>();
    purged += await purgeRows(env, rows.results);
  }
  return purged;
}

async function purgeRows(env: Env, results: Parameters<typeof toFile>[0][]): Promise<number> {
  const bridge = getBridge(env);
  let purged = 0;
  for (const row of results) {
    const file = toFile(row);
    try {
      await bridge.trashFile(file.driveId);
      await dropCachedFile(env, file.driveId);
    } catch (error) {
      console.error(`Gagal membuang berkas Drive ${file.driveId}: ${String(error)}`);
      continue;
    }
    await env.DB.prepare("DELETE FROM files WHERE id = ? AND status = 'pending_delete'")
      .bind(file.id)
      .run();
    purged++;
  }
  return purged;
}

/** Hapus berkas lengkap: tandai, buang di Drive, hapus baris. */
export async function deleteFiles(env: Env, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await env.DB.batch(markFilesPendingDelete(env, ids));
  await purgePendingFiles(env, ids.length);
}
