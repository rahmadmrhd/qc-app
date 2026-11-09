# Stiker Management 3a (Katalog dan Stok) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin mengelola jenis dan stiker; petugas mencatat stok masuk, keluar, koreksi, dan stok opname per lokasi (satuan butir) dengan riwayat; sistem menandai stiker yang total stoknya ≤ batas minimum.

**Architecture:** Dua modul izin baru: `sticker` (global, katalog; levelnya dihitung seperti `qrcode`, lewat `SHARED_MODULES`) dan `stickerstock` (berlokasi, stok). Satu modul server `server/src/modules/sticker/` (repo, service, validate, routes) mengikuti pola `brand`; penulisan stok memakai CAS di dalam `batch()`. Web: `web/src/modules/sticker/` dengan tiga halaman (Stiker, Jenis, Stok) mengikuti pola halaman Merk.

**Tech Stack:** Bun, Hono, MariaDB 11.8 (adaptor `Db`), zod, React, TanStack Router/Query/Form, shadcn, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md` (induk: `docs/superpowers/specs/2026-11-08-business-unit-design.md`, keputusan 23). Baca `CLAUDE.md` (bagian "Aturan server") dan `docs/adding-a-module.md` sebelum mulai.

## Global Constraints

- Migrasi `server/migrations/0005_stiker.sql`: hanya DDL, expand-only, idempoten (`IF NOT EXISTS`), kolom string mengikuti `0004_business_units.sql` (`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin`, tanpa kunci asing). Kunci kecocokan tak-peka-huruf lewat kolom virtual `*_key` (`LOWER(...)`) seperti `business_units.name_key`.
- Parameter SQL selalu `?` dan di-bind; penulisan stok dijaga CAS di dalam `batch()` (`server/src/core/cas.ts`), tanpa baca-lalu-tulis tak terjaga; galat usang lewat `staleError(message)`; stok tak pernah negatif.
- Rute berlokasi: `scope: 'location'`, pakai `ctx.locationIds`/`locationId`, jangan input mentah; lokasi tak dikenal, nonaktif, atau tanpa level cukup menolak seluruh permintaan.
- Bukan BU-limited: stiker dan stok tidak difilter BU (keputusan 23). Tidak ada notifikasi menipis. Pemotongan otomatis dan kelompok item bukan bagian rencana ini.
- Riwayat stok hanya ditambah (tanpa rute ubah/hapus). Stiker/jenis tidak pernah dihapus, hanya dinonaktifkan.
- UI berbahasa Indonesia; komponen shadcn; form dialog memakai `FormDialog`; pilihan BU memakai `LinkMultiField`; server state TanStack Query; form TanStack Form + zod.
- Batas (dipatok di `shared/stickers.ts`, `STICKER_LIMITS`): nama 120, alias 120, alasan 300 karakter; jumlah butir per catatan dan batas minimum ≤ 1.000.000; maks. 100 pasangan stiker×lokasi per opname; maks. 20 baris lembar per hitungan.
- `bun run check` hijau (butuh `bun run db:tunnel` hidup) sebelum tiap komit; Biome bersih; berkas LF; komit dengan path eksplisit.

## Review Focus

Masalah yang tidak disebut spek tetapi mungkin menggigit pemakai; tiap baris punya tes di task pemiliknya:
1. Dua pencatatan stok keluar serentak melebihi stok (stok 10, dua permintaan keluar 8): tepat satu berhasil, stok akhir 2, tak pernah negatif (Task 5).
2. Opname banyak baris dengan satu baris usang: seluruhnya ditolak dan tidak ada yang tertulis (Task 6).
3. Pengguna dengan izin stok di lokasi A tidak dapat mencatat atau melihat lokasi B; `low` memakai total semua lokasi tetapi angka total hanya lokasi yang berhak (Task 5).
4. Stiker nonaktif: masuk ditolak, keluar/koreksi/opname boleh, tidak pernah `low`; stiker baru di jenis nonaktif ditolak (Task 4, 5).
5. Nama sama beda huruf besar/kecil atau spasi ekor pada satu jenis = konflik generik; nama sama di jenis lain boleh; jenis stiker dan aturan jenis tak dapat diubah setelah terkunci (Task 3, 4).

---

### Task 1: Modul izin `sticker` dan `stickerstock`

**Files:**
- Modify: `shared/permissions.ts`, `shared/assignments.ts` (+ tes `shared/permissions.test.ts`, `shared/assignments.test.ts`), `web/src/app/module-links.ts`, `server/scripts/seed-data.ts`, dan setiap lokasi lain yang memaksa `Record<ModuleKey, …>` atau `LocationPermissionMap` (temukan lewat typecheck; `server/src/modules/access/context.ts`, `server/src/modules/auth/api.ts`, `shared/contract.ts` termasuk).

**Interfaces:**
- Produces: `ModuleKey` bertambah `'sticker' | 'stickerstock'`; `MODULE_LABELS.sticker = 'Katalog Stiker'`, `.stickerstock = 'Stok Stiker'`; `MODULE_LEVELS` keduanya `['none','view','edit','manage']`; `LOCATION_MODULES` bertambah `'stickerstock'`; `SHARED_MODULES` bertambah `'sticker'`; `fullLocationPermissions()` memuat `stickerstock: 'manage'`.
- Hint level (teks `MODULE_LEVEL_HINTS`): `sticker`: view "Melihat katalog jenis dan stiker.", edit "Menambah dan mengubah jenis dan stiker, termasuk batas minimum.", manage "Semua akses Ubah, ditambah menonaktifkan dan mengaktifkan jenis dan stiker."; `stickerstock`: view "Melihat stok dan riwayat stiker di lokasi penugasan.", edit "Melihat serta mencatat stok masuk dan keluar.", manage "Semua akses Ubah, ditambah koreksi dan stok opname."

- [ ] **Step 1: Tulis tes yang gagal.** Di `shared/assignments.test.ts`: `resolveAccess` memberi `global.sticker` dari penugasan lokasi mana pun (seperti `qrcode`) dan `byLocation[<lokasi>].stickerstock` hanya untuk lokasi itu ditambah "Semua lokasi". Di `shared/permissions.test.ts`: `sanitizePermissions({ sticker: 'manage', stickerstock: 'edit' })` mempertahankan keduanya.
- [ ] **Step 2: Jalankan** `bun test shared` → gagal (modul tak dikenal).
- [ ] **Step 3: Implementasi** perubahan konstanta di atas; jalankan `bun run typecheck` dan perbaiki setiap peta eksaustif yang gagal (nilai awal `none`; role seed dev memberi `sticker: 'manage'`, `stickerstock: 'manage'` pada role admin contoh). `module-links.ts`: `sticker: '/sticker'`, `stickerstock: '/sticker/stock'`.
- [ ] **Step 4: Jalankan** `bun run check` → hijau (tes web untuk form role ikut menyesuaikan daftar modul).
- [ ] **Step 5: Komit** `feat(izin): modul sticker dan stickerstock`.

### Task 2: Logika murni `shared/stickers.ts` dan jenis pemilik berkas `sticker`

**Files:**
- Create: `shared/stickers.ts`, `shared/stickers.test.ts`
- Modify: `shared/files.ts` (`FileOwnerType` bertambah `'sticker'`)

**Interfaces:**
- Produces (`shared/stickers.ts`):
  - `STICKER_LIMITS` (nilai di Global Constraints), `STICKER_RULES = ['bu', 'none'] as const`, `type StickerRule`, `STOCK_ENTRY_KINDS = ['in','out','adjust','opname'] as const`, `type StockEntryKind`.
  - `interface StockCount { rows: { sheets: number; perSheet: number }[]; loose: number }`
  - `piecesOfCount(count: StockCount): number` = Σ `sheets × perSheet` + `loose`.
  - `isLowStock(input: { status: 'active' | 'inactive'; minQty: number; total: number }): boolean` = aktif dan `minQty > 0` dan `total <= minQty`.
  - `stickerKey(name: string): string` = `normalizeKey(name)` dari `shared/items.ts`.

- [ ] **Step 1: Tes** `piecesOfCount({ rows: [{ sheets: 10, perSheet: 12 }, { sheets: 3, perSheet: 10 }], loose: 5 })` = 155; `piecesOfCount({ rows: [], loose: 7 })` = 7; `isLowStock` benar untuk (aktif, min 50, total 50) dan (aktif, min 50, total 20), salah untuk (aktif, min 50, total 51), (aktif, min 0, total 0), (nonaktif, min 50, total 0); `stickerKey('  Stiker  Hijau ')` = `stickerKey('stiker hijau')`.
- [ ] **Step 2: Jalankan** `bun test shared/stickers.test.ts` → gagal.
- [ ] **Step 3: Implementasi** sesuai signature di atas.
- [ ] **Step 4: Jalankan** tes yang sama + `bun run typecheck` → lulus.
- [ ] **Step 5: Komit** `feat(stiker): logika murni stok dan batas`.

### Task 3: Migrasi dan jenis stiker (server)

**Files:**
- Create: `server/migrations/0005_stiker.sql`, `server/src/modules/sticker/{repo,service,validate,routes}.ts`, `server/src/modules/sticker/type.test.ts`, `server/src/modules/sticker/rest.test.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/routes.ts` (daftar `ALL_API_IDS` dan `realRoutes`), `shared/api.test.ts` bila tabel batas ikut diuji

**Interfaces:**
- Migrasi memuat semua tabel 3a (agar satu migrasi): `sticker_types(id, name, name_key virtual, rule, status, created_at, updated_at, updated_by; UNIQUE sticker_types_name_unique(name_key))`, `stickers(id, type_id, name, name_key virtual, alias, file_id, min_qty BIGINT, status, created_at, updated_at, updated_by; UNIQUE stickers_type_name_unique(type_id, name_key))`, `sticker_business_units(sticker_id, bu_id; PK gabungan, indeks bu_id)`, `sticker_stock(sticker_id, location_id, qty BIGINT, updated_at; PK(sticker_id, location_id))`, `sticker_stock_entries(id BIGINT AUTO_INCREMENT, sticker_id, location_id, kind, delta BIGINT, qty_after BIGINT, count_json LONGTEXT, reason, actor, ts; indeks (sticker_id, ts), (location_id, ts))`.
- Kontrak: `StickerTypeDto { id; name; rule: StickerRule; status: 'active' | 'inactive'; stickerCount: number; updatedAt: string }`; `SaveStickerTypeInput { id?: string; name: string; rule: StickerRule }`; `SetStickerTypeStatusInput { id: string; status: 'active' | 'inactive' }` (bentuk persis seperti input `brands.*` padanannya). Id baru: `'stickerTypes.list'` (GET `/sticker-types`), `'stickerTypes.save'` (PUT `/sticker-types/{id}`, create POST `/sticker-types`), `'stickerTypes.setStatus'` (PATCH `/sticker-types/{id}`, `etag: 'updatedAt'`).
- Izin rute: list = `sticker: view`; save = `sticker: edit`; setStatus = `sticker: manage`. Fungsi: `listStickerTypes(env)`, `saveStickerType(env, input, actor)`, `setStickerTypeStatus(env, input, actor)` di `service.ts`.
- Perilaku: nama unik tak-peka-huruf (`mapDuplicateError`, pesan "Nama jenis sudah dipakai"); `rule` tak dapat diubah bila sudah ada stiker pada jenis itu (`VALIDATION`, pesan "Aturan jenis tidak dapat diubah karena sudah ada stiker"); audit `stickerType.create|update|status` lewat `writeAudit` dalam `batch()` yang sama; `stickerCount` menghitung stiker.

- [ ] **Step 1: Tes** (`type.test.ts` + `rest.test.ts`, pola `brand.test.ts`/`rest.test.ts`): buat jenis ("QC", `bu`) lalu daftar memuatnya dengan `stickerCount` 0; nama "qc " (beda huruf/spasi ekor) ditolak dengan pesan generik; `rule` bernilai `'group'` ditolak `VALIDATION`; pengguna dengan `sticker: view` saja ditolak `FORBIDDEN` pada save; nonaktifkan lalu aktifkan; audit memuat `stickerType.create`.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/sticker` → gagal.
- [ ] **Step 3: Implementasi** migrasi, kontrak, rute, validator, repo, service sesuai Interfaces (pola `server/src/modules/brand/*`; daftarkan di `server/src/routes.ts`).
- [ ] **Step 4: Jalankan** tes yang sama + `bun run typecheck` → lulus.
- [ ] **Step 5: Komit** `feat(stiker): migrasi dan jenis stiker`.

### Task 4: Stiker (server) dan akses berkas gambar contoh

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/sticker/{repo,service,validate,routes}.ts`, `server/src/modules/files/{routes,service}.ts`, `server/src/modules/access/*` atau `server/src/modules/item/*` hanya bila rute `businessUnits.options` perlu izin tambahan (lihat Step 4)
- Create: `server/src/modules/sticker/catalog.test.ts`

**Interfaces:**
- Consumes: Task 3 (`sticker_types`, `stickers`, `sticker_business_units`), `planAttachFiles(env, ids, 'sticker', stickerId)`.
- Produces: `StickerDto { id; typeId; typeName; name; alias: string; fileId: string | null; minQty: number; status; businessUnitIds: string[]; low: boolean; updatedAt }` (`low` dihitung dari total seluruh lokasi lewat `isLowStock`); `SaveStickerInput { id?: string; typeId: string; name: string; alias: string; fileId: string | null; minQty: number; businessUnitIds: string[] }`; id `'stickers.list'` (GET `/stickers`), `'stickers.save'` (PUT/POST `/stickers`), `'stickers.setStatus'` (PATCH, etag `updatedAt`). Izin: list view, save edit, setStatus manage (modul `sticker`).
- Aturan: `typeId` dan jenisnya tak dapat diubah setelah dibuat; stiker baru di jenis nonaktif ditolak; BU baru harus aktif (pola `assertDefaultBusinessUnits` merk), jenis ber-`rule: 'none'` memaksa `businessUnitIds = []`, `'bu'` mewajibkan ≥ 1; nama unik per jenis (`stickers_type_name_unique`, pesan "Nama stiker sudah dipakai pada jenis ini"); berkas gambar dipasang lewat `planAttachFiles` dengan pemilik `'sticker'` dan audit `sticker.create|update|status` mencatat `minQty`.
- Berkas: `files.upload` anyOf bertambah `{ module: 'sticker', level: 'edit' }`; `files.get` anyOf bertambah `{ module: 'sticker', level: 'view' }`; `FileViewer` mendapat `canReadStickerFiles: boolean` (benar bila `sticker: view` atau berhak `item: view`) dan `readFile` mengizinkan `ownerType === 'sticker'` bila benar, di cabang `itemBuIds === null` juga.

- [ ] **Step 1: Tes** (`catalog.test.ts`): buat stiker "QC Spectrum/Teakwave" di jenis QC dengan dua BU → `businessUnitIds` urut stabil; stiker di jenis `none` dengan BU ditolak; stiker ke-dua bernama "qc spectrum/teakwave " pada jenis sama = konflik, pada jenis lain berhasil; `typeId` tak dapat diubah (VALIDATION); jenis nonaktif menolak stiker baru; stiker nonaktif → `low: false` walau stok 0 dan min 10; berkas contoh: pemegang `sticker: view` tanpa izin item dapat `files.get` berkas pemilik `sticker`, tetapi tidak berkas item.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/sticker src/modules/files` → gagal.
- [ ] **Step 3: Implementasi** sesuai Interfaces.
- [ ] **Step 4: Periksa izin rute `businessUnits.options`**: bila `sticker: view/edit` belum mencukupi, tambahkan sebagai alternatif `anyOf` (tes: pengguna `sticker: edit` tanpa izin lain memuat opsi BU).
- [ ] **Step 5: Jalankan** tes yang sama + `bun run typecheck`; komit `feat(stiker): katalog stiker dan akses gambar contoh`.

### Task 5: Stok masuk, keluar, koreksi, daftar, dan riwayat (server)

**Files:**
- Create: `server/src/modules/sticker/stock-service.ts`, `server/src/modules/sticker/stock-repo.ts`, `server/src/modules/sticker/stock.test.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/sticker/{validate,routes}.ts`

**Interfaces:**
- Consumes: Task 2 (`StockCount`, `piecesOfCount`, `isLowStock`), Task 4 (tabel dan `StickerDto`).
- Produces (kontrak): `StickerStockDto { stickerId: string; total: number; byLocation: { locationId: string; qty: number }[] }` (total = jumlah lokasi di `locationIds` permintaan); `RecordStockInput { locationId: string; stickerId: string; kind: 'in' | 'out'; quantity?: number; count?: StockCount; reason: string }` (tepat satu dari `quantity` atau `count`; `reason` wajib untuk `out`); `AdjustStockInput { locationId; stickerId; delta: number /* ≠ 0, bertanda */; reason: string /* wajib */ }`; `StockEntryDto { id: string; stickerId; locationId; kind: StockEntryKind; delta: number; qtyAfter: number; count: StockCount | null; reason: string; actor: string; ts: string }`; `StockHistoryPageDto { entries: StockEntryDto[]; nextCursor: string | null }`.
- Id: `'stickerStock.list'` GET `/sticker-stock` (query `locationIds` list; izin `stickerstock: view`, `scope: 'location'`; input `{ locationIds }`), `'stickerStock.record'` POST `/sticker-stock/entries` (`stickerstock: edit`, location), `'stickerStock.adjust'` POST `/sticker-stock/adjustments` (`stickerstock: manage`, location), `'stickerStock.history'` GET `/sticker-stock/entries` (query `locationIds`, `stickerId`, `cursor`, `limit`; view, location; halaman bawaan 50, maks. 200, terbaru dahulu pola `listAudit`).
- Perilaku: masuk menambah (baris stok dibuat saat catatan pertama); keluar dan koreksi negatif mengurangi dengan penjaga CAS — gagal = `VALIDATION` "Stok tidak cukup"; masuk pada stiker nonaktif = `VALIDATION`; keluar/koreksi pada stiker nonaktif diizinkan; `count` menjadi `delta` lewat `piecesOfCount` (> 0) dan disimpan di `count_json`; riwayat tertulis di `batch()` yang sama dengan perubahan stok (`qty_after` diambil dari stok sesudah pembaruan); `list` mengembalikan baris hanya untuk stiker aktif atau yang stoknya > 0 pada lokasi diminta.

- [ ] **Step 1: Tes** (`stock.test.ts`, `createTestEnv`, pola handover untuk lokasi): masuk 10×12 + 5 lepas (count) → stok 125 dan riwayat memuat `count`; `Promise.all` dua keluar 8 pada stok 10 → tepat satu berhasil, stok 2, riwayat satu baris keluar; keluar melebihi stok → `VALIDATION` dan stok tak berubah; masuk pada stiker nonaktif ditolak, keluar diizinkan; koreksi −3 dengan alasan kosong ditolak; pengguna `stickerstock: edit` di lokasi A: record di lokasi B = `FORBIDDEN`, list lokasi B ditolak; pengguna `edit` tidak boleh `adjust` (`FORBIDDEN`); lokasi nonaktif/tak dikenal ditolak; `stickers.list` memberi `low: true` bila total semua lokasi ≤ min walau pengguna hanya melihat lokasi A, sementara `StickerStockDto.total` hanya lokasi A.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/sticker/stock.test.ts` → gagal.
- [ ] **Step 3: Implementasi** sesuai Interfaces; `low` pada `stickers.list` memakai total seluruh lokasi lewat satu kueri agregat (bukan N+1).
- [ ] **Step 4: Jalankan** tes yang sama + `bun run typecheck`; komit `feat(stiker): stok masuk, keluar, koreksi, dan riwayat`.

### Task 6: Stok opname (server)

**Files:**
- Modify: `server/src/modules/sticker/{stock-service,stock-repo,validate,routes}.ts`, `shared/contract.ts`, `shared/api.ts`
- Test: `server/src/modules/sticker/opname.test.ts`

**Interfaces:**
- Produces: `OpnameRowInput { stickerId: string; locationId: string; expectedQty: number; count: StockCount }`; `OpnameInput { rows: OpnameRowInput[] }` (1..`STICKER_LIMITS.opnameRows`, pasangan stiker×lokasi unik, `reason` tidak ada); id `'stickerStock.opname'` POST `/sticker-stock/opname` (`stickerstock: manage`, `scope: 'location'`, input memuat `locationIds` turunan dari baris agar router memeriksa semua lokasi); keluaran `StockEntryDto[]` (satu per baris yang berubah; baris dengan selisih 0 tidak membuat riwayat).
- Perilaku: stok baru = `piecesOfCount(count)`; `delta` = stok baru − `expectedQty`; bila stok tersimpan ≠ `expectedQty` pada baris mana pun → `staleError("Stok berubah sejak dihitung; hitung ulang")` dan TIDAK ada baris yang tertulis (satu `batch()` atomik dengan penjaga CAS per baris); riwayat `kind: 'opname'` menyimpan `count` dan `delta`; stiker nonaktif boleh.

- [ ] **Step 1: Tes** (`opname.test.ts`): opname sukses dua baris (selisih + dan −) menulis dua riwayat dengan `qtyAfter` benar; baris dengan `expectedQty` benar tetapi hitungan sama = tak ada riwayat; satu baris usang (stok diubah serentak) → `staleError` (412 pada REST dengan `If-Match` bila berlaku, atau galat usang) dan stok SEMUA baris tak berubah; pengguna `edit` ditolak `FORBIDDEN`; baris ke-101 ditolak `VALIDATION`; pasangan kembar ditolak.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/sticker/opname.test.ts` → gagal.
- [ ] **Step 3: Implementasi** sesuai Interfaces (pernyataan per baris dalam satu `batch()`; penjaga `qty = expectedQty` pada `UPDATE`).
- [ ] **Step 4: Jalankan** tes + `bun run --cwd server test src/modules/sticker` penuh; komit `feat(stiker): stok opname atomik`.

### Task 7: Fondasi web dan halaman Jenis stiker

**Files:**
- Create: `web/src/modules/sticker/{queries.ts,schemas.ts}`, `web/src/modules/sticker/components/{sticker-type-form-dialog.tsx,sticker-types-page.tsx}` (+ tes `*.test.tsx`), `web/src/routes/_app/sticker/types.tsx`
- Modify: `web/src/app/navigation.ts` (+ `navigation.test.ts`), `web/src/routeTree.gen.ts` (terbit otomatis dari dev server)

**Interfaces:**
- Consumes: id `stickerTypes.*` (Task 3), `api(id, input)`.
- Produces: `stickerTypesQuery`, `useSaveStickerType()`, `useSetStickerTypeStatus()` di `queries.ts`; grup menu baru "Stiker" di `NAV_GROUPS` dengan `Stiker` (`/sticker`, `sticker: view`, `excludes: ['/sticker/types', '/sticker/stock']`), `Jenis Stiker` (`/sticker/types`, `sticker: view`), `Stok Stiker` (`/sticker/stock`, `stickerstock: view`, `scope: 'location'`); guard rute `requirePermission(context.queryClient, 'sticker', 'view')`.
- Halaman Jenis: tabel (nama, aturan "Menurut BU" / "Tanpa syarat", jumlah stiker, status), tombol Tambah (`sticker: edit`), ubah nama (aturan terkunci bila `stickerCount > 0`, tampil sebagai teks), Nonaktifkan/Aktifkan (`sticker: manage`).

- [ ] **Step 1: Tes** (Vitest): halaman menampilkan daftar; tombol Tambah hanya untuk `sticker: edit`; aturan tidak dapat dipilih bila `stickerCount > 0`; `visibleNavGroups` menyembunyikan grup Stiker bagi user tanpa izin dan menampilkan "Stok Stiker" hanya bila `stickerstock: view` di lokasi aktif.
- [ ] **Step 2: Jalankan** `bun run --cwd web test sticker navigation` → gagal.
- [ ] **Step 3: Implementasi** sesuai Interfaces (pola `web/src/modules/brand/*`).
- [ ] **Step 4: Jalankan** tes + `bun run typecheck` + `bun run dev` untuk menerbitkan `routeTree.gen.ts`; verifikasi halaman di browser (terang dan gelap); komit `feat(web): halaman jenis stiker dan menu`.

### Task 8: Halaman Stiker (web)

**Files:**
- Create: `web/src/modules/sticker/components/{sticker-form-dialog.tsx,stickers-page.tsx}` (+ tes), `web/src/routes/_app/sticker/index.tsx`
- Modify: `web/src/modules/sticker/{queries,schemas}.ts`

**Interfaces:**
- Consumes: `stickers.*` (Task 4), `ImagePicker` (`web/src/modules/item/components/image-picker.tsx`) untuk gambar contoh, `LinkMultiField` untuk BU (opsi dari `businessUnits.options`), `FormDialog`, `useUploadImage`.
- Produces: tabel Stiker (nama/alias yang tampil = alias bila ada, jenis, BU sebagai chip, batas minimum, penanda "Menipis", status) dengan filter jenis dan status; dialog tambah/ubah (jenis tak dapat diubah saat ubah; field BU hanya muncul bila `rule === 'bu'`); Nonaktifkan/Aktifkan.

- [ ] **Step 1: Tes**: alias menggantikan nama pada tampilan; field BU tersembunyi untuk jenis `none`; penanda "Menipis" muncul bila `low`; jenis tak dapat diubah saat edit; pesan konflik nama dari server tampil pada field nama.
- [ ] **Step 2: Jalankan** `bun run --cwd web test sticker` → gagal.
- [ ] **Step 3: Implementasi** sesuai Interfaces.
- [ ] **Step 4: Jalankan** tes + typecheck; coba di browser (unggah gambar contoh, tautkan dua BU); komit `feat(web): halaman katalog stiker`.

### Task 9: Halaman Stok (web)

**Files:**
- Create: `web/src/modules/sticker/components/{stock-page.tsx,stock-entry-dialog.tsx,count-input.tsx,opname-dialog.tsx,stock-history.tsx}` (+ tes), `web/src/routes/_app/sticker/stock.tsx`
- Modify: `web/src/modules/sticker/queries.ts`

**Interfaces:**
- Consumes: `stickerStock.*` (Task 5, 6), `useActiveLocations().selectedIds`, `LocationField` untuk form tulis, `piecesOfCount` dari `@shared/stickers`.
- Produces: `CountInput` (props `{ value: StockCount; onChange(next: StockCount): void }`) dengan baris "lembar × isi per lembar" yang dapat ditambah (maks. `STICKER_LIMITS.countRows`) dan butir lepas, serta jumlah butir hasilnya ditampilkan langsung; halaman Stok: tabel stiker (total butir lokasi terpilih, rincian per lokasi, penanda "Menipis" dari `low` stiker), tombol Catat masuk/keluar (`stickerstock: edit`), Koreksi dan Stok opname (`stickerstock: manage`), kolom Lokasi bila `selectedIds.length > 1`, panel riwayat per stiker dengan penomoran kursor.

- [ ] **Step 1: Tes**: `CountInput` 10×12 dan 3×10 plus 5 lepas menampilkan 155 butir; tombol Koreksi/Opname tersembunyi untuk `edit`; dialog keluar mewajibkan alasan; opname mengirim `expectedQty` yang dilihat halaman dan menampilkan pesan "hitung ulang" saat server menolak usang; penanda Menipis muncul.
- [ ] **Step 2: Jalankan** `bun run --cwd web test sticker` → gagal.
- [ ] **Step 3: Implementasi** sesuai Interfaces.
- [ ] **Step 4: Jalankan** tes + typecheck; coba alur lengkap di browser (masuk, keluar, koreksi, opname, riwayat, dua lokasi, satu lokasi terlarang); komit `feat(web): halaman stok stiker`.

### Task 10: Data contoh dev, dokumen, verifikasi akhir

**Files:**
- Modify: `server/scripts/seed-dev.ts` (+ `seed-data.ts`), `CLAUDE.md` (modul, izin, aturan server stok), `docs/adding-a-module.md` (satu bagian singkat modul global + berlokasi sekaligus bila relevan), `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md` (status implementasi)

- [ ] **Step 1:** Seed dev: tujuh jenis contoh (QC, Segel dengan `bu`; Country Lock, Warning Frekuensi, Warning Unifi, Manual Book, Postel dengan `none` untuk sementara) dan beberapa stiker serta stok contoh; `bun run db:seed` berhasil.
- [ ] **Step 2:** Perbarui `CLAUDE.md` (baris modul stiker, dua modul izin baru, aturan: stok hanya ditulis lewat `stock-service`, riwayat hanya ditambah) dan resep modul.
- [ ] **Step 3:** `bun run check` dan `bun run build` (lolos `verify-dist`) → hijau.
- [ ] **Step 4:** Komit `docs: stiker 3a dan data contoh dev`.
