import { describe, expect, test } from 'bun:test';
import { API_ROUTES, SYNC_API_ROUTES, type SyncRouteId, syncInputFromParts } from './api';
import { SYNC_LIMITS, SYNC_REST_API_VERSION } from './sync';

// Kontrak QC Desktop versi 2 (REST `/api/v1/sync/*`): tabel rute murni, mengikuti pola `API_ROUTES`.

const IDS = Object.keys(SYNC_API_ROUTES) as SyncRouteId[];

describe('tabel rute sinkron', () => {
  test('enam rute dengan verba dan jalur final (relatif terhadap /api/v1)', () => {
    const rows = IDS.map((id) => `${id} ${SYNC_API_ROUTES[id].verb} ${SYNC_API_ROUTES[id].path}`);
    expect(rows.sort()).toEqual(
      [
        'sync.ping GET /sync/ping',
        'sync.brands.pull GET /sync/brands',
        'sync.brands.push POST /sync/brands/push',
        'sync.items.pull GET /sync/items',
        'sync.items.push POST /sync/items/push',
        'sync.file.get GET /sync/files/{id}',
      ].sort(),
    );
  });

  test('query pull: sinceRev dan limit angka; include berupa daftar (items: subset field berat; brands: dideklarasikan agar ditolak validator, seperti v1)', () => {
    expect(SYNC_API_ROUTES['sync.brands.pull'].query).toEqual({
      sinceRev: 'number',
      limit: 'number',
      include: 'list',
    });
    expect(SYNC_API_ROUTES['sync.items.pull'].query).toEqual({
      sinceRev: 'number',
      limit: 'number',
      include: 'list',
    });
  });

  test('sync.file.get = unduhan biner (byte mentah, Content-Type dari berkas), bukan base64', () => {
    const def = SYNC_API_ROUTES['sync.file.get'];
    expect(def.binary).toBe('response');
    expect(def.download).toMatchObject({ bytesField: 'bytes', mimeField: 'mime' });
  });

  test('tak bertabrakan dengan jalur tabel aplikasi web', () => {
    const web = new Set(
      Object.values(API_ROUTES).flatMap((def) => [
        `${def.verb} ${def.path}`,
        ...(def.create ? [`${def.create.verb} ${def.create.path}`] : []),
      ]),
    );
    for (const id of IDS)
      expect(web.has(`${SYNC_API_ROUTES[id].verb} ${SYNC_API_ROUTES[id].path}`)).toBe(false);
  });

  test('versi API REST = 2', () => {
    expect(SYNC_REST_API_VERSION).toBe(2);
  });
});

describe('syncInputFromParts', () => {
  const parts = (over: Partial<Parameters<typeof syncInputFromParts>[1]> = {}) => ({
    params: {},
    query: {},
    body: undefined,
    ...over,
  });

  test('ping tanpa input', () => {
    expect(syncInputFromParts('sync.ping', parts({ query: { x: '1' } }))).toBeNull();
  });

  test('pull: query diparse (angka, daftar); query tak dikenal diabaikan; kosong = objek kosong', () => {
    expect(syncInputFromParts('sync.items.pull', parts())).toEqual({});
    expect(
      syncInputFromParts(
        'sync.items.pull',
        parts({ query: { sinceRev: '120', limit: '50', include: 'detail,stickers', lain: 'x' } }),
      ),
    ).toEqual({ sinceRev: 120, limit: 50, include: ['detail', 'stickers'] });
  });

  test('pull: bukan angka melempar galat field', () => {
    expect(() =>
      syncInputFromParts('sync.brands.pull', parts({ query: { sinceRev: 'abc' } })),
    ).toThrow();
    try {
      syncInputFromParts('sync.brands.pull', parts({ query: { limit: 'x' } }));
    } catch (issue) {
      expect(issue).toMatchObject({ field: 'limit' });
    }
  });

  test('file.get: id jalur menjadi driveId', () => {
    expect(syncInputFromParts('sync.file.get', parts({ params: { id: 'abc123' } }))).toEqual({
      driveId: 'abc123',
    });
  });

  test('push: badan apa adanya (hanya properti milik; __proto__/constructor/prototype dibuang)', () => {
    const body = JSON.parse(
      '{"items":[{"id":"1"}],"overwrite":true,"__proto__":{"x":1},"constructor":{"y":2}}',
    );
    const input = syncInputFromParts('sync.items.push', parts({ body })) as Record<string, unknown>;
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(Object.keys(input).sort()).toEqual(['items', 'overwrite']);
    expect(syncInputFromParts('sync.brands.push', parts())).toBeNull();
    expect(() => syncInputFromParts('sync.items.push', parts({ body: [1] }))).toThrow();
  });
});

describe('batas kontrak versi 2', () => {
  test('batas dokumen: pull 500 (200 dengan detail), push 50 (25 dengan detail), berkas 8 MB, body 5 MB', () => {
    expect(SYNC_LIMITS.pullMax).toBe(500);
    expect(SYNC_LIMITS.pullMaxWithDetail).toBe(200);
    expect(SYNC_LIMITS.pushMax).toBe(50);
    expect(SYNC_LIMITS.pushMaxWithDetail).toBe(25);
    expect(SYNC_LIMITS.fileBytes).toBe(8_000_000);
    expect(SYNC_LIMITS.bodyChars).toBe(5_000_000);
  });
});
