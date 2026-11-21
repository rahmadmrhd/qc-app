-- qc:contract
-- Migrasi contract soft delete (keputusan pemilik 2026-11-20 butir 11; spek 2026-11-20-soft-delete-design.md §4.1 dan §5
-- butir 7): membuang indeks unik LAMA yang kini digantikan padanan `<nama>_live` (kolom indeks lama + `deleted_at`,
-- dibuat 0027), supaya record terhapus dan record baru berkunci sama dapat hidup berdampingan.
--
-- PENGECUALIAN SADAR atas aturan expand -> contract: migrasi ini ikut PR redesain yang sama dengan kodenya, bukan
-- rilis berikutnya. Setelah rilis, image sebelum soft delete TIDAK aman dijalankan di atas skema ini (ia tak
-- menyaring `deleted_at`, dan indeks `_live` tak mencegah duplikat kunci hidup yang ia buat bersama record terhapus):
-- bila deploy bermasalah, perbaiki ke depan, jangan rollback image (docs/ci-cd.md).
--
-- TIDAK dibuang di sini:
--  * `users_email` (tetap unik penuh; keputusan 10: email pengguna terhapus tak dipakai akun baru);
--  * `serials_serial` dan `serials_bu_serial`: dibuang oleh `ensureSerialUniqueIndex` HANYA setelah `serials_serial_live`
--    berhasil dibuat (data lama dapat memuat serial ganda lintas BU; membuangnya tanpa syarat meninggalkan serial
--    tanpa penjaga indeks apa pun).
-- Semua pasangan `_live` diawali kolom yang sama dengan indeks lamanya, jadi kunci asing yang bersandar pada indeks
-- lama (mis. `stickers.type_id`, `postels.sticker_id`) tetap punya indeks pendukung.

DROP INDEX IF EXISTS roles_name_unique ON roles;
DROP INDEX IF EXISTS locations_code_unique ON locations;
DROP INDEX IF EXISTS locations_name_unique ON locations;
DROP INDEX IF EXISTS business_units_code_unique ON business_units;
DROP INDEX IF EXISTS business_units_name_unique ON business_units;
DROP INDEX IF EXISTS brands_key ON brands;
DROP INDEX IF EXISTS customers_key ON customers;
DROP INDEX IF EXISTS items_key ON items;
DROP INDEX IF EXISTS sticker_types_name_unique ON sticker_types;
DROP INDEX IF EXISTS sticker_types_kind_unique ON sticker_types;
DROP INDEX IF EXISTS stickers_type_name_unique ON stickers;
DROP INDEX IF EXISTS qr_presets_bu_unique ON qr_presets;
DROP INDEX IF EXISTS postel_numbers_key ON postel_numbers;
DROP INDEX IF EXISTS postels_sticker ON postels;
DROP INDEX IF EXISTS handovers_number ON handovers;
