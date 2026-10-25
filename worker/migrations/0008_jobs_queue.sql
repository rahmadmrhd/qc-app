-- Antrean pekerjaan (Task 3.3). `input`/`state` = JSON kecil; `step` = langkah berikutnya yang harus dijalankan;
-- `lease_until` (epoch ms) = penguasaan langkah oleh satu pengolah (pesan Queues at-least-once).
ALTER TABLE jobs ADD COLUMN input TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;

-- Muatan besar (base64 PDF/PNG ekspor QR) yang tidak boleh ikut pesan antrean (128 KB) maupun satu baris job
-- (baris maks. 2 MB): satu baris per muatan (maks. ±1 juta karakter). Dibersihkan saat job selesai/gagal/kedaluwarsa.
CREATE TABLE job_blobs (
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (job_id, name)
);
