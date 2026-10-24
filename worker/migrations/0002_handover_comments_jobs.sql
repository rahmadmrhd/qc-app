-- Komentar serah terima (append-only), satu baris per komentar (Spek 7.3); `at` Sheets = created_at.
-- `stale` cadangan untuk penanda basi yang disimpan; DTO tetap menurunkannya saat baca.
CREATE TABLE handover_comments (
  id TEXT PRIMARY KEY,
  handover_id TEXT NOT NULL REFERENCES handovers (id),
  author TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '',
  "before" TEXT NOT NULL DEFAULT '',
  "after" TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  stale INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX handover_comments_handover ON handover_comments (handover_id, created_at);

-- Pekerjaan latar Queues (ekspor QR/Sheets, pembersihan); status: queued|running|done|failed.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX jobs_status_updated ON jobs (status, updated_at);

-- Penghitung atomik (UPDATE ... SET value = value + 1 ... RETURNING), mis. nomor ST harian.
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- Pembatas percobaan; window_start = epoch milidetik.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0
);
