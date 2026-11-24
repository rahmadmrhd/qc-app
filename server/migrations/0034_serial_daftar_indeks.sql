-- Daftar Serial Number (`serials.list`): urutan `created_at DESC, id DESC` untuk pengguna yang membaca SEMUA BU. Satu-
-- satunya indeks ber-`created_at` adalah `serials_bu_created (bu_id, created_at)`, yang tidak dapat menghasilkan urutan
-- lintas beberapa nilai `bu_id` (diukur 1,4-3 dtk pada 200 ribu serial, memindai seluruh tabel). Indeks ini melayani
-- `deleted_at = '' ORDER BY created_at DESC, id DESC LIMIT n` beserta kursor `(created_at, id)`.
-- Expand-only (hanya menambah indeks), idempoten.
CREATE INDEX IF NOT EXISTS serials_live_created ON serials (deleted_at, created_at, id);
