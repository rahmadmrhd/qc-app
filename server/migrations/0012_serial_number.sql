-- qc:contract
-- Serial Number (tahap 5a). Expand-only, idempoten (IF NOT EXISTS). Pengecualian tunggal: pencabutan CHECK stok di
-- bawah, yaitu pelonggaran yang kompatibel mundur dengan image sebelumnya.

-- Catatan serial per (BU, serial). `serial` selalu bentuk hasil normalizeSerial. Kolom teks NOT NULL DEFAULT ''
-- (DTO memetakan '' menjadi null). `client_id` = kunci idempoten per baris (retry simpan ulang).
CREATE TABLE IF NOT EXISTS serials (
  id VARCHAR(100) NOT NULL,
  client_id VARCHAR(100) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  serial VARCHAR(64) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  test_date VARCHAR(10) NOT NULL DEFAULT '',
  sample TINYINT NOT NULL DEFAULT 0,
  note VARCHAR(1000) NOT NULL DEFAULT '',
  location_id VARCHAR(100) NOT NULL DEFAULT '',
  recorded_location_id VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'good',
  custody VARCHAR(16) NOT NULL DEFAULT 'qc',
  transit_from_location_id VARCHAR(100) NOT NULL DEFAULT '',
  transit_to_location_id VARCHAR(100) NOT NULL DEFAULT '',
  assignee_user_id VARCHAR(100) NOT NULL DEFAULT '',
  open_case_id VARCHAR(100) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY serials_bu_serial (bu_id, serial),
  UNIQUE KEY serials_client_id (client_id),
  KEY serials_bu_created (bu_id, created_at),
  KEY serials_item (item_id),
  KEY serials_location (location_id),
  KEY serials_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Stiker yang dipakai per serial (daftar centang) beserta jumlahnya.
CREATE TABLE IF NOT EXISTS serial_stickers (
  serial_id VARCHAR(100) NOT NULL,
  sticker_id VARCHAR(100) NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  PRIMARY KEY (serial_id, sticker_id),
  KEY serial_stickers_sticker (sticker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Riwayat bergaya tiket, hanya ditambah. `seq` berurutan per serial.
CREATE TABLE IF NOT EXISTS serial_events (
  id VARCHAR(100) NOT NULL,
  serial_id VARCHAR(100) NOT NULL,
  case_id VARCHAR(100) NOT NULL DEFAULT '',
  seq INT NOT NULL,
  type VARCHAR(32) NOT NULL,
  occurred_on VARCHAR(10) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  actor_id VARCHAR(100) NOT NULL DEFAULT '',
  actor_name VARCHAR(255) NOT NULL DEFAULT '',
  actor_team VARCHAR(16) NOT NULL DEFAULT 'qc',
  message LONGTEXT NOT NULL DEFAULT '',
  changes_json LONGTEXT NOT NULL DEFAULT '',
  data_json LONGTEXT NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY serial_events_seq (serial_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Entri stok yang lahir dari pemotongan serial merujuk serial dan kejadiannya ('' = bukan dari serial).
ALTER TABLE sticker_stock_entries ADD COLUMN IF NOT EXISTS serial_id VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE sticker_stock_entries ADD COLUMN IF NOT EXISTS serial_event_id VARCHAR(100) NOT NULL DEFAULT '';

-- Stok boleh negatif HANYA akibat pemotongan serial (spek Serial Number). Penjaga CAS di kode tetap menolak
-- hasil negatif untuk stok keluar manual dan opname.
ALTER TABLE sticker_stock DROP CONSTRAINT IF EXISTS sticker_stock_qty_check;
