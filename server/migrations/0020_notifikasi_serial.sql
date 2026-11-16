-- Notifikasi foto bukti QC Serial Number bermasalah (spek 2026-11-16-serial-bukti-foto-qc-masalah-design.md §4.1):
-- jenis baru `serialProofFailed` memakai tabel `notifications` yang ada (kolom `kind` VARCHAR tanpa CHECK, jadi jenis
-- baru tanpa migrasi). Dua kolom referensi ditambahkan agar jenis ini tidak meminjam `handover_id`:
--   serial_id = id Serial Number (tujuan klik; juga dasar aturan akses jenis Serial: BU serialnya, bukan lokasi),
--   proof_id  = id foto bukti yang gagal (tag push per foto dan dedup per kejadian gagal).
-- Kosong untuk jenis Serah Terima.
--
-- EXPAND-ONLY, kompatibel mundur: dua kolom NOT NULL ber-DEFAULT '' pada tabel yang ada; image sebelumnya tak
-- membacanya dan tetap berjalan di atas skema ini (baris jenis baru tak dikenal image lama; kolomnya diabaikan).
-- Idempoten (ADD COLUMN IF NOT EXISTS).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS serial_id VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS proof_id VARCHAR(100) NOT NULL DEFAULT '';
