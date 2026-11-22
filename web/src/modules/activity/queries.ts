import type { ActivityPageDto, ListActivityInput } from '@shared/contract';
import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Halaman pertama log aktivitas panel View: 10 entri; "Muat lebih banyak" menambah per 10 (kursor server). */
export const ACTIVITY_PAGE_SIZE = 10;

export type ActivityTarget = Pick<ListActivityInput, 'kind' | 'id'>;

/** Kunci tunggal log aktivitas satu record. TIDAK masuk whitelist `query-persist` (log tidak disimpan ke perangkat). */
export const activityKeys = {
  all: ['activity'] as const,
  one: (target: ActivityTarget) => ['activity', target.kind, target.id] as const,
};

/** Log aktivitas satu record (`activity.list`), terbaru dahulu, berkursor. Hanya nama field, tanpa nilai. */
export function activityQueryOptions(target: ActivityTarget) {
  return infiniteQueryOptions({
    queryKey: activityKeys.one(target),
    queryFn: ({ pageParam }) =>
      api('activity.list', {
        kind: target.kind,
        id: target.id,
        limit: ACTIVITY_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ActivityPageDto) => last.nextCursor ?? undefined,
    // Selalu muat ulang saat View dibuka: log harus mencerminkan simpan yang baru saja terjadi.
    staleTime: 0,
  });
}
