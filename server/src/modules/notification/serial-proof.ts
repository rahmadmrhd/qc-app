import type { DbStatement, Preparer } from '@server/core/db';
import { newId } from '@server/core/id';
import { liveWhere } from '@server/core/soft-delete';

/**
 * Notifikasi "foto bukti QC bermasalah" (jenis `serialProofFailed`; spek 2026-11-16-serial-bukti-foto-qc-masalah-design.md
 * §4.1). Satu penerima: pelaku yang menyimpan foto (`serial_proof_photos.created_by`, email ternormalisasi), satu
 * notifikasi per foto per kejadian gagal. Isi hanya nomor Serial Number (`number`); judulnya dibentuk
 * `notificationTitle`. `location_id` = lokasi serial saat ini; aturan akses jenis ini mengikuti BU serial (lihat
 * `recipients.ts`), bukan lokasi.
 */

/** Panjang kolom `notifications.number`. */
const NUMBER_MAX = 50;

/**
 * Pernyataan untuk digabung ke `batch()` yang menetapkan foto `failed` (`onFail` job `serial_proof`). `INSERT ... SELECT`
 * BERSYARAT agar atomik dan tak menggandakan:
 *  - foto benar-benar `failed` dengan `updated_at = now` (= baris itu baru saja dipindahkan batch ini; kegagalan lain atau
 *    foto yang sudah dihapus/selesai tak menghasilkan baris),
 *  - belum ada notifikasi untuk kejadian gagal ini (`created_at >= p.updated_at`): `onFail` yang berjalan dua kali
 *    (waktu sama maupun beda) tak menggandakan, sedangkan kegagalan baru sesudah Coba lagi (`updated_at` lebih baru dari
 *    notifikasi lama) menghasilkan notifikasi baru.
 * Pemanggil memanggil `wakeNotifications()` sesudah komit.
 */
export function proofFailedNotificationStmt(
  db: Preparer,
  photoId: string,
  now: string,
): DbStatement {
  return db
    .prepare(
      // Satu literal (bukan rangkaian) agar penyaring `liveWhere('s')` terlihat tes penjaga soft delete.
      `INSERT INTO notifications (id, recipient, kind, handover_id, location_id, number, customer_name, actor_email, actor_name, \`count\`, preview, created_at, serial_id, proof_id) SELECT ?, p.created_by, 'serialProofFailed', '', s.location_id, LEFT(s.serial, ${NUMBER_MAX}), '', '', '', 0, '', ?, p.serial_id, p.id FROM serial_proof_photos p JOIN serials s ON s.id = p.serial_id WHERE ${liveWhere('s')} AND p.id = ? AND p.state = 'failed' AND p.updated_at = ? AND p.created_by <> '' AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.kind = 'serialProofFailed' AND n.proof_id = p.id AND n.created_at >= p.updated_at)`,
    )
    .bind(newId(), now, photoId, now);
}
