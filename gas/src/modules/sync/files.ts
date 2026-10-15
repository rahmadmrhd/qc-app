import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { readObject_ } from '@gas/core/validate';
import { nowIso_ } from '@gas/modules/access/service';
import type { NewFileRecord } from '@gas/modules/files/repo';
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
 * Rencana pendaftaran (TANPA menulis): tiap id Drive dipetakan ke baris `files` yang boleh dipakai pemilik
 * `ownerId` — baris tanpa pemilik atau milik `ownerId` dipakai ulang; bila berkas Drive itu sudah dimiliki
 * entitas lain, disiapkan baris BARU untuk berkas Drive yang sama (satu foto boleh dipakai banyak item).
 * Id yang tak ada di folder aplikasi, bukan gambar JPEG/PNG/WebP, atau > 8 MB dilaporkan di `missing`.
 * `pending` hanya ditulis lewat `commitDriveFiles_` setelah semua pemeriksaan entri lolos.
 */
export function planDriveFiles_(
  driveIds: readonly string[],
  probes: ReadonlyMap<string, DriveProbe | null>,
  ownerId: string,
): { map: Map<string, string>; missing: string[]; pending: NewFileRecord[] } {
  const rows = listFiles_();
  const map = new Map<string, string>();
  const missing: string[] = [];
  const pending: NewFileRecord[] = [];
  for (const driveId of new Set(driveIds)) {
    const usable = rows.find(
      (file) => file.driveId === driveId && (file.ownerType === '' || file.ownerId === ownerId),
    );
    if (usable) {
      map.set(driveId, usable.id);
      continue;
    }
    const sibling = rows.find((file) => file.driveId === driveId);
    const info: DriveProbe | null = sibling
      ? { mime: sibling.mime, size: sibling.size }
      : (probes.get(driveId) ?? null);
    if (!info || !isImageMime(info.mime) || info.size > SYNC_LIMITS.fileBytes) {
      missing.push(driveId);
      continue;
    }
    const id = platform_().uuid();
    pending.push({
      id,
      driveId,
      mime: info.mime,
      size: info.size,
      width: sibling?.width ?? 0,
      height: sibling?.height ?? 0,
      ownerType: '',
      ownerId: '',
      createdAt: nowIso_(),
      createdBy: SYNC_ACTOR,
    });
    map.set(driveId, id);
  }
  return { map, missing, pending };
}

/** Menulis baris yang direncanakan `planDriveFiles_`. PEMANGGIL WAJIB memegang lock. */
export function commitDriveFiles_(pending: readonly NewFileRecord[]): void {
  for (const record of pending) insertFile_(record);
}

/** Rencana + tulis sekaligus (tanpa pemeriksaan tambahan di antaranya). PEMANGGIL WAJIB memegang lock. */
export function registerDriveFiles_(
  driveIds: readonly string[],
  probes: ReadonlyMap<string, DriveProbe | null>,
  ownerId: string,
): { map: Map<string, string>; missing: string[] } {
  const { map, missing, pending } = planDriveFiles_(driveIds, probes, ownerId);
  commitDriveFiles_(pending);
  return { map, missing };
}
