import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { UserContext } from '@gas/modules/access/context';
import { nowIso_ } from '@gas/modules/access/service';
import type { FileOwnerType } from '@shared/files';
import { base64ByteLength } from '@shared/files';
import type { FileContentDto, FileDto, GetFileInput, UploadFileInput } from '@shared/rpc';
import type { NewFileRecord } from './repo';
import { insertFile_, listFiles_, updateFile_ } from './repo';

const DRIVE_FOLDER_PROPERTY = 'DRIVE_FOLDER_ID';
export const DRIVE_FOLDER_NAME = 'QC App Files';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Tanpa lock: pemanggil wajib sudah memegang lock (hindari withLock bersarang). */
function driveFolderId_(): string {
  const platform = platform_();
  const existing = platform.getProperty(DRIVE_FOLDER_PROPERTY)?.trim();
  if (existing) return existing;
  const id = platform.driveCreateFolder(DRIVE_FOLDER_NAME);
  platform.setProperty(DRIVE_FOLDER_PROPERTY, id);
  return id;
}

/** Dipakai `setup`; idempoten dan aman terhadap pemanggilan bersamaan. */
export function ensureDriveFolder_(): string {
  return platform_().withLock(() => driveFolderId_());
}

function toFileDto_(file: NewFileRecord): FileDto {
  return { id: file.id, mime: file.mime, size: file.size, width: file.width, height: file.height };
}

export function uploadFile_(input: UploadFileInput, actor: UserContext): FileDto {
  const platform = platform_();
  const folderId = platform.getProperty(DRIVE_FOLDER_PROPERTY)?.trim() || ensureDriveFolder_();
  const id = platform.uuid();
  const name = `${id}.${EXTENSIONS[input.mime] ?? 'bin'}`;
  // I/O Drive (unggah ~1 MB) di luar lock agar tidak menahan penulisan lain; hanya sheet di dalam lock.
  const driveId = platform.driveCreateFile(folderId, name, input.mime, input.base64);
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
}

/** Hanya berkas yang tercatat di sheet `files` yang dapat dibaca; Drive id tidak pernah datang dari klien. */
export function readFile_(input: GetFileInput): FileContentDto {
  const record = listFiles_().find((file) => file.id === input.id);
  if (!record) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  const content = platform_().driveReadFile(record.driveId);
  if (!content) throw appError_('NOT_FOUND', 'Isi berkas tidak ditemukan di Drive');
  return { id: record.id, mime: record.mime, base64: content.base64 };
}

/**
 * Menetapkan pemilik berkas (dipakai simpan item pada Fase B). Pemanggil wajib memegang lock.
 * Berkas yang sudah dimiliki entitas lain ditolak; pemilik yang sama aman diulang.
 */
export function attachFiles_(
  ids: readonly string[],
  ownerType: FileOwnerType,
  ownerId: string,
): void {
  if (ids.length === 0) return;
  const files = listFiles_();
  for (const id of ids) {
    const file = files.find((item) => item.id === id);
    if (!file) throw appError_('VALIDATION', 'Ada berkas yang tidak dikenal');
    if (file.ownerType === '') {
      updateFile_({ ...file, ownerType, ownerId });
    } else if (file.ownerType !== ownerType || file.ownerId !== ownerId) {
      throw appError_('CONFLICT', 'Berkas sudah dipakai di tempat lain');
    }
  }
}
