import type { PublicDashboardDto, PublicQueryInput } from '@shared/dashboard-public';
import { CSRF_HEADERS } from '@/lib/api/client';

/** Awalan rute publik dashboard (sub-aplikasi `/api/public`, di luar `API_ROUTES`). */
export const PUBLIC_DASHBOARD_BASE = '/api/public/dashboards';

/** Galat memuat dashboard publik; `status` 0 = jaringan atau jawaban tak terbaca. */
export class PublicDashboardError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Dashboard publik gagal dimuat (${status})`);
    this.name = 'PublicDashboardError';
    this.status = status;
  }
  /** Token salah, kedaluwarsa, dicabut, atau kena batas laju: satu pesan seragam, tanpa membuka sebabnya. */
  get isInvalidLink(): boolean {
    return this.status === 404 || this.status === 429;
  }
  /** Filter penonton ditolak server (nilai di luar pilihan atau rentang rusak). */
  get isBadFilter(): boolean {
    return this.status === 400 || this.status === 413;
  }
}

/** Filter penonton kosong = tampilan bawaan pembagi; dimuat lewat GET hanya pada muat awal (lihat `fetchPublicDashboard`). */
export function isEmptyViewer(viewer: PublicQueryInput): boolean {
  const hasList = (value: string[] | undefined) => value !== undefined && value.length > 0;
  return (
    !hasList(viewer.buIds) &&
    !hasList(viewer.locationIds) &&
    viewer.from === undefined &&
    viewer.to === undefined &&
    (viewer.groups === undefined || Object.keys(viewer.groups).length === 0)
  );
}

/**
 * Memuat dashboard lewat tautan bertanda tangan. `fetch` biasa (bukan `api()`): tanpa pemicu "belum login", tanpa
 * cache, dan tanpa Referer (token ada di URL halaman). Satu-satunya `POST` memakai header CSRF yang sama dengan klien
 * REST (`X-Requested-With`, dipaksa `csrfGuard` global untuk semua `POST /api/*`). Tidak pernah menyentuh `/api/v1`.
 *
 * Server menghitung kunjungan HANYA dari `GET` halaman (spek dashboard 7.6). Karena itu `GET` dipakai khusus untuk muat
 * awal tanpa filter; penyegaran otomatis (interval, fokus tab, Coba lagi: `refresh` true) selalu lewat `POST query`
 * dengan badan filter yang sama (kosong = `{}`), jadi tab yang dibiarkan terbuka tidak menambah kunjungan.
 */
export async function fetchPublicDashboard(
  token: string,
  viewer: PublicQueryInput,
  fetchImpl: typeof fetch = fetch,
  refresh = false,
): Promise<PublicDashboardDto> {
  const base = `${PUBLIC_DASHBOARD_BASE}/${encodeURIComponent(token)}`;
  let response: Response;
  try {
    response =
      isEmptyViewer(viewer) && !refresh
        ? await fetchImpl(base, {
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            headers: { Accept: 'application/json' },
          })
        : await fetchImpl(`${base}/query`, {
            method: 'POST',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...CSRF_HEADERS,
            },
            body: JSON.stringify(viewer),
          });
  } catch {
    throw new PublicDashboardError(0);
  }
  if (!response.ok) throw new PublicDashboardError(response.status);
  try {
    return (await response.json()) as PublicDashboardDto;
  } catch {
    throw new PublicDashboardError(0);
  }
}
