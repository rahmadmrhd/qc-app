import type { MeDto } from '@shared/contract';
import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { loadMe, loadMeState, resolveInitialSession } from './boot';

const me = { email: 'a@x.com', name: 'A' } as MeDto;

afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
});

function networkError() {
  // Galat jaringan klien (fetch gagal): INTERNAL tanpa requestId server dan dengan penyebab.
  return new ApiError('INTERNAL', 'Tidak dapat menghubungi server.', '-', undefined, {
    cause: new TypeError('offline'),
  });
}

test('desktop: loadMe tetap dipanggil (tidak dilewati) dan galat jaringan = null', async () => {
  (window as unknown as { qcBridge?: unknown }).qcBridge = { version: 2 };
  const ok = vi.fn(async () => me);
  await expect(loadMe(ok as never)).resolves.toEqual(me);
  expect(ok).toHaveBeenCalledWith('auth.me', null);
  const offline = vi.fn(async () => {
    throw networkError();
  });
  await expect(loadMe(offline as never)).resolves.toBeNull();
});

test('loadMeState membedakan server tak terjangkau dari belum login', async () => {
  const ok = vi.fn(async () => me);
  await expect(loadMeState(ok as never)).resolves.toEqual({ me, unreachable: false });

  const unauthorized = vi.fn(async () => {
    throw new ApiError('UNAUTHENTICATED', 'Sesi tidak valid', 'r1', undefined, { status: 401 });
  });
  await expect(loadMeState(unauthorized as never)).resolves.toEqual({
    me: null,
    unreachable: false,
  });

  const offline = vi.fn(async () => {
    throw networkError();
  });
  await expect(loadMeState(offline as never)).resolves.toEqual({ me: null, unreachable: true });

  // Proksi desktop menjawab 503 problem+json saat server mati.
  const unavailable = vi.fn(async () => {
    throw new ApiError('UNAVAILABLE', 'Layanan tidak tersedia', 'r2', undefined, { status: 503 });
  });
  await expect(loadMeState(unavailable as never)).resolves.toEqual({
    me: null,
    unreachable: true,
  });

  // 500 dari server (ada requestId) bukan "tak terjangkau".
  const broken = vi.fn(async () => {
    throw new ApiError('INTERNAL', 'Galat', 'r3', undefined, { status: 500 });
  });
  await expect(loadMeState(broken as never)).resolves.toEqual({ me: null, unreachable: false });

  // Galat non-ApiError (mis. TypeError murni) dihitung tak terjangkau.
  const raw = vi.fn(async () => Promise.reject(new TypeError('offline')));
  await expect(loadMeState(raw as never)).resolves.toEqual({ me: null, unreachable: true });
});

test('resolveInitialSession membawa penanda server tak terjangkau', () => {
  expect(resolveInitialSession(null, null, true)).toMatchObject({ serverUnreachable: true });
  expect(resolveInitialSession(null, null)).toMatchObject({ serverUnreachable: false });
  expect(resolveInitialSession(me, null, true)).toMatchObject({
    authenticated: true,
    serverUnreachable: false,
  });
});
