-- Stiker tahap 3b-1 (spek docs/superpowers/specs/2026-11-09-stiker-pustaka-gambar-3b1-design.md): pustaka gambar
-- instruksi stiker. Satu gambar = satu baris `files` (pemilik 'stickerguide', owner_id = id berkasnya sendiri) +
-- satu baris tabel ini (id = files.id).
--
-- EXPAND-ONLY, kompatibel mundur: hanya menambah tabel baru. Image sebelumnya tidak mengenalnya dan tetap berjalan
-- di atas skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan migrasi).
--
-- Idempoten (IF NOT EXISTS). Tanpa kunci asing ke `files` (berkas dan barisnya dihapus lewat `batch()` yang sama di
-- kode). `name_key` = LOWER(name) untuk pencarian tak-peka-huruf dan pengurutan nama; nama dirapikan (trim) oleh
-- validator. Ukuran, dimensi, pengunggah, dan waktu diambil dari baris `files`. `thumb` = thumbnail (maks. 40 KB,
-- dijaga validator) yang disajikan dengan cache peramban panjang.

CREATE TABLE IF NOT EXISTS sticker_guide_images (
  id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  name_key VARCHAR(255) AS (LOWER(name)) VIRTUAL,
  thumb_mime VARCHAR(32) NOT NULL DEFAULT '',
  thumb MEDIUMBLOB NOT NULL,
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY sticker_guide_images_name (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
