import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { CSRF_HEADERS } from '@/lib/api/client';
import { clearAllDrafts } from '@/modules/serial/lib/draft-store';
import { clearSession } from './session';

/** Menghapus cookie sesi di server (gagal jaringan diabaikan: sesi lokal tetap dibuang). */
export async function postLogout(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: CSRF_HEADERS,
    });
  } catch {
    // Dibiarkan.
  }
}

export function useLogout(): () => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  return () => {
    void (async () => {
      if (!import.meta.env.DEV) await postLogout();
      clearSession();
      // Draf tabel sementara Serial Number (localStorage) dibuang saat keluar; sesi yang kedaluwarsa tidak membuangnya.
      clearAllDrafts();
      queryClient.clear();
      await router.navigate({ to: '/login' });
    })();
  };
}
