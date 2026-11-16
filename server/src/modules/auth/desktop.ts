import { encodeBytes } from '@server/core/base64url';
import { DbError } from '@server/core/db';
import { type Env, nowOf } from '@server/core/env';
import { signValue, verifyValue } from '@server/core/session';
import { loadUserContext } from '@server/modules/access/context';

/**
 * Login aplikasi desktop (PKCE S256 + kode sekali pakai). Alur: desktop membuka peramban sistem di
 * `/auth/desktop/start` (cookie `qc_desktop` mengikat `challenge`+`state`), login Google berjalan seperti web,
 * lalu callback mengarahkan ke `http://127.0.0.1:<port>/callback?code&state` (loopback; `port` dari aplikasi, diikat
 * di cookie bertanda tangan) atau, tanpa `port`, ke `qc://auth?code&state` (BUKAN cookie sesi web). Desktop menukar kode dan `verifier`
 * di `POST /auth/desktop/token` dengan token Bearer.
 */

/** Cookie awal login desktop berlaku 10 menit (sama dengan cookie state OAuth). */
export const DESKTOP_START_TTL_MS = 10 * 60 * 1000;
/** Kode login desktop berlaku 2 menit. */
export const DESKTOP_CODE_TTL_MS = 2 * 60 * 1000;
/** Pesan seragam semua penolakan penukaran kode; penyebab sebenarnya hanya di log server. */
export const DESKTOP_CODE_INVALID_MESSAGE = 'Kode tidak valid atau kedaluwarsa';

/** Hash SHA-256 base64url: tepat 43 karakter. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
/** RFC 7636 `code_verifier`. */
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
/** Kode = base64url(JSON) + "." + HMAC; jauh di bawah ini. */
export const DESKTOP_CODE_MAX_LENGTH = 1024;

export const isDesktopChallenge = (value: unknown): value is string =>
  typeof value === 'string' && CHALLENGE_PATTERN.test(value);
export const isDesktopState = (value: unknown): value is string =>
  typeof value === 'string' && STATE_PATTERN.test(value);
export const isDesktopVerifier = (value: unknown): value is string =>
  typeof value === 'string' && VERIFIER_PATTERN.test(value);

/** Port loopback aplikasi desktop: bilangan bulat desimal 1024-65535 (tanpa nol di depan, tanda, atau spasi). */
const PORT_PATTERN = /^[1-9][0-9]{3,4}$/;
export const isDesktopPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
/** Port dari query string: tepat satu nilai berformat sah, selain itu `null`. */
export function parseDesktopPort(values: readonly string[] | undefined): number | null {
  if (values?.length !== 1) return null;
  const [raw] = values;
  if (raw === undefined || !PORT_PATTERN.test(raw)) return null;
  const port = Number(raw);
  return isDesktopPort(port) ? port : null;
}

export interface DesktopStart {
  challenge: string;
  state: string;
  /**
   * Port loopback `127.0.0.1` yang dibuka aplikasi desktop untuk menerima kode (RFC 8252 §7.3). Tanpa port =
   * kode dikirim ke `qc://auth` (aplikasi terkemas dengan skema terdaftar). Nilainya hanya dari cookie bertanda
   * tangan ini, tak pernah dari parameter callback.
   */
  port?: number;
}

/** Perbandingan waktu-konstan untuk string; panjang berbeda langsung tidak sama (panjangnya bukan rahasia). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Nilai cookie `qc_desktop`: mengikat `challenge` dan `state` ke peramban yang memulai login. */
export async function signDesktopStart(env: Env, start: DesktopStart): Promise<string> {
  return signValue(env, {
    typ: 'dstart',
    challenge: start.challenge,
    state: start.state,
    ...(start.port === undefined ? {} : { port: start.port }),
    exp: nowOf(env) + DESKTOP_START_TTL_MS,
  });
}

/** Isi cookie `qc_desktop` yang sah dan belum kedaluwarsa; `null` bila tidak ada/rusak/kedaluwarsa. */
export async function readDesktopStart(
  env: Env,
  cookieValue: string | undefined,
): Promise<DesktopStart | null> {
  if (!cookieValue) return null;
  const payload = (await verifyValue(env, cookieValue)) as Record<string, unknown> | null;
  if (payload?.typ !== 'dstart') return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowOf(env)) return null;
  if (!isDesktopChallenge(payload.challenge) || !isDesktopState(payload.state)) return null;
  // Port ada tetapi tak sah (cookie dari sumber lain/rusak) = seluruh cookie ditolak, bukan jatuh ke `qc://`.
  if (payload.port !== undefined && !isDesktopPort(payload.port)) return null;
  return {
    challenge: payload.challenge,
    state: payload.state,
    ...(payload.port === undefined ? {} : { port: payload.port }),
  };
}

/** Kode login sekali pakai, terikat ke `challenge` PKCE dan email yang sudah login. */
export async function issueDesktopCode(
  env: Env,
  email: string,
  challenge: string,
): Promise<string> {
  const nonce = encodeBytes(crypto.getRandomValues(new Uint8Array(16)));
  return signValue(env, {
    typ: 'dcode',
    email,
    challenge,
    nonce,
    exp: nowOf(env) + DESKTOP_CODE_TTL_MS,
  });
}

/**
 * Menukar kode: tanda tangan dan masa berlaku, `S256(verifier) = challenge`, akun masih aktif, lalu penanda
 * `rate_limits` (`dcode:<sha256 kode>`) lewat `INSERT` yang gagal duplikat bila kode sudah dipakai. `verifier`
 * salah/akun nonaktif TIDAK menghabiskan kode (penanda ditulis paling akhir). Penanda memakai `window_start = now`,
 * jadi `purgeExpiredRateLimits` membuangnya 10 menit kemudian, jauh setelah kode kedaluwarsa (2 menit).
 * `null` untuk semua penolakan; alasannya hanya di log server (tanpa kode/verifier/token).
 */
export async function consumeDesktopCode(
  env: Env,
  code: string,
  verifier: string,
  now: number,
): Promise<{ email: string } | null> {
  const reject = (reason: string): null => {
    console.warn(`Penukaran kode login desktop ditolak: ${reason}`);
    return null;
  };
  const payload = (await verifyValue(env, code)) as Record<string, unknown> | null;
  if (payload?.typ !== 'dcode') return reject('kode tidak sah');
  if (typeof payload.exp !== 'number' || payload.exp <= now) return reject('kode kedaluwarsa');
  const { email, challenge } = payload;
  if (typeof email !== 'string' || email === '' || !isDesktopChallenge(challenge)) {
    return reject('isi kode tidak lengkap');
  }
  if (!isDesktopVerifier(verifier)) return reject('verifier tidak berformat sah');
  if (!safeEqual(encodeBytes(await sha256(verifier)), challenge)) return reject('verifier salah');
  if (!(await loadUserContext(env, email))) return reject('akun tidak aktif');

  const marker = `dcode:${toHex(await sha256(code))}`;
  try {
    await env.DB.prepare('INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?)')
      .bind(marker, now)
      .run();
  } catch (error) {
    if (error instanceof DbError && error.kind === 'duplicate') return reject('kode sudah dipakai');
    throw error;
  }
  return { email };
}
