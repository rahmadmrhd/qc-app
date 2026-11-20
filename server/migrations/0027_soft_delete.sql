-- Soft delete untuk semua model (keputusan pemilik 2026-11-20; spek 2026-11-20-soft-delete-design.md §2 dan §4.1).
-- EXPAND-ONLY, idempoten, kompatibel mundur dengan image sebelumnya: hanya menambah kolom dan indeks unik baru
-- (`<nama lama>_live` = kolom indeks lama + `deleted_at`) di samping indeks lama; tak ada yang dihapus di sini.
-- Migrasi contract (membuang indeks unik lama, berpenanda `-- qc:contract`) menyusul di PR yang sama pada task
-- penutup fase 4d (keputusan pemilik 11; pengecualian sadar atas aturan expand -> contract: setelah rilis, rollback
-- image TIDAK aman, perbaiki ke depan).
--
-- `deleted_at` = ISO UTC, '' = hidup (sengaja bukan NULL: NULL dalam indeks unik MariaDB selalu dianggap berbeda).
-- `deleted_by` = email pelaku. `sticker_guide_images` SENGAJA tidak termasuk (tetap hapus permanen, keputusan 6).
-- `users_email` TETAP unik penuh, tanpa padanan `_live` (keputusan 10). Indeks serial (`serials_serial_live`) dibuat
-- bersyarat oleh `ensureSerialUniqueIndex`, bukan di sini (data lama dapat ganda; pemeriksa dump menolak PREPARE).

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE business_units ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE business_units ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE sticker_types ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE sticker_types ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE stickers ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE stickers ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE qr_designs ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE qr_designs ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE qr_presets ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE qr_presets ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE postels ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE postels ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE postel_numbers ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE postel_numbers ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE serials ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE serials ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(254) NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique_live ON roles (name_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS locations_code_unique_live ON locations (code, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS locations_name_unique_live ON locations (name_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS business_units_code_unique_live ON business_units (code, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS business_units_name_unique_live ON business_units (name_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS brands_key_live ON brands (`key`, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS customers_key_live ON customers (`key`, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS items_key_live ON items (`key`, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS sticker_types_name_unique_live ON sticker_types (name_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS sticker_types_kind_unique_live ON sticker_types (kind_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS stickers_type_name_unique_live ON stickers (type_id, name_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS qr_presets_bu_unique_live ON qr_presets (bu_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS postel_numbers_key_live ON postel_numbers (number_key, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS postels_sticker_live ON postels (sticker_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS handovers_number_live ON handovers (number, deleted_at);
