-- Business Unit (BU) tahap 1 (spek docs/superpowers/specs/2026-11-08-business-unit-design.md): master BU, tabel
-- penghubung item<->BU dan merk<->BU bawaan, serta kolom penugasan BU per user.
--
-- EXPAND-ONLY, kompatibel mundur: hanya menambah tabel/kolom. Image sebelumnya tidak mengenal ketiganya dan tetap
-- berjalan di atas skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan migrasi).
-- Hak `item` pengguna lama dipindahkan ke `users.bu_assignments` oleh `backfillBuAssignments` saat server start (kode,
-- bukan SQL; idempoten).
--
-- Idempoten (IF NOT EXISTS): aman dijalankan ulang (DDL MariaDB tidak transaksional). Kolom string mengikuti tabel
-- `locations`; tanpa kunci asing (BU tidak pernah dihapus, hanya dinonaktifkan; keutuhan dijaga kode dalam `batch()`).

CREATE TABLE IF NOT EXISTS business_units (
  id VARCHAR(100) NOT NULL,
  code VARCHAR(32) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  name_key VARCHAR(255) AS (LOWER(name)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY business_units_code_unique (code),
  UNIQUE KEY business_units_name_unique (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Satu item boleh punya banyak BU (minimal satu, dijaga aplikasi). Indeks pada bu_id untuk filter baca per BU.
CREATE TABLE IF NOT EXISTS item_business_units (
  item_id VARCHAR(100) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  PRIMARY KEY (item_id, bu_id),
  KEY item_business_units_bu (bu_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- BU bawaan merk (nol atau lebih): hanya mengisi otomatis form item, tidak memberi hak apa pun.
CREATE TABLE IF NOT EXISTS brand_default_business_units (
  brand_id VARCHAR(100) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  PRIMARY KEY (brand_id, bu_id),
  KEY brand_default_business_units_bu (bu_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Penugasan BU user: JSON daftar { buId: string | null, roleIds: string[] } (null = Semua BU), pola `assignments`.
-- Kosong ('') = belum pernah diisi: itulah penanda baris yang masih harus di-backfill dari hak lama.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bu_assignments LONGTEXT NOT NULL DEFAULT '';
