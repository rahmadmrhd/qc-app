-- Riwayat per record (`activity.list`, revisi tampilan lanjutan 2026-11-22). Expand-only: indeks baru agar pencarian
-- entri audit menurut `target_id` (terbaru dahulu, berhalaman `(ts, id)`) tidak memindai seluruh tabel. Entri sebelum
-- 0028 punya `target_id = ''` dan tidak ikut (tanpa backfill).
CREATE INDEX IF NOT EXISTS audit_log_target_id_ts ON audit_log (target_id, ts, id);
