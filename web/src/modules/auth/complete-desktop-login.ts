import type { MeDto } from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import { meQueryKey } from './queries';
import { markAuthenticated } from './session';

/**
 * Menyelesaikan login desktop setelah `auth.onChange` melaporkan `signedIn` dan `me` berhasil dimuat:
 * sesi ditandai sah, `me` dipasang ke cache (seperti boot), lalu masuk ke aplikasi.
 */
export async function completeDesktopLogin(
  me: MeDto,
  deps: { queryClient: QueryClient; navigate: (options: { to: '/' }) => Promise<unknown> },
): Promise<void> {
  markAuthenticated(me.email);
  deps.queryClient.setQueryData(meQueryKey, me);
  await deps.navigate({ to: '/' });
}
