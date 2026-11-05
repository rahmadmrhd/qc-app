import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { limiterAddress } from '@server/http/proxy';
import { constantTimeEqual, SYNC_LIMITS, SYNC_TOKEN_MIN_LENGTH } from '@shared/sync';

/** Kunci pembatas per klien: `sync:blocked:<id>` dan `sync:fails:<id>` (kolom `key` VARCHAR(255); id = IPv4 atau /64 IPv6, <= 45). */
const BLOCK_PREFIX = 'sync:blocked:';
const FAIL_PREFIX = 'sync:fails:';

/** Pemanggil tanpa IP (tes, atau peer tak dikenal) berbagi satu penghitung. */
export const UNKNOWN_CLIENT_IP = 'unknown';

/** True bila pembatas sedang memblokir (10 salah dalam 10 menit memblokir 10 menit). */
async function isBlocked(env: Env, now: number, ip: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT window_start FROM rate_limits WHERE `key` = ?')
    .bind(BLOCK_PREFIX + ip)
    .first<{ window_start: number }>();
  return row !== null && now - Number(row.window_start) < SYNC_LIMITS.blockSeconds * 1000;
}

/**
 * Memesan satu jatah percobaan SEBELUM token dibandingkan (atomik: satu `INSERT ... ON DUPLICATE KEY UPDATE` + baca
 * hitungan dalam satu transaksi). Jendela tetap: hitungan dimulai ulang bila jendela sebelumnya sudah lewat. Dengan
 * pemesanan di muka, tebakan serentak tidak lagi lolos bersamaan: paling banyak `failedAttempts` pemesanan yang
 * dibandingkan, sisanya ditolak tanpa perbandingan. Mengembalikan hitungan sesudah pemesanan, atau `null` bila pencatatan
 * gagal (best-effort: kegagalan mencatat tidak mengubah balasan dan tidak membuka bypass karena token tetap dibandingkan).
 */
async function reserveAttempt(env: Env, now: number, ip: string): Promise<number | null> {
  try {
    const windowMs = SYNC_LIMITS.blockSeconds * 1000;
    const [, read] = await env.DB.batch<{ count: number }>([
      env.DB.prepare(
        `INSERT INTO rate_limits (\`key\`, count, window_start) VALUES (?, 1, ?)
       ON DUPLICATE KEY UPDATE
         count = CASE WHEN ? - window_start >= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END`,
      ).bind(FAIL_PREFIX + ip, now, now, windowMs, now, windowMs, now),
      env.DB.prepare('SELECT count FROM rate_limits WHERE `key` = ?').bind(FAIL_PREFIX + ip),
    ]);
    const row = read?.results[0] ?? null;
    return row === null ? null : Number(row.count);
  } catch (error) {
    console.error(`pembatas sync gagal mencatat: ${String(error)}`);
    return null;
  }
}

/**
 * Mengembalikan satu jatah (percobaan sukses, atau ditolak sebelum dibandingkan): hitungan turun satu dan baris dibuang
 * bila habis. Hanya kegagalan yang tetap tercatat, jadi IP yang benar tidak dihukum oleh pemesanannya sendiri.
 */
async function releaseAttempt(env: Env, ip: string): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE rate_limits SET count = GREATEST(count - 1, 0) WHERE `key` = ?').bind(
        FAIL_PREFIX + ip,
      ),
      env.DB.prepare('DELETE FROM rate_limits WHERE `key` = ? AND count <= 0').bind(
        FAIL_PREFIX + ip,
      ),
    ]);
  } catch (error) {
    console.error(`pembatas sync gagal melepas jatah: ${String(error)}`);
  }
}

/** Kegagalan ke-`failedAttempts` dalam jendela memblokir IP (blokir ditulis, penghitung dibuang). */
async function blockClient(env: Env, now: number, ip: string): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = 1, window_start = ?',
      ).bind(BLOCK_PREFIX + ip, now, now),
      env.DB.prepare('DELETE FROM rate_limits WHERE `key` = ?').bind(FAIL_PREFIX + ip),
    ]);
  } catch (error) {
    console.error(`pembatas sync gagal memblokir: ${String(error)}`);
  }
}

/**
 * True bila token sah dan IP klien tidak sedang diblokir. Jatah dipesan SEBELUM perbandingan: pemesanan di atas
 * `failedAttempts` (tebakan serentak) ditolak tanpa dibandingkan dan jatahnya dikembalikan; yang dibandingkan lalu gagal
 * tetap tercatat (token belum diset ikut dihitung) dan kegagalan ke-10 memblokir IP itu 10 menit; yang sukses
 * mengembalikan jatahnya. IP lain tidak terpengaruh.
 */
export async function authenticateSync(
  env: Env,
  token: unknown,
  ip: string = UNKNOWN_CLIENT_IP,
): Promise<boolean> {
  const now = nowOf(env);
  ip = limiterAddress(ip); // IPv6 per /64, IPv4 per alamat
  if (await isBlocked(env, now, ip)) return false;
  const reserved = await reserveAttempt(env, now, ip);
  if (reserved !== null && reserved > SYNC_LIMITS.failedAttempts) {
    await releaseAttempt(env, ip);
    return false;
  }
  const expected = env.SYNC_API_TOKEN?.trim() ?? '';
  const valid =
    expected.length >= SYNC_TOKEN_MIN_LENGTH &&
    typeof token === 'string' &&
    constantTimeEqual(token, expected);
  if (valid) {
    if (reserved !== null) await releaseAttempt(env, ip);
    return true;
  }
  if (reserved !== null && reserved >= SYNC_LIMITS.failedAttempts) await blockClient(env, now, ip);
  return false;
}
