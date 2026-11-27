-- Stok Ready per kardus (Keluar Gudang, spek 2026-11-27-stok-ready-kardus-design.md §4): pcs per kardus pada item, kardus
-- bernomor per (BU, item), dan serial yang sedang ada di stok ready.
--
-- EXPAND-ONLY, kompatibel mundur: satu kolom baru NOT NULL berbawaan 0 (= belum diisi) dan dua tabel baru. Image
-- sebelumnya tak membaca/menulisnya dan tetap berjalan di atas skema ini. Idempoten (IF NOT EXISTS).
ALTER TABLE items ADD COLUMN IF NOT EXISTS box_size INT NOT NULL DEFAULT 0;

-- Kardus ready. `closed_key` = '' selama kardus terbuka (masih berisi atau belum dilepas); diisi id kardus itu sendiri
-- saat kardus kosong (serial semua dilepas atau dihapus), sehingga nomor kardus yang sama dapat dipakai lagi (indeks unik tetap menjaga satu
-- kardus terbuka per nomor).
CREATE TABLE IF NOT EXISTS warehouse_ready_boxes (
  id VARCHAR(100) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  number INT NOT NULL,
  capacity INT NOT NULL,
  dispatch_id VARCHAR(100) NOT NULL,
  closed_key VARCHAR(100) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL,
  created_by VARCHAR(254) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY warehouse_ready_boxes_open (bu_id, item_id, number, closed_key),
  KEY warehouse_ready_boxes_dispatch (dispatch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Serial yang ada di stok ready. `released_dispatch_id` = '' selama masih di stok; diisi id pengeluaran Penjualan
-- yang melepasnya.
CREATE TABLE IF NOT EXISTS warehouse_ready_serials (
  serial_id VARCHAR(100) NOT NULL,
  box_id VARCHAR(100) NOT NULL,
  dispatch_id VARCHAR(100) NOT NULL,
  seq INT NOT NULL,
  released_dispatch_id VARCHAR(100) NOT NULL DEFAULT '',
  PRIMARY KEY (serial_id),
  KEY warehouse_ready_serials_box (box_id, released_dispatch_id),
  KEY warehouse_ready_serials_dispatch (dispatch_id),
  KEY warehouse_ready_serials_released (released_dispatch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
