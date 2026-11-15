-- Kunci idempoten klien untuk Serah Terima (PWA Fase 3 Tahap C; spek 2026-11-13-pwa-offline-serah-terima-design.md
-- bagian 7 dan 9): komentar dan task baru yang diantrekan di perangkat dikirim ulang dengan `clientId` yang sama
-- sehingga server tidak membuat duplikat (pola `serials.client_id`).
--
-- EXPAND-ONLY, kompatibel mundur: dua kolom NULLABLE dan dua indeks unik; image sebelumnya tidak mengenalnya dan
-- tetap berjalan di atas skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan
-- migrasi). Baris lama dan penulisan tanpa `clientId` bernilai NULL (indeks unik mengizinkan banyak NULL).
--
-- Idempoten (ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS). Nama indeks dipetakan untuk percobaan
-- ulang di `core/cas.ts` (`RETRYABLE_UNIQUE_KEYS`): jangan diganti tanpa memperbaruinya.
ALTER TABLE handovers ADD COLUMN IF NOT EXISTS client_id VARCHAR(100) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS handovers_client_id ON handovers (client_id);

ALTER TABLE handover_comments ADD COLUMN IF NOT EXISTS client_id VARCHAR(100) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS handover_comments_client_id ON handover_comments (client_id);
