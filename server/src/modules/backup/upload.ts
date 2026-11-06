import type { DriveFolderEntry } from '@server/core/bridge-client';
import { getBridge, viaBridge } from '@server/core/bridge-client';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import { folderIdOf } from '@server/core/settings';
import { ensureNamedFolder } from '@server/modules/files/service';
import { parseBackupName } from './names';

/** Kunci tabel `settings` (dan nama folder otomatis) untuk folder cadangan di bawah folder induk. */
export const BACKUP_FOLDER_SETTING = 'BACKUP_FOLDER_ID';
export const BACKUP_FOLDER_NAME = 'QC App Cadangan';
export const BACKUP_MIME = 'application/gzip';
/** Halaman `listFolder` (Drive membatasi 1000). */
const LIST_PAGE_SIZE = 200;

/** Folder cadangan: id dari `.env` (hanya diverifikasi) atau subfolder yang dibuat di bawah folder induk. */
export function ensureBackupFolder(env: Env): Promise<string> {
  return ensureNamedFolder(env, BACKUP_FOLDER_SETTING, BACKUP_FOLDER_NAME);
}

/** Id folder cadangan bila sudah ada ('' bila belum dikonfigurasi/dibuat); tidak membuat folder. */
export function backupFolderIdOf(env: Env): Promise<string> {
  return folderIdOf(env, BACKUP_FOLDER_SETTING);
}

/** Semua berkas folder (semua halaman). */
export async function listAllEntries(env: Env, folderId: string): Promise<DriveFolderEntry[]> {
  const bridge = getBridge(env);
  const all: DriveFolderEntry[] = [];
  let pageToken: string | undefined;
  do {
    const page = await viaBridge(() =>
      bridge.listFolder(folderId, {
        pageSize: LIST_PAGE_SIZE,
        ...(pageToken === undefined ? {} : { pageToken }),
      }),
    );
    all.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);
  return all;
}

/** Berkas cadangan bernama dikenal, urut dari yang terbaru (menurut waktu di nama). */
export function recognizedBackups(entries: DriveFolderEntry[]): DriveFolderEntry[] {
  return entries
    .flatMap((entry) => {
      const parsed = parseBackupName(entry.name);
      return parsed === null ? [] : [{ entry, key: parsed.key }];
    })
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    .map(({ entry }) => entry);
}

export interface UploadSource {
  name: string;
  /** Jalur berkas lokal yang diunggah (dibaca streaming lewat `Bun.file`). */
  path: string;
  md5: string;
  sha256: string;
  size: number;
}

/** Pencatat berkas Drive cacat: ditandai sebelum dibuang agar yang gagal dibuang dicoba lagi saat job gagal (`onFail`). */
export interface BadFileTracker {
  mark(driveId: string): Promise<void>;
  clear(): void;
}

/**
 * Unggah satu berkas cadangan ke Drive secara idempoten dan memverifikasi integritasnya:
 * - berkas bernama sama yang MD5 dan ukurannya cocok dipakai ulang (pengulangan setelah gagal di tengah);
 * - berkas bernama sama yang tidak cocok (sisa unggahan gagal) dibuang permanen sebelum mengunggah;
 * - setelah unggah, `md5Checksum` dan ukuran dari Drive HARUS sama dengan hitungan lokal; beda = berkas Drive dibuang
 *   dan galat dilempar (job gagal). SHA-256 disimpan di `appProperties` untuk verifikasi saat pemulihan.
 */
export async function uploadVerified(
  env: Env,
  folderId: string,
  source: UploadSource,
  tracker: BadFileTracker,
): Promise<string> {
  const bridge = getBridge(env);
  const existing = (await listAllEntries(env, folderId)).filter(
    (entry) => entry.name === source.name,
  );
  const reusable = existing.find(
    (entry) => entry.md5Checksum === source.md5 && entry.size === source.size,
  );
  for (const entry of existing) {
    if (entry !== reusable) await viaBridge(() => bridge.deleteFile(entry.id));
  }
  if (reusable) return reusable.id;

  const result = await viaBridge(() =>
    bridge.uploadFile(folderId, source.name, BACKUP_MIME, Bun.file(source.path), {
      appProperties: { sha256: source.sha256, app: 'qc' },
    }),
  );
  if (result.md5Checksum !== source.md5 || result.size !== source.size) {
    await tracker.mark(result.id);
    try {
      await viaBridge(() => bridge.deleteFile(result.id));
      tracker.clear();
    } catch (error) {
      console.error(
        `cadangan: berkas Drive cacat ${result.id} belum dapat dibuang: ${String(error)}`,
      );
    }
    throw appError(
      'INTERNAL',
      'Checksum cadangan di Drive tidak sama dengan berkas lokal; unggahan dianggap gagal',
    );
  }
  return result.id;
}
