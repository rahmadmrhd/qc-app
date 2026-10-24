import type { AuthErrorCode } from '@shared/rpc';

/** Cache query tersimpan (lihat app/query-persist); dibuang saat keluar/sesi berakhir. */
export const PERSISTED_CACHE_KEY = 'qc.cache.v1';
const DEV_TOKEN_STORAGE_KEY = 'qc.dev-session';

/** Awal alur login Google (ditangani Worker; `run_worker_first` mencakup /auth/*). */
export const LOGIN_URL = '/auth/login';

export interface SessionState {
  /** Sesi cookie sah (hasil GET /api/boot). Token tidak pernah dipegang JavaScript. */
  authenticated: boolean;
  email: string | null;
  loginUrl: string;
  authError: AuthErrorCode | null;
  authErrorEmail: string | null;
}

export const ANONYMOUS_SESSION: SessionState = {
  authenticated: false,
  email: null,
  loginUrl: LOGIN_URL,
  authError: null,
  authErrorEmail: null,
};

let state: SessionState = ANONYMOUS_SESSION;
/** Hanya mode dev (mock backend di peramban). Produksi memakai cookie HttpOnly dan tidak mengisi ini. */
let devToken: string | null = null;

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage diblokir (mode privat / kebijakan browser) — sesi tetap berjalan di memori.
  }
}

export function getSession(): SessionState {
  return state;
}

export function isAuthenticated(): boolean {
  return state.authenticated;
}

export function initSession(next: SessionState): void {
  state = next;
}

export function markAuthenticated(email: string): void {
  state = { ...state, authenticated: true, email, authError: null, authErrorEmail: null };
}

/** Sesi berakhir/keluar: buang status, token dev, dan cache tersimpan. */
export function clearSession(): void {
  state = { ...state, authenticated: false, email: null };
  devToken = null;
  safeRemove(DEV_TOKEN_STORAGE_KEY);
  safeRemove(PERSISTED_CACHE_KEY);
}

// --- Mode dev (mock backend) ---------------------------------------------------------------------------------------

export function getToken(): string | null {
  return devToken;
}

export function readStoredDevToken(): string | null {
  try {
    return localStorage.getItem(DEV_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setDevToken(token: string | null): void {
  devToken = token;
  try {
    if (token) localStorage.setItem(DEV_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(DEV_TOKEN_STORAGE_KEY);
  } catch {
    // Storage diblokir — token tetap di memori.
  }
}
