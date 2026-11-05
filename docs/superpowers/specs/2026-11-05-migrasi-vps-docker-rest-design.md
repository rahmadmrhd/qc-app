# Backend di VPS (Docker, Bun + Hono + MariaDB) dengan API REST — rancangan

| | |
|---|---|
| **Tanggal** | 2026-11-05 |
| **Status** | Draf untuk persetujuan pemilik (belum ada kode ditulis) |
| **Menggantikan** | `2026-10-25-migrasi-cloudflare-worker-d1-design.md` (dibatalkan pemilik 2026-11-05; lihat §2 dan §14) |
| **Cakupan** | Backend QC App, kontrak API FE↔BE dan QC Desktop, basis data, deploy, CI/CD, cadangan, cutover dari Google Sheets |
| **Dasar** | Kode saat ini (`worker/`, `bridge/`, `gas/`, `shared/`, `web/`), `docs/api/desktop-sync.md`, `docs/ci-cd.md`, pemeriksaan VPS lewat SSH (baca-saja, 2026-11-05), percakapan dengan pemilik |

Tanda: **[pemilik]** = diputuskan pemilik. **[saya]** = pilihan saya yang belum Anda setujui; koreksi bila salah. **[verifikasi]** = fakta yang HARUS dicek saat perencanaan/implementasi sebelum dijadikan dasar.

---

## 1. Maksud dan alasan

Migrasi ke Cloudflare Worker + D1 (rancangan 2026-10-25) tidak pernah sampai cutover. Gerbang CPU (p95 ≤ 8 ms per rute di edge) tidak lulus pada paket gratis: rute berotentikasi terukur p95 13–17 ms, dan uji beban menghabiskan kuota D1 harian (`docs/superpowers/spikes/2026-10-cpu-gate.md`). Hampir semua kerumitan kode Worker (penggabungan kueri `db.batch()`, penjaga CAS lewat `integer overflow`, cache memori per isolate, JSON disusun di SQLite, batas 5 task per permintaan) ada hanya untuk menyiasati batas itu.

Pemilik sudah memiliki VPS dan domain, sehingga batas tersebut hilang. Keberhasilan = backend berjalan di VPS sendiri dalam Docker dengan MariaDB, API berstandar REST, rilis otomatis lewat GitHub Actions, dan data produksi dari Google Sheets berpindah tanpa kehilangan — dengan kode yang **lebih sederhana** daripada Worker.

## 2. Keputusan pemilik **[pemilik]** (2026-11-05)

1. **Pembatalan migrasi Cloudflare.** Worker + D1 + Queues + R2 + `wrangler` tidak diteruskan.
2. **Deploy di VPS milik pemilik, dikemas dengan Docker** (`docker compose`).
3. **Basis data MariaDB/MySQL** (bukan SQLite/D1, bukan Postgres).
4. **Backend: Bun + Hono** (dipilih dari opsi Bun+Hono / Node / Go-Rust).
5. **Frontend tetap** (React + Vite, struktur modul sama), tetapi pemanggilan API dirombak dari gaya RPC (`POST /api/rpc` dengan nama metode) menjadi **REST standar**.
6. **Seluruh API, termasuk sinkron QC Desktop, dikonversi ke REST.** Kontrak `docs/api/desktop-sync.md` belum dipakai klien mana pun, jadi tidak ada jalur kompatibilitas.
7. **Google Apps Script hanya untuk hal yang butuh platform Google**: Drive (berkas) dan Spreadsheet (impor awal, ekspor). Jembatan `bridge/` dipertahankan; aplikasi GAS lama (`gas/`) dipensiunkan setelah cutover **[saya]**.
8. **DNS di Cloudflare, mode proxy, SSL Full (strict).** VPS dapat diakses lewat SSH (alias `rhd_vps_ipv4`) untuk deploy.
9. **Cadangan = dump SQL ke Google Drive**; **penghapusan dump lama dilakukan trigger waktu di Apps Script**, bukan di VPS (agar VPS tidak terbebani).
10. **CI/CD otomatis ke staging dan production.** Nama environment GitHub saat ini: **`dev`** dan **`exec`**. Staging berjalan di VPS yang sama dengan production.
11. **Email peringatan cadangan disetujui**: trigger GAS di jembatan mengirim email ke pemilik bila cadangan terbaru > ±36 jam (menambah izin `MailApp` pada jembatan).
12. **Basis data untuk pengembangan dan tes: MariaDB di Docker pada VPS, diakses lewat SSH tunnel** — tanpa memasang Docker di mesin Windows pemilik (jawaban pemilik atas pertanyaan Docker lokal).
13. **Status sistem GAS saat ini**: fitur-fitur di sistem GAS terhenti; **yang berjalan di produksi hanya QR Code generator**. Konsekuensi: tidak ada pengembangan fitur baru di sistem lama; hotfix hanya untuk QR generator bila darurat; data produksi yang hidup di Sheets terutama modul akses dan QR.

## 3. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- Semua fitur dan perilaku bisnis yang ada tetap sama (izin, lokasi, handover/checklist/komentar, item/merk/customer, QR, audit, sinkron Desktop, PWA).
- API REST yang konsisten dan terdokumentasi (OpenAPI dihasilkan dari kode), dengan tipe bersama FE↔BE (`shared/`).
- Konsistensi data tulis-bersamaan (task handover, nomor `ST-YYYYMMDD-NNN`, merk/item unik) dijaga transaksi MariaDB, bukan trik SQLite.
- Deploy berulang yang aman: build di Actions, migrasi otomatis, uji asap, kembali ke versi sebelumnya bila gagal.
- Cadangan harian yang terbukti bisa dipulihkan.

**Bukan-tujuan**
- Mengubah fitur atau UI. Mengganti React/Vite/TanStack/shadcn.
- Memindahkan berkas gambar/PDF dari Drive ke VPS. Mengganti login Google.
- Skala horizontal (lebih dari satu instance app). Satu VPS cukup.
- Menjalankan ulang gerbang CPU edge atau optimasi D1 (ditutup).

**Anti-tujuan** (gagal walau "jalan")
- Menyentuh container, konfigurasi nginx, atau firewall aplikasi lain di VPS (Frappe/ERP, MySQL dev, Postgres).
- Menyimpan rahasia di repositori atau di GitHub selain kunci SSH deploy.
- Cutover yang kehilangan atau menggandakan data Sheets.
- Mempertahankan kode khusus-Cloudflare yang tak lagi berguna.

## 4. Kondisi VPS (dibaca 2026-11-05, baca-saja) **[verifikasi ulang saat deploy]**

- Ubuntu 26.04, x86_64, **2 vCPU, 3,8 GB RAM (±2,4 GB tersedia), disk 38 GB (±12 GB kosong)**. Docker 29.1.3, Compose 2.40.3. Login SSH sebagai `root` (port SSH nonstandar).
- **Dipakai bersama**: nginx host menahan 80/443 (firewall `ufw` hanya mengizinkan rentang IP Cloudflare untuk 80/443); stack Frappe/ERPNext (termasuk `mariadb:11.8` miliknya), `mysql:8.0` dev di `127.0.0.1:33061`, Postgres di `127.0.0.1:5432`, proses Python di `127.0.0.1:8787`, `x11vnc`/`wine`.
- Konsekuensi: **tanpa proxy baru** (pakai nginx yang ada), **MariaDB khusus QC dengan memori dibatasi** (jangan menumpang MariaDB/MySQL milik aplikasi lain), **port 8787 tidak boleh dipakai**, disk terbatas (dump/log/image harus dibatasi dan dibersihkan).

## 5. Arsitektur

```
Browser/PWA ──► Cloudflare (proxy, Full strict) ──► nginx host (80/443) ──► 127.0.0.1:<port>
QC Desktop  ─────────────────────────────────────────────────────────────────┘
                                                        │
                                          docker compose (per lingkungan)
                                          ┌──────────────┴──────────────┐
                                          │ qc-app  (Bun + Hono)        │── HMAC ──► Jembatan Apps Script ──► Drive / Sheets
                                          │  API REST + berkas statis   │
                                          │  penjadwal internal         │
                                          │ qc-db   (MariaDB 11.8 LTS)  │   (volume bernama; tak diekspos ke host)
                                          └─────────────────────────────┘
```

- **`qc-app`** melayani API (`/api/v1/*`), alur login (`/auth/*`), dan hasil build web (SPA, fallback `index.html`) dalam satu origin (tanpa CORS). Mendengarkan hanya di `127.0.0.1:<port>`; nginx menambah satu blok `server {}` per subdomain **[saya]**.
- **`qc-db`**: MariaDB 11.8 LTS **[saya]**, `utf8mb4`, `innodb_buffer_pool_size` ≈ 128–256 MB, tanpa port ke host. Satu container database per lingkungan **[saya]** (dev/staging dan exec/production terpisah total; alternatif satu server dua skema lebih hemat ±300 MB tetapi kurang terisolasi — keputusan pemilik di §13).
- **Penjadwal internal** di `qc-app` (bukan Queue): pembersihan berkala (sesi/rate-limit/job lama), ekspor Sheets, dump cadangan. Pekerjaan berat (ekspor, dump) dieksekusi berurutan dengan kunci agar tidak menumpuk di 2 vCPU **[saya]**.
- **IP asli klien**: dibaca dari `CF-Connecting-IP`, **hanya dipercaya bila permintaan datang dari nginx host** (loopback); dipakai untuk pembatas percobaan salah (token sinkron, login) dan log.
- **Jembatan GAS tidak berubah** protokolnya (HMAC + `ts` + allowlist folder, `docs/setup-bridge.md`); hanya ditambah aksi/trigger cadangan (§10).

## 6. Backend (`server/`, menggantikan `worker/`)

**Pilihan [pemilik]:** Bun + Hono. **Turunan [saya]:**
- **Struktur**: folder `worker/` diganti nama menjadi `server/` pada branch yang sama; `modules/<modul>/{repo,service,validate,routes}.ts`, `core/`, tes, dan `shared/` dipakai ulang. Alias `@worker/*` → `@server/*`.
- **Akses data**: **Kysely** (dialek MySQL/MariaDB) dengan SQL mentah (`sql` tag) untuk kueri kompleks; migrasi berupa berkas SQL bernomor dengan pelacak versi sederhana. Driver: yang stabil di Bun (`mysql2` atau `Bun.sql`) **[verifikasi]**; cadangan bila bermasalah: Node + Hono.
- **Validasi & dokumentasi**: zod (sudah dipakai) dengan `@hono/zod-openapi` sehingga OpenAPI dihasilkan dari rute dan menjadi kontrak REST yang tidak bisa menyimpang dari kode.
- **Dibuang**: `wrangler.jsonc`, Queue/`jobs` consumer berbasis antrean, R2/`file-cache` R2, `mem-cache.ts` + `touchCache/settleCache` + `RouteDef.warm`, `PreEncodedJson`, `pre-encoded.ts`, batas `HANDOVER_WORKER_BATCH`, skrip gerbang CPU (`load-cpu*`), `hot-path.test.ts`, bagian "Aturan Worker" di `CLAUDE.md`. Cache diperkenalkan lagi **hanya bila pengukuran menuntutnya** **[saya]**.
- **Dipertahankan**: logika domain murni di `shared/` (status handover, checklist, saran customer, QR layout), model izin, pemeriksaan izin per lokasi, audit, validasi, error berkode, log terstruktur + `requestId`.
- **Konkurensi**: pola CAS (`updated_at`/`version` dan penghitung nomor) diganti transaksi + `SELECT … FOR UPDATE` atau `UPDATE … WHERE version = ?` dengan pemeriksaan baris terpengaruh; konflik → `409`/`412`. Tes konkurensi handover (`03850ac`) diportingkan sebagai tes MariaDB sungguhan.

## 7. Kontrak REST **[saya, kecuali ditandai]**

**Konvensi**
- Dasar `/api/v1`, JSON, nama sumber daya jamak berbahasa Inggris (`/handovers`, `/items`, …), kunci JSON camelCase (mengikuti DTO `shared/rpc.ts` yang ada).
- Verba: `GET` baca, `POST` buat/aksi, `PUT` ganti, `PATCH` ubah sebagian (mis. status), `DELETE` hapus. Aksi non-CRUD sebagai sub-sumber daya (`POST /handovers/{id}/cancel`).
- Kode status benar (200/201/204/400/401/403/404/409/412/422/429/5xx). Galat memakai **`application/problem+json` (RFC 9457)** dengan ekstensi `code` (nilai `ErrorCode` yang ada), `requestId`, dan `fields` untuk validasi; amplop `{ok,data}` dihapus.
- **Konkurensi optimistis**: `ETag` pada GET sumber daya tunggal dan `If-Match` pada PUT/PATCH/DELETE; versi tak cocok → `412`. Tempat kolom `updated_at`/`version` dipakai sekarang.
- **Paginasi** kursor (`?cursor=&limit=`), respons `{ items, nextCursor }` untuk daftar besar (board handover, audit, item).
- **Autentikasi web**: cookie sesi bertanda tangan (`HttpOnly`, `Secure`, `SameSite=Lax`) dari alur OAuth Google yang ada; mitigasi CSRF `X-Requested-With: qc` dipertahankan untuk metode non-aman. **Sinkron Desktop**: `Authorization: Bearer <token>` (token tidak lagi di badan), pembatas 10 salah/10 menit dipertahankan.
- **Berkas**: unggah **`multipart/form-data` atau badan biner**, unduh **stream biner dengan `Content-Type` benar**, `Cache-Control` privat, dan dukungan `ETag`; **base64-di-JSON dihapus** (hemat 33% dan memori). Batas ukuran tetap seperti sekarang kecuali pemilik mengubah.
- Versi: perubahan tak kompatibel → `/api/v2`. Dokumentasi: `GET /api/openapi.json` (dilindungi di produksi).

**Peta awal RPC → REST** (jalur final ditetapkan di OpenAPI pada Fase 1; daftar ini memastikan tidak ada metode terlewat — kompilator memeriksa kelengkapan seperti `ALL_RPC_METHODS` sekarang):

| RPC sekarang | REST |
|---|---|
| `auth.me` (+ `/api/boot`) | `GET /me` |
| `access.users.list/save/setStatus` | `GET/POST /users`, `PUT /users/{id}`, `PATCH /users/{id}` |
| `access.roles.list/save/delete` | `GET/POST /roles`, `PUT/DELETE /roles/{id}` |
| `access.locations.list/save/setStatus` | `GET/POST /locations`, `PUT/PATCH /locations/{id}` |
| `access.audit.list` | `GET /audit-logs` |
| `files.upload/get` | `POST /files`, `GET /files/{id}` |
| `brands.list/save/setStatus` | `GET/POST /brands`, `PUT/PATCH /brands/{id}` |
| `customers.list/rename/setStatus` | `GET /customers`, `PATCH /customers/{id}` |
| `items.list/get/save/setStatus` | `GET/POST /items`, `GET/PUT/PATCH /items/{id}` |
| `handovers.options/board/get` | `GET /handovers/options`, `GET /handovers`, `GET /handovers/{id}` |
| `handovers.save/saveBatch` | `POST /handovers`, `PUT /handovers/{id}`, `POST /handovers/batch` |
| `handovers.cancel/reopen/setDone` | `POST /handovers/{id}/cancel`, `/reopen`, `/done` |
| `handovers.setCheck/comment` | `PUT /handovers/{id}/checks`, `POST /handovers/{id}/comments` |
| `qrcodes.list/get/save/delete` | `GET/POST /qrcodes`, `GET/PUT/DELETE /qrcodes/{id}` |
| `qrcodes.getDefaults/savePreset/deletePreset/saveLogoLibrary` | `GET /qrcode-defaults`, `POST/PUT/DELETE /qrcode-presets…`, `PUT /qrcode-logos` |
| `qrcodes.uploadPdf/cloneFromDrive/file/export` | `PUT /qrcodes/{id}/pdf`, `POST /qrcodes/{id}/pdf/clone`, `GET /qrcodes/{id}/file`, `POST /qrcodes/{id}/exports` |
| `jobs.get`, `exports.sheets` | `GET /jobs/{id}`, `POST /exports/sheets` |
| `sync.ping/brands.pull/push/items.pull/push/file.get` | `GET /sync/ping`, `GET/POST /sync/brands…`, `GET/POST /sync/items…`, `GET /sync/files/{id}` (kontrak baru di `docs/api/desktop-sync.md`, versi API 2) |

Izin tiap rute (modul, level, `scope: 'location'`, `anyOf`) dipindahkan apa adanya.

## 8. Basis data MariaDB

- Skema: 20 tabel yang ada (`users … item_alias_keys`, `counters`, `jobs`, `job_blobs`, `rate_limits`, `settings`, `sync_state`) diterjemahkan dari `worker/migrations/0001–0009` ke MariaDB. Tabel `jobs`/`job_blobs` tetap (status ekspor), tanpa Queue.
- Terjemahan dialek **[saya]**: tipe eksplisit (`VARCHAR`/`TEXT`/`JSON`/`DATETIME(3)` atau ISO teks — dipilih di rencana dengan pertimbangan perbandingan dan urutan), `AUTO_INCREMENT` pengganti `rowid`, `json_each`/`json_object` diganti `JSON_TABLE`/`JSON_OBJECT` bila masih dibutuhkan, `RETURNING` hanya tersedia pada `INSERT`/`DELETE` (UPDATE perlu `SELECT` dalam transaksi yang sama). Format waktu di API tetap ISO 8601 UTC.
- Keunikan nama/alias item dan jumlah item per merk: **tabel `item_alias_keys` dan kolom `brands.item_count` dipertahankan** bila masih perlu (alias banyak-nilai tidak bisa jadi satu indeks unik); alasan awalnya (kuota rows read) hilang, jadi rencana boleh menyederhanakannya **[saya]**.
- Migrasi skema: berkas SQL maju-saja, dijalankan otomatis saat deploy (sebelum app baru menerima lalu lintas), wajib kompatibel mundur satu versi karena rilis berurutan.

## 9. Sinkron QC Desktop

QC Desktop (di balik VPN, memakai MySQL sendiri) tetap klien eksternal terpisah. Kontrak baru **REST, versi API 2**, dengan token Bearer di header, paginasi kursor, dan `ETag`/`If-Match` untuk deteksi konflik per item. Aturan yang tetap: perubahan field sinkron item/merk WAJIB menaikkan `sync_rev` (`itemSyncSignature_`), batas detail 50 item per halaman, status konflik per item (bukan galat tingkat atas). Dokumen `docs/api/desktop-sync.md` ditulis ulang sebagai bagian pekerjaan (sesuai aturan pencatatan keputusan pemilik).

## 10. Integrasi Google (jembatan GAS) dan cadangan

- **Jembatan**: tetap satu proyek per lingkungan; aksi Drive/Sheets yang ada tidak berubah. `BRIDGE_URL`/`BRIDGE_SECRET` pindah ke `.env` di VPS.
- **Login Google** tetap langsung dari backend (OAuth), tidak lewat GAS; URI redirect OAuth baru didaftarkan pemilik untuk domain VPS.
- **Cadangan [pemilik + saya]**:
  - Dump `mariadb-dump --single-transaction` dikompres gzip, nama `qc-backup-YYYYMMDD-HHmm.sql.gz`, **sekali per malam** (data yang rela hilang ≤ ±24 jam). Dijalankan penjadwal di `qc-app` **[saya]**.
  - Diunggah ke **folder Drive khusus** lewat jembatan (folder wajib masuk `ALLOWED_FOLDER_IDS`). Karena batas badan jembatan 1.048.576 karakter (±780 KB per berkas), dump dikompres lalu **dipotong menjadi beberapa bagian bila perlu** atau jembatan diberi aksi unggah bertahap khusus cadangan **[saya; dipilih di rencana]**.
  - **Pembersihan dilakukan trigger waktu Apps Script di jembatan [pemilik]** (pola sama dengan `cleanupQrPdfs`), **berbasis jumlah** bukan umur: sisakan 7 harian + 4 mingguan, **tidak pernah menghapus bila salinan tersisa < minimum**, agar unggahan yang berhenti tidak menghabiskan cadangan **[saya]**.
  - **Peringatan email [pemilik, disetujui 2026-11-05]**: trigger yang sama mengirim email ke pemilik (`MailApp`) bila cadangan terbaru > ±36 jam; menambah izin email pada jembatan (otorisasi ulang oleh pemilik saat deploy jembatan).
  - Di VPS hanya 2–3 salinan terakhir disimpan (disk terbatas); bila unggah gagal, dump tetap ada dan dicoba lagi pada jadwal berikutnya.
  - **Prosedur pemulihan** ditulis dan **diuji sekali** pada lingkungan staging sebelum cutover produksi.

## 11. Docker, deploy, dan CI/CD

- **Image `qc-app`** multi-stage (build web + build server), dasar image Bun ringan, pengguna non-root; satu tag per commit (SHA).
- **Compose per lingkungan** (`dev` = staging, `exec` = production) pada direktori terpisah di VPS dengan nama proyek berbeda, jaringan internal sendiri, rahasia di berkas `.env` (izin 600) milik pengguna deploy — **tidak** di GitHub dan tidak di repositori. Batas memori container ditetapkan agar tidak mengganggu aplikasi lain **[saya]**.
- **nginx**: satu berkas `server {}` per subdomain, TLS memakai sertifikat origin yang dipakai untuk Cloudflare Full (strict); direktif `real_ip` dari Cloudflare; batas ukuran unggah sesuai batas berkas **[saya]**. Pemeriksaan `nginx -t` sebelum reload; tidak menyentuh blok milik aplikasi lain.
- **CI (GitHub Actions)** — menggantikan `deploy-worker.yml` dengan `deploy-server.yml`, memakai ulang pola keamanan yang ada:
  - `test.yml` tetap (`bun run check`, `bun run build`) untuk setiap PR.
  - Merge PR ke `dev` → environment **`dev`** (staging); merge ke `main` → environment **`exec`** (production) — **[saya]** `exec` diasumsikan production. Dispatch manual hanya dari `main`/`dev`, ditolak sebelum checkout dari ref lain; `pull_request_target` hanya setelah merge dan hanya checkout `merge_commit_sha`; antrean serial tanpa membatalkan yang berjalan.
  - Langkah: check → build → build image dan dorong ke **GHCR** (tag SHA) **[saya]** → SSH ke VPS → `docker compose pull && up -d` → migrasi → uji asap `GET /api/ping` (dan kesehatan database) → bila gagal, kembali ke tag sebelumnya otomatis.
  - **Rahasia di GitHub hanya**: kunci SSH deploy per environment (+ token baca GHCR di VPS). Pengguna `deploy` khusus (bukan `root`) dengan kunci yang dibatasi hanya menjalankan skrip deploy **[saya]**.
  - Build di Actions (bukan di VPS) karena 2 vCPU dan server sibuk.
- Perubahan jembatan Apps Script tetap lewat alur `clasp` terpisah (`dev` → HEAD staging, `main` → versi baru produksi).

## 12. Frontend

- Struktur modul, router, query (TanStack), form, tema, PWA, dan `shared/` tetap.
- Berubah: `web/src/lib/rpc/*` (transport, klien, penerjemah galat) diganti **klien REST bertipe** (satu modul `lib/api`), dan `queries.ts` tiap modul memakai metode/jalur REST. Galat `problem+json` diterjemahkan ke `describeError` yang sama. `ETag/If-Match` menggantikan pengiriman `updatedAt` manual. Unggah/unduh berkas memakai biner, bukan base64.
- `gas-transport`/penggabungan RPC 15 ms dan `defaultPreload: false` (alasan GAS) dihapus pada PR cutover (lihat §13): sesudah itu FE hanya disajikan `qc-app` dan build GAS (`build:gas`) tidak lagi didukung di branch utama; FE lama untuk jalan mundur tinggal di tag `gas-legacy`.
- Build produksi tetap ke direktori yang dilayani `qc-app`; `verify-dist` (tanpa kode mock, batas ukuran potongan) dipertahankan.

## 13. Strategi branch, koeksistensi dengan GAS, dan pilihan hasil pemeriksaan penyusun

**Fakta [verifikasi 2026-11-05]**: `origin/main` = jalur produksi aplikasi GAS (merge PR → `deploy.yml` → `/exec`); branch ini (`feat/migrasi-cloudflare`) 115 commit di depan `origin/main`. Mesin pengembangan Windows belum memiliki Docker (WSL Ubuntu ada).

**Pilihan saya [saya]** (koreksi bila salah):
1. **`origin/main` dibekukan sebagai jalur GAS lama sampai cutover.** Branch ini TIDAK di-merge ke `main` sebelum cutover (merge itu akan memicu `deploy.yml` dengan FE REST yang tak bisa jalan di GAS). Tag `gas-legacy` dipasang pada `origin/main` saat cutover sebagai titik jalan mundur. Karena fitur GAS terhenti dan hanya QR generator yang berjalan (keputusan 13), hotfix hanya untuk QR generator bila darurat, lewat PR kecil langsung ke `main`. Bendera `READ_ONLY` (ada di branch ini, belum di `main`) dibawa ke `main` lewat PR kecil sebelum cutover.
2. **Staging sebelum cutover** di-deploy lewat `workflow_dispatch` `deploy-server.yml` dari branch kerja (aturan environment `dev` sementara mengizinkan branch itu). Saat cutover: satu PR menggabungkan branch ke `main` DAN menonaktifkan/menghapus `deploy.yml` (GAS) dalam PR yang sama; sesudahnya aturan normal berlaku (`dev` → environment `dev`, `main` → `exec`).
3. **Environment**: `dev` dan `exec` baru dipakai `deploy-server.yml`; `gas-dev`/`gas-exec` milik `deploy.yml` lama tetap sampai `gas/` dipensiunkan.
4. **Rollback data**: tidak ada sinkron balik otomatis ke Sheets. Bila mundur, tulisan di sistem baru selama jendela dipulihkan **manual** lewat runbook (ekspor `sheets.export`/dump MariaDB lalu masukkan ulang). Skala ±50 task/bulan membuat ini wajar. Jendela cutover yang diterima: **jeda tulis beberapa jam** (keputusan pemilik 2026-10-25 pada rancangan Cloudflare, dibawa ke sini; konfirmasi bila berubah).
5. **Staging memakai proyek jembatan GAS dan folder Drive staging terpisah** (`bridge/deployment.staging.json` sudah ada), dan boleh berisi salinan data nyata untuk gladi dengan akses terbatas pada pemilik.
6. **Tes dan dev [pemilik: DB lewat tunnel; sisanya saya]**: tes konkurensi/SQL memakai MariaDB sungguhan. Lokal: MariaDB di Docker **pada VPS**, diakses lewat SSH tunnel (`bun run db:tunnel` membuka `127.0.0.1:<port lokal>` ke database VPS lewat port SSH yang ada); tidak ada Docker di mesin Windows. Agar RAM VPS tidak bertambah, **tidak ada container ketiga**: dev/tes memakai container MariaDB lingkungan `dev` (staging) dengan skema terpisah (`qc_dev`, `qc_test_*`) dan **pengguna DB khusus yang hanya berhak atas skema itu** (tidak bisa menyentuh skema staging/produksi; tak ada tunnel ke database `exec`). Tiap proses tes membuat skema sementara `qc_test_<acak>` lalu menghapusnya. Port database di VPS tetap hanya `127.0.0.1` (tunnel lewat SSH). CI memakai service container `mariadb:11.8` (tanpa tunnel). `bun run check` GAGAL (bukan melewati) bila DB uji tak terjangkau, supaya "hijau" berarti penuh; pesan galat menyebut perintah tunnel. Tes murni (shared, FE) tetap tanpa DB. Batas koneksi dan waktu tes dijaga agar beban tes tidak mengganggu aplikasi lain di VPS.
7. **OAuth Google**: satu klien OAuth dengan dua URI redirect (staging dan produksi).
8. **PWA Fase 2** (antrean centang offline) di luar cakupan dokumen ini; REST dirancang agar kelak mungkin: `PUT /handovers/{id}/checks` idempoten dan memakai `ETag`/`If-Match`.

**Sudah dijawab pemilik (2026-11-05)**: email peringatan cadangan disetujui (keputusan 11); DB dev lewat tunnel ke VPS, bukan Docker lokal (keputusan 12, butir 6); fitur GAS terhenti, hanya QR generator berjalan (keputusan 13, butir 1). Nama subdomain `dev`/`exec` adalah nilai konfigurasi yang diisi pemilik saat deploy (tidak mengubah desain).

## 14. Data produksi dan cutover

- **Sumber data**: Google Sheets (aplikasi GAS lama); D1 produksi belum pernah dicutover dan dianggap kosong **[saya; verifikasi]**. Karena hanya QR generator yang berjalan di produksi (keputusan 13), data hidup terutama modul akses (users, roles, locations, audit) dan QR (`qr_designs`, `qr_documents`, `qr_defaults`, `qr_presets`); tabel handover/item/merk/customer kemungkinan kosong atau hanya data uji — **[verifikasi]** lewat dump sebelum gladi, dan putuskan di rencana apakah data uji itu dibuang. Jendela tulis-beku praktis hanya menyangkut QR dan akses.
- Skrip `scripts/migrate/import-sheets.ts` dan `verify-import.ts` diarahkan ulang ke MariaDB (keluaran SQL dialek MariaDB; verifikasi jumlah baris + checksum per tabel, rujukan yatim, penghitung `sync_rev` dan nomor `handover:YYYYMMDD`).
- Urutan: gladi di staging (impor dari dump Sheets nyata, uji fitur, uji cadangan→pemulihan) → deploy bendera `READ_ONLY=1` ke aplikasi GAS lama → dump Sheets via jembatan → impor ke MariaDB produksi → verifikasi → alihkan DNS/pengguna ke domain baru → pantau. **Jalan mundur**: aplikasi GAS lama tidak diubah selain bendera `READ_ONLY`; mencabutnya mengembalikan layanan lama, dengan syarat data tulis di sistem baru selama jendela dicatat.
- Runbook cutover Cloudflare (`docs/superpowers/runbooks/2026-10-cutover-cloudflare.md`) diganti runbook cutover ke VPS.

## 15. Penghapusan dan dokumentasi yang harus diselaraskan

- Hapus/arsipkan: `worker/wrangler.jsonc`, `.github/workflows/deploy-worker.yml`, perintah `dev:worker`/`load:cpu`, `docs/dev-worker.md`, `docs/observability.md` (versi Workers Logs), rencana dan runbook Cloudflare (ditandai **Dibatalkan**, bukan dihapus, agar riwayat keputusan tetap).
- Tandai `2026-10-25-migrasi-cloudflare-worker-d1-design.md` dan rencananya sebagai **Dibatalkan 2026-11-05 oleh pemilik; digantikan dokumen ini**.
- Perbarui `CLAUDE.md` (perintah, struktur, hapus "Aturan Worker", tambah aturan server/REST), `docs/ci-cd.md`, `docs/adding-a-module.md`, `docs/setup-bridge.md`, `docs/api/desktop-sync.md`, dan PRD terkait (PRD PWA: Fase 2 "ketahanan server" ditinjau ulang karena alasan kuota D1 hilang). Keputusan pemilik dicatat pada spek/PRD terkait dengan tanggal absolut dan alasan.
- Pembaruan memori proyek agen (status migrasi): dari "ditunda" menjadi "dibatalkan, digantikan".

## 16. Fase (garis besar untuk rencana)

1. **Fondasi**: `server/` (rename), Docker dev (compose + MariaDB lokal), skema MariaDB + migrasi, inti (konfigurasi, log, error problem+json, sesi, izin) dan satu modul kecil (merk) ujung ke ujung sebagai pola REST + OpenAPI.
2. **Modul REST** satu per satu (access, lokasi, customer, item, handover, files, QR, jobs/ekspor) bersama perombakan FE modul itu, tes MariaDB sungguhan.
3. **Sinkron Desktop** versi 2 dan dokumennya.
4. **Deploy & CI/CD**: image, compose, nginx, skrip deploy, `deploy-server.yml`, staging di VPS.
5. **Cadangan**: dump, unggah, trigger pembersih, pemulihan teruji.
6. **Migrasi data & cutover**: skrip impor MariaDB, gladi staging, runbook, produksi, pemensiunan `gas/` dan pembersihan sisa Cloudflare/GAS di FE.

Tiap fase berakhir dengan `bun run check` hijau; tinjauan akhir per putaran (kesesuaian spek + `security-audit` terfokus perubahan) sesuai pedoman kerja.

## 17. Risiko

- **Memori VPS (±2,4 GB tersisa)**: dua app + dua MariaDB + aplikasi lain. Mitigasi: batas memori container, buffer pool kecil, pantau; opsi satu MariaDB dua skema.
- **Driver MySQL di Bun**: kematangan/perbedaan perilaku. Mitigasi: spike pendek di Fase 1; cadangan Node + Hono.
- **Server dipakai bersama**: kesalahan konfigurasi nginx/firewall dapat mengganggu aplikasi lain. Mitigasi: `nginx -t`, tidak menyentuh blok lain, pengguna deploy terbatas.
- **Batas badan jembatan untuk dump besar**. Mitigasi: gzip + potongan/unggah bertahap.
- **Satu titik gagal (satu VPS)**. Mitigasi: cadangan harian ke Drive + pemulihan teruji; RPO ±24 jam diterima pemilik.
- **Tes lewat tunnel SSH**: latensi lebih tinggi dan beban tambahan pada VPS bersama; tunnel bisa terputus. Mitigasi: skema/pengguna DB terisolasi, batas koneksi, batas waktu tes, pesan galat yang menunjuk perintah tunnel; CI tidak bergantung tunnel.
- **Perombakan FE luas** (semua `queries.ts`). Mitigasi: per modul bersama backend-nya; tipe bersama; tes FE yang ada diadaptasi.

## 18. Catatan revisi saat penyusunan rencana (2026-11-05)

Pembacaan kode saat menyusun `docs/superpowers/plans/2026-11-05-migrasi-vps-docker-rest.md` mengubah lima butir **[saya]** di §6/§7 (rinci dan alasannya di bagian "Penyimpangan dari spek" rencana itu): adaptor `Db` berbentuk D1 sebagai pengganti Kysely; OpenAPI dari tabel rute `shared/api.ts` sebagai pengganti `@hono/zod-openapi` (validator server ditulis tangan); penjaga CAS yang digabung ke `UPDATE` dipertahankan; klien FE bertipe berbasis tabel rute; migrasi D1 0001–0009 dikonsolidasi menjadi satu baseline. Pemilik memilih melanjutkan ke eksekusi rencana setelah melihat daftar itu (2026-11-05); butir ini dianggap diterima dan dapat dibalik bila pemilik keberatan. Bila rencana dan §6/§7 bertentangan, §18 ini dan rencana yang berlaku.
