# Runbook cutover: Apps Script + Sheets → Bun + MariaDB di VPS

| | |
|---|---|
| **Rencana** | `docs/superpowers/plans/2026-11-05-migrasi-vps-docker-rest.md` Task 33 dan 34 |
| **Spek** | `docs/superpowers/specs/2026-11-05-migrasi-vps-docker-rest-design.md` §13 (branch dan koeksistensi), §14 (data dan cutover), §19 butir 9 (data uji dibuang) |
| **Menggantikan** | `docs/superpowers/runbooks/2026-10-cutover-cloudflare.md` (rencana Cloudflare dibatalkan 2026-11-05) |
| **Status** | **Draf, belum pernah dijalankan.** Tidak ada langkah di sini yang dieksekusi oleh penulisnya; gladi (Fase 0) wajib mulus dua kali berturut-turut sebelum hari-H |
| **Lingkungan** | Staging: `https://qc-dev.rhd.my.id`, folder VPS `/root/apps/qc-app/staging`, kontainer `qc-staging-db` / `qc-staging-app`, skema `qc_dev`. Production: `https://qc.rhd.my.id`, folder VPS `/root/apps/qc-app/production`, kontainer `qc-production-db` / `qc-production-app`, skema `qc_production` (nama dari `deploy/compose.yml`, `docs/deploy-vps.md`) |

## Cakupan data (keputusan pemilik 2026-11-06, spek §14 dan §19 butir 9)

- **Diimpor** (LINGKUP FINAL, keputusan pemilik 2026-11-06, spek §14 dan §19 butir 9e): `users`, `roles`, `locations`, `qr_designs`, `qr_documents`, `qr_presets`, `qr_defaults`; `files` HANYA berkas yang dirujuk tabel QR yang diimpor (logo desain `qr_designs.logo_file_id`, pustaka logo dan logo bawaan `qr_defaults`, logo bawaan `qr_presets`); `audit_log` HANYA baris yang berkaitan dengan entitas yang diimpor, yaitu aksi berkeluarga `user.*`, `role.*`, `location.*`, `qrcode.*` (keluarga = bagian `action` sebelum titik pertama; target audit berupa nama, bukan id, jadi aturannya per keluarga aksi). Aksi di luar kedua daftar (mis. `export.sheets`, kosong, ejaan lain) MENGHENTIKAN impor per baris (`AUDIT_AKSI_TAK_DIKENAL`); pemilik memutuskan lewat `excludes.json`.
- **Dibuang, tidak dimigrasi**: `handovers` (beserta komentar), `items`, `brands`, `customers` (data uji yang belum pernah dipakai); berkas `files` milik item (`owner_type = item`) dan berkas yang tak dirujuk tabel QR yang diimpor; baris `audit_log` berkeluarga `brand.*`, `item.*`, `customer.*`, `handover.*` (termasuk `*.sync.conflict`). TIDAK diimpor juga: `sync_state` dan `counters` (server baru menghitung revisi sinkron dan nomor serah terima `ST-` dari nol; sheetnya diabaikan). Semua tabel itu HARUS kosong di target (`verify-import` memeriksanya).
- **Gerbang pembuangan**: `import-sheets.ts` dan `verify-import.ts` BERHENTI (kode keluar 1, tanpa `import.sql`) selama dump masih berisi baris di tabel yang dibuang dan pemilik belum menyetujui isinya lewat berkas persetujuan (`--discard-approval`). Persetujuan terikat pada jumlah baris dan checksum isi: dump yang berubah sesudah disetujui membatalkannya. Pemilik memeriksa `discarded` di `report.json` (jumlah baris, rentang tanggal, pembuat); bila ada yang terlihat dipakai sungguhan, JANGAN menyetujui: berhenti dan putuskan bersama pemilik. Kunci ringkasan buangan di `discarded`: `handovers`, `items`, `brands`, `customers`, `files:item`, `files:tak-dirujuk`, `audit_log`.
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
- **Merge PR ke `main` men-deploy production (`deploy-server.yml`, environment `production`; `pull_request_target` merged + checkout `merge_commit_sha`) dan merge PR ke `dev` men-deploy staging**; push langsung ke `main`/`dev` TIDAK memicu (keputusan pemilik 2026-11-06, spek §11/§13.2, `docs/ci-cd.md`), dan push ke `feat/migrasi-cloudflare` men-deploy staging (sementara, sampai cutover). Merge PR cutover ke `main` otomatis memperbarui image production: itu perilaku normal, bukan kejutan, tetapi terjadi SETELAH impor selesai (lihat H12).

---

## Fase 0: gladi di staging (ulangi sampai mulus dua kali berturut-turut)

Tujuan: membuktikan dump, impor, verifikasi, dan fitur dengan salinan data nyata, mengukur waktu tempuh, dan membuktikan pemulihan cadangan.

Prasyarat gladi:
1. Staging berjalan sehat (T27–T29: `docs/deploy-vps.md`), skema `qc_dev` sudah bermigrasi (qc-app menjalankan migrasi saat start).
2. Klien Google langsung selesai (T30a): spreadsheet data tunggal dibagikan ke service account sebagai Editor, folder Drive QR dan dokumen QR dibagikan ke service account, kunci service account terpasang di staging (rincian di `docs/setup-google.md`; T30a selesai).
3. Sumber dump: CLI `scripts/migrate/dump-sheets.ts` (`bun run migrate:dump`, T33) membaca spreadsheet lewat klien Google (hanya baca; sheet `export_*` tak disentuh) dan menulis `dump.json` (`{"tables": {"<sheet>": [[header...], [baris...]]}}`) yang langsung dibaca `import-sheets.ts` dan `verify-import.ts`. Dijalankan pemilik dari mesinnya dengan berkas kunci service account lokal; cara dan jaminannya di `docs/setup-google.md` S9. **Kolom legasi `audit_log.detail`** (ditemukan di G1 nyata): header `detail` masih ada di sheet produksi walau selnya dikosongkan aplikasi lama; CLI dan `import-sheets` mengabaikannya bila kosong. Bila ada sel `detail` TERISI, CLI mencetak PERINGATAN (jumlah dan nomor baris, tanpa isi) dan `import-sheets` berhenti dengan galat `KOLOM_LEGASI_TERISI` per baris: pemilik memutuskan (perbaiki di Sheets atau kecualikan baris lewat `excludes.json`). **[verifikasi]** CLI baru diuji dengan klien Google palsu (round-trip ke `import-sheets`); pembacaan spreadsheet produksi nyata baru terbukti pada G1 gladi pertama.

| # | Langkah | Perintah / cara | Pelaksana |
|---|---|---|---|
| G1 | Ambil dump Sheets produksi (hanya baca) ke `dump.json` di luar repositori | `GOOGLE_SA_KEY_FILE=<berkas kunci lokal> GOOGLE_SPREADSHEET_ID=<id> bun run migrate:dump --out <jalur di luar repositori>/dump.json` (tambah `--force` hanya bila sengaja mengganti dump lama). Keluaran konsol: jumlah baris per sheet saja; berkas 0600 berisi data pengguna: JANGAN di-commit, simpan di luar repositori. Header sheet tak cocok membatalkan dump (tanpa berkas): perbaiki di Sheets lalu ulangi (rincian: `docs/setup-google.md` S9) | agen, atas persetujuan pemilik |
| G2 | Hasilkan laporan impor (belum ada persetujuan: diharapkan kode keluar 1) | `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json --reset` | agen, atas persetujuan pemilik |
| G3 | **Periksa data yang akan dibuang**: buka `report.json`, bagian `discarded` (jumlah baris, `createdFirst`/`updatedLast`, `creators` dan `creatorCounts` (jumlah baris per pelaku; untuk `audit_log` dari kolom `ts` dan `actor`), `checksum`). Bila semuanya data uji, salin `approvalTemplate` ke `discard-approval.json` dan isi `approvedBy` (pemilik) dan `approvedOn` (tanggal absolut `YYYY-MM-DD`). Bila ada yang terlihat dipakai sungguhan: BERHENTI, tanya pemilik | manual | pemilik memutuskan |
| G4 | Ulangi impor dengan persetujuan | `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json --reset --discard-approval discard-approval.json` (kode keluar 0). Bila 1 lagi: baca galat di `report.json`, perbaiki di Sheets atau tulis `excludes.json` (`[{"table":"locations","row":4}]`) lalu ulangi dari G1 | agen; pemilik memutuskan pengecualian |
| G5 | Salin `import.sql` ke VPS (izin 600) dan terapkan ke staging (satu transaksi: galat = tidak ada yang tersimpan) | Ikuti "Menerapkan `import.sql` di VPS" di bawah dengan `<env>` = `staging`, kontainer `qc-staging-db`, pengguna/skema `qc_dev`. Atomik: **[verifikasi]** diuji lewat driver mysql2 (multi-pernyataan), belum lewat klien `mariadb` sungguhan; cek di gladi bahwa galat di tengah berkas tidak meninggalkan baris | pemilik (rahasia), agen mengamati |
| G6 | Verifikasi di VPS (tanpa terowongan, tanpa membuka port DB), cara yang SAMA dengan H9 supaya terbukti sebelum hari-H: lihat "Cara verifikasi di VPS" di bawah, dengan folder `staging`, kontainer `qc-staging-*`, dan `--dump`/`--discard-approval` gladi | kode keluar 0 = lulus. **[verifikasi]** cara ini belum pernah dijalankan; gladi pertama yang membuktikannya. Terowongan SSH sementara dari mesin pengembang ke `127.0.0.1:<DB_PORT staging>` (hanya staging) boleh dipakai sebagai cadangan bila cara kontainer gagal: kata sandi lewat prompt tanpa gema (`read -rs`), variabel lingkungan `QC_IMPORT_DB_URL`, tidak pernah argumen | pemilik (rahasia), agen mengamati |
| G7 | Uji fitur di `https://qc-dev.rhd.my.id` dengan data nyata: masuk dengan Google, pengaturan akses, QR (daftar, pratinjau, ekspor sampai job `done`, logo, PDF sumber; **logo QR lama tampil** dan **unduh ekspor lama berhasil**, bukti id folder lama terpasang benar), `docs/e2e-checklist.md` bagian yang berlaku | manual | pemilik |
| G8 | **Uji pemulihan cadangan** (T30/T31): picu dump malam di staging, pulihkan ke skema sementara `qc_restore_check`, bandingkan jumlah baris per tabel (perbedaan di `settings` [`BACKUP_LAST_SUCCESS_DATE` ditulis sesudah dump] dan `rate_limits` [baris pembatas hidup] wajar; tabel lain harus sama, jika tidak pemulihan bermasalah), hapus skema itu | perintah nyata di `docs/setup-google.md` S8 (pengguna berhak terbatas `qc_restore`, `docker exec -e RESTORE_DATABASE_URL <kontainer-app> bun /app/scripts/restore-backup.ts --target qc_restore_check --compare-with <skema-aplikasi> --drop-after`); periksa nama/tanggal cadangan yang ditampilkan CLI | agen, atas persetujuan pemilik |
| G9 | Catat waktu tiap langkah di tabel catatan bawah; ulangi sampai dua kali mulus | | agen |

Gladi memakai `--reset` (mengosongkan tabel target: HANYA staging). **JANGAN pernah memakai `--reset` di production.**

Syarat lulus gladi: `verify-import` lulus (kode keluar 0) dua kali berturut-turut; uji fitur hijau; pemulihan cadangan terbukti; waktu tempuh tercatat.

## Menerapkan `import.sql` di VPS (G5 dan H8)

`.env` TIDAK boleh di-`source` oleh shell root (nilai berspasi seperti sandi aplikasi Google `abcd efgh ijkl mnop` dijalankan sebagai perintah, dan `$`/backtick dieksekusi atau dirusak; aturan yang sama dengan `deploy.sh`). Ambil HANYA `QC_DB_PASSWORD`, dan jangan lewat argumen proses: `MYSQL_PWD` diteruskan sebagai lingkungan (`-e MYSQL_PWD` TANPA nilai).
```bash
cd /root/apps/qc-app/<env>
PW=$(grep -E '^QC_DB_PASSWORD=' .env | tail -n1 | cut -d= -f2-)
PW=${PW%$'\r'}; dq='"'; sq="'"
# buang SATU pasang kutip yang cocok (logika yang sama dengan env_value di deploy.sh)
if [[ $PW =~ ^${dq}(.*)${dq}$ ]] || [[ $PW =~ ^${sq}(.*)${sq}$ ]]; then PW=${BASH_REMATCH[1]}; fi
MYSQL_PWD="$PW" docker exec -i -e MYSQL_PWD qc-<staging|production>-db mariadb --default-character-set=utf8mb4 -u qc_<dev|production> qc_<dev|production> < import.sql
echo "kode keluar: $?"; unset PW
```
Kode keluar 0 = selesai. Jangan `cat .env` dan jangan mencetak `$PW`.

## Cara verifikasi di VPS (G6 dan H9; tanpa terowongan)

Tujuan: menjalankan `verify-import.ts` terhadap MariaDB yang hanya terjangkau dari jaringan compose, tanpa membuka port. Kontainer sementara memakai image `qc-app` yang sama (berisi Bun, `mysql2`, `shared/`, dan `DATABASE_URL` dari compose) dan memasang baca-saja skrip verifikasi dari komit yang sama. Di bawah, `<env>` = `staging` (gladi) atau `production` (hari-H). Semua langkah **atas persetujuan pemilik**; hapus folder kerja sesudahnya karena `dump.json` berisi data pengguna.

1. **Siapkan folder kerja di VPS** (pemilik, izin ketat; uid 1000 adalah pengguna `bun` di kontainer). Dari mesin pengembang pada komit yang sama dengan image yang berjalan:
   ```bash
   ssh rhd_vps_ipv4 'install -d -m 700 -o 1000 -g 1000 /root/apps/qc-app/<env>/verify /root/apps/qc-app/<env>/verify/data'
   git archive HEAD scripts/migrate tsconfig.json | ssh rhd_vps_ipv4 'tar -x --exclude="*.test.ts" -C /root/apps/qc-app/<env>/verify'
   scp dump.json discard-approval.json rhd_vps_ipv4:/root/apps/qc-app/<env>/verify/data/
   ssh rhd_vps_ipv4 'chown -R 1000:1000 /root/apps/qc-app/<env>/verify && chmod 600 /root/apps/qc-app/<env>/verify/data/*'
   ```
2. **Jalankan** di VPS (basis data `qc-db` harus berjalan; aplikasi `qc-app` boleh berhenti seperti di H7; `--no-deps` agar tidak menyalakan layanan lain, `-T` karena SSH tanpa terminal):
   ```bash
   cd /root/apps/qc-app/<env>
   V=/root/apps/qc-app/<env>/verify
   QC_IMAGE_TAG=<tag image yang berjalan> docker compose run --rm --no-deps -T --entrypoint sh      -v "$V/scripts/migrate:/app/scripts/migrate:ro" -v "$V/tsconfig.json:/app/tsconfig.json:ro" -v "$V/data:/data"      qc-app -c 'QC_IMPORT_DB_URL="$DATABASE_URL" exec bun /app/scripts/migrate/verify-import.ts --dump /data/dump.json --discard-approval /data/discard-approval.json --report /data/verify.json'
   echo "kode keluar: $?"
   ```
   **Tag image**: `docker compose run` memakai `QC_IMAGE_TAG` dari `.env` folder itu (bukan tag kontainer yang kebetulan berjalan). `.env` staging HARUS menunjuk tag image yang berjalan, minimal `local-a39dc2e` (komit yang memuat `server/src/core/google`; tag lebih lama gagal `Cannot find module '@server/core/google/client'` karena `import-sheets` dan `verify-import` mengimpor modul itu). Periksa tag yang berjalan (`docker inspect --format '{{.Config.Image}}' <kontainer-app>`), lalu isi `QC_IMAGE_TAG=<tag>` di awal perintah seperti di atas (override sekali jalan, tanpa menyunting `.env`) atau perbarui `.env`. Perintah yang sama dipakai di G6 dan H9.
   Kode keluar 0 = lulus. Baca `$V/data/verify.json` bila gagal (hasil per tabel, yatim, penghitung, tabel buangan).
3. **Bersihkan**: `rm -r "$V"` (dump dan laporan berisi data pengguna; salin dulu `verify.json` ke mesin pengembang bila perlu).

**[verifikasi]** Belum pernah dijalankan: pemasangan `tsconfig.json` ke `/app` agar alias `@server/*` dan `@shared/*` terurai, dan batas memori kontainer (`mem_limit` compose 256m) untuk dump sesungguhnya. Bila gagal pada gladi, perbaiki cara ini di runbook SEBELUM hari-H (jangan beralih ke terowongan ke `exec`).

---

## T-7 hari: syarat siap (semua harus ya)

- [ ] Gladi mulus dua kali berturut-turut.
- [ ] **PR kecil `READ_ONLY` ke `origin/main` sudah digabung** dan bendera aktif di aplikasi GAS `/exec` **[T34; atas persetujuan pemilik; hanya ditulis di sini, belum dieksekusi]**: branch baru dari `origin/main`, bawa hanya komit bendera (`gas/src/core/read-only.ts`, tes, pemanggilnya di router/sinkron, dan `docs/setup-google.md` §7e) dari branch kerja; `bun run check` hijau; merge memicu `deploy.yml` (target `exec`). Uji: dengan Script Property `READ_ONLY=1` semua RPC tulis dan sinkron tulis ditolak `UNAVAILABLE`, baca tetap jalan. Catatan: trigger `cleanupQrPdfs` tidak ikut dibekukan.
- [ ] Stack production di VPS siap tetapi **belum menerima pengguna**: `/root/apps/qc-app/production` terisi (`.env` rahasia baru, kunci service account), skema `qc_production` dan pengguna `qc_production` dibuat, image yang sama dengan hasil merge cutover berjalan (bangun lokal `qc-app:local-<sha>`, `docs/deploy-vps.md` §7, atau tag GHCR) dan **sudah bermigrasi** (qc-app menjalankan migrasi saat start; impor butuh skema itu), `/api/ping` sehat dari dalam VPS, semua tabel masih kosong.
- [ ] nginx production (`qc.rhd.my.id`) ditulis tetapi **belum diaktifkan**; DNS `qc` belum dialihkan; URI redirect `https://qc.rhd.my.id/auth/callback` sudah terdaftar di Google Cloud Console (klien OAuth yang sama).
- [ ] **Id folder Drive lama dipindahkan ke `.env` (P1-I3; impor TIDAK menulis tabel `settings`, jadi tanpa ini logo QR lama dan unduh ekspor lama tak terbaca dan server membuat folder BARU yang kosong)**. Ambil dari Script Properties proyek Apps Script lama (hanya baca): `DRIVE_FOLDER_ID`, `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`. Isikan ke `.env` production (dan staging untuk gladi) sebagai `ITEM_IMAGES_FOLDER_ID` (dari `DRIVE_FOLDER_ID`; ini folder berkas logo QR), `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`. Bagikan ketiga folder itu ke service account sebagai Editor, ATAU pindahkan ke bawah folder induk `GOOGLE_ROOT_FOLDER_ID` TANPA mengubah id (`docs/setup-google.md` S3). Id yang terisi hanya diverifikasi; folder yang tak terjangkau = galat jelas saat `qc-app` dipakai. Checklist: ketiga variabel terisi (bukan kosong atau `ISI_OLEH_PEMILIK`) dan ketiga folder terjangkau service account; `files` hasil impor akan merujuk isi di `ITEM_IMAGES_FOLDER_ID`, jadi variabel itu kosong sementara `files` diimpor = logo tak tampil.
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
| H3 | Dump final Sheets (setelah H2, aplikasi lama beku) | `GOOGLE_SA_KEY_FILE=<berkas kunci lokal> GOOGLE_SPREADSHEET_ID=<id> bun run migrate:dump --out <jalur di luar repositori>/dump.json` (tambah `--force` hanya bila sengaja mengganti dump lama). Keluaran konsol: jumlah baris per sheet saja; berkas 0600 berisi data pengguna: JANGAN di-commit, simpan di luar repositori. Header sheet tak cocok membatalkan dump (tanpa berkas): perbaiki di Sheets lalu ulangi (rincian: `docs/setup-google.md` S9); simpan satu salinan arsip | agen, atas persetujuan pemilik |
| H4 | Laporan impor | `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json` **tanpa `--reset`** (kode keluar 1 bila `discarded` berisi: itu diharapkan) | agen |
| H5 | **Persetujuan pembuangan atas dump FINAL** | Pemilik memeriksa `discarded` di `report.json` (isi dump final dapat berbeda dari gladi; persetujuan gladi tidak berlaku karena checksum). Bila hanya data uji: tulis `discard-approval.json` (`approvedBy`, `approvedOn`); bila ada yang dipakai sungguhan: BERHENTI (jalan mundur) | pemilik memutuskan |
| H6 | Hasilkan `import.sql` | Ulangi H4 dengan `--discard-approval discard-approval.json` (kode keluar 0); baca `warnings`, `normalizations`, `excluded` | agen |
| H7 | Pastikan target kosong dan henti aplikasi | Hentikan `qc-production-app` (`docker compose stop qc-app` di `/root/apps/qc-app/production`) agar tak ada tulisan atau job selama impor; semua tabel di `qc_production` kosong | pemilik, atas persetujuan pemilik |
| H8 | Terapkan impor ke production | Salin `import.sql` ke VPS (izin 600), lalu ikuti "Menerapkan `import.sql` di VPS" di bawah dengan `<env>` = `production`, kontainer `qc-production-db`, pengguna/skema `qc_production`; satu transaksi: galat = tidak ada yang tersimpan. Hapus `import.sql` dari VPS sesudahnya | pemilik, atas persetujuan pemilik |
| H9 | **Verifikasi (HARUS lulus)** | Dijalankan DI VPS dengan kontainer sementara pada jaringan compose `production` ("Cara verifikasi di VPS" di bawah). TANPA terowongan SSH dan tanpa membuka port DB production (spek §13 butir 6: database `production` tidak dijangkau tunnel; alasan penggantian terowongan sementara 2026-11-06). Kata sandi DB tidak diketik dan tidak lewat argumen proses: `DATABASE_URL` sudah ada di lingkungan kontainer dari compose. Kode keluar 0 = lulus | pemilik, atas persetujuan pemilik; agen mengamati |
| H9b | Bila verifikasi gagal | Jangan lanjut. Cabut `READ_ONLY` di Apps Script (aplikasi lama utuh), kosongkan target production (hanya bila pemilik memutuskan ulang impor), analisis di `verify.json`. Pengguna tidak terdampak | pemilik |
| H10 | Nyalakan aplikasi dan smoke test | `docker compose up -d`; dari dalam VPS (`curl -sk --resolve qc.rhd.my.id:443:127.0.0.1 https://qc.rhd.my.id/api/ping`, `docs/deploy-vps.md` §12) lalu uji lengkap: masuk Google (admin), pengaturan akses (pengguna dan peran hasil impor), daftar QR, pratinjau, ekspor QR sampai job `done`, logo (**logo QR lama tampil**), **unduh ekspor lama berhasil**, `/api/v1/me`, `/api/v1/sync/ping` dengan token Desktop uji | pemilik |
| H11 | **Alihkan pengguna** | Aktifkan blok nginx production (`nginx -t` lulus baru `nginx -s reload`), alihkan DNS Cloudflare `qc` ke VPS (Proxied; SSL/TLS Full strict), umumkan URL `https://qc.rhd.my.id`; ganti URL QC Desktop ke `…/api/v1/sync` bila sudah dipakai. Sebelum langkah ini jalan mundur tidak menyentuh pengguna | pemilik, atas persetujuan pemilik |
| H12 | Tag dan PR cutover | **Tag `gas-legacy` pada `origin/main` SEBELUM merge** (titik jalan mundur). Lalu gabungkan PR cutover dari branch kerja: hapus `.github/workflows/deploy.yml` (GAS) dan daftar `feat/migrasi-cloudflare` di `deploy-server.yml`, aturan environment `staging` menjadi hanya branch `dev` dan `main` (`docs/ci-cd.md`, "Saat cutover"); baca PERINGATAN di atas dulu. Merge memicu deploy production dari `main` (image baru, restart singkat) | pemilik, atas persetujuan pemilik |
| H13 | Pantau 1 jam pertama | `docker logs -f qc-production-app`, `docker stats`, `free -h`, galat 5xx di log nginx, pekerjaan latar (job QR), dump malam pertama berhasil | pemilik + agen |
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
