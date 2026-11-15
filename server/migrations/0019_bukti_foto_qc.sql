-- Serial Number: bukti foto QC (bagian 2, rancangan 2026-11-16). Expand-only dan idempoten (IF NOT EXISTS): hanya
-- tabel baru, tanpa mengubah tabel yang ada, sehingga image sebelumnya tetap berjalan di atas skema ini.
--
-- Satu baris per foto. `draft` = diunggah tetapi belum disimpan (serial_id/event_id kosong); saat Simpan, foto diklaim
-- ke kejadian (`queued`, `snapshot_json` = data cap yang dibekukan), lalu antrean job `serial_proof` menggambar cap
-- (`processing`) dan mengunggahnya ke Drive (`done`, `file_id` = baris `files` pemilik `serialproof`) atau `failed`.
-- `staged_name` = nama berkas sementara buatan server (UUID) di volume `PROOF_STAGING_DIR`; tidak pernah dari klien.
CREATE TABLE IF NOT EXISTS serial_proof_photos (
  id VARCHAR(100) NOT NULL,
  serial_id VARCHAR(100) NOT NULL DEFAULT '',
  event_id VARCHAR(100) NOT NULL DEFAULT '',
  state VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  mime VARCHAR(32) NOT NULL DEFAULT '',
  width INT NOT NULL DEFAULT 0,
  height INT NOT NULL DEFAULT 0,
  size INT NOT NULL DEFAULT 0,
  staged_name VARCHAR(64) NOT NULL DEFAULT '',
  snapshot_json LONGTEXT NOT NULL DEFAULT '',
  file_id VARCHAR(100) NOT NULL DEFAULT '',
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY serial_proof_photos_state (state, updated_at),
  KEY serial_proof_photos_event (event_id),
  KEY serial_proof_photos_owner (created_by, state),
  CONSTRAINT serial_proof_photos_state_check CHECK (state IN ('draft', 'queued', 'processing', 'done', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
