# Country Lock Bundel — Fase 1 (Server + Editor Admin Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server menjadi sumber tunggal berkas Country Lock (pengaturan, skrip, berkas router, firmware): admin menyunting dengan riwayat revisi gaya git, menerbitkan bundel tak berubah ber-`computerHash`/`routerHash`, dan desktop (fase 2) dapat mengunduhnya lewat manifest publik bertoken.

**Architecture:** Teks disimpan di MariaDB, biner di Google Drive (subfolder, nama berkas = sha256). Setiap Simpan = satu revisi append-only per berkas; Terbitkan = foto revisi terbaru semua berkas menjadi bundel bernomor tak berubah; "mengaktifkan versi lama" = menerbitkan ulang isi bundel lama sebagai bundel baru. Firmware menjadi tabel dinamis (menggantikan `shared/firmware.ts`) dan dijaga atomik terhadap Item. Fase ini TIDAK menyentuh keadaan router (form/hash REST RouterOS ditambahkan fase 5 lewat kenaikan `schema`/`minApp`).

**Tech Stack:** Bun + Hono + MariaDB (mysql2 lewat adaptor `Db`), kontrak `shared/` murni, React + TanStack (web), vitest (web/shared), `bun:test` (server/countrylock); editor kode lazy (Monaco bila lolos spike, selain itu CodeMirror 6 + `@codemirror/merge`).

**Spec:** `docs/superpowers/specs/2026-11-28-country-lock-sync-bundel-design.md` (juga `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` dan `2026-11-06-countrylock-legacy-behavior.md` untuk perilaku skrip lama).

## Global Constraints

- `shared/` murni: tanpa `node:*`, `crypto`, DOM, `fetch`; sha256 dihitung di server (dan di web/desktop bila perlu), `shared/` hanya membentuk string kanonik.
- ID baris = `newId()` (`server/src/core/id.ts`), ULID huruf kecil; `crypto.randomUUID()` hanya untuk nilai tak tertebak.
- Migrasi expand-only, nomor berikut `0046` (`server/migrations/0046_country_lock_bundel.sql`), idempoten (`IF NOT EXISTS`), tanpa `SET @var`/`PREPARE`; tanpa `DROP`/`RENAME` (tak perlu `-- qc:contract`).
- Parameter SQL selalu `?` berurutan; kolom `key`/`before`/`after` berbacktick; `SUM`/`COUNT` dibungkus `Number()`.
- Konkurensi: CAS di `batch()` (`core/cas.ts`: `CAS_FAIL_SQL`, `runCas`, `staleError`) atau `SELECT ... FOR UPDATE`; jangan baca-lalu-tulis tanpa salah satunya. Nomor berurutan lewat penghitung `counters` CAS.
- Setiap rute baru: id di `ApiContract` (`shared/contract.ts`) + `API_ROUTES` (`shared/api.ts`) + `server/src/routes.ts` (`ALL_API_IDS`, `realRoutes()`) + `shared/api-versions.ts` (kelompok `cl*`) + contoh di `shared/api.test.ts` + entri di `server/src/http/body.test.ts` bila JSON/biner + `bun run api:snapshot`.
- Batas JSON REST 2 MB; potongan unggah biner ≤ 4 MiB (`CL_CHUNK_BYTES`) agar di bawah rute biner terbesar yang dikunci `body.test.ts`.
- Rute publik desktop: 404 seragam, `Cache-Control: no-store` (kecuali berkas bersha256 yang boleh `immutable`), batas laju kegagalan per IP lewat `rate_limits`, token `DESKTOP_CATALOG_TOKEN` (≥ 32 karakter; kosong/pendek = 404), tak pernah mencatat token.
- Kredensial router TIDAK disembunyikan di UI/DTO admin (polos), tetapi TIDAK PERNAH masuk log/audit/galat.
- Web: `ListPage`/`ViewPage`/`FormPage`; field relasi `LinkField`; tanpa `<select>` HTML dan tanpa `<input type="file">` baru (pakai `FilePicker`); warna token semantik; teks UI santai (serapan asing boleh).
- Web `components/**` tidak mengimpor `@/modules/**`; kode admin di `web/src/modules/countrylock-admin/` (BUKAN `countrylock/`, yang milik halaman desktop).
- Perubahan `shared/` wajib membawa fragmen `desktop/changelog.d/<yyyymmdd>-<slug>.md` dan perubahan server `server/changelog.d/...`: satu butir per baris `tipe(area): ringkasan` ≤ 200 karakter.
- Wajib hijau sebelum commit: `bun run typecheck`, `bun run lint`, tes area terkait. Tes server butuh `bun run db:tunnel` hidup; jalankan terarah (`bun run --cwd server test <path>`), bukan penuh.
- Keputusan di luar spek 2026-11-06 dicatat ke spek itu (Task 12).

## Review Focus

- Simpan berkas bersamaan oleh dua admin pada revisi dasar yang sama: yang kedua `412`/`CONFLICT` (bukan menimpa diam-diam) — dites di Task 4.
- Dua `publish` serentak: nomor bundel unik berurutan, tak ada nomor ganda atau bundel setengah jadi — Task 7.
- Hapus firmware yang dipakai item hidup bersamaan dengan item menyimpan firmware itu: tepat satu menang, tak ada item menunjuk firmware terhapus — Task 6.
- Nama jalur berbeda hanya huruf besar/kecil, `..`, `\`, jalur absolut, atau karakter kontrol: ditolak — Task 4.
- Unggah biner: potongan di luar urutan, ukuran/sha256 tak cocok, sesi basi, dan unggah ulang isi yang sama (idempoten) — Task 5.
- Unduhan publik: sha256 tak dirujuk bundel terbit, token salah/kosong, `Range` tak sah — semua 404/416 seragam tanpa bocor keberadaan — Task 9.
- Impor `config.QC` dengan `)` nyasar/skrip hilang/firmware tak dikenal: laporan jelas, tak setengah tersimpan — Task 8.
- Berkas teks berisi `{placeholder}` tak dikenal atau `/temp/...` yang tak ada: `validateDraft` melaporkan, publish ditolak — Task 2 dan 7.

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/countrylock-bundle.ts` | Konstanta batas, tipe manifest/pengaturan, `extractTempRefs`, `extractPlaceholders`, `countryLockBrandOf`, `parseSettingsFile`, `validateDraft`, `canonicalHashInput`, validator nama jalur |
| `shared/countrylock-bundle.test.ts` | Tes murni modul di atas |
| `countrylock/src/placeholder-parity.test.ts` | Menjaga `PLACEHOLDER_NAMES` (shared) = `PLACEHOLDERS` (`script-template.ts`) |
| `server/migrations/0046_country_lock_bundel.sql` | Tabel `cl_files`, `cl_revisions`, `cl_blobs`, `cl_uploads`, `cl_upload_chunks`, `cl_firmwares`, `cl_bundles`, `cl_bundle_files` |
| `server/src/modules/countrylock/` | `repo.ts`, `files-service.ts`, `upload-service.ts`, `firmware-service.ts`, `bundle-service.ts`, `import-service.ts`, `seed.ts`, `audit.ts`, `validate.ts`, `routes.ts`, `public-routes.ts`, `blob-store.ts`, `sweep.ts` |
| `server/src/modules/desktop/token-guard.ts` | Penjaga token bersama (diekstrak dari `desktop/routes.ts`) |
| `web/src/modules/countrylock-admin/` | `queries.ts`, `components/` (halaman berkas, editor, riwayat/diff, pengaturan, firmware, bundel, impor), `lib/` (`parse-legacy-config.ts` dll.) |

---

### Task 1: Level izin `countrylock` diperluas

**Files:**
- Modify: `shared/assignments.ts` (`MODULE_LEVELS`, `MODULE_LEVEL_HINTS`, entri `countrylock` di `SHARED_MODULES` tetap)
- Modify: tes izin yang menegaskan `countrylock` hanya `none/view` (cari: `Grep "countrylock" shared server web --glob "*.test.*"`)
- Modify: `web/src/modules/access/` bila ada teks level per modul (verifikasi dengan grep `MODULE_LEVEL_HINTS`)

**Interfaces:**
- Produces: level `countrylock` ∈ `none|view|edit|manage`. `view` = memakai Country Lock desktop; `edit` = menyunting draf berkas/pengaturan/firmware/impor; `manage` = menerbitkan/mengaktifkan ulang bundel dan menghapus firmware. Peran lama (`view`) tetap sah tanpa migrasi data.

- [ ] **Step 1: Tes gagal** — di tes izin `shared`, tambahkan `it('countrylock mengenal level none/view/edit/manage', ...)` yang menegaskan `levelsOf('countrylock')` sama dengan `['none','view','edit','manage']` (nama fungsi: ikuti yang dipakai tes sekarang) dan tes yang ada untuk `view` tetap lolos.
- [ ] **Step 2: Jalankan** `bun run --cwd shared test` → gagal pada tes baru.
- [ ] **Step 3: Ubah** `MODULE_LEVELS.countrylock` dan petunjuk levelnya (teks: view "Memakai Country Lock", edit "Menyunting draf bundel", manage "Menerbitkan bundel & kelola firmware").
- [ ] **Step 4: Jalankan** `bun run --cwd shared test`, `bun run --cwd web test src/modules/access` (atau path tes izin yang ditemukan), `bun run typecheck` → lolos.
- [ ] **Step 5: Commit** `feat(access): perluas level izin countrylock jadi none/view/edit/manage`.

---

### Task 2: Kontrak murni bundel (`shared/countrylock-bundle.ts`)

**Files:**
- Create: `shared/countrylock-bundle.ts`, `shared/countrylock-bundle.test.ts`
- Create: `countrylock/src/placeholder-parity.test.ts`

**Interfaces:**
- Produces (semua diekspor):
  - Konstanta: `CL_TEXT_MAX_BYTES = 200 * 1024`, `CL_BINARY_MAX_BYTES = 64 * 1024 * 1024`, `CL_CHUNK_BYTES = 4 * 1024 * 1024`, `CL_PATH_MAX = 200`, `CL_FILES_MAX = 400`, `PLACEHOLDER_NAMES: readonly string[]` (`ipTarget, usernameTarget, passwordTarget, ipServer, usernameServer, passwordServer, sshKey`), `SETTINGS_PATH = 'settings.json'`.
  - `type ClFileRole = 'settings' | 'script' | 'router'` (router = berkas yang diunggah ke `/temp/` router; computer-only = settings+script).
  - `validateClPath(path: string): string | null` (pesan galat atau `null`; menolak kosong, > `CL_PATH_MAX`, diawali `/`, memuat `..`, `\`, karakter kontrol/bidi, segmen kosong).
  - `pathKey(path: string): string` (huruf kecil, untuk deteksi bentrok huruf besar/kecil).
  - `extractTempRefs(text: string): string[]` (nama berkas dari pola `/temp/<nama>` dan `src-path=/temp/<nama>` tanpa duplikat, urut kemunculan).
  - `extractPlaceholders(text: string): string[]` (isi `{nama}` unik).
  - `countryLockBrandOf(name: string): 'mikrotik' | 'ubiquiti' | null` (dari awalan nama firmware/kode; menggantikan `firmwareBrandOf`).
  - `parseSettingsFile(text: string): { ok: true; settings: ClSettings } | { ok: false; error: string }` dengan `ClSettings` skema 1: `{ schema: 1; router: { ip, username, password, interfaceComp, interfaceBridge }; network: { computerIp?, ... }; brands: Record<'mikrotik'|'ubiquiti', { folder: string; modes: { single: ClMode; multi: ClMode } }> }` (field persis: ikuti `countrylock/src/config.ts` `ServerConfig`/`BrandConfig`/`ModeConfig`; field jaringan komputer/mode lanjutan menyusul fase 3/5 lewat kenaikan `schema`).
  - `type ClDraftFile = { path; role: ClFileRole; sha256: string; size: number; text?: string }` dan `type ClFirmwareRef = { brand; code; scriptPath: string | null; parallel: boolean }`.
  - `type ClIssue = { severity: 'error' | 'warning'; code: string; path?: string; message: string }`; `validateDraft(files: ClDraftFile[], firmwares: ClFirmwareRef[]): ClIssue[]` dengan kode error `SETTINGS_MISSING`, `SETTINGS_INVALID`, `SCRIPT_MISSING` (firmware menunjuk skrip yang tak ada), `TEMP_REF_MISSING`, `PLACEHOLDER_UNKNOWN`, `DUPLICATE_PATH_CASE`; peringatan `ORPHAN_ROUTER_FILE` (berkas router tak dirujuk skrip mana pun), `ARP_FLUSH_GLOBAL` (skrip memuat `/ip arp remove [find]` tanpa `address=`), `ADDRESS_CHANGED` (tidak dipakai fase 1; jangan diimplementasi).
  - `canonicalHashInput(entries: { path: string; sha256: string }[], extra?: string): string` (urut path menurut `pathKey`, baris `path\0sha256\n`, `extra` ditambahkan di akhir) — sha256-nya dihitung pemanggil.
  - `type ClManifest = { schema: 1; minApp: string; number: number; computerHash: string; routerHash: string; files: { path; role; sha256; size }[]; firmwares: { brand; code; label; scriptPath: string | null; parallel: boolean }[] }`.

- [ ] **Step 1: Tulis tes** di `shared/countrylock-bundle.test.ts` (vitest): `validateClPath` menolak `''`, `'/a'`, `'a/../b'`, `'a\\b'`, `'a//b'`, `'a\u0000b'` dan menerima `'mikrotik/IDN.rsc'`; `extractTempRefs('src-path=/temp/customblock-x.npk\n/temp/a.bin /temp/a.bin')` = `['customblock-x.npk','a.bin']`; `extractPlaceholders('{ipTarget} {nope} {ipTarget}')` = `['ipTarget','nope']`; `validateDraft` untuk: tanpa `settings.json` → error `SETTINGS_MISSING`; skrip dengan `{nope}` → `PLACEHOLDER_UNKNOWN`; skrip merujuk `/temp/x.npk` yang tak ada → `TEMP_REF_MISSING`; dua path beda huruf besar → `DUPLICATE_PATH_CASE`; berkas router tak dirujuk → warning `ORPHAN_ROUTER_FILE`; `/ip arp remove [find]` → warning `ARP_FLUSH_GLOBAL`, sedangkan `[find address={ipTarget}]` tidak; draf sehat → `[]`. `canonicalHashInput` sama untuk urutan masukan berbeda dan berbeda bila satu sha256 berbeda. `parseSettingsFile` menolak JSON rusak, `schema` ≠ 1, dan menerima contoh sah.
- [ ] **Step 2: Tes paritas** di `countrylock/src/placeholder-parity.test.ts` (`bun:test`): `expect([...PLACEHOLDER_NAMES].sort()).toEqual([...PLACEHOLDERS].sort())` dengan impor relatif dari `../../shared/countrylock-bundle` dan `./script-template`.
- [ ] **Step 3: Jalankan** `bun run --cwd shared test` dan `bun run --cwd countrylock test` → gagal.
- [ ] **Step 4: Implementasi** semua fungsi/tipe di atas. `countryLockBrandOf` meniru `firmwareBrandOf` lama (baca `shared/firmware.ts` sebelum menghapusnya di Task 6 dan salin aturannya).
- [ ] **Step 5: Jalankan** tes yang sama + `bun run typecheck` → lolos.
- [ ] **Step 6: Fragmen changelog** `desktop/changelog.d/20261128-country-lock-bundel-kontrak.md`: `feat(shared): kontrak bundel Country Lock (hash, validasi draf, manifest)`.
- [ ] **Step 7: Commit** `feat(countrylock): kontrak murni bundel dan validasi draf`.

---

### Task 3: Migrasi `0046`, repo dasar, dan seed firmware

**Files:**
- Create: `server/migrations/0046_country_lock_bundel.sql`
- Create: `server/src/modules/countrylock/repo.ts`, `server/src/modules/countrylock/seed.ts`, `server/src/modules/countrylock/repo.test.ts`
- Modify: `server/src/server.ts` (panggil `seedCountryLockFirmwares(env)` setelah migrasi, di samping `ensureSystemStickerTypes`; galat dicatat, tak menggagalkan start)
- Modify: `shared/audit.ts` bila ada daftar target/aksi yang menuntut pendaftaran (lihat Task 4)
- Modify: `server/scripts/seed-dev.ts` (`RESET_TABLES`: masukkan tabel `cl_*` data-bawaan-pengguna yang harus dikosongkan; tes seed menegakkan setiap tabel terklasifikasi — jalankan tes seed) dan `server/src/modules/backup`/ekspor bila ada daftar tabel yang diverifikasi tes (cari dengan grep `stok_ready`/`RESET_TABLES` dari migrasi 0043 terakhir sebagai contoh)

**Interfaces:**
- Produces tabel (semua `utf8mb4_nopad_bin` mengikuti baseline; `id CHAR(26)`):
  - `cl_files(id, path VARCHAR(200), path_key VARCHAR(200), role ENUM('settings','script','router'), kind ENUM('text','binary'), head_rev INT, removed_at VARCHAR(30) NOT NULL DEFAULT '', created_at, updated_at)` + UNIQUE `cl_files_path_live (path_key, removed_at)`.
  - `cl_revisions(id, file_id, seq INT, sha256 CHAR(64), size INT, text_body MEDIUMTEXT NULL, message VARCHAR(200), author VARCHAR(254), created_at)` + UNIQUE `(file_id, seq)`; append-only (tanpa UPDATE/DELETE di kode).
  - `cl_blobs(sha256 CHAR(64) PK, size BIGINT, drive_file_id VARCHAR(100), md5 CHAR(32), created_at)`.
  - `cl_uploads(id, file_path, size BIGINT, sha256 CHAR(64), chunk_count INT, state ENUM('open','done','aborted'), owner VARCHAR(254), created_at, updated_at)` dan `cl_upload_chunks(upload_id, idx INT, data MEDIUMBLOB, PRIMARY KEY(upload_id, idx))`.
  - `cl_firmwares(id, brand ENUM('mikrotik','ubiquiti'), code VARCHAR(40), label VARCHAR(120), script_path VARCHAR(200) NULL, parallel TINYINT(1) DEFAULT 0, sort INT, removed_at VARCHAR(30) NOT NULL DEFAULT '', created_at, updated_at)` + UNIQUE `cl_firmwares_code_live (brand, code, removed_at)`.
  - `cl_bundles(id, number INT UNIQUE, computer_hash CHAR(64), router_hash CHAR(64), min_app VARCHAR(20), manifest_json MEDIUMTEXT, note VARCHAR(200), published_by VARCHAR(254), source_number INT NULL, created_at)` dan `cl_bundle_files(bundle_id, path, role, sha256, size, PRIMARY KEY(bundle_id, path))`.
- Produces di `repo.ts`: fungsi pembaca/penulis statement murni (pola `postel/repo.ts`), mis. `getFileByPath`, `listFiles`, `insertRevisionStmts`, `latestBundle`, `firmwareRows`. Indeks unik baru didaftarkan di peta konflik modul (`mapDuplicateError`) dan `RETRYABLE_UNIQUE_KEYS` bila dipakai CAS-retry (nomor bundel).
- Produces `seedCountryLockFirmwares(env: Env): Promise<{ inserted: number }>` — memasukkan 17 firmware awal dari daftar `FIRMWARE_BY_BRAND` (`shared/firmware.ts`; salin literalnya ke seed sebelum berkas itu dihapus di Task 6) bila `cl_firmwares` untuk `(brand, code)` belum ada (idempoten, aman serentak lewat `INSERT ... ON DUPLICATE KEY UPDATE id = id`), `parallel` awal: false semua kecuali yang diputuskan nanti (tidak ditebak).

- [ ] **Step 1: Tes** `repo.test.ts` (`createTestEnv`): setelah `seedCountryLockFirmwares` dua kali, `cl_firmwares` berisi tepat 17 baris hidup (tidak ganda); unik `(brand, code)` hidup menolak duplikat dan mengizinkan kode yang sama setelah `removed_at` terisi; `cl_files_path_live` menolak dua path hidup beda huruf besar/kecil (karena `path_key`).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/countrylock/repo.test.ts` → gagal.
- [ ] **Step 3: Tulis migrasi** (idempoten `CREATE TABLE IF NOT EXISTS`) dan `repo.ts`, `seed.ts`; sambungkan seed di `server.ts`.
- [ ] **Step 4: Jalankan** tes di atas, plus tes migrasi/hash templat bila ada (`bun run --cwd server test src/core/migrate`), `bun run typecheck`.
- [ ] **Step 5: Fragmen** `server/changelog.d/20261128-country-lock-bundel-skema.md`: `feat(countrylock): skema bundel Country Lock dan seed firmware awal`.
- [ ] **Step 6: Commit** `feat(countrylock): migrasi 0046 dan repo dasar bundel`.

---

### Task 4: Layanan berkas teks + riwayat revisi + rute

**Files:**
- Create: `server/src/modules/countrylock/files-service.ts`, `validate.ts`, `audit.ts`, `routes.ts`, `files-service.test.ts`, `rest.test.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `shared/api-versions.ts`, `shared/api.test.ts`, `server/src/routes.ts`, `server/src/http/body.test.ts`
- Modify: `shared/audit.ts` (`AUDIT_NON_ENTITY_ACTIONS`/daftar aksi bila tes `audit-target.test.ts` menuntut; label di `web/src/modules/access/lib/audit-actions.ts`)

**Interfaces:**
- DTO di `shared/contract.ts`: `ClFileDto = { id; path; role: ClFileRole; kind: 'text'|'binary'; headRev: number; size: number; sha256: string; updatedAt: string; updatedBy: string; removed: boolean }`, `ClRevisionDto = { seq; sha256; size; message; author; createdAt }`, `ClFileDetailDto = ClFileDto & { text: string | null }`.
- Rute (kelompok `clFiles`; izin: baca = `countrylock: edit`; tulis = `edit`; hapus = `edit`): `clFiles.list` GET `/countrylock/files` → `ClFileDto[]`; `clFiles.get` GET `/countrylock/files/{id}` (etag = `updatedAt`) → `ClFileDetailDto`; `clFiles.save` PUT `/countrylock/files` input `{ path, role, text, message?, baseSeq? }` dengan `If-Match` berisi `updatedAt` file (berkas baru: tanpa `If-Match`), `baseSeq` = seq yang dilihat editor (wajib untuk berkas yang ada); `clFiles.remove` DELETE `/countrylock/files/{id}` (menandai `removed_at`; revisi tetap); `clFiles.history` GET `/countrylock/files/{id}/history` → `ClRevisionDto[]` (terbaru dulu, maks. 200); `clFiles.revision` GET `/countrylock/files/{id}/revisions/{seq}` → `{ text: string | null; ...ClRevisionDto }`; `clFiles.revert` POST `/countrylock/files/{id}/revert` input `{ seq, message? }` → membuat revisi BARU berisi isi `seq` (tidak menulis ulang riwayat).
- Aturan: simpan berisi teks sama dengan revisi terbaru = no-op (tanpa revisi baru, tanpa audit); ukuran teks > `CL_TEXT_MAX_BYTES` = `VALIDATION`; path via `validateClPath`; bentrok `path_key` hidup = `CONFLICT` generik; `baseSeq` ≠ `head_rev` = `staleError` (412). Seq berurutan lewat penghitung `counters` kunci `clrev:<fileId>` (CAS) dalam `batch()` yang sama dengan pembaruan `head_rev`. Role `settings` hanya untuk path `settings.json` dan isinya harus lolos `parseSettingsFile` (jika tidak: `VALIDATION` dengan pesan parser). Audit `countrylock.file_save|file_remove|file_revert`, `targetId` = id berkas.

- [ ] **Step 1: Tes layanan** (`files-service.test.ts`, `createTestEnv`): simpan pertama → `headRev` 1; simpan teks beda → 2 dan riwayat memuat dua entri berurut; simpan teks sama → tetap 2; dua `save` serentak (`Promise.all`) dari `baseSeq` sama → tepat satu sukses, satu `CONFLICT`/stale; path `'A.rsc'` lalu `'a.rsc'` → `CONFLICT`; path jahat → `VALIDATION`; `settings.json` rusak → `VALIDATION`; `remove` lalu simpan path sama → membuat berkas baru (id beda) tanpa menghapus revisi lama; `revert` ke seq 1 → revisi baru dengan sha256 sama seperti seq 1.
- [ ] **Step 2: Tes REST** (`rest.test.ts`, `restClient`): pemegang `countrylock: view` ditolak `FORBIDDEN` pada semua rute `clFiles.*`; `edit` boleh; `If-Match` basi → 412.
- [ ] **Step 3: Jalankan** kedua berkas tes → gagal.
- [ ] **Step 4: Implementasi** DTO/rute/validator/layanan; daftarkan di `server/src/routes.ts`; perbarui `shared/api-versions.ts` (kelompok `clFiles`: `latest: 1`), contoh di `shared/api.test.ts`, entri `body.test.ts` (JSON `clFiles.save` terbesar = teks maks + overhead).
- [ ] **Step 5: Jalankan** kedua tes, `bun run --cwd shared test`, `bun run api:snapshot`, tes `audit-target` terkait, `bun run typecheck`.
- [ ] **Step 6: Fragmen** server + desktop; **commit** `feat(countrylock): berkas teks dengan riwayat revisi dan rute admin`.

---

### Task 5: Unggah biner bertahap ke Drive

**Files:**
- Create: `server/src/modules/countrylock/blob-store.ts`, `upload-service.ts`, `sweep.ts`, `upload-service.test.ts`
- Modify: `server/src/modules/countrylock/routes.ts`, `repo.ts`
- Modify: `server/src/core/bridge-client.ts` + `server/src/core/google/client.ts` + `drive.ts` (Range: `downloadFile(fileId, folderId, range?: { start: number; end: number })`), `server/test-support/fake-bridge.ts`, `fake-google.ts`
- Modify: `shared/contract.ts`/`api.ts`/`api-versions.ts`/`api.test.ts`/`body.test.ts`/`server/src/routes.ts`
- Modify: `server/src/jobs/runner.ts` (`schedulerTick` memanggil `sweepCountryLockUploads`)

**Interfaces:**
- `blob-store.ts`: `ensureBlobFolder(env): Promise<string>` memakai `ensureNamedFolder(env, 'COUNTRYLOCK_FOLDER_ID', ...)`/`folderIdOf` (tanpa variabel `.env` baru; ikuti pola `backup`/`qrcode` untuk nama folder dan daftar folder terjaga di `core/google/drive.ts`); `storeBlob(env, { sha256, bytes: Uint8Array }): Promise<void>` mengunggah dengan nama berkas = sha256, idempoten + verifikasi MD5 (model `backup/upload.ts` `uploadVerified`), lalu `INSERT cl_blobs ... ON DUPLICATE KEY UPDATE sha256 = sha256`; `openBlob(env, sha256, range?): Promise<{ stream: ReadableStream<Uint8Array>; size: number }>`.
- Rute (kelompok `clUploads`, izin `countrylock: edit`): `clUploads.start` POST `/countrylock/uploads` input `{ path, role: 'router', size, sha256 }` → `{ uploadId, chunkBytes }` (menolak `size > CL_BINARY_MAX_BYTES`, `role` selain `router`, atau sha256 bukan 64 heksa huruf kecil); `clUploads.chunk` PUT `/countrylock/uploads/{id}/chunks/{idx}` (`binary: 'request'`, `maxBytes = CL_CHUNK_BYTES + 1024`) → `{ received: number }`; `clUploads.finish` POST `/countrylock/uploads/{id}/finish` → `ClFileDto` (merakit potongan berurut, memeriksa jumlah/ukuran/sha256, `storeBlob`, membuat berkas biner + revisi baru; isi sama dengan revisi terbaru = no-op).
- Aturan: potongan harus tepat urut mulai 0; idx duplikat dengan isi sama = idempoten, isi beda = `CONFLICT`; ukuran tak cocok/sha256 tak cocok = `VALIDATION` dan sesi tetap terbuka untuk diulang; hanya pemilik sesi (`owner`) yang boleh `chunk`/`finish` (lain = `NOT_FOUND`); `sweepCountryLockUploads` membuang sesi `open` > 24 jam beserta potongannya. Berkas biner yang sudah ada (sha256 sama) tidak diunggah ulang ke Drive.
- Web: keputusan di Task 10 (adaptor bergaya `FileSource` memakai `File.slice(CL_CHUNK_BYTES)`).

- [ ] **Step 1: Tes** (`upload-service.test.ts`, `createTestEnv` dengan `fake-bridge`): unggah 3 potongan (ukuran kecil dengan `CL_CHUNK_BYTES` disuntik/diperkecil lewat parameter fungsi) lalu `finish` → berkas biner `headRev` 1 dan `openBlob` mengembalikan byte persis sama; potongan idx 2 sebelum 1 → `CONFLICT`; sha256 salah di `finish` → `VALIDATION` dan sesi masih bisa melanjutkan; unggah ulang isi sama → tak ada unggahan Drive kedua (hitung panggilan di `fake-bridge`); pemilik lain → `NOT_FOUND`; `openBlob` dengan `range {start:1,end:2}` mengembalikan 2 byte.
- [ ] **Step 2: Tes REST** `clUploads.*`: `view` ditolak; `edit` boleh; potongan > batas → 413.
- [ ] **Step 3: Jalankan** → gagal.
- [ ] **Step 4: Implementasi** Range di klien Google (`Range: bytes=a-b` pada `files.get?alt=media`, respons 206) dan `fake-*`, blob-store, layanan, rute, penyapu; tes `core/google` yang ada tetap hijau.
- [ ] **Step 5: Jalankan** tes baru + `bun run --cwd server test src/core/google` + `src/http/body.test.ts` + `bun run api:snapshot` + typecheck.
- [ ] **Step 6: Fragmen; commit** `feat(countrylock): unggah biner bertahap ke Drive dan dukungan Range`.

---

### Task 6: Firmware dinamis dan penjaga Item

**Files:**
- Create: `server/src/modules/countrylock/firmware-service.ts`, `firmware-service.test.ts`
- Modify: `server/src/modules/countrylock/routes.ts`, `shared/contract.ts`/`api.ts`/`api-versions.ts`/`api.test.ts`/`server/src/routes.ts`
- Modify: `server/src/modules/item/service.ts` (`resolveItemFirmware` ~baris 970 dalam `planItemWrite`), `item/validate.ts`, `server/src/modules/desktop/catalog.ts`/`shared/desktop-catalog.ts` (cari semua pemakai `shared/firmware.ts` dengan `Grep "firmware" --glob "!*.md"`)
- Modify (web): `web/src/modules/item/components/item-form.tsx`, `item-detail-view.tsx`, `web/src/modules/countrylock/lib/type-firmware.ts` dan tes terkait
- Delete: `shared/firmware.ts`, `shared/firmware.test.ts`, `countrylock/src/firmware-parity.test.ts` (pindahkan `FIRMWARE_CODE_MAX` ke `shared/countrylock-bundle.ts`)

**Interfaces:**
- DTO: `ClFirmwareDto = { id; brand; code; label; scriptPath: string | null; parallel: boolean; sort: number; inUseCount: number; updatedAt: string }`.
- Rute (`clFirmwares`): `list` GET `/countrylock/firmwares` (`edit`); `options` GET `/countrylock/firmware-options?brand=` → `{ code; label }[]` **tanpa izin modul** (cukup login; dipakai form Item); `save` PUT `/countrylock/firmwares` (`edit`; input `{ id?, brand, code, label, scriptPath, parallel, sort, expectedUpdatedAt? }`; kode unik hidup per brand; `scriptPath` harus berkas hidup role `script` bila diisi; mengganti `code` firmware yang dipakai item = `CONFLICT`); `remove` DELETE `/countrylock/firmwares/{id}` (`manage`; ditolak `CONFLICT` "Firmware masih dipakai item" bila ada item hidup memakainya).
- Penjaga atomik: `firmwareKeyGuardStmt` (pola `brandKeyGuardStmt`): `items.save` yang menyetel `firmware` mengunci baris `cl_firmwares` (`SELECT ... FOR UPDATE` di `transaction`/CAS yang sama dengan penulisan) dan menolak bila firmware tak ada/terhapus/beda brand; `firmwares.remove` mengunci baris yang sama sebelum menghitung item pemakai (item hidup dengan `firmware = code` dan merk brand itu) — sehingga satu-satunya pemenang. `resolveItemFirmware` membaca `cl_firmwares` (bukan daftar tetap), tetap menolak firmware pada item non-Country-lock.

- [ ] **Step 1: Tes** (`firmware-service.test.ts`): `options` hanya firmware hidup brand itu, urut `sort`; `save` duplikat kode hidup → `CONFLICT`; `remove` firmware dipakai item hidup → `CONFLICT`; `remove` firmware tak dipakai → sukses lalu tak muncul di `options`; **konkurensi** `Promise.all([items.save(firmware X), firmwares.remove(X)])` → tepat satu sukses dan keadaan akhir konsisten (item menunjuk firmware hidup, atau firmware terhapus dan item tak memakainya); `items.save` dengan firmware dari brand lain/terhapus → `VALIDATION`.
- [ ] **Step 2: Perbarui tes yang ada** yang bergantung `shared/firmware.ts` (item service/validate/catalog/web) ke sumber baru; hapus tiga berkas lama beserta impor.
- [ ] **Step 3: Jalankan** `bun run --cwd server test src/modules/countrylock src/modules/item src/modules/desktop`, `bun run --cwd web test src/modules/item src/modules/countrylock`, `bun run --cwd countrylock test` → gagal lalu perbaiki.
- [ ] **Step 4: Implementasi**; web form Item memuat opsi lewat `clFirmwares.options` (`queries.ts` item: `queryOptions`), `LinkField`/`Select` enum dinamis mengikuti aturan (daftar tetap/dinamis dari server = tetap `Select`).
- [ ] **Step 5: Jalankan** seluruh tes terarah di atas + `bun run api:snapshot` + `bun run typecheck` + `bun run lint`.
- [ ] **Step 6: Fragmen** (server + desktop, karena `shared/` dan katalog berubah); **commit** `feat(countrylock): firmware dinamis dan penjaga atomik terhadap Item`.

---

### Task 7: Validasi draf, terbitkan bundel, aktifkan ulang

**Files:**
- Create: `server/src/modules/countrylock/bundle-service.ts`, `bundle-service.test.ts`
- Modify: `routes.ts`, `repo.ts`, kontrak + penjaga rute seperti Task 4

**Interfaces:**
- DTO: `ClDraftDto = { files: ClFileDto[]; firmwares: ClFirmwareDto[]; issues: ClIssue[]; computerHash: string; routerHash: string; changed: boolean }` (`changed` = berbeda dari bundel terbit terakhir), `ClBundleDto = { number; computerHash; routerHash; minApp; note; publishedBy; createdAt; sourceNumber: number | null; fileCount: number }`, `ClBundleDetailDto = ClBundleDto & { files: {path;role;sha256;size}[]; firmwares: ... }`.
- Rute (`clBundles`): `draft` GET `/countrylock/draft` (`edit`) → `ClDraftDto`; `publish` POST `/countrylock/bundles` (`manage`, input `{ note }`) → `ClBundleDto` (menolak `CONFLICT` bila ada `issues` ber-severity error atau `changed=false`); `list` GET (`edit`); `get` GET `/countrylock/bundles/{number}` (`edit`); `reactivate` POST `/countrylock/bundles/{number}/reactivate` (`manage`, input `{ note }`) → bundel baru dengan `sourceNumber` = nomor asal dan isi file persis bundel lama (revisi file ber-sha256 itu tak perlu ada lagi di draf; manifest disusun dari `cl_bundle_files` lama).
- Aturan hash: `computerHash` = sha256 hex dari `canonicalHashInput(semua file hidup role settings|script|router)`; `routerHash` = sha256 hex dari `canonicalHashInput(file role router, extra = sha256(JSON kredensial router dari settings))` — kredensial diambil dari `settings.json` yang diparse; `minApp` = `'0.0.0'` fase 1 (dinaikkan hanya bila `schema` manifest naik). Nomor bundel lewat penghitung `counters` kunci `clbundle` (CAS) dan UNIQUE `cl_bundles.number`; seluruh penulisan (bundle + bundle_files + audit) dalam satu `batch()`. `publish` dua kali serentak → dua nomor berurutan, atau yang kedua `CONFLICT` karena `changed=false` — tidak pernah nomor ganda. Audit `countrylock.publish|reactivate`.

- [ ] **Step 1: Tes** (`bundle-service.test.ts`): draf kosong → issue `SETTINGS_MISSING`; setelah menyimpan `settings.json` sah + skrip + firmware menunjuknya, `publish` → nomor 1; ubah satu skrip, `draft.changed` true, `publish` → nomor 2 dan `computerHash` berbeda sedangkan `routerHash` SAMA (skrip bukan berkas router); ubah password router di `settings.json` → `routerHash` berubah; `publish` tanpa perubahan → `CONFLICT`; `reactivate(1)` → nomor 3 dengan `sourceNumber 1` dan `computerHash` sama seperti bundel 1; dua `publish` serentak dari draf yang berubah → nomor unik berurutan (tes `Promise.all`); `publish` saat ada `TEMP_REF_MISSING` → `CONFLICT`; izin `edit` tidak boleh `publish`/`reactivate` (`FORBIDDEN`).
- [ ] **Step 2: Jalankan** → gagal. **Step 3: Implementasi.** **Step 4: Jalankan** tes + api:snapshot + typecheck.
- [ ] **Step 5: Fragmen; commit** `feat(countrylock): terbitkan dan aktifkan ulang bundel dengan computerHash dan routerHash`.

---

### Task 8: Impor sekali pakai dari `config.QC` dan folder skrip lama

**Files:**
- Create: `server/src/modules/countrylock/import-service.ts`, `import-service.test.ts`
- Modify: `routes.ts`, kontrak + penjaga rute

**Interfaces:**
- Input `clImport.run` POST `/countrylock/import` (`edit`): `{ settings: ClSettings; scripts: { path: string; text: string; brand: 'mikrotik'|'ubiquiti' }[]; firmwares: { brand; code; label; scriptPath: string | null }[] }` — **diparse di web** (`parseConfig` dari `countrylock/` + pembaca folder), server tak mengimpor `countrylock/`. Output `{ filesCreated; filesSkipped; firmwaresLinked; issues: ClIssue[] }`.
- Aturan: hanya membuat berkas yang belum ada (path hidup yang sama dengan isi sama dilewati; isi beda = laporan `issues` warning, tidak menimpa); semua dalam satu `batch()` (atau dibatalkan seluruhnya); firmware yang `code`-nya sudah ada hanya mengaitkan `script_path`; kode firmware tak dikenal dilaporkan, tidak dibuat diam-diam. Batas jumlah berkas `CL_FILES_MAX`. Audit `countrylock.import`.

- [ ] **Step 1: Tes**: impor memakai fixture kecil (3 skrip + settings) membuat berkas dan mengaitkan firmware; impor ulang yang sama → `filesCreated 0`, `filesSkipped 3`; skrip bernama bentrok isi berbeda → `issues` warning dan isi lama utuh; masukan melebihi `CL_FILES_MAX` → `VALIDATION`; kegagalan di tengah (path jahat pada entri ke-2) → tak ada berkas tersimpan.
- [ ] **Step 2–4:** gagal → implementasi → lolos (+ api:snapshot, typecheck). **Step 5:** fragmen; commit `feat(countrylock): impor sekali pakai dari config.QC dan skrip lama`.

---

### Task 9: Unduhan publik bertoken (manifest + berkas) dengan Range

**Files:**
- Create: `server/src/modules/desktop/token-guard.ts` (ekstrak `tokenMatches`/`rejectCatalog` privat dari `desktop/routes.ts`), `server/src/modules/countrylock/public-routes.ts`, `public-routes.test.ts`
- Modify: `server/src/modules/desktop/routes.ts` (pakai helper bersama; tes katalog yang ada tetap hijau), `server/src/app.ts` (pasang rute publik di bawah `/api/desktop/countrylock`)

**Interfaces:**
- `GET /api/desktop/countrylock/manifest` → JSON `ClManifest` bundel TERBARU (404 bila belum ada bundel); header `ETag` = `"<number>-<computerHash prefix>"`, `If-None-Match` → 304; `Cache-Control: no-store`.
- `GET /api/desktop/countrylock/files/<sha256>` → isi berkas (teks dari `cl_revisions.text_body` atau biner dari Drive lewat `openBlob`) HANYA bila sha256 dirujuk `cl_bundle_files` bundel mana pun (cukup bundel terakhir + yang masih bisa diaktifkan ulang → aturan: bundel mana pun); `Content-Type: application/octet-stream`, `Accept-Ranges: bytes`, mendukung `Range: bytes=a-b` (206 + `Content-Range`), `Range` tak sah/di luar ukuran = 416; `Cache-Control: public, max-age=31536000, immutable` (nama = hash isi) — hanya untuk jawaban 200/206.
- Penjaga: token `DESKTOP_CATALOG_TOKEN` via header Bearer (sama dengan katalog), perbandingan waktu-konstan; sha256 bukan 64 heksa → 404; kegagalan dibatasi lewat `rate_limits` (`desktop-countrylock:<ip>`, pola katalog); semua penolakan = 404 problem+json seragam (kecuali 416 yang hanya muncul setelah autentikasi dan sha256 sah).

- [ ] **Step 1: Tes** (`public-routes.test.ts`): token benar + bundel terbit → manifest memuat `computerHash`; tanpa/token salah → 404 identik; `If-None-Match` sama → 304; berkas teks dan biner terunduh persis; `Range: bytes=0-1` → 206 2 byte; `Range: bytes=999999-` → 416; sha256 tak dirujuk bundel → 404 (tak bedakan "ada tapi tak dirujuk"); setelah 20 kegagalan dari IP sama, permintaan sah dari IP itu tetap dilayani (pembatas hanya menghitung kegagalan, ikuti perilaku katalog); tes katalog desktop yang ada tetap lolos.
- [ ] **Step 2–4:** gagal → implementasi → lolos (`bun run --cwd server test src/modules/desktop src/modules/countrylock/public-routes.test.ts`, `src/http`), typecheck.
- [ ] **Step 5:** fragmen server; commit `feat(countrylock): manifest dan unduhan berkas publik bertoken dengan Range`.

---

### Task 10: Web admin — spike editor, halaman berkas, riwayat/diff, unggah biner

**Files:**
- Create: `web/src/modules/countrylock-admin/queries.ts`, `lib/upload-chunks.ts`, `components/{files-page,file-editor-page,code-editor,diff-view,history-panel,binary-upload}.tsx`, rute `web/src/routes/_app/countrylock/files/{index,$fileId/index}.tsx`
- Modify: `web/package.json` (dependensi editor), `web/src/routeTree.gen.ts` (hasil generate), `web/src/app/navigation.ts` (butir "Bundel Country Lock" sebagai anak parent `system`, permission `countrylock: edit`), `web/src/app/route-meta.ts`/`staticData.crumb` pada rute baru, tes penjaga terkait (`route-meta-coverage`, `navigation.test`, `module-coverage` → tambahkan `countrylock-admin` ke `MODULES_WITHOUT_GUIDE_YET` bila modulnya terdeteksi)

**Interfaces:**
- Spike (Step 1, wajib pertama): bangun `components/code-editor.tsx` (prop `{ value, onChange, language: 'rsc'|'sh'|'json'|'text', readOnly? }`) dan `diff-view.tsx` (prop `{ original, modified }`) sebagai komponen lazy (`React.lazy`) berpotongan JS sendiri. **Coba Monaco dulu** (`@monaco-editor/react`/`monaco-editor` dengan worker lokal); ukur: (a) potongan JS gzip ≤ 600 KB (`bun run build` + `verify-dist`), (b) berjalan di CSP desktop tanpa `unsafe-eval`/`worker-src` (tulis dalam laporan; uji penuh di desktop menyusul fase 2), (c) tes jsdom jalan dengan mock. Bila salah satu gagal → pakai **CodeMirror 6** (`@codemirror/state/view/language/merge`, `@lezer/*` seperlunya) dan **laporkan deviasi ke pemilik di ringkasan akhir tugas** (jangan memutuskan diam-diam).
- `lib/upload-chunks.ts`: `uploadBinary(file: File, path: string, api: ..., onProgress): Promise<ClFileDto>` — hitung sha256 (`crypto.subtle` dari potongan/stream), `clUploads.start`, kirim potongan `file.slice(i*CL_CHUNK_BYTES, ...)` berurut dengan ulang-coba potongan, `finish`. Pemilihan berkas lewat `FilePicker` (kategori tanpa batasan tipe; jangan `<input type="file">` baru; jika `FilePicker` memaksa image/pdf, perluas prop-nya secara minimal dan sebutkan di ringkasan).
- Halaman: `/countrylock/files` = `ListPage` + `DataTable` (path, role, versi, ukuran, diubah; aksi tambah teks, unggah biner, hapus dengan `ConfirmDeleteDialog`); `/countrylock/files/$fileId` = `ViewPage` bertab "Isi" (editor + Simpan dengan pesan opsional, `baseSeq` dikirim, tangani 412 dengan dialog "Berkas diubah orang lain: muat ulang") dan "Riwayat" (daftar revisi; pilih dua revisi → `DiffView`; tombol "Kembalikan revisi ini" → `clFiles.revert`). Berkas biner: tab "Riwayat" saja (daftar versi tanpa diff, unduh sha256).

- [ ] **Step 1: Spike editor** (lihat atas) → tulis hasil ukur di komentar PR/ringkasan; pilih Monaco atau CodeMirror.
- [ ] **Step 2: Tes web** (vitest + Testing Library, `CodeEditor`/`DiffView` dimock lewat `vi.mock`): daftar berkas menampilkan baris dari `clFiles.list`; menyimpan teks memanggil `clFiles.save` dengan `baseSeq` dan `If-Match` benar; respons 412 memunculkan dialog muat ulang dan TIDAK menimpa teks yang sedang disunting; tab Riwayat memuat daftar dan "Kembalikan" memanggil `clFiles.revert`; `uploadBinary` mengirim potongan berurut dan memanggil `finish` (mock `api`); pengguna `view` tanpa `edit` tidak melihat butir menu.
- [ ] **Step 3: Jalankan** `bun run --cwd web test src/modules/countrylock-admin` → gagal. **Step 4: Implementasi** halaman/rute/nav/crumb.
- [ ] **Step 5: Jalankan** `bun run --cwd web test` (penuh web, termasuk tes penjaga), `bun run typecheck`, `bun run lint`, `bun run build` (anggaran potongan `verify-dist`).
- [ ] **Step 6: Commit** `feat(web): editor admin berkas Country Lock dengan riwayat dan diff`.

---

### Task 11: Web admin — pengaturan, firmware, bundel, impor

**Files:**
- Create: `web/src/modules/countrylock-admin/components/{settings-form,firmware-page,firmware-form-dialog,bundles-page,publish-dialog,import-page}.tsx`, `lib/parse-legacy-config.ts`, rute `web/src/routes/_app/countrylock/{settings,firmware,bundles/index,bundles/$number,import}.tsx`
- Modify: `navigation.ts` (anak "Pengaturan Router", "Firmware", "Bundel", "Impor"), tes penjaga

**Interfaces:**
- `parseLegacyConfig(configText: string, files: { path: string; text: string }[]): { request: ClImportInput; problems: string[] }` memakai `parseConfig` dari `@countrylock/config` (alias sudah ada di `web/tsconfig.json`/`vite.config.ts`), memetakan firmware ke `{ brand, code, label, scriptPath }` dan mengisi `ClSettings`.
- `settings-form`: mengedit `settings.json` terstruktur (router, folder/mode per brand) → menyimpan lewat `clFiles.save` (role `settings`, teks JSON kanonik); kredensial tampil polos. `firmware-page`: `DataTable` + form dialog (`FormDialogShell`; `scriptPath` = `LinkField` ke berkas role `script`; `parallel` = checkbox; hapus butuh `manage`, dialog menyebut jumlah item pemakai dari `inUseCount`). `bundles-page`: daftar bundel, tombol "Terbitkan" membuka `publish-dialog` yang menampilkan `ClDraftDto.issues` (error memblokir tombol; warning tampil), catatan wajib; detail bundel + "Jadikan versi aktif" (`reactivate`, hanya `manage`). `import-page`: pilih `config.QC` + banyak berkas skrip lewat `FilePicker` (baca teks di klien), tampilkan `problems`, kirim `clImport.run`, tampilkan laporan.

- [ ] **Step 1: Tes web:** `parseLegacyConfig` dengan fixture `countrylock/fixtures/country-lock2/config.QC` (impor relatif di tes) menghasilkan 17 firmware dan menandai `)` nyasar sebagai `problems` bila parse gagal/dibersihkan; publish dialog menonaktifkan tombol saat ada issue error dan mengaktifkannya bila hanya warning; hapus firmware dipakai menampilkan jumlah item; pengguna `edit` tidak melihat tombol Terbitkan/Hapus firmware/Jadikan aktif.
- [ ] **Step 2–4:** gagal → implementasi → `bun run --cwd web test`, typecheck, lint, build.
- [ ] **Step 5: Commit** `feat(web): pengaturan, firmware, bundel, dan impor Country Lock di admin`.

---

### Task 12: Penjaga, dokumentasi, dan spek

**Files:**
- Modify: `shared/api-contract.snapshot.json` (`bun run api:snapshot`), `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` (catat keputusan 2026-11-28 pada §4.1, §4.2, §5, §5.1, §9: server sumber tunggal, OCR ditunda, firmware dinamis, tanpa legacy, pemilik menyetujui), `CLAUDE.md` (bagian desktop/Country Lock + Aturan server: modul `countrylock`, tabel `cl_*`, rute publik `/api/desktop/countrylock`, Range, izin `none/view/edit/manage`), `docs/ci-cd.md` (folder Drive `COUNTRYLOCK_FOLDER_ID` otomatis, cadangan biner Drive tak tercakup cadangan DB), `docs/e2e-checklist-desktop.md` (butir uji manual bundel menyusul fase 2)
- Create: `server/changelog.d/20261128-country-lock-bundel.md`, `desktop/changelog.d/20261128-country-lock-bundel.md` (bila belum dibuat per tugas)

- [ ] **Step 1:** `bun run api:snapshot` lalu `bun run api:snapshot --check` → lolos; pastikan hitungan rute di CLAUDE.md diperbarui.
- [ ] **Step 2:** Perbarui dokumen di atas (keputusan memuat tanggal absolut 2026-11-28 dan bahwa pemilik produk menyetujui; ubah butir spek yang bertentangan, bukan hanya menambah catatan).
- [ ] **Step 3: Verifikasi akhir:** `bun run check` (butuh tunnel) dan `bun run build`; laporkan tes yang gagal apa adanya.
- [ ] **Step 4: Commit** `docs(countrylock): catat keputusan bundel dan perbarui panduan`.

---

## Self-Review (diisi pembuat rencana)

- **Cakupan spek fase 1 (§7 fase 1):** berkas+revisi (T4), biner Drive (T5), firmware dinamis (T6), validasi+bundel+hash+aktifkan ulang (T7), impor (T8), unduhan publik+Range (T9), editor admin+riwayat/diff (T10), form pengaturan/firmware/bundel (T11), izin (T1), kontrak murni (T2), skema+seed (T3), dokumen (T12). Yang sengaja BUKAN fase ini: sinkron komputer, buang jalur lama (`package/local-folder.ts`, `settings.packageDir`) = fase 2; keadaan router/REST = fase 4–6.
- **Konsistensi tipe:** `ClFileRole`, `ClIssue`, `ClManifest`, `ClFileDto`, `CL_CHUNK_BYTES`, `PLACEHOLDER_NAMES` didefinisikan di T2/T4 dan dipakai identik di T5–T11.
- **Hal yang perlu diverifikasi implementer (tidak ditebak di rencana):** nama fungsi tes izin di `shared`; pola persis `ensureNamedFolder`/`folderIdOf`; apakah `FilePicker` membatasi tipe berkas; lokasi pendaftaran `AUDIT_NON_ENTITY_ACTIONS`; apakah `module-coverage.test.ts` mewajibkan entri untuk modul baru.
- **Keputusan perancang yang menunggu persetujuan pemilik:** perluasan level izin `countrylock` (T1); `computerHash` ikut berubah saat kredensial router berubah (over-inclusion disengaja, T7); potongan unggah ≤ 4 MiB disimpan sementara di DB (T5); editor Monaco dengan cadangan CodeMirror (T10).

**Deviasi yang disetujui pemilik 2026-11-28.** Pemilik produk menyetujui dua deviasi dari rencana ini. (1) Editor admin memakai CodeMirror 6 (+ `@codemirror/merge` untuk diff), bukan Monaco: hasil spike Task 10 menunjukkan Monaco `editor.api` 598 KB gzip dan versi lengkap 851 KB melewati anggaran 600 KB gzip per potongan, sedangkan CodeMirror 6 sekitar 116 KB gzip. Langkah spike di atas (Step 1, pilih Monaco atau CodeMirror) sudah dijawab dengan CodeMirror. (2) Migrasi tetap bernomor `0046_country_lock_bundel.sql` (expand-only, tabel `cl_*`), karena `0043` sudah dipakai `origin/dev`. Keputusan ini mengubah spek §9 butir 5 sampai 9 (`docs/superpowers/specs/2026-11-28-country-lock-sync-bundel-design.md`). Butir batas laju, jalur Windows, IP komputer impor, dan sesi `aborted` dicatat di spek dan `CLAUDE.md`; statusnya di kode perlu diverifikasi terhadap rencana tugas 4 sampai 9.
