import { queryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Kunci query panduan. TIDAK masuk whitelist `app/query-persist.ts`: status panduan dimuat dari server (akun
 * individu) atau dari `localStorage` perangkat (akun bersama) tiap aplikasi dibuka, tak perlu disalin lagi.
 */
export const guideKeys = {
  all: ['guides'] as const,
  list: ['guides', 'list'] as const,
  device: (email: string) => ['guides', 'device', email.trim().toLowerCase()] as const,
};

/** Penanda panduan milik pemanggil (akun individu). */
export function guidesQueryOptions() {
  return queryOptions({
    queryKey: guideKeys.list,
    queryFn: () => api('guides.list', null),
  });
}
