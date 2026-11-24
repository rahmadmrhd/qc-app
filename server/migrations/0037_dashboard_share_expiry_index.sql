-- Indeks penyapu kedaluwarsa tautan dashboard (`sweepExpiredShares`, tiap jam): kondisi utamanya `expires_at <= ?` lalu
-- `revoked_at`, jadi indeks (expires_at, revoked_at) melayani rentang kedaluwarsa tanpa memindai seluruh tabel.
-- Expand-only dan idempoten (IF NOT EXISTS); image sebelumnya tidak terpengaruh. Nomor 0035 dicadangkan Rencana 3
-- (laporan terjadwal), 0034 dan 0036 dipakai cabang lain.
CREATE INDEX IF NOT EXISTS dashboard_shares_expiry ON dashboard_shares (expires_at, revoked_at);
