import type { PushConfigDto } from '@shared/contract';
import { api } from '@/lib/api';
import { getPushRegistration, subscribeThisDevice } from './subscribe';

/**
 * Menautkan perangkat ini ke akun yang sedang masuk lewat service worker yang aktif dan API push. `unavailable` bila
 * service worker tidak ada (mis. dev) atau push tidak tersedia di server. Melempar bila peramban/server menolak.
 */
export async function syncThisDevice(config: PushConfigDto): Promise<'subscribed' | 'unavailable'> {
  const registration = await getPushRegistration();
  if (registration === undefined) return 'unavailable';
  return subscribeThisDevice({
    registration,
    config,
    send: (input) => api('push.subscribe', input),
    unsubscribeServer: (input) => api('push.unsubscribe', input),
  });
}
