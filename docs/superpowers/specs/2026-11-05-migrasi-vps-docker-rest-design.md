# Backend di VPS (Docker, Bun + Hono + MariaDB) dengan API REST — rancangan

| | |
|---|---|
| **Tanggal** | 2026-11-05 |
| **Status** | Disetujui pemilik 2026-11-05 dan sedang dieksekusi (Fase 1–2 selesai). **Direvisi 2026-11-06**: Google diakses langsung dari server lewat service account, jembatan Apps Script dipensiunkan (§19 butir 6); mengubah §2 butir 7, 9, 11, §5, §10, §11, §13, §14, §15, §16, §17 |
| **Menggantikan** | `2026-10-25-migrasi-cloudflare-worker-d1-design.md` (dibatalkan pemilik 2026-11-05; lihat §2 dan §14) |
| **Cakupan** | Backend QC App, kontrak API FE↔BE dan QC Desktop, basis data, deploy, CI/CD, cadangan, cutover dari Google Sheets |
| **Dasar** | Kode saat ini (`worker/`, `bridge/`, `gas/`, `shared/`, `web/`), `docs/api/desktop-sync.md`, `docs/ci-cd.md`, pemeriksaan VPS lewat SSH (baca-saja, 2026-11-05), percakapan dengan pemilik (2026-11-05; keputusan Google langsung 2026-11-06) |

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
7. **Drive (berkas) dan Spreadsheet (impor awal, ekspor) diakses langsung dari server (Bun) lewat service account Google, bukan lewat Apps Script.** *Diganti 2026-11-06 (§19 butir 6; semula: Apps Script hanya untuk Drive/Sheets lewat jembatan `bridge/` yang dipertahankan).* Jembatan `bridge/` dan aplikasi GAS lama (`gas/`) dipensiunkan: kode server berhenti memakai jembatan di T30a, `bridge/` dan `gas/` dihapus di T35 **[pemilik, 2026-11-06; pemensiunan `gas/` setelah cutover dari 2026-11-05]**.
8. **DNS di Cloudflare, mode proxy, SSL Full (strict).** VPS dapat diakses lewat SSH (alias `rhd_vps_ipv4`) untuk deploy.
9. **Cadangan = dump SQL ke Google Drive**; **penghapusan dump lama dilakukan server** lewat Drive API (beberapa panggilan API per malam, tidak membebani VPS). *Diganti 2026-11-06 (§19 butir 6; semula: dilakukan trigger waktu di Apps Script agar VPS tidak terbebani). Pemindahan ini akibat langsung dari klien Google langsung (tanpa jembatan, tidak ada trigger Apps Script); konfirmasi pemilik atas pemindahan ini diminta (§17, §19 butir 6).*
10. **CI/CD otomatis ke staging dan production.** Nama environment GitHub saat ini: **`dev`** dan **`exec`**. Staging berjalan di VPS yang sama dengan production.
11. **Email peringatan cadangan disetujui**: server mengirim email ke pemilik lewat SMTP generik bila cadangan terbaru > ±36 jam. *Diganti 2026-11-06 (§19 butir 6; semula: trigger GAS di jembatan dengan izin `MailApp`).* Konsekuensi yang menunggu keputusan pemilik: peringatan ini tidak berbunyi bila VPS atau `qc-app` mati (§17).
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
                                          │ qc-app  (Bun + Hono)        │── service account ──► Google API (Drive v3, Sheets v4)
                                          │  API REST + berkas statis   │
                                          │  penjadwal internal         │
                                          │ qc-db   (MariaDB 11.8 LTS)  │   (volume bernama; tak diekspos ke host)
                                          └─────────────────────────────┘
```

- **`qc-app`** melayani API (`/api/v1/*`), alur login (`/auth/*`), dan hasil build web (SPA, fallback `index.html`) dalam satu origin (tanpa CORS). Mendengarkan hanya di `127.0.0.1:<port>`; nginx menambah satu blok `server {}` per subdomain **[saya]**.
- **`qc-db`**: MariaDB 11.8 LTS **[saya]**, `utf8mb4`, `innodb_buffer_pool_size` ≈ 128–256 MB, tanpa port ke host. Satu container database per lingkungan **[saya]** (dev/staging dan exec/production terpisah total; alternatif satu server dua skema lebih hemat ±300 MB tetapi kurang terisolasi — keputusan pemilik di §13).
- **Penjadwal internal** di `qc-app` (bukan Queue): pembersihan berkala (sesi/rate-limit/job lama, PDF QR), ekspor Sheets, dump cadangan, pembersihan cadangan lama, dan peringatan cadangan basi (§10). Pekerjaan berat (ekspor, dump) dieksekusi berurutan dengan kunci agar tidak menumpuk di 2 vCPU **[saya]**.
- **IP asli klien**: dibaca dari `CF-Connecting-IP`, **hanya dipercaya bila permintaan datang dari nginx host** (loopback); dipakai untuk pembatas percobaan salah (token sinkron, login) dan log.
- **Google langsung dari server** (diganti 2026-11-06, §19 butir 6; semula jembatan Apps Script dengan HMAC): `qc-app` memanggil Drive v3 dan Sheets v4 lewat `fetch` dengan token OAuth service account (§10). Antarmuka `BridgeClient` (`server/src/core/bridge-client.ts`) dipertahankan sebagai batas ke Google, sehingga modul `files`, `qrcode`, `jobs`, dan impor tidak berubah; implementasi `createGoogleClient(env)` menggantikan `createBridgeClient`.

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
- **Berkas**: unggah **`multipart/form-data` atau badan biner**, unduh **stream biner dengan `Content-Type` benar**, `Cache-Control` privat, dan dukungan `ETag`; **base64-di-JSON dihapus** (hemat 33% dan memori). Batas ukuran berkas/gambar: lihat §19 butir 5 (10 MB di tepi, dinaikkan di T30a bersama klien Google langsung; §19 butir 6); batas badan JSON REST 2 MB (§19 butir 4).
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

QC Desktop (di balik VPN, memakai MySQL sendiri) tetap klien eksternal terpisah. Kontrak baru **REST, versi API 2**, dengan token Bearer di header, paginasi kursor `sinceRev`/`nextRev`/`hasMore`, dan `baseRev` di badan push untuk deteksi konflik per item (TANPA `ETag`/`If-Match` pada item dan merk; hanya unduhan berkas yang ber-ETag; §19 butir 7). Aturan yang tetap: perubahan field sinkron item/merk WAJIB menaikkan `sync_rev` (`itemSyncSignature_`), status konflik per item (bukan galat tingkat atas). Batas halaman dengan detail 50 item DIGANTI 200 (pull) dan push 50/25 item (§19 butir 7). Dokumen `docs/api/desktop-sync.md` ditulis ulang sebagai bagian pekerjaan (sesuai aturan pencatatan keputusan pemilik).

## 10. Integrasi Google (klien langsung, service account) dan cadangan

*Ditulis ulang 2026-11-06 (§19 butir 6, disetujui pemilik); semula bagian ini memuat jembatan Apps Script dengan HMAC, unggah berpotongan, trigger pembersih, dan email `MailApp`.*

- **Klien Google langsung dari server [pemilik, 2026-11-06]**. `qc-app` memanggil Drive v3 dan Sheets v4 lewat `fetch` (tanpa SDK berat). Alasan: tanpa biaya tetap 1,5–2,5 dtk per eksekusi Apps Script, tanpa batas badan jembatan ±750 KB (unggah resumable Drive), dan pengembangan lokal dapat memakai Drive sungguhan. Antarmuka `BridgeClient` dipertahankan; `createGoogleClient(env)` (di `server/src/core/google/`) menggantikan `createBridgeClient`; modul `files`, `qrcode`, `jobs`, dan impor tidak berubah. Pemeriksaan yang dulu dilakukan jembatan (induk berkas harus folder yang diizinkan, `X-Goog-Drive-Resource-Keys` untuk berkas eksternal, 404 menjadi `null`/sukses) dipindahkan ke klien baru.
- **Autentikasi**: service account Google (kunci JSON). Server menandatangani JWT RS256 (klaim `iss`, `scope`, `aud`, `exp` ≤ 1 jam) dengan Web Crypto, menukarnya dengan token akses OAuth, menyimpannya di memori, dan memperbaruinya sebelum kedaluwarsa; 401 → perbarui token sekali lalu ulangi. Cakupan: `drive` dan `spreadsheets` (cakupan `drive.file` tidak cukup karena berkas lama dan folder induk dibuat pemilik, bukan oleh aplikasi). Service account berkuota Drive 15 GB **[pemilik; verifikasi dengan `scripts/google-sa-check` sebelum T30a: service account tanpa kuota tak dapat memiliki berkas di Drive pribadi]**. Kunci disimpan sebagai **berkas rahasia** (izin 600) di VPS dan dipasang baca-saja ke container; tidak di GitHub, tidak di image, tidak di log.
- **Satu folder induk milik pemilik**, dibagikan ke service account sebagai **Editor**, berisi **subfolder per fungsi**: gambar item, PDF sumber QR, ekspor QR, cadangan SQL. Folder lama dipindahkan ke bawah induk **tanpa mengubah id** (id berkas di basis data tetap valid). Penjaga dan pemisah fungsi dipertahankan sebagai konfigurasi di `.env` (`ALLOWED_FOLDER_IDS`, `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`, folder cadangan): klien menolak operasi pada berkas yang induknya di luar daftar **[pemilik: dipertahankan; saya: peralihan dari tabel `settings` (`DRIVE_FOLDER_ID`, `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`, yang kini diisi `ensureNamedFolder`) ke `.env` ditetapkan di T30a]**. Folder baru tidak pernah dibuat di luar induk: `createFolder` pada klien selalu mengisi `parents: [GOOGLE_ROOT_FOLDER_ID]`. Variabel baru: `GOOGLE_SA_KEY_FILE` (jalur berkas kunci) dan `GOOGLE_ROOT_FOLDER_ID`; `BRIDGE_URL`/`BRIDGE_SECRET` dihapus. Berkas baru yang dibuat service account **dimiliki service account**, sehingga kuota 15 GB dipakai bersama gambar, PDF, dan cadangan: retensi dan pemantauan pemakaian wajib (§17).
- **Unggah resumable**: berkas diunggah lewat sesi resumable Drive tanpa batas badan jembatan; batas berkas/gambar tinggal batas di server (10 MB, §19 butir 5). Panggilan idempoten (baca, daftar, hapus) dicoba ulang pada 429/5xx dengan jeda bertahap; pembuatan berkas tidak diulang otomatis tanpa pemeriksaan.
- **Spreadsheet**: satu spreadsheet data tunggal (job `exports.sheets` yang ada; juga sumber impor awal), dibagikan ke service account sebagai Editor. **Spreadsheet laporan per periode ditunda** dan di luar cakupan (fitur tersendiri nanti).
- **Login Google** tetap langsung dari backend (OAuth web), terpisah dari service account; URI redirect OAuth baru didaftarkan pemilik untuk domain VPS.
- **Cadangan [pemilik + saya]**:
  - Dump `mariadb-dump --single-transaction` dikompres gzip menjadi **satu berkas** `qc-backup-YYYYMMDD-HHmm.sql.gz`, **sekali per malam** (data yang rela hilang ≤ ±24 jam), dijalankan penjadwal di `qc-app` **[saya]**. Tanpa potongan dan tanpa manifest.
  - Diunggah resumable ke **folder cadangan** di bawah folder induk. **Integritas**: setelah unggah, `md5Checksum` dari Drive dibandingkan dengan hash MD5 lokal; SHA-256 disimpan di `appProperties` berkas. Hasil beda → unggah dianggap gagal (dicoba lagi pada jadwal berikutnya).
  - **Pembersihan dilakukan server** (diganti 2026-11-06; semula trigger Apps Script): daftar folder lewat Drive API, **berbasis jumlah** bukan umur, sisakan 7 harian + 4 mingguan menurut tanggal di nama berkas, **tidak pernah menghapus bila salinan tersisa < minimum**, agar unggahan yang berhenti tidak menghabiskan cadangan **[saya]**. Beban hanya beberapa panggilan API per malam. *Konfirmasi pemilik diminta: pemilik awalnya meminta pembersihan lewat trigger Apps Script demi VPS ringan; pemindahan ini akibat langsung dari keputusan Google langsung.*
  - **Peringatan email [pemilik, disetujui 2026-11-05; pengirim diganti 2026-11-06]**: server mengirim email ke pemilik bila cadangan terbaru > ±36 jam, diperiksa penjadwal tiap jam. Waktu peringatan terakhir disimpan di tabel `settings` agar tidak berulang: **maksimal sekali per 12 jam**. Pengiriman lewat **SMTP generik** (bukan `MailApp`): variabel `.env` `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_TO`; sekarang SMTP Google (sandi aplikasi), kelak dapat pindah ke email kantor tanpa kode khusus penyedia (pustaka `nodemailer`, kompatibel Bun **[verifikasi saat implementasi]**).
  - **Risiko baru: peringatan lewat server tidak berbunyi bila VPS atau `qc-app` mati** (dulu trigger Apps Script independen dari VPS). Mitigasi yang diusulkan, **belum diputuskan, menunggu keputusan pemilik**: (a) dead-man's switch eksternal, mis. healthchecks.io: job cadangan mem-ping setelah sukses dan layanan itu mengirim email bila ping hilang; atau (b) satu trigger Apps Script minimal khusus peringatan. Lihat §17.
  - Di VPS hanya 2–3 salinan terakhir disimpan (disk terbatas); bila unggah gagal, dump tetap ada dan dicoba lagi pada jadwal berikutnya.
  - **Prosedur pemulihan** (unduh `alt=media`, verifikasi checksum, gunzip, impor ke skema target) ditulis dan **diuji sekali** pada lingkungan staging sebelum cutover produksi.

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
- Kunci service account Google (§10) adalah berkas rahasia di VPS (izin 600, di luar repositori dan image, dipasang baca-saja ke container); GitHub tidak menyimpannya. Tidak ada lagi alur `clasp` untuk backend baru (jembatan Apps Script dipensiunkan, §19 butir 6).

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
5. **Staging memakai folder induk Drive staging terpisah dan kunci service account yang sama** (diganti 2026-11-06, §19 butir 6; semula proyek jembatan GAS terpisah). Folder induk staging dibagikan ke service account sebagai Editor; staging boleh berisi salinan data nyata untuk gladi dengan akses terbatas pada pemilik. Kunci yang sama dipilih demi kesederhanaan; keterpisahan datanya dijaga oleh folder induk dan penjaga folder (§10).
6. **Tes dan dev [pemilik: DB lewat tunnel; sisanya saya]**: tes konkurensi/SQL memakai MariaDB sungguhan. Lokal: MariaDB di Docker **pada VPS**, diakses lewat SSH tunnel (`bun run db:tunnel` membuka `127.0.0.1:<port lokal>` ke database VPS lewat port SSH yang ada); tidak ada Docker di mesin Windows. Agar RAM VPS tidak bertambah, **tidak ada container ketiga**: dev/tes memakai container MariaDB lingkungan `dev` (staging) dengan skema terpisah (`qc_dev`, `qc_test_*`) dan **pengguna DB khusus yang hanya berhak atas skema itu** (tidak bisa menyentuh skema staging/produksi; tak ada tunnel ke database `exec`). Tiap proses tes membuat skema sementara `qc_test_<acak>` lalu menghapusnya. Port database di VPS tetap hanya `127.0.0.1` (tunnel lewat SSH). CI memakai service container `mariadb:11.8` (tanpa tunnel). `bun run check` GAGAL (bukan melewati) bila DB uji tak terjangkau, supaya "hijau" berarti penuh; pesan galat menyebut perintah tunnel. Tes murni (shared, FE) tetap tanpa DB. Batas koneksi dan waktu tes dijaga agar beban tes tidak mengganggu aplikasi lain di VPS.
7. **OAuth Google**: satu klien OAuth dengan dua URI redirect (staging dan produksi).
8. **PWA Fase 2** (antrean centang offline) di luar cakupan dokumen ini; REST dirancang agar kelak mungkin: `PUT /handovers/{id}/checks` idempoten dan memakai `ETag`/`If-Match`.

**Sudah dijawab pemilik (2026-11-05)**: email peringatan cadangan disetujui (keputusan 11; pengirimnya diganti SMTP server pada 2026-11-06); DB dev lewat tunnel ke VPS, bukan Docker lokal (keputusan 12, butir 6); fitur GAS terhenti, hanya QR generator berjalan (keputusan 13, butir 1). Nama subdomain `dev`/`exec` adalah nilai konfigurasi yang diisi pemilik saat deploy (tidak mengubah desain).

## 14. Data produksi dan cutover

- **Sumber data**: Google Sheets (aplikasi GAS lama); D1 produksi belum pernah dicutover dan dianggap kosong **[saya; verifikasi]**. Karena hanya QR generator yang berjalan di produksi (keputusan 13), data hidup terutama modul akses (users, roles, locations, audit) dan QR (`qr_designs`, `qr_documents`, `qr_defaults`, `qr_presets`); tabel handover/item/merk/customer kemungkinan kosong atau hanya data uji — **[verifikasi]** lewat dump sebelum gladi, dan putuskan di rencana apakah data uji itu dibuang. Jendela tulis-beku praktis hanya menyangkut QR dan akses.
- Skrip `scripts/migrate/import-sheets.ts` dan `verify-import.ts` diarahkan ulang ke MariaDB (keluaran SQL dialek MariaDB; verifikasi jumlah baris + checksum per tabel, rujukan yatim, penghitung `sync_rev` dan nomor `handover:YYYYMMDD`).
- Urutan: gladi di staging (impor dari dump Sheets nyata, uji fitur, uji cadangan→pemulihan) → deploy bendera `READ_ONLY=1` ke aplikasi GAS lama → dump Sheets lewat klien Google (`sheetsDump`, service account) → impor ke MariaDB produksi → verifikasi → alihkan DNS/pengguna ke domain baru → pantau. **Jalan mundur**: aplikasi GAS lama tidak diubah selain bendera `READ_ONLY`; mencabutnya mengembalikan layanan lama, dengan syarat data tulis di sistem baru selama jendela dicatat.
- Runbook cutover Cloudflare (`docs/superpowers/runbooks/2026-10-cutover-cloudflare.md`) diganti runbook cutover ke VPS.

## 15. Penghapusan dan dokumentasi yang harus diselaraskan

- Hapus/arsipkan: `worker/wrangler.jsonc`, `.github/workflows/deploy-worker.yml`, perintah `dev:worker`/`load:cpu`, `docs/dev-worker.md`, `docs/observability.md` (versi Workers Logs), rencana dan runbook Cloudflare (ditandai **Dibatalkan**, bukan dihapus, agar riwayat keputusan tetap).
- Pensiun jembatan Google Apps Script (§19 butir 6): hapus `bridge/`, `docs/setup-bridge.md`, `bridge/deployment*.json`, perintah `build:bridge` (dan `scripts/bridge-smoke.ts`), serta entri `clasp` di `.mcp.json` bila hanya untuk GAS, bersama `gas/` di T35 (kode server berhenti memakai jembatan di T30a). `docs/setup-google.md` direvisi (service account, folder induk, env, rotasi kunci).
- Tandai `2026-10-25-migrasi-cloudflare-worker-d1-design.md` dan rencananya sebagai **Dibatalkan 2026-11-05 oleh pemilik; digantikan dokumen ini**.
- Perbarui `CLAUDE.md` (perintah, struktur, hapus "Aturan Worker", tambah aturan server/REST), `docs/ci-cd.md`, `docs/adding-a-module.md`, `docs/setup-google.md` (menggantikan `docs/setup-bridge.md`), `docs/api/desktop-sync.md`, dan PRD terkait (PRD PWA: Fase 2 "ketahanan server" ditinjau ulang karena alasan kuota D1 hilang). Keputusan pemilik dicatat pada spek/PRD terkait dengan tanggal absolut dan alasan.
- Pembaruan memori proyek agen (status migrasi): dari "ditunda" menjadi "dibatalkan, digantikan".

## 16. Fase (garis besar untuk rencana)

1. **Fondasi**: `server/` (rename), Docker dev (compose + MariaDB lokal), skema MariaDB + migrasi, inti (konfigurasi, log, error problem+json, sesi, izin) dan satu modul kecil (merk) ujung ke ujung sebagai pola REST + OpenAPI.
2. **Modul REST** satu per satu (access, lokasi, customer, item, handover, files, QR, jobs/ekspor) bersama perombakan FE modul itu, tes MariaDB sungguhan.
3. **Sinkron Desktop** versi 2 dan dokumennya.
4. **Deploy & CI/CD**: image, compose, nginx, skrip deploy, `deploy-server.yml`, staging di VPS.
5. **Google langsung dan cadangan**: klien Google (service account) menggantikan jembatan dan batas berkas 10 MB (T30a), dump satu berkas + unggah resumable (T30), pembersihan cadangan oleh server (retensi, T30), pemulihan teruji (T31), peringatan SMTP dan pemantauan kuota (T32).
6. **Migrasi data & cutover**: skrip impor MariaDB, gladi staging, runbook, produksi, pemensiunan `gas/` dan `bridge/` dan pembersihan sisa Cloudflare/GAS di FE.

Tiap fase berakhir dengan `bun run check` hijau; tinjauan akhir per putaran (kesesuaian spek + `security-audit` terfokus perubahan) sesuai pedoman kerja.

## 17. Risiko

- **Memori VPS (±2,4 GB tersisa)**: dua app + dua MariaDB + aplikasi lain. Mitigasi: batas memori container, buffer pool kecil, pantau; opsi satu MariaDB dua skema.
- **Driver MySQL di Bun**: kematangan/perbedaan perilaku. Mitigasi: spike pendek di Fase 1; cadangan Node + Hono.
- **Server dipakai bersama**: kesalahan konfigurasi nginx/firewall dapat mengganggu aplikasi lain. Mitigasi: `nginx -t`, tidak menyentuh blok lain, pengguna deploy terbatas.
- **Kunci service account bocor** (akses Editor ke folder induk dan spreadsheet). Mitigasi: berkas rahasia izin 600 di luar repositori/image/GitHub, dipasang baca-saja; tidak pernah masuk log atau pesan galat (diuji); akses hanya ke folder induk dan spreadsheet yang dibagikan (bukan seluruh Drive pemilik); prosedur rotasi kunci di `docs/setup-google.md`.
- **Kuota Drive 15 GB dipakai bersama** gambar, PDF sumber, ekspor QR, dan cadangan (berkas buatan service account dimiliki service account). Mitigasi: retensi cadangan (7 harian + 4 mingguan), pemantauan pemakaian (`about.get` storageQuota; peringatan email bila > ambang yang ditetapkan di T32), batas berkas 10 MB.
- **Peringatan cadangan tidak independen dari VPS** (dulu trigger Apps Script): bila VPS atau `qc-app` mati, email peringatan tidak terkirim dan cadangan yang berhenti tak diketahui. **Menunggu keputusan pemilik**: dead-man's switch eksternal (mis. healthchecks.io, job cadangan mem-ping sesudah sukses) atau satu trigger Apps Script minimal khusus peringatan; sampai diputuskan, T32 hanya mengirim peringatan lewat server.
- **Pembersihan cadangan oleh server, bukan trigger Apps Script**: berbeda dari permintaan awal pemilik (VPS ringan); beban hanya beberapa panggilan API per malam. Konfirmasi pemilik diminta (§19 butir 6).
- **Perilaku service account di Drive belum diverifikasi penuh** (kuota 15 GB, kemampuan Editor menghapus/memindahkan berkas lama milik pemilik, kompatibilitas `nodemailer` di Bun). Mitigasi: `scripts/google-sa-check` diperluas dan dijalankan sebelum T30a; verifikasi saat implementasi.
- **Satu titik gagal (satu VPS)**. Mitigasi: cadangan harian ke Drive + pemulihan teruji; RPO ±24 jam diterima pemilik.
- **Tes lewat tunnel SSH**: latensi lebih tinggi dan beban tambahan pada VPS bersama; tunnel bisa terputus. Mitigasi: skema/pengguna DB terisolasi, batas koneksi, batas waktu tes, pesan galat yang menunjuk perintah tunnel; CI tidak bergantung tunnel.
- **Perombakan FE luas** (semua `queries.ts`). Mitigasi: per modul bersama backend-nya; tipe bersama; tes FE yang ada diadaptasi.

## 18. Catatan revisi saat penyusunan rencana (2026-11-05)

Pembacaan kode saat menyusun `docs/superpowers/plans/2026-11-05-migrasi-vps-docker-rest.md` mengubah lima butir **[saya]** di §6/§7 (rinci dan alasannya di bagian "Penyimpangan dari spek" rencana itu): adaptor `Db` berbentuk D1 sebagai pengganti Kysely; OpenAPI dari tabel rute `shared/api.ts` sebagai pengganti `@hono/zod-openapi` (validator server ditulis tangan); penjaga CAS yang digabung ke `UPDATE` dipertahankan; klien FE bertipe berbasis tabel rute; migrasi D1 0001–0009 dikonsolidasi menjadi satu baseline. Pemilik memilih melanjutkan ke eksekusi rencana setelah melihat daftar itu (2026-11-05); butir ini dianggap diterima dan dapat dibalik bila pemilik keberatan. Bila rencana dan §6/§7 bertentangan, §18 ini dan rencana yang berlaku.

## 19. Keputusan pemilik setelah Fase 1 (2026-11-05 dan 2026-11-06)

Pemilik produk menyetujui tiga butir hasil review akhir Fase 1 (butir 1-3); butir 4-5 dari review akhir Fase 2 (2026-11-06); butir 6 (klien Google langsung) pada 2026-11-06; butir 7 (rincian kontrak sinkron Desktop versi 2, T25) pada 2026-11-06. Semuanya mengubah atau melengkapi butir spek di atas dan dikerjakan pada tugas yang disebut:
1. **I5 — IP klien di Docker (mengubah §5 dan Global Constraints rencana, "hanya dipercaya bila dari loopback")**: `TRUSTED_PROXY` menerima daftar CIDR; `CF-Connecting-IP` dipercaya hanya dari peer di dalam daftar itu (bawaan: loopback), dan subnet jaringan compose dipatok agar alamat gateway nginx→container dapat didaftarkan. Alasan: di dalam container peer nginx host adalah gateway bridge, bukan loopback. Dikerjakan di T26; kata §5 diubah di tugas itu.
2. **M2 — longgarkan batas peninggalan CPU edge (menggantikan keputusan pemilik 2026-10-30 di PRD handover)**: `saveBatch` maks. 30 task per permintaan (sama dengan Apps Script; formulir bulk satu permintaan atomik), halaman board bawaan 20 dan maks. 50. Alasan: batas 5/3 hanya anggaran CPU edge Cloudflare, yang tidak ada lagi di VPS. Dikerjakan di T19; PRD dan `CLAUDE.md` diubah di tugas itu. **Hasil implementasi (T19, 2026-11-05)**: `HANDOVER_WORKER_BATCH` (5) dibuang dan diganti `HANDOVER_BATCH_MAX = HANDOVER_LIMITS.batch` (30) di `shared/handover.ts`; `BOARD_DEFAULT_LIMIT` 20 dan `BOARD_MAX_LIMIT` 50 di `server/src/modules/handover/validate.ts`; formulir bulk mengirim SATU permintaan `POST /api/v1/handovers/batch` (pemecahan per 5 dan logika "kelompok tersimpan dibuang dari draf" dihapus); PRD handover (`2026-10-09-qc-item-serah-terima.md` baris kontrak RPC, `2026-10-18-qc-serah-terima-catatan-checklist.md` baris `handovers.board` dan AC14) dan `docs/e2e-checklist.md` 124b/124c diubah. Butir ketiga rencana (detail `sync.items.pull` 50) ditinjau di T25: lihat butir 7.
3. **Stabilitas tes lewat tunnel**: kurangi shard bawaan lebih dulu (T13b, 4 → 3, lalu 2 bila perlu); tes langsung di VPS (`test:remote`) hanya bila masih tak stabil.
4. **Batas badan JSON REST 2 MB (mengubah batas global 16 MB peninggalan masa base64)**: `MAX_JSON_BODY_BYTES` = 2 MB (2026-11-06, disetujui pemilik produk). Alasan: base64 sudah hilang dari kabel, muatan JSON sah terbesar (`handovers.saveBatch` 30 task x 5.000 karakter) < 1 MB, dan batas kecil memperkecil permukaan serangan memori; badan lebih besar = 413 problem+json (code VALIDATION). Batas global `Bun.serve` kini diturunkan dari tabel rute biner (maxBytes terbesar + overhead kecil) dan batas push sinkron (semula tetap 16 MB sampai T25; hasil T25: 5 MB sendiri, butir 7). Dikerjakan pada putaran perbaikan 1 Fase 2.
5. **Batas berkas/gambar 10 MB di tepi (Fase 5, T30a)**: opsi A disetujui pemilik produk 2026-11-06. Alasan: batas berkas lama (±750 KB, peninggalan batas badan jembatan Apps Script) terlalu kecil untuk berkas nyata dan dump cadangan. Batas tepi (gambar 1 MB → 10 MB, PDF sumber 10 MB tetap, ekspor 8 MB tetap) dinaikkan bersamaan dengan T30a, bukan sebelumnya; target pengecilan gambar di FE tidak ikut naik. Ini mengganti "Batas ukuran tetap seperti sekarang" dan "badan jembatan ≤ 1.048.576 karakter" sebagai batas BERKAS. **Direvisi 2026-11-06 oleh butir 6**: rancangan awal butir ini (unggah berpotongan di jembatan GAS, Task 30a lama) DIBATALKAN karena jembatan dipensiunkan; yang tetap hanya batas 10 MB, kini batas di server dengan unggah resumable langsung ke Drive.
6. **Klien Google langsung lewat service account; jembatan Apps Script dipensiunkan (Fase 5, T30a–T32; mengubah §2 butir 7, 9, 11, §5, §10, §11, §13 butir 5, §14, §15, §16, §17)**: disetujui pemilik produk 2026-11-06. Alasan: performa (tanpa biaya tetap 1,5–2,5 dtk per eksekusi Apps Script), tanpa batas badan jembatan ±750 KB, dan pengembangan lokal dapat memakai Drive sungguhan. Isi keputusan:
   - Server memakai klien Google langsung (JWT RS256 → token OAuth; Drive v3 dan Sheets v4 lewat `fetch`) dengan service account berkuota Drive 15 GB. Antarmuka `BridgeClient` dipertahankan; `createGoogleClient(env)` menggantikan `createBridgeClient`; modul `files`, `qrcode`, `jobs`, dan impor tidak berubah. `bridge/` dan `gas/` dipensiunkan di T35 (server berhenti memakainya di T30a). Login Google OAuth web tetap seperti semula.
   - Satu folder induk Drive milik pemilik dibagikan ke service account sebagai Editor, berisi subfolder per fungsi (gambar item, PDF sumber QR, ekspor QR, cadangan SQL); folder lama dipindahkan ke bawah induk tanpa mengubah id. Penjaga dan pemisah fungsi (`ALLOWED_FOLDER_IDS`, `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`, folder cadangan) tetap dikonfigurasi di `.env`. Berkas baru dimiliki service account (kuota 15 GB dipakai bersama; retensi dan pemantauan pemakaian wajib).
   - Email peringatan lewat SMTP generik (bukan `MailApp`): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_TO`; sekarang SMTP Google (sandi aplikasi), kelak bisa pindah ke email kantor tanpa kode khusus penyedia (`nodemailer`; kompatibilitas Bun diverifikasi saat implementasi).
   - Pembersihan cadangan oleh server (daftar folder lewat Drive API; 7 harian + 4 mingguan; tidak pernah menghapus bila salinan tersisa < minimum), bukan trigger Apps Script. **Mengganti §2 butir 9 dan §10 versi awal ("dilakukan trigger GAS agar VPS tidak terbebani")**; ini akibat langsung dari keputusan di atas dan konfirmasinya diminta pemilik (pemilik awalnya meminta trigger GAS demi VPS ringan).
   - Peringatan cadangan oleh server: email bila cadangan terbaru > 36 jam, diperiksa penjadwal jam-an; waktu peringatan terakhir di tabel `settings`, maksimal sekali per 12 jam.
   - Dump cadangan = satu berkas `qc-backup-YYYYMMDD-HHmm.sql.gz` diunggah resumable (tanpa potongan/manifest); integritas: `md5Checksum` Drive dibandingkan dengan hash lokal setelah unggah, SHA-256 disimpan di `appProperties`; pemulihan: unduh `alt=media`, verifikasi, gunzip, impor ke skema target.
   - Spreadsheet: hanya satu spreadsheet data tunggal (job `exports.sheets`), dibagikan ke service account sebagai Editor; spreadsheet laporan per periode DITUNDA (di luar lingkup).
   - **Pertanyaan terbuka kepada pemilik (belum diputuskan)**: (a) peringatan cadangan lewat server tidak berbunyi bila VPS atau `qc-app` mati; mitigasi yang diusulkan: dead-man's switch eksternal (mis. healthchecks.io, job cadangan mem-ping sesudah sukses) atau satu trigger Apps Script minimal khusus peringatan (§17, T32); (b) konfirmasi pemindahan pembersihan cadangan dari trigger Apps Script ke server.

7. **Kontrak sinkron QC Desktop versi 2 (REST) dan peninjauan batas peninggalan CPU edge (T25; mengubah §9 dan kalimat "batas detail 50 item per halaman"; menutup peninjauan butir 2)**: 2026-11-06. (a) **Batas dikembalikan ke nilai dokumen kontrak** — disetujui pemilik produk lewat keputusan M2 2026-11-05 (butir 2) yang menugaskan peninjauan ini: `sync.items.pull` dengan detail 200 per halaman (bukan 50; tanpa detail tetap 500), push item 50 per panggilan (25 bila ada entri berdetail; bukan 5; merk tetap 50), badan push 5 MB (`SYNC_LIMITS.bodyBytes`), berkas 8 MB. Alasan: 50/5 hanya anggaran CPU edge Cloudflare yang tidak ada lagi di VPS; tidak ada angka yang dikecilkan di bawah dokumen maupun dinaikkan tanpa alasan. `WORKER_PULL_MAX_WITH_DETAIL` dan `WORKER_ITEM_PUSH_MAX` dihapus. (b) **Batas badan sinkron 5 MB sendiri** (`SYNC_MAX_BODY_BYTES` = `SYNC_LIMITS.bodyBytes`; bukan 2 MB JSON karena 25 item berdetail 20.000 karakter dapat mendekati 2 MB dan bukan 16 MB lama); batas global `Bun.serve` kini hanya rute biner terbesar + overhead, tanpa ketergantungan pada sinkron. (c) **Rincian kontrak yang melengkapi §9 dan diputuskan pada arahan Fase 3 (koordinator; konfirmasi pemilik atas rincian ini diminta)**: pull berbasis query `sinceRev`/`limit`/`include` (bukan `?cursor=`) dan TANPA `ETag`/`If-Match` pada item dan merk (`baseRev` di badan push tetap satu-satunya prasyarat konflik; hanya `GET /sync/files/{id}` ber-ETag = id Drive); hasil push per item tetap di badan 200 (bukan 207); otentikasi hanya `Authorization: Bearer` tanpa cookie dan tanpa CSRF; semua kegagalan pra-otentikasi menjawab 401 problem+json yang sama ("Token tidak valid"); `POST /sync` dihapus (404); `UNAVAILABLE` kini 503 (bukan dipetakan INTERNAL); berkas sebagai byte mentah (tanpa base64). Alasan umum: kontrak belum dipakai klien mana pun. Dikerjakan di T25; `docs/api/desktop-sync.md`, PRD item/serah terima (FS1-FS12, §6.3b, daftar periksa Fase B2), `CLAUDE.md`, dan `docs/observability.md` diubah di tugas itu.

Rincian kabel REST (tabel id→jalur, status galat, ETag/`If-Match`, urutan penghapusan RPC) ada di rencana, bagian Fase 2.
