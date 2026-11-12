import type { QcBridge } from '@countrylock/bridge-contract';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { CSRF_HEADERS } from '@/lib/api/client';
import { getBridge } from '@/lib/platform';
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

/** Desktop: proses utama membuang token Bearer; galat IPC diabaikan (sesi lokal tetap dibuang). */
export async function logoutDesktop(bridge: QcBridge): Promise<void> {
  try {
    await bridge.auth.logout();
  } catch {
    // Dibiarkan.
  }
}

export function useLogout(): () => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  return () => {
    void (async () => {
      const bridge = getBridge();
      if (bridge) await logoutDesktop(bridge);
      else if (!import.meta.env.DEV) await postLogout();
      clearSession();
      queryClient.clear();
      await router.navigate({ to: '/login' });
    })();
  };
}
