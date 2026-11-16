import type { AuthErrorCode, MeDto } from '@shared/contract';
import { type ApiCall, ApiError, api } from '@/lib/api';
import { isDesktop } from '@/lib/platform';
import { ANONYMOUS_SESSION, type SessionState } from '@/modules/auth/session';

/** Galat login dari redirect server (`/?authError=...`); nilai lain diabaikan. */
export function readAuthError(search: string): AuthErrorCode | null {
  const value = new URLSearchParams(search).get('authError');
  return value === 'NOT_WHITELISTED' || value === 'LOGIN_FAILED' ? value : null;
}

export function resolveInitialSession(
  me: MeDto | null,
  authError: AuthErrorCode | null,
  serverUnreachable = false,
): SessionState {
  if (me) return { ...ANONYMOUS_SESSION, authenticated: true, email: me.email };
  return { ...ANONYMOUS_SESSION, authError, serverUnreachable };
}

/**
 * Server tak terjangkau (bukan sekadar belum login)? Galat jaringan klien (INTERNAL tanpa requestId server dan
 * dengan penyebab), 503 `UNAVAILABLE` (proksi desktop saat server mati; di peramban fetch yang gagal juga menjadi
 * `UNAVAILABLE`), atau galat non-ApiError.
 */
function isServerUnreachable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === 'UNAVAILABLE') return true;
  return error.code === 'INTERNAL' && error.requestId === '-' && error.cause !== undefined;
}

export interface MeState {
  me: MeDto | null;
  /** `me` kosong karena server tak terjangkau, bukan karena belum login. */
  unreachable: boolean;
}

/**
 * Data awal klien: `GET /api/v1/me` (id `auth.me`, sesi dari cookie; di desktop proses utama menambahkan Bearer).
 * 401 = belum login. Galat lain (jaringan/5xx) tetap menghasilkan `me: null` agar halaman login bisa tampil, dengan
 * `unreachable` menandai server yang tak terjangkau.
 */
export async function loadMeState(
  call: ApiCall = api,
  options: { timeoutMs?: number } = {},
): Promise<MeState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = call('auth.me', null);
    // Batas waktu opsional: server yang menjatuhkan paket tak pernah menjawab; tanpa batas, boot menggantung.
    const timeout =
      options.timeoutMs === undefined
        ? null
        : new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), options.timeoutMs);
          });
    const result = timeout ? await Promise.race([request, timeout]) : await request;
    if (result === 'timeout') {
      request.catch(() => undefined); // jawaban terlambat/galatnya diabaikan
      return { me: null, unreachable: true };
    }
    return { me: result ?? null, unreachable: false };
  } catch (error) {
    return { me: null, unreachable: isServerUnreachable(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Batas tunggu `GET /api/v1/me` saat boot di desktop; di atasnya halaman login (server tak terjangkau) tampil. */
export const DESKTOP_BOOT_ME_TIMEOUT_MS = 8000;

/** Pemuatan `me` saat boot: dengan batas waktu hanya di desktop (peramban tidak berubah). */
export function loadMeForBoot(call: ApiCall = api): Promise<MeState> {
  return loadMeState(call, isDesktop() ? { timeoutMs: DESKTOP_BOOT_ME_TIMEOUT_MS } : {});
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
