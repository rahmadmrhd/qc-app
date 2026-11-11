import { describe, expect, test } from 'bun:test';
import {
  API_ROUTES,
  type ApiFieldIssue,
  contentDispositionOf,
  downloadOutput,
  etagMatches,
  etagOf,
  filenameFromDisposition,
  fillPath,
  formatEtag,
  fromRequestParts,
  parseIfMatch,
  parseQueryValue,
  routeShape,
  toRequestParts,
} from './api';
import type { ApiId, ApiInput } from './contract';
import { MAX_IMAGE_BYTES } from './files';
import { QR_LIMITS } from './qrcode';
import { GUIDE_LIMITS } from './stickers';

const IDS = Object.keys(API_ROUTES) as ApiId[];

/** Contoh input tiap id; `Record<ApiId, …>` memaksa kelengkapan lewat kompilator. */
const EXAMPLES: { [M in ApiId]: ApiInput<M> } = {
  'auth.me': null,
  'access.users.list': null,
  'access.users.save': {
    id: 'u1',
    email: 'a@b.co',
    name: 'A',
    status: 'active',
    assignments: [],
    buAssignments: [{ buId: 'b1', roleIds: ['r1'] }],
  },
  'access.users.setStatus': { id: 'u1', status: 'inactive' },
  'access.roles.list': null,
  'access.roles.save': { id: 'r1', name: 'R', description: '', permissions: {} },
  'access.roles.delete': { id: 'r1' },
  'access.audit.list': { cursor: 'c1', limit: 20, action: 'user.update', query: 'a b' },
  'access.locations.list': null,
  'access.locations.save': { id: 'l1', code: 'WH', name: 'Gudang' },
  'access.locations.setStatus': { id: 'l1', status: 'inactive' },
  'access.businessUnits.list': null,
  'access.businessUnits.save': { id: 'b1', code: 'UM', name: 'Umum' },
  'access.businessUnits.setStatus': { id: 'b1', status: 'inactive' },
  'businessUnits.options': null,
  'files.upload': { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), width: 10, height: 20 },
  'files.get': { id: 'f1' },
  'stickerGuides.list': {
    search: 'kar%_\\',
    sort: 'nameAsc',
    mine: true,
    unused: false,
    cursor: 'c1',
    limit: 40,
  },
  'stickerGuides.upload': {
    name: 'Foto Kardus',
    mime: 'image/jpeg',
    thumbMime: 'image/webp',
    width: 800,
    height: 600,
    image: new Uint8Array([255, 216, 255]),
    thumbnail: new Uint8Array([82, 73, 70, 70]),
  },
  'stickerGuides.rename': { id: 'g1', name: 'Kardus Baru' },
  'stickerGuides.remove': { id: 'g1' },
  'stickerGuides.thumbnail': { id: 'g1' },
  'stickerGuides.usages': { id: 'g1' },
  'brands.list': null,
  'brands.save': { id: 'b1', name: 'Sony', businessUnitIds: ['bu1'] },
  'brands.setStatus': { id: 'b1', status: 'inactive' },
  'stickerSettings.get': null,
  'stickerSettings.save': {
    expectedUpdatedAt: '2026-11-09T00:00:00.000Z',
    alert: { enabled: true, recipients: ['a@contoh.com'], digestHour: 8 },
    defaults: [{ typeId: 'st1', defaultMinQty: 5 }],
  },
  'stickerTypes.list': null,
  'stickerTypes.save': {
    id: 'st1',
    expectedUpdatedAt: '2026-11-09T00:00:00.000Z',
    name: 'QC',
    rule: 'bu',
  },
  'stickerTypes.setStatus': { id: 'st1', status: 'inactive' },
  'stickers.list': null,
  'stickers.save': {
    id: 's1',
    expectedUpdatedAt: '2026-11-09T00:00:00.000Z',
    typeId: 'st1',
    name: 'QC',
    alias: '',
    fileId: null,
    minQty: 0,
    businessUnitIds: ['bu1'],
  },
  'stickers.setStatus': { id: 's1', status: 'inactive' },
  'stickerStock.list': { locationIds: ['l1', 'l2'] },
  'stickerStock.record': {
    locationId: 'l1',
    stickerId: 's1',
    kind: 'in',
    quantity: 5,
    reason: '',
  },
  'stickerStock.adjust': { locationId: 'l1', stickerId: 's1', delta: -2, reason: 'rusak' },
  'stickerStock.opname': {
    rows: [{ stickerId: 's1', locationId: 'l1', expectedQty: 10, count: { rows: [], loose: 12 } }],
  },
  'stickerStock.history': { locationIds: ['l1'], stickerId: 's1', cursor: 'c', limit: 20 },
  'customers.list': null,
  'customers.rename': { id: 'c1', name: 'PT Maju' },
  'customers.setStatus': { id: 'c1', status: 'inactive' },
  'handovers.options': { locationIds: ['l1', 'l2'] },
  'handovers.board': { locationIds: ['l1'], status: 'in_progress', cursor: 'x', limit: 3 },
  'handovers.get': { id: 'h1', locationIds: ['l1'] },
  'handovers.save': {
    id: 'h1',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    locationId: 'l1',
    customerName: 'PT Maju',
    note: '- [ ] a',
  },
  'handovers.saveBatch': { locationId: 'l1', tasks: [{ customerName: 'A', note: 'x' }] },
  'handovers.cancel': { id: 'h1', locationId: 'l1' },
  'handovers.reopen': { id: 'h1', locationId: 'l1' },
  'handovers.setCheck': { id: 'h1', locationId: 'l1', index: 0, text: 'a', checked: true },
  'handovers.setDone': { id: 'h1', locationId: 'l1' },
  'handovers.comment': {
    id: 'h1',
    locationId: 'l1',
    quote: '',
    before: '',
    after: '',
    body: 'halo',
  },
  'items.list': {
    cursor: 'c',
    limit: 10,
    query: 'sony',
    status: 'active',
    instruction: 'none',
    stickerId: 's1',
    typeId: 't1',
    stickerMode: 'missing',
  },
  'items.get': { id: 'i1' },
  'items.save': {
    id: 'i1',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    brandId: 'b1',
    model: 'X',
    isCountryLock: false,
    aliases: [],
    stickerPhotos: [],
    accessories: [],
    attachments: [],
    detail: '',
    businessUnitIds: ['bu1'],
  },
  'items.setStatus': { id: 'i1', status: 'inactive' },
  'qrcodes.list': null,
  'qrcodes.get': { id: 'q1' },
  'qrcodes.versions': { id: 'q1' },
  'qrcodes.save': {
    id: 'q1',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    name: 'Nama',
    presetId: 'p1',
    itemIds: ['i1', 'i2'],
    title: 'T',
    linkSource: 'url',
    link: 'https://x.id',
    documentId: '',
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: 'a' as never,
  },
  'qrcodes.delete': { id: 'q1' },
  'qrcodes.getDefaults': null,
  'qrcodes.itemOptions': { query: 'a7', cursor: 'k', limit: 20 },
  'qrcodes.savePreset': {
    id: 'p1',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    name: 'N',
    title: '',
    subtitle: '',
    footer: '',
    layout: 'a' as never,
    style: {} as never,
    defaultLogoId: '',
    buId: 'bu1',
    namePlacement: 'title',
  },
  'qrcodes.clonePreset': { id: 'p1', buId: 'bu2', name: 'Salinan' },
  'qrcodes.deletePreset': { id: 'p1' },
  'qrcodes.saveLogoLibrary': {
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    logoFileIds: ['f1'],
  },
  'qrcodes.uploadPdf': {
    name: 'a.pdf',
    bytes: new Uint8Array([37, 80, 68, 70]),
    replaceDocumentId: 'd1',
  },
  'qrcodes.cloneFromDrive': { source: 'https://drive.google.com/x', replaceDocumentId: 'd1' },
  'qrcodes.export': {
    id: 'q1',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    pdf: new Uint8Array([37, 80, 68, 70]),
    png: new Uint8Array([137, 80, 78, 71]),
    preview: new Uint8Array([137, 80, 78, 71]),
    reason: 'Logo diganti',
  },
  'qrcodes.file': { id: 'q1', kind: 'pdf' },
  'jobs.get': { id: 'j1' },
  'exports.sheets': { tables: ['items'] },
};

const ROUNDTRIP_IDS = IDS;

function issueOf(run: () => unknown): ApiFieldIssue {
  try {
    run();
  } catch (error) {
    return error as ApiFieldIssue;
  }
  throw new Error('seharusnya melempar');
}

function roundTrip<M extends ApiId>(id: M, input: ApiInput<M>) {
  const parts = toRequestParts(id, input);
  const create = API_ROUTES[id].create;
  const created = create !== undefined && parts.verb === create.verb && parts.path === create.path;
  const rebuilt = fromRequestParts(id, {
    params: pathParams(id, parts.path, created),
    query: parts.query,
    body: parts.body === undefined ? undefined : JSON.parse(JSON.stringify(parts.body)),
    raw: parts.raw,
    multipart: parts.multipart,
    ifMatch: parts.ifMatch,
    created,
  });
  return { parts, rebuilt };
}

/** Parameter jalur dibaca dari jalur terisi menurut templat (kebalikan `fillPath`). */
function pathParams(id: ApiId, filled: string, created: boolean) {
  const shape = routeShape(API_ROUTES[id], created);
  const names = [...shape.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string);
  const pattern = new RegExp(`^${shape.path.replace(/\{\w+\}/g, '([^/]+)')}$`);
  const found = pattern.exec(filled);
  const params: Record<string, string> = {};
  names.forEach((name, index) => {
    params[name] = decodeURIComponent(found?.[index + 1] ?? '');
  });
  return params;
}

describe('tabel rute', () => {
  test('tiap id punya jalur+verba unik (termasuk jalur create)', () => {
    const seen = new Map<string, string>();
    for (const id of IDS) {
      const def = API_ROUTES[id];
      const pairs = [`${def.verb} ${def.path}`];
      if (def.create) pairs.push(`${def.create.verb} ${def.create.path}`);
      for (const pair of pairs) {
        expect(seen.get(pair), `${pair} dipakai ${seen.get(pair)} dan ${id}`).toBeUndefined();
        seen.set(pair, id);
      }
    }
  });

  test('rute PATCH (keluaran DTO ber-updatedAt) memberi ETag updatedAt', () => {
    // Pengecualian: ganti nama gambar pustaka (`StickerGuideDto` tanpa `updatedAt`, tanpa If-Match; spek 3b-1).
    const withoutEtag: ReadonlySet<ApiId> = new Set<ApiId>(['stickerGuides.rename']);
    const patches = IDS.filter((id) => API_ROUTES[id].verb === 'PATCH' && !withoutEtag.has(id));
    expect(patches.length).toBeGreaterThanOrEqual(5);
    for (const id of patches) expect(API_ROUTES[id].etag, id).toBe('updatedAt');
  });

  test('semua id kontrak API punya entri tabel (dan sebaliknya)', () => {
    expect(IDS).toHaveLength(Object.keys(EXAMPLES).length);
    expect([...IDS].sort()).toEqual(Object.keys(EXAMPLES).sort() as ApiId[]);
  });

  test('rute biner punya bentuk rinci (rawBody/multipart/download) sesuai penandanya', () => {
    for (const id of IDS) {
      const def = API_ROUTES[id];
      expect(def.binary === 'request').toBe(def.rawBody !== undefined);
      expect(def.binary === 'multipart').toBe(def.multipart !== undefined);
      expect(def.binary === 'response').toBe(def.download !== undefined);
    }
  });

  test('rute statis tidak tertutup rute berparameter yang lebih awal secara verba+kedalaman', () => {
    // /handovers/options dan /handovers/batch berbeda dari /handovers/{id}: keduanya literal pada segmen ke-2.
    expect(API_ROUTES['handovers.options'].path).toBe('/handovers/options');
    expect(API_ROUTES['handovers.saveBatch'].path).toBe('/handovers/batch');
    expect(API_ROUTES['handovers.get'].path).toBe('/handovers/{id}');
  });
});

describe('toRequestParts <-> fromRequestParts', () => {
  for (const id of ROUNDTRIP_IDS) {
    test(`${id}: bolak-balik mengembalikan input identik`, () => {
      const input = EXAMPLES[id];
      const { rebuilt } = roundTrip(id, input as never);
      expect(rebuilt).toEqual(input);
    });
  }

  test('save tanpa id memakai jalur create (POST), dengan id memakai PUT dan If-Match', () => {
    const created = toRequestParts('items.save', {
      brandId: 'b1',
      model: 'X',
      isCountryLock: false,
      aliases: [],
      stickerPhotos: [],
      accessories: [],
      attachments: [],
      detail: '',
      businessUnitIds: ['bu1'],
    });
    expect(created).toMatchObject({ verb: 'POST', path: '/items', ifMatch: undefined });
    const updated = toRequestParts('items.save', EXAMPLES['items.save'] as never);
    expect(updated).toMatchObject({
      verb: 'PUT',
      path: '/items/i1',
      ifMatch: '2026-10-09T00:00:00.000Z',
    });
    expect(updated.body).not.toHaveProperty('expectedUpdatedAt');
    expect(updated.body).not.toHaveProperty('id');
  });

  test('GET: semua field lewat query; list dipecah dan digabung dengan koma', () => {
    const parts = toRequestParts('handovers.board', {
      locationIds: ['l1', 'l2'],
      status: 'done',
      limit: 3,
    });
    expect(parts).toMatchObject({
      verb: 'GET',
      path: '/handovers',
      query: { locationIds: 'l1,l2', status: 'done', limit: '3' },
    });
    expect(parts.body).toBeUndefined();
    expect(
      fromRequestParts('handovers.board', {
        params: {},
        query: { locationIds: 'a,b', status: 'done' },
        body: undefined,
        created: false,
      }),
    ).toEqual({ locationIds: ['a', 'b'], status: 'done' });
  });

  test('id tanpa input (lists) menjadi null', () => {
    expect(
      fromRequestParts('brands.list', { params: {}, query: {}, body: undefined, created: false }),
    ).toBeNull();
    expect(toRequestParts('brands.list', null)).toEqual({
      verb: 'GET',
      path: '/brands',
      query: {},
      ifMatch: undefined,
    });
  });

  test('id pada badan yang berbeda dari jalur menjadi galat; yang sama diterima', () => {
    const base = { params: { id: 'b1' }, query: {}, created: false };
    expect(
      issueOf(() => fromRequestParts('brands.save', { ...base, body: { id: 'b2', name: 'X' } })),
    ).toEqual({
      field: 'id',
      message: 'Nilai pada badan berbeda dari jalur',
    });
    expect(fromRequestParts('brands.save', { ...base, body: { id: 'b1', name: 'X' } })).toEqual({
      id: 'b1',
      name: 'X',
    });
  });

  test('jalur create menolak id yang terisi pada badan', () => {
    const run = () =>
      fromRequestParts('brands.save', {
        params: {},
        query: {},
        body: { id: 'b1', name: 'X' },
        created: true,
      });
    expect(issueOf(run).field).toBe('id');
  });

  test('If-Match dibaca dari header; nilai badan bernama sama dibuang', () => {
    const rebuilt = fromRequestParts('items.save', {
      params: { id: 'i1' },
      query: {},
      body: { expectedUpdatedAt: 'dari-badan', brand: 'X' },
      ifMatch: 'dari-header',
      created: false,
    });
    expect(rebuilt).toMatchObject({ expectedUpdatedAt: 'dari-header' });
    const tanpa = fromRequestParts('items.save', {
      params: { id: 'i1' },
      query: {},
      body: { expectedUpdatedAt: 'dari-badan', brand: 'X' },
      created: false,
    }) as Record<string, unknown>;
    expect(tanpa).not.toHaveProperty('expectedUpdatedAt');
  });

  test('__proto__/constructor/prototype di badan JSON tidak mengganti prototipe input dan tidak menyelundupkan nilai', () => {
    const body = JSON.parse(
      '{"brand":"X","__proto__":{"expectedUpdatedAt":"X","isAdmin":true},"constructor":{"a":1},"prototype":{"b":2}}',
    );
    const rebuilt = fromRequestParts('items.save', {
      params: { id: 'i1' },
      query: {},
      body,
      created: false,
    }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(rebuilt)).toBe(Object.prototype);
    expect(rebuilt.expectedUpdatedAt).toBeUndefined();
    expect((rebuilt as { isAdmin?: unknown }).isAdmin).toBeUndefined();
    expect(Object.keys(rebuilt).sort()).toEqual(['brand', 'id']);
  });

  test('number dan boolean diparse; bukan angka menjadi galat', () => {
    expect(
      fromRequestParts('access.audit.list', {
        params: {},
        query: { limit: '25' },
        body: undefined,
        created: false,
      }),
    ).toEqual({ limit: 25 });
    for (const bad of ['abc', '', ' ', 'Infinity']) {
      expect(
        issueOf(() =>
          fromRequestParts('access.audit.list', {
            params: {},
            query: { limit: bad },
            body: undefined,
            created: false,
          }),
        ),
      ).toEqual({ field: 'limit', message: 'Harus berupa angka' });
    }
  });

  test('badan non-objek ditolak', () => {
    expect(
      issueOf(() =>
        fromRequestParts('brands.save', {
          params: { id: 'b1' },
          query: {},
          body: ['x'],
          created: false,
        }),
      ).field,
    ).toBe('body');
  });
});

describe('fillPath, etag, If-Match', () => {
  test('fillPath meng-encode nilai dan menolak parameter kosong', () => {
    expect(fillPath('/qrcodes/{id}/files/{kind}', { id: 'a/b c', kind: 'pdf' })).toBe(
      '/qrcodes/a%2Fb%20c/files/pdf',
    );
    expect(() => fillPath('/items/{id}', {})).toThrow();
  });

  test('etagOf mengambil field keluaran; kosong bila tak ada', () => {
    expect(etagOf('items.get', { updatedAt: 't1' } as never)).toBe('t1');
    expect(etagOf('items.get', { updatedAt: '' } as never)).toBeUndefined();
    expect(etagOf('brands.list', [] as never)).toBeUndefined();
    expect(etagOf('qrcodes.saveLogoLibrary', { logoUpdatedAt: 'x' } as never)).toBe('x');
  });

  test('formatEtag/parseIfMatch/etagMatches', () => {
    expect(formatEtag('a"b')).toBe('"ab"');
    expect(parseIfMatch('"abc"')).toBe('abc');
    expect(parseIfMatch('abc')).toBe('abc');
    for (const ignored of ['*', '"a", "b"', '', '  ', null, undefined, '""']) {
      expect(parseIfMatch(ignored)).toBeUndefined();
    }
    expect(etagMatches('"abc"', 'abc')).toBe(true);
    expect(etagMatches('W/"abc", "z"', 'abc')).toBe(true);
    expect(etagMatches('*', 'abc')).toBe(true);
    expect(etagMatches('"abd"', 'abc')).toBe(false);
    expect(etagMatches(null, 'abc')).toBe(false);
  });
});

describe('parseQueryValue', () => {
  test('boolean: true dan false diparse, nilai lain menjadi galat', () => {
    expect(parseQueryValue('aktif', 'boolean', 'true')).toBe(true);
    expect(parseQueryValue('aktif', 'boolean', 'false')).toBe(false);
    for (const bad of ['yes', 'TRUE', '1', '']) {
      expect(issueOf(() => parseQueryValue('aktif', 'boolean', bad))).toEqual({
        field: 'aktif',
        message: 'Harus true atau false',
      });
    }
  });

  test('number, list, dan string', () => {
    expect(parseQueryValue('n', 'number', '-2.5')).toBe(-2.5);
    expect(parseQueryValue('l', 'list', '')).toEqual([]);
    expect(parseQueryValue('l', 'list', 'a,b')).toEqual(['a', 'b']);
    expect(parseQueryValue('s', 'string', '')).toBe('');
  });
});

describe('rute biner', () => {
  test('files.upload: byte menjadi badan mentah, mime menjadi Content-Type, lebar/tinggi lewat query', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const parts = toRequestParts('files.upload', {
      mime: 'image/png',
      bytes,
      width: 10,
      height: 20,
    });
    expect(parts).toMatchObject({
      verb: 'POST',
      path: '/files',
      query: { width: '10', height: '20' },
      raw: { data: bytes, contentType: 'image/png' },
    });
    expect(parts.body).toBeUndefined();
  });

  test('qrcodes.uploadPdf: Content-Type tetap application/pdf; name dan replaceDocumentId lewat query', () => {
    const parts = toRequestParts('qrcodes.uploadPdf', EXAMPLES['qrcodes.uploadPdf']);
    expect(parts).toMatchObject({
      path: '/qrcode-documents',
      query: { name: 'a.pdf', replaceDocumentId: 'd1' },
      raw: { contentType: 'application/pdf' },
    });
  });

  test('qrcodes.export: tiga bagian multipart, reason di query, If-Match dari expectedUpdatedAt, tanpa badan JSON', () => {
    const parts = toRequestParts('qrcodes.export', EXAMPLES['qrcodes.export']);
    expect(parts.path).toBe('/qrcodes/q1/exports');
    expect(Object.keys(parts.multipart ?? {})).toEqual(['pdf', 'png', 'preview']);
    expect(parts.query).toEqual({ reason: 'Logo diganti' });
    expect(parts.ifMatch).toBe('2026-10-09T00:00:00.000Z');
    expect(parts.body).toBeUndefined();
  });

  test('input biner tanpa byte yang sah melempar galat pemrograman', () => {
    expect(() =>
      toRequestParts('files.upload', { mime: 'image/png', width: 1, height: 1 } as never),
    ).toThrow();
    expect(() =>
      toRequestParts('qrcodes.export', {
        id: 'q1',
        expectedUpdatedAt: 'x',
        pdf: new Uint8Array(),
        reason: '',
      } as never),
    ).toThrow();
  });

  test('batas ukuran tiap rute memakai konstanta yang ada (tidak dinaikkan)', () => {
    expect(API_ROUTES['files.upload'].rawBody?.maxBytes).toBe(MAX_IMAGE_BYTES);
    expect(API_ROUTES['qrcodes.uploadPdf'].rawBody?.maxBytes).toBe(QR_LIMITS.documentMaxBytes);
    // multipart = batas total isi berkas + 64 KB ruang batas bagian dan header
    expect(API_ROUTES['qrcodes.export'].multipart?.maxBytes).toBe(
      QR_LIMITS.exportMaxBytes + QR_LIMITS.previewMaxBytes + 64 * 1024,
    );
    expect(API_ROUTES['qrcodes.export'].multipart?.maxBytes).toBe(8_978_432);
    // pustaka gambar: gambar penuh + thumbnail + 64 KB ruang batas bagian dan header
    expect(API_ROUTES['stickerGuides.upload'].multipart?.maxBytes).toBe(
      MAX_IMAGE_BYTES + GUIDE_LIMITS.thumbMaxBytes + 65_536,
    );
    expect(API_ROUTES['stickerGuides.upload'].multipart?.maxBytes).toBe(10_592_256);
  });

  test('stickerGuides.upload: bagian image dan thumbnail, metadata lewat query, tanpa badan JSON', () => {
    const parts = toRequestParts('stickerGuides.upload', EXAMPLES['stickerGuides.upload']);
    expect(parts).toMatchObject({
      verb: 'POST',
      path: '/sticker-guides',
      query: {
        name: 'Foto Kardus',
        mime: 'image/jpeg',
        thumbMime: 'image/webp',
        width: '800',
        height: '600',
      },
    });
    expect(Object.keys(parts.multipart ?? {})).toEqual(['image', 'thumbnail']);
    expect(parts.body).toBeUndefined();
    expect(API_ROUTES['stickerGuides.upload'].status).toBe(201);
    expect(API_ROUTES['stickerGuides.upload'].location).toBe('/sticker-guides/{id}');
  });

  test('stickerGuides.thumbnail: unduhan tak berubah (immutable) dengan echo id', () => {
    expect(API_ROUTES['stickerGuides.thumbnail']).toMatchObject({
      verb: 'GET',
      path: '/sticker-guides/{id}/thumbnail',
      etag: 'id',
      binary: 'response',
      download: { bytesField: 'bytes', mimeField: 'mime', echo: ['id'], cache: 'immutable' },
    });
  });

  test('Content-Disposition: cadangan ASCII, filename* UTF-8, tanpa kutip/CRLF; terurai kembali', () => {
    const header = contentDispositionOf('Label "Gudang" \u00e9\r\nx.pdf');
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    expect(header).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
    expect(filenameFromDisposition(header)).toBe('Label _Gudang_ \u00e9__x.pdf');
    expect(filenameFromDisposition(null)).toBe('');
    expect(filenameFromDisposition(contentDispositionOf(''))).toBe('berkas');
  });

  test('downloadOutput: byte, mime tanpa parameter, nama berkas, echo id, ETag tanpa kutip', () => {
    const bytes = new Uint8Array([9]);
    const headers = new Headers({
      'content-type': 'application/pdf; charset=binary',
      'content-disposition': contentDispositionOf('a b.pdf'),
      etag: '"v1"',
    });
    expect(downloadOutput('qrcodes.file', { id: 'q1', kind: 'pdf' }, headers, bytes)).toEqual({
      filename: 'a b.pdf',
      mime: 'application/pdf',
      bytes,
      etag: 'v1',
    });
    expect(
      downloadOutput(
        'files.get',
        { id: 'f1' },
        new Headers({ 'content-type': 'image/png' }),
        bytes,
      ),
    ).toEqual({ id: 'f1', mime: 'image/png', bytes });
  });
});
