import { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { auditInfiniteQueryOptions } from './queries';

beforeEach(() => {
  apiMock.mockReset();
});

test('log audit berkursor: filter aksi/kata kunci dan kursor dikirim ke server; halaman terakhir berhenti', async () => {
  apiMock.mockImplementation(async (_method: string, input: { cursor?: string }) => {
    return input.cursor ? { entries: [], nextCursor: null } : { entries: [], nextCursor: 'k1' };
  });
  const client = new QueryClient();
  const data = await client.fetchInfiniteQuery({
    ...auditInfiniteQueryOptions({ action: 'user.update', query: 'budi' }),
    pages: 3,
  });
  expect(apiMock).toHaveBeenNthCalledWith(1, 'access.audit.list', {
    action: 'user.update',
    query: 'budi',
  });
  expect(apiMock).toHaveBeenNthCalledWith(2, 'access.audit.list', {
    action: 'user.update',
    query: 'budi',
    cursor: 'k1',
  });
  expect(data.pages).toHaveLength(2);
  apiMock.mockClear();
  await client.fetchInfiniteQuery(auditInfiniteQueryOptions({}));
  expect(apiMock).toHaveBeenCalledWith('access.audit.list', {});
});

test('kabel REST: GET /api/v1/audit-logs dengan filter dan kursor di query string', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response('{"entries":[],"nextCursor":null}', {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = actual.createApiClient({ fetchImpl: fetchMock as unknown as typeof fetch });
  await client('access.audit.list', { action: 'user.update', query: 'budi', cursor: 'k 1' });
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    '/api/v1/audit-logs?action=user.update&query=budi&cursor=k+1',
  );
});
