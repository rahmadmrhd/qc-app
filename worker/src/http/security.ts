import type { Env } from '@worker/core/env';
import { nowOf } from '@worker/core/env';
import type { SessionPayload } from '@worker/core/session';
import { SESSION_COOKIE, verifySessionToken } from '@worker/core/session';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';

export interface AppBindings {
  Bindings: Env;
  Variables: { session: SessionPayload };
}

export { SESSION_COOKIE };
export const OAUTH_COOKIE = 'qc_oauth';
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'qc';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/** Amplop galat yang sama dengan RPC (`{ ok:false, error }`). */
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
