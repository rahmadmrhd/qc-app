import type { AuthErrorCode, MeDto } from '@shared/contract';
import { type ApiCall, ApiError, api } from '@/lib/api';
import { ANONYMOUS_SESSION, type SessionState } from '@/modules/auth/session';

/** Galat login dari redirect server (`/?authError=...`); nilai lain diabaikan. */
export function readAuthError(search: string): AuthErrorCode | null {
  const value = new URLSearchParams(search).get('authError');
  return value === 'NOT_WHITELISTED' || value === 'LOGIN_FAILED' ? value : null;
}

export function resolveInitialSession(
  me: MeDto | null,
  authError: AuthErrorCode | null,
): SessionState {
  if (me) return { ...ANONYMOUS_SESSION, authenticated: true, email: me.email };
  return { ...ANONYMOUS_SESSION, authError };
}

/**
 * Data awal klien: `GET /api/v1/me` (id `auth.me`, sesi dari cookie). 401 = belum login. Server tidak terjangkau
 * (`UNAVAILABLE`) dikembalikan sebagai `'unavailable'` agar boot menampilkan layar "Tidak ada koneksi", BUKAN halaman
 * login yang menyesatkan (FR-P7). Galat lain (5xx dan sebagainya) tetap diperlakukan sebagai belum login.
 */
export async function loadMe(call: ApiCall = api): Promise<MeDto | null | 'unavailable'> {
  try {
    return (await call('auth.me', null)) ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAVAILABLE') return 'unavailable';
    return null;
  }
}
