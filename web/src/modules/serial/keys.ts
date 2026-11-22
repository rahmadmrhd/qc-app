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
  lookupMany: (serials: readonly string[]) =>
    ['serial', 'lookupMany', [...serials].sort()] as const,
  /** Awalan semua daftar laporan (satu per kombinasi filter). */
  cases: ['serial', 'cases'] as const,
  casePage: (filter: Omit<SerialCaseListInput, 'cursor'>) => ['serial', 'cases', filter] as const,
  /** Detail satu laporan: di bawah awalan `cases` agar ikut ditandai/dimuat ulang bersama daftar laporan. */
  caseOne: (id: string) => ['serial', 'cases', 'one', id] as const,
  itemOptions: (query: string) => ['serial', 'itemOptions', query] as const,
  itemsById: (ids: readonly string[]) => ['serial', 'itemsById', [...ids].sort()] as const,
  locationOptions: ['serial', 'locationOptions'] as const,
  buOptions: ['serial', 'buOptions'] as const,
  /** `serialId` kosong = daftar biasa; terisi = jalur cek ulang serial itu (kunci terpisah, tak saling membocorkan). */
  stickerOptions: (itemId: string, buId: string, serialId = '') =>
    ['serial', 'stickerOptions', itemId, buId, serialId] as const,
};

/** Foto bukti QC: awalan kunci sumber `FileDialog` (tanpa daftar; foto bukti tak punya pustaka). */
export const proofKeys = {
  upload: ['serial-proofs'] as const,
};
