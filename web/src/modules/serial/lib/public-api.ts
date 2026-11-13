import type { SerialPublicReportDto } from '@shared/serial-public';

/** Awalan rute publik laporan rusak (sub-aplikasi `/api/public`, di luar `API_ROUTES`). */
export const PUBLIC_REPORT_BASE = '/api/public/serial-reports';

/** Galat memuat halaman publik; `status` 0 = jaringan atau jawaban tak terbaca. */
export class PublicReportError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Laporan publik gagal dimuat (${status})`);
    this.name = 'PublicReportError';
    this.status = status;
  }
  /** Token salah, kedaluwarsa, laporan tak ada, atau kena batas laju: satu pesan seragam di halaman. */
  get isInvalidLink(): boolean {
    return this.status === 404 || this.status === 429;
  }
}

/** URL gambar pesan lewat rute berkas bertoken (server memeriksa bahwa berkas milik pesan pada laporan itu). */
export function publicFileUrl(token: string, fileId: string): string {
  return `${PUBLIC_REPORT_BASE}/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}`;
}

/**
 * Memuat laporan lewat tautan bertanda tangan. `fetch` biasa (bukan `api()`): tanpa header kustom, tanpa pemicu
 * "belum login", tanpa cache, dan tanpa Referer (token ada di URL halaman). Cookie sesi (bila ada) ikut terkirim
 * agar server dapat menandai `viewerCanOpen`; token tidak pernah memberi izin.
 */
export async function fetchPublicReport(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SerialPublicReportDto> {
  let response: Response;
  try {
    response = await fetchImpl(`${PUBLIC_REPORT_BASE}/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new PublicReportError(0);
  }
  if (!response.ok) throw new PublicReportError(response.status);
  try {
    return (await response.json()) as SerialPublicReportDto;
  } catch {
    throw new PublicReportError(0);
  }
}
