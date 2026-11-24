-- Dashboard pemantauan, tautan publik (spek dashboard bagian 7). Expand-only, idempoten (IF NOT EXISTS);
-- kompatibel mundur: image sebelumnya tidak menyentuh tabel baru ini.

-- Tautan dashboard publik. Kolom teks NOT NULL DEFAULT '' (kosong = aktif/tidak berlaku). `scope` = JSON cakupan beku
-- (BU, lokasi, rentang, widget, filter yang ditawarkan ke penonton). `report_id` terisi bila tautan diterbitkan laporan
-- terjadwal (tidak dihitung dalam batas tautan aktif per pembagi). Bukan model soft delete: pencabutan = `revoked_at`.
CREATE TABLE IF NOT EXISTS dashboard_shares (
  id VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  created_by VARCHAR(254) NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  expires_at VARCHAR(30) NOT NULL,
  revoked_at VARCHAR(30) NOT NULL DEFAULT '',
  revoked_by VARCHAR(254) NOT NULL DEFAULT '',
  scope LONGTEXT NOT NULL,
  report_id VARCHAR(100) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY dashboard_shares_creator (created_by, revoked_at),
  KEY dashboard_shares_report (report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
