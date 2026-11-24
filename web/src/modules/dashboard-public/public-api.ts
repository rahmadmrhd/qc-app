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

/** Filter penonton kosong = tampilan bawaan pembagi (GET); selain itu POST `query` (lihat `fetchPublicDashboard`). */
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
 */
export async function fetchPublicDashboard(
  token: string,
  viewer: PublicQueryInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicDashboardDto> {
  const base = `${PUBLIC_DASHBOARD_BASE}/${encodeURIComponent(token)}`;
  let response: Response;
  try {
    response = isEmptyViewer(viewer)
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

/**
 * Mencatat kunjungan: `POST .../visit` SEKALI per pembukaan halaman (dipanggil `public-page.tsx`; spek dashboard 7.6).
 * Fire-and-forget: tanpa badan, header CSRF yang sama dengan `POST query`, tanpa Referer, tanpa retry, dan semua galat
 * (jaringan, 404, 429, 5xx) ditelan karena kunjungan hanya statistik dan tak boleh mengganggu halaman.
 */
export async function recordPublicVisit(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`${PUBLIC_DASHBOARD_BASE}/${encodeURIComponent(token)}/visit`, {
      method: 'POST',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { ...CSRF_HEADERS },
    });
  } catch {
    // statistik saja
  }
}
