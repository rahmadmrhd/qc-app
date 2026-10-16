import type { QrFileDto } from '@shared/rpc';
import { base64ToBytes } from './export-files';

/** Memicu unduhan berkas dari base64 (Blob + tautan sementara). */
export function saveBase64File(file: QrFileDto): void {
  const blob = new Blob([base64ToBytes(file.base64)], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
