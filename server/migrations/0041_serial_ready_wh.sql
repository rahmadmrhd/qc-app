-- Catat ready (Keluar Gudang): pengeluaran tanpa No SO. Expand-only, idempoten.
-- kind: 'order' (bawaan, pengeluaran ke SO) atau 'ready'; bu_id terisi hanya untuk 'ready'
-- (pengeluaran ready tidak punya SO yang membawa BU), order_id kosong ('') untuk 'ready'.
ALTER TABLE warehouse_dispatches ADD COLUMN IF NOT EXISTS kind VARCHAR(8) NOT NULL DEFAULT 'order';
ALTER TABLE warehouse_dispatches ADD COLUMN IF NOT EXISTS bu_id VARCHAR(100) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS warehouse_dispatches_kind_bu ON warehouse_dispatches (kind, bu_id, created_at);
