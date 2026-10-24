import type { MeDto } from '@shared/rpc';
import { afterEach, expect, test, vi } from 'vitest';
import { loadBoot, readAuthError, resolveInitialSession } from './boot';

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

test('loadBoot memanggil GET /api/boot dengan cookie; 401 dan galat jaringan = belum login', async () => {
  vi.stubEnv('DEV', false);
  const ok = vi.fn(async () => Response.json({ ok: true, data: me }));
  await expect(loadBoot(ok as unknown as typeof fetch)).resolves.toEqual(me);
  expect(ok).toHaveBeenCalledWith('/api/boot', { credentials: 'same-origin' });
  const unauthorized = vi.fn(async () =>
    Response.json({ ok: false, error: { code: 'UNAUTHENTICATED' } }, { status: 401 }),
  );
  await expect(loadBoot(unauthorized as unknown as typeof fetch)).resolves.toBeNull();
  const offline = vi.fn(async () => Promise.reject(new TypeError('offline')));
  await expect(loadBoot(offline as unknown as typeof fetch)).resolves.toBeNull();
});
