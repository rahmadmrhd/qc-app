-- Menghapus penghitung revisi sinkron QC Desktop: kolom `brands.sync_rev` dan `items.sync_rev`, indeksnya, dan tabel
-- `sync_state`. Modul sinkron REST (`/api/v1/sync/*`) dan kontraknya (`docs/api/desktop-sync.md`) dihapus karena QC
-- Desktop dibuat ulang (Electron, di monorepo ini) dan tidak memakai kontrak itu.
--
-- PENGECUALIAN ATURAN EXPAND -> CONTRACT (dicatat 2026-11-08, keputusan pemilik produk): migrasi ini langsung
-- MENGHAPUS kolom/tabel dalam rilis yang sama dengan penghapusan kodenya, padahal aturan proyek menunda penghapusan
-- skema sampai tidak ada image yang memakainya. Alasan: belum ada klien sinkron, belum ada item di staging maupun
-- production, jadi tidak ada data yang hilang. Risiko yang diketahui: pengembalian otomatis `deploy.sh` hanya mengganti
-- image dan TIDAK membatalkan migrasi, sehingga image lama (yang masih menulis `sync_rev`/`sync_state`) gagal menulis
-- merk dan item di atas skema ini. Bila deploy gagal setelah migrasi ini diterapkan, perbaiki ke depan (fix forward),
-- jangan kembali ke image sebelumnya. Lihat `docs/ci-cd.md` ("Migrasi basis data dan pengembalian").
--
-- Idempoten: aman dijalankan ulang (DDL MariaDB tidak transaksional).
ALTER TABLE brands DROP INDEX IF EXISTS brands_sync_rev;
ALTER TABLE brands DROP COLUMN IF EXISTS sync_rev;
ALTER TABLE items DROP INDEX IF EXISTS items_sync_rev;
ALTER TABLE items DROP COLUMN IF EXISTS sync_rev;
DROP TABLE IF EXISTS sync_state;
