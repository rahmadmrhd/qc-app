import { loadRequestCtx } from '@server/core/context';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import {
  credentialOf,
  type RoutePermissionSpec,
  type RouteTable,
  sessionOfCredential,
} from '@server/core/router';
import { SESSION_COOKIE } from '@server/core/session';
import { toProblem, problemResponse as toProblemResponse } from '@server/http/problem';
import { newRequestId } from '@server/http/security';
import {
  API_ROUTES,
  type ApiRouteDef,
  type ApiVerb,
  pathParamNames,
  type QueryKind,
  routeShape,
} from '@shared/api';
import { parseApiId } from '@shared/api-versions';
import { type ApiId, ERROR_CODES } from '@shared/contract';

// Dokumen OpenAPI 3.1 yang dibangun dari tabel `API_ROUTES` (BUKAN dari skema validator, yang ditulis tangan):
// jalur, verba, status, parameter jalur/query, header `If-Match`/`ETag`, `operationId` = id rute, dan ringkasan
// izin dari `RouteDef.permission`. Skema JSON badan/respons belum dihasilkan (lihat penyimpangan 2 rencana).

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: Record<string, unknown>;
  security: Array<Record<string, string[]>>;
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  parameters: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses: Record<string, Record<string, unknown>>;
  'x-permission': string;
}

const SCHEMA_BY_KIND: Record<QueryKind, Record<string, unknown>> = {
  string: { type: 'string' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  list: { type: 'array', items: { type: 'string' }, style: 'form', explode: false },
};

/** Ringkasan izin yang terbaca manusia, mis. `item:edit` atau `handover:view@lokasi atau qc:edit@lokasi`. */
export function describePermission(spec: RoutePermissionSpec | undefined): string {
  if (!spec) return 'login';
  const alternatives = 'anyOf' in spec ? spec.anyOf : [spec];
  if (alternatives.length === 0) return 'ditolak';
  return alternatives
    .map((item) => `${item.module}:${item.level}${item.scope === 'location' ? '@lokasi' : ''}`)
    .join(' atau ');
}

function problemResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
    },
  };
}

function operationFor(
  id: ApiId,
  def: ApiRouteDef,
  created: boolean,
  routes: RouteTable,
): { verb: ApiVerb; path: string; operation: OpenApiOperation } {
  const shape = routeShape(def, created);
  const permission = describePermission(routes[id]?.permission);
  const parameters: Array<Record<string, unknown>> = pathParamNames(shape.path).map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  for (const [name, kind] of Object.entries(def.query ?? {})) {
    parameters.push({ name, in: 'query', required: false, schema: SCHEMA_BY_KIND[kind] });
  }
  if (def.ifMatch !== undefined) {
    parameters.push({
      name: 'If-Match',
      in: 'header',
      required: false,
      description: `Nilai \`${def.ifMatch}\` yang dilihat penulis (dalam tanda kutip); basi = 412.`,
      schema: { type: 'string' },
    });
  }
  const responseHeaders =
    def.etag === undefined
      ? undefined
      : { ETag: { description: `Nilai \`${def.etag}\`.`, schema: { type: 'string' } } };
  const responses: Record<string, Record<string, unknown>> = {
    [String(shape.status)]: {
      description: 'Berhasil',
      ...(responseHeaders ? { headers: responseHeaders } : {}),
      content:
        def.binary === 'response'
          ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
          : { 'application/json': { schema: {} } },
    },
    ...(def.verb === 'GET' && def.etag ? { '304': { description: 'If-None-Match cocok' } } : {}),
    '401': problemResponse('Belum masuk'),
    '403': problemResponse('Akses ditolak'),
    '404': problemResponse('Tidak ditemukan'),
    '409': problemResponse('Konflik'),
    ...(def.ifMatch ? { '412': problemResponse('Prasyarat gagal (data sudah diubah)') } : {}),
    '422': problemResponse('Input tidak valid'),
    default: problemResponse('Galat lain'),
  };
  const operation: OpenApiOperation = {
    operationId: created ? `${id}.create` : id,
    summary: created ? `${id} (buat)` : id,
    description: `Izin: ${permission}.`,
    tags: [id.split('.')[0] as string],
    parameters,
    responses,
    'x-permission': permission,
  };
  if (shape.verb !== 'GET' && shape.verb !== 'DELETE') {
    const media =
      def.binary === 'request'
        ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
        : def.binary === 'multipart'
          ? { 'multipart/form-data': { schema: { type: 'object' } } }
          : { 'application/json': { schema: { type: 'object' } } };
    operation.requestBody = { required: false, content: media };
  }
  return { verb: shape.verb, path: shape.path, operation };
}

/**
 * Kunci path item dokumen: v1 memakai jalur tabel apa adanya (relatif terhadap `servers[0]` = `/api/v1`); versi >= 2
 * SELALU diawali `/v<n>` (mis. `/v2/qrcodes/{id}`) supaya tak pernah bertabrakan dengan v1 dan tetap kunci sah OAS 3.1
 * (tanpa query string). Pasangannya `serversFor`: path item versi >= 2 menimpa server menjadi `/api`.
 */
export function openApiPathKey(version: number, path: string): string {
  return version <= 1 ? path : `/v${version}${path}`;
}

/** `servers` untuk path item rute versi >= 2 (kunci pathnya membawa `/v<n>`, jadi server = `/api`); v1 memakai `servers` dokumen. */
export function serversFor(version: number): Array<{ url: string }> | undefined {
  return version <= 1 ? undefined : [{ url: '/api' }];
}

/**
 * Dokumen OpenAPI 3.1 dari seluruh tabel rute (jalur v1 relatif terhadap `servers[0].url` = `/api/v1`). Rute versi >= 2
 * ditaruh pada path item berkunci `/v<n><jalur>` dengan `servers` `/api` (lihat `openApiPathKey`/`serversFor`).
 */
export function buildOpenApi(
  routes: RouteTable,
  table: Record<string, ApiRouteDef> = API_ROUTES,
): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  for (const id of Object.keys(table) as ApiId[]) {
    const def = table[id] as ApiRouteDef;
    const { version } = parseApiId(id);
    for (const created of def.create ? [false, true] : [false]) {
      const { verb, path, operation } = operationFor(id, def, created, routes);
      const key = openApiPathKey(version, path);
      const item = paths[key] ?? {};
      item[verb.toLowerCase()] = operation;
      const servers = serversFor(version);
      if (servers !== undefined) (item as Record<string, unknown>).servers = servers;
      paths[key] = item;
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'QC App API',
      version: '1',
      description:
        'API REST aplikasi QC. Sesi lewat cookie; metode tulis wajib membawa header `X-Requested-With: qc`. Galat memakai application/problem+json.',
    },
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
      },
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status', 'detail', 'code', 'requestId'],
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            code: {
              type: 'string',
              enum: [...ERROR_CODES],
            },
            requestId: { type: 'string' },
            fields: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
    },
    security: [{ session: [] }],
  };
}

/**
 * `GET /api/openapi.json`: dokumen tabel rute untuk pengembang; butuh sesi login aktif (401 problem+json bila tidak).
 * `no-store` karena isinya bergantung pada rilis berjalan.
 */
export async function openApiResponse(
  env: Env,
  request: Request,
  routes: RouteTable,
): Promise<Response> {
  const requestId = newRequestId();
  const session = await sessionOfCredential(env, credentialOf(request, SESSION_COOKIE), nowOf(env));
  const context = session ? await loadRequestCtx(env, session.email, requestId) : null;
  if (!context) {
    return toProblemResponse(
      toProblem(appError('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir'), requestId),
    );
  }
  return new Response(JSON.stringify(buildOpenApi(routes)), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
