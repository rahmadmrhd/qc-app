# Redesain Fase 4d: Serial Number + Serah Terima + Country Lock (penutup) — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Serial Number dan Serah Terima memakai kit (View bertab, Kanban, daftar) dan soft delete; Country Lock memakai kerangka seragam; redesain ditutup dengan menghapus pemetaan varian lama dan mengaktifkan tes kerangka halaman.

**Architecture:** Pola fase 3/4. Serial: soft delete dengan indeks `serials_serial_live` dibuat bersyarat di `ensureSerialUniqueIndex` (data lama dapat ganda), Hapus/Pulihkan massal tanpa ubah massal (keputusan 13). Serah Terima: Hapus/Pulihkan per task tanpa rute batch (keputusan 14); task terhapus terlihat lewat filter "Terhapus" di papan. Penutup: semua pemakai varian lama dimigrasi lalu pemetaan dihapus; tes kerangka halaman (spek §6.4) aktif.

**Tech Stack:** seperti fase sebelumnya.

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§5 keputusan 13-14, §6.4-6.9, §6.10 baris 4d, §8 butir 4, 5, 8, 9), `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§2 butir 8, §4.3, §5 butir 5, 7, 10). Rancangan serial unik se-sistem: `docs/superpowers/specs/2026-11-18-serial-unik-sistem-design.md`. Inventaris: `.superpowers/sdd/fase-4-inventaris.md` bagian 4d.

## Global Constraints

- Serial: Hapus/Pulihkan = `serial: manage` pada BU serial; tanpa syarat status; stok stiker yang sudah dipotong tidak dikembalikan; laporan rusak milik serial terhapus ikut tak tampil (daftar Laporan, surel, notifikasi, halaman publik = 404 seragam), tidak ditutup; memulihkan ditolak selama serial yang sama hidup ("Serial Number ini sudah dicatat ulang"); mencatat ulang serial terhapus = record BARU (setelah rilis contract; sebelum itu indeks lama menolak dengan pesan duplikat yang ada).
- Serial: TIDAK ada ubah massal (keputusan 13); checkbox daftar hanya untuk Hapus/Pulihkan massal.
- Serah Terima: Hapus/Pulihkan = `handover: manage` pada lokasi task; per task saja; berbeda dari Batalkan; antrean notifikasi tunggu task dibuang seperti `done`; tanpa checkbox di papan.
- Antrean luring PWA: kiriman ke task terhapus ditolak server (`NOT_FOUND`) dan diperlakukan "rejected" (diumumkan sekali lalu dibuang); klasifikasi di `outbox-flush.ts` dan `web/public/sync-sw.js` tetap sama (`outbox-parity.test.ts`).
- Country Lock: hanya kerangka (`PageContainer width="full"`, bar judul seragam, `ActionButton` untuk aksi yang ada di kosakata); jembatan desktop dan `UI_MIN_BRIDGE_VERSION` tidak berubah.
- Target `data-tour` (Serial 5 panduan, Serah Terima 2 panduan) dipertahankan; tur yang menyorot isi tab lain membuka tab lewat `langkah.buka` (`{ tab }`, fase 4b).
- Akhir fase: tidak ada pemakai varian lama Button/Badge/Alert; tidak ada halaman pola lama (tes kerangka); `verify-dist` (≤ 600 KB gzip per potongan) hijau.
- Wajib hijau: `bun run check` dan `bun run build`.

## Review Focus

1. Serial terhapus: tautan publik laporan rusaknya → 404 seragam; lonceng notifikasi foto bukti yang menaut ke serial itu → `NOT_FOUND` bagi non-manage, bukan galat 500. (Task 1)
2. `ensureSerialUniqueIndex` pada basis data dengan serial ganda lintas BU: tidak membuat `serials_serial` maupun `serials_serial_live`, start tidak gagal, dan pesan peringatan tetap satu. (Task 1)
3. Papan Serah Terima: menghapus task di kolom "Baru" mengurangi `hasMore`/hitungan kolom tanpa memuat ulang semua kolom; filter "Terhapus" hanya untuk `handover: manage`. (Task 2, 4)
4. Centang luring ke task yang kemudian dihapus → saat online, satu toast "ditolak", antrean bersih, papan tidak menampilkan task itu. (Task 4)
5. Menghapus pemetaan varian lama tidak mengubah tampilan tombol desktop Country Lock (Retry/Cancel/Buka web) dan halaman publik `/laporan/$token`. (Task 5)

## Pembagian kelas beban

Sonnet: Task 1-5. Haiku: Task 6. Berurutan.

---

### Task 1: Server Serial — soft delete dan batch hapus/pulihkan

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/serial/{service,repo,validate,routes,bu-history,case-list,case-repo,report,alert-job,public-routes,act}.ts`, `server/src/modules/serial/proof/{service,sweep}.ts`, `server/src/modules/notification/{recipients,repo,serial-proof}.ts`, `server/src/modules/files/service.ts`, `soft-delete-pending.ts`
- Test: `server/src/modules/serial/soft-delete.test.ts` (Create), `serial/rest.test.ts`, `serial/unik-migration.test.ts`

**Interfaces:**
- Produces: `serials.remove` (`DELETE /serials/{id}`), `serials.removeBatch` (`POST /serials/batch/delete`), `serials.restore` (`POST /serials/{id}/restore`), `serials.restoreBatch` (`POST /serials/batch/restore`), semua `serial: manage` pada SEMUA BU serial yang disentuh (di luar hak = `NOT_FOUND` seragam); `serials.list` menerima `status?: 'live' | 'deleted'`; `SerialSummaryDto.deleted?`, `SerialDto.deleted?`. `ensureSerialUniqueIndex` juga membuat `serials_serial_live (serial, deleted_at)` dengan syarat yang sama; `mapDuplicateError` serial memetakan keduanya. Audit `serial.delete|restore` (kejadian `serial_events` TIDAK ditulis untuk hapus/pulihkan; riwayat tetap utuh). Perencana `planSerialRemove/Restore`.
- [ ] **Step 1: Tes gagal**: hapus serial → hilang dari `serials.list`, `serials.lookup`, `serialCases.list`; `GET /api/public/serial-reports/<token>` laporannya → 404 seragam; stok tak berubah; pulihkan saat serial sama hidup → `CONFLICT` "Serial Number ini sudah dicatat ulang"; `serial: edit` saja → rute hapus `FORBIDDEN`; batch dua serial dari BU berbeda, pemanggil `manage` di satu BU saja → `NOT_FOUND`, tak ada yang terhapus; `ensureSerialUniqueIndex` tanpa ganda membuat dua indeks, dengan ganda tidak membuat keduanya; penyapu foto bukti dan job `serial_alert` melewati serial terhapus.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/serial src/modules/notification src/modules/files src/modules/sticker src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): soft delete dan hapus massal Serial Number`.

### Task 2: Server Serah Terima — hapus dan pulihkan per task

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/handover/{service,repo,validate,routes}.ts`, `server/src/modules/notification/{flush,emit,repo,service}.ts` (lonceng/push/SSE melewati task terhapus), `soft-delete-pending.ts`
- Test: `server/src/modules/handover/soft-delete.test.ts` (Create), `handover/rest.test.ts`

**Interfaces:**
- Produces: `handovers.remove` (`DELETE /handovers/{id}?locationId=`), `handovers.restore` (`POST /handovers/{id}/restore`), keduanya `handover: manage` + lokasi (`scope: 'location'`), tanpa penjaga versi (spek §8 butir 6); `handovers.board` menerima `deleted?: boolean` (hanya `handover: manage`; mengembalikan task terhapus dikelompokkan menurut kolom statusnya); `HandoverDto.deleted?`. Hapus membuang `notification_pending` task itu dalam `batch()` yang sama. `setCheck`/`comment`/`save`/`setDone`/`cancel`/`reopen` pada task terhapus → `NOT_FOUND`. Audit `handover.delete|restore`.
- [ ] **Step 1: Tes gagal**: hapus → hilang dari `board` default (hitungan dan `hasMore` kolom tak memuatnya), `get` oleh non-manage → `NOT_FOUND`; `board deleted=true` oleh manage menampilkannya di kolom statusnya; `setCheck` ke task terhapus → `NOT_FOUND`; tunggu notifikasi dibuang; nomor `ST-…` tidak dipakai ulang; pulihkan → kembali ke kolom statusnya.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/handover src/modules/notification src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): hapus dan pulihkan task Serah Terima`.

### Task 3: Web Serial Number — daftar, View, Laporan, Pengaturan, Catat

**Files:**
- Modify: `web/src/modules/serial/components/{serial-list-page,serial-filters,serial-detail-page,timeline-tabs,custody-panel,case-list-page,serial-settings-page,service-locations-settings,record-page,report-page}.tsx`, `web/src/modules/serial/queries.ts`, rute `web/src/routes/_app/serial/*`, `web/src/modules/guide/catalog/serial.ts` (bila langkah perlu `buka: { tab }`)
- Test: tes komponen Serial yang ada, `web/src/modules/guide/catalog/catalog.test.ts`

**Interfaces:**
- Daftar Serial: `ListPage` + `DataTable` [checkbox hanya `serial: manage`][Aksi: Ubah (dialog yang ada), Hapus / Pulihkan][Serial `LinkCell` → View (mono, badge foto)][Item `LinkCell`][BU `LinkCell`][Lokasi `LinkCell`][Tanggal uji][Status][Posisi][Sample]; filter yang ada sebagai `FilterChip` + Status (Hidup/Terhapus bagi manage); `BulkBar`: Hapus / Pulihkan (`serials.removeBatch`/`restoreBatch`); infinite "Muat lebih banyak" tetap.
- View Serial: `ViewPage` tab `detail` (identitas + `CustodyPanel`), `riwayat` (`ActButtons` + `TimelineTabs`; `?case=` membuka tab ini), `foto` (galeri bukti); aksi Ubah, Hapus/Pulihkan, `DeletedBanner`.
- Laporan: `ListPage` + `DataTable` tanpa checkbox; Nomor LP `LinkCell` → `/serial/$id?case=…&tab=riwayat`, Serial/Item/BU `LinkCell`; filter yang ada sebagai chip.
- Pengaturan: `FormPage` + `FormTabs` "Email rusak" (form `SERIAL_ALERT`) dan "Lokasi tim servis" (form sendiri); Simpan header mengikuti tab aktif (pola 4a Konfigurasi Stiker).
- Catat (`/serial/new`) dan Lapor Rusak: bar judul `FormPage` (judul + tombol Simpan yang ada) di atas isi yang ada; tabel draft TIDAK diganti `DataTable` (draft lokal, mode kartu ponsel dipertahankan).
- [ ] **Step 1: Tes gagal**: daftar tanpa checkbox bagi `serial: edit`, dengan checkbox bagi manage; Hapus massal memanggil `serials.removeBatch`; tidak ada tombol "Ubah massal"; View `?case=x` membuka tab Riwayat; Nomor LP menaut ke View serial; Pengaturan: Simpan di tab Lokasi hanya memanggil `serialServiceSettings.save`; tes katalog panduan hijau.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/serial src/modules/guide src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Serial Number di kit dengan View bertab dan hapus massal`.

### Task 4: Web Serah Terima — Kanban, View, form, antrean luring

**Files:**
- Modify: `web/src/modules/handover/components/{handover-board-page,handover-board,handover-card,handover-detail-view,handover-form,handover-batch-form}.tsx`, `web/src/modules/handover/queries.ts`, `web/src/modules/handover/lib/{outbox-flush,outbox-labels}.ts`, `web/public/sync-sw.js`, `web/src/modules/handover/lib/board-snapshot.ts`, rute `web/src/routes/_app/handover/*`
- Test: tes komponen dan lib handover yang ada, `outbox-parity.test.ts`

**Interfaces:**
- Papan desktop memakai `KanbanBoard` (kolom `min-w-[290px]`, gulir horizontal, warna kolom = warna badge status lewat `badgeColorOf(status)` yang dipakai juga badge status task); ponsel tetap daftar kartu + chip status. Filter: chip "Terhapus" (`handover: manage`, memanggil `handovers.board` `deleted: true`); tanpa checkbox. Nama customer di kartu menaut ke View customer (fase 4c).
- View task: `ViewPage` tab `catatan` (NoteView: checklist + komentar) dan `riwayat`; aksi yang ada (Selesai, Buka lagi, Ubah, Batalkan) + Hapus (`ConfirmDeleteDialog`, `handover: manage`) / Pulihkan + `DeletedBanner`.
- Form ubah/buat: bar judul `FormPage` (tombol Simpan yang ada); isi form batch tidak diubah.
- Antrean luring: `NOT_FOUND` dari `setCheck`/`comment` untuk task yang ada di antrean = "rejected" dengan alasan "Task sudah dihapus" di `outbox-flush.ts` DAN `sync-sw.js`; snapshot papan IndexedDB membuang task yang hilang dari respons papan.
- [ ] **Step 1: Tes gagal**: kolom papan memakai warna badge statusnya; chip "Terhapus" tak tampil bagi non-manage; View task terhapus menampilkan banner + Pulihkan; Hapus mengeluarkan task dari cache papan; penguras antrean memperlakukan `NOT_FOUND` setCheck sebagai rejected sekali; `outbox-parity.test.ts` hijau.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/handover src/app src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Serah Terima di Kanban kit dengan hapus dan pulihkan per task`.

### Task 5: Country Lock, hapus pemetaan varian lama, tes kerangka halaman

**Files:**
- Modify: `web/src/modules/countrylock/components/*.tsx` (kerangka + `ActionButton`), semua pemakai varian lama Button (`default`, `destructive`, `secondary`, `outline`, `ghost`, `link` tanpa `color`) / Badge / Alert di `web/src` (cari lewat tes baru), `web/src/components/ui/{button,badge,alert}.tsx` dan `variant-style.ts` (hapus pemetaan lama), `web/src/components/ui/variant-style.test.ts`
- Create: `scripts/no-legacy-variants.test.ts`, `scripts/page-frame.test.ts`
- Test: kedua tes baru + tes web penuh

**Interfaces:**
- `scripts/no-legacy-variants.test.ts`: gagal bila `web/src` (kecuali `components/ui/**` dan tes) memuat `variant="default"`, `variant="destructive"`, `variant="secondary"` pada Button/Badge/Alert, atau `variant="outline"`/`"ghost"`/`"link"` TANPA prop `color` pada Button dan Badge.
- `scripts/page-frame.test.ts` (spek §6.4): setiap berkas rute di `web/src/routes/_app/**` dan `web/src/routes/country-lock.tsx` yang merender halaman memakai salah satu kerangka `ListPage`, `ViewPage`, `FormPage`, `KanbanBoard` (lewat komponen modulnya), atau tercantum di daftar pengecualian bernama beralasan (mis. beranda, halaman publik `/laporan/$token`, Country Lock dengan `PageContainer`); entri basi menggagalkan tes.
- [ ] **Step 1: Tes gagal**: jalankan kedua tes baru → daftar pemakai lama dan halaman pola lama.
- [ ] **Step 2:** Migrasikan setiap pemakai ke `color` + `variant` baru sesuai tabel pemetaan fase 1 (`variant-style.ts`), lalu hapus pemetaan; Country Lock ke kerangka seragam. **Step 3:** `bun run --cwd web test` penuh + `bun run build` (termasuk `verify-dist`) → PASS.
- [ ] **Step 4:** Commit `refactor(web): hapus varian lama dan tegakkan kerangka halaman`.

### Task 6 (Haiku): Dokumentasi, changelog, verifikasi akhir

**Files:**
- Modify: `CLAUDE.md` (Serial 5a/5b: rute hapus/pulihkan, indeks `serials_serial_live`, laporan publik 404 untuk serial terhapus, tanpa ubah massal; Serah Terima: `handovers.remove|restore`, papan `deleted`, antrean luring "Task sudah dihapus"; Aturan frontend: tes `no-legacy-variants` dan `page-frame`, varian lama sudah dihapus), `docs/ci-cd.md` (pengecualian rollback: Serial dan Serah Terima terhapus tampil lagi pada image lama; migrasi contract soft delete dijadwalkan rilis berikutnya)
- Create: `server/changelog.d/20261120-serial-serah-terima-hapus.md` (`jenis: ditambah`; paragraf: Serial Number dan task Serah Terima dapat dihapus dan dipulihkan; halaman detail Serial bertab; papan Serah Terima berwarna per status)
- [ ] **Step 1:** Tulis. **Step 2:** `bun run check` dan `bun run build` → hijau (catat). **Step 3:** Commit `docs: Serial Number dan Serah Terima di kit + soft delete; redesain selesai`.
