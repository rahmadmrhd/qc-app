import { appError } from '@server/core/errors';
import { logRequest } from '@server/core/log';
import { SYNC_MAX_BODY_BYTES } from '@server/http/body';
import { problemResponse, toProblem } from '@server/http/problem';
import { honoPath, readJsonBody } from '@server/http/rest';
import { type AppBindings, newRequestId } from '@server/http/security';
import {
  etagMatches,
  formatEtag,
  isApiFieldIssue,
  SYNC_API_ROUTES,
  type SyncRouteId,
  syncInputFromParts,
} from '@shared/api';
import { SYNC_ACTOR } from '@shared/sync';
import type { Context } from 'hono';
import type { Hono } from 'hono/tiny';
import { authenticateSync } from './auth';
import type { SyncRouteDef, SyncRouteTable } from './handler';

/** Detail galat otentikasi: SATU teks untuk semua sebab (header hilang, bukan Bearer, token salah, diblokir, server belum diset). */
const INVALID_TOKEN = 'Token tidak valid';

/**
 * Token dari header `Authorization: Bearer <token>`; `undefined` untuk header yang tidak ada atau bukan skema Bearer.
 * Skema tak peka huruf (RFC 9110); sisanya (setelah spasi) adalah token apa adanya.
 */
export function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  return /^Bearer +(\S+)$/i.exec(header.trim())?.[1];
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Unduhan berkas: byte mentah, Content-Type dari berkas, ETag = id Drive, 304 untuk `If-None-Match` yang cocok. */
function fileResponse(request: Request, output: unknown): Response {
  const file = output as { driveId: string; mime: string; bytes: Uint8Array };
  const headers: Record<string, string> = {
    etag: formatEtag(file.driveId),
    // Isi untuk id Drive yang sama tidak berubah (sama dengan `files.get` web).
    'cache-control': 'private, max-age=31536000, immutable',
  };
  if (etagMatches(request.headers.get('if-none-match'), file.driveId)) {
    return new Response(null, { status: 304, headers });
  }
  headers['content-type'] = file.mime;
  return new Response(file.bytes, { status: 200, headers });
}

function handlerFor(id: SyncRouteId, table: SyncRouteTable) {
  const def = SYNC_API_ROUTES[id];
  return async (c: Context<AppBindings>): Promise<Response> => {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const request = c.req.raw;
    try {
      // Otentikasi PERTAMA dan seragam: tidak ada yang terungkap (rute, bentuk badan) tanpa token sah, dan badan
      // tidak dibaca. HANYA Bearer; cookie sesi tidak pernah dibaca di sini. Header Authorization tidak dicatat.
      const token = bearerToken(request.headers.get('authorization'));
      if (!(await authenticateSync(c.env, token, c.env.clientIp))) {
        throw appError('UNAUTHENTICATED', INVALID_TOKEN);
      }
      const route = table[id] as SyncRouteDef<unknown>;
      const body =
        def.verb === 'POST' ? await readJsonBody(request, SYNC_MAX_BODY_BYTES) : undefined;
      let input: unknown;
      try {
        input = syncInputFromParts(id, { params: c.req.param(), query: c.req.query(), body });
      } catch (issue) {
        if (isApiFieldIssue(issue)) {
          throw appError('VALIDATION', 'Input tidak valid', { [issue.field]: issue.message });
        }
        throw issue;
      }
      const output = await route.handler(route.validate(input), {
        env: c.env,
        requestId,
        actor: SYNC_ACTOR,
      });
      logRequest({ evt: 'sync', requestId, method: id, ok: true, ms: Date.now() - startedAt });
      return def.download === undefined ? jsonResponse(output) : fileResponse(request, output);
    } catch (error) {
      const problem = toProblem(error, requestId);
      logRequest({
        evt: 'sync',
        requestId,
        method: id,
        ok: false,
        code: problem.body.code,
        ms: Date.now() - startedAt,
      });
      if (problem.status === 401)
        problem.headers = { ...problem.headers, 'www-authenticate': 'Bearer' };
      return problemResponse(problem);
    }
  };
}

/**
 * Penutup `/sync/*`: rute (atau verba) sinkron yang tidak dikenal. Otentikasi LEBIH DULU (gagal = 401 seragam, dihitung
 * pembatas), baru 404: keberadaan rute tidak terungkap tanpa token sah (sama dengan rute yang ada).
 */
async function unknownSyncRoute(c: Context<AppBindings>): Promise<Response> {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const token = bearerToken(c.req.raw.headers.get('authorization'));
  const authenticated = await authenticateSync(c.env, token, c.env.clientIp);
  const problem = authenticated
    ? toProblem(appError('NOT_FOUND', 'Rute tidak ditemukan'), requestId)
    : toProblem(appError('UNAUTHENTICATED', INVALID_TOKEN), requestId);
  logRequest({
    evt: 'sync',
    requestId,
    method: '?',
    ok: false,
    code: problem.body.code,
    ms: Date.now() - startedAt,
  });
  if (problem.status === 401)
    problem.headers = { ...problem.headers, 'www-authenticate': 'Bearer' };
  return problemResponse(problem);
}

/**
 * Mendaftarkan rute QC Desktop (`SYNC_API_ROUTES`, kontrak versi 2) pada sub-aplikasi `/api/v1`: satu handler per id,
 * otentikasi Bearer (bukan sesi, tanpa CSRF), galat problem+json. Harus dipanggil SEBELUM `registerRest` (yang
 * menutup dengan 404 untuk jalur lain).
 */
export function registerSyncRest(app: Hono<AppBindings>, table: SyncRouteTable): void {
  for (const id of Object.keys(SYNC_API_ROUTES) as SyncRouteId[]) {
    const def = SYNC_API_ROUTES[id];
    app.on(def.verb, honoPath(def.path), handlerFor(id, table));
  }
  app.all('/sync', unknownSyncRoute);
  app.all('/sync/*', unknownSyncRoute);
}
