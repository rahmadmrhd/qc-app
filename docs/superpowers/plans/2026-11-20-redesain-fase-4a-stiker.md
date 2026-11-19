# Redesain Fase 4a: Stiker — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Modul Stiker (Katalog, Jenis, Stok, Pustaka Gambar, Konfigurasi) memakai kit CRUD, punya View Stiker dan View Jenis, aksi massal atomik, dan soft delete Stiker/Jenis; Pustaka Gambar tetap hapus permanen dengan Hapus massal.

**Architecture:** Mengikuti pola fase 3 (perencana per record dipakai rute tunggal dan batch dalam satu `batch()`; semua pembaca `stickers`/`sticker_types` menyaring record terhapus kecuali penampil rujukan). Pustaka: `removeBatch` permanen di atas `removeGuide` yang ada. Web: halaman dirakit dari `ListPage`/`DataTable`/`GridView`/`ViewPage`/`FormDialogShell`/`FormTabs`.

**Tech Stack:** seperti fase 1-3.

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§5 keputusan 13-16, §6.5-6.9, §8), `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§2 butir 6-8, §4.3, §5). Inventaris pendukung: `.superpowers/sdd/fase-4-inventaris.md` bagian 0 dan 4a.

## Global Constraints

- Stiker dan Jenis: Hapus/Pulihkan = `sticker: manage`; syarat hapus Stiker = bukan Aktif (`inactive` atau `deprecated`, keputusan 15); syarat hapus Jenis = Nonaktif; dipulihkan sebagai `inactive`; satu gagal = tak ada yang berubah; maks. `BATCH_MAX`.
- Jenis sistem (`system_kind` terisi) tak dapat dinonaktifkan/dihapus; stiker milik jenis sistem tak punya Hapus sendiri (mengikuti Desain QR/Postel). Batch yang memuat salah satunya ditolak SELURUHNYA dengan pesan generik.
- Batch status stiker hanya `active|inactive`; `deprecated → active` ditolak (aturan yang ada), `deprecated → inactive` diterima.
- Pustaka Gambar: HAPUS PERMANEN, tanpa Pulihkan, tanpa tampilan Terhapus (keputusan 16); ditolak bila dipakai penempatan item HIDUP (`GUIDE_IN_USE_MESSAGE`). Pemakaian oleh item TERHAPUS diabaikan: penempatan (`item_sticker_photos` + `item_sticker_marks`) milik item terhapus yang merujuk gambar itu ikut dihapus permanen dalam transaksi yang sama (keputusan pemilik soft delete 14; item itu kehilangan penempatan tersebut bila kelak dipulihkan). Batch = semua atau tidak sama sekali per permintaan; izin per gambar sama dengan rute tunggal (pengunggah atau `item: manage`). Gambar Pustaka dikecualikan dari "setiap model punya View" (keputusan pemilik 23): pratinjau + daftar pemakai tetap di dialog.
- Stok hanya-tambah, tidak punya Hapus/checkbox; stiker/jenis terhapus tak tampil di Stok, digest, menipis, katalog desktop, `stickersForType`, opsi stiker Serial.
- Semua model punya View kecuali gambar Pustaka (keputusan 1 dan 23): `stickerLinkAccess`/`stickerTypeLinkAccess` kini memberi `openHref` bila pengguna dapat membaca katalog.
- Kolom unik/relasi = `LinkCell`; aksi tabel = `ActionButton compact`; field relasi = `LinkField`/`LinkMultiField`; teks UI santai (memori `feedback-bahasa-ui-santai`).
- Target `data-tour` yang ada dipertahankan (tes katalog panduan).
- Rujukan tersimpan dipertahankan (T1): `items.save` menerima penempatan ke stiker/jenis yang TIDAK berubah walau terhapus; penempatan baru harus ke stiker hidup. Stiker terhapus ditolak di Cek ulang Serial (`recheck` `stickerIds`) seperti `inactive` (T9). Hapus ulang = sukses tanpa audit (T2); `deleted_at` ISO UTC, `deleted_by` email, tes dua record berkunci sama menggeser jam (T10); hitungan pemakaian di dialog konfirmasi = record hidup (T6).
- Aksi massal dikirim bertahap lewat `runChunkedBatch` (keputusan pemilik 19); luring = toast galat (T21); aksi baris di ponsel = menu "⋯" (keputusan pemilik 22; tes berpatokan lebar ≥ 768 px); setelah Hapus dari View: navigasi ke indeks induk + toast "Dihapus" (+ "Pulihkan" bagi pemegang izin; T22).
- Wajib hijau: `bun run check`.

## Review Focus

1. Batch Hapus stiker berisi satu stiker Aktif atau satu stiker Manual Book → seluruh batch ditolak; tak ada yang terhapus. (Task 1)
2. Stiker terhapus tidak muncul di Stok, opsi stiker Cek ulang Serial, instruksi stiker item (pilihan baru), katalog desktop, dan ringkasan surel; penempatan lama di item tetap menampilkan namanya + "Terhapus". (Task 1)
3. Memulihkan jenis "Postel" buatan orang setelah jenis sistem Postel dibuat tidak membuat dua jenis hidup bertabrakan `kind_key`. (Task 1)
4. Hapus massal Pustaka berisi satu gambar yang dipakai item HIDUP → tak ada gambar terhapus dan berkas Drive tak dibuang; gambar yang hanya dipakai item terhapus → terhapus bersama penempatan item terhapus itu. (Task 2)
5. Pengaturan Stiker: berpindah tab dengan perubahan belum disimpan tidak membuang isian; Simpan di tab Postel tidak mengirim form ringkasan stok. (Task 5)
6. Cek ulang Serial dengan `stickerIds` berisi stiker terhapus → ditolak seperti stiker `inactive`. (Task 1)

## Pembagian kelas beban

Sonnet: Task 1-5. Haiku: Task 6. Berurutan.

---

### Task 1: Server Stiker + Jenis — get, batch status, hapus, pulihkan, penyaringan

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/sticker/{service,repo,validate,routes,stock-repo,digest,instruction-repo,instruction-service,manual-book}.ts`, `server/src/modules/sticker/postel.ts` (adopsi jenis), pembaca di `desktop/catalog.ts`, `serial/applicable.ts`, `item/{repo,service}.ts`, `qrcode/{items,service}.ts`, `postel/stickers.ts`, `server/src/core/soft-delete-pending.ts` (hapus entri `stickers`, `sticker_types`)
- Test: `server/src/modules/sticker/soft-delete.test.ts` (Create), `sticker/rest.test.ts`, `server/src/http/body.test.ts`

**Interfaces:**
- Consumes: fase 2b (`StatusBatchInput`, `IdBatchInput`, `BatchResult`, `SoftDeleteInfo`, `ListStatusFilter`, `softDeleteStmt`, `restoreStmt`, `liveWhere`, `validateIdBatch`, `mapLiveDuplicate`).
- Produces:
  - `stickers.get` (`GET /stickers/{id}` → `StickerDto`, izin `CATALOG_READ_PERMISSION`, terhapus hanya bagi `sticker: manage`), `stickers.setStatusBatch` (`POST /stickers/batch/status`), `stickers.remove` (`DELETE /stickers/{id}`), `stickers.removeBatch` (`POST /stickers/batch/delete`), `stickers.restore` (`POST /stickers/{id}/restore`), `stickers.restoreBatch` (`POST /stickers/batch/restore`); padanan `stickerTypes.*` dengan jalur `/sticker-types/...`. Rute statis sebelum `/{id}`.
  - `stickers.list` dan `stickerTypes.list` menerima `status?: ListStatusFilter` (`deleted` hanya `sticker: manage`); DTO mendapat `deleted?: SoftDeleteInfo`; `StickerDto.typeDeleted?: boolean`.
  - Perencana `planStickerStatus`, `planStickerRemove`, `planStickerRestore`, `planStickerTypeStatus`, `planStickerTypeRemove`, `planStickerTypeRestore` (pola fase 3 `planItemStatus`), audit `sticker.delete|restore`, `stickerType.delete|restore`.
  - Pesan persis: "Nonaktifkan stiker dulu sebelum dihapus", "Nonaktifkan jenis stiker dulu sebelum dihapus", "Stiker Manual Book dan Postel mengikuti konfigurasinya, jadi tidak bisa dihapus di sini", "Jenis stiker sistem tidak bisa diubah statusnya atau dihapus".
- [ ] **Step 1: Tes gagal** (`soft-delete.test.ts`, `rest.test.ts`):
  - batch status tiga stiker → semua berubah + audit per stiker; satu `deprecated → active` → seluruh batch `CONFLICT`, tak ada yang berubah; status sama → tanpa audit.
  - hapus stiker Aktif → `CONFLICT` pesan persis; hapus `deprecated` langsung → sukses; batch berisi stiker jenis `manual_book` → seluruh batch ditolak; hapus ulang → sukses tanpa audit; pulihkan → `inactive`.
  - stiker terhapus: tak ada di `stickers.list` default, `stickerStock.list`, `serials.stickerOptions` (cek ulang), `stickersForType`/`hasInstructions`, `getServedCatalog`, ringkasan `checkStickerDigest`; `items.get` dengan penempatan ke stiker itu tetap mengembalikan namanya + `deleted`.
  - jenis: sistem → ditolak (status dan hapus); jenis Aktif → `CONFLICT`; jenis Nonaktif berstiker → terhapus, stiker tetap ada dengan `typeDeleted: true`; `stickerTypes.get` jenis terhapus oleh `sticker: view` → `NOT_FOUND`.
  - adopsi Postel: jenis bernama "Postel" yang terhapus tidak diadopsi `ensurePostelType`.
  - rujukan tersimpan (T1): `items.save` pada item dengan penempatan ke stiker terhapus, tanpa mengubah penempatan itu, sukses; menempatkan ke stiker terhapus yang baru → `VALIDATION`.
  - Cek ulang (T9): `serials.act` `recheck` dengan `stickerIds` berisi stiker terhapus → ditolak seperti stiker `inactive`.
  - hapus ulang stiker terhapus → sukses tanpa audit; dua stiker berkunci sama dihapus dengan jam digeser (`env.clock`) tidak bentrok.
  - konkurensi: `Promise.all([stickers.removeBatch([A]), stickers.setStatusBatch([A] → active)])` → A tidak sekaligus terhapus dan aktif.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi; penyaringan semua pembaca (penampil rujukan masuk `SOFT_DELETE_EXEMPT` beralasan). **Step 4:** `bun run --cwd server test src/modules/sticker src/modules/item src/modules/serial src/modules/qrcode src/modules/postel src/modules/desktop src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): View, batch status, hapus, dan pulihkan stiker dan jenis stiker`.

### Task 2: Server Pustaka — hapus massal permanen

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/sticker/guide-{service,validate,routes}.ts`
- Test: `server/src/modules/sticker/guide-batch.test.ts` (Create)

**Interfaces:**
- Produces: `stickerGuides.removeBatch` (`POST /sticker-guides/batch/delete`, `IdBatchInput` → `{ ids: string[] }`, izin rute `item: edit` + penjaga `canManageGuide` per gambar). Satu transaksi: kunci semua baris (urut id), tolak seluruhnya bila ada yang dipakai penempatan item HIDUP (`GUIDE_IN_USE_MESSAGE`, generik) atau ada yang tak boleh dikelola pemanggil (`NOT_FOUND` seragam), lalu hapus permanen penempatan milik item TERHAPUS yang merujuk gambar itu (`item_sticker_marks` lalu `item_sticker_photos`, FK RESTRICT; keputusan pemilik soft delete 14) dan `markGuideFilePendingDeleteStmt` + `deleteGuideStmt` per gambar; `purgePendingFiles` SETELAH commit. `removeGuide` tunggal memakai perencana yang sama. `guideUsageCountSql` dan `stickerGuides.usages` hanya menghitung/menampilkan item hidup.
- [ ] **Step 1: Tes gagal**: dua gambar tak terpakai → keduanya hilang, berkas `pending_delete` lalu dibuang; satu dipakai item HIDUP → tak ada yang hilang dan tak ada `purge`; gambar yang hanya dipakai item TERHAPUS → terhapus dan penempatan item terhapus itu ikut hilang permanen (item yang dipulihkan kemudian tak punya penempatan itu), sedangkan `usages` dan hitungan pemakaian tak menghitung item terhapus; gambar unggahan orang lain oleh non-manage → `NOT_FOUND`, tak ada yang hilang; id ganda → `VALIDATION`; 101 id → `VALIDATION`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/sticker` → PASS.
- [ ] **Step 5:** Commit `feat(server): hapus massal gambar pustaka stiker`.

### Task 3: Web Katalog Stiker — daftar, View, form dialog

**Files:**
- Modify: `web/src/routes/_app/sticker/index.tsx`, `web/src/modules/sticker/components/{stickers-page,sticker-form-dialog}.tsx`, `web/src/modules/sticker/queries.ts`, `web/src/lib/link-access.ts`
- Create: `web/src/routes/_app/sticker/$stickerId.tsx`, `web/src/modules/sticker/components/{sticker-form,sticker-view}.tsx`
- Test: tes komponen yang ada + `sticker-view.test.tsx`

**Interfaces:**
- Consumes: kit fase 2 (`ListPage`, `FilterBar`, `FilterChip`, `DataTable`, `LinkCell`, `BulkBar`, `useRowSelection`, `ViewPage`, `ViewSection`, `DetailList`, `FormDialogShell`), fase 2b (`DeletedBadge`, `DeletedBanner`, `ConfirmDeleteDialog`, `statusFilterOptions`), `ActionButton`.
- Produces: `StickerForm` (field saja, `formId`), `StickerFormDialog` (props publik tetap); mutasi `useSetStickerStatusBatch`, `useRemoveStickers`, `useRestoreStickers` (cache lewat `upsertInList`/`removeFromList`; bertahap lewat `runChunkedBatch`, keputusan pemilik 19); `stickerViewQueryOptions(id)` (data awal dari cache daftar, lalu `stickers.get`).
- Daftar: [checkbox, hanya `sticker: manage`][Aksi: Ubah (dialog), Aktifkan/Nonaktifkan, Hapus (bukan Aktif, bukan jenis sistem) / Pulihkan di tampilan Terhapus][Stiker `LinkCell` → `/sticker/$stickerId` + badge Menipis][Jenis `LinkCell` → `/sticker/types/$typeId` + `DeletedBadge` bila `typeDeleted`][BU `LinkCell` per BU][Batas minimum][Status badge]. Filter: cari teks (nama/alias), chip Jenis (`LinkField`), chip Status (`statusFilterOptions(canManage)` + opsi "Usang"). Teks deskripsi "tak dihapus, hanya dinonaktifkan" diganti.
- View (lebar `default`; `ViewMeta` tanpa angka hitungan, "Dibuat" hanya bila DTO punya `createdBy`, T12): judul alias/nama, badge status; aksi Ubah (dialog), status, Hapus/Pulihkan; `DeletedBanner`. Isi: Identitas (Jenis tautan, nama asli, alias, BU tautan, batas minimum, gambar), "Asal" untuk stiker sistem (tautan ke Desain QR `/qrcode/$id` atau Postel `/postel/$id` bila datanya ada di DTO), tautan "Lihat stok" ke `/sticker/stock`.
- [ ] **Step 1: Tes gagal**: nama stiker menaut ke View; tak ada tombol "Lihat"; pilih dua → `stickers.setStatusBatch` dua id; tombol Hapus tak tampil untuk stiker Aktif dan stiker Manual Book; View stiker terhapus menampilkan banner + hanya Pulihkan; Hapus dari View → navigasi ke `/sticker` + toast "Dihapus" (T22); `LinkField` Jenis di form menampilkan "Buka" ke View jenis.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/sticker src/lib src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Katalog Stiker di kit dengan View dan aksi massal`.

### Task 4: Web Jenis Stiker dan Stok

**Files:**
- Modify: `web/src/routes/_app/sticker/types.tsx`, `web/src/routes/_app/sticker/stock.tsx`, `web/src/modules/sticker/components/{sticker-types-page,sticker-type-form-dialog,stock-page}.tsx`, `web/src/modules/sticker/queries.ts`
- Create: `web/src/routes/_app/sticker/types/$typeId.tsx` (pindahkan `types.tsx` ke `types/index.tsx` bila perlu oleh router), `web/src/modules/sticker/components/{sticker-type-form,sticker-type-view}.tsx`
- Test: tes komponen terkait + `sticker-type-view.test.tsx`

**Interfaces:**
- Jenis daftar: [checkbox][Aksi: Ubah, status, Hapus/Pulihkan; jenis sistem tanpa ketiganya][Jenis `LinkCell` → View + badge "Sistem"][Aturan][Stiker (jumlah; tautan ke `/sticker?typeId=…`)][Status]; filter cari + Status. View jenis: aturan, minimum bawaan, daftar stiker jenis itu (dari cache `stickers.list`, tiap nama `LinkCell`).
- Stok: `ListPage` + `DataTable` TANPA checkbox; Aksi kiri `ActionButton compact`: Catat masuk (`upload`→ikon masuk, `stickerstock: edit`), Catat keluar, Koreksi (`manage`), Riwayat; Stiker `LinkCell` → View stiker; filter cari + chip Jenis; tombol judul "Stok opname" (`manage`). Lokasi tetap dari pemilih header.
- [ ] **Step 1: Tes gagal**: View jenis menampilkan stiker jenis itu bertaut; jenis sistem tanpa checkbox maupun aksi; tabel Stok tak punya checkbox dan tombol "Riwayat" berikon + `aria-label` "Riwayat <nama>"; filter cari menyaring baris stok.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): Jenis Stiker dan Stok di kit`.

### Task 5: Web Pustaka (pilih + hapus massal) dan Konfigurasi Stiker bertab

**Files:**
- Modify: `web/src/components/file-dialog/library-tab.tsx` (hanya bila perlu; `GridView` + `selection` sudah dibangun di fase 2), `web/src/modules/sticker/components/guide-library-page.tsx`, `web/src/modules/sticker/lib/guide-source.ts`, `web/src/modules/sticker/components/{sticker-settings-page,postel-alert-settings}.tsx`, `web/src/routes/_app/sticker/settings.tsx`
- Test: `guide-library-page.test.tsx`, `sticker-settings-page.test.tsx`

**Interfaces:**
- Consumes: `GridView` dengan prop opsional `selection?: RowSelection` (dibangun di fase 2 Task 5, T16; bukan di sini) → checkbox di pojok kartu dengan `aria-label` "Pilih <label>"; tanpa `selection` perilaku tak berubah (dialog berkas tetap tanpa checkbox). Produces: mutasi `useRemoveGuides` (`stickerGuides.removeBatch`, bertahap lewat `runChunkedBatch`; tiap tahap menolak seluruhnya bila ada gambar yang dipakai item hidup). Halaman Pustaka: `BulkBar` dengan Hapus (`ConfirmDeleteDialog` "Hapus N gambar? Gambar dihapus permanen.") hanya bila pemanggil boleh mengelola SEMUA gambar terpilih.
- Konfigurasi: `FormPage` dengan `FormTabs` tiga tab — "Minimum stok", "Ringkasan stok" (keduanya satu form `STICKER_ALERT`, `formId` `sticker-settings`), "Peringatan Postel" (form `POSTEL_ALERT` sendiri, `formId` `postel-alert-settings`); tombol Simpan header memakai `formId` tab aktif; isian tiap form dipertahankan saat berpindah tab (`forceMount`). Jenis terhapus tak tampil di "Minimum stok".
- [ ] **Step 1: Tes gagal**: Pustaka memakai `GridView` `selection` (tes `GridView` ada di fase 2): pilih dua → Hapus memanggil `stickerGuides.removeBatch`; pilih 250 → dikirim 100/100/50, tahap gagal menghentikan sisanya; galat "masih dipakai" → toast galat, pilihan tetap; Konfigurasi: ubah nilai di tab Minimum, pindah ke tab Postel lalu kembali → nilai tetap; Simpan di tab Postel hanya memanggil `postelSettings.save`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/components src/modules/sticker src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): hapus massal Pustaka dan Konfigurasi Stiker bertab`.

### Task 6 (Haiku): Dokumentasi, panduan, changelog, verifikasi

**Files:**
- Modify: `CLAUDE.md` (bullet Stiker 3a/3b-1/4a: rute `get`/batch/hapus/pulihkan, `typeDeleted`, aturan hapus; koreksi "jumlah global maks. 2000 dijaga lewat baris `counters`" menjadi `COUNT(*)` atas `sticker_guide_images` (temuan inventaris); Pustaka tetap hapus permanen + `removeBatch`; `stickerLinkAccess`/`stickerTypeLinkAccess` kini dengan Buka); "Aturan frontend" butir field relasi: ganti kalimat "model tanpa halaman lihat ... tidak punya Buka dan tidak membuat rute baru" dengan aturan baru "setiap model punya View (kecuali gambar Pustaka, keputusan pemilik 23); Buka tersedia bila pengguna dapat membaca model itu; baris Tambah di `LinkField` untuk SEMUA model yang dapat dibuat di UI (Item lewat Form Dialog, Role, Lokasi, Preset QR; keputusan pemilik 18); `LocationField` tetap tanpa Tambah/Buka" (keputusan pemilik 2026-11-20, spek redesain §5 butir 1, 18, dan 23; catatan pengganti di spek BU keputusan 24 sudah ditulis 2026-11-20); bullet "Pustaka gambar stiker (3b-1)": ganti "apa pun status itemnya" pada `guideUsageCountSql` (pemakaian oleh item terhapus diabaikan dan penempatan item terhapus ikut dihapus permanen saat gambar dihapus; keputusan pemilik soft delete 14), `web/src/modules/guide/catalog/*` hanya bila target/teks berubah (kosmetik, tanpa menaikkan versi); SUNTING (bukan hanya menambah) pernyataan CLAUDE.md lain yang bertentangan dan periksa `docs/e2e-checklist*.md` (T23)
- Create: `server/changelog.d/20261120-stiker-kit-hapus.md` (`jenis: ditambah`; paragraf: halaman detail stiker dan jenis, pilih banyak untuk diaktifkan/dinonaktifkan/dihapus/dipulihkan, hapus banyak gambar pustaka sekaligus, pengaturan stiker per tab)
- [ ] **Step 1:** Tulis. **Step 2:** `bun run check` → hijau (catat ringkasannya). **Step 3:** Commit `docs: Stiker di kit + soft delete`.
