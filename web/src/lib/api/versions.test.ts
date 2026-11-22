import type { ApiId } from '@shared/contract';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getOutdatedLevel, resetOutdatedForTests } from '@/app/pwa/client-outdated';
import {
  getServerApis,
  getServerMinClient,
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
  resetOutdatedForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetServerApisForTests();
  resetOutdatedForTests();
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

const MIN_KEY = 'qc.api.minClient';
// Klien nyata hanya mengenal v1 untuk semua kelompok: kelompok yang v1-nya deprecated = klien perlu diperbarui.
const DEPRECATED_V1 = { qrcodes: { latest: 2, deprecated: [1] } };

test('ping memuat minClient: disimpan di memori dan localStorage', async () => {
  await refreshServerApis(pingFetch({ ok: true, apis: SAMPLE, minClient: { desktop: '1.2.0' } }));
  expect(getServerMinClient()).toEqual({ desktop: '1.2.0' });
  expect(JSON.parse(localStorage.getItem(MIN_KEY) ?? 'null')).toEqual({ desktop: '1.2.0' });
});

test('minClient tersimpan terbaca lagi setelah muat ulang halaman', () => {
  localStorage.setItem(MIN_KEY, JSON.stringify({ desktop: '1.5.0' }));
  expect(getServerMinClient()).toEqual({ desktop: '1.5.0' });
});

test('ping tanpa minClient (server lama) tidak menghapus nilai tersimpan', async () => {
  await refreshServerApis(pingFetch({ ok: true, apis: SAMPLE, minClient: { desktop: '1.2.0' } }));
  await refreshServerApis(pingFetch({ ok: true, apis: SAMPLE }));
  expect(getServerMinClient()).toEqual({ desktop: '1.2.0' });
});

test('minClient rusak diabaikan tanpa melempar, termasuk di penyimpanan', async () => {
  localStorage.setItem(MIN_KEY, 'bukan json');
  expect(getServerMinClient()).toBeNull();
  for (const bad of [{ desktop: 3 }, 'x', [], { desktop: '1.2' }, null]) {
    await expect(
      refreshServerApis(pingFetch({ ok: true, apis: SAMPLE, minClient: bad })),
    ).resolves.toBeUndefined();
    expect(getServerMinClient()).toBeNull();
  }
});

test('versi klien yang dipakai ditandai deprecated server = level deprecated', async () => {
  expect(getOutdatedLevel()).toBe('none');
  await refreshServerApis(pingFetch({ ok: true, apis: DEPRECATED_V1 }));
  expect(getOutdatedLevel()).toBe('deprecated');
});

test('peta sehat atau tanpa kelompok klien tidak menaikkan level', async () => {
  await refreshServerApis(pingFetch({ ok: true, apis: SAMPLE }));
  expect(getOutdatedLevel()).toBe('none');
  await refreshServerApis(pingFetch({ ok: true, apis: { zzz: { latest: 1, deprecated: [1] } } }));
  expect(getOutdatedLevel()).toBe('none');
});

test('localStorage yang melempar tidak membuat minClient melempar', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('diblokir');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('diblokir');
  });
  expect(getServerMinClient()).toBeNull();
  await expect(
    refreshServerApis(pingFetch({ ok: true, apis: SAMPLE, minClient: { desktop: '1.2.0' } })),
  ).resolves.toBeUndefined();
  expect(getServerMinClient()).toEqual({ desktop: '1.2.0' });
});
