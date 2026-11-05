import {
  callRoute,
  handleRpc,
  readCookie,
  rpcResponse,
  statusOf,
  toErrorBody,
} from '@server/core/router';
import { SESSION_COOKIE } from '@server/core/session';
import {
  type AppBindings,
  csrfGuard,
  errorEnvelope,
  newRequestId,
  securityHeaders,
} from '@server/http/security';
import { isServerPath, serveStatic } from '@server/http/static';
import { authApp } from '@server/modules/auth/routes';
import { handleSyncRequest } from '@server/modules/sync/handler';
import { syncRoutes } from '@server/modules/sync/routes';
import { getRoutes } from '@server/routes';
import { Hono } from 'hono/tiny';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Aplikasi Hono: `/api/*`, `/auth/*`, `/sync`, lalu berkas statis web dengan fallback SPA. `Env` (koneksi
 * dan rahasia) datang lewat `c.env`; `createServer` (server.ts) menyusunnya dari konfigurasi.
 */
const app = new Hono<AppBindings>();

app.use('*', securityHeaders);
app.use('/api/*', csrfGuard);
app.use('/auth/*', csrfGuard);

app.get('/api/ping', (c) => c.json({ ok: true }));
app.post('/api/rpc', (c) => handleRpc(c.env, c.req.raw, getRoutes()));
// Data awal klien: alias `auth.me` (sesi dari cookie); tanpa sesi -> 401 UNAUTHENTICATED.
app.get('/api/boot', async (c) =>
  rpcResponse(
    await callRoute(c.env, readCookie(c.req.raw, SESSION_COOKIE), 'auth.me', null, getRoutes()),
  ),
);
app.route('/auth', authApp);
// QC Desktop: token di badan, tanpa cookie (bukan permukaan CSRF); amplop sama dengan era Apps Script.
// Pembatas percobaan salah dihitung per IP klien (`clientIp`, lihat http/proxy.ts).
app.post('/sync', (c) => handleSyncRequest(c.env, c.req.raw, syncRoutes(), c.env.clientIp));

// Berkas statis web (`bun run build` -> `server/dist`) dengan fallback SPA; rute server yang tak dikenal = 404.
app.get('*', (c) => {
  const path = new URL(c.req.url).pathname;
  const staticDir = c.env.staticDir;
  const response =
    staticDir === undefined || isServerPath(path)
      ? null
      : serveStatic(staticDir, c.req.method, path);
  return response ?? c.notFound();
});
// Galat tak tertangani di rute (mis. konfigurasi kurang): amplop yang sama dengan RPC, galat internal disamarkan.
app.onError((error, c) => {
  const body = toErrorBody(error, newRequestId());
  return c.json(
    { ok: false, error: body },
    statusOf({ ok: false, error: body }) as ContentfulStatusCode,
  );
});
app.notFound((c) => c.json(errorEnvelope('NOT_FOUND', 'Rute tidak ditemukan'), 404));

export { app };
