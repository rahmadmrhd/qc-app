# Serial Number tahap 5a (inti) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pencatatan Serial Number (SN) per BU dengan tabel sementara, ubah massal, berkas `.qcsn`, pemindai fisik, daftar centang stiker yang memotong stok otomatis (boleh negatif), riwayat bergaya tiket (jenis `recorded`, `data_changed`, `recheck`, `note`), izin ber-BU `serial`, serta daftar dan detail.

**Architecture:** Modul server baru `server/src/modules/serial/` (repo, service, validate, routes) di belakang REST `/api/v1/serials*`; fungsi murni di `shared/serials.ts` dan `shared/serial-file.ts`; satu migrasi `0011_serial_number.sql` (expand-only, ditambah pencabutan `CHECK` stok); pemotongan stok disusun sebagai pernyataan SQL (`serialDeductStmts` di `stock-repo.ts`) ke dalam `batch()` tiap baris serial lewat bus event kecil (`server/src/core/events.ts`). Web: `web/src/modules/serial/` dengan tabel sementara yang disimpan di `localStorage`.

**Tech Stack:** Bun, Hono, MariaDB 11.8 (adaptor `Db`), TypeScript, React + TanStack (Router, Query, Form), Tiptap, vitest (web), `bun:test` (server, shared).

**Spec:** `docs/superpowers/specs/2026-11-12-serial-number-design.md` (disetujui pemilik 2026-11-12). Induk: spek BU, 3a, 3b-2, Desktop (lihat §10 spek). **Cabang kerja:** `feat/serial-number-5a` dari `origin/dev`; PR ke `dev` (tanpa auto-merge).

**Di luar 5a (tahap berikutnya):** alur tidak lolos dan servis, `serial_cases`, email rusak, modul `serialservice` (modulnya terdaftar di T1 tetapi belum dipakai), sisip gambar pada pesan, `serials.history` berfilter, layar Cek ulang/Terima massal (5b/5c), pemindai kamera (5c). 5a hanya menerima status `good`.

## Global Constraints

- Tanpa stored procedure; semua aturan di kode server. Nilai SELALU di-bind (`?`); kolom `key`/`before`/`after` bertanda backtick; `SUM`/`COUNT` dibungkus `Number()`.
- Penulisan yang bergantung pada pembacaan terbaru memakai CAS di dalam `batch()` (`core/cas.ts`: `CAS_UPDATED_AT_SET`, `runCas`) atau `FOR UPDATE`; jangan baca lalu tulis tanpa salah satunya.
- Migrasi idempoten (`IF NOT EXISTS`), id `VARCHAR(100)`, waktu `VARCHAR(30)` ISO, tanggal teks `YYYY-MM-DD`, kolasi `utf8mb4_nopad_bin`, kolom teks `NOT NULL DEFAULT ''` (bukan NULL; DTO memetakan `''` menjadi `null`). Pengecualian tunggal: pencabutan `CHECK` stok adalah pelonggaran kompatibel mundur.
- Serial unik per **(BU, serial)**; semua perbandingan memakai bentuk hasil `normalizeSerial`; duplikat dijawab generik "Serial sudah terdaftar" tanpa menyebut BU atau item lain.
- Di luar hak = `NOT_FOUND` (baca) atau hasil baris `invalid` generik (tulis massal); jalur tulis butuh level pada BU serial (`canActOnAllBus` dengan satu BU). Pembaca: level `view` pada `serial` **atau** `serialservice`.
- Stok boleh negatif **hanya** akibat pemotongan SN; stok keluar manual, opname, dan penjaga CAS yang ada tetap menolak hasil negatif. Riwayat stok dan `serial_events` hanya bertambah (tanpa UPDATE/DELETE di kode). Tidak ada pengembalian stok otomatis. Mengubah data serial tidak menyentuh stok.
- `shared/` murni: tanpa API runtime/DOM, tanpa dependensi (`zod` tidak dipakai di `shared/`), import relatif.
- Web: field relasi memakai `LinkField`/`LinkMultiField` (tanpa Tambah/Buka untuk item, BU, lokasi, stiker pada fitur ini); enum memakai `Select`; **tidak ada `<select>`**; dialog mengikuti aturan header/footer tetap; tes memilih opsi lewat `pickLink`/`pickSelect`.
- Rute JSON baru wajib masuk tabel `WORST` di `server/src/http/body.test.ts` dan `EXAMPLES` di `shared/api.test.ts`; id baru masuk `ALL_API_IDS` (`server/src/routes.ts:19`). JSON REST ≤ 2 MB.
- Tes server butuh `bun run db:tunnel` hidup. `bun run check` hijau sebelum tiap PR; jalankan juga di akhir T1, T5, T6, T8, dan T17.
- Batas awal: `serialMax` 64, `noteMax` 1.000, `messageMax` 5.000, `tableRows`/`inputLines` 1.000, `batchRows` 200, `stickerQtyMax` 99, berkas `.qcsn` 2 MB dan 1.000 baris.
- Commit per task dengan pesan Indonesia (`feat(serial): …`) dan trailer attribution sesi.

## Review Focus

1. **Serial sama di BU berbeda** tercatat sebagai dua catatan; serial sama di BU yang sama (termasuk konkurensi `Promise.all`) hanya satu `created`, sisanya `duplicate` (T8).
2. **Simpan ulang baris yang sama (retry `clientId`)** setelah commit tidak menjadi `duplicate` dan tidak memotong stok dua kali (T8).
3. **Stok negatif:** pemotongan SN boleh melewati nol; stok keluar manual dan opname menolak hasil negatif; opname dan stok masuk pada baris yang sudah negatif tetap bekerja; stiker `deprecated` menjadi `inactive` saat total `<= 0` (T5, T8).
4. **Varian MAC:** `4C:5E:0C:1A:2B:3D`, `4c-5e-0c-1a-2b-3d`, `4C5E.0C1A.2B3D`, dan `4C5E0C1A2B3D` adalah serial yang sama; `SN-12345` dan pemisah campuran tidak diubah (T2, T8).
5. **Berkas `.qcsn` dan draf bermusuhan atau terlalu besar:** kunci `__proto__`, baris melebihi batas, karakter kontrol, versi lebih baru, checksum rusak, kuota `localStorage` penuh (T3, T13).
6. **Hak akses:** pengguna `serial: view` tidak bisa menulis; pengguna BU lain atau tanpa penugasan BU menerima `NOT_FOUND`; pencatat tanpa `item: view` tetap dapat memilih item hanya di BU berlevel `serial: edit` (T7-T11).

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/serials.ts` (+`.test.ts`) | Konstanta, `normalizeSerial`, `serialProblem`, `splitSerialInput`, tipe status/kejadian |
| `shared/serial-file.ts` (+`.test.ts`) | Tipe `.qcsn`, `validateQcsn`, `qcsnCanonical` |
| `shared/contract.ts`, `shared/api.ts` | DTO dan id rute `serials.*` |
| `server/migrations/0011_serial_number.sql` | Tabel baru, kolom entri stok, pencabutan `CHECK` |
| `server/src/core/events.ts` | Bus event kecil (pendengar berbentuk penyusun pernyataan) |
| `server/src/modules/sticker/stock-repo.ts` | `serialDeductStmts`, `insertEntryStmt` memuat kolom serial, ambang `<= 0` |
| `server/src/modules/serial/{access,applicable,repo,service,validate,routes}.ts` | BU, stiker berlaku, SQL, aturan, validator, rute |
| `web/src/modules/serial/` | `queries.ts`, `lib/{draft,draft-store,qcsn}.ts`, `components/*`, rute di `web/src/routes/_app/serial/` |

---

### Task 1: Modul izin `serial` dan `serialservice` [Sonnet; bagian fixture mekanis boleh Haiku]

**Files:**
- Modify: `shared/permissions.ts` (`MODULES` :1-10, `MODULE_LABELS` :13, `MODULE_LEVELS` :38, `MODULE_LEVEL_HINTS` :57), `shared/business-units.ts` (`BU_MODULES` :8, `fullBuPermissions` :21), `shared/assignments.ts:119`, `web/src/app/module-links.ts`
- Modify (fixture): semua literal `PermissionMap` dan `BuPermissionMap` yang gagal typecheck (daftar awal: `shared/permissions.test.ts`, `shared/business-units.test.ts:24-26`, `shared/assignments.test.ts`, `server/src/modules/auth/rest.test.ts`, `server/src/routes.test.ts`, `server/src/modules/access/context.test.ts`, `web/src/app/navigation.test.ts`, `web/src/app/prefetch.test.ts`, `web/src/modules/access/components/role-form.test.tsx`, `web/src/modules/auth/permissions.test.ts`, `require-any-permission.test.ts`, `link-access.test.ts`, `handover-batch-form.test.tsx`; ikuti galat typecheck)

**Interfaces:**
- Produces: `ModuleKey` memuat `'serial' | 'serialservice'`; `BU_MODULES = ['item','serial','serialservice']`; `fullBuPermissions()` mengembalikan `manage` untuk ketiganya; `UserContext.businessUnits[buId].serial` dan `.serialservice`.

- [ ] **Step 1: Tes gagal.** Di `shared/business-units.test.ts` ubah ekspektasi menjadi `expect(BU_MODULES).toEqual(['item','serial','serialservice'])` dan `fullBuPermissions()` `toEqual({ item:'manage', serial:'manage', serialservice:'manage' })`. Di `shared/assignments.test.ts` tambah tes: role `{ serial:'edit' }` pada penugasan **BU tertentu** tidak membuat `global.serial` menjadi `edit`; pada penugasan "Semua BU" (`buId:null`) `global.serial` = `edit` (cermin tes `item` yang sudah ada).
- [ ] **Step 2:** `bun test shared/business-units.test.ts shared/assignments.test.ts` → FAIL.
- [ ] **Step 3: Implementasi.** `MODULES` + `MODULE_LABELS` ("Serial Number", "Servis Serial Number") + `MODULE_LEVELS` (`serial`: none/view/edit/manage; `serialservice`: none/view/edit; ikuti bentuk entri `item`) + hints singkat; `BU_MODULES` dan `fullBuPermissions`; ganti penimpaan hard-code `global.item = globalBuLevel(...)` di `shared/assignments.ts:119` dengan loop atas `BU_MODULES`; tambah dua entri di `web/src/app/module-links.ts`. Perbaiki semua fixture sampai `bun run typecheck` bersih (nilai `'none'` pada literal `PermissionMap`, `{ item: …, serial: 'none', serialservice: 'none' }` pada `BuPermissionMap`).
- [ ] **Step 4:** `bun test shared` PASS, lalu `bun run check` PASS (butuh tunnel).
- [ ] **Step 5: Commit** `feat(serial): modul izin ber-BU serial dan serialservice`.

---

### Task 2: `shared/serials.ts` (normalisasi dan pemecah masukan) [Sonnet]

**Files:** Create `shared/serials.ts`, `shared/serials.test.ts`.

**Interfaces — Produces:**
```ts
export const SERIAL_STATUSES = ['good','failed','qc_repair','at_service','service_repair','recheck','broken'] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];
export const SERIAL_CUSTODIES = ['qc','transit','service'] as const;
export type SerialCustody = (typeof SERIAL_CUSTODIES)[number];
export const SERIAL_EVENT_TYPES = ['recorded','data_changed','recheck','note','report_failure','identify_damage','attempt_repair','send','receive','service_diagnosis','declare_broken','recheck_pass','recheck_fail'] as const;
export type SerialEventType = (typeof SERIAL_EVENT_TYPES)[number];
export const SERIAL_LIMITS = { serialMax: 64, noteMax: 1000, messageMax: 5000, inputLines: 1000, tableRows: 1000, batchRows: 200, stickerQtyMax: 99 } as const;
export function normalizeSerial(raw: string): string;
export function serialProblem(normalized: string): 'empty' | 'too_long' | 'control_chars' | null;
export interface SplitResult { serials: string[]; duplicates: number; rejected: string[]; truncated: boolean }
export function splitSerialInput(text: string, max?: number): SplitResult;
export function isIsoDate(value: string): boolean;
```

- [ ] **Step 1: Tes** (`bun:test`) dengan nilai tepat:
  - `normalizeSerial('  4c:5e:0c:1a:2b:3d ')` dan `('4C-5E-0C-1A-2B-3D')`, `('4C5E.0C1A.2B3D')`, `('4c5e0c1a2b3d')` semuanya `'4C5E0C1A2B3D'`.
  - `normalizeSerial('sn-12345')` = `'SN-12345'`; `('4C:5E-0C:1A:2B:3D')` (pemisah campuran) tetap `'4C:5E-0C:1A:2B:3D'`; `('0x4C5E0C1A2B3D')` tetap `'0X4C5E0C1A2B3D'`.
  - `serialProblem('')` = `'empty'`; 65 karakter = `'too_long'`; `'AB\u0000C'`, `'AB‮C'` = `'control_chars'`; `'AB12'` = `null`.
  - `splitSerialInput('a\r\nb\n\nA\rc\n')` → `serials ['A','B','C']`, `duplicates 1`; baris dengan karakter kontrol di tengah masuk `rejected`; `splitSerialInput` pada 1.001 baris unik → `serials.length 1000`, `truncated true`; QR berisi `'4C:5E:0C:1A:2B:3D\n4C5E0C1A2B3E'` menghasilkan dua serial.
  - `isIsoDate('2026-11-12')` true; `'2026-13-01'`, `'2026-02-30'`, `'12-11-2026'` false.
- [ ] **Step 2:** `bun test shared/serials.test.ts` → FAIL.
- [ ] **Step 3: Implementasi.** `normalizeSerial`: `trim()`, `toUpperCase()`, lalu bila **seluruh** string cocok `^[0-9A-F]{2}([:-])(?:[0-9A-F]{2}\1){4}[0-9A-F]{2}$` atau `^[0-9A-F]{4}\.[0-9A-F]{4}\.[0-9A-F]{4}$` buang pemisahnya. `serialProblem` memakai definisi karakter kontrol/pengatur arah yang sama dengan `hasControlChars` di `shared/postel.ts` (impor, jangan menyalin). `splitSerialInput` memecah `\r\n|\r|\n`, menormalisasi, membuang baris kosong, memisahkan yang bermasalah ke `rejected`, menghitung duplikat (urutan pertama dipertahankan), dan memotong di `max` (bawaan `SERIAL_LIMITS.inputLines`).
- [ ] **Step 4:** tes PASS.
- [ ] **Step 5: Commit** `feat(serial): normalisasi serial dan pemecah masukan di shared`.

---

### Task 3: `shared/serial-file.ts` (format `.qcsn`) [Sonnet]

**Files:** Create `shared/serial-file.ts`, `shared/serial-file.test.ts`.

**Interfaces — Consumes:** `normalizeSerial`, `serialProblem`, `SERIAL_LIMITS`, `isIsoDate`. **Produces:**
```ts
export const QCSN_FORMAT = 'qc-sn-batch'; export const QCSN_VERSION = 1;
export const QCSN_MAX_BYTES = 2_000_000; export const QCSN_MAX_ROWS = 1000;
export interface QcsnSticker { stickerId: string; stickerLabel: string; qty: number }
export interface QcsnRow { clientId: string; serial: string; testDate: string; itemId: string; itemLabel: string; buId: string; buLabel: string; locationId: string; locationLabel: string; sample: boolean; note: string; status: 'good'; source: 'manual' | 'countrylock'; capturedAt: string; reinjectedAt?: string; stickers?: QcsnSticker[] }
export interface QcsnFile { format: typeof QCSN_FORMAT; version: number; exportedAt: string; app: { name: string; version: string }; rows: QcsnRow[]; checksum: string }
export interface QcsnProblem { row: number | null; message: string }
export type QcsnParse = { ok: true; file: QcsnFile; rows: QcsnRow[]; problems: QcsnProblem[] } | { ok: false; message: string };
export function parseQcsn(text: string): QcsnParse;          // JSON.parse + validasi; tidak menghitung hash
export function qcsnCanonical(rows: readonly QcsnRow[]): string; // bentuk kanonis untuk hash (urutan kunci tetap)
```

- [ ] **Step 1: Tes** dengan nilai tepat: berkas sah → `ok:true`, serial baris dinormalisasi; teks > `QCSN_MAX_BYTES` → `ok:false`; `format` salah → `ok:false`; `version: 2` → `ok:false` dengan pesan memuat "versi lebih baru"; `rows.length 1001` → `ok:false`; baris dengan `"__proto__"`/kunci tak dikenal → kunci diabaikan dan hasil tidak mengubah `Object.prototype` (`({} as any).polluted` tetap `undefined`); baris dengan karakter kontrol pada `note` atau `serial` bermasalah → masuk `problems` dengan nomor baris dan baris itu tidak ada di `rows`; `sample` bukan boolean, `testDate` tidak ISO, `clientId` bukan 8-100 karakter `[A-Za-z0-9-]`, `qty` di luar 1..99 → `problems`; `clientId` kembar → baris kedua `problems`; `qcsnCanonical` stabil terhadap urutan kunci masukan; JSON rusak → `ok:false` tanpa melempar.
- [ ] **Step 2:** `bun test shared/serial-file.test.ts` → FAIL.
- [ ] **Step 3: Implementasi** validator tulisan tangan (pola `readObject` proyek boleh ditiru; tanpa dependensi). Baris tak valid tidak menggagalkan berkas; kegagalan tingkat berkas (format, versi, ukuran, jumlah baris, JSON) mengembalikan `ok:false`. Panjang string dibatasi (`itemLabel`/`buLabel`/`locationLabel` ≤ 255, `note` ≤ `noteMax`).
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(serial): format berkas .qcsn di shared`.

---

### Task 4: Migrasi `0011_serial_number.sql` [Sonnet]

**Files:** Create `server/migrations/0011_serial_number.sql`; Modify `server/src/core/migrate.test.ts` (`EXPECTED_TABLES` :208-231 dan daftar nama migrasi).

- [ ] **Step 1: Tes.** Perbarui `migrate.test.ts`: tiga tabel baru (`serials`, `serial_stickers`, `serial_events`) di `EXPECTED_TABLES` dan nama migrasi baru di daftar; tambah tes: `INSERT INTO sticker_stock` dengan `qty = -3` berhasil setelah migrasi; menjalankan migrasi dua kali tidak gagal (idempoten).
- [ ] **Step 2:** `bun run --cwd server test src/core/migrate.test.ts` → FAIL.
- [ ] **Step 3: DDL** (semua `IF NOT EXISTS`; kolasi dan mesin seperti `0005_stiker.sql`):
```sql
CREATE TABLE IF NOT EXISTS serials (
  id VARCHAR(100) NOT NULL, client_id VARCHAR(100) NOT NULL, bu_id VARCHAR(100) NOT NULL,
  serial VARCHAR(64) NOT NULL, item_id VARCHAR(100) NOT NULL, test_date VARCHAR(10) NOT NULL DEFAULT '',
  sample TINYINT NOT NULL DEFAULT 0, note VARCHAR(1000) NOT NULL DEFAULT '',
  location_id VARCHAR(100) NOT NULL DEFAULT '', recorded_location_id VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'good', custody VARCHAR(16) NOT NULL DEFAULT 'qc',
  transit_from_location_id VARCHAR(100) NOT NULL DEFAULT '', transit_to_location_id VARCHAR(100) NOT NULL DEFAULT '',
  assignee_user_id VARCHAR(100) NOT NULL DEFAULT '', open_case_id VARCHAR(100) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '', created_by VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '', updated_by VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY serials_bu_serial (bu_id, serial), UNIQUE KEY serials_client_id (client_id),
  KEY serials_bu_created (bu_id, created_at), KEY serials_item (item_id),
  KEY serials_location (location_id), KEY serials_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE TABLE IF NOT EXISTS serial_stickers (
  serial_id VARCHAR(100) NOT NULL, sticker_id VARCHAR(100) NOT NULL, qty INT NOT NULL DEFAULT 1,
  PRIMARY KEY (serial_id, sticker_id), KEY serial_stickers_sticker (sticker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
CREATE TABLE IF NOT EXISTS serial_events (
  id VARCHAR(100) NOT NULL, serial_id VARCHAR(100) NOT NULL, case_id VARCHAR(100) NOT NULL DEFAULT '',
  seq INT NOT NULL, type VARCHAR(32) NOT NULL, occurred_on VARCHAR(10) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '', actor_id VARCHAR(100) NOT NULL DEFAULT '',
  actor_name VARCHAR(255) NOT NULL DEFAULT '', actor_team VARCHAR(16) NOT NULL DEFAULT 'qc',
  message LONGTEXT NOT NULL DEFAULT '', changes_json LONGTEXT NOT NULL DEFAULT '', data_json LONGTEXT NOT NULL DEFAULT '',
  PRIMARY KEY (id), UNIQUE KEY serial_events_seq (serial_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
ALTER TABLE sticker_stock_entries ADD COLUMN IF NOT EXISTS serial_id VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE sticker_stock_entries ADD COLUMN IF NOT EXISTS serial_event_id VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE sticker_stock DROP CONSTRAINT IF EXISTS sticker_stock_qty_check;
```
- [ ] **Step 4:** tes PASS (templat tes diperbarui otomatis oleh hash migrasi). **Step 5: Commit** `feat(serial): migrasi tabel serial dan stok boleh negatif`.

---

### Task 5: Stok: jenis `serial`, `serialDeductStmts`, ambang `<= 0`, tampilan negatif [Sonnet]

**Files:** Modify `shared/stickers.ts` (`STOCK_ENTRY_KINDS` :84 + `formatStockQty`), `server/src/modules/sticker/stock-repo.ts` (`toStockEntry` :34-39, `insertEntryStmt` :171, `inactivateDeprecatedIfEmptyStmt` :109, penyusun baru), `server/src/modules/sticker/validate.ts:~314` (`expectedQty`), UI: `web/src/modules/sticker/components/{stock-page,stickers-page}.tsx` (+ label jenis entri di riwayat); tes: `stock-repo`/`rest.test.ts` stok, `shared/stickers.test.ts`.

**Interfaces — Produces:**
```ts
// shared/stickers.ts
export const STOCK_ENTRY_KINDS = ['in','out','adjust','opname','serial'] as const;
export function formatStockQty(qty: number): string; // 5 -> '5', -2 -> 'Kurang 2'
// stock-repo.ts
export interface SerialDeduction { stickerId: string; qty: number }
export function serialDeductStmts(db: Preparer, args: { serialId: string; eventId: string; locationId: string; picks: readonly SerialDeduction[]; actor: string; now: string }): DbStatement[];
```

- [ ] **Step 1: Tes.** (a) `formatStockQty(-2)` = `'Kurang 2'`, `(0)` = `'0'`. (b) Tes server: `serialDeductStmts` dijalankan lewat `env.DB.batch` pada stiker aktif dengan stok 1 dan `qty 3` → stok `-2` dan satu entri `kind 'serial'`, `delta -3`, `qty_after -2`, `serial_id`/`serial_event_id` terisi; `picks` diproses terurut `stickerId` (dua `serialDeductStmts` serentak lewat `Promise.all` pada pasangan stiker yang sama menghasilkan total stok yang benar tanpa galat); stok keluar manual (`recordStock` out) pada baris `-2` ditolak `VALIDATION`; stok masuk `+5` pada baris `-2` menghasilkan `3`; opname dengan `expectedQty: -2` diterima dan menyetel nilai baru; stiker `deprecated` dengan total `-1` setelah pemotongan menjadi `inactive`; riwayat stok mengembalikan `kind 'serial'` (bukan `'adjust'`) dan **tidak** memuat `serialId` di DTO (stok tidak dibatasi BU). (c) `isLowStock` tetap benar untuk total negatif.
- [ ] **Step 2:** `bun run --cwd server test src/modules/sticker` dan `bun test shared/stickers.test.ts` → FAIL.
- [ ] **Step 3: Implementasi.** `serialDeductStmts`: urut `picks` menurut `stickerId`; per pick: `lockStickerRowStmt`, upsert stok dengan penambahan negatif (penyusun baru tanpa penjaga kecukupan, pola `addStockStmt`), `insertEntryStmt` (diperluas dengan `serialId?`/`serialEventId?` opsional yang menulis kolom baru; panggilan lama tak berubah) berjenis `'serial'` dan `delta = -qty`; setelah semua pick `inactivateDeprecatedIfEmptyStmt` per stiker. Ubah kondisinya menjadi `... (SELECT COALESCE(SUM(qty), 0) ...) <= 0`. `toStockEntry` mengenali `'serial'`. Validator `expectedQty` menerima bilangan bulat negatif. UI: tampilkan `formatStockQty` (kelas `text-destructive` untuk negatif) di dua halaman dan label jenis entri "Dipotong Serial Number".
- [ ] **Step 4:** tes PASS; `bun run check` PASS. **Step 5: Commit** `feat(stiker): pemotongan stok serial boleh negatif`.

---

### Task 6: DTO kontrak, bus event, akses BU, stiker yang berlaku [Sonnet]

**Files:** Modify `shared/contract.ts` (tipe DTO saja, tanpa id rute); Create `server/src/core/events.ts`, `server/src/modules/serial/access.ts`, `server/src/modules/serial/applicable.ts` (+ tes `*.test.ts`).

**Interfaces — Produces:**
```ts
// shared/contract.ts (tipe)
export interface SerialStickerPick { stickerId: string; qty: number }
export interface SerialStickerDto { stickerId: string; name: string; alias: string; qty: number }
export interface SerialChangeDto { field: string; from: string | null; to: string | null }
export interface SerialEventDto { id: string; seq: number; type: SerialEventType; occurredOn: string; createdAt: string; actorName: string; actorTeam: 'qc' | 'service' | 'system'; message: string; changes: SerialChangeDto[]; data: Record<string, unknown> }
export interface SerialSummaryDto { id: string; buId: string; buCode: string; serial: string; itemId: string; itemLabel: string; testDate: string; sample: boolean; locationId: string; locationName: string; status: SerialStatus; custody: SerialCustody; createdAt: string }
export interface SerialDto extends SerialSummaryDto { note: string; recordedLocationId: string; stickers: SerialStickerDto[]; openCaseId: string | null; createdBy: string; updatedAt: string; updatedBy: string }
export interface SerialRowInput { clientId: string; serial: string; itemId: string; buId: string; testDate: string; locationId: string; sample: boolean; note: string; status: 'good'; stickers: SerialStickerPick[] }
export type SerialRowResult = { clientId: string; result: 'created' | 'duplicate' | 'invalid' | 'error'; message: string; id?: string; serial?: string }
export interface ApplicableStickerDto { id: string; name: string; alias: string; typeName: string; defaultQty: number }
// server/src/core/events.ts
export type StatementListener<P> = (env: Env, payload: P) => DbStatement[] | Promise<DbStatement[]>;
export interface EventPayloads { 'serial.recorded': SerialStockPayload; 'serial.stickers_added': SerialStockPayload }
export interface SerialStockPayload { serialId: string; eventId: string; locationId: string; picks: readonly { stickerId: string; qty: number }[]; actor: string; now: string }
export function onEvent<K extends keyof EventPayloads>(type: K, listener: StatementListener<EventPayloads[K]>): void; // idempoten per (type, listener)
export function statementsFor<K extends keyof EventPayloads>(env: Env, type: K, payload: EventPayloads[K]): Promise<DbStatement[]>;
// serial/access.ts
export function readableBuIds(user: UserContext): string[];            // level view pada serial ATAU serialservice
export function writableBuIds(user: UserContext): string[];            // level edit pada serial
export function assertSerialVisible(user: UserContext, buId: string): void;       // NOT_FOUND 'Serial tidak ditemukan'
export function canWriteBu(user: UserContext, buId: string): boolean;               // canActOnAllBus(..., 'serial', 'edit', [buId])
// serial/applicable.ts
export async function applicableStickersOf(env: Env, itemId: string, buId: string): Promise<ApplicableStickerDto[]>;
```

- [ ] **Step 1: Tes.** `access`: pengguna dengan `serial: view` hanya di BU A → `readableBuIds` = `['A']`, `writableBuIds` = `[]`, `assertSerialVisible(user,'B')` melempar `NOT_FOUND`; pengguna `serialservice: view` saja ikut `readableBuIds`; super admin melihat semua. `events`: `statementsFor` tanpa pendengar → `[]`; `onEvent` dua kali dengan fungsi yang sama hanya mendaftar sekali; pendengar dipanggil berurutan. `applicable` (fixture `seedItem` + instruksi stiker 3b-2 + `sticker-fixtures.ts`): penanda ke stiker tertentu menghasilkan stiker itu; penanda jenis aturan `bu` hanya stiker yang tertaut ke BU argumen (item di dua BU, argumen satu BU); jenis `group` Manual Book/Postel hanya bila item terhubung; stiker `inactive` dibuang; hasil tanpa duplikat; urut stabil menurut nama; `defaultQty` selalu 1.
- [ ] **Step 2:** FAIL. **Step 3: Implementasi.** `applicableStickersOf`: `loadItemInstructions(env.DB, [itemId])` (`instruction-repo.ts:98`) lalu `buildInstructionViews(env, itemId, [buId], photos)` (`instruction-service.ts:80`), ratakan `photos[].marks[].resolved`, buang `inactive`, dedupe menurut `id`, lengkapi `typeName`. `access.ts` memakai `buIdsWithLevel` dan `canActOnAllBus` dari `shared/business-units.ts` (tidak menyalin `item/access.ts`). Tipe `SerialEventType`/`SerialStatus`/`SerialCustody` diimpor dari `shared/serials.ts`.
- [ ] **Step 4:** PASS; `bun run check` PASS. **Step 5: Commit** `feat(serial): DTO kontrak, bus event, akses BU, stiker berlaku`.

---

### Task 7: `serials.itemOptions` dan `serials.stickerOptions` [Sonnet]

**Files:** Modify `shared/contract.ts` (`ApiContract` dua id), `shared/api.ts`, `shared/api.test.ts` (`EXAMPLES`), `server/src/routes.ts` (`ALL_API_IDS`, `realRoutes()`); Create `server/src/modules/serial/{validate,routes,service}.ts` (awal), `rest.test.ts`.

**Interfaces — Produces:** (ikuti pola `postels.itemOptions`, `server/src/modules/postel/items.ts:177-223`)
```ts
'serials.itemOptions': { input: { query?: string; cursor?: string; limit?: number }; output: { items: SerialItemOptionDto[]; nextCursor: string | null } }
'serials.stickerOptions': { input: { itemId: string; buId: string }; output: { stickers: ApplicableStickerDto[] } }
export interface SerialItemOptionDto { id: string; label: string; buIds: string[]; buOptions: { id: string; code: string }[] }
```
API_ROUTES: `GET /serials/item-options` (didaftarkan SEBELUM `/serials/{id}` kelak) dengan `query: {query:'string',cursor:'string',limit:'number'}`; `GET /serials/sticker-options` dengan `query: {itemId:'string',buId:'string'}`. Izin: `serial: edit`.

- [ ] **Step 1: Tes** (`rest.test.ts`, pola `postel/rest.test.ts`): pencatat `serial: edit` di BU A **tanpa** izin `item: view` melihat item aktif milik BU A saja (`buOptions` hanya BU yang boleh ia tulis); item hanya di BU B tidak muncul; item `inactive` tidak muncul; pencarian `query` lewat `normalizeKey`; kursor dan `limit` (bawaan 20, maks 50); `stickerOptions` untuk `buId` di luar hak atau item di luar BU → `NOT_FOUND`; pengguna `serial: view` saja → `FORBIDDEN` pada kedua rute.
- [ ] **Step 2:** FAIL. **Step 3: Implementasi** `queryItemOptions(env, user, input)` meniru `queryPostelItemOptions` dengan himpunan `writableBuIds(user)` (kosong → hasil kosong tanpa kueri) dan membawa `buOptions`; `stickerOptions` memverifikasi `canWriteBu` dan item ∈ BU (lewat `item_business_units`) sebelum `applicableStickersOf`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(serial): rute pilihan item dan stiker`.

---

### Task 8: `serials.saveBatch` (pencatatan, stok, riwayat) [Sonnet]

**Files:** Modify `shared/contract.ts`, `shared/api.ts`, `shared/api.test.ts`, `server/src/routes.ts`, `server/src/http/body.test.ts` (`WORST`); Create/Modify `server/src/modules/serial/{repo,service,validate,routes}.ts`, `rest.test.ts`; Modify `server/src/modules/access/repo.ts` pemetaan galat bila perlu (gunakan `mapDuplicateError` dengan peta `SERIAL_CONFLICTS`: `serials_bu_serial`, `serials_client_id`).

**Interfaces:** `'serials.saveBatch': { input: { rows: SerialRowInput[] }; output: { results: SerialRowResult[] } }`; `API_ROUTES`: `POST /serials/batch` (status 200); izin `serial: edit`. Fungsi: `saveSerialBatch(env, input, user): Promise<{ results: SerialRowResult[] }>`; per baris `createSerialOnce(env, row, ctx, user)` mengembalikan `SerialRowResult`.

**Aturan per baris (urut):** (1) validasi bentuk (serial lewat `normalizeSerial` + `serialProblem`, `clientId`, tanggal ISO tidak di masa depan menurut jam WIB `env`, `note` ≤ `noteMax`, `qty` 1..`stickerQtyMax`, `status === 'good'`) → `invalid`; (2) `canWriteBu(user, row.buId)` dan item aktif milik BU itu, lokasi ada dan aktif → bila tidak, `invalid` "Item tidak ditemukan atau tidak dapat dipakai"/"Lokasi tidak ditemukan" (generik, tanpa membocorkan); (3) tiap `stickerId` ada di `applicableStickersOf(item, bu)` dan tidak kembar → `invalid` "Stiker tidak berlaku bagi item ini"; (4) bila `client_id` sudah ada: serial dan BU sama → `created` dengan `id` lama (idempoten, tanpa efek baru), berbeda → `invalid`; (5) satu `env.DB.batch` berisi: `INSERT serials` (status `good`, custody `qc`, `recorded_location_id = location_id`), `INSERT serial_stickers`, `INSERT serial_events` (`seq 1`, `type 'recorded'`, `occurred_on` = tanggal hari ini WIB, `data_json` memuat stiker dan lokasi, `actor_team 'qc'`), lalu `statementsFor(env,'serial.recorded', …)`; (6) galat duplikat `serials_bu_serial` → `duplicate` "Serial sudah terdaftar"; duplikat `serials_client_id` akibat balapan → baca ulang dan perlakukan seperti (4); galat lain → `error` (pesan generik, tanpa detail SQL). Maks 200 baris per permintaan (`VALIDATION` bila lebih); tiap baris atomik sendiri, urut input. Pendengar stok didaftarkan di `server/src/modules/sticker/serial-listener.ts` yang memanggil `onEvent('serial.recorded', …)` → `serialDeductStmts`, dan diimpor oleh `serial/routes.ts` (pendaftaran idempoten).

- [ ] **Step 1: Tes** (`rest.test.ts`; nama dan nilai tepat):
  - `mencatat serial dan memotong stok per stiker tercentang`: stiker S1 (stok 5) dan S2 (stok 0) berlaku; baris dengan `S1 qty 1`, `S2 qty 2` → hasil `created`; stok S1 4, S2 `-2`; `serial_events` satu baris `recorded`, `serial_stickers` dua baris.
  - `stiker yang tidak dicentang tidak dipotong` (picks hanya S1 → stok S2 tetap).
  - `serial yang sama di BU lain tercatat terpisah` (dua BU, item di kedua BU; hasil dua `created`, dua baris `serials`).
  - `duplikat di BU yang sama` → `duplicate` dengan pesan tepat "Serial sudah terdaftar"; `4C:5E:0C:1A:2B:3D` setelah `4C5E0C1A2B3D` → `duplicate`.
  - `Promise.all` 5 permintaan serentak dengan serial sama → tepat satu `created`, empat `duplicate`, stok dipotong sekali.
  - `retry clientId` mengirim ulang baris yang sama → `created` dengan `id` sama, stok tidak berubah, satu `serials`.
  - `sebagian baris gagal tidak menggagalkan yang lain` (satu serial rusak karakter kontrol, satu item BU lain, satu sah) → hasil `invalid`, `invalid`, `created`; baris `invalid` tidak membocorkan nama item.
  - `pengguna serial: view` → `FORBIDDEN`; pengguna BU lain → baris `invalid`; 201 baris → `VALIDATION`.
  - `pemotongan tidak bergantung status/sample` (sample true tetap memotong).
  - `batch atomik per baris`: simulasikan galat pada pernyataan stok (stiker dihapus di tengah) → baris `error`, tidak ada serial/riwayat tertinggal.
  - Tambahkan `serials.saveBatch` ke `WORST` di `body.test.ts` (200 baris terburuk dengan catatan 1.000 karakter 6-byte; harus ≤ 2 MB).
- [ ] **Step 2:** FAIL. **Step 3: Implementasi** sesuai aturan; id baris/kejadian dengan pembangkit id modul lain; aktor dari `ActorRef` seperti `stock-service`. **Step 4:** PASS; `bun run check` PASS. **Step 5: Commit** `feat(serial): simpan serial dengan pemotongan stok otomatis`.

---

### Task 9: `serials.get` dan `serials.list` [Sonnet]

**Files:** Modify kontrak/api/routes/`ALL_API_IDS`/`EXAMPLES`; `server/src/modules/serial/{repo,service,validate,routes}.ts`, `rest.test.ts`.

**Interfaces:**
```ts
'serials.get': { input: { id: string }; output: { serial: SerialDto; events: SerialEventDto[] } }   // events menaik, maks 500
'serials.list': { input: SerialListInput; output: { items: SerialSummaryDto[]; nextCursor: string | null } }
export interface SerialListInput { query?: string; serials?: string[]; buId?: string; itemId?: string; locationId?: string; status?: SerialStatus; from?: string; to?: string; createdBy?: string; cursor?: string; limit?: number }
```
`API_ROUTES`: `serials.get` = `GET /serials/{id}` dengan `etag: 'updatedAt'`; `serials.list` = `GET /serials` dengan query `query, serials, buId, itemId, locationId, status, from, to, createdBy, cursor, limit` (`serials` = daftar dipisah baris baru, maks 200 baris sebelum normalisasi). Izin: `anyOf` [`serial: view`, `serialservice: view`]. Daftar urut `created_at DESC, id DESC`; kursor mengikuti pola daftar item; `limit` bawaan 50, maks 100.

- [ ] **Step 1: Tes:** `get` BU di luar hak → `NOT_FOUND` (bukan `FORBIDDEN`); pembaca `serialservice: view` boleh membaca; `events` menaik berdasar `seq` dan `changes`/`data` ter-parse; `serial.stickers` memuat nama stiker dan `qty`; `list` hanya BU terbaca (himpunan kosong → hasil kosong tanpa kueri, uji lewat spy jumlah kueri atau hasil), filter `from`/`to` inklusif pada `test_date`, `serials` banyak baris memakai bentuk ternormalisasi (`4C:5E:…` menemukan `4C5E…`), `query` mencari serial awalan ternormalisasi, kursor tanpa baris terlewat atau ganda pada 3 halaman berukuran 2, `limit` 101 → ditolak/dipotong 100.
- [ ] **Step 2:** FAIL. **Step 3: Implementasi** dengan `EXISTS`/`IN` atas `readableBuIds`; `etag` dari `updatedAt`. **Step 4:** PASS. **Step 5: Commit** `feat(serial): baca daftar dan detail serial`.

---

### Task 10: `serials.update` dan `serials.updateBatch` [Sonnet]

**Files:** kontrak/api/routes/`ALL_API_IDS`/`EXAMPLES`/`WORST`; `server/src/modules/serial/{repo,service,validate,routes}.ts`, `rest.test.ts`.

**Interfaces:**
```ts
'serials.update': { input: UpdateSerialInput; output: SerialDto }
'serials.updateBatch': { input: { rows: { id: string; expectedUpdatedAt: string; fields: Partial<SerialEditable> }[] }; output: { results: { id: string; result: 'updated'|'duplicate'|'stale'|'invalid'|'error'; message: string; updatedAt?: string }[] } }
export interface SerialEditable { serial: string; itemId: string; testDate: string; sample: boolean; note: string; locationId: string }
export interface UpdateSerialInput extends SerialEditable { id: string; expectedUpdatedAt: string }
```
`API_ROUTES`: `serials.update` = `PUT /serials/{id}`, `ifMatch: 'expectedUpdatedAt'`, `etag: 'updatedAt'`; `serials.updateBatch` = `POST /serials/batch-update`. Izin `serial: edit`; maks 200 baris.

**Aturan:** perlu `canWriteBu` pada BU serial (serial di luar hak → `NOT_FOUND`); item baru harus aktif dan memuat BU serial; lokasi harus ada; serial baru dinormalisasi dan unik pada (BU, serial); CAS `updated_at` (`CAS_UPDATED_AT_SET`, `runCas`; usang → `staleError`, hasil massal `stale`); satu `batch`: `UPDATE serials`, `INSERT serial_events` (`seq` berikutnya, `type 'data_changed'`, `changes_json` berisi `{field, from, to}` memakai label terbaca: nama item, nama lokasi, "Ya"/"Tidak" untuk sample; hanya kolom yang benar-benar berubah; tidak ada perubahan → tidak menulis kejadian dan `updatedAt` tetap). **Tidak ada pernyataan stok dan `serial_stickers` tidak disentuh.** Mengubah `location_id` lewat update tidak mengubah `recorded_location_id`.

- [ ] **Step 1: Tes:** mengubah serial typo → kejadian `data_changed` dengan `changes [{field:'serial', from:'AB12', to:'AB13'}]`, stok semua stiker **tidak berubah** dan tidak ada entri stok baru; mengganti item (BU sama) → stok dan `serial_stickers` tidak berubah; item yang tidak memuat BU serial → `invalid`; serial baru bentrok di BU yang sama → `duplicate` (pesan generik), di BU lain bukan bentrok; `If-Match` usang → 412 (`PUT`) / hasil `stale` (massal); update tanpa perubahan tidak menambah kejadian; dua `Promise.all` update serentak pada serial sama → satu berhasil, satu `stale`; pengguna `serial: view` → `FORBIDDEN`; massal parsial (satu `stale`, satu sah) memproses baris sah; `serials.update` dan `serials.updateBatch` ada di `WORST`.
- [ ] **Step 2:** FAIL. **Step 3:** implementasi. **Step 4:** PASS. **Step 5: Commit** `feat(serial): ubah serial tunggal dan massal`.

---

### Task 11: `serials.act` (catatan dan cek ulang) [Sonnet]

**Files:** kontrak/api/routes/`ALL_API_IDS`/`EXAMPLES`/`WORST`; `server/src/modules/serial/{repo,service,validate,routes}.ts`, `rest.test.ts`.

**Interfaces:**
```ts
'serials.act': { input: SerialActInput; output: SerialDto }
export interface SerialActInput { id: string; expectedUpdatedAt: string; action: 'note' | 'recheck'; occurredOn: string; message: string; locationId?: string; stickers?: SerialStickerPick[] }
```
`API_ROUTES`: `POST /serials/{id}/act`; izin `serial: edit`. Pesan ≤ `messageMax`. `occurredOn` ISO dan tidak di masa depan (bawaan hari ini WIB bila kosong ditolak: wajib diisi klien).

**Aturan 5a:** `note`: `message` wajib tidak kosong; menulis kejadian `note`; `updated_at` naik; tidak mengubah status. `recheck`: hanya bila `status === 'good'` dan `custody === 'qc'` (selain itu `CONFLICT`); `locationId` (bawaan lokasi serial sekarang) harus ada → bila berbeda memperbarui `serials.location_id` dan mencatat chip `location`; `stickers` = **jumlah baru per stiker** (opsional): untuk tiap stiker, jumlah baru ≥ jumlah sekarang (turun → `VALIDATION`), stiker yang belum ada harus ada di `applicableStickersOf`; selisih positif memotong stok di `locationId` cek ulang lewat `statementsFor(env,'serial.stickers_added', …)` dengan `eventId` kejadian ini, memperbarui/menyisipkan `serial_stickers`, dan mencatat chip `stickers` (mis. `from: 'Segel A ×1'`, `to: 'Segel A ×2'`). Tanpa perubahan lokasi dan stiker, `recheck` tetap sah (kejadian saja). Kejadian `type 'recheck'`, `data_json` memuat hasil `'pass'`. Satu `batch`, CAS `updated_at`.

- [ ] **Step 1: Tes:** `note` menambah kejadian dan tidak mengubah stok; `recheck` di Jakarta (lokasi berbeda) mengubah `location_id`, `recorded_location_id` tetap Surabaya, chip lokasi `Surabaya → Jakarta`; `recheck` menaikkan stiker Segel A 1→2 → stok di Jakarta turun 1 (bukan di Surabaya) dengan entri `kind 'serial'` bertanda `serial_event_id` kejadian itu; `recheck` tanpa kenaikan **tidak** memotong stok; menurunkan jumlah → `VALIDATION`; stiker tak berlaku → `VALIDATION`; `recheck` pada serial `status` selain `good` → `CONFLICT`; `expectedUpdatedAt` usang → 412/`stale`; `occurredOn` masa depan → `VALIDATION`; `serialservice` saja → `FORBIDDEN`; BU lain → `NOT_FOUND`; `serials.act` di `WORST`.
- [ ] **Step 2:** FAIL. **Step 3:** implementasi. **Step 4:** PASS; `bun run check` PASS. **Step 5: Commit** `feat(serial): catatan dan cek ulang dengan kenaikan stiker`.

---

### Task 12: Web: helper izin BU per modul, navigasi, query, editor mode `message` [Sonnet]

**Files:** Modify `web/src/modules/auth/permissions.ts:88-125` (helper per modul), `web/src/app/navigation.ts` (grup "Serial Number"), `web/src/modules/markdown/wysiwyg-editor.tsx` (+ toolbar jika perlu); Create `web/src/modules/serial/queries.ts`; tes terkait.

**Interfaces — Produces:**
```ts
// auth/permissions.ts (tambahan; helper item lama tetap dan mendelegasikan)
export function buIdsWithLevelOf(me: MeDto, module: BuModule, level: Level): string[];
export function canWriteSerials(me: MeDto): boolean;       // level edit pada >= 1 BU
// wysiwyg-editor.tsx
mode?: 'item' | 'note' | 'message';  // 'message': tanpa gambar, centang dapat diubah
// serial/queries.ts
export const serialListQueryOptions: (input: SerialListInput) => …; export const serialDetailQueryOptions: (id: string) => …;
export const serialItemOptionsQueryOptions; export const serialStickerOptionsQueryOptions;
export function useSaveSerialBatch(); export function useUpdateSerial(); export function useUpdateSerialBatch(); export function useActSerial();
```
Navigasi: grup "Serial Number" dengan "Daftar Serial" (`/serial`, izin `serial`/`serialservice` view) dan "Catat Serial" (`/serial/new`, `serial: edit`); mutasi menempel hasil server ke cache (`upsertInList`/`markStale` dari `web/src/lib/query-cache.ts`). **Jangan** menambah data serial ke whitelist `query-persist`.

- [ ] **Step 1: Tes:** `buIdsWithLevelOf(me,'serial','edit')` benar untuk campuran BU; `navigation.test.ts` menampilkan grup hanya untuk pengguna berizin; `WysiwygEditor` mode `message`: tidak ada tombol gambar dan tempel berkas gambar tidak memicu unggah, centang `task list` dapat diubah (kebalikan mode `note`); mode `item` dan `note` tidak berubah (tes yang ada tetap hijau).
- [ ] **Step 2:** FAIL. **Step 3:** implementasi (toolbar menerima `mode`; periksa bahwa tombol gambar hanya muncul pada `item`). **Step 4:** PASS. **Step 5: Commit** `feat(serial): dasar web (izin, navigasi, query, editor pesan)`.

---

### Task 13: Web: draf tabel sementara, penyimpanan lokal, pustaka `.qcsn` [Sonnet]

**Files:** Create `web/src/modules/serial/lib/{draft,draft-store,qcsn}.ts` dan tesnya; Modify tempat pembersihan data perangkat saat keluar (cari pemanggil `PERSISTED_CACHE_KEY` di `web/src/modules/auth/session.ts` dan `query-persist.ts`).

**Interfaces — Produces:**
```ts
export interface StagingRow { clientId: string; serial: string; itemId: string; itemLabel: string; buId: string; testDate: string; locationId: string; locationLabel: string; sample: boolean; note: string; stickers: { stickerId: string; name: string; qty: number }[] | null /* null = bawaan semua, diisi saat opsi dimuat */; result?: 'duplicate' | 'invalid' | 'error'; message?: string; selected: boolean; unresolved?: ('item' | 'location' | 'stickers')[] }
export interface Defaults { itemId: string; itemLabel: string; buId: string; testDate: string; locationId: string; locationLabel: string; sample: boolean; note: string }
export interface AddReport { added: number; duplicates: number; rejected: string[]; truncated: boolean }
export function addSerials(rows: readonly StagingRow[], text: string, defaults: Defaults, newId: () => string): { rows: StagingRow[]; report: AddReport };
export function applyBulk(rows: readonly StagingRow[], ids: ReadonlySet<string>, patch: Partial<Pick<StagingRow,'itemId'|'itemLabel'|'buId'|'testDate'|'locationId'|'locationLabel'|'sample'|'note'>>): StagingRow[]; // mengganti item mengatur stickers = null
export function removeRows(rows: readonly StagingRow[], ids: ReadonlySet<string>): StagingRow[];
export function applyResults(rows: readonly StagingRow[], results: readonly SerialRowResult[]): StagingRow[]; // created -> dibuang; lainnya ditandai
export function toRowInput(row: StagingRow): SerialRowInput;  // stickers null -> error program (klien harus mengisi dulu)
export function toBatches<T>(rows: readonly T[], size?: number): T[][];
// draft-store.ts
export function loadDraft(ownerKey: string): StagingRow[]; export function saveDraft(ownerKey: string, rows: readonly StagingRow[]): boolean; export function clearDraft(ownerKey: string): void; export function clearAllDrafts(): void;
// qcsn.ts
export function exportQcsn(rows: readonly StagingRow[], app: { name: string; version: string }, now: Date): Promise<string>;  // menghitung sha256 dengan crypto.subtle
export function importQcsn(text: string): Promise<{ rows: QcsnRow[]; problems: QcsnProblem[]; fatal: string | null }>; // memverifikasi checksum; checksum rusak => fatal
```
Kunci `localStorage`: `qc.serial.draft:<ownerKey>`; `saveDraft` memotong ke `tableRows` dan mengembalikan `false` bila `setItem` melempar (kuota); semua akses dibungkus try/catch.

- [ ] **Step 1: Tes** (vitest): `addSerials` memakai `splitSerialInput` (QR berisi dua serial menambah dua baris; serial yang sudah ada di tabel dihitung `duplicates`, termasuk varian MAC); batas 1.000 baris → `truncated true`; `applyBulk` mengganti item mengosongkan `stickers` ke `null` dan hanya mengubah baris terpilih; `applyResults` membuang `created`, menandai `duplicate`/`invalid`/`error` dengan pesan, mempertahankan urutan; `toBatches(rows 450)` → 200/200/50; `saveDraft`: kuota penuh (`localStorage.setItem` dipaksa melempar) → `false` tanpa melempar; `loadDraft` dengan JSON rusak → `[]`; draf tidak lintas pemilik; `clearAllDrafts` dipanggil pada alur keluar; `exportQcsn` lalu `importQcsn` mengembalikan baris yang sama; checksum diubah → `fatal`; berkas dengan `__proto__` tidak mencemari prototipe; berkas 1.001 baris → `fatal`.
- [ ] **Step 2:** FAIL. **Step 3:** implementasi. **Step 4:** PASS. **Step 5: Commit** `feat(serial): logika tabel sementara, draf lokal, impor ekspor qcsn`.

---

### Task 14: Web: komponen pemindai fisik `SerialScanInput` [Sonnet]

**Files:** Create `web/src/modules/serial/components/serial-scan-input.tsx` dan `.test.tsx`.

**Interfaces — Produces:**
```ts
export type ScanFeedback = 'added' | 'duplicate' | 'rejected';
export interface SerialScanInputProps { id: string; label: string; onSubmit(text: string): ScanFeedback; disabled?: boolean; autoFocus?: boolean }
```
Perilaku: `<textarea>` satu baris yang tumbuh; **Enter** (tanpa Shift) mengirim isinya ke `onSubmit`, mengosongkan, dan mengembalikan fokus; **Tab** saat isi tidak kosong dianggap terminator pemindai (cegah pindah fokus) dan berperilaku sama; **tempel** teks yang mengandung baris baru langsung dikirim (`onSubmit`); umpan balik dari `onSubmit` memicu kilatan warna (hijau/oranye/merah) dan bunyi pendek berbeda lewat WebAudio (dibungkus try/catch dan dilewati bila tidak tersedia, mis. jsdom) serta `navigator.vibrate` bila ada; label dan status untuk pembaca layar (`aria-live="polite"`).

- [ ] **Step 1: Tes:** mengetik `ABC{Enter}` memanggil `onSubmit('ABC')` sekali dan mengosongkan kolom; fokus tetap di kolom; `ABC{Tab}` memanggil `onSubmit('ABC')` dan fokus tidak berpindah; Tab pada kolom kosong tidak memanggil apa pun (fokus boleh pindah normal); tempel `'A\nB'` memanggil `onSubmit('A\nB')`; `Shift+Enter` menyisipkan baris baru tanpa mengirim; `onSubmit` mengembalikan `'duplicate'` menampilkan teks "Sudah ada" di wilayah `aria-live`; tanpa `AudioContext` tidak melempar; `disabled` tidak menerima masukan.
- [ ] **Step 2:** FAIL. **Step 3:** implementasi. **Step 4:** PASS. **Step 5: Commit** `feat(serial): komponen masukan pemindai fisik`.

---

### Task 15: Web: halaman Catat Serial (tabel sementara, ubah massal, detail stiker, impor/ekspor, simpan) [Sonnet]

**Files:** Create `web/src/modules/serial/components/{record-page,staging-table,bulk-edit-bar,row-detail-dialog,import-export-bar}.tsx`, `web/src/routes/_app/serial/new.tsx` (tipis, `requirePermission` `serial: edit`), tes terkait; `routeTree.gen.ts` dihasilkan otomatis (jangan disunting).

**Perilaku (acuan spek §5.1):** blok "Bawaan rombongan" (item via `LinkField` bersumber `serialItemOptionsQueryOptions` dengan `onSearchChange`/`hasMore`; BU otomatis dari item atau `Select`/`LinkField` bila item berada di > 1 BU yang boleh ditulis; tanggal uji bawaan hari ini; lokasi via `LinkField` tanpa Tambah/Buka; sample; catatan) lalu `SerialScanInput` (hasilnya lewat `addSerials`; `ScanFeedback` dari `AddReport`); tabel dengan kotak centang baris dan "pilih semua", sel dapat diedit (serial dinormalisasi saat keluar sel; duplikat dalam tabel ditolak), kolom hasil/pesan bertanda warna; `bulk-edit-bar` muncul saat ada baris terpilih untuk mengubah item/tanggal/lokasi/sample/catatan massal lewat `applyBulk`; tombol "Detail" per baris membuka `row-detail-dialog` berisi daftar centang stiker (dimuat dari `serials.stickerOptions` per (item, BU); bawaan semua tercentang, `qty` 1..99 dengan pencacah; dialog dirender di luar `<form>` induk); impor `.qcsn` (input berkas, laporan jumlah baru/dilewati/bermasalah, baris dengan rujukan tak ditemukan memakai `unresolved` dan memaksa pilih ulang sebelum simpan) dan ekspor `.qcsn` (unduh); **Simpan** membagi dengan `toBatches` (200), memanggil `useSaveSerialBatch` berurutan, menerapkan `applyResults` sesudah tiap bagian, menampilkan ringkasan (dibuat/duplikat/gagal) dan opsi "Coba lagi" untuk baris tersisa; baris yang `stickers` masih `null` dimuat dulu sebelum simpan; draf disimpan otomatis (`saveDraft`, ditunda 500 ms) dan dipulihkan saat halaman dibuka; peringatan "draf tidak tersimpan otomatis" saat `saveDraft` mengembalikan `false`; konfirmasi bila keluar halaman dengan draf tak kosong.

- [ ] **Step 1: Tes** (vitest + Testing Library; `pickLink`): menempel dua serial menambah dua baris dengan bawaan rombongan; serial ganda menampilkan pesan dan tidak menambah baris; ubah massal tiga baris terpilih mengganti lokasi dan hanya baris itu yang berubah; mengganti item pada baris mengosongkan pilihan stiker lalu detail memuat ulang dengan semua tercentang; mencentang qty stiker 2 mengirim `stickers: [{stickerId, qty: 2}]`; simpan 450 baris memanggil mutasi 3 kali dan menghapus baris `created`; baris `duplicate` tersisa berwarna dan dapat dicoba lagi; impor berkas sah menambah baris dan impor berkas rusak menampilkan pesan tanpa mengubah tabel; muat ulang komponen memulihkan draf dari `localStorage`; kuota penuh menampilkan peringatan; halaman tidak memuat elemen `select`/`option` (`scripts/no-native-select.test.ts` tetap hijau).
- [ ] **Step 2:** FAIL. **Step 3:** implementasi. **Step 4:** PASS. **Step 5: Commit** `feat(serial): halaman catat serial dengan tabel sementara`.

---

### Task 16: Web: daftar, detail bergaya tiket, edit data, catatan dan cek ulang [Sonnet]

**Files:** Create `web/src/modules/serial/components/{serial-list-page,serial-filters,serial-detail-page,timeline,act-composer,edit-serial-dialog}.tsx`, `web/src/routes/_app/serial/{index.tsx,$serialId/index.tsx}`, tes terkait.

**Perilaku (acuan spek §9, mockup sesi):** Daftar: kolom serial, item, BU, lokasi, **Test Date (tanggal uji pertama)**, status, posisi, sample; filter rentang tanggal, item, lokasi, status (enum `Select`, relasi `LinkField`/`LinkMultiField`), pencarian banyak serial (kotak teks multi-baris; dinormalisasi) dan `SerialScanInput` untuk mencari (hasil pindai menambah ke daftar pencarian); paginasi kursor. Detail: kepala (serial, item, BU, status, posisi), panel ringkasan (Test Date pertama, "terakhir lolos" dihitung dari kejadian `recorded`/`recheck`, lokasi awal dan terakhir, sample, catatan, dicatat oleh, stiker yang ditempel beserta jumlah), linimasa menaik (kartu: pelaku dan tim, `occurredOn` besar dan `createdAt` kecil, pesan Markdown dirender dengan `MarkdownView`, chip `changes` dari→ke, kartu kejadian `recorded` memuat ringkasan stok yang dipotong dan tampil merah bila stok sesudahnya negatif **tanpa** membuka angka stok lokasi lain), kotak "Pembaruan baru" (`act-composer`: aksi `Select` Catatan/Cek ulang, `WysiwygEditor mode="message"` maks 5.000, tanggal kejadian, lokasi `LinkField` pada cek ulang, daftar stiker dengan pencacah yang tidak dapat turun di bawah jumlah sekarang), dialog "Ubah data" (`edit-serial-dialog`: serial, item, tanggal uji, sample, catatan, lokasi; hanya bila `canWriteSerials` pada BU serial). Pengguna hanya `serial: view`: tanpa composer dan tanpa tombol ubah. Penanganan 412 (`describeError`) memuat ulang detail.

- [ ] **Step 1: Tes:** daftar merender baris dan memakai filter ke parameter pencarian; pencarian banyak serial mengirim bentuk ternormalisasi; detail merender linimasa berurutan dan chip `Lokasi: Surabaya → Jakarta`; composer cek ulang mengirim `serials.act` dengan `expectedUpdatedAt` dari `get` dan menempelkan hasilnya (kartu baru muncul); pencacah stiker tidak dapat di bawah nilai sekarang; pengguna `serial: view` tidak melihat composer/tombol ubah; 412 menampilkan pesan versi usang dan memuat ulang; dialog edit mengirim hanya bidang yang berubah dan menampilkan "Serial sudah terdaftar" pada `duplicate`.
- [ ] **Step 2:** FAIL. **Step 3:** implementasi. **Step 4:** PASS. **Step 5: Commit** `feat(serial): daftar dan detail serial bergaya tiket`.

---

### Task 17: Dokumentasi, `CLAUDE.md`, verifikasi akhir [Haiku untuk dokumen; verifikasi oleh pengendali]

**Files:** Modify `CLAUDE.md` (bagian Struktur: modul Serial Number; aturan stok negatif dari pemotongan SN dan pengecualian migrasi `0011`; modul izin `serial`/`serialservice`; format `.qcsn`; bus event kecil), `docs/adding-a-module.md` (peringatan: modul BU baru juga harus masuk loop `shared/assignments.ts`), `docs/ci-cd.md` (catatan rollback: image sebelum 5a membaca stok negatif sebagai angka biasa; `CHECK` dicabut), spek 5a status "dibangun".

- [ ] **Step 1:** perbarui dokumen sesuai spek §10 butir 4.
- [ ] **Step 2:** `bun run check` PASS penuh (tunnel hidup); `bun run build` PASS (`verify-dist`: tiap potongan ≤ 600 KB gzip).
- [ ] **Step 3:** uji manual di `bun run dev` (login "Masuk sebagai pengguna dev"): catat tiga serial dengan pemindai simulasi (ketik + Enter), ubah massal lokasi, simpan, buka detail, cek ulang dengan kenaikan stiker, ekspor lalu impor `.qcsn`, periksa stok negatif tampil "Kurang N".
- [ ] **Step 4: Commit** `docs(serial): dokumentasi tahap 5a`. Siapkan PR ke `dev` (migrasi `0011` diterapkan otomatis saat start; tidak ada variabel `.env` baru).
