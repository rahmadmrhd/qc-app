import { queryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Daftar unduhan aplikasi desktop. TIDAK masuk whitelist `app/query-persist.ts`: isinya dibaca dari server tiap halaman
 * dibuka, dan tautan unduhnya tak berguna tanpa koneksi.
 */
export const desktopDownloadKeys = {
  releases: ['desktop', 'releases'] as const,
};

export function desktopReleasesQueryOptions() {
  return queryOptions({
    queryKey: desktopDownloadKeys.releases,
    queryFn: () => api('desktop.releases', null),
  });
}
