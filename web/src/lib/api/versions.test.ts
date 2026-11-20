import type { ApiId } from '@shared/contract';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  getServerApis,
  pickApi,
  refreshServerApis,
  resetServerApisForTests,
  setServerApis,
  startApiVersions,
} from './versions';

const KEY = 'qc.api.apis';
const SAMPLE = { qrcodes: { latest: 2, deprecated: [] as number[] } };

function pingFetch(body: unknown, init: ResponseInit = {}): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), init)) as unknown as typeof fetch;
}

function failingFetch(): typeof fetch {
  return vi.fn(async () => new Response('galat', { status: 500 })) as unknown as typeof fetch;
}

beforeEach(() => {
  localStorage.clear();
  resetServerApisForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetServerApisForTests();
});

test('peta tersimpan terbaca setelah startApiVersions', () => {
  localStorage.setItem(KEY, JSON.stringify(SAMPLE));
  vi.stubGlobal('fetch', failingFetch());
  startApiVersions();
  expect(getServerApis()).toEqual(SAMPLE);
});

test('refreshServerApis mengganti peta dan menyimpannya', async () => {
  await refreshServerApis(pingFetch({ ok: true, apis: SAMPLE }));
  expect(getServerApis()).toEqual(SAMPLE);
  expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(SAMPLE);
});

test('respons buruk atau fetch gagal membiarkan peta lama utuh dan tidak melempar', async () => {
  setServerApis(SAMPLE);
  const buruk: Array<typeof fetch> = [
    pingFetch({ apis: { qrcodes: { latest: 3, deprecated: [] } } }, { status: 500 }),
    vi.fn(async () => new Response('bukan json', { status: 200 })) as unknown as typeof fetch,
    pingFetch({ ok: true }),
    pingFetch({ ok: true, apis: 'sampah' }),
    vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch,
  ];
  for (const fetchImpl of buruk) {
    await expect(refreshServerApis(fetchImpl)).resolves.toBeUndefined();
    expect(getServerApis()).toEqual(SAMPLE);
  }
});

test('setServerApis menolak nilai tak valid', () => {
  setServerApis(SAMPLE);
  setServerApis('sampah');
  setServerApis({ x: { latest: 0 } });
  expect(getServerApis()).toEqual(SAMPLE);
});

test('pickApi: tabel nyata hanya v1, apa pun petanya', () => {
  expect(pickApi('qrcodes.list' as ApiId)).toBe('qrcodes.list');
  setServerApis({ qrcodes: { latest: 5, deprecated: [] } });
  expect(pickApi('qrcodes.list' as ApiId)).toBe('qrcodes.list');
});

test('localStorage yang melempar tidak membuat fungsi apa pun melempar', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('diblokir');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('diblokir');
  });
  vi.stubGlobal('fetch', failingFetch());
  expect(() => startApiVersions()).not.toThrow();
  expect(getServerApis()).toBeNull();
  expect(() => setServerApis(SAMPLE)).not.toThrow();
  expect(getServerApis()).toEqual(SAMPLE);
  await expect(refreshServerApis(pingFetch({ apis: SAMPLE }))).resolves.toBeUndefined();
});

test('startApiVersions memanggil ping tiap dipanggil dan tiap event online, tanpa menggandakan pendengar', async () => {
  const fetchImpl = pingFetch({ ok: true, apis: SAMPLE });
  vi.stubGlobal('fetch', fetchImpl);
  startApiVersions();
  startApiVersions(); // panggilan kedua tak menggandakan pendengar
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
});
