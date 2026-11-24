import type { AuthStatus } from '@countrylock/bridge-contract';
import { beforeEach, describe, expect, test } from 'vitest';
import type { AuthErrorCode } from '../qc-url';
import type { Settings } from '../settings';
import { createLoginFlow } from './login-flow';
import type { Loopback } from './loopback';
import { createTokenStore, type TokenStore } from './token-store';

const SERVER = 'https://qc.example.com';
const CODE = 'eyJ0eXAiOiJkY29kZSJ9.abc-DEF_123';

let opened: string[];
let changes: AuthStatus[];
let tokens: TokenStore;
let clock: number;
let counter: number;
/** Penangan yang dipasang flow pada loopback palsu. */
let handler: ((code: string, state: string) => Promise<boolean>) | null;
let errorHandler: ((error: AuthErrorCode, state: string) => Promise<boolean>) | undefined;
let closes: number;
let loopbackFails: boolean;
let openFails: boolean;
let exchanged: number;

const random = (n: number): Uint8Array => new Uint8Array(n).fill(++counter);

beforeEach(() => {
  opened = [];
  changes = [];
  clock = 1_000_000;
  counter = 0;
  handler = null;
  errorHandler = undefined;
  closes = 0;
  loopbackFails = false;
  openFails = false;
  exchanged = 0;
  tokens = createTokenStore('tidak-dipakai.json', null, () => clock);
});

const flow = () =>
  createLoginFlow({
    settings: (): Settings => ({ packageDir: null, serverUrl: SERVER }),
    tokens,
    openExternal: async (url) => {
      opened.push(url);
      if (openFails) throw new Error('gagal');
    },
    startLoopback: async (onCallback, onError): Promise<Loopback> => {
      if (loopbackFails) throw new Error('port tak tersedia');
      handler = onCallback;
      errorHandler = onError;
      return { port: 49321, close: () => void closes++ };
    },
    fetchImpl: (async () => {
      exchanged++;
      return new Response(
        JSON.stringify({ token: 'TOKEN', expiresAt: clock + 1_000_000, email: 'a@b.co' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch,
    random,
    now: () => clock,
    onChange: (s) => changes.push(s),
  });

const startedState = (): string =>
  new URL(opened[opened.length - 1] ?? '').searchParams.get('state') ?? '';

describe('login lewat loopback', () => {
  test('start membuka loopback dulu lalu menyertakan port di URL awal', async () => {
    await flow().start();
    const url = new URL(opened[0] ?? '');
    expect(url.pathname).toBe('/auth/desktop/start');
    expect(url.searchParams.get('port')).toBe('49321');
    expect(handler).not.toBeNull();
  });

  test('callback loopback dengan state yang cocok menukar kode, menyimpan token, dan menutup loopback', async () => {
    const f = flow();
    await f.start();
    const ok = await (handler as NonNullable<typeof handler>)(CODE, startedState());
    expect(ok).toBe(true);
    expect(exchanged).toBe(1);
    expect(f.status().signedIn).toBe(true);
    expect(closes).toBe(1);
    expect(changes.at(-1)?.signedIn).toBe(true);
  });

  test('state asing: ditolak diam-diam, loopback TETAP terbuka, login sah masih bisa selesai', async () => {
    const f = flow();
    await f.start();
    const h = handler as NonNullable<typeof handler>;
    expect(await h(CODE, 'state-asing-1234')).toBe(false);
    expect(exchanged).toBe(0);
    expect(closes).toBe(0);
    expect(changes).toEqual([]);
    expect(await h(CODE, startedState())).toBe(true);
  });

  test('callback kedua setelah berhasil tidak menukar lagi', async () => {
    const f = flow();
    await f.start();
    const h = handler as NonNullable<typeof handler>;
    const state = startedState();
    expect(await h(CODE, state)).toBe(true);
    expect(await h(CODE, state)).toBe(false);
    expect(exchanged).toBe(1);
  });

  test('loopback gagal dibuka: login tetap jalan lewat qc:// (tanpa port)', async () => {
    loopbackFails = true;
    await flow().start();
    expect(new URL(opened[0] ?? '').searchParams.has('port')).toBe(false);
  });

  test('peramban gagal dibuka: start menolak dan loopback ditutup', async () => {
    openFails = true;
    await expect(flow().start()).rejects.toThrow('Tidak dapat membuka peramban sistem');
    expect(closes).toBe(1);
  });

  test('start baru, logout, dan dispose menutup loopback sebelumnya', async () => {
    const f = flow();
    await f.start();
    await f.start();
    expect(closes).toBe(1);
    f.logout();
    expect(closes).toBe(2);
    await f.start();
    f.dispose();
    expect(closes).toBe(3);
  });

  test('login kedaluwarsa lewat loopback: gagal, loopback ditutup, UI diberi tahu', async () => {
    const f = flow();
    await f.start();
    clock += 11 * 60 * 1000;
    expect(await (handler as NonNullable<typeof handler>)(CODE, startedState())).toBe(false);
    expect(closes).toBe(1);
    expect(changes).toHaveLength(1);
    expect(exchanged).toBe(0);
  });

  test('galat server dengan state cocok: login dihabiskan, loopback ditutup, UI diberi tahu, tanpa penukaran', async () => {
    const f = flow();
    await f.start();
    const handled = await (errorHandler as NonNullable<typeof errorHandler>)(
      'NOT_WHITELISTED',
      startedState(),
    );
    expect(handled).toBe(true);
    expect(exchanged).toBe(0);
    expect(closes).toBe(1);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.signedIn).toBe(false);
    expect(changes[0]?.error).toBe('NOT_WHITELISTED');
    expect(f.status().error).toBe('NOT_WHITELISTED');
    // Login sudah dihabiskan: callback sah sesudahnya tak lagi cocok.
    expect(await (handler as NonNullable<typeof handler>)(CODE, startedState())).toBe(false);
    expect(exchanged).toBe(0);
  });

  test('galat server dengan state asing atau tanpa login berjalan: diabaikan diam-diam', async () => {
    const f = flow();
    await f.start();
    const onError = errorHandler as NonNullable<typeof errorHandler>;
    expect(await onError('LOGIN_FAILED', 'state-asing-1234')).toBe(false);
    expect(closes).toBe(0);
    expect(changes).toEqual([]);
    // Login sah masih bisa selesai.
    expect(await (handler as NonNullable<typeof handler>)(CODE, startedState())).toBe(true);
    expect(await onError('LOGIN_FAILED', startedState())).toBe(false);
  });

  test('qc://auth?error=...&state=... (cadangan) menghabiskan login yang berjalan', async () => {
    const f = flow();
    await f.start();
    const state = startedState();
    expect(await f.handleCallback(`qc://auth?error=NOT_WHITELISTED&state=${state}`)).toBe(false);
    expect(closes).toBe(1);
    expect(changes).toHaveLength(1);
    expect(exchanged).toBe(0);
    // Kode di luar daftar tetap tak diproses.
    await f.start();
    const next = startedState();
    expect(await f.handleCallback(`qc://auth?error=APA_SAJA&state=${next}`)).toBe(false);
    expect(await (handler as NonNullable<typeof handler>)(CODE, next)).toBe(true);
  });

  test('LOGIN_FAILED dari server juga masuk status; qc://auth?error=... (cadangan) sama', async () => {
    const f = flow();
    await f.start();
    await (errorHandler as NonNullable<typeof errorHandler>)('LOGIN_FAILED', startedState());
    expect(changes.at(-1)).toMatchObject({ signedIn: false, error: 'LOGIN_FAILED' });
    await f.start();
    await f.handleCallback(`qc://auth?error=NOT_WHITELISTED&state=${startedState()}`);
    expect(changes.at(-1)).toMatchObject({ signedIn: false, error: 'NOT_WHITELISTED' });
  });

  test('error dibersihkan saat login baru dimulai, login sukses, dan keluar; tanpa token tak bocor ke status', async () => {
    const f = flow();
    await f.start();
    await (errorHandler as NonNullable<typeof errorHandler>)('NOT_WHITELISTED', startedState());
    expect(f.status().error).toBe('NOT_WHITELISTED');
    // Percobaan berikutnya: bersih sejak dimulai.
    await f.start();
    expect(f.status()).not.toHaveProperty('error');
    // Gagal lagi lalu sukses: status berhasil tanpa error.
    await (errorHandler as NonNullable<typeof errorHandler>)('LOGIN_FAILED', startedState());
    await f.start();
    expect(await (handler as NonNullable<typeof handler>)(CODE, startedState())).toBe(true);
    expect(f.status()).toEqual({
      signedIn: true,
      email: 'a@b.co',
      serverUrl: SERVER,
    });
    expect(JSON.stringify(f.status())).not.toContain('TOKEN');
    // Keluar membersihkan galat sisa.
    f.logout();
    expect(f.status()).not.toHaveProperty('error');
  });

  test('galat dari server TIDAK muncul bila callback asing (state tak cocok): status tanpa error', async () => {
    const f = flow();
    await f.start();
    await (errorHandler as NonNullable<typeof errorHandler>)('LOGIN_FAILED', 'state-asing-1234');
    expect(f.status()).not.toHaveProperty('error');
  });

  test('login kedua saat penukaran kode lama berjalan: loopback milik login baru tetap terbuka', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closed: number[] = [];
    let port = 50000;
    const f = createLoginFlow({
      settings: (): Settings => ({ packageDir: null, serverUrl: SERVER }),
      tokens,
      openExternal: async (url) => {
        opened.push(url);
      },
      startLoopback: async (onCallback): Promise<Loopback> => {
        handler = onCallback;
        const mine = ++port;
        return { port: mine, close: () => void closed.push(mine) };
      },
      fetchImpl: (async () => {
        await gate; // server sibuk: penukaran lambat
        return new Response(
          JSON.stringify({ token: 'TOKEN', expiresAt: clock + 1_000_000, email: 'a@b.co' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch,
      random,
      now: () => clock,
      onChange: (s) => changes.push(s),
    });
    await f.start();
    const firstHandler = handler as NonNullable<typeof handler>;
    const pendingExchange = firstHandler(CODE, startedState());
    await f.start(); // login kedua: menutup loopback#1 (50001) dan membuka #2 (50002)
    expect(closed).toEqual([50001]);
    release?.();
    await pendingExchange;
    // Penyelesaian login lama TIDAK boleh menutup loopback#2.
    expect(closed).toEqual([50001]);
  });
});
