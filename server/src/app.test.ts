import { expect, test } from 'bun:test';
import { API_GROUP_VERSIONS } from '@shared/api-versions';
import pkg from '../package.json';
import { app } from './app';

test('GET /api/ping menjawab ok beserta versi server dan build', async () => {
  const response = await app.request('/api/ping');
  expect(response.status).toBe(200);
  const body = (await response.json()) as { ok: boolean; version: string; build: string };
  expect(body.ok).toBe(true);
  expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(body.version).toBe(pkg.version);
  expect(body.build).toBe('unknown');
});

test('GET /api/ping memuat SHA build bila Env.BUILD_SHA diisi', async () => {
  const sha = 'a'.repeat(40);
  const response = await app.request('/api/ping', {}, { BUILD_SHA: sha });
  const body = (await response.json()) as { build: string };
  expect(body.build).toBe(sha);
});

test('GET /api/ping mengumumkan versi API per kelompok (aditif, field lama tetap)', async () => {
  const response = await app.request('/api/ping');
  const body = (await response.json()) as {
    ok: boolean;
    version: string;
    build: string;
    apis: Record<string, { latest: number; deprecated: number[] }>;
  };
  expect(body.ok).toBe(true);
  expect(body.version).toBe(pkg.version);
  expect(body.build).toBe('unknown');
  expect(Object.keys(body.apis).sort()).toEqual(Object.keys(API_GROUP_VERSIONS).sort());
  expect(body.apis.qrcodes).toEqual({ latest: 1, deprecated: [] });
});
