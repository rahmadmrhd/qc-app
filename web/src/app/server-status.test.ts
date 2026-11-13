import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import {
  formatClock,
  getServerStatus,
  resetServerStatusForTests,
  startServerStatus,
} from './server-status';

const unavailable = () => new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-');

let client: QueryClient;
let stop: () => void;

beforeEach(() => {
  resetServerStatusForTests();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stop = startServerStatus(client);
});
afterEach(() => {
  stop();
  client.clear();
});

/** Refetch yang gagal: `fetchQuery` pada query basi menjalankan queryFn dan menyimpan galatnya. */
async function failFetch(key: unknown[], error: Error = unavailable()) {
  await client
    .fetchQuery({ queryKey: key, queryFn: () => Promise.reject(error), staleTime: 0 })
    .catch(() => {});
}
async function okFetch(key: unknown[], data: unknown = 'ok') {
  await client.fetchQuery({ queryKey: key, queryFn: () => Promise.resolve(data), staleTime: 0 });
}

test('query whitelist berdata lalu refetch gagal UNAVAILABLE: menyala dengan waktu dataUpdatedAt', async () => {
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' }, { updatedAt: 1_700_000_000_000 });
  expect(getServerStatus().unavailableSince).toBeNull();
  await failFetch(['auth', 'me']);
  expect(getServerStatus().unavailableSince).toBe(1_700_000_000_000);
});

test('refetch berikutnya sukses memadamkan', async () => {
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  await failFetch(['auth', 'me']);
  expect(getServerStatus().unavailableSince).not.toBeNull();
  await okFetch(['auth', 'me'], { email: 'a@x.com' });
  expect(getServerStatus().unavailableSince).toBeNull();
});

test('sukses query lain (non-manual) memadamkan', async () => {
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  await failFetch(['auth', 'me']);
  expect(getServerStatus().unavailableSince).not.toBeNull();
  await okFetch(['handovers', 'board']);
  expect(getServerStatus().unavailableSince).toBeNull();
});

test('sukses mutasi memadamkan', async () => {
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  await failFetch(['auth', 'me']);
  expect(getServerStatus().unavailableSince).not.toBeNull();
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.resolve('ok') })
    .execute(undefined);
  expect(getServerStatus().unavailableSince).toBeNull();
});

test('setQueryData manual (patch optimistis) saat menyala tidak memadamkan', async () => {
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  await failFetch(['auth', 'me']);
  const since = getServerStatus().unavailableSince;
  expect(since).not.toBeNull();
  client.setQueryData(['handovers', 'board'], { rows: [] });
  client.setQueryData(['handovers', 'get', 't1'], { id: 't1' });
  expect(getServerStatus().unavailableSince).toBe(since);
});

test('setelah dipadamkan sukses lain, penulisan manual tidak menyalakan lagi', async () => {
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  await failFetch(['auth', 'me']);
  await okFetch(['handovers', 'board']);
  client.setQueryData(['handovers', 'get', 't1'], { id: 't1' });
  expect(getServerStatus().unavailableSince).toBeNull();
});

test('query non-whitelist gagal UNAVAILABLE tidak menyalakan', async () => {
  client.setQueryData(['handovers', 'board'], { rows: [] });
  await failFetch(['handovers', 'board']);
  expect(getServerStatus().unavailableSince).toBeNull();
});

test('query whitelist gagal tanpa data tidak menyalakan', async () => {
  await failFetch(['brands', 'list']);
  expect(getServerStatus().unavailableSince).toBeNull();
});

test('query whitelist gagal INTERNAL tidak menyalakan', async () => {
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  await failFetch(['auth', 'me'], new ApiError('INTERNAL', 'Galat', 'r1'));
  expect(getServerStatus().unavailableSince).toBeNull();
});

test('waktu = dataUpdatedAt terbaru di antara query yang gagal', async () => {
  client.setQueryData(['auth', 'me'], { a: 1 }, { updatedAt: 1_000 });
  client.setQueryData(['brands', 'list'], [], { updatedAt: 5_000 });
  await failFetch(['auth', 'me']);
  await failFetch(['brands', 'list']);
  expect(getServerStatus().unavailableSince).toBe(5_000);
});

test('berhenti berlangganan: status direset dan kegagalan berikutnya diabaikan', async () => {
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  await failFetch(['auth', 'me']);
  stop();
  expect(getServerStatus().unavailableSince).toBeNull();
  await failFetch(['auth', 'me']);
  expect(getServerStatus().unavailableSince).toBeNull();
  stop = startServerStatus(client);
});

test('formatClock memakai jam:menit dua digit dengan titik dua', () => {
  expect(formatClock(new Date(2026, 10, 13, 7, 5).getTime())).toBe('07:05');
  expect(formatClock(new Date(2026, 10, 13, 23, 59).getTime())).toBe('23:59');
});
