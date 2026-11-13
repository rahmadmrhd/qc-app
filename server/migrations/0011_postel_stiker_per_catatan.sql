-- Postel (susulan 4b): satu stiker katalog PER CATATAN Postel (keputusan pemilik 2026-11-12), menggantikan satu stiker
-- "Postel" bersama. Expand-only dan idempoten (DDL MariaDB tidak transaksional):
--
--   * `postels.sticker_id` -> `stickers.id`, NULLABLE (NULL = belum bersiker; stiker lahir bersama catatan, dan catatan
--     lama dibekali stiker oleh pengisi saat start: `backfillPostelStickers`) dan UNIQUE (satu stiker milik paling banyak
--     satu catatan). `ON DELETE RESTRICT`: stiker tidak pernah dihapus (riwayat stok tetap terbaca), jadi penunjuk dari
--     catatan tidak boleh menggantung. Menghapus catatan tidak menyentuh stikernya (kode menjadikannya nonaktif/usang).
--   * Stiker Manual Book yang sudah ada diberi awalan "Manual Book - " pada namanya agar tak membingungkan di katalog
--     (keputusan pemilik yang sama). Nama stiker Postel berawalan "Postel - " dibuat kode. `name_key` kolom turunan
--     (LOWER(name)), jadi indeks unik (jenis, nama) ikut menyesuaikan; semua stiker jenis itu diubah bersamaan sehingga
--     tidak ada tabrakan baru.
--
-- Image sebelum rilis ini tetap kompatibel (kolom baru NULLABLE dan diabaikan; ia hanya salah menerjemahkan stiker Postel:
-- semua stiker Postel dianggap berlaku bagi setiap item ber-Postel).

ALTER TABLE postels ADD COLUMN IF NOT EXISTS sticker_id VARCHAR(100) NULL DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS postels_sticker ON postels (sticker_id);

ALTER TABLE postels ADD CONSTRAINT postels_sticker_fk
  FOREIGN KEY IF NOT EXISTS postels_sticker_fk (sticker_id) REFERENCES stickers (id) ON DELETE RESTRICT;

UPDATE stickers s JOIN sticker_types t ON t.id = s.type_id
  SET s.name = CONCAT('Manual Book - ', s.name)
  WHERE t.system_kind = 'manual_book' AND s.name NOT LIKE 'Manual Book - %';
