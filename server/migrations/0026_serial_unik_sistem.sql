-- Serial Number unik se-sistem (keputusan pemilik 2026-11-18; spek 2026-11-18-serial-unik-sistem-design.md §4, §8).
-- Satu Serial Number = satu catatan di seluruh sistem. EXPAND-ONLY, idempoten, kompatibel mundur dengan image
-- sebelumnya (tak ada kolom/tabel/indeks yang dihapus; indeks lama `serials_bu_serial` dipertahankan sampai rilis
-- berikutnya, lalu dihapus pada tahap contract).

-- Riwayat BU per serial: `serials.bu_id` tetap berarti BU SAAT INI; tabel ini mencatat semua BU yang pernah memegang
-- serial (`left_at` kosong = BU saat ini, paling banyak satu per serial). Kunci utama (serial_id, bu_id) sekaligus
-- penjaga "BU yang sudah ditinggalkan tidak boleh dimasuki lagi". Waktu = ISO UTC.
CREATE TABLE IF NOT EXISTS serial_business_units (
  serial_id VARCHAR(100) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  first_at VARCHAR(40) NOT NULL DEFAULT '',
  left_at VARCHAR(40) NOT NULL DEFAULT '',
  PRIMARY KEY (serial_id, bu_id),
  KEY serial_bu_by_bu (bu_id, serial_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Isi awal: satu baris "BU saat ini" per serial. Diulang tiap start server oleh `backfillSerialBusinessUnits` (image
-- lama yang menulis serial tanpa baris penghubung tetap pulih saat maju lagi).
INSERT IGNORE INTO serial_business_units (serial_id, bu_id, first_at, left_at)
  SELECT id, bu_id, created_at, '' FROM serials;

-- Pengenal klien kejadian: kejadian `recheck` dari Catat idempoten (kirim ulang setelah jaringan putus tidak menggandakan
-- cek ulang dan potongan stok). NULLABLE dengan indeks unik (banyak NULL boleh). Belum ada kolom pengenal serupa di
-- `serial_events` (0012/0015/0017/0019 tak menambahnya).
ALTER TABLE serial_events ADD COLUMN IF NOT EXISTS client_id VARCHAR(100) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS serial_events_client_id ON serial_events (client_id);

-- Keunikan serial se-sistem, BERSYARAT: dibuat hanya bila belum ada serial ganda lintas BU. Bila ada, dilewati tanpa
-- menggagalkan start (keunikan dijaga di aplikasi; `ensureSerialUniqueIndex` mencoba lagi tiap start, mis. setelah
-- skrip penyatuan dijalankan). `serials_bu_serial` tetap ada.
SET @qc_serial_dups := (SELECT COUNT(*) FROM (SELECT 1 FROM serials GROUP BY serial HAVING COUNT(*) > 1 LIMIT 1) AS d);
SET @qc_serial_sql := IF(@qc_serial_dups = 0, 'CREATE UNIQUE INDEX IF NOT EXISTS serials_serial ON serials (serial)', 'DO 0');
PREPARE qc_serial_stmt FROM @qc_serial_sql;
EXECUTE qc_serial_stmt;
DEALLOCATE PREPARE qc_serial_stmt;
