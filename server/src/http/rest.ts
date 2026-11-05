import { appError, isAppError } from '@server/core/errors';
import { logRequest } from '@server/core/log';
import {
  authorize,
  execute,
  type RouteMeta,
  type RouteTable,
  readCookie,
} from '@server/core/router';
import { SESSION_COOKIE } from '@server/core/session';
import { MAX_REQUEST_BODY_BYTES, readBytesLimited, readTextLimited } from '@server/http/body';
import { problemResponse, toProblem } from '@server/http/problem';
import { type AppBindings, newRequestId } from '@server/http/security';
import {
  API_ROUTES,
  type ApiRouteDef,
  type ApiVerb,
  contentDispositionOf,
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
 * Daftar operasi yang didaftarkan: tiap id tabel `API_ROUTES` (termasuk rute biner) dengan jalur ubah
 * dan, bila ada, jalur `create`. Rute statis didahulukan atas berparameter (router Hono mencocokkan menurut urutan
 * pendaftaran): `/handovers/options` dan `/handovers/batch` tidak boleh tertelan `/handovers/{id}`.
 */
export function listOperations(): Operation[] {
  const operations: Operation[] = [];
  for (const id of Object.keys(API_ROUTES) as WorkerRpcMethod[]) {
    const def = API_ROUTES[id];
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

function tooLarge(message: string): Error {
  return Object.assign(appError('VALIDATION', message), { status: 413 });
}

/** Badan mentah rute unggah: byte (berbatas) dan Content-Type tanpa parameter. */
async function readRawBody(
  request: Request,
  spec: NonNullable<ApiRouteDef['rawBody']>,
): Promise<{ data: Uint8Array; contentType: string }> {
  const data = await readBytesLimited(request, spec.maxBytes);
  if (data === undefined) throw tooLarge(spec.tooLarge);
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  return { data, contentType: contentType.toLowerCase() };
}

/** Bagian multipart bernama (byte). Bagian yang tak ada / bukan berkas dilewati (validator yang menolak). */
async function readMultipart(
  request: Request,
  spec: NonNullable<ApiRouteDef['multipart']>,
): Promise<Record<string, Uint8Array>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw Object.assign(appError('VALIDATION', 'Badan harus multipart/form-data'), { status: 415 });
  }
  const data = await readBytesLimited(request, spec.maxBytes);
  if (data === undefined) throw tooLarge(spec.tooLarge);
  let form: Awaited<ReturnType<Response['formData']>>;
  try {
    // Badan sudah dibatasi di atas; formData() hanya mengurai salinan berbatas itu.
    form = await new Response(data, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw Object.assign(appError('VALIDATION', 'Badan multipart tidak valid'), { status: 400 });
  }
  const parts: Record<string, Uint8Array> = {};
  for (const name of spec.parts) {
    const value = form.get(name);
    if (value !== null && typeof value !== 'string') {
      parts[name] = new Uint8Array(await value.arrayBuffer());
    }
  }
  return parts;
}

/** Respons unduhan: byte mentah, Content-Type dari keluaran, ETag/304, dan Cache-Control menurut tabel. */
function downloadResponse(
  def: ApiRouteDef,
  output: unknown,
  headers: Record<string, string>,
  notModified: boolean,
): Response {
  const spec = def.download as NonNullable<ApiRouteDef['download']>;
  const source = output as Record<string, unknown>;
  const bytes = source[spec.bytesField] as Uint8Array;
  headers['cache-control'] =
    spec.cache === 'immutable' ? 'private, max-age=31536000, immutable' : 'private, no-cache';
  if (notModified) return new Response(null, { status: 304, headers });
  headers['content-type'] = String(source[spec.mimeField]);
  if (spec.filenameField !== undefined) {
    headers['content-disposition'] = contentDispositionOf(String(source[spec.filenameField]));
  }
  return new Response(bytes, { status: 200, headers });
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
      const hasBinaryBody = def.rawBody !== undefined || def.multipart !== undefined;
      // Sesi (HMAC), akun aktif, dan izin global diperiksa SEBELUM badan apa pun dibaca: klien tanpa sesi sah atau
      // tanpa izin tidak dapat memaksa server menyangga/mem-parse badan besar (JSON sampai batas, unggahan sampai 10 MB).
      // Izin berlokasi butuh input tervalidasi, jadi diperiksa di `execute`.
      const authorized = await authorize(
        c.env,
        readCookie(request, SESSION_COOKIE),
        id,
        routes,
        meta,
      );
      const raw = def.rawBody ? await readRawBody(request, def.rawBody) : undefined;
      const multipart = def.multipart ? await readMultipart(request, def.multipart) : undefined;
      const body = BODY_VERBS.has(verb) && !hasBinaryBody ? await readJsonBody(request) : undefined;
      let input: unknown;
      try {
        input = fromRequestParts(id, {
          params: c.req.param(),
          query: c.req.query(),
          body,
          raw,
          multipart,
          ifMatch: parseIfMatch(ifMatchHeader),
          created,
        });
      } catch (issue) {
        if (isApiFieldIssue(issue)) {
          throw appError('VALIDATION', 'Input tidak valid', { [issue.field]: issue.message });
        }
        throw issue;
      }
      const output = await execute(authorized, input);
      logRequest({
        evt: 'rest',
        requestId: meta.requestId,
        method: id,
        ok: true,
        ms: Date.now() - startedAt,
        userId: meta.userId,
      });
      // JSON tidak boleh disimpan peramban. ETag `updatedAt` BUKAN validator isi (komentar, ganti nama merk/customer,
      // dan hasil ekspor tidak menaikkannya), jadi cache HTTP + revalidasi dapat menyajikan badan basi lewat 304.
      // ETag tetap dikirim (dasar If-Match dan 304 bagi klien yang sendiri mengirim If-None-Match); unduhan biner
      // memakai kebijakan tabelnya (`downloadResponse` menimpa).
      const headers: Record<string, string> = { 'cache-control': 'no-store' };
      const etag = etagOf(id, output as never);
      if (etag !== undefined) headers.etag = formatEtag(etag);
      if (created && output && typeof (output as { id?: unknown }).id === 'string') {
        headers.location = `${REST_BASE}${fillPath(def.path, { id: (output as { id: string }).id })}`;
      }
      if (def.location !== undefined) {
        const location = locationOf(def.location, output);
        if (location !== undefined) headers.location = location;
      }
      const notModified =
        verb === 'GET' &&
        etag !== undefined &&
        etagMatches(request.headers.get('if-none-match'), etag);
      if (def.download !== undefined) return downloadResponse(def, output, headers, notModified);
      if (notModified) return new Response(null, { status: 304, headers });
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

/** `Location` dari templat `def.location` dan field keluaran; `undefined` bila ada parameter yang tidak terisi. */
function locationOf(template: string, output: unknown): string | undefined {
  const source =
    typeof output === 'object' && output !== null ? (output as Record<string, unknown>) : {};
  const params: Record<string, string> = {};
  for (const name of pathParamNames(template)) {
    const value = source[name];
    if (typeof value !== 'string' || value === '') return undefined;
    params[name] = value;
  }
  return `${REST_BASE}${fillPath(template, params)}`;
}

/** Jawaban untuk rute `/api/v1/*` yang tidak dikenal: 404 problem+json (bukan fallback SPA). */
export function restNotFound(): Response {
  return problemResponse(toProblem(appError('NOT_FOUND', 'Rute tidak ditemukan'), newRequestId()));
}

/**
 * Mendaftarkan rute REST pada `app` (disambung ke `/api/v1`): satu handler per operasi tabel `API_ROUTES`
 * untuk SEMUA id, lalu 404 problem+json untuk sisanya. Handler memakai `authorize` + `execute`
 * (= `runRoute`: sesi, izin, validasi, lokasi), jadi logika modul tidak berubah.
 */
export function registerRest(app: Hono<AppBindings>, routes: RouteTable): void {
  for (const operation of listOperations()) {
    app.on(operation.verb, honoPath(operation.path), handlerFor(operation, routes));
  }
  app.all('*', () => restNotFound());
}
