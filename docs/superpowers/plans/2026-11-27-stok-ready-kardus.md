# Stok Ready dan Kardus: rencana implementasi

> **Untuk pelaksana:** WAJIB memakai sub-skill superpowers:subagent-driven-development (disarankan) atau superpowers:executing-plans. Langkah memakai kotak centang (`- [ ]`).

**Tujuan:** WH mencatat Ready Stock per kardus bernomor, melihat stoknya di halaman khusus (selang-seling warna per kardus, ecer terpisah), dan meneruskan serial terpilih ke pengeluaran Penjualan tanpa scan ulang.

**Arsitektur:** Tabel `warehouse_ready_boxes` (kardus) dan `warehouse_ready_serials` (serial di stok) ditulis dalam `batch()` yang sama dengan `serialWarehouse.submit` mode ready; pelepasan stok dan penutupan kardus terjadi di `batch()` penyelesaian pengeluaran Penjualan. Daftar stok = rute baca baru `serialWarehouse.readyStock`. Halaman web baru memakai kit `ListPage`/`DataTable` dan mengoper serial terpilih ke draf form Catat Serial WH yang sudah ada.

**Tech Stack:** Bun + Hono + MariaDB (server), React + TanStack (web), zod, bun test (server/shared), vitest (web).

**Spec:** `docs/superpowers/specs/2026-11-27-stok-ready-kardus-design.md` (disetujui pemilik produk 2026-11-27; induk: `2026-11-26-serial-keluar-gudang-design.md`).

## Batasan global

- Migrasi `0043_stok_ready_kardus.sql`: expand-only, idempoten (`IF NOT EXISTS`), tanpa `DROP`, tanpa `PREPARE`/`SET @var`.
- Kontrak aditif tanpa id `@n`; setelah mengubah `shared/api.ts` jalankan `bun run api:snapshot`.
- ID baris = `newId()` (`server/src/core/id.ts`); kolom `key`/`before`/`after` berbacktick; parameter `?`; `SUM`/`COUNT` dibungkus `Number()`.
- Setiap kueri ke `serials` memakai `liveWhere('s')`; tabel baru bukan soft delete. Kueri baru yang tak terdeteksi penjaga wajib didaftarkan di `server/src/core/soft-delete-pending.ts`/`SOFT_DELETE_EXEMPT` hanya bila pemindai memintanya.
- Hak: `serialwh: view` (baca), `serialwh: edit` (catat/keluarkan), per BU, lewat `assertWhBu`/`canWh` (`access.ts`); BU lain = `NOT_FOUND` seragam.
- Field relasi web wajib `LinkField`/`LinkMultiField`; jangan `<select>`; halaman wajib `ListPage`/`ViewPage`/`FormPage`; teks UI Indonesia santai.
- Konvensi jawab/komentar: Indonesia, kata umum. Fragmen changelog `server/changelog.d/20261127-stok-ready-kardus.md` dan `desktop/changelog.d/20261127-stok-ready-kardus.md`.

## Review Focus

1. Kardus melintasi batas potongan (potongan ke-2 melanjutkan kardus terakhir potongan ke-1; kiriman ulang potongan tidak menggandakan kardus atau serial). Tes pada Tugas 3.
2. Sebagian serial dilewati (sudah tercatat WH): nomor kardus tetap rapat tanpa lubang, kardus terakhir menjadi ecer. Tugas 3.
3. Nomor kardus bentrok, nomor lanjutan dari sistem lama (mis. mulai 57), dan nomor dipakai ulang setelah kardusnya kosong (mulai lagi dari 1). Tugas 3 dan 4.
4. Pengeluaran Penjualan yang selesai dari scan langsung (bukan lewat halaman Stok Ready) tetap melepas serial dari stok; dua pengeluaran serentak atas serial yang sama tidak melepas ganda. Tugas 4.
5. Pencatatan ready dibatalkan penyapu: kardus kosong dan baris stok dihapus, nomor bebas lagi. Tugas 4.
6. Paginasi menurut kardus dengan filter: satu kardus tidak terpotong antar halaman; "Pilih N unit" atas seluruh stok terfilter, bukan hanya baris termuat. Tugas 5 dan 7.
7. Pengguna BU lain tidak melihat, tidak memilih, dan tidak melepas stok BU ini. Tugas 5.

## Peta berkas

- Ubah: `shared/serial-warehouse.ts`, `shared/contract.ts`, `shared/api.ts`, `shared/api-contract.snapshot.json`, `server/src/modules/serialwh/{submit,validate,routes,sweep,repo,audit}.ts`, `server/src/modules/item/{validate,service,repo}.ts`, `web/src/modules/item/components/item-form.tsx`, `web/src/modules/serialwh/components/{confirm-dialog,dispatch-page}.tsx`, `web/src/modules/serialwh/lib/{submit,draft}.ts`, `web/src/modules/serialwh/queries.ts`, `web/src/app/navigation.ts`, `CLAUDE.md`, spek induk.
- Baru: `server/migrations/0043_stok_ready_kardus.sql`, `server/src/modules/serialwh/{boxes,stock}.ts`, `web/src/routes/_app/serial/gudang/ready.tsx`, `web/src/modules/serialwh/components/{ready-stock-page,ready-stock-table}.tsx`, `web/src/modules/serialwh/lib/{ready-stock-filter,hand-off}.ts`, fragmen changelog.

---

### Task 1: Fungsi murni dan kontrak bersama

**Berkas:** ubah `shared/serial-warehouse.ts`, `shared/contract.ts`, `shared/api.ts`; tes `shared/serial-warehouse.test.ts`.

**Interfaces:**
- Menghasilkan, di `shared/serial-warehouse.ts`:
  - `WAREHOUSE_BOX_LIMITS = { sizeMax: 1000, numberMax: 999999 }`.
  - `assignBoxes(input: { startNumber: number; size: number; carry?: { number: number; used: number }; count: number }): { number: number; take: number }[]` — membagi `count` serial berurutan ke kardus: lanjut dulu mengisi `carry` (kardus terbuka dengan `used` unit), lalu kardus baru bernomor naik; `take` jumlah serial per kardus.
  - `boxKindOf(remaining: number, capacity: number): 'full' | 'loose'` (`remaining >= capacity` = `full`).
  - `pickByOrder(boxes: { id: string; number: number; kind: 'full' | 'loose'; serialIds: string[] }[], count: number): string[]` — memilih `count` serial mengikuti nomor kardus naik, kardus `full` lebih dulu lalu `loose`.
  - `readyStockClipboard(rows: { box: number; serial: string }[]): string` — teks `Kardus\tSerial` per baris, CRLF tidak dipakai (`\n`).
- Di `shared/contract.ts`: `WarehouseSubmitHeader.boxStart?: number`, `boxSize?: number` (wajib bersama pada `mode: 'ready'`, ditolak pada `order`); `ItemDto.boxSize: number` dan `SaveItemInput.boxSize?: number`; `ReadyStockSerialDto { id: string; serial: string; boxId: string; boxNumber: number; capacity: number; recordedOn: string; processing: boolean }`; `ReadyStockBoxDto { id: string; number: number; capacity: number; remaining: number; kind: 'full' | 'loose'; serials: ReadyStockSerialDto[] }`; `ListReadyStockInput { buIds?: string[]; itemIds?: string[]; query?: string; cursor?: string; limit?: number; pickCount?: number }`; `ReadyStockPageDto { boxes: ReadyStockBoxDto[]; nextCursor: string | null; totals: { units: number; fullBoxes: number; looseBoxes: number; maxBoxNumber: number }; picked?: string[] }`.
- Di `shared/api.ts`: `'serialWarehouse.readyStock': { verb: 'GET', path: '/serial-warehouse/ready-stock', query: { buIds: 'list', itemIds: 'list', query: 'string', cursor: 'string', limit: 'number', pickCount: 'number' } }` (ikuti bentuk query rute `serialWarehouse.dispatchList`).

- [ ] **Langkah 1: tes gagal** di `shared/serial-warehouse.test.ts`: `assignBoxes({startNumber:12,size:10,count:25})` = `[{12,10},{13,10},{14,5}]`; dengan `carry:{number:11,used:4}` dan `count:8` = `[{11,6},{12,2}]` (start 12, size 10); `count:0` = `[]`; `boxKindOf(10,10)`=`full`, `boxKindOf(5,10)`=`loose`; `pickByOrder` untuk kardus 1-3 penuh dan 4 ecer dengan `count:35` memilih 10+10+10 dari kardus 1-3 lalu 5 dari kardus ecer berikutnya (penuh lebih dulu: kardus penuh 5 didahulukan atas ecer 4, uji urutan itu); `readyStockClipboard([{box:3,serial:'A'}])` = `'Kardus\tSerial\n3\tA'`.
- [ ] **Langkah 2:** jalankan `bun test shared/serial-warehouse.test.ts`; harus GAGAL (fungsi belum ada).
- [ ] **Langkah 3:** implementasikan keempat fungsi dan tipe di atas; tambah rute di `shared/api.ts`; jalankan `bun run api:snapshot`.
- [ ] **Langkah 4:** `bun test shared`; harus lulus (termasuk `shared/api.test.ts` yang menjaga tabel dan kontrak sejalan).
- [ ] **Langkah 5:** commit `feat(serialwh): fungsi murni dan kontrak stok ready per kardus`.

### Task 2: Migrasi dan field pcs/kardus pada Item

**Berkas:** buat `server/migrations/0043_stok_ready_kardus.sql`; ubah `server/src/modules/item/{validate,service,repo}.ts`, `web/src/modules/item/components/item-form.tsx` dan `item-detail-view.tsx`; ubah `server/src/core/migrate.test.ts` bila daftar migrasi/indeks dijaga di sana; tes `server/src/modules/item/box-size.test.ts`.

**Interfaces:**
- Menghasilkan: kolom `items.box_size INT NOT NULL DEFAULT 0`; tabel `warehouse_ready_boxes (id VARCHAR(100), bu_id VARCHAR(100), item_id VARCHAR(100), number INT, capacity INT, dispatch_id VARCHAR(100), closed_key VARCHAR(100) NOT NULL DEFAULT '', created_at VARCHAR(30), created_by VARCHAR(254), PRIMARY KEY (id), UNIQUE KEY warehouse_ready_boxes_open (bu_id, item_id, number, closed_key), KEY warehouse_ready_boxes_dispatch (dispatch_id))`; tabel `warehouse_ready_serials (serial_id VARCHAR(100), box_id VARCHAR(100), dispatch_id VARCHAR(100), seq INT, released_dispatch_id VARCHAR(100) NOT NULL DEFAULT '', PRIMARY KEY (serial_id), KEY warehouse_ready_serials_box (box_id, released_dispatch_id), KEY warehouse_ready_serials_dispatch (dispatch_id))`; semuanya `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin`.
- `ItemDto.boxSize` dibaca dari kolom; `SaveItemInput.boxSize` opsional (tak dikirim = tak diubah), bilangan bulat 0..`WAREHOUSE_BOX_LIMITS.sizeMax`.

- [ ] **Langkah 1: tes gagal** `box-size.test.ts`: simpan item dengan `boxSize: 12` lalu `items.get` mengembalikan `boxSize: 12`; `boxSize: -1`, `1001`, dan `1.5` ditolak `VALIDATION`; tidak mengirim `boxSize` pada simpan ulang tidak mengubah nilainya.
- [ ] **Langkah 2:** jalankan tes itu; harus GAGAL.
- [ ] **Langkah 3:** tulis migrasi dan perluas validator, layanan, repo item (pola kolom `firmware`, `0023_firmware_item.sql`); tambah `Input` angka "Pcs per kardus" di form Item (ikuti field bertipe angka yang ada) dan baris di View Item bila > 0.
- [ ] **Langkah 4:** `bun run --cwd server test src/modules/item` dan `bun run --cwd server test src/core/migrate`; web `vitest run src/modules/item`; harus lulus.
- [ ] **Langkah 5:** commit `feat(item): field pcs per kardus dan tabel kardus ready`.

### Task 3: Mencatat ready dengan kardus

**Berkas:** buat `server/src/modules/serialwh/boxes.ts`; ubah `submit.ts`, `validate.ts`, `audit.ts`; tes `server/src/modules/serialwh/boxes.test.ts`.

**Interfaces:**
- Mengonsumsi: `assignBoxes`, `WarehouseSubmitHeader.boxStart/boxSize` (Tugas 1), tabel Tugas 2.
- Menghasilkan di `boxes.ts`: `boxStatements(env: Env, input: { dispatchId: string; buId: string; itemId: string; header: { boxStart: number; boxSize: number }; serialIds: string[]; firstSeq: number; user: string; now: string }): Promise<DbStatement[]>` — membaca kardus terbuka milik `dispatchId` (nomor tertinggi dan `used`) lalu memakai `assignBoxes` dengan `carry`; mengembalikan `INSERT` kardus baru (id `newId()`) dan `INSERT` `warehouse_ready_serials` per serial (`seq` = urutan global `firstSeq + i`).
- `headerHash` (`submit.ts:63`) memuat `boxStart` dan `boxSize` agar kiriman ulang berbeda ditolak "Isi pengeluaran berubah".

- [ ] **Langkah 1: tes gagal** `boxes.test.ts` (pakai `seedWarehouseWorld`, `submitDispatch` dari `@server-test/warehouse-fixtures`; perluas `submitDispatch` agar menerima `boxStart`, `boxSize`): (a) 25 serial baru, `boxStart 12`, `boxSize 10` → kardus 12 (10), 13 (10), 14 (5); (b) pengiriman 25 serial dalam potongan 10 → hasil identik dengan (a); kardus 14 hanya dibuat sekali (potongan ke-2 menyambung kardus 12, potongan ke-3 melengkapi 13 dan 14); (c) kiriman ulang potongan yang sama tidak menambah kardus atau serial; (d) tiga serial dalam potongan dilewati (sudah tercatat WH) → kardus terakhir menjadi ecer dan nomor rapat; (e) `boxStart 12` saat kardus 12 sudah terbuka untuk BU dan Tipe yang sama → ditolak `VALIDATION` pada field `boxStart` dengan pesan "Nomor kardus sudah dipakai"; (f) `mode: 'order'` dengan `boxStart` ditolak; `mode: 'ready'` tanpa `boxSize` ditolak; `boxSize 0` ditolak; (g) audit `serialwh.ready_create` memuat `boxFrom` dan `boxTo`.
- [ ] **Langkah 2:** `bun run --cwd server test src/modules/serialwh/boxes.test.ts`; harus GAGAL.
- [ ] **Langkah 3:** validasi header di `validate.ts` (pola validasi `mode` ready yang ada); panggil `boxStatements` di `submitOnce` hanya bila `ready`, setelah `plans` final (setelah semua penyaringan lewati) dan sebelum pernyataan penyelesaian; bentrok nomor diperiksa dengan `SELECT` kardus terbuka sebelum membangun dan dijaga indeks unik (galat duplikat dipetakan ke pesan yang sama lewat `mapFinalError`).
- [ ] **Langkah 4:** jalankan seluruh `bun run --cwd server test src/modules/serialwh`; harus lulus.
- [ ] **Langkah 5:** commit `feat(serialwh): catat ready per kardus dengan nomor dan isi`.

### Task 4: Pelepasan stok, penutupan kardus, dan penyapu

**Berkas:** ubah `submit.ts`, `sweep.ts`; tes `server/src/modules/serialwh/release.test.ts`.

**Interfaces:**
- Menghasilkan di `boxes.ts`: `releaseStatements(env: Env, dispatchId: string): DbStatement[]` — dua pernyataan berurutan: (1) `UPDATE warehouse_ready_serials SET released_dispatch_id = ? WHERE released_dispatch_id = '' AND serial_id IN (SELECT serial_id FROM warehouse_dispatch_serials WHERE dispatch_id = ?) AND EXISTS (SELECT 1 FROM warehouse_dispatches WHERE id = ? AND status = 'done' AND kind = 'order')`; (2) `UPDATE warehouse_ready_boxes SET closed_key = id WHERE closed_key = '' AND NOT EXISTS (SELECT 1 FROM warehouse_ready_serials r WHERE r.box_id = warehouse_ready_boxes.id AND r.released_dispatch_id = '')`.
  - `cancelReadyStatements(env: Env, dispatchId: string): DbStatement[]` — `DELETE` baris `warehouse_ready_serials` dan `warehouse_ready_boxes` milik `dispatchId` (hanya dipakai bagi pencatatan ready yang dibatalkan).

- [ ] **Langkah 1: tes gagal** `release.test.ts`: (a) catat ready 25 serial (kardus 1-3 → 10,10,5), lalu pengeluaran Penjualan SO untuk 12 serial dari kardus 1-2 melalui scan langsung → `released_dispatch_id` terisi di 12 serial itu dan kardus 1 tertutup (`closed_key = id`), kardus 2 masih terbuka; (b) pengeluaran masih pending (potongan belum lengkap) tidak melepas apa pun; (c) dua pengeluaran Penjualan serentak (`Promise.all`) atas serial ready yang sama tidak membuat galat dan `released_dispatch_id` menunjuk tepat satu dari keduanya; (d) setelah semua kardus 1 tertutup, nomor 1 bebas: pencatatan ready baru dengan `boxStart 1` berhasil; (e) `sweepStaleDispatches` atas pencatatan ready pending > 7 hari menghapus kardus dan baris stoknya, dan nomor kardus itu bebas lagi; pengeluaran SO yang disapu tidak mengubah stok ready.
- [ ] **Langkah 2:** jalankan tes itu; harus GAGAL.
- [ ] **Langkah 3:** tambahkan `releaseStatements` setelah pernyataan pembaruan status dan sebelum audit penyelesaian di `submitOnce` untuk mode `order`; tambahkan `cancelReadyStatements` di `sweep.ts` untuk dispatch `kind = 'ready'` (dalam batch pembatalan yang sama).
- [ ] **Langkah 4:** `bun run --cwd server test src/modules/serialwh`; harus lulus.
- [ ] **Langkah 5:** commit `feat(serialwh): pelepasan stok ready saat pengeluaran selesai dan pembersihan penyapu`.

### Task 5: Rute daftar Stok Ready

**Berkas:** buat `server/src/modules/serialwh/stock.ts`; ubah `routes.ts`, `validate.ts`; tes `server/src/modules/serialwh/stock.test.ts`.

**Interfaces:**
- Mengonsumsi: tipe `ListReadyStockInput`/`ReadyStockPageDto` (Tugas 1), `boxKindOf`, `pickByOrder`.
- Menghasilkan: `listReadyStock(env: Env, user: UserContext, input: ListReadyStockInput): Promise<ReadyStockPageDto>`; terdaftar di `routes.ts` sebagai `serialWarehouse.readyStock` dengan izin `serialwh: view`.

Aturan: serial di stok = baris `warehouse_ready_serials` dengan `released_dispatch_id = ''`, pencatatan readynya `status = 'done'`, dan serial hidup (`liveWhere('s')`); `processing` = serial ada di pengeluaran `kind = 'order'` berstatus `pending`. BU dibatasi `serialwh: view` pengguna (irisan dengan `buIds`). `query` mencocokkan teks serial dan nomor kardus. Urutan: kardus `full` dulu (nomor naik), lalu `loose`; kursor = `<bagian>|<nomor>|<id>`; `limit` bawaan 20 kardus, maks. 50; satu kardus utuh selalu di satu halaman. `totals` menghitung seluruh hasil terfilter, bukan hanya halaman; `maxBoxNumber` = nomor kardus terbuka tertinggi pada hasil terfilter (0 bila kosong; dipakai nilai awal "nomor kardus awal" di dialog simpan, jadi klien memanggil rute dengan filter BU dan Tipe yang sama dan `limit: 1`). `pickCount` mengisi `picked` = `pickByOrder` atas seluruh hasil terfilter (serial `processing` dikecualikan).

- [ ] **Langkah 1: tes gagal** `stock.test.ts`: (a) stok contoh Tugas 4 (kardus 1-3) tampil dengan `kind` benar dan `remaining` setelah sebagian keluar; kardus yang sebagian keluar berubah `loose`; (b) serial `processing` tampil bertanda dan tidak ikut `picked`; (c) filter `itemIds` dan `query` (nomor kardus dan serial); (d) paginasi `limit: 2` tanpa memotong kardus dan tanpa tumpang tindih; (e) `pickCount: 35` pada stok 3 kardus penuh + 1 ecer mengembalikan 35 id yang urut kardus; `totals` (termasuk `maxBoxNumber`) tidak bergantung halaman; (f) pengguna BU lain mendapat daftar kosong, pengguna tanpa `serialwh: view` ditolak; serial terhapus tidak tampil; pencatatan ready `pending` tidak tampil.
- [ ] **Langkah 2:** jalankan tes itu; harus GAGAL.
- [ ] **Langkah 3:** implementasikan `listReadyStock` (satu kueri kardus lalu satu kueri serial per halaman kardus; `pickCount` dari kueri ringkas id saja); daftarkan rute dan validator (`readFilterList` untuk `buIds`/`itemIds`).
- [ ] **Langkah 4:** `bun run --cwd server test src/modules/serialwh` dan `bun run --cwd server test src/core/soft-delete-guard` (pemindai harus tidak menandai kueri baru); lulus.
- [ ] **Langkah 5:** commit `feat(serialwh): rute daftar Stok Ready`.

### Task 6: Isian kardus di dialog simpan (web)

**Berkas:** ubah `web/src/modules/serialwh/components/confirm-dialog.tsx`, `dispatch-page.tsx`, `web/src/modules/serialwh/lib/submit.ts`; tes `confirm-dialog.test.tsx`, `lib/submit.test.ts`.

**Interfaces:**
- Mengonsumsi: `assignBoxes`, `WarehouseSubmitHeader.boxStart/boxSize`; `items.boxSize` dari pilihan Item (perluas `warehouse itemOptions` hanya bila `ItemDto.boxSize` belum tersedia di data Item halaman; bila perlu tambah `boxSize` aditif ke opsi Item Gudang di kontrak).
- Menghasilkan: `ConfirmValues.boxStart?: number`, `boxSize?: number` (hanya bila Tujuan = Ready Stock); `buildHeader` di `lib/submit.ts` meneruskan keduanya ke `header`.

Perilaku: bila Tujuan Ready Stock, dialog menampilkan "Nomor kardus awal" (bawaan = nomor kardus tertinggi untuk BU dan Tipe + 1; bila belum diketahui, 1) dan "Isi per kardus" (bawaan = `boxSize` Item; wajib > 0); di bawahnya ringkasan perkiraan ("Kardus 12-14: 2 penuh, 1 ecer (5 unit)") dari `assignBoxes` atas jumlah baris yang akan disimpan; pesan galat "Nomor kardus sudah dipakai" dari server tampil pada field nomor.

- [ ] **Langkah 1: tes gagal:** dialog Ready Stock menampilkan dua field dan ringkasan (25 baris, isi 10, awal 12 → "12-14", "2 penuh", "1 ecer (5 unit)"); Simpan terblokir bila isi kosong atau 0; nilai terkirim di `onConfirm`; mode Penjualan tidak menampilkannya; `submit.test.ts`: header mode ready memuat `boxStart`/`boxSize`, mode order tidak.
- [ ] **Langkah 2:** `bunx vitest run src/modules/serialwh` dari `web`; harus GAGAL pada tes baru.
- [ ] **Langkah 3:** implementasikan field dan ringkasan di `confirm-dialog.tsx`; kirim dari `dispatch-page.tsx` ke `buildHeader`; ambil `totals.maxBoxNumber` lewat `serialWarehouse.readyStock` dengan filter BU dan Tipe dialog (`limit: 1`); nilai awal = `maxBoxNumber + 1`.
- [ ] **Langkah 4:** `bunx tsc --noEmit`, `bunx biome check --write src/modules/serialwh`, `bunx vitest run src/modules/serialwh`; lulus.
- [ ] **Langkah 5:** commit `feat(serialwh): isian nomor dan isi kardus pada dialog simpan ready`.

### Task 7: Halaman Stok Ready (web)

**Berkas:** buat `web/src/routes/_app/serial/gudang/ready.tsx`, `web/src/modules/serialwh/components/{ready-stock-page,ready-stock-table}.tsx`, `lib/{ready-stock-filter,hand-off}.ts`; ubah `web/src/modules/serialwh/queries.ts`, `web/src/app/navigation.ts`, `web/src/modules/serialwh/components/dispatch-page.tsx` (membaca serial oper); tes `ready-stock-page.test.tsx`, `lib/hand-off.test.ts`.

**Interfaces:**
- Mengonsumsi: `serialWarehouse.readyStock`, `readyStockClipboard`, `ReadyStockBoxDto`.
- Menghasilkan: `readyStockQueryOptions(filter: ReadyStockFilter)` (infinite, kursor), `parseReadyStockFilter`/`toReadyStockInput` di `lib/ready-stock-filter.ts` (search param `buIds`, `itemIds`, `query`); `handOffToDispatch(rows: { serialId: string; serial: string; itemId: string; buId: string }[]): void` di `lib/hand-off.ts` — menulis baris `existing` ke draf form Catat Serial WH lewat `draft-store.ts` lalu mengembalikan kontrol agar pemanggil menavigasi ke `/serial/gudang` (draf yang sudah ada tidak ditimpa: baris ditambahkan di akhir, ganda dilewati); menolak (melempar `Error` berpesan "Terlalu banyak serial untuk satu pengeluaran") bila melebihi `WAREHOUSE_LIMITS` baris draf.

Perilaku halaman: `ListPage` bertajuk "Stok Ready"; butir sidebar "Stok Ready" di grup Serial Number bagi `serialwh: view`; chip filter BU, Tipe (`LinkMultiField`), dan kotak cari; ringkasan `totals` di atas tabel; dua bagian tabel ("Kardus penuh", lalu "Ecer") dengan baris berwarna selang-seling per kardus (token warna yang ada, bukan palet mentah; tes memeriksa atribut `data-box-tone="a|b"` bergantian antar kardus berurutan dan sama dalam satu kardus); kolom Kardus (`nomor` dan "sisa/kapasitas"), Tipe, Serial Number, tanggal dicatat; kotak centang per serial dan per kardus (kit pilih rentang `DataTable`); serial `processing` bertanda "Sedang diproses" dan nonaktif; `BulkBar` dengan aksi "Keluarkan ke Penjualan" (hanya `serialwh: edit`), "Salin ke clipboard" (teks `readyStockClipboard`), dan isian "Pilih N unit sesuai urutan" (memanggil rute dengan `pickCount`, mengisi pilihan dari `picked`; pilihan tetap dapat diubah); muat halaman berikutnya lewat sentinel kit (kardus utuh per halaman).

- [ ] **Langkah 1: tes gagal** `hand-off.test.ts`: menambah baris ke draf kosong, tidak menimpa draf yang ada, melewati serial yang sudah ada di draf, melempar bila melewati batas baris draf. `ready-stock-page.test.tsx` (mock `api`): dua bagian dan zebra sesuai di atas; memilih satu kardus memilih semua serialnya yang bisa dipilih; "Pilih N unit" memanggil rute dengan `pickCount` lalu mencentang `picked`; "Salin ke clipboard" menyalin teks tab-terpisah; "Keluarkan ke Penjualan" memanggil `handOffToDispatch` dengan serial terpilih dan menavigasi ke `/serial/gudang`; pengguna `serialwh: view` tanpa edit tidak melihat tombol Keluarkan; serial `processing` tidak dapat dicentang; keadaan kosong, galat + Coba lagi (`ListState`).
- [ ] **Langkah 2:** `bunx vitest run src/modules/serialwh`; harus GAGAL pada tes baru.
- [ ] **Langkah 3:** implementasikan rute (`staticData` mengikuti rute `riwayat/index.tsx`; `crumb` wajib; jangan memasang `pageWidth`), komponen, kueri, nav (`web/src/app/navigation.ts` di dekat butir "Riwayat Gudang"; perbarui `excludes`/`alsoActiveOn` bila perlu agar butir Serial Number tidak ikut aktif), dan pembaca serial oper di `dispatch-page.tsx` (draf dibaca `draft-store.ts` saat halaman dibuka; Item draf mengikuti Item baris pertama bila draf kosong).
- [ ] **Langkah 4:** `bunx tsc --noEmit`, `bunx biome check --write src`, `bunx vitest run src/modules/serialwh src/app src/components/page` (jalankan di latar, keluaran ke berkas; berkas besar lambat); tes cakupan rute `route-meta-coverage.test.ts` dan penjaga navigasi ponsel harus lulus.
- [ ] **Langkah 5:** commit `feat(serialwh): halaman Stok Ready per kardus dan oper ke pengeluaran`.

### Task 8: Dokumen, changelog, dan pemeriksaan akhir

**Berkas:** ubah `CLAUDE.md`, `docs/superpowers/specs/2026-11-26-serial-keluar-gudang-design.md`; buat dua fragmen changelog.

- [ ] **Langkah 1:** tambahkan butir keputusan 35 pada spek induk (Stok Ready dan kardus, menunjuk spek ini, tanggal 2026-11-27, disetujui pemilik produk) dan perbarui 5.16 yang menyebut "dapat dikeluarkan belakangan"; perbarui `CLAUDE.md` pada butir Keluar Gudang (tabel baru, rute `serialWarehouse.readyStock`, halaman `/serial/gudang/ready`, `items.box_size`, migrasi `0043`, jumlah rute potret).
- [ ] **Langkah 2:** fragmen `server/changelog.d/20261127-stok-ready-kardus.md` (`feat(serialwh): ...`, `feat(item): ...`) dan `desktop/changelog.d/20261127-stok-ready-kardus.md` (web ikut dibundel desktop).
- [ ] **Langkah 3:** pemeriksaan akhir: `bun run api:snapshot --check`, `bun run --cwd server test src/modules/serialwh src/modules/item src/core`, `bun test shared`, `bunx vitest run src/modules/serialwh src/modules/item src/app src/components/page` (dari `web`), `bunx tsc --noEmit` (web dan server), `bunx biome check`; semua harus lulus. Terowongan `bun run db:tunnel` wajib hidup untuk tes server.
- [ ] **Langkah 4:** commit `docs(serialwh): Stok Ready per kardus (spek, CLAUDE.md, changelog)`.
