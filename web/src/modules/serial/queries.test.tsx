import type { GetSerialOutput, SerialDto, SerialListOutput } from '@shared/contract';
import type { InfiniteData } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { stickerKeys } from '@/modules/sticker/keys';
import { serialKeys } from './keys';
import {
  serialHistoryInfiniteQueryOptions,
  serialItemOptionsQueryOptions,
  serialSettingsQueryOptions,
  useActSerial,
  useSaveSerialBatch,
  useSaveSerialSettings,
  useUpdateSerial,
} from './queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const dto = (over: Partial<SerialDto> = {}): SerialDto => ({
  id: 's1',
  buId: 'b1',
  buCode: 'BU1',
  serial: 'ABC123',
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  testDate: '2026-11-10',
  sample: false,
  locationId: 'l1',
  locationName: 'Jakarta',
  status: 'good',
  custody: 'qc',
  transitToLocationId: null,
  transitToLocationName: null,
  transitOn: null,
  openCaseNumber: null,
  hasProofPhotos: false,
  proofProblemCount: 0,
  createdAt: '2026-11-10T03:00:00.000Z',
  note: '',
  recordedLocationId: 'l1',
  stickers: [],
  openCaseId: null,
  transitFromLocationId: null,
  transitFromLocationName: null,
  openCase: null,
  cases: [],
  createdBy: 'a@x.com',
  updatedAt: '2026-11-10T03:00:00.000Z',
  updatedBy: 'a@x.com',
  ...over,
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  apiMock.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

test('opsi item: kata kunci kosong tidak dikirim, batas 20', async () => {
  apiMock.mockResolvedValue({ items: [], nextCursor: null });
  await client.fetchQuery(serialItemOptionsQueryOptions(''));
  await client.fetchQuery(serialItemOptionsQueryOptions('c92'));
  expect(apiMock).toHaveBeenNthCalledWith(1, 'serials.itemOptions', { limit: 20 });
  expect(apiMock).toHaveBeenNthCalledWith(2, 'serials.itemOptions', { query: 'c92', limit: 20 });
});

test('simpan massal menandai daftar dan katalog stiker basi tanpa memuat ulang', async () => {
  apiMock.mockResolvedValue({ results: [] });
  const spy = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useSaveSerialBatch(), { wrapper });
  await act(() => result.current.mutateAsync({ rows: [] }));
  const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
  expect(keys).toContainEqual(serialKeys.list);
  expect(keys).toContainEqual(stickerKeys.all);
});

test('ubah serial menempel hasil ke detail dan baris daftar', async () => {
  const before = dto();
  client.setQueryData<GetSerialOutput>(serialKeys.one('s1'), {
    serial: before,
    events: [],
    eventsTruncated: false,
  });
  client.setQueryData<InfiniteData<SerialListOutput, string | undefined>>(serialKeys.page({}), {
    pages: [{ items: [before], nextCursor: null }],
    pageParams: [undefined],
  });
  const saved = dto({ serial: 'XYZ', updatedAt: '2026-11-11T03:00:00.000Z' });
  apiMock.mockResolvedValue(saved);
  const { result } = renderHook(() => useUpdateSerial(), { wrapper });
  await act(() =>
    result.current.mutateAsync({
      id: 's1',
      expectedUpdatedAt: before.updatedAt,
      serial: 'XYZ',
      itemId: 'i1',
      testDate: '2026-11-10',
      sample: false,
      note: '',
      locationId: 'l1',
    }),
  );
  expect(client.getQueryData<GetSerialOutput>(serialKeys.one('s1'))?.serial.serial).toBe('XYZ');
  const list = client.getQueryData<InfiniteData<SerialListOutput>>(serialKeys.page({}));
  expect(list?.pages[0]?.items[0]?.serial).toBe('XYZ');
});

test('aksi (catatan/cek ulang) memasang serial terbaru ke detail', async () => {
  client.setQueryData<GetSerialOutput>(serialKeys.one('s1'), {
    serial: dto(),
    events: [],
    eventsTruncated: false,
  });
  apiMock.mockResolvedValue(
    dto({ locationName: 'Surabaya', updatedAt: '2026-11-12T03:00:00.000Z' }),
  );
  const { result } = renderHook(() => useActSerial(), { wrapper });
  await act(() =>
    result.current.mutateAsync({
      id: 's1',
      expectedUpdatedAt: '2026-11-10T03:00:00.000Z',
      action: 'recheck',
      occurredOn: '2026-11-12',
      message: '',
    }),
  );
  expect(client.getQueryData<GetSerialOutput>(serialKeys.one('s1'))?.serial.locationName).toBe(
    'Surabaya',
  );
});

test('aksi memuat ulang riwayat serial itu (awalan history) dan menandai stok stiker basi', async () => {
  apiMock.mockResolvedValue(dto({ updatedAt: '2026-11-12T03:00:00.000Z' }));
  const spy = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useActSerial(), { wrapper });
  await act(() =>
    result.current.mutateAsync({
      id: 's1',
      expectedUpdatedAt: '2026-11-10T03:00:00.000Z',
      action: 'report_failure',
      occurredOn: '2026-11-12',
      message: 'Port 3 mati',
    }),
  );
  expect(apiMock).toHaveBeenCalledWith(
    'serials.act',
    expect.objectContaining({ action: 'report_failure', message: 'Port 3 mati' }),
  );
  const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
  expect(keys).toContainEqual(serialKeys.history('s1'));
  expect(keys).toContainEqual(stickerKeys.all);
});

test('riwayat: halaman pertama tanpa kursor, berikutnya memakai nextCursor; kunci per tab dan kasus', async () => {
  apiMock
    .mockResolvedValueOnce({
      events: [],
      nextCursor: '40',
      counts: { all: 90, checks: 3, changes: 2, byCase: {} },
    })
    .mockResolvedValueOnce({
      events: [],
      nextCursor: null,
      counts: { all: 90, checks: 3, changes: 2, byCase: {} },
    });
  const options = serialHistoryInfiniteQueryOptions({ id: 's1', group: 'checks' });
  expect(options.queryKey).toEqual(serialKeys.historyPage('s1', 'checks', ''));
  expect(serialHistoryInfiniteQueryOptions({ id: 's1', caseId: 'c1' }).queryKey).toEqual(
    serialKeys.historyPage('s1', 'all', 'c1'),
  );
  const { result } = renderHook(() => useInfiniteQuery(options), { wrapper });
  await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  expect(apiMock).toHaveBeenNthCalledWith(1, 'serials.history', { id: 's1', group: 'checks' });
  await act(() => result.current.fetchNextPage());
  expect(apiMock).toHaveBeenNthCalledWith(2, 'serials.history', {
    id: 's1',
    group: 'checks',
    cursor: '40',
  });
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
});

test('pengaturan surel: memuat lewat serialSettings.get; simpan memasang hasil ke cache', async () => {
  const loaded = { alert: { enabled: false, recipients: [] }, updatedAt: '', smtpConfigured: true };
  apiMock.mockResolvedValueOnce(loaded);
  await client.fetchQuery(serialSettingsQueryOptions());
  expect(apiMock).toHaveBeenCalledWith('serialSettings.get', null);
  const saved = {
    alert: { enabled: true, recipients: ['a@b.co'] },
    updatedAt: '2026-11-13T01:00:00.000Z',
    smtpConfigured: true,
  };
  apiMock.mockResolvedValueOnce(saved);
  const { result } = renderHook(() => useSaveSerialSettings(), { wrapper });
  await act(() => result.current.mutateAsync({ expectedUpdatedAt: '', alert: saved.alert }));
  expect(client.getQueryData(serialKeys.settings)).toEqual(saved);
});
