import type { TestEnv } from './test-env';

/**
 * Menjalankan `fn` tanpa indeks unik LAMA `index` (skema tes dipakai bersama semua berkas di satu proses). Dibuang
 * hanya bila ada, dan dipasang kembali hanya bila tadi ada: setelah migrasi contract (indeks lama sudah tak ada di
 * templat) tes ini tidak memasang indeks yang sudah dibuang.
 */
export async function withoutOldIndex(
  env: TestEnv,
  table: string,
  index: string,
  columns: string,
  fn: () => Promise<void>,
): Promise<void> {
  const found = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
  )
    .bind(table, index)
    .first<{ n: number | string }>();
  const existed = Number(found?.n) > 0;
  if (existed) await env.DB.prepare(`ALTER TABLE ${table} DROP INDEX ${index}`).run();
  try {
    await fn();
  } finally {
    if (existed) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
      await env.DB.prepare(`CREATE UNIQUE INDEX ${index} ON ${table} (${columns})`).run();
    }
  }
}
