# Redesain Fase 3: Percontohan Item + Merk — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Item dan Merk sepenuhnya memakai kit (fase 2) dan soft delete (fase 2b): daftar ber-checkbox dengan aksi massal atomik, tautan kolom, View bertab, form bertab yang dipakai halaman dan dialog, Hapus/Pulihkan.

**Architecture:** Server: logika status/hapus/pulihkan per record dipecah menjadi "perencana" yang menghasilkan pernyataan SQL + DTO, dipakai rute tunggal dan rute batch (satu `batch()` untuk semua id). Semua pembaca tabel `items`/`brands` di SEMUA modul menyaring record terhapus (kecuali penampil rujukan) karena sejak fase ini keduanya dapat dihapus. Web: halaman dirakit dari `ListPage`/`DataTable`/`ViewPage`/`FormPage`/`FormDialogShell`.

**Tech Stack:** seperti fase 1-2b.

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§6.5-6.9, §8), `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§4, §5).

## Global Constraints

- Kontrak batch §6.9 + soft delete §4.3: Item/Merk wajib Nonaktif sebelum Hapus; Hapus/Pulihkan = `item: manage` (Item: pada SEMUA BU item); dipulihkan dalam keadaan Nonaktif; satu gagal = tak ada yang berubah; status sama/hapus ulang = bukan galat; maks. `BATCH_MAX` id.
- Item di luar hak BU = `NOT_FOUND` seragam (juga di batch: seluruh permintaan `NOT_FOUND`).
- Pesan konflik keunikan item WAJIB generik (CLAUDE.md BU keputusan).
- Prinsip soft delete §5: rujukan menampilkan nama + "Terhapus"; perhitungan, pilihan, filter, katalog desktop mengabaikan yang terhapus.
- Penjaga merk (`brandKeyGuardStmt`) dan CAS yang ada dipertahankan di jalur batch.
- Tes konkurensi tetap `Promise.all` atas permintaan nyata.
- Field relasi = `LinkField`/`LinkMultiField`; kolom unik/relasi = `LinkCell`; aksi tabel = `ActionButton compact`.
- Wajib hijau: `bun run check` (terowongan DB).

## Review Focus

1. Batch berisi item yang salah satunya masih Aktif → seluruh Hapus ditolak dengan pesan yang menyebut syarat Nonaktif; tak ada yang terhapus. (Task 1)
2. Item terhapus tidak muncul di pemilih item modul lain (Serial `itemOptions`, QR `itemOptions`, Postel `itemOptions`, katalog desktop, filter item). (Task 1)
3. Merk terhapus: item-nya tetap tampil dengan nama merk + "Terhapus", dan merk itu tak ditawarkan di field Merk. (Task 2, 5)
4. Form item bertab: galat di tab "Instruksi Stiker" saat simpan → tab itu aktif dan bertitik merah. (Task 5)
5. Dialog "Tambah merk" dibuka dari form item → menyimpan merk tidak men-submit form item. (Task 5, 6)

## Pembagian kelas beban

Sonnet: Task 1-6. Haiku: Task 7. Berurutan.

---

### Task 1: Server Item — batch status, hapus, pulihkan, penyaringan lintas modul

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `shared/api.test.ts`, `server/src/modules/item/{service,repo,validate,routes}.ts`, pembaca `items` di modul lain (`serial`, `qrcode`, `postel`, `desktop/catalog.ts`, `sticker` instruksi, `notification` bila ada), `server/src/core/soft-delete-pending.ts` (hapus semua entri tabel `items`)
- Test: `server/src/modules/item/soft-delete.test.ts` (Create), `server/src/modules/item/rest.test.ts`, `server/src/http/body.test.ts` (rute JSON baru)

**Interfaces:**
- Consumes: `StatusBatchInput`, `IdBatchInput`, `BatchResult`, `SoftDeleteInfo`, `ListStatusFilter`, `softDeleteStmt`, `restoreStmt`, `requireExistsStmt`, `liveWhere`, `validateIdBatch` (fase 2b).
- Produces:
  - Rute: `items.setStatusBatch` (`POST /items/batch/status`, `StatusBatchInput` → `BatchResult<ItemDto>`), `items.remove` (`DELETE /items/{id}` → `{ id }`), `items.removeBatch` (`POST /items/batch/delete`, `IdBatchInput` → `{ ids }`), `items.restore` (`POST /items/{id}/restore` → `ItemDto`), `items.restoreBatch` (`POST /items/batch/restore` → `BatchResult<ItemDto>`). Rute statis didaftarkan sebelum `/items/{id}`. Izin rute: `item: manage`.
  - `items.list` menerima `status: 'deleted'` (`ListStatusFilter`; hanya bila pemanggil punya `item: manage` pada minimal satu BU, selain itu `FORBIDDEN`); `ItemDto`/`ItemSummaryDto` mendapat `deleted?: SoftDeleteInfo` dan `brandDeleted?: boolean`.
  - Perencana internal `planItemStatus(env, found, status, actor): Promise<{ stmts: DbStatement[]; dto: ItemDto } | { unchanged: ItemDto }>` dipakai `setItemStatus` dan `setItemStatusBatch`; `planItemRemove`/`planItemRestore` serupa. Audit `item.delete` / `item.restore`.
- [ ] **Step 1: Tes gagal** `item/soft-delete.test.ts` + `rest.test.ts`:
  - batch status 3 item → semua berubah, satu audit per item; satu id di luar hak BU → `NOT_FOUND`, tak ada yang berubah; status sudah sama → tanpa audit.
  - hapus item Aktif → `CONFLICT` "Nonaktifkan item dulu sebelum dihapus" (teks persis), batch campuran → tak ada yang terhapus; hapus Nonaktif → hilang dari `items.list` default dan `items.get` (`NOT_FOUND`) bagi non-manage; muncul di `status=deleted` bagi manage; hapus ulang → sukses tanpa audit baru.
  - pulihkan → kembali Nonaktif dan tampil lagi; `items.list status=deleted` oleh `item: view` → `FORBIDDEN`.
  - item terhapus tidak ada di `serials.itemOptions`, `qrcodes.itemOptions`, `postels.itemOptions`, katalog desktop (`getServedCatalog`).
  - konkurensi: `Promise.all([removeBatch(A,B), setStatusBatch(B → active)])` → hasil akhir konsisten (B tak sekaligus terhapus dan aktif).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi + penyaringan semua pembaca `items` (penampil rujukan dikecualikan di `SOFT_DELETE_EXEMPT` dengan alasan). **Step 4:** `bun run --cwd server test src/modules/item src/modules/serial src/modules/qrcode src/modules/postel src/modules/desktop src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): batch status, hapus, dan pulihkan item dengan soft delete`.

### Task 2: Server Merk — batch status, hapus, pulihkan

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/brand/{service,repo,validate,routes}.ts`, pembaca `brands` di modul lain (item JOIN = penampil rujukan + `brandDeleted`), `soft-delete-pending.ts` (entri `brands`)
- Test: `server/src/modules/brand/soft-delete.test.ts` (Create), `brand/rest.test.ts`

**Interfaces:**
- Produces: `brands.setStatusBatch` (`POST /brands/batch/status`), `brands.remove` (`DELETE /brands/{id}`), `brands.removeBatch` (`POST /brands/batch/delete`), `brands.restore` (`POST /brands/{id}/restore`), `brands.restoreBatch` (`POST /brands/batch/restore`); `brands.list` menerima `status?: ListStatusFilter` (`deleted` hanya `item: manage`); `BrandDto.deleted?: SoftDeleteInfo`. Izin: status/hapus/pulihkan `item: manage`.
- [ ] **Step 1: Tes gagal**: hapus merk Aktif → `CONFLICT` "Nonaktifkan merk dulu sebelum dihapus"; hapus Nonaktif yang punya item → sukses, item-nya tetap ada dan `ItemDto.brand` = nama merk, `brandDeleted` true; merk terhapus tak muncul di `brands.list` default dan tak dapat dipakai `items.save` (`VALIDATION` "Merk tidak ditemukan" seperti merk tak dikenal); pulihkan → Nonaktif; batch status dua merk + satu id asing → `NOT_FOUND`, tak ada yang berubah; ganti nama merk bersamaan dengan hapus (`Promise.all`) → konsisten.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(server): batch status, hapus, dan pulihkan merk`.

### Task 3: Web daftar Item di kit

**Files:**
- Modify: `web/src/routes/_app/item/index.tsx`, `web/src/modules/item/components/items-table.tsx`, `item-filters.tsx`, `web/src/modules/item/queries.ts`, `web/src/modules/item/lib/list-filter.ts`, `web/src/lib/link-access.ts`
- Test: `items-table.test.tsx`, `item-filters.test.tsx`, `queries.test.tsx`, route test bila ada

**Interfaces:**
- Consumes: `ListPage`, `FilterBar`, `FilterChip`, `DataTable`, `LinkCell`, `BulkBar`, `useRowSelection`, `ActionButton`, `ConfirmDeleteDialog`, `DeletedBadge`, `statusFilterOptions`.
- Produces: mutasi `useSetItemStatusBatch`, `useRemoveItems`, `useRestoreItems` (memasang hasil ke cache lewat `upsertInList`/`removeFromList`, toast "N item dinonaktifkan" dst.).
- Kolom: [checkbox] [Aksi: Ubah, Aktifkan/Nonaktifkan, Hapus (hanya Nonaktif); di tampilan Terhapus: Pulihkan] [Merk: `LinkCell` ke `/item/brands/$brandId` bila `brandLinkAccess` membolehkan + `DeletedBadge` bila `brandDeleted`] [Tipe: `LinkCell` ke `/item/$itemId` + catatan Manual Book/Postel/instruksi yang ada] [BU: `LinkCell` per BU ke `/access/business-units/$id` bila berhak, selain itu kode] [Lock] [Gambar] [Status badge]. Tanpa tombol "Lihat". Filter: cari + chip Status (`statusFilterOptions(canManage)`), Merk, BU, Manual Book, Postel, Instruksi, Stiker/Jenis (yang ada di `ItemFilters`, kini sebagai `FilterChip`). Aksi bar judul: "Kelola merk" dihapus (Merk di sidebar), `ActionButton action="create" label="Tambah item"`. Bar massal: Aktifkan, Nonaktifkan, Hapus (tampilan biasa) / Pulihkan (tampilan Terhapus); hanya bila `canManage` untuk SEMUA item terpilih.
- [ ] **Step 1: Tes gagal**: tautan "Asus" ke `/item/brands/b1` dan "RT-AX55" ke `/item/i1`; tak ada tombol "Lihat"; tombol "Ubah Asus RT-AX55" adalah ikon dengan nama tersebut; pilih dua baris → "2 dipilih" + Nonaktifkan memanggil `items.setStatusBatch` dengan dua id; Hapus membuka `ConfirmDeleteDialog` "Hapus 2 item?"; ubah filter → pilihan kosong; tanpa `item: manage` tak ada checkbox maupun opsi "Terhapus".
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/item src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): daftar Item di kit dengan aksi massal dan tautan kolom`.

### Task 4: Web View Item

**Files:**
- Modify: `web/src/routes/_app/item/$itemId/index.tsx`, `web/src/modules/item/components/item-detail-view.tsx`
- Test: `item-detail-view.test.tsx`

**Interfaces:**
- Consumes: `ViewPage`, `ViewSection`, `DetailList`, `DeletedBanner`, `ActionButton`, mutasi Task 3 (versi tunggal `useSetItemStatus`, `useRemoveItems`, `useRestoreItems`).
- `ViewPage` judul `"{merk} {tipe}"`, badge status; aksi: Ubah, Aktifkan/Nonaktifkan, Hapus (Nonaktif saja), dan saat terhapus hanya Pulihkan (+ `DeletedBanner`). Tab: Detail (Identitas: Merk tautan, Tipe, BU tautan, Nama lain, Country lock + Firmware, Wajib foto; Aksesoris; Detail & spesifikasi Markdown), Gambar, Instruksi Stiker, Manual Book & Postel (isi yang hari ini ada di detail; Postel hanya `sticker: view`). Tab aktif di search param `tab`. Aside: dibuat/diubah oleh + kapan (dari DTO bila ada), tautan "Lihat Serial Number item ini" ke `/serial` dengan filter item (bila `serial: view`).
- [ ] **Step 1: Tes gagal**: judul + badge; tab berpindah dan `tab` di URL; "Merk" berupa tautan; item terhapus menampilkan banner dan hanya tombol Pulihkan (bagi manage).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): View Item bertab`.

### Task 5: Web form Item bertab (halaman + dialog)

**Files:**
- Modify: `web/src/modules/item/components/item-form.tsx` (menjadi field saja: `<form id={formId}>`, tanpa `FormHeader`), `web/src/routes/_app/item/new.tsx`, `web/src/routes/_app/item/$itemId/edit.tsx`
- Create: `web/src/modules/item/components/item-form-page.tsx`, `item-form-dialog.tsx`
- Test: `item-form.test.tsx` (+ tes baru dialog)

**Interfaces:**
- Consumes: `FormPage`, `FormDialogShell`, `FormTabs`, `firstTabWithError`, `FormSection`.
- Produces: `ITEM_FORM_ID = 'item-form'`; `ItemForm` props tetap kecuali `title` dan pemicu tombol dipindah ke pembungkus, ditambah `formId: string`, `tabs` terkendali lewat `activeTab`/`onActiveTabChange` dan `onTabErrorsChange(errors: Record<ItemFormTab, boolean>)`; `type ItemFormTab = 'detail' | 'gambar' | 'instruksi' | 'spesifikasi'` (Detail = Informasi dasar + Kelengkapan aksesoris; Gambar = Gambar lampiran; Instruksi = Instruksi stiker; Spesifikasi = Detail dan spesifikasi). `ItemFormPage({ mode: 'create' | 'edit', … })` dipakai rute; `ItemFormDialog({ open, onOpenChange, onCreated(item) })` membuat item dari dialog (dipakai kelak oleh LinkField "Tambah item" modul lain; formId `item-form-dialog`).
- Field wajib bertanda (sudah di fase 1); "Tambah merk" dari field Merk memakai `BrandFormDialog` (Task 6) yang dirender di luar `<form>`.
- [ ] **Step 1: Tes gagal**: empat tab berlabel; simpan dengan Tipe kosong → tab Detail aktif bertitik; galat instruksi dari server (`fieldErrors` pada `stickerPhotos`) → tab Instruksi bertitik dan aktif; `ItemFormDialog` menyimpan → `onCreated` dipanggil; Simpan di dialog Tambah merk tidak men-submit form item.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/item src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): form Item bertab untuk halaman dan dialog`.

### Task 6: Web Merk (daftar, View, form dialog)

**Files:**
- Modify: `web/src/modules/brand/components/brands-manager.tsx`, `brand-detail-view.tsx`, `brand-form-dialog.tsx`, `web/src/modules/brand/queries.ts`, `web/src/routes/_app/item/brands/index.tsx`, `web/src/routes/_app/item/brands/$brandId.tsx`
- Test: tes ketiga komponen

**Interfaces:**
- Produces: `BrandForm` (field saja, `formId`), `BrandFormDialog` = `FormDialogShell` + `BrandForm` (props publik tetap agar `ItemForm` tak berubah); mutasi `useSetBrandStatusBatch`, `useRemoveBrands`, `useRestoreBrands`.
- Daftar: `ListPage` + `DataTable` [checkbox][Aksi: Ubah (dialog), Aktifkan/Nonaktifkan, Hapus/Pulihkan][Merk `LinkCell` ke View][BU bawaan `LinkCell`][Item (jumlah; tautan ke `/item?brandId=…`)][Status]; filter cari + Status. View: `ViewPage` (Identitas: nama, BU bawaan tautan, jumlah item tautan; aksi Ubah = dialog, status, Hapus/Pulihkan, `DeletedBanner`).
- [ ] **Step 1: Tes gagal**: nama merk menaut ke `/item/brands/b1`; bar massal Nonaktifkan memanggil `brands.setStatusBatch`; View merk terhapus menampilkan banner; `BrandFormDialog` tetap bekerja dari `ItemForm`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): Merk di kit dengan aksi massal, View, dan form dialog`.

### Task 7 (Haiku): Dokumentasi, changelog, verifikasi

**Files:**
- Modify: `CLAUDE.md` (bullet Item/Merk: rute batch + hapus/pulihkan, `brandDeleted`), Create `server/changelog.d/20261120-item-merk-hapus-massal.md` (`jenis: ditambah`; paragraf: pilih banyak item/merk untuk diaktifkan, dinonaktifkan, dihapus, dan dipulihkan; tampilan Terhapus)
- [ ] **Step 1:** Tulis. **Step 2:** `bun run check` → hijau (catat). **Step 3:** Commit `docs: Item dan Merk di kit + soft delete`.
