-- Penjualan Gudang tanpa No SO (spek stok-ready-kardus bagian 11 butir 2). Expand-only, idempoten.
-- Pengeluaran tanpa SO tidak membuat baris `warehouse_orders`: `order_id` = id pengeluaran itu sendiri (unik per
-- pengeluaran, tidak bentrok dengan penanda '' milik pencatatan Ready), `bu_id` diisi BU pengeluaran, dan customer
-- (opsional, hanya penyaring task) disimpan di kolom di bawah. Pada pengeluaran bersatu SO kolom ini tetap kosong.
ALTER TABLE warehouse_dispatches ADD COLUMN IF NOT EXISTS customer_id VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE warehouse_dispatches ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255) NOT NULL DEFAULT '';
