import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function load(): Promise<string | null> {
  vi.resetModules();
  return (await import('./public-key')).UI_PUBLIC_KEY_PEM;
}

test('tanpa suntikan build (dev, tes): kunci publik null, pembaruan UI nonaktif', async () => {
  expect(await load()).toBeNull();
});

test('kunci yang disuntikkan build (define __UI_PUBLIC_KEY_PEM__) dipakai apa adanya', async () => {
  const pem = '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n';
  vi.stubGlobal('__UI_PUBLIC_KEY_PEM__', pem);
  expect(await load()).toBe(pem);
});

test('suntikan null, kosong, atau bukan string diperlakukan sebagai tanpa kunci', async () => {
  for (const value of [null, '', 123]) {
    vi.stubGlobal('__UI_PUBLIC_KEY_PEM__', value);
    expect(await load()).toBeNull();
  }
});
