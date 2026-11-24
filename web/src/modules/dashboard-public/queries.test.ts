// Kunjungan tautan publik hanya dihitung dari GET (spek dashboard 7.6): muat awal = GET, penyegaran = POST.
import type { PublicDashboardDto } from '@shared/dashboard-public';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { publicDashboardQuery, resetPublicInitialLoad } from './queries';

const DTO = {
  title: 'Rekap',
  sharedBy: 'budi',
  generatedAt: '2026-11-24T02:15:00.000Z',
  expiresAt: '2026-12-20T16:59:59.000Z',
  range: { from: '2026-11-01', to: '2026-11-24' },
  bounds: { from: '2026-11-01', to: '2026-11-24' },
  bucket: 'day',
  scope: { buNames: [], locationNames: [] },
  options: { bu: [], location: [], groups: {} },
  widgets: [],
} as unknown as PublicDashboardDto;

const fetchMock = vi.fn();

beforeEach(() => {
  resetPublicInitialLoad('tok.en');
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(DTO), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function calls() {
  return fetchMock.mock.calls.map((call) => ({
    url: String(call[0]),
    method: ((call[1] as RequestInit | undefined)?.method ?? 'GET') as string,
    headers: ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>,
  }));
}

async function observe(token: string, viewer: Parameters<typeof publicDashboardQuery>[1]) {
  const client = new QueryClient();
  const observer = new QueryObserver(client, publicDashboardQuery(token, viewer));
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
  return { observer, unsubscribe, client };
}

test('muat awal tanpa filter = GET; penyegaran (interval, fokus, Coba lagi) = POST tanpa dihitung kunjungan', async () => {
  const { observer, unsubscribe } = await observe('tok.en', {});
  expect(calls().map((c) => c.method)).toEqual(['GET']);
  await observer.refetch();
  await observer.refetch();
  const all = calls();
  expect(all.map((c) => c.method)).toEqual(['GET', 'POST', 'POST']);
  expect(all[1]?.url).toBe('/api/public/dashboards/tok.en/query');
  expect(all[1]?.headers).toMatchObject({ 'X-Requested-With': 'qc' });
  unsubscribe();
});

test('filter berisi = POST sejak awal (tidak ada GET)', async () => {
  const { unsubscribe } = await observe('tok.en', { buIds: ['b1'] });
  expect(calls().map((c) => c.method)).toEqual(['POST']);
  unsubscribe();
});

test('N4: filter diisi lalu dihapus (kunci kosong sudah dibuang dari cache) tidak pernah GET kedua', async () => {
  const client = new QueryClient();
  const empty = new QueryObserver(client, publicDashboardQuery('tok.en', {}));
  const stopEmpty = empty.subscribe(() => {});
  await vi.waitFor(() => expect(empty.getCurrentResult().isSuccess).toBe(true));
  stopEmpty();
  const filtered = new QueryObserver(client, publicDashboardQuery('tok.en', { buIds: ['b1'] }));
  const stopFiltered = filtered.subscribe(() => {});
  await vi.waitFor(() => expect(filtered.getCurrentResult().isSuccess).toBe(true));
  stopFiltered();
  client.clear(); // gcTime 0 + lewat jeda: semua kunci dibuang
  const cleared = new QueryObserver(client, publicDashboardQuery('tok.en', {}));
  const stopCleared = cleared.subscribe(() => {});
  await vi.waitFor(() => expect(cleared.getCurrentResult().isSuccess).toBe(true));
  expect(calls().map((c) => c.method)).toEqual(['GET', 'POST', 'POST']);
  stopCleared();
});

test('GET awal gagal: Coba lagi = GET (belum ada data); sesudah sukses semuanya POST', async () => {
  fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
  const client = new QueryClient();
  const observer = new QueryObserver(client, publicDashboardQuery('tok.en', {}));
  const stop = observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
  await observer.refetch();
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
  await observer.refetch();
  expect(calls().map((c) => c.method)).toEqual(['GET', 'GET', 'POST']);
  stop();
});

test('halaman dibuka dengan filter di URL: POST dulu, GET sekali saat filter dikosongkan, lalu POST', async () => {
  const client = new QueryClient();
  const filtered = new QueryObserver(client, publicDashboardQuery('tok.en', { buIds: ['b1'] }));
  const stopFiltered = filtered.subscribe(() => {});
  await vi.waitFor(() => expect(filtered.getCurrentResult().isSuccess).toBe(true));
  stopFiltered();
  client.clear();
  for (let round = 0; round < 2; round += 1) {
    const cleared = new QueryObserver(client, publicDashboardQuery('tok.en', {}));
    const stop = cleared.subscribe(() => {});
    await vi.waitFor(() => expect(cleared.getCurrentResult().isSuccess).toBe(true));
    stop();
    client.clear();
  }
  expect(calls().map((c) => c.method)).toEqual(['POST', 'GET', 'POST']);
});

test('dua pemasangan serentak untuk token yang sama (StrictMode) = satu GET', async () => {
  const client = new QueryClient();
  const first = new QueryObserver(client, publicDashboardQuery('tok.en', {}));
  const second = new QueryObserver(client, publicDashboardQuery('tok.en', {}));
  const stopFirst = first.subscribe(() => {});
  const stopSecond = second.subscribe(() => {});
  await vi.waitFor(() => expect(first.getCurrentResult().isSuccess).toBe(true));
  expect(calls().map((c) => c.method)).toEqual(['GET']);
  stopFirst();
  stopSecond();
});

test('pemasangan baru (halaman dibuka ulang, token sama) = GET awal baru', async () => {
  const client = new QueryClient();
  const first = new QueryObserver(client, publicDashboardQuery('tok.en', {}));
  const stop = first.subscribe(() => {});
  await vi.waitFor(() => expect(first.getCurrentResult().isSuccess).toBe(true));
  stop();
  resetPublicInitialLoad('tok.en'); // halaman dilepas
  client.clear();
  const second = new QueryObserver(client, publicDashboardQuery('tok.en', {}));
  const stopSecond = second.subscribe(() => {});
  await vi.waitFor(() => expect(second.getCurrentResult().isSuccess).toBe(true));
  expect(calls().map((c) => c.method)).toEqual(['GET', 'GET']);
  stopSecond();
});
