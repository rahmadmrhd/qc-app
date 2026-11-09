import type { AuthErrorCode } from '@shared/contract';

/**
 * Cache query tersimpan (lihat app/query-persist); dibuang saat keluar/sesi berakhir. Naikkan versi pada kunci DAN
 * amplopnya setiap bentuk data yang disimpan berubah (mis. field baru pada `MeDto`/`BrandDto`), dan daftarkan kunci
 * lama di `LEGACY_PERSISTED_CACHE_KEYS` agar ikut dibersihkan.
 */
export const PERSISTED_CACHE_KEY = 'qc.cache.v2';
/** Kunci versi lama: tak pernah dibaca lagi, hanya dibuang (restore dan keluar). */
export const LEGACY_PERSISTED_CACHE_KEYS: readonly string[] = ['qc.cache.v1'];

/** Awal alur login Google (ditangani server, rute `/auth/*`). */
export const LOGIN_URL = '/auth/login';

export interface SessionState {
  /** Sesi cookie sah (hasil GET /api/v1/me). Token tidak pernah dipegang JavaScript. */
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
  safeRemove(PERSISTED_CACHE_KEY);
  for (const key of LEGACY_PERSISTED_CACHE_KEYS) safeRemove(key);
}
