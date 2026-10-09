import { beforeEach, expect, test } from 'bun:test';
import { invalidateAccessCache_ } from '@gas/modules/access/context';
import {
  insertLocation_,
  insertRole_,
  insertUser_,
  listUsers_,
  updateUser_,
} from '@gas/modules/access/repo';
import { location, role, user } from '@gas-test/access-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { RpcResult } from '@shared/rpc';
import { appError_ } from './errors';
import { setPlatform_ } from './platform';
import type { RequestContext, RoutePermission, RouteTable } from './router';
import { handleRpc_ } from './router';
import { signSessionToken_ } from './session';
import { expectNull_ } from './validate';

let platform: MemoryPlatform;
let calls: string[];

const routes = {
  'auth.me': {
    validate: expectNull_,
    handler: (_input: unknown, ctx: RequestContext) => {
      calls.push('me');
      return { email: ctx.user.email };
    },
  },
  'access.users.list': {
    permission: { module: 'access', level: 'view' },
    validate: expectNull_,
    handler: () => {
      calls.push('list');
      return [];
    },
  },
  'access.users.save': {
    permission: { module: 'access', level: 'manage' },
    validate: (raw: unknown) => {
      if (raw === null) {
        throw appError_('VALIDATION', 'Input tidak valid', { email: 'Wajib diisi' });
      }
      return raw;
    },
    handler: () => {
      throw new Error('rahasia internal di stack');
    },
  },
  'item.list': {
    permission: { module: 'item', level: 'view', scope: 'location' },
    validate: (raw: unknown) => raw,
    handler: (_input: unknown, ctx: RequestContext) => {
      calls.push('items');
      return ctx.locationIds;
    },
  },
  'item.save': {
    permission: { module: 'item', level: 'edit', scope: 'location' },
    validate: (raw: unknown) => raw,
    handler: (_input: unknown, ctx: RequestContext) => {
      calls.push('save');
      return ctx.locationIds;
    },
  },
} as unknown as RouteTable;

function errorOf(result: RpcResult<unknown>) {
  if (result.ok) throw new Error(`Diharapkan error, didapat ${JSON.stringify(result.data)}`);
  return result.error;
}

beforeEach(() => {
  calls = [];
  platform = createMemoryPlatform({
    properties: { SESSION_SECRET: 's', ADMIN_EMAIL: 'admin@gmail.com' },
  });
  setPlatform_(platform);
  insertRole_(role({ id: 'r-view', name: 'Viewer', permissions: { access: 'view' } }));
  insertUser_(user({ id: 'u1', email: 'viewer@gmail.com', roleIds: ['r-view'] }));
  insertUser_(user({ id: 'u2', email: 'plain@gmail.com' }));
  insertLocation_(location({ id: 'l-a', code: 'A' }));
  insertLocation_(location({ id: 'l-b', code: 'B' }));
  insertLocation_(location({ id: 'l-mati', code: 'MATI', status: 'inactive' }));
  insertRole_(role({ id: 'r-item-view', name: 'Lihat Item', permissions: { item: 'view' } }));
  insertRole_(role({ id: 'r-item-manage', name: 'Kelola Item', permissions: { item: 'manage' } }));
  insertUser_(
    user({
      id: 'u3',
      email: 'staf@gmail.com',
      assignments: [
        { locationId: 'l-a', roleIds: ['r-item-view'] },
        { locationId: 'l-b', roleIds: ['r-item-manage'] },
        { locationId: 'l-mati', roleIds: ['r-item-manage'] },
      ],
    }),
  );
});

test('method tak dikenal, termasuk nama properti bawaan objek, menghasilkan NOT_FOUND', () => {
  const token = signSessionToken_('admin@gmail.com');
  for (const method of ['x.y', '__proto__', 'constructor', 'toString', 42]) {
    expect(errorOf(handleRpc_(method, 'null', token, routes)).code).toBe('NOT_FOUND');
  }
});

test('tanpa token atau token rusak menghasilkan UNAUTHENTICATED', () => {
  for (const token of [undefined, '', 'abc', 'a.b', 123]) {
    expect(errorOf(handleRpc_('auth.me', 'null', token, routes)).code).toBe('UNAUTHENTICATED');
  }
  expect(calls).toEqual([]);
});

test('token valid milik user yang lalu dinonaktifkan menghasilkan UNAUTHENTICATED', () => {
  const token = signSessionToken_('viewer@gmail.com');
  expect(handleRpc_('auth.me', 'null', token, routes).ok).toBe(true);
  const viewer = listUsers_().find((record) => record.id === 'u1');
  if (!viewer) throw new Error('fixture hilang');
  updateUser_({ ...viewer, status: 'inactive' });
  invalidateAccessCache_();
  expect(errorOf(handleRpc_('auth.me', 'null', token, routes)).code).toBe('UNAUTHENTICATED');
});

test('level kurang menghasilkan FORBIDDEN dan handler tidak dipanggil', () => {
  const token = signSessionToken_('plain@gmail.com');
  expect(errorOf(handleRpc_('access.users.list', 'null', token, routes)).code).toBe('FORBIDDEN');
  expect(calls).toEqual([]);
});

test('payload bukan JSON menghasilkan VALIDATION', () => {
  const token = signSessionToken_('admin@gmail.com');
  expect(errorOf(handleRpc_('auth.me', '{rusak', token, routes)).code).toBe('VALIDATION');
});

test('error validasi membawa daftar field', () => {
  const token = signSessionToken_('admin@gmail.com');
  const error = errorOf(handleRpc_('access.users.save', 'null', token, routes));
  expect(error).toMatchObject({ code: 'VALIDATION', fields: { email: 'Wajib diisi' } });
});

test('error tak terduga disamarkan menjadi INTERNAL dan dicatat bersama requestId', () => {
  const token = signSessionToken_('admin@gmail.com');
  const error = errorOf(handleRpc_('access.users.save', '{"a":1}', token, routes));
  expect(error.code).toBe('INTERNAL');
  expect(error.message).toBe('Terjadi kesalahan pada server');
  expect(error.message).not.toContain('rahasia');
  expect(error.requestId).toHaveLength(8);
  expect(platform.errors[0]).toContain(error.requestId);
  expect(platform.errors[0]).toContain('rahasia internal');
});

test('request sukses mengembalikan data dan meneruskan konteks user', () => {
  const token = signSessionToken_('viewer@gmail.com');
  expect(handleRpc_('access.users.list', 'null', token, routes)).toEqual({ ok: true, data: [] });
  expect(handleRpc_('auth.me', '', token, routes)).toEqual({
    ok: true,
    data: { email: 'viewer@gmail.com' },
  });
  expect(calls).toEqual(['list', 'me']);
});

const call = (method: string, payload: unknown, email = 'staf@gmail.com') =>
  handleRpc_(method, JSON.stringify(payload), signSessionToken_(email), routes);

test('rute berlokasi: baca di beberapa lokasi yang diizinkan, id ganda dirapikan', () => {
  expect(call('item.list', { locationIds: ['l-a', 'l-b', 'l-a'] })).toEqual({
    ok: true,
    data: ['l-a', 'l-b'],
  });
});

test('rute berlokasi: tulis butuh level di lokasi tujuan, bukan di lokasi lain', () => {
  expect(call('item.save', { locationId: 'l-b' })).toEqual({ ok: true, data: ['l-b'] });
  expect(errorOf(call('item.save', { locationId: 'l-a' })).code).toBe('FORBIDDEN');
});

test('satu lokasi terlarang di antara yang diizinkan menolak seluruh permintaan dan handler tidak jalan', () => {
  expect(errorOf(call('item.save', { locationIds: ['l-b', 'l-a'] })).code).toBe('FORBIDDEN');
  expect(calls).toEqual([]);
});

test('lokasi tak dikenal, nonaktif, dan terlarang menghasilkan FORBIDDEN dengan pesan yang sama', () => {
  const messages = ['tidak-ada', 'l-mati'].map(
    (id) => errorOf(call('item.list', { locationIds: [id] })).message,
  );
  expect(new Set(messages).size).toBe(1);
  expect(errorOf(call('item.list', { locationIds: ['l-a'] }, 'plain@gmail.com')).message).toBe(
    messages[0] ?? '',
  );
  expect(calls).toEqual([]);
});

test('rute berlokasi tanpa lokasi atau bentuk salah menghasilkan VALIDATION', () => {
  for (const payload of [
    null,
    {},
    { locationIds: [] },
    { locationIds: [1] },
    { locationId: '' },
    { locationIds: 'l-a' },
  ]) {
    expect(errorOf(call('item.list', payload)).code).toBe('VALIDATION');
  }
  expect(calls).toEqual([]);
});

test('super admin boleh di semua lokasi aktif tetapi tidak di lokasi nonaktif', () => {
  expect(call('item.list', { locationIds: ['l-a', 'l-b'] }, 'admin@gmail.com').ok).toBe(true);
  expect(errorOf(call('item.list', { locationIds: ['l-mati'] }, 'admin@gmail.com')).code).toBe(
    'FORBIDDEN',
  );
});

test('rute global tetap memakai izin global dan menerima locationIds kosong', () => {
  const token = signSessionToken_('viewer@gmail.com');
  expect(handleRpc_('access.users.list', 'null', token, routes)).toEqual({ ok: true, data: [] });
});

test('tipe: modul berlokasi wajib menandai scope location (tidak diam-diam memakai izin global)', () => {
  // @ts-expect-error modul berlokasi tanpa scope: 'location' harus ditolak compiler
  const salah: RoutePermission = { module: 'item', level: 'view' };
  const benar: RoutePermission = { module: 'item', level: 'view', scope: 'location' };
  const global: RoutePermission = { module: 'access', level: 'view' };
  expect([salah, benar, global]).toHaveLength(3);
});
