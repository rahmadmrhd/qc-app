import type { SerialListInput } from '@shared/contract';

export const serialKeys = {
  all: ['serial'] as const,
  /** Awalan semua daftar serial (satu per kombinasi filter). */
  list: ['serial', 'list'] as const,
  page: (filter: Omit<SerialListInput, 'cursor'>) => ['serial', 'list', filter] as const,
  one: (id: string) => ['serial', 'one', id] as const,
  itemOptions: (query: string) => ['serial', 'itemOptions', query] as const,
  itemsById: (ids: readonly string[]) => ['serial', 'itemsById', [...ids].sort()] as const,
  locationOptions: ['serial', 'locationOptions'] as const,
  stickerOptions: (itemId: string, buId: string) =>
    ['serial', 'stickerOptions', itemId, buId] as const,
};
