# Instruksi Stiker per Item (3b-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item memiliki foto instruksi (dari pustaka 3b-1) dengan penanda posisi ke stiker atau jenis stiker, tampil di detail item dengan daftar di bawah foto, dengan tanda dan filter "belum ada instruksi" serta filter per stiker/jenis, menggantikan total daftar stiker lama.

**Architecture:** Dua tabel baru (`item_sticker_photos` dengan FK `RESTRICT` ke pustaka, `item_sticker_marks`) ditulis bersama item lewat `items.save` (ganti-semua dalam satu `batch()`, penjaga versi dan hak BU yang ada). Aturan jenis→stiker satu fungsi murni di `shared/stickers.ts` (dipakai server saat membaca detail) dengan cermin SQL untuk filter daftar, dijaga tes kesepakatan. Web: bagian "Instruksi stiker" di form item (editor penanda + dialog berkas 3b-1), tampilan baca di detail, filter di daftar.

**Tech Stack:** Bun + Hono + MariaDB 11.8 (`server/`), React + TanStack Router/Query/Form + shadcn (`web/`), `shared/` murni, Vitest (web), `bun test` (server, MariaDB sungguhan lewat `bun run db:tunnel`).

**Spec:** `docs/superpowers/specs/2026-11-10-stiker-instruksi-item-3b2-design.md` (induk: spek 3a §6, spek 3b-1 §3 "Kontrak ke 3b-2", spek BU keputusan 13/17/18/20/21/23). Pustaka 3b-1 sudah di-merge (PR 48). Aturan LinkField (PR 49) berlaku: pilihan stiker, jenis, dan BU memakai `LinkField`.

## Global Constraints

- Batas (`shared/stickers.ts`, `INSTRUCTION_LIMITS`): 10 foto per item, 30 penanda per foto, catatan foto maks. 200 karakter, catatan penanda maks. 120 karakter, koordinat bilangan bulat 0-1000 (permil). Satu foto pustaka hanya sekali per item.
- Sasaran penanda tepat satu: `{ kind: 'sticker', stickerId }` atau `{ kind: 'type', typeId }`. Pilihan baru hanya stiker/jenis aktif; yang tersimpan tetap utuh bila kemudian nonaktif. Penanda ke stiker tertentu tidak disaring BU dan tidak divalidasi tautan BU-nya.
- Label BU foto (`buId`, boleh `null`) harus salah satu BU item (dari input `businessUnitIds`); murni tampilan, tidak memengaruhi pencocokan.
- Pencocokan jenis→stiker (satu definisi, `stickersForType`): hanya stiker `active` berjenis itu; aturan jenis `none` = semua; aturan `bu` = stiker yang tertaut (`sticker_business_units`) ke minimal satu BU item; stiker tanpa BU tidak pernah cocok untuk aturan `bu`. Status jenis tidak memengaruhi penerjemahan. Tidak cocok = `unresolved: true` (label tetap tampil dengan peringatan "Belum ada stiker {jenis} untuk BU ini"); simpan tidak pernah diblokir.
- Instruksi = "ada" bila item punya minimal satu penanda (`hasInstructions`).
- `items.save` PUT utuh: `stickerPhotos` wajib ada (daftar kosong = tanpa instruksi). Perubahan instruksi menaikkan versi item dan memakai hak BU yang sama dengan pengeditan biasa (keputusan 13). Item di luar hak BU = `NOT_FOUND` di semua jalur baru.
- Migrasi `0007_instruksi_stiker_item.sql`: expand-only, idempoten; kolom `items.stickers` TIDAK dihapus dan tidak dibaca/ditulis lagi (kode berhenti memakainya; kolom `NOT NULL DEFAULT ''`). Tanpa backfill.
- `usageCount` pustaka menghitung semua penempatan, apa pun status item. Hapus gambar yang dipakai = `CONFLICT` "Gambar masih dipakai" (dijaga FK `RESTRICT`).
- Izin: baca katalog untuk editor = `stickers.list` dan `stickerTypes.list` menjadi `anyOf` (`sticker: view` atau `item: edit`); `stickerGuides.usages` = `item: view`; menulis = `items.save` (`item: edit`). Detail item tidak memerlukan `sticker: view`.
- Tabel baru mengikuti kolasi `utf8mb4_nopad_bin` dan tipe id `VARCHAR(100)` seperti migrasi 0005/0006; parameter SQL selalu `?` ter-bind; `SUM`/`COUNT` dibungkus `Number()`.
- Urutan komit: Task 1 menghapus `ItemDto.stickers`, sehingga typecheck server baru bersih setelah Task 4 dan typecheck web baru bersih setelah Task 10; tiap tugas cukup menjalankan tes terfokusnya, dan `bun run check` penuh wajib hijau di Task 13 (sebelum PR).
- Tes server MariaDB sungguhan (`bun run db:tunnel` hidup); tes konkurensi memakai `Promise.all` atas permintaan nyata. Komponen UI shadcn dari `web/src/components/ui`; tanpa library state global. Jangan menyentuh `scripts/google-sa-check/check.ts` (perubahan lokal pemilik). Jangan mematikan server dev pengguna (tab c3) maupun terowongan DB (c7).

## Review Focus

1. Item dev lama dengan `items.stickers` terisi tetap dapat dibaca, disimpan, dan masuk daftar tanpa galat (instruksi kosong). → Task 4.
2. Input tak sah: foto kembar dalam satu item, koordinat di luar 0-1000 atau bukan bilangan bulat, sasaran ganda atau kosong, foto/stiker/jenis/BU yang tidak ada, batas 10/30 terlampaui, galat disebut per field `stickerPhotos`. → Task 3.
3. Stiker atau jenis dinonaktifkan setelah ditandai (label tetap, tanda nonaktif), jenis tanpa stiker yang cocok untuk BU item (peringatan, simpan tetap berhasil), item dua BU (stiker dari kedua BU, berlabel BU). → Task 1 dan 4.
4. Item di luar hak BU: `NOT_FOUND` di detail, daftar, filter, dan `stickerGuides.usages` (jumlah dan nama item tidak bocor). → Task 4, 5, 6.
5. Balapan: hapus gambar pustaka bersamaan dengan menyimpan item yang memakainya tidak boleh meninggalkan penempatan yatim; filter per stiker sepakat dengan hasil detail. → Task 5 dan 6.
6. Sentuh dan layar kecil: penanda dapat dibuat dan dipindah lewat sentuhan/papan ketik, daftar di bawah foto tetap jalan di 375 px. → Task 8 dan 10.

---

### Task 1: Kontrak bersama (shared)

**Files:**
- Modify: `shared/stickers.ts` (konstanta, tipe, `stickersForType`), `shared/contract.ts`, `shared/api.ts`
- Test: `shared/stickers.test.ts`, `shared/api.test.ts`

**Interfaces:**
- Produces di `shared/stickers.ts`:
  - `INSTRUCTION_LIMITS = { photos: 10, marks: 30, caption: 200, markNote: 120, coordMax: 1000 } as const`
  - `type StickerMarkTarget = { kind: 'sticker'; stickerId: string } | { kind: 'type'; typeId: string }`
  - `interface MatchSticker { id: string; typeId: string; status: 'active' | 'inactive'; buIds: readonly string[] }`
  - `interface MatchType { id: string; rule: StickerRule }`
  - `stickersForType(type: MatchType, stickers: readonly MatchSticker[], itemBuIds: readonly string[]): MatchSticker[]` (aturan di Global Constraints; urutan masukan dipertahankan)
  - `GUIDE_SORTS` ditambah `'usageDesc'` (urut "paling sering dipakai").
- Produces di `shared/contract.ts`: `ItemStickerMarkDto { x; y; target: StickerMarkTarget; note: string }`; `ItemStickerPhotoInput { guideId; caption; buId: string | null; marks: ItemStickerMarkDto[] }`; `ResolvedStickerDto { id; name; alias; fileId: string | null; buCodes: string[]; inactive: boolean }`; `ItemStickerMarkView extends ItemStickerMarkDto { targetName: string; resolved: ResolvedStickerDto[]; unresolved: boolean }`; `ItemStickerPhotoDto { guideId; guideName; width; height; caption; buId: string | null; marks: ItemStickerMarkView[] }`; `SaveItemInput.stickerPhotos: ItemStickerPhotoInput[]`; `ItemDto.stickerPhotos: ItemStickerPhotoDto[]` (`ItemDto.stickers` dan `ItemStickerDto` DIHAPUS); `ItemSummaryDto.hasInstructions: boolean`; `ListItemsPageInput` + `instruction?: 'none'`, `stickerId?`, `typeId?`, `stickerMode?: 'has' | 'missing'`; `GuideUsageDto { itemId; label; status: ItemStatus }`; `ListGuideUsagesInput { id }`; id kontrak `'stickerGuides.usages': { input: ListGuideUsagesInput; output: GuideUsageDto[] }`.
- Produces di `shared/api.ts`: entri `'stickerGuides.usages': { verb: 'GET', path: '/sticker-guides/{id}/usages' }`; `items.list` menambah query `instruction`, `stickerId`, `typeId`, `stickerMode` (string).

- [ ] **Step 1: Tes `stickersForType`** (nama tes dan asersi): aturan `none` mengembalikan semua stiker aktif jenis itu dan mengabaikan stiker nonaktif serta jenis lain; aturan `bu` hanya yang `buIds` beririsan dengan `itemBuIds`; item dua BU mengembalikan stiker dari kedua BU; stiker `buIds: []` tidak cocok untuk `bu`; `itemBuIds: []` menghasilkan daftar kosong untuk `bu` dan semua untuk `none`.
- [ ] **Step 2: Jalankan** `bun run --cwd shared test stickers` → GAGAL (fungsi belum ada).
- [ ] **Step 3: Implementasikan** konstanta, tipe, `stickersForType`, tambahan `GUIDE_SORTS`, semua DTO/kontrak, dan entri `API_ROUTES`. Perbarui `shared/api.test.ts` bila perlu (tabel dan kontrak sejalan; batas literal).
- [ ] **Step 4: Jalankan** `bun run --cwd shared test` dan `bun run typecheck` (server dan web akan gagal tipe di Task berikutnya; di sini cukup `shared` hijau, catat daftar berkas yang gagal tipe untuk Task 3-4 dan 7).
- [ ] **Step 5: Commit** `feat(shared): kontrak instruksi stiker item`.

### Task 2: Migrasi dan repo instruksi (server)

**Files:**
- Create: `server/migrations/0007_instruksi_stiker_item.sql`, `server/src/modules/sticker/instruction-repo.ts`, `server/src/modules/sticker/instruction.test.ts`
- Modify: `server/src/core/migrate.test.ts` (daftar migrasi/hash templat bila ada), `server/src/core/db.ts` (hanya bila perlu kind galat kunci asing)

**Interfaces:**
- Consumes: `ItemStickerPhotoInput`, `INSTRUCTION_LIMITS` (Task 1).
- Produces di `instruction-repo.ts`:
  - `replaceItemInstructionStmts(db: Db, itemId: string, photos: readonly ItemStickerPhotoInput[]): DbStatement[]` (DELETE foto item lalu INSERT foto dan penanda berurutan; `position` dari urutan array)
  - `loadItemInstructions(db: Db, itemIds: readonly string[]): Promise<Map<string, StoredPhoto[]>>` dengan `StoredPhoto { guideId; caption; buId: string | null; position; marks: ItemStickerMarkDto[] }`
  - `hasInstructionsOf(db: Db, itemIds: readonly string[]): Promise<Set<string>>`
- Tabel: `item_sticker_photos` (PK `item_id, guide_id`; `caption`, `bu_id` ('' = tanpa label), `position`; indeks `guide_id`; FK `guide_id` → `sticker_guide_images(id)` `ON DELETE RESTRICT`) dan `item_sticker_marks` (PK `item_id, guide_id, position`; `x`, `y` SMALLINT, `sticker_id`, `type_id` (salah satu terisi), `note`; FK `(item_id, guide_id)` → foto `ON DELETE CASCADE`; indeks `sticker_id` dan `type_id`).

- [ ] **Step 1: Tes** di `instruction.test.ts` (harness `createTestEnv`): `replaceItemInstructionStmts` lalu `loadItemInstructions` mengembalikan foto dan penanda berurutan persis; ganti-semua menghapus yang lama; menghapus baris pustaka yang dipakai dengan SQL langsung GAGAL oleh kunci asing (galat duplikat/FK, bukan senyap); menghapus foto item ikut menghapus penandanya; `hasInstructionsOf` benar hanya bila ada penanda (foto tanpa penanda = tidak ada).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/sticker/instruction` → GAGAL.
- [ ] **Step 3: Implementasikan** migrasi dan repo; perbarui `migrate.test.ts` untuk migrasi baru.
- [ ] **Step 4: Jalankan** tes berkas itu dan `migrate.test.ts` → hijau.
- [ ] **Step 5: Commit** `feat(server): tabel dan repo instruksi stiker item`.

### Task 3: Validasi `items.save` dengan `stickerPhotos`

**Files:**
- Modify: `server/src/modules/item/validate.ts` (ganti `readItemStickers` dengan `readStickerPhotos`), `server/src/modules/item/validate.test.ts`, `server/src/modules/item/service.ts` (hanya pemeriksaan rujukan; penulisan di Task 4)

**Interfaces:**
- Consumes: Task 1 tipe dan batas; Task 2 repo.
- Produces: `validateSaveItem` mengembalikan `SaveItemInput` dengan `stickerPhotos` (dirapikan: trim catatan, `buId` kosong → `null`); galat per field `stickerPhotos` dengan pesan menyebut nomor foto/penanda; `assertInstructionRefs(env: Env, input: SaveItemInput): Promise<void>` di `item/service.ts` (satu `batch()` baca): foto ada di `sticker_guide_images` (+ `files` aktif), stiker ada (status apa pun lama; BARU harus aktif bila berbeda dari tersimpan: periksa terhadap penanda item yang sudah ada), jenis ada, `buId` ∈ `input.businessUnitIds`; gagal = `VALIDATION` pada `stickerPhotos`.

- [ ] **Step 1: Tes validator** (nama dan asersi, pesan Indonesia persis di tes): bukan daftar; >10 foto; `guideId` kembar; catatan foto >200; >30 penanda; x/y bukan bilangan bulat atau di luar 0-1000; target tidak berbentuk `sticker`/`type`; kedua id terisi; catatan penanda >120; `buId` bukan string/`null`. Pesan menyebut "Foto 2" / "Foto 1, penanda 3".
- [ ] **Step 2: Tes rujukan** (`item-bu-write.test.ts` atau berkas tes item baru): foto/stiker/jenis tidak ada → `VALIDATION`; stiker nonaktif baru ditolak tetapi stiker nonaktif yang sudah tersimpan di item itu lolos; `buId` di luar BU item ditolak.
- [ ] **Step 3: Jalankan** → GAGAL.
- [ ] **Step 4: Implementasikan** `readStickerPhotos` (hapus `readItemStickers`, `ITEM_LIMITS.stickers*` dan cek `checkItemJsonSize('stickers')`; tambahkan ukuran JSON bila perlu), `assertInstructionRefs`, dan panggil dari `planItemWrite`.
- [ ] **Step 5: Jalankan** `bun run --cwd server test src/modules/item/validate` dan tes terkait → hijau.
- [ ] **Step 6: Commit** `feat(server): validasi instruksi stiker pada penyimpanan item`.

### Task 4: Tulis dan baca instruksi bersama item, ganti daftar lama

**Files:**
- Modify: `server/src/modules/item/service.ts` (`planItemWrite`, `getItemDto`, `saveItem`/`saveItemOnce`, `toItemDto`, `itemSnapshot`, `itemContentEquals`, `referencedFileIds`, `assertItemFilesUsable`), `server/src/modules/item/repo.ts` (`ItemRecord.stickers`, `parseStickers`, `insertItemStmts`, `updateItemStmts`: berhenti membaca/menulis kolom `stickers`), `server/scripts/seed-data.ts`, tes item yang memakai `stickers`
- Create: `server/src/modules/sticker/instruction-service.ts`
- Test: `server/src/modules/item/instruction.test.ts`

**Interfaces:**
- Consumes: Task 1-3.
- Produces di `instruction-service.ts`: `buildInstructionViews(env: Env, itemId: string, itemBuIds: readonly string[], photos: readonly StoredPhoto[]): Promise<ItemStickerPhotoDto[]>` (satu pembacaan stiker/jenis/BU stiker/foto pustaka; memakai `stickersForType`; `targetName` = nama stiker (alias bila ada) atau nama jenis; penanda ke stiker tertentu → `resolved` berisi stiker itu dengan `inactive` benar; `buCodes` = kode BU persekutuan stiker dan item).
- `getItemDto` dan hasil `saveItem` mengisi `stickerPhotos` lewat pembacaan SETELAH batch (bukan dari input). `planItemWrite` menambah `replaceItemInstructionStmts(...)` ke batch item baru maupun ubah, setelah `attach`. `itemSnapshot` mencatat ringkasan `stickerPhotos: { photos, marks }` menggantikan `stickers`.

- [ ] **Step 1: Tes** di `instruction.test.ts` lewat `restClient`: simpan item baru dengan 2 foto dan penanda campuran lalu `items.get` mengembalikan persis (urutan, koordinat, catatan, `guideName`); ubah mengganti seluruhnya; instruksi saja yang berubah tetap menaikkan `updatedAt` dan `expectedUpdatedAt` usang = 412 lewat `If-Match`; penanda jenis `bu` pada item satu BU, dua BU (berlabel `buCodes`), tanpa kecocokan (`unresolved: true`), jenis `none`; stiker nonaktif langsung tampil `inactive: true`; jenis nonaktif tetap diterjemahkan; item dev lama dengan kolom `stickers` terisi (isi lewat SQL langsung) dapat di-`get` (instruksi kosong) dan disimpan ulang tanpa galat; item di luar hak BU `NOT_FOUND` di `get`; audit `item.update` memuat ringkasan instruksi.
- [ ] **Step 2: Jalankan** → GAGAL.
- [ ] **Step 3: Implementasikan**; hapus `ItemRecord.stickers`/`parseStickers` dan semua rujukan `stickers` lama (`referencedFileIds` tak lagi memuat berkas contoh stiker lama); perbarui tes dan `seed-data.ts` yang masih memakai `stickers` (seed: contoh item dengan satu foto dan penanda bila ada gambar pustaka contoh, selain itu kosong).
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/item` (seluruh folder, termasuk `item-bu-*`) dan `bun run typecheck` untuk server → hijau.
- [ ] **Step 5: Commit** `feat(server): simpan dan baca instruksi stiker bersama item`.

### Task 5: Filter dan penanda di daftar item (server)

**Files:**
- Modify: `server/src/modules/item/service.ts` (`listItemPage`), `server/src/modules/item/validate.ts` (`validateListItems`), `server/src/modules/sticker/instruction-repo.ts`
- Test: `server/src/modules/item/instruction-list.test.ts`

**Interfaces:**
- Consumes: Task 1-4.
- Produces di `instruction-repo.ts`: `instructionFilterSql(filter: { instruction?: 'none'; stickerId?: string; typeId?: string; stickerMode?: 'has' | 'missing' }): { clauses: string[]; binds: unknown[] }` (kait `EXISTS`/`NOT EXISTS` atas `item_sticker_marks` dengan alias item `i`; pencocokan jenis→stiker dicerminkan SQL dari `stickersForType`); `ItemSummaryDto.hasInstructions` diisi dari `hasInstructionsOf` untuk baris halaman. `validateListItems`: `stickerId` dan `typeId` tidak boleh bersamaan, `stickerMode` hanya dengan salah satunya (bawaan `has`), nilai tak dikenal = `VALIDATION`.

- [ ] **Step 1: Tes** (seed manual stiker/jenis/BU/item): `instruction=none` menyaring hanya item tanpa penanda; `stickerId` mode `has` cocok untuk penanda langsung dan untuk penanda jenis yang menghasilkan stiker itu bagi BU item (dua item beda BU memberi hasil berbeda); `typeId` mode `has` cocok untuk penanda jenis itu atau penanda ke stiker berjenis itu; mode `missing` adalah komplemen di antara item terlihat; **tes kesepakatan**: untuk tiap item uji, `items.get` (hasil `resolved`) dan daftar terfilter `stickerId` memberi jawaban sama; filter tetap terbatas BU (item di luar BU tidak muncul di `has` maupun `missing`); kombinasi dengan `status` dan `query`; kursor tetap stabil.
- [ ] **Step 2: Jalankan** → GAGAL.
- [ ] **Step 3: Implementasikan.**
- [ ] **Step 4: Jalankan** tes baru + `item.test.ts`/`rest.test.ts` → hijau. Uji `EXPLAIN` sederhana pada filter bila perlu; tambahkan indeks hanya bila tes performa nyata menuntut (spek §5).
- [ ] **Step 5: Commit** `feat(server): filter instruksi stiker pada daftar item`.

### Task 6: Pustaka: pemakaian nyata, hapus dijaga FK, urut, usages, izin katalog

**Files:**
- Modify: `server/src/modules/sticker/guide-repo.ts` (`guideUsageCountSql`, urut `usageDesc`), `guide-validate.ts`, `guide-service.ts` (`removeGuide` memetakan galat FK; `listGuideUsages`), `guide-routes.ts` (rute `stickerGuides.usages`), `routes.ts` (`stickers.list`/`stickerTypes.list` → `anyOf`), `server/src/routes.ts` (`ALL_API_IDS`), `server/src/http/body.test.ts` bila perlu, `server/src/core/db.ts` bila kind FK baru
- Test: `server/src/modules/sticker/guide.test.ts` (tambah), `server/src/modules/sticker/rest.test.ts`

**Interfaces:**
- Consumes: Task 1-2.
- Produces: `guideUsageCountSql()` = `(SELECT COUNT(*) FROM item_sticker_photos p WHERE p.guide_id = g.id)` (alias `g` tetap); `listGuideUsages(env: Env, input: ListGuideUsagesInput, user: UserContext): Promise<GuideUsageDto[]>` (maks. 20 item, hanya BU terlihat, urut nama, termasuk item nonaktif dengan `status`); `removeGuide` pada gambar terpakai → `appError('CONFLICT', 'Gambar masih dipakai')`.

- [ ] **Step 1: Tes** (tambah ke `guide.test.ts`): **jalur `usageCount > 0`**: setelah satu item memasang gambar, `list` mengembalikan `usageCount` benar, filter `unused` menyembunyikannya, `remove` = `CONFLICT` "Gambar masih dipakai" dan gambar serta penempatan tetap ada; item nonaktif tetap menahan hapus; **balapan** `Promise.all([remove, items.save yang memakai gambar itu])`: hasil akhir konsisten (tidak ada penempatan yatim, tidak ada galat 500; salah satu menang); urut `usageDesc` benar termasuk kursor; `usages` menampilkan item (BU terlihat saja; item di luar BU tidak ada), item nonaktif berstatus; `usages` pada id tak dikenal = daftar kosong atau `NOT_FOUND` sesuai pola `list`; izin: pemegang `item: edit` tanpa `sticker: view` dapat `stickers.list` dan `stickerTypes.list`, tanpa kedua izin = `FORBIDDEN`.
- [ ] **Step 2: Jalankan** → GAGAL.
- [ ] **Step 3: Implementasikan**; perbarui komentar kontrak 3b-1 di `guide-repo.ts` dan `CLAUDE.md` (bullet pustaka: pemakaian kini nyata).
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/sticker` dan `src/routes.test.ts`, `src/http/body.test.ts` → hijau.
- [ ] **Step 5: Commit** `feat(server): pemakaian nyata pustaka, hapus dijaga FK, urut dan usages`.

### Task 7: Fondasi web: skema form, kueri, pembantu

**Files:**
- Modify: `web/src/modules/item/schemas.ts` (`stickers` → `stickerPhotos`, `toItemFormDefaults`, `toSaveItemInput`), `web/src/modules/item/queries.ts` (`toItemSummary`, filter daftar), `web/src/modules/sticker/queries.ts`, `web/src/modules/item/lib/link-access.ts`
- Create: `web/src/modules/item/lib/sticker-instructions.ts`, `web/src/modules/item/lib/sticker-instructions.test.ts`
- Delete: `web/src/modules/item/components/sticker-list-field.tsx` dan tesnya (setelah Task 9 menggantikannya; hapus di Task 9)
- Test: `web/src/modules/item/schemas.test.ts`, `queries.test.tsx`, `link-access.test.ts`

**Interfaces:**
- Consumes: Task 1 tipe.
- Produces di `sticker-instructions.ts`: `pointToPermil(point: { clientX: number; clientY: number }, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number }` (dijepit 0-1000, bulat); `clampPermil(value: number): number`; `copyMarks(source: readonly ItemStickerMarkDto[]): ItemStickerMarkDto[]` (salinan dalam); `moveEntry<T>(list: readonly T[], from: number, to: number): T[]`; `markLabel(target: StickerMarkTarget, stickers: readonly StickerDto[], types: readonly StickerTypeDto[]): string`.
- `ItemFormInput.stickerPhotos: Array<{ guideId: string; caption: string; buId: string | null; marks: Array<{ x: number; y: number; target: StickerMarkTarget; note: string }> }>` (zod: batas 10/30/200/120, foto kembar ditolak); `ItemListFilter` + `instruction: 'all' | 'none'`, `stickerKey: string` (`''` | `s:<id>` | `t:<id>`), `stickerMode: 'has' | 'missing'`; `itemsInfiniteQueryOptions` meneruskannya ke query `items.list`; `stickerGuideUsagesQuery(guideId: string)` di `web/src/modules/sticker/queries.ts`. `link-access.ts` menambah penentu Tambah stiker/jenis (hanya `sticker: edit`), tanpa Buka.

- [ ] **Step 1: Tes** pembantu murni (jepit, pembulatan, salinan dalam tidak berbagi referensi, pindah urutan) dan skema (batas, foto kembar, sasaran wajib); tes `link-access` untuk stiker/jenis.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/item` → GAGAL.
- [ ] **Step 3: Implementasikan.** `bun run typecheck` web akan menunjuk berkas yang masih memakai `stickers` (form, detail, tes); perbaiki hanya yang termasuk tugas ini, sisanya Task 8-10 (catat di laporan).
- [ ] **Step 4: Jalankan** tes berkas yang diubah → hijau.
- [ ] **Step 5: Commit** `feat(web): fondasi form instruksi stiker`.

### Task 8: Kanvas penanda dan baris penanda (web)

**Files:**
- Create: `web/src/modules/item/components/marker-canvas.tsx`, `web/src/modules/item/components/mark-row.tsx`, `marker-canvas.test.tsx`, `mark-row.test.tsx`

**Interfaces:**
- Consumes: Task 7 pembantu.
- Produces: `MarkerCanvas({ src, width, height, marks, selected, onSelect, onAdd, onMove, disabled }: { src: string; width: number; height: number; marks: readonly { x: number; y: number }[]; selected: number | null; onSelect: (index: number | null) => void; onAdd: (point: { x: number; y: number }) => void; onMove: (index: number, point: { x: number; y: number }) => void; disabled?: boolean })` (gambar dengan rasio asli; ketuk area kosong = `onAdd`; penanda bernomor dapat diseret dengan pointer (mouse dan sentuh) dan digeser dengan tombol panah saat terfokus; `aria-label` "Penanda n"); `MarkRow({ index, mark, stickerOptions, typeOptions, onChange, onRemove, ... })` memuat pilihan mode (stiker tertentu / jenis) dengan `LinkField` sesuai (opsi dan `labelOf` dari katalog; `onCreate` hanya bila disediakan), catatan penanda (maks. 120), tombol hapus, dan galat per baris.

- [ ] **Step 1: Tes**: ketuk menghasilkan `onAdd` dengan permil benar (rect disimulasikan); seret memanggil `onMove` dan menjepit di tepi; panah menggeser 10 permil; `disabled` mematikan semuanya; `MarkRow` mengganti mode membersihkan sasaran lama, `LinkField` menampilkan label stiker nonaktif dengan "— nonaktif", hapus memanggil `onRemove`.
- [ ] **Step 2: Jalankan** → GAGAL. **Step 3: Implementasikan.** **Step 4: Jalankan** → hijau.
- [ ] **Step 5: Commit** `feat(web): kanvas dan baris penanda instruksi stiker`.

### Task 9: Bagian "Instruksi stiker" di form item (web)

**Files:**
- Create: `web/src/modules/item/components/sticker-instructions-field.tsx`, `copy-marks-dialog.tsx`, tesnya
- Modify: `web/src/modules/item/components/item-form.tsx` (ganti `StickerListField`), `item-form.test.tsx`, rute yang merender `ItemForm` (mis. `web/src/routes/_app/item/**`) untuk menyuplai katalog stiker/jenis dan pembuat stiker, `web/src/modules/item/lib/edit-access.ts` bila perlu
- Delete: `sticker-list-field.tsx`, `sticker-list-field.test.tsx`

**Interfaces:**
- Consumes: Task 7-8; dialog berkas 3b-1 (`FileDialog`, `FileDropZone`, `guideSource` dari `web/src/modules/sticker/lib/guide-source.ts`); `stickerGuideUsagesQuery`; `itemQueryOptions` (membaca penanda item sumber).
- Produces: `StickerInstructionsField({ value, onChange, businessUnits, stickers, types, onCreateSticker?, onCreateType?, errors })` bagian bernama "Instruksi stiker" dengan `Section` yang sama; daftar foto (gambar penuh dari pembaca yang dipakai pratinjau Pustaka Gambar), catatan foto, label BU (`LinkField` ke BU item yang sedang dipilih di form), naik/turun, hapus foto, `MarkerCanvas` + `MarkRow`; tombol "Tambah foto" membuka dialog berkas (mode banyak, sumber pustaka stiker); seret-lepas ke bagian ini membuka dialog dengan `initialFiles`; memilih foto yang dipakai item lain menawarkan `CopyMarksDialog` (daftar dari `usages`, penanda dibaca lewat `itemQueryOptions(id)`, disalin lewat `copyMarks`, catatan foto tidak ikut; foto tanpa pemakai langsung ditambahkan). `buId` yang tidak lagi ada di BU item otomatis dikosongkan.

- [ ] **Step 1: Tes** (Vitest, `@testing-library/react`, jaringan di-mock seperti tes form lain): menambah foto dari dialog menambah kartu foto; salin penanda mengisi penanda tanpa catatan foto; mengubah satu penanda hasil salinan tidak mengubah item sumber; batas 10 foto dan 30 penanda menonaktifkan tombol; galat server per field tampil; LinkField stiker/jenis memakai opsi katalog dan tombol Tambah hanya bila `onCreate*` disediakan; ubah BU item yang melepas BU label foto mengosongkan label.
- [ ] **Step 2: Jalankan** → GAGAL. **Step 3: Implementasikan**; hapus komponen lama dan tesnya.
- [ ] **Step 4: Jalankan** `bun run --cwd web test src/modules/item` dan `bun run typecheck` → hijau.
- [ ] **Step 5: Commit** `feat(web): bagian instruksi stiker pada form item`.

### Task 10: Tampilan baca di detail item dan tanda belum ada instruksi (web)

**Files:**
- Create: `web/src/modules/item/components/sticker-instructions-view.tsx`, `sticker-instructions-view.test.tsx`
- Modify: `web/src/modules/item/components/item-detail-view.tsx` (ganti bagian stiker lama), `item-detail-view.test.tsx`, `items-table.tsx`, `items-table.test.tsx`

**Interfaces:**
- Consumes: `ItemDto.stickerPhotos`, `ItemSummaryDto.hasInstructions`.
- Produces: `StickerInstructionsView({ photos, canEdit, editHref }: { photos: readonly ItemStickerPhotoDto[]; canEdit: boolean; editHref: string })`: per foto: catatan foto, gambar dengan penanda bernomor (desktop: nama di samping nomor; HP: hanya nomor; ketuk nomor menyorot baris daftar), lencana BU foto, lalu **daftar di bawah foto selalu tampil**: nomor, gambar contoh tiap stiker hasil terjemahan, nama (alias bila ada), `buCodes` bila lebih dari satu BU, catatan penanda, stiker nonaktif diberi "nonaktif", `unresolved` diberi peringatan "Belum ada stiker {jenis} untuk BU ini". `instructions` kosong = tanda "Belum ada instruksi stiker" (dan tautan ke form bila `canEdit`). `ItemsTable` menampilkan tanda yang sama kecil pada baris `hasInstructions === false`.

- [ ] **Step 1: Tes**: foto dengan tiga penanda menampilkan tiga baris daftar bernomor sama dengan penanda; penanda jenis dengan dua hasil menampilkan dua stiker dalam satu baris nomor; unresolved dan nonaktif; tanda kosong di detail dan di baris tabel; tanpa foto tidak ada kanvas; lebar 375 px (jsdom: kelas responsif/ARIA, bukan piksel) menyembunyikan nama di foto tetapi daftar tetap ada.
- [ ] **Step 2: Jalankan** → GAGAL. **Step 3: Implementasikan.** **Step 4: Jalankan** → hijau.
- [ ] **Step 5: Commit** `feat(web): tampilan instruksi stiker di detail item`.

### Task 11: Filter di halaman daftar item (web)

**Files:**
- Modify: komponen daftar item dan rutenya (`web/src/modules/item/components/items-table.tsx` atau halaman daftar, `web/src/routes/_app/item/index.tsx`: search params), `web/src/modules/item/queries.ts` bila belum lengkap dari Task 7
- Test: tes halaman daftar yang ada

**Interfaces:**
- Consumes: `ItemListFilter` (Task 7), `stickersQuery`/`stickerTypesQuery`.
- Produces: kontrol filter "Instruksi stiker" (Semua / Belum ada), pilihan stiker-atau-jenis (satu `NativeSelect` dikelompokkan per jenis, opsi "Semua" + opsi jenis dan stiker) dan mode (Memakai / Belum memakai), semua tersimpan di search params Router dan diteruskan ke `items.list`. Ini filter halaman, bukan field form (pengecualian aturan LinkField, spek 3b-2 §3).

- [ ] **Step 1: Tes**: memilih opsi memperbarui search params dan memanggil `items.list` dengan `instruction`/`stickerId`/`typeId`/`stickerMode` yang benar; mode tersembunyi saat tidak ada pilihan stiker; membersihkan filter mengembalikan bawaan; pemegang tanpa `sticker: view` tetap dapat memakai filter (katalog dari izin `item: edit` atau daftar kosong yang aman bila `FORBIDDEN`).
- [ ] **Step 2: Jalankan** → GAGAL. **Step 3: Implementasikan.** **Step 4: Jalankan** → hijau.
- [ ] **Step 5: Commit** `feat(web): filter instruksi stiker pada daftar item`.

### Task 12: Halaman Pustaka Gambar: pemakaian dan urut baru (web)

**Files:**
- Modify: `web/src/modules/sticker/components/guide-library-page.tsx`, `web/src/modules/sticker/lib/guide-source.ts`, `web/src/components/file-dialog/*` bila ada label urut/ pemakaian, tesnya

**Interfaces:**
- Consumes: `GuideSort` `'usageDesc'`, `StickerGuideDto.usageCount`.
- Produces: opsi urut "Paling sering dipakai"; kartu pustaka menampilkan "Dipakai n item" bila `usageCount > 0`; tombol hapus pada gambar terpakai tidak tersedia dengan penjelasan (atau galat `CONFLICT` "Gambar masih dipakai" tampil ramah bila tetap dicoba).

- [ ] **Step 1: Tes** (kisi menampilkan jumlah, urut mengirim `sort=usageDesc`, hapus terpakai → pesan). **Step 2: Jalankan** → GAGAL. **Step 3: Implementasikan.** **Step 4: Jalankan** `bun run --cwd web test src/modules/sticker src/components/file-dialog` → hijau.
- [ ] **Step 5: Commit** `feat(web): pemakaian dan urut paling sering dipakai di pustaka gambar`.

### Task 13: Dokumen, seed, dan verifikasi akhir

**Files:**
- Modify: `CLAUDE.md` (bullet stiker 3b-2, perbarui bullet pustaka dan Data Item), spek 3b-2 (status "dibangun"), spek 3a §6 dan spek BU keputusan 23 (catatan selesai), `docs/adding-a-module.md` bila relevan, memori proyek (`project-bu-tahap-1-status.md`)

- [ ] **Step 1:** Perbarui dokumen di atas (apa yang berubah: daftar stiker lama diganti, `items.stickers` ditinggalkan untuk dihapus di rilis berikutnya, aturan jenis→stiker satu sumber).
- [ ] **Step 2:** `bun run check` penuh (tunnel hidup). Tes skrip bash lambat di Windows (`deploy-script.test.ts`, `scripts/ci-workflows.test.ts`) dijalankan sendirian bila gagal karena beban.
- [ ] **Step 3: Verifikasi browser nyata** (server sementara dengan `createFakeBridge` di port lain + Vite `--port 3100`; jangan matikan server dev pengguna): buat item dengan foto pustaka + penanda campuran (stiker tertentu dan jenis), simpan, buka detail (label di foto, daftar di bawah, ketuk menyorot baris), salin penanda dari item lain, filter "Belum ada instruksi" dan filter per stiker/jenis, hapus gambar terpakai ditolak, 375 px, sentuh/papan ketik pada penanda. Laporkan terpisah apa yang tak teruji (unggah ke Drive sungguhan).
- [ ] **Step 4: Commit** `docs: instruksi stiker per item (3b-2)`.
