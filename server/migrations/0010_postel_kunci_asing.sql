-- Postel (susulan 4b): kunci asing yang dijaga basis data untuk dua penunjuk ke `postels`, menggantikan penjagaan
-- murni kode di 0009 (keputusan pemilik 2026-11-12: penunjuk yatim tidak boleh mungkin terjadi, bukan hanya tak
-- dihitung).
--
--   * `items.postel_id` -> `postels.id` ON DELETE SET NULL. Kolom menjadi NULLABLE: NULL = item belum tertaut
--     (sebelumnya ''), karena kunci asing tidak dapat menerima '' yang tak menunjuk baris mana pun. Menghapus catatan
--     melepas itemnya (perilaku yang sama dengan kode, kini dijamin juga bila baris dihapus di luar aplikasi).
--   * `postel_numbers.postel_id` -> `postels.id` ON DELETE CASCADE (nomor milik satu catatan; spek 4b §3).
--
-- BUKAN expand-only (pengecualian tercatat, keputusan pemilik 2026-11-12; CLAUDE.md "Migrasi"): image 0009 menulis ''
-- ke `items.postel_id` dan membaca dengan `<> ''`, sehingga di atas skema ini ia gagal melepas/menautkan item (galat
-- 1452) dan menganggap item tertaut sebagai belum tertaut. Pengecualian itu aman karena Postel 4b hanya pernah
-- di-deploy ke staging (production belum memuatnya) dan tidak ada data yang bergantung pada image 0009. Bila deploy
-- rilis ini gagal, perbaiki ke depan; jangan rollback image ke 0009.
--
-- Idempoten (DDL MariaDB tidak transaksional): MODIFY ... NULL, UPDATE yang aman diulang, dan FOREIGN KEY IF NOT
-- EXISTS. Urutan penting: kolom dibuat NULLABLE dulu, lalu '' dan penunjuk yatim dinormalkan menjadi NULL, baru kunci
-- asing dipasang (jika tidak, pemasangan gagal pada baris lama).

ALTER TABLE items MODIFY COLUMN postel_id VARCHAR(100) NULL DEFAULT NULL;

UPDATE items SET postel_id = NULL WHERE postel_id = '';
UPDATE items SET postel_id = NULL
  WHERE postel_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM postels p WHERE p.id = items.postel_id);

-- Nomor yatim (catatannya sudah tidak ada) tak terjangkau dari aplikasi mana pun; dibuang agar kunci asing dapat dipasang.
DELETE FROM postel_numbers WHERE NOT EXISTS (SELECT 1 FROM postels p WHERE p.id = postel_numbers.postel_id);

ALTER TABLE items ADD CONSTRAINT items_postel_fk
  FOREIGN KEY IF NOT EXISTS items_postel_fk (postel_id) REFERENCES postels (id) ON DELETE SET NULL;
ALTER TABLE postel_numbers ADD CONSTRAINT postel_numbers_postel_fk
  FOREIGN KEY IF NOT EXISTS postel_numbers_postel_fk (postel_id) REFERENCES postels (id) ON DELETE CASCADE;
