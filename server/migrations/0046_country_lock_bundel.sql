-- Bundel Country Lock (spek 2026-11-28-country-lock-sync-bundel-design.md §5.2, fase 1): berkas (teks di MariaDB, biner di
-- Google Drive menurut sha256), riwayat revisi per berkas gaya git (hanya ditambah), unggahan bertahap, daftar firmware
-- dinamis, dan bundel terbit yang tak dapat diubah.
--
-- EXPAND-ONLY, kompatibel mundur: hanya tabel baru; image sebelumnya tak membacanya. Idempoten (IF NOT EXISTS), tanpa
-- DROP/RENAME. Waktu = ISO UTC teks (VARCHAR(30)); `removed_at` = '' selama hidup (bukan NULL agar dijaga indeks unik).

-- Berkas draf. `path_key` = nama jalur huruf kecil (mencegah dua berkas beda huruf besar/kecil); `head_rev` = nomor revisi
-- terbaru (0 = belum ada isi). Berkas yang dihapus hanya diberi `removed_at`; riwayat revisinya tetap.
CREATE TABLE IF NOT EXISTS cl_files (
  id CHAR(26) NOT NULL,
  path VARCHAR(200) NOT NULL,
  path_key VARCHAR(200) NOT NULL,
  role ENUM('settings','script','router') NOT NULL,
  kind ENUM('text','binary') NOT NULL,
  head_rev INT NOT NULL DEFAULT 0,
  removed_at VARCHAR(30) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL,
  updated_at VARCHAR(30) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cl_files_path_live (path_key, removed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Revisi berkas (append-only: kode tidak pernah UPDATE/DELETE). Teks ada di `text_body`; biner hanya sha256 dan ukuran
-- (isinya di `cl_blobs`/Drive).
CREATE TABLE IF NOT EXISTS cl_revisions (
  id CHAR(26) NOT NULL,
  file_id CHAR(26) NOT NULL,
  seq INT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size INT NOT NULL,
  text_body MEDIUMTEXT NULL,
  message VARCHAR(200) NOT NULL DEFAULT '',
  author VARCHAR(254) NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cl_revisions_file_seq (file_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Katalog biner di Drive, dinamai menurut sha256 (satu salinan untuk semua bundel yang memakainya).
CREATE TABLE IF NOT EXISTS cl_blobs (
  sha256 CHAR(64) NOT NULL,
  size BIGINT NOT NULL,
  drive_file_id VARCHAR(100) NOT NULL,
  md5 CHAR(32) NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  PRIMARY KEY (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Sesi unggah biner bertahap (potongan disimpan sementara di `cl_upload_chunks` sampai dirakit dan diunggah ke Drive).
CREATE TABLE IF NOT EXISTS cl_uploads (
  id CHAR(26) NOT NULL,
  file_path VARCHAR(200) NOT NULL,
  size BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  chunk_count INT NOT NULL,
  state ENUM('open','done','aborted') NOT NULL DEFAULT 'open',
  owner VARCHAR(254) NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  updated_at VARCHAR(30) NOT NULL,
  PRIMARY KEY (id),
  KEY cl_uploads_state (state, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS cl_upload_chunks (
  upload_id CHAR(26) NOT NULL,
  idx INT NOT NULL,
  data MEDIUMBLOB NOT NULL,
  PRIMARY KEY (upload_id, idx)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Daftar firmware dinamis (menggantikan `shared/firmware.ts`). `script_path` menunjuk berkas skrip di draf (NULL = belum
-- punya); `parallel` = boleh paralel di mode Multi. Dihapus lunak lewat `removed_at`; kode yang sama boleh dipakai lagi.
CREATE TABLE IF NOT EXISTS cl_firmwares (
  id CHAR(26) NOT NULL,
  brand ENUM('mikrotik','ubiquiti') NOT NULL,
  code VARCHAR(40) NOT NULL,
  label VARCHAR(120) NOT NULL,
  script_path VARCHAR(200) NULL,
  parallel TINYINT(1) NOT NULL DEFAULT 0,
  sort INT NOT NULL DEFAULT 0,
  removed_at VARCHAR(30) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL,
  updated_at VARCHAR(30) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cl_firmwares_code_live (brand, code, removed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Bundel terbit (tak berubah). `source_number` terisi bila bundel ini hasil "mengaktifkan ulang" bundel lama.
CREATE TABLE IF NOT EXISTS cl_bundles (
  id CHAR(26) NOT NULL,
  number INT NOT NULL,
  computer_hash CHAR(64) NOT NULL,
  router_hash CHAR(64) NOT NULL,
  min_app VARCHAR(20) NOT NULL,
  manifest_json MEDIUMTEXT NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  published_by VARCHAR(254) NOT NULL,
  source_number INT NULL,
  created_at VARCHAR(30) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cl_bundles_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Foto berkas tiap bundel; indeks sha256 untuk menjawab "biner ini dirujuk bundel terbit mana pun?".
CREATE TABLE IF NOT EXISTS cl_bundle_files (
  bundle_id CHAR(26) NOT NULL,
  path VARCHAR(200) NOT NULL,
  role ENUM('settings','script','router') NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size BIGINT NOT NULL,
  PRIMARY KEY (bundle_id, path),
  KEY cl_bundle_files_sha (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
