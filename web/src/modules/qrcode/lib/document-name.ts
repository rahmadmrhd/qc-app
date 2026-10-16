/** Batas nama dokumen di server (`QR_LIMITS.documentName`). */
const DOCUMENT_NAME_MAX = 150;

/** Nama berkas PDF untuk dikirim: dirapikan, dipotong ke batas server, dan ekstensi .pdf dipertahankan. */
export function limitDocumentName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return 'dokumen.pdf';
  if (trimmed.length <= DOCUMENT_NAME_MAX) return trimmed;
  const extension = trimmed.toLowerCase().endsWith('.pdf') ? trimmed.slice(-4) : '';
  return trimmed.slice(0, DOCUMENT_NAME_MAX - extension.length) + extension;
}

/** PDF menurut tipe berkas, atau bernama .pdf bila peramban/OS tidak mengisi tipe (kosong). */
export function looksLikePdf(file: { type: string; name: string }): boolean {
  return (
    file.type === 'application/pdf' ||
    (file.type === '' && file.name.toLowerCase().endsWith('.pdf'))
  );
}
