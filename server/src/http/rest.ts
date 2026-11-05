import { appError, isAppError } from '@server/core/errors';
import { logRequest } from '@server/core/log';
import { type RouteMeta, type RouteTable, readCookie, runRoute } from '@server/core/router';
import { SESSION_COOKIE } from '@server/core/session';
import { MAX_REQUEST_BODY_BYTES, readTextLimited } from '@server/http/body';
import { problemResponse, toProblem } from '@server/http/problem';
import { type AppBindings, newRequestId } from '@server/http/security';
import {
  API_ROUTES,
  type ApiRouteDef,
  type ApiVerb,
  etagMatches,
  etagOf,
  fillPath,
  formatEtag,
  fromRequestParts,
  isApiFieldIssue,
  parseIfMatch,
  pathParamNames,
  routeShape,
} from '@shared/api';
import type { WorkerRpcMethod } from '@shared/rpc';
import type { Context } from 'hono';
import type { Hono } from 'hono/tiny';

/** Awalan jalur REST; jalur di tabel (`/brands/{id}`) relatif terhadapnya. */
export const REST_BASE = '/api/v1';

const BODY_VERBS: ReadonlySet<ApiVerb> = new Set<ApiVerb>(['POST', 'PUT', 'PATCH']);

interface Operation {
  id: WorkerRpcMethod;
  def: ApiRouteDef;
  created: boolean;
  verb: ApiVerb;
  path: string;
  status: 200 | 201 | 202;
}

/** `/brands/{id}` -> `/brands/:id` (sintaks Hono). */
function honoPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
}

/**
 * Daftar operasi yang didaftarkan: tiap id yang sudah `migrated` (dan bukan berkas biner, T21) dengan jalur ubah
 * dan, bila ada, jalur `create`. Rute statis didahulukan atas berparameter (router Hono mencocokkan menurut urutan
 * pendaftaran): `/handovers/options` dan `/handovers/batch` tidak boleh tertelan `/handovers/{id}`.
 */
export function listOperations(migrated: ReadonlySet<WorkerRpcMethod>): Operation[] {
  const operations: Operation[] = [];
  for (const id of Object.keys(API_ROUTES) as WorkerRpcMethod[]) {
    const def = API_ROUTES[id];
    if (!migrated.has(id) || def.binary !== undefined) continue;
    operations.push({ id, def, created: false, ...routeShape(def, false) });
    if (def.create) operations.push({ id, def, created: true, ...routeShape(def, true) });
  }
  return operations
    .map((operation, index) => ({
      operation,
      index,
      params: pathParamNames(operation.path).length,
    }))
    .sort((a, b) => a.params - b.params || a.index - b.index)
    .map((entry) => entry.operation);
}

/** Badan JSON dengan batas byte (413 bila terlampaui, 400 bila bukan JSON); badan kosong = `undefined`. */
async function readJsonBody(request: Request): Promise<unknown> {
  const text = await readTextLimited(request, MAX_REQUEST_BODY_BYTES);
  if (text === undefined) {
    throw Object.assign(appError('VALIDATION', 'Badan permintaan terlalu besar'), { status: 413 });
  }
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(appError('VALIDATION', 'Badan permintaan bukan JSON yang valid'), {
      status: 400,
    });
  }
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function handlerFor(operation: Operation, routes: RouteTable) {
  const { id, def, created, verb, status } = operation;
  return async (c: Context<AppBindings>): Promise<Response> => {
    const meta: RouteMeta = { requestId: newRequestId() };
    const startedAt = Date.now();
    const request = c.req.raw;
    const ifMatchHeader = request.headers.get('if-match');
    try {
      const body = BODY_VERBS.has(verb) ? await readJsonBody(request) : undefined;
      let input: unknown;
      try {
        input = fromRequestParts(id, {
          params: c.req.param(),
          query: c.req.query(),
          body,
          ifMatch: parseIfMatch(ifMatchHeader),
          created,
        });
      } catch (issue) {
        if (isApiFieldIssue(issue)) {
          throw appError('VALIDATION', 'Input tidak valid', { [issue.field]: issue.message });
        }
        throw issue;
      }
      const output = await runRoute(
        c.env,
        readCookie(request, SESSION_COOKIE),
        id,
        input,
        routes,
        meta,
      );
      logRequest({
        evt: 'rest',
        requestId: meta.requestId,
        method: id,
        ok: true,
        ms: Date.now() - startedAt,
        userId: meta.userId,
      });
      const headers: Record<string, string> = {
        'cache-control': verb === 'GET' && def.etag ? 'private, no-cache' : 'no-store',
      };
      const etag = etagOf(id, output as never);
      if (etag !== undefined) headers.etag = formatEtag(etag);
      if (created && output && typeof (output as { id?: unknown }).id === 'string') {
        headers.location = `${REST_BASE}${fillPath(def.path, { id: (output as { id: string }).id })}`;
      }
      if (
        verb === 'GET' &&
        etag !== undefined &&
        etagMatches(request.headers.get('if-none-match'), etag)
      ) {
        return new Response(null, { status: 304, headers });
      }
      return jsonResponse(status, output, headers);
    } catch (error) {
      // Basi + rute berETag + permintaan membawa If-Match = prasyarat gagal (412); `code` tetap CONFLICT.
      const precondition =
        isAppError(error) &&
        error.stale === true &&
        def.ifMatch !== undefined &&
        parseIfMatch(ifMatchHeader) !== undefined;
      const problem = toProblem(error, meta.requestId, precondition ? { status: 412 } : {});
      logRequest({
        evt: 'rest',
        requestId: meta.requestId,
        method: id,
        ok: false,
        code: problem.body.code,
        ms: Date.now() - startedAt,
        userId: meta.userId,
      });
      return problemResponse(problem);
    }
  };
}

/** Jawaban untuk rute `/api/v1/*` yang tidak dikenal: 404 problem+json (bukan fallback SPA). */
export function restNotFound(): Response {
  return problemResponse(toProblem(appError('NOT_FOUND', 'Rute tidak ditemukan'), newRequestId()));
}

/**
 * Mendaftarkan rute REST pada `app` (disambung ke `/api/v1`): satu handler per operasi tabel `API_ROUTES`
 * untuk id yang sudah `migrated`, lalu 404 problem+json untuk sisanya. Handler memakai `runRoute` yang sama
 * dengan RPC (sesi, izin, validasi, lokasi), jadi logika modul tidak berubah.
 */
export function registerRest(
  app: Hono<AppBindings>,
  routes: RouteTable,
  migrated: ReadonlySet<WorkerRpcMethod>,
): void {
  for (const operation of listOperations(migrated)) {
    app.on(operation.verb, honoPath(operation.path), handlerFor(operation, routes));
  }
  app.all('*', () => restNotFound());
}
