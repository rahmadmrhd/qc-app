// Pemilihan GET vs POST halaman publik (kunjungan dicatat oleh `POST .../visit`, bukan oleh GET; spek dashboard 7.6).
import type { PublicDashboardDto } from '@shared/dashboard-public';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { recordPublicVisit } from './public-api';
import { publicDashboardQuery } from './queries';

const DTO = {
  title: 'Rekap',
  sharedBy: 'budi',
  generatedAt: '2026-11-24T02:15:00.000Z',
  expiresAt: '2026-12-20T16:59:59.000Z',
  range: { from: '2026-11-01', to: '2026-11-24' },
  bounds: { from: '2026-11-01', to: '2026-11-24' },
  bucket: 'day',
  scope: { buNames: [], buDeleted: [], locationNames: [], locationDeleted: [] },
  options: { bu: [], location: [], groups: {} },
  widgets: [],
} as unknown as PublicDashboardDto;

const fetchMock = vi.fn();

beforeEach(() => {
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

test('tanpa filter = GET (juga saat disegarkan); tidak ada kaitan dengan kunjungan', async () => {
  const { observer, unsubscribe } = await observe('tok.en', {});
  await observer.refetch();
  expect(calls().map((c) => c.method)).toEqual(['GET', 'GET']);
  unsubscribe();
});

test('filter berisi = POST query berheader CSRF, juga saat disegarkan', async () => {
  const { observer, unsubscribe } = await observe('tok.en', { buIds: ['b1'] });
  await observer.refetch();
  const all = calls();
  expect(all.map((c) => c.method)).toEqual(['POST', 'POST']);
  expect(all[0]?.url).toBe('/api/public/dashboards/tok.en/query');
  expect(all[0]?.headers).toMatchObject({ 'X-Requested-With': 'qc' });
  unsubscribe();
});

test('filter diisi lalu dikosongkan kembali = aturan yang sama (POST, lalu GET), tanpa keadaan tersembunyi', async () => {
  const client = new QueryClient();
  const run = async (viewer: Parameters<typeof publicDashboardQuery>[1]) => {
    const observer = new QueryObserver(client, publicDashboardQuery('tok.en', viewer));
    const stop = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    stop();
    client.clear();
  };
  await run({});
  await run({ buIds: ['b1'] });
  await run({});
  expect(calls().map((c) => c.method)).toEqual(['GET', 'POST', 'GET']);
});

test('recordPublicVisit: POST visit berheader CSRF tanpa badan, galat ditelan', async () => {
  await recordPublicVisit('tok.en');
  const [call] = calls();
  expect(call?.url).toBe('/api/public/dashboards/tok.en/visit');
  expect(call?.method).toBe('POST');
  expect(call?.headers).toMatchObject({ 'X-Requested-With': 'qc' });
  fetchMock.mockImplementationOnce(async () => {
    throw new TypeError('putus');
  });
  await expect(recordPublicVisit('tok.en')).resolves.toBeUndefined();
  fetchMock.mockImplementationOnce(async () => new Response(null, { status: 500 }));
  await expect(recordPublicVisit('tok.en')).resolves.toBeUndefined();
});
