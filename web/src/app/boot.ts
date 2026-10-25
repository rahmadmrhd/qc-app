import type { AuthErrorCode, MeDto } from '@shared/rpc';
import { ANONYMOUS_SESSION, type SessionState } from '@/modules/auth/session';

/** Galat login dari redirect Worker (`/?authError=...`); nilai lain diabaikan. */
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
 * Data awal klien: `GET /api/boot` (alias `auth.me`, sesi dari cookie). 401 = belum login. Galat lain
 * (jaringan/5xx) diperlakukan sebagai belum login agar halaman login tetap bisa tampil.
 */
export async function loadBoot(fetchImpl: typeof fetch = fetch): Promise<MeDto | null> {
  try {
    const response = await fetchImpl('/api/boot', { credentials: 'same-origin' });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; data?: MeDto };
    return body.ok && body.data ? body.data : null;
  } catch {
    return null;
  }
}
