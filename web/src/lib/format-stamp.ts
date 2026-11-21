/** Waktu server (ISO) dalam WIB, mis. "12 Nov 2026 14.05". Teks asli dikembalikan bila bukan tanggal sah ("—" bila kosong). */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  });
}
