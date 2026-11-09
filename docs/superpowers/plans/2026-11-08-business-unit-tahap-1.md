# Business Unit (BU) Tahap 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur eksekusi mengikuti `~/.claude/CLAUDE.md` pemilik (satu putaran: implementasi semua task tanpa review per task → satu review independen + `security-audit` pada diff → putaran perbaikan); kolom **Kelas** di tiap task = model subagent yang disarankan (Haiku: mekanis; Sonnet: logika inti).

**Goal:** Membatasi data item menurut Business Unit (BU) milik user, dengan hak per BU. (Diperbarui 2026-11-09, keputusan 14 spek: tanpa backfill hak pengguna lama; staging dan production belum punya data merk/item.)

**Architecture:** Tabel master `business_units` + tabel penghubung `item_business_units` dan `brand_default_business_units`; kolom JSON `users.bu_assignments` (pola `users.assignments`); modul ber-BU generik (`BU_MODULES = ['item']`) dihitung `resolveAccess` menjadi `byBu`; semua jalur baca item difilter di SQL, jalur tulis memeriksa hak pada SEMUA BU item. Form web memakai komponen `LinkField` (pilih record, chip untuk banyak pilihan).

**Tech Stack:** Bun + Hono + MariaDB 11.8 (adaptor `Db`, `batch()`, CAS), React + TanStack (Router/Query/Form) + zod + shadcn, `bun test` (shared/server), Vitest + Testing Library (web).

**Spec:** `docs/superpowers/specs/2026-11-08-business-unit-design.md` (disetujui pemilik produk 2026-11-08, "lanjut pengerjaan BU"). Konvensi proyek: `CLAUDE.md` (Aturan server, Aturan frontend, Menambah rute REST).

## Global Constraints

- `shared/` murni (tanpa API runtime/DOM), import internal relatif; kontrak FE↔server di `shared/contract.ts`, rute di `API_ROUTES` (`shared/api.ts`); id baru wajib juga di `server/src/routes.ts` (`ALL_API_IDS`) dan tabel `server/src/http/body.test.ts` (rute JSON baru).
- SQL: parameter `?` berurutan, nilai SELALU di-bind, kolom `key`/`before`/`after` berbacktick, `Number()` untuk `COUNT`/`SUM`, kolasi `utf8mb4_nopad_bin` (kecocokan tak-peka-huruf lewat kolom ternormalisasi).
- Migrasi `server/migrations/0004_business_units.sql`: idempoten (`IF NOT EXISTS`), hanya menambah (expand; kompatibel mundur dengan image sebelumnya). Jangan menyunting migrasi yang sudah ada.
- Penulisan yang bergantung pada hasil baca dijaga CAS di `batch()` (`runCas`, `CAS_UPDATED_AT_SET`) atau `SELECT ... FOR UPDATE`; tes konkurensi memakai `Promise.all` atas permintaan nyata dan tidak boleh dilemahkan.
- Galat: `appError('NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION' | 'CONFLICT', ...)`; versi usang lewat `staleError`. Detail item di luar hak BU = `NOT_FOUND`, bukan `FORBIDDEN`.
- Level per BU memakai `Level` yang ada (`none|view|edit|manage`); `MODULE_LEVELS.item` tak berubah.
- Pengecualian anti-tujuan yang disengaja: log audit utuh untuk `access: view`; `brands.item_count` total global; hasil ekspor Sheets (`exports.sheets`, hanya `access: manage`) tidak difilter (lihat Keputusan Plan #1).
- Komponen UI shadcn (`web/src/components/ui`, dikecualikan lint); form TanStack Form + zod; server state TanStack Query; tanpa library state global.
- Commit: pesan berbahasa Indonesia, diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `bun run check` (butuh `bun run db:tunnel` hidup) hijau sebelum commit terakhir tiap task; `bun` ada di `~/.bun/bin`.
- Jangan menyentuh server dev :3000 dan jangan men-stage `scripts/google-sa-check/check.ts`.

## Review Focus

Input/kondisi yang diimplikasikan spek tetapi tidak dijaga satu tugas pun secara eksplisit; tiap baris sudah dipasang tesnya di task pemilik kode (nomor task di kurung):

1. User **tanpa penugasan BU** (atau BU-nya tak dikenal/basi di `bu_assignments`): daftar item kosong, `items.get` `NOT_FOUND`, `items.save` baru ditolak; tidak melempar 500 (T4, T5, T6).
2. **Bootstrap tanpa BU sama sekali** (admin pertama): `items.save` baru gagal dengan pesan jelas "buat BU dulu"; Merk/Customer tetap bisa dikelola oleh user "Semua BU" meski belum ada BU (T4, T6).
3. **Mass assignment/IDOR**: `items.save` dengan `businessUnitIds` berisi BU yang tak dikenal, nonaktif, atau tanpa hak `edit` user → `FORBIDDEN`/`VALIDATION`; `items.get`/`files.get` untuk item/berkas BU lain tidak membocorkan keberadaan (`NOT_FOUND`) (T5, T6, T7).
4. **Item multi-BU**: user `edit` di BU A tetapi hanya `view` di BU B tidak boleh mengubah/menonaktifkan item A+B, tetapi boleh melihatnya (T6).
5. **Konkurensi**: dua `items.save` serentak yang mengubah himpunan BU item yang sama tidak meninggalkan baris penghubung ganda/yatim dan tidak menggandakan item (T6).

## Keputusan Plan (ambil dari kekosongan spek; ditandai agar pemilik bisa mengoreksi)

1. **Ekspor Sheets** (`exports.sheets`, `access: manage`) mengekspor seluruh item tanpa filter BU; dicatat sebagai pengecualian (d) di spek. **Dikonfirmasi pemilik 2026-11-09 (keputusan 16 spek):** fitur ekspor Sheets belum dibutuhkan; tetap tanpa filter.
2. Rute `businessUnits.options` (GET `/business-units/options`, izin `item: view`) memberi daftar BU ringkas untuk pemilih (Merk dan form item) bagi user tanpa `access: view`.
3. ~~Backfill hak pengguna lama di kode saat start (`backfillBuAssignments`).~~ **Dibatalkan 2026-11-09 (keputusan 14 spek, pemilik produk):** tidak ada backfill karena belum ada data merk/item di staging dan production; `bu_assignments` kosong dibaca `[]` (tanpa penugasan BU). `bu-backfill.ts`, `legacyBuAssignments`, dan pemanggilan di `main.ts` dihapus.
4. `ItemSummaryDto`/`ItemDto` membawa `businessUnits: BusinessUnitRefDto[]` (`{id, code, name}`, semua BU item), supaya tabel dan detail menampilkan chip tanpa kueri tambahan.
5. `SaveItemInput.brand` (nama) diganti `brandId` (konsekuensi LinkField, spek 5.5); merk tak lagi dibuat diam-diam dari teks.
6. `LinkField` menerima `options` + `onSearchChange` sebagai properti (sumber data dari pemakai); Merk dan BU memfilter daftar yang sudah di-cache di klien (daftar kecil), debounce dan batas hasil dikerjakan di komponen (spek bagian 7 menyerahkannya kepada pelaksana).
7. `BusinessUnitDto.userCount` = jumlah user **aktif** yang berhak atas BU itu (penugasan eksplisit atau "Semua BU" dengan role yang memberi level `item` selain `none`; diputuskan pemilik 2026-11-09 setelah review T1-T4); `itemCount` = jumlah baris `item_business_units`.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/business-units.ts` (baru) | Tipe & fungsi murni BU: `BU_MODULES`, `BuAssignment`, `sanitizeBuAssignments`, `resolveBuAccess`, `buIdsWithLevel`, `canActOnAllBus` |
| `shared/assignments.ts` | `resolveAccess` menerima penugasan BU; `item` keluar dari `SHARED_MODULES` |
| `shared/contract.ts`, `shared/api.ts` | DTO/input/rute BU, perubahan Me/User/Item/Brand |
| `server/migrations/0004_business_units.sql` | tabel + kolom baru |
| `server/src/modules/access/business-unit-service.ts` (baru) | master BU (pola `location-service.ts`) |
| `server/src/modules/access/{repo,context,service,validate,routes}.ts` | catatan BU, konteks akses, penugasan BU user, rute |
| `server/src/modules/item/{repo,service,validate,routes}.ts` | relasi item↔BU, filter baca, aturan tulis, `brandId` |
| `server/src/modules/brand/{repo,service,validate}.ts` | BU bawaan merk |
| `server/src/modules/files/{service,routes}.ts` | pemeriksaan BU berkas item |
| `server/test-support/{access-fixtures,item-fixtures}.ts` | `seedBusinessUnit`, `seedUser` ber-BU, `seedItem` ber-BU |
| `web/src/components/link-field.tsx` (baru) | `LinkField`/`LinkMultiField` |
| `web/src/modules/access/*` | halaman BU, bagian "Penugasan BU" di form user |
| `web/src/modules/{item,brand}/*` | field Merk (LinkField), BU (chip), BU bawaan merk |

---

### Task 1: Model BU murni di `shared/` (Kelas: Sonnet)

**Files:**
- Create: `shared/business-units.ts`, `shared/business-units.test.ts`
- Modify: `shared/assignments.ts` (`SHARED_MODULES`, `ResolvedAccess`, `resolveAccess`), `shared/assignments.test.ts`

**Interfaces:**
- Produces (di `shared/business-units.ts`):
  - `export const BU_MODULES = ['item'] as const; export type BuModule = (typeof BU_MODULES)[number]; export type BuPermissionMap = Record<BuModule, Level>;`
  - `export const ALL_BU_KEY = '*'; export interface BuAssignment { buId: string | null; roleIds: string[] }` (`null` = Semua BU)
  - `sanitizeBuAssignments(raw: unknown): BuAssignment[]` — perilaku sama dengan `sanitizeAssignments` (hanya `null` eksplisit = Semua BU, entri rusak dibuang, id kembar digabung).
  - `resolveBuAccess(assignments: readonly BuAssignment[], rolePermissions: ReadonlyMap<string, PartialPermissionMap>, allBuIds: readonly string[]): Record<string, BuPermissionMap>` — per BU: gabungan role "Semua BU" + role penugasan BU itu (level tertinggi); "Semua BU" berlaku untuk semua id di `allBuIds`; penugasan ke id yang tak ada di `allBuIds` diabaikan; BU tanpa level apa pun tak dimasukkan.
  - `globalBuLevel(assignments, rolePermissions, module: BuModule): Level` — level tertinggi `module` di antara SEMUA penugasan BU (tanpa memedulikan `allBuIds`).
  - `buIdsWithLevel(byBu: Record<string, BuPermissionMap>, module: BuModule, level: Level): string[]`
  - `canActOnAllBus(byBu, module: BuModule, level: Level, buIds: readonly string[]): boolean` — `true` hanya bila `buIds` tak kosong dan tiap id punya level ≥ `level`.
  - `fullBuPermissions(): BuPermissionMap` (`{ item: 'manage' }`).
- Produces (di `shared/assignments.ts`): `ResolvedAccess` bertambah `byBu: Record<string, BuPermissionMap>`; `resolveAccess(assignments, rolePermissions, activeLocationIds, bu: { assignments: readonly BuAssignment[]; allBuIds: readonly string[] } = { assignments: [], allBuIds: [] })`; `global.item = globalBuLevel(bu.assignments, rolePermissions, 'item')` (sumber `item` global hanya penugasan BU); `SHARED_MODULES = ['qrcode']`.

- [ ] **Step 1: Tulis tes gagal** di `shared/business-units.test.ts` (dan perbarui `assignments.test.ts`): `sanitizeBuAssignments` (bukan array → `[]`; `buId` hilang/kosong dibuang; `null` eksplisit = Semua BU; id kembar digabung); `resolveBuAccess`: "Semua BU" + penugasan BU A menggabung level tertinggi untuk A dan hanya "Semua BU" untuk B; id tak dikenal diabaikan; role tak dikenal diabaikan; `canActOnAllBus(byBu,'item','edit',[])` = `false`; `canActOnAllBus` `false` bila satu BU hanya `view`; `resolveAccess` `global.item` = `'none'` bila user hanya punya role `item` di penugasan lokasi (bukan penugasan BU) dan `'view'` bila role `item: view` ada di penugasan BU; `SHARED_MODULES` tidak memuat `'item'` (ubah asersi lama yang mengharapkan `item` dihitung dari penugasan lokasi).
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd shared test` → FAIL (modul `./business-units` belum ada).
- [ ] **Step 3: Implementasikan** `shared/business-units.ts` dengan signature di atas dan ubah `resolveAccess`/`SHARED_MODULES` di `shared/assignments.ts`. Gunakan `mergePermissions` dari `./permissions` untuk gabungan level; `sanitizeBuAssignments` boleh meniru `sanitizeAssignments`.
- [ ] **Step 4: Jalankan**: `bun run --cwd shared test` dan `bun run typecheck` → PASS (typecheck server akan merah sampai T4: biarkan, T1 hanya menjamin `shared`; bila typecheck server gagal karena `resolveAccess`/`SHARED_MODULES`, perbaiki hanya pemanggilnya secara minimal dengan argumen bawaan).
- [ ] **Step 5: Commit** `git add shared && git commit -m "feat(shared): model BU murni dan penugasan BU pada resolveAccess"`.

---

### Task 2: Migrasi `0004`, fixture tes (Kelas: Sonnet; tanpa backfill, keputusan 14)

**Files:**
- Create: `server/migrations/0004_business_units.sql`
- Modify: `server/src/core/migrate.test.ts`, `server/test-support/access-fixtures.ts`, `server/test-support/item-fixtures.ts`, `server/scripts/seed-data.ts` (+ `server/scripts/seed.test.ts`)

**Interfaces:**
- Produces: tabel `business_units(id, code, name, status, created_at, updated_at, updated_by, name_key VIRTUAL LOWER(name), UNIQUE business_units_code_unique(code), UNIQUE business_units_name_unique(name_key))`, `item_business_units(item_id, bu_id, PRIMARY KEY(item_id, bu_id), KEY item_business_units_bu(bu_id))`, `brand_default_business_units(brand_id, bu_id, PRIMARY KEY(brand_id, bu_id), KEY brand_default_business_units_bu(bu_id))`, `ALTER TABLE users ADD COLUMN IF NOT EXISTS bu_assignments LONGTEXT NOT NULL DEFAULT ''` (semua `ENGINE=InnoDB ... COLLATE=utf8mb4_nopad_bin`, kolom string mengikuti tipe tabel `locations`).
- `seedBusinessUnit(env: Pick<Env,'DB'>, bu: { id: string; code: string; name?: string; status?: 'active'|'inactive' }): Promise<void>`; `seedUser` menerima `buAssignments?: BuAssignment[]` dan, bila `roleIds` dipakai tanpa `buAssignments`, menulis `bu_assignments = [{buId:null, roleIds}]` (agar tes lama yang memberi role `item` tetap berlaku); `seedItem` menerima `businessUnitIds?: string[]` (bawaan `['bu-umum']` dan memastikan BU `bu-umum` (kode `DEF`, nama "BU Bawaan Tes") ada, idempoten) lalu menyisipkan `item_business_units`.

- [ ] **Step 1: Tulis tes gagal.** `migrate.test.ts`: `EXPECTED_TABLES` menjadi 23 tabel (tambah tiga), judul "23 tabel aplikasi + schema_migrations", daftar migrasi memuat `0004_business_units.sql`, indeks `business_units.business_units_code_unique`, `business_units.business_units_name_unique`, `item_business_units.item_business_units_bu`, `brand_default_business_units.brand_default_business_units_bu`, kolom `users.bu_assignments` ada.
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd server test src/core/migrate.test.ts` → FAIL.
- [ ] **Step 3: Tulis migrasi** `0004_business_units.sql` (header komentar: tahap 1 BU, expand-only, kompatibel mundur) dengan DDL di atas (tanpa backfill; `main.ts` tidak berubah).
- [ ] **Step 4: Perbarui fixture dan seed:** `seedBusinessUnit`, `seedUser` ber-BU, `seedItem` ber-BU seperti di Interfaces; `seed-data.ts` membuat dua BU contoh (`UM`/"Umum" dan `ENT`/"Enterprise"), memberi user admin dev penugasan BU "Semua BU" (role admin yang sudah ada), dan menautkan tiap item contoh ke BU `UM`; sesuaikan `seed.test.ts`.
- [ ] **Step 5: Jalankan**: `bun run --cwd server test src/core src/modules/access scripts` → PASS (suite lain memang akan merah sampai T4–T6 selesai karena `item` kini hanya dari penugasan BU; fixture di atas menjaga mayoritasnya hijau).
- [ ] **Step 6: Commit** `git add server && git commit -m "feat(server): migrasi 0004 BU dan fixture tes"`.

---

### Task 3: Master BU di server (Kelas: Sonnet)

**Files:**
- Create: `server/src/modules/access/business-unit-service.ts`, `server/src/modules/access/business-unit.test.ts` (logika), `server/src/modules/access/business-unit-rest.test.ts` (lewat `restCall`/`restClient`, pola `access/rest.test.ts`)
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/access/{repo,validate,routes}.ts`, `server/src/routes.ts` (`ALL_API_IDS`), `server/src/http/body.test.ts`, `shared/api.test.ts` (bila ada daftar id/jumlah)

**Interfaces:**
- Produces (di `shared/contract.ts`): `BusinessUnitStatus = 'active' | 'inactive'`; `BusinessUnitRefDto { id; code; name }`; `BusinessUnitOptionDto extends BusinessUnitRefDto { status }`; `BusinessUnitDto extends BusinessUnitOptionDto { itemCount: number; userCount: number; createdAt; updatedAt; updatedBy }`; `SaveBusinessUnitInput { id?: string; code: string; name: string }`; `SetBusinessUnitStatusInput { id: string; status: BusinessUnitStatus }`. `ApiContract` mendapat: `'access.businessUnits.list'` (`null` → `BusinessUnitDto[]`), `'access.businessUnits.save'`, `'access.businessUnits.setStatus'`, `'businessUnits.options'` (`null` → `BusinessUnitOptionDto[]`).
- Produces (di `shared/api.ts`): `'access.businessUnits.list': GET /business-units`; `'access.businessUnits.save': PUT /business-units/{id}, create POST /business-units`; `'access.businessUnits.setStatus': PATCH /business-units/{id}, etag 'updatedAt'`; `'businessUnits.options': GET /business-units/options`.
- Produces (server): `BusinessUnitRecord { id; code; name; status; createdAt; updatedAt; updatedBy }`; `listBusinessUnitDtos(env)`, `listBusinessUnitOptions(env)`, `saveBusinessUnit(env, input: SaveBusinessUnitInput, actor: UserContext): Promise<BusinessUnitDto>`, `setBusinessUnitStatus(env, input, actor)`; audit `businessunit.create|update|activate|deactivate`, target = kode; peta konflik `business_units_code_unique` ("Kode BU sudah dipakai", field `code`), `business_units_name_unique` ("Nama BU sudah dipakai", field `name`). Izin: list/save/setStatus `access` view/manage/manage; options `item` view.
- Validator: `code` mengikuti aturan lokasi (huruf besar/angka/tanda hubung, maks. 10, tak dapat diubah setelah dibuat), `name` 1–100 karakter (salin pola `validateSaveLocation`).

- [ ] **Step 1: Tulis tes gagal** (pola `location` di tes akses): membuat BU → DTO `status:'active'`, `itemCount:0`, `userCount:0`, audit `businessunit.create`; kode ganda dan nama ganda berbeda huruf besar → `CONFLICT` dengan field; mengubah `code` → `VALIDATION`; nonaktif lalu aktif mengubah `status` dan menulis audit; `userCount` menghitung user "Semua BU" dan user yang menugaskan BU itu secara eksplisit (seed `bu_assignments` lewat `seedUser`), `itemCount` menghitung baris `item_business_units`; menonaktifkan BU yang masih dipakai TIDAK ditolak; `access.businessUnits.list` dengan user `access: view` OK, tanpa izin `FORBIDDEN`; `businessUnits.options` OK untuk user `item: view` (lewat penugasan BU) dan `FORBIDDEN` untuk user tanpa `item`; `body.test.ts` memuat entri `access.businessUnits.save` dengan muatan sah terbesar.
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd server test src/modules/access` → FAIL.
- [ ] **Step 3: Implementasikan** kontrak, tabel rute, repo (`loadAccessTables` ikut memuat `businessUnits`; `insertBusinessUnitStmt`, `updateBusinessUnitStmt`, hitungan `item_business_units` dan penghitung user dari `bu_assignments`), service (meniru `location-service.ts`), validator, rute, dan daftar `ALL_API_IDS`. Konflik duplikat lewat `batchWrite(env.DB, stmts, BUSINESS_UNIT_CONFLICTS)`.
- [ ] **Step 4: Jalankan**: `bun run --cwd server test src/modules/access src/routes.test.ts src/http` dan `bun run --cwd shared test` → PASS; `bun run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(access): master Business Unit (kontrak, rute, tes)"`.

---

### Task 4: Konteks akses dan penugasan BU user (Kelas: Sonnet)

**Files:**
- Modify: `shared/contract.ts` (`MeDto`, `UserDto`, `SaveUserInput`), `server/src/modules/access/{context,repo,service,validate}.ts`, `server/src/modules/auth/api.ts`, `server/src/modules/access/location-brief.ts` (atau berkas baru `business-unit-brief.ts` untuk ringkasan BU)
- Test: `server/src/modules/access/context.test.ts` (atau berkas konteks yang ada), `server/src/modules/access/access.test.ts`, `server/src/modules/access/rest.test.ts`, `server/src/modules/auth/rest.test.ts`

**Interfaces:**
- Consumes: `BuAssignment`, `sanitizeBuAssignments`, `resolveAccess(..., bu)`, `fullBuPermissions` (T1); tabel/kolom T2; `seedUser({ buAssignments })`, `seedBusinessUnit` (T2).
- Produces:
  - `UserContext.businessUnits: Record<string, BuPermissionMap>` (peta `byBu`; super admin = semua BU bernilai `fullBuPermissions()`). `loadUserContext` menambah ke `ACCESS_SQL` kolom `bu_assignments` (kolom generik `f`) dan baris `'b'` untuk seluruh `business_units.id`; `permissions.item` global = `globalBuLevel`.
  - `UserDto.buAssignments: BuAssignment[]`, `SaveUserInput.buAssignments: BuAssignment[]`, `UserRecord.buAssignments`.
  - `MeDto.businessUnits: BusinessUnitAccessDto[]` dengan `BusinessUnitAccessDto extends BusinessUnitOptionDto { permissions: BuPermissionMap }` — semua BU yang punya level ≠ `none`, terurut menurut `code`.
  - `validateSaveUser` membaca `buAssignments` (daftar `{ buId: string | null, roleIds: string[] }`; tiap entri ≥ 1 role; `buId` unik, "Semua BU" paling banyak sekali; pesan galat berpola `readAssignmentList`).
  - `saveUser` memvalidasi: role dikenal; BU dikenal dan (aktif atau sudah ada di penugasan lama user); BU nonaktif baru → `VALIDATION` "BU tidak dikenal atau tidak aktif". Snapshot audit user memuat `buAssignments` (peta `kode BU atau '*'` → role id, pola `assignmentsSnapshot`). `usesRole`/`userCount` role ikut menghitung penugasan BU (menghapus role yang masih dipakai penugasan BU → `CONFLICT`).

- [ ] **Step 1: Tulis tes gagal.** (a) `loadUserContext`: user ber-penugasan "Semua BU" (role `item: edit`) dengan dua BU → `businessUnits` memuat keduanya `{item:'edit'}`, `permissions.item === 'edit'`; penugasan BU A saja → hanya A; BU id basi di `bu_assignments` diabaikan tanpa galat; user tanpa penugasan BU → `businessUnits = {}`, `permissions.item === 'none'`; user hanya role `item` di penugasan LOKASI → `permissions.item === 'none'` (perubahan perilaku disengaja); super admin → semua BU `manage`, tanpa BU sama sekali → `{}` dan `permissions.item === 'manage'`; JSON `bu_assignments` rusak → `[]`. (b) `auth.me` memuat `businessUnits` terurut menurut kode dengan `permissions` yang benar dan mencakup BU nonaktif yang berhak. (c) `access.users.save`: round-trip `buAssignments`; BU nonaktif baru ditolak, BU nonaktif yang sudah ditugaskan boleh dipertahankan; dua entri BU sama → `VALIDATION`; audit `user.update` memuat `buAssignments`. (d) menghapus role yang dipakai hanya lewat penugasan BU → `CONFLICT`.
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd server test src/modules/access src/modules/auth` → FAIL.
- [ ] **Step 3: Implementasikan** perubahan di atas. `readBuAssignments(row)`: `bu_assignments` kosong/rusak → `[]` (BUKAN turunan legacy; tidak ada backfill, keputusan 14).
- [ ] **Step 4: Jalankan** seluruh tes server yang menyentuh izin `item` (`bun run --cwd server test src/modules src/http src/routes.test.ts`); perbaiki fixture tes yang bergantung pada `item` dari penugasan lokasi dengan `seedUser({ roleIds })` (T2 sudah menulis `bu_assignments`) atau `buAssignments` eksplisit. `bun run typecheck` untuk shared+server.
- [ ] **Step 5: Commit** `git commit -m "feat(access): penugasan BU user, konteks akses per BU, auth.me memuat BU"`.

---

### Task 5: Relasi item↔BU dan jalur baca terfilter (Kelas: Sonnet)

**Files:**
- Modify: `shared/contract.ts` (`ItemSummaryDto.businessUnits`), `server/src/modules/item/{repo,service,routes}.ts`
- Test: `server/src/modules/item/item.test.ts`, `server/src/modules/item/rest.test.ts`

**Interfaces:**
- Consumes: `UserContext.businessUnits`, `buIdsWithLevel` (T1/T4); `seedItem({ businessUnitIds })`, `seedBusinessUnit` (T2).
- Produces:
  - `visibleBuIds(user: UserContext): string[]` (`buIdsWithLevel(user.businessUnits, 'item', 'view')`) di `server/src/modules/item/access.ts` (berkas baru, dipakai T6 dan T7).
  - `ItemSummaryDto.businessUnits: BusinessUnitRefDto[]` terurut menurut `code`; `ItemView = ItemRecord & { brand: string; businessUnits: BusinessUnitRefDto[] }`.
  - `listItemPage(env, input, user: UserContext)`: filter SQL `i.id IN (SELECT item_id FROM item_business_units WHERE bu_id IN (?, ...))` dengan semua BU terlihat; bila tak ada BU terlihat → `{ items: [], nextCursor: null }` tanpa kueri; BU tiap item pada halaman dimuat dengan SATU kueri tambahan (`item_id IN (...)`).
  - `getItemDto(env, input, user)`: `NOT_FOUND` bila item tak ada ATAU tak beririsan dengan BU terlihat.
  - Rute `items.list`/`items.get` meneruskan `ctx.user`.

- [ ] **Step 1: Tulis tes gagal** (`item.test.ts`/`rest.test.ts`, MariaDB sungguhan): dua BU A/B, item `i1` (A), `i2` (B), `i3` (A+B); user "Semua BU" melihat tiga item; user BU A hanya `i1` dan `i3` (dan `i3.businessUnits` memuat A dan B); user BU B hanya `i2`,`i3`; `items.get` `i2` oleh user BU A → `NOT_FOUND` (bukan `FORBIDDEN`); pencarian `query` tidak membocorkan item BU lain (cari nama `i2`); halaman berkursor tetap benar dengan filter (`limit` 1, ikuti `nextCursor`); user tanpa penugasan BU → daftar kosong dan `items.get` `NOT_FOUND`; BU nonaktif yang melekat tetap memberi hak lihat; user bila diberi level `view` pada BU lalu level dicabut → permintaan berikutnya langsung kosong (konteks dimuat per permintaan).
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd server test src/modules/item` → FAIL.
- [ ] **Step 3: Implementasikan** `access.ts`, perubahan `repo.ts` (`itemBusinessUnitsOf(db, itemIds)`), `service.ts` (daftar, detail, `toItemSummaryDto`/`toItemDto` memuat `businessUnits`), `routes.ts`; perbarui semua pemanggil `listItemPage`/`getItemDto` dan tes lama.
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/item src/modules/brand` dan `bun run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(item): relasi item-BU dan filter BU pada jalur baca"`.

---

### Task 6: Jalur tulis item: aturan BU dan `brandId` (Kelas: Sonnet)

**Files:**
- Modify: `shared/contract.ts` (`SaveItemInput`), `server/src/modules/item/{validate,repo,service,routes}.ts`, `server/src/modules/brand/service.ts` (hapus `planBrandByName` dan pemakai lain yang jadi tak terpakai)
- Test: `server/src/modules/item/item.test.ts`, `server/src/modules/item/rest.test.ts`, `server/src/modules/brand/*.test.ts` (yang memakai nama merk lewat item), `server/src/http/body.test.ts`

**Interfaces:**
- Consumes: `canActOnAllBus`, `buIdsWithLevel` (T1), `visibleBuIds` (T5), `UserContext.businessUnits` (T4).
- Produces:
  - `SaveItemInput`: field `brand: string` DIGANTI `brandId: string`, ditambah `businessUnitIds: string[]` (wajib, tanpa kembar). `validateSaveItem` menolak `businessUnitIds` kosong (`VALIDATION`, field `businessUnitIds`, pesan "Pilih minimal satu BU") dan `brandId` kosong.
  - `saveItem(env, input, actor: UserContext): Promise<ItemDto>` dan `setItemStatus(env, input, actor: UserContext)`.
  - Aturan (spek 5.3, keputusan 13):
    - **Baru:** tiap `businessUnitIds` harus ada, aktif, dan `canActOnAllBus(user.businessUnits,'item','edit', ids)`; BU tak dikenal/nonaktif → `VALIDATION` (field `businessUnitIds`), tanpa hak → `FORBIDDEN` "Anda tidak berhak menambah item ke BU ini"; tanpa BU sama sekali di sistem → `VALIDATION` "Belum ada BU aktif; buat BU dulu".
    - **Ubah:** item tak ada atau tak beririsan BU terlihat → `NOT_FOUND`; user harus `edit` pada SEMUA BU item saat ini, kalau tidak `FORBIDDEN` "Anda tidak berhak mengubah item ini"; BU yang DITAMBAH harus ada, aktif, dan `edit` untuk user; BU lama boleh dilepas atau dipertahankan (termasuk yang nonaktif); himpunan baru tak boleh kosong.
    - **setItemStatus:** `NOT_FOUND` bila tak terlihat; butuh `manage` pada SEMUA BU item, kalau tidak `FORBIDDEN`.
    - Merk: `brandId` harus merk yang ada (`NOT_FOUND`-style `VALIDATION` field `brandId` "Merk tidak ditemukan"); merk nonaktif hanya boleh bila item sudah memakainya (aturan lama); `key = itemKey(brand.name, model)`; `brandKeyGuardStmt` tetap dipakai. `WriteItemOptions.knownBrand` dan `planBrandByName` dihapus (tak ada lagi merk lahir dari teks).
    - Penulisan: himpunan BU diganti di `batch()` yang sama dengan UPDATE/INSERT item (`DELETE FROM item_business_units WHERE item_id = ? AND bu_id NOT IN (...)`-setara + `INSERT` yang ditambah, lewat pernyataan per-BU), di bawah CAS `updated_at` yang sudah ada; `item.update` mengubah `updated_at` sehingga perubahan hanya-BU ikut memicu CAS. Snapshot audit item (`itemSnapshot`) menambah `businessUnits: string[]` (kode BU terurut).
  - Konflik indeks `items_key`/`PRIMARY` tak berubah.

- [ ] **Step 1: Tulis tes gagal** (tambahkan ke `item.test.ts`/`rest.test.ts`; perbarui semua tes lama ke bentuk input baru): (a) user BU A `edit` membuat item di A → sukses, `item_business_units` berisi A, audit `item.create` memuat `businessUnits`; (b) membuat di BU B (tak berhak) → `FORBIDDEN`; (c) BU nonaktif/tak dikenal/`businessUnitIds: []` → `VALIDATION`; (d) tanpa BU di sistem → pesan "buat BU dulu"; (e) item A+B: user `edit` di A saja dan `view` di B → `items.get` OK tetapi `items.save` dan `items.setStatus` → `FORBIDDEN`, user `edit` A dan B → sukses, user `edit` A+B tetapi `manage` hanya A → `setItemStatus` `FORBIDDEN`; (f) menambah BU yang user tak berhak → `FORBIDDEN`; melepas BU → sukses; (g) item di BU lain (tak terlihat) diubah → `NOT_FOUND`; (h) `brandId` tak ada → `VALIDATION` field `brandId`; merk nonaktif untuk item baru ditolak; (i) kunci merk+tipe duplikat di BU berbeda → `CONFLICT` generik "Merk dan tipe sudah dipakai item lain" tanpa menyebut BU; (j) **konkurensi** (`Promise.all`): dua `items.save` serentak atas item yang sama mengubah himpunan BU ke dua himpunan berbeda → hasil akhir salah satu himpunan utuh (tanpa baris yatim/ganda) dan `item_business_units` konsisten; dua pembuatan item identik serentak → tepat satu sukses dan satu `CONFLICT`; (k) rename merk (`brands.save`) sambil `items.save` serentak tetap konsisten (tes lama dipertahankan).
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd server test src/modules/item` → FAIL.
- [ ] **Step 3: Implementasikan** validator, repo (`syncItemBusinessUnitsStmts(db, itemId, current, next)`), service, rute (`saveItem(ctx.env, input, ctx.user)`, `setItemStatus(..., ctx.user)`), hapus `planBrandByName` dan kode mati.
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/item src/modules/brand src/http` dan `bun run typecheck`; `body.test.ts` untuk `items.save` memakai muatan terbesar baru.
- [ ] **Step 5: Commit** `git commit -m "feat(item): aturan tulis menurut BU dan merk lewat brandId"`.

---

### Task 7: Berkas gambar item mengikuti BU (Kelas: Sonnet)

**Files:**
- Modify: `server/src/modules/files/{service,routes}.ts`
- Test: `server/src/modules/files/files.test.ts`

**Interfaces:**
- Consumes: `visibleBuIds` (T5), `UserContext` (T4).
- Produces: `readFile(env, input: GetFileInput, viewer: FileViewer): Promise<FileContentDto>` dengan `FileViewer = { email: string; itemBuIds: readonly string[] | null }` (`null` = tak punya izin `item` global: perilaku lama "hanya logo `qrlogo` dan unggahan sendiri yang belum terpasang"; array = BU terlihat user). Berkas `ownerType === 'item'` hanya terbaca bila item pemiliknya beririsan dengan `itemBuIds`, selain itu `NOT_FOUND` "Berkas tidak ditemukan"; jenis pemilik lain tak berubah. Pemeriksaan BU memakai SATU kueri (`SELECT 1 FROM item_business_units WHERE item_id = ? AND bu_id IN (...) LIMIT 1`) dan dijalankan SEBELUM cache isi berkas dibaca.

- [ ] **Step 1: Tulis tes gagal:** berkas milik item BU A dibaca user BU A (OK) dan user BU B (`NOT_FOUND`, pesan sama dengan berkas tak ada); user BU A membaca berkas item A+B; berkas logo QR tetap terbaca user `qrcode` tanpa `item`; unggahan milik sendiri yang belum terpasang tetap terbaca; user tanpa penugasan BU tetapi `item` global `none` memakai jalur lama; isi berkas tidak diambil dari cache bila BU tak cocok (spy pada `cachedFileContent`/jembatan palsu: panggilan 0 kali).
- [ ] **Step 2: Jalankan**: `bun run --cwd server test src/modules/files` → FAIL.
- [ ] **Step 3: Implementasikan** perubahan di `service.ts` dan `routes.ts` (rakit `FileViewer` dari `ctx.user`: `itemBuIds = hasLevel(user.permissions.item,'view') ? visibleBuIds(user) : null`).
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/files src/modules/qrcode` dan `bun run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(files): berkas item hanya terbaca oleh user yang berhak atas BU item"`.

---

### Task 8: BU bawaan pada merk (Kelas: Sonnet)

**Files:**
- Modify: `shared/contract.ts` (`BrandDto`, `SaveBrandInput`), `server/src/modules/brand/{repo,service,validate}.ts`
- Test: `server/src/modules/brand/brand.test.ts`, `server/src/modules/brand/rest.test.ts`, `server/src/modules/brand/brand-rename.test.ts`

**Interfaces:**
- Consumes: tabel `brand_default_business_units` (T2), `seedBusinessUnit` (T2).
- Produces: `BrandDto.businessUnitIds: string[]` (terurut menurut kode BU), `SaveBrandInput.businessUnitIds: string[]` (boleh kosong; tanpa kembar). Aturan: BU yang DITAMBAH harus ada dan aktif (`VALIDATION`, field `businessUnitIds`); BU lama (termasuk nonaktif) boleh dipertahankan; siapa pun dengan `brands.save` (`item: edit` global) boleh mengatur; BU bawaan tidak memberi hak apa pun. `brands.save` (buat maupun ubah) menulis himpunan di `batch()`/transaksi yang sama dan menaikkan `updated_at` merk bila himpunan berubah, termasuk saat nama tak berubah (jalur `renameBrand` tidak lagi `return` dini bila hanya BU bawaan yang berubah). Audit merk (`brandSnapshot`) memuat `businessUnits` (kode BU terurut). `brands.list` memuat `businessUnitIds` lewat SATU kueri tambahan (bukan N+1). `brands.setStatus` tak berubah.

- [ ] **Step 1: Tulis tes gagal:** membuat merk dengan dua BU bawaan → `brands.list` memuatnya terurut; mengubah hanya BU bawaan (nama sama) → tersimpan, `updatedAt` naik, audit `brand.update` memuat `businessUnits` sebelum/sesudah; BU nonaktif baru → `VALIDATION`, BU nonaktif lama dipertahankan OK; BU tak dikenal → `VALIDATION`; `businessUnitIds: []` OK; user `item: edit` global (BU apa pun) boleh mengatur BU bawaan di BU yang tak ia kuasai; rename serentak dengan perubahan BU bawaan (`Promise.all`) tidak merusak (himpunan akhir salah satu dari keduanya, tanpa baris yatim); tes rename/konkurensi lama tetap hijau; `body.test.ts` `brands.save`.
- [ ] **Step 2: Jalankan**: `bun run --cwd server test src/modules/brand` → FAIL.
- [ ] **Step 3: Implementasikan** repo (`brandDefaultBusinessUnits(env)`, `syncBrandDefaultBuStmts(db, brandId, next)`), service (`saveBrand`, `renameBrand` → mis. `updateBrand`), validator.
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/brand src/modules/item src/http` dan `bun run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(brand): BU bawaan pada merk"`.

---

### Task 9: Komponen `LinkField` (web) (Kelas: Sonnet)

**Files:**
- Create: `web/src/components/link-field.tsx`, `web/src/components/link-field.test.tsx`; komponen shadcn `popover` dan `command` (jalankan `bunx --bun shadcn@latest add popover command` dari `web/`; dikecualikan dari lint)
- Test: `web/src/components/link-field.test.tsx`

**Interfaces:**
- Produces:
  - `export interface LinkOption { id: string; label: string; description?: string; disabled?: boolean }`
  - `interface LinkFieldCommon { id: string; label: string; options: readonly LinkOption[]; placeholder?: string; loading?: boolean; hasMore?: boolean; onSearchChange?: (term: string) => void; searchDebounceMs?: number /* bawaan 200 */; onCreate?: () => void /* tombol tambah tampil hanya bila ada */; openHref?: (id: string) => string | null /* tombol panah: tab baru */; error?: string; disabled?: boolean }`
  - `LinkField(props: LinkFieldCommon & { value: string | null; onChange: (id: string | null) => void })` — nilai satu record, tombol X mengosongkan.
  - `LinkMultiField(props: LinkFieldCommon & { value: readonly string[]; onChange: (ids: string[]) => void; labelOf: (id: string) => string })` — nilai terpilih tampil sebagai chip (tombol hapus per chip, `aria-label="Hapus {label}"`); opsi yang sudah terpilih tidak ditawarkan lagi.
  - Perilaku: mengetik hanya mencari; menutup daftar dengan teks yang tak cocok mengosongkan teks (nilai tak berubah); `hasMore` memunculkan petunjuk "Ada hasil lain, persempit pencarian"; `disabled` opsi tak dapat dipilih.

- [ ] **Step 1: Tulis tes gagal** (Testing Library + user-event): memilih opsi memanggil `onChange(id)`; X memanggil `onChange(null)`; ketik teks tanpa pasangan lalu tutup → teks dikosongkan, `onChange` tidak dipanggil; `onSearchChange` dipanggil sekali setelah debounce (fake timers) dengan teks terakhir; `onCreate` hanya membuat tombol "Tambah" muncul bila disediakan dan dipanggil saat diklik; multi: memilih dua opsi → dua chip dan `onChange([a,b])`; menghapus chip → `onChange` tanpa id itu; opsi terpilih hilang dari daftar; `hasMore` menampilkan petunjuk; `openHref` menghasilkan tautan `target="_blank"` hanya bila mengembalikan string; `error` tampil lewat `role="alert"` (pola `FieldError`).
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd web test src/components/link-field.test.tsx` → FAIL.
- [ ] **Step 3: Tambah komponen shadcn, lalu implementasikan `link-field.tsx`** (Popover + Command, teks pencarian lokal + `useEffect` debounce ke `onSearchChange`).
- [ ] **Step 4: Jalankan** `bun run --cwd web test src/components` dan `bunx biome check web/src/components`.
- [ ] **Step 5: Commit** `git commit -m "feat(web): komponen LinkField dan LinkMultiField"`.

---

### Task 10: Halaman BU dan penugasan BU di form user (Kelas: Sonnet)

**Files:**
- Create: `web/src/routes/_app/access/business-units.tsx`, `web/src/modules/access/components/business-unit-form.tsx`, `web/src/modules/access/components/business-units-table.tsx` (+ tes `.test.tsx` masing-masing)
- Modify: `web/src/modules/access/queries.ts` (`businessUnitsQueryOptions`, `useSaveBusinessUnit`, `useSetBusinessUnitStatus`, `businessUnitOptionsQueryOptions`), `web/src/modules/access/schemas.ts` (`businessUnitFormSchema`, `toBusinessUnitFormDefaults`, `userFormSchema.buAssignments`, `toUserFormDefaults`), `web/src/modules/access/components/user-form.tsx`, `web/src/modules/access/components/users-table.tsx`, `web/src/app/navigation.ts` (menu "Business Unit" di grup Pengaturan Akses, izin `access: view`), `web/src/routeTree.gen.ts` (dibangkitkan generator router), `web/src/routes/_app/access/users.tsx`

**Interfaces:**
- Consumes: kontrak BU (T3), `UserDto.buAssignments`/`SaveUserInput.buAssignments` (T4), pola `locations.tsx`/`location-form.tsx`/`locations-table.tsx`.
- Produces: halaman `/access/business-units` (tabel kode, nama, status, jumlah item, jumlah user; tombol ubah/nonaktifkan hanya bila `can(me,'access','manage')`; menonaktifkan BU yang `itemCount > 0 || userCount > 0` membuka konfirmasi yang menyebut jumlah item dan user (tidak memblokir); form kode (huruf besar/angka/tanda hubung, maks. 10, tak dapat diubah saat mengubah) dan nama). Bagian **"Penugasan BU"** di `user-form.tsx`, terpisah dari "Penugasan lokasi", memakai pola baris yang sama: pilih BU atau "Semua BU" (kunci `'*'` → `buId: null`), lalu role; teks bantu "Hak BU berlaku sama di semua lokasi; hanya modul ber-BU (Data Item) yang dibaca dari role di sini"; skema menolak BU kembar dan baris tanpa role.

- [ ] **Step 1: Tulis tes gagal:** tabel menampilkan kolom dan menyembunyikan aksi tanpa `access: manage`; konfirmasi nonaktif memuat jumlah; form BU menolak kode > 10 karakter dan huruf kecil diubah jadi huruf besar; `userFormSchema` menolak baris BU tanpa role dan BU kembar; `toUserFormDefaults` memetakan `buId: null` ↔ `'*'` dan membuang role basi; `user-form` mengirim `buAssignments` pada submit dan menampilkan BU nonaktif yang sudah ditugaskan dengan label "— nonaktif".
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd web test src/modules/access` → FAIL.
- [ ] **Step 3: Implementasikan** halaman, komponen, query, skema, navigasi (`bunx` generator rute dijalankan oleh `bun run dev`/`vite build`; periksa bahwa `routeTree.gen.ts` terbarui).
- [ ] **Step 4: Jalankan** `bun run --cwd web test src/modules/access src/app` dan `bun run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(web): halaman BU dan penugasan BU di form user"`.

---

### Task 11: Form item: Merk (LinkField) dan BU (chip) (Kelas: Sonnet)

**Files:**
- Create: `web/src/modules/brand/components/brand-form-dialog.tsx` (+ tes; diekstrak dari `brands-manager.tsx`), `web/src/modules/item/lib/default-business-units.ts` (+ tes)
- Modify: `web/src/modules/item/{schemas,queries}.ts`, `web/src/modules/item/components/{item-form,items-table,item-detail-view}.tsx`, `web/src/modules/brand/components/brands-manager.tsx`, `web/src/modules/auth/permissions.ts` (+ tes), tes komponen yang ada
- Modify (rute): `web/src/routes/_app/item/new.tsx`, `web/src/routes/_app/item/$itemId/*`

**Interfaces:**
- Consumes: `LinkField`/`LinkMultiField` (T9), `MeDto.businessUnits` (T4), `SaveItemInput.brandId`/`businessUnitIds` (T6), `BrandDto.businessUnitIds` (T8), `ItemSummaryDto.businessUnits` (T5), `businessUnitOptionsQueryOptions` (T10).
- Produces:
  - `permissions.ts`: `buIdsWithLevelFor(me, level: Level): string[]` (BU `item` dengan level ≥ `level`), `canEditItem(me, item: { businessUnits: readonly BusinessUnitRefDto[] }): boolean` (`edit` pada SEMUA BU item), `canManageItem(me, item)` (`manage` pada semua), `canCreateItem(me): boolean` (ada ≥ 1 BU aktif ber-`edit`).
  - `itemFormSchema`: `brand` → `brandId: z.string().min(1, 'Pilih merk')`; `businessUnitIds: z.array(z.string()).min(1, 'Pilih minimal satu BU')`; `toItemFormDefaults`/`toSaveItemInput` disesuaikan.
  - `defaultBusinessUnitIds(brand: BrandDto | undefined, editableActiveBuIds: readonly string[]): string[]` = `brand.businessUnitIds ∩ editableActiveBuIds` (BU bawaan di luar hak disaring, bukan ditolak diam-diam).
  - Form item: field **Merk** = `LinkField` (opsi merk aktif + merk item bila nonaktif; tombol tambah membuka `BrandFormDialog` hanya bila `can(me,'item','edit')`, merk baru langsung terpilih; panah membuka `/item/brands` di tab baru); field **BU** = `LinkMultiField` (opsi: BU aktif ber-`edit` + BU yang sudah melekat). Memilih merk mengisi BU dari BU bawaan HANYA bila user belum mengubah field BU secara manual; tetap bisa diubah. Tombol "Ubah"/"Nonaktifkan" di detail dan tabel tampil sesuai `canEditItem`/`canManageItem`; tombol "Tambah item" sesuai `canCreateItem`; user tanpa BU aktif ber-`edit` melihat pesan "Belum ada BU yang dapat Anda isi; hubungi admin" di form baru. `items-table`/`item-detail-view` menampilkan chip BU (`Badge`).

- [ ] **Step 1: Tulis tes gagal:** `canEditItem` (semua BU `edit` → true; satu `view` → false; item tanpa BU → false), `canCreateItem` (tanpa BU aktif ber-`edit` → false); `defaultBusinessUnitIds` menyaring BU di luar hak/nonaktif; form: memilih merk berBU-bawaan mengisi chip BU, memilih BU manual dulu lalu merk TIDAK menimpa; tombol tambah merk hanya untuk `item: edit`; submit mengirim `brandId` dan `businessUnitIds`; galat server `fields.brandId`/`businessUnitIds` tampil di field masing-masing; detail menampilkan chip BU dan menyembunyikan "Ubah" bila `canEditItem` false; tabel menampilkan chip BU; `brands-manager` memakai `BrandFormDialog` yang sama (tes lama hijau).
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd web test src/modules/item src/modules/brand src/modules/auth` → FAIL.
- [ ] **Step 3: Ekstrak `BrandFormDialog`, ubah skema/queries/form/tabel/detail dan helper izin.** Perbarui `queries.ts` (`toItemSummary` ikut `businessUnits`; cache `query-persist` whitelist tak berubah).
- [ ] **Step 4: Jalankan** `bun run --cwd web test` (penuh) dan `bun run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(web): form item memakai LinkField untuk Merk dan BU"`.

---

### Task 12: BU bawaan di form merk (Kelas: Haiku)

**Files:**
- Modify: `web/src/modules/brand/components/brand-form-dialog.tsx`, `web/src/modules/brand/components/brands-manager.tsx`, `web/src/modules/brand/queries.ts`, tes terkait
- Test: `web/src/modules/brand/components/brands-manager.test.tsx`, `web/src/modules/brand/components/brand-form-dialog.test.tsx`

**Interfaces:**
- Consumes: `LinkMultiField` (T9), `businessUnitOptionsQueryOptions` (T10), `BrandDto.businessUnitIds`/`SaveBrandInput.businessUnitIds` (T8).
- Produces: field "BU bawaan" (`LinkMultiField`, opsi = semua BU aktif; BU nonaktif yang sudah melekat tetap tampil sebagai chip "— nonaktif") di `BrandFormDialog`; tabel merk menampilkan kolom BU bawaan (chip, kode BU). Kirim `businessUnitIds` (boleh kosong) pada simpan.

- [ ] **Step 1: Tulis tes gagal:** dialog menampilkan chip BU bawaan merk yang diubah; memilih BU lalu simpan mengirim `businessUnitIds`; menyimpan tanpa BU mengirim `[]`; BU nonaktif lama tampil dan boleh dilepas; tabel memuat kolom BU bawaan.
- [ ] **Step 2: Jalankan, pastikan gagal**: `bun run --cwd web test src/modules/brand` → FAIL.
- [ ] **Step 3: Implementasikan** field dan kolom.
- [ ] **Step 4: Jalankan** `bun run --cwd web test src/modules/brand src/modules/item` dan `bun run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(web): BU bawaan pada form merk"`.

---

### Task 13: Dokumen dan verifikasi akhir (Kelas: Haiku untuk dokumen, Sonnet untuk verifikasi)

**Files:**
- Modify: `CLAUDE.md`, `docs/adding-a-module.md`, `docs/prd/2026-10-09-qc-item-serah-terima.md`, `docs/e2e-checklist.md`, `docs/superpowers/specs/2026-11-08-business-unit-design.md` (status disetujui, pengecualian (d) ekspor Sheets bila pemilik menyetujui, Keputusan Plan #2–#7), `docs/prd/*` yang menyebut izin `item` per lokasi

**Interfaces:** tidak ada kode baru.

- [ ] **Step 1: Perbarui dokumen:** `CLAUDE.md` (Struktur: modul BU server/web, `shared/business-units.ts`, `LinkField`; Aturan server: `item` kini dari penugasan BU, `UserContext.businessUnits`, filter BU di SQL, `NOT_FOUND` di luar hak, tanpa backfill hak lama; Menambah rute REST: butir "modul ber-BU" menunjuk `BU_MODULES`), `docs/adding-a-module.md` (resep modul ber-BU), PRD item (tabel hak per BU, FI baru untuk BU/merk), `docs/e2e-checklist.md` (skenario: user BU A tak melihat item BU B; item A+B dengan `view` di B; merk bawaan mengisi BU; BU nonaktif), spek (status "Disetujui 2026-11-08", butir pengecualian yang dikonfirmasi).
- [ ] **Step 2: Verifikasi penuh:** `bun run check` (typecheck + Biome + semua tes; tunnel hidup) dan `bun run build` → hijau.
- [ ] **Step 3: Uji manual di server dev** (jangan menghentikan server :3000; pengguna dev dan data seed memakai BU `UM`/`ENT`): buka `/access/business-units`, buat BU, tugaskan user "Penugasan BU", buat item lewat form (merk LinkField + chip BU), periksa user BU berbeda tak melihat item. Catat hasil.
- [ ] **Step 4: Commit** `git commit -m "docs: BU tahap 1 (CLAUDE.md, resep modul, PRD, checklist e2e)"`.

---

## Self-Review

**Cakupan spek:** master BU (5.1) → T3; penugasan & izin (5.2) → T1, T4; relasi item↔BU, filter baca, berkas, BU nonaktif, aturan tulis (5.3) → T5, T6, T7; BU bawaan merk (5.4) → T8, T12; `LinkField` (5.5) → T9, T11; sinkron (5.6) → tak ada pekerjaan (modul dihapus); migrasi/bootstrap (5.7) → T2, T4 (tanpa backfill pengguna lama, keputusan 14); dokumen (bagian 4) → T13. Anti-tujuan: jalur bocor (daftar, detail, pencarian, berkas) → T5, T7; OpenAPI dan `GET /me` tidak memuat data item (`me` hanya BU milik user) → diverifikasi di T4.
**Pemindaian langkah:** tiap langkah bertanda tangan/asersi eksplisit; tak ada "TBD".
**Konsistensi tipe:** `BuAssignment`/`BuPermissionMap`/`canActOnAllBus`/`visibleBuIds`/`FileViewer`/`BusinessUnitRefDto` dipakai konsisten (T1 → T4–T7, T10–T11); `SaveItemInput.brandId`+`businessUnitIds` (T6) dipakai T11; `BrandDto.businessUnitIds` (T8) dipakai T11–T12.
**Review Focus:** semua lima baris punya tes di task pemilik (T2, T4, T5, T6, T7).
**Proporsi:** rencana ± 3x spek (spek ± 150 baris, tugas lintas lapisan server+web); tiap task berisi signature dan asersi, bukan badan fungsi.
