-- qc:contract
-- Membuang indeks `serials_created_id (created_at, id)` (dibuat 0032_indeks_kinerja). Redundan: urutan daftar Serial
-- Number (`created_at DESC, id DESC`) kini dilayani `serials_live_created (deleted_at, created_at, id)` (0034, jalur
-- Semua BU) dan `serials_bu_created (bu_id, created_at)` per cabang BU. Keputusan pemilik 2026-11-24. Idempoten.
DROP INDEX IF EXISTS serials_created_id ON serials;
