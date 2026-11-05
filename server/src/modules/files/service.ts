import { getBridge, viaBridge } from '@server/core/bridge-client';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { cachedFileContent, dropCachedFile } from '@server/core/file-cache';
import { getSetting, SETTING_DRIVE_FOLDER_ID, setSettingIfAbsent } from '@server/core/settings';
import type { UserContext } from '@server/modules/access/context';
import type { FileOwnerType } from '@shared/files';
import { base64ByteLength, MAX_UNATTACHED_UPLOADS } from '@shared/files';
import type { FileContentDto, FileDto, GetFileInput, UploadFileInput } from '@shared/rpc';
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

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
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
  const existing = await getSetting(env, settingKey);
  const bridge = getBridge(env);
  if (existing) {
    if (await viaBridge(() => bridge.folderExists(existing))) return existing;
    throw appError(
      'INTERNAL',
      `Folder Drive ${existing} tidak dapat diakses (dihapus, ada di tempat sampah, atau akun pemilik script belum punya akses Editor).`,
    );
  }
  const id = await viaBridge(() => bridge.createFolder(name));
  // Permintaan serentak: yang pertama menyimpan menang; folder kedua menjadi yatim kosong (tak berbahaya).
  return setSettingIfAbsent(env, settingKey, id);
}

/** Folder gambar item; perilaku FS13 ada di `ensureNamedFolder`. */
export function ensureDriveFolder(env: Env): Promise<string> {
  return ensureNamedFolder(env, SETTING_DRIVE_FOLDER_ID, DRIVE_FOLDER_NAME);
}

function toFileDto(file: FileRecord): FileDto {
  return { id: file.id, mime: file.mime, size: file.size, width: file.width, height: file.height };
}

/**
 * Unggah gambar. Urutan (Spek 8.2): Drive DULU lewat jembatan, lalu baris D1. Bila D1 gagal setelah Drive
 * sukses, berkas Drive dibuang (best effort; yang tersisa dibersihkan cron) dan pengguna melihat galat jelas.
 * Bila jembatan gagal, tidak ada baris D1 sama sekali. Aman diulang.
 */
export async function uploadFile(
  env: Env,
  input: UploadFileInput,
  actor: UserContext,
): Promise<FileDto> {
  // Batas berkas yatim per user: yang belum ditautkan ke entitas tidak boleh menumpuk tanpa batas.
  if ((await countUnattached(env, actor.email)) >= MAX_UNATTACHED_UPLOADS) {
    throw appError(
      'CONFLICT',
      'Terlalu banyak gambar yang belum dipakai. Simpan item yang sedang diedit terlebih dulu.',
    );
  }
  const folderId =
    (await getSetting(env, SETTING_DRIVE_FOLDER_ID)) || (await ensureDriveFolder(env));
  const id = crypto.randomUUID();
  const name = `${id}.${EXTENSIONS[input.mime] ?? 'bin'}`;
  const bridge = getBridge(env);
  const driveId = await viaBridge(() =>
    bridge.createFile(folderId, name, input.mime, input.base64),
  );
  const record: FileRecord = {
    id,
    driveId,
    mime: input.mime,
    size: base64ByteLength(input.base64),
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
 * Membaca berkas: hanya berkas aktif yang tercatat di tabel `files` yang dapat dibaca (id Drive tidak
 * pernah datang dari klien), dan hanya yang induknya folder aplikasi. Isi diteruskan sebagai base64 apa
 * adanya, tanpa decode di Worker. `onlyLogosFor` (email pemanggil) untuk pengguna tanpa izin `item`:
 * hanya logo bersama (`qrlogo`) dan unggahan miliknya yang belum terpasang.
 */
export async function readFile(
  env: Env,
  input: GetFileInput,
  onlyLogosFor?: string,
): Promise<FileContentDto> {
  const record = await findActiveFile(env, input.id);
  if (!record) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  if (onlyLogosFor !== undefined) {
    const isLogo = record.ownerType === 'qrlogo';
    const isOwnPending = record.ownerType === '' && record.createdBy === onlyLogosFor;
    if (!isLogo && !isOwnPending) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  }
  const folderId = await getSetting(env, SETTING_DRIVE_FOLDER_ID);
  if (folderId === '') throw appError('NOT_FOUND', 'Isi berkas tidak ditemukan di Drive');
  // Cache (R2 / Cache API) terikat folder aktif; dibaca SETELAH aturan akses di atas.
  const bridge = getBridge(env);
  const content = await cachedFileContent(env, folderId, record.driveId, async () => {
    const read = await viaBridge(() => bridge.readFile(record.driveId, folderId));
    return read ? { mime: record.mime, base64: read.base64 } : null;
  });
  if (!content) throw appError('NOT_FOUND', 'Isi berkas tidak ditemukan di Drive');
  return { id: record.id, mime: record.mime, base64: content.base64 };
}

/**
 * Rencana penetapan pemilik berkas (dipakai simpan item/logo): memvalidasi seluruh batch dulu, lalu
 * mengembalikan pernyataan UPDATE untuk digabung ke `batch()` penyimpanan entitas (atomik). Berkas yang
 * sudah dimiliki entitas lain ditolak; pemilik yang sama aman diulang. Pernyataan memakai penjaga
 * `owner_type = ''` sehingga rebutan berkas yang sama tidak menimpa pemilik.
 */
export async function planAttachFiles(
  env: Env,
  ids: readonly string[],
  ownerType: FileOwnerType,
  ownerId: string,
  /** Hasil `findActiveFiles` untuk `ids` yang sudah dimuat pemanggil (hindari kueri ganda). */
  preloaded?: readonly FileRecord[],
): Promise<D1PreparedStatement[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const files = preloaded ?? (await findActiveFiles(env, unique));
  const byId = new Map(files.map((file) => [file.id, file] as const));
  const toClaim: FileRecord[] = [];
  for (const id of unique) {
    const file = byId.get(id);
    if (!file) throw appError('VALIDATION', 'Ada berkas yang tidak dikenal');
    if (file.ownerType === '') toClaim.push(file);
    else if (file.ownerType !== ownerType || file.ownerId !== ownerId) {
      throw appError('CONFLICT', 'Berkas sudah dipakai di tempat lain');
    }
  }
  return toClaim.map((file) =>
    env.DB.prepare(
      "UPDATE files SET owner_type = ?, owner_id = ? WHERE id = ? AND status = 'active' AND owner_type = ''",
    ).bind(ownerType, ownerId, file.id),
  );
}

export async function attachFiles(
  env: Env,
  ids: readonly string[],
  ownerType: FileOwnerType,
  ownerId: string,
): Promise<void> {
  const statements = await planAttachFiles(env, ids, ownerType, ownerId);
  if (statements.length > 0) await env.DB.batch(statements);
}

/** Langkah 1 penghapusan (Spek 8.2): tandai `pending_delete` di D1; berkas langsung tak terbaca. */
export function markFilesPendingDelete(env: Env, ids: readonly string[]): D1PreparedStatement[] {
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
  const bridge = getBridge(env);
  let purged = 0;
  for (const row of rows.results) {
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
