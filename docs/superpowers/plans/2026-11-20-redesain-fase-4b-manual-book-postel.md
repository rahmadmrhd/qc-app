# Redesain Fase 4b: Manual Book (QR Code, Default QR) + Postel — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Desain QR, Preset QR, dan Postel memakai kit CRUD dengan View, form bertab, Hapus/Pulihkan soft delete (tunggal dan massal), dan daftar ber-checkbox.

**Architecture:** Hapus keras hari ini (`removeQrDesign`, `deleteQrPreset`, `removePostel`) diganti soft delete lewat perencana per record yang dipakai rute tunggal dan batch dalam satu `batch()`. Efek samping luar basis data (trash Drive, cabut berbagi, buang lampiran, kosongkan rujukan item, hapus nomor) DIHAPUS dari jalur hapus (daftar lengkap: soft delete §4.3; tes lama yang menegaskan perilaku itu diubah, T24); stiker milik record yang dihapus menjadi `deprecated`/`inactive` seperti sekarang. Pembaca `qr_designs`/`qr_presets`/`postels`/`postel_numbers` menyaring record terhapus kecuali penampil rujukan.

**Tech Stack:** seperti fase 1-4a.

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§6.5-6.9, §8 butir 1, 7, 8, 9), `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§4.3, §5 butir 1, 2, 6, 7, 9, 10). Inventaris: `.superpowers/sdd/fase-4-inventaris.md` bagian 4b.

## Global Constraints

- Desain QR dan Preset: Hapus/Pulihkan = `qrcode: manage`. Postel: Hapus/Pulihkan = `sticker: edit` (aturan hapus yang ada dipertahankan; keputusan pemilik 2026-11-20, soft delete §2 butir 15a). Tanpa syarat status.
- Hapus tidak mengubah `items.manual_book_design_id`/`items.postel_id`, tidak membuang/mencabut berkas Drive, tidak menghapus nomor Postel; stiker Manual Book/Postel milik record terhapus menjadi `deprecated` (stok > 0) atau `inactive`. Pulihkan MEMULIHKAN stikernya: stiker versi terbaru milik record itu yang menjadi `deprecated`/`inactive` karena penghapusan kembali `inactive` (dapat diaktifkan lagi; keputusan pemilik soft delete 13); stiker versi lama yang `deprecated` karena versi baru tidak berubah.
- Desain QR yang sudah punya versi Manual Book boleh dihapus (penolakan `hasStickerMessage` dicabut).
- Item yang rujukannya terhapus dihitung "Belum ada QR Manual Book"/"Belum ada Postel" dan boleh dipasang ke record lain; saat dipulihkan hanya item yang masih menunjuk ke record itu yang kembali terhubung.
- Pulihkan ditolak (pesan generik) bila bentrok dengan record hidup: nama Manual Book (`assertManualBookNameFree`), BU preset (`qr_presets_bu_unique_live`), nomor sertifikat Postel (`postel_numbers_key_live`). Postel BARU bernama sama ditolak selama Postel lama masih di Terhapus (nama stiker lama memegang `stickers_type_name_unique`); pesan menyarankan memulihkan yang lama bagi pemegang izin Pulihkan dan tetap generik bagi yang lain (keputusan pemilik soft delete 13). Pulihkan memanggil penjaga keunikan aplikasi yang sama dengan simpan (T4).
- Kontrak batch §6.9 (atomik per permintaan, `BATCH_MAX`, `NOT_FOUND` hanya untuk id tak dikenal/di luar hak, hapus ulang = sukses tanpa audit; T2).
- Aksi massal dikirim bertahap lewat `runChunkedBatch` (keputusan pemilik 19); luring = toast galat (T21); aksi baris di ponsel = menu "⋯" (keputusan pemilik 22; tes berpatokan lebar ≥ 768 px); setelah Hapus dari View: navigasi ke indeks induk + toast "Dihapus" (+ "Pulihkan" bagi pemegang izin; T22). `deleted_at` ISO UTC, `deleted_by` email (T10).
- Pengecualian kerangka bernama (T18): Pustaka logo di halaman Default QR (bukan `DataTable`/`GridView`); tombol "Konfigurasi default" di halaman QR dipertahankan sebagai pintasan ke menu Default QR.
- Target `data-tour` QR (13) dan Postel dipertahankan; tur yang menyorot isi tab lain membuka tabnya lewat `langkah.buka { tab }` (murni UI; mesin tur memeriksa keterlihatan target; `scroll-margin-top` = header + bar headroom). `ListPage`/`FormPage`/`LinkCell` meneruskan `data-tour` (target `qr-header`, `qr-new`, tombol simpan `FormPage`); `halamanKecuali` panduan QR diperluas untuk rute View baru (`/qrcode/$id`, `/qrcode/default*`) agar banner panduan tidak salah muncul (T13).
- Wajib hijau: `bun run check`.

## Review Focus

1. Ekspor QR yang sedang berjalan saat desainnya dihapus: langkah komit job tidak membuat stiker/versi baru untuk desain terhapus, job berakhir gagal dengan pesan "Konfigurasi sudah dihapus". (Task 1)
2. Desain QR terhapus lalu item-nya dipasang ke desain lain; desain lama dipulihkan → item tetap di desain baru, desain lama tanpa item. (Task 1)
3. Postel terhapus: nomornya dapat dipakai Postel baru; surel peringatan kedaluwarsa tidak menyebut Postel terhapus; memulihkan Postel lama saat nomornya sudah dipakai → ditolak; Postel baru bernama sama dengan Postel yang masih di Terhapus → ditolak (pesan menyarankan memulihkan yang lama bagi pemegang izin Pulihkan). (Task 2)
4. Tur `qrcode-buat` tetap menyorot setiap target dari awal sampai akhir walau target berada di tab berbeda. (Task 3)
5. Lampiran Postel terhapus masih dapat diunduh dari View oleh pemegang `sticker: edit`, tetapi `postelFiles.get` oleh `sticker: view` saja → `NOT_FOUND`. (Task 2)
6. Memulihkan Desain QR/Postel → stiker versi terbarunya yang `deprecated`/`inactive` karena penghapusan kembali `inactive` (bukan `active`); stiker versi lama yang `deprecated` karena versi baru tetap `deprecated`. (Task 1, 2)

## Pembagian kelas beban

Sonnet: Task 1-5. Haiku: Task 6. Berurutan.

---

### Task 1: Server Desain QR + Preset — soft delete, batch, `getPreset`

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/qrcode/{service,repo,validate,routes,items}.ts`, `server/src/modules/sticker/manual-book.ts` (komit ekspor), pembaca `qr_designs`/`qr_presets` di `item/repo.ts`, `desktop/catalog.ts`, `sticker/instruction-*` (aturan `group`), `cleanupQrDocuments` (pemilik terhapus = sah), `server/src/core/soft-delete-pending.ts`
- Test: `server/src/modules/qrcode/soft-delete.test.ts` (Create), `qrcode/rest.test.ts`, `qrcode/export-job.test.ts` (atau berkas tes job yang ada)

**Interfaces:**
- Produces: `qrcodes.delete` (jalur tetap) menjadi soft delete; `qrcodes.removeBatch` (`POST /qrcodes/batch/delete`), `qrcodes.restore` (`POST /qrcodes/{id}/restore`), `qrcodes.restoreBatch` (`POST /qrcodes/batch/restore`); `qrcodes.getPreset` (`GET /qrcodes/presets/{id}`, `qrcode: view`, DTO = preset di `getDefaults`); `qrcodes.deletePreset` menjadi soft delete; `qrcodes.removePresetBatch`, `qrcodes.restorePreset`, `qrcodes.restorePresetBatch`. `qrcodes.list` menerima `status?: 'live' | 'deleted'` (`deleted` hanya `qrcode: manage`); `QrDesignDto.deleted?`, `QrPresetDto.deleted?`, `QrDesignDto.presetDeleted?: boolean`. Audit `qrcode.delete|restore`, `qrcode.preset_delete|preset_restore`. Perencana `planQrDesignRemove/Restore`, `planQrPresetRemove/Restore`; `planQrDesignRestore` juga mengembalikan stiker versi terbarunya ke `inactive` (keputusan pemilik soft delete 13); hapus ulang = sukses tanpa audit (T2); tabel anak (`manual_book_versions`) mengikuti induk (daftar `CHILD_PARENTS` tes penjaga, T5).
- [ ] **Step 1: Tes gagal**:
  - hapus desain ber-versi → sukses; `items.manual_book_design_id` tak berubah; item tampil "Belum ada QR Manual Book" (`items.list manualBook=missing`); stiker Manual Book menjadi `deprecated`/`inactive`; `trashFile` dan pencabutan berbagi TIDAK dipanggil (klien Google palsu mencatat nol panggilan).
  - pasang item itu ke desain lain lalu pulihkan desain lama → item tetap di desain baru.
  - pulihkan desain (keputusan pemilik soft delete 13): stiker versi terbarunya yang `deprecated`/`inactive` karena penghapusan → `inactive` dan dapat diaktifkan lagi; stiker versi lama tak berubah; Pulihkan tidak mengaktifkan stiker.
  - pulihkan desain yang namanya kini dipakai desain hidup → `CONFLICT` generik pada field `name`.
  - job ekspor: desain dihapus setelah langkah 0 → langkah komit tidak menulis `manual_book_versions`/stiker, job gagal "Konfigurasi sudah dihapus".
  - preset: hapus → tak ditarik otomatis saat QR baru untuk BU itu; desain yang memakainya `presetDeleted: true`; pulihkan saat BU sudah punya preset hidup → `CONFLICT`; `getPreset` terhapus oleh `qrcode: view` → `NOT_FOUND`.
  - batch hapus dua desain + satu id asing → `NOT_FOUND`, tak ada yang berubah.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi (komit ekspor menambah syarat `deleted_at = ''` di bawah kunci `qr_designs FOR UPDATE` yang ada). **Step 4:** `bun run --cwd server test src/modules/qrcode src/modules/sticker src/modules/item src/modules/desktop src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): soft delete dan batch untuk desain dan preset QR`.

### Task 2: Server Postel — soft delete dan batch

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/postel/{service,repo,items,attachments,digest,validate,routes}.ts`, `server/src/modules/sticker/postel.ts` (`ensurePostelType`, `backfillPostelStickers`), `postel/stickers.ts`, `server/src/modules/files/service.ts` (`canReadPostelFiles`), `soft-delete-pending.ts`
- Test: `server/src/modules/postel/soft-delete.test.ts` (Create), `postel/rest.test.ts`

**Interfaces:**
- Produces: `postels.remove` menjadi soft delete; `postels.removeBatch` (`POST /postels/batch/delete`), `postels.restore` (`POST /postels/{id}/restore`), `postels.restoreBatch` (`POST /postels/batch/restore`); `postels.list` menerima `status?: 'live' | 'deleted'` (`deleted` hanya `sticker: edit`); `PostelDto.deleted?`. `postel_numbers` mengikuti induk (kolom `deleted_at` milik tabel nomor diisi bersama induk dalam satu `batch()`, dan `postel_numbers_key_live` membebaskan nomor). Audit `postel.delete|restore`. Hapus/pulihkan memakai `softDeleteWithChildren`/`restoreWithChildren` (fase 2b) untuk `postels` + `postel_numbers`; `postels.save` dan `ensurePostelType`/pembuatan stiker Postel baru memeriksa nama stiker Postel lama yang masih ada (termasuk milik Postel terhapus, keputusan pemilik soft delete 13); pulihkan Postel mengembalikan stikernya ke `inactive`.
- [ ] **Step 1: Tes gagal**: hapus → item tetap ber-`postel_id`, dihitung "Belum ada Postel"; lampiran tetap `active`; stiker `deprecated`/`inactive`; nomor dapat dipakai `postels.save` baru; pulihkan saat nomor sudah dipakai → `CONFLICT` generik; `checkPostelExpiryDigest` mengabaikan Postel terhapus; `backfillPostelStickers` tidak mengadopsi stiker Postel terhapus; `postelFiles.get` lampiran Postel terhapus: `sticker: edit` → isi, `sticker: view` → `NOT_FOUND`; nama Postel turunan dan klaim item hanya menghitung item hidup; Postel BARU bernama sama dengan Postel yang masih di Terhapus → `CONFLICT` (nama stiker lama masih memegang `stickers_type_name_unique`), pesan menyarankan memulihkan yang lama bagi pemegang `sticker: edit` dan generik bagi lainnya; pulihkan Postel → stikernya `inactive`; `softDeleteWithChildren` menghapus Postel + nomornya sekaligus (T5); batch atomik.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/postel src/modules/sticker src/modules/item src/modules/files src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): soft delete dan batch untuk Postel`.

### Task 3: Web QR Code — daftar, View, form bertab, tur

**Files:**
- Modify: `web/src/routes/_app/qrcode/{index,new}.tsx`, `web/src/routes/_app/qrcode/$designId/edit.tsx`, `web/src/modules/qrcode/components/{qr-designs-table,qr-design-form}.tsx`, `web/src/modules/qrcode/queries.ts`, `web/src/modules/guide/catalog/qrcode.ts`, `web/src/modules/guide/components/tour/*` (bila `langkah.buka` perlu jenis `tab`), `web/src/lib/link-access.ts`
- Create: `web/src/routes/_app/qrcode/$designId/index.tsx`, `web/src/modules/qrcode/components/{qr-design-view,qr-design-form-page}.tsx`
- Test: tes komponen terkait, `qr-design-view.test.tsx`, `web/src/modules/guide/catalog/catalog.test.ts`, tes mesin tur

**Interfaces:**
- Daftar: [checkbox `qrcode: manage`][Aksi: Ubah, Ekspor/Ekspor ulang, Unduh PDF, Unduh PNG, Hapus / Pulihkan][Nama `LinkCell` → View][Item (`LinkCell` per item bila `itemLinkAccess`)][Versi stiker][Link][Diperbarui][Status ekspor badge]; filter cari + Status (Hidup/Terhapus bagi manage).
- View `/qrcode/$designId`: tab Detail (nama, preset tautan + `DeletedBadge`, BU, sumber link, pratinjau label), Item, Versi stiker (`version-history`); aksi Ubah, Ekspor, Unduh, Hapus/Pulihkan + `DeletedBanner`.
- Form `QR_DESIGN_FORM_ID = 'qr-design-form'`; tab: `item` (Item Manual Book, Konfigurasi default, Nama Manual Book, BU), `sumber` (Sumber link), `label` (Isi label), `logo` (Logo, Bingkai), `ukuran` (Ukuran); pratinjau label di luar tab (selalu terlihat). Mode `defaults` memakai tab yang sama tanpa `item`/`sumber`. Galat simpan → `firstTabWithError`.
- Tur (T13): `GuideStep.buka` mendapat bentuk `{ tab: string }` yang mengaktifkan tab form ber-`data-form-tab="<id>"` (murni UI; `FormTabs` fase 2 menyediakan atributnya), dan mesin tur memeriksa keterlihatan target sebelum menyorot (target di tab tersembunyi tidak disorot sebelum tab dibuka); `scroll-margin-top` = tinggi header + bar headroom. Langkah `qrcode-buat` yang targetnya di tab lain memakainya. `ListPage`/`FormPage`/`LinkCell` meneruskan `data-tour`: target `qr-header` (bar judul daftar), `qr-new` (tombol Tambah), dan tombol simpan form lewat `saveTour`. `halamanKecuali` panduan QR diperluas untuk `/qrcode/$id` dan `/qrcode/default*` agar banner tidak salah muncul. Perubahan kosmetik → versi panduan TIDAK dinaikkan; tombol "Konfigurasi default" di halaman QR dipertahankan sebagai pintasan (T18).
- [ ] **Step 1: Tes gagal**: tautan nama → View; bar massal Hapus memanggil `qrcodes.removeBatch`; View terhapus menampilkan banner + Pulihkan; form menampilkan 5 tab; galat nama → tab `item` aktif bertitik; langkah tur dengan `buka: { tab: 'logo' }` mengaktifkan tab Logo sebelum menyorot `qr-logo`; mesin tur tidak menyorot target yang tak terlihat sebelum `buka` dijalankan; `qr-header`/`qr-new` ada di `ListPage` QR; banner panduan tidak muncul di `/qrcode/$id`; Hapus dari View → `/qrcode` + toast "Dihapus"; aksi baris daftar di ponsel = menu "⋯"; tes katalog tetap hijau.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/qrcode src/modules/guide src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): QR Code di kit dengan View, form bertab, dan aksi massal`.

### Task 4: Web Default QR

**Files:**
- Modify: `web/src/routes/_app/qrcode/default/index.tsx` (isi dipindah ke komponen), `web/src/routes/_app/qrcode/default/$presetId/edit.tsx`, `default/new.tsx`, `web/src/modules/qrcode/queries.ts`
- Create: `web/src/routes/_app/qrcode/default/$presetId/index.tsx`, `web/src/modules/qrcode/components/{qr-presets-page,qr-preset-view,qr-preset-form-dialog}.tsx`
- Test: `qr-presets-page.test.tsx`, `qr-preset-view.test.tsx`

**Interfaces:**
- Daftar: [checkbox `qrcode: manage`][Aksi: Ubah, Kloning, Hapus/Pulihkan][Nama `LinkCell` → View][BU `LinkCell`][Nama Manual Book di][Diperbarui]; filter cari + Status. View: tab Detail (BU, penempatan nama, isi label/logo/bingkai/ukuran ringkas + pratinjau) dan "Dipakai oleh" (desain QR yang memakai preset ini, dari cache `qrcodes.list`, `LinkCell`). Data View dari `qrcodes.getPreset`. Tambah (keputusan pemilik 18): `LinkField` Preset QR di form QR mendapat baris "Tambah preset" (`qrPresetLinkAccess(...).canCreate`: `qrcode: manage`) yang membuka `QrPresetFormDialog` (Form Dialog yang membungkus form Default QR yang sama; BU wajib dan unik per BU, galat unik dipetakan generik), dirender di luar `<form>` QR; preset baru langsung terpilih. Pustaka logo di halaman Default QR = pengecualian kerangka bernama (T18), tetap seperti sekarang. View preset lebar `default`, aside `ViewMeta` tanpa angka hitungan (T12); setelah Hapus → `/qrcode/default` + toast "Dihapus" (T22).
- [ ] **Step 1: Tes gagal**: nama → View; Kloning tetap membuka `ClonePresetDialog`; batch Hapus memanggil `qrcodes.removePresetBatch`; View terhapus menampilkan banner; "Tambah preset" dari form QR membuka dialog di luar `<form>` QR dan preset baru langsung terpilih; Hapus dari View → `/qrcode/default` + toast "Dihapus".
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): Default QR di kit dengan View`.

### Task 5: Web Postel

**Files:**
- Modify: `web/src/modules/postel/components/{postels-page,postel-view,postel-form-page,postel-form}.tsx`, `web/src/modules/postel/queries.ts`, rute `web/src/routes/_app/postel/*`
- Test: tes komponen Postel yang ada

**Interfaces:**
- Daftar: [checkbox `sticker: edit`][Aksi: Ubah, Hapus / Pulihkan][Nama `LinkCell` → View][Jumlah item][Nomor Aktif][Tanggal habis][Sisa hari][Kondisi badge][Nomor lama][Diperbarui]; filter cari (fungsi `filterPostels` yang ada) + chip Kondisi + Status (Hidup/Terhapus).
- View: `ViewPage` tab Detail (Nomor sertifikat, Catatan), Item, Lampiran, Riwayat (`postel-history`); aksi Ubah, Hapus/Pulihkan, `DeletedBanner`.
- Form: `FormPage` (`POSTEL_FORM_ID = 'postel-form'`), tab `item`, `nomor`, `catatan` (Catatan + Lampiran); `firstTabWithError`.
- [ ] **Step 1: Tes gagal**: batch Hapus memanggil `postels.removeBatch`; View tab berpindah dan `tab` di URL; form galat nomor → tab `nomor` aktif bertitik; Postel terhapus menampilkan banner dan lampiran tetap dapat diunduh; Hapus dari View → `/postel` + toast "Dihapus" dengan aksi "Pulihkan" bagi `sticker: edit`; aksi baris daftar di ponsel = menu "⋯".
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/postel src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Postel di kit dengan aksi massal dan form bertab`.

### Task 6 (Haiku): Dokumentasi, changelog, verifikasi

**Files:**
- Modify: `CLAUDE.md` (bullet QR/Manual Book 4a dan Postel 4b: hapus = soft delete tanpa efek Drive, rute batch/pulihkan, `getPreset`, izin Postel, pulihkan memulihkan stiker; SUNTING, bukan hanya menambah, pernyataan yang bertentangan: penolakan hapus bila sudah ber-versi, hapus Postel melepas item/menghapus nomor/membuang lampiran, penyapu PDF sumber yatim bila terdampak; T23/T24), `docs/prd/2026-10-16-qc-qr-code.md` (catatan "diubah redesain 2026-11-20" pada FQR50), `docs/e2e-checklist*.md` dan teks langkah panduan QR/Postel yang menyebut tombol "Lihat"/alur hapus lama, `docs/ci-cd.md` (pengecualian rollback: setelah rilis rollback image TIDAK aman, perbaiki ke depan; spek soft delete §5 butir 7 dan keputusan 11)
- Create: `server/changelog.d/20261120-manual-book-postel-hapus.md` (`jenis: diubah`; paragraf: Desain QR, Default QR, dan Postel yang dihapus kini dapat dipulihkan dan berkasnya tidak dibuang; halaman detail QR dan Default QR; pilih banyak untuk dihapus/dipulihkan; form bertab)
- [ ] **Step 1:** Tulis. **Step 2:** `bun run check` → hijau. **Step 3:** Commit `docs: Manual Book dan Postel di kit + soft delete`.
