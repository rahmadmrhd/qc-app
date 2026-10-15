import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { readObject_ } from '@gas/core/validate';
import { nowIso_ } from '@gas/modules/access/service';
import { insertFile_, listFiles_ } from '@gas/modules/files/repo';
import { base64ByteLength, isImageMime } from '@shared/files';
import { SYNC_ACTOR, SYNC_LIMITS } from '@shared/sync';

export interface SyncFileGetInput {
  driveId: string;
}

export interface DriveProbe {
  mime: string;
  size: number;
}

function syncFolderId_(): string {
  return platform_().getProperty('DRIVE_FOLDER_ID')?.trim() ?? '';
}

export function validateSyncFileGet_(raw: unknown): SyncFileGetInput {
  const reader = readObject_(raw);
  const driveId = reader.str('driveId', { required: true, max: 100 });
  reader.done();
  return { driveId };
}

export function getSyncFile_(input: SyncFileGetInput): {
  driveId: string;
  mime: string;
  base64: string;
} {
  const folderId = syncFolderId_();
  const info = folderId ? platform_().driveFileInfo(input.driveId, folderId) : null;
  if (!info) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  if (info.size > SYNC_LIMITS.fileBytes) {
    throw appError_('VALIDATION', 'Berkas melebihi 8 MB', { driveId: 'Berkas melebihi 8 MB' });
  }
  const content = platform_().driveReadFile(input.driveId, folderId);
  if (!content) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  if (base64ByteLength(content.base64) > SYNC_LIMITS.fileBytes) {
    throw appError_('VALIDATION', 'Berkas melebihi 8 MB', { driveId: 'Berkas melebihi 8 MB' });
  }
  return { driveId: input.driveId, mime: content.mime, base64: content.base64 };
}

/** TANPA lock (boleh I/O Drive): info Drive untuk id yang belum tercatat di sheet `files`; `null` = tak sah. */
export function probeDriveIds_(driveIds: readonly string[]): Map<string, DriveProbe | null> {
  const folderId = syncFolderId_();
  const known = new Set(listFiles_().map((file) => file.driveId));
  const probes = new Map<string, DriveProbe | null>();
  for (const driveId of new Set(driveIds)) {
    if (known.has(driveId)) continue;
    probes.set(driveId, folderId ? platform_().driveFileInfo(driveId, folderId) : null);
  }
  return probes;
}

/**
 * Memastikan tiap id Drive punya baris `files` (didaftarkan bila belum, tanpa pemilik). Id yang tak ada di folder
 * aplikasi, bukan gambar JPEG/PNG/WebP, atau > 8 MB dilaporkan di `missing`. PEMANGGIL WAJIB memegang lock.
 */
export function registerDriveFiles_(
  driveIds: readonly string[],
  probes: ReadonlyMap<string, DriveProbe | null>,
): { map: Map<string, string>; missing: string[] } {
  const byDrive = new Map(listFiles_().map((file) => [file.driveId, file.id]));
  const map = new Map<string, string>();
  const missing: string[] = [];
  for (const driveId of new Set(driveIds)) {
    const existing = byDrive.get(driveId);
    if (existing !== undefined) {
      map.set(driveId, existing);
      continue;
    }
    const probe = probes.get(driveId);
    if (!probe || !isImageMime(probe.mime) || probe.size > SYNC_LIMITS.fileBytes) {
      missing.push(driveId);
      continue;
    }
    const id = platform_().uuid();
    insertFile_({
      id,
      driveId,
      mime: probe.mime,
      size: probe.size,
      width: 0,
      height: 0,
      ownerType: '',
      ownerId: '',
      createdAt: nowIso_(),
      createdBy: SYNC_ACTOR,
    });
    map.set(driveId, id);
  }
  return { map, missing };
}
