-- Notifikasi Serah Terima (spek 2026-11-12-notifikasi-serah-terima-design.md): kotak notifikasi per penerima
-- (lonceng + antrean push) dan tabel tunggu penggabungan centang (jendela 5 menit).
--
-- EXPAND-ONLY, kompatibel mundur: hanya tabel baru; image sebelumnya tidak mengenalnya dan tetap berjalan di atas
-- skema ini (pengembalian otomatis `deploy.sh` hanya mengganti image, tidak membatalkan migrasi).
--
-- Idempoten (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS). Konvensi skema: id VARCHAR(100), waktu
-- VARCHAR(30) ISO UTC, tanpa kunci asing (penerima dikunci email ternormalisasi, bukan `users.id`; pembersihan
-- dijaga kode berdasarkan umur).

-- Satu baris per penerima per kejadian. `recipient` = email ternormalisasi (`normalizeEmail`). `read_at` '' = belum
-- dibaca. `handover_id` dan `number` kosong untuk `createdBatch`. `count` = jumlah butir (`checked`) atau jumlah
-- task (`createdBatch`). `preview` = cuplikan untuk lonceng saja (tidak pernah dikirim lewat push). `push_state`:
-- 'pending' | 'sent' | 'skipped' | 'failed'.
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(100) NOT NULL,
  recipient VARCHAR(255) NOT NULL DEFAULT '',
  kind VARCHAR(30) NOT NULL DEFAULT '',
  handover_id VARCHAR(100) NOT NULL DEFAULT '',
  location_id VARCHAR(100) NOT NULL DEFAULT '',
  number VARCHAR(50) NOT NULL DEFAULT '',
  customer_name VARCHAR(255) NOT NULL DEFAULT '',
  actor_email VARCHAR(255) NOT NULL DEFAULT '',
  actor_name VARCHAR(255) NOT NULL DEFAULT '',
  `count` INT NOT NULL DEFAULT 0,
  preview VARCHAR(1000) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  read_at VARCHAR(30) NOT NULL DEFAULT '',
  push_state VARCHAR(20) NOT NULL DEFAULT 'pending',
  PRIMARY KEY (id),
  KEY notifications_recipient (recipient, created_at, id),
  KEY notifications_push (push_state, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Ringkasan centang yang tertahan: satu baris per (task, pelaku). `first_at` = centang pertama dalam rangkaian,
-- `release_at` = `first_at` + jendela (tetap, tidak digeser centang berikutnya).
CREATE TABLE IF NOT EXISTS notification_pending (
  handover_id VARCHAR(100) NOT NULL,
  actor_email VARCHAR(255) NOT NULL,
  location_id VARCHAR(100) NOT NULL DEFAULT '',
  number VARCHAR(50) NOT NULL DEFAULT '',
  customer_name VARCHAR(255) NOT NULL DEFAULT '',
  actor_name VARCHAR(255) NOT NULL DEFAULT '',
  first_at VARCHAR(30) NOT NULL DEFAULT '',
  release_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (handover_id, actor_email),
  KEY notification_pending_release (release_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Butir yang berubah dalam rangkaian itu. `item_key` = hash teks kanonis butir + '#' + kemunculan ke-n (butir
-- kembar); `item_text` = teks kanonis (untuk mencocokkan ulang terhadap catatan saat dilepas); `parity` = 0/1
-- berapa kali butir itu dibalik: genap = kembali ke keadaan awal jendela (tak dihitung).
CREATE TABLE IF NOT EXISTS notification_pending_items (
  handover_id VARCHAR(100) NOT NULL,
  actor_email VARCHAR(255) NOT NULL,
  item_key VARCHAR(100) NOT NULL,
  item_text VARCHAR(1000) NOT NULL DEFAULT '',
  occurrence INT NOT NULL DEFAULT 0,
  parity INT NOT NULL DEFAULT 0,
  PRIMARY KEY (handover_id, actor_email, item_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
