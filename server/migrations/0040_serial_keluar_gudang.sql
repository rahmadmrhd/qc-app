-- Keluar Gudang (spek 2026-11-26 Bagian A). Expand-only, idempoten; image lama mengabaikan kolom/tabel baru.
ALTER TABLE serials ADD COLUMN IF NOT EXISTS wh_created TINYINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS serials_wh_created ON serials (wh_created, deleted_at);

-- Catatan SO: satu SO satu BU (bu_id tetap), No SO unik se-sistem tanpa beda huruf (kolom `key`). Bukan soft delete.
CREATE TABLE IF NOT EXISTS warehouse_orders (
  id VARCHAR(100) NOT NULL,
  number VARCHAR(64) NOT NULL,
  `key` VARCHAR(64) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  customer_id VARCHAR(100) NOT NULL DEFAULT '',
  customer_name VARCHAR(255) NOT NULL DEFAULT '',
  last_dispatched_on VARCHAR(10) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL,
  created_by VARCHAR(254) NOT NULL,
  updated_at VARCHAR(30) NOT NULL,
  updated_by VARCHAR(254) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY warehouse_orders_key (`key`),
  KEY warehouse_orders_bu_updated (bu_id, updated_at),
  KEY warehouse_orders_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS warehouse_order_handovers (
  order_id VARCHAR(100) NOT NULL,
  handover_id VARCHAR(100) NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  created_by VARCHAR(254) NOT NULL,
  PRIMARY KEY (order_id, handover_id),
  KEY warehouse_order_handovers_handover (handover_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Pengeluaran: status pending|done|cancelled (cancelled = penyapu 7 hari). header_hash = sha256 kolom tetap kanonis.
CREATE TABLE IF NOT EXISTS warehouse_dispatches (
  id VARCHAR(100) NOT NULL,
  order_id VARCHAR(100) NOT NULL,
  client_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  dispatched_on VARCHAR(10) NOT NULL,
  note TEXT NOT NULL,
  mode VARCHAR(16) NOT NULL DEFAULT 'clipboard',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  header_hash VARCHAR(64) NOT NULL,
  chunk_size INT NOT NULL,
  chunk_count INT NOT NULL,
  chunks_received INT NOT NULL DEFAULT 0,
  serial_total INT NOT NULL,
  created_count INT NOT NULL DEFAULT 0,
  created_at VARCHAR(30) NOT NULL,
  created_by VARCHAR(254) NOT NULL,
  completed_at VARCHAR(30) NOT NULL DEFAULT '',
  cancelled_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY warehouse_dispatches_client_id (client_id),
  KEY warehouse_dispatches_order (order_id, created_at),
  KEY warehouse_dispatches_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS warehouse_dispatch_chunks (
  dispatch_id VARCHAR(100) NOT NULL,
  chunk_index INT NOT NULL,
  received_at VARCHAR(30) NOT NULL,
  skipped_json TEXT NOT NULL,
  PRIMARY KEY (dispatch_id, chunk_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Satu serial paling banyak sekali per SO (termasuk pengeluaran pending); baris dibuang saat pengeluaran dibatalkan.
CREATE TABLE IF NOT EXISTS warehouse_dispatch_serials (
  dispatch_id VARCHAR(100) NOT NULL,
  order_id VARCHAR(100) NOT NULL,
  serial_id VARCHAR(100) NOT NULL,
  serial VARCHAR(64) NOT NULL,
  seq INT NOT NULL,
  created_new TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (dispatch_id, seq),
  UNIQUE KEY warehouse_dispatch_serials_order_serial (order_id, serial_id),
  KEY warehouse_dispatch_serials_serial (serial_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
