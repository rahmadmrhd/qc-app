import {
  claimBridgeSignature_,
  isBridgeBlocked_,
  recordBridgeFailure_,
  verifyBridgeRequest_,
} from './auth';
import {
  driveCopyFile_,
  driveCreateFile_,
  driveCreateFolder_,
  driveExternalFileInfo_,
  driveFileInfo_,
  driveFolderExists_,
  driveReadExternalFile_,
  driveReadFile_,
  driveRenameFile_,
  driveReplaceFileContent_,
  driveRevokeSharing_,
  driveShareAnyoneWithLink_,
  driveTrashFile_,
} from './drive';
import { isBridgeError_ } from './errors';
import { bridgePlatform_ } from './platform';
import { sheetsDump_, sheetsExport_ } from './sheets';
import type { BridgePayload } from './validate';
import { asBridgePayload_ } from './validate';

type BridgeActionHandler = (payload: BridgePayload) => unknown;

/** Allowlist aksi (Spek 8.1). Dibangun lazy karena urutan load file GAS tidak dijamin. */
export function bridgeActions_(): Record<string, BridgeActionHandler> {
  return {
    'drive.createFolder': driveCreateFolder_,
    'drive.createFile': driveCreateFile_,
    'drive.readFile': driveReadFile_,
    'drive.fileInfo': driveFileInfo_,
    'drive.folderExists': driveFolderExists_,
    'drive.trashFile': driveTrashFile_,
    'drive.externalFileInfo': driveExternalFileInfo_,
    'drive.readExternalFile': driveReadExternalFile_,
    'drive.copyFile': driveCopyFile_,
    'drive.renameFile': driveRenameFile_,
    'drive.shareAnyoneWithLink': driveShareAnyoneWithLink_,
    'drive.revokeSharing': driveRevokeSharing_,
    'drive.replaceFileContent': driveReplaceFileContent_,
    'sheets.dump': sheetsDump_,
    'sheets.export': sheetsExport_,
  };
}

/** Balasan penolakan keamanan: sama persis untuk semua penyebab. */
export function bridgeDeniedJson_(): string {
  return JSON.stringify({ ok: false, error: 'UNAUTHENTICATED' });
}

/**
 * Memproses satu permintaan jembatan (badan mentah) menjadi teks JSON balasan. Urutan: pemblokiran ->
 * ukuran/bentuk/jendela waktu/tanda tangan -> pemakaian ulang tanda tangan -> allowlist -> handler.
 * Hanya kegagalan autentikasi yang dihitung oleh pembatas.
 */
export function handleBridge_(rawBody: unknown): string {
  const platform = bridgePlatform_();
  if (isBridgeBlocked_()) return bridgeDeniedJson_();
  const secret = platform.getProperty('BRIDGE_SECRET')?.trim() ?? '';
  const verified = verifyBridgeRequest_(rawBody, secret, platform.now());
  if (!verified.ok || !claimBridgeSignature_(verified.envelope.sig)) {
    recordBridgeFailure_();
    return bridgeDeniedJson_();
  }
  const { action, payload } = verified.envelope;
  const actions = bridgeActions_();
  if (!Object.prototype.hasOwnProperty.call(actions, action)) return bridgeDeniedJson_();
  try {
    const handler = actions[action] as BridgeActionHandler;
    const data = handler(asBridgePayload_(payload));
    return JSON.stringify({ ok: true, data: data === undefined ? null : data });
  } catch (error) {
    if (isBridgeError_(error)) {
      if (error.bridgeCode === 'UNAUTHENTICATED') return bridgeDeniedJson_();
      return JSON.stringify({ ok: false, error: error.bridgeCode, message: error.message });
    }
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    platform.logError(`[bridge ${action}] ${detail}`);
    return JSON.stringify({
      ok: false,
      error: 'INTERNAL',
      message: 'Terjadi kesalahan pada jembatan',
    });
  }
}
