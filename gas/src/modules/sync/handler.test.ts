import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import { getRoutes_ } from '@gas/routes';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_, syncRoute_ } from './handler';
import { getSyncRoutes_ } from './routes';

const TOKEN = 't0k3n'.repeat(8);
let platform: MemoryPlatform;

function boot(properties: Record<string, string> = { SYNC_API_TOKEN: TOKEN }) {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', ...properties },
    now: () => Date.parse('2026-10-15T03:00:00.000Z'),
  });
  setPlatform_(platform);
}

beforeEach(() => {
  boot();
});

const send = (body: unknown) =>
  handleSync_(typeof body === 'string' ? body : JSON.stringify(body), getSyncRoutes_());
const ping = (token: unknown) => send({ v: 1, method: 'sync.ping', token, payload: null });

test('sync.ping dengan token benar mengembalikan versi, waktu server, dan sumber daya', () => {
  expect(ping(TOKEN)).toEqual({
    ok: true,
    data: { apiVersion: 1, serverTime: '2026-10-15T03:00:00.000Z', resources: ['brands', 'items'] },
  });
});

test('semua kegagalan sebelum autentikasi menghasilkan UNAUTHENTICATED yang sama', () => {
  const failures = [
    ping('salah'),
    ping(undefined),
    ping(123),
    send('{bukan json'),
    send(''),
    send('[]'),
    send('null'),
    send({ v: 1, method: 'tidak.ada', token: 'salah', payload: null }),
    send({ v: 99, method: 'sync.ping', token: 'salah' }),
    handleSync_(undefined, getSyncRoutes_()),
    handleSync_('x'.repeat(5_000_001), getSyncRoutes_()),
  ];
  for (const result of failures) {
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Token tidak valid' },
    });
  }
});

test('galat VALIDATION dan NOT_FOUND hanya muncul setelah token benar', () => {
  expect(send({ v: 2, method: 'sync.ping', token: TOKEN })).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION', fields: { v: 'Gunakan v 1' } },
  });
  expect(send({ v: 1, method: 'sync.tidak.ada', token: TOKEN })).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  });
  expect(send({ v: 1, method: 'sync.ping', token: TOKEN, payload: { x: 1 } })).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION' },
  });
});

test('token belum dikonfigurasi atau terlalu pendek: semua permintaan ditolak', () => {
  boot({});
  expect(ping('apa saja')).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  boot({ SYNC_API_TOKEN: 'pendek' });
  expect(ping('pendek')).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
});

test('10 kegagalan memblokir semua permintaan, termasuk yang bertoken benar', () => {
  for (let i = 0; i < 9; i++) ping(`salah-${i}`);
  expect(ping(TOKEN)).toMatchObject({ ok: true });
  ping('salah-9');
  expect(ping(TOKEN)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  expect(platform.cache.get('sync:blocked')).toBe('1');
});

test('token sinkron tidak berlaku untuk RPC web, dan token sesi tidak berlaku untuk jalur sinkron', () => {
  const rpc = handleRpc_('auth.me', '', TOKEN, getRoutes_());
  expect(rpc).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  expect(ping(signSessionToken_('admin@gmail.com'))).toMatchObject({
    ok: false,
    error: { code: 'UNAUTHENTICATED' },
  });
});

test('galat tak terduga di handler menjadi INTERNAL tanpa membocorkan detail, dan dicatat', () => {
  const routes = {
    'sync.boom': syncRoute_({
      validate: () => null,
      handler: () => {
        throw new Error('rahasia internal');
      },
    }),
  };
  const result = handleSync_(JSON.stringify({ v: 1, method: 'sync.boom', token: TOKEN }), routes);
  expect(result).toMatchObject({
    ok: false,
    error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' },
  });
  expect(JSON.stringify(result)).not.toContain('rahasia');
  expect(platform.errors.join('')).toContain('rahasia internal');
});

test('handler menerima konteks dengan pelaku sync:desktop dan tanpa user', () => {
  let seen: unknown;
  const routes = {
    'sync.ctx': syncRoute_({
      validate: () => null,
      handler: (_input, ctx) => {
        seen = ctx;
        return 1;
      },
    }),
  };
  handleSync_(JSON.stringify({ v: 1, method: 'sync.ctx', token: TOKEN }), routes);
  expect(seen).toMatchObject({ actor: 'sync:desktop' });
  expect(Object.keys(seen as object).sort()).toEqual(['actor', 'requestId']);
});

test('nama method bawaan Object (constructor, __proto__) tidak dianggap rute', () => {
  for (const method of ['constructor', '__proto__', 'toString']) {
    expect(send({ v: 1, method, token: TOKEN })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  }
});
