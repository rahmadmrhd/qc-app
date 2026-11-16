-- Indeks untuk notifikasi Serial Number (tambahan 0020; review 2026-11-16 butir M3): `proof_id` dipakai dedup
-- `NOT EXISTS` saat foto bukti gagal (`proofFailedNotificationStmt`), `serial_id` dipakai klausa baca jenis Serial di
-- lonceng (`scopeClause`: `serial_id IN (SELECT id FROM serials ...)`).
--
-- EXPAND-ONLY, kompatibel mundur: hanya dua indeks tambahan pada tabel yang ada; image sebelumnya tak terpengaruh.
-- Idempoten (CREATE INDEX IF NOT EXISTS). 0013/0014/0020 tidak disunting.
CREATE INDEX IF NOT EXISTS notifications_proof ON notifications (proof_id);
CREATE INDEX IF NOT EXISTS notifications_serial ON notifications (serial_id);
