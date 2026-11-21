-- Kunci idempoten klien untuk entri stok batch (redesain fase 4a, keputusan pemilik 2026-11-21, K1): kiriman yang
-- terputus di jaringan lalu ditekan Simpan lagi tidak boleh memotong stok dua kali. Tiap baris entri membawa
-- `clientId` (UUID huruf kecil) yang dibuat klien sebelum kiriman pertama dan dipakai ulang; server menjawab hasil
-- yang sudah tersimpan tanpa menulis ulang (pola `handover_comments.client_id`, migrasi 0018).
--
-- EXPAND-ONLY, kompatibel mundur: satu kolom NULLABLE dan satu indeks unik; image sebelumnya tidak mengenalnya dan
-- tetap berjalan di atas skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan
-- migrasi). Baris lama, entri opname, serial, dan penulisan tanpa `clientId` bernilai NULL (indeks unik mengizinkan
-- banyak NULL).
--
-- Idempoten (ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS). Nama indeks dipetakan untuk percobaan
-- ulang di `core/cas.ts` (`RETRYABLE_UNIQUE_KEYS`): jangan diganti tanpa memperbaruinya.
ALTER TABLE sticker_stock_entries ADD COLUMN IF NOT EXISTS client_id VARCHAR(36) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sticker_stock_entries_client_id ON sticker_stock_entries (client_id);
