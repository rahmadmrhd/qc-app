import { appError } from '@server/core/errors';
import type { RouteTable } from '@server/core/router';
import { MIN_CLIENT } from '@shared/api-versions';
import type { DesktopReleasesDto } from '@shared/contract';
import { issueHandoffTicket } from './handoff';
import { releaseReaderOf } from './release-reader';
import { filterSupported, toReleaseDto } from './releases-dto';

type DesktopMethod = 'desktop.handoff' | 'desktop.releases';

/** Daftar unduhan memuat paling banyak ini (retensi installer di Drive hanya 10 versi, jauh di bawahnya). */
const RELEASES_LIMIT = 50;

function validateNoInput(raw: unknown): Record<string, never> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) return {};
  throw appError('VALIDATION', 'Method ini tidak menerima input');
}

/**
 * Tiket serah-terima ke aplikasi desktop: butuh sesi web dan izin global `countrylock: view` (diperiksa kernel REST).
 * Penukaran tiketnya di `POST /auth/desktop/handoff` (tanpa sesi; `modules/auth/routes.ts`).
 *
 * `desktop.releases`: daftar versi aplikasi desktop yang terlihat dan masih didukung (`>= MIN_CLIENT.desktop`) untuk
 * halaman unduh. Tanpa izin modul (cukup sesi aktif, seperti lonceng dan panduan); `url` berkas mengarah ke rute publik
 * `/api/desktop/app-file`, jadi halaman ini pintu masuk yang mudah ditemukan, bukan kontrol akses. Galat Drive tidak
 * dibocorkan: folder tak terbaca = daftar kosong.
 */
export function desktopApiRoutes(): Pick<RouteTable, DesktopMethod> {
  return {
    'desktop.handoff': {
      permission: { module: 'countrylock', level: 'view' },
      validate: validateNoInput,
      handler: async (_input, ctx) => ({
        ticket: await issueHandoffTicket(ctx.env, ctx.user.email),
        email: ctx.user.email,
      }),
    },
    'desktop.releases': {
      validate: () => null,
      handler: async (_input, ctx): Promise<DesktopReleasesDto> => {
        const reader = releaseReaderOf(ctx.env);
        if (!reader) return { enabled: false, releases: [] };
        try {
          const supported = filterSupported(await reader.list(), MIN_CLIENT.desktop);
          return { enabled: true, releases: supported.slice(0, RELEASES_LIMIT).map(toReleaseDto) };
        } catch {
          console.warn('Daftar unduhan desktop: folder rilis tak terbaca');
          return { enabled: true, releases: [] };
        }
      },
    },
  };
}
