import { createDb } from '../src/core/db';

/** Batas waktu `SELECT 1` nyata sebelum runner tes memecah proses (detik tunnel sehat: puluhan milidetik). */
export const DB_PING_TIMEOUT_MS = 5_000;

/**
 * Memastikan MariaDB benar-benar menjawab: satu `SELECT 1` lewat handshake penuh dengan batas waktu. Uji TCP saja
 * tidak cukup: tunnel setengah-terbuka (proses `ssh` hidup, sisi VPS mati) tetap menerima TCP di port lokal, lalu
 * handshake menggantung puluhan detik per koneksi di setiap proses tes (M4). Melempar `Error` bila gagal atau
 * melewati `timeoutMs`; koneksi yang masih menggantung ditinggalkan (proses runner segera keluar).
 */
export async function pingDatabase(url: string, timeoutMs = DB_PING_TIMEOUT_MS): Promise<void> {
  const db = createDb({ url, connectionLimit: 1 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.prepare('SELECT 1').first(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`tidak menjawab dalam ${timeoutMs} ms (tunnel setengah-terbuka?)`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void db.close().catch(() => undefined);
  }
}
