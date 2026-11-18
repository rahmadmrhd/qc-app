-- Item wajib foto bukti QC (spek Catat Serial wajib foto 2026-11-18 §3 A, keputusan pemilik 2026-11-18): bendera
-- `proof_required` (0/1) dan jumlah foto minimum `proof_min` (1 sampai 5, ditegakkan validator server; bila
-- `proof_required` = 0 nilainya selalu 1). Dibaca `serials.itemOptions` dan ditegakkan `serials.saveBatch`.
--
-- EXPAND-ONLY, kompatibel mundur: dua kolom baru NOT NULL dengan nilai bawaan (0 dan 1 = perilaku lama). Image
-- sebelumnya tak membaca/menulisnya dan tetap berjalan di atas skema ini (INSERT lama memakai nilai bawaan; UPDATE lama
-- tak menyentuhnya, jadi bendera yang sudah terisi tetap bertahan). Idempoten (IF NOT EXISTS).
ALTER TABLE items ADD COLUMN IF NOT EXISTS proof_required TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS proof_min TINYINT UNSIGNED NOT NULL DEFAULT 1;
