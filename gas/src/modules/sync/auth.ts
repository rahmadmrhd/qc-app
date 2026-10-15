import { syncToken_ } from '@gas/core/config';
import { platform_ } from '@gas/core/platform';
import { constantTimeEqual, SYNC_LIMITS, SYNC_TOKEN_MIN_LENGTH } from '@shared/sync';

const SYNC_BLOCK_KEY = 'sync:blocked';
const SYNC_FAIL_KEY = 'sync:fails';

/**
 * Mencatat satu kegagalan. Pembatas bersifat best-effort (cache GAS bisa dibuang sewaktu-waktu); kegagalan
 * mencatat tidak boleh mengubah balasan agar penyerang tidak mendapat sinyal tambahan.
 */
function recordSyncFailure_(): void {
  const platform = platform_();
  try {
    platform.withLock(() => {
      const count = (Number(platform.cacheGet(SYNC_FAIL_KEY)) || 0) + 1;
      if (count >= SYNC_LIMITS.failedAttempts) {
        platform.cachePut(SYNC_BLOCK_KEY, '1', SYNC_LIMITS.blockSeconds);
        platform.cacheRemove(SYNC_FAIL_KEY);
      } else {
        platform.cachePut(SYNC_FAIL_KEY, String(count), SYNC_LIMITS.blockSeconds);
      }
    });
  } catch {
    // diabaikan: lihat komentar fungsi
  }
}

/** True bila token sah dan tidak sedang diblokir. Setiap kegagalan dihitung (token belum diset ikut dihitung). */
export function authenticateSync_(token: unknown): boolean {
  const platform = platform_();
  if (platform.cacheGet(SYNC_BLOCK_KEY) !== null) return false;
  const expected = syncToken_();
  const valid =
    expected.length >= SYNC_TOKEN_MIN_LENGTH &&
    typeof token === 'string' &&
    constantTimeEqual(token, expected);
  if (valid) return true;
  recordSyncFailure_();
  return false;
}
