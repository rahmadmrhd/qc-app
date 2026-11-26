-- Filter "Dicatat oleh" (`serials.list` createdBys) dan pilihan pencatat (`serials.creatorOptions`): mencari serial hidup
-- menurut pembuat catatan pertama tanpa memindai seluruh tabel. `serials_created_by` melayani pembaca Semua BU;
-- `serials_bu_deleted_created_by` melayani pembaca sebagian BU yang digerakkan dari BU. Expand-only, idempoten.
CREATE INDEX IF NOT EXISTS serials_created_by ON serials (created_by, deleted_at);
CREATE INDEX IF NOT EXISTS serials_bu_deleted_created_by ON serials (bu_id, deleted_at, created_by);
