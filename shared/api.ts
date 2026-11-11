import type { ApiId, ApiInput, ApiOutput } from './contract';

// Tabel rute REST (`/api/v1`): SATU sumber untuk klien FE (`api()`), server (kernel REST), dan OpenAPI. Murni:
// tanpa API runtime (`shared/` murni, tanpa `URL`/`URLSearchParams`/`fetch`/`atob`), jadi query
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
  /**
   * Rute asinkron (202): jalur sumber daya yang dibuat, `{param}` diisi dari field keluaran (mis. `/jobs/{jobId}`);
   * kernel memberi header `Location: /api/v1<jalur>`.
   */
  location?: string;
  /** Penanda rute biner (dokumentasi OpenAPI); bentuk rinci ada di `rawBody`/`multipart`/`download`. */
  binary?: 'request' | 'response' | 'multipart';
  /** Badan permintaan mentah (unggah): `field` input memuat byte; Content-Type dari `mimeField` atau `contentType` tetap. */
  rawBody?: ApiRawBody;
  /** Badan multipart/form-data: tiap nama bagian = nama field input (byte). */
  multipart?: { parts: readonly string[]; maxBytes: number; tooLarge: string };
  /** Unduhan: isi respons = byte mentah; field keluaran lain dibentuk dari header. */
  download?: ApiDownload;
}

export interface ApiRawBody {
  field: string;
  mimeField?: string;
  contentType?: string;
  /** Batas byte badan; server memutus pembacaan begitu terlampaui (413). */
  maxBytes: number;
  /** Pesan galat 413 yang ramah pengguna. */
  tooLarge: string;
}

export interface ApiDownload {
  /** Field keluaran yang memuat byte. */
  bytesField: string;
  /** Field keluaran untuk Content-Type. */
  mimeField: string;
  /** Field keluaran untuk nama berkas (header Content-Disposition); tanpa = tidak ada header itu. */
  filenameField?: string;
  /** Field input yang disalin ke keluaran di sisi klien (mis. `id`). */
  echo?: readonly string[];
  /** `immutable` = isi tak pernah berubah untuk id yang sama; `revalidate` = selalu cek ETag. */
  cache: 'immutable' | 'revalidate';
}

// Batas ukuran di tabel ditulis sebagai angka literal agar `shared/api.ts` tak bergantung pada berkas lain
// (`MAX_IMAGE_BYTES`, `QR_LIMITS`).
// `api.test.ts` memastikan angka-angka ini sama dengan konstanta sumbernya.

export const API_ROUTES: { [M in ApiId]: ApiRouteDef } = {
  'auth.me': { verb: 'GET', path: '/me' },
  'access.users.list': { verb: 'GET', path: '/users' },
  'access.users.save': {
    verb: 'PUT',
    path: '/users/{id}',
    create: { verb: 'POST', path: '/users' },
  },
  'access.users.setStatus': { verb: 'PATCH', path: '/users/{id}', etag: 'updatedAt' },
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
  'access.locations.setStatus': { verb: 'PATCH', path: '/locations/{id}', etag: 'updatedAt' },
  'access.businessUnits.list': { verb: 'GET', path: '/business-units' },
  'access.businessUnits.save': {
    verb: 'PUT',
    path: '/business-units/{id}',
    create: { verb: 'POST', path: '/business-units' },
  },
  'access.businessUnits.setStatus': {
    verb: 'PATCH',
    path: '/business-units/{id}',
    etag: 'updatedAt',
  },
  'businessUnits.options': { verb: 'GET', path: '/business-units/options' },
  'files.upload': {
    verb: 'POST',
    path: '/files',
    status: 201,
    location: '/files/{id}',
    query: { width: 'number', height: 'number' },
    binary: 'request',
    rawBody: {
      field: 'bytes',
      mimeField: 'mime',
      maxBytes: 10_485_760, // = MAX_IMAGE_BYTES (shared/files.ts)
      tooLarge: 'Ukuran gambar maksimal 10 MB',
    },
  },
  'files.get': {
    verb: 'GET',
    path: '/files/{id}',
    etag: 'id',
    binary: 'response',
    download: { bytesField: 'bytes', mimeField: 'mime', echo: ['id'], cache: 'immutable' },
  },
  'stickerGuides.list': {
    verb: 'GET',
    path: '/sticker-guides',
    query: {
      search: 'string',
      sort: 'string',
      mine: 'boolean',
      unused: 'boolean',
      cursor: 'string',
      limit: 'number',
    },
  },
  'stickerGuides.upload': {
    verb: 'POST',
    path: '/sticker-guides',
    status: 201,
    location: '/sticker-guides/{id}',
    query: {
      name: 'string',
      mime: 'string',
      thumbMime: 'string',
      width: 'number',
      height: 'number',
    },
    binary: 'multipart',
    multipart: {
      parts: ['image', 'thumbnail'],
      // = MAX_IMAGE_BYTES + GUIDE_LIMITS.thumbMaxBytes + 64 KB ruang batas bagian dan header multipart
      maxBytes: 10_592_256,
      tooLarge: 'Ukuran gambar maksimal 10 MB',
    },
  },
  'stickerGuides.rename': { verb: 'PATCH', path: '/sticker-guides/{id}' },
  'stickerGuides.remove': { verb: 'DELETE', path: '/sticker-guides/{id}' },
  'stickerGuides.thumbnail': {
    verb: 'GET',
    path: '/sticker-guides/{id}/thumbnail',
    etag: 'id',
    binary: 'response',
    download: { bytesField: 'bytes', mimeField: 'mime', echo: ['id'], cache: 'immutable' },
  },
  'stickerGuides.usages': { verb: 'GET', path: '/sticker-guides/{id}/usages' },
  'brands.list': { verb: 'GET', path: '/brands' },
  'brands.save': {
    verb: 'PUT',
    path: '/brands/{id}',
    create: { verb: 'POST', path: '/brands' },
  },
  'brands.setStatus': { verb: 'PATCH', path: '/brands/{id}', etag: 'updatedAt' },
  'stickerSettings.get': { verb: 'GET', path: '/sticker-settings', etag: 'updatedAt' },
  'stickerSettings.save': {
    verb: 'PUT',
    path: '/sticker-settings',
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'stickerTypes.list': { verb: 'GET', path: '/sticker-types' },
  'stickerTypes.save': {
    verb: 'PUT',
    path: '/sticker-types/{id}',
    create: { verb: 'POST', path: '/sticker-types' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'stickerTypes.setStatus': { verb: 'PATCH', path: '/sticker-types/{id}', etag: 'updatedAt' },
  'stickers.list': { verb: 'GET', path: '/stickers' },
  'stickers.save': {
    verb: 'PUT',
    path: '/stickers/{id}',
    create: { verb: 'POST', path: '/stickers' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'stickers.setStatus': { verb: 'PATCH', path: '/stickers/{id}', etag: 'updatedAt' },
  'stickerStock.list': { verb: 'GET', path: '/sticker-stock', query: { locationIds: 'list' } },
  'stickerStock.record': { verb: 'POST', path: '/sticker-stock/entries', status: 201 },
  'stickerStock.adjust': { verb: 'POST', path: '/sticker-stock/adjustments', status: 201 },
  'stickerStock.opname': { verb: 'POST', path: '/sticker-stock/opname' },
  'stickerStock.history': {
    verb: 'GET',
    path: '/sticker-stock/entries',
    query: { locationIds: 'list', stickerId: 'string', cursor: 'string', limit: 'number' },
  },
  'customers.list': { verb: 'GET', path: '/customers' },
  'customers.rename': { verb: 'PUT', path: '/customers/{id}' },
  'customers.setStatus': { verb: 'PATCH', path: '/customers/{id}', etag: 'updatedAt' },
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
    query: {
      cursor: 'string',
      limit: 'number',
      query: 'string',
      status: 'string',
      instruction: 'string',
      stickerId: 'string',
      typeId: 'string',
      stickerMode: 'string',
      manualBook: 'string',
      postel: 'string',
    },
  },
  'items.get': { verb: 'GET', path: '/items/{id}', etag: 'updatedAt' },
  'items.save': {
    verb: 'PUT',
    path: '/items/{id}',
    create: { verb: 'POST', path: '/items' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'items.setStatus': { verb: 'PATCH', path: '/items/{id}', etag: 'updatedAt' },
  'qrcodes.list': { verb: 'GET', path: '/qrcodes' },
  'qrcodes.get': { verb: 'GET', path: '/qrcodes/{id}', etag: 'updatedAt' },
  'qrcodes.versions': { verb: 'GET', path: '/qrcodes/{id}/versions' },
  'qrcodes.save': {
    verb: 'PUT',
    path: '/qrcodes/{id}',
    create: { verb: 'POST', path: '/qrcodes' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'qrcodes.delete': { verb: 'DELETE', path: '/qrcodes/{id}' },
  'qrcodes.getDefaults': { verb: 'GET', path: '/qrcode-defaults' },
  'qrcodes.itemOptions': {
    verb: 'GET',
    path: '/qrcode-item-options',
    query: { query: 'string', cursor: 'string', limit: 'number' },
  },
  'qrcodes.savePreset': {
    verb: 'PUT',
    path: '/qrcode-presets/{id}',
    create: { verb: 'POST', path: '/qrcode-presets' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'qrcodes.clonePreset': { verb: 'POST', path: '/qrcode-presets/{id}/clone', status: 201 },
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
    rawBody: {
      field: 'bytes',
      contentType: 'application/pdf',
      maxBytes: 10_485_760, // = QR_LIMITS.documentMaxBytes (shared/qrcode.ts)
      tooLarge: 'Ukuran PDF maksimal 10 MB',
    },
  },
  'qrcodes.cloneFromDrive': { verb: 'POST', path: '/qrcode-documents/clone' },
  'qrcodes.export': {
    verb: 'POST',
    path: '/qrcodes/{id}/exports',
    status: 202,
    location: '/jobs/{jobId}',
    ifMatch: 'expectedUpdatedAt',
    query: { reason: 'string' },
    binary: 'multipart',
    multipart: {
      parts: ['pdf', 'png', 'preview'],
      // = QR_LIMITS.exportMaxBytes (8 MB) + QR_LIMITS.previewMaxBytes (512 KB) + 64 KB ruang batas bagian dan header
      maxBytes: 8_978_432,
      tooLarge: 'Ukuran hasil ekspor maksimal 8 MB',
    },
  },
  'qrcodes.file': {
    verb: 'GET',
    path: '/qrcodes/{id}/files/{kind}',
    etag: 'etag',
    binary: 'response',
    download: {
      bytesField: 'bytes',
      mimeField: 'mime',
      filenameField: 'filename',
      cache: 'revalidate',
    },
  },
  // `postels.itemOptions` didaftarkan SEBELUM rute `/postels/{id}` agar jalur statis tidak tertangkap parameter id.
  'postels.itemOptions': {
    verb: 'GET',
    path: '/postels/item-options',
    query: { query: 'string', cursor: 'string', limit: 'number' },
  },
  'postels.list': { verb: 'GET', path: '/postels' },
  'postels.get': { verb: 'GET', path: '/postels/{id}', etag: 'updatedAt' },
  'postels.save': {
    verb: 'PUT',
    path: '/postels/{id}',
    create: { verb: 'POST', path: '/postels', status: 201 },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'postels.remove': { verb: 'DELETE', path: '/postels/{id}' },
  'postels.history': {
    verb: 'GET',
    path: '/postels/{id}/history',
    query: { cursor: 'string', limit: 'number' },
  },
  'postelFiles.upload': {
    verb: 'POST',
    path: '/postel-files',
    status: 201,
    location: '/postel-files/{id}',
    binary: 'request',
    rawBody: {
      field: 'bytes',
      mimeField: 'mime',
      maxBytes: 10_485_760, // = POSTEL_LIMITS.attachmentMaxBytes = MAX_IMAGE_BYTES
      tooLarge: 'Ukuran lampiran maksimal 10 MB',
    },
  },
  'postelFiles.get': {
    verb: 'GET',
    path: '/postel-files/{id}',
    etag: 'id',
    binary: 'response',
    download: {
      bytesField: 'bytes',
      mimeField: 'mime',
      filenameField: 'filename',
      echo: ['id'],
      cache: 'immutable',
    },
  },
  'jobs.get': { verb: 'GET', path: '/jobs/{id}' },
  'exports.sheets': {
    verb: 'POST',
    path: '/exports/sheets',
    status: 202,
    location: '/jobs/{jobId}',
  },
};

export interface RequestParts {
  verb: ApiVerb;
  /** Jalur relatif terhadap `/api/v1`, parameter sudah terisi (nilai di-encode). */
  path: string;
  query: Record<string, string>;
  /** Ada hanya untuk POST/PUT/PATCH. */
  body?: unknown;
  /** Badan mentah (rute `rawBody`): byte dan Content-Type. */
  raw?: { data: Uint8Array; contentType: string };
  /** Bagian multipart (rute `multipart`): nama bagian -> byte. */
  multipart?: Record<string, Uint8Array>;
  /** Nilai `If-Match` TANPA tanda kutip (pemanggil yang membungkusnya, lihat `formatEtag`). */
  ifMatch?: string;
}

export interface ParsedParts {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  /** Badan mentah yang sudah dibaca server (rute `rawBody`) dan Content-Type tanpa parameter. */
  raw?: { data: Uint8Array; contentType: string };
  /** Bagian multipart yang ada (nama -> byte). */
  multipart?: Record<string, Uint8Array>;
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
export function toRequestParts<M extends ApiId>(id: M, input: ApiInput<M>): RequestParts {
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
  const path = fillPath(shape.path, params);
  if (def.rawBody !== undefined) {
    const { field, mimeField } = def.rawBody;
    const data = rest[field];
    delete rest[field];
    const contentType = mimeField === undefined ? def.rawBody.contentType : rest[mimeField];
    if (mimeField !== undefined) delete rest[mimeField];
    if (!(data instanceof Uint8Array) || typeof contentType !== 'string' || contentType === '') {
      throw new Error(`Input ${id} harus memuat byte "${field}" dan jenis isinya`);
    }
    assertNoStray(id, rest);
    return { verb: shape.verb, path, query, raw: { data, contentType }, ifMatch };
  }
  if (def.multipart !== undefined) {
    const parts: Record<string, Uint8Array> = {};
    for (const name of def.multipart.parts) {
      const data = rest[name];
      delete rest[name];
      if (!(data instanceof Uint8Array)) throw new Error(`Input ${id} harus memuat byte "${name}"`);
      parts[name] = data;
    }
    assertNoStray(id, rest);
    return { verb: shape.verb, path, query, multipart: parts, ifMatch };
  }
  if (BODY_VERBS.has(shape.verb)) {
    return { verb: shape.verb, path, query, body: rest, ifMatch };
  }
  if (Object.keys(rest).length > 0) {
    throw new Error(
      `Field ${Object.keys(rest).join(', ')} tidak dideklarasikan sebagai query untuk ${id}`,
    );
  }
  return { verb: shape.verb, path, query, ifMatch };
}

function assertNoStray(id: string, rest: AnyRecord): void {
  if (Object.keys(rest).length > 0) {
    throw new Error(`Field ${Object.keys(rest).join(', ')} tidak dapat dikirim untuk ${id}`);
  }
}

export function parseQueryValue(field: string, kind: QueryKind, text: string): unknown {
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

/** Nama properti badan JSON yang tidak pernah disalin ke input (lihat `fromRequestParts`). */
const UNSAFE_BODY_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Kebalikan `toRequestParts`: merakit input datar (siap `validate`) dari jalur + query + badan + `If-Match`.
 * Parameter jalur menang atas badan: nilai badan yang berbeda dari jalur = galat. Field `If-Match` hanya dibaca
 * dari header (nilai badan dengan nama sama dibuang). Galat parameter dilempar sebagai `ApiFieldIssue`.
 * Rute tanpa input (`null`) dikenali dari: GET tanpa parameter jalur dan tanpa query.
 */
export function fromRequestParts<M extends ApiId>(id: M, parts: ParsedParts): unknown {
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
      // Salin hanya properti milik dan lewati nama prototipe: `Object.assign` memanggil setter `__proto__` sehingga
      // nilai warisan (mis. expectedUpdatedAt) lolos dari `delete` aturan "If-Match hanya dari header".
      for (const key of Object.keys(body)) {
        if (UNSAFE_BODY_KEYS.has(key)) continue;
        input[key] = (body as AnyRecord)[key];
      }
    }
  }
  for (const [field, kind] of Object.entries(kinds)) {
    const text = parts.query[field];
    if (text !== undefined) input[field] = parseQueryValue(field, kind, text);
  }
  if (def.rawBody !== undefined) {
    const { field, mimeField } = def.rawBody;
    delete input[field];
    if (parts.raw !== undefined) input[field] = parts.raw.data;
    if (mimeField !== undefined) {
      delete input[mimeField];
      if (parts.raw !== undefined) input[mimeField] = parts.raw.contentType;
    }
  }
  if (def.multipart !== undefined) {
    for (const name of def.multipart.parts) {
      delete input[name];
      const data = parts.multipart?.[name];
      if (data !== undefined) input[name] = data;
    }
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
export function etagOf<M extends ApiId>(id: M, output: ApiOutput<M>): string | undefined {
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

/** Pembaca header minimal (dipenuhi `Headers` peramban dan Bun) agar berkas ini tetap murni. */
export interface HeaderReader {
  get(name: string): string | null;
}

/** Nama berkas untuk header: tanpa karakter kendali, tanda kutip, dan garis miring terbalik. */
function cleanFilename(filename: string): string {
  let out = '';
  for (const ch of filename) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f || ch === '"' || ch === '\\' ? '_' : ch;
  }
  return out === '' ? 'berkas' : out;
}

/** `Content-Disposition: attachment` dengan cadangan ASCII dan `filename*` UTF-8 (RFC 6266/5987). */
export function contentDispositionOf(filename: string): string {
  const clean = cleanFilename(filename);
  let ascii = '';
  for (const ch of clean) {
    const code = ch.charCodeAt(0);
    ascii += code < 0x20 || code > 0x7e || ch === '%' ? '_' : ch;
  }
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Nama berkas dari `Content-Disposition` (`filename*` didahulukan); string kosong bila tak ada. */
export function filenameFromDisposition(header: string | null | undefined): string {
  if (header === null || header === undefined) return '';
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1] !== undefined) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // jatuh ke filename biasa
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header);
  return plain?.[1] ?? '';
}

/**
 * Keluaran sisi klien untuk rute `download`: byte dari badan respons, MIME dari Content-Type, nama berkas dari
 * Content-Disposition, field `echo` disalin dari input, dan field ETag (bila ada) dari header `ETag`.
 */
export function downloadOutput<M extends ApiId>(
  id: M,
  input: ApiInput<M>,
  headers: HeaderReader,
  bytes: Uint8Array,
): ApiOutput<M> {
  const def = API_ROUTES[id];
  const spec = def.download;
  if (spec === undefined) throw new Error(`Rute ${id} bukan unduhan`);
  const source = asRecord(input);
  const output: AnyRecord = {};
  for (const field of spec.echo ?? []) output[field] = source[field];
  output[spec.bytesField] = bytes;
  output[spec.mimeField] = (headers.get('content-type') ?? 'application/octet-stream')
    .split(';')[0]
    ?.trim();
  if (spec.filenameField !== undefined) {
    output[spec.filenameField] = filenameFromDisposition(headers.get('content-disposition'));
  }
  if (def.etag !== undefined && output[def.etag] === undefined) {
    const raw = headers.get('etag');
    if (raw !== null) output[def.etag] = raw.replace(/^W\//, '').replace(/"/g, '');
  }
  return output as ApiOutput<M>;
}
