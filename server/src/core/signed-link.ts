/**
 * Penanda tautan bertanda tangan generik untuk halaman publik tanpa sesi (laporan rusak Serial Number, tautan
 * dashboard). Token tanpa keadaan di basis data: `v1.<id>.<expSeconds>.<base64url(sig)>`,
 * `sig = HMAC-SHA256(derivedKey, "v1.<id>.<expSeconds>")` dan `derivedKey = HMAC-SHA256(secret, label)`.
 * Kunci turunan berlabel per jenis tautan: token satu jenis tidak sah sebagai token jenis lain, dan tidak dapat
 * dipakai (atau dipalsukan) sebagai sesi. Semua kegagalan verifikasi menghasilkan `null` tanpa membedakan sebab.
 */
import { decodeBytes, encodeBytes } from './base64url';

const VERSION = 'v1';
const TOKEN_MAX_LENGTH = 300;
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const EXP_PATTERN = /^\d{1,12}$/;
const SIG_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const encoder = new TextEncoder();

export interface LinkSigner {
  /** Membuat token untuk `id` yang berlaku sampai `expiresAtMs` (disimpan dalam detik penuh, dibulatkan ke bawah). */
  sign(secret: string, id: string, expiresAtMs: number): Promise<string>;
  /** `{ id }` bila token sah dan belum kedaluwarsa pada `nowMs`; selain itu `null`. */
  verify(secret: string, token: string, nowMs: number): Promise<{ id: string } | null>;
}

async function hmacKey(
  raw: ArrayBuffer | Uint8Array,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function derivedKey(
  label: string,
  secret: string,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  const base = await hmacKey(encoder.encode(secret), 'sign');
  const derived = await crypto.subtle.sign('HMAC', base, encoder.encode(label));
  return hmacKey(derived, usage);
}

/** Penanda untuk satu jenis tautan; `label` menurunkan kunci tanda tangan dari rahasia sesi. */
export function createLinkSigner(label: string): LinkSigner {
  return {
    async sign(secret, id, expiresAtMs) {
      const expSeconds = Math.floor(expiresAtMs / 1000);
      const payload = `${VERSION}.${id}.${expSeconds}`;
      const key = await derivedKey(label, secret, 'sign');
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
      return `${payload}.${encodeBytes(new Uint8Array(sig))}`;
    },
    async verify(secret, token, nowMs) {
      if (secret === '' || token.length > TOKEN_MAX_LENGTH) return null;
      const parts = token.split('.');
      if (parts.length !== 4) return null;
      const [version, id, exp, sig] = parts as [string, string, string, string];
      if (version !== VERSION) return null;
      if (!ID_PATTERN.test(id) || !EXP_PATTERN.test(exp) || !SIG_PATTERN.test(sig)) return null;
      const sigBytes = decodeBytes(sig);
      // Hanya bentuk kanonis: karakter terakhir base64url membawa bit sisa (padding) yang diabaikan decoder, jadi
      // tanpa pemeriksaan ini beberapa tanda tangan berbeda terbaca sebagai byte yang sama (token "cacat" tetap sah).
      if (!sigBytes || encodeBytes(sigBytes) !== sig) return null;
      const key = await derivedKey(label, secret, 'verify');
      // `crypto.subtle.verify` membandingkan tanda tangan dalam waktu tetap.
      const valid = await crypto.subtle.verify(
        'HMAC',
        key,
        sigBytes,
        encoder.encode(`${version}.${id}.${exp}`),
      );
      if (!valid) return null;
      // Token membawa detik penuh (dibulatkan ke bawah): sah sampai akhir detik itu (:59.999), 1 ms sesudahnya tidak.
      if (nowMs > Number(exp) * 1000 + 999) return null;
      return { id };
    },
  };
}
