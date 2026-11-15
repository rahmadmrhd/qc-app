import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import type { GuideId, GuideProgressDto } from '@shared/guides';

/**
 * Akses database progres panduan interaktif (`guide_progress`). Satu baris per (pengguna, panduan); pengguna dikunci
 * email ternormalisasi (`recipient`). Penulisan berbentuk pernyataan siap-`batch()` agar penandaan beberapa panduan
 * sekaligus (panduan + yang dicakupnya) atomik.
 */

type Row = Record<string, string | number | null>;

/** Daftar progres milik `recipient`, urut id agar deterministik. */
export async function listProgress(env: Env, recipient: string): Promise<GuideProgressDto[]> {
  const result = await env.DB.prepare(
    'SELECT guide_id, `version` FROM guide_progress WHERE recipient = ? ORDER BY guide_id',
  )
    .bind(recipient)
    .all<Row>();
  return result.results.map((row) => ({
    id: String(row.guide_id) as GuideId,
    version: Number(row.version),
  }));
}

/**
 * Upsert idempoten yang tidak pernah menurunkan versi tersimpan. `updated_at` hanya berubah bila versi naik
 * (ditulis SEBELUM `version` karena MariaDB mengevaluasi penugasan dari kiri ke kanan).
 */
export function markProgressStmt(
  db: Preparer,
  recipient: string,
  guideId: string,
  version: number,
  now: string,
): DbStatement {
  return db
    .prepare(
      'INSERT INTO guide_progress (recipient, guide_id, `version`, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE updated_at = IF(VALUES(`version`) > `version`, VALUES(updated_at), updated_at), ' +
        '`version` = GREATEST(`version`, VALUES(`version`))',
    )
    .bind(recipient, guideId, version, now);
}

export function resetProgressStmt(db: Preparer, recipient: string, guideId: string): DbStatement {
  return db
    .prepare('DELETE FROM guide_progress WHERE recipient = ? AND guide_id = ?')
    .bind(recipient, guideId);
}
