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
  'access.users.list': { verb: 'GET', path: '/users', query: { status: 'string' } },
  'access.users.get': { verb: 'GET', path: '/users/{id}', etag: 'updatedAt' },
  'access.users.save': {
    verb: 'PUT',
    path: '/users/{id}',
    create: { verb: 'POST', path: '/users' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'access.users.setStatus': { verb: 'PATCH', path: '/users/{id}', etag: 'updatedAt' },
  // Urutan tabel = urutan pendaftaran: `/users/batch/restore` harus SEBELUM `/users/{id}/restore`.
  'access.users.setStatusBatch': { verb: 'POST', path: '/users/batch/status' },
  'access.users.remove': { verb: 'DELETE', path: '/users/{id}' },
  'access.users.removeBatch': { verb: 'POST', path: '/users/batch/delete' },
  'access.users.restoreBatch': { verb: 'POST', path: '/users/batch/restore' },
  'access.users.restore': { verb: 'POST', path: '/users/{id}/restore', etag: 'updatedAt' },
  'access.roles.list': { verb: 'GET', path: '/roles', query: { status: 'string' } },
  'access.roles.get': { verb: 'GET', path: '/roles/{id}', etag: 'updatedAt' },
  'access.roles.save': {
    verb: 'PUT',
    path: '/roles/{id}',
    create: { verb: 'POST', path: '/roles' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'access.roles.delete': { verb: 'DELETE', path: '/roles/{id}' },
  'access.roles.removeBatch': { verb: 'POST', path: '/roles/batch/delete' },
  'access.roles.restoreBatch': { verb: 'POST', path: '/roles/batch/restore' },
  'access.roles.restore': { verb: 'POST', path: '/roles/{id}/restore', etag: 'updatedAt' },
  'access.audit.list': {
    verb: 'GET',
    path: '/audit-logs',
    query: {
      cursor: 'string',
      limit: 'number',
      action: 'string',
      query: 'string',
      actions: 'list',
    },
  },
  'activity.list': {
    verb: 'GET',
    path: '/activity',
    query: { kind: 'string', id: 'string', cursor: 'string', limit: 'number' },
  },
  'access.locations.list': { verb: 'GET', path: '/locations', query: { status: 'string' } },
  'access.locations.get': { verb: 'GET', path: '/locations/{id}', etag: 'updatedAt' },
  'access.locations.save': {
    verb: 'PUT',
    path: '/locations/{id}',
    create: { verb: 'POST', path: '/locations' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'access.locations.setStatus': { verb: 'PATCH', path: '/locations/{id}', etag: 'updatedAt' },
  'access.locations.setStatusBatch': { verb: 'POST', path: '/locations/batch/status' },
  'access.locations.remove': { verb: 'DELETE', path: '/locations/{id}' },
  'access.locations.removeBatch': { verb: 'POST', path: '/locations/batch/delete' },
  'access.locations.restoreBatch': { verb: 'POST', path: '/locations/batch/restore' },
  'access.locations.restore': {
    verb: 'POST',
    path: '/locations/{id}/restore',
    etag: 'updatedAt',
  },
  'access.businessUnits.list': {
    verb: 'GET',
    path: '/business-units',
    query: { status: 'string' },
  },
  // `/business-units/options` harus terdaftar SEBELUM `/business-units/{id}` (jalur statis lebih dulu).
  'businessUnits.options': { verb: 'GET', path: '/business-units/options' },
  'access.businessUnits.get': {
    verb: 'GET',
    path: '/business-units/{id}',
    etag: 'updatedAt',
  },
  'access.businessUnits.save': {
    verb: 'PUT',
    path: '/business-units/{id}',
    create: { verb: 'POST', path: '/business-units' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'access.businessUnits.setStatus': {
    verb: 'PATCH',
    path: '/business-units/{id}',
    etag: 'updatedAt',
  },
  'access.businessUnits.setStatusBatch': { verb: 'POST', path: '/business-units/batch/status' },
  'access.businessUnits.remove': { verb: 'DELETE', path: '/business-units/{id}' },
  'access.businessUnits.removeBatch': { verb: 'POST', path: '/business-units/batch/delete' },
  'access.businessUnits.restoreBatch': { verb: 'POST', path: '/business-units/batch/restore' },
  'access.businessUnits.restore': {
    verb: 'POST',
    path: '/business-units/{id}/restore',
    etag: 'updatedAt',
  },
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
  'stickerGuides.removeBatch': { verb: 'POST', path: '/sticker-guides/batch/delete' },
  'stickerGuides.thumbnail': {
    verb: 'GET',
    path: '/sticker-guides/{id}/thumbnail',
    etag: 'id',
    binary: 'response',
    download: { bytesField: 'bytes', mimeField: 'mime', echo: ['id'], cache: 'immutable' },
  },
  'stickerGuides.usages': { verb: 'GET', path: '/sticker-guides/{id}/usages' },
  'brands.list': { verb: 'GET', path: '/brands', query: { status: 'string' } },
  'brands.get': { verb: 'GET', path: '/brands/{id}', etag: 'updatedAt' },
  'brands.save': {
    verb: 'PUT',
    path: '/brands/{id}',
    create: { verb: 'POST', path: '/brands' },
  },
  'brands.setStatus': { verb: 'PATCH', path: '/brands/{id}', etag: 'updatedAt' },
  // Urutan tabel = urutan pendaftaran: `/brands/batch/restore` harus SEBELUM `/brands/{id}/restore`.
  'brands.setStatusBatch': { verb: 'POST', path: '/brands/batch/status' },
  'brands.remove': { verb: 'DELETE', path: '/brands/{id}' },
  'brands.removeBatch': { verb: 'POST', path: '/brands/batch/delete' },
  'brands.restoreBatch': { verb: 'POST', path: '/brands/batch/restore' },
  'brands.restore': { verb: 'POST', path: '/brands/{id}/restore', etag: 'updatedAt' },
  'stickerSettings.get': { verb: 'GET', path: '/sticker-settings', etag: 'updatedAt' },
  'stickerSettings.save': {
    verb: 'PUT',
    path: '/sticker-settings',
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'stickerTypes.list': { verb: 'GET', path: '/sticker-types', query: { status: 'string' } },
  'stickerTypes.get': { verb: 'GET', path: '/sticker-types/{id}', etag: 'updatedAt' },
  'stickerTypes.save': {
    verb: 'PUT',
    path: '/sticker-types/{id}',
    create: { verb: 'POST', path: '/sticker-types' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'stickerTypes.setStatus': { verb: 'PATCH', path: '/sticker-types/{id}', etag: 'updatedAt' },
  // Urutan tabel = urutan pendaftaran: `/sticker-types/batch/restore` harus SEBELUM `/sticker-types/{id}/restore`.
  'stickerTypes.setStatusBatch': { verb: 'POST', path: '/sticker-types/batch/status' },
  'stickerTypes.remove': { verb: 'DELETE', path: '/sticker-types/{id}' },
  'stickerTypes.removeBatch': { verb: 'POST', path: '/sticker-types/batch/delete' },
  'stickerTypes.restoreBatch': { verb: 'POST', path: '/sticker-types/batch/restore' },
  'stickerTypes.restore': { verb: 'POST', path: '/sticker-types/{id}/restore', etag: 'updatedAt' },
  'stickers.list': { verb: 'GET', path: '/stickers', query: { status: 'string' } },
  'stickers.get': { verb: 'GET', path: '/stickers/{id}', etag: 'updatedAt' },
  'stickers.save': {
    verb: 'PUT',
    path: '/stickers/{id}',
    create: { verb: 'POST', path: '/stickers' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'stickers.setStatus': { verb: 'PATCH', path: '/stickers/{id}', etag: 'updatedAt' },
  // Urutan tabel = urutan pendaftaran: `/stickers/batch/restore` harus SEBELUM `/stickers/{id}/restore`.
  'stickers.setStatusBatch': { verb: 'POST', path: '/stickers/batch/status' },
  'stickers.remove': { verb: 'DELETE', path: '/stickers/{id}' },
  'stickers.removeBatch': { verb: 'POST', path: '/stickers/batch/delete' },
  'stickers.restoreBatch': { verb: 'POST', path: '/stickers/batch/restore' },
  'stickers.restore': { verb: 'POST', path: '/stickers/{id}/restore', etag: 'updatedAt' },
  'stickerStock.list': { verb: 'GET', path: '/sticker-stock', query: { locationIds: 'list' } },
  'stickerStock.record': { verb: 'POST', path: '/sticker-stock/entries', status: 201 },
  'stickerStock.adjust': { verb: 'POST', path: '/sticker-stock/adjustments', status: 201 },
  'stickerStock.recordBatch': { verb: 'POST', path: '/sticker-stock/entries/batch', status: 201 },
  'stickerStock.adjustBatch': {
    verb: 'POST',
    path: '/sticker-stock/adjustments/batch',
    status: 201,
  },
  'stickerStock.opname': { verb: 'POST', path: '/sticker-stock/opname' },
  'stickerStock.history': {
    verb: 'GET',
    path: '/sticker-stock/entries',
    query: { locationIds: 'list', stickerId: 'string', cursor: 'string', limit: 'number' },
  },
  'customers.list': { verb: 'GET', path: '/customers', query: { status: 'string' } },
  'customers.get': { verb: 'GET', path: '/customers/{id}', etag: 'updatedAt' },
  'customers.rename': { verb: 'PUT', path: '/customers/{id}' },
  'customers.setStatus': { verb: 'PATCH', path: '/customers/{id}', etag: 'updatedAt' },
  'customers.setStatusBatch': { verb: 'POST', path: '/customers/batch/status' },
  'customers.remove': { verb: 'DELETE', path: '/customers/{id}' },
  'customers.removeBatch': { verb: 'POST', path: '/customers/batch/delete' },
  'customers.restoreBatch': { verb: 'POST', path: '/customers/batch/restore' },
  'customers.restore': { verb: 'POST', path: '/customers/{id}/restore', etag: 'updatedAt' },
  'handovers.options': { verb: 'GET', path: '/handovers/options', query: { locationIds: 'list' } },
  'handovers.board': {
    verb: 'GET',
    path: '/handovers',
    query: {
      locationIds: 'list',
      status: 'string',
      cursor: 'string',
      limit: 'number',
      customerId: 'string',
      customerIds: 'list',
      deleted: 'boolean',
    },
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
  // Hapus lunak per task (fase 4d; tanpa rute batch, keputusan pemilik soft delete 8): lokasi task lewat `locationId`,
  // tanpa penjaga versi dari klien (spek soft delete §8 butir 6); `restore` mengembalikan DTO sehingga `etag` = `updatedAt`.
  'handovers.remove': { verb: 'DELETE', path: '/handovers/{id}', query: { locationId: 'string' } },
  'handovers.restore': { verb: 'POST', path: '/handovers/{id}/restore', etag: 'updatedAt' },
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
      brandId: 'string',
      buId: 'string',
      brandIds: 'list',
      buIds: 'list',
      typeIds: 'list',
    },
  },
  // Katalog nama Item untuk saran editor checklist (statis, SEBELUM `/items/{id}`).
  'items.nameOptions': { verb: 'GET', path: '/items/name-options' },
  'items.get': { verb: 'GET', path: '/items/{id}', etag: 'updatedAt' },
  'items.save': {
    verb: 'PUT',
    path: '/items/{id}',
    create: { verb: 'POST', path: '/items' },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'items.setStatus': { verb: 'PATCH', path: '/items/{id}', etag: 'updatedAt' },
  'items.setStatusBatch': { verb: 'POST', path: '/items/batch/status' },
  'items.remove': { verb: 'DELETE', path: '/items/{id}' },
  'items.removeBatch': { verb: 'POST', path: '/items/batch/delete' },
  // `/items/batch/restore` SEBELUM `/items/{id}/restore` (urutan tabel = urutan pendaftaran; jalur statis harus lebih dulu).
  'items.restoreBatch': { verb: 'POST', path: '/items/batch/restore' },
  'items.restore': { verb: 'POST', path: '/items/{id}/restore', etag: 'updatedAt' },
  'qrcodes.list': { verb: 'GET', path: '/qrcodes', query: { status: 'string' } },
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
  // `/qrcodes/batch/restore` SEBELUM `/qrcodes/{id}/restore` (urutan tabel = urutan pendaftaran; jalur statis lebih dulu).
  'qrcodes.removeBatch': { verb: 'POST', path: '/qrcodes/batch/delete' },
  'qrcodes.restoreBatch': { verb: 'POST', path: '/qrcodes/batch/restore' },
  'qrcodes.restore': { verb: 'POST', path: '/qrcodes/{id}/restore', etag: 'updatedAt' },
  'qrcodes.getDefaults': { verb: 'GET', path: '/qrcode-defaults', query: { status: 'string' } },
  'qrcodes.getPreset': { verb: 'GET', path: '/qrcode-presets/{id}', etag: 'updatedAt' },
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
  // `/qrcode-presets/batch/restore` SEBELUM `/qrcode-presets/{id}/restore`.
  'qrcodes.removePresetBatch': { verb: 'POST', path: '/qrcode-presets/batch/delete' },
  'qrcodes.restorePresetBatch': { verb: 'POST', path: '/qrcode-presets/batch/restore' },
  'qrcodes.restorePreset': {
    verb: 'POST',
    path: '/qrcode-presets/{id}/restore',
    etag: 'updatedAt',
  },
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
  'postels.list': { verb: 'GET', path: '/postels', query: { status: 'string' } },
  // Serial Number: rute statis (`item-options`, `sticker-options`) didaftarkan SEBELUM `/serials/{id}` kelak.
  'serials.itemOptions': {
    verb: 'GET',
    path: '/serials/item-options',
    query: { query: 'string', cursor: 'string', limit: 'number', itemIds: 'list' },
  },
  'serials.creatorOptions': {
    verb: 'GET',
    path: '/serials/creator-options',
    query: { query: 'string', ids: 'list', cursor: 'string', limit: 'number' },
  },
  'serials.stickerOptions': {
    verb: 'GET',
    path: '/serials/sticker-options',
    query: { itemId: 'string', buId: 'string', serialId: 'string' },
  },
  'serials.locationOptions': { verb: 'GET', path: '/serials/location-options' },
  'serials.buOptions': { verb: 'GET', path: '/serials/bu-options' },
  'serials.serviceLocations': { verb: 'GET', path: '/serials/service-locations' },
  'serials.lookup': { verb: 'GET', path: '/serials/lookup', query: { serial: 'string' } },
  'serials.lookupMany': { verb: 'POST', path: '/serials/lookup-many', status: 200 },
  'serials.reportNew': { verb: 'POST', path: '/serials/report', status: 200 },
  'serials.saveBatch': { verb: 'POST', path: '/serials/batch', status: 200 },
  'serials.list': {
    verb: 'GET',
    path: '/serials',
    query: {
      query: 'string',
      serials: 'string',
      buId: 'string',
      itemId: 'string',
      locationId: 'string',
      status: 'string',
      custody: 'string',
      buIds: 'list',
      itemIds: 'list',
      locationIds: 'list',
      statuses: 'list',
      custodies: 'list',
      from: 'string',
      to: 'string',
      createdBy: 'string',
      createdBys: 'list',
      deleted: 'boolean',
      whRecorded: 'string',
      needsProof: 'boolean',
      cursor: 'string',
      limit: 'number',
    },
  },
  // Hapus lunak (fase 4d). Rute statis `/serials/batch/...` SEBELUM `/serials/{id}/...` (urutan tabel = urutan pendaftaran).
  'serials.removeBatch': { verb: 'POST', path: '/serials/batch/delete' },
  'serials.restoreBatch': { verb: 'POST', path: '/serials/batch/restore' },
  // Tempel stiker massal (R1): statis, SEBELUM `/serials/{id}`.
  'serials.applyStickersBatch': { verb: 'POST', path: '/serials/batch/stickers', status: 200 },
  'serials.remove': { verb: 'DELETE', path: '/serials/{id}' },
  'serials.restore': { verb: 'POST', path: '/serials/{id}/restore', etag: 'updatedAt' },
  'serials.history': {
    verb: 'GET',
    path: '/serials/{id}/history',
    query: { group: 'string', caseId: 'string', cursor: 'string', limit: 'number' },
  },
  'serials.get': { verb: 'GET', path: '/serials/{id}' },
  'serials.update': {
    verb: 'PUT',
    path: '/serials/{id}',
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'serials.updateBatch': { verb: 'POST', path: '/serials/batch-update', status: 200 },
  'serials.act': {
    verb: 'POST',
    path: '/serials/{id}/act',
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
    status: 200,
  },
  'postels.get': { verb: 'GET', path: '/postels/{id}', etag: 'updatedAt' },
  'postels.save': {
    verb: 'PUT',
    path: '/postels/{id}',
    create: { verb: 'POST', path: '/postels', status: 201 },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'postels.remove': { verb: 'DELETE', path: '/postels/{id}' },
  // `/postels/batch/delete` dan `/postels/batch/restore` SEBELUM `/postels/{id}/restore` (jalur statis lebih dulu).
  'postels.removeBatch': { verb: 'POST', path: '/postels/batch/delete' },
  'postels.restoreBatch': { verb: 'POST', path: '/postels/batch/restore' },
  'postels.restore': { verb: 'POST', path: '/postels/{id}/restore', etag: 'updatedAt' },
  'serialSettings.get': { verb: 'GET', path: '/serial-settings', etag: 'updatedAt' },
  'serialSettings.save': {
    verb: 'PUT',
    path: '/serial-settings',
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'serialServiceSettings.get': {
    verb: 'GET',
    path: '/serial-service-settings',
    etag: 'updatedAt',
  },
  'serialServiceSettings.save': {
    verb: 'PUT',
    path: '/serial-service-settings',
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'serialCases.list': {
    verb: 'GET',
    path: '/serial-cases',
    query: {
      status: 'string',
      buId: 'string',
      buIds: 'list',
      query: 'string',
      cursor: 'string',
      limit: 'number',
    },
  },
  // Rute statis `/serial-cases` (daftar) terdaftar di atas, sebelum yang berparameter.
  'serialCases.get': { verb: 'GET', path: '/serial-cases/{id}' },
  // Keluar Gudang (WH). Jalur statis SEBELUM yang berparameter (urutan tabel = urutan pendaftaran).
  'serialWarehouse.itemOptions': {
    verb: 'GET',
    path: '/serial-warehouse/item-options',
    query: { query: 'string', buId: 'string', ids: 'list', cursor: 'string', limit: 'number' },
  },
  'serialWarehouse.options': { verb: 'GET', path: '/serial-warehouse/options' },
  'serialWarehouse.serials': {
    verb: 'GET',
    path: '/serial-warehouse/serials',
    query: {
      itemId: 'string',
      buIds: 'list',
      locationId: 'string',
      testDate: 'string',
      query: 'string',
      hideRecordedBuId: 'string',
      forMode: 'string',
      cursor: 'string',
      limit: 'number',
    },
  },
  'serialWarehouse.lookup': { verb: 'POST', path: '/serial-warehouse/lookup', status: 200 },
  'serialWarehouse.orderOptions': {
    verb: 'GET',
    path: '/serial-warehouse/order-options',
    query: { query: 'string', buId: 'string', ids: 'list', cursor: 'string', limit: 'number' },
  },
  'serialWarehouse.handoverCandidates': {
    verb: 'GET',
    path: '/serial-warehouse/handover-candidates',
    query: {
      customerId: 'string',
      customerName: 'string',
      query: 'string',
      includeFinished: 'boolean',
      orderId: 'string',
      itemId: 'string',
      cursor: 'string',
      limit: 'number',
    },
  },
  'serialWarehouse.handoverContext': {
    verb: 'GET',
    path: '/serial-warehouse/handover-context/{handoverId}',
  },
  'serialWarehouse.submit': { verb: 'POST', path: '/serial-warehouse/dispatches', status: 200 },
  'serialWarehouse.dispatchSerials': {
    verb: 'GET',
    path: '/serial-warehouse/dispatches/{id}/serials',
    query: { cursor: 'string', limit: 'number' },
  },
  'serialWarehouse.copyText': { verb: 'GET', path: '/serial-warehouse/dispatches/{id}/text' },
  'serialWarehouse.listOrders': {
    verb: 'GET',
    path: '/serial-warehouse/orders',
    query: {
      query: 'string',
      customerIds: 'list',
      buIds: 'list',
      from: 'string',
      to: 'string',
      status: 'string',
      cursor: 'string',
      limit: 'number',
    },
  },
  'serialWarehouse.setLinks': {
    verb: 'PUT',
    path: '/serial-warehouse/orders/{id}/handovers',
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'serialWarehouse.getOrder': {
    verb: 'GET',
    path: '/serial-warehouse/orders/{id}',
    etag: 'updatedAt',
  },
  // Catat ready (tanpa SO). Jalur statis SEBELUM yang berparameter.
  'serialWarehouse.readyList': {
    verb: 'GET',
    path: '/serial-warehouse/ready',
    query: {
      buIds: 'list',
      from: 'string',
      to: 'string',
      status: 'string',
      cursor: 'string',
      limit: 'number',
    },
  },
  'serialWarehouse.ready': { verb: 'GET', path: '/serial-warehouse/ready/{id}' },
  // Riwayat gabungan Penjualan + Ready Stock (per pengeluaran). `submit` memakai POST pada jalur yang sama.
  'serialWarehouse.dispatchList': {
    verb: 'GET',
    path: '/serial-warehouse/dispatches',
    query: {
      query: 'string',
      kind: 'string',
      customerIds: 'list',
      buIds: 'list',
      from: 'string',
      to: 'string',
      status: 'string',
      cursor: 'string',
      limit: 'number',
    },
  },
  'serialWarehouse.dispatchGet': { verb: 'GET', path: '/serial-warehouse/dispatches/{id}' },
  // Bukti foto QC Serial Number. `serialProofs.get` TANPA `etag` dan memakai `cache: 'revalidate'` (`private, no-cache`): isi pada
  // id yang sama berubah dari foto asli (draft/antre) menjadi hasil bercap (selesai), jadi ETag `id` atau `immutable`
  // akan menyajikan foto basi; tanpa validator, tiap tampilan mengunduh ulang berkasnya.
  'serialProofs.upload': {
    verb: 'POST',
    path: '/serial-proofs',
    status: 201,
    location: '/serial-proofs/{id}',
    query: { width: 'number', height: 'number' },
    binary: 'request',
    rawBody: {
      field: 'bytes',
      mimeField: 'mime',
      maxBytes: 10_485_760, // = MAX_IMAGE_BYTES (shared/files.ts)
      tooLarge: 'Ukuran foto maksimal 10 MB',
    },
  },
  'serialProofs.get': {
    verb: 'GET',
    path: '/serial-proofs/{id}',
    binary: 'response',
    download: {
      bytesField: 'bytes',
      mimeField: 'mime',
      filenameField: 'filename',
      echo: ['id'],
      cache: 'revalidate',
    },
  },
  'serialProofs.remove': { verb: 'DELETE', path: '/serial-proofs/{id}' },
  'serialProofs.retry': { verb: 'POST', path: '/serial-proofs/{id}/retry', status: 200 },
  'serialProofs.replace': { verb: 'POST', path: '/serial-proofs/{photoId}/replace', status: 200 },
  'postelSettings.get': { verb: 'GET', path: '/postel-settings', etag: 'updatedAt' },
  'postelSettings.save': {
    verb: 'PUT',
    path: '/postel-settings',
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
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
  'notifications.list': {
    verb: 'GET',
    path: '/notifications',
    query: { limit: 'number', before: 'string' },
  },
  // `read-all` (2 segmen) tidak bertabrakan dengan `/notifications/{id}/read` (3 segmen).
  'notifications.markAllRead': { verb: 'POST', path: '/notifications/read-all' },
  'notifications.markRead': { verb: 'POST', path: '/notifications/{id}/read' },
  'push.config': { verb: 'GET', path: '/push/config' },
  'push.subscribe': { verb: 'POST', path: '/push/subscriptions' },
  'push.unsubscribe': { verb: 'POST', path: '/push/unsubscribe' },
  'push.setPreference': { verb: 'PUT', path: '/push/preference' },
  // Endpoint langganan di badan (bukan URL): tak masuk log akses. `deviceState` POST hanya membaca.
  'push.deviceState': { verb: 'POST', path: '/push/device/state' },
  'push.setDeviceMuted': { verb: 'PUT', path: '/push/device' },
  'push.reportPermission': { verb: 'PUT', path: '/push/permission' },
  'push.status': { verb: 'GET', path: '/push/status' },
  'desktop.handoff': { verb: 'POST', path: '/desktop/handoff' },
  'desktop.releases': { verb: 'GET', path: '/desktop/releases' },
  'guides.list': { verb: 'GET', path: '/guides' },
  'guides.mark': { verb: 'PUT', path: '/guides/{id}' },
  'guides.reset': { verb: 'POST', path: '/guides/{id}/reset' },
  'jobs.get': { verb: 'GET', path: '/jobs/{id}' },
  'exports.sheets': {
    verb: 'POST',
    path: '/exports/sheets',
    status: 202,
    location: '/jobs/{jobId}',
  },
  // Dashboard: `query` memakai POST karena badannya memuat daftar widget beserta filternya (tak mengubah data).
  'dashboard.query': { verb: 'POST', path: '/dashboard/query', status: 200 },
  'dashboard.options': {
    verb: 'GET',
    path: '/dashboard/options',
    query: { kind: 'string', query: 'string', cursor: 'string', limit: 'number', ids: 'list' },
  },
  // Tautan dashboard publik (spek dashboard 7.5): `create` = 201, `revoke` idempoten.
  'dashboardShares.list': { verb: 'GET', path: '/dashboard-shares' },
  'dashboardShares.get': { verb: 'GET', path: '/dashboard-shares/{id}' },
  'dashboardShares.create': { verb: 'POST', path: '/dashboard-shares', status: 201 },
  'dashboardShares.update': { verb: 'PUT', path: '/dashboard-shares/{id}' },
  'dashboardShares.revoke': { verb: 'POST', path: '/dashboard-shares/{id}/revoke' },
  // Laporan dashboard terjadwal (spek dashboard 7a.7): `save` = PUT utuh ber-CAS `updatedAt`, `create` = 201.
  'dashboardReports.list': { verb: 'GET', path: '/dashboard-reports' },
  'dashboardReports.get': { verb: 'GET', path: '/dashboard-reports/{id}', etag: 'updatedAt' },
  'dashboardReports.save': {
    verb: 'PUT',
    path: '/dashboard-reports/{id}',
    create: { verb: 'POST', path: '/dashboard-reports', status: 201 },
    ifMatch: 'expectedUpdatedAt',
    etag: 'updatedAt',
  },
  'dashboardReports.setEnabled': { verb: 'POST', path: '/dashboard-reports/{id}/enabled' },
  'dashboardReports.remove': { verb: 'DELETE', path: '/dashboard-reports/{id}' },
  'dashboardReports.sendTest': { verb: 'POST', path: '/dashboard-reports/{id}/send-test' },
  'dashboardReports.preview': { verb: 'GET', path: '/dashboard-reports/{id}/preview' },
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
