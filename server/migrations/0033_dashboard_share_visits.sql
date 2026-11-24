-- Data kunjungan tautan dashboard publik (keputusan pemilik 2026-11-24). Expand-only, idempoten (IF NOT EXISTS);
-- kompatibel mundur: image sebelumnya tidak membaca kolom/tabel baru ini. Nomor 0034 dicadangkan cabang lain.

-- Ringkasan per tautan (ISO UTC; '' = belum pernah dikunjungi). `visit_count` menghitung SEMUA kunjungan, bukan hanya
-- baris yang masih disimpan.
ALTER TABLE dashboard_shares ADD COLUMN IF NOT EXISTS visit_count INT NOT NULL DEFAULT 0;
ALTER TABLE dashboard_shares ADD COLUMN IF NOT EXISTS first_visit_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE dashboard_shares ADD COLUMN IF NOT EXISTS last_visit_at VARCHAR(30) NOT NULL DEFAULT '';

-- Baris kunjungan terbaru (maks. 50 per tautan, dipangkas aplikasi). Tidak menyimpan IP asli maupun User-Agent
-- mentah: `ip_prefix` = IPv4 /24 atau IPv6 /48, `country` = dua huruf, `device` = ringkasan dari daftar putih.
CREATE TABLE IF NOT EXISTS dashboard_share_visits (
  id VARCHAR(26) NOT NULL,
  share_id VARCHAR(100) NOT NULL,
  visited_at VARCHAR(30) NOT NULL,
  country VARCHAR(2) NOT NULL DEFAULT '',
  device VARCHAR(80) NOT NULL DEFAULT '',
  ip_prefix VARCHAR(50) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY dashboard_share_visits_share (share_id, visited_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
