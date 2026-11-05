# Backend di VPS (Docker, Bun + Hono + MariaDB) dengan API REST — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memindahkan backend QC App dari rencana Cloudflare Worker+D1 ke Bun + Hono + MariaDB dalam Docker di VPS pemilik, dengan API REST, rilis otomatis (GitHub Actions), cadangan ke Drive, dan cutover data dari Google Sheets.

**Architecture:** Dua tahap yang tiap tahapnya tetap berjalan. **Fase 1** menukar runtime dan basis data di bawah RPC yang ada (frontend tidak berubah) lewat adaptor `Db` tipis berbentuk D1 di atas MariaDB. **Fase 2** mengganti kabel RPC menjadi REST lewat satu tabel rute bersama (`shared/api.ts`) yang dipakai klien FE, server, dan OpenAPI. Fase 3–6: sinkron Desktop v2, Docker/CI, cadangan, cutover.

**Tech Stack:** Bun, Hono, `mysql2` (bila gagal di Bun: Node + Hono, lihat T3), MariaDB 11.8 LTS, Docker Compose, nginx host, GitHub Actions + GHCR, klien Google langsung (service account; Drive v3 + Sheets v4 lewat `fetch`, mulai T30a; jembatan Apps Script dipakai kode Fase 1–4 sampai diganti lalu dipensiunkan di T35), SMTP generik (`nodemailer`) untuk email peringatan, React/Vite/TanStack (tetap).

**Spec:** `docs/superpowers/specs/2026-11-05-migrasi-vps-docker-rest-design.md` (disetujui pemilik 2026-11-05). Dokumen pendukung: `docs/api/desktop-sync.md`, `docs/setup-google.md` (direvisi di T30a; `docs/setup-bridge.md` dipensiunkan di T35), `docs/ci-cd.md`, `CLAUDE.md`. Revisi 2026-11-06 (Google langsung): spek §10 dan §19 butir 6.

## Penyimpangan dari spek (perlu konfirmasi pemilik)

Hasil pembacaan kode saat menyusun rencana; spek §6/§7 menandainya **[saya]**:
1. **Adaptor `Db` berbentuk D1 (`prepare().bind().first()/all()/run()`, `batch()` = transaksi), bukan Kysely.** Alasan: ±10.500 baris repo dan ±9.300 baris tes memakai bentuk itu dan hanya ±50 baris memakai SQL khusus SQLite; Kysely berarti menulis ulang semuanya.
2. **OpenAPI dari tabel rute `shared/api.ts`, bukan `@hono/zod-openapi`.** Alasan: validator server ditulis tangan (`core/validate.ts`), bukan zod. Skema JSON permintaan/respons tidak dihasilkan pada iterasi ini (jalur, verba, izin, status, nama DTO saja).
3. **Penjaga CAS yang digabung ke `UPDATE` dipertahankan** (ekspresi gagal dan pendeteksi galatnya diganti untuk MariaDB, galat 1690), bukan `SELECT … FOR UPDATE`. Perilaku sama, sudah teruji, satu pernyataan lebih sedikit.
4. **Klien FE bertipe berbasis tabel rute** (`api(id, input)` membangun URL REST dari tabel) agar ±11 berkas `queries.ts` hampir tidak berubah; yang berubah adalah bentuk kabel (REST nyata).
5. **Migrasi skema D1 0001–0009 dikonsolidasi menjadi satu `0001_baseline.sql`** (belum ada database produksi yang harus dijaga).
6. **Klien Google langsung lewat service account menggantikan jembatan Apps Script (keputusan pemilik 2026-11-06, spek §19 butir 6)**. Alasan: performa (tanpa biaya tetap 1,5–2,5 dtk per eksekusi Apps Script), tanpa batas badan jembatan ±750 KB, dev lokal dapat memakai Drive sungguhan. Akibat pada rencana: `BridgeClient` tetap sebagai antarmuka, `createGoogleClient(env)` menggantikan `createBridgeClient` (T30a); Task 30a lama (unggah berpotongan di jembatan) DIBATALKAN dan diganti "Klien Google langsung + batas berkas 10 MB"; cadangan satu berkas resumable (T30), pemulihan lewat Drive langsung (T31), email peringatan lewat SMTP dan pembersihan oleh server (T32; **mengganti** permintaan awal pemilik "pembersihan oleh trigger GAS demi VPS ringan", konfirmasi diminta), `bridge/` dan `docs/setup-bridge.md` dipensiunkan di T35. **Pertanyaan terbuka kepada pemilik**: peringatan cadangan lewat server tidak berbunyi bila VPS mati; mitigasi yang diusulkan (belum diputuskan): dead-man's switch eksternal atau satu trigger Apps Script minimal (T32). Tugas Fase 1–3 yang selesai tidak diubah; tempat yang menyebut jembatan hanya diberi catatan "digantikan di T30a".

## Global Constraints

- Backend: **Bun + Hono**; DB **MariaDB 11.8 LTS**, `utf8mb4`, `innodb_buffer_pool_size` 128 MB, `max_connections` 40, batas memori container 384 MB; tanpa port database ke host kecuali `127.0.0.1`.
- **Port 8787 tidak boleh dipakai** (terpakai di VPS). Tunnel dev: lokal dan remote `33063`.
- VPS dipakai bersama: **jangan menyentuh** container, blok nginx, atau firewall aplikasi lain; semua berkas QC di `/opt/qc/<dev|exec>/`; periksa `docker ps`/`ss -tlnp` sebelum membuat apa pun.
- Environment GitHub: **`dev`** (staging) dan **`exec`** (production). Rahasia aplikasi hanya di `.env` VPS (izin 600) dan berkas kunci service account Google (berkas rahasia izin 600 di VPS, dipasang baca-saja ke container; tidak di image dan tidak di GitHub), di GitHub hanya kunci SSH deploy.
- REST: dasar `/api/v1`, `application/problem+json` (RFC 9457) dengan ekstensi `code`, `requestId`, `fields`; `ETag`/`If-Match`; kursor `?cursor=&limit=`; cookie sesi `HttpOnly; Secure; SameSite=Lax` + header `X-Requested-With: qc` pada metode non-aman; sinkron Desktop `Authorization: Bearer`, API versi 2, 10 token salah/10 menit memblokir 10 menit.
- Cadangan: nama `qc-backup-YYYYMMDD-HHmm.sql.gz`, sekali per malam, retensi **7 harian + 4 mingguan**, **tidak pernah** menghapus bila salinan tersisa < minimum, email ke pemilik bila terbaru > **36 jam**. Sejak 2026-11-06 (spek §19 butir 6): dump = SATU berkas diunggah resumable langsung ke Drive lewat service account (tanpa jembatan, potongan, dan manifest); pembersihan dan peringatan dilakukan **server** (penjadwal jam-an; email lewat SMTP generik, bukan `MailApp`; waktu peringatan terakhir di `settings`, maks. sekali per 12 jam); env baru `GOOGLE_SA_KEY_FILE`, `GOOGLE_ROOT_FOLDER_ID`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_TO` (`BRIDGE_URL`/`BRIDGE_SECRET` dihapus di T30a); penjaga folder `ALLOWED_FOLDER_IDS`/`QR_FOLDER_ID`/`QR_DOC_FOLDER_ID`/folder cadangan tetap di `.env`. Batas badan JSON REST 2 MB (spek §19 butir 4, 2026-11-06); batas berkas/gambar 10 MB di tepi dinaikkan bersama T30a (spek §19 butir 5).
- IP klien dari `CF-Connecting-IP` **hanya** bila koneksi datang dari loopback (nginx).
- Aturan kode yang ada tetap: komentar Indonesia, Biome, `bun run check` hijau sebelum commit, `gas/dist` tak pernah diedit, logika murni di `shared/` tanpa API runtime.
- Commit: pesan gaya repo (`feat(server): …`), akhiri dengan baris `Co-Authored-By` yang berlaku; jangan commit rahasia (`.env*`, kunci).

## Review Focus

Masukan yang tersirat spek tetapi tak terlihat di tes biasa (tiap baris punya tes di tugas pemiliknya):
1. **Dua penulis menyimpan task yang sama / nomor `ST-YYYYMMDD-NNN` paralel**: satu menang, satu `409`/`412`, nomor tidak pernah ganda (T9, T19).
2. **Kunci unik dengan huruf besar-kecil, aksen, spasi ekor** (`Sony` vs `sony `): keunikan merk/customer di tingkat layanan tetap menolak keduanya lewat `normalizeKey`, dan collation DB tidak memperlakukan `a = a␠`/`e = é` secara diam-diam seperti collation `_ci`/PAD SPACE bawaan MariaDB (T4, T6).
3. **Emoji/Unicode 4-byte** di catatan, komentar, nama merk tersimpan dan terbaca utuh (T4, T9).
4. **Header `CF-Connecting-IP` palsu** dari koneksi non-loopback diabaikan sehingga pembatas token tak bisa dikelabui (T13).
5. **Dump rusak atau terpotong (unggah/unduh tak utuh)**: unggah dianggap gagal bila `md5Checksum` Drive ≠ hash lokal; pemulihan menolak bila checksum atau gunzip gagal, tidak mengimpor setengah data (T30, T31; direvisi 2026-11-06, dulu "potongan hilang/tertukar").
6. **Tunnel DB mati saat `bun run check`**: gagal cepat dengan pesan yang menyebut `bun run db:tunnel`, bukan menggantung (T3, T5).
7. **Galat REST**: badan bukan JSON/terlalu besar → 400/413 `problem+json`; `id` badan ≠ `id` jalur → 422; metode tulis tanpa `X-Requested-With: qc` → 403; rute `/api/v1/*` tak dikenal → 404 `problem+json`, bukan HTML SPA (T14).
8. **`If-Match` basi → 412, duplikat nama → 409**, dan galat 412/409 tak membocorkan isi baris orang lain (T14, T18, T19).
9. **Rute statis vs berparameter** (`/handovers/options`, `/handovers/batch` tidak tertelan `/handovers/{id}`) dan `{kind}` di luar `pdf|png` ditolak (T14, T21).
10. **Unggahan biner**: melebihi batas diputus tanpa memuat seluruh badan ke memori; byte masuk = byte keluar; izin diperiksa sebelum cache berkas (T21).

## Pembagian beban eksekusi (pedoman kerja pemilik)

Haiku: rename/mekanis, dokumen, berkas konfigurasi. Sonnet: adaptor, port modul, REST, tes, deploy. Satu putaran = implementasi semua tugas → **satu** review menyeluruh independen (kesesuaian spek + `security-audit` terfokus diff, bukan seluruh codebase) → putaran perbaikan. Temuan di luar spek menunggu konfirmasi pemilik dan dicatat di spek/PRD terkait.

## Urutan eksekusi Fase 1 (putusan controller, 2026-11-05, hasil pindai pra-eksekusi)

Penomoran tugas tidak berubah; urutan jalannya: **T2 → T1 → T3 → T4 → T5 → T6 → (T8, T10, T11 sebagai satu blok) → T7 → T9 → T12 → T13.**
- **T2 mendahului T1**: T1 membuat berkas di `server/` yang baru ada setelah rename.
- **Blok `files` + `qrcode` + `jobs` (T8, T10, T11)** saling mengimpor (siklus), jadi dikerjakan berurutan oleh agen yang sama dan direktori tes ketiganya baru masuk `ported-modules.ts` setelah ketiganya selesai.
- **`item` (T7) setelah blok itu** karena `item` mengimpor `files`; **`sync/state.ts` dipindah ke T6** karena `brand` memakainya (T12 tidak mengulanginya).
- T2 juga memperbarui SEMUA rujukan jalur `worker/` di luar folder itu dan menghapus `.github/workflows/deploy-worker.yml` (migrasi Cloudflare dibatalkan; workflow itu tak ada di `origin/main` sehingga tak pernah aktif).
- `cached/touchCache/settleCache` dibuang dari modul yang dipindah di tugasnya masing-masing; T13 membuang sisanya (router, `warm`) lalu modul `mem-cache`.

## Peta berkas (akhir Fase 1–2)

- `server/` (ganti nama dari `worker/`): `src/core/{db,migrate,cas,errors,validate,session,log,audit,settings,context,router,bridge-client,mail}.ts` dan `src/core/google/{auth,drive,sheets,client}.ts` (`bridge-http.ts` Fase 1 diganti `core/google/*` di T30a; `mail.ts` di T32), `src/modules/<modul>/…` (struktur tetap), `src/http/{security,rest,openapi,proxy}.ts`, `src/main.ts` (Bun.serve), `src/jobs/runner.ts`, `migrations/0001_baseline.sql`, `test-support/` (harness MariaDB), `scripts/`.
- `shared/api.ts` (tabel rute REST + fungsi murni pemetaan), `shared/rpc.ts` (DTO dipertahankan; amplop RPC dihapus di akhir Fase 2).
- `web/src/lib/api/` (menggantikan `lib/rpc/`).
- `deploy/` (`compose.yml`, `.env.example`, `nginx/qc.conf.example`, `deploy.sh`, `Dockerfile` di akar), `.github/workflows/deploy-server.yml`.
- `server/src/modules/backup/` (dump, unggah, pembersihan, peringatan), `scripts/restore-backup.ts`, `docs/setup-google.md`. (`bridge/src/backup.ts` dan aksi `drive.listFolder` di jembatan DIBATALKAN 2026-11-06; `bridge/` dihapus di T35.)

---

# FASE 1 — Runtime dan basis data diganti, RPC tetap (FE tidak berubah)

Gerbang Fase 1: `bun run check` hijau (termasuk tes MariaDB lewat tunnel), `bun run dev` melayani FE yang ada terhadap MariaDB tanpa perubahan FE, tanpa referensi Cloudflare di `server/`.

### Task 1: MariaDB dev di VPS dan tunnel SSH

**Files:**
- Create: `deploy/compose.yml` (layanan `qc-db` saja; `qc-app` ditambah di T26), `deploy/.env.example`, `deploy/mariadb/qc.cnf`, `scripts/db-tunnel.ts`, `server/.env.test.example`
- Modify: root `package.json` (skrip `db:tunnel`), `.gitignore` (`server/.env.test`, `deploy/.env`)

**Interfaces:**
- Produces: DB dev di VPS (`/opt/qc/dev`, kontainer `qc-dev-db`, `127.0.0.1:33063`), pengguna `qc_dev` (ALL pada skema `qc_dev`) dan `qc_test` (ALL pada skema pola `` `qc\_test\_%` `` + CREATE); `bun run db:tunnel` membuka `127.0.0.1:33063` lokal → VPS; `QC_TEST_DB_URL` di `server/.env.test`.

- [ ] **Step 1:** Baca-saja di VPS (`ssh rhd_vps_ipv4`): `docker ps`, `ss -tlnp`, `df -h /`, `free -h`; pastikan 33063 bebas dan `/opt/qc` belum ada. Hentikan dan laporkan bila port terpakai.
- [ ] **Step 2:** Tulis `deploy/compose.yml` (proyek `qc-${QC_ENV}`, layanan `qc-db`: `mariadb:11.8`, `mem_limit: 384m`, `127.0.0.1:${DB_PORT}:3306`, volume bernama, `deploy/mariadb/qc.cnf` dengan `character-set-server=utf8mb4`, `collation-server=utf8mb4_nopad_bin`, `innodb_buffer_pool_size=128M`, `max_connections=40`, `sql_mode=STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`), `.env.example` (`QC_ENV`, `DB_PORT`, `MARIADB_ROOT_PASSWORD`, `QC_DB_PASSWORD`, `QC_TEST_DB_PASSWORD`).
- [ ] **Step 3:** Salin ke `/opt/qc/dev/` lewat `scp`, buat `.env` (`chmod 600`, kata sandi acak `openssl rand -hex 24`), `docker compose up -d`, tunggu sehat. Buat pengguna `qc_dev`/`qc_test` dengan hak di atas lewat `docker exec … mariadb`.
- [ ] **Step 4:** Tulis `scripts/db-tunnel.ts` (menjalankan `ssh -N -L 33063:127.0.0.1:33063 rhd_vps_ipv4` dengan `ServerAliveInterval`, keluar bila SSH gagal) dan skrip `db:tunnel`; isi `server/.env.test` lokal dari `.env.test.example`.
- [ ] **Step 5:** Verifikasi: jalankan tunnel, lalu `mysql`-klien atau skrip `bun -e` kecil `SELECT VERSION(), @@character_set_server, @@collation_server` memakai `QC_TEST_DB_URL` → MariaDB 11.8, `utf8mb4`, `utf8mb4_nopad_bin`. Pastikan `ss -tlnp` di VPS menunjukkan 33063 hanya `127.0.0.1`.
- [ ] **Step 6:** Commit `chore(deploy): compose MariaDB dev dan tunnel SSH`.

### Task 2: Ganti nama `worker/` → `server/`, tandai spek Cloudflare dibatalkan

**Files:**
- Rename: `worker/` → `server/` (`git mv`), alias `@worker/*` → `@server/*`, `@worker-test/*` → `@server-test/*`
- Modify: `server/package.json` (nama `@qc/server`), `server/tsconfig.json`, root `package.json` (workspaces, `typecheck`, `test`), `biome.json`, `tsconfig.json`, impor di seluruh `server/`, `web/`, `scripts/`, `.github/workflows/test.yml`, rujukan jalur di root `package.json` (`dev:worker`, `db:seed`, `load:cpu` → `server/scripts/…`), `tsconfig.json` (`paths`, `include`), `web/vite.config.ts` (`outDir: '../server/dist'`), `scripts/{paths,verify-dist,bridge-smoke}.ts` dan `scripts/verify-dist.test.ts` (pesan/impor)
- Delete: `.github/workflows/deploy-worker.yml`
- Modify (status): `docs/superpowers/specs/2026-10-25-migrasi-cloudflare-worker-d1-design.md`, `docs/superpowers/plans/2026-10-25-migrasi-cloudflare-worker-d1.md` (baris Status: **Dibatalkan 2026-11-05 oleh pemilik; digantikan** spek dan rencana ini, dengan alasan singkat: gerbang CPU edge tak lulus di paket gratis, pemilik memiliki VPS)

**Interfaces:**
- Produces: semua tugas berikutnya memakai jalur `server/` dan alias `@server/*`.

- [ ] **Step 1:** `git mv worker server`; ganti `@worker` → `@server` dan `@worker-test` → `@server-test` secara mekanis (impor, `tsconfig` paths, `biome.json`, skrip root). Perintah root `dev:worker`, `load:cpu` dipertahankan namanya sementara tetapi jalurnya menunjuk `server/scripts/…` (dihapus di T13). `server/nul` (berkas liar Windows, tak terlacak git): jangan dipindah atau dihapus; bila menghalangi `git mv`, pindahkan isi terlacak per berkas/subfolder dan laporkan.
- [ ] **Step 2:** Tandai status kedua dokumen Cloudflare (lihat Files).
- [ ] **Step 3:** Run: `bun run typecheck && bun run lint && bun run test`. Expected: hijau seperti sebelum rename (tes server masih berjalan di SQLite-D1 sampai T5).
- [ ] **Step 4:** Commit `refactor: ganti nama worker menjadi server; tandai rencana Cloudflare dibatalkan`.

### Task 3: Adaptor `Db` di atas MariaDB (+ spike driver di Bun)

**Files:**
- Create: `server/src/core/db.ts`, `server/src/core/db.test.ts`, `server/test-support/db-env.ts`
- Modify: `server/package.json` (`mysql2`)

**Interfaces:**
- Produces:
  - `interface DbResult<T = unknown> { results: T[]; meta: { changes: number; lastRowId: number } }`
  - `interface DbStatement { bind(...values: unknown[]): DbStatement; first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<DbResult<T>>; run(): Promise<DbResult> }`
  - `interface Db { prepare(sql: string): DbStatement; batch(statements: DbStatement[]): Promise<DbResult[]>; exec(sql: string): Promise<void>; close(): Promise<void> }`
  - `function createDb(config: { url: string; connectionLimit?: number }): Db` (kolam utama `multipleStatements: false`; `exec(sql)` memakai koneksi khusus `multipleStatements: true` HANYA untuk SQL tepercaya milik migrator dan harness tes)
  - `class DbError extends Error { errno: number; kind: 'duplicate' | 'out_of_range' | 'deadlock' | 'unavailable' | 'other'; key?: string }` (1062 → `duplicate` dengan `key` nama indeks; 1690 → `out_of_range`; 1213/1205 → `deadlock`; ECONNREFUSED/ETIMEDOUT → `unavailable` dengan pesan menyebut `bun run db:tunnel`)
  - `function testDbUrl(): string` (membaca `QC_TEST_DB_URL`; melempar galat yang menyebut `bun run db:tunnel` bila kosong)
- Consumes: `QC_TEST_DB_URL` (T1).

- [ ] **Step 1:** Tulis tes (butuh tunnel): `prepare().bind().first()` mengembalikan baris/`null`; `run()` mengisi `meta.changes` dan `meta.lastRowId`; `batch([...])` atomik (pernyataan kedua gagal → pernyataan pertama tak tertulis); `batch` mengulang sekali pada deadlock; JSON dan `utf8mb4` (emoji `😀`) bolak-balik utuh; spasi ekor `'a '` dan `'a'` dua nilai berbeda pada kolom `utf8mb4_nopad_bin`; `INSERT` duplikat → `DbError{kind:'duplicate', key}`; `(-9223372036854775807 - 2)` di `UPDATE` → `DbError{kind:'out_of_range'}` dan membatalkan `batch`; tunnel mati (port salah) → galat `unavailable` dalam < 5 dtk dengan pesan menyebut `db:tunnel`.
- [ ] **Step 2:** Run `bun test server/src/core/db.test.ts`. Expected: FAIL (modul belum ada).
- [ ] **Step 3:** Implementasi `createDb` dengan `mysql2/promise` pool (`?` sebagai placeholder, `dateStrings: true`, `supportBigNumbers`, `multipleStatements: false`; `batch` = `BEGIN … COMMIT` pada satu koneksi, `ROLLBACK` + lempar `DbError` bila gagal). **Spike**: bila `mysql2` tak stabil di Bun (pool/transaksi/JSON), putuskan di sini: coba `Bun.sql` (MySQL); bila keduanya gagal, hentikan dan laporkan ke pemilik (opsi cadangan spek: Node + Hono) — jangan lanjut T4.
- [ ] **Step 4:** Run tes lagi. Expected: PASS; catat latensi rata-rata satu query lewat tunnel di komentar tes (dasar anggaran T5).
- [ ] **Step 5:** Commit `feat(server): adaptor Db di atas MariaDB`.

### Task 4: Skema baseline MariaDB dan migrator

**Files:**
- Create: `server/migrations/0001_baseline.sql`, `server/src/core/migrate.test.ts`
- Modify: `server/src/core/migrate.ts`
- Delete: `server/migrations/0001_init.sql` … `0009_item_alias_index_brand_count.sql` (setelah terjemahan; sejarah ada di git)

**Interfaces:**
- Produces: `applyMigrations(db: Db, migrations?: Migration[]): Promise<string[]>` (nama migrasi yang baru diterapkan; pelacak tabel `schema_migrations(name PRIMARY KEY, applied_at)`); `MIGRATIONS: Migration[]` dibaca dari berkas `*.sql` bernomor di `server/migrations/` (urut nama); `splitStatements` dipertahankan.
- Consumes: `Db` (T3).

- [ ] **Step 1:** Tulis tes: skema baseline terapan pada skema kosong menghasilkan 20 tabel (`users roles locations audit_log brands customers files handovers items qr_designs qr_documents qr_defaults qr_presets sync_state handover_comments jobs counters rate_limits settings job_blobs item_alias_keys`) ditambah `schema_migrations`; terapan dua kali = tak ada perubahan; kolom kunci unik (`brands.key`, `customers.key`, `items.key`, `item_alias_keys.key`, `handovers.number`, `users.email`) membandingkan **byte persis** seperti SQLite `BINARY` (collation `utf8mb4_nopad_bin`): nilai identik byte-per-byte ditolak, sedangkan `'sony'`, `'sony '`, `'Sony'`, dan `'soné'` dapat hidup berdampingan di tingkat DB (normalisasi tetap tugas `normalizeKey` di aplikasi; tidak ada kesetaraan diam-diam `a = a␠` atau `e = é`); teks `😀` di `handover_comments.quote`/`handovers.note` utuh.
- [ ] **Step 2:** Run tes. Expected: FAIL.
- [ ] **Step 3:** Terjemahkan 0001–0009 menjadi satu baseline: tipe eksplisit (`VARCHAR(n)` untuk kunci/id/email/status, `LONGTEXT` untuk Markdown/JSON, `BIGINT` untuk penghitung/revisi, waktu tetap `VARCHAR(30)` ISO 8601 agar tak mengubah perilaku perbandingan), `PRIMARY KEY` dan indeks sama dengan SQLite (tiap indeks diterjemahkan, termasuk `item_alias_keys` PRIMARY KEY dan `brands.item_count`), `ENGINE=InnoDB`, `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin`; `audit_log.id` dan `handover_comments.id` `BIGINT AUTO_INCREMENT` (pengganti `rowid` untuk urutan). Tulis ulang `migrate.ts` memakai `Db` dan membaca berkas dari disk (`Bun.file`).
- [ ] **Step 4:** Run tes. Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): skema baseline MariaDB dan migrator`.

### Task 5: Harness tes MariaDB, `Env.DB` menjadi `Db`, port inti + `access` + `auth`

**Files:**
- Modify: `server/test-support/test-env.ts`, `server/test-support/{access-fixtures,item-fixtures,handover-env,qrcode-env}.ts`, `server/src/core/{env,cas,audit,settings,context,errors,router,session}.ts`, `server/src/modules/access/*.ts`, `server/src/modules/auth/*.ts` (+ tes masing-masing), `server/package.json` (`test` memakai `--preload test-support/global-setup.ts`)
- Create: `server/test-support/global-setup.ts`
- Create: `server/test-support/ported-modules.ts` (daftar direktori tes yang sudah dipindah ke MariaDB), `server/scripts/test.ts` (menjalankan `bun test --preload test-support/global-setup.ts` hanya pada daftar itu); `server/package.json` skrip `test` → `bun run scripts/test.ts`

**Interfaces:**
- Produces: `Env.DB: Db`; `createTestEnv(overrides?): Promise<TestEnv>` (skema per berkas tes `qc_test_<hex>` dikloning dari `qc_test_template` — dibuat/diperbarui `global-setup` bila hash migrasi berubah — dan dikosongkan per tes lewat satu `exec` multi-pernyataan `TRUNCATE`; seed admin seperti sekarang); `dropTestSchemas()` di `afterAll`; `CAS_FAIL_SQL = '(-9223372036854775807 - 2)'`, `isGuardFailure(error)` memeriksa `DbError.kind === 'out_of_range'`; `batchWrite(db, statements, conflicts)` memetakan `DbError{kind:'duplicate', key}` ke `CONFLICT` memakai peta nama indeks (bukan teks pesan SQLite).
- Consumes: `Db`, `DbError`, `testDbUrl` (T3); skema (T4).

- [ ] **Step 1 (strategi):** Perubahan tipe `Env.DB` bersifat satu-sekali untuk seluruh `server/`; karena itu T5 mengganti tipe (`D1Database`→`Db`, `D1PreparedStatement`→`DbStatement`, `D1Result`→`DbResult`) secara mekanis di SEMUA modul (tanpa mengubah SQL modul selain inti/access/auth), sehingga typecheck hijau. Tes hanya dijalankan pada direktori yang tercantum di `ported-modules.ts` (awal: `src/core`, `src/modules/access`, `src/modules/auth`, `test-support`, `src/http`); di T6–T12, frasa "aktifkan tes <modul>" berarti menambahkan direktori tes modul itu ke daftar tersebut (tes berjalan dan gagal pada SQL lama sampai modulnya dipindah). Daftar dan `scripts/test.ts` dihapus di T13 (skrip `test` kembali `bun test` biasa).
- [ ] **Step 2:** Tulis tes harness: dua `createTestEnv()` berurutan terisolasi (data tes pertama tak terlihat); waktu per tes (`createTestEnv`) tercatat dan ≤ 400 ms rata-rata lewat tunnel (bila lebih, catat angkanya dan putuskan dengan pemilik; target tidak boleh diabaikan diam-diam); skema sementara dihapus di akhir; `bun run check` tanpa tunnel gagal < 5 dtk dengan pesan menyebut `bun run db:tunnel`.
- [ ] **Step 3:** Run `bun test server/test-support`. Expected: FAIL.
- [ ] **Step 4:** Implementasi harness dan port: `INSERT OR IGNORE` → `INSERT IGNORE`; `ON CONFLICT … DO UPDATE SET value = excluded.value` → `ON DUPLICATE KEY UPDATE value = VALUES(value)`; kutip kolom `"before"/"after"` → `` `before` ``/`` `after` ``; `instr(lower(x), ?) > 0` → `LOCATE(?, LOWER(x)) > 0`; penghitung (`counters`) dibaca lewat `LAST_INSERT_ID(expr)` + `meta.lastRowId` sebagai pengganti `RETURNING` pada UPDATE; hapus `cached`/`touchCache` dari jalur access/auth (cache dimatikan; modul `mem-cache` dibuang di T13).
- [ ] **Step 5:** Run `bun test server/src/core server/src/modules/access server/src/modules/auth server/test-support`. Expected: PASS (termasuk tes CAS/konflik access yang ada).
- [ ] **Step 6:** `bun run typecheck && bun run lint`. Expected: hijau.
- [ ] **Step 7:** Commit `feat(server): harness tes MariaDB; port inti, access, auth`.

### Task 6: Port modul `brand` dan `customer`

**Files:**
- Modify: `server/src/modules/brand/{repo,service,validate,routes}.ts`, `server/src/modules/customer/*.ts`, `server/src/modules/sync/state.ts` (+ tes masing-masing; `nextSyncRev`/`syncRevExpr`/`currentSyncRev` dipindah ke MariaDB di sini), `server/test-support/ported-modules.ts`

- [ ] **Step 1:** Aktifkan tes `brand` dan `customer` (tambahkan ke `ported-modules.ts`; gagal pada SQL lama).
- [ ] **Step 2:** Port: penyederhanaan ganti-nama merk (hapus `UPDATE … FROM json_each`, kunci sementara `char(1) || rowid`, pemecahan dua tahap, dan optimasi jatah pernyataan → satu transaksi: `UPDATE items … WHERE brand_id = ?` berbasis kunci `brands` yang dikunci `SELECT … FOR UPDATE`, semantik hasil sama: merk berubah nama → `key` merk dan kunci pencarian item ikut, `sync_rev` item naik; **tes yang ada tetap menjadi spesifikasi**); `brands.item_count` tetap dijaga; `RETURNING sync_rev` → baca `sync_state` dalam transaksi yang sama.
- [ ] **Step 3:** Run `bun test server/src/modules/brand server/src/modules/customer`. Expected: PASS, termasuk tes bahwa `'Sony'` dan `'sony'`/`'SONY '` bentrok seperti sebelumnya (Review Focus 2).
- [ ] **Step 4:** Commit `feat(server): port brand dan customer ke MariaDB`.

### Task 7: Port modul `item`

**Files:** Modify: `server/src/modules/item/*.ts` (+ tes), `server/test-support/ported-modules.ts`

- [ ] **Step 1:** Aktifkan tes `item` (gagal).
- [ ] **Step 2:** Port: pencarian `instr(i.key, ?) > 0 OR instr(i.alias_keys, ?) > 0` → `LOCATE`; `INSERT/UPDATE … RETURNING sync_rev` → `sync_rev` dihitung lewat `nextSyncRev` dalam transaksi yang sama dan dikembalikan dari variabel aplikasi; `item_alias_keys` tetap ditulis bersama `items` (`insertItemStmts`/`updateItemStmts`).
- [ ] **Step 3:** Run `bun test server/src/modules/item`. Expected: PASS.
- [ ] **Step 4:** Commit `feat(server): port item ke MariaDB`.

### Task 8: Port modul `files` (tanpa cache R2)

**Files:** Modify: `server/src/modules/files/*.ts`, `server/src/core/file-cache.ts` (+ tes); Delete: `server/test-support/fake-r2.ts`, `server/src/modules/files/r2-cache.test.ts`

- [ ] **Step 1:** Aktifkan tes `files`; hapus tes/dukungan R2.
- [ ] **Step 2:** Port: `cachedFileContent` tidak lagi memakai R2/Cache API Workers; ganti dengan cache memori LRU sederhana berbatas ukuran (≤ 32 MB total, kunci `driveId`) yang diperiksa SETELAH pemeriksaan izin/folder; `trashFile`/`replaceFileContent` memanggil `dropCachedFile` (aturan yang ada). Isi berkas tetap dilewatkan sebagai base64 pada Fase 1 (berubah ke biner di T21).
- [ ] **Step 3:** Run `bun test server/src/modules/files`. Expected: PASS.
- [ ] **Step 4:** Commit `feat(server): port files ke MariaDB tanpa R2`.

### Task 9: Port modul `handover`

**Files:** Modify: `server/src/modules/handover/*.ts` (+ tes), `server/test-support/handover-env.ts`, `server/test-support/ported-modules.ts`

- [ ] **Step 1:** Aktifkan tes `handover` (gagal), termasuk tes konkurensi (`03850ac`) yang kini berjalan pada MariaDB sungguhan.
- [ ] **Step 2:** Port: urutan komentar `ORDER BY created_at, rowid` → `ORDER BY created_at, id`; komentar halaman sebagai `json_group_array(json_object(...))` → kueri komentar terpisah per halaman (dua round trip dalam `Promise.all` dan penyusunan di aplikasi; hapus batas CPU-driven); penghitung nomor `ST-YYYYMMDD-NNN` lewat `counters` + `LAST_INSERT_ID`; penjaga CAS dipertahankan (`CAS_VERSION_BUMP_SET`).
- [ ] **Step 3:** Tambahkan dua tes (Review Focus 1 dan 3): dua `saveBatch`/`save` paralel pada hari yang sama menghasilkan nomor berbeda tanpa celah ganda; dua `setCheck` paralel pada task yang sama → satu `CONFLICT`; catatan dan komentar berisi `😀` dan 5.000 karakter tersimpan dan terbaca utuh.
- [ ] **Step 4:** Run `bun test server/src/modules/handover`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): port handover ke MariaDB`.

### Task 10: Port modul `qrcode`

**Files:** Modify: `server/src/modules/qrcode/*.ts` (+ tes), `server/test-support/qrcode-env.ts`

- [ ] **Step 1:** Aktifkan tes `qrcode` (gagal).
- [ ] **Step 2:** Port: `SELECT CASE WHEN changes() = 0 THEN abs(-9223372036854775807 - 1) ELSE 1 END` (penjaga baris-terpengaruh) → penjaga serupa memakai `ROW_COUNT()` dan ekspresi gagal `CAS_FAIL_SQL`; ekspor PDF/PNG sisi FE tidak tersentuh.
- [ ] **Step 3:** Run `bun test server/src/modules/qrcode`. Expected: PASS.
- [ ] **Step 4:** Commit `feat(server): port qrcode ke MariaDB`.

### Task 11: Port `jobs` dan penjadwal internal (menggantikan Queue + Cron)

**Files:**
- Create: `server/src/jobs/runner.ts`, `server/src/jobs/runner.test.ts`
- Modify: `server/src/modules/jobs/{consumer,service,repo,routes,cleanup,export-sheets,sheets-job,sheets-export}.ts`, `server/src/scheduled.ts` (dihapus; logikanya pindah ke runner), `server/src/core/env.ts` (hapus `JOBS`), `server/test-support/test-env.ts` (hapus `queued`)

**Interfaces:**
- Produces: `enqueueJob(env, kind, params, actor): Promise<string>` (menyisipkan baris `jobs` status `pending`, tanpa Queue); `runPendingJobs(env: Env): Promise<number>` (menjalankan job `pending` berurutan, mengembalikan jumlahnya; dipanggil tes); `startJobRunner(env: Env, options?: { intervalMs?: number }): () => void` (polling tiap 2 dtk, satu job pada satu waktu, mengembalikan fungsi penghenti); `startScheduler(env: Env): () => void` (tiap jam menyisipkan `cleanup_qr` bila belum ada job aktif; kerangka yang T30 pakai untuk dump malam).
- Consumes: `Db` (T3), `jobs` (T4).

- [ ] **Step 1:** Tulis tes runner: `enqueueJob` lalu `runPendingJobs` menyelesaikan job `cleanup_qr` dan `export_sheets` (jembatan palsu); dua pemanggilan paralel `runPendingJobs` tidak menjalankan job yang sama dua kali (klaim atomik `UPDATE … WHERE status='pending'` memeriksa `changes`); job gagal dicatat `failed` dengan pesan dan bisa diulang manual (perilaku `jobs.get` sekarang); `startScheduler` tidak menumpuk `cleanup_qr` bila sudah ada yang aktif.
- [ ] **Step 2:** Run tes. Expected: FAIL.
- [ ] **Step 3:** Implementasi; hapus `handleQueue`, pesan antrean, dan retensi-24-jam; potongan ekspor Sheets tetap di `job_blobs`.
- [ ] **Step 4:** Run `bun test server/src/jobs server/src/modules/jobs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): runner job internal menggantikan Queue dan Cron`.

### Task 12: Port `sync` (Desktop) tanpa JSON-di-SQL

**Files:** Modify: `server/src/modules/sync/{auth,items,items-wire,pull,state,handler,files,brands,conflict,routes,wire}.ts` (+ tes); Delete: `server/src/core/pre-encoded.ts`

- [ ] **Step 1:** Aktifkan tes `sync` (gagal).
- [ ] **Step 2:** Port: `rate_limits` (`ON CONFLICT … RETURNING count`) → `INSERT … ON DUPLICATE KEY UPDATE` + baca hitungan dalam transaksi; parameter bernomor `?1/?2` → `?` berurutan; `sync_state` penghitung lewat `LAST_INSERT_ID`; **hapus** penyusunan JSON kabel di SQL (`json_object/json_each/json_group_array`) dan `PreEncodedJson`: tarik item membaca baris biasa lalu `toWireItem` di aplikasi (satu-satunya definisi bentuk kabel; tes kesetaraan SQL-vs-`toWireItem` dihapus karena tak lagi relevan).
- [ ] **Step 3:** Run `bun test server/src/modules/sync`. Expected: PASS. Kontrak `/sync` tetap amplop lama pada Fase 1 (diganti REST di Fase 3).
- [ ] **Step 4:** Commit `feat(server): port sync ke MariaDB; bentuk kabel disusun di aplikasi`.

### Task 13: Entri Bun, dev lokal, pembuangan sisa Cloudflare, dokumen

**Files:**
- Create: `server/src/main.ts`, `server/src/http/proxy.ts`, `server/src/http/proxy.test.ts`, `server/src/config.ts`, `server/src/main.test.ts`
- Modify: `server/src/index.ts` (jadi `app.ts` yang mengekspor `app` Hono, tanpa `queue`/`scheduled`), `web/vite.config.ts` (proxy ke `:8788`, `outDir: '../server/dist'`), root `package.json` (`dev`, `dev:server`, `db:seed`; hapus `dev:worker`, `load:cpu`), `scripts/dev.ts`, `scripts/verify-dist.ts`, `CLAUDE.md`, `README.md`
- Delete: `server/wrangler.jsonc`, `server/src/core/mem-cache.ts`(+tes), `RouteDef.warm`, `server/scripts/{load-cpu*,hot-path.test.ts,doh-preload.cjs}`, `server/test-support/{sqlite-d1*,measure*,fake-r2.ts}`, `server/spike/`, `docs/dev-worker.md`, `docs/observability.md` (versi Workers Logs), `@cloudflare/workers-types` dari `package.json` dan tsconfig, `server/test-support/ported-modules.ts` dan `server/scripts/test.ts` (skrip `test` kembali `bun test` biasa; seluruh direktori tes kini berjalan)

**Interfaces:**
- Produces: `loadConfig(env = process.env): Config` (`DATABASE_URL`, `SESSION_SECRET`, `OAUTH_CLIENT_ID/SECRET`, `SYNC_API_TOKEN`, `BRIDGE_URL`, `BRIDGE_SECRET` (digantikan di T30a oleh `GOOGLE_SA_KEY_FILE` dan `GOOGLE_ROOT_FOLDER_ID`; SMTP_* ditambah di T32), `ADMIN_EMAIL`, `APP_ORIGIN`, `PORT` default 8788, `TRUSTED_PROXY` default `loopback`); `clientIp(request: Request, peerAddress: string, trustedProxy: 'loopback' | 'any'): string` (membaca `CF-Connecting-IP` HANYA bila `peerAddress` loopback); `createServer(config): { fetch, stop }` — Hono melayani `/api/ping`, `/api/rpc`, `/api/boot`, `/auth/*`, `/sync`, berkas statis `server/dist` dengan fallback SPA, `startJobRunner` + `startScheduler`.
- Consumes: semua tugas T3–T12.

- [ ] **Step 1:** Tulis tes: `clientIp` mengembalikan nilai `CF-Connecting-IP` bila peer `127.0.0.1`/`::1`; mengabaikan header itu bila peer `203.0.113.7` (Review Focus 4); `loadConfig` melempar galat daftar semua variabel wajib yang hilang (tanpa membocorkan nilainya); `createServer` menjawab `GET /api/ping`, melayani `index.html` untuk `/rute-klien`, dan `POST /api/rpc` `auth.me` tanpa sesi → 401 `UNAUTHENTICATED`.
- [ ] **Step 2:** Run tes. Expected: FAIL.
- [ ] **Step 3:** Implementasi entri dan konfigurasi; pembatas percobaan salah (`sync/auth`) memakai `clientIp`; hapus seluruh sisa Cloudflare dan pengoptimalan edge (lihat Files); `bun run dev` menjalankan `server` (:8788, DB lewat tunnel — skrip memeriksa tunnel dan memberi petunjuk) dan Vite (:3000 proxy `/api /auth /sync` ke :8788); `bun run db:seed` memuat data contoh ke skema `qc_dev` (porting `seed-dev.ts`, `seed-data.ts`).
- [ ] **Step 4:** Perbarui `CLAUDE.md`: bagian Perintah (dev/tunnel/check), Struktur (`server/`), HAPUS "Aturan Worker (CPU edge dan rows read D1)", tambah aturan server (adaptor `Db`, penjaga CAS MariaDB, harness tes lewat tunnel, collation `utf8mb4_nopad_bin`); selaraskan `README.md`.
- [ ] **Step 5:** Run `bun run check && bun run build`. Expected: hijau penuh (tunnel hidup). Uji manual `bun run dev`: login "pengguna dev", buka daftar merk/item/board, simpan satu merk; lampirkan hasil.
- [ ] **Step 6:** Commit `feat(server): entri Bun dan konfigurasi; buang sisa Cloudflare` lalu tandai **gerbang Fase 1**.

---

# FASE 2 — Kabel REST (dirinci 2026-11-05 setelah Fase 1 lulus dan pemilik menyetujui I5, M2, stabilitas tes)

Gerbang Fase 2: `/api/rpc`, `/api/boot`, amplop `RpcResult`, dan `web/src/lib/rpc/` tidak ada lagi; semua rute web dilayani di `/api/v1/*` dari SATU tabel (`shared/api.ts`); `bun run check` dan `bun run build` hijau; `GET /api/openapi.json` memuat semua jalur.

## Putusan desain Fase 2 (berlaku untuk T13b–T24; catat di ledger sebagai `Ruling:`)

1. **Satu tabel, validator dan handler tak disentuh.** `API_ROUTES` memetakan tiap id `WorkerRpcMethod` ke bentuk kabel. Server merakit kembali objek input datar yang SAMA dengan sekarang (`SaveBrandInput`, dst.) dari jalur + query + badan + `If-Match`, lalu memanggil `RouteDef.validate/handler/permission` yang ada. Perubahan bentuk kabel tidak boleh menyentuh logika modul.
2. **Bentuk `ApiRouteDef` (shared/api.ts, murni, tanpa API runtime):**
   ```ts
   type ApiVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
   type QueryKind = 'string' | 'number' | 'boolean' | 'list'; // list = nilai dipisah koma
   interface ApiRouteDef {
     verb: ApiVerb; path: string;        // relatif terhadap /api/v1, mis. '/brands/{id}'
     status?: 200 | 201 | 202;           // bawaan 200
     query?: Record<string, QueryKind>;  // field input yang dikirim lewat query (selain parameter jalur)
     create?: { verb: ApiVerb; path: string; status?: 201 }; // dipakai bila input.id TIDAK ada (rute save)
     etag?: string;                      // field keluaran yang menjadi nilai header ETag (mis. 'updatedAt')
     ifMatch?: string;                   // field input yang dibawa header If-Match (mis. 'expectedUpdatedAt')
     binary?: 'request' | 'response' | 'multipart'; // diisi T21; sebelum itu rute berpenanda ini tidak didaftarkan
   }
   ```
   Field input yang bukan parameter jalur/query/`ifMatch` masuk badan JSON (POST/PUT/PATCH); pada GET/DELETE semuanya lewat query. Parameter jalur menang atas badan; `id` badan yang berbeda dari jalur → `VALIDATION` 422.
3. **Rute `save` = dua jalur satu id**: `PUT /x/{id}` (ubah) dan `create` = `POST /x` (buat, 201 + `Location`). `toRequestParts` memilih menurut ada-tidaknya `input.id`.
4. **Status galat (RFC 9457 `application/problem+json`)**: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `VALIDATION` 422 (badan bukan JSON/terlalu besar: 400/413 dengan `code: 'VALIDATION'`), `UNAVAILABLE` 503 (pembatas laju 429), `INTERNAL` 500. Badan: `{ type: 'urn:qc:problem:<code-huruf-kecil>', title, status, detail, code, requestId, fields? }`. Galat basi (stale) membawa penanda `stale: true` pada `AppError` (helper `staleError(message)`, dipakai di `cas.ts` dan tiap pelempar `STALE_MESSAGE`); aturan kernel: `stale` DAN rute punya `ifMatch` DAN permintaan membawa `If-Match` → **412**, selain itu `CONFLICT` → 409. Kode di badan tetap `CONFLICT` agar FE tidak berubah.
5. **ETag**: GET sumber daya tunggal dan respons PUT/PATCH/POST-buat memberi `ETag: "<keluaran[etag]>"`; GET dengan `If-None-Match` cocok → 304 (handler tetap jalan; hemat badan, bukan hemat CPU). `If-Match` dibaca ke field `ifMatch` (kutip dibuang; `*` dan banyak-nilai diabaikan).
6. **Kursor**: `limit`/`cursor` lewat query, keluaran `{ items, nextCursor }` (item, audit) dan `BoardPageDto` (board) tetap seperti `WorkerRpcContract`. Bawaan dan batas baru: lihat T19 (M2).
7. **Penghapusan bertahap tanpa mematikan FE**: `REST_MIGRATED_IDS` (satu sumber, di `shared/api.ts`, dipakai server dan FE) memuat himpunan id yang sudah REST; `getRoutes()` untuk `/api/rpc` menjawab `NOT_FOUND` untuk id di himpunan itu; tiap tugas modul menambah id-nya dan memindahkan FE modul itu dalam komit yang sama. `/api/rpc` dihapus di T23 saat himpunan = semua id.
8. **Urutan pendaftaran Hono**: rute statis sebelum berparameter (`/handovers/options` dan `/handovers/batch` sebelum `/handovers/{id}`). Rute tak dikenal di bawah `/api/v1/*` → 404 `problem+json` (bukan fallback SPA; `isServerPath` sudah mencakup `/api`).
9. **OpenAPI**: `GET /api/openapi.json` (OpenAPI 3.1) dibangun dari tabel: jalur, verba, status, parameter jalur/query, header `If-Match`/`ETag`, `operationId` = id RPC, ringkasan izin dari `RouteDef.permission`. Tanpa skema JSON badan (lihat penyimpangan 2). Dilindungi: butuh sesi login (galat 401 bila tidak); `Cache-Control: no-store`.
10. **`DELETE` mengembalikan 200 dengan `{ id }`** (isi kontrak sekarang dipertahankan; tidak 204) — FE tak berubah.

## Peta id → REST (jalur final; dua jalur pada satu sel = ubah / `create`)

| id | verba jalur | catatan |
|---|---|---|
| `auth.me` | `GET /me` | etag: —; T22 |
| `access.users.list` / `save` / `setStatus` | `GET /users` / `PUT /users/{id}` + `POST /users` / `PATCH /users/{id}` | setStatus: badan `{status}`; PATCH etag `updatedAt` (ruling review putaran 2, M6) |
| `access.roles.list` / `save` / `delete` | `GET /roles` / `PUT /roles/{id}` + `POST /roles` / `DELETE /roles/{id}` | |
| `access.locations.list` / `save` / `setStatus` | `GET /locations` / `PUT /locations/{id}` + `POST /locations` / `PATCH /locations/{id}` | PATCH etag `updatedAt` |
| `access.audit.list` | `GET /audit-logs` | query `cursor:string, limit:number, action:string, query:string` |
| `brands.list` / `save` / `setStatus` | `GET /brands` / `PUT /brands/{id}` + `POST /brands` / `PATCH /brands/{id}` | PATCH etag `updatedAt` |
| `customers.list` / `rename` / `setStatus` | `GET /customers` / `PUT /customers/{id}` / `PATCH /customers/{id}` | rename = ganti `name`; setStatus = ubah `status`; PATCH etag `updatedAt` |
| `items.list` / `get` / `save` / `setStatus` | `GET /items` / `GET /items/{id}` / `PUT /items/{id}` + `POST /items` / `PATCH /items/{id}` | list query `cursor,limit,query,status`; save `ifMatch:'expectedUpdatedAt'`, `etag:'updatedAt'`; setStatus (PATCH) etag `updatedAt` |
| `handovers.options` | `GET /handovers/options` | query `locationIds:list` |
| `handovers.board` | `GET /handovers` | query `locationIds:list, status, cursor, limit:number` |
| `handovers.get` | `GET /handovers/{id}` | query `locationIds:list`; etag `updatedAt` |
| `handovers.save` | `PUT /handovers/{id}` + `POST /handovers` | ifMatch `expectedUpdatedAt`, etag `updatedAt` |
| `handovers.saveBatch` | `POST /handovers/batch` (201) | |
| `handovers.cancel` / `reopen` / `setDone` | `POST /handovers/{id}/cancel` / `/reopen` / `/done` | badan `{locationId}` |
| `handovers.setCheck` | `PUT /handovers/{id}/checks` | badan `{locationId,index,text,checked}`; idempoten |
| `handovers.comment` | `POST /handovers/{id}/comments` (201) | |
| `qrcodes.list` / `get` / `save` / `delete` | `GET /qrcodes` / `GET /qrcodes/{id}` / `PUT /qrcodes/{id}` + `POST /qrcodes` / `DELETE /qrcodes/{id}` | get/save etag `updatedAt`; save ifMatch `expectedUpdatedAt` (ruling T20) |
| `qrcodes.getDefaults` | `GET /qrcode-defaults` | |
| `qrcodes.savePreset` / `deletePreset` | `PUT /qrcode-presets/{id}` + `POST /qrcode-presets` / `DELETE /qrcode-presets/{id}` | savePreset ifMatch `expectedUpdatedAt`, etag `updatedAt` (ruling T20) |
| `qrcodes.saveLogoLibrary` | `PUT /qrcode-defaults/logos` | ifMatch `expectedUpdatedAt`, etag `logoUpdatedAt` |
| `qrcodes.uploadPdf` | `POST /qrcode-documents` | `binary:'request'` (badan = PDF mentah; query `name:string, replaceDocumentId:string`); status **200** (bukan 201: mengunggah/mengganti dokumen sumber, bukan membuat sumber daya ber-`Location`); T21 |
| `qrcodes.cloneFromDrive` | `POST /qrcode-documents/clone` | badan `{source, replaceDocumentId?}` |
| `qrcodes.export` | `POST /qrcodes/{id}/exports` (202) | `binary:'multipart'` (bagian `pdf`, `png`); ifMatch `expectedUpdatedAt`; `Location: /api/v1/jobs/{jobId}`; T21 |
| `qrcodes.file` | `GET /qrcodes/{id}/files/{kind}` | `binary:'response'`, `kind` ∈ `pdf|png`; T21 |
| `files.upload` | `POST /files` (201) | `binary:'request'` (badan = byte gambar, `Content-Type` = `mime`; query `width,height:number`); `Location: /api/v1/files/{id}`; T21 |
| `files.get` | `GET /files/{id}` | `binary:'response'`, etag = id (isi tak berubah); T21 |
| `jobs.get` | `GET /jobs/{id}` | |
| `exports.sheets` | `POST /exports/sheets` (202) | badan `{tables?}` |

Aturan umum (ruling yang diterapkan): rute `create` mendaftarkan operasi kedua dengan `operationId` OpenAPI `<id>.create` (jalur ubah memakai `<id>`), jadi jumlah operasi = jumlah id + jumlah rute ber-`create`; respons JSON `Cache-Control: no-store` dan klien `cache: 'no-store'` (review putaran 2, I1: ETag `updatedAt` bukan validator isi); `authorize` (sesi + izin global) berjalan SEBELUM badan dibaca (I2). Jalur `{id}` = `input.id`; `{kind}` = `input.kind`. Sinkron Desktop (`sync.*`) bukan bagian tabel ini (T25).

### Task 13b: Perkuat stabilitas `bun run check` lewat tunnel (keputusan pemilik: kurangi shard atau tes jarak jauh)

**Files:** Modify: `server/scripts/test.ts`, `docs/dev-server.md`
- Keputusan controller (memilih opsi termurah dulu): `DEFAULT_SHARDS` 4 → 3, `MAX_SHARDS` tetap; `QC_TEST_SHARDS` tetap menimpa. Ukur: tiga `bun run check` berurutan di mesin pengembang harus hijau tanpa timeout latensi; bila masih acak gagal, turunkan ke 2 dan catat durasinya di `docs/dev-server.md`. `test:remote` (tes langsung di VPS) HANYA bila 2 shard pun gagal — catat sebagai `Ruling:` dan jangan dibangun spekulatif.
- Tes: tes runner yang ada hijau; tidak ada tes baru. Komit: `fix(server): turunkan shard tes bawaan untuk stabilitas lewat tunnel`.

### Task 14: Tabel rute `shared/api.ts` + kernel REST di server

**Files:** Create: `shared/api.ts`, `shared/api.test.ts`, `server/src/http/{rest,problem,openapi}.ts` (+ `*.test.ts`); Modify: `server/src/app.ts`, `server/src/core/errors.ts` (`staleError`, `AppError.stale?`), `server/src/core/cas.ts` + semua pelempar `STALE_MESSAGE` (grep `STALE_MESSAGE`/`staleMessage`/`'CONFLICT'`), `server/src/core/router.ts` (pisahkan perakitan konteks permintaan dari amplop agar dipakai bersama)
**Interfaces:**
- Produces `API_ROUTES: { [M in WorkerRpcMethod]: ApiRouteDef }` dan, murni dan bolak-balik:
  `toRequestParts(id: M, input: WorkerRpcInput<M>): { verb; path: string; query: Record<string,string>; body?: unknown; ifMatch?: string }`,
  `fromRequestParts(id: M, parts: { params: Record<string,string>; query: Record<string,string>; body: unknown; ifMatch?: string; created: boolean }): unknown` (hasil = input datar siap `validate`; galat parameter → melempar objek `{ field: string; message: string }` yang diubah kernel menjadi `VALIDATION`),
  `etagOf(id: M, output: WorkerRpcOutput<M>): string | undefined`, `fillPath(path: string, params: Record<string,string>): string`.
- Produces `toProblem(error: unknown, requestId: string): { status: number; body: ProblemBody; headers?: Record<string,string> }`, `registerRest(app, routes: RouteTable)` (himpunan `migrated` hanya ada sementara sampai T23), `buildOpenApi(routes: RouteTable): OpenApiDocument`.
- Consumes `RouteDef`/`callRoute` logika dari `router.ts` (sesi cookie, konteks, izin, validasi, lokasi, handler): refaktor `callRoute` menjadi `runRoute(env, token, id, rawInput, routes)` yang melempar/mengembalikan nilai mentah; `callRoute` (RPC) membungkusnya dengan amplop dan kernel REST membungkusnya dengan problem+json (satu jalur kode). Diperbarui (review putaran 2, I2): `runRoute` dipecah `authorize` (sesi + izin global, dipanggil kernel SEBELUM badan dibaca) dan `execute` (validasi, izin berlokasi, handler).
- **Tes (RED dulu)**:
  - `shared/api.test.ts`: tiap id punya jalur+verba unik (pasangan `verb path` tak ada yang ganda, termasuk `create`); `toRequestParts → fromRequestParts` mengembalikan input identik untuk satu contoh tiap id (tabel contoh di berkas tes; kompilator memaksa contoh lengkap lewat `Record<WorkerRpcMethod, …>`); `id` badan ≠ jalur → galat; `list` memecah `a,b`; `number`/`boolean` diparse, bukan-angka → galat.
  - Server (`http/rest.test.ts` memakai `createTestEnv` + `app.request`): `CONFLICT` biasa → 409; `staleError` + `If-Match` → 412; `staleError` tanpa `If-Match` → 409; `VALIDATION` → 422 dengan `fields`; badan bukan JSON → 400, > batas → 413 (`problem+json`); metode tulis tanpa `X-Requested-With: qc` → 403 problem+json; `/api/v1/tidak-ada` → 404 problem+json; GET tunggal memberi `ETag` dan `If-None-Match` sama → 304; `INTERNAL` menyamarkan pesan dan menyertakan `requestId`; `/api/openapi.json` tanpa sesi 401, dengan sesi memuat SEMUA jalur tabel (jumlah operasi = jumlah id + jumlah rute ber-`create`; `operationId` jalur create = `<id>.create`).
- Langkah: (1) tulis tes RED; (2) implementasi `shared/api.ts` + `problem.ts` + refaktor router; (3) `rest.ts` + `openapi.ts` + `app.ts` (`app.route('/api/v1', …)`, `/api/openapi.json`); (4) `staleError` di semua pelempar basi, tes lama tetap hijau; (5) `bun run check`; komit bertahap.

### Task 15: Klien FE `web/src/lib/api/` + `describeError` problem+json

**Files:** Create: `web/src/lib/api/{client,api-error,describe-error,index}.ts` (+ tes); Modify: setup tes FE bila perlu
**Interfaces:** Produces `api<M extends WorkerRpcMethod>(id: M, input: WorkerRpcInput<M>): Promise<WorkerRpcOutput<M>>`, `class ApiError extends Error { code: ErrorCode; status: number; requestId: string; fields?: Record<string,string> }`, `describeError(error: unknown): string` (isi dan format identik dengan `lib/rpc/describe-error.ts` sekarang; kelas dasar diganti).
- `api()` memakai `toRequestParts`, menyisipkan `X-Requested-With: qc` pada non-GET dan `If-Match: "<nilai>"`, `credentials: 'same-origin'`, memetakan respons `problem+json` ke `ApiError` (kode dari `body.code`, bukan dari status; 412 → `CONFLICT`), jaringan gagal → `INTERNAL` ("Tidak dapat menghubungi server…"), badan bukan problem (halaman galat proksi) dipetakan dari status seperti `http-transport.ts` sekarang. Alias sementara: `rpc = api` dan `RpcError = ApiError` diekspor dari `web/src/lib/rpc/index.ts` hingga T23 supaya modul yang belum pindah tetap jalan, tetapi `lib/rpc` memakai transport lama untuk id yang belum REST — SATU pintu: `rpc(id, input)` memeriksa `RPC_MIGRATED` (himpunan sama dengan server; sumber tunggal di `shared/api.ts`: `REST_MIGRATED_IDS`) dan mengarahkan ke `api()` bila id sudah pindah.
- Tes: `fetch` dipalsukan: tiap verba/jalur contoh (GET dengan query list, PUT dengan `If-Match`, POST `create`, PATCH, DELETE); problem 409 → `code 'CONFLICT'`; 412 → `CONFLICT`; 401 → `UNAUTHENTICATED` (penanganan global di `query-client.ts`/`_app.tsx` tetap bekerja: periksa memakai `ApiError`/`RpcError` yang sama); jaringan gagal → `INTERNAL`; `describeError` tabel kasus yang sama dengan tes lama dipindah.

### Task 16: `brand` REST (pola acuan)

**Files:** Modify: `shared/api.ts` (`REST_MIGRATED_IDS`), `web/src/modules/brand/queries.ts` (`rpc` → `api`), tes
- Tambah id `brands.*` ke himpunan; `/api/rpc` untuk id itu → `NOT_FOUND`. Tes server (`modules/brand/rest.test.ts`): 201 + `Location` saat membuat; `PUT` ganti nama; `PATCH` status; duplikat nama → 409 `fields`; tanpa izin → 403; merk dipakai item tak terhapus; tes lama RPC brand diganti padanan REST (bukan dihapus: tiap asersi lama tetap ada lewat `app.request`). Tes FE: `queries.test` memeriksa URL/verba. Uji manual: `bun run dev` → halaman Merk (daftar, buat, ganti nama, status) tanpa galat konsol; lampirkan hasil di ledger.

### Task 17: `customer` + `access` REST

**Files:** Modify: modul `customer` dan `access` (server: tes; FE: `modules/customer/queries.ts`, `modules/access/queries.ts` dan pemanggil audit)
- `users/roles/locations` + `GET /audit-logs` berkursor (FE audit: ganti `page` angka oleh kursor — periksa `access.audit.list` FE memakai `ListAuditPageInput`; bila UI audit masih bernomor halaman, pakai tombol "Muat lebih banyak" dengan kursor). Tes: kursor tidak melewatkan/menggandakan entri saat penulisan audit baru masuk di tengah; `DELETE /roles/{id}` role dipakai → 409; toggle status ganda aman.

### Task 18: `item` REST

**Files:** Modify: modul `item` (server tes, FE `modules/item/queries.ts`, detail/form)
- `GET /items?cursor&limit&query&status`, `PUT` dengan `If-Match: "<updatedAt>"` menggantikan `expectedUpdatedAt` di badan; ETag dari `updatedAt`. Tes: dua penyimpan, satu 412; GET → ETag sama dengan `updatedAt`; kursor + `query`; sinkron Desktop tak terdampak (jalur `sync` tidak disentuh).

### Task 19: `handover` REST + **M2 (keputusan pemilik 2026-11-05: longgarkan batas peninggalan CPU edge)**

**Files:** Modify: modul `handover` (server dan FE `modules/handover/**`), `shared/handover.ts` (`HANDOVER_WORKER_BATCH` → `HANDOVER_BATCH_MAX = 30`), `server/src/modules/handover/{validate,service}.ts` (`BOARD_DEFAULT_LIMIT`), `web/src/modules/handover/components/handover-batch-form.tsx`, spek §18 dan PRD (`docs/prd/`: lokasi keputusan 2026-10-30 — cari `HANDOVER_WORKER_BATCH`, "maks. 5", "10 sebelum 2026-10-30")
- M2 yang disetujui: (a) `saveBatch` maks. **30** per permintaan (seperti GAS); formulir bulk mengirim SATU permintaan atomik (hapus pemecahan 5 dan logika "kelompok tersimpan dibuang bila berikutnya gagal"; gagal = tak ada yang tersimpan); (b) board: bawaan **20**, maks. **50** (BoardPageInput) menggantikan 3; (c) detail `sync.items.pull` 50 ditinjau di T25 (bukan di sini). Catat: spek §18 (butir baru), PRD (keputusan 2026-10-30 digantikan 2026-11-05, alasan: batas CPU edge hilang di VPS, disetujui pemilik), `CLAUDE.md` bagian handover (angka batch), dan ubah semua tes yang menyebut 5/10/3.
- Tes: `PUT …/checks` dipanggil dua kali dengan isi sama → hasil identik (idempoten), tanpa 409; 31 task → 422 `fields.tasks`; 30 task atomik (satu gagal → tidak ada yang tersimpan, nomor `ST-…` tidak ganda; ekstensi tes konkurensi nomor paralel T9 lewat REST); `POST …/comments` 201; stale `PUT /handovers/{id}` → 412 saat `If-Match` ada; `GET /handovers?status=…&limit=50` kursor konsisten; lokasi di luar akses → 403.

### Task 20: `qrcode` + `jobs` + `exports` REST (tanpa biner)

**Files:** Modify: modul `qrcode`, `jobs`, `jobs/routes.ts` (`exports.sheets`), FE `modules/qrcode/queries.ts`, `modules/jobs/queries.ts`, `routes/_app/qrcode/index.tsx`
- Ubah rute bukan-biner saja (`list/get/save/delete/getDefaults/savePreset/deletePreset/saveLogoLibrary/cloneFromDrive`, `jobs.get`, `exports.sheets`); `export` dan `uploadPdf`/`file` dipindah di T21. `exports.sheets` memberi 202 + `Location: /api/v1/jobs/{id}`. Tes: pemilik QR default; `DELETE` mengembalikan `{id}`; `GET /jobs/{id}` job milik orang lain → 404 (periksa perilaku sekarang dulu, jangan mengubahnya).

### Task 21: Berkas biner (hapus base64 dari kabel)

**Files:** Modify: `shared/rpc.ts` (hapus `base64` dari `UploadFileInput`, `FileContentDto`, `UploadQrPdfInput`, `ExportQrDesignInput`, `QrFileDto`; ganti dengan `bytes: Uint8Array`/`Blob` di sisi kernel), `shared/api.ts` (`binary`), `server/src/http/rest.ts` (pembaca badan biner/multipart, penulis aliran), modul `files` dan `qrcode` (validator, layanan, jembatan: base64 tetap hanya di `bridge-client` ke GAS; *catatan 2026-11-06: jembatan GAS digantikan klien Google langsung di T30a, antarmuka `BridgeClient` tidak berubah*), FE `modules/files/**`, `modules/qrcode/**`
- Batas ukuran tetap seperti saat T21 (periksa konstanta yang ada; jangan menaikkan di T21). Diperbarui 2026-11-06 (spek §19 butir 5): batas berkas/gambar menjadi 10 MB bersama T30a, bukan sebelumnya; batas JSON REST 2 MB (§19 butir 4). Unggah: `POST /files` (badan mentah, `Content-Type` = mime, `width/height` di query), `POST /qrcode-documents` (PDF mentah), `POST /qrcodes/{id}/exports` (multipart: `pdf`, `png`). Unduh: `GET /files/{id}` dan `GET /qrcodes/{id}/files/{kind}` mengalirkan byte dengan `Content-Type` benar, `Content-Disposition` untuk QR, `Cache-Control: private, max-age=…` (file gambar: `immutable`), `ETag` + 304.
- Tes: melebihi batas → 413 `problem+json` TANPA membaca seluruh badan ke memori (alirkan dan potong); mime tidak diizinkan → 422; unduh memberi `Content-Type`, `ETag`, 304 pada `If-None-Match`; izin tetap diperiksa SEBELUM cache berkas; byte yang diunggah = byte yang diunduh (round trip, termasuk gambar ≥ 1 MB); multipart tanpa bagian `png` → 422; FE `modules/files` tes unggah memakai `Blob`; tak ada `base64` tersisa di `shared/rpc.ts` selain DTO jembatan (grep jadi tes).

### Task 22: `auth` — `GET /me`

**Files:** Modify: `server/src/modules/auth/rpc.ts` → rute REST, `server/src/app.ts` (hapus `/api/boot`), `web/src/app/boot.ts`, `web/src/modules/auth/queries.ts`/`session.ts`, `web/src/app/query-persist.ts` (rujukan `/api/boot`), tes
- `GET /api/v1/me` (tanpa sesi → 401 problem). Tes boot FE memakai jalur baru; `/api/boot` tak ada (404). Alur `/auth/*` (OAuth) tidak berubah.

### Task 23: Hapus RPC lama dan perbarui dokumen

**Files:** Delete: `web/src/lib/rpc/`, `/api/rpc` dan `handleRpc`, `REST_MIGRATED_IDS`; Modify: `shared/rpc.ts` (amplop `RpcResult`/`RpcErrorBody` dihapus; `ErrorCode` tetap; DTO dan `WorkerRpcContract` tetap sebagai kontrak tipe — ganti nama berkas ke `shared/contract.ts` BILA diff-nya kecil, jika tidak tinggalkan), `docs/adding-a-module.md` (resep modul baru: tambah id di kontrak, entri `API_ROUTES`, `RouteDef`, `queries.ts` via `api`), `CLAUDE.md` ("Menambah method RPC" → "Menambah rute REST"), `README.md`, `docs/dev-server.md`, `docs/observability.md` (log per rute REST), `web/vite.config.ts` bila perlu
- Tes: grep-tes (`scripts/`): tak ada `rpc(`/`/api/rpc`/`RpcResult` tersisa di `web/`, `server/`, `shared/` (kecuali `gas/` yang dipensiunkan di T35); semua id punya rute REST terdaftar (`registerRest` tanpa himpunan).

### Task 24: Gerbang Fase 2

`bun run check && bun run build` hijau; uji manual seluruh alur via `bun run dev` (login dev, Merk, Customer, Item (buat/ubah/status, konflik dua tab → pesan stale), Serah Terima (buat, bulk 30, centang, komentar, batal/buka ulang), QR (buat, unggah PDF, ekspor, unduh), Log Audit, Pengguna/Peran/Lokasi) dengan hasil per butir di ledger; periksa `GET /api/openapi.json` memuat tiap id; ukur lazy-load dan ukuran chunk (`verify-dist`). Lalu review akhir putaran 2 (independen, spek + `security-audit` terfokus diff: otorisasi per rute baru, `If-Match` bypass, mass assignment lewat gabungan badan+query+jalur (parameter jalur menang), CSRF header pada semua metode tulis, unggahan biner (ukuran, mime, path traversal pada `{kind}`), kebocoran detail galat di problem+json, IDOR pada `GET /files/{id}` dan `GET /jobs/{id}`).

---

# FASE 3 — Sinkron QC Desktop v2

### Task 25: REST `/api/v1/sync/*` dan kontrak baru
**Files:** Modify: `server/src/modules/sync/{handler,routes,auth}.ts`, `shared/api.ts` (`SYNC_API_ROUTES`), `shared/sync.ts` (+ tes), `docs/api/desktop-sync.md` (ditulis ulang, versi API 2), PRD terkait
- Rute: `GET /sync/ping`, `GET /sync/brands?sinceRev&limit`, `POST /sync/brands/push`, `GET /sync/items?sinceRev&limit&include`, `POST /sync/items/push`, `GET /sync/files/{id}` (biner: byte mentah, `Content-Type`, `ETag` = id, batas 8 MB); `Authorization: Bearer` saja (cookie tidak diterima, tanpa csrfGuard); semua kegagalan pra-otentikasi 401 problem+json yang sama; pembatas 10 salah/10 menit per IP; status konflik per item tetap di hasil per item (badan 200); TANPA `ETag`/`If-Match` pada item/merk (pull berbasis `sinceRev`); `POST /sync` dan amplop dihapus (404). Batas sinkron sendiri 5 MB; pull dengan detail 200, push 50/25 (peninjauan butir ketiga M2; spek §19 butir 7). Tes: token salah/hilang/diblokir seragam `401 problem+json`; blokir 10 menit per IP (IP lain bebas); `CF-Connecting-IP` hanya dari peer tepercaya; berkas byte mentah + 413/404/folder; batas push 50/25 → 422; `POST /sync` → 404; OpenAPI memuat rute sinkron dengan skema `syncBearer`; Authorization tidak masuk log. **Hasil implementasi (2026-11-06)**: `SYNC_API_ROUTES`/`syncInputFromParts` di `shared/api.ts`, `registerSyncRest` di `server/src/modules/sync/rest.ts`, `SYNC_REST_API_VERSION` = 2. **Pencatatan keputusan**: tambahkan di `desktop-sync.md` dan PRD sinkron catatan "REST, 2026-11-05, disetujui pemilik, alasan: kontrak belum dipakai klien", ubah butir bertentangan.

---

# FASE 4 — Docker, nginx, CI/CD

### Task 26: Image dan compose lengkap
**Files:** Create: `Dockerfile`, `.dockerignore`; Modify: `deploy/compose.yml` (tambah `qc-app`), `deploy/.env.example`
- Image WAJIB menyertakan `server/migrations/` (migrator membaca berkas dari disk, putusan T4). Multi-stage: build web + dependensi produksi server; dasar `oven/bun` ringan; pengguna non-root; `HEALTHCHECK` ke `/api/ping`; `qc-app` mendengarkan `127.0.0.1:${APP_PORT}`, `mem_limit` (±256m), bergantung `qc-db` sehat; migrasi dijalankan `qc-app` saat start sebelum `listen`. Tes: `docker build` lokal tidak tersedia → verifikasi di Actions (T28) dan di VPS dev (T27).
- **Rahasia Google (revisi 2026-11-06)**: berkas kunci service account TIDAK masuk image; `compose.yml` memasangnya baca-saja dari `/opt/qc/<env>/secrets/google-sa.json` ke `/run/secrets/google-sa.json` (`GOOGLE_SA_KEY_FILE`), dan `deploy/.env.example` memuat `GOOGLE_SA_KEY_FILE`, `GOOGLE_ROOT_FOLDER_ID`, `SMTP_*`, `ALERT_TO` (tanpa nilai). Sebelum T30a selesai, `BRIDGE_URL`/`BRIDGE_SECRET` masih dibaca kode Fase 1 dan hanya dipertahankan sampai T30a.
- **I5 (keputusan pemilik 2026-11-05)**: `TRUSTED_PROXY` menerima DAFTAR CIDR (bukan hanya loopback); subnet jaringan compose dipatok (`ipam` subnet tetap di `compose.yml`) dan nginx host memanggil `qc-app` lewat gateway bridge itu. Ubah `server/src/http/proxy.ts` (`clientIp` menerima daftar CIDR IPv4/IPv6; peer di luar daftar → `CF-Connecting-IP` diabaikan), `server/src/config.ts`, tes (peer di dalam/luar CIDR, IPv4-mapped), dan **catat di spek §5** (butir "hanya dipercaya bila dari loopback" diubah menjadi "hanya dari alamat dalam `TRUSTED_PROXY`; bawaan loopback") serta Global Constraints dan Review Focus 4 di rencana ini ("loopback" → "daftar CIDR tepercaya"), dengan tanggal 2026-11-05, alasan (peer di Docker adalah gateway bridge), disetujui pemilik.

### Task 27: Provisioning VPS (pengguna deploy, nginx, staging)
**Files:** Create: `deploy/nginx/qc.conf.example`, `deploy/deploy.sh`, `docs/deploy-vps.md`
- Atas konfirmasi pemilik (nama subdomain `dev`/`exec`, lokasi sertifikat origin; **pemilik mendaftarkan URI redirect OAuth untuk kedua domain di Google Cloud Console pada klien OAuth yang sama**; `.env` tiap lingkungan diisi rahasia baru: `SESSION_SECRET`, `OAUTH_*`, `SYNC_API_TOKEN`, `GOOGLE_ROOT_FOLDER_ID` folder induk Drive staging, `SMTP_*`/`ALERT_TO`; berkas kunci service account di `/opt/qc/dev/secrets/google-sa.json` izin 600, disalin pemilik, tidak lewat GitHub. Revisi 2026-11-06: `BRIDGE_URL`/`BRIDGE_SECRET` hanya sementara sampai T30a menggantikan jembatan; bila T27 berjalan sebelum T30a, isi variabel Google dan jembatan sekaligus dan fitur berkas staging mengikuti yang tersedia — rekomendasi kontroler: kerjakan T30a lebih dulu agar staging langsung lengkap [saya]): buat pengguna `deploy` (grup docker, kunci khusus dengan `command="/opt/qc/deploy.sh"`), direktori `/opt/qc/{dev,exec}`, blok nginx per subdomain (`real_ip` Cloudflare, `client_max_body_size` sesuai batas berkas), `nginx -t` sebelum `reload`, tanpa menyentuh blok lain; jalankan `qc-app` di lingkungan `dev`; `deploy.sh` (`pull`, `up -d`, tunggu sehat, uji `/api/ping`, kembali ke tag sebelumnya bila gagal). Verifikasi: `curl https://<dev-subdomain>/api/ping` lewat Cloudflare.

### Task 28: `deploy-server.yml` dan gerbang
**Files:** Create: `.github/workflows/deploy-server.yml`; Modify: `.github/workflows/test.yml` (service container `mariadb:11.8`, `QC_TEST_DB_URL`), `docs/ci-cd.md`
- Pola keamanan `deploy-worker.yml` dipakai ulang (`pull_request_target` hanya setelah merge, checkout `merge_commit_sha`, dispatch manual hanya dari `main`/`dev`, antrean serial); sementara sebelum cutover, aturan environment `dev` mengizinkan dispatch dari branch kerja. Langkah: check → build → `docker build` + push GHCR (tag SHA) → SSH `deploy` → uji asap. Tes: dispatch ke `dev` dan lihat `GET /api/ping` hijau; sengaja rusak (image yang gagal sehat) memicu kembali ke tag lama. Hapus `deploy-worker.yml` pada PR cutover (T34), bukan sebelumnya.

### Task 29: Gerbang Fase 4
- Staging (`dev`) berjalan di VPS dengan data contoh; `exec` disiapkan (tanpa DNS publik); pantau memori `docker stats` dan `free -h` (bandingkan dengan batas di Global Constraints); laporkan angka ke pemilik.

---

# FASE 5 — Google langsung (service account) dan cadangan ke Drive

### Task 30a: Klien Google langsung (service account) + batas berkas 10 MB (spek §19 butir 5 dan 6; keputusan pemilik 2026-11-06)

*Ditulis ulang 2026-11-06. Task 30a lama (unggah berpotongan di jembatan GAS) DIBATALKAN karena jembatan dipensiunkan; batas 10 MB (opsi A) tetap dan kini hanya batas di server.*

**Files:**
- Create: `server/src/core/google/{auth,drive,sheets,client}.ts` (+ `*.test.ts` memakai server Google palsu lewat `fetch` yang disuntik; kunci RSA uji dibangkitkan di tes, bukan kunci nyata), `docs/setup-google.md` (bagian baru "Service account"; langkah Apps Script lama ditandai usang dan dihapus di T35)
- Modify: `server/src/core/bridge-client.ts` (antarmuka metode yang ada TETAP; `getBridge` memakai `createGoogleClient(env)`; metode baru yang dibutuhkan T30–T32 ditambahkan di sini: daftar folder berhalaman, unggah dari berkas/aliran, unduh sebagai aliran, hapus permanen berkas buatan sendiri, info kuota), `server/src/core/env.ts` dan `server/src/config.ts` (`GOOGLE_SA_KEY_FILE`, `GOOGLE_ROOT_FOLDER_ID`; hapus `BRIDGE_URL`/`BRIDGE_SECRET`; penjaga folder `ALLOWED_FOLDER_IDS`/`QR_FOLDER_ID`/`QR_DOC_FOLDER_ID` dan folder cadangan dari `.env`), `server/.env.example`, `shared/files.ts` (`MAX_IMAGE_BYTES` batas tepi 10 MB; target pengecilan gambar di FE TIDAK ikut naik), `shared/qrcode.ts`, `shared/api.ts` (`maxBytes`; `api.test.ts` menjaga kesamaan dengan konstanta), modul `files` dan `qrcode` (ganti pesan "maksimal sekitar 750 KB" dengan batas 10 MB; layanan tak berubah selain itu; `MAX_REQUEST_BODY_BYTES` mengikuti tabel secara otomatis), `server/test-support/fake-bridge.ts` bila perlu (tetap memenuhi antarmuka)
- Delete: `server/src/core/bridge-http.ts` (+ tesnya, `bridge-client.real.test.ts` diganti tes klien Google)

**Interfaces:**
- Aturan folder induk: `createFolder(name)` pada klien SELALU membuat folder dengan `parents: [GOOGLE_ROOT_FOLDER_ID]` (modul `files`/`qrcode` tak berubah; `ensureNamedFolder` yang memanggil `createFolder` tanpa induk tidak boleh menaruh folder di Drive service account di luar induk dan di luar penjaga). Peralihan id folder fungsi dari tabel `settings` (`DRIVE_FOLDER_ID`, `QR_FOLDER_ID`, `QR_DOC_FOLDER_ID`) ke `.env` ditetapkan di sini: folder gambar item mendapat variabel `.env` sendiri (nama ditetapkan di T30a) dan `ensureNamedFolder` hanya memverifikasi folder yang dikonfigurasi (tanpa membuat otomatis bila id `.env` terisi); penjaga `ALLOWED_FOLDER_IDS` mencakup semua folder fungsi, dan pembuatan folder di luar induk ditolak.
- Produces: `createGoogleClient(env): BridgeClient`; `getAccessToken(): Promise<string>` (JWT RS256 dengan Web Crypto, klaim `iss`/`scope`/`aud`/`exp`; token di-cache di memori dan diperbarui sebelum kedaluwarsa); `driveRequest(...)` internal dengan aturan ulang (401 → perbarui token SEKALI lalu ulangi; 429/5xx dengan jeda bertahap HANYA untuk operasi idempoten: baca, daftar, hapus, rename, izin; pembuatan berkas tidak diulang tanpa pemeriksaan).
- Cakupan OAuth: `drive` dan `spreadsheets`. Padanan: `createFolder`/`createFile`/`replaceFileContent` → Drive v3 (unggah multipart ≤ ambang kecil, resumable di atasnya), `readFile`/`fileInfo` → `files.get` (`alt=media`) dengan pemeriksaan `parents` (induk HARUS folder yang diizinkan), `externalFileInfo`/`readExternalFile`/`copyFile` → `X-Goog-Drive-Resource-Keys` bila ada `resourceKey`, `trashFile` → `files.update {trashed:true}` (sukses bila 404), `shareAnyoneWithLink`/`revokeSharing` → `permissions.create`/`delete` (`type: anyone`, `role: reader`), `sheetsExport`/`sheetsDump` → Sheets v4 `values.update`/`append`/`batchGet` pada spreadsheet data tunggal.

- [ ] **Step 0 (verifikasi sebelum kode; prasyarat T30a):** perluas dan jalankan `scripts/google-sa-check` (uji manual lokal, kunci dari berkas rahasia di luar repositori) untuk memastikan hal yang spek tandai **[verifikasi]**: service account benar-benar berkuota 15 GB dan dapat memiliki berkas; Editor pada folder induk dapat membuat/mengganti/memindahkan/membuang berkas lama milik pemilik; unggah resumable 9 MB berhasil; pembacaan Sheets. Hasilnya dicatat di ledger. Bila ada yang gagal, hentikan dan laporkan ke pemilik, jangan lanjut ke kode.
- [ ] **Step 1:** Tulis tes dengan `fetch` palsu (RED): (a) JWT: klaim `iss` = email service account, `scope` = cakupan yang diminta, `aud` = titik token Google, `exp` ≤ 1 jam, tanda tangan terverifikasi dengan kunci publik uji; (b) token di-cache (dua panggilan beruntun = satu penukaran token) dan diperbarui sebelum kedaluwarsa; (c) 401 → perbarui token SEKALI lalu ulangi, 401 kedua → `UNAVAILABLE`; (d) 429/5xx dicoba ulang untuk operasi idempoten saja, `createFile` tidak diulang; (e) 404 → `null`/sukses sesuai kontrak `BridgeClient` (`readFile`, `fileInfo`, `trashFile`, `revokeSharing`); (f) pemeriksaan induk (`parents`): berkas yang induknya di luar daftar folder yang diizinkan → `null`/ditolak seperti jembatan lama; (g) `X-Goog-Drive-Resource-Keys` dikirim untuk berkas eksternal ber-`resourceKey`; (h) unggah resumable 9 MB lolos utuh (byte masuk = byte keluar); (i) galat dan log TIDAK memuat kunci privat atau token (uji: sentinel pada kunci/token tidak muncul di pesan galat maupun keluaran `console.*`); (j) 10 MB + 1 byte → 413 `problem+json` di tepi tanpa membaca seluruh badan; target pengecilan gambar di FE tak berubah.
- [ ] **Step 2:** Run tes → FAIL. Implementasi `core/google/*`, ganti `getBridge`, hapus `bridge-http.ts` dan `BRIDGE_*`, naikkan batas 10 MB (gambar 1 MB → 10 MB; PDF sumber 10 MB dan ekspor 8 MB TETAP kecuali ada kebutuhan nyata), ganti pesan "maksimal sekitar 750 KB". Run `bun test server/src/core server/src/modules/files server/src/modules/qrcode shared` → PASS.
- [ ] **Step 3:** Tulis `docs/setup-google.md`: membuat service account, mengaktifkan Drive API dan Sheets API, membuat kunci dan menyimpannya sebagai berkas rahasia (izin 600), membagikan folder induk dan spreadsheet data ke email service account (Editor), memindahkan folder lama ke bawah induk TANPA mengubah id, mengisi `.env` (`GOOGLE_SA_KEY_FILE`, `GOOGLE_ROOT_FOLDER_ID`, penjaga folder), rotasi kunci (buat kunci baru, ganti berkas, restart, hapus kunci lama), pemantauan kuota 15 GB.
- [ ] **Step 4:** Uji integrasi manual lokal dengan `scripts/google-sa-check` yang diperluas (unggah/unduh/hapus sungguhan ke folder uji; tidak masuk `bun run check`); lampirkan hasil di ledger.
- [ ] **Step 5:** `bun run check`. Commit `feat(server): klien Google langsung (service account) menggantikan jembatan; batas berkas 10 MB`.
- Dikerjakan SEBELUM T30 (dump cadangan memakai klien ini) dan bersamaan dengan kenaikan batas tepi. Dapat dikerjakan lebih awal dari urutan fase (hanya bergantung pada Fase 2) agar staging di T27–T29 langsung memakai Google tanpa jembatan **[saya; kontroler memutuskan]**.

### Task 30: Dump malam, satu berkas, unggah resumable, pembersihan (direvisi 2026-11-06)

**Files:** Create: `server/src/modules/backup/{dump,upload,retention,service}.ts` (+ tes); Modify: `server/src/jobs/runner.ts` (jadwal 02:00 WIB memakai `startScheduler`), `Dockerfile` (`mariadb-client`), `docs/setup-google.md` (folder cadangan di bawah induk)
- Dump `mariadb-dump --single-transaction --routines` → gzip → SATU berkas `qc-backup-YYYYMMDD-HHmm.sql.gz` → unggah resumable ke folder cadangan lewat klien Google (T30a). Tanpa potongan, manifest, atau `drive.listFolder` di jembatan. Integritas: setelah unggah bandingkan `md5Checksum` dari Drive dengan MD5 lokal (beda → job `failed`, berkas Drive yang cacat dibuang); SHA-256 disimpan di `appProperties`. Pembersihan oleh server (retensi): daftar folder lewat Drive API (berhalaman), sisakan 7 harian + 4 mingguan menurut tanggal di nama berkas, **tidak pernah menghapus bila salinan tersisa < minimum** (bentuk fungsi murni agar mudah diuji), dijalankan sesudah unggah sukses.
- Tes (klien Google palsu): dump diunggah utuh (byte masuk = byte keluar); `md5Checksum` beda → gagal; unggahan gagal → dump lokal tetap ada dan job `failed` dapat diulang; di VPS hanya 3 salinan terakhir; retensi: 30 berkas harian → tersisa 7 harian + 4 mingguan, hanya 3 berkas → tidak ada yang dihapus, berkas bernama tak dikenal tidak disentuh.

### Task 31: Pemulihan teruji (direvisi 2026-11-06)

**Files:** Create: `scripts/restore-backup.ts` (+ tes)
- Pemulihan lewat Drive langsung: unduh `alt=media` (lewat klien Google), verifikasi MD5 Drive dan SHA-256 di `appProperties`, gunzip, impor ke skema target; **menolak** bila checksum atau gunzip gagal dan tidak mengimpor setengah data (Review Focus 5). Tes unit memakai klien Google palsu; **uji sekali di staging** (dump `dev` → skema `qc_restore_check` → bandingkan jumlah baris per tabel → hapus skema).

### Task 32: Peringatan cadangan lewat SMTP dan pemantauan kuota (direvisi 2026-11-06; sebelumnya "Trigger pembersih dan peringatan di jembatan")

Pembersihan (retensi) oleh server dikerjakan di T30 (`retention.ts`); T32 hanya peringatan cadangan basi lewat SMTP dan pemantauan kuota.

**Files:** Create: `server/src/core/mail.ts` (+ tes), `server/src/modules/backup/alert.ts` (+ tes); Modify: `server/src/jobs/runner.ts` (pemeriksaan jam-an), `server/src/config.ts` dan `server/.env.example` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_TO`), `server/package.json` (`nodemailer`; kompatibilitas Bun diverifikasi di sini), `docs/setup-google.md`
- `mail.ts`: SMTP generik tanpa kode khusus penyedia (sekarang SMTP Google dengan sandi aplikasi, nanti bisa pindah ke email kantor hanya dengan mengganti `.env`); transport disuntik agar tes memakai SMTP palsu. `alert.ts`: penjadwal jam-an memeriksa cadangan terbaru (daftar folder cadangan); bila > 36 jam, kirim email ke `ALERT_TO` lalu simpan waktu peringatan terakhir di `settings`; **tidak mengirim lagi bila peringatan terakhir < 12 jam**. Pemeriksaan pemakaian kuota Drive (info kuota `about.get`) memberi peringatan bila melewati ambang yang diatur (bawaan 80%).
- Tes (klien Google dan SMTP palsu, jam terkendali): terbaru 40 jam → satu email; 10 jam → tidak ada email; dua pemeriksaan dalam 12 jam → satu email; 13 jam sesudah peringatan pertama dan masih basi → email kedua; email gagal terkirim → dicatat dan dicoba lagi pada jam berikutnya (tidak melempar ke penjadwal); pesan email dan log tidak memuat `SMTP_PASS`; tidak ada folder cadangan/salinan sama sekali → dianggap basi.
- **Pertanyaan terbuka kepada pemilik (MENUNGGU KEPUTUSAN; jangan dikerjakan sebelum diputuskan)**: peringatan lewat server tidak berbunyi bila VPS atau `qc-app` mati (dulu trigger Apps Script independen dari VPS). Mitigasi yang diusulkan: (a) dead-man's switch eksternal (mis. healthchecks.io: job cadangan mem-ping sesudah sukses; layanan itu mengirim email bila ping hilang; butuh satu variabel `.env` URL ping), atau (b) satu trigger Apps Script minimal khusus peringatan. Sampai diputuskan, T32 hanya mengerjakan peringatan lewat server; hasil keputusan dicatat di spek §10/§17/§19 butir 6 dan tugas ini diperbarui. Juga menunggu konfirmasi: pemindahan pembersihan cadangan dari trigger Apps Script ke server (spek §19 butir 6).


---

# FASE 6 — Data, cutover, pemensiunan

### Task 33: Impor Sheets → MariaDB dan gladi staging
**Files:** Modify: `scripts/migrate/{import-sheets,verify-import,schema-map}.ts` (+ tes), `docs/setup-google.md` (bagian impor; menggantikan `docs/setup-bridge.md` bagian 5); Create: `docs/superpowers/runbooks/2026-11-cutover-vps.md`
- **Revisi 2026-11-06**: dump Sheets dibaca lewat klien Google (`sheetsDump`, service account, spreadsheet data tunggal dibagikan sebagai Editor), bukan jembatan; tak ada rujukan `docs/setup-bridge.md` tersisa.
- **Aktifkan kembali** `scripts/migrate/*.test.ts` (29 tes; dikecualikan dari skrip `test` root lewat `--path-ignore-patterns` sejak T5 karena memakai SQL SQLite) dan hapus pengecualian itu dari skrip root.
- Keluaran SQL dialek MariaDB; `verify-import` membandingkan jumlah baris + checksum per tabel, rujukan yatim, penghitung `sync_rev` dan `handover:YYYYMMDD`. **Verifikasi dulu** isi dump produksi: hanya modul akses dan QR yang hidup; putuskan bersama pemilik apakah data uji handover/item dibuang. Gladi di staging dengan dump nyata, uji fitur, uji pemulihan cadangan. Runbook: urutan, jendela tulis-beku beberapa jam, jalan mundur (cabut `READ_ONLY`, `gas-legacy`), pemulihan manual tulisan jendela.

### Task 34: PR kecil ke `origin/main` (READ_ONLY) dan PR cutover
**Files (di `origin/main`):** `gas/src/…` bendera `READ_ONLY` dibawa lewat PR kecil sendiri; **PR cutover** dari branch kerja: hapus `.github/workflows/deploy.yml` (GAS) dan `deploy-worker.yml` DALAM PR yang sama dengan penggabungan; tag `gas-legacy` pada `origin/main` sebelum merge.
- Eksekusi atas persetujuan pemilik per langkah (deploy READ_ONLY, dump, impor produksi, verifikasi, DNS, pantau).
- **Revisi 2026-11-06**: `deploy-worker.yml` sudah dihapus di T2, jadi PR cutover hanya menghapus `deploy.yml` (GAS); jembatan Apps Script tidak lagi punya alur deploy yang perlu dijaga (server tidak memakainya sejak T30a), dan pemensiunannya ada di T35.

### Task 35: Pemensiunan dan dokumentasi akhir
**Files:** Modify/Delete: `gas/` (dihapus setelah masa pantau), `build:gas`/`push`/`deploy` root dan skrip GAS, **pensiun jembatan Apps Script (spek §19 butir 6, 2026-11-06)**: hapus `bridge/` (termasuk `bridge/deployment*.json`, `appsscript.json`, `spike/`), `docs/setup-bridge.md`, perintah `build:bridge` dan skrip `scripts/{bridge-clasp,bridge-smoke,build-bridge,build-bridge-lib,build-bridge.test,deploy-bridge,push-bridge}.ts`, `bridge` dari `workspaces`/`typecheck`/`test` di root `package.json`, serta entri `clasp` di `.mcp.json` bila hanya untuk GAS (`gas/` ikut dihapus; bila `clasp` masih dipakai alur lain, tinggalkan dan catat); pastikan `grep -ri bridge` tak menyisakan rujukan arahan kerja (nama antarmuka `BridgeClient`/`bridge-client.ts` boleh diganti nama menjadi `GoogleClient` bila diff kecil, jika tidak tinggalkan); `shared/gas-legacy.ts` (amplop RPC dan DTO base64 khusus `gas/`, dipertahankan di T23 karena `RpcContract` GAS masih memakainya; hapus bersama `gas/`) dan `RpcContract` GAS di `shared/rpc.ts`, `CLAUDE.md`, `docs/*`, PRD PWA (Fase 2 "ketahanan server" ditinjau ulang dengan alasan kuota D1 hilang), spek Cloudflare (status final); perbarui memori proyek agen.

### Task 36: Gerbang akhir
- Review menyeluruh independen atas seluruh diff proyek: kesesuaian spek + `security-audit` terfokus permukaan yang disentuh (otorisasi rute REST, validasi input, mass assignment, kebocoran data di `problem+json`, penanganan rahasia `.env` dan kunci service account Google (tak bocor ke log/galat, izin berkas, cakupan folder), race pada data sensitif, kepercayaan `CF-Connecting-IP`, izin pengguna `deploy` dan kunci SSH). Audit penuh seluruh codebase hanya bila pemilik memintanya.

---

## Self-review (dijalankan penyusun)

- **Cakupan spek:** §2 keputusan 1–13 → T1/T2/T13 (1–4), T14–T24 (5–6), Google langsung di T30a–T32 (7, 9, 11; direvisi 2026-11-06, spek §19 butir 6), T27–T28 (8, 10), T1/T3/T5 (12), T33–T35 (13). §5 arsitektur → T13/T26/T27; §6 → T3–T13 (+ penyimpangan 1–3); §7 → T14–T24 (+ penyimpangan 4); §8 → T4; §9 → T25; §10 → T30a–T32 (+ penyimpangan 6); §11 → T26–T28; §12 → T15–T23; §13 → T27/T28/T34; §14 → T33–T34; §15 → T2/T13/T35; §17 risiko memori → T29, driver → T3, tunnel → T3/T5.
- **Konsistensi tipe:** `Db`/`DbStatement`/`DbResult`/`DbError` (T3) dipakai T4–T13; `createTestEnv`/`testDbUrl` (T3/T5) dipakai T6–T12; `API_ROUTES`/`toRequestParts`/`fromRequestParts` (T14) dipakai T15–T25; `startScheduler` (T11) dipakai T13/T30.
- **Proporsi:** Fase 1 dirinci per langkah karena paling berisiko; Fase 2–6 sengaja garis besar dan **dirinci per langkah sebelum eksekusi fasenya** (pola yang sama dengan rencana-rencana fase di repo ini), agar tidak menjadi transkrip kode yang basi begitu Fase 1 mengubah antarmuka.
- **Risiko yang ditandai untuk pemilik:** enam penyimpangan di atas; (revisi 2026-11-06) peringatan cadangan lewat server tidak berbunyi bila VPS mati dan menunggu keputusan dead-man's switch atau trigger Apps Script minimal, konfirmasi pemindahan pembersihan cadangan ke server, serta verifikasi service account (kuota 15 GB, hak Editor atas berkas lama, `nodemailer` di Bun) di T30a Step 0; target waktu `createTestEnv` ≤ 400 ms lewat tunnel (T5) mungkin meleset dan memerlukan keputusan; nama subdomain, lokasi sertifikat origin, dan token GHCR disediakan pemilik pada T27/T28.
