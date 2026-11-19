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
  KEY serial_bu_by_bu (bu_id, left_at, serial_id)
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

-- Keunikan serial se-sistem: indeks unik `serials_serial` TIDAK dibuat di sini. Ia dibuat bersyarat oleh
-- `ensureSerialUniqueIndex` (server/src/modules/serial/bu-history.ts) tiap start server, setelah migrasi: hanya bila belum
-- ada serial ganda lintas BU; bila ada, start tidak digagalkan dan keunikan dijaga aplikasi sampai skrip penyatuan
-- dijalankan. Alasan: pemeriksa dump pemulihan menolak PREPARE/SET @var, dan semua migrasi harus lolos pemeriksa itu.
-- `serials_bu_serial` tetap ada (dibuang pada tahap contract).
