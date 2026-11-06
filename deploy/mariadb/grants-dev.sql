-- Hak pengguna basis data lingkungan DEV (kontainer qc-dev-db). Tanpa kata sandi: berkas ini aman masuk git.
--
-- Prinsip (spek migrasi VPS §13.6): pengguna aplikasi/tes hanya berhak atas skema miliknya, TIDAK ada hak global
-- (`ON *.*`). Hak CREATE/DROP database cukup lewat hak pada POLA skema; `qc_test` hanya dapat membuat dan menghapus
-- skema bernama `qc_test_%` (skema tes sementara dan `qc_test_template`), sehingga tidak dapat menyentuh `qc_dev`
-- maupun skema lingkungan lain di server yang sama.
--
-- Pemakaian (sekali, atau saat kontainer dibangun ulang), sebagai root di dalam kontainer:
--   docker exec -i qc-dev-db mariadb -uroot -p < deploy/mariadb/grants-dev.sql
-- Pengguna dibuat TERPISAH lebih dulu dengan kata sandi dari /opt/qc/dev/.env (jangan menaruh kata sandi di berkas ini):
--   CREATE USER IF NOT EXISTS 'qc_dev'@'%'  IDENTIFIED BY '<QC_DB_PASSWORD>';
--   CREATE USER IF NOT EXISTS 'qc_test'@'%' IDENTIFIED BY '<kata sandi qc_test>';

CREATE DATABASE IF NOT EXISTS `qc_dev` CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin;

-- Aplikasi dev + `bun run db:seed`: hanya skema qc_dev.
GRANT ALL PRIVILEGES ON `qc_dev`.* TO 'qc_dev'@'%';

-- Tes server: skema `qc_test_<epoch>_<acak>` sementara dan `qc_test_template`. `\_` = garis bawah harfiah pada
-- pola GRANT (tanpa escape, `_` berarti "satu karakter apa saja" dan hak meluas ke skema lain).
GRANT ALL PRIVILEGES ON `qc\_test\_%`.* TO 'qc_test'@'%';

FLUSH PRIVILEGES;

-- Verifikasi (hasil harus hanya memuat dua pola di atas, tanpa `ON *.*` selain USAGE):
--   SHOW GRANTS FOR 'qc_test'@'%';
--   SHOW GRANTS FOR 'qc_dev'@'%';
-- Hasil terakhir diperiksa 2026-11-05 (hanya baris GRANT):
--   GRANT USAGE ON *.* TO `qc_test`@`%` IDENTIFIED BY PASSWORD '***'
--   GRANT ALL PRIVILEGES ON `qc\_test\_%`.* TO `qc_test`@`%`
--   GRANT USAGE ON *.* TO `qc_dev`@`%` IDENTIFIED BY PASSWORD '***'
--   GRANT ALL PRIVILEGES ON `qc_dev`.* TO `qc_dev`@`%`
