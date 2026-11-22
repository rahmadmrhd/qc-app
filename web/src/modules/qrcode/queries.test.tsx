import type { QrDesignDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { itemKeys } from '@/modules/item/queries';
import { stickerKeys } from '@/modules/sticker/keys';
import {
  qrKeys,
  refreshQrDesign,
  useClonePreset,
  useExportQrDesign,
  useRemoveQrDesigns,
  useRemoveQrPresets,
  useRestoreQrDesigns,
  useRestoreQrPresets,
  useSaveQrDesign,
  useUploadQrPdf,
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

test('hapus QR (batch): keluar dari daftar hidup tanpa memuat ulang; detail ditandai basi, bukan dibuang', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'A', 't'), design('b', 'B', 't')]);
  client.setQueryData(qrKeys.one('a'), design('a', 'A', 't'));
  apiMock.mockResolvedValue({ ids: ['a'] });
  const { result } = renderHook(() => useRemoveQrDesigns(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ ids: ['a'] });
  });
  expect(apiMock).toHaveBeenCalledTimes(1);
  expect(apiMock).toHaveBeenCalledWith('qrcodes.removeBatch', { ids: ['a'] });
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'b',
  ]);
  // Hapus lunak: rekamannya masih ada (View bagi pemulih), jadi detail tidak dibuang.
  expect(client.getQueryData(qrKeys.one('a'))).toBeDefined();
  expect(client.getQueryState(qrKeys.one('a'))?.isInvalidated).toBe(true);
});

test('pulihkan QR (batch): kembali ke daftar hidup, keluar dari daftar terhapus, detail diperbarui', async () => {
  const restored = design('a', 'A', '2026-10-09T00:00:00.000Z');
  client.setQueryData(qrKeys.list, [design('b', 'B', '2026-10-01T00:00:00.000Z')]);
  client.setQueryData(qrKeys.listDeleted, [design('a', 'A', 't')]);
  apiMock.mockResolvedValue({ items: [restored] });
  const { result } = renderHook(() => useRestoreQrDesigns(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ ids: ['a'] });
  });
  expect(apiMock).toHaveBeenCalledWith('qrcodes.restoreBatch', { ids: ['a'] });
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'a',
    'b',
  ]);
  expect(client.getQueryData(qrKeys.listDeleted)).toEqual([]);
  expect(client.getQueryData(qrKeys.one('a'))).toEqual(restored);
});

test('hapus dan pulihkan preset (batch): cache defaults dan detail preset mengikuti hasil', async () => {
  const preset = (id: string, name: string) => ({ id, name }) as never;
  client.setQueryData(qrKeys.defaults, {
    presets: [preset('a', 'Alfa'), preset('b', 'Bravo')],
    logoFileIds: [],
    logoUpdatedAt: '',
  });
  client.setQueryData(qrKeys.defaultsDeleted, {
    presets: [preset('c', 'Charlie')],
    logoFileIds: [],
    logoUpdatedAt: '',
  });
  apiMock.mockResolvedValueOnce({ ids: ['a'] });
  const remove = renderHook(() => useRemoveQrPresets(), { wrapper });
  await act(async () => {
    await remove.result.current.mutateAsync({ ids: ['a'] });
  });
  expect(apiMock).toHaveBeenCalledWith('qrcodes.removePresetBatch', { ids: ['a'] });
  const afterRemove = client.getQueryData(qrKeys.defaults) as { presets: { id: string }[] };
  expect(afterRemove.presets.map((entry) => entry.id)).toEqual(['b']);

  apiMock.mockResolvedValueOnce({ items: [preset('c', 'Charlie')] });
  const restore = renderHook(() => useRestoreQrPresets(), { wrapper });
  await act(async () => {
    await restore.result.current.mutateAsync({ ids: ['c'] });
  });
  expect(apiMock).toHaveBeenCalledWith('qrcodes.restorePresetBatch', { ids: ['c'] });
  const live = client.getQueryData(qrKeys.defaults) as { presets: { id: string }[] };
  expect(live.presets.map((entry) => entry.id)).toEqual(['b', 'c']);
  const deleted = client.getQueryData(qrKeys.defaultsDeleted) as { presets: unknown[] };
  expect(deleted.presets).toEqual([]);
  expect(client.getQueryData(qrKeys.preset('c'))).toEqual(preset('c', 'Charlie'));
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
      postel: 'all',
      brandIds: [],
      buIds: [],
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
      apiMock.mockResolvedValue({ ids: ['a'] });
      const { result } = renderHook(() => useRemoveQrDesigns(), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ ids: ['a'] });
      });
    },
  ]) {
    client.clear();
    apiMock.mockReset();
    seedCatalogCaches();
    await run();
    expect(stale(stickerKeys.list)).toBe(true);
    expect(stale(itemKeys.one('i1'))).toBe(true);
    expect(stale(['items', 'list', '', 'all', 'all', '', 'has', 'all', 'all', '', ''])).toBe(true);
  }
});

test('refreshQrDesign memuat konfigurasi terbaru dan memasangnya ke daftar dan detail', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'Lama', '2026-10-01T00:00:00.000Z')]);
  const fresh = design('a', 'Baru', '2026-10-05T00:00:00.000Z');
  apiMock.mockResolvedValue(fresh);
  expect(await refreshQrDesign(client, 'a')).toEqual(fresh);
  expect(apiMock).toHaveBeenCalledWith('qrcodes.get', { id: 'a' });
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[])[0]?.title).toBe('Baru');
  expect(client.getQueryData(qrKeys.one('a'))).toEqual(fresh);
});

test('refreshQrDesign: konfigurasi yang ternyata terhapus keluar dari daftar hidup (DTO tetap dikembalikan dan dipasang ke detail)', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'A', 't'), design('b', 'B', 't')]);
  const gone = {
    ...design('a', 'A', 't'),
    deleted: { deletedAt: '2026-11-22T00:00:00.000Z', deletedBy: 'x@y.com' },
  } as unknown as QrDesignDto;
  apiMock.mockResolvedValue(gone);
  expect(await refreshQrDesign(client, 'a')).toEqual(gone);
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'b',
  ]);
  expect(client.getQueryData(qrKeys.one('a'))).toEqual(gone);
});

test('refreshQrDesign: NOT_FOUND (terhapus bagi non-manage) mengeluarkan konfigurasi dari daftar hidup dan menandai detail/terhapus basi, galat tetap dilempar', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'A', 't'), design('b', 'B', 't')]);
  client.setQueryData(qrKeys.one('a'), design('a', 'A', 't'));
  client.setQueryData(qrKeys.listDeleted, []);
  apiMock.mockRejectedValue(new ApiError('NOT_FOUND', 'Tidak ditemukan', 'r1'));
  await expect(refreshQrDesign(client, 'a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'b',
  ]);
  expect(client.getQueryState(qrKeys.one('a'))?.isInvalidated).toBe(true);
  expect(client.getQueryState(qrKeys.listDeleted)?.isInvalidated).toBe(true);
});

test('refreshQrDesign: galat lain tidak menyentuh daftar hidup', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'A', 't')]);
  apiMock.mockRejectedValue(new ApiError('FORBIDDEN', 'Tidak boleh', 'r1'));
  await expect(refreshQrDesign(client, 'a')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'a',
  ]);
});

test('unggah PDF: onUploadProgress diteruskan ke api sebagai opsi panggilan, bukan sebagai input', async () => {
  apiMock.mockResolvedValue({ id: 'd1' });
  const onUploadProgress = vi.fn();
  const { result } = renderHook(() => useUploadQrPdf(), { wrapper });
  const bytes = new Uint8Array([1]);
  await act(async () => {
    await result.current.mutateAsync({ name: 'a.pdf', bytes, onUploadProgress });
  });
  expect(apiMock).toHaveBeenCalledWith(
    'qrcodes.uploadPdf',
    { name: 'a.pdf', bytes },
    { onUploadProgress },
  );
  apiMock.mockClear();
  await act(async () => {
    await result.current.mutateAsync({ name: 'b.pdf', bytes });
  });
  expect(apiMock).toHaveBeenCalledWith('qrcodes.uploadPdf', { name: 'b.pdf', bytes }, undefined);
});
