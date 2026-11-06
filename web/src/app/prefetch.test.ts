import type { MeDto } from '@shared/rpc';
import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { prefetchCommonQueries } from './prefetch';

const me = (permissions: Record<string, string>) =>
  ({
    email: 'a@x.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { item: 'none', qrcode: 'none', access: 'none', ...permissions },
    locations: [],
  }) as unknown as MeDto;

function keysFor(user: MeDto): string[] {
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'prefetchQuery').mockResolvedValue(undefined);
  const infinite = vi.spyOn(client, 'prefetchInfiniteQuery').mockResolvedValue(undefined);
  prefetchCommonQueries(client, user);
  return [...spy.mock.calls, ...infinite.mock.calls].map(([options]) =>
    String((options as { queryKey: unknown[] }).queryKey[0]),
  );
}

test('hanya mem-prefetch daftar yang boleh dibaca pengguna (tanpa izin = tanpa RPC)', () => {
  expect(keysFor(me({}))).toEqual([]);
  expect(keysFor(me({ item: 'view' })).sort()).toEqual(['brands', 'items'].sort());
  expect(keysFor(me({ qrcode: 'edit' }))).toEqual(['qrcodes', 'qrcodes']);
  expect(keysFor(me({ access: 'manage' })).length).toBe(2);
  expect(keysFor(me({ item: 'view', qrcode: 'view', access: 'view' })).length).toBe(6);
});
