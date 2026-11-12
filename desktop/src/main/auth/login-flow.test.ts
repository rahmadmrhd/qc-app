import { createHash } from 'node:crypto';
import type { AuthStatus } from '@countrylock/bridge-contract';
import { beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_SERVER_URL, type Settings } from '../settings';
import { createLoginFlow } from './login-flow';
import { createTokenStore, type TokenStore } from './token-store';

const SERVER = 'https://qc.example.com';
const TOKEN = 'TOKEN-DESKTOP-RAHASIA';
const CODE = 'eyJ0eXAiOiJkY29kZSJ9.abc-DEF_123';

interface Call {
  url: string;
  init: RequestInit;
}

let opened: string[];
let changes: AuthStatus[];
let calls: Call[];
let tokens: TokenStore;
let clock: number;
let counter: number;
let fetchResult: () => Promise<Response>;
let openResult: () => Promise<void>;
let serverUrl: string;

/** Acak deterministik: tiap panggilan mengisi byte dengan nilai berbeda (verifier lalu state). */
const random = (n: number): Uint8Array => new Uint8Array(n).fill(++counter);
const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

beforeEach(() => {
  opened = [];
  changes = [];
  calls = [];
  clock = 1_000_000;
  counter = 0;
  serverUrl = SERVER;
  tokens = createTokenStore('tidak-dipakai.json', null, () => clock);
  openResult = async () => undefined;
  fetchResult = async () =>
    new Response(JSON.stringify({ token: TOKEN, expiresAt: clock + 1_000_000, email: 'a@b.co' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
});

const flow = () =>
  createLoginFlow({
    settings: (): Settings => ({ packageDir: null, serverUrl }),
    tokens,
    openExternal: async (url) => {
      opened.push(url);
      await openResult();
    },
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return fetchResult();
    }) as typeof fetch,
    random,
    now: () => clock,
    onChange: (s) => changes.push(s),
  });

const callbackUrl = (state: string, code = CODE) => `qc://auth?code=${code}&state=${state}`;
const startedState = (): string =>
  new URL(opened[opened.length - 1] ?? '').searchParams.get('state') ?? '';

// Nilai deterministik dari `random`: verifier = 32 byte bernilai 1, state = 16 byte bernilai 2.
const VERIFIER_1 = b64url(new Uint8Array(32).fill(1));
const STATE_1 = b64url(new Uint8Array(16).fill(2));

describe('start', () => {
  test('start membuka URL dengan challenge S256 dari verifier dan state', async () => {
    await flow().start();
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0] ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(`${SERVER}/auth/desktop/start`);
    const expectedChallenge = createHash('sha256').update(VERIFIER_1).digest('base64url');
    expect(url.searchParams.get('challenge')).toBe(expectedChallenge);
    expect(url.searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toBe(STATE_1);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect([...url.searchParams.keys()].sort()).toEqual(['challenge', 'state']);
  });

  test('verifier tak pernah muncul di URL', async () => {
    await flow().start();
    expect(opened[0]).not.toContain(VERIFIER_1);
    expect(VERIFIER_1).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
  });

  test('alamat server diambil dari pengaturan saat start', async () => {
    serverUrl = 'http://localhost:8788';
    await flow().start();
    expect(opened[0]?.startsWith('http://localhost:8788/auth/desktop/start?')).toBe(true);
  });

  test('openExternal gagal: galat aman (tanpa detail), tidak ada login berjalan', async () => {
    openResult = async () => {
      throw new Error('detail internal dengan C:\\jalur');
    };
    const f = flow();
    const error = await f.start().catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe('Tidak dapat membuka peramban sistem');
    expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('handleCallback', () => {
  test('callback sah menukar kode dan menyimpan token', async () => {
    const f = flow();
    await f.start();
    expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(`${SERVER}/auth/desktop/token`);
    expect(call?.init.method).toBe('POST');
    const headers = new Headers(call?.init.headers);
    expect(headers.get('x-requested-with')).toBe('qc');
    expect(headers.get('content-type')).toBe('application/json');
    expect(call?.init.redirect).toBe('manual');
    expect(JSON.parse(String(call?.init.body))).toEqual({ code: CODE, verifier: VERIFIER_1 });
    expect(tokens.get()).toEqual({ token: TOKEN, email: 'a@b.co', expiresAt: clock + 1_000_000 });
    expect(f.status()).toEqual({ signedIn: true, email: 'a@b.co', serverUrl: SERVER });
  });

  test('state tak cocok = diabaikan (login yang sah tetap dapat selesai)', async () => {
    const f = flow();
    await f.start();
    expect(await f.handleCallback(callbackUrl('zzzzzzzzzzzzzzzz'))).toBe(false);
    expect(calls).toHaveLength(0);
    expect(tokens.get()).toBeNull();
    expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(true);
  });

  test('tanpa login berjalan = diabaikan', async () => {
    expect(await flow().handleCallback(callbackUrl(STATE_1))).toBe(false);
    expect(calls).toHaveLength(0);
    expect(tokens.get()).toBeNull();
  });

  test('callback kedua (kode sama dikirim dua kali) = diabaikan', async () => {
    const f = flow();
    await f.start();
    expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(true);
    expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test('callback ganda serentak hanya menukar sekali', async () => {
    const f = flow();
    await f.start();
    const [a, b] = await Promise.all([
      f.handleCallback(callbackUrl(STATE_1)),
      f.handleCallback(callbackUrl(STATE_1)),
    ]);
    expect([a, b].sort()).toEqual([false, true]);
    expect(calls).toHaveLength(1);
  });

  test('lebih dari 10 menit = diabaikan', async () => {
    const f = flow();
    await f.start();
    clock += 10 * 60 * 1000 + 1;
    expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(false);
    expect(calls).toHaveLength(0);
    expect(tokens.get()).toBeNull();
  });

  test('tepat di batas 10 menit masih diterima', async () => {
    const f = flow();
    await f.start();
    clock += 10 * 60 * 1000;
    expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(true);
  });

  test('login baru menggantikan yang lama', async () => {
    const f = flow();
    await f.start();
    const oldState = startedState();
    await f.start();
    const newState = startedState();
    expect(newState).not.toBe(oldState);
    expect(await f.handleCallback(callbackUrl(oldState))).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await f.handleCallback(callbackUrl(newState))).toBe(true);
    // verifier yang dipakai = milik login baru (bukan yang lama)
    expect(JSON.parse(String(calls[0]?.init.body)).verifier).toBe(
      b64url(new Uint8Array(32).fill(3)),
    );
  });

  test('URL qc:// selain auth atau tak sah diabaikan', async () => {
    const f = flow();
    await f.start();
    for (const bad of ['qc://country-lock', 'bukan url', `qc://auth?code=${CODE}`, '']) {
      expect(await f.handleCallback(bad)).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  test('server menolak (401), jaringan gagal, atau respons rusak: false, tanpa token, kode terpakai', async () => {
    for (const result of [
      async () => new Response('{"code":"UNAUTHENTICATED"}', { status: 401 }),
      async () => {
        throw new Error(`gagal dengan ${TOKEN}`);
      },
      async () => new Response('bukan json', { status: 200 }),
      async () =>
        new Response(JSON.stringify({ token: '', expiresAt: 1, email: 'a@b.co' }), { status: 200 }),
      async () =>
        new Response(JSON.stringify({ token: TOKEN, expiresAt: 'x', email: 'a@b.co' }), {
          status: 200,
        }),
      async () => new Response(JSON.stringify({ token: TOKEN, expiresAt: 1 }), { status: 200 }),
      async () =>
        new Response(null, { status: 302, headers: { Location: 'https://jahat.example' } }),
    ]) {
      fetchResult = result;
      calls = [];
      counter = 0;
      const f = flow();
      await f.start();
      expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(false);
      expect(tokens.get()).toBeNull();
      // login sudah dihabiskan: callback lagi tak menukar ulang
      expect(await f.handleCallback(callbackUrl(STATE_1))).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });
});

describe('status dan onChange', () => {
  test('onChange dipanggil di setiap jalur dan tidak pernah memuat token', async () => {
    const f = flow();
    await f.start();
    await f.handleCallback(callbackUrl('zzzzzzzzzzzzzzzz')); // diabaikan
    await f.handleCallback(callbackUrl(STATE_1)); // sukses
    f.logout();
    expect(changes.length).toBeGreaterThanOrEqual(4);
    expect(changes.map((c) => c.signedIn)).toContain(true);
    expect(changes[changes.length - 1]).toEqual({
      signedIn: false,
      email: null,
      serverUrl: SERVER,
    });
    for (const change of changes) {
      expect(Object.keys(change).sort()).toEqual(['email', 'serverUrl', 'signedIn']);
    }
    expect(JSON.stringify(changes)).not.toContain(TOKEN);
  });

  test('status awal belum masuk dengan alamat server bawaan', () => {
    serverUrl = DEFAULT_SERVER_URL;
    expect(flow().status()).toEqual({
      signedIn: false,
      email: null,
      serverUrl: 'https://qc.rhd.my.id',
    });
  });

  test('logout menghapus token', async () => {
    const f = flow();
    await f.start();
    await f.handleCallback(callbackUrl(STATE_1));
    expect(tokens.get()).not.toBeNull();
    f.logout();
    expect(tokens.get()).toBeNull();
    expect(f.status().signedIn).toBe(false);
  });
});
