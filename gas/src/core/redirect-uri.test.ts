import { expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import {
  consumeLoginState_,
  createLoginUrl_,
  exchangeCodeForEmail_,
} from '@gas/modules/auth/oauth';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { missingConfigKeys_, redirectUri_ } from './config';

const EXEC = 'https://script.google.com/macros/s/ABC/exec';
const DEV = 'https://script.google.com/macros/s/ABC/dev';
const BASE_PROPS = {
  SPREADSHEET_ID: 'x',
  OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com',
  OAUTH_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'd',
  ADMIN_EMAIL: 'e@gmail.com',
};

function use(properties: Record<string, string>, scriptUrl = '') {
  const platform = createMemoryPlatform({
    properties,
    scriptUrl,
    http: () => ({ status: 400, body: '{}' }),
  });
  setPlatform_(platform);
  return platform;
}

test('tanpa properti, redirect URI diambil dari URL web app yang sedang berjalan', () => {
  use(BASE_PROPS, EXEC);
  expect(redirectUri_()).toBe(EXEC);
  use(BASE_PROPS, DEV);
  expect(redirectUri_()).toBe(DEV);
});

test('OAUTH_REDIRECT_URI menjadi override dan dirapikan dari spasi', () => {
  use({ ...BASE_PROPS, OAUTH_REDIRECT_URI: `  ${EXEC}  ` }, DEV);
  expect(redirectUri_()).toBe(EXEC);
});

test('properti kosong atau spasi saja dianggap tidak ada', () => {
  use({ ...BASE_PROPS, OAUTH_REDIRECT_URI: '   ' }, EXEC);
  expect(redirectUri_()).toBe(EXEC);
});

test('gagal dengan pesan jelas bila properti dan URL runtime sama-sama kosong', () => {
  use(BASE_PROPS, '');
  expect(() => redirectUri_()).toThrow('OAUTH_REDIRECT_URI');
});

test('OAUTH_REDIRECT_URI tidak lagi wajib diisi', () => {
  use(BASE_PROPS, EXEC);
  expect(missingConfigKeys_()).toEqual([]);
});

test('URL login dan penukaran kode memakai redirect URI yang sama', () => {
  const platform = use(BASE_PROPS, EXEC);
  const url = new URL(createLoginUrl_());
  expect(url.searchParams.get('redirect_uri')).toBe(EXEC);
  expect(consumeLoginState_(url.searchParams.get('state'))).toBe(true);
  exchangeCodeForEmail_('kode');
  expect(platform.httpCalls[0]?.form.redirect_uri).toBe(EXEC);
});
