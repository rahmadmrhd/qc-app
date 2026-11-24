import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { API_ROUTES, type ApiRouteDef } from './api';
import {
  compareContract,
  contractSnapshot,
  REMOVAL_MIN_AGE_MS,
  removalProblems,
  type SnapshotEntry,
} from './api-snapshot';
import { RETIRED_ROUTES, type RetiredRoute } from './api-versions';

const TABLE: Record<string, ApiRouteDef> = {
  'b.list': { verb: 'GET', path: '/b', query: { q: 'string', ids: 'list' } },
  'a.save': { verb: 'PUT', path: '/a/{id}', create: { verb: 'POST', path: '/a' } },
  'a.get': { verb: 'GET', path: '/a/{id}' },
};

const BASE: SnapshotEntry[] = [
  { id: 'a.get', verb: 'GET', path: '/a/{id}' },
  { id: 'a.save', verb: 'PUT', path: '/a/{id}', create: { verb: 'POST', path: '/a' } },
  { id: 'b.list', verb: 'GET', path: '/b', query: { ids: 'list', q: 'string' } },
];

const retired = (id: string): RetiredRoute => ({
  id,
  verb: 'GET',
  path: '/x',
  removedIn: 'server-v9.9.9',
});

/** Salinan `BASE` dengan satu entri diganti hasil `change`. */
function changed(id: string, change: (entry: SnapshotEntry) => SnapshotEntry): SnapshotEntry[] {
  return BASE.map((entry) => (entry.id === id ? change(entry) : entry));
}

describe('contractSnapshot', () => {
  test('urut menurut id; query dan create hanya bila ada', () => {
    const snapshot = contractSnapshot(TABLE);
    expect(snapshot.map((entry) => entry.id)).toEqual(['a.get', 'a.save', 'b.list']);
    expect('query' in (snapshot[0] as SnapshotEntry)).toBe(false);
    expect('create' in (snapshot[0] as SnapshotEntry)).toBe(false);
    expect(snapshot[1]?.create).toEqual({ verb: 'POST', path: '/a' });
    expect(snapshot[2]?.query).toEqual({ ids: 'list', q: 'string' });
  });
});

describe('contractSnapshot: status deprecated', () => {
  const table: Record<string, ApiRouteDef> = {
    'a.get': { verb: 'GET', path: '/a/{id}' },
    'a.get@2': { verb: 'GET', path: '/a/{id}' },
    'a.get@3': { verb: 'GET', path: '/a/{id}' },
    'b.list': { verb: 'GET', path: '/b' },
  };
  const groups = {
    a: { latest: 3, deprecated: [1, 2] },
    b: { latest: 1, deprecated: [] },
  };

  test('deprecated: true hanya pada id yang versinya tercantum di kelompoknya', () => {
    const byId = Object.fromEntries(contractSnapshot(table, groups).map((e) => [e.id, e]));
    expect(byId['a.get']?.deprecated).toBe(true);
    expect(byId['a.get@2']?.deprecated).toBe(true);
    expect('deprecated' in (byId['a.get@3'] as SnapshotEntry)).toBe(false);
    expect('deprecated' in (byId['b.list'] as SnapshotEntry)).toBe(false);
  });

  test('kelompok yang tak ada di peta dianggap tidak deprecated', () => {
    const byId = contractSnapshot({ 'z.x': { verb: 'GET', path: '/z' } }, groups);
    expect('deprecated' in (byId[0] as SnapshotEntry)).toBe(false);
  });
});

describe('compareContract', () => {
  test('potret sama dan sekadar penambahan lolos', () => {
    expect(compareContract(BASE, BASE, [])).toEqual([]);
    const added: SnapshotEntry[] = [
      ...BASE,
      { id: 'a.get@2', verb: 'GET', path: '/a/{id}' },
      { id: 'c.new', verb: 'GET', path: '/c' },
    ];
    expect(compareContract(BASE, added, [])).toEqual([]);
  });

  test('query baru di rute lama lolos (aditif)', () => {
    const current = changed('b.list', (e) => ({
      ...e,
      query: { ...e.query, extra: 'number' as const },
    }));
    expect(compareContract(BASE, current, [])).toEqual([]);
  });

  test('id hilang tanpa catatan = pelanggaran yang menyebut id', () => {
    const current = BASE.filter((entry) => entry.id !== 'a.get');
    const result = compareContract(BASE, current, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('a.get');
  });

  test('id hilang yang tercatat di retired DAN berstatus deprecated di potret lama lolos', () => {
    const previous = changed('a.get', (e) => ({ ...e, deprecated: true as const }));
    const current = BASE.filter((entry) => entry.id !== 'a.get');
    expect(compareContract(previous, current, [retired('a.get')])).toEqual([]);
  });

  test('id hilang yang tercatat di retired tetapi belum deprecated di potret lama = pelanggaran', () => {
    const current = BASE.filter((entry) => entry.id !== 'a.get');
    const result = compareContract(BASE, current, [retired('a.get')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('a.get');
    expect(result[0]).toContain('deprecated');
  });

  test('verb atau path berubah = pelanggaran', () => {
    const verb = changed('a.get', (e) => ({ ...e, verb: 'POST' as const }));
    const path = changed('a.get', (e) => ({ ...e, path: '/z/{id}' }));
    expect(compareContract(BASE, verb, [])[0]).toContain('a.get');
    expect(compareContract(BASE, path, [])[0]).toContain('a.get');
  });

  test('kunci query hilang atau jenisnya berubah = pelanggaran', () => {
    const lost = changed('b.list', (e) => ({ ...e, query: { ids: 'list' as const } }));
    const kind = changed('b.list', (e) => ({
      ...e,
      query: { ids: 'string' as const, q: 'string' as const },
    }));
    const noQuery = changed('b.list', (e) => ({ id: e.id, verb: e.verb, path: e.path }));
    expect(compareContract(BASE, lost, [])[0]).toContain('b.list');
    expect(compareContract(BASE, kind, [])[0]).toContain('b.list');
    expect(compareContract(BASE, noQuery, [])).toHaveLength(2);
  });

  test('create hilang atau berubah = pelanggaran', () => {
    const lost = changed('a.save', (e) => ({ id: e.id, verb: e.verb, path: e.path }));
    const other = changed('a.save', (e) => ({
      ...e,
      create: { verb: 'POST' as const, path: '/aa' },
    }));
    expect(compareContract(BASE, lost, [])[0]).toContain('a.save');
    expect(compareContract(BASE, other, [])[0]).toContain('a.save');
  });
});

describe('compareContract: bentuk kabel (status, ETag, If-Match, rawBody, multipart, download)', () => {
  /** Dasar berformat baru: `status` ada = entri dibandingkan pada field kabel. */
  const WIRE: SnapshotEntry[] = [
    { id: 'a.get', verb: 'GET', path: '/a/{id}', status: 200, etag: 'updatedAt' },
    { id: 'a.put', verb: 'PUT', path: '/a/{id}', status: 200, ifMatch: 'expectedUpdatedAt' },
    {
      id: 'u.up',
      verb: 'POST',
      path: '/u',
      status: 201,
      rawBody: { field: 'bytes', mimeField: 'mime' },
    },
    {
      id: 'q.export',
      verb: 'POST',
      path: '/q',
      status: 202,
      multipart: { parts: ['pdf', 'png'] },
    },
    {
      id: 'd.get',
      verb: 'GET',
      path: '/d/{id}',
      status: 200,
      download: { bytesField: 'bytes', mimeField: 'mime', filenameField: 'name' },
    },
  ];
  const edit = (id: string, change: (entry: SnapshotEntry) => SnapshotEntry): SnapshotEntry[] =>
    WIRE.map((entry) => (entry.id === id ? change(entry) : entry));

  test('potret sama lolos; ETag baru ditambahkan di rute lama lolos (aditif)', () => {
    expect(compareContract(WIRE, WIRE, [])).toEqual([]);
    expect(
      compareContract(
        WIRE,
        edit('a.put', (e) => ({ ...e, etag: 'updatedAt' })),
        [],
      ),
    ).toEqual([]);
  });

  test('status sukses berubah (200 -> 201) = pelanggaran', () => {
    const result = compareContract(
      WIRE,
      edit('a.get', (e) => ({ ...e, status: 201 })),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('a.get');
    expect(result[0]).toContain('status');
  });

  test('ETag berubah atau hilang, If-Match berubah, hilang, atau baru diwajibkan = pelanggaran', () => {
    for (const next of [
      edit('a.get', (e) => ({ ...e, etag: 'version' })),
      edit('a.get', ({ etag: _etag, ...rest }) => rest),
      edit('a.put', (e) => ({ ...e, ifMatch: 'lain' })),
      edit('a.put', ({ ifMatch: _ifMatch, ...rest }) => rest),
      edit('a.get', (e) => ({ ...e, ifMatch: 'expectedUpdatedAt' })),
    ]) {
      expect(compareContract(WIRE, next, []), JSON.stringify(next)).not.toEqual([]);
    }
  });

  test('badan mentah: field/mimeField/contentType berubah atau hilang atau baru muncul = pelanggaran; maxBytes tidak dicatat', () => {
    for (const next of [
      edit('u.up', (e) => ({ ...e, rawBody: { field: 'data', mimeField: 'mime' } })),
      edit('u.up', (e) => ({ ...e, rawBody: { field: 'bytes', contentType: 'image/png' } })),
      edit('u.up', ({ rawBody: _raw, ...rest }) => rest),
      edit('a.get', (e) => ({ ...e, rawBody: { field: 'bytes' } })),
    ]) {
      expect(compareContract(WIRE, next, []), JSON.stringify(next)).not.toEqual([]);
    }
  });

  test('multipart: bagian ditambah, dihapus, atau diganti = pelanggaran', () => {
    for (const parts of [['pdf', 'png', 'preview'], ['pdf'], ['pdf', 'jpg']]) {
      const result = compareContract(
        WIRE,
        edit('q.export', (e) => ({ ...e, multipart: { parts } })),
        [],
      );
      expect(result, parts.join()).toHaveLength(1);
      expect(result[0]).toContain('multipart');
    }
  });

  test('unduhan: field byte/mime/nama berubah atau hilang = pelanggaran', () => {
    for (const next of [
      edit('d.get', (e) => ({ ...e, download: { bytesField: 'isi', mimeField: 'mime' } })),
      edit('d.get', ({ download: _download, ...rest }) => rest),
    ]) {
      expect(compareContract(WIRE, next, []), JSON.stringify(next)).not.toEqual([]);
    }
  });

  test('entri potret lama (tanpa status) tidak dibandingkan pada field kabel (tak ada dasar)', () => {
    const legacy: SnapshotEntry[] = [{ id: 'a.get', verb: 'GET', path: '/a/{id}' }];
    expect(compareContract(legacy, WIRE.slice(0, 1), [])).toEqual([]);
    expect(
      compareContract(legacy, [{ id: 'a.get', verb: 'GET', path: '/a/{id}', status: 201 }], []),
    ).toEqual([]);
  });
});

describe('contractSnapshot: bentuk kabel', () => {
  test('status efektif selalu tercatat (bawaan 200); etag, ifMatch, rawBody, multipart, download tanpa batas ukuran', () => {
    const table: Record<string, ApiRouteDef> = {
      'a.get': { verb: 'GET', path: '/a', etag: 'updatedAt' },
      'a.put': { verb: 'PUT', path: '/a', status: 201, ifMatch: 'expectedUpdatedAt' },
      'u.up': {
        verb: 'POST',
        path: '/u',
        binary: 'request',
        rawBody: { field: 'bytes', mimeField: 'mime', maxBytes: 1, tooLarge: 'x' },
      },
      'q.ex': {
        verb: 'POST',
        path: '/q',
        binary: 'multipart',
        multipart: { parts: ['pdf'], maxBytes: 1, tooLarge: 'x' },
      },
      'd.get': {
        verb: 'GET',
        path: '/d',
        binary: 'response',
        download: { bytesField: 'bytes', mimeField: 'mime', cache: 'immutable' },
      },
    };
    const byId = Object.fromEntries(contractSnapshot(table).map((e) => [e.id, e]));
    expect(byId['a.get']).toEqual({
      id: 'a.get',
      verb: 'GET',
      path: '/a',
      status: 200,
      etag: 'updatedAt',
    });
    expect(byId['a.put']?.status).toBe(201);
    expect(byId['a.put']?.ifMatch).toBe('expectedUpdatedAt');
    expect(byId['u.up']?.rawBody).toEqual({ field: 'bytes', mimeField: 'mime' });
    expect(byId['q.ex']?.multipart).toEqual({ parts: ['pdf'] });
    expect(byId['d.get']?.download).toEqual({ bytesField: 'bytes', mimeField: 'mime' });
  });
});

test('potret berkas = subset dari kontrak sekarang (tak ada rute hilang tanpa catatan)', () => {
  const stored = JSON.parse(
    readFileSync(new URL('./api-contract.snapshot.json', import.meta.url), 'utf-8'),
  ) as SnapshotEntry[];
  expect(stored.length).toBeGreaterThan(0);
  expect(compareContract(stored, contractSnapshot(), RETIRED_ROUTES)).toEqual([]);
});

describe('removalProblems', () => {
  const HOUR = 60 * 60 * 1000;
  const old: SnapshotEntry[] = [{ id: 'a.b', verb: 'GET', path: '/a', deprecated: true }];
  const retired: RetiredRoute[] = [
    { id: 'a.b', verb: 'GET', path: '/a', removedIn: 'server-v1.4.0' },
  ];
  const input = (overrides: Partial<Parameters<typeof removalProblems>[0]> = {}) => ({
    previous: old,
    current: [] as SnapshotEntry[],
    retired,
    previousTagAgeMs: (25 * HOUR) as number | null,
    minAgeMs: REMOVAL_MIN_AGE_MS,
    ...overrides,
  });

  test('batas umur = 24 jam', () => {
    expect(REMOVAL_MIN_AGE_MS).toBe(24 * HOUR);
  });
  test('tag berumur 25 jam: penghapusan boleh', () => {
    expect(removalProblems(input())).toEqual([]);
  });
  test('tag berumur 23 jam: satu pelanggaran yang menyebut 24 jam', () => {
    const problems = removalProblems(input({ previousTagAgeMs: 23 * HOUR }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('24 jam');
    expect(problems[0]).toContain('a.b');
  });
  test('tanpa rilis sebelumnya (umur null) tidak menambah pelanggaran', () => {
    expect(removalProblems(input({ previousTagAgeMs: null }))).toEqual([]);
  });
  test('pelanggaran compareContract tetap muncul walau umur cukup', () => {
    const problems = removalProblems(
      input({ previous: [{ id: 'a.b', verb: 'GET', path: '/a' }], previousTagAgeMs: 99 * HOUR }),
    );
    expect(problems.some((line) => line.includes('belum berstatus deprecated'))).toBe(true);
  });
  test('tak ada id yang dihapus: umur tag tak relevan', () => {
    expect(
      removalProblems(input({ current: old, retired: [], previousTagAgeMs: 1 * HOUR })),
    ).toEqual([]);
  });
});

/** Pelanggaran daftar rute terhapus terhadap tabel rute (kosong = sehat). Dipakai data nyata dan kasus sintetis. */
function retiredProblems(
  retiredRoutes: readonly RetiredRoute[],
  table: Record<string, ApiRouteDef>,
): string[] {
  const live = new Set(Object.values(table).map((def) => `${def.verb} ${def.path}`));
  const problems: string[] = [];
  for (const route of retiredRoutes) {
    if (!/^server-v\d+\.\d+\.\d+$/.test(route.removedIn)) {
      problems.push(`${route.id}: removedIn "${route.removedIn}" bukan server-vX.Y.Z`);
    }
    if (Object.hasOwn(table, route.id)) {
      problems.push(`${route.id}: masih ada di API_ROUTES padahal dicatat terhapus`);
    }
    if (live.has(`${route.verb} ${route.path}`)) {
      problems.push(`${route.id}: ${route.verb} ${route.path} sama dengan rute yang masih hidup`);
    }
  }
  return problems;
}

describe('RETIRED_ROUTES (pagar data)', () => {
  test('data nyata: removedIn sah, id tak ada di API_ROUTES, jalur tak menutupi rute hidup', () => {
    expect(retiredProblems(RETIRED_ROUTES, API_ROUTES)).toEqual([]);
  });
  test('kasus sintetis: entri tak sah ditolak, entri sah lolos', () => {
    const table: Record<string, ApiRouteDef> = { 'a.get': { verb: 'GET', path: '/a/{id}' } };
    const route = (over: Partial<RetiredRoute>): RetiredRoute => ({
      id: 'a.old',
      verb: 'GET',
      path: '/x',
      removedIn: 'server-v1.2.0',
      ...over,
    });
    expect(retiredProblems([route({ path: '/a/{id}' })], table)).toHaveLength(1);
    expect(retiredProblems([route({ id: 'a.get' })], table)).toHaveLength(1);
    expect(retiredProblems([route({ removedIn: 'v1.2.0' })], table)).toHaveLength(1);
    expect(retiredProblems([route({})], table)).toEqual([]);
  });
});
