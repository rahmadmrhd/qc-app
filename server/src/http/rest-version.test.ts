import { describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import type { RouteTable } from '@server/core/router';
import { buildOpenApi, openApiPathKey, serversFor } from '@server/http/openapi';
import { listOperations } from '@server/http/rest';
import { isRestPath } from '@server/http/security';
import { API_ROUTES, type ApiRouteDef } from '@shared/api';

// Izin tak relevan di sini (hanya bentuk dokumen yang diperiksa).
const NO_ROUTES = {} as RouteTable;

// Tabel palsu: id dasar v1 dan dua id @2, bentuk yang sama dengan tabel nyata tetapi bebas dari kontrak asli.
const FAKE: Record<string, ApiRouteDef> = {
  'a.b': { verb: 'GET', path: '/b' },
  'a.b@2': { verb: 'GET', path: '/b' },
  'a.c@2': { verb: 'POST', path: '/c/{id}' },
};

describe('listOperations per versi', () => {
  test('tanpa argumen = perilaku lama (tiap id + tiap create, urutan tetap)', () => {
    const ids = Object.keys(API_ROUTES);
    const creates = ids.filter((id) => (API_ROUTES as Record<string, ApiRouteDef>)[id]?.create);
    const operations = listOperations();
    expect(operations).toHaveLength(ids.length + creates.length);
    // Statis didahulukan atas berparameter, jadi jumlah parameter tak pernah menurun sepanjang daftar.
    const params = operations.map((operation) => (operation.path.match(/\{/g) ?? []).length);
    expect(params).toEqual([...params].sort((a, b) => a - b));
  });

  test('versi 2 hanya memuat id @2', () => {
    const ids = listOperations(2, FAKE).map((operation) => operation.id as string);
    expect(ids.sort()).toEqual(['a.b@2', 'a.c@2']);
  });

  test('versi 1 hanya memuat id dasar', () => {
    expect(listOperations(1, FAKE).map((operation) => operation.id as string)).toEqual(['a.b']);
  });

  test('versi tanpa rute kosong', () => {
    expect(listOperations(3, FAKE)).toEqual([]);
  });
});

describe('isRestPath', () => {
  test('mengenali /api/v<n> dan turunannya', () => {
    for (const path of ['/api/v1', '/api/v1/x', '/api/v2/x', '/api/v10/x']) {
      expect(isRestPath(path)).toBe(true);
    }
  });
  test('menolak yang bukan jalur versi', () => {
    for (const path of ['/api/v1x/y', '/api/vx', '/api/ping', '/api/desktop/x', '/api']) {
      expect(isRestPath(path)).toBe(false);
    }
  });
});

describe('serversFor', () => {
  test('v1 tanpa override, v2 ke atas memakai server /api (jalurnya membawa /v<n>)', () => {
    expect(serversFor(1)).toBeUndefined();
    expect(serversFor(2)).toEqual([{ url: '/api' }]);
    expect(serversFor(10)).toEqual([{ url: '/api' }]);
  });

  test('openApiPathKey: v1 polos, v2 ke atas diawali /v<n>', () => {
    expect(openApiPathKey(1, '/b/{id}')).toBe('/b/{id}');
    expect(openApiPathKey(2, '/b/{id}')).toBe('/v2/b/{id}');
    expect(openApiPathKey(12, '/b')).toBe('/v12/b');
  });
});

describe('OpenAPI berversi', () => {
  test('dokumen tabel asli tidak memuat override servers', () => {
    const doc = buildOpenApi(NO_ROUTES);
    expect(doc.servers).toEqual([{ url: '/api/v1' }]);
    for (const item of Object.values(doc.paths)) {
      expect(Object.keys(item).includes('servers')).toBe(false);
    }
  });

  test('rute @n selalu memakai kunci /v<n><jalur> dan servers /api; v1 tak berubah dan tak tertimpa', () => {
    const doc = buildOpenApi(NO_ROUTES, FAKE);
    // Kunci path item sah menurut OAS 3.1 (tanpa query string) dan tak pernah bertabrakan antar versi.
    expect(Object.keys(doc.paths).sort()).toEqual(['/b', '/v2/b', '/v2/c/{id}']);
    for (const key of Object.keys(doc.paths)) expect(key).not.toContain('?');
    expect((doc.paths['/b'] as Record<string, unknown>).servers).toBeUndefined();
    expect(Object.keys(doc.paths['/b'] as object)).toEqual(['get']);
    expect((doc.paths['/v2/b'] as Record<string, unknown>).servers).toEqual([{ url: '/api' }]);
    expect((doc.paths['/v2/c/{id}'] as Record<string, unknown>).servers).toEqual([{ url: '/api' }]);
    const operationIds = Object.values(doc.paths).flatMap((item) =>
      Object.values(item).flatMap((entry) =>
        typeof entry === 'object' && entry !== null && 'operationId' in entry
          ? [(entry as { operationId: string }).operationId]
          : [],
      ),
    );
    expect(operationIds.sort()).toEqual(['a.b', 'a.b@2', 'a.c@2']);
  });
});

describe('aplikasi: jalur /api/v<n>', () => {
  test('POST /api/v2/* tanpa header CSRF = 403 problem+json', async () => {
    const response = await app.request('/api/v2/apa-saja', { method: 'POST' });
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });

  test('GET /api/v2/* yang tak ada = 404 bukan HTML', async () => {
    const response = await app.request('/api/v2/apa-saja');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
  });
});
