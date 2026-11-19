# Redesain Fase 4d: Serial Number + Serah Terima + Country Lock (penutup) — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Serial Number dan Serah Terima memakai kit (View bertab, Kanban, daftar) dan soft delete; Country Lock memakai kerangka seragam; redesain ditutup dengan menghapus pemetaan varian lama, mengaktifkan tes kerangka halaman, dan migrasi contract soft delete (buang indeks unik lama, dalam PR yang sama).

**Architecture:** Pola fase 3/4. Serial: soft delete dengan indeks `serials_serial_live` dibuat bersyarat di `ensureSerialUniqueIndex` (data lama dapat ganda; versi contract di Task 6, T3), Hapus/Pulihkan massal tanpa ubah massal (keputusan 13). Serah Terima: Hapus/Pulihkan per task tanpa rute batch (keputusan 14); task terhapus terlihat lewat filter "Terhapus" di papan. Penutup: semua pemakai varian lama dimigrasi lalu pemetaan dihapus; tes kerangka halaman (spek §6.4) aktif; migrasi contract soft delete (buang indeks lama) menjadi task terakhir sebelum dokumentasi (keputusan pemilik soft delete 11).

**Tech Stack:** seperti fase sebelumnya.

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§5 keputusan 13-14, §6.4-6.9, §6.10 baris 4d, §8 butir 4, 5, 8, 9), `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§2 butir 8, §4.3, §5 butir 5, 7, 10). Rancangan serial unik se-sistem: `docs/superpowers/specs/2026-11-18-serial-unik-sistem-design.md`. Inventaris: `.superpowers/sdd/fase-4-inventaris.md` bagian 4d.

## Global Constraints

- Serial: Hapus/Pulihkan = `serial: manage` pada SEMUA BU dalam riwayat BU serial itu (`serial_business_units`), bukan hanya BU saat ini (keputusan pemilik soft delete 12); tanpa syarat status; stok stiker yang sudah dipotong tidak dikembalikan; laporan rusak milik serial terhapus ikut tak tampil (daftar Laporan, surel, notifikasi, halaman publik = 404 seragam), tidak ditutup; memulihkan ditolak selama serial yang sama hidup ("Serial Number ini sudah dicatat ulang"); mencatat ulang serial terhapus = record BARU (indeks lama dibuang di migrasi contract PR ini, Task 6). Kiriman ulang ber-`clientId` untuk serial yang sudah terhapus = `NOT_FOUND` (T8); `serials.saveBatch` menolak baris yang Item/Lokasi/BU-nya sudah terhapus dengan pesan per baris (indeks baris + "Item/Lokasi/BU sudah dihapus"), dan katalog desktop membuang entri terhapus setelah sinkron berikutnya (T7); stiker terhapus ditolak di `recheck` (T9).
- Serial: TIDAK ada ubah massal (keputusan 13); checkbox daftar hanya untuk Hapus/Pulihkan massal.
- Serah Terima: Hapus/Pulihkan = `handover: manage` pada lokasi task; per task saja; berbeda dari Batalkan; antrean notifikasi tunggu task dibuang seperti `done`; tanpa checkbox di papan. Kiriman ulang ber-`clientId` (`save`, `saveBatch`, `comment`) untuk task yang sudah terhapus = `NOT_FOUND` (T8).
- Antrean luring PWA: kiriman ke task terhapus ditolak server (`NOT_FOUND`) dan diperlakukan "rejected" (diumumkan sekali lalu dibuang); klasifikasi di `outbox-flush.ts` dan `web/public/sync-sw.js` tetap sama (`outbox-parity.test.ts`).
- Country Lock: hanya kerangka (di luar `AppShell`: tanpa breadcrumb; halaman memasang `PageContainer width="default"` sendiri, keputusan pemilik 17; bar judul seragam, `ActionButton` untuk aksi yang ada di kosakata); jembatan desktop dan `UI_MIN_BRIDGE_VERSION` tidak berubah.
- Target `data-tour` (Serial 5 panduan, Serah Terima 2 panduan) dipertahankan; tur yang menyorot isi tab lain membuka tab lewat `langkah.buka` (`{ tab }`, fase 4b). Target yang berpindah (T13): `serial-open` menjadi tautan kolom (`LinkCell tour`), `serial-new` = tombol Tambah di `ListPage`, `serial-row-actions` = menu/aksi baris, `case-open` = tautan nomor LP, `handover-card-actions` = aksi kartu, tombol simpan lewat `FormPage saveTour`; `halamanKecuali` panduan Serial/Serah Terima diperluas untuk rute View baru (`/serial/$id` bertab, `/handover/$id`) agar banner tidak salah muncul.
- Akhir fase: tidak ada pemakai varian lama Button/Badge/Alert; tidak ada halaman pola lama (tes kerangka); `verify-dist` (≤ 600 KB gzip per potongan) hijau.
- Aksi massal Serial bertahap lewat `runChunkedBatch` (keputusan pemilik 19); luring = toast galat, tidak diantrekan (T21); aksi baris di ponsel = menu "⋯" (keputusan pemilik 22); setelah Hapus dari View: navigasi ke indeks induk + toast "Dihapus" (+ "Pulihkan" bagi pemegang izin; T22).
- Pengecualian kerangka bernama untuk `page-frame.test.ts` (T18): tabel draft Catat Serial (+ kartu ponsel), riwayat/log dalam tab View (`DetailList`/tabel sederhana), Pustaka logo di halaman Default QR. `FormHeader` dihapus bila tak ada pemakai (T17).
- Judul `h1` memakai nama lengkap ("Daftar Serial Number") dan `crumb` untuk `/serial/report` (T19); `SerialLocationField` mendapat Buka bila berhak (keputusan pemilik 18).
- Wajib hijau: `bun run check` dan `bun run build`.

## Review Focus

1. Serial terhapus: tautan publik laporan rusaknya → 404 seragam; lonceng notifikasi foto bukti yang menaut ke serial itu → `NOT_FOUND` bagi non-manage, bukan galat 500. (Task 1)
2. `ensureSerialUniqueIndex` pada basis data dengan serial ganda lintas BU: tidak membuat `serials_serial` maupun `serials_serial_live`, start tidak gagal, dan pesan peringatan tetap satu. (Task 1)
3. Papan Serah Terima: menghapus task di kolom "Baru" mengurangi `hasMore`/hitungan kolom tanpa memuat ulang semua kolom; filter "Terhapus" hanya untuk `handover: manage`. (Task 2, 4)
4. Centang luring ke task yang kemudian dihapus → saat online, satu toast "ditolak", antrean bersih, papan tidak menampilkan task itu. (Task 4)
5. Menghapus pemetaan varian lama tidak mengubah tampilan tombol desktop Country Lock (Retry/Cancel/Buka web) dan halaman publik `/laporan/$token`. (Task 5)
6. Hapus/pulihkan serial yang pernah berpindah BU: pemanggil `manage` hanya pada BU saat ini (bukan semua BU riwayat) → `NOT_FOUND`, tak ada yang berubah. (Task 1)
7. Kiriman ulang `clientId` ke serial/task terhapus → `NOT_FOUND`; `saveBatch` dengan Item/Lokasi/BU terhapus → ditolak per baris. (Task 1, 2)
8. Setelah migrasi contract, `SHOW INDEX` hanya memuat padanan `_live` (kecuali `users_email` penuh) dan record terhapus + record baru berkunci sama dapat hidup berdampingan di tiap tabel. (Task 6)

## Pembagian kelas beban

Sonnet: Task 1-6. Haiku: Task 7. Berurutan.

---

### Task 1: Server Serial — soft delete dan batch hapus/pulihkan

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/serial/{service,repo,validate,routes,bu-history,case-list,case-repo,report,alert-job,public-routes,act}.ts`, `server/src/modules/serial/proof/{service,sweep}.ts`, `server/src/modules/notification/{recipients,repo,serial-proof}.ts`, `server/src/modules/files/service.ts`, `soft-delete-pending.ts`
- Test: `server/src/modules/serial/soft-delete.test.ts` (Create), `serial/rest.test.ts`, `serial/unik-migration.test.ts`

**Interfaces:**
- Produces: `serials.remove` (`DELETE /serials/{id}`), `serials.removeBatch` (`POST /serials/batch/delete`), `serials.restore` (`POST /serials/{id}/restore`), `serials.restoreBatch` (`POST /serials/batch/restore`), semua `serial: manage` pada SEMUA BU dalam riwayat BU tiap serial yang disentuh (`serial_business_units`, bukan hanya BU saat ini; keputusan pemilik soft delete 12; di luar hak = `NOT_FOUND` seragam); `serials.list` menerima `status?: 'live' | 'deleted'`; `SerialSummaryDto.deleted?`, `SerialDto.deleted?`. `ensureSerialUniqueIndex` di task ini juga membuat `serials_serial_live (serial, deleted_at)` dengan syarat yang sama (versi contract di Task 6); `mapDuplicateError` serial memetakan keduanya lewat `baseIndexName` (T3). Audit `serial.delete|restore` (kejadian `serial_events` TIDAK ditulis untuk hapus/pulihkan; riwayat tetap utuh). Perencana `planSerialRemove/Restore`. `serials.saveBatch` menolak baris yang Item/Lokasi/BU-nya terhapus dengan pesan per baris (indeks baris + "Item/Lokasi/BU sudah dihapus"; T7); kiriman ulang ber-`clientId` untuk serial yang sudah terhapus = `NOT_FOUND` (T8); `serials.act` `recheck` menolak `stickerIds` stiker terhapus seperti `inactive` (T9); hapus ulang = sukses tanpa audit (T2); katalog desktop membuang entri terhapus setelah sinkron berikutnya (diterima; T7).
- [ ] **Step 1: Tes gagal**: hapus serial → hilang dari `serials.list`, `serials.lookup`, `serialCases.list`; `GET /api/public/serial-reports/<token>` laporannya → 404 seragam; stok tak berubah; pulihkan saat serial sama hidup → `CONFLICT` "Serial Number ini sudah dicatat ulang"; `serial: edit` saja → rute hapus `FORBIDDEN`; batch dua serial dari BU berbeda, pemanggil `manage` di satu BU saja → `NOT_FOUND`, tak ada yang terhapus; serial yang dulu berpindah BU: `manage` hanya pada BU saat ini → `NOT_FOUND`, `manage` pada SEMUA BU riwayat → berhasil (keputusan pemilik soft delete 12); `ensureSerialUniqueIndex` tanpa ganda membuat dua indeks, dengan ganda tidak membuat keduanya; penyapu foto bukti dan job `serial_alert` melewati serial terhapus; `saveBatch` dengan Item/Lokasi/BU terhapus → ditolak per baris dengan indeks baris; `saveBatch` ulang ber-`clientId` serial terhapus → `NOT_FOUND`; `recheck` dengan stiker terhapus → ditolak; hapus ulang → sukses tanpa audit; dua serial berkunci sama dihapus dengan jam digeser tidak bentrok.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/serial src/modules/notification src/modules/files src/modules/sticker src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): soft delete dan hapus massal Serial Number`.

### Task 2: Server Serah Terima — hapus dan pulihkan per task

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/handover/{service,repo,validate,routes}.ts`, `server/src/modules/notification/{flush,emit,repo,service}.ts` (lonceng/push/SSE melewati task terhapus), `soft-delete-pending.ts`
- Test: `server/src/modules/handover/soft-delete.test.ts` (Create), `handover/rest.test.ts`

**Interfaces:**
- Produces: `handovers.remove` (`DELETE /handovers/{id}?locationId=`), `handovers.restore` (`POST /handovers/{id}/restore`), keduanya `handover: manage` + lokasi (`scope: 'location'`), tanpa penjaga versi (spek §8 butir 6); `handovers.board` menerima `deleted?: boolean` (hanya `handover: manage`; mengembalikan task terhapus dikelompokkan menurut kolom statusnya); `HandoverDto.deleted?`. Hapus membuang `notification_pending` task itu dalam `batch()` yang sama. `setCheck`/`comment`/`save`/`setDone`/`cancel`/`reopen` pada task terhapus → `NOT_FOUND`. Audit `handover.delete|restore`. Kiriman ulang ber-`clientId` (`save`, `saveBatch`, `comment`) untuk task yang sudah terhapus = `NOT_FOUND` (T8); hapus ulang = sukses tanpa audit (T2).
- [ ] **Step 1: Tes gagal**: hapus → hilang dari `board` default (hitungan dan `hasMore` kolom tak memuatnya), `get` oleh non-manage → `NOT_FOUND`; `board deleted=true` oleh manage menampilkannya di kolom statusnya; `setCheck` ke task terhapus → `NOT_FOUND`; tunggu notifikasi dibuang; nomor `ST-…` tidak dipakai ulang; pulihkan → kembali ke kolom statusnya; `save`/`saveBatch`/`comment` ulang ber-`clientId` pada task terhapus → `NOT_FOUND`; hapus ulang → sukses tanpa audit.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/handover src/modules/notification src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): hapus dan pulihkan task Serah Terima`.

### Task 3: Web Serial Number — daftar, View, Laporan, Pengaturan, Catat

**Files:**
- Modify: `web/src/modules/serial/components/{serial-list-page,serial-filters,serial-detail-page,timeline-tabs,custody-panel,case-list-page,serial-settings-page,service-locations-settings,record-page,report-page}.tsx`, `web/src/modules/serial/queries.ts`, rute `web/src/routes/_app/serial/*`, `web/src/modules/guide/catalog/serial.ts` (target yang berpindah dan `halamanKecuali` untuk rute View baru; `buka: { tab }` bila perlu; T13)
- Test: tes komponen Serial yang ada, `web/src/modules/guide/catalog/catalog.test.ts`

**Interfaces:**
- Daftar Serial (judul `h1` "Daftar Serial Number", T19; tombol Tambah membawa target `serial-new`, T13): `ListPage` + `DataTable` [checkbox hanya `serial: manage`][Aksi: Ubah (dialog yang ada), Hapus / Pulihkan][Serial `LinkCell tour="serial-open"` → View (mono, badge foto)][Item `LinkCell`][BU `LinkCell`][Lokasi `LinkCell`][Tanggal uji][Status][Posisi][Sample]; filter yang ada sebagai `FilterChip` + Status (Hidup/Terhapus bagi manage); `BulkBar`: Hapus / Pulihkan (`serials.removeBatch`/`restoreBatch`, bertahap lewat `runChunkedBatch`, keputusan pemilik 19); aksi baris diberikan sebagai `RowAction[]` (menu "⋯" di ponsel; target `serial-row-actions`, T13); infinite "Muat lebih banyak" tetap.
- View Serial: `ViewPage` tab `detail` (identitas + `CustodyPanel`), `riwayat` (`ActButtons` + `TimelineTabs`; `?case=` membuka tab ini), `foto` (galeri bukti); aksi Ubah, Hapus/Pulihkan, `DeletedBanner`. Aside `ViewMeta` tanpa angka hitungan ("Dibuat" hanya bila DTO punya `createdBy`; T12); lebar `default`; setelah Hapus → `/serial` + toast "Dihapus" (T22). Riwayat/log dalam tab memakai `DetailList`/tabel sederhana (pengecualian kerangka bernama, T18); `LinkField` Item/BU/Lokasi di View dan dialog mendapat Buka bila berhak, termasuk `SerialLocationField` (keputusan pemilik 18).
- Laporan: `ListPage` + `DataTable` tanpa checkbox; Nomor LP `LinkCell tour="case-open"` → `/serial/$id?case=…&tab=riwayat`, Serial/Item/BU `LinkCell`; filter yang ada sebagai chip.
- Pengaturan: `FormPage` + `FormTabs` "Email rusak" (form `SERIAL_ALERT`) dan "Lokasi tim servis" (form sendiri); Simpan header mengikuti tab aktif (pola 4a Konfigurasi Stiker).
- Catat (`/serial/new`) dan Lapor Rusak: bar judul `FormPage` (judul + tombol Simpan yang ada) di atas isi yang ada; tabel draft TIDAK diganti `DataTable` (draft lokal, mode kartu ponsel dipertahankan; pengecualian kerangka bernama di `page-frame.test.ts`, T18).
- [ ] **Step 1: Tes gagal**: daftar tanpa checkbox bagi `serial: edit`, dengan checkbox bagi manage; Hapus massal memanggil `serials.removeBatch`; tidak ada tombol "Ubah massal"; View `?case=x` membuka tab Riwayat; Nomor LP menaut ke View serial; Pengaturan: Simpan di tab Lokasi hanya memanggil `serialServiceSettings.save`; tes katalog panduan hijau; pilih 250 serial → Hapus dikirim 100/100/50 dan tahap gagal menghentikan sisanya; Hapus dari View → `/serial` + toast "Dihapus"; aksi baris di ponsel = menu "⋯"; `LinkField` lokasi/Item di dialog Ubah baris mendapat Buka bila berhak; target `serial-new`/`serial-open`/`serial-row-actions`/`case-open` ada di DOM; banner panduan tidak muncul di `/serial/$id`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/serial src/modules/guide src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Serial Number di kit dengan View bertab dan hapus massal`.

### Task 4: Web Serah Terima — Kanban, View, form, antrean luring

**Files:**
- Modify: `web/src/modules/handover/components/{handover-board-page,handover-board,handover-card,handover-detail-view,handover-form,handover-batch-form}.tsx`, `web/src/modules/handover/queries.ts`, `web/src/modules/handover/lib/{outbox-flush,outbox-labels}.ts`, `web/public/sync-sw.js`, `web/src/modules/handover/lib/board-snapshot.ts`, rute `web/src/routes/_app/handover/*`
- Test: tes komponen dan lib handover yang ada, `outbox-parity.test.ts`

**Interfaces:**
- Papan desktop memakai `KanbanBoard` (kolom `min-w-[290px]`, gulir horizontal, warna kolom = warna badge status lewat `badgeColorOf(status)` yang dipakai juga badge status task); `height="viewport"` (T14: kolom menggulir sendiri dengan `ScrollRootProvider` + kartu lazy + `LoadMore` per kolom, bar headroom diam; tinggi diuji dengan banner tampil); ponsel tetap daftar kartu + chip status. Filter: chip "Terhapus" (`handover: manage`, memanggil `handovers.board` `deleted: true`; chip ada di bar filter desktop, T14); tanpa checkbox. Nama customer di kartu menaut ke View customer (fase 4c) hanya bagi `item: view` (keputusan pemilik soft delete 15c); aksi kartu membawa target `handover-card-actions` (T13).
- View task: `ViewPage` tab `catatan` (NoteView: checklist + komentar) dan `riwayat`; aksi yang ada (Selesai, Buka lagi, Ubah, Batalkan) + Hapus (`ConfirmDeleteDialog`, `handover: manage`) / Pulihkan + `DeletedBanner`. Setelah Hapus → `/handover` + toast "Dihapus" dengan "Pulihkan" bagi `handover: manage` (T22); lebar View `default`, aside `ViewMeta` (T12); riwayat dalam tab = pengecualian kerangka bernama (T18).
- Form ubah/buat: bar judul `FormPage` (tombol Simpan yang ada); isi form batch tidak diubah.
- Antrean luring: `NOT_FOUND` dari `setCheck`/`comment` untuk task yang ada di antrean = "rejected" dengan alasan "Task sudah dihapus" di `outbox-flush.ts` DAN `sync-sw.js`; kiriman ulang ber-`clientId` (komentar, task baru) ke task terhapus = `NOT_FOUND` = rejected juga (T8); aksi massal bukan bagian antrean (tak ada aksi massal Serah Terima, keputusan 14); snapshot papan IndexedDB membuang task yang hilang dari respons papan.
- [ ] **Step 1: Tes gagal**: kolom papan memakai warna badge statusnya; chip "Terhapus" tak tampil bagi non-manage; View task terhapus menampilkan banner + Pulihkan; Hapus mengeluarkan task dari cache papan; penguras antrean memperlakukan `NOT_FOUND` setCheck sebagai rejected sekali; `outbox-parity.test.ts` hijau; Hapus dari View → `/handover` + toast "Dihapus"; `KanbanBoard` memakai `height="viewport"` dan chip "Terhapus" tampil di desktop bagi manage.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/handover src/app src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Serah Terima di Kanban kit dengan hapus dan pulihkan per task`.

### Task 5: Country Lock, hapus pemetaan varian lama, tes kerangka halaman

**Files:**
- Modify: `web/src/modules/countrylock/components/*.tsx` (kerangka + `ActionButton`), `web/src/routes/country-lock.tsx` (memasang `PageContainer width="default"` sendiri: di luar `AppShell`, tanpa breadcrumb; keputusan pemilik 17), hapus `web/src/components/form-header.tsx` + `form-header.test.tsx` bila tak ada pemakai (T17), semua pemakai varian lama Button (`default`, `destructive`, `secondary`, `outline`, `ghost`, `link` tanpa `color`) / Badge / Alert di `web/src` (cari lewat tes baru), `web/src/components/ui/{button,badge,alert}.tsx` dan `variant-style.ts` (hapus pemetaan lama), `web/src/components/ui/variant-style.test.ts`
- Create: `scripts/no-legacy-variants.test.ts`, `scripts/page-frame.test.ts`
- Test: kedua tes baru + tes web penuh

**Interfaces:**
- `scripts/no-legacy-variants.test.ts`: gagal bila `web/src` (kecuali `components/ui/**` dan tes) memuat `variant="default"`, `variant="destructive"`, `variant="secondary"` pada Button/Badge/Alert, atau `variant="outline"`/`"ghost"`/`"link"` TANPA prop `color` pada Button dan Badge.
- `scripts/page-frame.test.ts` (spek §6.4): setiap berkas rute di `web/src/routes/_app/**` dan `web/src/routes/country-lock.tsx` yang merender halaman memakai salah satu kerangka `ListPage`, `ViewPage`, `FormPage`, `KanbanBoard` (lewat komponen modulnya), atau tercantum di daftar pengecualian bernama beralasan (mis. beranda, halaman publik `/laporan/$token`, Country Lock dengan `PageContainer` sendiri, tabel draft Catat Serial + kartu ponsel, riwayat/log dalam tab View (`DetailList`/tabel sederhana), Pustaka logo di halaman Default QR; T18); entri basi menggagalkan tes. Tes juga menjaga tak ada pemakai `FormHeader` (T17: berkasnya dihapus bila nol).
- [ ] **Step 1: Tes gagal**: jalankan kedua tes baru → daftar pemakai lama dan halaman pola lama.
- [ ] **Step 2:** Migrasikan setiap pemakai ke `color` + `variant` baru sesuai tabel pemetaan fase 1 (`variant-style.ts`), lalu hapus pemetaan; Country Lock ke kerangka seragam; pindahkan sisa pemakai `FormHeader` ke `FormPage`, lalu hapus `FormHeader` (T17). **Step 3:** `bun run --cwd web test` penuh + `bun run build` (termasuk `verify-dist`) → PASS.
- [ ] **Step 4:** Commit `refactor(web): hapus varian lama dan tegakkan kerangka halaman`.

### Task 6: Migrasi contract soft delete

> Task terakhir sebelum dokumentasi (keputusan pemilik soft delete 11: contract dalam PR yang SAMA, bukan rilis berikutnya; pengecualian sadar terhadap expand → contract). Dikerjakan SETELAH semua modul memakai nama indeks `_live` dan helper `baseIndexName` (fase 3 sampai Task 5).

**Files:**
- Create: `server/migrations/00NN_soft_delete_contract.sql` (nomor bebas berikutnya setelah `0028`; baris pertama WAJIB `-- qc:contract`), `server/src/core/soft-delete-contract.test.ts`
- Modify: `server/src/modules/serial/bu-history.ts` (`ensureSerialUniqueIndex` versi contract), `server/src/core/cas.ts` dan pembanding `error.key` hanya bila masih memakai nama literal lama (T3), `server/src/modules/serial/unik-migration.test.ts`

**Interfaces:**
- Migrasi: `DROP INDEX IF EXISTS` untuk indeks lama yang digantikan padanan `_live` (`roles_name_unique`, `locations_code_unique`, `locations_name_unique`, `business_units_code_unique`, `business_units_name_unique`, `brands_key`, `customers_key`, `items_key`, `sticker_types_name_unique`, `sticker_types_kind_unique`, `stickers_type_name_unique`, `qr_presets_bu_unique`, `postel_numbers_key`, `postels_sticker`, `handovers_number`); `serials_bu_serial` TIDAK dibuang di migrasi ini tetapi oleh `ensureSerialUniqueIndex` SETELAH `serials_serial_live` berhasil dibuat (ruling perencana 2026-11-20: bila data punya serial ganda lintas BU, indeks se-sistem tak terbentuk dan `serials_bu_serial` tetap menjadi penjaga keunikan per BU; membuangnya tanpa syarat meninggalkan serial tanpa penjaga indeks apa pun); `users_email` TIDAK dibuang (keputusan pemilik soft delete 10). Bila sebuah kunci asing bergantung pada indeks lama (MariaDB menolak DROP), buat indeks pendukung biasa lebih dulu di migrasi yang sama. Penanda `-- qc:contract` membuat `schema_guard` (`deploy/deploy.sh`) dan `deploy-tag.yml` tak pernah melewatinya saat downgrade (`scripts/migration-contract.test.ts`).
- `ensureSerialUniqueIndex` versi contract (T3): hanya membuat `serials_serial_live (serial, deleted_at)` bila tidak ada ganda, menghitung ganda lewat `GROUP BY serial, deleted_at`, dan membuang `serials_serial` lama bila ada; pesan peringatan ganda tetap satu.

- [ ] **Step 1: Tes gagal** `soft-delete-contract.test.ts`: setelah migrasi, `SHOW INDEX` hanya memuat padanan `_live` (dan `users_email` penuh); untuk tiap tabel: satu record terhapus + satu hidup berkunci sama dapat hidup berdampingan, dua hidup berkunci sama ditolak, dua terhapus dengan `deleted_at` sama ditolak; pengguna: email ganda (terhapus + baru) tetap ditolak; `index-names.test.ts` (fase 2b) hijau pada skema setelah contract; `scripts/migration-contract.test.ts` hijau; `ensureSerialUniqueIndex` tanpa ganda membuat `serials_serial_live` saja dan membuang `serials_serial` lama, dengan ganda tidak membuat apa pun dan start tidak gagal.
- [ ] **Step 2:** Jalankan → FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/core src/modules/serial` lalu `bun run --cwd server test` penuh → PASS (tes lama yang bergantung pada indeks lama disesuaikan; mis. tes fase 2b memakai `DROP INDEX IF EXISTS`).
- [ ] **Step 5:** Commit `feat(server): migrasi contract soft delete (buang indeks unik lama)`.

### Task 7 (Haiku): Dokumentasi, changelog, verifikasi akhir

**Files:**
- Modify: `CLAUDE.md` (Serial 5a/5b: rute hapus/pulihkan, indeks `serials_serial_live`, laporan publik 404 untuk serial terhapus, tanpa ubah massal; Serah Terima: `handovers.remove|restore`, papan `deleted`, antrean luring "Task sudah dihapus"; Aturan frontend: tes `no-legacy-variants` dan `page-frame`, varian lama sudah dihapus; butir "Migrasi": tambahkan soft delete ke daftar pengecualian expand → contract; SUNTING, bukan hanya menambah, pernyataan CLAUDE.md lain yang bertentangan), `docs/ci-cd.md` (pengecualian rollback soft delete: migrasi contract (buang indeks unik lama) ada di PR yang sama dengan redesain, sehingga setelah rilis rollback image ke sebelum soft delete TIDAK aman; perbaiki ke depan, jangan rollback, seperti pengecualian 0002/0003/0010/0017; spek soft delete §5 butir 7 dan keputusan 11; sebutkan nomor migrasi contract), `docs/superpowers/specs/2026-11-12-serial-number-design.md` (catatan "diubah redesain 2026-11-20" pada butir 41), `docs/e2e-checklist*.md` dan teks langkah panduan Serial/Serah Terima yang menyebut tombol/halaman yang berubah (T23)
- Create: `server/changelog.d/20261120-serial-serah-terima-hapus.md` (`jenis: ditambah`; paragraf: Serial Number dan task Serah Terima dapat dihapus dan dipulihkan; halaman detail Serial bertab; papan Serah Terima berwarna per status)
- [ ] **Step 1:** Tulis. **Step 2:** `bun run check` dan `bun run build` → hijau (catat). **Step 3:** Commit `docs: Serial Number dan Serah Terima di kit + soft delete; redesain selesai`.
