import type { BootData } from '@shared/rpc';
import type { SessionState } from '@/modules/auth/session';

export function readBoot(): BootData {
  return window.__BOOT__ ?? {};
}

export function resolveInitialSession(
  boot: BootData,
  storedToken: string | null,
  storedNonce: string | null = null,
): SessionState {
  const loginUrl = boot.loginUrl ?? null;
  // Token dari callback hanya sah bila nonce-nya cocok dengan yang dibuat browser ini (anti login-CSRF).
  if (boot.sessionToken && boot.nonce && boot.nonce === storedNonce) {
    return { token: boot.sessionToken, loginUrl, authError: null, authErrorEmail: null };
  }
  if (boot.authError === 'NOT_WHITELISTED') {
    return {
      token: null,
      loginUrl,
      authError: 'NOT_WHITELISTED',
      authErrorEmail: boot.email ?? null,
    };
  }
  // LOGIN_FAILED karena refresh di URL callback lama: token tersimpan tetap sah.
  if (storedToken) return { token: storedToken, loginUrl, authError: null, authErrorEmail: null };
  return { token: null, loginUrl, authError: boot.authError ?? null, authErrorEmail: null };
}
