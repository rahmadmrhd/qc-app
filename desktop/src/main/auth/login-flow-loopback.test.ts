import type { AuthStatus } from '@countrylock/bridge-contract';
import { beforeEach, describe, expect, test } from 'vitest';
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
    startLoopback: async (onCallback): Promise<Loopback> => {
      if (loopbackFails) throw new Error('port tak tersedia');
      handler = onCallback;
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
});
