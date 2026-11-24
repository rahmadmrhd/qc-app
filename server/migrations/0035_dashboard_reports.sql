-- Dashboard pemantauan, laporan terjadwal lewat surel (spek dashboard bagian 7a). Expand-only, idempoten
-- (IF NOT EXISTS); kompatibel mundur: image sebelumnya tidak menyentuh tabel baru ini. Kolom `report_id` pada
-- `dashboard_shares` (tautan terbitan laporan) sudah dibuat `0032_dashboard.sql`, jadi tidak diulang di sini. Nomor
-- 0033 dipakai data kunjungan tautan, 0034 dan 0036 dipakai cabang lain.

-- Laporan terjadwal. Teks NOT NULL DEFAULT '' (kosong = belum pernah/tidak berlaku). JSON (`schedule`, `scope`,
-- `recipients`) disimpan sebagai LONGTEXT dan dibaca ketat oleh aplikasi. `last_run_key` = kunci periode yang sudah
-- dikirim/diklaim (harian `YYYY-MM-DD`, mingguan `YYYY-Www`, bulanan `YYYY-MM`). Bukan model soft delete: menghapus
-- laporan = menghapus baris (tercatat di audit) dan mencabut tautan terbitannya.
CREATE TABLE IF NOT EXISTS dashboard_reports (
  id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  owner VARCHAR(254) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  schedule LONGTEXT NOT NULL,
  period VARCHAR(20) NOT NULL,
  scope LONGTEXT NOT NULL,
  recipients LONGTEXT NOT NULL,
  link_days INT NOT NULL,
  last_run_key VARCHAR(20) NOT NULL DEFAULT '',
  last_run_at VARCHAR(30) NOT NULL DEFAULT '',
  last_status VARCHAR(10) NOT NULL DEFAULT '',
  last_note VARCHAR(255) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL,
  updated_at VARCHAR(30) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY dashboard_reports_owner (owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
