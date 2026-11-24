/**
 * Pembatas laju halaman publik dashboard di atas tabel `rate_limits` (jendela tetap per kunci). `hitLimit` menghitung
 * SETIAP pemanggilan (pembatas keberhasilan), bukan hanya kegagalan: dipakai agar penonton tak dapat mengulang kueri
 * agregat berat (mis. dengan rentang tanggal berbeda-beda) tanpa batas.
 */
import { type Env, nowOf } from '@server/core/env';

/**
 * Menambah hitungan `key` pada jendela `windowMs` (jendela baru bila yang lama sudah lewat) lalu mengembalikan `true`
 * bila hitungan SESUDAH penambahan melewati `limit` (permintaan ke-`limit + 1` dan seterusnya). Gagal mencatat tidak
 * memblokir (pembatas best-effort, `false`).
 */
export async function hitLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const now = nowOf(env);
  const cutoff = now - windowMs;
  try {
    await env.DB.prepare(
      'INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = IF(window_start < ?, 1, count + 1), window_start = IF(window_start < ?, ?, window_start)',
    )
      .bind(key, now, cutoff, cutoff, now)
      .run();
    const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE `key` = ?')
      .bind(key)
      .first<{ count: number | string }>();
    return Number(row?.count ?? 0) > limit;
  } catch {
    return false;
  }
}
