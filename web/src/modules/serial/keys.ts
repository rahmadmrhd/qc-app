import type { SerialCaseListInput, SerialListInput } from '@shared/contract';

export const serialKeys = {
  all: ['serial'] as const,
  /** Awalan semua daftar serial (satu per kombinasi filter). */
  list: ['serial', 'list'] as const,
  page: (filter: Omit<SerialListInput, 'cursor'>) => ['serial', 'list', filter] as const,
  one: (id: string) => ['serial', 'one', id] as const,
  /** Awalan semua halaman riwayat satu serial (satu per tab/filter). */
  history: (id: string) => ['serial', 'history', id] as const,
  historyPage: (id: string, group: string, caseId: string) =>
    ['serial', 'history', id, group, caseId] as const,
  settings: ['serial', 'settings'] as const,
  serviceSettings: ['serial', 'serviceSettings'] as const,
  serviceLocations: ['serial', 'serviceLocations'] as const,
  lookup: (serial: string) => ['serial', 'lookup', serial] as const,
  /** Awalan semua daftar laporan (satu per kombinasi filter). */
  cases: ['serial', 'cases'] as const,
  casePage: (filter: Omit<SerialCaseListInput, 'cursor'>) => ['serial', 'cases', filter] as const,
  itemOptions: (query: string) => ['serial', 'itemOptions', query] as const,
  itemsById: (ids: readonly string[]) => ['serial', 'itemsById', [...ids].sort()] as const,
  locationOptions: ['serial', 'locationOptions'] as const,
  stickerOptions: (itemId: string, buId: string) =>
    ['serial', 'stickerOptions', itemId, buId] as const,
};
