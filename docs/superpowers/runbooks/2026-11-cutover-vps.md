# Runbook cutover: Apps Script + Sheets → Bun + MariaDB di VPS

| | |
|---|---|
| **Rencana** | `docs/superpowers/plans/2026-11-05-migrasi-vps-docker-rest.md` Task 33 dan 34 |
| **Spek** | `docs/superpowers/specs/2026-11-05-migrasi-vps-docker-rest-design.md` §13 (branch dan koeksistensi), §14 (data dan cutover), §19 butir 9 (data uji dibuang) |
| **Menggantikan** | `docs/superpowers/runbooks/2026-10-cutover-cloudflare.md` (rencana Cloudflare dibatalkan 2026-11-05) |
| **Status** | **Draf, belum pernah dijalankan.** Tidak ada langkah di sini yang dieksekusi oleh penulisnya; gladi (Fase 0) wajib mulus dua kali berturut-turut sebelum hari-H |
| **Lingkungan** | Staging: `https://qc-dev.rhd.my.id`, folder VPS `/root/apps/qc-app/dev`, kontainer `qc-staging-db` / `qc-staging-app`, skema `qc_dev`. Production: `https://qc.rhd.my.id`, folder VPS `/root/apps/qc-app/exec`, kontainer `qc-exec-db` / `qc-exec-app`, skema `qc_exec` (nama dari `deploy/compose.yml`, `docs/deploy-vps.md`) |

## Cakupan data (keputusan pemilik 2026-11-06, spek §14 dan §19 butir 9)

- **Diimpor**: modul akses (`users`, `roles`, `locations`, `audit_log`), QR (`qr_designs`, `qr_documents`, `qr_defaults`, `qr_presets`), berkas logo QR (`files` dengan `owner_type` `qrlogo` atau kosong), dan penghitung (`sync_state`; `counters` `st:YYYYMMDD`).
- **Dibuang, tidak dimigrasi** (data uji yang belum pernah dipakai): `handovers` (beserta komentar), `items`, `brands`, `customers`, dan `files` milik item (`owner_type = item`). Tabel itu dikosongkan di target.
- **Gerbang pembuangan**: `import-sheets.ts` dan `verify-import.ts` BERHENTI (kode keluar 1, tanpa `import.sql`) selama dump masih berisi baris di tabel yang dibuang dan pemilik belum menyetujui isinya lewat berkas persetujuan (`--discard-approval`). Persetujuan terikat pada jumlah baris dan checksum isi: dump yang berubah sesudah disetujui membatalkannya. Pemilik memeriksa `discarded` di `report.json` (jumlah baris, rentang tanggal, pembuat); bila ada yang terlihat dipakai sungguhan, JANGAN menyetujui: berhenti dan putuskan bersama pemilik.
- Berkas gambar item di Drive TIDAK dihapus (dibiarkan yatim; pemilik boleh membersihkannya manual kelak).

Tanda: **[pemilik]** hanya bisa dikerjakan pemilik (rahasia, pengaturan akun, persetujuan, koordinasi orang lain). **[agen]** boleh dikerjakan agen atas permintaan pemilik. **[bersama]** agen menjalankan, pemilik mengamati dan memutuskan. **Setiap langkah bertanda "atas persetujuan pemilik"**: tidak ada langkah yang dijalankan tanpa jawaban "ya" eksplisit dari pemilik untuk langkah itu (persetujuan per langkah dan per sesi, tidak berlaku untuk langkah berikutnya).

Aturan umum:
- Jangan menempel rahasia ke obrolan atau repositori. Kata sandi database, `.env`, dan kunci service account dikerjakan **pemilik** di VPS/terminalnya sendiri; agen tidak membacanya.
- `dump.json`, `import.sql`, `report.json` berisi data pengguna (email, audit): simpan di luar repositori, izin berkas 600, hapus salinan kerja setelah cutover stabil (simpan satu arsip dump final di tempat aman pilihan pemilik).
- Catat waktu mulai dan selesai tiap langkah di tabel catatan paling bawah.
- Bila ada langkah gagal sebelum pengguna dialihkan (langkah H11), jalan mundur = tidak ada yang berubah bagi pengguna.

## PERINGATAN urutan: merge memicu deploy

- **Merge PR ke `dev` atau `main` memicu `deploy.yml` (deploy GAS lama) selama berkas itu masih ada** (pemicu `pull_request_target` `closed` pada base `dev`/`main`: `dev` ke `/dev`, `main` ke `/exec`; `docs/ci-cd.md`). Karena itu `deploy.yml` dihapus DALAM PR cutover yang sama dengan penggabungan (T34), dan sebelum itu **branch kerja `feat/migrasi-cloudflare` TIDAK pernah di-merge ke `main` atau `dev`** (kode FE REST tak bisa jalan di GAS). Pengaman tambahan yang disarankan sebelum menggabungkan PR cutover **[pemilik, atas persetujuan pemilik]**: di GitHub Actions nonaktifkan workflow "Deploy GAS" (Disable workflow; dapat diaktifkan lagi) atau pasang *Required reviewers* pada environment `gas-exec`, agar deploy GAS yang tak sengaja tertahan. **[verifikasi]** apakah `pull_request_target` memakai `deploy.yml` dari base SEBELUM atau SESUDAH penggabungan; jangan mengandalkan penghapusan berkas saja.
- **PR kecil `READ_ONLY` ke `main` MEMANG memicu `deploy.yml` (target `exec`)**: itu yang diinginkan, karena itulah cara bendera sampai ke aplikasi GAS lama. `deploy-server.yml` tidak ikut jalan karena berkas itu belum ada di `origin/main` sebelum cutover (`docs/ci-cd.md`: workflow hanya berlaku bila ada di branch yang dipush; PR itu juga hanya menyentuh `gas/**` dan dokumen, yang ada di `paths-ignore`, tetapi alasan utamanya berkasnya belum ada).
- **Push ke `main` men-deploy production (`deploy-server.yml`, environment `exec`)** dan push ke `dev` atau `feat/migrasi-cloudflare` men-deploy staging. Merge PR cutover ke `main` otomatis memperbarui image production: itu perilaku normal, bukan kejutan, tetapi terjadi SETELAH impor selesai (lihat H12).

---

## Fase 0: gladi di staging (ulangi sampai mulus dua kali berturut-turut)

Tujuan: membuktikan dump, impor, verifikasi, dan fitur dengan salinan data nyata, mengukur waktu tempuh, dan membuktikan pemulihan cadangan.

Prasyarat gladi:
1. Staging berjalan sehat (T27–T29: `docs/deploy-vps.md`), skema `qc_dev` sudah bermigrasi (qc-app menjalankan migrasi saat start).
2. Klien Google langsung selesai (T30a): spreadsheet data tunggal dibagikan ke service account sebagai Editor, folder Drive QR dan dokumen QR dibagikan ke service account, kunci service account terpasang di staging. **[menunggu T30a: rincian di `docs/setup-google.md`]**
3. Sumber dump: pembacaan Sheets lewat klien Google (`sheetsDump`) **[menunggu T30a]**. Skrip impor dan verifikasi sudah siap dan membaca `dump.json` lokal (`{"tables": {"<sheet>": [[header...], [baris...]]}}`); setelah T30a hanya sumbernya yang diganti.

| # | Langkah | Perintah / cara | Pelaksana |
|---|---|---|---|
| G1 | Ambil dump Sheets produksi (hanya baca) ke `dump.json` di luar repositori | `sheetsDump` **[menunggu T30a]** | agen, atas persetujuan pemilik |
| G2 | Hasilkan laporan impor (belum ada persetujuan: diharapkan kode keluar 1) | `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json --reset` | agen, atas persetujuan pemilik |
| G3 | **Periksa data yang akan dibuang**: buka `report.json`, bagian `discarded` (jumlah baris, `createdFirst`/`updatedLast`, `creators`, `checksum`). Bila semuanya data uji, salin `approvalTemplate` ke `discard-approval.json` dan isi `approvedBy` (pemilik) dan `approvedOn` (tanggal absolut `YYYY-MM-DD`). Bila ada yang terlihat dipakai sungguhan: BERHENTI, tanya pemilik | manual | pemilik memutuskan |
| G4 | Ulangi impor dengan persetujuan | `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json --reset --discard-approval discard-approval.json` (kode keluar 0). Bila 1 lagi: baca galat di `report.json`, perbaiki di Sheets atau tulis `excludes.json` (`[{"table":"locations","row":4}]`) lalu ulangi dari G1 | agen; pemilik memutuskan pengecualian |
| G5 | Salin `import.sql` ke VPS (izin 600) dan terapkan ke staging (satu transaksi: galat = tidak ada yang tersimpan) | `cd /root/apps/qc-app/dev && set -a && . ./.env && set +a && MYSQL_PWD="$QC_DB_PASSWORD" docker exec -i -e MYSQL_PWD qc-staging-db mariadb --default-character-set=utf8mb4 -u qc_dev qc_dev < import.sql` (kata sandi dibaca dari `.env` tanpa dicetak; `-e MYSQL_PWD` TANPA nilai agar kata sandi tidak muncul di argumen proses yang terlihat lewat `ps`). Atomik: **[verifikasi]** diuji lewat driver mysql2 (multi-pernyataan), belum lewat klien `mariadb` sungguhan; cek di gladi bahwa galat di tengah berkas tidak meninggalkan baris | pemilik (rahasia), agen mengamati |
| G6 | Verifikasi dari mesin pengembang lewat terowongan SSH sementara ke port loopback DB staging (nilai `DB_PORT` di `.env` staging) | tutup terowongan sesudahnya; isi variabel dari prompt tanpa gema agar kata sandi tidak masuk riwayat shell (`read -rs -p 'Kata sandi DB: ' DBPW; export QC_IMPORT_DB_URL="mysql://qc_dev:${DBPW}@127.0.0.1:<port-lokal>/qc_dev"; unset DBPW`; kata sandi dengan karakter khusus harus di-URL-encode), lalu `bun run scripts/migrate/verify-import.ts --dump dump.json --discard-approval discard-approval.json --report verify.json` (kode keluar 0 = lulus; kata sandi hanya lewat variabel lingkungan, tidak pernah argumen) | pemilik (rahasia), agen mengamati |
| G7 | Uji fitur di `https://qc-dev.rhd.my.id` dengan data nyata: masuk dengan Google, pengaturan akses, QR (daftar, pratinjau, ekspor sampai job `done`, logo, PDF sumber), `docs/e2e-checklist.md` bagian yang berlaku | manual | pemilik |
| G8 | **Uji pemulihan cadangan** (T30/T31): picu dump malam di staging, pulihkan ke skema sementara `qc_restore_check`, bandingkan jumlah baris per tabel, hapus skema itu | `scripts/restore-backup.ts` **[menunggu T31]** | agen, atas persetujuan pemilik |
| G9 | Catat waktu tiap langkah di tabel catatan bawah; ulangi sampai dua kali mulus | | agen |

Gladi memakai `--reset` (mengosongkan tabel target: HANYA staging). **JANGAN pernah memakai `--reset` di production.**

Syarat lulus gladi: `verify-import` lulus (kode keluar 0) dua kali berturut-turut; uji fitur hijau; pemulihan cadangan terbukti; waktu tempuh tercatat.

---

## T-7 hari: syarat siap (semua harus ya)

- [ ] Gladi mulus dua kali berturut-turut.
- [ ] **PR kecil `READ_ONLY` ke `origin/main` sudah digabung** dan bendera aktif di aplikasi GAS `/exec` **[T34; atas persetujuan pemilik; hanya ditulis di sini, belum dieksekusi]**: branch baru dari `origin/main`, bawa hanya komit bendera (`gas/src/core/read-only.ts`, tes, pemanggilnya di router/sinkron, dan `docs/setup-google.md` §7e) dari branch kerja; `bun run check` hijau; merge memicu `deploy.yml` (target `exec`). Uji: dengan Script Property `READ_ONLY=1` semua RPC tulis dan sinkron tulis ditolak `UNAVAILABLE`, baca tetap jalan. Catatan: trigger `cleanupQrPdfs` tidak ikut dibekukan.
- [ ] Stack production di VPS siap tetapi **belum menerima pengguna**: `/root/apps/qc-app/exec` terisi (`.env` rahasia baru, kunci service account), skema `qc_exec` dan pengguna `qc_exec` dibuat, image yang sama dengan hasil merge cutover berjalan (bangun lokal `qc-app:local-<sha>`, `docs/deploy-vps.md` §7, atau tag GHCR) dan **sudah bermigrasi** (qc-app menjalankan migrasi saat start; impor butuh skema itu), `/api/ping` sehat dari dalam VPS, semua tabel masih kosong.
- [ ] nginx production (`qc.rhd.my.id`) ditulis tetapi **belum diaktifkan**; DNS `qc` belum dialihkan; URI redirect `https://qc.rhd.my.id/auth/callback` sudah terdaftar di Google Cloud Console (klien OAuth yang sama).
- [ ] Folder Drive QR dan dokumen QR (id di `.env` production) dibagikan ke service account sebagai Editor; id Drive di dump tetap berlaku (berkas tidak dipindah).
- [ ] Cadangan malam berjalan di staging dan pemulihannya terbukti (G8); peringatan email diuji.
- [ ] Pemelihara QC Desktop dihubungi: kontrak versi 2 REST di `https://qc.rhd.my.id/api/v1/sync/*` dengan token Bearer (`docs/api/desktop-sync.md`); belum dipakai klien mana pun, jadi tidak ada jendela sinkron yang harus dijaga selain memberi tahu.
- [ ] **[pemilik]** Jendela pemeliharaan diumumkan ke pengguna (tanggal, jam, lama perkiraan dari catatan gladi); pemilik tersedia sepanjang jendela (ia yang menyetujui isi `discarded` di H5).
- [ ] Rencana jalan mundur di bawah dibaca bersama.

---

## Hari-H

| # | Langkah | Detail | Pelaksana |
|---|---|---|---|
| H1 | Umumkan jendela dimulai; minta QC Desktop **berhenti sinkron** | | pemilik |
| H2 | **Bekukan aplikasi lama** | Set Script Property `READ_ONLY=1` di proyek Apps Script; tunggu tulis terakhir selesai (±1 menit); uji satu tulis ditolak `UNAVAILABLE` dan baca tetap jalan. Mulai jendela tulis-beku (catat jam) | pemilik, atas persetujuan pemilik |
| H3 | Dump final Sheets | `sheetsDump` **[menunggu T30a]** ke `dump.json` di luar repositori; simpan satu salinan arsip | agen, atas persetujuan pemilik |
| H4 | Laporan impor | `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json` **tanpa `--reset`** (kode keluar 1 bila `discarded` berisi: itu diharapkan) | agen |
| H5 | **Persetujuan pembuangan atas dump FINAL** | Pemilik memeriksa `discarded` di `report.json` (isi dump final dapat berbeda dari gladi; persetujuan gladi tidak berlaku karena checksum). Bila hanya data uji: tulis `discard-approval.json` (`approvedBy`, `approvedOn`); bila ada yang dipakai sungguhan: BERHENTI (jalan mundur) | pemilik memutuskan |
| H6 | Hasilkan `import.sql` | Ulangi H4 dengan `--discard-approval discard-approval.json` (kode keluar 0); baca `warnings`, `normalizations`, `excluded` | agen |
| H7 | Pastikan target kosong dan henti aplikasi | Hentikan `qc-exec-app` (`docker compose stop qc-app` di `/root/apps/qc-app/exec`) agar tak ada tulisan atau job selama impor; semua tabel di `qc_exec` kosong | pemilik, atas persetujuan pemilik |
| H8 | Terapkan impor ke production | Salin `import.sql` ke VPS (izin 600), lalu `set -a && . ./.env && set +a && MYSQL_PWD="$QC_DB_PASSWORD" docker exec -i -e MYSQL_PWD qc-exec-db mariadb --default-character-set=utf8mb4 -u qc_exec qc_exec < import.sql`; satu transaksi: galat = tidak ada yang tersimpan. Hapus `import.sql` dari VPS sesudahnya | pemilik, atas persetujuan pemilik |
| H9 | **Verifikasi (HARUS lulus)** | Terowongan SSH sementara ke port loopback DB production (nilai `DB_PORT` di `.env` production; tutup sesudahnya; kebijakan spek §13 butir 6 melarang terowongan permanen ke `exec`, ini sementara dan atas persetujuan pemilik) lalu isi `QC_IMPORT_DB_URL` dari prompt tanpa gema seperti G6 (jangan diketik inline) dan jalankan `bun run scripts/migrate/verify-import.ts --dump dump.json --discard-approval discard-approval.json --report verify.json` (kode keluar 0). **[verifikasi]** alternatif tanpa terowongan: jalankan pemeriksaan di kontainer sementara pada jaringan compose | pemilik (rahasia) + agen |
| H9b | Bila verifikasi gagal | Jangan lanjut. Cabut `READ_ONLY` di Apps Script (aplikasi lama utuh), kosongkan target production (hanya bila pemilik memutuskan ulang impor), analisis di `verify.json`. Pengguna tidak terdampak | pemilik |
| H10 | Nyalakan aplikasi dan smoke test | `docker compose up -d`; dari dalam VPS (`curl -sk --resolve qc.rhd.my.id:443:127.0.0.1 https://qc.rhd.my.id/api/ping`, `docs/deploy-vps.md` §12) lalu uji lengkap: masuk Google (admin), pengaturan akses (pengguna dan peran hasil impor), daftar QR, pratinjau, ekspor QR sampai job `done`, logo, `/api/v1/me`, `/api/v1/sync/ping` dengan token Desktop uji | pemilik |
| H11 | **Alihkan pengguna** | Aktifkan blok nginx production (`nginx -t` lulus baru `nginx -s reload`), alihkan DNS Cloudflare `qc` ke VPS (Proxied; SSL/TLS Full strict), umumkan URL `https://qc.rhd.my.id`; ganti URL QC Desktop ke `…/api/v1/sync` bila sudah dipakai. Sebelum langkah ini jalan mundur tidak menyentuh pengguna | pemilik, atas persetujuan pemilik |
| H12 | Tag dan PR cutover | **Tag `gas-legacy` pada `origin/main` SEBELUM merge** (titik jalan mundur). Lalu gabungkan PR cutover dari branch kerja: hapus `.github/workflows/deploy.yml` (GAS) dan daftar `feat/migrasi-cloudflare` di `deploy-server.yml`, aturan environment `dev` menjadi hanya `dev` dan `main` (`docs/ci-cd.md`, "Saat cutover"); baca PERINGATAN di atas dulu. Merge memicu deploy production dari `main` (image baru, restart singkat) | pemilik, atas persetujuan pemilik |
| H13 | Pantau 1 jam pertama | `docker logs -f qc-exec-app`, `docker stats`, `free -h`, galat 5xx di log nginx, pekerjaan latar (job QR), dump malam pertama berhasil | pemilik + agen |
| H14 | Aplikasi lama dan Sheets dibiarkan **utuh dan baca-saja** (`READ_ONLY=1` tetap) | Catat waktu selesai jendela di tabel bawah | pemilik |

---

## Jalan mundur

- **Sebelum H11** (pengguna belum dialihkan): cabut Script Property `READ_ONLY` di aplikasi lama; target production boleh dikosongkan atau dibiarkan. Tidak ada yang berubah bagi pengguna.
- **Setelah H11, sebelum ada tulisan penting baru di sistem baru**: cabut `READ_ONLY`, nonaktifkan blok nginx production (hapus symlink, `nginx -t && nginx -s reload`), kembalikan DNS, umumkan URL lama `/exec` dan kembalikan URL QC Desktop. Data baru di MariaDB diabaikan. Bila PR cutover sudah digabung (deploy GAS dihapus): pulihkan alur dari tag `gas-legacy` (periksa tag itu di mesin pengembang lalu `bun run deploy` dari sana; aplikasi lama sendiri tidak diubah selain bendera, sehingga umumnya cukup mencabut `READ_ONLY`).
- **Setelah ada tulisan penting baru di MariaDB**: tidak ada sinkron balik otomatis ke Sheets. Pemilik memutuskan manual data mana yang dipakai. Daftar tulisan sejak impor (hanya baca; ganti waktu dengan jam selesai H8, format ISO UTC): `SELECT ts, actor, action, target FROM audit_log WHERE ts > '<waktu impor>' ORDER BY id;`, perubahan QR `SELECT id, title, updated_at, updated_by FROM qr_designs WHERE updated_at > '<waktu impor>';`, dan sejenisnya untuk `qr_documents`, `qr_presets`, `qr_defaults`, `users`, `roles`, `locations`. Dump penuh MariaDB tersedia dari cadangan malam di Drive (T30). Masukkan ulang tulisan itu ke aplikasi lama secara manual atau ekspor tabel ke Spreadsheet lewat job ekspor Sheets (`server/src/modules/jobs/sheets-export.ts`; **[verifikasi]** cara memicunya dari aplikasi). Skala ±50 task/bulan (hanya QR dan akses yang hidup) membuat ini wajar; hindari kondisi ini dengan smoke test ketat (H10) dan pemantauan awal (H13).

## Setelah cutover

1. Pantau 2–4 minggu: log aplikasi, dump malam dan pembersihan cadangan, peringatan email, memori VPS (`docker stats`, `free -h`), pekerjaan latar. Catat di ledger.
2. Setelah stabil tanpa kebutuhan jalan mundur: pensiunkan `gas/`, jembatan Apps Script, dan skrip terkait (T35), perbarui `CLAUDE.md` dan dokumen yang menyebut GAS. Tag `gas-legacy` dipertahankan.
3. Hapus `dump.json`, `import.sql`, `report.json` dari mesin kerja; simpan satu arsip dump final di tempat aman pemilik.

## Catatan waktu (diisi saat gladi dan hari-H)

| Langkah | Gladi 1 | Gladi 2 | Hari-H |
|---|---|---|---|
| Dump Sheets (G1/H3) | | | |
| Laporan + persetujuan + `import.sql` (G2–G4/H4–H6) | | | |
| Impor ke MariaDB (G5/H8) | | | |
| Verifikasi (G6/H9) | | | |
| Smoke test (G7/H10) | | | |
| Pemulihan cadangan (G8) | | | |
| Total jendela tulis-beku (H2 sampai H11) | | | |
