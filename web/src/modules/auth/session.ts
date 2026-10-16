import type { AuthErrorCode } from '@shared/rpc';

const TOKEN_STORAGE_KEY = 'qc.session';
/** Cache query tersimpan (lihat app/query-persist); dibuang bersama token saat keluar/sesi berakhir. */
export const PERSISTED_CACHE_KEY = 'qc.cache.v1';

export interface SessionState {
  token: string | null;
  loginUrl: string | null;
  authError: AuthErrorCode | null;
  authErrorEmail: string | null;
}

let state: SessionState = { token: null, loginUrl: null, authError: null, authErrorEmail: null };

function persist(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(PERSISTED_CACHE_KEY);
    }
  } catch {
    // Storage diblokir (mode privat / kebijakan browser) — sesi tetap berjalan di memori.
  }
}

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getSession(): SessionState {
  return state;
}

export function getToken(): string | null {
  return state.token;
}

export function initSession(next: SessionState): void {
  state = next;
  persist(next.token);
}

export function setToken(token: string): void {
  state = { ...state, token, authError: null, authErrorEmail: null };
  persist(token);
}

export function clearToken(): void {
  state = { ...state, token: null };
  persist(null);
}
