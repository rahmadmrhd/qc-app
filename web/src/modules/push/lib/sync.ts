import type { PushConfigDto } from '@shared/contract';
import { api } from '@/lib/api';
import { getPushRegistration, subscribeThisDevice } from './subscribe';

/**
 * Menautkan perangkat ini ke akun yang sedang masuk lewat service worker yang aktif dan API push. `unavailable` bila
 * service worker tidak ada (mis. dev) atau push tidak tersedia di server. Melempar bila peramban/server menolak.
 */
export function syncThisDevice(
  config: PushConfigDto,
  owner: string,
): Promise<'subscribed' | 'unavailable'> {
  // Satu alur pada satu waktu: dialog pengaturan dan onboarding dapat memicunya bersamaan (mis. fokus kembali setelah
  // dialog izin peramban), dan dua `subscribe`/`unsubscribe` paralel hanya membuang permintaan.
  // Per pemilik (email): alur milik akun lain tidak boleh dipakai bersama, karena permintaan `push.subscribe` memakai
  // sesi akun yang memulainya.
  if (inflight !== null && inflight.owner === owner) return inflight.promise;
  const promise = run(config).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { owner, promise };
  return promise;
}

let inflight: { owner: string; promise: Promise<'subscribed' | 'unavailable'> } | null = null;

async function run(config: PushConfigDto): Promise<'subscribed' | 'unavailable'> {
  const registration = await getPushRegistration();
  if (registration === undefined) return 'unavailable';
  return subscribeThisDevice({
    registration,
    config,
    send: (input) => api('push.subscribe', input),
    unsubscribeServer: (input) => api('push.unsubscribe', input),
  });
}
