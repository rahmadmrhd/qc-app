import { expect, test } from 'bun:test';
import { app } from './index';

test('GET /api/ping menjawab ok', async () => {
  const response = await app.request('/api/ping');
  expect(response.status).toBe(200);
  expect((await response.json()) as unknown).toEqual({ ok: true });
});
