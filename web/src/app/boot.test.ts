import type { MeDto } from '@shared/rpc';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { loadMe, readAuthError, resolveInitialSession } from './boot';

const me = { email: 'a@x.com', name: 'A' } as MeDto;

afterEach(() => vi.unstubAllEnvs());

test('readAuthError hanya menerima kode yang dikenal', () => {
  expect(readAuthError('?authError=NOT_WHITELISTED')).toBe('NOT_WHITELISTED');
  expect(readAuthError('?authError=LOGIN_FAILED')).toBe('LOGIN_FAILED');
  expect(readAuthError('?authError=lain')).toBeNull();
  expect(readAuthError('')).toBeNull();
});

test('sesi sah dari boot; tanpa me, galat login ditampilkan', () => {
  expect(resolveInitialSession(me, null)).toMatchObject({ authenticated: true, email: 'a@x.com' });
  expect(resolveInitialSession(null, 'LOGIN_FAILED')).toMatchObject({
    authenticated: false,
    authError: 'LOGIN_FAILED',
    loginUrl: '/auth/login',
  });
});

test('loadMe memanggil auth.me lewat api() (GET /api/v1/me); 401, galat server, dan jaringan = belum login', async () => {
  const ok = vi.fn(async () => me);
  await expect(loadMe(ok as never)).resolves.toEqual(me);
  expect(ok).toHaveBeenCalledWith('auth.me', null);
  const unauthorized = vi.fn(async () => {
    throw new ApiError('UNAUTHENTICATED', 'Sesi tidak valid', 'r1', undefined, { status: 401 });
  });
  await expect(loadMe(unauthorized as never)).resolves.toBeNull();
  const broken = vi.fn(async () => {
    throw new ApiError('INTERNAL', 'Tidak dapat menghubungi server.', '-');
  });
  await expect(loadMe(broken as never)).resolves.toBeNull();
  const offline = vi.fn(async () => Promise.reject(new TypeError('offline')));
  await expect(loadMe(offline as never)).resolves.toBeNull();
});
