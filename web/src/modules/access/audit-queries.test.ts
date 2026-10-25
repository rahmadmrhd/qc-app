import { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rpc', () => ({ rpc: rpcMock }));

import { auditInfiniteQueryOptions } from './queries';

beforeEach(() => {
  rpcMock.mockReset();
});

test('log audit berkursor: filter aksi/kata kunci dan kursor dikirim ke server; halaman terakhir berhenti', async () => {
  rpcMock.mockImplementation(async (_method: string, input: { cursor?: string }) => {
    return input.cursor ? { entries: [], nextCursor: null } : { entries: [], nextCursor: 'k1' };
  });
  const client = new QueryClient();
  const data = await client.fetchInfiniteQuery({
    ...auditInfiniteQueryOptions({ action: 'user.update', query: 'budi' }),
    pages: 3,
  });
  expect(rpcMock).toHaveBeenNthCalledWith(1, 'access.audit.list', {
    action: 'user.update',
    query: 'budi',
  });
  expect(rpcMock).toHaveBeenNthCalledWith(2, 'access.audit.list', {
    action: 'user.update',
    query: 'budi',
    cursor: 'k1',
  });
  expect(data.pages).toHaveLength(2);
  rpcMock.mockClear();
  await client.fetchInfiniteQuery(auditInfiniteQueryOptions({}));
  expect(rpcMock).toHaveBeenCalledWith('access.audit.list', {});
});
