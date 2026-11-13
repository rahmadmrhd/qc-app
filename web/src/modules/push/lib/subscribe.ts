import type { PushConfigDto, PushSubscribeInput, PushUnsubscribeInput } from '@shared/contract';

/** Menunggu service worker aktif selama ini; lewat itu dianggap tak ada (mis. dev: service worker dimatikan). */
export const REGISTRATION_TIMEOUT_MS = 5000;

/** Kunci VAPID (teks URL-safe tanpa padding) menjadi byte untuk `applicationServerKey`. */
export function urlBase64ToBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (a === null || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((value, index) => value === b[index]);
}

/** Registrasi service worker yang aktif, atau `undefined` bila tidak ada dalam `timeoutMs`. */
export async function getPushRegistration(
  win: Window = window,
  timeoutMs: number = REGISTRATION_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in win.navigator)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    return await Promise.race([win.navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface SubscribeDeps {
  registration: Pick<ServiceWorkerRegistration, 'pushManager'>;
  config: PushConfigDto;
  send: (input: PushSubscribeInput) => Promise<unknown>;
  unsubscribeServer: (input: PushUnsubscribeInput) => Promise<unknown>;
}

/**
 * Menautkan perangkat ini ke akun yang sedang masuk. Idempoten: langganan yang sudah ada (kunci server sama) dipakai
 * ulang dan tetap dikirim ke server, sehingga akun kedua di perangkat yang sama ikut tertaut (spek §5.2). Bila kunci
 * VAPID server berubah, langganan lama dilepas (di peramban dan di server) lalu dibuat ulang dengan kunci baru.
 * Melempar bila peramban menolak berlangganan (mis. izin dicabut, layanan push tak terjangkau): pemanggil menangani.
 */
export async function subscribeThisDevice(
  deps: SubscribeDeps,
): Promise<'subscribed' | 'unavailable'> {
  const { registration, config } = deps;
  if (!config.enabled || config.publicKey === '') return 'unavailable';
  const key = urlBase64ToBytes(config.publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription !== null && !sameBytes(subscription.options.applicationServerKey, key)) {
    await deps.unsubscribeServer({ endpoint: subscription.endpoint });
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return 'unavailable';
  await deps.send({ endpoint: json.endpoint, p256dh, auth });
  return 'subscribed';
}
