import type { AuthErrorCode, MeDto } from '@shared/contract';
import { type ApiCall, api } from '@/lib/api';
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
 * Data awal klien: `GET /api/v1/me` (id `auth.me`, sesi dari cookie). 401 = belum login. Galat lain
 * (jaringan/5xx) diperlakukan sebagai belum login agar halaman login tetap bisa tampil.
 */
export async function loadMe(call: ApiCall = api): Promise<MeDto | null> {
  try {
    return (await call('auth.me', null)) ?? null;
  } catch {
    return null;
  }
}
