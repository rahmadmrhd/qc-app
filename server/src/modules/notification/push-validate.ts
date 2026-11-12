import { readObject } from '@server/core/validate';
import type {
  PushPermissionInput,
  PushPermissionState,
  PushPreferenceInput,
  PushSubscribeInput,
  PushUnsubscribeInput,
} from '@shared/contract';
import { base64UrlDecode } from './web-push';

/** Batas panjang masukan klien (endpoint berasal dari klien, jadi dibatasi dan divalidasi ketat). */
export const PUSH_LIMITS = {
  endpoint: 2000,
  p256dh: 128,
  auth: 64,
  /** Langganan per pengguna; yang paling lama diganti bila terlampaui. */
  perUser: 20,
} as const;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.localdomain', '.home.arpa'];

/**
 * Endpoint langganan harus layanan push publik: `https:` tanpa userinfo, port bawaan (443), nama host (bukan
 * literal IP, bukan `localhost` atau nama lokal/internal, bukan satu label). Pengirim tidak mengikuti pengalihan
 * dan berbatas waktu. Pemeriksaan ini TIDAK menyelesaikan DNS: host publik yang diarahkan ke alamat privat
 * (DNS rebinding) tidak terdeteksi di sini; risikonya dibatasi karena hanya POST berisi muatan terenkripsi tanpa
 * membaca respons, dan hanya pengguna ber-sesi yang dapat mendaftarkan endpoint.
 * Mengembalikan pesan galat, atau null bila layak.
 */
export function pushEndpointError(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'Endpoint bukan URL yang sah';
  }
  if (url.protocol !== 'https:') return 'Endpoint harus memakai https';
  if (url.username !== '' || url.password !== '') return 'Endpoint tidak boleh memuat kredensial';
  if (url.port !== '' && url.port !== '443') return 'Endpoint harus memakai port 443';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host.startsWith('[') || host.includes(':')) {
    return 'Endpoint tidak boleh berupa alamat IP';
  }
  if (!host.includes('.')) return 'Endpoint harus berupa nama host publik';
  const labels = host.split('.');
  // Literal IPv4 (URL menormalkan bentuk heksa/oktal ke titik-angka) atau TLD numerik.
  if (/^\d+$/.test(labels[labels.length - 1] as string)) {
    return 'Endpoint tidak boleh berupa alamat IP';
  }
  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return 'Endpoint harus berupa nama host publik';
  }
  return null;
}

function keyError(value: string, length: number, firstByte?: number): string | null {
  if (!BASE64URL.test(value)) return 'Harus base64url';
  try {
    const bytes = base64UrlDecode(value);
    if (bytes.length !== length) return 'Panjang kunci tidak sesuai';
    if (firstByte !== undefined && bytes[0] !== firstByte) return 'Format kunci tidak sesuai';
  } catch {
    return 'Harus base64url';
  }
  return null;
}

export function validatePushSubscribe(raw: unknown): PushSubscribeInput {
  const reader = readObject(raw);
  const endpoint = reader.str('endpoint', { required: true, max: PUSH_LIMITS.endpoint });
  const p256dh = reader.str('p256dh', { required: true, max: PUSH_LIMITS.p256dh });
  const auth = reader.str('auth', { required: true, max: PUSH_LIMITS.auth });
  reader.done();
  const endpointError = pushEndpointError(endpoint);
  if (endpointError !== null) reader.fail('endpoint', endpointError);
  const p256dhError = keyError(p256dh, 65, 4);
  if (p256dhError !== null) reader.fail('p256dh', p256dhError);
  const authError = keyError(auth, 16);
  if (authError !== null) reader.fail('auth', authError);
  reader.done();
  return { endpoint, p256dh, auth };
}

export function validatePushUnsubscribe(raw: unknown): PushUnsubscribeInput {
  const reader = readObject(raw);
  const endpoint = reader.str('endpoint', { required: true, max: PUSH_LIMITS.endpoint });
  reader.done();
  return { endpoint };
}

export function validatePushPreference(raw: unknown): PushPreferenceInput {
  const reader = readObject(raw);
  const enabled = reader.raw('enabled');
  if (typeof enabled !== 'boolean') reader.fail('enabled', 'Harus benar atau salah');
  reader.done();
  return { enabled: enabled as boolean };
}

export function validatePushPermission(raw: unknown): PushPermissionInput {
  const reader = readObject(raw);
  const state: PushPermissionState = reader.oneOf('state', ['granted', 'denied', 'default']);
  reader.done();
  return { state };
}
