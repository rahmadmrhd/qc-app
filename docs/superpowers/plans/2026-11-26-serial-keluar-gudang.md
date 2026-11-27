# Serial Number: Keluar Gudang (WH) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tim WH dapat memilih serial yang sudah ada (atau membuatnya bila belum ada) untuk satu SO, menyimpannya sebagai satu pengeluaran, dan menyalin daftar SN ke clipboard; ditambah Riwayat per SO, tautan ke task Serah Terima, petunjuk Item dari catatan task (5.14), saran Item saat mengetik checklist (5.15), serta badge/filter "Tercatat WH" dan "Butuh foto" di daftar Serial (bagian 8).

**Spek:** `docs/superpowers/specs/2026-11-26-serial-keluar-gudang-design.md` (bagian 4, 5.1-5.12, 5.14, 5.15, 8, 9, 12, 13). Bagian C (filter "Dicatat oleh") dan kit pilih rentang 5.13 (`web/src/components/data-table/selection-range.ts`, `use-range-select.ts`, `use-drag-select.ts`) SUDAH ada di `origin/dev` dan hanya DIPAKAI di sini. Bagian B (peringatan scan ulang QC) TIDAK ditemukan di `origin/dev` (tidak ada dialog "Lanjut menyimpan", `SerialExistingDto` tanpa lokasi/pelaku terbaru): di luar rencana ini sampai pemilik memutuskan (lihat "Menunggu keputusan pemilik").

**Architecture:** Modul server baru `server/src/modules/serialwh/` di jalur REST `/serial-warehouse/...` (grup kontrak `serialWarehouse`), terpisah dari modul `serial` agar tak berebut urutan dengan `/serials/{id}`. Pengiriman pengeluaran bertahap per potongan (maks. 200 serial, satu `batch()` per potongan, idempoten per `clientId` + nomor potongan). Serial baru dibuat dengan pembangun pernyataan yang diekstrak dari `createSerialOnce` (tanpa foto bukti), stok stiker terpotong lewat bus event `serial.recorded` yang sama. Web: modul `web/src/modules/serialwh/` dengan tiga rute di bawah `/serial/gudang`. Izin baru `serialwh` per BU (`BU_MODULES`).

**Tech Stack:** Bun + Hono + MariaDB 11.8 (adaptor `Db`, `batch()`, CAS), React + TanStack Router/Query/Form, Tiptap 3.31.4 (+ `@tiptap/suggestion@3.31.4`), vitest (web), `bun:test` (server/shared).

**Aturan proyek yang wajib dipatuhi semua jalur** (dari `CLAUDE.md`): ID baris `newId()`; `clientId` UUID huruf kecil (`newUuid()` di web); tak ada baca-lalu-tulis tanpa CAS (`CAS_FAIL_SQL`) atau `FOR UPDATE`; setiap `FROM`/`JOIN` ke tabel ber-soft-delete memakai `liveWhere`/perbandingan `deleted_at` di literal kueri; field relasi = `LinkField`/`LinkMultiField` (pengecualian: combobox No SO dan customer, teks bebas yang membuat record); tanpa `<select>` bawaan; tanpa `<input type="file">`; halaman memakai kit (`FormPage`/`ListPage`/`ViewPage`); kontrak hanya aditif (tanpa `@2`); bahasa UI santai, "Serial Number" lengkap pada judul.

---

## 1. Struktur berkas dan kontrak terkunci

Bagian ini adalah kontrak bersama. Jalur paralel TIDAK boleh mengubahnya; perubahan kontrak = kembali ke pengendali (orkestrator) dan diputuskan sekali.

### 1.1 Peta berkas (baru = B, ubah = U)

Server
- B `server/migrations/0040_serial_keluar_gudang.sql` (spek menyebut 0038; nomor bebas nyata di `origin/dev` = 0040)
- B `server/src/modules/serialwh/` : `routes.ts`, `access.ts`, `validate.ts`, `validate-links.ts`, `repo.ts`, `options.ts`, `scan.ts`, `submit.ts`, `orders.ts`, `sweep.ts`, `handover-links.ts`, `handover-candidates.ts`, `audit.ts`, beserta `*.test.ts`
- B `server/src/modules/serial/new-serial.ts` (pembangun pernyataan serial baru, diekstrak dari `createSerialOnce`)
- B `server/src/modules/serial/wh-flags.ts` (fragmen SQL `whRecorded`/`needsProof`)
- U `server/src/modules/serial/service.ts` (pakai `new-serial.ts`; `toSummary` + `listSerials` bagian 8), `repo.ts` (kolom + filter daftar), `validate.ts` (param `serials.list` baru)
- U `server/src/routes.ts` (daftarkan `serialwhRoutes()`), `server/src/jobs/runner.ts` (penyapu), `server/src/core/soft-delete-pending.ts` (pengecualian beralasan)
- U `server/src/modules/item/routes.ts` + B `server/src/modules/item/name-options.ts` (rute `items.nameOptions`, 5.15)
- U `server/src/modules/handover/service.ts` (aditif `detectedItems`, 5.14/5.15 lencana untuk pembaca; jalur F, dapat dipisah)

Shared
- B `shared/serial-warehouse.ts` (+ tes): batas, normalisasi No SO, teks clipboard, ukuran potongan, label "Dicatat Gudang"
- B `shared/item-detect.ts` (+ tes): pencocokan nama Item di catatan (5.14)
- B `shared/item-suggest.ts` (+ tes): pencocok saran checklist (5.15)
- U `shared/permissions.ts`, `shared/business-units.ts`, `shared/contract.ts`, `shared/api.ts`, `shared/api-versions.ts`, `shared/api-contract.snapshot.json`

Web
- B `web/src/modules/serialwh/` : `keys.ts`, `queries.ts`, `lib/*`, `components/*`
- B rute `web/src/routes/_app/serial/gudang/index.tsx`, `web/src/routes/_app/serial/gudang/riwayat/index.tsx`, `web/src/routes/_app/serial/gudang/riwayat/$orderId.tsx`; U `web/src/routeTree.gen.ts` (dibangkitkan)
- U `web/src/app/navigation.ts`, `web/src/app/module-links.ts`, `web/src/modules/auth/permissions.ts`, `web/src/modules/guide/catalog/serial.ts`
- U `web/src/modules/handover/components/handover-detail-view.tsx` (aksi "Keluar Gudang"), `web/src/components/action-button.tsx` (aksi `warehouse`)
- B `web/src/modules/handover/lib/item-suggest-extension.ts`, `web/src/modules/handover/components/item-suggest-list.tsx`, `web/src/modules/handover/components/item-badges.tsx`; U `note-editor.tsx`, `note-view.tsx`; U `web/package.json` + `bun.lock`
- U daftar/detail Serial: `web/src/modules/serial/components/serial-list-page.tsx`, `serial-filters.tsx`, `web/src/modules/serial/lib/list-filter.ts`, `web/src/modules/serial/components/timeline.tsx` (label kejadian)

Dokumen: `CLAUDE.md`, spek induk dan dua spek terkait, `server/changelog.d/20261126-serial-keluar-gudang.md`, `desktop/changelog.d/20261126-serial-keluar-gudang.md`, `docs/e2e-checklist.md`.

### 1.2 Migrasi `0040_serial_keluar_gudang.sql` (expand-only, idempoten, bukan contract)

```sql
-- Keluar Gudang (spek 2026-11-26 Bagian A). Expand-only, idempoten; image lama mengabaikan kolom/tabel baru.
ALTER TABLE serials ADD COLUMN IF NOT EXISTS wh_created TINYINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS serials_wh_created ON serials (wh_created, deleted_at);

-- Catatan SO: satu SO satu BU (bu_id tetap), No SO unik se-sistem tanpa beda huruf (kolom `key`). Bukan soft delete.
CREATE TABLE IF NOT EXISTS warehouse_orders (
  id VARCHAR(100) NOT NULL,
  number VARCHAR(64) NOT NULL,
  `key` VARCHAR(64) NOT NULL,
  bu_id VARCHAR(100) NOT NULL,
  customer_id VARCHAR(100) NOT NULL DEFAULT '',
  customer_name VARCHAR(255) NOT NULL DEFAULT '',
  last_dispatched_on VARCHAR(10) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL,
  created_by VARCHAR(254) NOT NULL,
  updated_at VARCHAR(30) NOT NULL,
  updated_by VARCHAR(254) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY warehouse_orders_key (`key`),
  KEY warehouse_orders_bu_updated (bu_id, updated_at),
  KEY warehouse_orders_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS warehouse_order_handovers (
  order_id VARCHAR(100) NOT NULL,
  handover_id VARCHAR(100) NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  created_by VARCHAR(254) NOT NULL,
  PRIMARY KEY (order_id, handover_id),
  KEY warehouse_order_handovers_handover (handover_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Pengeluaran: status pending|done|cancelled (cancelled = penyapu 7 hari). header_hash = sha256 kolom tetap kanonis.
CREATE TABLE IF NOT EXISTS warehouse_dispatches (
  id VARCHAR(100) NOT NULL,
  order_id VARCHAR(100) NOT NULL,
  client_id VARCHAR(36) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  dispatched_on VARCHAR(10) NOT NULL,
  note TEXT NOT NULL,
  mode VARCHAR(16) NOT NULL DEFAULT 'clipboard',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  header_hash VARCHAR(64) NOT NULL,
  chunk_size INT NOT NULL,
  chunk_count INT NOT NULL,
  chunks_received INT NOT NULL DEFAULT 0,
  serial_total INT NOT NULL,
  created_count INT NOT NULL DEFAULT 0,
  created_at VARCHAR(30) NOT NULL,
  created_by VARCHAR(254) NOT NULL,
  completed_at VARCHAR(30) NOT NULL DEFAULT '',
  cancelled_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY warehouse_dispatches_client_id (client_id),
  KEY warehouse_dispatches_order (order_id, created_at),
  KEY warehouse_dispatches_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS warehouse_dispatch_chunks (
  dispatch_id VARCHAR(100) NOT NULL,
  chunk_index INT NOT NULL,
  received_at VARCHAR(30) NOT NULL,
  PRIMARY KEY (dispatch_id, chunk_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

-- Satu serial paling banyak sekali per SO (termasuk pengeluaran pending); baris dibuang saat pengeluaran dibatalkan.
CREATE TABLE IF NOT EXISTS warehouse_dispatch_serials (
  dispatch_id VARCHAR(100) NOT NULL,
  order_id VARCHAR(100) NOT NULL,
  serial_id VARCHAR(100) NOT NULL,
  serial VARCHAR(64) NOT NULL,
  seq INT NOT NULL,
  created_new TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (dispatch_id, seq),
  UNIQUE KEY warehouse_dispatch_serials_order_serial (order_id, serial_id),
  KEY warehouse_dispatch_serials_serial (serial_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
```

Nama indeks yang didaftarkan di `server/src/core/migrate.test.ts` (daftar `tabel.indeks`): `serials.serials_wh_created`, `warehouse_orders.warehouse_orders_key`, `warehouse_orders.warehouse_orders_bu_updated`, `warehouse_orders.warehouse_orders_customer`, `warehouse_order_handovers.warehouse_order_handovers_handover`, `warehouse_dispatches.warehouse_dispatches_client_id`, `warehouse_dispatches.warehouse_dispatches_order`, `warehouse_dispatches.warehouse_dispatches_status`, `warehouse_dispatch_serials.warehouse_dispatch_serials_order_serial`, `warehouse_dispatch_serials.warehouse_dispatch_serials_serial`. Tabel baru masuk `EXPECTED_TABLES` (5 tabel; judul tes "46 tabel" naik menjadi 51), nama migrasi `0040_serial_keluar_gudang.sql` masuk daftar nama.

Peta konflik indeks (nama dasar lewat `baseIndexName`): `warehouse_orders_key` = balapan SO, `warehouse_dispatch_serials_order_serial` = "Sudah ada di SO ini", `warehouse_dispatches_client_id` = kiriman ulang, `serials_serial_live` = balapan serial draf.

### 1.3 Izin `serialwh`

- `shared/permissions.ts`: `MODULES` tambah `'serialwh'` (setelah `serialservice`); `MODULE_LABELS.serialwh = 'Gudang Serial Number'`; `MODULE_LEVELS.serialwh = ['none', 'view', 'edit']`; hint `view`: "Melihat Riwayat Keluar Gudang (catatan SO) pada BU penugasan dan menyalin ulang daftar Serial Number.", `edit`: "Melihat serta mencatat Keluar Gudang: memilih atau membuat Serial Number untuk sebuah SO dan menautkan task Serah Terima."
- `shared/business-units.ts`: `BU_MODULES = ['item', 'serial', 'serialservice', 'serialwh']`; `fullBuPermissions()` menambah `serialwh: 'edit'`. Form role dan penugasan BU membaca `MODULES`/`BU_MODULES` sehingga otomatis tampil; `MeDto.businessUnits[].permissions` otomatis memuat `serialwh`.
- `serialwh` TIDAK membuka baca serial lewat `serials.*` (izin rute `serials.*` tetap `serial`/`serialservice`).
- Server `server/src/modules/serialwh/access.ts` (dasar, lengkap): `whBuIds(user, level: 'view' | 'edit'): string[]` (BU hidup dan terhapus yang memberi hak, pola `buIdsWithLevel`), `whLiveBuIds(user, level)` (tanpa BU terhapus, untuk pilihan), `canWh(user, buId, level): boolean`, `assertWhBu(user, buId, level)` (gagal = `NOT_FOUND` seragam).
- Web `web/src/modules/auth/permissions.ts` (dasar): `warehouseBuIds(me, level)` (= `liveBuIdsWithLevelOf(me, 'serialwh', level)`), `canUseWarehouse(me)` (edit pada >= 1 BU hidup), `canReadWarehouse(me)` (view pada >= 1 BU).

### 1.4 Fungsi murni shared (tanda tangan persis)

`shared/serial-warehouse.ts`
```ts
export const WAREHOUSE_LIMITS = {
  orderNumberMax: 40,
  noteMax: 1000,
  chunkMax: 200,          // = SERIAL_LIMITS.batchRows (tes paritas)
  handoverLinksMax: 20,
  lookupMax: 200,
  candidatesDefault: 5,
  candidatesMax: 20,
  listDefault: 50,
  listMax: 100,
  dispatchSerialsMax: 500, // per halaman detail
  staleDays: 7,
  itemOptionsMax: 50,
} as const;
export type WarehouseDispatchStatus = 'pending' | 'done' | 'cancelled';
export type WarehouseDispatchMode = 'clipboard';
export const WAREHOUSE_SOURCE = 'warehouse';
export function normalizeOrderNumber(raw: string): string;            // trim; isi tak diubah
export function orderNumberProblem(normalized: string): 'empty' | 'too_long' | 'control_chars' | null; // hasControlChars
export function orderKey(normalized: string): string;                 // toLowerCase() dari hasil normalizeOrderNumber
export function chunkCountOf(total: number, chunkSize: number): number; // ceil; total 0 = 0
export function chunkRowsOf(total: number, chunkSize: number, index: number): number; // ukuran potongan ke-index
export function clipboardText(serials: readonly string[]): string;    // join('\n'), tanpa baris kosong di akhir
export function warehouseRecordedNote(orderNumber: string): string;   // "Dicatat Gudang · SO <no>"
```

`shared/item-detect.ts` (5.14)
```ts
export interface DetectableItem { id: string; brandName: string; model: string }
export interface ItemDetection {
  itemId: string;
  lines: number;               // jumlah baris catatan (teks polos) yang menyebutnya
  by: 'full' | 'model';        // cocok lewat merk+tipe, atau tipe saja (hanya bila unik)
  ambiguous: boolean;          // nama rapat sama dengan Item lain yang juga dilaporkan
}
export const ITEM_DETECT_MIN_COMPACT = 4;
export function itemDisplayName(item: Pick<DetectableItem, 'brandName' | 'model'>): string; // `${brand} ${model}`.trim()
export function compactKey(text: string): string;    // normalizeKey(text) tanpa spasi
/** Jumlah kecocokan `needle` (bentuk rapat) di `normalized` (hasil normalizeKey), hanya yang berbatas spasi/awal/akhir. */
export function countBoundedMatches(normalized: string, needle: string): number;
/** Urut: lines menurun, lalu itemDisplayName. Item dengan nama rapat < 4 dilewati. */
export function detectItemsInNote(note: string, items: readonly DetectableItem[]): ItemDetection[];
export function noteMentionsItem(note: string, itemId: string, items: readonly DetectableItem[]): boolean;
```
Algoritme terkunci: `noteToPlainText(note)` dipecah per baris; tiap baris `normalizeKey` (tanda baca dan `_` menjadi spasi, huruf kecil); varian penuh = `compactKey(itemKey(brand, model))`; varian tipe = `compactKey(model)` dipakai hanya bila tak ada Item lain (di daftar yang dipertimbangkan) dengan varian tipe yang sama DAN Item itu belum cocok lewat varian penuh di baris itu. Pencocokan memetakan indeks teks rapat ke indeks teks bernormalisasi; kecocokan sah hanya bila karakter sebelum awal dan sesudah akhir (di teks bernormalisasi) adalah spasi atau batas teks.

`shared/item-suggest.ts` (5.15)
```ts
export const ITEM_SUGGEST = { minChars: 3, maxWords: 3, limit: 6 } as const;
export interface ItemSuggestRange { start: number; end: number; query: string } // indeks di teks sebelum kursor
/** Kandidat rentang: 3, 2, lalu 1 kata terakhir (urutan itu); array kosong bila compactKey(rentang) < 3 karakter. */
export function itemSuggestRanges(textBeforeCursor: string): ItemSuggestRange[];
/** Rentang terpanjang yang punya >= 1 kecocokan `suggestMatches` (teks = itemDisplayName dan model) menang. */
export function suggestItemsFor<T extends DetectableItem>(
  items: readonly T[],
  textBeforeCursor: string,
  limit?: number,
): { range: ItemSuggestRange; items: T[] } | null;
```

### 1.5 Tipe kontrak (`shared/contract.ts`, aditif)

```ts
// --- Keluar Gudang (grup serialWarehouse) ---
export interface WarehouseItemOptionDto {
  id: string; label: string; brandName: string; model: string;
  buIds: string[];          // BU item yang termasuk BU ber-serialwh:edit pemanggil
  proofRequired: boolean; proofMin: number;
}
export interface ListWarehouseItemOptionsInput { query?: string; buId?: string; ids?: string[]; cursor?: string; limit?: number }
export interface WarehouseItemOptionsPageDto { items: WarehouseItemOptionDto[]; nextCursor: string | null }

export interface WarehouseOptionsDto {
  locations: { id: string; name: string }[];          // lokasi aktif hidup
  customers: { id: string; name: string }[];          // customer aktif hidup
  inactiveCustomerNames: string[];
}

export interface WarehouseDispatchRefDto {           // pengeluaran SELESAI yang memuat serial ini
  orderId: string; orderNumber: string; buId: string; buCode: string; dispatchedOn: string;
}
/** Pengungkapan minimal lintas BU (5.9): tanpa catatan, riwayat, pelaku, foto. */
export interface WarehouseSerialDto {
  id: string; serial: string; itemId: string; itemLabel: string;
  buId: string; buCode: string; buName?: string;
  locationId: string; locationName: string; testDate: string;
  status: SerialStatus; custody: SerialCustody;
  whCreated: boolean; needsProof: boolean;
  dispatches: WarehouseDispatchRefDto[];             // maks. 20 terbaru
  /** Hanya bila input `orderId` dikirim: serial sudah ada di SO itu (pengeluaran pending atau selesai). */
  inOrder?: boolean;
}
export interface ListWarehouseSerialsInput {
  itemId: string; buIds?: string[]; locationId?: string; testDate?: string; query?: string;
  hideRecordedBuId?: string; cursor?: string; limit?: number;
}
export interface WarehouseSerialsPageDto { items: WarehouseSerialDto[]; nextCursor: string | null }
export interface WarehouseLookupInput { serials?: string[]; ids?: string[]; orderId?: string } // gabungan maks. 200
export interface WarehouseLookupOutput { found: WarehouseSerialDto[] }

export interface WarehouseOrderOptionDto {
  id: string; number: string; buId: string; buCode: string; buName?: string;
  customerId: string; customerName: string; lastDispatchedOn: string;
}
export interface ListWarehouseOrderOptionsInput { query?: string; buId?: string; ids?: string[]; cursor?: string; limit?: number }
export interface WarehouseOrderOptionsPageDto { items: WarehouseOrderOptionDto[]; nextCursor: string | null }

export interface WarehouseSubmitHeader {
  dispatchedOn: string; orderId?: string; orderNumber: string; buId: string; customerName: string;
  itemId: string; note: string; handoverIds: string[]; total: number; chunkSize: number;
}
export type WarehouseSubmitRow =
  | { kind: 'existing'; serialId: string; serial: string }
  | { kind: 'new'; clientId: string; serial: string; locationId: string; testDate: string };
export interface WarehouseSubmitInput { clientId: string; chunkIndex: number; header: WarehouseSubmitHeader; rows: WarehouseSubmitRow[] }
export interface WarehouseSubmitOutput {
  dispatchId: string; orderId: string; orderNumber: string;
  status: WarehouseDispatchStatus; chunksReceived: number; chunkCount: number;
  created: number;                 // serial baru pada potongan ini (0 pada kiriman ulang)
  serials?: string[];              // hanya bila status = done: SN urut seq untuk clipboard
}

export interface WarehouseOrderSummaryDto {
  id: string; number: string; buId: string; buCode: string; buName?: string;
  customerId: string; customerName: string;
  dispatchCount: number; serialCount: number; lastDispatchedOn: string;
  hasPending: boolean; handoverCount: number; createdAt: string; updatedAt: string;
}
export interface ListWarehouseOrdersInput {
  query?: string; customerIds?: string[]; buIds?: string[]; from?: string; to?: string;
  status?: 'pending' | 'done'; cursor?: string; limit?: number;
}
export interface WarehouseOrdersPageDto { items: WarehouseOrderSummaryDto[]; nextCursor: string | null }
export interface WarehouseDispatchDto {
  id: string; itemId: string; itemLabel: string; dispatchedOn: string; note: string;
  mode: WarehouseDispatchMode; status: WarehouseDispatchStatus;
  serialTotal: number; chunkCount: number; chunksReceived: number; createdCount: number;
  createdBy: string; createdAt: string; completedAt: string; cancelledAt: string;
}
export interface WarehouseLinkedHandoverDto {
  id: string; number: string; status: HandoverStatus; customerName: string; createdAt: string;
  readable: boolean;               // false = hanya nomor, tanpa tautan
}
export interface WarehouseOrderDto extends WarehouseOrderSummaryDto {
  createdBy: string; dispatches: WarehouseDispatchDto[]; handovers: WarehouseLinkedHandoverDto[];
  canEdit: boolean;                // serialwh:edit pada BU SO
}
export interface GetWarehouseOrderInput { id: string }
export interface ListWarehouseDispatchSerialsInput { id: string; cursor?: string; limit?: number }
export interface WarehouseDispatchSerialDto { seq: number; serialId: string; serial: string; createdNew: boolean; deleted: boolean }
export interface WarehouseDispatchSerialsPageDto { items: WarehouseDispatchSerialDto[]; nextCursor: string | null }
export interface WarehouseCopyTextInput { id: string }
export interface WarehouseCopyTextOutput { text: string; count: number }

export interface ListWarehouseHandoverCandidatesInput {
  customerId?: string; customerName?: string; query?: string; includeFinished?: boolean;
  orderId?: string; itemId?: string; cursor?: string; limit?: number;
}
export interface WarehouseHandoverCandidateDto {
  id: string; number: string; createdAt: string; preview: string; status: HandoverStatus;
  linked: boolean; mentionsItem: boolean;
}
export interface WarehouseHandoverCandidatesDto {
  linked: WarehouseHandoverCandidateDto[];     // tertaut ke orderId (terbaca), selalu di depan
  items: WarehouseHandoverCandidateDto[]; nextCursor: string | null;
}
export interface SetWarehouseOrderLinksInput { id: string; expectedUpdatedAt: string; handoverIds: string[] }

export interface ItemDetectionDto extends ItemDetection { label: string }
export interface WarehouseHandoverContextInput { handoverId: string }
export interface WarehouseHandoverContextDto {
  handover: { id: string; number: string; customerId: string; customerName: string; status: HandoverStatus };
  orders: WarehouseOrderOptionDto[];            // SO tertaut task ini pada BU ber-serialwh:edit
  detected: ItemDetectionDto[];                 // Item hidup aktif pada BU ber-serialwh:edit
}

// --- 5.15: katalog nama Item untuk saran editor ---
export interface ItemNameOptionDto { id: string; brandName: string; model: string }
export interface ItemNameOptionsDto { items: ItemNameOptionDto[]; truncated: boolean } // maks. 5000

// --- Bagian 8 (aditif pada yang ada) ---
// SerialSummaryDto: whCreated?: boolean; whRecorded?: boolean; needsProof?: boolean;
// SerialListInput: whRecorded?: 'yes' | 'no'; needsProof?: boolean;
// HandoverDto (jalur F2): detectedItems?: ItemDetectionDto[];
```
Semua id kontrak baru ditambahkan ke `ApiContract` (`input`/`output`).

### 1.6 Tabel rute (`shared/api.ts`, urutan = urutan pendaftaran; jalur statis sebelum `{id}`)

| Id | Verba + jalur | Query / lainnya | Izin (server) |
|---|---|---|---|
| `serialWarehouse.itemOptions` | GET `/serial-warehouse/item-options` | `query`, `buId`, `ids:list`, `cursor`, `limit:number` | `serialwh: edit` |
| `serialWarehouse.options` | GET `/serial-warehouse/options` | - | `serialwh: edit` |
| `serialWarehouse.serials` | GET `/serial-warehouse/serials` | `itemId`, `buIds:list`, `locationId`, `testDate`, `query`, `hideRecordedBuId`, `cursor`, `limit:number` | `serialwh: edit` |
| `serialWarehouse.lookup` | POST `/serial-warehouse/lookup` | `status: 200` | `serialwh: edit` |
| `serialWarehouse.orderOptions` | GET `/serial-warehouse/order-options` | `query`, `buId`, `ids:list`, `cursor`, `limit:number` | `serialwh: edit` |
| `serialWarehouse.handoverCandidates` | GET `/serial-warehouse/handover-candidates` | `customerId`, `customerName`, `query`, `includeFinished:boolean`, `orderId`, `itemId`, `cursor`, `limit:number` | `serialwh: edit` |
| `serialWarehouse.handoverContext` | GET `/serial-warehouse/handover-context/{handoverId}` | - | `serialwh: edit` |
| `serialWarehouse.submit` | POST `/serial-warehouse/dispatches` | `status: 200` | `serialwh: edit` |
| `serialWarehouse.dispatchSerials` | GET `/serial-warehouse/dispatches/{id}/serials` | `cursor`, `limit:number` | `serialwh: view` |
| `serialWarehouse.copyText` | GET `/serial-warehouse/dispatches/{id}/text` | - | `serialwh: view` |
| `serialWarehouse.listOrders` | GET `/serial-warehouse/orders` | `query`, `customerIds:list`, `buIds:list`, `from`, `to`, `status`, `cursor`, `limit:number` | `serialwh: view` |
| `serialWarehouse.setLinks` | PUT `/serial-warehouse/orders/{id}/handovers` | `ifMatch: 'expectedUpdatedAt'`, `etag: 'updatedAt'` | `serialwh: edit` |
| `serialWarehouse.getOrder` | GET `/serial-warehouse/orders/{id}` | `etag: 'updatedAt'` | `serialwh: view` |
| `items.nameOptions` | GET `/items/name-options` (SEBELUM `/items/{id}`) | - | `item: view` |
| `serials.list` (ubah) | query tambah `whRecorded: 'string'`, `needsProof: 'boolean'` | - | tetap |

`shared/api-versions.ts`: `serialWarehouse: { latest: 1, deprecated: [] }`. Potret `shared/api-contract.snapshot.json` dibangkitkan ulang SEKALI di tugas dasar (`bun run api:snapshot`); potret bertambah 14 rute.

Pembatasan baris (handler, bukan izin rute): BU dibaca = `whBuIds(user, 'view')`; BU tulis = `whBuIds(user, 'edit')`; di luar hak = `NOT_FOUND` seragam ("Catatan SO tidak ditemukan", "Pengeluaran tidak ditemukan").

### 1.7 Web: kunci query, rute, nav, draf, clipboard

- `web/src/modules/serialwh/keys.ts`: `serialwhKeys = { all: ['serialwh'], itemOptions: (i) => ['serialwh','item-options',i], options: ['serialwh','options'], serials: (f) => ['serialwh','serials',f], orderOptions: (i) => ['serialwh','order-options',i], candidates: (i) => ['serialwh','candidates',i], context: (id) => ['serialwh','context',id], orders: (f) => ['serialwh','orders',f], order: (id) => ['serialwh','order',id], dispatchSerials: (id) => ['serialwh','dispatch-serials',id] }`. Tidak masuk whitelist `query-persist`. `itemNameKeys = ['items','name-options']` (jalur F, di `web/src/modules/handover/lib/item-names.ts`).
- Rute: `/serial/gudang` (search `{ handover?: string }`, FORM_FULL, `pageWidth: 'full'`, tanpa `crumb` karena tujuan nav), `/serial/gudang/riwayat` (INDEX; search `{ q?, customerIds?: string[], buIds?: string[], from?, to?, status?: 'pending'|'done' }`, jamak maks. `FILTER_LIST_MAX`), `/serial/gudang/riwayat/$orderId` (VIEW; `crumb`). `locationAware` tidak dipasang. Guard `beforeLoad`: `requirePermission(serialwh edit)` untuk form, `serialwh view` untuk Riwayat.
- Nav (`web/src/app/navigation.ts`, grup `serial`): butir "Keluar Gudang" `to: '/serial/gudang'`, ikon `PackageCheck`, `permission: { module: 'serialwh', level: 'edit' }`, `excludes: ['/serial/gudang/riwayat']`; butir "Riwayat Gudang" `to: '/serial/gudang/riwayat'`, ikon `History`, `permission: { module: 'serialwh', level: 'view' }`. Butir "Daftar" menambah `'/serial/gudang'` ke `excludes`. `module-links.ts`: `serialwh: '/serial/gudang/riwayat'`.
- Panduan: `serialwh` masuk `MODULES_WITHOUT_GUIDE_YET` (`web/src/modules/guide/catalog/module-coverage.test.ts`); `SERIAL_LIST_EXCEPT` di `catalog/serial.ts` menambah `'/serial/gudang'` (banner `serial-daftar`/`serial-detail` tidak muncul di halaman Gudang).
- Draf form: `localStorage` `qc.serialwh.draft:<email>` versi 1 (`lib/draft-store.ts`), dibungkus try/catch, dibuang saat `useLogout`. Isi: `{ v: 1, itemId, filters: { buId, locationId, testDate, hideRecorded }, rows: DraftRow[], submission?: { clientId, header, chunkSize, sentChunks, orderId?, dispatchId? } }`; `DraftRow = { kind: 'existing', id, serial, snapshot: WarehouseSerialDto } | { kind: 'new', clientId, serial, locationId, testDate, itemId, buId }`. `clientId` baris baru dibuat SEKALI (`newUuid()`) dan dipakai ulang; pembagian potongan dibekukan di `submission` begitu kiriman pertama dimulai. Diuji dengan 5.000 baris.
- Clipboard: urutan = urutan baris draf (urutan scan, yang pertama di atas; lihat keputusan terbuka 3); `clipboardText()`; penulisan memakai `navigator.clipboard.write([new ClipboardItem({ 'text/plain': promiseBlob })])` yang dimulai di gestur klik "Simpan & salin", cadangan `writeText`, gagal = `ClipboardResultDialog` (area teks + "Salin lagi" + "Buka riwayat").
- Aksi `ACTIONS.warehouse` (`web/src/components/action-button.tsx`): ikon `PackageCheck`, `outline` primary, label "Keluar Gudang".

---

## 2. Fase dan jalur

```
Fase 0: T0 dasar (kontrak + shared murni + izin + migrasi + stub rute + stub halaman + perbaikan fixture)
Fase 1 (paralel): A server inti | B server tautan task | D web form | E web Riwayat + tautan | H web badge Serial | F editor saran + lencana
Fase 2: G dokumen
Fase 3: V verifikasi akhir, lalu R review akhir putaran (independen, + security-audit)
```
Ketergantungan di fase 1: A memakai `handover-links.ts` (B) lewat tanda tangan yang sudah dibuat stub di T0; D memakai `HandoverLinkPicker` (E) lewat tanda tangan stub T0. Bila salah satu belum selesai, jalur lain tetap dapat menulis dan menguji bagiannya dengan memalsukan modul itu.

Model: Sonnet untuk T0, A, B, D, E, F, H, V; Haiku untuk G (dokumen) dan boleh untuk perbaikan fixture literal di T0; review akhir R dengan model lebih tinggi. Catatan: aturan pemilik "satu agent per kelas beban yang dilanjutkan lewat `SendMessage`" bertentangan dengan lima jalur Sonnet paralel; orkestrator memutuskan (paralel demi waktu, atau satu agent Sonnet mengerjakan A, B, D, E, F, H berurutan).

Urutan sekuensial yang perlu diketahui: perbaikan fixture T0 menyentuh beberapa tes yang kemudian dimiliki jalur fase 1 (mis. `serial-list-page.test.tsx` milik H); karena T0 selesai sebelum fase 1 dimulai, tidak ada penyuntingan serentak.

---

### Task T0: Dasar kontrak, izin, migrasi, stub (Sonnet; fixture literal boleh diserahkan ke Haiku dalam dispatch yang sama)

**Files (milik):**
- Create: `server/migrations/0040_serial_keluar_gudang.sql`; `shared/serial-warehouse.ts`, `shared/serial-warehouse.test.ts`, `shared/item-detect.ts`, `shared/item-detect.test.ts`, `shared/item-suggest.ts`, `shared/item-suggest.test.ts`
- Create (lengkap): `server/src/modules/serialwh/routes.ts`, `server/src/modules/serialwh/access.ts`, `server/src/modules/serialwh/access.test.ts`
- Create (stub yang mengekspor tanda tangan final, isi `throw appError('UNAVAILABLE', 'Belum tersedia')`): `serialwh/options.ts`, `scan.ts`, `submit.ts`, `orders.ts`, `validate.ts` (milik A setelahnya), `handover-links.ts`, `handover-candidates.ts`, `validate-links.ts` (milik B setelahnya), `server/src/modules/item/name-options.ts` (milik F)
- Create (stub komponen berkerangka kit): `web/src/modules/serialwh/components/dispatch-page.tsx` (FormPage kosong; milik D), `orders-page.tsx` (ListPage kosong; milik E), `order-detail-page.tsx` (ViewPage kosong; milik E), `handover-link-picker.tsx` (props final, render kosong; milik E)
- Create: `web/src/modules/serialwh/keys.ts`, `web/src/modules/serialwh/queries.ts` (lengkap, tipis: `queryOptions`/`infiniteQueryOptions`/mutasi per rute 1.6)
- Create: tiga berkas rute 1.7; Modify: `web/src/routeTree.gen.ts` (dibangkitkan `bun run --cwd web build` atau generator router)
- Modify: `shared/permissions.ts`, `shared/business-units.ts`, `shared/business-units.test.ts`, `shared/permissions.test.ts`, `shared/assignments.test.ts`, `shared/contract.ts`, `shared/api.ts`, `shared/api.test.ts` (`EXAMPLES`), `shared/api-versions.ts`, `shared/api-contract.snapshot.json`
- Modify: `server/src/routes.ts`, `server/src/http/body.test.ts` (`WORST`), `server/src/core/legacy-ids.test.ts` (`NON_ID_CONTRACT_KEYS`), `server/src/core/migrate.test.ts`, `server/src/modules/item/routes.ts` (daftarkan `items.nameOptions` dengan handler stub)
- Modify: `web/src/app/navigation.ts`, `web/src/app/module-links.ts`, `web/src/modules/auth/permissions.ts`, `web/src/modules/guide/catalog/serial.ts`, `web/src/modules/guide/catalog/module-coverage.test.ts`, `web/src/app/route-meta-coverage.test.ts`
- Modify (fixture `BuPermissionMap`/`PermissionMap` literal yang menyebut `serialservice: '...'`, tambah `serialwh: 'none'` atau level sesuai tes): 56 berkas hasil `grep -rln "serialservice: '"` di `server shared web` (termasuk `web/src/test/make-me.ts`, `web/src/modules/serial/test-support.ts`, `server/test-support/serial-fixtures.ts`, `server/src/modules/auth/rest.test.ts`, `server/src/modules/access/*.test.ts`, `web/src/app/navigation*.test.ts`), kecuali `shared/permissions.ts`/`shared/business-units.ts` yang sudah tercantum.

**Interfaces — produces:** seluruh isi bagian 1 (kontrak, tabel rute, fungsi murni, tanda tangan stub di bawah).

Tanda tangan stub server yang wajib persis:
```ts
// serialwh/handover-links.ts (B)
export async function assertLinkableHandovers(env: Env, user: UserContext, handoverIds: readonly string[]): Promise<void>; // tak terbaca/terhapus = NOT_FOUND
export function addOrderLinksStmts(env: Env, orderId: string, handoverIds: readonly string[], actor: string, now: string): DbStatement[]; // INSERT IGNORE
export async function loadOrderHandovers(env: Env, user: UserContext, orderId: string): Promise<WarehouseLinkedHandoverDto[]>;
export async function setOrderLinks(env: Env, user: UserContext, input: SetWarehouseOrderLinksInput): Promise<WarehouseOrderDto>;
export async function handoverContext(env: Env, user: UserContext, input: WarehouseHandoverContextInput): Promise<WarehouseHandoverContextDto>;
// serialwh/handover-candidates.ts (B)
export async function handoverCandidates(env: Env, user: UserContext, input: ListWarehouseHandoverCandidatesInput): Promise<WarehouseHandoverCandidatesDto>;
// serialwh/orders.ts (A)
export async function loadOrderDto(env: Env, user: UserContext, id: string): Promise<WarehouseOrderDto>; // dipakai setOrderLinks (B)
```
Tanda tangan stub web:
```ts
// web/src/modules/serialwh/components/handover-link-picker.tsx (E)
export interface HandoverLinkPickerProps {
  customerId?: string; customerName?: string; orderId?: string; itemId?: string;
  value: string[]; onChange: (ids: string[]) => void; lockedIds?: string[]; // task asal (?handover)
}
export function HandoverLinkPicker(props: HandoverLinkPickerProps): JSX.Element;

// web/src/modules/serialwh/components/clipboard-result-dialog.tsx (D; dipakai E untuk Salin ulang)
export interface ClipboardResultDialogProps { open: boolean; onOpenChange: (open: boolean) => void; text: string; count: number; onOpenHistory?: () => void }
export function ClipboardResultDialog(props: ClipboardResultDialogProps): JSX.Element;
// web/src/modules/serialwh/lib/clipboard.ts (D)
export async function copyLines(text: string | Promise<string>): Promise<boolean>; // false = tampilkan ClipboardResultDialog
// web/src/modules/serialwh/lib/draft-store.ts (D; E membaca untuk "Lanjutkan")
export function readWarehouseDraft(email: string): WarehouseDraft | null;
export function writeWarehouseDraft(email: string, draft: WarehouseDraft): void;
export function clearWarehouseDraft(email: string): void;
export function draftDispatchId(email: string): string | null; // submission.dispatchId bila ada
```

- [ ] **Step 1:** Tulis tes murni dulu (gagal), lalu implementasi `shared/serial-warehouse.ts`, `shared/item-detect.ts`, `shared/item-suggest.ts`. Tes kunci:
  - `serial-warehouse.test.ts`: `normalizeOrderNumber('  so-12 ')` = `'so-12'`; `orderKey('SO-12') === orderKey('so-12')`; `orderNumberProblem` untuk kosong, 41 karakter, karakter kontrol, pengatur arah; `chunkCountOf(401, 200) = 3`, `chunkRowsOf(401, 200, 2) = 1`; `clipboardText(['A','B']) = 'A\nB'`; paritas `WAREHOUSE_LIMITS.chunkMax === SERIAL_LIMITS.batchRows`.
  - `item-detect.test.ts`: "Tenda AX-300", "tenda ax 300", "TENDA_AX300" terdeteksi sama; "AX300" tidak cocok di "AX3000" maupun "MAX300"; varian tipe saja dipakai bila unik, tidak dipakai bila dua Item bertipe sama; nama rapat < 4 dilewati; dua Item bernama rapat sama keduanya dilaporkan `ambiguous: true`; catatan berisi tautan `[x](http://...)` dan gambar tidak menghasilkan cocok dari URL; `lines` menghitung baris, bukan kemunculan; urutan hasil.
  - `item-suggest.test.ts`: "tenda ax-3" menyarankan "Tenda AX300"; < 3 karakter = null; hanya sampai 3 kata terakhir ("beli 2 tenda ax" memakai "tenda ax", bukan "beli"); rentang terpanjang yang cocok menang dan `range.start` menunjuk awal kata pertama rentang; tanda baca diabaikan; `limit` 6.
- [ ] **Step 2:** Izin (`permissions.ts`, `business-units.ts`) + perbarui tes yang mengunci daftar (`business-units.test.ts`: `BU_MODULES` dan `fullBuPermissions`; `permissions.test.ts`). Jalankan `bun run typecheck`, lalu perbaiki SEMUA fixture literal (daftar grep di atas) sampai typecheck hijau.
- [ ] **Step 3:** Kontrak + tabel rute + `api-versions` + `EXAMPLES` (`shared/api.test.ts`) + `WORST` (`server/src/http/body.test.ts`: `serialWarehouse.submit` dengan 200 baris `new` (serial 64 karakter, note 1.000 karakter emoji, 20 `handoverIds`), `serialWarehouse.lookup` 200 serial, `serialWarehouse.setLinks` 20 id) + `NON_ID_CONTRACT_KEYS` (tambah: `orderNumber`, `customerName` (sudah ada), `dispatchedOn`, `lastDispatchedOn`, `preview`, `testDate` (sudah ada), `hideRecordedBuId` cocok pola Id sehingga tak perlu, `kind`, `mode`, `completedAt` (ada), `cancelledAt`, `whRecorded`; cek ulang dengan menjalankan tesnya).
- [ ] **Step 4:** Migrasi 0040 + `migrate.test.ts` (`EXPECTED_TABLES`, judul "51 tabel", nama migrasi, daftar indeks 1.2).
- [ ] **Step 5:** `serialwh/routes.ts` lengkap (izin per 1.6) memanggil fungsi stub; daftarkan di `server/src/routes.ts`; `items.nameOptions` di `item/routes.ts`. `access.ts` + `access.test.ts` (BU terhapus memberi hak tetapi tidak muncul di `whLiveBuIds`; super admin = semua BU `edit`).
- [ ] **Step 6:** Web: `keys.ts`, `queries.ts`, stub komponen, tiga rute, `routeTree.gen.ts`, nav, module-links, helper izin, `SERIAL_LIST_EXCEPT`, `MODULES_WITHOUT_GUIDE_YET`, `route-meta-coverage.test.ts` (`/serial/gudang` ke `FORM_FULL`, `/serial/gudang/riwayat` ke `INDEX`, `/serial/gudang/riwayat/$orderId` ke `VIEW`).
- [ ] **Step 7:** `bun run api:snapshot`; `bun run typecheck`; Biome; tes terarah: `bun test shared`, `bun run --cwd server test src/core/migrate.test.ts src/core/legacy-ids.test.ts src/http/body.test.ts src/modules/serialwh`, `bun run --cwd web test src/app src/modules/guide src/modules/auth`, `scripts/page-frame.test.ts`. Commit: `feat(serialwh): dasar kontrak, izin serialwh, migrasi 0040, dan stub rute Keluar Gudang`.

---

### Task A: Server inti Keluar Gudang + bagian 8 server (Sonnet)

**Files (milik):** `server/src/modules/serialwh/{options,scan,submit,orders,sweep,validate,repo,audit}.ts` + tes `options.test.ts`, `scan.test.ts`, `submit.test.ts`, `submit-race.test.ts`, `orders.test.ts`, `sweep.test.ts`, `disclosure.test.ts`, `rest.test.ts`; `server/src/modules/serial/new-serial.ts`, `server/src/modules/serial/new-serial.test.ts`, `server/src/modules/serial/wh-flags.ts`, `server/src/modules/serial/wh-flags.test.ts`; Modify `server/src/modules/serial/service.ts`, `server/src/modules/serial/repo.ts`, `server/src/modules/serial/validate.ts`, `server/src/modules/serial/list-wh.test.ts` (baru); `server/src/jobs/runner.ts`; `server/src/core/soft-delete-pending.ts`; `server/src/modules/item/name-options.ts` TIDAK (milik F).

**Interfaces — consumes:** `access.ts`, `shared/serial-warehouse.ts`, `handover-links.ts` (`assertLinkableHandovers`, `addOrderLinksStmts`, `loadOrderHandovers`), `planCustomerByName` (`customer/service.ts`), `statementsFor('serial.recorded', …)`, `applicableStickersOf`, repo serial (`insertSerialStmt`, `insertSerialStickerStmt`, `insertEventStmt`). **Produces:** semua handler rute A di 1.6, `loadOrderDto`, `sweepStaleDispatches(env)`, `newSerialStatements(...)`, fragmen `whRecordedSql`/`needsProofSql`.

Aturan terkunci:
- `new-serial.ts`: `export async function newSerialStatements(env, input: { serialId, eventId, clientId, buId, serial, itemId, testDate, locationId, locationName, note, sample, actor: { id, name, email }, stickerPicks, stickerNames, eventData: Record<string, unknown>, occurredOn, now }): Promise<DbStatement[]>` = insert serial + stiker + kejadian `recorded` + pernyataan pendengar `serial.recorded`. `createSerialOnce` memakainya (perilaku dan tes yang ada tak berubah). Keluar Gudang menambah `UPDATE serials SET wh_created = 1 WHERE id = ?` di batch yang sama. Tanpa foto bukti (dikecualikan, 5.7).
- Serial baru WH: `status good`, custody `qc`, BU = BU SO, stiker = semua yang berlaku bagi (item, BU SO) dengan `defaultQty`, `note` = `warehouseRecordedNote(no)`, `sample` false, kejadian `recorded` dengan `data.source = 'warehouse'`, `data.orderId`, `data.orderNumber`, `actorTeam: 'qc'`, `serials.client_id` = `clientId` baris draf. Syarat: item hidup, aktif, tertaut ke BU SO (`item_business_units`); BU SO hidup dan aktif; lokasi aktif; `testDate` valid dan <= hari ini WIB; `normalizeSerial` + `serialProblem` null; tidak perlu izin `item`.
- `header_hash` (terkunci): sha256 dari JSON kanonis `{ dispatchedOn, orderKey: orderKey(normalizeOrderNumber(orderNumber)), buId, customerKey: customerKey(customerName), itemId, note, handoverIds: [...].sort(), total, chunkSize }`; `orderId` TIDAK ikut. Potongan > 0 SELALU memakai SO dari `warehouse_dispatches.order_id` (tak pernah mencari ulang), jadi SO hasil gabung balapan tetap konsisten. Klien mengirim ulang header beku apa adanya pada setiap potongan.
- `lookup.orderId`: SO harus ada pada BU `whBuIds(user,'edit')`, selain itu `NOT_FOUND` (mencegah `inOrder` membuka keanggotaan SO lain).
- `submit.ts` (per potongan, urutan pemeriksaan): bentuk (`validate.ts`; `rows.length === chunkRowsOf(total, chunkSize, chunkIndex)`, `chunkSize` 1..200, `handoverIds` <= 20 unik, `dispatchedOn` <= hari ini WIB) -> `clientId` sudah ada? (milik pelaku lain = `CONFLICT` generik; header hash beda = `VALIDATION` "Isi pengeluaran berubah"; potongan sudah tercatat = kiriman ulang, kembalikan keadaan tersimpan termasuk `serials` bila `done`; status `cancelled` = `CONFLICT` "Pengeluaran sudah dibatalkan otomatis") -> potongan > 0 tanpa pengeluaran = `VALIDATION` -> hak `serialwh: edit` pada BU SO (SO lama: `orders.bu_id`; SO baru: `header.buId`; tak berhak = `NOT_FOUND` seragam) -> `assertLinkableHandovers` (hanya potongan 0) -> pra-cek baca untuk pesan per SN (serial ada, satu item, `good`+`qc`, hidup, belum di SO ini; tanggal uji/BU berbeda BUKAN galat) -> `batch()`:
  1. potongan 0: SO baru (customer lewat `planCustomerByName`, insert `warehouse_orders`) atau kunci SO lama (`UPDATE warehouse_orders SET updated_at = ?, last_dispatched_on = GREATEST(...)`); insert `warehouse_dispatches` (`pending`, `header_hash`); `addOrderLinksStmts`; audit `serialwh.dispatch_create` (targetId = id SO).
  2. insert `warehouse_dispatch_chunks (dispatch_id, chunk_index)` (penjaga kiriman ganda).
  3. tiap baris `existing`: penjaga CAS `UPDATE serials SET id = CASE WHEN status = 'good' AND custody = 'qc' AND deleted_at = '' AND item_id = ? THEN id ELSE <CAS_FAIL_SQL> END WHERE id = ?` lalu insert `warehouse_dispatch_serials`.
  4. tiap baris `new`: `newSerialStatements` + `wh_created = 1` + insert `warehouse_dispatch_serials (created_new = 1)`.
  5. `UPDATE warehouse_dispatches SET chunks_received = chunks_received + 1, created_count = created_count + ?, status = CASE WHEN chunks_received + 1 = chunk_count THEN 'done' ELSE status END, completed_at = CASE ... END WHERE id = ? AND status = 'pending'` dijaga CAS (0 baris = `CAS_FAIL_SQL`, menutup balapan dengan penyapu).
  6. `seq = chunkIndex * chunkSize + i`.
- Galat batch: duplikat `warehouse_dispatch_serials_order_serial` = `VALIDATION` "Sudah ada di SO ini: <SN>"; `serials_serial_live` pada baris `new` = baca ulang serial itu: bila item sama dan memenuhi syarat `existing` maka ulangi potongan SEKALI dengan baris itu sebagai `existing`, selain itu `VALIDATION` menyebut SN; `warehouse_orders_key` = baca ulang SO pemenang: BU dan `customer_id` sama = ulangi sebagai SO lama, selain itu `CONFLICT` generik "No SO sudah dipakai"; `customers_key*` = ulangi lookup customer; gagal CAS = muat ulang dan nilai ulang per SN. Paling banyak 2 kali ulang.
- SO lama: customer DARI SO (input `customerName` diabaikan), BU SO menang atas `header.buId` (berbeda = `VALIDATION` "BU tidak sama dengan SO"; klien sudah menyamakan).
- `scan.ts`: `lookup` lintas BU (apa pun BU; terhapus = tidak ditemukan), `serials` (daftar tabel: BU `whBuIds(user,'view')`, `itemId` wajib, filter opsional, `hideRecordedBuId` = NOT EXISTS pengeluaran SELESAI pada SO ber-BU itu), keduanya membentuk `WarehouseSerialDto` lewat satu fungsi `toWarehouseSerial` (daftar putih).
- `options.ts`: `itemOptions` (item hidup aktif tertaut ke BU `whLiveBuIds(user,'edit')`, dipersempit `buId`; `ids` maks. 50 meresolusi nama), `options` (lokasi aktif, customer aktif + nama nonaktif), `orderOptions` (SO pada BU `edit`; urut: BU = `buId` dulu, lalu `updated_at` terbaru; `query` = awalan `key`).
- `orders.ts`: `listOrders` (BU `view`; hitungan lewat subkueri agregat; `hasPending` = ada `pending`), `getOrder`/`loadOrderDto` (pengeluaran urut terbaru; `handovers` dari `loadOrderHandovers`; `canEdit`), `dispatchSerials` (berpaginasi `seq`, `deleted` = serial terhapus; JOIN ke `serials` TANPA penyaring = entri `SOFT_DELETE_EXEMPT` beralasan "Riwayat menampilkan serial terhapus dengan penanda"), `copyText` (hanya `done`, selain itu `CONFLICT` "Pengeluaran belum selesai").
- `sweep.ts`: `sweepStaleDispatches(env)` dipasang di `schedulerTick` (`jobs/runner.ts`): pengeluaran `pending` dengan `created_at` < sekarang - 7 hari: satu `batch()` per pengeluaran = `UPDATE ... SET status='cancelled', cancelled_at=? WHERE id=? AND status='pending'` (CAS) + `DELETE FROM warehouse_dispatch_serials WHERE dispatch_id = ?` + audit `serialwh.dispatch_cancel` (aktor `system`, targetId = id SO). Serial baru tetap ada.
- `audit.ts`: tulis audit dengan `targetId`; aksi `serialwh.dispatch_create`, `serialwh.dispatch_cancel` (B menulis `serialwh.links_update`). Awalan `serialwh` TIDAK dipetakan ke jenis aktivitas (Log Audit tanpa tautan View; sengaja).
- Bagian 8 server: `wh-flags.ts` mengekspor `whRecordedSql(alias)` (`EXISTS` baris pengeluaran `done`) dan `needsProofSql(alias)` (`alias.wh_created = 1 AND item proof_required = 1 AND COUNT(foto serial dengan state NOT IN ('draft','failed')) < GREATEST(proof_min, 1)`; lihat keputusan terbuka 4); `repo.ts` menambah kolom `wh_created`, `wh_recorded`, `needs_proof` pada daftar dan filter `whRecorded`/`needsProof`; `toSummary` mengisi `whCreated`/`whRecorded`/`needsProof`; `validate.ts` (`serials.list`) menerima `whRecorded: 'yes'|'no'` dan `needsProof: boolean`. Serial terhapus tak dihitung.

- [ ] **Step 1:** Ekstrak `newSerialStatements` (refactor murni): jalankan tes serial yang ada (`bun run --cwd server test src/modules/serial/record-batch.test.ts src/modules/serial/rest.test.ts`) tetap hijau.
- [ ] **Step 2:** Tes merah lalu implementasi, berurutan: `options`, `scan`, `submit`, `orders`, `sweep`, bagian 8. Tes (nama + asersi kunci):
  - `submit.test.ts` "SO baru dibuat otomatis beserta customer baru": potongan tunggal, `warehouse_orders` 1 baris ber-`key` huruf kecil, customer baru tercatat audit, keluaran `status: 'done'`, `serials` urut seq.
  - "satu SO satu BU": SO lama ber-BU A, header BU B = `VALIDATION`; SO lama dipakai ulang dari pengeluaran kedua (hitungan pengeluaran 2).
  - "tipe berbeda ditolak": baris `existing` beritem lain = `VALIDATION` menyebut SN, tak ada baris tertulis.
  - "tanggal uji beda dan BU serial beda tidak menolak": tersimpan.
  - "serial dua kali pada SO yang sama ditolak; SO lain BU lain boleh".
  - "status bukan Lolos atau posisi bukan QC ditolak"; "serial terhapus = tidak ditemukan".
  - "potongan idempoten": kirim potongan 0 dua kali = satu set baris, stok stiker terpotong SEKALI (bandingkan `sticker_stock` sebelum/sesudah), `created` 0 pada kiriman ulang; `clientId` pelaku lain = `CONFLICT`; header berubah = `VALIDATION`.
  - "gagal di tengah lalu dilanjutkan": `chunkSize` 2, total 5; potongan 1 gagal (serial tak memenuhi) -> potongan 0 tetap tersimpan, status `pending`; kirim ulang potongan 1 yang benar lalu 2 -> `done`.
  - "satu tes ukuran penuh": 200 baris `existing` (murah) dalam satu potongan.
  - "serial baru WH dikecualikan wajib foto": item `proof_required` dan `proof_min` 2, serial baru tersimpan tanpa foto, `wh_created = 1`, `needsProof` true di `serials.list`, hilang setelah dua foto `done` ditautkan.
  - "kejadian recorded bertanda Gudang": `data.source === 'warehouse'`, `data.orderNumber`.
  - `submit-race.test.ts` "pembuatan SO serentak" (`Promise.all` dua permintaan nyata No SO sama, BU+customer sama = keduanya sukses, satu SO; customer beda = satu `CONFLICT`); "serial draf dibuat orang lain" (serial dicatat lewat `serials.saveBatch` sebelum potongan = diperlakukan `existing`, stok tak terpotong dua kali; beda item = `VALIDATION`); "penyapu vs potongan terakhir" (CAS: salah satu menang, tidak ada `done` dengan baris terhapus).
  - `sweep.test.ts` "pembatalan otomatis 7 hari": jam `env.clock` maju 7 hari + 1 menit, status `cancelled`, baris keanggotaan hilang, serial baru tetap ada, audit `serialwh.dispatch_cancel`; pengeluaran 6 hari tetap `pending`.
  - `disclosure.test.ts` "lookup.orderId di luar BU edit = NOT_FOUND"; "kebocoran lintas BU": pengguna `serialwh: edit` hanya di BU A melakukan `lookup` serial BU B: kunci DTO PERSIS daftar `WarehouseSerialDto` (tanpa `note`, `createdBy`, kejadian, foto); `serials` tanpa scan tidak memuat serial BU B; `listOrders`/`getOrder` SO BU B = kosong/`NOT_FOUND`; pengguna hanya `serial: edit` (tanpa `serialwh`) = 403 pada semua rute; `serialwh: view` = 403 pada `submit`, sukses pada `listOrders`/`copyText`.
  - `list-wh.test.ts` "filter whRecorded/needsProof": `yes`/`no` benar, serial terhapus tak dihitung, pengeluaran `pending`/`cancelled` tidak membuat "Tercatat WH".
  - `rest.test.ts`: tiap rute lewat `restCall` (verba, jalur, ETag `getOrder`).
- [ ] **Step 3:** Entri `SOFT_DELETE_PENDING`/`SOFT_DELETE_EXEMPT` berkunci `<tabel>@<n>#<sidik>`: mengubah atau menyisipkan kueri di `serial/repo.ts`/`service.ts` dapat menomori ulang entri yang ada; perbarui kuncinya. Jalur A satu-satunya pemilik `soft-delete-pending.ts` (B dan F hanya menulis kueri bersaring). `soft-delete-guard.test.ts` hijau (penyaring `liveWhere` pada JOIN `serials`, `items`, `customers`, `locations`, `business_units`, kecuali pengecualian beralasan di `soft-delete-pending.ts`); `audit-target.test.ts` hijau.
- [ ] **Step 4:** Commit per kelompok (`feat(serialwh): ...`, `feat(serial): badge dan filter Tercatat WH dan Butuh foto di serials.list`).

---

### Task B: Server tautan Serah Terima, kandidat task, konteks task (Sonnet)

**Files (milik):** `server/src/modules/serialwh/handover-links.ts`, `handover-candidates.ts`, `validate-links.ts`, tes `handover-links.test.ts`, `handover-candidates.test.ts`, `handover-context.test.ts`.

**Interfaces — consumes:** `access.ts`, `loadOrderDto` (A), `detectItemsInNote`/`noteMentionsItem` (T0), `noteToPlainText`, `notificationPreviewText`, `customerKey`. **Produces:** tanda tangan stub T0 (handover-links + candidates + context).

Aturan terkunci:
- Lokasi task terbaca = lokasi dengan `handover: view` atau `qc: edit` (aturan `assertHandoverReadable`), TETAPI task terhapus SELALU `NOT_FOUND` (juga bagi `handover: manage`) dan tak pernah muncul.
- `handoverCandidates`: customer = `customerId`, atau `customerName` diresolusi ke customer hidup lewat `customerKey` (tak ada = daftar kosong); bawaan hanya status `new`/`in_progress`, `includeFinished` menambah `done`/`cancelled`; `query` mencocokkan nomor, nama customer, atau isi catatan (`LOCATE` pada teks; tanpa `customerId`/`customerName` boleh lintas customer); urut `created_at` menurun, `id`; `limit` bawaan 5, maks. 20; `linked` = task tertaut `orderId` yang terbaca (maks. 20), dikeluarkan dari `items`; `mentionsItem` dihitung dengan `noteMentionsItem` terhadap Item hidup aktif pada BU `serialwh: edit` pemanggil (dimuat sekali per permintaan), dan pada halaman yang sama task ber-`mentionsItem` diurutkan lebih dulu (peringkat, bukan filter); `preview` = `notificationPreviewText` dipotong 120 karakter.
- `setOrderLinks`: hak `serialwh: edit` pada BU SO; CAS `updated_at` SO (basi = `staleError`, 412); daftar dikirim utuh untuk task yang TERBACA pemanggil; tautan ke task yang tak terbaca DIPERTAHANKAN; id baru tak terbaca/terhapus = `NOT_FOUND`; maks. 20 per SO; audit `serialwh.links_update` (targetId = id SO); keluaran `loadOrderDto`.
- `loadOrderHandovers`: task tertaut hidup; task terbaca = `readable: true`, task di lokasi tak terbaca = hanya `id`, `number`, `status`, `readable: false` (`customerName` kosong); task terhapus tidak ditampilkan.
- `handoverContext`: task harus terbaca dan hidup (selain itu `NOT_FOUND`); `orders` = SO tertaut task ini pada BU `serialwh: edit`; `detected` = `detectItemsInNote` dengan label.

- [ ] **Step 1:** Tes merah lalu implementasi. Tes kunci:
  - `handover-candidates.test.ts` "hak lokasi task": task di lokasi tanpa `handover: view`/`qc: edit` tak muncul; "task terhapus tak pernah muncul" (juga bagi `handover: manage`); "bawaan hanya berjalan, maks. 5, terbaru dulu"; "includeFinished"; "linked di depan dan tercentang"; "mentionsItem memberi peringkat, bukan filter".
  - `handover-links.test.ts` "submit menautkan task" (lewat A, `addOrderLinksStmts`), "setLinks mempertahankan tautan tak terbaca", "setLinks id baru tak terbaca = NOT_FOUND", "basi = 412", "audit links_update".
  - `handover-context.test.ts` "deteksi tunggal dan ganda", "task terhapus = NOT_FOUND", "SO tertaut hanya pada BU edit".
- [ ] **Step 2:** Commit `feat(serialwh): tautan task Serah Terima dan pemilih kandidat`.

---

### Task D: Web form Keluar Gudang (Sonnet)

**Files (milik):** `web/src/modules/serialwh/components/dispatch-page.tsx` (ganti stub), `dispatch-table.tsx`, `dispatch-cards.tsx`, `dispatch-header.tsx` (field Item terkunci + chip BU/Lokasi/Tanggal uji + saklar), `scan-bar.tsx`, `warning-banners.tsx`, `confirm-dialog.tsx`, `order-number-combobox.tsx`, `submit-progress-dialog.tsx`, `clipboard-result-dialog.tsx`, `type-mismatch-dialog.tsx`; `web/src/modules/serialwh/lib/{draft-store,draft,scan,submit,clipboard,warnings}.ts`; tes `*.test.ts(x)` di folder yang sama; rute `web/src/routes/_app/serial/gudang/index.tsx` (isi komponen saja; berkas dibuat T0).

**Interfaces — consumes:** `queries.ts`, `keys.ts` (T0), `HandoverLinkPicker` (E), `SerialScanInput`/`CameraScanButton` (serial, tanpa diubah), `CustomerCombobox` (handover, tanpa diubah), kit `FormPage`, `DataTable` (+ shift-klik/pilih tarik yang sudah ada), `MobileCard`, `FilterChip`/`useChipDraft`, `LinkField`, `useFocusIntoView`, `newUuid`, `clipboardText`.

Aturan terkunci (spek 5.3-5.6, 5.11, 5.12, 5.14 pemakaian 1):
- Tata letak: desktop field Item (`LinkField` + `Label required`, `onSearchChange` ke `itemOptions`) dan kolom Serial Number satu baris; chip BU (pilihan = `warehouseBuIds(me,'edit')`), Lokasi (`options.locations`), Tanggal uji, dan saklar "Sembunyikan yang sudah tercatat WH di BU ini" (bawaan menyala) di baris berikutnya; ponsel Item di atas, kolom scan menempel (`sticky`). Satu kolom Serial Number: mengetik = menyaring (tunda 350 ms), Enter/scan = memilih atau draf baru.
- Item terkunci bila ada >= 1 baris draf: gembok, pesan "Terkunci karena N serial sudah dipilih. Selesaikan pengeluaran Tipe ini, atau [Batalkan pilihan]."; Batalkan pilihan = konfirmasi bila ada baris `new`.
- Tabel kosong "Pilih Item atau scan serial untuk mulai" selama Item kosong. Isi = baris draf (selalu tampil, di atas) + halaman `serialWarehouse.serials` yang belum dipilih (paginasi "Muat lebih banyak"). Kolom: centang, SN, Item, BU, Lokasi, Tanggal uji, Status, badge ("Tercatat WH", "Draf baru", "Butuh foto"). Ponsel `MobileCard`.
- Hasil scan: `lib/scan.ts` fungsi murni `classifyScan(state, found: WarehouseSerialDto | null, normalized)` -> `{ kind: 'select' | 'confirm_switch_item' | 'error_type' | 'not_eligible' | 'new_draft' | 'missing_defaults' | 'duplicate_in_session'; warnings: ('test_date_diff' | 'bu_diff' | 'prior_same_bu' | 'prior_other_bu')[]; missing?: ('item' | 'bu' | 'location' | 'testDate')[] }` persis tabel 5.4 ("Sudah ada di SO ini" dinilai di dialog saat SO dipilih, karena SO belum diketahui saat scan). `missing_defaults` menyorot chip/field yang kurang. Getar/nada sukses dan getar ganda galat bila didukung. Fokus kembali ke input setelah scan.
- `warnings.ts`: hitung ulang warning per baris saat chip BU berubah; banner ringkas di atas tabel (tanggal uji beda, BU berbeda, pernah keluar) yang dapat dibuka.
- Dialog konfirmasi (`confirm-dialog.tsx`, `size="full-on-phone"`/layar penuh ponsel): Tanggal keluar (bawaan hari ini WIB, tak boleh lewat hari ini); No SO = `order-number-combobox.tsx` (pola `CustomerCombobox`, saran `orderOptions`, cocok persis `orderKey` = SO lama, selain itu lencana "SO baru" + "Dibuat saat disimpan"); BU (terkunci bila SO lama dan ikut BU SO, warning dihitung ulang); Customer (`CustomerCombobox` + `options.customers`; terkunci dari SO lama); Tautan task (`HandoverLinkPicker`, task asal `?handover` terkunci tercentang + info "SO ini akan ditautkan ke task ..."); Catatan (maks. 1.000); ringkasan (jumlah, baru, Tipe, rentang tanggal uji); banner foto bila ada baris `new` beritem wajib foto (teks persis 5.5); warning tanggal uji/BU dengan jumlah. Saat SO lama dipilih: `lookup` ber-`orderId` per 200 id di latar; baris `inOrder` ditampilkan "Sudah ada di SO ini" dengan tombol "Keluarkan dari pilihan" dan Simpan ditahan sampai dibereskan.
- Kirim (`lib/submit.ts`): bekukan `submission` di draf (clientId pengeluaran, header, `chunkSize = 200`), kirim potongan berurutan, simpan `sentChunks` setelah tiap sukses; `UNAVAILABLE` = berhenti, progres dapat dilanjutkan; galat per SN = tandai baris, draf utuh. `submit-progress-dialog` tak dapat ditutup tak sengaja. Selesai: tulis clipboard (1.7), kosongkan draf, tampilkan hasil "Salin lagi" + "Buka riwayat".
- `?handover=<id>`: muat `handoverContext`; isi customer dialog, centang task, sarankan SO tertaut; 1 Item terdeteksi = isi otomatis + banner "Terisi dari catatan task (N baris menyebut <Item>). Ubah"; >1 = chip saran; Item otomatis boleh diganti selama belum ada pilihan.
- Bar bawah ponsel "Salin ke clipboard (N)"; bar judul desktop tombol utama sama; menu ⋯ (Riwayat, Kosongkan pilihan).

- [ ] **Step 1:** Tes murni `scan.test.ts` (tiap baris tabel 5.4), `draft-store.test.ts` (versi, rusak = kosong, 5.000 baris tulis/baca < 200 ms, `clientId` baris baru stabil), `submit.test.ts` (pembagian potongan beku, melanjutkan dari `sentChunks`, kiriman ulang potongan yang sama), `warnings.test.ts`.
- [ ] **Step 2:** Komponen + tes: `dispatch-page.test.tsx` "tabel kosong sebelum Item", "Item terkunci dan pesannya", "scan tipe beda tanpa pilihan = Ganti Item?", "scan tipe beda dengan pilihan = dialog error", "scan belum ada tanpa BU/Lokasi/Tanggal uji ditahan dan menyebut yang kurang", "draf tahan muat ulang"; `confirm-dialog.test.tsx` "SO baru otomatis (lencana)", "SO lama mengunci BU dan customer", "banner foto", "warning jumlah", "task asal tercentang"; `clipboard.test.ts` "gagal menulis = dialog Salin lagi tanpa kirim ulang"; satu tes ponsel (`MobileCard`, bar bawah).
- [ ] **Step 3:** Commit `feat(web): form Keluar Gudang dengan scan, draf, dialog konfirmasi, dan salin ke clipboard`.

---

### Task E: Web Riwayat, detail SO, pemilih tautan task, aksi dari Serah Terima (Sonnet)

**Files (milik):** `web/src/modules/serialwh/components/orders-page.tsx`, `order-detail-page.tsx`, `orders-filters.tsx`, `dispatch-section.tsx`, `handover-link-picker.tsx` (ganti stub), `link-handovers-dialog.tsx`, tes masing-masing; rute `web/src/routes/_app/serial/gudang/riwayat/index.tsx` dan `$orderId.tsx` (isi saja); Modify `web/src/modules/handover/components/handover-detail-view.tsx` (+ tesnya), `web/src/components/action-button.tsx` (`ACTIONS.warehouse`), `web/src/modules/access/lib/audit-actions.ts` (label `serialwh.dispatch_create` "Keluar Gudang dicatat", `serialwh.dispatch_cancel` "Keluar Gudang dibatalkan otomatis", `serialwh.links_update` "Tautan task SO diubah").

**Interfaces — consumes:** `queries.ts`, `keys.ts`, kit `ListPage`/`DataTable`/`FilterChip`/`ViewPage`/`ViewSection`, `LinkMultiField` (filter customer, BU). **Produces:** `HandoverLinkPicker` (props 1.7/T0).

Aturan terkunci (5.10, 5.11, 5.5 Tautan):
- Riwayat (`ListPage`): kolom No SO (`LinkCell` ke detail), BU, Customer, Pengeluaran, Serial, Terakhir, Status ("Belum selesai" bila `hasPending`), Task (jumlah); filter teks, Customer (`LinkMultiField`), BU (`LinkMultiField`, BU `view`), rentang tanggal (draf chip), Status; berpaginasi infinite; search param `replace: true`.
- Detail (`ViewPage`): ringkasan SO; bagian "Task Serah Terima" (baris membuka `/handover/$id` hanya bila `readable`; "Tautkan task" membuka `link-handovers-dialog` berisi `HandoverLinkPicker`, lepas per task; keduanya hanya bila `canEdit`; simpan lewat `setLinks` dengan `expectedUpdatedAt` saat dialog dibuka, 412 = pesan basi); daftar pengeluaran (tanggal, Tipe, jumlah, pelaku, catatan, status) dengan tabel serial berpaginasi (penanda "Terhapus") dan "Salin ulang" (hanya `done`; `copyText` lalu clipboard dengan cadangan dialog yang sama dari D: impor `ClipboardResultDialog` dari D, bukan menyalin); pengeluaran `pending` = "Belum selesai" + "Lanjutkan" (ke `/serial/gudang` bila draf `submission.dispatchId` cocok ada di perangkat, selain itu pesan "Draf tidak ada di perangkat ini; pengeluaran dibatalkan otomatis setelah 7 hari").
- `HandoverLinkPicker`: tanpa customer = petunjuk "Isi customer dulu" + kolom cari; dengan customer = `linked` (tercentang, di atas) + maks. 5 task berjalan; baris = centang + nomor + tanggal + cuplikan + lencana status + lencana "Menyebut <Item>" bila `mentionsItem`; "Cari task lain" dan saklar "Tampilkan yang sudah selesai"; kosong = "Tidak ada task berjalan untuk customer ini"; tanpa centang otomatis; `lockedIds` tak dapat dilepas; maks. 20.
- Aksi "Keluar Gudang" di detail task: tampil bila `canUseWarehouse(me)` dan task tidak terhapus; membuka `/serial/gudang?handover=<id>` lewat `useStackNavigation().push`; bukan aksi utama (masuk "Aksi lainnya").

- [ ] **Step 1:** Tes merah lalu implementasi: `orders-page.test.tsx` (filter jamak, status Belum selesai), `order-detail-page.test.tsx` ("Salin ulang hanya selesai", "Tautkan task hanya bagi edit", "task tak terbaca tanpa tautan", "412 basi"), `handover-link-picker.test.tsx` ("tanpa centang otomatis", "linked di atas tercentang", "maks. 5", "lencana Menyebut", "task asal terkunci"), `handover-detail-view.test.tsx` ("aksi Keluar Gudang hanya bagi serialwh edit, tidak untuk task terhapus").
- [ ] **Step 2:** Commit `feat(web): Riwayat Keluar Gudang, detail SO, dan tautan task Serah Terima`.

---

### Task H: Web badge dan filter Serial (bagian 8) (Sonnet)

**Files (milik):** `web/src/modules/serial/components/serial-list-page.tsx`, `serial-filters.tsx`, `web/src/modules/serial/lib/list-filter.ts`, `web/src/modules/serial/components/timeline.tsx`, beserta tesnya (`serial-list-page.test.tsx`, `serial-filters.test.tsx` bila ada, `timeline.test.tsx`).

**Interfaces — consumes:** `SerialSummaryDto.whCreated|whRecorded|needsProof`, `SerialListInput.whRecorded|needsProof` (T0), `WAREHOUSE_SOURCE`, `warehouseRecordedNote`.

- [ ] **Step 1:** Badge "Tercatat WH" (soft `info`) dan "Butuh foto" (soft `warning`) pada baris tabel dan `MobileCard` daftar Serial (badge hanya teks). Chip enum "Gudang" (`Select`: Semua / Tercatat WH / Belum tercatat WH) -> `whRecorded`; chip "Butuh foto" (`Select`: Semua / Butuh foto) -> `needsProof`; search param tunggal, `replace: true`; skema di `list-filter.ts`.
- [ ] **Step 2:** Linimasa detail Serial: kejadian `recorded` dengan `data.source === 'warehouse'` berjudul "Dicatat Gudang · SO <no>" (dari `data.orderNumber`).
- [ ] **Step 3:** Tes: badge tampil/tidak sesuai DTO, chip mengirim param yang benar, label linimasa. Commit `feat(web): badge dan filter Tercatat WH serta Butuh foto di daftar Serial`.

---

### Task F: Saran Item di checklist (5.15) dan lencana deteksi (5.14) (Sonnet)

**Files (milik):** `server/src/modules/item/name-options.ts` (ganti stub) + `name-options.test.ts`; `web/package.json`, `bun.lock` (SATU-SATUNYA jalur yang menyentuhnya: `@tiptap/suggestion@3.31.4`); `web/src/modules/handover/lib/item-suggest-extension.ts`, `web/src/modules/handover/lib/item-names.ts`, `web/src/modules/handover/components/item-suggest-list.tsx`, `web/src/modules/handover/components/item-badges.tsx`, Modify `note-editor.tsx`, `note-view.tsx` + tes. Bagian F2 (dapat dipisah, keputusan terbuka 5): Create `server/src/modules/handover/detected-items.ts` (SEMUA SQL baru di sini, bersaring `liveWhere`, agar sidik soft delete berkas lama tak bergeser) dan Modify `server/src/modules/handover/service.ts` hanya untuk memanggilnya dari `dtoOf` (aditif `detectedItems`) + tes `server/src/modules/handover/detected-items.test.ts`.

**Interfaces — consumes:** `suggestItemsFor`, `detectItemsInNote`, `itemDisplayName` (T0), `items.nameOptions`.

Aturan terkunci:
- `items.nameOptions`: Item hidup aktif pada BU ber-`item: view` pemanggil (filter BU `EXISTS item_business_units`), maks. 5.000, `truncated` bila lebih; tanpa hak = 403 (klien tidak memanggil bila `!can(me,'item','view')`). Dimuat SEKALI per editor (`staleTime` 5 menit).
- Ekstensi: `Suggestion` dari `@tiptap/suggestion` dengan `findSuggestionMatch` kustom (tanpa karakter pemicu; `char: ''` tidak dipakai) yang memanggil `suggestItemsFor` pada teks paragraf sebelum kursor; aktif hanya bila kursor berada di dalam simpul `taskItem`; ditekan setelah transaksi tempel (`tr.getMeta('uiEvent') === 'paste'`) sampai ada ketikan berikutnya. Tombol: Tab = terima teratas; panah atas/bawah = sorot; Enter = terima yang disorot HANYA bila ada sorotan (tanpa sorotan Enter diteruskan dan membuat baris baru); Esc = tutup. Pilihan mengganti rentang `range.start..kursor` dengan `itemDisplayName` sebagai teks polos.
- Tampilan: daftar maks. 6 di bawah kursor (desktop, portal), baris saran di atas papan ketik (ponsel, `--kb`).
- Lencana (5.14/5.15): di editor (data `items.nameOptions`) dan di `note-view` (data `HandoverDto.detectedItems` dari server bila F2 dikerjakan, selain itu hanya bila pembaca punya `item: view`), nama Item di ujung baris checklist + ringkasan di bawah; dihitung, tidak disimpan.
- Paket: periksa `verify-dist` (anggaran 600 KB gzip per potongan) setelah dependensi ditambahkan.

- [ ] **Step 1:** Server `name-options` + tes (BU, hidup/aktif, batas, 403).
- [ ] **Step 2:** Ekstensi + tes (`item-suggest-extension.test.ts`): muncul hanya di baris checklist, tidak saat menempel (konversi WhatsApp tak berubah: tes `paste-extension` tetap hijau), Enter tanpa sorotan membuat baris baru, Tab/Enter menyisipkan teks polos tanpa Markdown, pengguna tanpa hak Item tak memanggil rute dan tak melihat saran.
- [ ] **Step 3:** Lencana + tes. F2 (bila disetujui): `detectedItems` pada `handovers.get` dengan Item hidup aktif (cakupan = keputusan terbuka 5), tes "hanya nama yang tertulis di catatan".
- [ ] **Step 4:** `bun run build` (verify-dist) lalu commit `feat(handover): saran nama Item saat mengetik checklist dan lencana Item terdeteksi`.

---

### Task G: Dokumen (Haiku, fase 2)

**Files (milik):** `CLAUDE.md`, `docs/superpowers/specs/2026-11-12-serial-number-design.md`, `docs/superpowers/specs/2026-11-18-serial-unik-sistem-design.md`, `docs/superpowers/specs/2026-11-18-serial-catat-wajib-foto-design.md`, `docs/superpowers/specs/2026-11-26-serial-keluar-gudang-design.md` (status, nomor migrasi 0040, keputusan yang dikonfirmasi), `server/changelog.d/20261126-serial-keluar-gudang.md`, `desktop/changelog.d/20261126-serial-keluar-gudang.md`, `docs/e2e-checklist.md`.

- [ ] **Step 1:** `CLAUDE.md`: bullet baru "Keluar Gudang (serialwh)" (modul, rute, tabel, potongan, penyapu, pengecualian foto, badge), `BU_MODULES` memuat `serialwh`, pengecualian aturan `LinkField` (combobox No SO), saran Item checklist, potret kontrak (jumlah rute baru dari `api-contract.snapshot.json`), daftar migrasi.
- [ ] **Step 2:** Spek terkait sesuai spek bagian 11 (catat keputusan pemilik 2026-11-26 dengan tanggal absolut, ubah butir yang bertentangan).
- [ ] **Step 3:** Fragmen changelog (`feat(serialwh): ...`, `feat(handover): ...`, `feat(serial): ...`; desktop karena `shared/` berubah). `bun run changelog validate`.
- [ ] **Step 4:** Butir uji manual (clipboard di Chrome/Safari, pemindai Bluetooth, pilih tarik di ponsel, 1.000+ serial).

---

### Task V: Verifikasi akhir (Sonnet)

- [ ] `bun run api:snapshot --check`; `bun run typecheck`; Biome; `bun run build` (verify-dist).
- [ ] Tes terarah (tunnel hidup): `bun run --cwd server test src/modules/serialwh src/modules/serial src/modules/handover src/modules/item src/core`; `bun test shared scripts`; `bun run --cwd web test`. Lalu `bun run check` penuh.
- [ ] Pastikan tak ada berkas di luar daftar milik jalur yang berubah (`git diff --stat origin/dev`).

### Task R: Review akhir putaran (independen, model lebih tinggi)

- [ ] Reviewer baru diberi diff + spek (tanpa kesimpulan implementer): kesesuaian spek/CLAUDE.md, kebenaran, regresi, dan security review dengan skill `security-audit` difokuskan pada perubahan ini dan permukaan yang disentuhnya. Temuan ditangani menurut aturan "Menangani temuan review" pemilik.

---

## 3. Checklist pagar yang wajib diperbarui bersamaan

| Pagar | Jalur pasti | Perubahan |
|---|---|---|
| Tabel, migrasi, indeks | `server/src/core/migrate.test.ts` | `EXPECTED_TABLES` +5, judul "51 tabel", nama `0040_serial_keluar_gudang.sql`, 10 indeks (1.2) |
| Pagar kontrak ID | `server/src/core/legacy-ids.test.ts` | properti string baru bukan-ID ke `NON_ID_CONTRACT_KEYS` (tanpa nama basi) |
| Contoh rute | `shared/api.test.ts` | `EXAMPLES` untuk 14 id baru; jalur statis sebelum `{id}` |
| Batas badan | `server/src/http/body.test.ts` | `WORST` untuk `submit`, `lookup`, `setLinks` |
| Potret kontrak | `shared/api-contract.snapshot.json` | `bun run api:snapshot` sekali di T0 |
| Grup versi | `shared/api-versions.ts` (+ `api-versions.test.ts`) | `serialWarehouse` |
| Modul ber-BU | `shared/business-units.test.ts`, `shared/permissions.test.ts`, `shared/assignments.test.ts` | daftar `BU_MODULES`, `fullBuPermissions`, `MODULES` |
| Fixture izin | 56 berkas `grep -rln "serialservice: '"` | tambah `serialwh` |
| Jenis halaman | `web/src/app/route-meta-coverage.test.ts` | `FORM_FULL` `/serial/gudang`, `INDEX` `/serial/gudang/riwayat`, `VIEW` `/serial/gudang/riwayat/$orderId` |
| Kerangka halaman | `scripts/page-frame.test.ts` | rute baru merender `FormPage`/`ListPage`/`ViewPage` (stub T0 sudah) |
| Nav | `web/src/app/navigation.ts`, `navigation.test.ts`, `navigation-desktop.test.ts` | dua butir baru, `excludes` Daftar |
| Panduan | `web/src/modules/guide/catalog/module-coverage.test.ts`, `catalog/serial.ts` | `serialwh` di `MODULES_WITHOUT_GUIDE_YET` bersamaan dengan `MODULE_LINKS`; `SERIAL_LIST_EXCEPT` + `/serial/gudang` |
| Soft delete | `server/src/core/soft-delete-guard.test.ts`, `server/src/core/soft-delete-pending.ts` | `liveWhere` di kueri baru; pengecualian beralasan (Riwayat serial terhapus) |
| Audit | `server/src/core/audit-target.test.ts`, `web/src/modules/access/lib/audit-actions.ts` (+ test) | `targetId` pada penulis `serialwh.*`; label aksi |
| Aksi tombol | `web/src/components/action-button.tsx` | `ACTIONS.warehouse` |
| Tanpa select/file bawaan | `scripts/no-native-select.test.ts`, `scripts/no-native-file-input.test.ts` | tetap hijau |
| Palet/kontras | `scripts/no-raw-palette.test.ts`, `web/src/styles.contrast.test.ts` | badge memakai token |
| Navigasi ponsel | `scripts/mobile-navigation-guard.test.ts` | `navigate({search})` = `replace`; `useStackNavigation` di form |
| Anggaran build | `scripts/verify-dist.ts` | setelah `@tiptap/suggestion` |
| Penyapu | `server/src/jobs/runner.ts` (`schedulerTick`) | `sweepStaleDispatches` |
| Changelog | `server/changelog.d/`, `desktop/changelog.d/` | fragmen baru |

---

## 4. Review Focus (mode gagal paling mungkin)

1. **Kebocoran lintas BU.** `lookup`/`serials`/`orderOptions`/`handoverCandidates` mengembalikan field di luar daftar putih (catatan, pelaku, foto, kejadian) atau SO/task dari BU/lokasi di luar hak; `serialwh` keliru membuka `serials.get`/`serials.list`. Uji: tes kunci DTO persis dan 403/`NOT_FOUND` per izin.
2. **Idempotensi potongan dan stok dobel.** Kiriman ulang potongan, balapan serial draf yang sudah dicatat QC, atau ulang otomatis setelah galat duplikat yang menulis ulang stiker/kejadian/pemotongan stok. Uji: stok sebelum/sesudah, jumlah kejadian `recorded`.
3. **Balapan dan CAS.** Dua kiriman membuat SO yang sama; serial berubah status di antara pra-cek dan tulis (wajib penjaga CAS di batch); penyapu membatalkan bersamaan potongan terakhir (`status = 'pending'` dijaga CAS di kedua sisi).
4. **Tautan task.** Task terhapus atau di lokasi tak terbaca ikut tertaut/tampil; `setLinks` menghapus tautan task yang tak terbaca pemanggil; centang otomatis; aksi "Keluar Gudang" tampil untuk task terhapus.
5. **Draf dan clipboard di ribuan baris.** Draf rusak/terlalu besar di `localStorage`, `clientId` baris baru berubah antar muat ulang (membuat serial ganda), pembagian potongan tidak beku saat melanjutkan, dan clipboard gagal setelah server sukses lalu UI mengirim ulang alih-alih menampilkan "Salin lagi".

---

## 5. Menunggu keputusan pemilik

Nomor di bawah dirujuk tugas sebagai "keputusan terbuka N". Sampai diputuskan, pembangun memakai usulan yang tertulis; setiap keputusan dicatat di spek (tanggal absolut, alasan, "disetujui pemilik produk").

1. **Bagian B (peringatan scan ulang QC) tidak ada di `origin/dev`**: tidak ada dialog "Lanjut menyimpan", dan `SerialExistingDto` tanpa lokasi unit/pelaku/waktu kejadian terbaru. Usul: rencana terpisah setelah rencana ini (atau tugas tambahan bila pemilik mau digabung).
2. **No SO yang sudah ada di BU tanpa hak `serialwh`**: usul `CONFLICT` generik "No SO sudah dipakai" (mengungkap keberadaan nomor saja, bukan BU/customer).
3. **Urutan clipboard**: usul urutan scan (yang pertama di atas, = `seq`), sedangkan kartu ponsel menampilkan yang terbaru di atas; spek 5.6 menulis "urutan seperti di tabel".
4. **Status foto yang dihitung untuk "Butuh foto"**: usul semua kecuali `draft` dan `failed` (`queued`, `processing`, `done` dihitung).
5. **Cakupan F2 (lencana Item untuk pembaca task)**: masuk v1 atau dipisah; cakupan Item untuk pembaca tanpa hak Item: usul semua Item hidup aktif (yang dikembalikan hanya nama yang memang tertulis di catatan).
6. **Melanjutkan pengeluaran yang sudah dibatalkan otomatis**: usul tidak dapat; draf membuat pengeluaran baru (`clientId` baru) dan serial yang sudah dibuat dikirim sebagai `existing`.
7. **Kolom "catatan umum" SO (spek 5.8)**: usul tidak ada di v1; catatan hanya per pengeluaran.
8. **Menu**: usul dua butir sidebar (Keluar Gudang bagi `edit`, Riwayat Gudang bagi `view`), bukan satu.
9. **Customer pada SO lama**: usul customer SO menang, isian dialog diabaikan server (dialog menguncinya).
10. **Task tertaut di detail Riwayat**: usul task di lokasi tak terbaca tampil nomor saja tanpa tautan; task terhapus disembunyikan.
11. **Nomor migrasi**: 0040 (spek menyebut 0038, yang sudah terpakai); catatan, bukan keputusan.

## 6. Self-review

- Spek 4 butir 1-23: izin per BU (T0), scan lintas BU + buat (A, D), satu Tipe/beda Tipe galat/tanggal uji warning (A, D), isian bawaan dari chip (D), draf sampai Salin (D), isi dialog + BU (D), satu SO satu BU + gabung SO (A), tanpa batas jumlah (A potongan, D draf), Riwayat (E), dari Serah Terima (B, E, D), wajib foto dikecualikan + badge + banner (A, H, D), badge Tercatat WH + saklar sembunyikan (A, H, D), BU beda warning (D), keluar lagi di BU lain (A unik per SO saja), B dan C (C sudah ada; B menunggu keputusan), stiker baru saja (A), SO otomatis (A, D), Item wajib terkunci (D), pemilih task tanpa menghafal (B, E), pilih rentang (kit yang ada, dipakai D/E), tabel kosong (D), satu kolom SN (D), pencocokan nama (T0, B, D, F).
- Spek 5.1-5.12, 5.14, 5.15: dipetakan di T0 (5.1, 5.2, 5.8 skema), D (5.3-5.6, 5.11 sisi form, 5.12), A (5.7-5.9), E (5.10, 5.11 aksi), B (5.5 tautan, 5.7 kandidat/setLinks, 5.14 pemakaian 2), F (5.15, lencana), T0 (fungsi murni 5.14/5.15). 5.13 sudah ada dan dipakai.
- Spek 8: A (server) + H (web).
- Tanda tangan: `WarehouseSubmitInput`, `HandoverLinkPickerProps`, `handover-links.ts`, `loadOrderDto`, `detectItemsInNote`, `suggestItemsFor` dipakai dengan nama yang sama di semua tugas.
- Kepemilikan berkas: tiap berkas hanya di satu jalur; stub yang dibuat T0 dimiliki jalur pengisinya (T0 hanya membuat kerangka).
