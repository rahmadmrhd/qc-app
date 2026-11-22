import { QueryClient } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { Route } from './edit';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));

let design: Record<string, unknown> = {};

beforeEach(() => {
  apiMock.mockReset();
  design = { id: 'd1', title: 'X' };
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'qrcodes.get') return design;
    if (id === 'qrcodes.getDefaults') return { presets: [], logoFileIds: [], logoUpdatedAt: '' };
    throw new Error(`api tak terduga: ${id}`);
  });
});

function runLoader() {
  const loader = Route.options.loader as (args: unknown) => Promise<unknown>;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return loader({ context: { queryClient }, params: { designId: 'd1' } });
}

test('konfigurasi terhapus: rute Ubah mengarahkan ke View (banner Terhapus), bukan membuka form', async () => {
  design = { ...design, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } };
  const failure = await runLoader().then(
    () => null,
    (error: unknown) => error,
  );
  expect(isRedirect(failure)).toBe(true);
  expect(failure).toMatchObject({
    options: { to: '/qrcode/$designId', params: { designId: 'd1' } },
  });
});

test('konfigurasi hidup: loader mengembalikan data (form terbuka)', async () => {
  await expect(runLoader()).resolves.toBeDefined();
});
