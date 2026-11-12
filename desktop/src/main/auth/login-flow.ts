// Alur login desktop lewat peramban sistem (PKCE S256): `start()` membuka
// `<server>/auth/desktop/start?challenge&state`, server mengarahkan ke `qc://auth?code&state`, lalu
// `handleCallback()` menukar kode dan `verifier` di `POST /auth/desktop/token`. `verifier` hanya di
// memori dan tak pernah ada di URL; token hanya disimpan ke `TokenStore` (tak pernah ke renderer,
// log, atau galat). Hanya SATU login berjalan; callback kedua/asing diabaikan.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthStatus } from '@countrylock/bridge-contract';
import { parseQcUrl } from '../qc-url';
import type { Settings } from '../settings';
import type { TokenStore } from './token-store';

export interface LoginFlowDeps {
  settings: () => Settings;
  tokens: TokenStore;
  /** `shell.openExternal` di aplikasi (pembungkus yang hanya mengizinkan https/localhost). */
  openExternal(url: string): Promise<void>;
  fetchImpl?: typeof fetch;
  random?(n: number): Uint8Array;
  now?(): number;
  onChange(status: AuthStatus): void;
}

export interface LoginFlow {
  start(): Promise<void>;
  /** `true` hanya bila kode berhasil ditukar dan token tersimpan. */
  handleCallback(url: string): Promise<boolean>;
  status(): AuthStatus;
  logout(): void;
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

  const status = (): AuthStatus => {
    const stored = deps.tokens.get();
    return {
      signedIn: stored !== null,
      email: stored ? stored.email : null,
      serverUrl: deps.settings().serverUrl,
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

  return {
    async start() {
      // Urutan acak: verifier dahulu, lalu state. Login baru menggantikan yang lama.
      const verifier = b64url(random(32));
      const state = b64url(random(16));
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const serverUrl = deps.settings().serverUrl;
      const url = new URL(`${serverUrl}/auth/desktop/start`);
      url.searchParams.set('challenge', challenge);
      url.searchParams.set('state', state);
      pending = { verifier, state, serverUrl, startedAt: now() };
      try {
        await deps.openExternal(url.toString());
      } catch {
        pending = null;
        notify();
        throw new Error('Tidak dapat membuka peramban sistem');
      }
      notify();
    },

    async handleCallback(rawUrl) {
      const parsed = parseQcUrl(rawUrl);
      const callback = parsed?.auth;
      const login = pending;
      if (
        !callback ||
        !login ||
        now() - login.startedAt > LOGIN_MAX_AGE_MS ||
        !sameString(callback.state, login.state)
      ) {
        // Kedaluwarsa dilepas; state asing tak menghapus login sah yang sedang menunggu.
        if (login && now() - login.startedAt > LOGIN_MAX_AGE_MS) pending = null;
        notify();
        return false;
      }
      // Dihabiskan SEBELUM menukar: callback kedua (juga yang serentak) tak lagi cocok.
      pending = null;
      const ok = await exchange(login, callback.code);
      notify();
      return ok;
    },

    status,

    logout() {
      pending = null;
      deps.tokens.clear();
      notify();
    },
  };
}
