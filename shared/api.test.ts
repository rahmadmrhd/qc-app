import { describe, expect, test } from 'bun:test';
import {
  API_ROUTES,
  type ApiFieldIssue,
  etagMatches,
  etagOf,
  fillPath,
  formatEtag,
  fromRequestParts,
  parseIfMatch,
  REST_MIGRATED_IDS,
  routeShape,
  toRequestParts,
} from './api';
import type { WorkerRpcInput, WorkerRpcMethod } from './rpc';

const IDS = Object.keys(API_ROUTES) as WorkerRpcMethod[];

/** Contoh input tiap id; `Record<WorkerRpcMethod, …>` memaksa kelengkapan lewat kompilator. */
const EXAMPLES: { [M in WorkerRpcMethod]: WorkerRpcInput<M> } = {
  'auth.me': null,
  'access.users.list': null,
  'access.users.save': {
    id: 'u1',
    email: 'a@b.co',
    name: 'A',
    status: 'active',
    assignments: [],
  },
  'access.users.setStatus': { id: 'u1', status: 'inactive' },
  'access.roles.list': null,
  'access.roles.save': { id: 'r1', name: 'R', description: '', permissions: {} },
  'access.roles.delete': { id: 'r1' },
  'access.audit.list': { cursor: 'c1', limit: 20, action: 'user.update', query: 'a b' },
  'access.locations.list': null,
  'access.locations.save': { id: 'l1', code: 'WH', name: 'Gudang' },
  'access.locations.setStatus': { id: 'l1', status: 'inactive' },
  'files.upload': { mime: 'image/png', base64: 'AAAA', width: 10, height: 20 },
  'files.get': { id: 'f1' },
  'brands.list': null,
  'brands.save': { id: 'b1', name: 'Sony' },
  'brands.setStatus': { id: 'b1', status: 'inactive' },
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
  'items.list': { cursor: 'c', limit: 10, query: 'sony', status: 'active' },
  'items.get': { id: 'i1' },
  'items.save': {
    id: 'i1',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    brand: 'Sony',
    model: 'X',
    isCountryLock: false,
    aliases: [],
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
  },
  'items.setStatus': { id: 'i1', status: 'inactive' },
  'qrcodes.list': null,
  'qrcodes.get': { id: 'q1' },
  'qrcodes.save': {
    id: 'q1',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
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
  },
  'qrcodes.deletePreset': { id: 'p1' },
  'qrcodes.saveLogoLibrary': {
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    logoFileIds: ['f1'],
  },
  'qrcodes.uploadPdf': { name: 'a.pdf', base64: 'AAAA', replaceDocumentId: 'd1' },
  'qrcodes.cloneFromDrive': { source: 'https://drive.google.com/x', replaceDocumentId: 'd1' },
  'qrcodes.export': {
    id: 'q1',
    expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    pdfBase64: 'AAAA',
    pngBase64: 'BBBB',
  },
  'qrcodes.file': { id: 'q1', kind: 'pdf' },
  'jobs.get': { id: 'j1' },
  'exports.sheets': { tables: ['items'] },
};

// Id berpenanda `binary` baru mendapat bentuk kabel final di T21 (badan mentah/multipart); sebelum itu
// perakitan bolak-baliknya belum bermakna dan tidak diuji.
const ROUNDTRIP_IDS = IDS.filter((id) => API_ROUTES[id].binary === undefined);

function issueOf(run: () => unknown): ApiFieldIssue {
  try {
    run();
  } catch (error) {
    return error as ApiFieldIssue;
  }
  throw new Error('seharusnya melempar');
}

function roundTrip<M extends WorkerRpcMethod>(id: M, input: WorkerRpcInput<M>) {
  const parts = toRequestParts(id, input);
  const create = API_ROUTES[id].create;
  const created = create !== undefined && parts.verb === create.verb && parts.path === create.path;
  const rebuilt = fromRequestParts(id, {
    params: pathParams(id, parts.path, created),
    query: parts.query,
    body: parts.body === undefined ? undefined : JSON.parse(JSON.stringify(parts.body)),
    ifMatch: parts.ifMatch,
    created,
  });
  return { parts, rebuilt };
}

/** Parameter jalur dibaca dari jalur terisi menurut templat (kebalikan `fillPath`). */
function pathParams(id: WorkerRpcMethod, filled: string, created: boolean) {
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

  test('semua id tercakup dan REST_MIGRATED_IDS hanya berisi id yang ada tanpa penanda binary', () => {
    expect(IDS).toHaveLength(Object.keys(EXAMPLES).length);
    for (const id of REST_MIGRATED_IDS) {
      expect(API_ROUTES[id]).toBeDefined();
      expect(API_ROUTES[id].binary).toBeUndefined();
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
      brand: 'Sony',
      model: 'X',
      isCountryLock: false,
      aliases: [],
      stickers: [],
      accessories: [],
      attachments: [],
      detail: '',
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
