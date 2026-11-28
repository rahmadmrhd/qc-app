-- Catat Serial WH mode catatan (spek stok-ready-kardus bagian 11 butir 5, keputusan pemilik 2026-11-28). Expand-only,
-- idempoten. Pengeluaran `kind = 'note'` tidak memakai tabel stok kardus (serial yang sama boleh muncul di banyak catatan):
-- nomor kardus awal dan isi per kardus disimpan di baris pengeluaran, nomor kardus tiap serial diturunkan saat dibaca dari
-- urutan serial yang diterima. Kolom `note` (TEXT) sudah menampung Markdown 5.000 karakter. `kind` (VARCHAR(8)) memuat 'note'.
ALTER TABLE warehouse_dispatches ADD COLUMN IF NOT EXISTS box_start INT NOT NULL DEFAULT 0;
ALTER TABLE warehouse_dispatches ADD COLUMN IF NOT EXISTS box_size INT NOT NULL DEFAULT 0;
