# Verifikasi cadangan database (uji pemulihan otomatis)

Status: dibangun 2026-11-27 (cabang `feat/verifikasi-cadangan-db`); menunggu review dan langkah manual pemilik di VPS
(bagian 7). Permintaan pemilik: (1) memeriksa berkas cadangan database TERAKHIR, (2) menguji bahwa SQL-nya benar-benar
bisa dijalankan dan data kembali utuh (uji pemulihan penuh ke skema sementara), (3) berjalan otomatis SETELAH cadangan
harian selesai. Alasan: semua cadangan manual di VPS sudah dihapus, jadi satu-satunya cadangan adalah cadangan harian
otomatis, dan cadangan yang tidak pernah diuji belum bisa dianggap cadangan.

## 1. Yang sudah ada dan dipakai ulang

`modules/backup/`: `dump.ts` (dump, `fileDigest`), `upload.ts` (Drive), `service.ts` (job `db_backup`), `alert.ts`
(`sendThrottled`, maks. sekali per 12 jam per jenis), `restore.ts` (`gunzipTo`, `createRestoreDb`, `createMariadbImporter`,
`purgeStaleRestoreDirs`), `dump-inspect.ts` (pemeriksa isi dump). Verifikasi menambah modul, bukan menulis ulang.

## 2. Keputusan desain

1. **Sumber kebenaran "data kembali utuh" = isi berkas dump sendiri, bukan basis data hidup.** Dump adalah snapshot
   `--single-transaction`; basis data hidup terus berubah sesudahnya (tabel `settings` ditulis SETELAH dump selesai, `jobs`
   bertambah, `rate_limits` terus bergerak; `docs/setup-google.md` S8 sudah mencatat selisih ini). Membandingkan jumlah
   baris dengan skema hidup akan gagal tiap malam. Karena itu `dump-scan.ts` menghitung tuple per tabel dari pernyataan
   `INSERT ... VALUES (...),(...);` selagi berkas di-gunzip (streaming, memori konstan, tahan string berisi `),(`, `\'`,
   `\\`, `''`, dan potongan baca di mana saja) dan mencatat nama tabel dari `CREATE TABLE`. Setelah impor, tabel hasil
   pemulihan HARUS sama persis dengan daftar `CREATE TABLE` dump dan `COUNT(*)` tiap tabel HARUS sama persis dengan
   jumlah tuple dump. Ini tidak terganggu perubahan data hidup dan menangkap impor yang terpotong, baris hilang, atau
   pernyataan yang diam-diam tidak jalan.
2. **Perbandingan dengan skema hidup hanya untuk hal yang stabil antar deploy:** struktur tabel (kolom berurutan, tipe,
   nullability, default, ekspresi kolom virtual, kolasi, dan indeks) dan daftar `schema_migrations`. Bila daftar migrasi
   sama, beda struktur = `failed`; bila beda (ada migrasi sejak dump), beda struktur hanya jadi catatan. Selisih jumlah baris
   dengan skema hidup HANYA catatan informasi. `CHECKSUM TABLE` tidak dipakai (tidak stabil pada kolom virtual
   terindeks seperti `stickers.name_key`).
3. **Keutuhan berkas lokal dan kecocokan dengan Drive:** `fileDigest` lokal (MD5, SHA-256, ukuran) dicocokkan dengan entri
   Drive bernama sama (`md5Checksum`, `size`, `appProperties.sha256`); gunzip penuh dan baris penutup "Dump completed"
   diperiksa sebelum skema apa pun dibuat (jalur yang sama dengan CLI pemulihan). Berkas Drive tidak diunduh ulang: MD5 yang
   dihitung Drive sendiri cocok dengan MD5 lokal berarti byte-nya sama.
4. **Tiga status hasil.** `ok`; `failed` = cadangan atau pemulihan bermasalah (berkas rusak, tidak ada di Drive, impor
   gagal, jumlah baris/tabel/struktur tidak sama): FINAL, tidak diulang (isi cadangan tak berubah dan basis data hidup hanya
   makin menyimpang) dan memicu peringatan; `error` = pemeriksaan tak bisa diselesaikan (tidak ada berkas lokal, Drive tak
   terjangkau, ruang disk kurang, galat tak terduga): dicoba lagi paling banyak 3 kali dengan jeda minimal 30 menit.
5. **Hasil buruk adalah HASIL, bukan kegagalan job.** `consumer.ts` memperlakukan semua galat non-`AppError` sebagai
   sementara dan mengulang langkah sampai 3 kali; kalau verifikasi yang tidak cocok dilempar sebagai galat, runner akan
   mengimpor seluruh basis data tiga kali pada MariaDB produksi yang memorinya terbatas. Handler menangkap semuanya,
   menyimpan hasil, memeriksa peringatan, lalu menyelesaikan job normal. Pengulangan atas `error` diatur penjadwal
   (`isVerifyDue`), bukan runner.
6. **Job tersendiri `backup_verify`** (bukan langkah tambahan `db_backup`): cadangan yang sudah aman tidak ikut gagal
   karena verifikasi. Dipasang dua jalur, keduanya lewat `scheduleBackupVerifyJob`: (a) akhir langkah retensi `db_backup`
   (verifikasi langsung SESUDAH cadangan, bukan pada jam tetap yang bisa mendahuluinya); (b) langkah penjadwal jam-an
   (mengejar ketinggalan setelah restart, dan percobaan ulang atas `error`). Dasarnya nama cadangan terakhir yang berhasil
   (`BACKUP_LAST_SUCCESS_NAME`, ditulis `db_backup` sesudah unggahan terverifikasi) dibanding hasil tersimpan
   (`BACKUP_VERIFY_RESULT`); satu job aktif pada satu waktu. Cadangan yang lebih tua dari 8 jam tidak lagi dijadwalkan
   (verifikasi menyertai cadangan malam, bukan jalan siang hari saat deploy), dan peringatan di bagian 4 menutup celahnya.
7. **Skema sementara `qc_restore_verify_<epoch detik>_<6 heksa>`.** Awalan `qc_restore_` WAJIB: pengguna pemulihan
   terbatas `qc_restore` hanya punya hak pada `qc\_restore\_%` (docs/setup-google.md S8); awalan lain butuh GRANT baru di
   VPS. Skema SELALU dibuang di `finally` (juga saat gagal). Bila proses terbunuh di tengah (Docker memberi 10 detik saat
   stop, impor bisa lebih lama), skema yatim yang lebih tua dari 40 menit (batas impor 30 menit + margin) disapu pada awal
   verifikasi berikutnya; folder kerja `verify-tmp/run-*` di volume cadangan disapu dengan fungsi yang sama dengan CLI
   (awalan berbeda, folder `job-*` milik CLI tak tersentuh).
8. **Pengaman beban (MariaDB produksi `mem_limit` 384m, riwayat OOM):** satu job pada satu waktu (runner), impor oleh
   `mariadb` dengan batas waktu 30 menit (proses dibunuh bila lewat), pemeriksaan ruang disk volume cadangan sebelum
   membuka dump (butuh sekitar 12x ukuran gzip + 256 MB), satu skema sementara, dan jumlah baris skema hidup hanya
   `COUNT(*)` per tabel (tanpa pemindaian isi).
9. **Hanya produksi.** `verifyEnabled` = `BACKUP_ENABLED` (produksi dengan Google, bukan `false`) DAN `BACKUP_VERIFY`
   terpasang (`RESTORE_DATABASE_URL` sah). Dev dan tes tidak pernah memulihkan apa pun kecuali menyuntik `BACKUP_VERIFY`
   sendiri; staging (`BACKUP_ENABLED=false`) ikut mati.
10. **Pemakaian ulang `restore.ts`:** `gunzipTo` kini diekspor dan menerima pemindai opsional; `createMariadbImporter`
    menerima `timeoutMs`; `purgeStaleRestoreDirs` menerima `prefix`. Perilaku CLI `restore-backup.ts` tidak berubah.

## 3. Alur (`runBackupVerification`, `verify.ts`)

1. Pilih berkas: nama dari `BACKUP_LAST_SUCCESS_NAME` (atau terbaru di folder lokal). Tidak ada = `error`.
2. Keutuhan: digest lokal, cocokkan dengan Drive (bagian 2 butir 3). Cek ruang disk.
3. Sapu skema sementara yatim dan folder kerja lama; buat folder kerja `run-*`.
4. `gunzipTo` (gunzip penuh + pemeriksa isi dump + pemindai tuple). Dump tanpa `CREATE TABLE` = `failed`.
5. Buat skema sementara, impor (`mariadb --binary-mode`), batas waktu 30 menit.
6. Bandingkan tabel dan jumlah baris dengan dump (kriteria utama); catat selisih dengan skema hidup (informasi).
7. Bandingkan struktur dan daftar migrasi dengan skema hidup (bagian 2 butir 2).
8. `finally`: buang skema sementara dan folder kerja. Kembalikan `VerifyResult` (fungsi tidak pernah melempar).

## 4. Hasil tersimpan dan peringatan

- `BACKUP_VERIFY_RESULT` (tabel `settings`, JSON): status, nama cadangan, percobaan, waktu mulai/selesai, durasi, ringkasan,
  rincian kegagalan (maks. 11), catatan, jumlah tabel/baris/byte. Daftar dipangkas agar kecil.
- `checkBackupVerifyAlerts` (`verify-alert.ts`, langkah penjadwal jam-an DAN seketika setelah job mencatat hasil), memakai
  `sendThrottled` (maks. sekali per 12 jam per jenis, kunci `BACKUP_VERIFY_FAILED_ALERT_LAST_AT` dan
  `BACKUP_VERIFY_MISSING_ALERT_LAST_AT`):
  - **gagal:** hasil cadangan terakhir `failed`, atau `error` setelah 3 percobaan. Isi: ringkasan dan rincian.
  - **belum diverifikasi:** cadangan terakhir berhasil lebih dari 12 jam lalu tetapi tidak ada hasil untuknya (job tidak
    berjalan, masih `error` menunggu ulang, atau `RESTORE_DATABASE_URL` belum diisi; pesan menyebut variabel itu bila
    `BACKUP_VERIFY` tidak terpasang). Ini sengaja berbunyi (tidak diam) bila kredensial belum diisi: tanpa itu cadangan tak
    pernah teruji dan pemilik tak tahu.
- Hanya bila `BACKUP_ENABLED` dan SMTP/`ALERT_TO` terkonfigurasi (pola `checkBackupAlerts`); gagal kirim tidak dilempar.

## 5. Konfigurasi baru

`RESTORE_DATABASE_URL` (opsional): `mysql://qc_restore:<sandi-heksa>@qc-db:3306/`. Ditambah di `server/src/config.ts`
(`restoreDatabaseUrl`), `deploy/compose.yml`, `deploy/.env.example`, `server/.env.example` (dijaga `deploy-files.test.ts`).
Kosong atau tidak valid = verifikasi mati dengan satu baris log (start tidak gagal, pola SMTP). Variabel yang sama dipakai
CLI `restore-backup.ts` (sebagai URL admin bawaan) sehingga `docker exec` tak perlu lagi `-e`.

## 6. CLI manual

`scripts/verify-backup.ts` (ikut image, `docker exec <kontainer-app> bun /app/scripts/verify-backup.ts [--file NAMA] [--record]`):
logika yang sama dengan job. `--record` menyimpan hasil seperti job otomatis. Dipakai untuk uji pertama kali di jam
pilihan pemilik, tanpa menunggu cadangan malam berikutnya.

## 7. Langkah manual pemilik (tidak dibawa CI)

1. Pastikan pengguna `qc_restore` ada dengan hak `qc\_restore\_%` + SELECT pada skema aplikasi (docs/setup-google.md S8).
2. Isi `RESTORE_DATABASE_URL` di `.env` VPS production, `docker compose up -d` SEBELUM merge `dev` -> `main` (atau segera
   sesudahnya; sebelum diisi, peringatan "belum diverifikasi" akan berbunyi 12 jam sesudah cadangan berikutnya).
3. Salin `deploy/compose.yml` terbaru ke VPS (variabel baru di `environment`).
4. Uji pertama: `docker exec <app> bun /app/scripts/verify-backup.ts --record` di luar jam sibuk (beban: mengimpor seluruh
   basis data; dump nyata sekitar 37 MB gzip, tabel terbesar `serials` dan `serial_events`).

## 8. Batas dan risiko yang diterima

- Runner menjalankan satu job pada satu waktu: impor berdurasi menit menahan `qr_export` dan `serial_proof` selama itu
  (cadangan memakai jalur yang sama; preseden). Berjalan tepat sesudah cadangan malam (sekitar 02:xx WIB).
- Verifikasi membuktikan jumlah baris, tabel, struktur, dan impor tanpa galat; ia TIDAK membandingkan isi kolom baris demi
  baris (basis data hidup berubah sejak dump, dan membandingkan isi dengan dump butuh pemindai SQL penuh). Korupsi isi
  yang mempertahankan jumlah baris (mis. salah kolasi teks) tidak terdeteksi. Perluasan yang mungkin: sidik jari isi untuk
  tabel stabil (`users`, `roles`, `items`) dibandingkan dengan skema hidup; belum dikerjakan (perlu keputusan toleransi).
- Pemindai tuple mengandalkan format `mariadb-dump` (satu pernyataan per baris, baris baru dalam data diloloskan); dump
  dengan format lain (mis. `--skip-extended-insert` memakai baris per tuple tetap benar, tetapi baris baru literal tidak)
  dapat memberi hitungan keliru dan tampil sebagai `failed` palsu; dijaga tes dan uji nyata pertama.
- Disk basis data tidak terlihat dari kontainer aplikasi; hanya ruang volume cadangan yang diperiksa. Skema sementara
  menggandakan ukuran data sementara (disk bebas VPS sekitar 6 GB saat spek ini ditulis).
- `RESTORE_DATABASE_URL` ada di lingkungan kontainer `qc-app` (rahasia berhak terbatas, sejajar dengan `DATABASE_URL`).

## 9. Pengujian

`dump-scan.test.ts` (string tricky, potongan 1 karakter), `verify.test.ts` (MariaDB nyata lewat tunnel: sukses, jumlah baris
kurang, tabel hilang, struktur beda/migrasi beda, impor melempar, gzip terpotong, tanpa baris penutup, MD5 beda dengan
Drive, tidak ada di Drive, isi dump berbahaya, tanpa berkas lokal, skema yatim, `isVerifyDue`, rantai job dari
`db_backup`, hasil buruk tidak diulang runner, percobaan ulang atas `error`, mati tanpa konfigurasi/`BACKUP_ENABLED`; skema
sementara dibuang di SETIAP jalur), `verify-alert.test.ts`, `verify-ports.test.ts`, `config.test.ts`, `backup-switch.test.ts`,
`deploy-files.test.ts`.
