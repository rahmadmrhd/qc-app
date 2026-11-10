-- Stiker tahap 3b-2 (spek docs/superpowers/specs/2026-11-10-stiker-instruksi-item-3b2-design.md): instruksi stiker per
-- item = foto dari pustaka gambar (`sticker_guide_images`) dengan penanda yang menunjuk ke stiker tertentu atau jenis
-- stiker.
--
-- EXPAND-ONLY, kompatibel mundur: hanya menambah tabel baru. Kolom lama `items.stickers` TIDAK dihapus (kode berhenti
-- membaca/menulisnya; tanpa backfill, keputusan pemilik). Image sebelumnya tidak mengenal tabel ini dan tetap berjalan
-- di atas skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan migrasi).
--
-- Idempoten (IF NOT EXISTS). Kunci asing hanya dipakai untuk dua hal yang harus dijaga basis data: gambar pustaka yang
-- masih ditempatkan tidak boleh terhapus (`ON DELETE RESTRICT`, menutup balapan hapus gambar vs simpan item) dan
-- penanda ikut hilang bersama fotonya (`ON DELETE CASCADE`). Item, stiker, jenis, dan BU tidak pernah dihapus (hanya
-- dinonaktifkan), jadi tanpa kunci asing ke tabel itu (pola 0005/0006).

CREATE TABLE IF NOT EXISTS item_sticker_photos (
  item_id VARCHAR(100) NOT NULL,
  guide_id VARCHAR(100) NOT NULL,
  caption VARCHAR(255) NOT NULL DEFAULT '',
  -- Label BU foto (murni tampilan); '' = tanpa label.
  bu_id VARCHAR(100) NOT NULL DEFAULT '',
  -- Urutan foto dalam item (dari urutan larik input).
  `position` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, guide_id),
  KEY item_sticker_photos_guide (guide_id),
  CONSTRAINT item_sticker_photos_guide_fk FOREIGN KEY (guide_id) REFERENCES sticker_guide_images (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS item_sticker_marks (
  item_id VARCHAR(100) NOT NULL,
  guide_id VARCHAR(100) NOT NULL,
  -- Urutan penanda dalam foto (dari urutan larik input).
  `position` INT NOT NULL DEFAULT 0,
  -- Koordinat permil 0..1000 dari lebar/tinggi foto.
  x SMALLINT NOT NULL DEFAULT 0,
  y SMALLINT NOT NULL DEFAULT 0,
  -- Sasaran: tepat satu dari stiker atau jenis terisi (yang lain '').
  sticker_id VARCHAR(100) NOT NULL DEFAULT '',
  type_id VARCHAR(100) NOT NULL DEFAULT '',
  note VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (item_id, guide_id, `position`),
  KEY item_sticker_marks_sticker (sticker_id),
  KEY item_sticker_marks_type (type_id),
  CONSTRAINT item_sticker_marks_photo_fk FOREIGN KEY (item_id, guide_id) REFERENCES item_sticker_photos (item_id, guide_id) ON DELETE CASCADE,
  CONSTRAINT item_sticker_marks_target_check CHECK ((sticker_id <> '') + (type_id <> '') = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
