-- Skema baseline MariaDB 11.8 (terjemahan skema SQLite lama 0001..0009). Satu tabel per TableSchema Sheets.
--
-- Konvensi:
--  * Semua tabel InnoDB, utf8mb4 + utf8mb4_nopad_bin: perbandingan BYTE PERSIS (setara SQLite BINARY; 'a' <> 'a ',
--    'e' <> 'é', 'Sony' <> 'sony'). Normalisasi kunci (huruf kecil, rapikan) tetap tugas aplikasi (normalizeKey).
--    Pengecualian terdokumentasi: roles.name dan locations.name memakai kolom turunan lower/trim (lihat bawah).
--  * Waktu = VARCHAR(30) ISO 8601 UTC (bukan DATETIME) agar perbandingan/urutan teks tak berubah.
--  * Panjang kunci: indeks InnoDB maks. 3072 byte; utf8mb4 = 4 byte/karakter, jadi kunci indeks <= 768 karakter
--    gabungan. id/rujukan VARCHAR(100) (batas validator 100), kunci ternormalisasi VARCHAR(255),
--    email VARCHAR(254), nomor serah terima VARCHAR(32). Markdown/JSON/teks bebas = LONGTEXT.
--  * Penghitung/revisi/ukuran = BIGINT (out of range -> ER_DATA_OUT_OF_RANGE 1690 membatalkan batch).
--  * Kolom `key`, `before`, `after` diberi backtick (kata kunci SQL).
--  * audit_log.id = BIGINT AUTO_INCREMENT; handover_comments.seq = BIGINT AUTO_INCREMENT UNIQUE (pengganti rowid SQLite untuk urutan/kursor).
--  * Boolean tetap teks seperti Sheets (items.is_country_lock 'true'/'false', qr_designs.overflow '1'/'',
--    qr_documents.shared '1'/'0').

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '',
  role_ids LONGTEXT NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  assignments LONGTEXT NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- SQLite: UNIQUE INDEX roles_name_unique ON roles (lower(trim(name))). MariaDB tidak punya indeks ekspresi:
-- kolom turunan VIRTUAL name_key + UNIQUE. LOWER MariaDB memakai pemetaan huruf Unicode (SQLite: hanya ASCII).
CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  description VARCHAR(500) NOT NULL DEFAULT '',
  permissions LONGTEXT NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  name_key VARCHAR(255) AS (LOWER(TRIM(name))) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY roles_name_unique (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- SQLite: UNIQUE (code) dan UNIQUE (lower(name)); lower(name) lewat kolom turunan name_key.
CREATE TABLE IF NOT EXISTS locations (
  id VARCHAR(100) NOT NULL,
  code VARCHAR(32) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  name_key VARCHAR(255) AS (LOWER(name)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY locations_code_unique (code),
  UNIQUE KEY locations_name_unique (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Sheets tidak punya id baris; id otomatis dipakai untuk kursor (ts, id) yang stabil.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT NOT NULL AUTO_INCREMENT,
  ts VARCHAR(30) NOT NULL,
  actor VARCHAR(255) NOT NULL DEFAULT '',
  action VARCHAR(64) NOT NULL DEFAULT '',
  target VARCHAR(255) NOT NULL DEFAULT '',
  `before` LONGTEXT NOT NULL DEFAULT '',
  `after` LONGTEXT NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY audit_log_ts (ts),
  KEY audit_log_target_ts (target, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- `key` kini membandingkan byte persis (SQLite: NOCASE); aplikasi menormalkan ke huruf kecil (normalizeKey).
CREATE TABLE IF NOT EXISTS brands (
  id VARCHAR(100) NOT NULL,
  external_id VARCHAR(100) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL DEFAULT '',
  `key` VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '',
  sync_rev BIGINT NOT NULL DEFAULT 0,
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  -- Jumlah item (aktif dan nonaktif) per merk, dijaga setiap penulisan item (item tak pernah dihapus).
  item_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY brands_key (`key`),
  KEY brands_external_id (external_id),
  KEY brands_sync_rev (sync_rev)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  `key` VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY customers_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- status: 'active' | 'pending_delete' (hapus = tandai dulu, lalu Drive, lalu hapus baris).
-- SQLite: indeks parsial WHERE status = 'pending_delete'; MariaDB tak punya indeks parsial -> indeks biasa pada status.
CREATE TABLE IF NOT EXISTS files (
  id VARCHAR(100) NOT NULL,
  drive_id VARCHAR(255) NOT NULL DEFAULT '',
  mime VARCHAR(100) NOT NULL DEFAULT '',
  size BIGINT NOT NULL DEFAULT 0,
  width INT NOT NULL DEFAULT 0,
  height INT NOT NULL DEFAULT 0,
  owner_type VARCHAR(32) NOT NULL DEFAULT '',
  owner_id VARCHAR(100) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  PRIMARY KEY (id),
  KEY files_owner (owner_type, owner_id),
  KEY files_pending_delete (status),
  CONSTRAINT files_status_check CHECK (status IN ('active', 'pending_delete'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- status tersimpan hanya 'open' | 'cancelled'; status tampilan diturunkan dari checked/total_count.
-- board_status turunan (deriveHandoverStatus di shared/handover.ts) WAJIB dijaga setiap penulisan handovers.
CREATE TABLE IF NOT EXISTS handovers (
  id VARCHAR(100) NOT NULL,
  number VARCHAR(32) NOT NULL,
  location_id VARCHAR(100) NOT NULL DEFAULT '',
  customer_id VARCHAR(100) NOT NULL DEFAULT '',
  customer_name VARCHAR(255) NOT NULL DEFAULT '',
  note LONGTEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  checks LONGTEXT NOT NULL DEFAULT '[]',
  completed_at VARCHAR(30) NOT NULL DEFAULT '',
  completed_by VARCHAR(255) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  version BIGINT NOT NULL DEFAULT 1,
  checked_count INT NOT NULL DEFAULT 0,
  total_count INT NOT NULL DEFAULT 0,
  board_status VARCHAR(16) NOT NULL DEFAULT 'new',
  PRIMARY KEY (id),
  UNIQUE KEY handovers_number (number),
  KEY handovers_board (location_id, board_status, updated_at),
  KEY handovers_customer (customer_id),
  CONSTRAINT handovers_status_check CHECK (status IN ('open', 'cancelled')),
  CONSTRAINT handovers_board_status_check CHECK (board_status IN ('new', 'in_progress', 'done', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- alias_keys: kunci ternormalisasi semua nama lain dalam bentuk '|kunci1|kunci2|' (pencarian substring daftar item,
-- ekspor). WAJIB diisi setiap penulisan item bersama item_alias_keys.
CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(100) NOT NULL,
  external_id VARCHAR(100) NOT NULL DEFAULT '',
  brand_id VARCHAR(100) NOT NULL DEFAULT '',
  model VARCHAR(255) NOT NULL DEFAULT '',
  `key` VARCHAR(255) NOT NULL DEFAULT '',
  is_country_lock VARCHAR(8) NOT NULL DEFAULT 'false',
  aliases LONGTEXT NOT NULL DEFAULT '',
  stickers LONGTEXT NOT NULL DEFAULT '',
  accessories LONGTEXT NOT NULL DEFAULT '',
  attachments LONGTEXT NOT NULL DEFAULT '',
  detail_md LONGTEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT '',
  sync_rev BIGINT NOT NULL DEFAULT 0,
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  alias_keys LONGTEXT NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY items_key (`key`),
  KEY items_status_updated (status, updated_at),
  KEY items_brand (brand_id),
  KEY items_external_id (external_id),
  KEY items_sync_rev (sync_rev)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Indeks ternormalisasi satu baris per kunci nama lain item; PRIMARY KEY = keunikan kunci nama lain di seluruh item.
-- Kunci yang sama dengan items.key item lain dicek aplikasi (assertItemNamesFree). WAJIB ditulis bersama items.
-- (SQLite: WITHOUT ROWID; InnoDB sudah berindeks klaster pada PRIMARY KEY.)
CREATE TABLE IF NOT EXISTS item_alias_keys (
  `key` VARCHAR(255) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS qr_designs (
  id VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  link_source VARCHAR(32) NOT NULL DEFAULT '',
  link VARCHAR(2048) NOT NULL DEFAULT '',
  document_id VARCHAR(100) NOT NULL DEFAULT '',
  subtitle VARCHAR(255) NOT NULL DEFAULT '',
  footer VARCHAR(255) NOT NULL DEFAULT '',
  logo_file_id VARCHAR(100) NOT NULL DEFAULT '',
  layout LONGTEXT NOT NULL DEFAULT '',
  style LONGTEXT NOT NULL DEFAULT '',
  overflow VARCHAR(8) NOT NULL DEFAULT '',
  exported_hash VARCHAR(128) NOT NULL DEFAULT '',
  exported_at VARCHAR(30) NOT NULL DEFAULT '',
  exported_by VARCHAR(255) NOT NULL DEFAULT '',
  export_pdf_drive_id VARCHAR(255) NOT NULL DEFAULT '',
  export_png_drive_id VARCHAR(255) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY qr_designs_document (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS qr_documents (
  id VARCHAR(100) NOT NULL,
  drive_id VARCHAR(255) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL DEFAULT '',
  size BIGINT NOT NULL DEFAULT 0,
  shared VARCHAR(8) NOT NULL DEFAULT '1',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS qr_defaults (
  id VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  subtitle VARCHAR(255) NOT NULL DEFAULT '',
  footer VARCHAR(255) NOT NULL DEFAULT '',
  layout LONGTEXT NOT NULL DEFAULT '',
  style LONGTEXT NOT NULL DEFAULT '',
  logo_file_ids LONGTEXT NOT NULL DEFAULT '',
  default_logo_id VARCHAR(100) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS qr_presets (
  id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  title VARCHAR(255) NOT NULL DEFAULT '',
  subtitle VARCHAR(255) NOT NULL DEFAULT '',
  footer VARCHAR(255) NOT NULL DEFAULT '',
  layout LONGTEXT NOT NULL DEFAULT '',
  style LONGTEXT NOT NULL DEFAULT '',
  default_logo_id VARCHAR(100) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Penghitung revisi sinkron per sumber daya ('brands' | 'items'); PK = resource.
CREATE TABLE IF NOT EXISTS sync_state (
  resource VARCHAR(64) NOT NULL,
  seq BIGINT NOT NULL DEFAULT 0,
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (resource)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Komentar serah terima (append-only), satu baris per komentar; `at` Sheets = created_at.
-- `stale` cadangan untuk penanda basi yang disimpan; DTO tetap menurunkannya saat baca.
CREATE TABLE IF NOT EXISTS handover_comments (
  id VARCHAR(100) NOT NULL,
  seq BIGINT NOT NULL AUTO_INCREMENT,
  handover_id VARCHAR(100) NOT NULL,
  author VARCHAR(255) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  quote LONGTEXT NOT NULL DEFAULT '',
  `before` LONGTEXT NOT NULL DEFAULT '',
  `after` LONGTEXT NOT NULL DEFAULT '',
  body LONGTEXT NOT NULL DEFAULT '',
  stale INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY handover_comments_seq (seq),
  KEY handover_comments_handover (handover_id, created_at),
  CONSTRAINT handover_comments_handover_fk FOREIGN KEY (handover_id) REFERENCES handovers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Antrean pekerjaan latar; status: queued|running|done|failed. `input`/`state` = JSON kecil; `step` = langkah berikutnya;
-- `lease_until` (epoch ms) = penguasaan langkah oleh satu pengolah (at-least-once).
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(100) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0,
  result LONGTEXT NOT NULL DEFAULT '',
  error LONGTEXT NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  input LONGTEXT NOT NULL DEFAULT '',
  state LONGTEXT NOT NULL DEFAULT '',
  step INT NOT NULL DEFAULT 0,
  lease_until BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY jobs_status_updated (status, updated_at),
  CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Penghitung atomik (UPDATE ... SET value = value + 1), mis. nomor ST harian.
CREATE TABLE IF NOT EXISTS counters (
  `key` VARCHAR(128) NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Pembatas percobaan; window_start = epoch milidetik.
CREATE TABLE IF NOT EXISTS rate_limits (
  `key` VARCHAR(255) NOT NULL,
  count BIGINT NOT NULL DEFAULT 0,
  window_start BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Konfigurasi aplikasi bernilai teks (mis. id folder Drive). Bukan rahasia.
CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(128) NOT NULL,
  value LONGTEXT NOT NULL DEFAULT '',
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Muatan besar (base64 PDF/PNG ekspor QR) satu baris per muatan (maks. ±1 juta karakter); dibersihkan saat job selesai.
CREATE TABLE IF NOT EXISTS job_blobs (
  job_id VARCHAR(100) NOT NULL,
  name VARCHAR(64) NOT NULL,
  data LONGTEXT NOT NULL DEFAULT '',
  PRIMARY KEY (job_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
