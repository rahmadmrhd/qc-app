-- Skema awal D1 (Task 1.3). Satu tabel per TableSchema Sheets (gas/src/modules/*/repo.ts).
-- Kolom teks = TEXT NOT NULL DEFAULT '' (sel kosong Sheets); waktu = ISO 8601 UTC (TEXT);
-- angka yang dipakai berhitung = INTEGER. Boolean tetap TEXT sebagaimana Sheets
-- (items.is_country_lock 'true'/'false', qr_designs.overflow '1'/'', qr_documents.shared '1'/'0')
-- agar impor langsung dan parser repo tetap sama. Tanpa foreign key ke data impor (rujukan
-- diperiksa skrip impor Task 5.1); setiap indeks menambah 1 baris tulis, jadi hanya yang dipakai kueri.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  role_ids TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  assignments TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX users_email ON users (email);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

-- Sheets tidak punya id baris; id otomatis dipakai untuk kursor (ts, id) yang stabil.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  "before" TEXT NOT NULL DEFAULT '',
  "after" TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_log_ts ON audit_log (ts);
CREATE INDEX audit_log_target_ts ON audit_log (target, ts);

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT '',
  sync_rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX brands_key ON brands (key);
CREATE INDEX brands_external_id ON brands (external_id);
CREATE INDEX brands_sync_rev ON brands (sync_rev);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX customers_key ON customers (key);

-- status: 'active' | 'pending_delete' (Spek 8: hapus = tandai dulu, lalu Drive, lalu hapus baris).
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  owner_type TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_delete'))
);
CREATE INDEX files_owner ON files (owner_type, owner_id);
CREATE INDEX files_pending_delete ON files (status) WHERE status = 'pending_delete';

-- Kolom `comments` Sheets dipindah ke tabel handover_comments (0002); skrip impor memecahnya.
-- status tersimpan hanya 'open' | 'cancelled' (status tampilan diturunkan dari checked/total_count).
CREATE TABLE handovers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  location_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  checks TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT NOT NULL DEFAULT '',
  completed_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  checked_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX handovers_number ON handovers (number);
CREATE INDEX handovers_board ON handovers (location_id, status, updated_at);
CREATE INDEX handovers_customer ON handovers (customer_id);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL DEFAULT '',
  brand_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  is_country_lock TEXT NOT NULL DEFAULT 'false',
  aliases TEXT NOT NULL DEFAULT '',
  stickers TEXT NOT NULL DEFAULT '',
  accessories TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '',
  detail_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  sync_rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX items_key ON items (key);
CREATE INDEX items_status_updated ON items (status, updated_at);
CREATE INDEX items_brand ON items (brand_id);
CREATE INDEX items_external_id ON items (external_id);
CREATE INDEX items_sync_rev ON items (sync_rev);

CREATE TABLE qr_designs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  link_source TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  document_id TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  footer TEXT NOT NULL DEFAULT '',
  logo_file_id TEXT NOT NULL DEFAULT '',
  layout TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT '',
  overflow TEXT NOT NULL DEFAULT '',
  exported_hash TEXT NOT NULL DEFAULT '',
  exported_at TEXT NOT NULL DEFAULT '',
  exported_by TEXT NOT NULL DEFAULT '',
  export_pdf_drive_id TEXT NOT NULL DEFAULT '',
  export_png_drive_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX qr_designs_document ON qr_designs (document_id);

CREATE TABLE qr_documents (
  id TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  shared TEXT NOT NULL DEFAULT '1',
  created_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE qr_defaults (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  footer TEXT NOT NULL DEFAULT '',
  layout TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT '',
  logo_file_ids TEXT NOT NULL DEFAULT '',
  default_logo_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE qr_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  footer TEXT NOT NULL DEFAULT '',
  layout TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT '',
  default_logo_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

-- Penghitung revisi sinkron per sumber daya ('brands' | 'items'); PK = resource.
CREATE TABLE sync_state (
  resource TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT ''
);
