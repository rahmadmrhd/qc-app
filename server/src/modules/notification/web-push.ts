import { decodeBytes, encodeBytes } from '@server/core/base64url';
import type { PushSender } from './push';
import { pushEndpointError } from './push-endpoint';

/**
 * Pengirim Web Push nyata (RFC 8030 pengiriman, RFC 8291 enkripsi `aes128gcm`, RFC 8292 VAPID) memakai WebCrypto
 * dan `fetch` bawaan Bun, TANPA dependensi baru.
 *
 * Pilihan [perancang, 2026-11-12]: pustaka `web-push` tidak dipakai. Alasan: (1) enkripsi + VAPID hanya sekitar 100
 * baris di atas WebCrypto dan dapat diuji penuh dengan mendekripsi muatan di tes (`web-push.test.ts`); (2) tanpa
 * dependensi tambahan berarti tak ada perubahan `bun.lock`/`package.json` bersama sesi lain; (3) pengiriman memakai
 * `fetch` yang dapat disuntik, sehingga tes tak memerlukan server TLS palsu (`web-push` memaksa `https.request`)
 * dan kita mengendalikan `redirect: 'manual'`, batas waktu, serta apa yang dicatat. Spike `web-push` di bawah Bun
 * tidak dijalankan.
 *
 * Keamanan: kunci privat VAPID hanya hidup di closure ini dan tidak pernah masuk log atau galat; kegagalan
 * dikembalikan sebagai teks pendek generik (`timeout`, `jaringan`, `http <status>`), tanpa endpoint/isi respons.
 */

export interface WebPushConfig {
  /** Kunci publik VAPID: titik P-256 tak terkompresi (65 byte), base64url. */
  publicKey: string;
  /** Kunci privat VAPID: skalar P-256 (32 byte), base64url. */
  privateKey: string;
  /** `mailto:` atau URL `https:` kontak operator (klaim `sub`). */
  subject: string;
}

export interface WebPushDeps {
  fetch?: typeof fetch;
  /** Jam (milidetik epoch) untuk klaim `exp` VAPID. */
  now?: () => number;
}

/** Batas waktu satu pengiriman (milidetik). */
export const PUSH_SEND_TIMEOUT_MS = 10_000;
/** Umur pesan di layanan push bila perangkat luring (detik). */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** Umur token VAPID (detik; batas RFC 8292: 24 jam). */
const VAPID_TOKEN_SECONDS = 12 * 60 * 60;
/** Ukuran rekaman enkripsi (RFC 8188); muatan notifikasi jauh lebih kecil. */
const RECORD_SIZE = 4096;
/** Batas muatan agar satu rekaman cukup (RFC 8291: 4096 - 86 byte). */
export const PUSH_PAYLOAD_MAX_BYTES = 3993;

const encoder = new TextEncoder();

/**
 * Base64url kunci/token kecil (kunci VAPID, kunci langganan, JWT) lewat `core/base64url.ts`, satu-satunya tempat
 * yang boleh memakai atob/btoa di server (pagar di `files.test.ts`). Melempar bila bukan base64url yang sah.
 */
export function base64UrlDecode(text: string): Uint8Array {
  const bytes = decodeBytes(text);
  if (bytes === null) throw new Error('base64url tidak sah');
  return bytes;
}

export const base64UrlEncode = encodeBytes;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Salinan ke `ArrayBuffer` murni (tipe BufferSource WebCrypto tidak menerima `SharedArrayBuffer`). */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Mengenkripsi muatan untuk satu langganan (RFC 8291, `aes128gcm`, satu rekaman). Mengembalikan badan permintaan
 * lengkap: `salt(16) || rs(4) || idlen(1) || kunci publik pengirim(65) || ciphertext`.
 */
export async function encryptPayload(
  sub: { p256dh: string; auth: string },
  payload: Uint8Array,
  random: { salt?: Uint8Array } = {},
): Promise<Uint8Array> {
  if (payload.length > PUSH_PAYLOAD_MAX_BYTES) throw new Error('muatan terlalu besar');
  const uaPublic = base64UrlDecode(sub.p256dh);
  const authSecret = base64UrlDecode(sub.auth);
  const uaKey = await crypto.subtle.importKey(
    'raw',
    buf(uaPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256),
  );
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const salt = random.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  // Penanda akhir rekaman 0x02 (tanpa padding).
  const plain = concat(payload, Uint8Array.of(2));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(plain)),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

async function importVapidKey(config: WebPushConfig): Promise<CryptoKey> {
  const publicBytes = base64UrlDecode(config.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4)
    throw new Error('VAPID_PUBLIC_KEY tidak valid');
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: config.privateKey,
      x: base64UrlEncode(publicBytes.slice(1, 33)),
      y: base64UrlEncode(publicBytes.slice(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** Kunci VAPID valid bila publik 65 byte (awalan 0x04) dan privat 32 byte; dipakai `loadConfig` tanpa menggagalkan start. */
export function isValidVapidKeys(publicKey: string, privateKey: string): boolean {
  try {
    const pub = base64UrlDecode(publicKey);
    const priv = base64UrlDecode(privateKey);
    return pub.length === 65 && pub[0] === 4 && priv.length === 32;
  } catch {
    return false;
  }
}

async function vapidAuthorization(
  key: CryptoKey,
  config: WebPushConfig,
  endpoint: string,
  nowMs: number,
): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(nowMs / 1000) + VAPID_TOKEN_SECONDS,
        sub: config.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto menghasilkan tanda tangan ECDSA format IEEE P1363 (r||s, 64 byte) = format JWS ES256.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      buf(encoder.encode(signingInput)),
    ),
  );
  return `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${config.publicKey}`;
}

export function createWebPushSender(config: WebPushConfig, deps: WebPushDeps = {}): PushSender {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let keyPromise: Promise<CryptoKey> | undefined;
  return {
    async send(sub, payload) {
      // Lapisan kedua (selain validasi saat berlangganan): baris tersimpan yang tak lagi lolos kebijakan endpoint
      // (mis. allowlist menyempit) tidak pernah dihubungi. Bukan `gone`: dipangkas lewat jalur kegagalan berturut-turut.
      if (pushEndpointError(sub.endpoint) !== null) {
        return { ok: false, gone: false, error: 'endpoint ditolak', prunable: true };
      }
      let request: { authorization: string; body: Uint8Array };
      try {
        // Kunci diimpor dan ditunggu LANGSUNG (tanpa janji menggantung yang bisa menjadi unhandled rejection);
        // kegagalan tidak di-cache.
        keyPromise ??= importVapidKey(config);
        let key: CryptoKey;
        try {
          key = await keyPromise;
        } catch (error) {
          keyPromise = undefined;
          throw error;
        }
        const body = await encryptPayload(sub, encoder.encode(payload));
        const authorization = await vapidAuthorization(key, config, sub.endpoint, now());
        request = { authorization, body };
      } catch {
        // Kunci VAPID atau langganan rusak: teks generik (tanpa kunci atau isi galat).
        return { ok: false, gone: false, error: 'internal', prunable: false };
      }
      try {
        const response = await doFetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: request.authorization,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(PUSH_TTL_SECONDS),
            Urgency: 'normal',
          },
          body: buf(request.body),
          // Endpoint berasal dari klien: tidak pernah mengikuti pengalihan (SSRF) dan selalu berbatas waktu.
          redirect: 'manual',
          signal: AbortSignal.timeout(PUSH_SEND_TIMEOUT_MS),
        });
        // Badan respons tidak dibaca dan tidak dicatat.
        void response.body?.cancel().catch(() => undefined);
        if (response.status >= 200 && response.status < 300) return { ok: true };
        // 404/410: langganan sudah tidak ada di layanan push (RFC 8030 §7.3).
        return {
          ok: false,
          gone: response.status === 404 || response.status === 410,
          error: `http ${response.status}`,
          // Jawaban layanan push sendiri: dapat dihitung menuju pemangkasan.
          prunable: true,
        };
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        return {
          ok: false,
          gone: false,
          error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'jaringan',
          // Tak ada jawaban dari layanan push (egress kita atau layanannya mati): tidak boleh menghapus langganan.
          prunable: false,
        };
      }
    },
  };
}
