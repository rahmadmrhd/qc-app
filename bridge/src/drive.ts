import { BRIDGE_MAX_BODY_CHARS } from './auth';
import { bridgeDenied_, bridgeError_ } from './errors';
import type { BridgeFileMeta } from './platform';
import { bridgePlatform_ } from './platform';
import type { BridgePayload } from './validate';
import { optText_, reqBase64_, reqText_ } from './validate';

const DRIVE_ID_MAX = 200;
const DRIVE_NAME_MAX = 255;
const DRIVE_MIME_MAX = 100;

/** Folder yang boleh disentuh jembatan: Script Property `ALLOWED_FOLDER_IDS` (id dipisah koma). */
function allowedFolderIds_(): string[] {
  return (bridgePlatform_().getProperty('ALLOWED_FOLDER_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/** Folder harus terdaftar; selain itu ditolak dengan balasan keamanan yang sama. */
function assertAllowedFolder_(folderId: string): void {
  if (!allowedFolderIds_().includes(folderId)) throw bridgeDenied_();
}

/** Berkas harus ada dan anak dari `folderId` (folder terdaftar). Berkas tak ada -> NOT_FOUND. */
function metaInFolder_(fileId: string, folderId: string): BridgeFileMeta | null {
  assertAllowedFolder_(folderId);
  const meta = bridgePlatform_().driveFileMeta(fileId);
  if (meta === null) return null;
  if (!meta.parentIds.includes(folderId)) throw bridgeDenied_();
  return meta;
}

/** Berkas yang akan diubah/dibuang harus berada di salah satu folder terdaftar. Berkas tak ada -> null. */
function assertManagedFile_(fileId: string): BridgeFileMeta | null {
  const meta = bridgePlatform_().driveFileMeta(fileId);
  if (meta === null) return null;
  const allowed = allowedFolderIds_();
  if (!meta.parentIds.some((id) => allowed.includes(id))) throw bridgeDenied_();
  return meta;
}

function notFound_(): never {
  throw bridgeError_('NOT_FOUND', 'Berkas tidak ditemukan');
}

export function driveCreateFolder_(payload: BridgePayload): unknown {
  const name = reqText_(payload, 'name', DRIVE_NAME_MAX);
  return { id: bridgePlatform_().driveCreateFolder(name) };
}

export function driveCreateFile_(payload: BridgePayload): unknown {
  const folderId = reqText_(payload, 'folderId', DRIVE_ID_MAX);
  const name = reqText_(payload, 'name', DRIVE_NAME_MAX);
  const mime = reqText_(payload, 'mime', DRIVE_MIME_MAX);
  const base64 = reqBase64_(payload, 'base64', BRIDGE_MAX_BODY_CHARS);
  assertAllowedFolder_(folderId);
  return { id: bridgePlatform_().driveCreateFile(folderId, name, mime, base64) };
}

export function driveReadFile_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  const folderId = reqText_(payload, 'folderId', DRIVE_ID_MAX);
  if (metaInFolder_(fileId, folderId) === null) return null;
  return bridgePlatform_().driveReadBase64(fileId);
}

export function driveFileInfo_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  const folderId = reqText_(payload, 'folderId', DRIVE_ID_MAX);
  const meta = metaInFolder_(fileId, folderId);
  if (meta === null || meta.trashed) return null;
  return { mime: meta.mime, size: meta.size };
}

export function driveFolderExists_(payload: BridgePayload): unknown {
  const folderId = reqText_(payload, 'folderId', DRIVE_ID_MAX);
  assertAllowedFolder_(folderId);
  const meta = bridgePlatform_().driveFolderMeta(folderId);
  return { exists: meta !== null && !meta.trashed };
}

export function driveTrashFile_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  if (assertManagedFile_(fileId) === null) return null;
  bridgePlatform_().driveTrashFile(fileId);
  return null;
}

export function driveExternalFileInfo_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  const resourceKey = optText_(payload, 'resourceKey', DRIVE_ID_MAX);
  return bridgePlatform_().driveExternalFileInfo(fileId, resourceKey);
}

export function driveReadExternalFile_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  const resourceKey = optText_(payload, 'resourceKey', DRIVE_ID_MAX);
  return bridgePlatform_().driveReadExternalFile(fileId, resourceKey);
}

export function driveCopyFile_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  const folderId = reqText_(payload, 'folderId', DRIVE_ID_MAX);
  const name = reqText_(payload, 'name', DRIVE_NAME_MAX);
  const resourceKey = optText_(payload, 'resourceKey', DRIVE_ID_MAX);
  assertAllowedFolder_(folderId);
  return { id: bridgePlatform_().driveCopyFile(fileId, folderId, name, resourceKey) };
}

export function driveRenameFile_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  const name = reqText_(payload, 'name', DRIVE_NAME_MAX);
  if (assertManagedFile_(fileId) === null) notFound_();
  bridgePlatform_().driveRenameFile(fileId, name);
  return null;
}

export function driveShareAnyoneWithLink_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  if (assertManagedFile_(fileId) === null) notFound_();
  bridgePlatform_().driveShareAnyoneWithLink(fileId);
  return null;
}

export function driveRevokeSharing_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  // Sukses bila berkas tidak ada (sama dengan Platform GAS).
  if (assertManagedFile_(fileId) === null) return null;
  bridgePlatform_().driveRevokeSharing(fileId);
  return null;
}

export function driveReplaceFileContent_(payload: BridgePayload): unknown {
  const fileId = reqText_(payload, 'fileId', DRIVE_ID_MAX);
  const mime = reqText_(payload, 'mime', DRIVE_MIME_MAX);
  const base64 = reqBase64_(payload, 'base64', BRIDGE_MAX_BODY_CHARS);
  if (assertManagedFile_(fileId) === null) notFound_();
  bridgePlatform_().driveReplaceFileContent(fileId, mime, base64);
  return null;
}
