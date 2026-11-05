import type { QrFileDto } from '@shared/rpc';

/** Memicu unduhan berkas dari byte mentah (Blob + tautan sementara). */
export function saveFileDownload(file: QrFileDto): void {
  const blob = new Blob([file.bytes as BlobPart], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
