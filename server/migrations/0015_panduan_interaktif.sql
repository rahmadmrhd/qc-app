-- Panduan interaktif (spek 2026-11-13-panduan-interaktif-design.md, bagian 4.3): penanda akun bersama dan
-- progres panduan per pengguna.
--
-- EXPAND-ONLY, kompatibel mundur: hanya kolom baru ber-bawaan dan tabel baru; image sebelumnya tidak mengenalnya
-- dan tetap berjalan di atas skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan
-- migrasi).
--
-- Idempoten (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS). Konvensi skema: id VARCHAR(100), waktu
-- VARCHAR(30) ISO UTC, tanpa kunci asing (pemilik progres dikunci email ternormalisasi, bukan `users.id`, seperti
-- `notifications` di 0013; progres yatim tak berbahaya dan tak perlu dibersihkan).

-- Akun bersama (dipakai beberapa orang): tidak memakai panduan yang bergantung pada progres per orang.
ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_account TINYINT(1) NOT NULL DEFAULT 0;

-- Satu baris per (pengguna, panduan): `recipient` = email ternormalisasi (`normalizeEmail`), `guide_id` = id panduan
-- (`GUIDE_IDS` di `shared/guides.ts`), `version` = versi panduan yang terakhir diselesaikan/dilewati, `updated_at` =
-- waktu ISO UTC penandaan.
CREATE TABLE IF NOT EXISTS guide_progress (
  recipient VARCHAR(255) NOT NULL,
  guide_id VARCHAR(100) NOT NULL,
  `version` INT NOT NULL DEFAULT 0,
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (recipient, guide_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
