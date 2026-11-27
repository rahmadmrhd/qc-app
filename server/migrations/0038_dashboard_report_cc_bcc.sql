-- Laporan dashboard terjadwal: penerima Tembusan (CC) dan Tembusan tersembunyi (BCC) selain Kepada (To, kolom
-- `recipients` yang sudah ada). Expand-only dan idempoten; kompatibel mundur: image sebelumnya tidak membaca kolom ini
-- (laporan lama tetap hanya memakai `recipients`). JSON larik surel seperti `recipients`.
ALTER TABLE dashboard_reports ADD COLUMN IF NOT EXISTS cc LONGTEXT NOT NULL DEFAULT '[]';
ALTER TABLE dashboard_reports ADD COLUMN IF NOT EXISTS bcc LONGTEXT NOT NULL DEFAULT '[]';
