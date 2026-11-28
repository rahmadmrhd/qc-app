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
 * sah tidak diblokir pembatas kegagalan; pembatas permintaan sah hanya ada bila diminta (`okLimit`) dan token tidak
 * pernah dicatat.
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

/** Batas permintaan SAH per alamat per jendela (opsional per kelompok rute; kunci `rate_limits` terpisah dari kegagalan). */
export interface OkLimit {
  limit: number;
  windowMs: number;
}

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
 * @param okLimit bila diberi, permintaan SAH juga dibatasi per alamat (kunci `<awalan>-ok:<alamat>`): melewatinya = 429
 *   + `Retry-After`. Pembatas ini dicatat dan dihitung terpisah dari pembatas kegagalan.
 */
export function createTokenGuard(
  limiterPrefix: string,
  notFoundMessage: string,
  okLimit?: OkLimit,
): TokenGuard {
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
  const overLimit = (retryAfterSeconds: number): Response => {
    const response = tooMany();
    response.headers.set('Retry-After', String(Math.max(1, retryAfterSeconds)));
    return response;
  };
  /** Menghitung satu permintaan sah; `null` = di bawah batas atau pembatas gagal (best-effort), selain itu respons 429. */
  async function countOk(c: TokenGuardContext, limit: OkLimit): Promise<Response | null> {
    const key = `${limiterPrefix}-ok:${limiterAddress(c.env.clientIp ?? 'unknown')}`;
    const now = nowOf(c.env);
    const cutoff = now - limit.windowMs;
    try {
      await c.env.DB.prepare(
        'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = IF(window_start < ?, 1, count + 1), window_start = IF(window_start < ?, ?, window_start)',
      )
        .bind(key, now, cutoff, cutoff, now)
        .run();
      const row = await c.env.DB.prepare(
        'SELECT count, window_start FROM rate_limits WHERE `key` = ?',
      )
        .bind(key)
        .first<{ count: number | string; window_start: number | string }>();
      if (row && Number(row.count) > limit.limit) {
        return overLimit(Math.ceil((Number(row.window_start) + limit.windowMs - now) / 1000));
      }
    } catch {
      // pembatas best-effort
    }
    return null;
  }
  return {
    notFound,
    async reject(c) {
      const expected = c.env.DESKTOP_CATALOG_TOKEN ?? '';
      if (expected === '') return notFound();
      if (tokenMatches(expected, c.req.header('authorization'))) {
        return okLimit === undefined ? null : countOk(c, okLimit);
      }
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
