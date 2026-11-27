import { createHash, timingSafeEqual } from 'node:crypto';
import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { problemResponse, toProblem } from '@server/http/problem';
import { limiterAddress } from '@server/http/proxy';
import { type AppBindings, newRequestId } from '@server/http/security';

/**
 * Penjaga token bersama rute baca publik desktop tanpa sesi (katalog Tipe, bundel Country Lock): header
 * `Authorization: Bearer <DESKTOP_CATALOG_TOKEN>` dibandingkan waktu-konstan, SEMUA penolakan = 404 problem+json yang sama
 * (termasuk rute dinonaktifkan karena token belum diisi), dan kegagalan dibatasi per IP lewat `rate_limits`. Token yang
 * sah tidak pernah diblokir pembatas (hanya jalur kegagalan) dan token tidak pernah dicatat.
 */
const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export function tokenMatches(expected: string, header: string | undefined): boolean {
  const match = /^Bearer (\S{1,512})$/.exec(header ?? '');
  const presented = match?.[1] ?? '';
  // Dibandingkan lewat sha256 agar panjang tetap sama; hasilnya tak bergantung pada awalan yang cocok.
  return timingSafeEqual(digest(expected), digest(presented)) && presented !== '';
}

/** Tambahan header untuk respons yang tak boleh disimpan atau membocorkan asal. */
export const noStore = (response: Response): Response => {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
};

export type TokenGuardContext = {
  env: AppBindings['Bindings'];
  req: { header(name: string): string | undefined };
};

export interface TokenGuard {
  /** `null` = diizinkan; selain itu respons penolakan (404 seragam, atau 429 untuk IP yang sudah melewati batas). */
  reject(c: TokenGuardContext): Promise<Response | null>;
  /** Respons 404 seragam rute ini (juga dipakai handler untuk "tidak ada"). */
  notFound(): Response;
}

/**
 * @param limiterPrefix awalan kunci `rate_limits` (`<awalan>:<alamat>`), terpisah per kelompok rute.
 * @param notFoundMessage pesan 404 seragam kelompok rute ini.
 */
export function createTokenGuard(limiterPrefix: string, notFoundMessage: string): TokenGuard {
  const notFound = (): Response =>
    noStore(problemResponse(toProblem(appError('NOT_FOUND', notFoundMessage), newRequestId())));
  const tooMany = (): Response =>
    noStore(
      problemResponse(
        toProblem(
          appError('FORBIDDEN', 'Terlalu banyak percobaan, coba lagi nanti'),
          newRequestId(),
          { status: 429 },
        ),
      ),
    );
  return {
    notFound,
    async reject(c) {
      const expected = c.env.DESKTOP_CATALOG_TOKEN ?? '';
      if (expected === '') return notFound();
      if (tokenMatches(expected, c.req.header('authorization'))) return null;
      const key = `${limiterPrefix}:${limiterAddress(c.env.clientIp ?? 'unknown')}`;
      const now = nowOf(c.env);
      const cutoff = now - FAIL_WINDOW_MS;
      const row = await c.env.DB.prepare(
        'SELECT count, window_start FROM rate_limits WHERE `key` = ?',
      )
        .bind(key)
        .first<{ count: number | string; window_start: number | string }>();
      if (row && Number(row.window_start) >= cutoff && Number(row.count) >= FAIL_LIMIT) {
        return tooMany();
      }
      try {
        await c.env.DB.prepare(
          'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = IF(window_start < ?, 1, count + 1), window_start = IF(window_start < ?, ?, window_start)',
        )
          .bind(key, now, cutoff, cutoff, now)
          .run();
      } catch {
        // pembatas best-effort
      }
      return notFound();
    },
  };
}
