-- Menghapus `external_id` (id MySQL era sinkron QC Desktop) dari `brands` dan `items`, beserta indeksnya. Sejak modul
-- sinkron dihapus (migrasi 0002) tidak ada kode yang mengisinya, dan belum ada item di staging maupun production.
--
-- PENGECUALIAN ATURAN EXPAND -> CONTRACT (dicatat 2026-11-08, keputusan pemilik produk): sama seperti 0002, kolom dihapus
-- dalam rilis yang sama dengan penghapusan kodenya. Risiko yang diketahui: pengembalian otomatis `deploy.sh` hanya
-- mengganti image dan TIDAK membatalkan migrasi, sehingga image lama (yang masih menulis `external_id`) gagal menulis
-- merk dan item di atas skema ini. Bila deploy gagal setelah migrasi ini diterapkan, perbaiki ke depan (fix forward),
-- jangan kembali ke image sebelumnya. Lihat `docs/ci-cd.md` ("Migrasi basis data dan pengembalian").
--
-- Idempoten: aman dijalankan ulang (DDL MariaDB tidak transaksional).
ALTER TABLE brands DROP INDEX IF EXISTS brands_external_id;
ALTER TABLE brands DROP COLUMN IF EXISTS external_id;
ALTER TABLE items DROP INDEX IF EXISTS items_external_id;
ALTER TABLE items DROP COLUMN IF EXISTS external_id;
