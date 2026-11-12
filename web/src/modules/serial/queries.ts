import type {
  GetSerialOutput,
  ListSerialItemOptionsInput,
  SaveSerialBatchInput,
  SerialActInput,
  SerialDto,
  SerialListInput,
  SerialListOutput,
  SerialSummaryDto,
  UpdateSerialBatchInput,
  UpdateSerialInput,
} from '@shared/contract';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { stickerKeys } from '@/modules/sticker/keys';
import { serialKeys } from './keys';

export type SerialListFilter = Omit<SerialListInput, 'cursor'>;

/** Daftar serial berkursor (kursor server); filter dan pencarian dikerjakan server. TIDAK masuk whitelist `query-persist`. */
export function serialListQueryOptions(filter: SerialListFilter = {}) {
  return infiniteQueryOptions({
    queryKey: serialKeys.page(filter),
    queryFn: ({ pageParam }) =>
      api('serials.list', { ...filter, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SerialListOutput) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function serialDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: serialKeys.one(id),
    queryFn: () => api('serials.get', { id }),
  });
}

/** Opsi item untuk pemilih pencatat serial: pencarian di server (hanya item pada BU yang boleh ditulis). */
export function serialItemOptionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: serialKeys.itemOptions(query),
    queryFn: () => api('serials.itemOptions', { ...(query === '' ? {} : { query }), limit: 20 }),
  });
}

/** Item menurut id (verifikasi impor `.qcsn`): server mengembalikan tepat item yang ada dan terlihat bagi pengguna (maks. 50 id). */
export function serialItemsByIdQueryOptions(itemIds: readonly string[]) {
  const input: ListSerialItemOptionsInput = { itemIds: [...itemIds] };
  return queryOptions({
    queryKey: serialKeys.itemsById(itemIds),
    queryFn: () => api('serials.itemOptions', input),
  });
}

/** Semua lokasi aktif untuk pemilih lokasi serial (bukan lokasi penugasan pengguna: spek §3 butir 3). */
export function serialLocationOptionsQueryOptions() {
  return queryOptions({
    queryKey: serialKeys.locationOptions,
    queryFn: () => api('serials.locationOptions', null),
    staleTime: 5 * 60_000,
  });
}

/** Stiker yang berlaku bagi (item, BU): bahan daftar centang stiker. */
export function serialStickerOptionsQueryOptions(itemId: string, buId: string) {
  return queryOptions({
    queryKey: serialKeys.stickerOptions(itemId, buId),
    queryFn: () => api('serials.stickerOptions', { itemId, buId }),
    enabled: itemId !== '' && buId !== '',
  });
}

export function toSerialSummary(serial: SerialDto): SerialSummaryDto {
  return {
    id: serial.id,
    buId: serial.buId,
    buCode: serial.buCode,
    serial: serial.serial,
    itemId: serial.itemId,
    itemLabel: serial.itemLabel,
    testDate: serial.testDate,
    sample: serial.sample,
    locationId: serial.locationId,
    locationName: serial.locationName,
    status: serial.status,
    custody: serial.custody,
    createdAt: serial.createdAt,
  };
}

/** Baris yang sudah termuat di daftar mana pun diganti di tempat (posisinya ditentukan server, jadi tidak disisipkan). */
function patchLists(queryClient: QueryClient, saved: SerialDto): void {
  const summary = toSerialSummary(saved);
  queryClient.setQueriesData<InfiniteData<SerialListOutput, string | undefined>>(
    { queryKey: serialKeys.list },
    (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((entry) => (entry.id === summary.id ? summary : entry)),
            })),
          }
        : current,
  );
}

/** Hasil server dipasang ke detail dan daftar; linimasa (kejadian baru) dimuat ulang bila detailnya sedang terbuka. */
function applySaved(queryClient: QueryClient, saved: SerialDto): void {
  queryClient.setQueryData<GetSerialOutput>(serialKeys.one(saved.id), (current) =>
    current ? { ...current, serial: saved } : current,
  );
  patchLists(queryClient, saved);
  void queryClient.invalidateQueries({ queryKey: serialKeys.one(saved.id) });
}

export function useSaveSerialBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSerialBatchInput) => api('serials.saveBatch', input),
    onSuccess: () => {
      // Serial baru muncul di daftar (posisi ditentukan server) dan memotong stok stiker.
      markStale(queryClient, serialKeys.list, stickerKeys.all, accessKeys.audit);
    },
  });
}

export function useUpdateSerial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSerialInput) => api('serials.update', input),
    onSuccess: (saved) => {
      applySaved(queryClient, saved);
      markStale(queryClient, accessKeys.audit);
    },
  });
}

export function useUpdateSerialBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSerialBatchInput) => api('serials.updateBatch', input),
    onSuccess: (_output, input) => {
      markStale(queryClient, serialKeys.list, accessKeys.audit);
      for (const row of input.rows) markStale(queryClient, serialKeys.one(row.id));
    },
  });
}

export function useActSerial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SerialActInput) => api('serials.act', input),
    onSuccess: (saved) => {
      applySaved(queryClient, saved);
      markStale(queryClient, stickerKeys.all, accessKeys.audit);
    },
  });
}
