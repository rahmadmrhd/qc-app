import { handleRpc, type RouteTable, statusOf, toErrorBody } from '@server/core/router';
import { openApiResponse } from '@server/http/openapi';
import { problemResponse, toProblem } from '@server/http/problem';
import { registerRest, restNotFound } from '@server/http/rest';
import {
  type AppBindings,
  csrfGuard,
  errorEnvelope,
  isRestPath,
  newRequestId,
  securityHeaders,
} from '@server/http/security';
import { isServerPath, serveStatic } from '@server/http/static';
import { authApp } from '@server/modules/auth/routes';
import { handleSyncRequest } from '@server/modules/sync/handler';
import { syncRoutes } from '@server/modules/sync/routes';
import { getRoutes } from '@server/routes';
import { REST_MIGRATED_IDS } from '@shared/api';
import type { WorkerRpcMethod } from '@shared/rpc';
import { Hono } from 'hono/tiny';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Aplikasi Hono: `/api/*`, `/auth/*`, `/sync`, lalu berkas statis web dengan fallback SPA. `Env` (koneksi
 * dan rahasia) datang lewat `c.env`; `createServer` (server.ts) menyusunnya dari konfigurasi.
 */
export function createApp(
  routes: RouteTable,
  migrated: ReadonlySet<WorkerRpcMethod>,
): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use('*', securityHeaders);
  app.use('/api/*', csrfGuard);
  app.use('/auth/*', csrfGuard);

  app.get('/api/ping', (c) => c.json({ ok: true }));
  app.post('/api/rpc', (c) => handleRpc(c.env, c.req.raw, routes, migrated));
  // REST (`/api/v1`): satu tabel `shared/api.ts` untuk klien, server, dan OpenAPI; id yang belum pindah tetap RPC.
  const rest = new Hono<AppBindings>();
  registerRest(rest, routes, migrated);
  app.route('/api/v1', rest);
  app.get('/api/openapi.json', (c) => openApiResponse(c.env, c.req.raw, routes));
  // Data awal klien = `GET /api/v1/me` (id `auth.me`, tabel REST); `/api/boot` sudah dihapus.
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
    if (isRestPath(c.req.path)) return problemResponse(toProblem(error, newRequestId()));
    const body = toErrorBody(error, newRequestId());
    return c.json(
      { ok: false, error: body },
      statusOf({ ok: false, error: body }) as ContentfulStatusCode,
    );
  });
  app.notFound((c) =>
    isRestPath(c.req.path)
      ? restNotFound()
      : c.json(errorEnvelope('NOT_FOUND', 'Rute tidak ditemukan'), 404),
  );
  return app;
}

export const app = createApp(getRoutes(), REST_MIGRATED_IDS);
