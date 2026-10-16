import { ensureNamedFolder_ } from '@gas/modules/files/service';

export const QR_FOLDER_PROPERTY = 'QR_FOLDER_ID';
export const QR_FOLDER_NAME = 'QC App QR';
export const QR_DOC_FOLDER_PROPERTY = 'QR_DOC_FOLDER_ID';
export const QR_DOC_FOLDER_NAME = 'QC App QR Dokumen';

/** Folder hasil ekspor (PDF lembar + PNG). Pemanggil TIDAK boleh memegang lock (fungsi ini mengunci sendiri). */
export function ensureQrFolder_(): string {
  return ensureNamedFolder_(QR_FOLDER_PROPERTY, QR_FOLDER_NAME);
}

/** Folder PDF sumber yang dibagikan lewat link. Pemanggil TIDAK boleh memegang lock. */
export function ensureQrDocFolder_(): string {
  return ensureNamedFolder_(QR_DOC_FOLDER_PROPERTY, QR_DOC_FOLDER_NAME);
}
