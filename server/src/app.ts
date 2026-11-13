import { httpStatusOf, type RouteTable, toErrorBody } from '@server/core/router';
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
import { getRoutes } from '@server/routes';
import { Hono } from 'hono/tiny';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Aplikasi Hono: `/api/*` (REST `/api/v1`), `/auth/*`, lalu berkas statis web dengan fallback SPA. `Env` (koneksi
 * dan rahasia) datang lewat `c.env`; `createServer` (server.ts) menyusunnya dari konfigurasi.
 */
export function createApp(routes: RouteTable): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use('*', securityHeaders);
  app.use('/api/*', csrfGuard);
  app.use('/auth/*', csrfGuard);

  app.get('/api/ping', (c) => c.json({ ok: true }));
  // REST (`/api/v1`): satu tabel `shared/api.ts` untuk klien, server, dan OpenAPI; semua id terdaftar.
  const rest = new Hono<AppBindings>();
  registerRest(rest, routes);
  app.route('/api/v1', rest);
  app.get('/api/openapi.json', (c) => openApiResponse(c.env, c.req.raw, routes));
  // Data awal klien = `GET /api/v1/me` (id `auth.me`, tabel REST).
  app.route('/auth', authApp);
  // Kabel lama (`POST /sync`, amplop {v,method,token,payload}) dihapus (keputusan pemilik 2026-11-06); modul sinkron
  // REST `/api/v1/sync/*` pun dihapus (2026-11-08). Jawabannya 404 problem+json untuk semua metode di `/sync` dan turunannya.
  app.all('/sync', () => restNotFound());
  app.all('/sync/*', () => restNotFound());

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
  // Galat tak tertangani di rute (mis. konfigurasi kurang): jalur non-REST memakai amplop `{ ok:false, error }`, galat internal disamarkan.
  app.onError((error, c) => {
    if (isRestPath(c.req.path)) return problemResponse(toProblem(error, newRequestId()));
    const body = toErrorBody(error, newRequestId());
    return c.json({ ok: false, error: body }, httpStatusOf(body.code) as ContentfulStatusCode);
  });
  app.notFound((c) =>
    isRestPath(c.req.path)
      ? restNotFound()
      : c.json(errorEnvelope('NOT_FOUND', 'Rute tidak ditemukan'), 404),
  );
  return app;
}

export const app = createApp(getRoutes());
