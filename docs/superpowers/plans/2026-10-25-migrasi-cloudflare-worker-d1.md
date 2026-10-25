# Migrasi Backend ke Cloudflare Worker + D1 — Rencana Implementasi

> **Untuk agen pelaksana:** WAJIB gunakan superpowers:subagent-driven-development (disarankan) atau superpowers:executing-plans untuk menjalankan rencana ini task demi task. Langkah memakai kotak centang (`- [ ]`).

**Tujuan:** Memindahkan backend QC App dari Apps Script + Google Sheets ke Cloudflare Worker + D1 (paket gratis, ≤ 10 ms CPU per permintaan), dengan Apps Script tinggal menjadi jembatan Drive/Sheets, tanpa mengubah fitur, kontrak RPC, atau kehilangan data.

**Arsitektur:** Satu Worker (Hono sebagai cangkang HTTP) menyajikan aset statis, `/api/rpc`, `/auth/*`, `/sync`, handler `queue` dan `scheduled`. Layanan domain `gas/src/modules/*` diporting menjadi async di `worker/src/modules/*` di atas D1; fungsi murni `shared/` dipakai ulang. Proyek Apps Script terpisah `bridge/` (ditandatangani HMAC) melayani Drive dan Sheets. Pekerjaan berat (ekspor QR/Sheets, pembersihan) berjalan di Cloudflare Queues.

**Tech Stack:** TypeScript, Bun (tes), Hono, Cloudflare Workers/D1/Queues/Static Assets, Wrangler ≥ 4.20.0, `bun:sqlite` (adaptor D1 untuk tes), React + TanStack (frontend yang ada), clasp (jembatan).

## Status (diperbarui 2026-10-25)

| Fase | Status |
|---|---|
| 0 Spike | Selesai (hasil di `docs/superpowers/spikes/`) |
| 1 Kerangka Worker | Selesai; uji `workflow_dispatch` ke staging (Task 1.7 Step 2) belum |
| 2 Porting modul | Selesai (access, brand, customer, files, item, handover, qrcode, sync) |
| 3 Jembatan dan antrean | Selesai; jembatan staging ter-deploy (`bridge/deployment.staging.json`) |
| 4 Frontend | 4.1–4.4 selesai; E2E login di staging (Task 4.2 Step 4) belum; **4.5 gerbang CPU sedang berjalan**: skrip dan optimasi selesai, rute baca diukur (board dan pull+detail masih > 8 ms, kriteria p99 menunggu keputusan pemilik), rute tulis belum; lihat `docs/superpowers/spikes/2026-10-cpu-gate.md` |
| 5 Migrasi data | 5.1, 5.2, 5.4 (kode) selesai; **5.3 gladi belum**; deploy `READ_ONLY` ke `/exec` belum |
| 6 Cutover | Belum |
| 7 Stabilisasi | Belum |

Kotak centang di "Prosedur Porting Modul" adalah templat per modul dan sengaja tidak dicentang; status per modul ada di Task 2.1–2.7.

**Spek:** `docs/superpowers/specs/2026-10-25-migrasi-cloudflare-worker-d1-design.md` (selanjutnya "Spek"). Rujukan perilaku fitur: spek/PRD yang ada di `docs/`. Kode sumber yang diporting: `gas/src/**`.

## Global Constraints

Setiap task secara implisit memuat bagian ini (nilai disalin dari Spek §2b, §5, §6–§11).

- CPU Worker **≤ 10 ms per permintaan HTTP dan per Cron**; gerbang rilis: **p99 ≤ 8 ms** tiap rute di staging.
- **Subrequest ≤ 50 per invokasi**: panggilan D1, jembatan, dan Queues semuanya dihitung; `db.batch()` dihitung satu.
- D1: **maks. 100 parameter terikat per kueri**; baris/string ≤ 2 MB; pernyataan SQL ≤ 100 KB; pola `LIKE`/`GLOB` ≤ 50 byte; 500 MB per database; baris dibaca 5 juta/hari (dihitung dari baris yang **dipindai**) dan ditulis 100.000/hari (tiap indeks +1 baris tulis).
- Queues: pesan ≤ 128 KB; 10.000 operasi/hari (±3 per pesan); retensi 24 jam; pesan hanya membawa `{ jobId, potongan }`.
- Cron Trigger ≤ 5 per akun; durasi ≤ 15 menit; CPU ≤ 10 ms.
- Worker **tidak pernah** `atob`/`btoa`/decode atau encode base64 berkas; tidak `JSON.parse` badan unggahan besar; endpoint daftar selalu berhalaman (bawaan 20, maks. 50, kursor) dan tidak mem-parse kolom JSON besar.
- `wrangler.jsonc`: `assets.not_found_handling = "single-page-application"`, `compatibility_date` ≥ `2025-04-01`, `assets.run_worker_first = ["/api/*", "/auth/*", "/sync"]` (daftar pola, bukan `true`). Router frontend: **browser history** (bukan hash).
- Kontrak RPC (`shared/rpc.ts`): kode galat dan bentuk DTO tidak berubah, kecuali `handovers.board` (berhalaman per kolom), `FileContentDto`/`files.get`, dan penambahan `jobs.get` (Spek §7.4, §8.2, §9b).
- Kerangka HTTP: Hono; router RPC (`RouteTable`, izin `anyOf`, `scope: 'location'`) milik proyek; tanpa validator zod / JSX / klien RPC Hono di Worker.
- Jembatan Apps Script: tanda tangan HMAC-SHA256 + `ts` (jendela ±2 menit) + allowlist aksi + batas ukuran + pembatas percobaan salah; deployment `/exec` aplikasi lama TIDAK diubah (satu-satunya perubahan di `gas/`: bendera `READ_ONLY`, Task 5.4).
- Konsistensi D1⇄Drive: membuat = Drive dulu lalu D1; menghapus = tandai `pending_delete` di D1, lalu Drive, lalu hapus baris; cron membersihkan yatim.
- Semua teks Indonesia (UI, galat, dokumen); kode dan identifier tetap bahasa Inggris/aslinya. Commit akhiri dengan baris `Co-Authored-By` model pelaksana.
- Aturan khas Apps Script (akhiran `_`, satu scope global, daftar API terlarang) **tidak berlaku** di `worker/`; berlaku tetap di `gas/` dan `bridge/`.
- Jangan push atau membuat PR tanpa diminta pemilik; kerja di branch `feat/migrasi-cloudflare` (dari `dev`).

## Review Focus

Mode kegagalan yang disiratkan Spek tetapi mudah terlewat (masing-masing punya tes di task yang disebut).

1. **Permintaan terbesar yang realistis melewati 10 ms CPU** (`handovers.saveBatch` 30 task × 5.000 karakter; `items.list` besar; `files` lewat jembatan). Tes: skrip beban Task 4.5; per-rute di Task 2.x mengukur CPU kasar (waktu proses sinkron) dan gagal bila > ambang.
2. **Jembatan lambat/gagal di tengah unggah atau ekspor** → tidak ada berkas yatim permanen, pengguna melihat galat jelas, ulang aman. Tes: Task 2.3 (urutan Drive→D1, galat bridge), Task 3.3 (job gagal bisa diulang).
3. **Dua pengguna mencentang bersamaan / dua `save` mengambil nomor `ST-YYYYMMDD-NNN` bersamaan** → tidak ada centang hilang, tidak ada nomor ganda. Tes: Task 2.5 (interleaving dengan `Promise.all`).
4. **Permintaan jembatan palsu/diulang** (tanda tangan salah, `ts` lama, aksi di luar allowlist, folder induk salah) → ditolak dengan galat yang sama. Tes: Task 3.1.
5. **Data Sheets kotor saat impor** (id ganda, rujukan yatim, angka sebagai teks, tanggal campur) → impor berhenti dengan laporan per baris dan TIDAK menulis sebagian ke D1. Tes: Task 5.1.
6. **Redirect OAuth `/auth/callback` tertelan SPA** (navigasi tidak sampai Worker bila `run_worker_first` salah). Tes: Task 1.5 memeriksa konfigurasi dan menguji handler; Task 4.2 E2E di staging.

## Prosedur Porting Modul (dirujuk Task 2.1–2.7)

Dipakai untuk setiap modul `gas/src/modules/<m>/` → `worker/src/modules/<m>/` agar tidak diulang:

- [ ] **P1:** Salin `<m>/*.test.ts` dan fixture yang dipakainya ke `worker/src/modules/<m>/` dan `worker/test-support/`; ubah memakai `createTestEnv()` (Task 1.2) dan `await` pada semua pemanggilan. Jalankan `bun test worker/src/modules/<m>` → **GAGAL** (modul belum ada).
- [ ] **P2:** Tulis `repo.ts` async dengan SQL eksplisit (`prepare(...).bind(...)`), memakai `batch()` untuk menggabungkan kueri; semua kolom daftar berindeks (cek dengan `EXPLAIN QUERY PLAN` di tes bila tabel diharapkan > 1.000 baris).
- [ ] **P3:** Salin `validate.ts` (sinkron, mostly tanpa perubahan) dan `service.ts` lalu ubah menjadi async; hapus `withLock`, `withRequestCache_`, `bumpTableVersion_`, `flush`; ganti dengan pola konkurensi Spek §7.2 (kolom `version` + `UPDATE … WHERE version=?`, penghitung `RETURNING`, `batch()` atomik).
- [ ] **P4:** Daftarkan rute di `routes.ts` (`RouteTable` entri yang sama dengan `gas/src/modules/<m>/routes.ts`: nama method, `permission`, `scope`, `anyOf`).
- [ ] **P5:** `bun test worker/src/modules/<m>` → **LULUS** seluruhnya (paritas dengan tes gas; tes yang bergantung pada hal khas Sheets/lock dicatat dan diganti setara).
- [ ] **P6:** Ukur CPU rute utama modul dengan data realistis memakai `measureCpu()` (Task 1.2) dan pastikan di bawah anggaran yang ditetapkan tes (maks. 5 ms sinkron di Bun sebagai proksi kasar; ukuran sebenarnya di Task 4.5).
- [ ] **P7:** `bun run check` hijau; commit `feat(worker): port modul <m>`.

---

# FASE 0 — Spike dan fondasi

### Task 0.1: Proyek Cloudflare dan rangka konfigurasi

**Files:**
- Create: `worker/wrangler.jsonc`, `worker/.dev.vars.example`, `docs/superpowers/spikes/2026-10-cloudflare-setup.md`

**Interfaces:**
- Produces: nama binding yang dipakai seluruh rencana — `DB` (D1), `JOBS` (Queue producer+consumer), `ASSETS` (aset statis); Secrets: `SESSION_SECRET`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SYNC_API_TOKEN`, `BRIDGE_URL`, `BRIDGE_SECRET`; variabel: `APP_ORIGIN`. Dua environment: `staging` dan `production` (D1, Queue, Worker terpisah).

- [x] **Step 1 (pemilik, manual):** Pemilik membuat/mengonfirmasi akun Cloudflare, menjalankan `wrangler login`, membuat D1 `qc-staging` dan `qc-production`, Queue `qc-jobs-staging` / `qc-jobs-production`, lalu menyerahkan id database. Agen mencatat langkah ini di `docs/superpowers/spikes/2026-10-cloudflare-setup.md` (id tidak rahasia boleh dicatat; rahasia tidak).
- [x] **Step 2:** Tulis `worker/wrangler.jsonc` dengan blok `env.staging` dan `env.production` berisi binding di atas, `main: "src/index.ts"`, `assets` sesuai Global Constraints, `triggers.crons`, `queues.consumers`. Hanya 1–2 cron (lihat Task 3.3).
- [x] **Step 3:** Verifikasi: `bunx wrangler deploy --dry-run --env staging` selesai tanpa galat konfigurasi (isi `src/index.ts` sementara `export default { fetch: () => new Response('ok') }`).
- [x] **Step 4:** Commit `chore(worker): rangka konfigurasi Cloudflare`.

### Task 0.2: Spike jembatan Apps Script (redirect, ukuran, latensi)

**Files:**
- Create: `bridge/spike/Code.gs` (sekali pakai, TIDAK menjadi `bridge/` final), `worker/spike/bridge-roundtrip.ts`, `docs/superpowers/spikes/2026-10-bridge-roundtrip.md`

**Interfaces:**
- Produces: keputusan tertulis untuk Task 3.1–3.2: (a) apakah `fetch` Workers mengikuti 302 Apps Script ke `GET` dan mengembalikan badan jawaban; (b) ukuran badan base64 terbesar yang berhasil lewat (target 540 KB dan 1 MB); (c) latensi p50/p95; (d) bentuk unggah yang dipilih (penyambungan string di Worker vs unggah langsung klien → jembatan); (e) apakah web app jembatan bisa dipanggil tanpa login Google (deploy "Anyone").

- [x] **Step 1:** Tulis `Code.gs` minimal: `doPost(e)` mengembalikan JSON `{ ok: true, len: e.postData.contents.length, ts: Date.now() }`; deploy sebagai web app (execute as me, access anyone) di proyek Apps Script **baru**.
- [x] **Step 2:** Tulis `bridge-roundtrip.ts` (Worker sementara di staging) yang POST ke URL jembatan dengan badan 10 KB, 540 KB, 1 MB (string base64 acak) dan mencatat status, apakah redirect diikuti, dan waktu.
- [x] **Step 3:** Jalankan terhadap staging; salin hasil ke `2026-10-bridge-roundtrip.md` bersama keputusan (a)–(e). Bila 302 tidak diikuti otomatis: dokumentasikan perlakuan manual (`redirect: 'manual'` lalu `GET` Location).
- [x] **Step 4:** Commit `docs(spike): hasil uji jembatan Apps Script`.

### Task 0.3: Spike CPU dan batas paket gratis

**Files:**
- Create: `worker/spike/cpu-probe.ts`, `docs/superpowers/spikes/2026-10-cpu-limits.md`

**Interfaces:**
- Produces: angka terukur (`cpuTime` dari `wrangler tail`/Workers Logs) untuk: `JSON.parse` 700 KB; teruskan teks base64 540 KB tanpa decode; `atob` 540 KB (sebagai pembanding, untuk membuktikan larangan); `D1.batch()` 10 kueri; konsumen Queues (apakah batas 10 ms berlaku pada paket gratis — jawab pertanyaan terbuka Spek §2b).

- [x] **Step 1:** Worker sementara dengan rute `/probe/<nama>` per skenario di atas, mengembalikan `Server-Timing` kasar.
- [x] **Step 2:** Deploy ke staging, panggil tiap rute ≥ 30 kali, kumpulkan `cpuTime` p50/p99 dari log.
- [x] **Step 3:** Tulis hasil + keputusan ke `2026-10-cpu-limits.md`; bila konsumen Queues terbukti dibatasi 10 ms atau Queues ternyata tidak tersedia di akun, **hentikan dan laporkan ke pemilik** (Spek §15.6) sebelum Fase 3.
- [x] **Step 4:** Commit `docs(spike): hasil pengukuran CPU dan batas gratis`.

---

# FASE 1 — Kerangka Worker

### Task 1.1: Paket `worker/` di monorepo

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/src/index.ts`
- Modify: `package.json` (workspaces + skrip `typecheck`/`test`), `biome.json` bila perlu, `tsconfig.base.json` bila perlu

**Interfaces:**
- Produces: alias `@worker/*` → `worker/src/*`, `@shared/*` → `shared/*`, `@worker-test/*` → `worker/test-support/*`; skrip `bun run --cwd worker test|typecheck`; root `check` menjalankan tes dan typecheck worker.

- [x] **Step 1:** Tambah tes rangka `worker/src/index.test.ts`: `import app from './index'`; `await app.request('/api/ping')` → status 200 dan `{ ok: true }`. Jalankan `bun test worker` → GAGAL.
- [x] **Step 2:** Buat paket (`type: module`, dependensi `hono`, devDependensi `@cloudflare/workers-types`, `wrangler`), tsconfig dengan tipe workers + bun, alias di atas. Implementasi `index.ts`: aplikasi Hono dengan `GET /api/ping`; `export default { fetch: app.fetch }`.
- [x] **Step 3:** Perbarui root `package.json` (`workspaces`, `typecheck`, `test`) agar mencakup `worker`.
- [x] **Step 4:** `bun install && bun run check` → hijau.
- [x] **Step 5:** Commit `feat(worker): kerangka paket worker`.

### Task 1.2: Adaptor D1 berbasis SQLite untuk tes + pengukur CPU

**Files:**
- Create: `worker/test-support/sqlite-d1.ts`, `worker/test-support/test-env.ts`, `worker/test-support/measure.ts`, `worker/test-support/sqlite-d1.test.ts`

**Interfaces:**
- Produces:
  - `createSqliteD1(): D1Database` — memenuhi `prepare(sql).bind(...).first()/all()/run()/raw()` dan `batch(stmts)` (transaksi atomik: gagal satu = semua dibatalkan), dan menegakkan batas **100 parameter terikat per pernyataan** (lempar galat bila lebih).
  - `createTestEnv(overrides?: Partial<Env>): Promise<Env>` — D1 baru dengan seluruh migrasi diterapkan, `BridgeClient` palsu, rahasia uji, jam terkendali (`now()` dapat diatur).
  - `measureCpu<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }>` — waktu proses (`performance.now` selisih) sebagai proksi kasar.

- [x] **Step 1:** Tes `sqlite-d1.test.ts`: `batch` atomik (pernyataan kedua gagal → pernyataan pertama tidak tersimpan); `bind` > 100 parameter melempar; `first()` mengembalikan `null` bila kosong; `RETURNING` bekerja.
- [x] **Step 2:** Jalankan → GAGAL. **Step 3:** Implementasi adaptor di atas `bun:sqlite`. **Step 4:** Tes → LULUS.
- [x] **Step 5:** Commit `test(worker): adaptor D1 sqlite dan pengukur CPU`.

### Task 1.3: Migrasi skema D1 awal dan indeks

**Files:**
- Create: `worker/migrations/0001_init.sql`, `worker/migrations/0002_handover_comments_jobs.sql`, `worker/src/core/migrate.ts`, `worker/src/core/migrations.test.ts`

**Interfaces:**
- Consumes: kolom tabel dari `gas/src/modules/*/repo.ts` (`users`, `roles`, `audit_log`, `locations`, `brands`, `customers`, `files`, `handovers`, `items`, `qr_designs`, `qr_documents`, `qr_defaults`, `qr_presets`, `sync_state`).
- Produces: skema D1; `applyMigrations(db: D1Database): Promise<void>` (dipakai `createTestEnv`); tabel tambahan `handover_comments`, `jobs`, `counters`, `rate_limits`, serta kolom turunan `handovers.version`, `handovers.checked_count`, `handovers.total_count`, `files.status`.

- [x] **Step 1:** Tes `migrations.test.ts`: (a) semua tabel dan kolom ada sesuai daftar; (b) `EXPLAIN QUERY PLAN` kueri board (`WHERE location_id IN (…) AND status=? ORDER BY updated_at DESC LIMIT 21`) memakai indeks, bukan `SCAN`; kueri `audit_log` per `ts` dan per `target` memakai indeks; pencarian `items.key LIKE ?` pola ≤ 50 byte dibatasi di tes validasi; (c) `handovers.number` unik menolak duplikat; (d) `applyMigrations` idempoten.
- [x] **Step 2:** Jalankan → GAGAL.
- [x] **Step 3:** Tulis `0001_init.sql`: kolom teks apa adanya (ISO 8601 UTC untuk waktu; `sync_rev`, `version`, `checked_count`, `total_count`, `size`, `width`, `height` INTEGER), kunci primer `id` (`sync_state.resource`), indeks minimal: `handovers(location_id,status,updated_at)`, unik `handovers(number)`, `audit_log(ts)`, `audit_log(target,ts)`, `items(key)`, `items(status,updated_at)`, `customers(key)`, `brands(key)`, `files(owner_type,owner_id)`, `users(email)` unik. `0002`: `handover_comments(id, handover_id, author, created_at, quote, before, after, body, stale)` + indeks `(handover_id, created_at)`, `jobs(id, kind, status, progress, result, error, created_by, created_at, updated_at)`, `counters(key, value)`, `rate_limits(key, count, window_start)`.
- [x] **Step 4:** Implementasikan `applyMigrations` (baca berkas SQL berurutan dari daftar impor statis, catat versi di tabel `d1_migrations` bawaan Wrangler untuk deploy dan di tabel sendiri untuk tes). **Step 5:** Tes → LULUS.
- [x] **Step 6:** Commit `feat(worker): migrasi skema D1`.

### Task 1.4: Inti Worker: galat, validasi, konfigurasi, klien jembatan (antarmuka)

**Files:**
- Create: `worker/src/core/errors.ts`, `worker/src/core/validate.ts`, `worker/src/core/env.ts`, `worker/src/core/bridge-client.ts`, `worker/test-support/fake-bridge.ts` + tesnya di berkas `*.test.ts` bersebelahan.
- Port dari: `gas/src/core/errors.ts`, `gas/src/core/validate.ts`.

**Interfaces:**
- Produces:
  - `AppError` + `appError(code, message, fields?)`, kode galat sama dengan `gas/src/core/errors.ts`.
  - `createReader(input: unknown)` dengan `str/int/bool/arr/…` sama dengan `gas/src/core/validate.ts`.
  - `interface Env { DB: D1Database; JOBS: Queue<JobMessage>; ASSETS: Fetcher; SESSION_SECRET: string; OAUTH_CLIENT_ID: string; OAUTH_CLIENT_SECRET: string; SYNC_API_TOKEN: string; BRIDGE_URL: string; BRIDGE_SECRET: string; APP_ORIGIN: string }`.
  - `interface BridgeClient` dengan metode yang memetakan satu-ke-satu antarmuka Drive/Sheets di `gas/src/core/platform.ts`: `createFolder(name)`, `createFile(folderId, name, mime, base64)`, `readFile(fileId, folderId)`, `fileInfo(fileId, folderId)`, `folderExists(id)`, `trashFile(id)`, `externalFileInfo(id, resourceKey?)`, `readExternalFile(id, resourceKey?)`, `copyFile(id, folderId, name, resourceKey?)`, `renameFile(id, name)`, `shareAnyoneWithLink(id)`, `revokeSharing(id)`, `replaceFileContent(id, mime, base64)`, `sheetsExport(chunk)`, `sheetsDump()`, semuanya `Promise`. `createFakeBridge()` (memori) untuk tes.

- [x] **Step 1:** Port tes `errors`/`validate` dari gas (jalankan → GAGAL). **Step 2:** Port implementasi. **Step 3:** Tes → LULUS.
- [x] **Step 4:** Tulis tes `fake-bridge.test.ts` (buat/baca/ganti berkas; salin; `readFile` dengan folder induk salah → `null`) → GAGAL → implementasi → LULUS.
- [x] **Step 5:** Commit `feat(worker): inti galat, validasi, env, antarmuka jembatan`.

### Task 1.5: Sesi, OAuth Google, dan rute `/auth/*` (Hono)

**Files:**
- Create: `worker/src/core/session.ts`, `worker/src/modules/auth/oauth.ts`, `worker/src/modules/auth/routes.ts`, `worker/src/http/security.ts` + tes.
- Modify: `worker/src/index.ts`
- Port dari: `gas/src/core/session.ts`, `gas/src/modules/auth/oauth.ts`

**Interfaces:**
- Consumes: `Env`, `appError`.
- Produces:
  - `signSessionToken(env: Env, email: string, now: number): Promise<string>` dan `verifySessionToken(env: Env, token: unknown, now: number): Promise<SessionPayload | null>` — format `base64url(payload).base64url(hmac)` sama dengan `gas/src/core/session.ts`, HMAC via `crypto.subtle`, perbandingan waktu-konstan, TTL 7 hari.
  - Rute Hono: `GET /auth/login` (state OAuth disimpan di `rate_limits`-gaya tabel `oauth_state` atau cookie bertanda tangan; pilih cookie bertanda tangan 10 menit), `GET /auth/callback` (tukar `code`, validasi `iss`/`aud`/`email_verified`, set cookie sesi, redirect `302 /`), `POST /auth/logout`.
  - Middleware `requireSession` (cookie `qc_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`) dan CSRF: setiap `POST`/`PUT`/`DELETE` wajib header `X-Requested-With: qc`; `secureHeaders`.

- [x] **Step 1:** Tes: token valid diverifikasi; token diubah satu karakter → `null`; kedaluwarsa → `null`; callback tanpa/ dengan `state` salah → 400/`UNAUTHENTICATED`; callback sukses (id_token palsu dari `fetch` yang dimock) → `Set-Cookie` ber-atribut `HttpOnly; Secure; SameSite=Lax` dan redirect `/`; POST tanpa header CSRF → 403; `wrangler.jsonc` memuat `run_worker_first` yang mencakup `/auth/*` (tes membaca berkas dan memeriksa pola).
- [x] **Step 2:** Jalankan → GAGAL. **Step 3:** Implementasi. **Step 4:** Tes → LULUS.
- [x] **Step 5:** Commit `feat(worker): sesi HMAC dan login Google`.

### Task 1.6: Konteks akses dan router RPC

**Files:**
- Create: `worker/src/core/context.ts`, `worker/src/core/router.ts`, `worker/src/modules/access/context.ts`, tes bersebelahan.
- Modify: `worker/src/index.ts` (rute `POST /api/rpc`)
- Port dari: `gas/src/core/router.ts`, `gas/src/core/actor.ts`, `gas/src/modules/access/context.ts`

**Interfaces:**
- Produces:
  - `interface RequestCtx { env: Env; email: string; userId: string; permissions: …; locationIds: string[]; … }` (bentuk sama dengan konteks gas).
  - `loadRequestCtx(env: Env, email: string): Promise<RequestCtx | null>` — memuat users/roles/locations dengan satu `db.batch([...])`, tanpa cache lintas permintaan.
  - `type RouteTable` / `defineRoutes(...)` — entri `{ permission, scope?, anyOf?, input(validator), handler(ctx, input) }`; `handleRpc(env, request, routes): Promise<Response>` mengembalikan amplop `{ ok, data | error }` dengan kode galat sama.
  - Tes tipe: setiap kunci `RpcContract` punya rute (`satisfies RouteTable`) — gagal kompilasi bila kurang.

- [x] **Step 1:** Port tes `gas/src/core/router.test.ts` dan tes konteks akses → GAGAL. **Step 2:** Implementasi. **Step 3:** LULUS.
- [x] **Step 4:** Rute `auth.me` (port `gas/src/modules/auth/routes.ts`) dan `GET /api/boot` (alias yang mengembalikan data `me`); tes kontrak keduanya.
- [x] **Step 5:** Commit `feat(worker): konteks akses dan router RPC`.

### Task 1.7: CI untuk Worker (tes, migrasi, deploy staging)

**Files:**
- Create: `.github/workflows/deploy-worker.yml`
- Modify: `.github/workflows/test.yml` (sudah menjalankan `bun run check` — pastikan mencakup `worker`), `docs/ci-cd.md`

**Interfaces:**
- Produces: workflow `deploy-worker.yml` yang **mencerminkan `deploy.yml` Apps Script**:

  | Kejadian | Hasil |
  |---|---|
  | PR dibuka/diperbarui | `test.yml` (check + build) — sudah ada, kini mencakup `worker` |
  | PR **di-merge** ke `dev` | build, `wrangler d1 migrations apply --env staging`, `wrangler deploy --env staging` |
  | PR **di-merge** ke `main` | hal sama untuk `--env production` (otomatis, tanpa persetujuan manual) |
  | Manual (`workflow_dispatch`) | pilih `staging` atau `production`; hanya dari `main` (keduanya) atau `dev` (hanya staging) |

  Sama dengan `deploy.yml`: event `pull_request_target` yang hanya berjalan setelah merge dan hanya me-checkout commit hasil merge; gerbang `bun run check` + `bun run build` sebelum deploy; satu antrean serial `deploy-worker` tanpa membatalkan yang berjalan; environment GitHub `worker-staging` (cabang `dev` dan `main`) dan `worker-production` (cabang `main` saja, reviewer wajib opsional dan dimatikan secara bawaan); `CLOUDFLARE_API_TOKEN` sebagai secret **environment**, bukan secret repositori; `deploy-worker.yml` harus ada di branch default `main` agar pemicunya aktif. Migrasi D1 dijalankan sebelum deploy kode dan harus kompatibel mundur (hanya menambah).
- Deploy jembatan Apps Script tetap lewat alur `clasp` terpisah (proyek jembatan), dengan pola `dev`→HEAD jembatan staging dan `main`→versi baru jembatan produksi.

- [x] **Step 1:** Tulis workflow mengikuti `deploy.yml` yang ada (aturan di atas; jangan menambah langkah yang me-checkout head PR yang belum di-merge). **Step 2:** Uji dengan `workflow_dispatch` dari `dev` ke staging; pastikan `GET /api/ping` di staging menjawab. **Step 3:** Perbarui `docs/ci-cd.md`. **Step 4:** Commit `ci: deploy Worker ke staging dan produksi`. *(Status: Step 1, 3, 4 selesai; Step 2 belum, karena workflow harus ada di `main` dulu agar `workflow_dispatch` aktif.)*

---

# FASE 2 — Porting modul (gunakan "Prosedur Porting Modul")

Setiap task di bawah mengikuti P1–P7; yang tertulis hanyalah keputusan khusus modul.

### Task 2.1: Modul `access` (pengguna, peran, lokasi, audit)

**Files:** `worker/src/modules/access/{repo,validate,service,routes}.ts`, `worker/src/core/audit.ts`; fixture `worker/test-support/access-fixtures.ts`.

**Interfaces:**
- Consumes: `RequestCtx`, `Env`, migrasi Task 1.3.
- Produces: `writeAudit(db: D1Database, entry: { actor; action; target; before?; after? }): D1PreparedStatement` — mengembalikan **pernyataan** agar digabung ke `batch()` tulisan yang sama (audit atomik dengan perubahan); `listAudit(env, { cursor?, limit, filters }): Promise<{ items; nextCursor }>` berhalaman berbasis `(ts, rowid)`; RPC `access.users.*`, `access.roles.*`, `access.locations.*`, `access.audit.list` (input kursor menggantikan halaman bila kontrak lama berhalaman offset — sesuaikan `shared/rpc.ts` dan catat).

- Khusus: pencabutan akses (`setStatus`, ganti peran) berlaku pada permintaan berikutnya karena konteks dimuat per permintaan. Tes: pengguna dinonaktifkan → permintaan berikutnya `FORBIDDEN`/`UNAUTHENTICATED` sesuai perilaku gas.
- [x] Jalankan P1–P7. Commit `feat(worker): port modul access`.

### Task 2.2: Modul `brand` dan `customer`

**Files:** `worker/src/modules/brand/*`, `worker/src/modules/customer/*`.

**Interfaces:** Produces RPC `brands.*`, `customers.*`; `nextSyncRev(db): D1PreparedStatement` — `UPDATE counters SET value = value + 1 WHERE key='sync_rev' RETURNING value` dipakai merk/item (menggantikan `nextRev_`); kunci pencarian dari `shared/items.ts`.

- Khusus: perubahan field sinkron merk **menaikkan `sync_rev`** dalam `batch()` yang sama (aturan CLAUDE.md `itemSyncSignature_`).
- [x] Jalankan P1–P7. Commit `feat(worker): port modul brand dan customer`.

### Task 2.3: Modul `files` (via jembatan)

**Files:** `worker/src/modules/files/{repo,validate,service,routes}.ts`, tes dengan `createFakeBridge`.

**Interfaces:**
- Consumes: `BridgeClient`.
- Produces: `files.upload` → urutan **jembatan `createFile` dulu, lalu `INSERT files`**, bila `INSERT` gagal `trashFile` dicoba (best effort) dan galat diteruskan; `files.get` mengembalikan `{ mime, base64 }` **tanpa decode** (kontrak `FileContentDto` tetap, Worker tidak menyentuh isi); cache Cache API per `fileId` untuk respons teks; penghapusan memakai `status='pending_delete'` lalu jembatan lalu hapus baris.

- Tes tambahan (Review Focus 2): jembatan melempar saat `createFile` → tidak ada baris `files`; `INSERT` gagal setelah Drive sukses → `trashFile` dipanggil dan galat jelas; `files.get` untuk berkas bukan anak folder → `NOT_FOUND`. Tes bahwa tidak ada pemanggilan `atob`/`btoa`/`Buffer.from(…,'base64')` di `worker/src` (pemindaian teks sebagai pagar).
- [x] Jalankan P1–P7. Commit `feat(worker): port modul files`.

### Task 2.4: Modul `item`

**Files:** `worker/src/modules/item/*`.

**Interfaces:** Produces RPC `items.list` (berhalaman kursor, bawaan 20/maks. 50, filter status/merk/kata kunci lewat kolom `key`), `items.get`, `items.save`, `items.setStatus`; kolom JSON (`aliases`, `stickers`, `accessories`, `attachments`) hanya di-parse pada `items.get`/`save`.

- Khusus: `items.list` kontraknya berubah dari "semua" menjadi berhalaman — sesuaikan `shared/rpc.ts` dan catat di Task 4.3 (frontend memakai muat bertahap). `itemSyncSignature_` dan `sync_rev` naik dalam `batch()` yang sama.
- [x] Jalankan P1–P7. Commit `feat(worker): port modul item`.

### Task 2.5: Modul `handover`

**Files:** `worker/src/modules/handover/{repo,validate,service,routes}.ts`, `worker/test-support/handover-fixtures.ts`.

**Interfaces:**
- Consumes: `shared/handover*.ts` (tidak diubah), `nextNumber`.
- Produces: RPC `handovers.*` (kontrak DTO tetap; `board` berubah: input `{ locationIds: string[]; status: HandoverStatus; cursor?: string; limit?: number }` → `{ items: HandoverDto[]; nextCursor: string | null; total: number }`, urutan sesuai spek serah terima §12: terbaru dahulu; pada Dikerjakan `checked_count/total_count` lebih kecil di atas); `nextHandoverNumber(db, dateKey): D1PreparedStatement` berbasis `counters` key `handover:YYYYMMDD`.
- Konkurensi (Review Focus 3): `setCheck` memakai `UPDATE handovers SET checks=?, version=version+1 WHERE id=? AND version=?`; bila 0 baris berubah, baca ulang dan ulangi **sekali** lalu `CONFLICT`. Komentar = `INSERT handover_comments` (batas 50 komentar/40.000 karakter dihitung dengan SQL pada `batch()` yang sama). `save` tidak CONFLICT bila hanya centang berubah (`base`, aturan spek serah terima §12.12) dipertahankan.

- Tes tambahan: dua `setCheck` butir berbeda dijalankan `Promise.all` pada task sama → keduanya tersimpan; dua `save` serentak untuk tanggal sama → nomor `001` dan `002` berbeda; `saveBatch` 30 task atomik (satu gagal validasi → tidak ada yang tersimpan) memakai satu `batch()` dan tidak melewati 100 parameter per pernyataan; board 300 task berhalaman 20 → muatan < 50 KB.
- [x] Jalankan P1–P7. Commit `feat(worker): port modul handover`.

### Task 2.6: Modul `qrcode` (tanpa ekspor)

**Files:** `worker/src/modules/qrcode/*` (kecuali `export`), `worker/test-support/qrcode-env.ts`.

**Interfaces:** Produces RPC `qrcodes.*` kecuali `qrcodes.export` (Task 3.3); Drive lewat `BridgeClient`; `qrcodes.file` meneruskan base64 tanpa decode.

- [x] Jalankan P1–P7 (dikecualikan: ekspor). Commit `feat(worker): port modul qrcode`.

### Task 2.7: Modul `sync` (QC Desktop)

**Files:** `worker/src/modules/sync/*`, rute Hono `POST /sync`.

**Interfaces:** Consumes `nextSyncRev`. Produces `handleSync(env, request)`: kontrak `docs/api/desktop-sync.md` (amplop `{v, method, token, payload}`, kode galat, body ≤ 5 MB, token di body); pembatas "10 salah / 10 menit" memakai tabel `rate_limits`; ukuran halaman sinkron dibatasi dan **diukur** (CPU hash `itemSyncSignature_` per item).

- Tes tambahan: kursor `sync_rev`/`sync_state` hasil impor tetap valid (fixture impor memuat nilai seq); semua kegagalan sebelum autentikasi → `UNAUTHENTICATED "Token tidak valid"` identik.
- [x] Jalankan P1–P7. Commit `feat(worker): port modul sync`.

---

# FASE 3 — Jembatan dan antrean

### Task 3.1: Proyek `bridge/` (Apps Script) dengan HMAC dan aksi Drive

**Files:**
- Create: `bridge/src/main.ts`, `bridge/src/auth.ts`, `bridge/src/drive.ts`, `bridge/src/sheets.ts`, `bridge/appsscript.json`, `bridge/package.json`, `bridge/tsconfig.json`, tes `*.test.ts`
- Modify: `scripts/build-gas.ts` atau skrip baru `scripts/build-bridge.ts` (pakai pagar yang sama: akhiran `_`, API terlarang)

**Interfaces:**
- Produces: `doPost(e)` yang membaca `{ action, ts, sig, payload }`; `verifyBridgeRequest_(body, secret, nowMs)` (HMAC-SHA256 atas `action.ts.payloadJson`, jendela ±2 menit, perbandingan waktu-konstan; semua kegagalan → balasan sama `{ ok:false, error:'UNAUTHENTICATED' }`); allowlist aksi sesuai Spek §8.1; pembatas percobaan salah via `CacheService`; setiap aksi berkas memeriksa folder induk (pola `driveReadFile(fileId, folderId)` sekarang).

- Tes (Review Focus 4): tanda tangan salah, `ts` lama (>2 menit), `ts` masa depan, aksi di luar allowlist, badan > batas, `folderId` bukan induk berkas → semuanya galat identik dan tidak ada efek Drive (fake Drive tidak terpanggil).
- [x] **Step 1:** Tes → GAGAL. **Step 2:** Implementasi (aksi Drive memanggil API `DriveApp` lewat antarmuka tipis agar teruji dengan fake). **Step 3:** LULUS. **Step 4:** Build jembatan + `clasp push` ke proyek jembatan staging (manual oleh pemilik bila butuh otorisasi). **Step 5:** Commit `feat(bridge): jembatan Drive ditandatangani HMAC`.

### Task 3.2: `BridgeClient` nyata di Worker

**Files:** `worker/src/core/bridge-client.ts` (implementasi), `worker/src/core/bridge-client.real.test.ts`

**Interfaces:** Produces `createBridgeClient(env: Env, fetchImpl?: typeof fetch): BridgeClient` — menandatangani permintaan, mengirim lewat `fetch`, menangani 302 sesuai keputusan Task 0.2, mem-parse balasan kecil dengan `JSON.parse` tetapi **tidak** mem-parse/decode badan base64 besar (menyambung string), batas waktu dan satu percobaan ulang untuk galat jaringan idempoten, memetakan galat jembatan ke `appError`.

- Tes: tanda tangan sesuai verifier jembatan (uji silang dengan `verifyBridgeRequest_`); ts diisi dari jam terkendali; 302 diikuti; timeout → `UNAVAILABLE` yang pesannya jelas.
- [x] Tes → GAGAL → implementasi → LULUS. Commit `feat(worker): klien jembatan`.

### Task 3.3: Antrean pekerjaan: `jobs`, ekspor QR, cron, `jobs.get`

**Files:** `worker/src/modules/jobs/{repo,service,routes,consumer}.ts`, `worker/src/modules/qrcode/export.ts`, `worker/src/scheduled.ts`; modifikasi `worker/src/index.ts` (`export default { fetch, queue, scheduled }`), `shared/rpc.ts` (`jobs.get`).

**Interfaces:**
- Produces: `interface JobMessage { jobId: string; kind: 'qr_export' | 'sheets_export' | 'cleanup_qr'; step: number }`; `enqueueJob(env, kind, input, createdBy): Promise<{ jobId: string }>` (menyisipkan `jobs` lalu `JOBS.send`); `queue(batch, env)` memproses satu potongan per pesan (mis. satu berkas QR, ±500 baris ekspor), memperbarui `jobs.progress/status/result`, mengirim pesan lanjutan; `scheduled(event, env)` hanya `enqueueJob('cleanup_qr')` (dan ekspor terjadwal bila dikonfigurasi); RPC `jobs.get { id } → { id; kind; status: 'queued'|'running'|'done'|'failed'; progress; result?; error? }` dengan pemeriksaan izin pembuat/`qrcode`; `qrcodes.export` kini hanya `enqueueJob` dan mengembalikan `{ jobId }`.

- Tes (Review Focus 2): potongan gagal di tengah → `status='failed'` dengan pesan, `jobs.retry`/ulang via `qrcodes.export` aman (tidak menggandakan berkas; berkas Drive setengah jadi dicatat yatim dan dibersihkan `cleanup_qr`); pesan terkirim ulang (at-least-once) tidak menggandakan hasil; `cleanup_qr` mencabut berbagi `qr_documents` yatim lewat fake bridge dalam potongan ≤ N per pesan.
- [x] Tes → GAGAL → implementasi → LULUS. Commit `feat(worker): antrean pekerjaan, ekspor QR, cron`.

### Task 3.4: Aksi Sheets: `sheets.dump` dan `sheets.export`

**Files:** `bridge/src/sheets.ts` (lengkapi), `worker/src/modules/jobs/sheets-export.ts`, tes.

**Interfaces:** Produces `sheets.dump` → `{ tables: Record<string, string[][]> }` (semua sheet, baris pertama = header); `sheets.export` menerima `{ sheet, header, rows, mode: 'replace' | 'append' }` dan menulis potongan; consumer `sheets_export` memanggil per halaman D1 (±500 baris, `LIMIT/OFFSET` berindeks atau kursor).

- Tes: ekspor 1.200 baris → 3 potongan, header sekali, urutan baris terjaga; ekspor tidak pernah menulis ke sheet sumber impor (nama sheet ekspor berawalan `export_`).
- [x] Tes → GAGAL → implementasi → LULUS. Commit `feat: dump dan ekspor Spreadsheet lewat jembatan`.

---

# FASE 4 — Frontend

### Task 4.1: Transport HTTP dan boot via `/api/boot`

**Files:**
- Create: `web/src/lib/rpc/http-transport.ts` + tes
- Modify: `web/src/lib/rpc/index.ts`, `web/src/lib/rpc/client.ts` (jika perlu), `web/src/app/boot.ts*`, hapus `web/src/lib/rpc/gas-transport.ts` (dan tesnya) setelah tidak dirujuk

**Interfaces:**
- Consumes: antarmuka `Transport` di `web/src/lib/rpc/transport.ts` (tidak berubah).
- Produces: `createHttpTransport(options?: { baseUrl?: string; fetchImpl?: typeof fetch }): Transport` — `POST /api/rpc` dengan header `X-Requested-With: qc`, `credentials: 'same-origin'`, tanpa batching; galat HTTP/jaringan → `RpcError` kode yang sama seperti sekarang; 401 → memicu alur login (`/auth/login`).

- [x] Tes: payload dan header benar; `{ok:false,error}` dipetakan; 401 memicu pengarahan ke login; dua panggilan serentak = dua permintaan terpisah. GAGAL → implementasi → LULUS. Commit `feat(web): transport HTTP menggantikan google.script.run`.

### Task 4.2: Routing standar, build tanpa satu berkas, aset Wrangler

**Files:**
- Modify: `web/src/app/router.ts` (`createBrowserHistory`), `web/vite.config.ts` (hapus `viteSingleFile`, `autoCodeSplitting: true`, `outDir: ../worker/dist`), `scripts/verify-dist.ts` (anggaran per potongan, hapus `MAX_INDEX_BYTES`), `worker/wrangler.jsonc` (`assets.directory`), `web/index.html`
- Delete: `web/src/app/gas-location.ts` dan referensinya

**Interfaces:**
- Produces: build menghasilkan `index.html` + potongan JS/CSS; `verify-dist` memeriksa: tidak ada kode mock, ada `index.html`, setiap potongan JS ≤ anggaran yang ditetapkan (mulai 500 KB gzip per potongan; sesuaikan dari hasil).

- [x] **Step 1:** Perbarui tes router/tautan yang mengasumsikan `#`; GAGAL. **Step 2:** Implementasi. **Step 3:** `bun run build` + `verify-dist` OK. **Step 4 (E2E staging, Review Focus 6):** login Google penuh di staging; muat langsung `/handover`, refresh, tombol Back/Forward; `/auth/callback` diproses Worker. **Step 5:** Commit `feat(web): routing standar dan build berpotongan`. *(Status: kode selesai; Step 4 E2E di staging belum dijalankan.)*

### Task 4.3: Daftar berhalaman di frontend (board, item, audit) dan polling job

**Files:** `web/src/modules/handover/queries.ts`, `components/handover-board*.tsx`, `lib/group-board.ts`; `web/src/modules/item/queries.ts` + daftar; `web/src/modules/access/` (audit); `web/src/modules/qrcode/` (status ekspor memakai `jobs.get`); tes terkait.

**Interfaces:**
- Consumes: `handovers.board {status,cursor,limit}`, `items.list` berhalaman, `access.audit.list` berkursor, `jobs.get`.
- Produces: `useBoardColumn(status)` (infinite query per kolom dengan `total` di judul), `useJob(jobId)` (polling interval bertahap 1→2→5 dtk sampai `done|failed`).

- [x] Tes: kolom memuat halaman berikutnya saat menggulir; optimistic update centang memperbarui item di halaman termuat dan mengurutkan ulang setelah server menjawab; job `failed` menampilkan pesan dan tombol ulang. GAGAL → implementasi → LULUS. Commit `feat(web): daftar berhalaman dan status job`.

### Task 4.4: Pengembangan lokal dan hapus mock-di-peramban

**Files:**
- Modify: `web/vite.config.ts` (proxy `/api`, `/auth`, `/sync` ke `wrangler dev`), root `package.json` (`dev` menjalankan `wrangler dev` + Vite), `CLAUDE.md`, `docs/e2e-checklist.md`
- Delete: `web/src/lib/rpc/mock-backend.ts(.test)` dan `gas/test-support` yang hanya dipakai mock (setelah Fase 7)

**Interfaces:** Produces `bun run dev` (Vite :3000 + Worker lokal dengan D1 lokal dan `fake-bridge` mode dev) dan `bun run db:seed` (data contoh).

- [x] Verifikasi manual terdokumentasi: login dev (mode dev melewati Google lewat variabel `DEV_LOGIN_EMAIL` HANYA di `.dev.vars`), buat task, centang, ekspor QR palsu. Commit `chore: pengembangan lokal dengan wrangler dev`. *(Status: selesai dengan penyimpangan: Worker lokal tidak memakai `fake-bridge`, sehingga unggah berkas, ekspor, dan QR yang memakai Drive gagal `UNAVAILABLE` secara lokal dan diuji di staging; lihat `docs/dev-worker.md`.)*

### Task 4.5: Gerbang CPU dan beban (kriteria rilis)

**Files:** `scripts/load-cpu.ts`, `docs/superpowers/spikes/2026-10-cpu-gate.md`

**Interfaces:** Produces skrip yang mengisi D1 staging dengan data proyeksi 2 tahun (task, audit, item), memanggil setiap RPC dengan muatan terbesar yang realistis (`saveBatch` 30×5.000 karakter, `items.list` halaman penuh, `handovers.board` tiap kolom, `files.get` 540 KB, `/sync` halaman penuh), mengambil `cpuTime` dari log, dan menghasilkan tabel p50/p99 per rute; **keluar dengan kode ≠ 0 bila ada rute p99 > 8 ms**.

- [ ] Jalankan di staging; perbaiki rute yang gagal (kembali ke task modul terkait) sampai hijau. Commit `test: gerbang CPU p99 ≤ 8 ms`.

---

# FASE 5 — Migrasi data

### Task 5.1: Skrip impor Sheets → SQL dengan validasi

**Files:** `scripts/migrate/import-sheets.ts`, `scripts/migrate/schema-map.ts`, `scripts/migrate/import-sheets.test.ts`

**Interfaces:**
- Consumes: `sheets.dump` (Task 3.4), skema (Task 1.3).
- Produces: `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json`. Normalisasi otomatis dan dilaporkan: pangkas spasi; angka-sebagai-teks → INTEGER untuk kolom INTEGER; tanggal format dikenal → ISO UTC. **Berhenti (kode ≠ 0, `import.sql` tidak ditulis)** bila: id ganda dalam tabel, rujukan yatim (`handovers.customer_id`, `items.brand_id`, `files.owner_id`, id lokasi/peran di `users`), tanggal tak terbaca, nilai di luar tipe kolom. Laporan per baris. Mengisi `counters` (`sync_rev`, `handover:YYYYMMDD`) dari data tertinggi dan `sync_state` apa adanya; memecah `handovers.comments` JSON ke `handover_comments`, menghitung `checked_count/total_count/version`.

- Tes (Review Focus 5): fixture dump kotor — id ganda, `customer_id` yatim, `sync_rev` bertulisan "12", tanggal `2026/10/5` — masing-masing menghasilkan perilaku di atas; dump bersih menghasilkan SQL yang bila dijalankan pada `createTestEnv` menghasilkan jumlah baris sama dan board yang valid.
- [x] Tes → GAGAL → implementasi → LULUS. Commit `feat(migrate): impor Sheets ke D1 dengan validasi`.

### Task 5.2: Skrip verifikasi pasca-impor

**Files:** `scripts/migrate/verify-import.ts` + tes

**Interfaces:** Produces `verify-import --dump dump.json --d1 <nama>`: jumlah baris per tabel sama; checksum (hash SHA-256 atas kolom kunci terurut) per tabel sama; tidak ada rujukan yatim di D1; `counters.sync_rev` ≥ `max(sync_rev)` data; laporan lulus/gagal per tabel.

- [x] Tes → GAGAL → implementasi → LULUS. Commit `feat(migrate): verifikasi impor`.

### Task 5.3: Gladi migrasi di staging (operasional)

**Files:** `docs/superpowers/spikes/2026-10-gladi-migrasi.md`

- [ ] **Step 1:** Ekspor `sheets.dump` dari Sheets produksi (hanya baca). **Step 2:** Impor ke D1 staging (hapus data staging dulu), jalankan verifikasi. **Step 3:** Jalankan `docs/e2e-checklist.md` penuh di staging terhadap data nyata. **Step 4:** Catat waktu tempuh tiap langkah dan temuan; ulangi sampai mulus dua kali berturut-turut. **Step 5:** Commit catatan.

### Task 5.4: Bendera `READ_ONLY` di aplikasi lama (`gas/`)

**Files:** `gas/src/core/router.ts` (atau titik masuk tulis), `gas/src/core/config.ts`, tes, `docs/setup-google.md`

**Interfaces:** Produces Script Property `READ_ONLY` (`'1'` = semua RPC tulis dan `doPost` sync tulis ditolak dengan `UNAVAILABLE "Aplikasi sedang dipindahkan; hanya baca"`; baca tetap jalan). Tidak ada perubahan perilaku bila properti tidak ada.

- [x] Tes: dengan `READ_ONLY=1` `handovers.save`/`items.save`/`files.upload`/`sync.items.push` ditolak, `handovers.board`/`items.list` tetap OK; tanpa properti tidak ada perubahan. GAGAL → implementasi → LULUS. Deploy ke `/exec` **sebelum hari cutover** lewat alur CI normal. Commit `feat(gas): bendera READ_ONLY untuk jendela migrasi`. *(Status: kode dan tes selesai; deploy ke `/exec` belum.)*

---

# FASE 6 — Cutover (operasional, dijalankan bersama pemilik)

### Task 6.1: Runbook dan pelaksanaan cutover

**Files:** `docs/superpowers/runbooks/2026-10-cutover-cloudflare.md`

- [ ] **Step 1 (T-7 hari):** Syarat siap: Task 4.5 hijau di staging, Task 5.3 dua kali mulus, Task 5.4 ter-deploy di `/exec`, pemelihara QC Desktop siap mengganti URL, OAuth redirect URI produksi terdaftar, domain/produksi Worker ter-deploy dengan D1 produksi kosong bermigrasi.
- [ ] **Step 2 (hari-H):** Umumkan; minta Desktop berhenti sinkron; set `READ_ONLY=1` di aplikasi lama; tunggu RPC tulis terakhir selesai.
- [ ] **Step 3:** `sheets.dump` → impor ke D1 produksi → `verify-import` **harus lulus**; bila gagal: set `READ_ONLY` kembali kosong, batalkan, analisis (jalan mundur = tidak ada yang berubah bagi pengguna).
- [ ] **Step 4:** Smoke test produksi: login, daftar, buat task + centang + Mark done, unggah gambar, ekspor QR (job selesai), `/sync` dengan token Desktop uji.
- [ ] **Step 5:** Arahkan pengguna ke domain Worker (umumkan URL); ganti URL QC Desktop dan nyalakan sinkron; pantau 1 jam (galat 1102, 429, CPU).
- [ ] **Step 6:** Aplikasi lama dibiarkan baca-saja. Catat waktu mulai-selesai di runbook. **Jalan mundur** (hanya sebelum ada tulis penting di D1): kosongkan `READ_ONLY`, kembalikan URL Desktop, umumkan URL lama.

---

# FASE 7 — Stabilisasi dan penghentian

### Task 7.1: Pemantauan dan perbaikan stabilisasi (2–4 minggu)

- [ ] Harian: periksa Workers Logs untuk galat 1102/429, kuota D1 (baris dibaca/ditulis), operasi Queues; ekspor terjadwal ke Sheets berjalan; catat di `docs/superpowers/spikes/2026-11-stabilisasi.md`. Perbaikan bug lewat PR kecil biasa.

### Task 7.2: Pembersihan kode yang tidak diperlukan lagi dan pembaruan dokumen

**Keputusan pemilik:** hapus saja file/baris kode yang tidak diperlukan lagi; tidak perlu persetujuan terpisah. Yang masih dipakai ekosistem Google (`bridge/`, skrip impor/ekspor, `scripts/push-bridge.ts`, `scripts/deploy-bridge.ts`) dipertahankan. Waktu pelaksanaan: setelah masa stabilisasi (Task 7.1) selesai tanpa kebutuhan jalan mundur; sebelum itu `gas/` tetap sebagai pegangan jalan mundur (sumbernya juga aman di riwayat git).

**Files:**
- Hapus (setelah memeriksa tidak ada referensi tersisa lewat pencarian dan typecheck): `gas/` (src, test-support, dist, `deployment.json`, `appsscript.json`), `scripts/build-gas*.ts`, `scripts/verify-gas-dist.ts`, `scripts/push.ts`, `scripts/deploy.ts`, `.github/workflows/deploy.yml` (versi GAS), `web/src/lib/rpc/mock-backend.*`, kontrak lama `RpcContract` di `shared/rpc.ts` (tinggalkan hanya `WorkerRpcContract`, ganti nama bila perlu), alias `@gas*` di tsconfig/vite, bendera `READ_ONLY` bila hanya milik `gas/`.
- Ubah: `CLAUDE.md`, `docs/ci-cd.md`, `docs/setup-google.md` (jembatan saja), `docs/api/desktop-sync.md` (URL baru, tanpa catatan redirect 302), `docs/adding-a-module.md`, PRD NFR yang menyebut Sheets/Apps Script sebagai penyimpanan.

- [ ] **Step 1:** Pastikan Task 7.1 selesai. **Step 2:** Hapus berkas/baris di atas secara bertahap; setelah tiap kelompok jalankan `bun run typecheck` dan pencarian referensi (`@gas`, `gas/`, `RpcContract`). Kode yang masih dirujuk `bridge/` atau skrip migrasi dipertahankan. **Step 3:** `bun run check` + `bun run build` hijau. **Step 4:** Commit `chore: bersihkan kode backend Apps Script lama, jembatan tetap`.

---

## Catatan Self-Review

- **Cakupan Spek:** §4 arsitektur (1.1, 1.5–1.7, 3.x); §5 CPU (Global Constraints, P6, 4.5); §6 kerangka (1.1–1.6); §7 D1 (1.3, 2.x); §8 berkas/jembatan/Sheets (2.3, 3.1–3.4, 5.x); §9 sync (2.7); §9b Queues (3.3); §10 cron (3.3); §11 frontend (4.1–4.4); §12 pengujian (P1–P7, 4.5, 5.1–5.3); §13 fase (struktur dokumen ini); §14 risiko (Review Focus); §15 pertanyaan terbuka (domain, Desktop, skala — diselesaikan sebelum Task 6.1, belum menghalangi Fase 0–4).
- **Tidak ada hal yang diputuskan agen sendiri tanpa catatan:** pilihan yang diserahkan Spek §16 (tipe kolom, daftar indeks, pemisahan `handover_comments`, cookie vs token, alur unggah) dicatat sebagai Ruling di hasil Task 0.2/1.3/1.5/2.5.
- **Urutan:** Fase 0 dapat berjalan paralel dengan Task 1.1; Task 2.3/2.6 butuh antarmuka `BridgeClient` (Task 1.4) tetapi tidak jembatan nyata; Task 3.x dapat berjalan paralel dengan Fase 2 setelah Task 1.4.
