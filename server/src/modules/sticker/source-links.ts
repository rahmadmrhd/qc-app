import type { DbStatement, Preparer } from '@server/core/db';
import { liveWhere } from '@server/core/soft-delete';

/**
 * Sumber stiker jenis sistem yang masih hidup, untuk tautan "Buka Postel" / "Buka Manual Book" di halaman stiker.
 * Hanya id (tanpa nama) yang keluar, jadi tak ada data lintas hak yang bocor; halaman tujuan tetap menegakkan izinnya.
 * Catatan Postel atau konfigurasi QR yang sudah terhapus tidak ditautkan (hasilnya kosong untuk stiker itu).
 */
export interface StickerSourceLinks {
  postelId?: string;
  manualBookDesignId?: string;
}

interface SourceRow {
  sticker_id: string;
  kind: string;
  source_id: string;
}

const POSTEL_SOURCE = `SELECT p.sticker_id AS sticker_id, 'postel' AS kind, p.id AS source_id FROM postels p WHERE p.sticker_id IS NOT NULL AND ${liveWhere('p')}`;
const MANUAL_BOOK_SOURCE = `SELECT mv.sticker_id AS sticker_id, 'manual_book' AS kind, mv.design_id AS source_id FROM manual_book_versions mv JOIN qr_designs d ON d.id = mv.design_id AND ${liveWhere('d')}`;

/** Semua sumber hidup (digabung ke `batch()` baca daftar stiker). */
export function stickerSourceLinksStatement(db: Preparer): DbStatement {
  return db.prepare(`${POSTEL_SOURCE} UNION ALL ${MANUAL_BOOK_SOURCE}`);
}

/** Sumber hidup satu stiker. */
export function stickerSourceLinksOfStatement(db: Preparer, stickerId: string): DbStatement {
  return db
    .prepare(
      `SELECT * FROM (${POSTEL_SOURCE} UNION ALL ${MANUAL_BOOK_SOURCE}) src WHERE src.sticker_id = ?`,
    )
    .bind(stickerId);
}

export function stickerSourceLinksFromResult(result: {
  results: unknown[];
}): Map<string, StickerSourceLinks> {
  const links = new Map<string, StickerSourceLinks>();
  for (const row of result.results as SourceRow[]) {
    const id = row.sticker_id.trim();
    const entry = links.get(id) ?? {};
    if (row.kind === 'postel') entry.postelId = row.source_id.trim();
    else entry.manualBookDesignId = row.source_id.trim();
    links.set(id, entry);
  }
  return links;
}
