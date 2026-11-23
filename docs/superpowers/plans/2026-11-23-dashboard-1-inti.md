# Dashboard 1 — Mesin widget dan halaman di aplikasi: rencana implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna login membuka `/dashboard`: 27 widget (kartu angka, donut/pie, line, bar, Quick List) per grup modul, disaring izin + BU + Lokasi, dengan filter global (BU, Lokasi, Tanggal) dan filter per grup.

**Architecture:** Registry metadata murni di `shared/dashboard.ts`; SQL tiap widget literal di `server/src/modules/dashboard/widgets/*.ts` (aturan soft delete); satu rute `dashboard.query` menghitung widget yang boleh dilihat pengguna lewat `resolveScope` (satu-satunya tempat irisan hak). Web merender dari registry dengan komponen `chart` shadcn (recharts) yang dimuat malas.

**Tech Stack:** Bun + Hono + MariaDB (server), React 19 + TanStack Query/Router + shadcn `chart` (recharts) (web), `shared/` murni.

**Spec:** `docs/superpowers/specs/2026-11-23-dashboard-design.md` (bagian 1-6, 8, 9, 10). Rencana lanjutan: `2026-11-23-dashboard-2-tautan-publik.md`, `2026-11-23-dashboard-3-laporan-terjadwal.md`. Ketiganya dikerjakan berurutan pada SATU cabang/PR; rencana ini sendiri harus hijau (`bun run check`) di akhir.

## Global Constraints

- Rentang tanggal: hari WIB penuh, maksimum **366 hari**, bawaan **30 hari terakhir** (berakhir hari ini); granularitas deret: **harian jika <= 31 hari, mingguan jika <= 180 hari, selain itu bulanan**.
- Filter: BU/Lokasi/Tanggal global; field filter grup TIDAK BOLEH `bu`, `location`, atau `date`. Maks. **20 nilai** per filter (`FILTER_LIST_MAX`, `server/src/core/validate.ts`; salinan web `web/src/lib/filter-limits.ts`). `undefined` = semua yang boleh dibaca; **`[]` = tidak ada** (bukan semua).
- `dashboard.query`: maks. **30 widget** per permintaan; **semafor global per proses, maks. 6 widget bersamaan** (diubah pemilik 2026-11-23, K10; semula 4 per permintaan), batas waktu 15 detik dihitung setelah slot diperoleh; cache hasil **30 detik**; penyegaran web **60 detik**; query dashboard TIDAK masuk `query-persist`.
- Quick List di aplikasi: **10 baris**; top-N grafik: **10**; grafik maks. 6 kategori + "Lainnya".
- Soft delete: tiap kueri widget adalah **literal** dengan `${liveWhere('alias')}` di dalamnya; DILARANG pembangun kueri generik atau `FROM ${...}` dinamis; `soft-delete-guard.test.ts` tidak boleh mendapat entri baru di `SOFT_DELETE_PENDING`.
- BU Serial/Laporan = **BU saat ini** (`serials.bu_id`, `serial_cases.bu_id`), bukan riwayat. Stok menipis/habis **per pasangan stiker×lokasi** (K5), hanya stiker aktif dan baris yang ada di `sticker_stock`.
- Waktu: kolom ISO UTC (`created_at`, `completed_at`, `sticker_stock_entries.ts`) dibandingkan dengan batas WIB yang dikonversi ke UTC (`wibRangeToUtc`); kolom tanggal WIB (`opened_on`, `closed_on`, `transit_on`) dibandingkan langsung.
- ID baris selalu `newId()` (`server/src/core/id.ts`). Tanpa variabel `.env` baru. Teks UI santai, "Serial Number" lengkap pada judul.
- Aturan web: field relasi memakai `LinkField`/`LinkMultiField`, enum `Select`/`MultiSelect` (tanpa `<select>`); halaman memakai `HeadroomFrame`/`HeadroomBar` (halaman agregat = `ROUTE_EXCEPTIONS` di `scripts/page-frame.test.ts` dengan alasan); warna dari token semantik yang ada, status tak hanya warna; kontras AA (`web/src/styles.contrast.test.ts` tetap hijau).
- Tes server memakai MariaDB lewat tunnel (`bun run db:tunnel` harus hidup); satu berkas: `bun run --cwd server test src/modules/dashboard`. Tes web: `bun run --cwd web test <jalur>`. Tes shared: `bun run --cwd shared test <berkas>`.
- **Commit hanya setelah pengguna mengizinkan** (aturan sesi); langkah "Commit" di bawah dijalankan pada saat izin itu ada. Pesan commit bergaya `feat(dashboard): ...`.

## Review Focus

Masukan yang tersirat spek tetapi mudah luput; tiap baris punya tes di tugas pemilik kodenya:
1. Pengguna tanpa penugasan BU/Lokasi, atau filter `[]`, harus mendapat **nol**, bukan semua (Tugas 3).
2. Serial yang sudah pindah BU tidak terhitung di BU lamanya; serial/task/laporan terhapus tidak terhitung (Tugas 5-7).
3. Kejadian 23:30 UTC jatuh ke hari WIB berikutnya; rentang `from > to`, > 366 hari, atau > 20 nilai filter ditolak `VALIDATION` (Tugas 2-4).
4. Stiker tanpa baris stok di sebuah lokasi tidak dianggap "habis" di sana; stiker nonaktif tak dihitung (Tugas 8).
5. Satu widget yang gagal atau lambat tidak menjatuhkan widget lain dan tidak membocorkan pesan galat mentah (Tugas 4).

## File Structure

- Create `shared/dashboard.ts` (+ `.test.ts`): registry, DTO, filter, rentang.
- Modify `shared/contract.ts`, `shared/api.ts`, `shared/api-versions.ts`, `shared/api-contract.snapshot.json`: dua rute baru.
- Modify `shared/permissions.ts`, `shared/assignments.ts`: modul `dashboard`.
- Create `server/src/modules/dashboard/`: `scope.ts`, `registry.ts`, `engine.ts`, `cache.ts`, `validate.ts`, `options.ts`, `routes.ts`, `widgets/{handover,serial,report,sticker,postel}.ts` (+ tes).
- Create `server/test-support/dashboard-seed.ts`: penyisip data uji.
- Modify `server/src/routes.ts` (daftar rute), `server/src/http/body.test.ts`.
- Create `web/src/modules/dashboard/` (`queries.ts`, `lib/*`, `components/**`), `web/src/routes/_app/dashboard/index.tsx`; modify `web/src/app/navigation.ts`, `web/src/app/module-links.ts`, `scripts/page-frame.test.ts`, `web/src/modules/guide/catalog/module-coverage.test.ts`.
- Create `server/changelog.d/20261123-dashboard.md`; modify `CLAUDE.md`.

---

### Task 1: Modul izin `dashboard`

**Files:**
- Modify: `shared/permissions.ts`, `shared/assignments.ts`, `web/src/app/module-links.ts`, `web/src/modules/guide/catalog/module-coverage.test.ts`
- Test: `shared/permissions.test.ts`, `shared/assignments.test.ts`; perbaiki ekspektasi di berkas lain yang menghitung `MODULES` (cari: `grep -rln "stickerstock" --include=*.test.ts --include=*.test.tsx`, mis. `server/src/routes.test.ts`, `web/src/modules/access/components/role-form.test.tsx`, `web/src/modules/auth/permissions.test.ts`, `server/scripts/seed-data.ts` bila perlu).

**Interfaces:**
- Produces: `ModuleKey` memuat `'dashboard'`; `MODULE_LEVELS.dashboard = ['none','manage']`; `SHARED_MODULES` memuat `'dashboard'`; `MODULE_LINKS.dashboard = '/dashboard'`.

- [ ] **Step 1: Tulis tes yang gagal**
  - `shared/permissions.test.ts`: `levelsFor('dashboard')` sama dengan `['none','manage']`; `MODULE_LABELS.dashboard === 'Dashboard'`.
  - `shared/assignments.test.ts`: pengguna dengan role `dashboard: manage` yang hanya ditugaskan di SATU lokasi (bukan "Semua lokasi") memiliki izin global `dashboard === 'manage'` lewat `resolveAccess` (perilaku `SHARED_MODULES`).
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd shared test permissions.test.ts assignments.test.ts` → FAIL.
- [ ] **Step 3: Implementasi**: tambah `'dashboard'` ke `MODULES`, `MODULE_LABELS` ("Dashboard"), `MODULE_LEVELS` (`none`,`manage`), `MODULE_LEVEL_HINTS.dashboard.manage` = "Membagikan dashboard secara publik, mengelola laporan terjadwal, dan mencabut tautan. Melihat dashboard cukup dengan izin modul sumber datanya."; tambah ke `SHARED_MODULES`; `MODULE_LINKS.dashboard = '/dashboard'`; tambah `'dashboard'` ke `MODULES_WITHOUT_GUIDE_YET` (komentar: panduan interaktif di luar cakupan v1).
- [ ] **Step 4: Perbaiki tes lain yang menghitung modul** lalu jalankan `bun run --cwd shared test`, `bun run --cwd server test src/routes.test.ts`, `bun run --cwd web test src/modules/access src/modules/auth src/modules/guide src/app/navigation.test.ts` → semua PASS.
- [ ] **Step 5: Commit** `feat(dashboard): modul izin dashboard`.

---

### Task 2: Registry, DTO, dan fungsi rentang (`shared/dashboard.ts`)

**Files:**
- Create: `shared/dashboard.ts`
- Test: `shared/dashboard.test.ts`

**Interfaces:**
- Produces (nama persis, dipakai tugas berikutnya dan rencana 2-3):
  - `DASHBOARD_GROUPS = ['handover','serial','report','sticker','postel'] as const`, `type DashboardGroupId`, `GROUP_LABELS: Record<DashboardGroupId,string>` ("Serah Terima", "Serial Number", "Laporan rusak", "Stok Stiker", "Postel").
  - `WIDGET_IDS` (27 id dari tabel Tugas 5-8), `type WidgetId`, `type WidgetVisual = 'number'|'donut'|'pie'|'line'|'bar'|'barH'|'barGroup'|'list'`.
  - `interface WidgetMeta { id: WidgetId; group: DashboardGroupId; visual: WidgetVisual; title: string; access: WidgetAccess; bu: boolean; location: 'handover'|'stock'|'serial'|'none'; date: { kind: 'none' } | { kind: 'column'; label: string }; delta: boolean; listColumns?: readonly { key: string; label: string }[] }`
  - `type WidgetAccess = readonly { module: ModuleKey; level: Level; scope: 'location'|'bu'|'global' }[]` (arti: salah satu terpenuhi).
  - `WIDGETS: readonly WidgetMeta[]`, `widgetMeta(id: WidgetId): WidgetMeta`.
  - `interface GroupFilterField { key: string; label: string; kind: 'enum'|'relation'; options?: readonly { value: string; label: string }[]; relation?: 'customer'|'item'|'stickerType'|'sticker' }`, `GROUP_FILTERS: Record<DashboardGroupId, readonly GroupFilterField[]>`, `GLOBAL_FILTER_KEYS = ['bu','location','date'] as const`.
  - `interface DashboardRange { from: string; to: string }` (`YYYY-MM-DD` WIB inklusif); `DASHBOARD_RANGE_MAX_DAYS = 366`; `type Bucket = 'day'|'week'|'month'`.
  - `validateDashboardRange(range: DashboardRange): string | null` (pesan galat atau null); `bucketFor(range): Bucket`; `wibRangeToUtc(range): { fromIso: string; toIso: string }` (`toIso` eksklusif); `previousRange(range): DashboardRange` (periode sebelumnya sama panjang); `type RangePreset = 'last7'|'last30'|'thisMonth'|'lastMonth'`; `rangePreset(preset, todayWib: string): DashboardRange`.
  - DTO: `NumberData {kind:'number'; value:number; previous?:number}`, `PartsData {kind:'parts'; slices:{key:string;label:string;value:number}[]}`, `SeriesData {kind:'series'; bucket:Bucket; points:{key:string;label:string}[]; series:{key:string;label:string;values:number[]}[]}`, `ListData {kind:'list'; columns:{key:string;label:string}[]; rows:Record<string,string|number>[]; total:number}`, `type WidgetData = NumberData|PartsData|SeriesData|ListData`, `type WidgetResult = {id:WidgetId; status:'ok'; data:WidgetData} | {id:WidgetId; status:'error'; message:string}`.
  - Input/output kontrak: `DashboardFilterInput {buIds?:string[]; locationIds?:string[]; from:string; to:string}`, `DashboardWidgetRequest {id:WidgetId; filters?:Record<string,string[]>}`, `DashboardQueryInput {filter:DashboardFilterInput; widgets:DashboardWidgetRequest[]}`, `DashboardQueryOutput {generatedAt:string; range:DashboardRange; bucket:Bucket; widgets:WidgetResult[]}`, `DashboardOption {value:string; label:string}`, `DashboardOptionsDto {customers:DashboardOption[]; items:DashboardOption[]; stickerTypes:DashboardOption[]; stickers:DashboardOption[]}`.

Isi `GROUP_FILTERS` (nilai dari spek 5.3): handover = Customer (relation `customer`), Status papan (enum `new|in_progress|done|cancelled` berlabel Baru/Dikerjakan/Selesai/Dibatalkan); serial = Status (enum 7 status serial dari `shared/serials.ts`), Kustodi (enum `qc|transit|service`), Item (relation `item`); report = Status laporan (enum `open|closed`), Hasil (enum `broken|passed`); sticker = Jenis stiker (relation `stickerType`), Stiker (relation `sticker`); postel = Kondisi (enum `active|expiring|expired`). Isi `WIDGETS` menyalin tabel spek bagian 6 (id, visual, `access`, `bu`/`location`/`date`/`delta`, `listColumns` = kolom putih tiap list).

- [ ] **Step 1: Tulis tes yang gagal** (`shared/dashboard.test.ts`)
  - `WIDGET_IDS` unik dan berjumlah 25; tiap grup punya >= 1 widget; `widgetMeta(id).id === id` untuk semua.
  - Tak ada `GroupFilterField.key` bernilai salah satu `GLOBAL_FILTER_KEYS`.
  - `bucketFor`: rentang 31 hari → `day`, 32 → `week`, 180 → `week`, 181 → `month`.
  - `validateDashboardRange`: `{from:'2026-11-10',to:'2026-11-09'}` → string; 367 hari → string; `'2026-13-01'` → string; 366 hari sah → `null`.
  - `wibRangeToUtc({from:'2026-11-17',to:'2026-11-17'})` = `{fromIso:'2026-11-16T17:00:00.000Z', toIso:'2026-11-17T17:00:00.000Z'}`.
  - `previousRange({from:'2026-11-17',to:'2026-11-23'})` = `{from:'2026-11-10',to:'2026-11-16'}`.
  - `rangePreset('last7','2026-11-23')` = 17-23 Nov; `lastMonth` pada `'2026-01-15'` = 1-31 Des 2025.
  - Widget ber-`visual: 'list'` punya `listColumns`, dan tak ada kolom bernama `note`, `comment`, `email`, `file`, `actor`.
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd shared test dashboard.test.ts` → FAIL.
- [ ] **Step 3: Implementasi** `shared/dashboard.ts` murni (tanpa DOM/`URL`/`fetch`). Aritmetika tanggal dengan `Date.UTC` (WIB = UTC+7 tetap). Impor `ModuleKey`/`Level` dari `./permissions`.
- [ ] **Step 4: Jalankan** → PASS; `bun run --cwd shared typecheck`.
- [ ] **Step 5: Commit** `feat(dashboard): registry widget dan fungsi rentang`.

---

### Task 3: Resolusi cakupan dan izin widget (`scope.ts`)

**Files:**
- Create: `server/src/modules/dashboard/scope.ts`
- Test: `server/src/modules/dashboard/scope.test.ts`

**Interfaces:**
- Consumes: Tugas 2 (`DashboardFilterInput`, `widgetMeta`, `WIDGETS`, `wibRangeToUtc`, `previousRange`, `bucketFor`, `validateDashboardRange`), `readableBuIds(user)` (`server/src/modules/serial/access.ts`), `UserContext`.
- Produces:
  - `interface ResolvedScope { range: DashboardRange; bucket: Bucket; fromIso: string; toIso: string; prevFromIso: string; prevToIso: string; today: string; buIds: string[]; handoverLocationIds: string[]; stockLocationIds: string[]; serialLocationIds: string[] | null }`
  - `resolveScope(user: UserContext, filter: DashboardFilterInput, nowMs: number): ResolvedScope` — melempar `appError('VALIDATION', ...)` untuk rentang tak sah atau > 20 nilai.
  - `widgetAllowed(user: UserContext, meta: WidgetMeta): boolean`; `allowedWidgetIds(user: UserContext): WidgetId[]`.

Aturan: `buIds` = `readableBuIds(user)` ∩ `filter.buIds` (bila diberikan; `[]` → kosong). `handoverLocationIds` = lokasi `user.locations` dengan `handover >= view` ATAU `qc >= edit`, ∩ `filter.locationIds`. `stockLocationIds` = lokasi dengan `stickerstock >= view`, ∩ filter. `serialLocationIds` = `null` bila `filter.locationIds` tak diberikan, selain itu daftar itu (sudah dibatasi >= bentuk id, tanpa irisan hak: lokasi bukan batas hak Serial). Akses widget: `scope:'location'` → ada minimal satu lokasi dengan level itu; `'bu'` → `readableBuIds` untuk `serial`/`serialservice` tidak kosong; `'global'` → `user.permissions[module]` memenuhi level (`sticker` view untuk Postel). Super admin: semua lolos lewat `UserContext` yang sudah memuat semua izin.

- [ ] **Step 1: Tulis tes yang gagal**
  - Matriks akses: pengguna hanya `handover: view` di lokasi A → `allowedWidgetIds` hanya widget grup handover; pengguna hanya `serialservice: view` pada BU X → grup serial dan report; pengguna `sticker: view` global saja → hanya Postel.
  - **Review Focus 1:** pengguna tanpa penugasan → semua `buIds`/`*LocationIds` kosong; `filter.buIds = []` untuk pengguna yang berhak atas BU X → `buIds = []`; `filter.locationIds=['lokasi-di-luar-hak']` → `handoverLocationIds = []`.
  - Irisan: pengguna berhak BU X dan Y, filter `[Y,Z]` → `[Y]`.
  - Rentang: `from > to` → `VALIDATION`; 367 hari → `VALIDATION`; filter 21 BU → `VALIDATION`.
  - `today` dari `nowMs` (WIB); `prevFromIso`/`prevToIso` sesuai `previousRange`.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/dashboard/scope.test.ts` → FAIL.
- [ ] **Step 3: Implementasi** `scope.ts` sesuai aturan di atas; bangun `UserContext` uji lewat helper yang sudah dipakai `server/src/modules/serial/access.test.ts` (tiru, jangan mengubahnya).
- [ ] **Step 4: Jalankan** → PASS; `bun run --cwd server typecheck`.
- [ ] **Step 5: Commit** `feat(dashboard): resolusi cakupan dan izin widget`.

---

### Task 4: Mesin, rute `dashboard.query` dan `dashboard.options`

**Files:**
- Create: `server/src/modules/dashboard/{registry,engine,cache,validate,options,routes}.ts`, `server/test-support/dashboard-seed.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `shared/api-versions.ts`, `server/src/routes.ts`, `server/src/http/body.test.ts`, `shared/api-contract.snapshot.json` (via `bun run api:snapshot`)
- Test: `server/src/modules/dashboard/{engine,rest}.test.ts`, `shared/api.test.ts` (tetap hijau)

**Interfaces:**
- Consumes: Tugas 2-3.
- Produces:
  - `interface WidgetCtx { db: Preparer; scope: ResolvedScope; filters: Record<string, string[]> }`; `interface WidgetImpl { id: WidgetId; run(ctx: WidgetCtx): Promise<WidgetData> }`.
  - `WIDGET_IMPLS: Map<WidgetId, WidgetImpl>` dan `registerWidgets(impls: readonly WidgetImpl[]): void` di `registry.ts` (diisi Tugas 5-8; tes memakai registri sendiri).
  - `runWidgets(env: Env, scope: ResolvedScope, requests: readonly DashboardWidgetRequest[], impls?: ReadonlyMap<WidgetId, WidgetImpl>): Promise<WidgetResult[]>` di `engine.ts`: 4 bersamaan, batas waktu 15 dtk per widget, galat → `{status:'error', message:'Widget tidak dapat dimuat'}` (pesan generik; galat asli ke `console.error` tanpa data), cache 30 dtk per kunci `JSON.stringify([id, scope, filters])` memakai `nowOf(env)`. Tidak memeriksa izin (pemanggil menyaring dengan `allowedWidgetIds`).
  - `createTtlCache<T>(ttlMs: number, now: () => number)` di `cache.ts`.
  - Rute `dashboard.query` (`POST /dashboard/query`) dan `dashboard.options` (`GET /dashboard/options`) di `routes.ts` tanpa `permission` modul (pola `notificationRoutes`); `dashboardRoutes(): Pick<RouteTable, 'dashboard.query'|'dashboard.options'>`.
  - `validateDashboardQuery` di `validate.ts`: maks. 30 widget; id harus dikenal; kunci filter harus terdaftar di `GROUP_FILTERS` grup widget itu; nilai enum harus anggota `options`; maks. 20 nilai (`readFilterList`); `filter` lolos `validateDashboardRange`.
  - `loadOptions(env, user): Promise<DashboardOptionsDto>` (diubah pemilik 2026-11-23, K9: halaman 50, pencarian `query`, `cursor`, `ids` di server; semula maks. 500 per daftar; tetap literal + `liveWhere`): customer (jika berhak handover), item (jika berhak serial; hanya item pada BU yang boleh dibaca), jenis stiker dan stiker (jika berhak stok stiker atau `sticker: view`).
  - Penyisip uji di `server/test-support/dashboard-seed.ts`: `seedHandover(env, row)`, `seedSerial(env, row)`, `seedCase(env, row)`, `seedStock(env, row)`, `seedPostel(env, row)` (bentuk argumen mengikuti kolom tabel; semua kolom opsional punya bawaan).

- [ ] **Step 1: Tulis tes yang gagal**
  - `engine.test.ts` (registri tiruan): empat widget berurutan tidak pernah > 4 berjalan bersamaan; satu widget melempar → hasilnya `status:'error'` dengan pesan generik dan yang lain `ok` (**Review Focus 5**); satu widget melebihi batas waktu → `error`; permintaan sama dalam 30 dtk (jam terkendali `env.clock`) tidak menjalankan ulang, setelah 31 dtk menjalankan ulang.
  - `rest.test.ts` (via `restClient`): `POST /dashboard/query` tanpa sesi → 401; id widget tak dikenal → `VALIDATION`; filter grup berkunci `bu` → `VALIDATION`; 31 widget → `VALIDATION`; pengguna tanpa izin widget tertentu → widget itu tidak ada di keluaran; `GET /dashboard/options` hanya memuat daftar yang boleh dibaca pengguna (pengguna hanya handover → `items`, `stickers` kosong).
  - `body.test.ts`: tambah `dashboard.query` ke tabel batas muatan JSON (muatan sah terbesar 30 widget × filter 20 nilai < 2 MB).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/dashboard` → FAIL.
- [ ] **Step 3: Implementasi** semua file di atas. Daftarkan id di `ApiContract` (`shared/contract.ts`), `API_ROUTES` (`shared/api.ts`: `dashboard.query` POST `/dashboard/query`; `dashboard.options` GET `/dashboard/options`), `API_GROUP_VERSIONS.dashboard = { latest: 1, deprecated: [] }`, dan gabungkan `dashboardRoutes()` ke `getRoutes()` di `server/src/routes.ts`.
- [ ] **Step 4: Jalankan** `bun run api:snapshot`, lalu `bun run --cwd server test src/modules/dashboard src/http/body.test.ts` dan `bun run --cwd shared test api.test.ts api-snapshot.test.ts` → PASS; `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(dashboard): mesin widget dan rute query/options`.

---

### Task 5: Widget Serah Terima (8)

**Files:**
- Create: `server/src/modules/dashboard/widgets/handover.ts`
- Test: `server/src/modules/dashboard/widgets/handover.test.ts`
- Modify: `server/src/modules/dashboard/registry.ts` (daftarkan `HANDOVER_WIDGETS`)

**Interfaces:**
- Consumes: Tugas 2-4. Produces: `HANDOVER_WIDGETS: readonly WidgetImpl[]`.

Semua kueri membatasi `h.location_id IN (scope.handoverLocationIds)` (kosong → hasil nol tanpa menjalankan SQL), `liveWhere('h')`, dan filter grup `customer` (`h.customer_id IN`) serta `status` (`h.board_status IN`). Tanggal: `created_at` kecuali dinyatakan lain.

| Id | Visual | Isi |
|---|---|---|
| `hs.created` | number (delta) | jumlah task `created_at` dalam rentang (termasuk yang dibatalkan); `previous` = rentang sebelumnya |
| `hs.active` | number | `board_status IN ('new','in_progress')`, tanpa rentang |
| `hs.status` | donut | jumlah per `board_status` pada rentang `created_at`; label Baru/Dikerjakan/Selesai/Dibatalkan |
| `hs.trend` | line | seri "Dibuat" per `created_at` dan "Selesai" per `completed_at`, per bucket WIB |
| `hs.byLocation` | bar | per lokasi (nama dari `locations`), rentang `created_at` |
| `hs.byCustomer` | barH | 10 customer teratas (`customer_name`), rentang `created_at` |
| `hs.avgDuration` | number | rata-rata (`completed_at` − `created_at`) dalam jam untuk `completed_at` dalam rentang; 0 bila tak ada |
| `hs.oldest` | list | 10 task aktif terlama: kolom `number`, `customer`, `location`, `age` (hari), `progress` ("checked/total"); `total` = jumlah task aktif |

- [ ] **Step 1: Tulis tes yang gagal** (`handover.test.ts`, data lewat `seedHandover`)
  - `hs.created`: 3 task dalam rentang (1 dibatalkan) + 1 di luar + 1 `deleted_at` terisi → value 3 (**Review Focus 2**); `previous` menghitung rentang sebelumnya.
  - **Review Focus 3:** task `created_at='2026-11-17T17:30:00.000Z'` (00:30 WIB 18 Nov) masuk rentang `{from:'2026-11-18',to:'2026-11-18'}`, bukan 17 Nov.
  - Lokasi di luar `handoverLocationIds` tak terhitung; `handoverLocationIds=[]` → value 0.
  - `hs.status` mematuhi filter grup `status=['done']` dan `customer=[id]`.
  - `hs.trend`: kolom `points` berurutan naik per hari; "Selesai" memakai `completed_at`.
  - `hs.oldest`: terurut paling lama dahulu, maks. 10 baris, `total` = seluruh yang aktif; kolom persis sama dengan `widgetMeta('hs.oldest').listColumns`.
  - `hs.avgDuration`: dua task selesai 2 jam dan 4 jam → 3.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/dashboard/widgets/handover.test.ts` → FAIL.
- [ ] **Step 3: Implementasi** delapan `WidgetImpl` (tiap satu kueri literal); bantu bersama (pengisi bucket kosong, pemformat label hari WIB) di `widgets/common.ts` (dipakai juga Tugas 6-8): `bucketKeys(range, bucket): {key,label}[]` dan `fillSeries(points, rows)`.
- [ ] **Step 4: Jalankan** → PASS; jalankan `bun run --cwd server test src/core/soft-delete-guard.test.ts` → PASS tanpa entri baru.
- [ ] **Step 5: Commit** `feat(dashboard): widget Serah Terima`.

---

### Task 6: Widget Serial Number (7)

**Files:**
- Create: `server/src/modules/dashboard/widgets/serial.ts`
- Test: `server/src/modules/dashboard/widgets/serial.test.ts`
- Modify: `registry.ts`

**Interfaces:**
- Consumes: Tugas 2-5 (`common.ts`). Produces: `SERIAL_WIDGETS: readonly WidgetImpl[]`.

Semua kueri: `s.bu_id IN (scope.buIds)` (kosong → nol), `${liveWhere('s')}`, `s.location_id IN (scope.serialLocationIds)` bila bukan `null`; filter grup `status`, `custody`, `item` (`s.item_id IN`). Tanggal `s.created_at`.

| Id | Visual | Isi |
|---|---|---|
| `sn.recorded` | number (delta) | jumlah serial dicatat dalam rentang |
| `sn.status` | donut | per status serial (label dari `shared/serials.ts`) |
| `sn.trend` | line | dicatat per bucket |
| `sn.byItem` | barH | 10 item teratas (nama dari `items`) |
| `sn.byBu` | bar | per BU saat ini (nama dari `business_units`) |
| `sn.custody` | pie | `qc`/`transit`/`service`, label QC / Dalam pengiriman / Servis |
| `sn.transit` | list | `custody='transit'`, tanpa rentang; lokasi cocok bila `location_id` ATAU `transit_to_location_id` ada di `serialLocationIds`; kolom `serial`, `item`, `route` ("Asal → Tujuan"), `days` (sejak `transit_on`); urut paling lama; 10 baris + `total` |

- [ ] **Step 1: Tulis tes yang gagal** (`seedSerial`)
  - **Review Focus 2:** serial yang `bu_id`-nya sekarang BU Y (dulu X) hanya terhitung di Y; serial `deleted_at` terisi tak terhitung.
  - `serialLocationIds=null` → tanpa penyaring lokasi; `['lokasi-A']` → hanya serial berlokasi A; `sn.transit` mencocokkan serial yang `transit_to_location_id` = A walau `location_id` = B.
  - `sn.status` mematuhi filter `custody=['transit']` dan `item=[id]`.
  - `buIds=[]` → semua widget bernilai nol.
  - `sn.byBu` tak menyertakan BU di luar `buIds`.
- [ ] **Step 2: Jalankan** → FAIL. **Step 3: Implementasi** tujuh `WidgetImpl`. **Step 4: Jalankan** tes widget dan `soft-delete-guard.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): widget Serial Number`.

---

### Task 7: Widget Laporan rusak (5)

**Files:**
- Create: `server/src/modules/dashboard/widgets/report.ts`
- Test: `server/src/modules/dashboard/widgets/report.test.ts`
- Modify: `registry.ts`

**Interfaces:**
- Consumes: Tugas 2-6. Produces: `REPORT_WIDGETS: readonly WidgetImpl[]`.

Kueri: `JOIN serials s ON s.id = c.serial_id` dengan `${liveWhere('s')}` (laporan milik serial terhapus tak dihitung); `c.bu_id IN (scope.buIds)`; lokasi = `s.location_id IN (scope.serialLocationIds)` bila bukan `null`; filter grup `status` (`open` = `c.closed_on = ''`, `closed`), `result` (`serial_cases.outcome`, nilai `broken|passed` — periksa nilai nyata kolom `outcome` di `server/migrations/0017_laporan_rusak.sql` dan sesuaikan `options` di `GROUP_FILTERS.report` bila berbeda).

| Id | Visual | Isi |
|---|---|---|
| `rp.open` | number | laporan terbuka, tanpa rentang |
| `rp.opened` | number (delta) | `opened_on` dalam rentang (kolom tanggal WIB, bandingkan langsung) |
| `rp.trend` | line | seri "Dibuka" per `opened_on` dan "Ditutup" per `closed_on` |
| `rp.result` | donut | hasil penutupan (`closed_on` dalam rentang): Rusak vs Lolos |
| `rp.oldest` | list | 10 laporan terbuka terlama: `number`, `serialStatus`, `location`, `days`; `total` |

- [ ] **Step 1: Tulis tes yang gagal** (`seedCase`, `seedSerial`): laporan serial terhapus tak terhitung (**Review Focus 2**); `opened_on` tepat `from`/`to` termasuk (inklusif); `rp.open` mengabaikan rentang; lokasi memakai lokasi serial induk; `rp.result` hanya menghitung laporan yang `closed_on`-nya dalam rentang; `rp.oldest` terurut `opened_on` menaik, maks. 10.
- [ ] **Step 2: Jalankan** → FAIL. **Step 3: Implementasi** lima `WidgetImpl`. **Step 4: Jalankan** tes widget dan `soft-delete-guard.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): widget Laporan rusak`.

---

### Task 8: Widget Stok Stiker (5) dan Postel (2)

**Files:**
- Create: `server/src/modules/dashboard/widgets/sticker.ts`, `server/src/modules/dashboard/widgets/postel.ts`
- Test: `widgets/sticker.test.ts`, `widgets/postel.test.ts`
- Modify: `registry.ts`

**Interfaces:**
- Consumes: Tugas 2-7; `postelCondition`/`alertTarget` dari `shared/postel.ts`. Produces: `STICKER_WIDGETS`, `POSTEL_WIDGETS` (`readonly WidgetImpl[]`).

Stok: `sticker_stock st JOIN stickers k ON k.id = st.sticker_id` dengan `${liveWhere('k')}`, `k.status = 'active'`, `st.location_id IN (scope.stockLocationIds)`; filter grup `stickerType` (`k.type_id IN`) dan `sticker` (`k.id IN`). Pasangan = baris `sticker_stock` yang ada. **Habis** = `st.qty <= 0`; **menipis** = `k.min_qty > 0 AND st.qty > 0 AND st.qty <= k.min_qty`.

| Id | Visual | Isi |
|---|---|---|
| `st.out` | number | jumlah pasangan habis |
| `st.low` | number | jumlah pasangan menipis |
| `st.attention` | list | pasangan habis/menipis (habis dahulu): `sticker`, `type`, `location`, `qty`, `min`; 10 baris + `total` |
| `st.movement` | barGroup | `sticker_stock_entries` pada lokasi cakupan, `ts` dalam rentang (UTC dari `wibRangeToUtc`): "Masuk" = `kind='in'` (jumlah `delta`), "Keluar" = `kind='out'` ATAU entri berpemilik serial (`serial_id <> ''`), nilai absolut; koreksi/opname tak dihitung; per bucket |
| `st.byType` | bar | total `qty` per jenis stiker pada lokasi cakupan (nama dari `sticker_types`) |

Postel (`sticker: view` global; tanpa BU/Lokasi/Tanggal; `${liveWhere('p')}` pada `postels`, nomor aktif = `seq` terbesar dengan `${liveWhere('n')}`; kondisi dihitung dengan `postelCondition` memakai tanggal WIB hari ini): `pt.condition` (donut: Berlaku/Segera habis/Kedaluwarsa; filter grup `condition`) dan `pt.expiring` (list kolom `name`, `number`, `expiresOn`, `daysLeft`; hanya Segera habis dan Kedaluwarsa, terurut `expiresOn`; 10 baris + `total`).

- [ ] **Step 1: Tulis tes yang gagal**
  - **Review Focus 4:** stiker tanpa baris `sticker_stock` di lokasi A tidak dihitung habis di A; stiker `inactive`/`deprecated` tak dihitung; stiker `deleted_at` terisi tak dihitung.
  - Per lokasi: stiker min 10, stok 8 di lokasi A (menipis) dan 50 di lokasi B → di cakupan `[A,B]`: `st.low` = 1 (pasangan A saja); di cakupan `[B]`: 0 dan tak ada angka lokasi A (K5).
  - `st.out` untuk `qty = 0` dan `qty < 0` (stok negatif akibat Serial); `min_qty = 0` tak pernah menipis.
  - `st.attention`: habis lebih dulu, lalu menipis; kolom persis `listColumns`.
  - `st.movement`: entri `in`, `out`, entri serial (keluar), `adjust`/`opname` (diabaikan); entri `ts='2026-11-17T17:30:00.000Z'` jatuh pada hari WIB 18 Nov; `stockLocationIds=[]` → nol.
  - Postel: nomor aktif = `seq` terbesar; kondisi sesuai `postelCondition`; postel/nomor terhapus tak dihitung; `pt.expiring` tak memuat yang Berlaku.
- [ ] **Step 2: Jalankan** → FAIL. **Step 3: Implementasi** tujuh `WidgetImpl`. **Step 4: Jalankan** tes widget dan `soft-delete-guard.test.ts` → PASS; `bun run --cwd server test src/modules/dashboard` seluruhnya PASS.
- [ ] **Step 5: Commit** `feat(dashboard): widget Stok Stiker dan Postel`.

---

### Task 9: Pasang `chart` shadcn dan komponen grafik

**Files:**
- Create (via shadcn): `web/src/components/ui/chart.tsx`; create: `web/src/modules/dashboard/components/charts/{donut-chart,column-chart,line-chart,bar-list-chart,stacked-bar}.tsx`, `chart-lazy.tsx`, `web/src/modules/dashboard/lib/colors.ts`
- Test: `web/src/modules/dashboard/components/charts/charts.test.tsx`

**Interfaces:**
- Produces:
  - `CHART_SERIES_TOKENS` di `lib/colors.ts`: urutan token semantik yang ada (`primary`, `info`, `success`, `warning`, `destructive`, `secondary`; baca nama variabel dari `web/src/styles.css`, jangan menambah token baru), dan `seriesColor(index: number): string` (indeks >= 6 → warna "Lainnya" netral).
  - `limitSlices(slices: PartsData['slices'], max = 6): PartsData['slices']` (sisa digabung "Lainnya").
  - Komponen presentasional murni (props = DTO): `DonutChart({ data: PartsData; pie?: boolean; label: string })`, `ColumnChart({ data: SeriesData; label: string })` (kolom; dua seri = berkelompok), `LineChart({ data: SeriesData; label: string })`, `BarListChart({ data: PartsData; label: string })` (batang horizontal), masing-masing membungkus tabel tersembunyi + `role="img"` + `aria-label`.
  - `LazyCharts` di `chart-lazy.tsx`: `React.lazy` untuk satu potongan yang berisi semua komponen recharts di atas.

- [ ] **Step 1: Pasang** `cd web && bunx --bun shadcn@latest add chart`; pastikan `recharts` masuk `web/package.json` dan `bun install` di akar.
- [ ] **Step 2: Tulis tes yang gagal**: `limitSlices` dengan 8 irisan → 6 irisan, irisan ke-6 berlabel "Lainnya" bernilai jumlah sisanya (urut menurun dahulu); tiap komponen merender `role="img"` dengan `aria-label` berisi `label` dan tabel tersembunyi (`sr-only`) berisi semua nilai; legenda memuat label teks (bukan hanya warna); seri kosong merender pesan "Belum ada data" bukan grafik kosong.
- [ ] **Step 3: Jalankan** `bun run --cwd web test src/modules/dashboard/components/charts` → FAIL.
- [ ] **Step 4: Implementasi** komponen dengan `ChartContainer`/`ChartTooltip` shadcn; warna memakai `seriesColor`; sumbu/ukuran font mengikuti sistem desain (>= 12 px).
- [ ] **Step 5: Jalankan** → PASS; `bun run --cwd web typecheck`; `bun run --cwd web test src/styles.contrast.test.ts` → PASS.
- [ ] **Step 6: Commit** `feat(dashboard): komponen grafik (chart shadcn)`.

---

### Task 10: Renderer widget dan kartu

**Files:**
- Create: `web/src/modules/dashboard/components/widgets/{widget-card,widget-renderer,number-widget,list-widget}.tsx`, `web/src/modules/dashboard/lib/format.ts`
- Test: `web/src/modules/dashboard/components/widgets/widgets.test.tsx`

**Interfaces:**
- Consumes: Tugas 2, 9. Produces:
  - `WidgetCard({ meta: WidgetMeta; result: WidgetResult | undefined; loading: boolean; filterState: { bu: boolean; location: boolean; date: boolean }; onRetry(): void })`: judul, penanda keterlibatan filter ("BU tidak berlaku" bila `!meta.bu` dan filter BU aktif; sama untuk Lokasi; "Kondisi saat ini" bila `meta.date.kind === 'none'`; "per lokasi" pada widget stok), skeleton saat `loading`, galat + tombol "Coba lagi", kosong.
  - `WidgetRenderer({ meta, data })` memilih komponen menurut `meta.visual`; `NumberWidget` (angka + delta "naik N% dari periode lalu"/"turun"/"tetap"; `previous === 0` → tanpa persen), `ListWidget` (tabel di desktop, `MobileCard` di ponsel lewat `useIsDesktop`, "Menampilkan N dari M").
  - `formatNumber(n: number): string`, `formatDelta(value: number, previous: number | undefined): { text: string; tone: 'success'|'danger'|'muted' } | null` di `lib/format.ts`.

- [ ] **Step 1: Tulis tes yang gagal**: `formatDelta(128, 114)` → naik 12% bertone `success`; `formatDelta(5, 0)` → null; kartu `loading` merender skeleton; kartu `status:'error'` merender "Coba lagi" yang memanggil `onRetry`; penanda "BU tidak berlaku" muncul HANYA bila filter BU aktif dan `meta.bu === false`; `ListWidget` ponsel merender `MobileCard` (`useIsDesktop` dipalsukan false), desktop merender tabel; baris kosong → pesan netral; `WidgetRenderer` untuk tiap `visual` merender komponen yang benar.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/dashboard/components/widgets` → FAIL.
- [ ] **Step 3: Implementasi**; semua teks santai ("Belum ada data", "Coba lagi"), tidak memakai warna saja untuk status.
- [ ] **Step 4: Jalankan** → PASS; typecheck web.
- [ ] **Step 5: Commit** `feat(dashboard): kartu dan renderer widget`.

---

### Task 11: Halaman `/dashboard`, filter, query, dan navigasi

**Files:**
- Create: `web/src/modules/dashboard/queries.ts`, `lib/search.ts`, `components/{dashboard-page,global-filters,group-section}.tsx`, `web/src/routes/_app/dashboard/index.tsx`
- Modify: `web/src/app/navigation.ts` (butir "Dashboard" tepat di bawah Beranda; `permission` `anyOf` modul sumber widget), `scripts/page-frame.test.ts` (`ROUTE_EXCEPTIONS`: `/dashboard` dengan alasan "halaman agregat bukan daftar/form, memakai HeadroomFrame seperti Beranda"), `web/src/app/navigation.test.ts` dan tes navigasi lain yang menghitung butir
- Test: `web/src/modules/dashboard/components/dashboard-page.test.tsx`, `lib/search.test.ts`, `queries.test.tsx`

**Interfaces:**
- Consumes: Tugas 2, 4, 9, 10. Produces:
  - `dashboardQueryOptions(input: DashboardQueryInput)` dan `dashboardOptionsQueryOptions()` di `queries.ts` (`api('dashboard.query', input)`; `refetchInterval: 60_000`, `staleTime: 60_000`; kunci `['dashboard', ...]` TIDAK masuk whitelist `app/query-persist.ts`).
  - `dashboardSearchSchema` (zod) di `lib/search.ts`: `bu: string[]`, `loc: string[]` (maks. 20), `from`/`to` (`YYYY-MM-DD`), dan satu param datar per filter grup `"<group>_<key>"` (array string, maks. 20) dibangkitkan dari `GROUP_FILTERS`; `defaultRange(todayWib: string): DashboardRange` (30 hari terakhir); `toQueryInput(search, todayWib, widgetIds): DashboardQueryInput`.
  - `DashboardPage()` (di `routes/_app/dashboard/index.tsx` lewat `createFileRoute('/_app/dashboard/')` dengan `staticData` tanpa `crumb`, bukan `pageWidth`): `HeadroomFrame` + bar filter global; per grup `GroupSection` (judul grup + `FilterChip` filter grup + kisi widget 12 kolom: number card kecil berderet, grafik 6 atau 12 kolom, satu kolom di ponsel); widget yang tak boleh dilihat (cek `canAnywhere(me, ...)` menurut `meta.access`) tak dirender; grup tanpa widget disembunyikan; tanpa satu pun → pesan "Anda belum punya akses ke data dashboard".
  - `GlobalFilters`: chip BU (`LinkMultiField` dari `me.businessUnits`, tanpa yang `deleted`), Lokasi (`LinkMultiField` gabungan lokasi yang boleh dibaca di modul sumber), Tanggal (preset 7 hari/30 hari/bulan ini/bulan lalu + rentang kustom; maks. 366 hari ditegakkan di UI).

- [ ] **Step 1: Tulis tes yang gagal**
  - `search.test.ts`: `defaultRange('2026-11-23')` = 25 Okt–23 Nov; skema menolak 21 nilai `bu`; param filter grup dibangkitkan dari `GROUP_FILTERS` dan **tak ada** param bernama `<group>_bu`, `<group>_location`, `<group>_date`; `toQueryInput` hanya menyertakan widget yang diminta.
  - `dashboard-page.test.tsx` (mock `api`): pengguna hanya handover → hanya grup Serah Terima terender; tanpa izin apa pun → pesan tanpa akses; mengubah chip Tanggal memperbarui search param dan memanggil `dashboard.query` dengan rentang baru; chip filter grup mengubah filter widget grup itu saja; filter BU aktif memunculkan penanda "BU tidak berlaku" pada widget Serah Terima; galat satu widget tidak menyembunyikan widget lain.
  - `queries.test.tsx`: query dashboard tidak ada di `PERSISTED_KEYS`/whitelist `query-persist`.
  - `navigation.test.ts`: butir Dashboard tampil bagi pemegang izin widget mana pun dan tidak bagi yang tak punya apa pun.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/dashboard src/app/navigation.test.ts` → FAIL.
- [ ] **Step 3: Implementasi** semua file; jalankan generator rute TanStack bila perlu (lihat bagaimana `routeTree.gen.ts` dibuat di proyek: `bun run --cwd web dev` atau `vite build` menghasilkannya; jangan ditulis tangan).
- [ ] **Step 4: Jalankan** `bun run --cwd web test`, `bun run --cwd web typecheck`, `bun run scripts/test-scripts.ts` (memuat `page-frame.test.ts`, `route-meta-coverage`) → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): halaman dashboard di aplikasi`.

---

### Task 12: Dokumentasi, changelog, dan verifikasi akhir

**Files:**
- Create: `server/changelog.d/20261123-dashboard.md` (satu baris: `feat(dashboard): dashboard pemantauan Serah Terima, Serial Number, Laporan, Stok Stiker, dan Postel`)
- Modify: `CLAUDE.md` (bagian Struktur: butir "Dashboard" memuat `shared/dashboard.ts`, `server/src/modules/dashboard/`, `web/src/modules/dashboard/`, aturan literal-SQL, BU saat ini, stok per lokasi, modul izin `dashboard` di `SHARED_MODULES`, dan penyimpangan dari halaman Stok)

- [ ] **Step 1:** Perbarui `CLAUDE.md` dan tambah fragmen changelog.
- [ ] **Step 2: Verifikasi penuh**: `bun run check` (tunnel hidup) → hijau; `bun run build` → `verify-dist` lolos, potongan JS grafik <= 600 KB gzip dan dimuat malas (tidak ada di potongan awal).
- [ ] **Step 3: Verifikasi UI manual** lewat server dev (`preview_start`): buka `/dashboard` sebagai pengguna dev, cek tiap grup terisi, filter global dan grup bekerja, mode gelap, tampilan ponsel 393 px, tanpa galat konsol.
- [ ] **Step 4: Commit** `docs(dashboard): catat dashboard di CLAUDE.md dan changelog`.
