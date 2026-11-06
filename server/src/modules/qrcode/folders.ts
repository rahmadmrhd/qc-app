import type { Env } from '@server/core/env';
import { ensureNamedFolder } from '@server/modules/files/service';

/** Kunci tabel `settings`. */
export const QR_FOLDER_SETTING = 'QR_FOLDER_ID';
export const QR_FOLDER_NAME = 'QC App QR';
export const QR_DOC_FOLDER_SETTING = 'QR_DOC_FOLDER_ID';
export const QR_DOC_FOLDER_NAME = 'QC App QR Dokumen';

/** Folder hasil ekspor (PDF lembar + PNG). */
export function ensureQrFolder(env: Env): Promise<string> {
  return ensureNamedFolder(env, QR_FOLDER_SETTING, QR_FOLDER_NAME);
}

/** Folder PDF sumber yang dibagikan lewat link. */
export function ensureQrDocFolder(env: Env): Promise<string> {
  return ensureNamedFolder(env, QR_DOC_FOLDER_SETTING, QR_DOC_FOLDER_NAME);
}
