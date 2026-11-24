// Alur login desktop lewat peramban sistem (PKCE S256): `start()` membuka port loopback 127.0.0.1 lalu
// `<server>/auth/desktop/start?challenge&state&port`; setelah login server mengarahkan peramban ke
// `http://127.0.0.1:<port>/callback?code&state` (jalur utama sejak 2026-11-16; tanpa `port` atau bila loopback tak
// dapat dibuka, ke `qc://auth?code&state`). Keduanya berakhir di `handleAuth()` yang menukar kode dan `verifier` di
// `POST /auth/desktop/token`. `verifier` hanya di
// memori dan tak pernah ada di URL; token hanya disimpan ke `TokenStore` (tak pernah ke renderer,
// log, atau galat). Hanya SATU login berjalan; callback kedua/asing diabaikan.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthStatus } from '@countrylock/bridge-contract';
import { type AuthErrorCode, parseQcUrl } from '../qc-url';
import type { Settings } from '../settings';
import type { Loopback } from './loopback';
import type { TokenStore } from './token-store';

export interface LoginFlowDeps {
  settings: () => Settings;
  tokens: TokenStore;
  /** `shell.openExternal` di aplikasi (pembungkus yang hanya mengizinkan https/localhost). */
  openExternal(url: string): Promise<void>;
  /**
   * Membuka penerima callback loopback; dipanggil sebelum peramban dibuka. Tanpa dep ini atau bila gagal,
   * login memakai `qc://auth`.
   */
  startLoopback?(
    onCallback: (code: string, state: string) => Promise<boolean>,
    onError?: (error: AuthErrorCode, state: string) => Promise<boolean>,
  ): Promise<Loopback>;
  fetchImpl?: typeof fetch;
  random?(n: number): Uint8Array;
  now?(): number;
  onChange(status: AuthStatus): void;
}

export interface LoginFlow {
  start(): Promise<void>;
  /**
   * `qc://auth?...` (kode login, atau `error=<kode>&state` bila server gagal masuk); `true` hanya bila kode berhasil
   * ditukar dan token tersimpan.
   */
  handleCallback(url: string): Promise<boolean>;
  status(): AuthStatus;
  logout(): void;
  /** Menutup penerima loopback (keluar aplikasi). */
  dispose(): void;
}

/** Login yang lebih lama dari ini tidak diterima lagi (sama dengan masa cookie awal di server). */
export const LOGIN_MAX_AGE_MS = 10 * 60 * 1000;
const TOKEN_REQUEST_TIMEOUT_MS = 20_000;
const MAX_TOKEN_LENGTH = 4096;

interface PendingLogin {
  verifier: string;
  state: string;
  serverUrl: string;
  startedAt: number;
}

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createLoginFlow(deps: LoginFlowDeps): LoginFlow {
  const doFetch = deps.fetchImpl ?? fetch;
  const random = deps.random ?? ((n: number) => randomBytes(n));
  const now = deps.now ?? Date.now;
  let pending: PendingLogin | null = null;
  let loopback: Loopback | null = null;
  // Penolakan login terakhir dari server (`error=<kode>`); hanya bermakna selama belum masuk. Dibersihkan saat login
  // baru dimulai, login sukses, dan keluar.
  let lastError: AuthErrorCode | null = null;
  const closeLoopback = (): void => {
    loopback?.close();
    loopback = null;
  };

  const status = (): AuthStatus => {
    const stored = deps.tokens.get();
    return {
      signedIn: stored !== null,
      email: stored ? stored.email : null,
      serverUrl: deps.settings().serverUrl,
      // Hanya `error` dari daftar tetap, dan hanya saat belum masuk (sesi sah dari jalur lain menimpanya).
      ...(stored === null && lastError !== null ? { error: lastError } : {}),
    };
  };
  const notify = (): void => {
    try {
      deps.onChange(status());
    } catch {
      // Pendengar tak boleh menjatuhkan alur login.
    }
  };

  /** Menukar kode; semua kegagalan menjadi `false` tanpa membawa isi respons atau token. */
  async function exchange(login: PendingLogin, code: string): Promise<boolean> {
    try {
      const response = await doFetch(`${login.serverUrl}/auth/desktop/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qc' },
        body: JSON.stringify({ code, verifier: login.verifier }),
        redirect: 'manual',
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      });
      if (response.status !== 200) return false;
      const body = (await response.json()) as Record<string, unknown>;
      const { token, expiresAt, email } = body;
      if (
        typeof token !== 'string' ||
        token === '' ||
        token.length > MAX_TOKEN_LENGTH ||
        typeof expiresAt !== 'number' ||
        !Number.isFinite(expiresAt) ||
        typeof email !== 'string' ||
        email === ''
      ) {
        return false;
      }
      deps.tokens.set({ token, email, expiresAt });
      return true;
    } catch {
      return false;
    }
  }

  /** Callback sah dari `qc://` atau loopback: satu-satunya jalan menghabiskan login yang berjalan. */
  async function handleAuth(callback: { code: string; state: string }): Promise<boolean> {
    const login = pending;
    // Loopback milik login INI: login kedua yang dimulai selama penukaran berjalan memasang loopback barunya
    // sendiri dan tak boleh ikut tertutup oleh penyelesaian login lama.
    const mine = loopback;
    // `onChange` hanya untuk hasil nyata login yang berjalan (sukses, penukaran gagal, kedaluwarsa).
    // Callback asing, ganda, tak sah, atau tanpa login berjalan diabaikan DIAM-DIAM: kalau tidak, UI
    // menampilkan "login gagal" padahal login sah masih menunggu.
    if (!login || !sameString(callback.state, login.state)) return false;
    if (now() - login.startedAt > LOGIN_MAX_AGE_MS) {
      pending = null;
      closeLoopback();
      notify();
      return false;
    }
    // Dihabiskan SEBELUM menukar: callback kedua (juga yang serentak) tak lagi cocok.
    pending = null;
    const ok = await exchange(login, callback.code);
    if (ok) lastError = null;
    if (loopback === mine) closeLoopback();
    notify();
    return ok;
  }

  /**
   * Galat login dari server (`error=<kode>&state`): kode sudah divalidasi terhadap daftar tetap oleh pemanggil. `true`
   * bila `state` cocok dengan login yang berjalan (login dihabiskan, UI diberi tahu); selain itu diabaikan diam-diam
   * seperti callback asing.
   */
  function handleAuthError(failure: { error: AuthErrorCode; state: string }): boolean {
    const login = pending;
    if (!login || !sameString(failure.state, login.state)) return false;
    pending = null;
    lastError = failure.error;
    closeLoopback();
    notify();
    return true;
  }

  return {
    async start() {
      closeLoopback();
      lastError = null;
      // Urutan acak: verifier dahulu, lalu state. Login baru menggantikan yang lama.
      const verifier = b64url(random(32));
      const state = b64url(random(16));
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const serverUrl = deps.settings().serverUrl;
      const url = new URL(`${serverUrl}/auth/desktop/start`);
      url.searchParams.set('challenge', challenge);
      url.searchParams.set('state', state);
      if (deps.startLoopback) {
        try {
          loopback = await deps.startLoopback(
            (code, callbackState) => handleAuth({ code, state: callbackState }),
            (error, callbackState) =>
              Promise.resolve(handleAuthError({ error, state: callbackState })),
          );
          url.searchParams.set('port', String(loopback.port));
        } catch {
          // Tak dapat membuka port: jatuh ke `qc://auth` (aplikasi terkemas mendaftarkannya).
          loopback = null;
        }
      }
      pending = { verifier, state, serverUrl, startedAt: now() };
      try {
        await deps.openExternal(url.toString());
      } catch {
        // Dilaporkan lewat penolakan `start()` (bukan `onChange`): UI tak boleh melihat kegagalan palsu.
        pending = null;
        closeLoopback();
        throw new Error('Tidak dapat membuka peramban sistem');
      }
    },

    async handleCallback(rawUrl) {
      const parsed = parseQcUrl(rawUrl);
      if (parsed?.auth) return handleAuth(parsed.auth);
      if (parsed?.authError) handleAuthError(parsed.authError);
      return false;
    },

    status,

    logout() {
      pending = null;
      lastError = null;
      closeLoopback();
      deps.tokens.clear();
      notify();
    },

    dispose() {
      pending = null;
      closeLoopback();
    },
  };
}
