-- Pemilih task Keluar Gudang: satu cabang per (lokasi, status) membaca task terbaru lebih dulu. Expand-only, idempoten.
CREATE INDEX IF NOT EXISTS handovers_candidates ON handovers (location_id, board_status, deleted_at, created_at);
