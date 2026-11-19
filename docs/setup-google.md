# Setup Google

Dua hal dikonfigurasi di Google: **service account** (cara server Bun mengakses Google Drive dan Google Sheets; wajib untuk server di VPS) dan **klien OAuth** (login web, bagian terakhir). Aplikasi Apps Script lama dan jembatannya sudah dipensiunkan (T35); panduannya ada di tag `gas-legacy`.

## Service account (server Bun, T30a)

Server memanggil Drive v3 dan Sheets v4 langsung lewat `fetch` dengan token OAuth service account (JWT RS256 ditukar di `oauth2.googleapis.com/token`, di-cache di memori dan diperbarui sebelum kedaluwarsa). Kode: `server/src/core/google/`; antarmuka ke modul tetap `BridgeClient` (`server/src/core/bridge-client.ts`). Login Google (OAuth web) tidak berubah dan terpisah dari service account.

### S1. Buat service account dan kunci
1. https://console.cloud.google.com -> pilih project (boleh project yang sama dengan OAuth client) -> **IAM & Admin -> Service Accounts -> Create service account**, mis. `qc-server`. Tanpa peran IAM project (aksesnya diberikan lewat berbagi Drive, langkah S3).
2. **Library**: aktifkan **Google Drive API** dan **Google Sheets API** di project yang sama.
3. Buka service account itu -> **Keys -> Add key -> Create new key -> JSON**. Berkas `.json` terunduh sekali; **simpan sebagai berkas rahasia, jangan commit, jangan kirim lewat chat/GitHub, jangan tempel isinya ke `.env`**.
4. Catat **email service account** (`...@<project>.iam.gserviceaccount.com`); dipakai di langkah S3.

> Service account yang dipakai bersama proyek lain: kuota Drive 15 GB-nya ikut dipakai bersama (lihat S6). Jangan menulis email service account di berkas repositori.

### S2. Pasang berkas kunci (izin 600)
- **VPS**: salin ke `<INSTALL_DIR>/<staging|production>/secrets/google-sa.json` (VPS pribadi: `/root/apps/qc-app/...`) (lewat `scp` ke nama sementara di folder itu, bukan GitHub), lalu pasang dengan `install -m 600 -o 1000 -g 1000 <sementara> google-sa.json` (pemilik WAJIB uid 1000: kontainer berjalan sebagai pengguna `bun`, berkas milik `root` berizin 600 tidak terbaca dan semua operasi Drive/Sheets menjadi `UNAVAILABLE`; `chmod 600` saja TIDAK cukup). Compose memasangnya **baca-saja** ke kontainer sebagai `/run/secrets/google-sa.json` (`GOOGLE_SA_KEY_FILE`; bila berkas belum ada, `docker compose up` GAGAL, bukan membuat direktori kosong). Kunci tidak masuk image, tidak masuk GitHub, dan tidak pernah dibaca dari variabel lingkungan.
- **Lokal (dev)**: simpan di luar repositori atau di `scripts/google-sa-check/` (`*.json` di folder itu diabaikan git), isi `GOOGLE_SA_KEY_FILE=<jalur mutlak>` di `server/.env`.
- Server membaca berkas hanya saat pertama dipakai; galat berkas (tak terbaca/bukan service account) menjadi `UNAVAILABLE` generik di aplikasi dan satu baris log tanpa isi kunci.

### S3. Bagikan folder induk dan spreadsheet
1. Di Drive pemilik, buat **satu folder induk** (mis. `QC App`; staging memakai folder induk sendiri). Bagikan ke email service account sebagai **Editor**. Salin id folder dari URL (`.../folders/<ID>`) sebagai `GOOGLE_ROOT_FOLDER_ID`.
2. Di dalam induk ada **subfolder per fungsi**: lampiran (tabel `files`: gambar item dan lampiran lain), PDF sumber QR, ekspor QR, cadangan SQL. Dua cara:
   - biarkan kosong: server membuat `QC App Files`, `QC App QR`, `QC App QR Dokumen` di bawah induk saat pertama dibutuhkan dan mencatat id-nya di tabel `settings`;
   - atau buat/pilih sendiri lalu isi `ATTACHMENTS_FOLDER_ID`, `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`, `BACKUP_FOLDER_ID` di `.env` (id yang terisi hanya **diverifikasi**, tidak pernah dibuat atau ditimpa; folder yang tak terjangkau = galat jelas).
3. **Folder lama** (mis. `QC App Files` milik pemilik yang sudah berisi gambar): **pindahkan** ke bawah folder induk **tanpa mengubah id** (seret di Drive; id berkas di basis data tetap valid), lalu isi `ATTACHMENTS_FOLDER_ID` dengan id folder itu . Tabel `settings` TIDAK pernah diisi oleh impor data (migrasi cutover hanya mengimpor akses, QR, dan berkas yang dirujuk QR), jadi untuk folder lama id-nya WAJIB diisi di `.env`; mengosongkannya membuat server membuat folder BARU yang kosong dan berkas lama tak terbaca.
4. Spreadsheet data tunggal (ekspor job `exports.sheets` dan sumber impor awal): bagikan ke service account sebagai **Editor**, isi `GOOGLE_SPREADSHEET_ID`. Sheet ekspor selalu berawalan `export_`; klien menolak menulis ke sheet lain.
5. Aturan penjaga: klien hanya menyentuh folder yang tercantum (`ATTACHMENTS_FOLDER_ID`, `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`, `BACKUP_FOLDER_ID`, `ALLOWED_FOLDER_IDS` untuk tambahan di luar induk) **atau subfolder langsung dari folder induk** (diverifikasi lewat API). Berkas harus anak folder yang diminta. `createFolder` SELALU membuat folder di bawah `GOOGLE_ROOT_FOLDER_ID`. Id Drive yang masuk ke jalur URL divalidasi `^[A-Za-z0-9_-]{10,100}$` (tanpa `../`, `?`, `#`).

### S4. Isi `.env`
| Variabel | Isi |
|---|---|
| `GOOGLE_SA_KEY_FILE` | Jalur berkas kunci (di kontainer: `/run/secrets/google-sa.json`). Wajib di produksi. |
| `GOOGLE_ROOT_FOLDER_ID` | Id folder induk Drive. Wajib di produksi (compose menolak kosong). |
| `GOOGLE_SPREADSHEET_ID` | Id spreadsheet data tunggal (kosong = ekspor/impor Sheets tidak tersedia). |
| `ATTACHMENTS_FOLDER_ID`, `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`, `BACKUP_FOLDER_ID` | Opsional (lihat S3). |
| `ALLOWED_FOLDER_IDS` | Opsional: id folder tambahan di luar induk, dipisah koma. |

Di luar produksi semuanya opsional: tanpa konfigurasi Google, operasi Drive/Sheets gagal dengan `UNAVAILABLE` ("Google belum dikonfigurasi") dan sisa aplikasi tetap berjalan. `BRIDGE_URL`/`BRIDGE_SECRET` (peninggalan jembatan Apps Script) sudah dihapus dan diabaikan.

### S5. Rotasi kunci
1. Buat kunci baru di service account (S1 langkah 3) **tanpa** menghapus yang lama.
2. Ganti berkas di VPS (`secrets/google-sa.json`): `scp` ke nama sementara di folder `secrets/`, lalu `install -m 600 -o 1000 -g 1000 <sementara> secrets/google-sa.json.baru && mv secrets/google-sa.json.baru secrets/google-sa.json` (pemilik WAJIB uid 1000 dan `mv` sesama folder agar atomik; berkas baru milik `root` membuat Google tak terbaca setelah rotasi, termasuk rotasi darurat), lalu hapus nama sementara.
3. Restart `qc-app` (`docker compose restart qc-app`) lalu cek `GET /api/ping` dan satu unggah gambar uji.
4. Hapus kunci lama di Console. Bila kunci bocor: hapus dulu kunci itu di Console (server tak dapat memakai Google sampai kunci baru terpasang), baru ganti berkas.

### S6. Pemantauan kuota 15 GB
Berkas yang dibuat service account **dimiliki service account**, jadi gambar, PDF sumber, ekspor QR, dan cadangan memakai kuota 15 GB yang sama (juga dipakai bersama proyek lain yang memakai service account yang sama). Klien menyediakan `storageQuota()` (`about.get`) untuk pemantauan (dipakai T30/T32: ambang peringatan). Cek manual: `scripts/google-sa-check/check.ts` (daftar semua berkas milik service account termasuk sampah). Retensi cadangan (7 harian + 4 mingguan, T30) menjaga pemakaian.

### S7. Uji integrasi manual (dijalankan pemilik; tidak masuk `bun run check`)
Skrip `scripts/google-sa-check/qc-integration.ts` memakai klien yang SAMA dengan server dan menguji hal yang tidak dapat diuji dengan server Google palsu: unggah multipart dan resumable 9 MB (byte dan MD5 sama), baca/unduh, ganti nama, berbagi/cabut, ganti isi, daftar folder, kuota, pembacaan dan penulisan Sheets, serta (opsional) hak Editor atas berkas/folder lama milik pemilik (hanya membaca `capabilities`; rename lalu kembalikan).

```bash
# kunci dan id TIDAK ditulis di repo: beri lewat argumen atau berkas JSON di luar repo
bun run scripts/google-sa-check/qc-integration.ts --config D:/rahasia/qc-integration.json
# atau
bun run scripts/google-sa-check/qc-integration.ts --key D:/rahasia/kunci.json --root <idFolderInduk> \
  [--spreadsheet <idSpreadsheet>] [--legacy-folder <idFolderLama>] [--legacy-file <idBerkasLama>]
```
Berkas `--config`: `{"key": "D:/rahasia/kunci.json", "root": "...", "spreadsheet": "...", "legacyFolder": "...", "legacyFile": "..."}` (hanya `key` dan `root` wajib). Skrip membuat subfolder uji `qc-integrasi-<waktu>` di bawah induk, menghapus semua yang dibuatnya di akhir (berkas dihapus permanen, folder uji dihapus, sheet uji `export_integrasi_qc` dihapus), mencetak PASS/FAIL per langkah, dan keluar dengan kode 1 bila ada yang gagal. Kunci dan token tidak pernah dicetak; keluarannya aman disalin utuh ke pengembang.

### S8. Cadangan malam, pemulihan, dan peringatan (T30–T32)
**Cadangan.** Penjadwal `qc-app` (hanya produksi dengan Google terkonfigurasi dan `BACKUP_ENABLED` bukan `false`; staging WAJIB `BACKUP_ENABLED=false` bila `BACKUP_FOLDER_ID`-nya sama dengan production, spek §19 butir 17; CLI pemulihan tetap berfungsi) membuat satu berkas `qc-backup-YYYYMMDD-HHmm.sql.gz` (waktu WIB) tiap malam sesudah 02:00 WIB: `mariadb-dump --single-transaction --routines` -> gzip -> unggah resumable ke folder cadangan -> verifikasi MD5 Drive dengan hitungan lokal (SHA-256 disimpan di `appProperties`) -> retensi. Bila server mati lewat 02:00, cadangan hari itu dibuat pada detak jam-an berikutnya; bila gagal, dicoba lagi tiap jam sampai berhasil.
- **Folder cadangan**: kosongkan `BACKUP_FOLDER_ID` agar server membuat subfolder "QC App Cadangan" di bawah folder induk dan mencatat id-nya di tabel `settings`; atau isi `BACKUP_FOLDER_ID` dengan subfolder yang Anda buat sendiri di bawah folder induk (hanya diverifikasi, tidak dibuat otomatis). **Tiap lingkungan (staging, production) WAJIB punya folder cadangan sendiri**: nama berkas tak memuat nama lingkungan, jadi folder bersama membuat retensi satu lingkungan menghitung dan menghapus berkas lingkungan lain, dan peringatan basi lingkungan lain teredam. `BACKUP_FOLDER_ID` kosong sudah aman (tiap lingkungan menyimpan folder buatannya di tabel `settings` sendiri).
- **Retensi** (oleh server, fungsi murni `retention.ts`): 7 harian (berkas terbaru dari 7 hari terbaru yang punya berkas) + 4 mingguan (terbaru per pekan ISO pada 4 pekan berikutnya), berdasarkan jumlah dan tanggal di NAMA berkas (bukan jam sekarang); tak pernah menghapus bila salinan tersisa kurang dari 3; nama yang bukan `qc-backup-*.sql.gz` tidak pernah disentuh. Berkas dihapus PERMANEN (sampah Drive tetap memakai kuota).
- **Di VPS**: dump disimpan di volume `qc-backups` (`/var/backups/qc`), 3 salinan terakhir (cadangan yang gagal diunggah tetap ada di sini).
- **Mengaktifkan**: tidak ada saklar; cadangan berjalan otomatis bila `NODE_ENV=production`, `GOOGLE_SA_KEY_FILE`, dan `GOOGLE_ROOT_FOLDER_ID` terisi. Dev lokal tidak pernah men-dump.

**Pemulihan** (uji sekali di staging sebelum cutover; jangan memulihkan ke skema aplikasi yang sedang berjalan). CLI ada di image (`/app/scripts/restore-backup.ts`). Dijalankan di VPS. Cek ringan dulu: tanpa argumen CLI harus mencetak petunjuk dan keluar 2, dan `mariadb-dump --version` harus jalan.

Jalan bawaan memakai pengguna DB berhak TERBATAS, BUKAN URL admin: satu kali per lingkungan, buat pengguna `qc_restore` yang hanya boleh membuat/menghapus skema berawalan `qc\_restore\_` dan membaca skema aplikasi (untuk `--compare-with`). Jalankan di dalam kontainer DB sebagai root DB (kata sandi tidak dicetak dan tidak lewat argumen proses; kata sandi `qc_restore` heksa agar aman-URL):
```sql
CREATE USER IF NOT EXISTS 'qc_restore'@'%' IDENTIFIED BY '<kata-sandi-heksa-baru>';
GRANT ALL PRIVILEGES ON `qc\_restore\_%`.* TO 'qc_restore'@'%';
GRANT SELECT ON `<skema-aplikasi>`.* TO 'qc_restore'@'%';
```
```
docker exec <kontainer-app> bun /app/scripts/restore-backup.ts ; echo $?
docker exec <kontainer-app> mariadb-dump --version
read -rs -p 'Kata sandi qc_restore: ' DBPW; echo
export RESTORE_DATABASE_URL="mysql://qc_restore:${DBPW}@qc-db:3306/"; unset DBPW   # tanpa nama basis data: pengguna ini hanya berhak pada skema qc_restore_*
docker exec -e RESTORE_DATABASE_URL <kontainer-app> bun /app/scripts/restore-backup.ts \
  --target qc_restore_check --compare-with <skema-aplikasi> --drop-after
unset RESTORE_DATABASE_URL
```
`-e RESTORE_DATABASE_URL` TANPA nilai: docker mengambilnya dari lingkungan pemanggil, jadi kata sandi tidak masuk argumen proses (`ps`) maupun riwayat shell. Pemeriksa isi dump di CLI (menolak per baris perintah klien `\`, `USE`, `CREATE`/`DROP DATABASE`, `GRANT`, tulisan ke skema lain) hanya lapisan kedua dan BUKAN pertahanan utama: MD5/SHA-256 membuktikan keutuhan, bukan asal berkas, sehingga pengguna berhak terbatas `qc_restore` itulah yang membatasi akibat dump rekaan. Baris sandbox MariaDB (`/*M!999999\- enable the sandbox mode */`) TIDAK diwajibkan ada di dump. URL admin (hak CREATE/DROP DATABASE penuh) HANYA dipakai bila pengguna terbatas tak bisa dipakai, dan jangan memberi pengguna terbatas hak di luar `qc\_restore\_%`.

CLI mengunduh cadangan terbaru (atau `--file-id <idDrive>`), MENAMPILKAN nama dan tanggal cadangan yang terpilih sebelum mengimpor (periksa bahwa itu cadangan yang Anda maksud, bukan berkas yang tak dikenal), memverifikasi MD5 Drive, SHA-256, gunzip penuh, dan baris penutup dump, BARU kemudian membuat skema target dan mengimpor; verifikasi gagal = tidak ada yang diimpor, impor gagal = skema target dibuang. Hasil: jumlah baris per tabel dan perbandingannya dengan skema sumber (kode keluar 1 bila berbeda). PERBEDAAN YANG WAJAR (terbukti pada uji staging nyata) dan bukan tanda pemulihan rusak: tabel `settings` (kunci `BACKUP_LAST_SUCCESS_DATE` ditulis SESUDAH dump selesai, jadi skema aplikasi punya satu baris lebih banyak dari dump) dan tabel `rate_limits` (baris pembatas percobaan yang hidup terus berubah di skema aplikasi). CLI tetap berkode keluar 1 bila hanya kedua tabel itu yang berbeda; baca daftar tabelnya. Tabel LAIN yang jumlah barisnya berbeda berarti pemulihan bermasalah (selidiki sebelum menganggap lulus).

**Batasan pemeriksa isi dump:** dump yang memuat trigger atau rutin tersimpan (`DELIMITER`, mis. dari `--routines`/trigger) TIDAK dapat dipulihkan lewat CLI ini karena `DELIMITER` ditolak pemeriksa (perintah klien). Skema saat ini tidak punya trigger/rutin/event (dijaga tes `dump-inspect.test.ts`), jadi cadangan nyata lolos. Bila kelak ada, aturan itu harus dilonggarkan secara sadar (ubah pemeriksa dan tesnya) sebelum cadangan seperti itu dapat dipulihkan dengan CLI; sementara itu pulihkan manual oleh pemilik dengan pengguna terbatas. Id folder cadangan dibaca dari skema aplikasi (`DATABASE_URL`), BUKAN dari `RESTORE_DATABASE_URL`.

**Skenario bencana** (skema aplikasi hilang atau rusak, sehingga id folder di tabel `settings` tak terbaca): beri id folder cadangan langsung lewat `--folder-id <idDrive>` (id dari URL folder cadangan di Drive; urutan sumber id folder: `--folder-id`, lalu `BACKUP_FOLDER_ID`, lalu `settings` skema aplikasi bila terjangkau). Pemulihan nyata: pulihkan ke skema BARU, periksa, lalu arahkan `DATABASE_URL` ke skema itu dan restart. Catat id folder cadangan tiap lingkungan di tempat aman pemilik di luar VPS.

**Peringatan email** (SMTP generik, `nodemailer`; tanpa kode khusus penyedia). Pemeriksaan jam-an mengirim email ke `ALERT_TO` bila (a) cadangan terbaru > 36 jam atau belum ada, (b) pemakaian kuota Drive > `QUOTA_ALERT_PERCENT` (bawaan 80). Tiap jenis maksimal sekali per 12 jam (waktu terakhir yang BERHASIL terkirim disimpan di `settings`: `BACKUP_ALERT_LAST_AT`, `QUOTA_ALERT_LAST_AT`); gagal kirim dicatat dan dicoba lagi pada jam berikutnya. Variabel `.env`:
| Variabel | Isi |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` untuk 465) | Server SMTP. Sekarang SMTP Google (`smtp.gmail.com`, 587, sandi aplikasi dari akun Google dengan verifikasi 2 langkah). |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Akun dan pengirim (`SMTP_FROM` kosong = `SMTP_USER`). |
| `ALERT_TO` | Penerima, dipisah koma. |
| `QUOTA_ALERT_PERCENT` | Ambang kuota Drive (1-99, bawaan 80). |

Pindah ke email kantor nanti = mengganti nilai-nilai ini di `.env` lalu `docker compose up -d`; tidak ada perubahan kode. `SMTP_*` juga dipakai email ringkasan harian stok stiker menipis (penerima, sakelar, dan jam kirim diatur di halaman Konfigurasi Stiker, tidak memakai `ALERT_TO`; `ALERT_TO` tetap hanya untuk peringatan cadangan dan kuota). Bila `SMTP_HOST`/`SMTP_FROM`/`ALERT_TO` kosong atau tidak valid (mis. masih `ISI_OLEH_PEMILIK`), peringatan dinonaktifkan dan satu baris log menyebutnya; aplikasi tetap berjalan. Keterbatasan yang diterima pemilik (2026-11-06): peringatan berjalan DI server, jadi tidak berbunyi bila VPS atau `qc-app` mati; dead-man's switch eksternal tidak dikerjakan (dapat ditambahkan kemudian).

### S9. Folder rilis aplikasi desktop dan service account penerbit
Installer aplikasi desktop disimpan di satu folder Drive dan disajikan server (`GET /api/desktop/app-manifest` dan `app-file/...`; `docs/desktop-release-signing.md`). Folder ini **bukan** anak folder induk aplikasi, jadi tercantum eksplisit lewat `DESKTOP_RELEASES_FOLDER_ID` (juga masuk daftar folder terjaga klien Google; berkas yang diminta harus anak langsungnya).
1. Buat folder (mis. `QC App Rilis Desktop`) di Drive pemilik dan catat id-nya.
2. Bagikan ke service account **server** (S1) sebagai **Viewer**: server hanya membaca dan mengalirkan berkas. Bagikan ke service account **penerbit** sebagai **Editor**: akun terpisah yang kuncinya hanya dipakai CI (`release.yml`) untuk menulis installer dan manifest; kunci penerbit bocor hanya memungkinkan menaruh berkas, bukan membuat manifest yang diterima aplikasi (tanpa kunci tanda tangan rilis).
3. Isi `DESKTOP_RELEASES_FOLDER_ID=<id>` di `.env` VPS (staging dan production), lalu `docker compose up -d`. Kosong = rute pembaruan menjawab 404 (aplikasi tidak menawarkan pembaruan).
4. Kunci JSON penerbit disimpan sebagai secret `DESKTOP_DRIVE_PUBLISHER_KEY` pada environment GitHub `desktop-release` (bukan berkas di VPS).
5. Kuota: installer sekitar 100 MB per arsitektur dan retensi menyimpan 10 versi terbaru (`pruneInstallers`), jadi sekitar 2 GB. Berkas yang dibuat service account penerbit dimiliki akun itu dan memakai kuota 15 GB-nya sendiri (S6), terpisah dari service account server, sehingga rilis tak mengurangi kuota gambar/cadangan.

### Troubleshooting service account
| Gejala | Penyebab & solusi |
|---|---|
| `UNAVAILABLE` "Google belum dikonfigurasi" | `GOOGLE_SA_KEY_FILE`/`GOOGLE_ROOT_FOLDER_ID`/`GOOGLE_SPREADSHEET_ID` kosong untuk fungsi yang dipakai. |
| `UNAVAILABLE` "Kunci service account Google tidak terbaca/valid" | Jalur salah, izin berkas, atau bukan JSON kunci service account (cek log server: satu baris tanpa isi kunci). |
| `UNAVAILABLE` "Gagal memperoleh token Google" | Log memuat `HTTP 400 invalid_grant` (kunci dihapus/diganti, jam server menyimpang jauh) atau galat jaringan. |
| `UNAVAILABLE` "Akses ke Google Drive ditolak" | Folder/berkas di luar daftar yang diizinkan, atau service account belum Editor pada folder induk. |
| `Folder Drive ... tidak dapat diakses` | Id folder di `.env`/`settings` salah, dihapus, di sampah, atau belum dibagikan ke service account. |
| `403 storageQuotaExceeded` di log | Kuota 15 GB habis: hapus berkas milik service account (`check.ts` menampilkan daftarnya). |
| `UNAVAILABLE` "Spreadsheet ... belum dibagikan" | Bagikan spreadsheet ke service account sebagai Editor (S3 langkah 4). |

## Klien OAuth (login web)

Login pengguna memakai OAuth Google (bukan service account) dan tidak bergantung pada Apps Script. Di https://console.cloud.google.com (project yang sama):
1. **Google Auth Platform → Branding/OAuth consent screen**: User type **External**, nama aplikasi "QC App", email dukungan.
2. **Data access / Scopes**: tambahkan `openid` dan `.../auth/userinfo.email` saja.
3. **Audience**: **Publish app** sehingga status **In production** (scope ini tidak memerlukan verifikasi Google).
4. **Clients → Create client → Web application**; daftarkan URI redirect `https://<host>/auth/callback` untuk tiap hostname (staging, production; `docs/deploy-vps.md` bagian OAuth), persis dan tanpa garis miring di akhir.
5. Salin **Client ID** dan **Client secret** ke `.env` server (`OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`; `server/.env.example`).

| Gejala | Penyebab & solusi |
|---|---|
| Google menampilkan `redirect_uri_mismatch` | URI redirect yang dikirim server (diturunkan dari `APP_ORIGIN`) tidak terdaftar; daftarkan persis nilai yang tampil di halaman galat Google. |
| "Email … belum terdaftar" | Tambahkan email itu di menu Users (status Aktif). |
| Paksa semua user logout | Ganti `SESSION_SECRET` di `.env` lalu mulai ulang kontainer. |
