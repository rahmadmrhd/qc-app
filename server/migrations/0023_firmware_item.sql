-- Kode firmware Country Lock per item (spek desktop §6.6, keputusan pemilik 2026-11-06 dan 2026-11-18): desktop memilih
-- skrip inject dan mengunci kotak firmware dari kode ini. Berisi salah satu kode di `shared/firmware.ts` untuk merk
-- itu; '' = belum diisi. Hanya bermakna untuk item `is_country_lock = 'true'` (validator server mengosongkannya bila
-- tidak).
--
-- EXPAND-ONLY, kompatibel mundur: satu kolom baru NOT NULL dengan nilai bawaan '' (= perilaku lama). Image sebelumnya
-- tak membaca/menulisnya dan tetap berjalan di atas skema ini (INSERT lama memakai nilai bawaan; UPDATE lama tak
-- menyentuhnya, jadi kode yang sudah terisi tetap bertahan). Idempoten (IF NOT EXISTS).
ALTER TABLE items ADD COLUMN IF NOT EXISTS firmware VARCHAR(40) NOT NULL DEFAULT '';
