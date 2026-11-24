-- Indeks kinerja hasil audit 2026-11-23. Expand-only dan idempoten (`IF NOT EXISTS`); tanpa backfill. Indeks lama
-- (`handovers_board`) sengaja dipertahankan: membuangnya = migrasi contract di rilis berikutnya.

-- Papan Serah Terima: `deleted_at` sebagai kolom sama-dengan sebelum `updated_at`/`number` agar satu lokasi dapat
-- membaca urutan indeks (`updated_at DESC, number DESC`) dan berhenti di LIMIT; COUNT per kolom hanya indeks.
CREATE INDEX IF NOT EXISTS handovers_board_live ON handovers (location_id, board_status, deleted_at, updated_at, number);

-- Log Audit difilter menurut aksi (`action = ?` / `action IN (...)`), terbaru dahulu.
CREATE INDEX IF NOT EXISTS audit_log_action_ts ON audit_log (action, ts, id);

-- Daftar Serial lintas BU (urut `created_at DESC, id DESC` tanpa filter BU sempit).
CREATE INDEX IF NOT EXISTS serials_created_id ON serials (created_at, id);

-- Lonceng: hitungan belum dibaca (`recipient`, `read_at = ''`) dan tandai-semua-dibaca.
CREATE INDEX IF NOT EXISTS notifications_unread ON notifications (recipient, read_at);
