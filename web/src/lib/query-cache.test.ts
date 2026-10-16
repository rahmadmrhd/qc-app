import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { markStale, removeFromList, upsertInList } from './query-cache';

const byName = (a: { id: string; name: string }, b: { id: string; name: string }) =>
  a.name.localeCompare(b.name);

test('upsertInList: mengganti entri berid sama atau menambah, lalu mengurutkan; daftar yang belum dimuat tidak dibuat', () => {
  const client = new QueryClient();
  upsertInList(client, ['x'], { id: '1', name: 'B' }, byName);
  expect(client.getQueryData(['x'])).toBeUndefined();
  client.setQueryData(['x'], [{ id: '1', name: 'B' }]);
  upsertInList(client, ['x'], { id: '2', name: 'A' }, byName);
  upsertInList(client, ['x'], { id: '1', name: 'C' }, byName);
  expect(client.getQueryData(['x'])).toEqual([
    { id: '2', name: 'A' },
    { id: '1', name: 'C' },
  ]);
});

test('removeFromList menghapus entri; daftar yang belum dimuat tidak berubah', () => {
  const client = new QueryClient();
  removeFromList(client, ['x'], '1');
  expect(client.getQueryData(['x'])).toBeUndefined();
  client.setQueryData(['x'], [{ id: '1' }, { id: '2' }]);
  removeFromList(client, ['x'], '1');
  expect(client.getQueryData(['x'])).toEqual([{ id: '2' }]);
});

test('markStale menandai basi TANPA memuat ulang (tidak memanggil queryFn)', async () => {
  const client = new QueryClient();
  const queryFn = vi.fn(async () => 1);
  await client.fetchQuery({ queryKey: ['x', 'a'], queryFn });
  queryFn.mockClear();
  markStale(client, ['x']);
  expect(client.getQueryState(['x', 'a'])?.isInvalidated).toBe(true);
  expect(queryFn).not.toHaveBeenCalled();
});
