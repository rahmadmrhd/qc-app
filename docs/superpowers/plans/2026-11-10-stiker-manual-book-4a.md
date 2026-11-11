# Stiker Management 4a (Manual Book + Konfigurasi Stiker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manual Book lahir dari ekspor konfigurasi QR (berversi, per BU lewat preset, dikelompokkan ke item), ditambah halaman Konfigurasi Stiker (default minimum stok, penerima email, ringkasan harian stok menipis).

**Architecture:** Tabel `stickers` tetap satu-satunya sumber stok/riwayat/penanda; Manual Book = baris `stickers` berjenis sistem `manual_book` + tabel pendamping `manual_book_versions`. Item menunjuk konfigurasi QR (`items.manual_book_design_id`), stiker berlaku = versi terbaru. Stiker baru, versi, dan penonaktifan stiker lama terjadi di batch komit job `qr_export`. Ringkasan email = langkah baru penjadwal jam-an tanpa job.

**Tech Stack:** Bun, Hono, MariaDB 11.8 (adaptor `Db`), React + TanStack Router/Query/Form, shadcn, zod, Vitest, `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-10-stiker-manual-book-4a-design.md` (disetujui 2026-11-10). Peta kode kerja: `.superpowers/sdd/code-map-4a.md` (git-ignored; baca untuk nomor baris dan pola).

## Global Constraints

- Migrasi `0008_manual_book_4a.sql`: **expand-only, idempoten** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`), tanpa backfill, tanpa menyunting migrasi lama. Keunikan untuk kolom ber-bawaan `''` memakai kolom virtual `..._key AS (NULLIF(col, '')) VIRTUAL` + `UNIQUE` (preseden `name_key`).
- `shared/` murni (tanpa DOM/runtime API), import internal relatif. Batas ukuran literal di `shared/api.ts` dijaga `shared/api.test.ts`.
- Penulisan = pernyataan `DbStatement` dalam `batch()` dengan CAS/penjaga (`runGuardedBatch`/`runCas`); jangan baca-lalu-tulis tanpa penjaga. Kolom `key`/`before`/`after` berbacktick; parameter `?`; `SUM/COUNT` dibungkus `Number()`.
- Pesan galat memakai bahasa Indonesia seperti kode sekitar; galat versi usang lewat `staleError(...)`.
- Field relasi di form wajib `LinkField`/`LinkMultiField`; izin Tambah/Buka hanya di `web/src/lib/link-access.ts`.
- Tes server memakai MariaDB sungguhan (butuh `bun run db:tunnel` hidup; JANGAN mematikan/menjalankan ulang terowongan atau server dev pengguna). Tes web: Vitest + RTL.
- `scripts/google-sa-check/check.ts` adalah perubahan lokal pengguna: jangan disentuh atau di-commit. Commit hanya berkas tugas (`git add <path>`), akhiri pesan dengan `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Setiap tugas selesai bila tes tugas itu + `bun run typecheck` hijau; `bun run check` penuh hanya di Task 15.
- Teks UI Indonesia. Rute web baru ⇒ regenerasi dan commit `web/src/routeTree.gen.ts` (jalankan `bun run --cwd web build` atau `dev` sekali).
- Rilis: image lama (rollback `deploy.sh`) membaca status `'deprecated'` sebagai `'active'`; dicatat di `docs/ci-cd.md` (Task 15), tidak dicegah.

## Review Focus

1. **Ekspor/simpan serentak atas satu konfigurasi**: dua ekspor ulang bersamaan tidak boleh membuat dua stiker versi sama (`UNIQUE (design_id, version)` + CAS `updated_at`); percobaan ulang job setelah komit tidak menggandakan stiker.
2. **Item di dua Manual Book**: pemasangan item serentak oleh dua konfigurasi harus gagal salah satunya; tidak pernah ada item dengan dua penunjuk; item tak terlihat tetap terpasang saat penyimpan lain mengganti daftar.
3. **Stok stiker `deprecated`**: saat total semua lokasi mencapai 0 lewat keluar/koreksi/opname (serentak sekalipun) status menjadi `inactive` atomik; tidak pernah dihitung menipis; stok masuk ditolak.
4. **Kebocoran lintas BU**: DTO konfigurasi hanya memuat item yang terlihat bagi pembaca (+ jumlah tersembunyi); pemilih item/BU tidak mengembalikan item di luar BU pengguna.
5. **Ekspor tak sah/gagal**: tanpa item, tanpa nama, tanpa `reason` (saat versi baru), `preview` hilang atau bukan PNG ⇒ `VALIDATION` sebelum job dibuat; gagal sebelum komit tidak meninggalkan stiker, versi, atau berkas yatim.
6. **Email ringkasan**: tidak terkirim dobel pada hari yang sama, tidak terkirim tanpa penerima/SMTP, satu surel meski banyak stiker, kegagalan kirim diulang pada detak berikutnya.

---

### Task 1: Fungsi murni `shared/` (nama otomatis, status, aturan, penyimpangan preset)

**Files:**
- Create: `shared/manual-book.ts`, `shared/manual-book.test.ts`
- Modify: `shared/stickers.ts`, `shared/stickers.test.ts`, `shared/qrcode.ts`, `shared/qrcode.test.ts`

**Interfaces:**
- Produces:
  - `manualBookNameFromTypes(types: readonly string[], max = 60): string`
  - `STICKER_STATUSES = ['active','inactive','deprecated'] as const; type StickerStatus`
  - `STICKER_SYSTEM_KINDS = ['', 'manual_book', 'postel'] as const; type StickerSystemKind`
  - `STICKER_RULES = ['bu','none','group'] as const` (tetap diekspor, `StickerRule`), `USER_STICKER_RULES = ['bu','none'] as const`
  - `isLowStock(input: { status: StickerStatus; minQty: number; total: number }): boolean` (hanya `active`)
  - `MatchSticker.status: StickerStatus`; `stickersForType(type: MatchType, stickers: readonly MatchSticker[], itemBuIds: readonly string[], groupStickerIds: ReadonlySet<string>): MatchSticker[]`: hanya `active` bertipe sama; `none` semua; `bu` irisan BU; `group` = yang `id` ada di `groupStickerIds`.
  - `QrNamePlacement = 'title'|'subtitle'|'footer'`; `QR_LIMITS` bertambah `manualBookName: 60`, `reason: 500`, `previewMaxBytes: 512 * 1024`; `qrPresetDeviations(design: QrDeviationInput, preset: QrDeviationPreset): string[]` (nama bagian yang menyimpang: `'title'|'subtitle'|'footer'|'logo'|'layout'|'style'`, bagian terkunci nama tidak dihitung); `manualBookFileName(name: string, stampMs: string): string`.

- [ ] **Step 1: Tulis tes `manual-book.test.ts`** — `manualBookNameFromTypes`: `['PBE M5-400','PBE M5-200']` → `'PBE M5-400/200'`; `['U6-XG','U6-XG-B']` → `'U6-XG(-B)'`; `['U6-XG','U6-XG-B','U6-XG-W']` → `'U6-XG(-B/-W)'`; satu tipe → tipe itu; `['AC-100','AC-200','AC-300']` → `'AC-100/200/300'`; tanpa awalan sama (`['Alpha','Zulu']`) → `'Alpha/Zulu'`; hasil mengikuti urutan masukan (fungsi tidak mengurutkan ulang; keputusan pemilik 2026-11-11, spek 4a §8 butir 5); hasil dipotong ke `max` (tanpa memotong tengah kurung: potong lalu buang kurung terbuka); masukan kosong → `''`. Pemotongan awalan di batas spasi atau `-`.
- [ ] **Step 2: Jalankan** `bun run --cwd shared test manual-book` — gagal (modul belum ada).
- [ ] **Step 3: Implement** `shared/manual-book.ts` (awalan terpanjang pada batas token spasi/`-`; bila satu masukan sama dengan awalan → sisa lainnya dalam kurung digabung `/`; selain itu sisa digabung `/` tanpa kurung).
- [ ] **Step 4: Tes `stickers.test.ts` dan `qrcode.test.ts`**: `isLowStock` false untuk `deprecated`/`inactive`; `stickersForType` aturan `group` hanya id dalam himpunan dan hanya `active`; `USER_STICKER_RULES` tak memuat `group`; `qrPresetDeviations` kosong untuk design = preset, mengembalikan `['style']` bila gaya beda, mengabaikan bagian yang `namePlacement`-nya terkunci; `manualBookFileName('PBE M5-400/200','20261110')` = `'PBE-M5-400-200-20261110'` (memakai `labelFileSlug`).
- [ ] **Step 5: Implement** perubahan `shared/stickers.ts` dan `shared/qrcode.ts`; perbaiki pemanggil lama di `shared/` agar typecheck bersih (pemanggil server/web diperbaiki di tugas masing-masing; tulis argumen `new Set()` sementara bila perlu agar `bun run typecheck` tetap hijau).
- [ ] **Step 6: Jalankan** `bun run --cwd shared test` dan `bun run typecheck` — hijau. **Commit** `feat(shared): nama Manual Book, status deprecated, aturan group, penyimpangan preset`.

---

### Task 2: Migrasi 0008, repo, dan fixture tes

**Files:**
- Create: `server/migrations/0008_manual_book_4a.sql`
- Modify: `server/src/modules/qrcode/repo.ts`, `server/src/modules/sticker/repo.ts`, `server/src/modules/item/repo.ts`, `server/test-support/sticker-fixtures.ts`, `server/test-support/item-fixtures.ts`, `server/test-support/qrcode-env.ts`
- Test: `server/src/modules/qrcode/repo.test.ts`, `server/src/modules/sticker/repo.test.ts` (baru bila belum ada)

**Interfaces:**
- Produces (skema): `qr_presets` + `bu_id VARCHAR(100) NOT NULL DEFAULT ''`, `name_placement VARCHAR(16) NOT NULL DEFAULT ''`, `bu_key VARCHAR(100) AS (NULLIF(bu_id,'')) VIRTUAL` + `UNIQUE qr_presets_bu_unique (bu_key)`; `qr_designs` + `name VARCHAR(255)`, `name_placement VARCHAR(16)`, `preset_id VARCHAR(100)` (semua `NOT NULL DEFAULT ''`); `sticker_types` + `system_kind VARCHAR(16) NOT NULL DEFAULT ''`, `kind_key ... AS (NULLIF(system_kind,'')) VIRTUAL` + `UNIQUE sticker_types_kind_unique (kind_key)`, `default_min_qty BIGINT NOT NULL DEFAULT 0`; `items` + `manual_book_design_id VARCHAR(100) NOT NULL DEFAULT ''` + `KEY items_manual_book (manual_book_design_id)`; tabel `manual_book_versions(sticker_id VARCHAR(100) PK, design_id VARCHAR(100) NOT NULL, version INT NOT NULL, content_hash VARCHAR(128), content_snapshot LONGTEXT, reason VARCHAR(600), created_at VARCHAR(30), created_by VARCHAR(255), UNIQUE KEY manual_book_versions_design_version (design_id, version))`.
- Produces (TS): `QrDesignRecord` + `name, namePlacement: QrNamePlacement | '', presetId`; `QrPresetRecord` + `buId, namePlacement`; `StickerTypeRecord` + `systemKind: StickerSystemKind, defaultMinQty`; `StickerRecord.status: StickerStatus` (`toSticker` memetakan `'deprecated'`); `ItemRecord` tidak berubah (kolom dibaca lewat fungsi khusus); `ManualBookVersionRecord {stickerId, designId, version, contentHash, contentSnapshot, reason, createdAt, createdBy}` dengan `insertManualBookVersionStmt(db, record)`, `listManualBookVersions(env, designId)`, `latestManualBookStickerIds(db, designIds: readonly string[]): Promise<Map<string, string>>`.

- [ ] **Step 1: Tes `repo.test.ts`**: simpan dua preset dengan `bu_id` sama gagal `duplicate` pada indeks `qr_presets_bu_unique`; dua preset `bu_id=''` boleh; dua jenis `system_kind='manual_book'` gagal, dua `''` boleh; `(design_id, version)` ganda gagal; `listManualBookVersions` terurut `version` menurun; `latestManualBookStickerIds` memberi versi tertinggi per desain; kolom baru terbaca lewat `toDesign/toPreset/toStickerType`; `toSticker` mempertahankan `'deprecated'`.
- [ ] **Step 2: Tulis migrasi** idempoten sesuai Interfaces; **Step 3:** perbarui `DESIGN_COLUMNS`/`PRESET_COLUMNS`/`designValues`/`presetValues`/`TYPE_SELECT`/`toX`; **Step 4:** perluas fixture: `seedStickerType({systemKind?, defaultMinQty?, rule?: StickerRule})`, `seedSticker({minQty?, status?: StickerStatus})`, `seedItem({manualBookDesignId?})`, fixture QR (`seedQrDesign`/`seedQrPreset` bila belum ada) dan `seedManualBookVersion`.
- [ ] **Step 5: Jalankan** `bun run --cwd server test src/modules/qrcode/repo src/modules/sticker` dan `bun run typecheck` — hijau (perbaiki pemanggil tipe yang patah). **Commit** `feat(server): migrasi 0008 (preset per BU, nama Manual Book, jenis sistem, versi)`.

---

### Task 3: Server stiker: status `deprecated`, aturan `group`, jenis sistem, stok

**Files:**
- Modify: `server/src/modules/sticker/{service,validate,stock-service,stock-repo,routes}.ts`, `shared/contract.ts` (DTO stiker/jenis), `shared/api.ts` bila perlu
- Test: `server/src/modules/sticker/{type,catalog,stock,opname}.test.ts`

**Interfaces:**
- Produces: `StickerTypeDto` + `systemKind: StickerSystemKind`, `defaultMinQty: number`; `StickerDto.status`/`StickerStockDto.status: StickerStatus`; `StickerDto.systemKind`-nya lewat peta jenis di klien (tidak ditambah ke StickerDto). `validateSaveStickerType` memakai `USER_STICKER_RULES` (menolak `group`); `saveSticker` menolak jenis sistem kecuali perubahan `minQty`, `alias`, dan status; `setStickerStatus`: `deprecated→active` ditolak (`VALIDATION`), `deprecated→inactive` boleh, stiker jenis sistem yang bukan versi terbaru tak boleh diaktifkan; stok masuk ke `deprecated` ditolak; `toStickerDto.low` = `isLowStock` baru. Pernyataan penonaktifan otomatis `UPDATE stickers SET status='inactive', updated_at=?, updated_by=? WHERE id=? AND status='deprecated' AND (SELECT COALESCE(SUM(qty),0) FROM sticker_stock WHERE sticker_id=?) = 0` ditaruh di batch `applyChangeOnce` dan `opnameOnce` SEBELUM pembacaan ulang slot.

- [ ] **Step 1: Tes** (di `type.test.ts`): ganti tes "group ditolak" dengan nilai tak dikenal (`'xyz'`) dan tambah "pengguna tak dapat membuat jenis group via `stickerTypes.save`" (VALIDATION); jenis sistem muncul di `stickerTypes.list` dengan `systemKind`; (di `catalog.test.ts`): stiker jenis sistem — ubah `name`/`typeId`/`fileId` ditolak `VALIDATION`, ubah `minQty` dan `alias` berhasil; `setStatus` `deprecated→active` ditolak, `deprecated→inactive` berhasil; (di `stock.test.ts`): stok masuk ke `deprecated` ditolak; stok keluar yang menghabiskan total semua lokasi mengubah `deprecated` menjadi `inactive` pada respons dan basis data; `low` false untuk `deprecated`; (di `opname.test.ts`): opname yang membuat total 0 pada `deprecated` ⇒ `inactive`; dua `adjust` keluar serentak (`Promise.all`) menghasilkan tepat satu penonaktifan tanpa galat.
- [ ] **Step 2: Jalankan** tes-tes itu — gagal.
- [ ] **Step 3: Implement** perubahan sesuai Interfaces (pemetaan status di `toSticker`, `listStickerStock`, `toStickerType` memuat `group`/`systemKind`/`defaultMinQty`, `STATUS_VALUES` untuk jenis tetap dua nilai, untuk stiker memakai `STICKER_STATUSES` tetapi validator `setStatus` hanya menerima `active|inactive`).
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/sticker` dan typecheck — hijau. **Commit** `feat(server): status deprecated, aturan group, jenis sistem, penonaktifan otomatis stok`.

---

### Task 4: Penentuan stiker menurut kelompok item (instruksi, filter, penjaga)

**Files:**
- Modify: `server/src/modules/sticker/instruction-{service,repo}.ts`, `server/src/modules/item/service.ts` (hanya `assertInstructionRefs`)
- Test: `server/src/modules/sticker/instruction.test.ts`, `server/src/modules/item/{instruction-list,instruction-refs}.test.ts`

**Interfaces:**
- Consumes: `stickersForType(..., groupStickerIds)` (Task 1), `latestManualBookStickerIds` (Task 2).
- Produces: `buildInstructionViews(env, itemId, itemBuIds, photos)` mengisi `groupStickerIds` dari `items.manual_book_design_id` item itu; `instructionFilterSql` menambah cabang `t.rule = 'group' AND s.id = (SELECT mv.sticker_id FROM manual_book_versions mv WHERE mv.design_id = i.manual_book_design_id ORDER BY mv.version DESC LIMIT 1)`; `assertInstructionRefs` menolak penanda ke **stiker** berjenis sistem (`VALIDATION`, "Stiker Manual Book dipilih lewat jenisnya") tetapi menerima penanda ke **jenis** sistem; stiker `deprecated` bukan `active` ⇒ pesan "stiker dinonaktifkan".

- [ ] **Step 1: Tes** `instruction.test.ts`: item dengan penanda jenis Manual Book dan `manual_book_design_id` → `resolved` memuat stiker versi terbaru `active`; versi terbaru `inactive` ⇒ `unresolved`; item tanpa konfigurasi ⇒ `unresolved`; stiker `deprecated` tak pernah muncul. `instruction-list.test.ts`: tes kesepakatan (pola baris ~197) diperluas dengan jenis `group`: untuk tiap item, jawaban `items.get` dan filter `stickerMode=has|missing` + `typeId` sama. `instruction-refs.test.ts`: penanda ke stiker jenis sistem ditolak, ke jenis sistem diterima.
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**. **Step 4: Jalankan** `bun run --cwd server test src/modules/sticker/instruction src/modules/item/instruction` — hijau; tes lama kesepakatan `none`/`bu` tetap hijau. **Commit** `feat(server): aturan group pada instruksi stiker dan filter daftar item`.

---

### Task 5: Preset QR per BU (server): simpan, kloning, opsi BU

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `shared/api.test.ts`, `server/src/modules/qrcode/{service,validate,routes}.ts`, rute `businessUnits.options` (izin)
- Test: `server/src/modules/qrcode/{defaults,validate,rest}.test.ts`

**Interfaces:**
- Produces: `QrPresetDto += buId: string; namePlacement: QrNamePlacement | ''`; `SaveQrPresetInput += buId: string; namePlacement: QrNamePlacement` (wajib untuk preset baru/diubah); `ClonePresetInput { id: string; buId: string; name: string }` dengan rute `qrcodes.clonePreset` (`POST /qrcode-presets/{id}/clone`, izin `qrcode: manage`, mengembalikan `QrPresetDto`); `saveQrPreset` memvalidasi BU ada dan aktif, `buId` belum dipakai preset lain (`CONFLICT` field `buId`, "BU ini sudah punya konfigurasi default"), nama unik per sistem seperti sekarang; kloning menyalin seluruh isi kecuali `bu_id`/`name`; preset lama (`buId=''`) tetap dapat dibaca dan diberi BU lewat `savePreset`; `businessUnits.options` menambah `{module:'qrcode', level:'view'}` ke `anyOf`.

- [ ] **Step 1: Tes**: simpan preset dengan BU+penempatan; BU ganda ditolak; BU nonaktif ditolak; `clonePreset` ke BU lain menyalin gaya/penempatan dan memberi nama baru; kloning ke BU yang sudah punya preset ditolak; preset tanpa BU lama tetap terdaftar dan dapat diberi BU; pengguna `qrcode: view` dapat memanggil `businessUnits.options`, `noqr@` tidak; `validateSaveQrPreset` menolak `namePlacement` di luar tiga nilai.
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement** (kontrak, `API_ROUTES`, validator, service, rute; audit `qrcode.preset_clone`). **Step 4: Jalankan** `bun run --cwd server test src/modules/qrcode` + `bun run --cwd shared test` — hijau. **Commit** `feat(server): preset QR per BU dan kloning`.

---

### Task 6: Konfigurasi QR dengan nama, item, preset (server)

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/qrcode/{service,validate,routes,repo}.ts`
- Test: `server/src/modules/qrcode/{qrcode,rest,validate}.test.ts`, `server/src/modules/qrcode/items.test.ts` (baru)

**Interfaces:**
- Produces:
  - `QrDesignItemDto { id: string; brand: string; model: string }`; `QrDesignDto += name: string; namePlacement: QrNamePlacement | ''; presetId: string; items: QrDesignItemDto[]; hiddenItemCount: number; stickerVersion: number; stickerStatus: StickerStatus | ''`.
  - `SaveQrDesignInput += name: string; presetId: string; itemIds: string[]` (`itemIds` hanya mencakup yang diubah pengguna; item tak terlihat tak dikirim dan tetap).
  - `listQrDesignDtos(env, user: UserContext)` dan `getQrDesignDto(env, { id }, user)`; `qrcodes.list/get` meneruskan `ctx.user`.
  - Rute `qrcodes.itemOptions` (`GET /qrcode-item-options`, query `query`, `cursor`, `limit`, izin `qrcode: edit`) → `{ items: QrItemOptionDto[]; nextCursor: string | null }` dengan `QrItemOptionDto { id: string; brand: string; model: string; businessUnitIds: string[]; manualBookName: string }` (hanya item aktif terlihat menurut BU pengguna; `manualBookName` terisi bila sudah tergabung).
  - `saveQrDesignNow`: konfigurasi baru wajib ≥1 item dan `name` tak kosong (`VALIDATION`, field `itemIds`/`name`); konfigurasi yang sudah punya stiker tak boleh berakhir tanpa item; bagian `namePlacement` (disalin dari `presetId` saat dibuat, tak diubah sesudahnya) dipaksa sama dengan `name` di server; item yang sudah milik konfigurasi lain ditolak dengan pesan menyebut nama Manual Book itu; tulis `items.manual_book_design_id` dalam batch yang sama dengan penjaga: setelah `UPDATE items SET manual_book_design_id=? WHERE id IN (...) AND manual_book_design_id IN ('', ?)` jalankan `SELECT CASE WHEN (SELECT COUNT(*) FROM items WHERE id IN (...) AND manual_book_design_id = ?) <> N THEN CAS_FAIL_SQL ELSE 0 END`; item dilepas lewat `UPDATE ... SET manual_book_design_id='' WHERE manual_book_design_id=? AND id IN (dilepas-yang-terlihat)`; cabang "snapshot sama = tak menulis" memperhitungkan nama/preset/daftar item (daftar item berubah ⇒ `updated_at` naik, tanpa memengaruhi `exportStatus`).
  - `removeQrDesign`: `CONFLICT` bila punya stiker; bila belum pernah diekspor, lepaskan item dalam batch yang sama dengan DELETE.

- [ ] **Step 1: Tes** (`items.test.ts`, memakai `seedItem`, `seedBusinessUnit`, `seedUser` dengan `buAssignments`): simpan baru tanpa item ditolak; dengan item ⇒ `items.manual_book_design_id` terisi dan DTO memuat item; item milik konfigurasi lain ditolak (pesan memuat nama konfigurasi lain); dua `Promise.all` menyimpan dua konfigurasi baru dengan item yang sama ⇒ tepat satu berhasil, satu gagal (`CONFLICT`/412), item punya satu pemilik; pengguna dengan BU terbatas melihat hanya item miliknya di DTO dan `hiddenItemCount` benar; menyimpan oleh pengguna terbatas tidak melepas item tak terlihat; `namePlacement='subtitle'` memaksa `subtitle = name`; mengubah daftar item saja menaikkan `updatedAt` tetapi `exportStatus` tetap `current`; `qrcodes.itemOptions` terfilter BU dan berkursor; `qrcode: view` saja ⇒ 403; hapus konfigurasi tanpa stiker melepas item; hapus konfigurasi berstiker ⇒ `CONFLICT`.
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**. **Step 4: Jalankan** `bun run --cwd server test src/modules/qrcode` dan typecheck — hijau (perbarui tes lama yang membuat desain tanpa item lewat fixture). **Commit** `feat(server): nama, item, dan preset pada konfigurasi QR`.

---

### Task 7: Rute dan validasi ekspor (`reason`, `preview`, nama berkas)

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `shared/api.test.ts`, `server/src/modules/qrcode/{export,validate,service}.ts`, `deploy/nginx/qc.conf.example` (bila tes menuntut)
- Test: `server/src/modules/qrcode/{rest-binary,validate}.test.ts`, `shared/api.test.ts`

**Interfaces:**
- Produces: `ExportQrDesignInput += preview: Uint8Array; reason: string`; `API_ROUTES['qrcodes.export']`: `multipart.parts: ['pdf','png','preview']`, `query: { reason: 'string' }`, `maxBytes: 8_978_432` (= `QR_LIMITS.exportMaxBytes + QR_LIMITS.previewMaxBytes + 64*1024`; sesuaikan literal di `shared/api.test.ts`); `validateExportQrDesign` memeriksa `preview` PNG ≤ `previewMaxBytes` (`isPngBytes`) dan `reason` ≤ 500; `requestQrExport`: tolak (`VALIDATION`) bila konfigurasi tanpa item atau tanpa nama; hitung `willCreateVersion = design belum punya stiker OR qrContentHash(sekarang) ≠ hash versi terbaru`; bila `willCreateVersion` dan sudah punya stiker ⇒ `reason` (trim) wajib; bila `willCreateVersion` ⇒ `preview` wajib bermakna (PNG sah); simpan `preview` dan `reason` sebagai blob job (`blobs: { pdf, png, preview, reason }`); nama berkas Drive = `manualBookFileName(design.name, stamp)` + ekstensi; `readQrFile` memakai nama yang sama untuk unduhan.

- [ ] **Step 1: Tes** (`rest-binary.test.ts`, helper `multipart` diperluas dengan `preview`): ekspor tanpa item ⇒ 422; tanpa nama ⇒ 422; ekspor pertama tanpa `reason` ⇒ sukses (tidak menuntut alasan); ekspor ulang dengan label berubah tanpa `reason` ⇒ 422 field `reason`; dengan `reason` ⇒ 202; ekspor ulang tanpa perubahan label ⇒ sukses tanpa `reason`; `preview` bukan PNG ⇒ 422; nama berkas di `env.BRIDGE.state.files` = `<slug nama>-<stempel>.pdf/.png`; `shared/api.test.ts` memeriksa `maxBytes` baru dan builder klien mengirim tiga bagian + `reason` di query.
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**. **Step 4: Jalankan** `bun run --cwd server test src/modules/qrcode/rest-binary src/modules/qrcode/validate` + `bun run --cwd shared test` — hijau; periksa `bun run --cwd server test src/deploy-files` bila `client_max_body_size` perlu naik. **Commit** `feat(server): ekspor QR menerima alasan dan preview, nama berkas dari nama Manual Book`.

---

### Task 8: Komit ekspor: stiker baru, versi, penonaktifan stiker lama

**Files:**
- Create: `server/src/modules/sticker/manual-book.ts`
- Modify: `server/src/modules/qrcode/export.ts`, `server/src/modules/qrcode/{routes,service}.ts` (rute riwayat), `shared/contract.ts`, `shared/api.ts`
- Test: `server/src/modules/sticker/manual-book.test.ts`, `server/src/modules/qrcode/rest-binary.test.ts`

**Interfaces:**
- Consumes: `insertManualBookVersionStmt`, `latestManualBookStickerIds`, `insertStickerStmt`, `insertFileStmt` (`files/repo.ts`), `qrContentHash`.
- Produces:
  - `ensureManualBookType(env): Promise<StickerTypeRecord>`: jenis `system_kind='manual_book'`; bila belum ada: pakai jenis bernama "Manual Book" yang belum punya stiker (ubah `rule='group'`, `system_kind`), bila namanya ada tetapi sudah berstiker ⇒ `VALIDATION` ("Ganti nama jenis 'Manual Book' lebih dulu"), selain itu buat baru (`rule='group'`).
  - `manualBookCommitStatements(env, input: { design: QrDesignRecord; hash: string; reason: string; actor: string; now: string; previewFileId: string }): Promise<DbStatement[]>`: bila `design` belum punya versi atau `hash ≠` hash versi terbaru: stiker baru `name = "<nama> v<n>"`, `file_id = previewFileId`, `min_qty` = versi sebelumnya atau `default_min_qty` jenis, status `active`; baris `manual_book_versions` (`content_snapshot` JSON memuat `title, subtitle, footer, logoFileId, layout, style, link`); stiker lama: `UPDATE ... SET status = CASE WHEN total=0 THEN 'inactive' ELSE 'deprecated' END WHERE id=? AND status='active'`; mengembalikan `[]` bila hash sama dan sudah punya versi.
  - Langkah job (urutan menjadi: 0 PDF, 1 PNG, **2 preview (baru)**, 3 komit, 4 pembersihan; geser indeks `switch (ctx.job.step)` dan tes yang menyebut nomor langkah): step baru membuat berkas preview di Drive (folder files `folderIdOf(env, SETTING_DRIVE_FOLDER_ID) || ensureDriveFolder(env)`, simpan `previewDriveId`/`previewFileId` di state, idempoten, dibuang di `onFail` bila belum komit); komit (step 2) menambah `manualBookCommitStatements` + `insertFileStmt` (`ownerType: 'sticker'`, `ownerId: stikerBaru`) ke `runGuardedBatch` dengan penjaga `alreadyCommitted` yang ada.
  - Rute `qrcodes.versions` (`GET /qrcodes/{id}/versions`, izin `qrcode: view`) → `QrVersionDto[] { stickerId, version, name, status: StickerStatus, reason, createdAt, createdBy, fileId: string | null, total: number }`.

- [ ] **Step 1: Tes** (`manual-book.test.ts` memakai pola `rest-binary`): ekspor pertama ⇒ jenis Manual Book dibuat, satu stiker `"X v1"` `active`, `min_qty` = `default_min_qty` jenis, baris versi dengan `reason=''`, `files` pemilik `sticker` terpasang; ekspor ulang label berubah dengan stok lama 0 ⇒ stiker lama `inactive`, baru `v2`, `min_qty` mewarisi nilai v1 (setelah v1 diubah ke 200); stok lama > 0 ⇒ `deprecated`; ekspor ulang tanpa perubahan label ⇒ tidak ada stiker/versi baru, berkas Drive tetap diganti; dua ekspor ulang serentak ⇒ tepat satu versi baru (yang lain 412/`CONFLICT`); gagal `createFile` preview (paksa lewat FakeBridge) ⇒ tidak ada stiker/versi, berkas Drive yatim dibuang; mengulang step komit setelah sukses (simulasikan job diulang) tidak menggandakan stiker; jenis "Manual Book" berstiker non-sistem ⇒ ekspor ditolak dengan pesan; `qrcodes.versions` urut menurun dan memuat `reason`.
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**. **Step 4: Jalankan** `bun run --cwd server test src/modules/sticker/manual-book src/modules/qrcode` dan typecheck — hijau. **Commit** `feat(server): stiker Manual Book berversi lahir dari ekspor QR`.

---

### Task 9: Konfigurasi Stiker (server): default minimum, penerima, ringkasan harian

**Files:**
- Create: `server/src/modules/sticker/{settings,digest}.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `shared/api.test.ts`, `server/src/modules/sticker/{routes,validate}.ts`, `server/src/jobs/runner.ts`, `server/src/config.ts`, `deploy/.env.example` dan `deploy/compose.yml` (komentar bila perlu)
- Test: `server/src/modules/sticker/{settings,digest}.test.ts`, `server/src/config.test.ts`, `server/src/jobs/runner.test.ts`

**Interfaces:**
- Produces:
  - `StickerAlertSettings { enabled: boolean; recipients: string[]; digestHour: number }` (maks. 20 email valid unik, jam 0–23 WIB); `StickerSettingsDto { alert: StickerAlertSettings; types: Array<{ id: string; name: string; systemKind: StickerSystemKind; defaultMinQty: number }>; updatedAt: string; smtpConfigured: boolean }`; `SaveStickerSettingsInput { expectedUpdatedAt: string; alert: StickerAlertSettings; defaults: Array<{ typeId: string; defaultMinQty: number }> }`.
  - Rute `stickerSettings.get` (`GET /sticker-settings`, etag `updatedAt`) dan `stickerSettings.save` (`PUT /sticker-settings`, `ifMatch: 'expectedUpdatedAt'`), izin `sticker: manage`. Penyimpanan JSON di `settings` kunci `STICKER_ALERT` berisi `updatedAt` (CAS: `UPDATE settings SET value=? WHERE \`key\`=? AND value=?` bernilai lama; kunci belum ada ⇒ `setSettingIfAbsent`); `defaultMinQty` memperbarui `sticker_types.default_min_qty` dalam batch yang sama; audit `sticker.settings`.
  - `lowStockRows(env): Promise<Array<{ name: string; typeName: string; total: number; minQty: number }>>` (hanya stiker `active` dengan `min_qty > 0` dan total semua lokasi ≤ min); `checkLowStockDigest(env): Promise<'sent' | 'skipped' | 'failed'>`: keluar `'skipped'` bila `MAILER` kosong, `enabled=false`, tanpa penerima, WIB jam < `digestHour`, `STICKER_DIGEST_LAST_DATE` (`wibDate`) = hari ini, atau tak ada yang menipis; kirim satu surel (subjek "Stok stiker menipis (N)", teks daftar + tautan `${APP_ORIGIN}/sticker/stock`) lalu `putSetting` tanggal; gagal kirim ⇒ `'failed'` tanpa menulis tanggal. Ditambahkan ke daftar `schedulerTick` setelah `checkBackupAlerts`.
  - `config.ts`: objek `smtp` tidak lagi menjadi `null` hanya karena `ALERT_TO` kosong (syarat `alertTo.length > 0` dilepas dari pembentukan `smtp`; `checkBackupAlerts` tetap menuntut `ALERT_TO`).

- [ ] **Step 1: Tes**: `settings.test.ts` (get bawaan: `enabled=false`, penerima kosong, jam 8; save valid ⇒ tersimpan dan `defaultMinQty` jenis berubah; email tak valid/ganda/>20 ⇒ 422; `expectedUpdatedAt` basi ⇒ 412; `sticker: edit` ⇒ 403; `smtpConfigured` mengikuti `MAILER`); `digest.test.ts` (jam < digestHour ⇒ `skipped`; menipis dan `deprecated`/`inactive` tak ikut; satu surel meski 3 stiker; tanggal sama ⇒ tidak terkirim dua kali; `env.clock` hari berikutnya ⇒ terkirim lagi; `MAILER.send` melempar ⇒ `failed` dan tanggal tak tertulis lalu detak berikutnya mencoba lagi; tanpa penerima ⇒ `skipped`); `config.test.ts` (`SMTP_HOST`+`SMTP_FROM` tanpa `ALERT_TO` ⇒ `smtp` terbentuk); `runner.test.ts` (penjadwal memanggil digest dengan `MAILER` palsu).
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**. **Step 4: Jalankan** `bun run --cwd server test src/modules/sticker/settings src/modules/sticker/digest src/config src/jobs src/deploy-files` + `bun run --cwd shared test` — hijau. **Commit** `feat(server): Konfigurasi Stiker, default minimum stok, ringkasan email harian`.

---

### Task 10: Item (server+kontrak): Manual Book pada DTO, label, filter

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `shared/api.test.ts`, `server/src/modules/item/{service,validate,repo}.ts`
- Test: `server/src/modules/item/{item,validate,rest}.test.ts`, `server/src/modules/item/manual-book-list.test.ts` (baru)

**Interfaces:**
- Produces: `ItemSummaryDto += hasManualBook: boolean` (true bila `manual_book_design_id` terisi DAN konfigurasi itu punya minimal satu versi); `ItemDto += manualBook: { designId: string; name: string; version: number; status: StickerStatus } | null`; `ListItemsPageInput += manualBook?: 'has' | 'missing'` dengan `API_ROUTES['items.list'].query.manualBook`; filter SQL cermin definisi `hasManualBook`; hanya item aktif ber-label (aturan label ada di klien; server mengembalikan boolean apa adanya).

- [ ] **Step 1: Tes** `manual-book-list.test.ts` (pola `instruction-list.test.ts`): item tanpa konfigurasi ⇒ `hasManualBook=false`, konfigurasi belum diekspor ⇒ false, sudah diekspor ⇒ true; `manualBook=missing|has` memfilter sama dengan `hasManualBook` di tiap item (kesepakatan), terpagination dengan kursor, terbatas BU; `items.get` memuat `manualBook` dengan versi terbaru; parameter tak sah ⇒ 422; `items.save` tidak menimpa `manual_book_design_id` (PUT utuh mempertahankan).
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**. **Step 4: Jalankan** `bun run --cwd server test src/modules/item` + shared — hijau. **Commit** `feat(server): Manual Book pada item (DTO, label, filter)`.

---

### Task 11: Web: preset QR per BU (form, daftar, kloning)

**Files:**
- Modify: `web/src/modules/qrcode/{queries,schemas}.ts`, `web/src/modules/qrcode/components/qr-design-form.tsx` (mode `defaults`), `web/src/routes/_app/qrcode/default/{index,new,$presetId/edit}.tsx`, `web/src/lib/link-access.ts`
- Create: `web/src/modules/qrcode/components/clone-preset-dialog.tsx`
- Test: `web/src/modules/qrcode/{schemas.test.ts,queries.test.tsx}`, `components/qr-design-form.test.tsx`, `components/clone-preset-dialog.test.tsx`

**Interfaces:**
- Consumes: kontrak Task 5; `businessUnitOptionsQueryOptions()`; `pickLink`.
- Produces: `useClonePreset()`; form preset memuat `LinkField` "Business Unit" (satu), "Penempatan nama Manual Book" (`NativeSelect` enum title/subtitle/footer; enum tetap = pengecualian LinkField), dan bagian terpilih pada pratinjau diberi keterangan "diisi nama Manual Book"; daftar preset menampilkan BU dan tombol "Kloning ke BU lain" (`manage`); `qrBusinessUnitLinkAccess` tak diperlukan (tanpa Tambah/Buka BU di sini; pakai `businessUnitLinkAccess`).

- [ ] **Step 1: Tes** (komponen): form preset wajib BU + penempatan (pesan galat zod); memilih BU memakai `pickLink(form, 'Business Unit', 'Spectrum')`; dialog kloning memilih BU tujuan (`LinkField`) dan nama baru lalu memanggil `qrcodes.clonePreset`; BU yang sudah punya preset tidak ditawarkan; `schemas.test.ts` `toSaveQrPresetInput` memuat `buId`/`namePlacement`.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/qrcode` — gagal. **Step 3: Implement**. **Step 4: Jalankan** tes web QR + typecheck — hijau (perbarui literal `QrPresetDto` di tes lama). **Commit** `feat(web): preset QR per BU dan kloning`.

---

### Task 12: Web: form konfigurasi QR baru (item → preset → nama → banner)

**Files:**
- Modify: `web/src/modules/qrcode/{queries,schemas}.ts`, `components/qr-design-form.tsx`, `components/apply-preset-dialog.tsx`, `web/src/routes/_app/qrcode/{new,$designId/edit}.tsx`, `web/src/lib/link-access.ts`
- Create: `web/src/modules/qrcode/components/item-picker.tsx`, `components/preset-deviation-banner.tsx`, `components/export-change-warning.tsx`
- Test: `components/{qr-design-form,item-picker,preset-deviation-banner}.test.tsx`, `schemas.test.ts`

**Interfaces:**
- Consumes: `QrDesignDto`/`SaveQrDesignInput` (Task 6), `qrcodes.itemOptions`, `manualBookNameFromTypes`, `qrPresetDeviations`, `businessUnitOptionsQueryOptions`.
- Produces: `ItemPicker` = `LinkMultiField` item (pencarian lewat `qrcodes.itemOptions` dengan `onSearchChange`/`hasMore`; item yang sudah milik Manual Book lain ditampilkan nonaktif dengan keterangan nama Manual Book-nya); `itemLinkAccess(me)` di `link-access.ts` (`openItemHref` bila `item: view`, tanpa Tambah). Urutan form baru: item → preset (otomatis menurut gabungan BU item; satu BU = otomatis; lebih dari satu = `LinkField` pilih preset; tanpa preset BU tersebut = daftar semua preset + opsi "Tanpa preset") → Nama (hasil `manualBookNameFromTypes` dari teks tipe item, boleh diedit; tidak ter-generate ulang setelah pengguna mengeditnya atau setelah tersimpan) → Sumber Link → Logo → Isi Label (bagian `namePlacement` terkunci mengikuti Nama, gayanya bebas) → Bingkai → Ukuran. `PresetDeviationBanner` menampilkan peringatan (tidak memblokir tombol simpan) dari `qrPresetDeviations`. `ExportChangeWarning`: sebelum menyimpan konfigurasi yang `exportedAt !== ''` dan hash akan berubah (hitung klien dengan `qrContentHash`), dialog peringatan akibat (stiker baru, stiker lama `deprecated`/nonaktif) tanpa kolom alasan; mengubah hanya daftar item tidak memunculkannya.

- [ ] **Step 1: Tes**: memilih dua item berlainan BU memunculkan pilihan preset, satu BU tidak; nama terisi "PBE M5-400/200" dari dua item bertipe itu dan tidak tertimpa setelah diedit; bagian yang dikunci terlihat `disabled` dan nilainya = nama; banner menyimpang muncul saat gaya diubah dan tombol simpan tetap aktif; submit tanpa item ditolak; item milik Manual Book lain tak dapat dipilih; dialog peringatan muncul saat label berubah pada konfigurasi yang sudah diekspor dan TIDAK muncul saat hanya item berubah; `pickLink`/`linkOptionNames` dipakai untuk semua pilihan relasi.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/qrcode` — gagal. **Step 3: Implement**. **Step 4: Jalankan** + typecheck — hijau. **Commit** `feat(web): form konfigurasi QR berbasis item, preset otomatis, nama, banner`.

---

### Task 13: Web: ekspor (alasan, preview), riwayat versi, tabel QR

**Files:**
- Modify: `web/src/modules/qrcode/{queries.ts,lib/export-files.ts}`, `components/{export-dialog,qr-designs-table}.tsx`, `web/src/routes/_app/qrcode/index.tsx`
- Create: `web/src/modules/qrcode/components/version-history.tsx`, `lib/preview-png.ts`
- Test: `components/{export-dialog,qr-designs-table,version-history}.test.tsx`, `lib/export-files.test.ts`

**Interfaces:**
- Consumes: `qrcodes.export` baru (Task 7), `qrcodes.versions` (Task 8).
- Produces: `renderExportFiles(...)` juga mengembalikan `preview: Uint8Array` (PNG sisi terpanjang ≈ 800 px dari kanvas yang sama, `previewMaxBytes`; fungsi murni `fitPreviewSize(width, height, max=800)` dapat dites); `ExportDialog` menampilkan penjelasan akibat dan kolom alasan wajib bila ekspor ulang akan membuat versi baru (`design.exportStatus === 'stale'` dan `design.stickerVersion > 0`), maks. 500 karakter; `useExportQrDesign` mengirim `preview` dan `reason`; `QrDesignsTable` menambah kolom Item (jumlah + nama pertama), Versi stiker (`vN`, badge `deprecated`/`nonaktif`), dan memakai badge status ekspor yang ada; `VersionHistory` (di halaman edit konfigurasi) daftar versi dengan gambar contoh (`StickerImage` bila pengguna dapat membaca, jika tidak placeholder), alasan, tanggal.

- [ ] **Step 1: Tes**: dialog meminta alasan hanya pada ekspor ulang berubah (tombol Ekspor nonaktif tanpa alasan), tidak pada ekspor pertama; `renderExportFiles` memberi `preview` ≤ batas (kanvas ditiru); tabel menampilkan Item dan Versi; riwayat menampilkan v2 di atas v1 dengan alasan.
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**. **Step 4: Jalankan** tes web QR + typecheck — hijau. **Commit** `feat(web): ekspor QR dengan alasan dan preview, riwayat versi, kolom Manual Book`.

---

### Task 14: Web: katalog stiker (deprecated, jenis sistem), Konfigurasi Stiker, navigasi

**Files:**
- Modify: `web/src/modules/sticker/{schemas,queries}.ts`, `components/{stickers-page,sticker-form-dialog,sticker-type-form-dialog,sticker-types-page,stock-page}.tsx`, `web/src/modules/item/components/sticker-instructions-field.tsx`, `web/src/modules/item/lib/sticker-instructions.ts`, `web/src/app/navigation.ts`, `web/src/app/navigation.test.ts`, `web/src/modules/access/lib/audit-actions.ts`
- Create: `web/src/routes/_app/sticker/settings.tsx`, `web/src/modules/sticker/components/sticker-settings-page.tsx`
- Test: `components/{stickers-page,sticker-types-page,stock-page,sticker-settings-page}.test.tsx`, `item/components/sticker-instructions-field.test.tsx`

**Interfaces:**
- Consumes: `StickerStatus`, `StickerTypeDto.systemKind/defaultMinQty`, `stickerSettings.get/save`.
- Produces: `STICKER_RULE_LABEL`/`STICKER_RULE_HINT` memuat `group` ("Menurut kelompok item"); form jenis hanya menawarkan `USER_STICKER_RULES` (jenis sistem tampil dengan keterangan, tak dapat diubah aturannya); badge "Usang" untuk `deprecated`; tombol "Tambah stiker" tak memuat jenis sistem di pemilih jenis; form stiker jenis sistem hanya mengizinkan minimum, alias, status (nama/jenis/gambar `disabled`); filter status katalog menambah "Usang"; stok: baris `deprecated` tanpa tombol catat masuk; pemilih stiker di editor instruksi menyembunyikan stiker jenis sistem (jenisnya tetap dapat dipilih); `StickerSettingsPage` = tabel jenis dengan input default minimum (jenis sistem tampil dengan label) + bagian penerima email (`LinkMultiField` user lewat `access.users.list` bila `access: view`, plus input email bebas valid; maks. 20; kartu peringatan bila `!smtpConfigured`) + jam ringkasan + sakelar; rute `/sticker/settings` (`requirePermission(qc,'sticker','manage')`); `navigation.ts`: grup baru "Manual Book" berisi "QR Code" (dipindah dari "Data"), item "Konfigurasi Stiker" di grup "Stiker" (`excludes` item "Stiker" ditambah `/sticker/settings`); label audit `qrcode.preset_*`, `sticker.*`, `stickerType.*`, `sticker.settings`.

- [ ] **Step 1: Tes** sesuai Interfaces (filter/ badge Usang; form stiker jenis sistem terkunci; pemilih instruksi menyembunyikan stiker sistem; halaman konfigurasi menyimpan `stickerSettings.save` dengan `expectedUpdatedAt`; kartu SMTP; navigasi: "QR Code" kini di "Manual Book", "Konfigurasi Stiker" butuh `sticker: manage`).
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**; regenerasi `routeTree.gen.ts` dan commit. **Step 4: Jalankan** `bun run --cwd web test src/modules/sticker src/modules/item src/app` + typecheck — hijau. **Commit** `feat(web): katalog stiker usang dan jenis sistem, halaman Konfigurasi Stiker, grup menu Manual Book`.

---

### Task 15: Web item (label, filter, detail), dokumen, dan verifikasi akhir

**Files:**
- Modify: `web/src/modules/item/{queries.ts,lib/list-filter.ts}`, `components/{items-table,item-filters,item-detail-view}.tsx`, `web/src/routes/_app/item/index.tsx`, `shared/permissions.ts` (`MODULE_LEVEL_HINTS.qrcode`), `docs/prd/2026-10-16-qc-qr-code.md`, `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md`, `docs/superpowers/specs/2026-11-08-business-unit-design.md`, `docs/ci-cd.md`, `CLAUDE.md`
- Test: `item/components/{items-table,item-filters,item-detail-view}.test.tsx`, `item/lib/list-filter.test.ts`, `item/queries.test.tsx`

**Interfaces:**
- Consumes: `hasManualBook`, `ItemDto.manualBook`, `items.list` filter `manualBook`.
- Produces: `ItemListFilter.manualBook: 'all' | 'missing'` (+ `manualBook` search param di `itemsSearchSchema`, kunci `itemKeys.page`, `filterOfSearch`/`searchPatchOf`); `NoManualBookNote` ("Belum ada QR Manual Book") di sel Tipe tabel item untuk item aktif tanpa `hasManualBook` (ditampilkan berdampingan dengan `NoInstructionsNote`); opsi filter "Belum ada QR Manual Book" di `ItemFilters`; bagian "Manual Book" di `ItemDetailView` (nama, versi, status; tautan ke `/qrcode/$designId/edit` bila `qrcode: view`); `MODULE_LEVEL_HINTS.qrcode`: ekspor butuh `edit`, `manage` = hapus dan pengaturan default; dokumen: PRD QR (preset per BU, penarikan otomatis menggantikan pemilihan manual, Manual Book/versi/alasan, nama berkas, peringatan), spek 3a (status `deprecated`, `default_min_qty`, aturan `group`, jenis sistem, low mengabaikan deprecated, Konfigurasi Stiker), spek BU (baris tahap 4 → 4a/4b), `docs/ci-cd.md` (catatan rollback image lama vs `deprecated`), `CLAUDE.md` (bullet tahap 4a setelah bullet 3b-2, daftar `link-access` bertambah `itemLinkAccess`/`stickerLinkAccess`), dan spek 4a status "dibangun".

- [ ] **Step 1: Tes** web item sesuai Interfaces (label muncul hanya untuk item aktif tanpa Manual Book; filter mengubah search param dan kunci query; detail menampilkan bagian Manual Book dan tautan sesuai izin).
- [ ] **Step 2: Jalankan** — gagal. **Step 3: Implement**, perbarui dokumen. 
- [ ] **Step 4: Verifikasi penuh**: `bun run check` (butuh terowongan hidup) — hijau; `bun run build` — hijau (`verify-dist`); jalankan `git status` dan pastikan hanya berkas rencana ini yang berubah dan `check.ts` pengguna tidak ikut. **Commit** `feat(web): label dan filter Manual Book pada item, dokumen tahap 4a`.

---

## Catatan verifikasi (diisi implementer; hasil yang benar-benar dijalankan)

**Setelah Task 15 (commit 5c2ff0d), 2026-11-11:** `bun run check` penuh dijalankan sekali: typecheck bersih, Biome 0 galat, skrip 48 lulus, shared 323 lulus, server 1463 lulus dan 11 gagal. Sebelas kegagalan itu: 1 nyata (`server/src/core/migrate.test.ts` belum memuat tabel `manual_book_versions`, migrasi 0008, dan indeks baru; diperbaiki di commit yang sama) dan 10 karena terowongan MariaDB putus di tengah proses paralel (`ECONNREFUSED`/"Connection lost") pada `qrcode.test.ts`, `jobs.test.ts`, `rest-binary.test.ts`; ketiganya dijalankan ulang per berkas: 31, 19, 19 lulus. Karena rantai `check` berhenti di tahap server, tes web dijalankan terpisah (134 berkas, 928 tes lulus). `bun run build` hijau (`verify-dist`). **`bun run check` belum pernah hijau dalam satu proses utuh** (terowongan dev tidak stabil); hasil di atas gabungan dari run penuh dan pengulangan per berkas.

**Setelah putaran perbaikan review akhir (2026-11-11):** typecheck bersih (root, shared, web, server); `biome check . --diagnostic-level=error` 0 galat; `bun test shared` 323 lulus; `bun run --cwd web test` 137 berkas / 945 tes lulus; `bun run build` hijau (127 potongan JS, terbesar 510483 byte gzip); server hanya berkas yang diubah: `src/modules/sticker/manual-book.test.ts` 19 lulus (tunnel 33063 hidup). Catatan: polling `INNODB_TRX`/`PROCESSLIST` di helper `whileLocked` butuh hak PROCESS yang tidak dimiliki pengguna tes pada MariaDB dev lewat tunnel (galat 1227), sehingga di sana polling selalu jatuh ke jeda tetap 1,5 dtk; penantang tetap wajib belum selesai saat kunci dilepas.

**Putaran keputusan pemilik (2026-11-11):** pemilik menyetujui semua rekomendasi pada daftar "menunggu keputusan"; keputusan tercatat di spek 4a §8. Perubahan kode: penanda `StickerDto.latestManualBookVersion` (Aktifkan hanya untuk versi terbaru), nama Manual Book unik di `qrcodes.save`/`qrcodes.export`, `stickerTypes.setStatus` menolak jenis sistem, `assertPresetBu` hanya saat `buId` berubah, `total` dihapus dari `qrcodes.versions`, filter "Belum ada QR Manual Book" mengirim `status=active`. Tanpa migrasi baru.
