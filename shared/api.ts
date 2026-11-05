import type { WorkerRpcInput, WorkerRpcMethod, WorkerRpcOutput } from './rpc';

// Tabel rute REST (`/api/v1`): SATU sumber untuk klien FE (`api()`), server (kernel REST), dan OpenAPI. Murni:
// tanpa API runtime (build GAS menolak `URL`/`URLSearchParams`/`fetch`/`atob` dll. di `shared/`), jadi query
// diterima dan dikembalikan sebagai `Record<string, string>` dan pengodean URL diserahkan ke pemanggil.
// Validator dan handler modul tidak tahu bentuk kabel: server merakit kembali objek input datar yang sama
// (`fromRequestParts`) lalu memanggil `RouteDef.validate/handler` yang ada.

export type ApiVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** `list` = nilai dipisah koma. */
export type QueryKind = 'string' | 'number' | 'boolean' | 'list';

export interface ApiRouteDef {
  verb: ApiVerb;
  /** Relatif terhadap `/api/v1`, mis. `/brands/{id}`. */
  path: string;
  /** Bawaan 200. */
  status?: 200 | 201 | 202;
  /** Field input yang dikirim lewat query (selain parameter jalur). */
  query?: Record<string, QueryKind>;
  /** Dipakai bila `input.id` TIDAK ada (rute save): membuat sumber daya baru. */
  create?: { verb: ApiVerb; path: string; status?: 201 };
  /** Field keluaran yang menjadi nilai header `ETag` (mis. `updatedAt`). */
  etag?: string;
  /** Field input yang dibawa header `If-Match` (mis. `expectedUpdatedAt`). */
  ifMatch?: string;
  /** Diisi T21; sebelum itu rute berpenanda ini tidak didaftarkan dan tidak masuk `REST_MIGRATED_IDS`. */
  binary?: 'request' | 'response' | 'multipart';
}

export const API_ROUTES: { [M in WorkerRpcMethod]: ApiRouteDef } = {
  'auth.me': { verb: 'GET', path: '/me' },
  'access.users.list': { verb: 'GET', path: '/users' },
  'access.users.save': {
    verb: 'PUT',
    path: '/users/{id}',
    create: { verb: 'POST', path: '/users' },
  },
  'access.users.setStatus': { verb: 'PATCH', path: '/users/{id}' },
  'access.roles.list': { verb: 'GET', path: '/roles' },
  'access.roles.save': {
    verb: 'PUT',
    path: '/roles/{id}',
    create: { verb: 'POST', path: '/roles' },
  },
  'access.roles.delete': { verb: 'DELETE', path: '/roles/{id}' },
  'access.audit.list': {
    verb: 'GET',
    path: '/audit-logs',
    query: { cursor: 'string', limit: 'number', action: 'string', query: 'string' },
  },
  'access.locations.list': { verb: 'GET', path: '/locations' },
  'access.locations.save': {
    verb: 'PUT',
    path: '/locations/{id}',
    create: { verb: 'POST', path: '/locations' },
  },
  'access.locations.setStatus': { verb: 'PATCH', path: '/locations/{id}' },
  'files.upload': {
    verb: 'POST',
    path: '/files',
    status: 201,
    query: { width: 'number', height: 'number' },
    binary: 'request',
  },
  'files.get': { verb: 'GET', path: '/files/{id}', etag: 'id', binary: 'response' },
  'brands.list': { verb: 'GET', path: '/brands' },
  'brands.save': {
    verb: 'PUT',
    path: '/brands/{id}',
    create: { verb: 'POST', path: '/brands' },
  },
  'brands.setStatus': { verb: 'PATCH', path: '/brands/{id}' },
  'customers.list': { verb: 'GET', path: '/customers' },
  'customers.rename': { verb: 'PUT', path: '/customers/{id}' },
  'customers.setStatus': { verb: 'PATCH', path: '/customers/{id}' },
  'handovers.options': { verb: 'GET', path: '/handovers/options', query: { locationIds: 'list' } },
  'handovers.board': {
    verb: 'GET',
    path: '/handovers',
    query: { locationIds: 'list', status: 'string', cursor: 'string', limit: 'number' },
  },
  'handovers.get': {
    verb: 'GET',
    path: '/handovers/{id}',
    query: { locationIds: 'list' },
    etag: 'updatedAt',
  },
  'handovers.save': {
    verb: 'PUT',
    path: '/handovers/{id}',
    create: { verb: 'POST', path: '/handovers' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'handovers.saveBatch': { verb: 'POST', path: '/handovers/batch', status: 201 },
  'handovers.cancel': { verb: 'POST', path: '/handovers/{id}/cancel' },
  'handovers.reopen': { verb: 'POST', path: '/handovers/{id}/reopen' },
  'handovers.setCheck': { verb: 'PUT', path: '/handovers/{id}/checks' },
  'handovers.setDone': { verb: 'POST', path: '/handovers/{id}/done' },
  'handovers.comment': { verb: 'POST', path: '/handovers/{id}/comments', status: 201 },
  'items.list': {
    verb: 'GET',
    path: '/items',
    query: { cursor: 'string', limit: 'number', query: 'string', status: 'string' },
  },
  'items.get': { verb: 'GET', path: '/items/{id}', etag: 'updatedAt' },
  'items.save': {
    verb: 'PUT',
    path: '/items/{id}',
    create: { verb: 'POST', path: '/items' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'items.setStatus': { verb: 'PATCH', path: '/items/{id}' },
  'qrcodes.list': { verb: 'GET', path: '/qrcodes' },
  'qrcodes.get': { verb: 'GET', path: '/qrcodes/{id}', etag: 'updatedAt' },
  'qrcodes.save': {
    verb: 'PUT',
    path: '/qrcodes/{id}',
    create: { verb: 'POST', path: '/qrcodes' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'qrcodes.delete': { verb: 'DELETE', path: '/qrcodes/{id}' },
  'qrcodes.getDefaults': { verb: 'GET', path: '/qrcode-defaults' },
  'qrcodes.savePreset': {
    verb: 'PUT',
    path: '/qrcode-presets/{id}',
    create: { verb: 'POST', path: '/qrcode-presets' },
  },
  'qrcodes.deletePreset': { verb: 'DELETE', path: '/qrcode-presets/{id}' },
  'qrcodes.saveLogoLibrary': {
    verb: 'PUT',
    path: '/qrcode-defaults/logos',
    ifMatch: 'expectedUpdatedAt',
    etag: 'logoUpdatedAt',
  },
  'qrcodes.uploadPdf': {
    verb: 'POST',
    path: '/qrcode-documents',
    query: { name: 'string', replaceDocumentId: 'string' },
    binary: 'request',
  },
  'qrcodes.cloneFromDrive': { verb: 'POST', path: '/qrcode-documents/clone' },
  'qrcodes.export': {
    verb: 'POST',
    path: '/qrcodes/{id}/exports',
    status: 202,
    ifMatch: 'expectedUpdatedAt',
    binary: 'multipart',
  },
  'qrcodes.file': { verb: 'GET', path: '/qrcodes/{id}/files/{kind}', binary: 'response' },
  'jobs.get': { verb: 'GET', path: '/jobs/{id}' },
  'exports.sheets': { verb: 'POST', path: '/exports/sheets', status: 202 },
};

/**
 * Id yang sudah dilayani REST. Sumber tunggal untuk server (`/api/rpc` menjawab `NOT_FOUND` untuk id ini) dan
 * FE (`rpc()` mengarahkan id ini ke `api()`). Tiap tugas modul menambah id-nya bersama pemindahan FE modul itu;
 * id berpenanda `binary` baru masuk setelah T21.
 */
export const REST_MIGRATED_IDS: ReadonlySet<WorkerRpcMethod> = new Set<WorkerRpcMethod>([]);

export interface RequestParts {
  verb: ApiVerb;
  /** Jalur relatif terhadap `/api/v1`, parameter sudah terisi (nilai di-encode). */
  path: string;
  query: Record<string, string>;
  /** Ada hanya untuk POST/PUT/PATCH. */
  body?: unknown;
  /** Nilai `If-Match` TANPA tanda kutip (pemanggil yang membungkusnya, lihat `formatEtag`). */
  ifMatch?: string;
}

export interface ParsedParts {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  /** Nilai `If-Match` tanpa kutip (lihat `parseIfMatch`). */
  ifMatch?: string;
  /** Permintaan datang di jalur `create` (rute save tanpa id). */
  created: boolean;
}

/** Galat parameter yang dilempar `fromRequestParts`; kernel mengubahnya menjadi `VALIDATION` dengan `fields`. */
export interface ApiFieldIssue {
  field: string;
  message: string;
}

export function isApiFieldIssue(value: unknown): value is ApiFieldIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiFieldIssue).field === 'string' &&
    typeof (value as ApiFieldIssue).message === 'string'
  );
}

type AnyRecord = Record<string, unknown>;

const BODY_VERBS: ReadonlySet<ApiVerb> = new Set<ApiVerb>(['POST', 'PUT', 'PATCH']);

/** Nama parameter jalur (`{id}`) berurutan. */
export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  const pattern = /\{([A-Za-z0-9_]+)\}/g;
  let match = pattern.exec(path);
  while (match) {
    names.push(match[1] as string);
    match = pattern.exec(path);
  }
  return names;
}

/** Mengisi `{nama}` pada jalur dengan nilai ter-encode; parameter yang hilang = galat pemrograman. */
export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, (_all, name: string) => {
    const value = params[name];
    if (value === undefined || value === '') {
      throw new Error(`Parameter jalur "${name}" wajib diisi untuk ${path}`);
    }
    return encodeURIComponent(value);
  });
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

function hasId(input: AnyRecord): boolean {
  return typeof input.id === 'string' && input.id !== '';
}

/** Verba, jalur, dan status menurut jalur yang dipilih (`create` bila `created`). */
export function routeShape(
  def: ApiRouteDef,
  created: boolean,
): { verb: ApiVerb; path: string; status: 200 | 201 | 202 } {
  if (created && def.create) {
    return { verb: def.create.verb, path: def.create.path, status: def.create.status ?? 201 };
  }
  return { verb: def.verb, path: def.path, status: def.status ?? 200 };
}

function queryText(kind: QueryKind, value: unknown): string {
  if (kind === 'list') {
    if (!Array.isArray(value)) throw new Error('Field daftar harus berupa array');
    return value.join(',');
  }
  return String(value);
}

/**
 * Memecah input datar sebuah id menjadi bagian permintaan HTTP: parameter jalur, query, badan, dan `If-Match`.
 * Rute `save` memilih jalur `create` bila `input.id` tidak ada. Pada GET/DELETE semua field lewat query.
 */
export function toRequestParts<M extends WorkerRpcMethod>(
  id: M,
  input: WorkerRpcInput<M>,
): RequestParts {
  const def = API_ROUTES[id];
  const source = asRecord(input);
  const created = def.create !== undefined && !hasId(source);
  const shape = routeShape(def, created);
  const names = pathParamNames(shape.path);
  const params: Record<string, string> = {};
  for (const name of names) {
    const value = source[name];
    if (typeof value !== 'string' || value === '') {
      throw new Error(`Input ${id} tidak memuat "${name}" untuk jalur ${shape.path}`);
    }
    params[name] = value;
  }
  const kinds = def.query ?? {};
  const query: Record<string, string> = {};
  const rest: AnyRecord = {};
  let ifMatch: string | undefined;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || names.includes(key)) continue;
    if (key === def.ifMatch) {
      if (typeof value === 'string' && value !== '') ifMatch = value;
      continue;
    }
    const kind = kinds[key];
    if (kind === undefined) {
      rest[key] = value;
    } else if (value !== null) {
      query[key] = queryText(kind, value);
    }
  }
  if (BODY_VERBS.has(shape.verb)) {
    return { verb: shape.verb, path: fillPath(shape.path, params), query, body: rest, ifMatch };
  }
  if (Object.keys(rest).length > 0) {
    throw new Error(
      `Field ${Object.keys(rest).join(', ')} tidak dideklarasikan sebagai query untuk ${id}`,
    );
  }
  return { verb: shape.verb, path: fillPath(shape.path, params), query, ifMatch };
}

function parseQueryValue(field: string, kind: QueryKind, text: string): unknown {
  if (kind === 'list') return text === '' ? [] : text.split(',');
  if (kind === 'number') {
    if (text.trim() === '' || !Number.isFinite(Number(text))) {
      throw { field, message: 'Harus berupa angka' } satisfies ApiFieldIssue;
    }
    return Number(text);
  }
  if (kind === 'boolean') {
    if (text !== 'true' && text !== 'false') {
      throw { field, message: 'Harus true atau false' } satisfies ApiFieldIssue;
    }
    return text === 'true';
  }
  return text;
}

/**
 * Kebalikan `toRequestParts`: merakit input datar (siap `validate`) dari jalur + query + badan + `If-Match`.
 * Parameter jalur menang atas badan: nilai badan yang berbeda dari jalur = galat. Field `If-Match` hanya dibaca
 * dari header (nilai badan dengan nama sama dibuang). Galat parameter dilempar sebagai `ApiFieldIssue`.
 * Rute tanpa input (`null`) dikenali dari: GET tanpa parameter jalur dan tanpa query.
 */
export function fromRequestParts<M extends WorkerRpcMethod>(id: M, parts: ParsedParts): unknown {
  const def = API_ROUTES[id];
  const shape = routeShape(def, parts.created);
  const names = pathParamNames(shape.path);
  const kinds = def.query ?? {};
  if (shape.verb === 'GET' && names.length === 0 && def.query === undefined) return null;

  const input: AnyRecord = {};
  if (BODY_VERBS.has(shape.verb)) {
    const body = parts.body;
    if (body !== undefined && body !== null) {
      if (typeof body !== 'object' || Array.isArray(body)) {
        throw { field: 'body', message: 'Badan harus berupa objek JSON' } satisfies ApiFieldIssue;
      }
      Object.assign(input, body);
    }
  }
  for (const [field, kind] of Object.entries(kinds)) {
    const text = parts.query[field];
    if (text !== undefined) input[field] = parseQueryValue(field, kind, text);
  }
  if (def.ifMatch !== undefined) {
    delete input[def.ifMatch];
    if (parts.ifMatch !== undefined) input[def.ifMatch] = parts.ifMatch;
  }
  for (const name of names) {
    const value = parts.params[name];
    if (value === undefined || value === '') {
      throw { field: name, message: 'Wajib diisi pada jalur' } satisfies ApiFieldIssue;
    }
    if (input[name] !== undefined && input[name] !== value) {
      throw {
        field: name,
        message: 'Nilai pada badan berbeda dari jalur',
      } satisfies ApiFieldIssue;
    }
    input[name] = value;
  }
  if (parts.created && def.create !== undefined) {
    const stray = pathParamNames(def.path).find(
      (name) => input[name] !== undefined && input[name] !== null && input[name] !== '',
    );
    if (stray !== undefined) {
      throw {
        field: stray,
        message: 'Tidak boleh diisi saat membuat; gunakan jalur ubah',
      } satisfies ApiFieldIssue;
    }
  }
  return input;
}

/** Nilai ETag dari keluaran (`undefined` bila rute tidak berETag atau field kosong). */
export function etagOf<M extends WorkerRpcMethod>(
  id: M,
  output: WorkerRpcOutput<M>,
): string | undefined {
  const field = API_ROUTES[id].etag;
  if (field === undefined || typeof output !== 'object' || output === null) return undefined;
  const value = (output as AnyRecord)[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Membungkus nilai menjadi ETag kuat bertanda kutip (tanda kutip di dalam nilai dibuang). */
export function formatEtag(value: string): string {
  return `"${value.replace(/"/g, '')}"`;
}

/**
 * Nilai `If-Match` tanpa kutip. `*`, banyak nilai (berkoma), dan header kosong diabaikan (`undefined`):
 * hanya satu nilai tunggal yang dipakai sebagai pembanding kontrol konkurensi.
 */
export function parseIfMatch(header: string | null | undefined): string | undefined {
  if (header === null || header === undefined) return undefined;
  const text = header.trim();
  if (text === '' || text === '*' || text.includes(',')) return undefined;
  const bare =
    text.startsWith('"') && text.endsWith('"') && text.length >= 2 ? text.slice(1, -1) : text;
  return bare === '' ? undefined : bare;
}

/** True bila `If-None-Match` memuat ETag itu (atau `*`); awalan lemah `W/` diabaikan. */
export function etagMatches(header: string | null | undefined, etag: string): boolean {
  if (header === null || header === undefined) return false;
  const quoted = formatEtag(etag);
  return header.split(',').some((part) => {
    const candidate = part.trim().replace(/^W\//, '');
    return candidate === '*' || candidate === quoted;
  });
}
