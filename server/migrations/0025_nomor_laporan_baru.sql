-- Nomor laporan baru `LP/<kode BU>/YYMM-iiii` (keputusan pemilik 2026-11-18; spek serial unik se-sistem §5.5): kolom
-- `serial_cases.number` diperlebar dari 32 ke 64 karakter (kode BU dapat panjang). Nomor lama `LP-YYYYMMDD-NNN` tetap
-- valid dan tidak diubah. Indeks unik `serial_cases_number` tetap.
--
-- EXPAND-ONLY, kompatibel mundur: pelebaran VARCHAR tak mengubah isi; image sebelumnya tetap menulis nomor format
-- lama (<= 32 karakter) di atas skema ini. Idempoten: MODIFY ke definisi yang sama tidak berbuat apa pun.
ALTER TABLE serial_cases MODIFY COLUMN number VARCHAR(64) NOT NULL;
