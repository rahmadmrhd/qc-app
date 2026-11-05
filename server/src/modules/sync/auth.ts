import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { limiterAddress } from '@server/http/proxy';
import { constantTimeEqual, SYNC_LIMITS, SYNC_TOKEN_MIN_LENGTH } from '@shared/sync';

/** Kunci pembatas per klien: `sync:blocked:<id>` dan `sync:fails:<id>` (kolom `key` VARCHAR(255); id = IPv4 atau /64 IPv6, <= 45). */
const BLOCK_PREFIX = 'sync:blocked:';
const FAIL_PREFIX = 'sync:fails:';

/** Pemanggil tanpa IP (tes, atau peer tak dikenal) berbagi satu penghitung. */
export const UNKNOWN_CLIENT_IP = 'unknown';

/** True bila baris blokir ada dan masih berlaku pada `now`. */
function blockActive(row: { window_start: number } | null, now: number): boolean {
  return row !== null && now - Number(row.window_start) < SYNC_LIMITS.blockSeconds * 1000;
}

/** Pra-pemeriksaan tanpa penulisan: IP yang sedang diblokir ditolak tanpa menyentuh penghitung. */
async function isBlocked(env: Env, now: number, ip: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT window_start FROM rate_limits WHERE `key` = ?')
    .bind(BLOCK_PREFIX + ip)
    .first<{ window_start: number }>();
  return blockActive(row, now);
}

/**
 * Menetapkan hasil satu percobaan dalam SATU transaksi dengan bentuk pernyataan yang sama untuk token benar maupun salah
 * (hanya nilai bind yang berbeda: +1 bila salah, +0 bila benar; tidak ada orakel waktu dari jalur yang berlainan).
 * Kunci baris `sync:fails:<ip>` menyerialkan semua percobaan dari IP itu, sehingga:
 * - token salah dicatat tepat sekali dan kegagalan ke-`failedAttempts` MENULIS blokir di transaksi yang sama (blokir
 *   dan penghapusan penghitung atomik: tidak ada generasi baru yang membaca hitungan nol sementara blokir belum terlihat);
 * - token benar diterima HANYA bila IP tidak terblokir dan kegagalan terhitung < `failedAttempts`; permintaan sah
 *   tidak dihitung, tidak ditolak karena serentak, dan tidak ikut memicu blokir;
 * - blokir yang dibaca di dalam transaksi (setelah kunci didapat) menolak percobaan yang lolos pra-pemeriksaan tepat
 *   sebelum blokir ter-commit (penghitung yang sempat dibuat dibuang lagi).
 * `fn` bebas efek di luar basis data (deadlock mengulangnya sekali).
 */
async function settleAttempt(env: Env, now: number, ip: string, valid: boolean): Promise<boolean> {
  const windowMs = SYNC_LIMITS.blockSeconds * 1000;
  const delta = valid ? 0 : 1;
  const failKey = FAIL_PREFIX + ip;
  const blockKey = BLOCK_PREFIX + ip;
  return env.DB.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO rate_limits (\`key\`, count, window_start) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         count = CASE WHEN ? - window_start >= ? THEN ? ELSE count + ? END,
         window_start = CASE WHEN ? - window_start >= ? THEN ? ELSE window_start END`,
      )
      .bind(failKey, delta, now, now, windowMs, delta, delta, now, windowMs, now)
      .run();
    const counted = await tx
      .prepare('SELECT count FROM rate_limits WHERE `key` = ?')
      .bind(failKey)
      .first<{ count: number }>();
    const blockRow = await tx
      .prepare('SELECT window_start FROM rate_limits WHERE `key` = ?')
      .bind(blockKey)
      .first<{ window_start: number }>();
    const failures = counted === null ? 0 : Number(counted.count);
    let blocked = blockActive(blockRow, now);
    if (!blocked && !valid && failures >= SYNC_LIMITS.failedAttempts) {
      await tx
        .prepare(
          'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = 1, window_start = ?',
        )
        .bind(blockKey, now, now)
        .run();
      blocked = true;
    }
    // Penghitung dibuang bila blokir berlaku (kegagalan sudah terwakili blokir) atau kosong (permintaan sah tidak
    // meninggalkan baris); pernyataan yang sama dijalankan pada semua jalur.
    await tx
      .prepare('DELETE FROM rate_limits WHERE `key` = ? AND (count <= 0 OR ?)')
      .bind(failKey, blocked ? 1 : 0)
      .run();
    return valid && !blocked && failures < SYNC_LIMITS.failedAttempts;
  });
}

/**
 * True bila token sah dan IP klien tidak sedang diblokir. Token dibandingkan DULU (waktu-konstan, lokal), lalu
 * `settleAttempt` menetapkan hasilnya secara atomik: permintaan sukses tidak dihitung, 10 token salah dalam 10 menit
 * memblokir IP itu 10 menit (token belum diset ikut dihitung), IP lain tidak terpengaruh.
 */
export async function authenticateSync(
  env: Env,
  token: unknown,
  ip: string = UNKNOWN_CLIENT_IP,
): Promise<boolean> {
  const now = nowOf(env);
  ip = limiterAddress(ip); // IPv6 per /64, IPv4 per alamat
  const expected = env.SYNC_API_TOKEN?.trim() ?? '';
  const valid =
    expected.length >= SYNC_TOKEN_MIN_LENGTH &&
    typeof token === 'string' &&
    constantTimeEqual(token, expected);
  if (await isBlocked(env, now, ip)) return false;
  return settleAttempt(env, now, ip, valid);
}
