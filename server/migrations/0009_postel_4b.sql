-- Stiker tahap 4b (Postel): catatan sertifikat Postel yang dipakai bersama beberapa item, nomor sertifikat beserta
-- tanggal kedaluwarsanya, dan penunjuk item -> catatan Postel.
--
-- EXPAND-ONLY, kompatibel mundur: hanya menambah tabel baru dan satu kolom berbawaan ('' = item belum tertaut ke
-- Postel, tanpa backfill) pada `items`. Image sebelumnya tidak mengenal tabel/kolom ini dan tetap berjalan di atas
-- skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan migrasi).
--
-- Idempoten (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Konvensi skema:
-- id VARCHAR(100), waktu VARCHAR(30) ISO, tanggal kalender VARCHAR(10) 'YYYY-MM-DD' (tanpa kolom DATE), tanpa kunci
-- asing (penghapusan dijaga kode: nomor dihapus bersama catatannya dalam satu batch).

-- Catatan Postel: catatan bebas dan lampiran (JSON larik id berkas milik `files`, urutan larik = urutan tampil;
-- sama dengan `items.attachments`).
CREATE TABLE IF NOT EXISTS postels (
  id VARCHAR(100) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  attachments LONGTEXT NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Nomor sertifikat milik satu catatan. `number_key` = kunci ternormalisasi (`normalizeKey`), unik di seluruh catatan
-- (kolasi nopad membedakan huruf besar/kecil, jadi kecocokan tak-peka-huruf lewat kunci ini). `seq` = urutan tampil
-- dalam catatan. `alert_sent_threshold`: NULL = belum ada peringatan terkirim; selain itu ambang hari terakhir yang
-- sudah diberitahukan (negatif = sudah lewat) pada `alert_sent_on` ('YYYY-MM-DD' WIB).
CREATE TABLE IF NOT EXISTS postel_numbers (
  id VARCHAR(100) NOT NULL,
  postel_id VARCHAR(100) NOT NULL DEFAULT '',
  number VARCHAR(100) NOT NULL DEFAULT '',
  number_key VARCHAR(100) NOT NULL DEFAULT '',
  expires_on VARCHAR(10) NOT NULL DEFAULT '',
  link VARCHAR(2000) NOT NULL DEFAULT '',
  seq INT NOT NULL DEFAULT 0,
  alert_sent_threshold INT NULL,
  alert_sent_on VARCHAR(10) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY postel_numbers_key (number_key),
  UNIQUE KEY postel_numbers_seq (postel_id, seq),
  KEY postel_numbers_expiry (expires_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Penunjuk item -> catatan Postel; '' = belum tertaut. Penulisnya modul Postel, bukan `items.save`.
ALTER TABLE items ADD COLUMN IF NOT EXISTS postel_id VARCHAR(100) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS items_postel ON items (postel_id);
