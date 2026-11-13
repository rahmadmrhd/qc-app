-- Serial Number tahap 5b (alur tidak lolos dan servis). Expand-only, idempoten (IF NOT EXISTS); kompatibel mundur:
-- image 5a tidak menyentuh tabel/kolom/indeks baru ini dan INSERT `serials` gaya 5a tetap berhasil (`transit_on` berbawaan '').

-- Kasus tidak lolos: satu episode kegagalan serial (serial dapat gagal berkali-kali). Nomor `LP-YYYYMMDD-NNN` unik
-- se-sistem. Kolom teks NOT NULL DEFAULT '' (DTO memetakan '' menjadi null: `closed_on`, `outcome`).
CREATE TABLE IF NOT EXISTS serial_cases (
  id VARCHAR(100) NOT NULL,
  number VARCHAR(32) NOT NULL,
  serial_id VARCHAR(100) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  opened_on VARCHAR(10) NOT NULL DEFAULT '',
  closed_on VARCHAR(10) NOT NULL DEFAULT '',
  damage VARCHAR(200) NOT NULL DEFAULT '',
  outcome VARCHAR(16) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY serial_cases_number (number),
  KEY serial_cases_serial (serial_id),
  KEY serial_cases_bu_opened (bu_id, opened_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Tanggal kirim pengiriman yang sedang berjalan (`transit_from/to_location_id` sudah ada sejak 0012).
ALTER TABLE serials ADD COLUMN IF NOT EXISTS transit_on VARCHAR(10) NOT NULL DEFAULT '';

-- Filter posisi di daftar, dan riwayat per kasus.
CREATE INDEX IF NOT EXISTS serials_custody ON serials (custody);
CREATE INDEX IF NOT EXISTS serial_events_case ON serial_events (serial_id, case_id, seq);
