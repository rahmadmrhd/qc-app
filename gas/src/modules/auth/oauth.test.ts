import { beforeEach, expect, test } from 'bun:test';
import type { HttpResponseLike } from '@gas/core/platform';
import { platform_, setPlatform_ } from '@gas/core/platform';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import {
  consumeLoginState_,
  createLoginUrl_,
  exchangeCodeForEmail_,
  readIdTokenEmail_,
} from './oauth';

const NOW = Date.parse('2026-10-08T00:00:00.000Z');
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const PROPS = {
  OAUTH_CLIENT_ID: CLIENT_ID,
  OAUTH_CLIENT_SECRET: 'secret',
  OAUTH_REDIRECT_URI: 'https://script.google.com/macros/s/DEPLOY/exec',
};
let platform: MemoryPlatform;
let httpResponse: HttpResponseLike;

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => platform_().base64UrlEncode(JSON.stringify(value));
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

const validClaims = {
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  exp: NOW / 1000 + 600,
  email: 'Budi@Gmail.com',
  email_verified: true,
};

beforeEach(() => {
  httpResponse = { status: 500, body: '' };
  platform = createMemoryPlatform({ properties: PROPS, now: () => NOW, http: () => httpResponse });
  setPlatform_(platform);
});

test('createLoginUrl_ menyusun URL Google dan menyimpan state sekali pakai', () => {
  const url = new URL(createLoginUrl_());
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
  expect(url.searchParams.get('redirect_uri')).toBe(PROPS.OAUTH_REDIRECT_URI);
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('scope')).toBe('openid email');
  expect(url.searchParams.get('prompt')).toBe('select_account');
  const state = url.searchParams.get('state') ?? '';
  expect(consumeLoginState_(state)).toBe(true);
  expect(consumeLoginState_(state)).toBe(false);
});

test('consumeLoginState_ menolak state tak dikenal atau bukan string', () => {
  for (const value of ['tidak-ada', '', undefined, 42]) {
    expect(consumeLoginState_(value)).toBe(false);
  }
});

test('readIdTokenEmail_ menerima token valid dan menormalisasi email', () => {
  expect(readIdTokenEmail_(idToken(validClaims), CLIENT_ID, NOW)).toEqual({
    ok: true,
    email: 'budi@gmail.com',
  });
  expect(
    readIdTokenEmail_(idToken({ ...validClaims, iss: 'accounts.google.com' }), CLIENT_ID, NOW).ok,
  ).toBe(true);
});

test('readIdTokenEmail_ menolak aud, iss, exp, email_verified yang salah, dan token rusak', () => {
  const cases = [
    idToken({ ...validClaims, aud: 'lain' }),
    idToken({ ...validClaims, iss: 'https://evil.example' }),
    idToken({ ...validClaims, exp: NOW / 1000 - 1 }),
    idToken({ ...validClaims, email_verified: false }),
    idToken({ ...validClaims, email: '' }),
    'bukan-jwt',
    'a.%%%.c',
  ];
  for (const token of cases) expect(readIdTokenEmail_(token, CLIENT_ID, NOW).ok).toBe(false);
});

test('exchangeCodeForEmail_ mengirim form yang benar dan membaca id_token', () => {
  httpResponse = { status: 200, body: JSON.stringify({ id_token: idToken(validClaims) }) };
  expect(exchangeCodeForEmail_('kode-123')).toEqual({ ok: true, email: 'budi@gmail.com' });
  expect(platform.httpCalls[0]).toEqual({
    url: 'https://oauth2.googleapis.com/token',
    form: {
      code: 'kode-123',
      client_id: CLIENT_ID,
      client_secret: 'secret',
      redirect_uri: PROPS.OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    },
  });
});

test('exchangeCodeForEmail_ gagal bila endpoint menolak atau respons rusak', () => {
  httpResponse = { status: 400, body: '{"error":"invalid_grant"}' };
  expect(exchangeCodeForEmail_('x').ok).toBe(false);
  httpResponse = { status: 200, body: 'bukan json' };
  expect(exchangeCodeForEmail_('x').ok).toBe(false);
  httpResponse = { status: 200, body: '{}' };
  expect(exchangeCodeForEmail_('x').ok).toBe(false);
});
