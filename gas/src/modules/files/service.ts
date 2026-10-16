import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { nowIso_ } from '@gas/modules/access/service';
import type { FileOwnerType } from '@shared/files';
import { base64ByteLength, MAX_UNATTACHED_UPLOADS } from '@shared/files';
import type { FileContentDto, FileDto, GetFileInput, UploadFileInput } from '@shared/rpc';
import type { FileRecord, NewFileRecord } from './repo';
import { insertFile_, listFiles_, updateFile_ } from './repo';

const DRIVE_FOLDER_PROPERTY = 'DRIVE_FOLDER_ID';
export const DRIVE_FOLDER_NAME = 'QC App Files';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Dipakai `setup`; idempoten. Membuat folder **hanya bila `DRIVE_FOLDER_ID` kosong**. Bila terisi tetapi
 * foldernya tak dapat diakses (dihapus, tempat sampah, atau akun pemilik tak punya akses), melempar galat dan
 * TIDAK menimpa properti: menimpa akan memutus semua gambar yang sudah tercatat (FS13).
 */
export function ensureNamedFolder_(property: string, name: string): string {
  return platform_().withLock(() => {
    const platform = platform_();
    const existing = platform.getProperty(property)?.trim();
    if (existing) {
      if (platform.driveFolderExists(existing)) return existing;
      throw appError_(
        'INTERNAL',
        `Folder Drive ${existing} tidak dapat diakses (dihapus, ada di tempat sampah, atau akun pemilik script belum punya akses Editor).`,
      );
    }
    const id = platform.driveCreateFolder(name);
    platform.setProperty(property, id);
    return id;
  });
}

/** Folder gambar item; perilaku FS13 (tidak menimpa properti terisi) ada di `ensureNamedFolder_`. */
export function ensureDriveFolder_(): string {
  return ensureNamedFolder_(DRIVE_FOLDER_PROPERTY, DRIVE_FOLDER_NAME);
}

function toFileDto_(file: NewFileRecord): FileDto {
  return { id: file.id, mime: file.mime, size: file.size, width: file.width, height: file.height };
}

export function uploadFile_(input: UploadFileInput, actor: UserContext): FileDto {
  const platform = platform_();
  // Batas berkas yatim per user: yang belum ditautkan ke entitas tidak boleh menumpuk tanpa batas.
  const pending = listFiles_().filter(
    (file) => file.createdBy === actor.email && file.ownerType === '',
  ).length;
  if (pending >= MAX_UNATTACHED_UPLOADS) {
    throw appError_(
      'CONFLICT',
      'Terlalu banyak gambar yang belum dipakai. Simpan item yang sedang diedit terlebih dulu.',
    );
  }
  const folderId = platform.getProperty(DRIVE_FOLDER_PROPERTY)?.trim() || ensureDriveFolder_();
  const id = platform.uuid();
  const name = `${id}.${EXTENSIONS[input.mime] ?? 'bin'}`;
  // I/O Drive (unggah ~1 MB) di luar lock agar tidak menahan penulisan lain; hanya sheet di dalam lock.
  const driveId = platform.driveCreateFile(folderId, name, input.mime, input.base64);
  try {
    return platform.withLock(() => {
      const record: NewFileRecord = {
        id,
        driveId,
        mime: input.mime,
        size: base64ByteLength(input.base64),
        width: input.width,
        height: input.height,
        ownerType: '',
        ownerId: '',
        createdAt: nowIso_(),
        createdBy: actor.email,
      };
      insertFile_(record);
      return toFileDto_(record);
    });
  } catch (error) {
    // Pencatatan gagal: jangan tinggalkan berkas yatim di Drive.
    platform.driveTrashFile(driveId);
    throw error;
  }
}

/** Hanya berkas yang tercatat di sheet `files` yang dapat dibaca; Drive id tidak pernah datang dari klien. */
export function readFile_(input: GetFileInput): FileContentDto {
  const record = listFiles_().find((file) => file.id === input.id);
  if (!record) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  // Hanya berkas di dalam folder aplikasi yang boleh dibaca (pertahanan berlapis bila sheet files diedit manual).
  const folderId = platform_().getProperty(DRIVE_FOLDER_PROPERTY)?.trim() ?? '';
  const content = folderId ? platform_().driveReadFile(record.driveId, folderId) : null;
  if (!content) throw appError_('NOT_FOUND', 'Isi berkas tidak ditemukan di Drive');
  return { id: record.id, mime: record.mime, base64: content.base64 };
}

/**
 * Menetapkan pemilik berkas (dipakai simpan item pada Fase B). Pemanggil wajib memegang lock.
 * Berkas yang sudah dimiliki entitas lain ditolak; pemilik yang sama aman diulang. Atomik: seluruh batch divalidasi dulu.
 */
export function attachFiles_(
  ids: readonly string[],
  ownerType: FileOwnerType,
  ownerId: string,
): void {
  if (ids.length === 0) return;
  const files = listFiles_();
  // Tahap 1: validasi seluruh batch sebelum menulis apa pun (tanpa setengah jalan bila ada yang gagal).
  const toClaim: FileRecord[] = [];
  for (const id of new Set(ids)) {
    const file = files.find((item) => item.id === id);
    if (!file) throw appError_('VALIDATION', 'Ada berkas yang tidak dikenal');
    if (file.ownerType === '') toClaim.push(file);
    else if (file.ownerType !== ownerType || file.ownerId !== ownerId) {
      throw appError_('CONFLICT', 'Berkas sudah dipakai di tempat lain');
    }
  }
  // Tahap 2: tetapkan pemilik.
  for (const file of toClaim) updateFile_({ ...file, ownerType, ownerId });
}
