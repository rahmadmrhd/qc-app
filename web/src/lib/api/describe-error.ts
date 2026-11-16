import { ApiError } from './api-error';

export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Terjadi kesalahan yang tidak terduga.';
  // Hanya nilai teks tak kosong dari `fields` berbentuk objek (`sync-sw.js` memakai aturan yang sama).
  const fieldValues: unknown[] =
    typeof error.fields === 'object' && error.fields !== null ? Object.values(error.fields) : [];
  const details = [
    ...new Set(
      fieldValues.filter(
        (text): text is string => typeof text === 'string' && text !== '' && text !== error.message,
      ),
    ),
  ];
  const base = details.length > 0 ? `${error.message}: ${details.join(', ')}` : error.message;
  if (error.code === 'UNAVAILABLE')
    return `${base.replace(/[.s]+$/, '')}. Coba lagi beberapa saat.`;
  return error.code === 'INTERNAL' && error.requestId !== '-'
    ? `${base} (kode: ${error.requestId})`
    : base;
}
