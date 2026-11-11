import type { QrDesignDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { itemKeys } from '@/modules/item/queries';
import { stickerKeys } from '@/modules/sticker/keys';
import {
  qrKeys,
  useClonePreset,
  useDeleteQrDesign,
  useExportQrDesign,
  useSaveQrDesign,
} from './queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/modules/jobs/queries', () => ({ awaitJob: vi.fn().mockResolvedValue(undefined) }));

const design = (id: string, title: string, updatedAt: string) =>
  ({ id, title, updatedAt }) as unknown as QrDesignDto;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  apiMock.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

test('simpan QR: hasil dipasang ke daftar dan detail tanpa memuat ulang; mutasi selesai tanpa menunggu permintaan lain', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'Lama', '2026-10-01T00:00:00.000Z')]);
  const saved = design('b', 'Baru', '2026-10-02T00:00:00.000Z');
  apiMock.mockResolvedValue(saved);
  const { result } = renderHook(() => useSaveQrDesign(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({} as never);
  });
  expect(apiMock).toHaveBeenCalledTimes(1); // hanya simpan; tidak ada qrcodes.list / audit ulang
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'b',
    'a',
  ]);
  expect(client.getQueryData(qrKeys.one('b'))).toEqual(saved);
});

test('hapus QR: dibuang dari daftar dan detail tanpa memuat ulang', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'A', 't'), design('b', 'B', 't')]);
  client.setQueryData(qrKeys.one('a'), design('a', 'A', 't'));
  apiMock.mockResolvedValue({ id: 'a' });
  const { result } = renderHook(() => useDeleteQrDesign(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ id: 'a' });
  });
  expect(apiMock).toHaveBeenCalledTimes(1);
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'b',
  ]);
  expect(client.getQueryData(qrKeys.one('a'))).toBeUndefined();
});

test('kloning preset: preset baru dipasang ke cache defaults urut nama tanpa memuat ulang', async () => {
  const preset = (id: string, name: string) => ({ id, name }) as never;
  client.setQueryData(qrKeys.defaults, {
    presets: [preset('a', 'Alfa'), preset('c', 'Charlie')],
    logoFileIds: [],
    logoUpdatedAt: '',
  });
  apiMock.mockResolvedValue(preset('b', 'Bravo'));
  const { result } = renderHook(() => useClonePreset(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ id: 'a', buId: 'bu2', name: 'Bravo' });
  });
  expect(apiMock).toHaveBeenCalledTimes(1);
  expect(apiMock).toHaveBeenCalledWith('qrcodes.clonePreset', {
    id: 'a',
    buId: 'bu2',
    name: 'Bravo',
  });
  const cached = client.getQueryData(qrKeys.defaults) as { presets: Array<{ id: string }> };
  expect(cached.presets.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
});

/** Katalog stiker dan item memuat Manual Book hasil ekspor (stiker baru/usang, `hasManualBook`): ditandai basi. */
function seedCatalogCaches() {
  client.setQueryData(stickerKeys.list, [{ id: 's1' }]);
  client.setQueryData(
    itemKeys.page({
      query: '',
      status: 'all',
      instruction: 'all',
      stickerKey: '',
      stickerMode: 'has',
      manualBook: 'all',
    }),
    { pages: [], pageParams: [] },
  );
  client.setQueryData(itemKeys.one('i1'), { id: 'i1' });
}
const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated === true;

test('simpan, ekspor, dan hapus QR menandai basi cache stiker dan item (tanpa memuat ulang sekarang)', async () => {
  for (const run of [
    async () => {
      apiMock.mockResolvedValue(design('b', 'Baru', 't'));
      const { result } = renderHook(() => useSaveQrDesign(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({} as never);
      });
    },
    async () => {
      apiMock.mockImplementation(async (id: string) =>
        id === 'qrcodes.export' ? { jobId: 'j1' } : design('b', 'Baru', 't'),
      );
      const { result } = renderHook(() => useExportQrDesign(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ id: 'b' } as never);
      });
    },
    async () => {
      apiMock.mockResolvedValue({ id: 'a' });
      const { result } = renderHook(() => useDeleteQrDesign(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ id: 'a' });
      });
    },
  ]) {
    client.clear();
    apiMock.mockReset();
    seedCatalogCaches();
    await run();
    expect(stale(stickerKeys.list)).toBe(true);
    expect(stale(itemKeys.one('i1'))).toBe(true);
    expect(stale(['items', 'list', '', 'all', 'all', '', 'has', 'all'])).toBe(true);
  }
});
