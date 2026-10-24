# Migrasi backend ke Cloudflare Worker + D1 (Apps Script sebagai jembatan Google) — rancangan

| | |
|---|---|
| **Tanggal** | 2026-10-25 |
| **Status** | Draf untuk ditinjau pemilik |
| **Cakupan** | Seluruh backend QC App (auth, RPC, data, berkas, sinkron QC Desktop, QR, cron) dan transport frontend |
| **Dasar** | Kode saat ini (`gas/src`, `shared/`, `web/`), `docs/api/desktop-sync.md`, `docs/ci-cd.md`, percakapan dengan pemilik |

Tanda: **[pemilik]** = diputuskan pemilik. **[saya]** = pilihan saya yang belum Anda setujui; koreksi bila salah. **[verifikasi]** = angka/perilaku Cloudflare atau Apps Script yang HARUS dicek di dokumentasi/spike sebelum dijadikan dasar.

---

## 1. Maksud dan alasan

Backend sekarang berjalan di Apps Script dan menyimpan data di Google Sheets. Pemilik ingin memindahkannya karena:

- Tiap eksekusi Apps Script punya biaya tetap 1,5–2,5 dtk dan tiap panggilan Sheets/Drive ratusan milidetik. Sebagian besar kerumitan arsitektur sekarang (batching RPC 15 ms, cache tabel dua lapis, versi tabel, `withRequestCache_`, `withLock`) hanya ada untuk menutupi itu.
- Satu berkas `index.html` (batas `MAX_INDEX_BYTES`) menghalangi pemuatan malas (lazy load) bagian yang jarang dipakai.
- Sheets bukan basis data: tidak ada indeks, transaksi, atau paginasi sungguhan.

Keberhasilan = respons API terasa instan (puluhan ms di luar jembatan Google), tetap berjalan di paket **gratis** Cloudflare, tanpa kehilangan fitur atau data.

## 2. Keputusan pemilik **[pemilik]**

1. **Proses utama berjalan di Cloudflare Worker**, dengan aturan mutlak paket gratis: **≤ 10 ms waktu CPU per permintaan**, tidak termasuk waktu menunggu (panggilan API, akses basis data, dan sebagainya).
2. **D1 = basis data inti** untuk semua data kecuali berkas.
3. **Berkas tetap di Google Drive**, diakses lewat Apps Script.
4. **Apps Script = jembatan ke ekosistem Google saja**: simpan/baca berkas Drive, impor Spreadsheet ke D1 **sekali di awal**, dan ekspor data D1 menjadi Spreadsheet.
5. Peralihan boleh memakai jeda tulis beberapa jam; aplikasi lama (deployment `/exec` Apps Script) tidak diubah selama Worker dibangun. **[saya]** Satu-satunya pengecualian: satu perubahan kecil di `gas/` berupa bendera Script Property `READ_ONLY=1` (semua RPC tulis ditolak dengan pesan jelas), di-deploy SEBELUM hari cutover supaya pembekuan tulis tidak bergantung pada disiplin pengguna.
6. Skala sekarang ±50 task per bulan. Skala tahunan item/audit: **belum diketahui** (lihat §12).

## 2b. Batas paket gratis yang SUDAH diverifikasi (dokumentasi Cloudflare, dibaca 2026-10-25)

| Fitur | Batas gratis | Dampak pada rancangan |
|---|---|---|
| Workers: permintaan HTTP | 100.000/hari (reset 00:00 UTC) | Jauh di atas kebutuhan 50 task/bulan; tetap hindari polling agresif |
| Workers: CPU per permintaan HTTP | **10 ms** | Aturan mutlak §5 |
| Workers: CPU per Cron Trigger | **10 ms**; durasi (wall) 15 menit | Cron hanya menjadwalkan ke antrean (§9b, §10) |
| Cron Trigger per akun | **5** | Cukup: pembersihan QR, ekspor terjadwal; hemat |
| Subrequest per invokasi | **50**; panggilan D1 ikut dihitung; `db.batch()` dihitung **satu** | Jembatan Apps Script, D1, dan Queues semua menghabiskan jatah 50; pakai `batch()` |
| Ukuran badan permintaan | 100 MB (mengikuti plan akun) | Tidak mengikat unggahan gambar ≤ ±540 KB |
| Memori per isolate | 128 MB | Cukup |
| Static Assets | 20.000 berkas/versi, 25 MiB per berkas; `_headers` 100 aturan; `_redirects` 2.100. **Permintaan aset statis "free and unlimited"** (halaman Billing and limitations) dan tidak memanggil Worker, jadi tidak memakan 100.000 permintaan/hari maupun CPU | Cukup untuk potongan JS/CSS. `run_worker_first` hanya berupa daftar pola `/api/*`, `/auth/*`, `/sync` (lihat §11); aset, potongan JS, dan navigasi rute klien dilayani tanpa Worker dan tanpa CPU |
| D1: basis data | 10 per akun; **500 MB per DB**; 5 GB total | Cukup (staging + produksi + cadangan) |
| D1: baris dibaca | **5 juta/hari**, dihitung dari baris yang **dipindai**, bukan yang dikembalikan | Indeks wajib (§7.1); kueri tanpa indeks memakan kuota |
| D1: baris ditulis | **100.000/hari**; tiap indeks pada kolom tertulis menambah 1 baris tulis | Aman pada skala sekarang; jangan menambah indeks berlebihan |
| D1: **parameter terikat per kueri** | **100** | Penyisipan banyak baris per pernyataan terbatas (mis. 20 kolom → maks. 5 baris/pernyataan); gunakan `batch()` dari pernyataan per baris. Impor awal via berkas SQL (`wrangler d1 execute --file`) tidak terkena batas ini |
| D1: ukuran baris/string/BLOB | 2 MB; pernyataan SQL 100 KB | Cukup (catatan ≤ 5.000 karakter, komentar ≤ 40 KB) |
| D1: pola `LIKE`/`GLOB` | 50 byte | Pencarian teks panjang harus lewat kolom kunci pencarian (`shared/items.ts`) |
| Queues | **Tersedia di paket gratis**; 10.000 operasi/hari; tiap pesan ±3 operasi (tulis, baca, hapus), tiap 64 KB = 1 operasi; retensi tetap **24 jam** | ≈ 3.300 pesan/hari; ukuran potongan ekspor dipilih agar jumlah pesan kecil. Pekerjaan yang tak tuntas dalam 24 jam hilang → status `jobs` harus bisa diulang manual |
| Queues: ukuran pesan | 128 KB; batch konsumen 100; percobaan ulang maks. 100 | Pesan hanya membawa `{ jobId, potongan }`, data diambil dari D1 |
| Queues: CPU konsumen | halaman limit Queues menyebut default 30 dtk (dapat diatur); **belum jelas** apakah paket gratis tetap dibatasi 10 ms | Tetap dirancang ≤ 10 ms per pesan; **[verifikasi lewat spike]** |

Belum terverifikasi (tetap spike Fase 0): perilaku redirect 302 Apps Script dari `fetch` Workers, ukuran/CPU unggahan base64 lewat Worker, dan CPU konsumen Queues di paket gratis.

## 3. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- Semua RPC di `shared/rpc.ts` tetap ada dengan kontrak input/output yang sama, sehingga frontend hampir tidak berubah selain transport.
- Login Google OAuth dan izin berlokasi/peran berjalan sama.
- Jalur sinkron QC Desktop tetap berfungsi dengan kontrak `docs/api/desktop-sync.md` (hanya URL yang berganti).
- Frontend boleh dipecah per potongan (lazy load).

**Bukan-tujuan**
- Mengubah fitur atau aturan bisnis. Perilaku fitur mengikuti PRD/spek yang ada.
- Menyimpan berkas di R2/D1 (berkas tetap di Drive).
- Sinkronisasi dua arah D1 ⇄ Sheets. Sheets hanya sumber impor awal dan tujuan ekspor satu arah.
- Memindahkan QC Desktop atau MySQL.

**Anti-tujuan (gagal walau "jalan")**
- Satu permintaan melewati 10 ms CPU di kondisi normal (Cloudflare memutus dengan galat 1102).
- Data hilang atau ganda saat peralihan.
- Rahasia (OAuth, sesi, token sinkron, rahasia jembatan) bocor ke klien atau repo.
- Jembatan Apps Script dapat dipanggil siapa saja tanpa tanda tangan.

## 4. Arsitektur sasaran

```
Browser ──HTTPS──▶ Cloudflare Worker (satu skrip)
                    ├─ Static Assets: index.html + potongan JS/CSS (gratis, tanpa CPU)
                    ├─ /auth/*     Google OAuth, sesi HMAC
                    ├─ /api/rpc    RPC (kontrak shared/rpc.ts)
                    ├─ /sync       QC Desktop (token bersama)
                    ├─ D1          data inti
                    └─ fetch ──▶ Jembatan Apps Script (proyek terpisah, ditandatangani HMAC)
                                   ├─ Drive: buat/baca/ganti/salin/ubah nama/bagikan/cabut/sampah
                                   ├─ Sheets: dump (impor awal), export (D1 → Spreadsheet)
                    Cron Trigger ─▶ Worker scheduled(): pembersihan PDF QR yatim, ekspor terjadwal
```

Kode baru: `worker/` (Worker) dan `bridge/` (Apps Script jembatan). `shared/` dan `web/` dipakai bersama. `gas/` dipertahankan apa adanya sampai masa stabilisasi selesai (jalan mundur), lalu dihapus (kecuali kode yang dipindah ke `bridge/`).

## 5. Anggaran CPU 10 ms

Prinsip: CPU hanya untuk memetakan permintaan → SQL → respons. Pekerjaan berat dibuang atau dipindah.

| Aturan | Alasan |
|---|---|
| Endpoint daftar **selalu berhalaman** (batas bawaan 20, maks 50, kursor) dan tidak mem-parse kolom JSON besar | `handovers.board` sekarang mengirim seluruh task (711 KB untuk 300 task); komentar sampai 40 KB per task |
| Kolom JSON (`checks`, `comments`, snapshot audit) hanya di-parse pada `get`, bukan pada daftar; atau dinormalisasi jadi tabel (lihat §7.3) | `JSON.parse` pada banyak baris mahal |
| Worker **tidak pernah** decode/encode base64 berkas | Mengubah 540 KB base64 ↔ byte bisa puluhan ms; klien yang mendekode |
| Tidak ada loop atas seluruh tabel di dalam permintaan; filter/urut/hitung dikerjakan SQL dengan indeks | Pemindaian tanpa indeks memakan CPU dan kuota baris-dibaca D1 |
| Penggabungan beberapa query memakai `D1.batch()` | Batas 50 subrequest per invokasi (D1, jembatan, Queues semua dihitung; `batch()` = satu) — terverifikasi §2b |
| Validasi catatan (≤5.000 karakter), `extractChecklist`, kanonisasi tetap di server, tetapi `saveBatch` dibatasi 30 task dan diukur | Hot path terberat yang tersisa |
| Pemecah WhatsApp, saran customer, ekspor PDF/PNG QR, kecilkan gambar tetap di klien | Tidak menggunakan CPU Worker |

**Gerbang pengukuran (kriteria rilis).** Cloudflare melaporkan `cpuTime` per invokasi (Workers Logs / `wrangler tail`). Skrip beban di staging memanggil setiap RPC dengan data realistis (±2 tahun data hasil proyeksi) dan mencatat p50/p99 CPU. Rilis ke produksi hanya bila **p99 ≤ 8 ms** untuk setiap rute (margin 2 ms). Rute yang gagal diperbaiki sebelum cutover, bukan sesudahnya.

## 6. Kerangka Worker

- **Router RPC:** `POST /api/rpc` dengan `{ method, payload }`, balasan `{ ok, data | error }` identik dengan sekarang (kode galat `UNAUTHENTICATED`, `VALIDATION`, `CONFLICT`, dst. tidak berubah). `RouteTable` bertipe, izin `anyOf`, dan `scope: 'location'` dipertahankan.
- **Batching:** `api('batch')` dan jendela 15 ms **dihapus**; HTTP/2 sudah menangani banyak permintaan paralel. Loader tidak perlu lagi menunggu pengelompokan.
- **Async penuh:** semua lapisan data/service menjadi `async`. Fungsi murni di `shared/` tidak berubah.
- **Aturan kode GAS tidak berlaku di `worker/`:** akhiran `_`, satu scope global, larangan `class`/`import` alias, daftar API terlarang. Biome/tsc tetap berlaku. Nama berkas dan modul mengikuti `modules/<modul>/{repo,validate,service,routes}.ts` agar pemetaan mudah.
- **Konfigurasi:** Worker Secrets: `SESSION_SECRET`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SYNC_API_TOKEN`, `BRIDGE_URL`, `BRIDGE_SECRET`. Script Properties jembatan: `BRIDGE_SECRET`, id folder Drive.
- **Auth.** Alur Google OAuth dan token sesi HMAC-SHA256 (`gas/src/core/session.ts`, `gas/src/modules/auth/oauth.ts`) dipindah ke Worker dengan WebCrypto (HMAC native, CPU murah). Hal yang berubah: `redirect_uri` baru harus didaftarkan di Google Cloud Console (untuk produksi dan staging). **[saya]** Token sesi disimpan di cookie `HttpOnly; Secure; SameSite=Lax` dan setiap `POST` wajib membawa header kustom (mitigasi CSRF), menggantikan token di body/localStorage. Bila ini terlalu besar untuk fase pertama, token boleh tetap seperti sekarang dan cookie menyusul (builder memutuskan, catat sebagai Ruling).
- **Satu origin, tanpa CORS.** Worker menyajikan aset statis dan API dari origin yang sama, jadi cookie `SameSite=Lax` dan tanpa CORS. Redirect OAuth kembali ke `/auth/callback` di origin itu. `query-persist` yang kini berkunci "per pemilik token" berkunci pada identitas pengguna (email dari `me`) agar tidak tergantung bentuk token.
- **Boot.** Data awal yang sekarang disuntik `doGet` (`buildBootData_`) menjadi `GET /api/boot` yang dipanggil klien saat mulai (query `me` sudah dipersist oleh `query-persist`, jadi tampilan awal tetap instan).
- **Konteks izin.** Pengguna/peran/lokasi dimuat per permintaan dengan satu `batch()` (tabel kecil). **[saya]** Tanpa cache lintas permintaan pada tahap awal; cache pendek (≤ 15 dtk) boleh ditambah bila pengukuran CPU/kuota menuntut. Pencabutan akses harus berlaku cepat (lihat catatan `uctx` di CLAUDE.md).

## 7. Basis data D1

### 7.1 Skema
Satu tabel D1 per `TableSchema` yang ada: `users`, `roles`, `locations`, `audit_log`, `brands`, `customers`, `files`, `handovers`, `items`, `qr_designs`, `qr_documents`, `qr_defaults`, `qr_presets`, `sync_state`. Kolom awal = kolom Sheets, supaya impor langsung dan jalan mundur mudah. Migrasi dikelola `wrangler d1 migrations` (berkas SQL di repo, berurutan, dijalankan CI).

- Kolom teks tetap TEXT; waktu = ISO 8601 UTC string; angka yang dipakai berhitung (mis. `sync_rev`, `version`) = INTEGER. Builder memutuskan tipe tiap kolom saat menulis migrasi dan mencatat penyimpangan dari "semua teks".
- Kunci primer = `id` yang sudah ada (tidak diganti, karena dirujuk berkas Drive, URL, dan Desktop).
- **Indeks wajib** (kuota baris-dibaca dan CPU): minimal `handovers(location_id, status, updated_at)`, `handovers(number)` unik, `audit_log(created_at)` dan `audit_log(entity, entity_id)`, `items` pada kunci pencarian yang dipakai daftar, `files(owner…)`. Daftar lengkap ditentukan builder dari kueri nyata dan diuji dengan `EXPLAIN QUERY PLAN`.
- Pembatasan `NOT NULL`/`UNIQUE`/`CHECK` ditambahkan di mana model sekarang menjaganya lewat kode (mis. nomor `ST-YYYYMMDD-NNN` unik).

### 7.2 Konkurensi (menggantikan `withLock`)
D1 menserialkan tulis, tetapi urutan baca-ubah-tulis lintas dua query tidak atomik. Pola yang dipakai:
- Operasi baca-ubah-tulis memakai **kolom `version` + `UPDATE … WHERE id=? AND version=?`**, diulang sekali bila 0 baris berubah (bukan lock).
- Penomoran (`ST-YYYYMMDD-NNN`, `sync_rev`) memakai tabel penghitung dengan `UPDATE … SET n = n + 1 … RETURNING`, di dalam `batch()` yang sama dengan penyisipan agar atomik.
- `saveBatch` (maks. 30 task, atomik) = satu `batch()` D1 (transaksi implisit): validasi semua dulu di kode, lalu sisipkan semuanya atau tidak sama sekali.
- Aturan bisnis yang sekarang ada **tidak berubah**: `setCheck` idempoten dan tidak memakai `expectedUpdatedAt`; simpan task tidak CONFLICT bila hanya centang berubah (`base`); antrean klien serial per task.

### 7.3 Bentuk data handover
**[saya]** Komentar (append-only, sampai 50) dipisah menjadi tabel `handover_comments` (satu baris per komentar), dan audit tetap tabel sendiri. `checks` tetap satu kolom JSON dengan `version` (butir dicocokkan sebagai satu kesatuan oleh `reconcileChecks`). Tujuannya: daftar tidak mem-parse komentar, penambahan komentar atomik tanpa baca-ubah-tulis, dan batas "50 komentar ATAU 40.000 karakter" dihitung dengan SQL. Builder boleh menolak pemisahan ini bila ada alasan kuat dan mencatatnya sebagai Ruling.

### 7.4 Kontrak DTO
`HandoverDto` dan DTO lain tidak berubah bentuk. Yang berubah: `handovers.board` menjadi berhalaman (input kursor/batas/filter status per kolom), dan `FileContentDto` diganti (lihat §8).

**Kontrak `handovers.board` baru [saya].** Tiap kolom kanban (Baru, Dikerjakan, Selesai, Dibatalkan) dimuat terpisah: `handovers.board { locationIds, status, cursor?, limit }` → `{ items, nextCursor, total }`. `total` = hitungan SQL per kolom untuk judul kolom. Urutan di server sesuai spek serah terima §12 (terbaru dahulu; pada Dikerjakan progres lebih sedikit di atas), sehingga tabel `handovers` menyimpan kolom turunan `checked_count` dan `total_count` (dihitung saat tulis) dan `updated_at` berindeks. Klien memuat halaman berikutnya saat daftar kolom digulir ke bawah (infinite scroll per kolom). Ponsel memakai `status` yang dipilih sebagai satu daftar. Optimistic update centang memperbarui item di halaman yang termuat; kolom diurut ulang setelah server menjawab (perilaku sekarang). `usePendingIds`, antrean centang, dan prefetch disesuaikan; persist TIDAK menyimpan board. Perubahan kontrak ini dicatat di `shared/rpc.ts`, dan frontend menyesuaikan `handover-board-page`.

## 8. Berkas dan jembatan Google

### 8.1 Jembatan (`bridge/`)
Proyek Apps Script **baru dan terpisah** dengan deployment sendiri (web app, dijalankan sebagai pemilik). Deployment `/exec` aplikasi sekarang tidak disentuh. Aksi (allowlist): `drive.createFolder`, `drive.createFile`, `drive.readFile`, `drive.fileInfo`, `drive.folderExists`, `drive.trashFile`, `drive.externalFileInfo`, `drive.readExternalFile`, `drive.copyFile`, `drive.renameFile`, `drive.shareAnyoneWithLink`, `drive.revokeSharing`, `drive.replaceFileContent` (sama dengan antarmuka `Platform` Drive sekarang), serta `sheets.dump` (impor awal) dan `sheets.export`.

Keamanan jembatan (web app Apps Script bersifat publik di internet):
- Setiap permintaan membawa `ts` dan tanda tangan HMAC-SHA256 atas badan (`BRIDGE_SECRET`); jembatan menolak tanda tangan salah, `ts` di luar jendela singkat (mis. ±2 menit), dan aksi di luar allowlist. Perbandingan waktu-konstan. Semua kegagalan autentikasi menghasilkan galat yang sama.
- Batas ukuran badan, pembatas percobaan salah (pola `sync/auth` yang sudah ada), dan tidak pernah membuat/menghapus selain di folder yang dikonfigurasi (validasi induk folder, seperti `driveReadFile(fileId, folderId)` sekarang).
- Rahasia hanya di Script Properties/Worker Secrets.

### 8.2 Aliran berkas tanpa decode di Worker
Apps Script web app hanya mengembalikan teks, jadi berkas dikirim sebagai base64. Worker meneruskannya **sebagai teks apa adanya**:
- **Baca:** `files.get` mengembalikan base64 tanpa diubah (Worker mengambil dari jembatan, menaruhnya di Cache API / header cache, dan meneruskan). **Klien** mengubah base64 menjadi blob. `FileContentDto` tetap berisi base64, hanya tanpa diproses di Worker.
- **Unggah:** klien sudah mengecilkan gambar dan mengirim base64; Worker menyambung badan ke amplop jembatan dengan penggabungan string tanpa `JSON.parse` atas badan besar. **[verifikasi lewat spike]** apakah batas ukuran badan (≤ ±540 KB) dan CPU tetap di bawah anggaran; bila tidak, alternatifnya unggahan langsung klien → jembatan dengan tiket bertanda tangan dari Worker (builder memutuskan).
- **Konsistensi D1 ⇄ Drive [saya].** Tidak ada transaksi bersama, jadi urutannya: **unggah/buat = Drive dulu, lalu D1** (kegagalan sesudah Drive meninggalkan berkas yatim yang dibersihkan cron; pengguna melihat galat dan mengulang); **hapus/ganti = tandai di D1 dulu (status `pending_delete`), lalu Drive, lalu hapus baris** (cron mencoba ulang yang tersangkut). Tabel `files` dan ekspor QR mendapat kolom `status` untuk ini, dan cron pembersihan mencakup berkas yatim di semua folder yang dikelola, bukan hanya `qr_documents`.
- **Ulang aman:** `files.upload` tetap idempoten terhadap kegagalan di tengah (berkas Drive yatim dibersihkan oleh cron).
- **Redirect Apps Script:** web app menjawab `POST` dengan 302 ke `script.googleusercontent.com`. `fetch` Workers mengikuti 302 dengan `GET` tanpa badan sesuai spesifikasi fetch; ini **[verifikasi lewat spike]** dengan permintaan nyata, termasuk ukuran badan besar.
- **Latensi:** jembatan tetap 1,5–2,5 dtk per panggilan (waktu tunggu, tidak dihitung CPU). Operasi yang butuh banyak panggilan Drive (mis. ekspor QR) dijalankan lewat antrean (§9b) dan statusnya ditampilkan ke pengguna.

### 8.3 Impor dan ekspor Sheets
- **Impor awal (sekali):** skrip lokal (Bun, bukan Worker) memanggil `sheets.dump` untuk mendapat semua tabel sebagai JSON, memvalidasi baris terhadap skema (tipe, kunci unik, rujukan antar tabel), dan menghasilkan berkas SQL `INSERT` untuk `wrangler d1 execute --file`. Dijalankan berulang di staging (gladi) sebelum produksi.
- **Ekspor:** consumer antrean (§9b) membaca D1 per halaman (±500 baris) dan mengirim potongan ke `sheets.export` (membuat/menimpa sheet laporan; baris pertama = nama kolom). Dipicu manual (tombol admin) dan opsional terjadwal. Sheets hasil ekspor **hanya baca**; suntingan di sana tidak kembali ke D1.

## 9. Sinkron QC Desktop

Kontrak `docs/api/desktop-sync.md` (amplop, token di body, kode galat, pembatas 10 salah/10 menit, body ≤ 5 MB, paginasi) dipertahankan; endpoint menjadi `POST https://<domain-worker>/sync`. Tidak ada lagi redirect 302. Syarat peralihan: data `sync_state` dan semua `sync_rev` item/merk **diimpor apa adanya** sehingga kursor Desktop tetap valid. QC Desktop adalah proyek terpisah: pemilik/pemelihara Desktop harus mengganti URL pada hari cutover (lihat §11). Ukuran halaman sinkron dibatasi dan diukur terhadap anggaran CPU (hash `itemSyncSignature_` per item).

## 9b. Pekerjaan latar lewat Queues **[pemilik: ekspor dilakukan di queue]**

Semua pekerjaan yang butuh banyak panggilan jembatan (ekspor QR ke Drive, ekspor D1 ke Spreadsheet, pembersihan berkas yatim) dijalankan oleh **consumer Cloudflare Queues**, bukan di dalam permintaan pengguna. Tiap pesan antrean = satu invokasi consumer dengan anggaran CPU dan subrequest sendiri, sehingga batas per permintaan tidak mengikat alur pengguna.

- **Producer:** RPC ekspor (mis. `qrcodes.export`) memvalidasi izin dan input, menyisipkan baris `jobs` (status `queued`) di D1, mengirim pesan `{ jobId }` ke antrean, lalu membalas segera dengan `jobId`. Respons tidak menunggu Drive.
- **Consumer:** memproses satu potongan kecil per pesan (mis. satu berkas QR, atau ±500 baris ekspor), memperbarui `jobs` (`running`/`progress`/`done`/`failed` + hasil seperti id berkas Drive), dan mengirim pesan lanjutan untuk potongan berikutnya. Idempoten per potongan (pesan bisa terkirim ulang).
- **Status ke pengguna:** klien memantau `jobs.get { id }` (polling ringan, interval bertahap) dan menampilkan progres, hasil, atau galat jelas. Pekerjaan gagal bisa diulang; berkas Drive setengah jadi mengikuti aturan yatim (§8.2).
- **Batas dan ukuran:** ukuran potongan dipilih agar satu invokasi aman di bawah 10 ms CPU dan batas subrequest. Percobaan ulang otomatis dengan batas dan antrean galat mati (DLQ) bila tersedia. Terverifikasi (§2b): Queues tersedia di paket gratis, 10.000 operasi/hari (≈ 3 per pesan), retensi 24 jam, pesan 128 KB. **[verifikasi lewat spike Fase 0]:** batas CPU consumer di paket gratis.
- **Cron:** `scheduled()` hanya menjadwalkan (memasukkan pesan ke antrean); pekerjaan beratnya tetap di consumer.

## 10. Cron

`scheduled()` Worker menggantikan trigger waktu Apps Script (`cleanupQrPdfs`, `docs/setup-google.md` 7d): mencari `qr_documents` yatim di D1 melewati masa tenggang lalu memerintahkan jembatan `drive.revokeSharing`, dengan memasukkannya ke antrean (§9b), bukan mengerjakannya di handler cron (CPU cron ≤ 10 ms di paket gratis, terverifikasi §2b). Jadwal cron memakai UTC (WIB = UTC+7). Ekspor terjadwal ke Sheets memakai mekanisme yang sama.

## 11. Frontend

- **Routing standar (browser history) [pemilik].** `createHashHistory` (alamat `/#/handover`) diganti `createBrowserHistory` (alamat `/handover`). Hapus `web/src/app/gas-location.ts` (sinkron hash ke `google.script.history`) dan semua asumsi `#` (tautan, redirect OAuth, tes, dokumen E2E). Pelayanan SPA memakai fitur Cloudflare (dokumentasi *Single Page Application*):
  - `wrangler.jsonc`: `assets.directory` = hasil build, `assets.not_found_handling = "single-page-application"`, `compatibility_date` ≥ 2025-04-01, dan `assets.run_worker_first = ["/api/*", "/auth/*", "/sync"]` (daftar pola, bukan `true`). Butuh Wrangler ≥ 4.20.0.
  - Akibatnya: berkas yang cocok (JS/CSS/gambar) dilayani tanpa Worker; **navigasi ke rute klien** (mis. `/handover`, refresh, bookmark) tak cocok berkas mana pun dan dijawab `index.html` (200) tanpa memanggil Worker; hanya `/api/*`, `/auth/*`, `/sync` yang memanggil Worker. Permintaan Worker dan CPU tidak terpakai untuk memuat halaman.
  - **Peringatan dokumentasi:** tanpa `run_worker_first`, navigasi (header `Sec-Fetch-Mode: navigate`) tidak pernah sampai ke Worker, sehingga `/auth/callback` (redirect OAuth) akan menerima HTML. Pola `/auth/*` di atas mencegah itu dan **wajib**. Tes: login penuh di staging.
  - Rute tak dikenal tetap dijawab 200 + `index.html`; halaman 404 ditangani TanStack Router (`notFoundComponent`), bukan server. `/api/*` yang tak dikenal dijawab galat JSON oleh Worker.
  - Pola `run_worker_first` hanya untuk jalur API; JANGAN `true` (semua aset akan memanggil Worker dan di paket gratis ikut kena 429 saat kuota habis).
- Transport: `createGasTransport` (`google.script.run` + batching) diganti `createHttpTransport` (`fetch` ke `/api/rpc`). Antarmuka `Transport` (`web/src/lib/rpc/transport.ts`) dipertahankan sehingga `client.ts` dan semua `queries.ts` tidak berubah.
- Hapus bundel satu berkas: build memakai potongan biasa dengan lazy load (rute, editor Tiptap, pdf-lib/ekspor QR). Batas `MAX_INDEX_BYTES` diganti anggaran per potongan di `verify-dist`. Pekerjaan lazy load yang tertunda dari fitur serah terima selesai di sini.
- Mock backend `bun run dev`: sekarang menjalankan router dan layanan GAS asli di memori peramban. Setelah async/D1, **[saya]** pengembangan lokal memakai `wrangler dev` (D1 lokal via Miniflare) dengan proxy dari Vite; mock di peramban dihapus. Tes unit/integrasi worker memakai adaptor D1 berbasis `bun:sqlite` agar cepat.
- Antrean centang optimistis, `usePendingIds`, dan semua perilaku UI serah terima tidak berubah.
- Urutan boot: hapus injeksi boot HTML; `GET /api/boot`.

## 12. Strategi pengujian

1. **Paritas:** kumpulan skenario RPC (dari tes `gas/src/**` yang ada, ±450) diporting ke async dan dijalankan terhadap Worker + adaptor D1 `bun:sqlite`. Tes `shared/` (148) tidak berubah. Kegagalan paritas = bug porting, bukan perubahan perilaku.
2. **Kontrak:** tes bahwa tiap entri `RpcContract` punya rute Worker (mengganti pemeriksaan `RouteTable`).
3. **Anggaran CPU:** skrip beban di staging (§5) sebagai gerbang rilis.
4. **Jembatan:** tes tanda tangan/replay/allowlist; spike nyata terhadap Apps Script (bukan tiruan) untuk redirect, ukuran badan, kuota.
5. **Migrasi data:** gladi impor di staging dengan salinan data nyata: jumlah baris per tabel sama, ringkasan (checksum) kolom kunci sama, sampel baris dibandingkan, rujukan (customer, lokasi, berkas) tidak ada yang yatim.
6. **E2E manual:** `docs/e2e-checklist.md` dijalankan penuh di staging; ditambah baris untuk berkas via jembatan, ekspor Sheets, dan sinkron Desktop.

7. **Porting tes.** Banyak tes `gas/src` bergantung pada `gas/test-support` (memory platform, `bumpTableVersion_`, lock). Itu pekerjaan tersendiri: adaptor D1 `bun:sqlite` dan fixture ditulis di Fase 1, dan porting tes dihitung di dalam estimasi tiap modul Fase 2 (bukan dikerjakan di akhir).

## 12b. Kebijakan data dan audit **[saya]**
- **Impor data kotor:** skrip impor TIDAK menolak diam-diam dan TIDAK memperbaiki sembarangan. Normalisasi deterministik yang aman diterapkan otomatis dan dilaporkan (pemangkasan spasi, angka tersimpan sebagai teks → INTEGER, format tanggal dikenal → ISO). Id ganda, rujukan yatim, atau tanggal tak terbaca **menghentikan impor** dengan laporan per baris; pemilik memutuskan memperbaiki di Sheets atau mengecualikan baris. Hasil gladi (Fase 5) memuat jumlah baris ternormalisasi/dikecualikan.
- **`audit_log`:** disimpan semua (tanpa retensi), halaman audit memakai kursor, indeks `audit_log(created_at)`. Pantau ukuran D1; bila mendekati batas, arsip ke Sheets lewat ekspor lalu hapus yang lama (keputusan pemilik saat itu).

## 13. Fase dan urutan kerja

**Fase 0 — Spike dan fondasi (tidak menyentuh produksi).** Jawab yang **[verifikasi]**: batas paket gratis (CPU, subrequest/query D1 per invokasi, ukuran badan, cron), perilaku redirect Apps Script dari `fetch` Workers, ukuran badan unggah/baca base64 dan CPU-nya, `cpuTime` terukur di `wrangler dev`/tail. Buat akun/proyek Cloudflare, D1 staging + produksi, redirect URI OAuth. *Keluaran:* catatan hasil spike dan keputusan alur berkas (§8.2).

**Fase 1 — Kerangka Worker.** `worker/` (router, error, validasi), lapisan data async di atas D1 (+ adaptor `bun:sqlite` untuk tes), migrasi skema awal, auth (OAuth, sesi, `/api/boot`), CI (tes + `wrangler deploy` staging, `d1 migrations apply`). *Keluaran:* login ke staging berhasil; `me` terbaca.

**Fase 2 — Porting modul** (urut dari yang paling mendasari): `access` (pengguna, peran, lokasi, audit) → `brand`, `customer` → `files` (butuh jembatan) → `item` → `handover` (termasuk board berhalaman, `base`, centang, komentar) → `qrcode` → `sync`. Tiap modul: port, tes paritas, ukuran CPU. *Keluaran:* semua RPC di staging lulus paritas.

**Fase 3 — Jembatan dan antrean.** `bridge/` dengan HMAC, aksi Drive, `sheets.dump`, `sheets.export`; skrip `clasp` + CI untuk jembatan. Antrean + consumer + tabel `jobs` + `jobs.get`, cron `scheduled()` yang hanya menjadwalkan (pembersihan QR, ekspor). *Keluaran:* unggah/baca/ekspor QR berfungsi di staging.

**Fase 4 — Frontend.** Transport HTTP, pecah bundel, `board` berhalaman, hapus mock-di-peramban, perbarui `verify-dist`. *Keluaran:* aplikasi staging penuh dengan E2E hijau; gerbang CPU p99 ≤ 8 ms lulus.

**Fase 5 — Gladi migrasi data.** Skrip impor + verifikasi; ulangi sampai mulus dan terdokumentasi dengan waktu tempuh terukur. *Keluaran:* runbook cutover terbukti.

**Fase 6 — Cutover (satu jendela pemeliharaan).**
1. Umumkan jendela; minta tim QC Desktop menghentikan sinkron.
2. Bekukan tulis di aplikasi lama (mode baca-saja atau tutup akses) — tidak ada tulis baru.
3. Jalankan impor akhir Sheets → D1 produksi; jalankan verifikasi (jumlah baris, checksum, rujukan).
4. Uji cepat (smoke) di produksi: login, daftar, centang, unggah gambar, ekspor.
5. Arahkan pengguna ke domain Worker; ganti URL QC Desktop dan hidupkan lagi sinkron; amati.
6. Aplikasi lama dan Sheets dibiarkan **utuh dan baca-saja** sebagai jalan mundur.
*Jalan mundur:* sebelum ada tulis baru di D1 yang penting, cukup kembalikan URL ke aplikasi lama dan buka kembali tulis. Setelah ada tulis baru, jalan mundur = ekspor D1 ke Sheets lalu memutuskan manual data mana yang dipakai (pemilik memutuskan; hindari kondisi ini dengan smoke test ketat dan pemantauan awal).

**Fase 7 — Stabilisasi dan penghentian.** Pantau 2–4 minggu (galat 1102, CPU, kuota D1). Lalu hapus `gas/` (kecuali yang dipindah ke `bridge/`), perbarui `CLAUDE.md`, `docs/ci-cd.md`, `docs/setup-google.md`, `docs/api/desktop-sync.md` (URL), dan PRD NFR yang menyebut Apps Script/Sheets sebagai penyimpanan.

## 14. Risiko

| Risiko | Penanganan |
|---|---|
| Rute melewati 10 ms CPU (galat 1102) | Anggaran §5, gerbang p99, paginasi, tanpa decode base64, SQL berindeks |
| Kuota Queues gratis (10.000 operasi/hari, retensi 24 jam) atau CPU konsumen tidak cukup | Pesan sedikit dan besar; `jobs` dapat diulang; spike Fase 0; bila tidak cukup, pemilik memutuskan paket berbayar atau pembatasan fitur |
| Aliran berkas lewat jembatan lambat atau melewati batas badan/CPU | Spike Fase 0; alternatif unggahan langsung klien ↔ jembatan bertiket |
| Jembatan terbuka publik | HMAC + jendela waktu + allowlist + batas ukuran + pembatas percobaan |
| Data tidak konsisten saat cutover | Jeda tulis, impor akhir terverifikasi, aplikasi lama tetap utuh |
| QC Desktop tidak sempat berganti URL | Koordinasi sebelum jendela; URL Desktop dapat dikonfigurasi; `sync_rev` dibawa |
| Kuota gratis (D1 baris dibaca, permintaan harian) terlampaui oleh indeks yang kurang | Indeks wajib + `EXPLAIN` + pantauan |
| Porting menyelundupkan perubahan perilaku | Tes paritas dari tes gas yang ada; kontrak DTO tetap |
| Biaya porting async besar | Dikerjakan modul demi modul dengan tes; `shared/` tidak tersentuh |

## 15. Pertanyaan yang hanya Anda yang bisa jawab

1. Domain: cukup `*.workers.dev` atau memakai domain sendiri? (memengaruhi redirect OAuth dan URL Desktop)
2. Perkiraan jumlah item, pelanggan, dan baris audit sekarang dan setahun ke depan (untuk memastikan kuota D1 dan ukuran halaman sinkron).
3. Siapa yang memelihara QC Desktop dan bisakah URL sinkron diganti pada hari cutover?
4. Setuju lingkungan **staging** terpisah (Worker + D1 staging + jembatan staging) selain produksi?
5. Apakah masa jalan mundur 2–4 minggu (aplikasi lama tetap hidup, baca-saja) cukup?
6. ~~Batas subrequest untuk ekspor~~ — dijawab pemilik: ekspor berjalan di Queues (§9b). Bila spike menunjukkan Queues tidak tersedia/cukup di paket gratis, pemilik diminta memutuskan ulang (paket berbayar atau pembatasan fitur).

## 16. Diserahkan kepada pembangun

Tipe kolom D1 dan daftar indeks tepat; struktur folder `worker/` dan `bridge/`; pilihan `wrangler` vs alat lain untuk CI; pemisahan `handover_comments` (§7.3) dan cookie vs token sesi (§6) bila ada alasan teknis kuat (catat sebagai Ruling); bentuk akhir unggah berkas (§8.2) setelah spike; detail skrip impor/verifikasi.
