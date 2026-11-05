import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { constantTimeEqual, SYNC_LIMITS, SYNC_TOKEN_MIN_LENGTH } from '@shared/sync';

/** Kunci pembatas per IP klien: `sync:blocked:<ip>` dan `sync:fails:<ip>` (kolom `key` VARCHAR(255); IP <= 45). */
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
 * Mencatat satu kegagalan (best-effort; kegagalan mencatat tidak mengubah balasan agar penyerang tidak
 * mendapat sinyal tambahan). Jendela tetap: hitungan dimulai ulang bila jendela sebelumnya sudah lewat.
 */
async function recordFailure(env: Env, now: number, ip: string): Promise<void> {
  const failKey = FAIL_PREFIX + ip;
  const blockKey = BLOCK_PREFIX + ip;
  try {
    const windowMs = SYNC_LIMITS.blockSeconds * 1000;
    // Naikkan hitungan dan baca nilainya dalam transaksi yang sama (kunci baris dari INSERT ... ON DUPLICATE KEY
    // UPDATE ditahan sampai COMMIT, jadi SELECT membaca hitungan milik penulis ini). Jendela tetap: hitungan
    // dimulai ulang bila jendela sebelumnya sudah lewat; di UPDATE, `count` dievaluasi sebelum `window_start`.
    const [, read] = await env.DB.batch<{ count: number }>([
      env.DB.prepare(
        `INSERT INTO rate_limits (\`key\`, count, window_start) VALUES (?, 1, ?)
       ON DUPLICATE KEY UPDATE
         count = CASE WHEN ? - window_start >= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END`,
      ).bind(failKey, now, now, windowMs, now, windowMs, now),
      env.DB.prepare('SELECT count FROM rate_limits WHERE `key` = ?').bind(failKey),
    ]);
    const row = read?.results[0] ?? null;
    if (row !== null && Number(row.count) >= SYNC_LIMITS.failedAttempts) {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = 1, window_start = ?',
        ).bind(blockKey, now, now),
        env.DB.prepare('DELETE FROM rate_limits WHERE `key` = ?').bind(failKey),
      ]);
    }
  } catch (error) {
    console.error(`pembatas sync gagal mencatat: ${String(error)}`);
  }
}

/**
 * True bila token sah dan IP klien tidak sedang diblokir. Setiap kegagalan dihitung per IP (token belum diset ikut
 * dihitung): 10 salah dalam 10 menit memblokir IP itu 10 menit; IP lain tidak terpengaruh.
 */
export async function authenticateSync(
  env: Env,
  token: unknown,
  ip: string = UNKNOWN_CLIENT_IP,
): Promise<boolean> {
  const now = nowOf(env);
  if (await isBlocked(env, now, ip)) return false;
  const expected = env.SYNC_API_TOKEN?.trim() ?? '';
  const valid =
    expected.length >= SYNC_TOKEN_MIN_LENGTH &&
    typeof token === 'string' &&
    constantTimeEqual(token, expected);
  if (valid) return true;
  await recordFailure(env, now, ip);
  return false;
}
