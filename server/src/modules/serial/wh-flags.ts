import { liveWhere } from '@server/core/soft-delete';

/**
 * Fragmen SQL Keluar Gudang untuk daftar serial (spek 2026-11-26 bagian 8). `alias` = alias tabel `serials` pada kueri
 * pemanggil; nama bawaan alias ditulis literal oleh pemanggil, bukan dari masukan pengguna.
 */

/** Serial ini sudah tercatat pada pengeluaran SELESAI (pengeluaran `pending`/`cancelled` tak dihitung). */
export function whRecordedSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM warehouse_dispatch_serials wr_s JOIN warehouse_dispatches wr_d ON wr_d.id = wr_s.dispatch_id WHERE wr_s.serial_id = ${alias}.id AND wr_d.status = 'done')`;
}

/**
 * Serial yang dibuat dari Keluar Gudang (tanpa foto bukti) untuk item wajib foto dan foto yang sudah masuk (selain
 * `draft` dan `failed`) belum mencapai minimum. Item terhapus = tak lagi menuntut foto.
 */
export function needsProofSql(alias: string): string {
  return `(${alias}.wh_created = 1 AND EXISTS (SELECT 1 FROM items np_i WHERE ${liveWhere('np_i')} AND np_i.id = ${alias}.item_id AND np_i.proof_required = 1 AND (SELECT COUNT(*) FROM serial_proof_photos np_p WHERE np_p.serial_id = ${alias}.id AND np_p.state NOT IN ('draft', 'failed')) < GREATEST(np_i.proof_min, 1)))`;
}
