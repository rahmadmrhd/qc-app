import { beforeEach, expect, test } from 'bun:test';
import { insertLocation_ } from '@gas/modules/access/repo';
import { handleSync_ } from '@gas/modules/sync/handler';
import { getSyncRoutes_ } from '@gas/modules/sync/routes';
import { getRoutes_ } from '@gas/routes';
import { location } from '@gas-test/access-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { RpcResult } from '@shared/rpc';
import { setPlatform_ } from './platform';
import { RPC_ACCESS, SYNC_READ_METHODS } from './read-only';
import { handleRpc_, handleRpcBatch_ } from './router';
import { signSessionToken_ } from './session';

const SYNC_TOKEN = 't0k3n'.repeat(8);
const MESSAGE = 'Aplikasi sedang dipindahkan; hanya baca';

function boot(readOnly: string | null) {
  setPlatform_(
    createMemoryPlatform({
      properties: {
        SESSION_SECRET: 's',
        ADMIN_EMAIL: 'admin@gmail.com',
        SYNC_API_TOKEN: SYNC_TOKEN,
        ...(readOnly === null ? {} : { READ_ONLY: readOnly }),
      },
    }),
  );
  insertLocation_(location({ id: 'l-a', code: 'A' }));
}

const rpc = (method: string, payload: unknown) =>
  handleRpc_(method, JSON.stringify(payload), signSessionToken_('admin@gmail.com'), getRoutes_());
const sync = (method: string, payload: unknown) =>
  handleSync_(JSON.stringify({ v: 1, method, token: SYNC_TOKEN, payload }), getSyncRoutes_());

function code(result: RpcResult<unknown>): string | null {
  return result.ok ? null : result.error.code;
}

const WRITES: Array<[string, unknown]> = [
  ['handovers.save', null],
  ['handovers.setCheck', null],
  ['items.save', null],
  ['files.upload', null],
  ['qrcodes.export', null],
  ['access.users.save', null],
];

beforeEach(() => boot('1'));

test('READ_ONLY=1: RPC tulis ditolak UNAVAILABLE dengan pesan migrasi', () => {
  for (const [method, payload] of WRITES) {
    const result = rpc(method, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAVAILABLE');
      expect(result.error.message).toBe(MESSAGE);
    }
  }
});

test('READ_ONLY=1: RPC baca tetap berjalan', () => {
  expect(rpc('auth.me', null).ok).toBe(true);
  expect(rpc('items.list', null).ok).toBe(true);
  expect(rpc('access.locations.list', null).ok).toBe(true);
  expect(rpc('handovers.board', { locationIds: ['l-a'] }).ok).toBe(true);
});

test('READ_ONLY=1: item tulis dalam batch ditolak, item baca lolos', () => {
  const token = signSessionToken_('admin@gmail.com');
  const result = handleRpcBatch_(
    JSON.stringify([
      { m: 'items.list', p: 'null' },
      { m: 'items.save', p: 'null' },
    ]),
    token,
    getRoutes_(),
  );
  if (!('batch' in result)) throw new Error('Diharapkan batch');
  expect(result.batch.map(code)).toEqual([null, 'UNAVAILABLE']);
});

test('READ_ONLY=1: tanpa sesi sah tetap UNAUTHENTICATED (tidak membocorkan status)', () => {
  const result = handleRpc_('items.save', 'null', 'bukan-token', getRoutes_());
  expect(code(result)).toBe('UNAUTHENTICATED');
});

test('READ_ONLY=1: sinkron tulis ditolak, sinkron baca tetap jalan', () => {
  for (const method of ['sync.items.push', 'sync.brands.push']) {
    const result = sync(method, null);
    expect(code(result)).toBe('UNAVAILABLE');
    if (!result.ok) expect(result.error.message).toBe(MESSAGE);
  }
  expect(sync('sync.ping', null).ok).toBe(true);
  for (const method of ['sync.items.pull', 'sync.brands.pull', 'sync.file.get']) {
    expect(code(sync(method, null))).not.toBe('UNAVAILABLE');
  }
});

test('READ_ONLY=1: sinkron tanpa token sah tetap UNAUTHENTICATED', () => {
  const result = handleSync_(
    JSON.stringify({ v: 1, method: 'sync.items.push', token: 'salah', payload: null }),
    getSyncRoutes_(),
  );
  expect(code(result)).toBe('UNAUTHENTICATED');
});

test('tanpa properti READ_ONLY (atau bukan "1") perilaku tidak berubah', () => {
  for (const value of [null, '', '0', 'true']) {
    boot(value);
    expect(code(rpc('items.save', null))).toBe('VALIDATION');
    expect(code(sync('sync.items.push', null))).toBe('VALIDATION');
    expect(rpc('items.list', null).ok).toBe(true);
  }
});

test('setiap method RPC dan sinkron terklasifikasi (gagal tertutup untuk method baru)', () => {
  expect(Object.keys(RPC_ACCESS).sort()).toEqual(Object.keys(getRoutes_()).sort());
  const syncWrites = Object.keys(getSyncRoutes_()).filter((m) => !SYNC_READ_METHODS.includes(m));
  expect(syncWrites.sort()).toEqual(['sync.brands.push', 'sync.items.push']);
});
