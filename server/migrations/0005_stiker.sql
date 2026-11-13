-- Stiker tahap 3a (spek docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md): katalog jenis dan stiker,
-- tautan stiker<->BU, stok per stiker per lokasi, dan riwayat stok (hanya ditambah).
--
-- EXPAND-ONLY, kompatibel mundur: hanya menambah tabel baru. Image sebelumnya tidak mengenalnya dan tetap berjalan
-- di atas skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan migrasi).
--
-- Idempoten (IF NOT EXISTS). Kolom string mengikuti tabel lain; tanpa kunci asing (stiker, jenis, BU, dan lokasi tidak
-- pernah dihapus, hanya dinonaktifkan; keutuhan dijaga kode dalam `batch()`). `name_key` = LOWER(name) (pola
-- `business_units`): nama dirapikan (trim) oleh validator, jadi kunci ini cukup untuk keunikan tak-peka-huruf.

CREATE TABLE IF NOT EXISTS sticker_types (
  id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  -- Aturan penentuan stiker bagi item: 'bu' | 'none' (tak dapat diubah setelah jenis punya stiker).
  rule VARCHAR(16) NOT NULL DEFAULT 'bu',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  name_key VARCHAR(255) AS (LOWER(name)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY sticker_types_name_unique (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS stickers (
  id VARCHAR(100) NOT NULL,
  type_id VARCHAR(100) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL DEFAULT '',
  -- Nama tampilan untuk tim QC (opsional, tidak unik).
  alias VARCHAR(255) NOT NULL DEFAULT '',
  -- Id berkas gambar contoh (tabel `files`); kosong = tanpa gambar.
  file_id VARCHAR(100) NOT NULL DEFAULT '',
  -- Batas minimum stok (butir) total semua lokasi; 0 = tanpa peringatan.
  min_qty BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  name_key VARCHAR(255) AS (LOWER(name)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY stickers_type_name_unique (type_id, name_key),
  KEY stickers_type (type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Satu stiker boleh punya banyak BU (pola `item_business_units`). Indeks pada bu_id untuk filter baca per BU.
CREATE TABLE IF NOT EXISTS sticker_business_units (
  sticker_id VARCHAR(100) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  PRIMARY KEY (sticker_id, bu_id),
  KEY sticker_business_units_bu (bu_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Stok (butir) per stiker per lokasi; tidak boleh negatif (jaring pengaman; penjaga CAS di kode mendahuluinya).
CREATE TABLE IF NOT EXISTS sticker_stock (
  sticker_id VARCHAR(100) NOT NULL,
  location_id VARCHAR(100) NOT NULL,
  qty BIGINT NOT NULL DEFAULT 0,
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (sticker_id, location_id),
  CONSTRAINT sticker_stock_qty_check CHECK (qty >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Riwayat stok, hanya ditambah. kind: 'in' | 'out' | 'adjust' | 'opname'. delta = perubahan butir (bertanda),
-- qty_after = stok sesudahnya, count_json = rincian input hitungan (lembar, isi per lembar, butir lepas) bila ada.
CREATE TABLE IF NOT EXISTS sticker_stock_entries (
  id BIGINT NOT NULL AUTO_INCREMENT,
  sticker_id VARCHAR(100) NOT NULL,
  location_id VARCHAR(100) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT '',
  delta BIGINT NOT NULL DEFAULT 0,
  qty_after BIGINT NOT NULL DEFAULT 0,
  count_json LONGTEXT NOT NULL DEFAULT '',
  reason VARCHAR(500) NOT NULL DEFAULT '',
  actor VARCHAR(255) NOT NULL DEFAULT '',
  ts VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY sticker_stock_entries_sticker_ts (sticker_id, ts),
  KEY sticker_stock_entries_location_ts (location_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
