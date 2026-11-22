import type { QrDesignDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import { hasUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { ApiError } from '@/lib/api/api-error';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  mutate: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock('../queries', () => ({
  refreshQrDesign: (...args: unknown[]) => mocks.refresh(...args),
  useExportQrDesign: () => ({ mutateAsync: (input: unknown) => mocks.mutate(input) }),
}));
vi.mock('./prepare-export', () => ({
  prepareExportFiles: (...args: unknown[]) => mocks.prepare(...args),
}));

import { BULK_EXPORT_MAX, useBulkQrExport } from './use-bulk-qr-export';

const design = (id: string, patch: Partial<QrDesignDto> = {}): QrDesignDto => ({
  id,
  title: `Judul ${id}`,
  linkSource: 'url',
  link: 'https://contoh.com/a',
  documentId: '',
  documentName: '',
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  overflow: false,
  name: `MB ${id}`,
  namePlacement: '',
  presetId: '',
  items: [{ id: `it-${id}`, brand: 'PBE', model: `M-${id}` }],
  hiddenItemCount: 0,
  stickerVersion: 0,
  stickerStatus: '',
  exportStatus: 'none',
  exportedAt: '',
  exportedBy: '',
  createdAt: 't',
  createdBy: 'a@x.com',
  updatedAt: `u-${id}`,
  updatedBy: 'a@x.com',
  ...patch,
});
/** Konfigurasi yang melahirkan versi Manual Book baru (label berubah, sudah punya versi). */
const newVersion = (id: string) =>
  design(id, { exportStatus: 'stale', stickerVersion: 1, exportedAt: '2026-11-01T00:00:00.000Z' });

const files = { pdf: new Uint8Array(1), png: new Uint8Array(1), preview: new Uint8Array(1) };
const stale412 = () => new ApiError('CONFLICT', 'basi', 'r1', undefined, { status: 412 });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const designs = new Map<string, QrDesignDto>();
const register = (...items: QrDesignDto[]) => {
  for (const item of items) designs.set(item.id, item);
  return items;
};
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

beforeEach(() => {
  resetBusyForTests();
  designs.clear();
  mocks.refresh.mockReset();
  mocks.mutate.mockReset();
  mocks.prepare.mockReset();
  // Bawaan: memuat ulang mengembalikan konfigurasi terdaftar (disetel per tes bila perlu).
  mocks.refresh.mockImplementation(async (_client: unknown, id: string) => designs.get(id));
  mocks.prepare.mockResolvedValue(files);
  mocks.mutate.mockResolvedValue(undefined);
});

const idsOfCalls = () => mocks.mutate.mock.calls.map((args) => (args[0] as { id: string }).id);

test('berurutan satu per satu: item berikutnya baru mulai setelah item sebelumnya selesai', async () => {
  const list = register(design('a'), design('b'), design('c'));
  const gates = [deferred<undefined>(), deferred<undefined>(), deferred<undefined>()];
  let call = 0;
  mocks.mutate.mockImplementation(() => gates[call++]?.promise);
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });

  let finished: Promise<unknown> = Promise.resolve();
  act(() => {
    finished = result.current.start(list, '');
  });
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  // Item pertama belum selesai: tidak ada permintaan kedua.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(mocks.mutate.mock.calls[0]?.[0]).toMatchObject({ id: 'a', expectedUpdatedAt: 'u-a' });
  expect(result.current.running).toBe(true);
  expect(isBusy()).toBe(true);
  expect(hasUnsavedChanges()).toBe(true);

  await act(async () => gates[0]?.resolve(undefined));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
  await act(async () => gates[1]?.resolve(undefined));
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(3));
  await act(async () => gates[2]?.resolve(undefined));
  await act(async () => {
    await finished;
  });

  expect(idsOfCalls()).toEqual(['a', 'b', 'c']);
  expect(result.current.phase).toBe('finished');
  expect(result.current.outcome).toMatchObject({
    doneIds: ['a', 'b', 'c'],
    failedIds: [],
    stopped: null,
  });
  expect(isBusy()).toBe(false);
  expect(hasUnsavedChanges()).toBe(false);
});

test('lanjut setelah galat per konfigurasi dan melaporkannya per baris', async () => {
  const list = register(design('a'), design('b'), design('c'));
  mocks.mutate.mockImplementation(async (input: { id: string }) => {
    if (input.id === 'b') throw new ApiError('VALIDATION', 'Nama sudah dipakai', 'r2');
  });
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '');
  });
  expect(mocks.mutate).toHaveBeenCalledTimes(3);
  expect(result.current.outcome).toMatchObject({ doneIds: ['a', 'c'], failedIds: ['b'] });
  const failed = result.current.rows.find((row) => row.id === 'b');
  expect(failed).toMatchObject({ status: 'failed' });
  expect(failed?.message).toContain('Nama sudah dipakai');
});

test('berhenti penuh pada UNAVAILABLE: sisanya tetap menunggu dan tidak dikirim', async () => {
  const list = register(design('a'), design('b'), design('c'));
  mocks.mutate.mockImplementation(async (input: { id: string }) => {
    if (input.id === 'b') throw new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-');
  });
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '');
  });
  expect(mocks.mutate).toHaveBeenCalledTimes(2);
  expect(result.current.outcome).toMatchObject({
    doneIds: ['a'],
    failedIds: ['b'],
    waitingIds: ['c'],
    stopped: 'unavailable',
  });
  expect(result.current.rows.find((row) => row.id === 'c')?.status).toBe('waiting');
  expect(isBusy()).toBe(false);
});

test('UNAVAILABLE saat memuat ulang konfigurasi juga menghentikan putaran', async () => {
  const list = register(design('a'), design('b'));
  mocks.refresh.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '');
  });
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(result.current.outcome).toMatchObject({ stopped: 'unavailable', waitingIds: ['b'] });
});

test('galat basi: muat ulang lalu ulang SEKALI dengan updatedAt baru; basi lagi = gagal', async () => {
  const list = register(design('a'), design('b'));
  const refreshed = design('a', { updatedAt: 'u-a-baru' });
  let refreshCalls = 0;
  mocks.refresh.mockImplementation(async (_client: unknown, id: string) => {
    refreshCalls += 1;
    return id === 'a' && refreshCalls > 1 ? refreshed : designs.get(id);
  });
  mocks.mutate.mockImplementation(async (input: { id: string; expectedUpdatedAt: string }) => {
    if (input.id === 'a' && input.expectedUpdatedAt === 'u-a') throw stale412();
    if (input.id === 'b') throw stale412();
  });
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '');
  });
  const calls = mocks.mutate.mock.calls.map(
    (args) => args[0] as { id: string; expectedUpdatedAt: string },
  );
  // a: gagal basi lalu berhasil dengan updatedAt baru; b: basi dua kali (hanya satu ulangan), lalu gagal.
  expect(calls.filter((call) => call.id === 'a').map((call) => call.expectedUpdatedAt)).toEqual([
    'u-a',
    'u-a-baru',
  ]);
  expect(calls.filter((call) => call.id === 'b')).toHaveLength(2);
  expect(result.current.outcome).toMatchObject({ doneIds: ['a'], failedIds: ['b'] });
});

test('alasan hanya dikirim untuk konfigurasi yang melahirkan versi baru', async () => {
  const list = register(design('first'), newVersion('ver'));
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '  Logo diganti  ');
  });
  const byId = Object.fromEntries(
    mocks.mutate.mock.calls.map((args) => [(args[0] as { id: string }).id, args[0]]),
  );
  expect(byId.first).toMatchObject({ reason: '' });
  expect(byId.ver).toMatchObject({ reason: 'Logo diganti' });
});

test('klasifikasi ulang setelah memuat ulang: sudah terbaru dilewati tanpa mengekspor', async () => {
  const list = register(design('a'));
  mocks.refresh.mockResolvedValue(
    design('a', { exportStatus: 'current', stickerVersion: 1, exportedAt: 'x' }),
  );
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '');
  });
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(result.current.outcome).toMatchObject({ skippedIds: ['a'], doneIds: [] });
});

test('label berubah menjadi butuh alasan padahal tak ada alasan: baris gagal, tidak mengirim', async () => {
  const list = register(design('a'));
  mocks.refresh.mockResolvedValue(newVersion('a'));
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '');
  });
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(result.current.outcome?.failedIds).toEqual(['a']);
});

test('yang tak lengkap dilewati sejak awal dan dilaporkan; yang lain tetap diekspor', async () => {
  const list = register(design('ok'), design('besar', { overflow: true }));
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '');
  });
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(result.current.outcome).toMatchObject({ doneIds: ['ok'], skippedIds: ['besar'] });
});

test('batal: item yang berjalan diselesaikan, sisanya tidak dikerjakan', async () => {
  const list = register(design('a'), design('b'), design('c'));
  const gate = deferred<undefined>();
  mocks.mutate.mockImplementationOnce(() => gate.promise);
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  let finished: Promise<unknown> = Promise.resolve();
  act(() => {
    finished = result.current.start(list, '');
  });
  await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  act(() => result.current.cancel());
  expect(result.current.cancelling).toBe(true);
  await act(async () => gate.resolve(undefined));
  await act(async () => {
    await finished;
  });
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(result.current.outcome).toMatchObject({
    doneIds: ['a'],
    waitingIds: ['b', 'c'],
    stopped: 'cancelled',
  });
});

test('lebih dari batas yang dapat diekspor tidak dimulai', async () => {
  const list = register(
    ...Array.from({ length: BULK_EXPORT_MAX + 1 }, (_, index) => design(`d${index}`)),
  );
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  let started: unknown = 'belum';
  await act(async () => {
    started = await result.current.start(list, '');
  });
  expect(started).toBeNull();
  expect(result.current.phase).toBe('idle');
  expect(mocks.mutate).not.toHaveBeenCalled();
});

test('reset mengembalikan ke idle setelah selesai', async () => {
  const list = register(design('a'));
  const { result } = renderHook(() => useBulkQrExport(), { wrapper });
  await act(async () => {
    await result.current.start(list, '');
  });
  expect(result.current.phase).toBe('finished');
  act(() => result.current.reset());
  expect(result.current.phase).toBe('idle');
  expect(result.current.rows).toEqual([]);
});
