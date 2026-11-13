-- Stiker tahap 4a (spek docs/superpowers/specs/2026-11-10-stiker-manual-book-4a-design.md): Manual Book dan
-- Konfigurasi Stiker. Preset QR per BU, nama Manual Book pada konfigurasi QR, jenis stiker sistem dengan minimum bawaan,
-- penunjuk item -> konfigurasi QR (Manual Book), dan riwayat versi Manual Book.
--
-- EXPAND-ONLY, kompatibel mundur: hanya menambah kolom (semua berbawaan, tanpa backfill) dan tabel baru. Image
-- sebelumnya tidak mengenal kolom/tabel ini dan tetap berjalan di atas skema ini (pengembalian otomatis `deploy.sh`
-- hanya mengganti image, tidak membatalkan migrasi). Catatan rilis: image lama membaca status stiker 'deprecated'
-- sebagai 'active' (dicatat di docs/ci-cd.md), tidak dicegah.
--
-- Idempoten (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS). Keunikan untuk
-- kolom berbawaan '' memakai kolom virtual `NULLIF(kolom, '')` + UNIQUE (pola `name_key`): nilai kosong menjadi NULL
-- sehingga boleh berulang, nilai terisi tetap unik.

-- Preset QR milik tepat satu BU ('' = preset lama tanpa BU) dan bagian label yang menampung nama Manual Book.
ALTER TABLE qr_presets ADD COLUMN IF NOT EXISTS bu_id VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE qr_presets ADD COLUMN IF NOT EXISTS name_placement VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE qr_presets ADD COLUMN IF NOT EXISTS bu_key VARCHAR(100) AS (NULLIF(bu_id, '')) VIRTUAL;
CREATE UNIQUE INDEX IF NOT EXISTS qr_presets_bu_unique ON qr_presets (bu_key);

-- Konfigurasi QR: nama Manual Book, penempatan nama (disalin dari preset), dan preset asal (pembanding banner).
ALTER TABLE qr_designs ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE qr_designs ADD COLUMN IF NOT EXISTS name_placement VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE qr_designs ADD COLUMN IF NOT EXISTS preset_id VARCHAR(100) NOT NULL DEFAULT '';

-- Jenis stiker sistem ('' | 'manual_book' | 'postel'; paling banyak satu jenis per nilai terisi) dan minimum bawaan
-- bagi stiker versi pertama.
ALTER TABLE sticker_types ADD COLUMN IF NOT EXISTS system_kind VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE sticker_types ADD COLUMN IF NOT EXISTS default_min_qty BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sticker_types ADD COLUMN IF NOT EXISTS kind_key VARCHAR(16) AS (NULLIF(system_kind, '')) VIRTUAL;
CREATE UNIQUE INDEX IF NOT EXISTS sticker_types_kind_unique ON sticker_types (kind_key);

-- Penunjuk item -> konfigurasi QR (Manual Book); '' = belum tergabung. Penulisnya modul QR, bukan `items.save`.
ALTER TABLE items ADD COLUMN IF NOT EXISTS manual_book_design_id VARCHAR(100) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS items_manual_book ON items (manual_book_design_id);

-- Satu baris per stiker Manual Book: versi konfigurasi QR yang melahirkannya. UNIQUE (design_id, version) menjaga dua
-- ekspor serentak tidak membuat dua stiker versi yang sama. Tanpa kunci asing (pola 0005: stiker tidak pernah dihapus).
CREATE TABLE IF NOT EXISTS manual_book_versions (
  sticker_id VARCHAR(100) NOT NULL,
  design_id VARCHAR(100) NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1,
  content_hash VARCHAR(128) NOT NULL DEFAULT '',
  -- JSON: judul, subtitle, footer, logo, tata letak, dan gaya saat versi dibuat.
  content_snapshot LONGTEXT NOT NULL,
  reason VARCHAR(600) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (sticker_id),
  UNIQUE KEY manual_book_versions_design_version (design_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
