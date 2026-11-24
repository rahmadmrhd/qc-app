import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { SessionPayload } from '@server/core/session';
import { SESSION_COOKIE, verifySessionToken } from '@server/core/session';
import { problemResponse, toProblem } from '@server/http/problem';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';

/** Data per permintaan yang ditambahkan `createServer` di atas `Env` (tidak ada di tes yang memanggil `app` langsung). */
export interface RequestBindings {
  /** IP klien hasil `clientIp` (peer, atau `CF-Connecting-IP` bila peer proxy tepercaya). */
  clientIp?: string;
  /**
   * True bila peer TCP ada di dalam daftar proxy tepercaya (`TRUSTED_PROXY`): hanya dari peer itu header yang
   * dipasang proxy (`CF-IPCountry`) boleh dipercaya, sama seperti `CF-Connecting-IP` pada `clientIp`.
   */
  trustedPeer?: boolean;
  /** Alamat TCP peer (bukan header). Rute khusus mesin lokal (dev-login) mensyaratkan peer loopback. */
  peerAddress?: string;
  /** Direktori berkas statis web; tanpa nilai = tidak ada berkas statis (mis. tes API). */
  staticDir?: string;
}

export interface AppBindings {
  Bindings: Env & RequestBindings;
  Variables: { session: SessionPayload };
}

export { SESSION_COOKIE };
export const OAUTH_COOKIE = 'qc_oauth';
/** Cookie awal login desktop (`/auth/desktop/start`): mengikat `challenge` PKCE dan `state` aplikasi. */
export const DESKTOP_COOKIE = 'qc_desktop';
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'qc';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/** Jalur REST (`/api/v<n>` dan turunannya, mis. `/api/v1`, `/api/v2`): galatnya problem+json, bukan amplop JSON lama. */
export function isRestPath(path: string): boolean {
  return /^\/api\/v\d+(\/|$)/.test(path);
}

/** Amplop galat jalur non-REST (`{ ok:false, error }`), mis. `/auth/*`. */
export function errorEnvelope(code: string, message: string) {
  return { ok: false, error: { code, message, requestId: newRequestId() } };
}

export const securityHeaders = secureHeaders();

/**
 * Mitigasi CSRF: setiap `POST`/`PUT`/`PATCH`/`DELETE` wajib membawa `X-Requested-With: qc`.
 * Header kustom tidak dapat dikirim lintas-origin dari form/navigasi tanpa preflight CORS (yang tidak diizinkan).
 */
export const csrfGuard = createMiddleware<AppBindings>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method) && c.req.header(CSRF_HEADER) !== CSRF_VALUE) {
    if (isRestPath(c.req.path)) {
      const message = 'Permintaan ditolak (header CSRF tidak ada)';
      return problemResponse(toProblem(appError('FORBIDDEN', message), newRequestId()));
    }
    return c.json(errorEnvelope('FORBIDDEN', 'Permintaan ditolak (header CSRF tidak ada)'), 403);
  }
  await next();
});

/** Mewajibkan cookie sesi yang sah; menaruh payload di `c.var.session`. */
export const requireSession = createMiddleware<AppBindings>(async (c, next) => {
  const session = await verifySessionToken(c.env, getCookie(c, SESSION_COOKIE), nowOf(c.env));
  if (!session) {
    return c.json(errorEnvelope('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir'), 401);
  }
  c.set('session', session);
  await next();
});

/** Host pengembangan lokal; tidak pernah melayani produksi. */
export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

/**
 * Atribut `Secure` cookie, diturunkan dari `APP_ORIGIN` (konfigurasi), BUKAN dari URL/header Host permintaan (di
 * belakang reverse proxy Host dapat berupa `127.0.0.1:<port>`): tidak Secure hanya bila `APP_ORIGIN` adalah
 * http://localhost atau http://127.0.0.1 (pengembangan; sebagian peramban menolak cookie Secure pada http). Tanpa
 * `APP_ORIGIN` atau origin lain: Secure.
 */
export function cookieSecure(env: Pick<Env, 'APP_ORIGIN'>): boolean {
  const origin = env.APP_ORIGIN?.trim();
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return !(url.protocol === 'http:' && isLocalHostname(url.hostname));
  } catch {
    return true;
  }
}
