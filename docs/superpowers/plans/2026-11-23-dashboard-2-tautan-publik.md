# Dashboard 2 — Tautan publik: rencana implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna ber-`dashboard: manage` membagikan sebagian dashboard lewat tautan publik yang kedaluwarsa, dapat dicabut, terisolasi pada cakupan beku, dan boleh dipersempit penonton di dalam cakupan itu.

**Architecture:** Token bertanda tangan (`v1.<shareId>.<exp>.<sig>`, kunci turunan berlabel sendiri) + baris `dashboard_shares` untuk pencabutan. Halaman publik memakai mesin widget Rencana 1 dengan `ResolvedScope` dari baris + irisan hak pembagi saat itu + filter penonton; keluaran melewati `toPublicDto` (daftar putih).

**Tech Stack:** Bun + Hono + MariaDB, WebCrypto HMAC, React/TanStack (halaman publik di luar `_app`).

**Spec:** `docs/superpowers/specs/2026-11-23-dashboard-design.md` (bagian 3, 4 K1-K4, 7, 8.2, 10). **Prasyarat:** Rencana 1 selesai (`2026-11-23-dashboard-1-inti.md`).

## Global Constraints

- Token: `v1.<shareId>.<exp>.<sig>`; HMAC-SHA256 dengan kunci turunan label **`qc:dashboard-share-link:v1`** dari `SESSION_SECRET`; verifikasi tanda tangan TANPA DB lebih dulu (bentuk kanonik, batas panjang 300), baru baris (ada, tak dicabut, belum lewat `expires_at`). Mengganti `SESSION_SECRET` mematikan semua tautan.
- Kedaluwarsa wajib: pilihan 7/30/90/180/365 hari atau tanggal kustom, bawaan **30 hari**, plafon **365 hari**.
- Maks. **50 tautan aktif per pembagi** (tautan terbitan laporan, `report_id <> ''`, tidak dihitung).
- Izin: membuat/mencabut butuh `dashboard: manage`; daftar tautan terlihat semua pemegang `manage`; **menyalin tautan (`url`) hanya pembagi atau super admin**. Pembagi tak aktif/terhapus ATAU tak lagi memegang `dashboard: manage` → 404 seragam.
- Cakupan beku saat dibagikan: BU/Lokasi kosong diubah jadi himpunan id eksplisit; `locationFiltered` menandai pilihan aktif (Serial/Laporan hanya memakai Lokasi sebagai filter bila `true`). Rentang tetap `{from,to}` atau bergulir `{days}` (berakhir hari ini).
- Penonton hanya MEMPERSEMPIT (irisan): BU/Lokasi dalam himpunan beku; tanggal dijepit ke rentang beku dan **dibulatkan hari WIB penuh**; filter grup enum bebas; filter grup relasi hanya bila ditawarkan pembagi dan hanya di dalam nilai pilihan pembagi, selain itu diabaikan; nilai di luar cakupan diabaikan lewat irisan tanpa galat berbeda; maks. 20 nilai per filter; widget di luar daftar tautan tak dapat diminta.
- DTO publik berdaftar putih (`toPublicDto`): tanpa `previous` (tak ada delta di halaman publik), list maks. **10 baris**, kolom hanya `listColumns` widget; TANPA `total` dan `key` irisan/seri berupa indeks (keputusan pemilik 2026-11-24, spek 7.4; semula `total` boleh tampil). Tanpa catatan, komentar, foto, id berkas, surel pengguna. Pembagi tampil sebagai `publicActorName` (bagian lokal surel).
- Rute publik di `/api/public/dashboards/<token>` (GET) dan `/api/public/dashboards/<token>/query` (POST), di luar `API_ROUTES`/OpenAPI: semua penolakan 404 problem+json yang sama; `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; token tak dicatat; kegagalan token 20 per 10 menit per IP (`rate_limits` kunci `dashboard-share:<ip>`); keberhasilan `query` 30 per menit per IP (`dashboard-view-ip:<ip>`) dan 120 per menit per token (`dashboard-view-token:<shareId>`) → 429 seragam.
- Halaman publik `/dashboard-publik/$token` di luar layout `_app`; token bertitik → awalan `/dashboard-publik/` dikecualikan di `server/src/http/static.ts` dan `SERVER_PATH_DENYLIST` (`web/src/app/pwa/server-paths.ts`); log nginx `qc_masked` diperluas (langkah manual VPS sebelum merge).
- URL tautan disusun SERVER dari `APP_ORIGIN`. Penyegaran halaman publik 60 detik saat tab terlihat. `dashboard_shares` bukan model soft delete (`revoked_at`). Migrasi `0032_dashboard.sql` expand-only dan idempoten.
- Aturan sesi/UI/tes sama dengan Rencana 1 (commit hanya setelah izin pengguna; tanpa `.env` baru; `LinkField`/`Select` aturan; tunnel DB untuk tes server).

## Review Focus

1. Pembagi yang diturunkan haknya (nonaktif, kehilangan `manage`, kehilangan izin sebuah widget, atau menyempit BU/Lokasi-nya) tak boleh meninggalkan tautan yang membuka data di luar hak barunya (Tugas 5-6).
2. Filter penonton berisi id di luar cakupan, tanggal di luar rentang, atau filter relasi yang tak ditawarkan: hasil harus tetap himpunan bagian dari hasil tanpa filter, bentuk respons tak berubah (Tugas 5).
3. Filter BU/Lokasi kosong saat membagikan tak boleh menjadi "semua" saat dibuka: BU yang ditambahkan ke pembagi kemudian tidak ikut (Tugas 4).
4. Token Serial (laporan rusak) tak boleh lolos verifikasi dashboard dan sebaliknya (Tugas 1).
5. Pembatas keberhasilan harus menahan permintaan berulang dengan rentang tanggal berbeda-beda (Tugas 6).

## File Structure

- Create `server/src/core/signed-link.ts` (+ tes); modify `server/src/modules/serial/public-link.ts` (mendelegasikan, API tak berubah).
- Create `server/src/modules/dashboard/{share-link,share-repo,share-service,share-validate,share-routes,public-view,public-limits,public-routes}.ts` (+ tes), `server/migrations/0032_dashboard.sql`.
- Create `shared/dashboard-share.ts`, `shared/dashboard-public.ts` (+ tes).
- Modify `shared/contract.ts`, `shared/api.ts`, `shared/api-versions.ts`, `shared/audit.ts` (`ActivityKind` + `dashboardShare`), `server/src/routes.ts`, `server/src/app.ts`, `server/src/http/{static.ts,body.test.ts}`, `web/src/app/pwa/server-paths.ts`, `deploy/nginx/qc.conf.example`, `shared/api-contract.snapshot.json`.
- Create `web/src/modules/dashboard/components/{scope-editor,share-dialog,shares-dialog}.tsx`, `web/src/modules/dashboard/share-queries.ts`, `web/src/modules/dashboard-public/` (halaman publik), `web/src/routes/dashboard-publik.$token.tsx`.
- Modify `web/src/modules/dashboard/components/dashboard-page.tsx` (tombol Bagikan/Tautan dibagikan), `CLAUDE.md`, `server/changelog.d/20261123-dashboard.md`.

---

### Task 1: Penanda tautan generik dan token dashboard

**Files:**
- Create: `server/src/core/signed-link.ts`, `server/src/modules/dashboard/share-link.ts`
- Modify: `server/src/modules/serial/public-link.ts`, `server/src/http/static.ts`, `web/src/app/pwa/server-paths.ts`, `deploy/nginx/qc.conf.example`
- Test: `server/src/core/signed-link.test.ts`, `server/src/modules/dashboard/share-link.test.ts`; tes yang ada tetap hijau: `server/src/modules/serial/public-link.test.ts`, `scripts/pwa-server-paths.test.ts`, tes `static.ts`

**Interfaces:**
- Produces:
  - `createLinkSigner(label: string): { sign(secret: string, id: string, expiresAtMs: number): Promise<string>; verify(secret: string, token: string, nowMs: number): Promise<{ id: string } | null> }` (logika persis `public-link.ts` yang ada: `v1.<id>.<expSeconds>.<sig>`, kunci turunan berlabel, kanonik, 300 karakter, sah sampai `exp*1000 + 999`).
  - `signShareToken(secret, shareId, expiresAtMs): Promise<string>` dan `verifyShareToken(secret, token, nowMs): Promise<{ shareId: string } | null>` (label `qc:dashboard-share-link:v1`).
  - `signReportToken`/`verifyReportToken` (Serial) tetap, tanda tangan fungsi tak berubah, label tetap `qc:serial-report-link:v1`.

- [ ] **Step 1: Tulis tes yang gagal**
  - `signed-link.test.ts`: round trip; tanda tangan diubah satu karakter → null; token sah pada `exp*1000+999` ms, tak sah pada `+1000`; tanda tangan non-kanonik (bit sisa base64url) → null; panjang > 300 → null; `secret === ''` → null.
  - **Review Focus 4:** token yang dibuat penanda berlabel Serial ditolak `verifyShareToken` dan sebaliknya.
  - Tes `static`/`server-paths`: `/dashboard-publik/<token-bertitik>` dilayani fallback SPA (bukan 404 berkas) dan masuk denylist service worker.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/core/signed-link.test.ts src/modules/dashboard/share-link.test.ts` → FAIL.
- [ ] **Step 3: Implementasi**: pindahkan logika `public-link.ts` ke `createLinkSigner`; `public-link.ts` memanggilnya dengan label lamanya (hasil `{id}` dipetakan ke `{caseId}`); tambah awalan `/dashboard-publik/` di tempat `/laporan/` dikecualikan (`static.ts`, `server-paths.ts`); perluas `map`/`log_format qc_masked` di `deploy/nginx/qc.conf.example` ke awalan itu (komentar: salin manual ke VPS sebelum merge).
- [ ] **Step 4: Jalankan** tes baru + `bun run --cwd server test src/modules/serial/public-link.test.ts src/modules/serial/public-routes.test.ts` + `bun run scripts/test-scripts.ts` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): token tautan bertanda tangan dan jalur publik`.

---

### Task 2: Migrasi, tipe berbagi, dan repo

**Files:**
- Create: `server/migrations/0032_dashboard.sql`, `shared/dashboard-share.ts`, `server/src/modules/dashboard/share-repo.ts`
- Test: `server/src/modules/dashboard/share-repo.test.ts`, `shared/dashboard-share.test.ts`

**Interfaces:**
- Produces (`shared/dashboard-share.ts`):
  - `SHARE_LIMITS = { widgetsMax: 30, activePerSharer: 50, expiryDaysMax: 365, expiryDaysDefault: 30, titleMax: 120 } as const`.
  - `type ShareRange = { mode: 'fixed'; from: string; to: string } | { mode: 'rolling'; days: number }`.
  - `interface ShareWidgetScope { id: WidgetId; filters: Record<string, string[]> }`; `interface ShareScope { buIds: string[]; locationIds: string[]; locationFiltered: boolean; range: ShareRange; widgets: ShareWidgetScope[]; offers: string[] }` (`offers` = kunci filter relasi yang ditawarkan ke penonton: subset `customer|item|stickerType|sticker`).
  - `interface DashboardShareDto { id: string; title: string; createdBy: string; createdAt: string; expiresAt: string; revokedAt: string; status: 'active'|'expired'|'revoked'; widgetCount: number; reportId: string; url?: string }`; `interface CreateShareInput { title: string; filter: DashboardFilterInput; locationFiltered?: boolean; range: ShareRange; widgets: ShareWidgetScope[]; offers: string[]; expiresInDays: number }`; `shareStatus(row: { expires_at: string; revoked_at: string }, nowIso: string)`.
- Produces (`share-repo.ts`): `interface ShareRow { id: string; title: string; created_by: string; created_at: string; expires_at: string; revoked_at: string; revoked_by: string; scope: string; report_id: string }`; `insertShareStmt(row: ShareRow): DbStatement`, `loadShare(db: Preparer, id: string): Promise<ShareRow | null>`, `listShares(db: Preparer): Promise<ShareRow[]>` (terbaru dahulu; tanpa terbitan laporan kecuali diminta lewat argumen `includeReport: boolean`), `countActiveShares(db: Preparer, creator: string, nowIso: string): Promise<number>` (tanpa `report_id <> ''`), `revokeShareStmt(id: string, by: string, nowIso: string): DbStatement`, `parseScope(raw: string): ShareScope | null`.

Skema `dashboard_shares`: `id VARCHAR(100)`, `title VARCHAR(255)`, `created_by VARCHAR(254)`, `created_at VARCHAR(30)`, `expires_at VARCHAR(30)`, `revoked_at VARCHAR(30) NOT NULL DEFAULT ''`, `revoked_by VARCHAR(254) NOT NULL DEFAULT ''`, `scope LONGTEXT`, `report_id VARCHAR(100) NOT NULL DEFAULT ''`; kunci `(created_by, revoked_at)` dan `(report_id)`; kolasi `utf8mb4_nopad_bin` (ikuti tabel lain di `0012`/`0015`); `CREATE TABLE IF NOT EXISTS`.

- [ ] **Step 1: Tulis tes yang gagal**: `shareStatus` → `revoked` bila `revoked_at` terisi, `expired` bila `expires_at <= now`, selain itu `active`; repo menyisip lalu memuat baris yang sama; `countActiveShares` tak menghitung baris dicabut, kedaluwarsa, dan `report_id <> ''`; `listShares` urut terbaru; `parseScope` mengembalikan `null` untuk JSON rusak atau widget tak dikenal; `revokeShareStmt` idempoten (cabut dua kali = tetap tercabut, `revoked_at` pertama dipertahankan); `bun run --cwd server test src/core/migrate` (tes migrasi yang ada) tetap hijau dan migrasi dapat dijalankan dua kali.
- [ ] **Step 2: Jalankan** → FAIL. **Step 3: Implementasi** migrasi, tipe, repo. **Step 4: Jalankan** `bun run --cwd shared test dashboard-share.test.ts` dan `bun run --cwd server test src/modules/dashboard/share-repo.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): tabel dashboard_shares dan repo`.

---

### Task 3: DTO publik berdaftar putih (`shared/dashboard-public.ts`)

**Files:**
- Create: `shared/dashboard-public.ts`
- Test: `shared/dashboard-public.test.ts`

**Interfaces:**
- Consumes: `WidgetData`, `WidgetMeta`, `widgetMeta` (Rencana 1 Tugas 2).
- Produces:
  - `PUBLIC_LIST_ROW_MAX = 10`.
  - `type PublicWidgetData = Omit<NumberData,'previous'> | PartsData | SeriesData | ListData` (tanpa `previous`).
  - `toPublicDto(id: WidgetId, data: WidgetData): PublicWidgetData` — number: buang `previous`; list: pertahankan HANYA kolom di `widgetMeta(id).listColumns` (baris dan kolom ekstra dibuang), potong ke `PUBLIC_LIST_ROW_MAX`, `total` tetap; parts/series: salin.
  - `interface PublicFilterOptions { bu: {value:string;label:string}[]; location: {value:string;label:string}[]; groups: Partial<Record<string, {value:string;label:string}[]>> }` (hanya nilai cakupan beku; `groups` hanya kunci relasi yang ditawarkan).
  - `interface PublicDashboardDto { title: string; sharedBy: string; generatedAt: string; expiresAt: string; range: DashboardRange; bucket: Bucket; scope: { buNames: string[]; locationNames: string[] }; options: PublicFilterOptions; widgets: { id: WidgetId; group: DashboardGroupId; result: { status: 'ok'; data: PublicWidgetData } | { status: 'error'; message: string } }[] }`.
  - `interface PublicQueryInput { buIds?: string[]; locationIds?: string[]; from?: string; to?: string; groups?: Partial<Record<DashboardGroupId, Record<string, string[]>>> }`.

- [ ] **Step 1: Tulis tes yang gagal**: `toPublicDto('hs.created', {kind:'number', value:3, previous:2})` tak punya properti `previous`; list dengan kolom ekstra (`note`, `email`) dan 15 baris → hanya kolom putih, 10 baris, `total` 15; `toPublicDto` untuk widget list yang kolom putihnya tak ada di data → kolom ada dengan nilai kosong, bukan galat; kunci objek `PublicDashboardDto.widgets[n]` tepat `id, group, result`.
- [ ] **Step 2: Jalankan** `bun run --cwd shared test dashboard-public.test.ts` → FAIL. **Step 3: Implementasi** murni. **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): DTO publik berdaftar putih`.

---

### Task 4: Layanan berbagi dan rute `dashboardShares.*`

**Files:**
- Create: `server/src/modules/dashboard/{share-service,share-validate,share-routes}.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `shared/api-versions.ts`, `shared/audit.ts`, `server/src/routes.ts`, `server/src/http/body.test.ts`, `shared/api-contract.snapshot.json`; tambahkan pembaca log untuk `dashboardShare` pada `activity.list` (cari pemuat per jenis di `server/src/modules/activity/`; gerbang = pemegang `dashboard: manage`)
- Test: `server/src/modules/dashboard/share-service.test.ts`, `share-rest.test.ts`

**Interfaces:**
- Consumes: Rencana 1 (`resolveScope`, `allowedWidgetIds`), Tugas 1-3 rencana ini.
- Produces:
  - Rute (semua `permission` global `dashboard: manage`): `dashboardShares.list` (`GET /dashboard-shares`, keluaran `DashboardShareDto[]`), `dashboardShares.create` (`POST /dashboard-shares`, 201, masukan `CreateShareInput`, keluaran `DashboardShareDto` dengan `url`), `dashboardShares.revoke` (`POST /dashboard-shares/{id}/revoke`, keluaran `{ ok: true }`).
  - `freezeScope(user: UserContext, input: CreateShareInput, nowMs: number): ShareScope` di `share-service.ts` (melempar `VALIDATION`): `buIds`/`locationIds` = hasil `resolveScope` (bukan masukan mentah): BU = `scope.buIds`; Lokasi = `locationFiltered` ? lokasi pilihan ∩ hak : gabungan `handoverLocationIds ∪ stockLocationIds` (hanya modul berlokasi dari widget terpilih); widget tak boleh di luar `allowedWidgetIds(user)`; `offers` ⊆ kunci relasi yang filternya dipilih pada widget grup terkait.
  - `shareUrl(env: Env, token: string): string` = `APP_ORIGIN + '/dashboard-publik/' + token` (cari cara modul lain, mis. digest Postel, membaca `APP_ORIGIN`).
  - Audit `dashboard.share_create` / `dashboard.share_revoke` (target `dashboard_share:<id>`, tanpa token); `ActivityKind` memuat `dashboardShare`.

- [ ] **Step 1: Tulis tes yang gagal**
  - **Review Focus 3:** pengguna berhak BU X; membagikan dengan filter BU kosong → `scope.buIds = [X]`; setelah itu pengguna ditambah BU Y, `scope.buIds` tersimpan tetap `[X]`.
  - Widget di luar hak pembuat → `VALIDATION`; > 30 widget → `VALIDATION`; `expiresInDays` 0 atau 366 → `VALIDATION`; judul kosong atau > 120 → `VALIDATION`; rentang tetap tak sah → `VALIDATION`.
  - Batas 50: tautan aktif ke-51 ditolak `CONFLICT`; tautan dicabut atau kedaluwarsa dan tautan `report_id <> ''` tak dihitung.
  - Izin: pengguna tanpa `dashboard: manage` → `FORBIDDEN` pada ketiga rute; `list` oleh pemegang `manage` lain memuat tautan orang lain TANPA `url`; `url` hanya untuk pembagi dan super admin; pemegang `manage` lain boleh `revoke` (`status` jadi `revoked`, idempoten); `revoke` id tak dikenal → `NOT_FOUND`.
  - `create` mengembalikan `url` yang diawali `APP_ORIGIN + '/dashboard-publik/v1.'` dan token lolos `verifyShareToken`; `expiresAt` = sekarang + hari terpilih (jam terkendali).
  - Audit tertulis tanpa token; `activity.list` untuk `dashboardShare` hanya terbaca pemegang `manage`.
  - `body.test.ts`: `dashboardShares.create` masuk tabel batas muatan.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/dashboard/share-service.test.ts src/modules/dashboard/share-rest.test.ts` → FAIL.
- [ ] **Step 3: Implementasi**; daftarkan id di kontrak, `API_ROUTES` (`dashboardShares`, tambah ke `API_GROUP_VERSIONS`), dan `getRoutes()`.
- [ ] **Step 4: Jalankan** `bun run api:snapshot`, lalu tes server terkait, `bun run --cwd shared test`, `bun run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): layanan dan rute berbagi dashboard`.

---

### Task 5: Mesin tampilan publik (`public-view.ts`)

**Files:**
- Create: `server/src/modules/dashboard/public-view.ts`
- Test: `server/src/modules/dashboard/public-view.test.ts`

**Interfaces:**
- Consumes: Rencana 1 (`resolveScope`, `allowedWidgetIds`, `runWidgets`, `widgetMeta`), Tugas 2-4.
- Produces:
  - `validatePublicQuery(input: unknown): PublicQueryInput` (maks. 20 nilai per filter, tanggal `YYYY-MM-DD`; kunci tak dikenal diabaikan).
  - `loadPublicDashboard(env: Env, share: ShareRow, viewer: PublicQueryInput, nowMs: number): Promise<PublicDashboardDto | null>`: `null` bila pembagi tak ditemukan/tak aktif (`loadUserContext`), tak memegang `dashboard: manage`, atau `scope` tak terbaca. Langkah: widget tautan ∩ `allowedWidgetIds(sharer)`; cakupan efektif = beku ∩ filter penonton (BU/Lokasi irisan; tanggal dijepit ke rentang beku — bergulir dihitung dari hari ini — lalu hari WIB penuh); filter grup: enum bebas, relasi hanya bila `offers` memuat kuncinya dan dalam nilai pembagi, sisanya abaikan; irisan kosong = **kosong, bukan semua** (kirim `[]` ke `resolveScope`); hitung dengan `resolveScope(sharer, ...)` lalu `runWidgets`; petakan lewat `toPublicDto`; isi `scope.buNames`/`locationNames`/`options` dari nama basis data.

- [ ] **Step 1: Tulis tes yang gagal** (tiap kasus memanggil `loadPublicDashboard` dan membandingkan dengan hasil tanpa filter penonton)
  - **Review Focus 1:** pembagi nonaktif → `null`; pembagi dicabut `dashboard: manage` → `null`; pembagi kehilangan izin widget Postel → widget itu hilang, lainnya ada; pembagi kehilangan BU Y → angka dari Y hilang; semuanya tanpa galat berbeda.
  - **Review Focus 2:** filter penonton `buIds=[Z-di-luar-beku]` → semua angka nol; `buIds=[X,Z]` → sama dengan `[X]`; `from` sebelum rentang beku dijepit ke awal beku; `to` sesudah dijepit; filter relasi `customer` yang tidak ditawarkan → diabaikan (hasil sama dengan tanpa filter); ditawarkan dengan nilai di luar pilihan pembagi → diabaikan; ditawarkan dan di dalam pilihan → mempersempit; sifat himpunan bagian diuji untuk setiap grup widget.
  - Rentang bergulir 7 hari dihitung dari `nowMs` (hari ini WIB).
  - Hasil tak memuat `previous` pada number dan list dipotong 10 baris dengan kolom putih saja.
  - `options` hanya memuat id/nama dalam himpunan beku; relasi tak ditawarkan tak muncul.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/dashboard/public-view.test.ts` → FAIL. **Step 3: Implementasi.** **Step 4: Jalankan** → PASS; `soft-delete-guard.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): mesin tampilan publik terisolasi`.

---

### Task 6: Rute publik, pembatas laju, dan pemasangan

**Files:**
- Create: `server/src/modules/dashboard/{public-limits,public-routes}.ts`
- Modify: `server/src/app.ts` (pasang sub-aplikasi sebelum fallback statis, seperti `publicSerialApp`)
- Test: `server/src/modules/dashboard/public-routes.test.ts`

**Interfaces:**
- Consumes: Tugas 1, 2, 5.
- Produces: `publicDashboardApp` (Hono) dengan `GET /api/public/dashboards/:token` (keluaran `PublicDashboardDto`) dan `POST /api/public/dashboards/:token/query` (badan JSON `PublicQueryInput`, keluaran `PublicDashboardDto`); `hitLimit(env: Env, key: string, limit: number, windowMs: number): Promise<boolean>` (true = lewat batas) di `public-limits.ts`, memakai `rate_limits` dengan pola upsert `public-routes.ts` Serial.

Urutan per permintaan: panjang token → verifikasi tanda tangan (tanpa DB) → cek pembatas kegagalan per IP → muat baris (`loadShare`; tak ada/dicabut/kedaluwarsa = kegagalan dicatat) → pembatas keberhasilan (IP 30/menit, token 120/menit; hanya `POST query`) → `loadPublicDashboard` (null = 404 seragam). Pesan 404 dan respons 429 seragam; header `no-store`, `no-referrer`, `X-Robots-Tag: noindex`. Verifikasi bagaimana `csrfGuard` dipasang (`server/src/http/security.ts` dan pemasang di `app.ts`/`server.ts`): `POST` publik mengirim header CSRF yang sama dengan klien REST (`CSRF_HEADER`) dan tes memastikan perilaku nyata; bila guard terpasang global, pertahankan dan klien menambahkannya.

- [ ] **Step 1: Tulis tes yang gagal** (`app.request` ke aplikasi nyata dengan `createTestEnv`)
  - 404 identik (status, badan) untuk: token acak, token dikutak-katik, token kedaluwarsa, baris dicabut, pembagi nonaktif, pembagi kehilangan `manage`.
  - Pembatas kegagalan: percobaan ke-21 dari IP sama dalam 10 menit → 429; tautan sah dari IP yang sama tidak diblokir oleh jalur kegagalan.
  - **Review Focus 5:** 31 `POST query` dari satu IP dalam semenit (tanggal berbeda tiap kali) → yang ke-31 mendapat 429; 121 dengan token sama dari IP berbeda → ke-121 429; jendela berikutnya pulih.
  - Header pada 200 dan 404: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; parameter query tak dikenal pada GET tak mengubah hasil; badan POST tak sah → 400 problem+json; badan > 16 KB ditolak; widget di luar tautan tak muncul pada respons.
  - End-to-end isolasi: tautan BU X, `POST query` dengan `buIds=[Y]` → angka nol dan bentuk respons sama.
  - `GET` tak mengandung `previous` dan list ≤ 10 baris kolom putih.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/dashboard/public-routes.test.ts` → FAIL. **Step 3: Implementasi** dan pasang di `app.ts`. **Step 4: Jalankan** tes ini + `bun run --cwd server test src/modules/serial/public-routes.test.ts src/app.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): rute publik tautan dashboard`.

---

### Task 7: UI membagikan di aplikasi

**Files:**
- Create: `web/src/modules/dashboard/components/{scope-editor,share-dialog,shares-dialog}.tsx`, `web/src/modules/dashboard/share-queries.ts`
- Modify: `web/src/modules/dashboard/components/dashboard-page.tsx` (aksi "Bagikan" dan "Tautan dibagikan" hanya bila `canAnywhere(me, 'dashboard', 'manage')`)
- Test: `web/src/modules/dashboard/components/share-dialog.test.tsx`, `shares-dialog.test.tsx`

**Interfaces:**
- Consumes: Rencana 1 (filter global, `GROUP_FILTERS`, `WIDGETS`), Tugas 4.
- Produces:
  - `ScopeEditor({ value: ScopeEditorValue; onChange(v: ScopeEditorValue): void; allowedWidgetIds: readonly WidgetId[] })` dengan `ScopeEditorValue = { buIds: string[]; locationIds: string[]; widgets: ShareWidgetScope[]; offers: string[] }` — komponen bersama yang juga dipakai form Laporan terjadwal (Rencana 3): chip BU/Lokasi (`LinkMultiField`), daftar centang widget per grup (hanya `allowedWidgetIds`), filter grup per widget terpilih (relasi `LinkMultiField`, enum `MultiSelect`), dan saklar "Penonton boleh mempersempit <filter>" per filter relasi yang dipilih.
  - `ShareDialog` (`FormDialogShell size="lg"`, formId `share-dialog`): judul, `ScopeEditor` (awal = filter dashboard aktif), mode rentang (tetap dari filter aktif / bergulir N hari), masa berlaku (7/30/90/180/365 hari atau tanggal kustom, bawaan 30), peringatan bila ada widget daftar ("Baris data (mis. nama customer, nomor serial) akan terlihat oleh siapa pun yang memegang tautan"), ringkasan "Terlihat oleh siapa pun yang memegang tautan: periode …, BU …, Lokasi …, N widget", tombol Simpan memanggil `dashboardShares.create` lalu menampilkan tautan dengan tombol salin.
  - `SharesDialog`: tabel (nama, pembagi, dibuat, kedaluwarsa, status `Badge`), aksi "Salin tautan" hanya bila `url` ada, "Cabut" (`ConfirmDeleteDialog`); aksi massal tidak ada.
  - `share-queries.ts`: `sharesQueryOptions()`, `useCreateShare()`, `useRevokeShare()` (mutasi memasang hasil ke cache/invalidasi `['dashboard','shares']`).

- [ ] **Step 1: Tulis tes yang gagal**: tombol "Bagikan" tak ada tanpa `dashboard: manage`; dialog menolak simpan tanpa judul/widget dengan pesan inline; hanya widget yang diizinkan muncul di daftar centang; widget daftar memicu peringatan; kirim memanggil `dashboardShares.create` dengan `buIds`/`locationIds` dari filter aktif dan `expiresInDays` 30; tautan hasil dapat disalin (clipboard dipalsukan); `SharesDialog` menyembunyikan "Salin tautan" untuk baris tanpa `url` dan menampilkan status dengan teks (bukan hanya warna); mencabut menampilkan konfirmasi lalu memanggil `dashboardShares.revoke`; saklar "penonton boleh mempersempit" hanya untuk filter relasi yang terisi.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/dashboard/components/share-dialog.test.tsx src/modules/dashboard/components/shares-dialog.test.tsx` → FAIL. **Step 3: Implementasi.** **Step 4: Jalankan** + `bun run --cwd web test src/modules/dashboard`, typecheck → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): dialog bagikan dan daftar tautan`.

---

### Task 8: Halaman publik `/dashboard-publik/$token`

**Files:**
- Create: `web/src/routes/dashboard-publik.$token.tsx`, `web/src/modules/dashboard-public/{public-api,public-page,public-filters}.tsx` (+ `queries.ts`)
- Test: `web/src/modules/dashboard-public/public-page.test.tsx`; ikuti `web/src/routes/-laporan.test.tsx` untuk pola rute publik di luar `_app`

**Interfaces:**
- Consumes: `PublicDashboardDto`, `PublicQueryInput` (Tugas 3), `WidgetCard`/`WidgetRenderer` (Rencana 1).
- Produces: `publicDashboardQuery(token: string, viewer: PublicQueryInput)` (GET bila `viewer` kosong, selain itu POST `query` dengan header CSRF yang dipakai klien REST; `refetchInterval: 60_000` saat tab terlihat; galat 404/429 → keadaan "Tautan tidak berlaku atau terlalu banyak permintaan"); `PublicDashboardPage` (rute di luar `_app`: tanpa navigasi, tanpa boot sesi, `<meta name="robots" content="noindex">`, tema terang/gelap): kepala (judul, periode, nama BU/Lokasi cakupan, "Diperbarui <waktu>", "Dibagikan oleh <sharedBy>", "Tautan berlaku sampai <tanggal>") lalu grup widget; bar filter hanya menawarkan `options` DTO (chip BU, Lokasi, Tanggal dijepit ke rentang, filter relasi yang ditawarkan, filter enum grup); filter penonton ada di search param halaman; `WidgetCard` memakai penanda yang sama (tanpa delta).

- [ ] **Step 1: Tulis tes yang gagal**: render memuat kepala dengan nama BU/Lokasi cakupan dan `sharedBy`; tidak ada elemen navigasi aplikasi, lonceng, atau menu pengguna; chip filter hanya memuat opsi dari `options` (BU di luar `options.bu` tak bisa dipilih); memilih rentang tanggal memanggil POST `query` dengan header CSRF dan `from`/`to`; filter relasi yang tak ditawarkan tidak dirender; 404 → pesan tautan tak berlaku tanpa membocorkan sebab; 429 → pesan "terlalu banyak permintaan"; widget tanpa delta; `<meta name="robots">` terpasang; tidak ada panggilan ke `/api/v1`.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/dashboard-public src/routes` → FAIL. **Step 3: Implementasi**; pastikan `route-meta-coverage.test.ts` dan `web/src/main.tsx` (jalur boot publik seperti `/laporan/`) mengenali rute baru (cari bagaimana `/laporan/` dikecualikan dari boot sesi dan tiru). **Step 4: Jalankan** `bun run --cwd web test`, `bun run --cwd web typecheck`, `bun run scripts/test-scripts.ts` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): halaman publik dashboard`.

---

### Task 9: Dokumentasi, changelog, dan verifikasi

**Files:**
- Modify: `server/changelog.d/20261123-dashboard.md` (tambah baris `feat(dashboard): tautan publik dashboard dengan cakupan terisolasi dan filter penonton`), `CLAUDE.md` (bagian Kabel REST: tambah `/api/public/dashboards` ke daftar pengecualian rute publik bertoken; bagian Dashboard: model berbagi, token, cakupan beku, izin `manage`, pembatas laju, langkah manual nginx), `docs/ci-cd.md` (langkah manual VPS: perluas `qc_masked` ke `/dashboard-publik/` sebelum merge)

- [ ] **Step 1:** Perbarui dokumen. **Step 2: Verifikasi penuh**: `bun run check` (tunnel hidup) hijau; `bun run build` hijau (`verify-dist`).
- [ ] **Step 3: Verifikasi manual** lewat server dev: buat tautan dari `/dashboard`, buka di jendela tanpa sesi (navigasi tersendiri), pastikan hanya cakupan itu yang tampil, persempit filter, cabut tautan dan muat ulang → "tidak berlaku"; tanpa galat konsol; ponsel 393 px.
- [ ] **Step 4: Commit** `docs(dashboard): catat tautan publik dashboard`.
