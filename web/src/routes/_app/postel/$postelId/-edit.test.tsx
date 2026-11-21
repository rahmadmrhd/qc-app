import { QueryClient } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { Route } from './edit';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));

beforeEach(() => apiMock.mockReset());

function runLoader() {
  const loader = Route.options.loader as (args: unknown) => Promise<unknown>;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return loader({ context: { queryClient }, params: { postelId: 'p1' } });
}

test('catatan terhapus: rute Ubah mengarahkan ke View (banner Terhapus), bukan membuka form', async () => {
  apiMock.mockResolvedValue({
    id: 'p1',
    name: 'X',
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  });
  const failure = await runLoader().then(
    () => null,
    (error: unknown) => error,
  );
  expect(isRedirect(failure)).toBe(true);
  expect(failure).toMatchObject({
    options: { to: '/postel/$postelId', params: { postelId: 'p1' } },
  });
});

test('catatan hidup: loader mengembalikan data (form terbuka)', async () => {
  apiMock.mockResolvedValue({ id: 'p1', name: 'X' });
  await expect(runLoader()).resolves.toMatchObject({ id: 'p1' });
});
