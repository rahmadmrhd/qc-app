# Backend di VPS (Docker, Bun + Hono + MariaDB) dengan API REST — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memindahkan backend QC App dari rencana Cloudflare Worker+D1 ke Bun + Hono + MariaDB dalam Docker di VPS pemilik, dengan API REST, rilis otomatis (GitHub Actions), cadangan ke Drive, dan cutover data dari Google Sheets.

**Architecture:** Dua tahap yang tiap tahapnya tetap berjalan. **Fase 1** menukar runtime dan basis data di bawah RPC yang ada (frontend tidak berubah) lewat adaptor `Db` tipis berbentuk D1 di atas MariaDB. **Fase 2** mengganti kabel RPC menjadi REST lewat satu tabel rute bersama (`shared/api.ts`) yang dipakai klien FE, server, dan OpenAPI. Fase 3–6: sinkron Desktop v2, Docker/CI, cadangan, cutover.

**Tech Stack:** Bun, Hono, `mysql2` (bila gagal di Bun: Node + Hono, lihat T3), MariaDB 11.8 LTS, Docker Compose, nginx host, GitHub Actions + GHCR, Apps Script (jembatan), React/Vite/TanStack (tetap).

**Spec:** `docs/superpowers/specs/2026-11-05-migrasi-vps-docker-rest-design.md` (disetujui pemilik 2026-11-05). Dokumen pendukung: `docs/api/desktop-sync.md`, `docs/setup-bridge.md`, `docs/ci-cd.md`, `CLAUDE.md`.

## Penyimpangan dari spek (perlu konfirmasi pemilik)

Hasil pembacaan kode saat menyusun rencana; spek §6/§7 menandainya **[saya]**:
1. **Adaptor `Db` berbentuk D1 (`prepare().bind().first()/all()/run()`, `batch()` = transaksi), bukan Kysely.** Alasan: ±10.500 baris repo dan ±9.300 baris tes memakai bentuk itu dan hanya ±50 baris memakai SQL khusus SQLite; Kysely berarti menulis ulang semuanya.
2. **OpenAPI dari tabel rute `shared/api.ts`, bukan `@hono/zod-openapi`.** Alasan: validator server ditulis tangan (`core/validate.ts`), bukan zod. Skema JSON permintaan/respons tidak dihasilkan pada iterasi ini (jalur, verba, izin, status, nama DTO saja).
3. **Penjaga CAS yang digabung ke `UPDATE` dipertahankan** (ekspresi gagal dan pendeteksi galatnya diganti untuk MariaDB, galat 1690), bukan `SELECT … FOR UPDATE`. Perilaku sama, sudah teruji, satu pernyataan lebih sedikit.
4. **Klien FE bertipe berbasis tabel rute** (`api(id, input)` membangun URL REST dari tabel) agar ±11 berkas `queries.ts` hampir tidak berubah; yang berubah adalah bentuk kabel (REST nyata).
5. **Migrasi skema D1 0001–0009 dikonsolidasi menjadi satu `0001_baseline.sql`** (belum ada database produksi yang harus dijaga).

## Global Constraints

- Backend: **Bun + Hono**; DB **MariaDB 11.8 LTS**, `utf8mb4`, `innodb_buffer_pool_size` 128 MB, `max_connections` 40, batas memori container 384 MB; tanpa port database ke host kecuali `127.0.0.1`.
- **Port 8787 tidak boleh dipakai** (terpakai di VPS). Tunnel dev: lokal dan remote `33063`.
- VPS dipakai bersama: **jangan menyentuh** container, blok nginx, atau firewall aplikasi lain; semua berkas QC di `/opt/qc/<dev|exec>/`; periksa `docker ps`/`ss -tlnp` sebelum membuat apa pun.
- Environment GitHub: **`dev`** (staging) dan **`exec`** (production). Rahasia aplikasi hanya di `.env` VPS (izin 600), di GitHub hanya kunci SSH deploy.
- REST: dasar `/api/v1`, `application/problem+json` (RFC 9457) dengan ekstensi `code`, `requestId`, `fields`; `ETag`/`If-Match`; kursor `?cursor=&limit=`; cookie sesi `HttpOnly; Secure; SameSite=Lax` + header `X-Requested-With: qc` pada metode non-aman; sinkron Desktop `Authorization: Bearer`, API versi 2, 10 token salah/10 menit memblokir 10 menit.
- Cadangan: nama `qc-backup-YYYYMMDD-HHmm.sql.gz`, sekali per malam, retensi **7 harian + 4 mingguan**, **tidak pernah** menghapus bila salinan tersisa < minimum, email ke pemilik bila terbaru > **36 jam**; badan jembatan ≤ 1.048.576 karakter.
- IP klien dari `CF-Connecting-IP` **hanya** bila koneksi datang dari loopback (nginx).
- Aturan kode yang ada tetap: komentar Indonesia, Biome, `bun run check` hijau sebelum commit, `gas/dist` tak pernah diedit, logika murni di `shared/` tanpa API runtime.
- Commit: pesan gaya repo (`feat(server): …`), akhiri dengan baris `Co-Authored-By` yang berlaku; jangan commit rahasia (`.env*`, kunci).

## Review Focus

Masukan yang tersirat spek tetapi tak terlihat di tes biasa (tiap baris punya tes di tugas pemiliknya):
1. **Dua penulis menyimpan task yang sama / nomor `ST-YYYYMMDD-NNN` paralel**: satu menang, satu `409`/`412`, nomor tidak pernah ganda (T9, T19).
2. **Kunci unik dengan huruf besar-kecil, aksen, spasi ekor** (`Sony` vs `sony `): keunikan merk/customer di tingkat layanan tetap menolak keduanya lewat `normalizeKey`, dan collation DB tidak memperlakukan `a = a␠`/`e = é` secara diam-diam seperti collation `_ci`/PAD SPACE bawaan MariaDB (T4, T6).
3. **Emoji/Unicode 4-byte** di catatan, komentar, nama merk tersimpan dan terbaca utuh (T4, T9).
4. **Header `CF-Connecting-IP` palsu** dari koneksi non-loopback diabaikan sehingga pembatas token tak bisa dikelabui (T13).
5. **Dump terpotong hilang/tertukar bagian**: pemulihan menolak (checksum), tidak mengimpor setengah data (T31).
6. **Tunnel DB mati saat `bun run check`**: gagal cepat dengan pesan yang menyebut `bun run db:tunnel`, bukan menggantung (T3, T5).

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

- `server/` (ganti nama dari `worker/`): `src/core/{db,migrate,cas,errors,validate,session,log,audit,settings,context,router,bridge-client,bridge-http}.ts`, `src/modules/<modul>/…` (struktur tetap), `src/http/{security,rest,openapi,proxy}.ts`, `src/main.ts` (Bun.serve), `src/jobs/runner.ts`, `migrations/0001_baseline.sql`, `test-support/` (harness MariaDB), `scripts/`.
- `shared/api.ts` (tabel rute REST + fungsi murni pemetaan), `shared/rpc.ts` (DTO dipertahankan; amplop RPC dihapus di akhir Fase 2).
- `web/src/lib/api/` (menggantikan `lib/rpc/`).
- `deploy/` (`compose.yml`, `.env.example`, `nginx/qc.conf.example`, `deploy.sh`, `Dockerfile` di akar), `.github/workflows/deploy-server.yml`.
- `bridge/src/backup.ts` (+ aksi `drive.listFolder`), `scripts/restore-backup.ts`.

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
- Produces: `loadConfig(env = process.env): Config` (`DATABASE_URL`, `SESSION_SECRET`, `OAUTH_CLIENT_ID/SECRET`, `SYNC_API_TOKEN`, `BRIDGE_URL`, `BRIDGE_SECRET`, `ADMIN_EMAIL`, `APP_ORIGIN`, `PORT` default 8788, `TRUSTED_PROXY` default `loopback`); `clientIp(request: Request, peerAddress: string, trustedProxy: 'loopback' | 'any'): string` (membaca `CF-Connecting-IP` HANYA bila `peerAddress` loopback); `createServer(config): { fetch, stop }` — Hono melayani `/api/ping`, `/api/rpc`, `/api/boot`, `/auth/*`, `/sync`, berkas statis `server/dist` dengan fallback SPA, `startJobRunner` + `startScheduler`.
- Consumes: semua tugas T3–T12.

- [ ] **Step 1:** Tulis tes: `clientIp` mengembalikan nilai `CF-Connecting-IP` bila peer `127.0.0.1`/`::1`; mengabaikan header itu bila peer `203.0.113.7` (Review Focus 4); `loadConfig` melempar galat daftar semua variabel wajib yang hilang (tanpa membocorkan nilainya); `createServer` menjawab `GET /api/ping`, melayani `index.html` untuk `/rute-klien`, dan `POST /api/rpc` `auth.me` tanpa sesi → 401 `UNAUTHENTICATED`.
- [ ] **Step 2:** Run tes. Expected: FAIL.
- [ ] **Step 3:** Implementasi entri dan konfigurasi; pembatas percobaan salah (`sync/auth`) memakai `clientIp`; hapus seluruh sisa Cloudflare dan pengoptimalan edge (lihat Files); `bun run dev` menjalankan `server` (:8788, DB lewat tunnel — skrip memeriksa tunnel dan memberi petunjuk) dan Vite (:3000 proxy `/api /auth /sync` ke :8788); `bun run db:seed` memuat data contoh ke skema `qc_dev` (porting `seed-dev.ts`, `seed-data.ts`).
- [ ] **Step 4:** Perbarui `CLAUDE.md`: bagian Perintah (dev/tunnel/check), Struktur (`server/`), HAPUS "Aturan Worker (CPU edge dan rows read D1)", tambah aturan server (adaptor `Db`, penjaga CAS MariaDB, harness tes lewat tunnel, collation `utf8mb4_nopad_bin`); selaraskan `README.md`.
- [ ] **Step 5:** Run `bun run check && bun run build`. Expected: hijau penuh (tunnel hidup). Uji manual `bun run dev`: login "pengguna dev", buka daftar merk/item/board, simpan satu merk; lampirkan hasil.
- [ ] **Step 6:** Commit `feat(server): entri Bun dan konfigurasi; buang sisa Cloudflare` lalu tandai **gerbang Fase 1**.

---

# FASE 2 — Kabel REST (rinci tiap tugas saat Fase 1 lulus; berikut garis besar dan tes kuncinya)

### Task 14: Tabel rute `shared/api.ts` + kernel REST di server

**Files:** Create: `shared/api.ts`, `shared/api.test.ts`, `server/src/http/rest.ts`, `server/src/http/problem.ts`, `server/src/http/openapi.ts` (+ tes); Modify: `server/src/app.ts`
- `API_ROUTES: { [M in WorkerRpcMethod]: ApiRouteDef }` (kompilator memaksa lengkap), `ApiRouteDef { verb; path; status?; query?; etag?: string; ifMatch?: string; binary?: 'request' | 'response' }`; fungsi murni `toRequestParts(id, input)` dan `fromRequestParts(id, params, query, body, ifMatch)`; `toProblem(error, requestId)` (RFC 9457 + `code`/`fields`); registrasi rute REST dari tabel memakai `RouteDef` yang ada (izin/validator/handler tak berubah); `GET /api/openapi.json` dari tabel. Tes: tiap id punya tepat satu (verba, jalur); `toRequestParts`→`fromRequestParts` bolak-balik identik untuk input contoh semua id; `409` untuk `CONFLICT`, `412` untuk `If-Match` basi; `GET` memberi `ETag`; OpenAPI memuat semua jalur.

### Task 15: Klien FE `web/src/lib/api/` + `describeError` problem+json

**Files:** Create: `web/src/lib/api/{client,api-error,index}.ts` (+ tes); Modify: `web/src/lib/rpc/describe-error.ts` (dipindah), setup tes FE
- `api<M>(id: M, input): Promise<Output<M>>` membangun URL/verba/badan dari `API_ROUTES`, menyisipkan `X-Requested-With: qc` dan `If-Match`, menerjemahkan `problem+json` ke `ApiError` (kode, pesan, `requestId`, `fields`); alias `rpc` dipertahankan sementara agar migrasi modul bertahap. Tes: mock `fetch` memverifikasi tiap verba/jalur contoh, galat 412 → `CONFLICT`, jaringan gagal → `INTERNAL`.

### Task 16–24: Modul REST + FE per modul (satu tugas per kelompok)
Tiap tugas: server mendaftarkan rute REST modul dari tabel (rute `/api/rpc` modul itu dihapus), FE modul beralih `rpc`→`api`, tes server (kode status, `ETag`/`If-Match`, `problem+json`), tes FE (`queries.test`) dan uji manual dev.
- **T16** `brand` (pola acuan), **T17** `customer` + `access` (users, roles, locations, audit; kursor audit), **T18** `item`, **T19** `handover` (board berkursor; `PUT …/checks` idempoten; `POST …/batch`), **T20** `qrcode` + `jobs`/`exports`, **T21** **berkas biner**: `files.upload/get`, `qrcodes.uploadPdf/file` memakai `multipart`/biner dan stream (hapus base64 dari `shared/rpc.ts` dan FE `modules/files`); tes: unggahan melebihi batas → 413 problem+json, unduh memberi `Content-Type` dan `ETag`, **T22** `auth` (`GET /me`, alias `/api/boot`), **T23** hapus `/api/rpc`, `shared/rpc.ts` amplop `RpcResult`/`RpcErrorBody` diganti `Problem`, hapus `web/src/lib/rpc/`, perbarui `docs/adding-a-module.md`; **T24** gerbang Fase 2: `bun run check && bun run build`, OpenAPI diperiksa, uji manual seluruh alur (checklist `docs/e2e-checklist.md`).

---

# FASE 3 — Sinkron QC Desktop v2

### Task 25: REST `/api/v1/sync/*` dan kontrak baru
**Files:** Modify: `server/src/modules/sync/{handler,routes,auth}.ts`, `shared/api.ts` (`SYNC_API_ROUTES`), `shared/sync.ts` (+ tes), `docs/api/desktop-sync.md` (ditulis ulang, versi API 2), PRD terkait
- Rute: `GET /sync/ping`, `GET /sync/brands?cursor=`, `POST /sync/brands/push`, `GET /sync/items?cursor=`, `POST /sync/items/push`, `GET /sync/files/{id}` (biner); `Authorization: Bearer`; pembatas 10 salah/10 menit; status konflik per item tetap di hasil per item; `ETag` per item. Tes: token salah/hilang seragam `401 problem+json`; blokir 10 menit; `v` lama ditolak. **Pencatatan keputusan**: tambahkan di `desktop-sync.md` dan PRD sinkron catatan "REST, 2026-11-05, disetujui pemilik, alasan: kontrak belum dipakai klien", ubah butir bertentangan.

---

# FASE 4 — Docker, nginx, CI/CD

### Task 26: Image dan compose lengkap
**Files:** Create: `Dockerfile`, `.dockerignore`; Modify: `deploy/compose.yml` (tambah `qc-app`), `deploy/.env.example`
- Image WAJIB menyertakan `server/migrations/` (migrator membaca berkas dari disk, putusan T4). Multi-stage: build web + dependensi produksi server; dasar `oven/bun` ringan; pengguna non-root; `HEALTHCHECK` ke `/api/ping`; `qc-app` mendengarkan `127.0.0.1:${APP_PORT}`, `mem_limit` (±256m), bergantung `qc-db` sehat; migrasi dijalankan `qc-app` saat start sebelum `listen`. Tes: `docker build` lokal tidak tersedia → verifikasi di Actions (T28) dan di VPS dev (T27).

### Task 27: Provisioning VPS (pengguna deploy, nginx, staging)
**Files:** Create: `deploy/nginx/qc.conf.example`, `deploy/deploy.sh`, `docs/deploy-vps.md`
- Atas konfirmasi pemilik (nama subdomain `dev`/`exec`, lokasi sertifikat origin; **pemilik mendaftarkan URI redirect OAuth untuk kedua domain di Google Cloud Console pada klien OAuth yang sama**; `.env` tiap lingkungan diisi rahasia baru: `SESSION_SECRET`, `OAUTH_*`, `SYNC_API_TOKEN`, `BRIDGE_URL`/`BRIDGE_SECRET` proyek jembatan staging untuk `dev`): buat pengguna `deploy` (grup docker, kunci khusus dengan `command="/opt/qc/deploy.sh"`), direktori `/opt/qc/{dev,exec}`, blok nginx per subdomain (`real_ip` Cloudflare, `client_max_body_size` sesuai batas berkas), `nginx -t` sebelum `reload`, tanpa menyentuh blok lain; jalankan `qc-app` di lingkungan `dev`; `deploy.sh` (`pull`, `up -d`, tunggu sehat, uji `/api/ping`, kembali ke tag sebelumnya bila gagal). Verifikasi: `curl https://<dev-subdomain>/api/ping` lewat Cloudflare.

### Task 28: `deploy-server.yml` dan gerbang
**Files:** Create: `.github/workflows/deploy-server.yml`; Modify: `.github/workflows/test.yml` (service container `mariadb:11.8`, `QC_TEST_DB_URL`), `docs/ci-cd.md`
- Pola keamanan `deploy-worker.yml` dipakai ulang (`pull_request_target` hanya setelah merge, checkout `merge_commit_sha`, dispatch manual hanya dari `main`/`dev`, antrean serial); sementara sebelum cutover, aturan environment `dev` mengizinkan dispatch dari branch kerja. Langkah: check → build → `docker build` + push GHCR (tag SHA) → SSH `deploy` → uji asap. Tes: dispatch ke `dev` dan lihat `GET /api/ping` hijau; sengaja rusak (image yang gagal sehat) memicu kembali ke tag lama. Hapus `deploy-worker.yml` pada PR cutover (T34), bukan sebelumnya.

### Task 29: Gerbang Fase 4
- Staging (`dev`) berjalan di VPS dengan data contoh; `exec` disiapkan (tanpa DNS publik); pantau memori `docker stats` dan `free -h` (bandingkan dengan batas di Global Constraints); laporkan angka ke pemilik.

---

# FASE 5 — Cadangan ke Drive

### Task 30: Dump malam, potong, unggah, `drive.listFolder`
**Files:** Create: `server/src/modules/backup/{dump,upload,service}.ts` (+ tes), `bridge/src/backup.ts`; Modify: `server/src/jobs/runner.ts` (jadwal 02:00 WIB), `bridge/src/dispatch.ts` (+ `drive.listFolder`), `docs/setup-bridge.md`, `Dockerfile` (`mariadb-client`)
- Dump `mariadb-dump --single-transaction --routines` → gzip → potongan ≤ 700.000 byte (`…sql.gz.part001`) + manifest JSON (daftar bagian, ukuran, SHA-256 per bagian dan total) ke folder Drive; folder masuk `ALLOWED_FOLDER_IDS`. Tes: potongan menyambung kembali identik dengan dump; badan tiap unggahan < 1.048.576 karakter; unggahan gagal → dump lokal tetap ada dan job `failed` dapat diulang; di VPS hanya 3 salinan terakhir.

### Task 31: Pemulihan teruji
**Files:** Create: `scripts/restore-backup.ts` (+ tes)
- Unduh bagian lewat jembatan, verifikasi SHA-256 tiap bagian dan total, gunakan ke skema target; **menolak** bila ada bagian hilang atau tertukar (Review Focus 5). Tes unit memakai jembatan palsu; **uji sekali di staging** (dump `dev` → skema `qc_restore_check` → bandingkan jumlah baris per tabel → hapus skema).

### Task 32: Trigger pembersih dan peringatan di jembatan
**Files:** Modify: `bridge/src/backup.ts` (+ tes `bridge/src/backup.test.ts`), `bridge/appsscript.json` (scope `script.send_mail`), `docs/setup-bridge.md`, `docs/setup-google.md`
- `cleanupBackups_` (publik, khusus pemilik, pola `cleanupQrPdfs`): sisakan 7 harian + 4 mingguan menurut tanggal di nama berkas, **tidak menghapus bila hasilnya < minimum**; `alertStaleBackup_` mengirim `MailApp` ke pemilik bila terbaru > 36 jam; keduanya dipasang sebagai trigger waktu. Tes (platform memori): 30 berkas harian → tersisa 7+4; hanya 3 berkas → tidak ada yang dihapus; terbaru 40 jam → satu email; 10 jam → tidak ada email. Pemilik mengotorisasi ulang jembatan saat deploy (catat di runbook).

---

# FASE 6 — Data, cutover, pemensiunan

### Task 33: Impor Sheets → MariaDB dan gladi staging
**Files:** Modify: `scripts/migrate/{import-sheets,verify-import,schema-map}.ts` (+ tes), `docs/setup-bridge.md` bagian 5; Create: `docs/superpowers/runbooks/2026-11-cutover-vps.md`
- **Aktifkan kembali** `scripts/migrate/*.test.ts` (29 tes; dikecualikan dari skrip `test` root lewat `--path-ignore-patterns` sejak T5 karena memakai SQL SQLite) dan hapus pengecualian itu dari skrip root.
- Keluaran SQL dialek MariaDB; `verify-import` membandingkan jumlah baris + checksum per tabel, rujukan yatim, penghitung `sync_rev` dan `handover:YYYYMMDD`. **Verifikasi dulu** isi dump produksi: hanya modul akses dan QR yang hidup; putuskan bersama pemilik apakah data uji handover/item dibuang. Gladi di staging dengan dump nyata, uji fitur, uji pemulihan cadangan. Runbook: urutan, jendela tulis-beku beberapa jam, jalan mundur (cabut `READ_ONLY`, `gas-legacy`), pemulihan manual tulisan jendela.

### Task 34: PR kecil ke `origin/main` (READ_ONLY) dan PR cutover
**Files (di `origin/main`):** `gas/src/…` bendera `READ_ONLY` dibawa lewat PR kecil sendiri; **PR cutover** dari branch kerja: hapus `.github/workflows/deploy.yml` (GAS) dan `deploy-worker.yml` DALAM PR yang sama dengan penggabungan; tag `gas-legacy` pada `origin/main` sebelum merge.
- Eksekusi atas persetujuan pemilik per langkah (deploy READ_ONLY, dump, impor produksi, verifikasi, DNS, pantau).

### Task 35: Pemensiunan dan dokumentasi akhir
**Files:** Modify/Delete: `gas/` (dihapus setelah masa pantau), `build:gas`/`push`/`deploy` root dan skrip GAS, `web/src/lib/rpc/*` sisa, `CLAUDE.md`, `docs/*`, PRD PWA (Fase 2 "ketahanan server" ditinjau ulang dengan alasan kuota D1 hilang), spek Cloudflare (status final); perbarui memori proyek agen.

### Task 36: Gerbang akhir
- Review menyeluruh independen atas seluruh diff proyek: kesesuaian spek + `security-audit` terfokus permukaan yang disentuh (otorisasi rute REST, validasi input, mass assignment, kebocoran data di `problem+json`, penanganan rahasia `.env`, race pada data sensitif, kepercayaan `CF-Connecting-IP`, izin pengguna `deploy` dan kunci SSH). Audit penuh seluruh codebase hanya bila pemilik memintanya.

---

## Self-review (dijalankan penyusun)

- **Cakupan spek:** §2 keputusan 1–13 → T1/T2/T13 (1–4), T14–T24 (5–6), jembatan di T30–T32 (7, 9, 11), T27–T28 (8, 10), T1/T3/T5 (12), T33–T35 (13). §5 arsitektur → T13/T26/T27; §6 → T3–T13 (+ penyimpangan 1–3); §7 → T14–T24 (+ penyimpangan 4); §8 → T4; §9 → T25; §10 → T30–T32; §11 → T26–T28; §12 → T15–T23; §13 → T27/T28/T34; §14 → T33–T34; §15 → T2/T13/T35; §17 risiko memori → T29, driver → T3, tunnel → T3/T5.
- **Konsistensi tipe:** `Db`/`DbStatement`/`DbResult`/`DbError` (T3) dipakai T4–T13; `createTestEnv`/`testDbUrl` (T3/T5) dipakai T6–T12; `API_ROUTES`/`toRequestParts`/`fromRequestParts` (T14) dipakai T15–T25; `startScheduler` (T11) dipakai T13/T30.
- **Proporsi:** Fase 1 dirinci per langkah karena paling berisiko; Fase 2–6 sengaja garis besar dan **dirinci per langkah sebelum eksekusi fasenya** (pola yang sama dengan rencana-rencana fase di repo ini), agar tidak menjadi transkrip kode yang basi begitu Fase 1 mengubah antarmuka.
- **Risiko yang ditandai untuk pemilik:** lima penyimpangan di atas; target waktu `createTestEnv` ≤ 400 ms lewat tunnel (T5) mungkin meleset dan memerlukan keputusan; nama subdomain, lokasi sertifikat origin, dan token GHCR disediakan pemilik pada T27/T28.
