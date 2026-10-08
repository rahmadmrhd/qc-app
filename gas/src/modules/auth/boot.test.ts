import { beforeEach, expect, test } from 'bun:test';
import type { HttpResponseLike } from '@gas/core/platform';
import { platform_, setPlatform_ } from '@gas/core/platform';
import { verifySessionToken_ } from '@gas/core/session';
import { insertUser_ } from '@gas/modules/access/repo';
import { user } from '@gas-test/access-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { BOOT_MARKER, buildBootData_, injectBoot_ } from './boot';
import { createLoginUrl_ } from './oauth';

const NOW = Date.parse('2026-10-08T00:00:00.000Z');
let platform: MemoryPlatform;
let tokenEmail = 'budi@gmail.com';

function tokenResponse(): HttpResponseLike {
  const encode = (value: unknown) => platform_().base64UrlEncode(JSON.stringify(value));
  const claims = {
    iss: 'accounts.google.com',
    aud: 'cid',
    exp: NOW / 1000 + 600,
    email: tokenEmail,
    email_verified: true,
  };
  return {
    status: 200,
    body: JSON.stringify({ id_token: `${encode({})}.${encode(claims)}.sig` }),
  };
}

function freshState(): string {
  return `${new URL(createLoginUrl_()).searchParams.get('state') ?? ''}.nonce1`;
}

beforeEach(() => {
  tokenEmail = 'budi@gmail.com';
  platform = createMemoryPlatform({
    properties: {
      OAUTH_CLIENT_ID: 'cid',
      OAUTH_CLIENT_SECRET: 'cs',
      OAUTH_REDIRECT_URI: 'https://script.google.com/macros/s/D/exec',
      SESSION_SECRET: 's',
      ADMIN_EMAIL: 'admin@gmail.com',
    },
    now: () => NOW,
    http: () => tokenResponse(),
  });
  setPlatform_(platform);
  insertUser_(user({ id: 'u1', email: 'budi@gmail.com' }));
});

test('tanpa parameter login hanya memberi loginUrl', () => {
  const boot = buildBootData_({});
  expect(Object.keys(boot)).toEqual(['loginUrl']);
  expect(boot.loginUrl).toStartWith('https://accounts.google.com/');
});

test('callback valid untuk email terdaftar menghasilkan sessionToken', () => {
  const boot = buildBootData_({ code: 'kode', state: freshState() });
  expect(verifySessionToken_(boot.sessionToken)?.email).toBe('budi@gmail.com');
  expect(boot.authError).toBeUndefined();
  expect(boot.loginUrl).toStartWith('https://accounts.google.com/');
  expect(boot.nonce).toBe('nonce1');
});

test('state tanpa nonce (tidak terikat ke browser) ditolak tanpa memanggil Google', () => {
  const bare = new URL(createLoginUrl_()).searchParams.get('state') ?? '';
  platform.httpCalls.length = 0;
  expect(buildBootData_({ code: 'kode', state: bare }).authError).toBe('LOGIN_FAILED');
  expect(platform.httpCalls).toHaveLength(0);
});

test('callback valid untuk email tidak terdaftar menghasilkan NOT_WHITELISTED', () => {
  tokenEmail = 'asing@gmail.com';
  const boot = buildBootData_({ code: 'kode', state: freshState() });
  expect(boot).toMatchObject({ authError: 'NOT_WHITELISTED', email: 'asing@gmail.com' });
  expect(boot.sessionToken).toBeUndefined();
  expect(boot.loginUrl).toBeDefined();
});

test('state tidak dikenal atau dipakai ulang menghasilkan LOGIN_FAILED tanpa memanggil Google', () => {
  const state = freshState();
  buildBootData_({ code: 'kode', state });
  platform.httpCalls.length = 0;
  for (const params of [
    { code: 'kode', state },
    { code: 'kode', state: 'palsu' },
    { code: 'kode' },
  ]) {
    const boot = buildBootData_(params);
    expect(boot.authError).toBe('LOGIN_FAILED');
    expect(boot.loginUrl).toBeDefined();
  }
  expect(platform.httpCalls).toHaveLength(0);
});

test('user membatalkan izin di Google (parameter error) menghasilkan LOGIN_FAILED', () => {
  expect(buildBootData_({ error: 'access_denied', state: freshState() }).authError).toBe(
    'LOGIN_FAILED',
  );
});

const PAGE = `<head><script>window.__BOOT__ = '${BOOT_MARKER}';</script></head>`;

test('injectBoot_ mengganti penanda dengan objek JSON dan meng-escape karakter berbahaya', () => {
  const result = injectBoot_(PAGE, { email: '</script><script>alert(1)</script>' });
  expect(result).toStartWith('<head><script>window.__BOOT__ = {');
  expect(result).not.toContain(BOOT_MARKER);
  expect(result).not.toContain('</script><script>alert');
  expect(result).toContain('\u003c/script>');
});

test('injectBoot_ tidak bergantung pada komentar HTML (yang dibuang HtmlService) dan menerima kutip ganda', () => {
  const page = `<!doctype html><html><head><script>window.__BOOT__ = "${BOOT_MARKER}";</script></head></html>`;
  expect(injectBoot_(page, { loginUrl: 'u' })).toContain('window.__BOOT__ = {"loginUrl":"u"};');
});

test('injectBoot_ memperlakukan karakter $ pada data sebagai teks biasa', () => {
  const result = injectBoot_(PAGE, { email: "a$&b$'c" });
  expect(result).toContain("a$&b$'c");
});

test('injectBoot_ meng-escape pemisah baris Unicode tetapi tidak merusak teks biasa', () => {
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  const result = injectBoot_(PAGE, {
    email: `a${lineSeparator}b${paragraphSeparator}c tahun 2028 dan 2029`,
  });
  expect(result).not.toContain(lineSeparator);
  expect(result).not.toContain(paragraphSeparator);
  expect(result).toContain('tahun 2028 dan 2029');
});

test('injectBoot_ gagal bila penanda tidak ada atau ganda', () => {
  expect(() => injectBoot_('<head></head>', {})).toThrow(/BOOT/);
  expect(() => injectBoot_(`${PAGE}${PAGE}`, {})).toThrow(/BOOT/);
});
