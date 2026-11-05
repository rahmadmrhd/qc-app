import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { constantTimeEqual, SYNC_LIMITS, SYNC_TOKEN_MIN_LENGTH } from '@shared/sync';

const BLOCK_KEY = 'sync:blocked';
const FAIL_KEY = 'sync:fails';

/** True bila pembatas sedang memblokir (10 salah dalam 10 menit memblokir 10 menit). */
async function isBlocked(env: Env, now: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT window_start FROM rate_limits WHERE key = ?')
    .bind(BLOCK_KEY)
    .first<{ window_start: number }>();
  return row !== null && now - row.window_start < SYNC_LIMITS.blockSeconds * 1000;
}

/**
 * Mencatat satu kegagalan (best-effort; kegagalan mencatat tidak mengubah balasan agar penyerang tidak
 * mendapat sinyal tambahan). Jendela tetap: hitungan dimulai ulang bila jendela sebelumnya sudah lewat.
 */
async function recordFailure(env: Env, now: number): Promise<void> {
  try {
    const windowMs = SYNC_LIMITS.blockSeconds * 1000;
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
       RETURNING count`,
    )
      .bind(FAIL_KEY, now, windowMs)
      .first<{ count: number }>();
    if (row !== null && row.count >= SYNC_LIMITS.failedAttempts) {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2) ON CONFLICT (key) DO UPDATE SET count = 1, window_start = ?2',
        ).bind(BLOCK_KEY, now),
        env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(FAIL_KEY),
      ]);
    }
  } catch (error) {
    console.error(`pembatas sync gagal mencatat: ${String(error)}`);
  }
}

/** True bila token sah dan tidak sedang diblokir. Setiap kegagalan dihitung (token belum diset ikut dihitung). */
export async function authenticateSync(env: Env, token: unknown): Promise<boolean> {
  const now = nowOf(env);
  if (await isBlocked(env, now)) return false;
  const expected = env.SYNC_API_TOKEN?.trim() ?? '';
  const valid =
    expected.length >= SYNC_TOKEN_MIN_LENGTH &&
    typeof token === 'string' &&
    constantTimeEqual(token, expected);
  if (valid) return true;
  await recordFailure(env, now);
  return false;
}
