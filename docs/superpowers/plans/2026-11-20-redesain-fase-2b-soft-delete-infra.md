# Redesain Fase 2b: Infrastruktur Soft Delete — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Fondasi soft delete yang dipakai modul di fase 3-4: kolom dan indeks unik baru, helper SQL "hidup", tes penjaga yang mencatat setiap query yang belum menyaring, kontrak batch hapus/pulihkan, konteks akses yang mengabaikan record terhapus, dan komponen web "Terhapus".

**Architecture:** Satu migrasi expand-only menambah `deleted_at`/`deleted_by` (`''` = hidup) dan indeks unik `<nama>_live` di samping indeks lama. `server/src/core/soft-delete.ts` memusatkan daftar tabel, potongan SQL `liveWhere`, dan pernyataan hapus/pulihkan ber-CAS. Tes penjaga memindai SQL server untuk `FROM|JOIN <tabel ber-soft-delete>` tanpa penyaring; semua kemunculan hari ini dicatat di daftar tunggu per modul (hijau sekarang), dan tiap fase modul menghapus entrinya — entri basi menggagalkan tes.

**Tech Stack:** Bun, MariaDB 11.8, `server/src/core/db.ts` (`prepare/bind/run`, `batch()`), `core/cas.ts`, vitest (web), `bun test` (server, butuh `bun run db:tunnel`).

**Spec:** `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§4.1-4.6, §5). Kontrak batch: `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` §6.9.

## Global Constraints

- `deleted_at VARCHAR(30) NOT NULL DEFAULT ''`, `deleted_by VARCHAR(254) NOT NULL DEFAULT ''`; `''` = hidup. Bukan `NULL`.
- Migrasi expand-only, idempoten (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`); indeks lama TIDAK dihapus di sini (contract di rilis berikutnya, berpenanda `-- qc:contract`).
- Nilai SQL selalu di-bind (`?`); nama kolom `key` berbacktick.
- Hapus/pulihkan = CAS di dalam `batch()`; satu gagal = tak ada yang berubah; idempoten.
- Batas batch `BATCH_MAX = 100` id unik per permintaan.
- Pengguna/role/lokasi/BU terhapus TIDAK memberi hak apa pun.
- Wajib hijau: `bun run check` (butuh terowongan DB; bila mati laporkan dan jalankan bagian web/typecheck/lint/scripts).

## Review Focus

1. Dua baris dengan email sama (satu terhapus, satu hidup) → login/sesi memakai yang hidup; yang terhapus tak pernah dipakai. (Task 4)
2. Role terhapus masih tercantum di `role_ids` pengguna → izinnya tidak dihitung. (Task 4)
3. Pulihkan saat kunci unik dipakai record hidup → `CONFLICT` generik, tak ada yang berubah (bergantung indeks `_live`). (Task 2)
4. Hapus dua kali (permintaan ulang) → bukan galat, `deleted_at` asli tidak tertimpa. (Task 2)
5. Kueri baru yang ditambahkan tanpa penyaring → tes penjaga gagal dengan nama berkas dan baris. (Task 3)

## Pembagian kelas beban

Sonnet: Task 1-5. Haiku: Task 6. Berurutan.

---

### Task 1: Migrasi `0026_soft_delete.sql`

**Files:**
- Create: `server/migrations/0026_soft_delete.sql`, `server/src/core/soft-delete-migration.test.ts`

Tabel ber-soft-delete (urutan tetap, diekspor juga di Task 2): `users`, `roles`, `locations`, `business_units`, `brands`, `customers`, `items`, `sticker_types`, `stickers`, `sticker_guide_images`, `qr_designs`, `qr_presets`, `postels`, `postel_numbers` (ikut induknya), `serials`, `handovers`.

Indeks baru (nama = lama + `_live`, kolom = kolom lama + `deleted_at`): `users_email_live`, `roles_name_unique_live`, `locations_code_unique_live`, `locations_name_unique_live`, `business_units_code_unique_live`, `business_units_name_unique_live`, `brands_key_live`, `customers_key_live`, `items_key_live`, `sticker_types_name_unique_live`, `sticker_types_kind_unique_live`, `stickers_type_name_unique_live`, `qr_presets_bu_unique_live`, `postel_numbers_key_live`, `postels_sticker_live`, `serials_bu_serial_live`, `handovers_number_live`.

- [ ] **Step 1: Tes gagal** `soft-delete-migration.test.ts` (harness `createTestEnv`): untuk tiap tabel, `SHOW COLUMNS ... LIKE 'deleted_at'` → `Type` varchar(30), `Null` NO, `Default` ''; `deleted_by` ada; untuk tiap nama indeks `_live`, `SHOW INDEX` → unik, kolom terakhir `deleted_at`; INSERT dua merk dengan `key` sama dan `deleted_at` berbeda masih DITOLAK (indeks lama `brands_key` masih ada — membuktikan expand-only).
- [ ] **Step 2:** `bun run --cwd server test src/core/soft-delete-migration.test.ts` → FAIL.
- [ ] **Step 3:** Tulis migrasi dengan komentar kepala gaya migrasi lain (alasan, EXPAND-ONLY, kompatibel mundur, idempoten, rujukan spek).
- [ ] **Step 4:** Tes → PASS; `bun run --cwd server test src/core/migrate.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(server): kolom deleted_at dan indeks unik _live (expand)`.

### Task 2: Inti `core/soft-delete.ts` dan kontrak batch bersama

**Files:**
- Create: `server/src/core/soft-delete.ts`, `server/src/core/soft-delete.test.ts`, `shared/batch.ts`, `shared/batch.test.ts`
- Modify: `shared/contract.ts` (ekspor ulang tipe dari `batch.ts` bila pola berkas itu mengharuskan)

**Interfaces:**
- Produces (`shared/batch.ts`): `BATCH_MAX = 100`; `interface IdBatchInput { ids: string[] }`; `interface VersionedBatchInput { items: { id: string; updatedAt: string }[] }`; `interface StatusBatchInput extends IdBatchInput { status: 'active' | 'inactive' }` (rute `setStatus` tunggal hari ini tak membawa `updatedAt` — Item/Merk/Stiker/Jenis/Customer/Pengguna/Lokasi/BU — jadi batch status cukup id; `VersionedBatchInput` hanya untuk model yang rute tunggalnya memeriksa versi); `interface BatchResult<T> { items: T[] }`; `interface SoftDeleteInfo { deletedAt: string; deletedBy: string }`; `type ListStatusFilter = 'active' | 'inactive' | 'deleted' | 'all'`.
- Produces (`core/soft-delete.ts`):
  - `SOFT_DELETE_TABLES` (tuple `as const` urutan Task 1); `type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number]`
  - `liveWhere(alias?: string): string` → `"deleted_at = ''"` / `` `${alias}.deleted_at = ''` ``; `deletedWhere(alias?)` → `deleted_at <> ''`
  - `softDeleteStmt(db: Preparer, table: SoftDeleteTable, id: string, actor: string, now: string): DbStatement` — `UPDATE <table> SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at = ''` (idempoten: baris sudah terhapus = 0 baris, bukan galat).
  - `restoreStmt(db, table, id): DbStatement` — `UPDATE … SET deleted_at = '', deleted_by = '' WHERE id = ? AND deleted_at <> ''`; bentrok indeks `_live` saat pulih muncul sebagai `DbError` `duplicate`.
  - `requireExistsStmt(db, table, id): DbStatement` — penjaga CAS untuk `batch()`: gagal (`CAS_FAIL_SQL`) bila baris dengan `id` tidak ada SAMA SEKALI (hidup atau terhapus), sehingga satu id asing membatalkan batch.
  - `validateIdBatch(raw: unknown): IdBatchInput` dan `validateVersionedBatch(raw: unknown): VersionedBatchInput` (di `core/validate.ts` pola yang ada): 1..`BATCH_MAX` id unik, id string tak kosong; pelanggaran = `VALIDATION`.
  - `mapLiveDuplicate(error, conflicts)` — memetakan nama indeks lama ATAU `_live` ke konflik yang sama (bungkus `mapDuplicateError` yang ada).
- [ ] **Step 1: Tes gagal**: `shared/batch.test.ts` (`BATCH_MAX` = 100); `soft-delete.test.ts` (DB nyata): hapus merk → `deleted_at` terisi, `deleted_by` = aktor; hapus ulang → `deleted_at` tetap nilai pertama; pulihkan → kosong; pulihkan merk saat ada merk hidup dengan `key` sama (sisipkan langsung dengan id berbeda setelah menghapus indeks lama HANYA di skema tes ini lewat `ALTER TABLE … DROP INDEX brands_key`) → `DbError` duplicate dipetakan `CONFLICT`; `batch([requireExistsStmt(…'nope'), softDeleteStmt(…'b1')])` → gagal dan `b1` tetap hidup; `validateIdBatch({ ids: [] })`, 101 id, id ganda → `VALIDATION`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(server): inti soft delete dan kontrak batch bersama`.

### Task 3: Tes penjaga query "hidup"

**Files:**
- Create: `server/src/core/soft-delete-guard.test.ts`, `server/src/core/soft-delete-pending.ts`

**Interfaces:**
- Consumes: `SOFT_DELETE_TABLES`.
- Produces: `SOFT_DELETE_PENDING: Record<string, readonly string[]>` di `soft-delete-pending.ts` — kunci = berkas relatif `server/src/...`, nilai = daftar kemunculan `"<TABEL>@<nomor urut kemunculan di berkas>"` yang BELUM menyaring, dikelompokkan dengan komentar per fase modul yang akan membersihkannya (3: item, brand; 4a: sticker; 4b: qrcode, postel; 4c: access, customer; 4d: serial, handover; lain-lain: modul yang membaca tabel lain, mis. notification, desktop catalog, digest). Juga `SOFT_DELETE_EXEMPT: Record<string, string>` — kemunculan yang sah tanpa penyaring (mis. `INSERT`, penulis `soft-delete.ts`, Log Audit, migrator, penampil rujukan) beserta alasan.
- Aturan pemindaian: berkas `.ts` non-tes di `server/src` dan `server/scripts`; dalam tiap literal string/template, setiap `\b(FROM|JOIN)\s+\`?(tabel)\`?\b` untuk tabel di `SOFT_DELETE_TABLES` dianggap tersaring bila literal yang sama memuat `deleted_at` atau interpolasi `${liveWhere(` / `${deletedWhere(`. Tidak tersaring dan tidak ada di `PENDING`/`EXEMPT` → gagal ("<berkas>:<baris> FROM <tabel> tanpa penyaring"). Entri `PENDING`/`EXEMPT` yang tak lagi cocok → gagal ("entri basi").
- [ ] **Step 1: Tes gagal**: tulis tes penjaga dengan `PENDING` kosong → FAIL dan mencetak semua kemunculan hari ini.
- [ ] **Step 2:** Jalankan → FAIL (daftar).
- [ ] **Step 3:** Isi `SOFT_DELETE_PENDING` dari daftar itu (dikelompokkan per fase) dan `EXEMPT` untuk yang sah.
- [ ] **Step 4:** Tes → PASS. Tambahkan kasus uji mandiri dalam tes: sumber sintetis `"SELECT * FROM items WHERE id = ?"` dilaporkan; `` `SELECT * FROM items WHERE ${liveWhere()}` `` tidak.
- [ ] **Step 5:** Commit `test(server): penjaga query soft delete dengan daftar tunggu per modul`.

### Task 4: Konteks akses mengabaikan record terhapus

**Files:**
- Modify: `server/src/modules/access/context.ts` (`ACCESS_SQL`, `SHARED_ACCESS_SQL`, kueri pengguna aktif), `server/src/core/session.ts` atau pemeriksa akun di `core/router.ts` bila membaca `users` langsung, `server/src/modules/auth/**` yang mencari pengguna menurut email (login Google, dev login, desktop token/handoff)
- Test: `server/src/modules/access/context.test.ts`, tes auth terkait

**Interfaces:** pengguna dicari dengan `email = ? AND deleted_at = ''`; role/lokasi/BU terhapus dibuang dari tabel bersama sehingga tak memberi izin dan tak muncul di `me.locations`/BU.
- [ ] **Step 1: Tes gagal**: (a) pengguna A (hidup) dan A' terhapus dengan email sama (sisipkan A' setelah `DROP INDEX users_email` di skema tes) → konteks memakai A; (b) role R terhapus di `role_ids` pengguna → izin R tak berlaku; (c) lokasi terhapus di penugasan → tak ada di `locationIds`; (d) BU terhapus → tak ada di hak BU; (e) pengguna terhapus (status apa pun) → sesi ditolak `UNAUTHENTICATED` seperti nonaktif.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi; hapus entri terkait dari `SOFT_DELETE_PENDING`. **Step 4:** PASS (+ tes penjaga).
- [ ] **Step 5:** Commit `fix(server): akses dan sesi mengabaikan pengguna/role/lokasi/BU terhapus`.

### Task 5: Komponen web "Terhapus"

**Files:**
- Create: `web/src/components/soft-delete/deleted-badge.tsx`, `deleted-banner.tsx`, `confirm-delete-dialog.tsx`, `status-filter.ts`, tes masing-masing

**Interfaces:**
- Consumes: `Badge`, `Alert`, `ActionButton`, `ListStatusFilter`, `SoftDeleteInfo` (shared).
- Produces: `DeletedBadge()` → `Badge color="secondary" variant="soft"` "Terhapus"; `DeletedBanner({ info, canRestore, onRestore, restoring })` → `Alert color="destructive"` "Data ini sudah dihapus" + "oleh {deletedBy} pada {tanggal WIB}" + `ActionButton action="restore"` bila `canRestore`; `ConfirmDeleteDialog({ open, onOpenChange, count, subject, usage, onConfirm, busy })` → AlertDialog "Hapus {count} {subject}?" + kalimat "Data dapat dipulihkan dari tampilan Terhapus." + `usage` opsional (mis. "Dipakai 12 item"); `statusFilterOptions(canRestore: boolean): { value: ListStatusFilter; label: string }[]` → Semua status / Aktif / Nonaktif (+ Terhapus bila `canRestore`).
- [ ] **Step 1: Tes gagal** untuk keempatnya (teks persis di atas; tombol Pulihkan hanya bila `canRestore`; opsi Terhapus hanya bila `canRestore`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): komponen Terhapus, banner pulihkan, dan konfirmasi hapus`.

### Task 6 (Haiku): Dokumentasi dan verifikasi

**Files:**
- Modify: `CLAUDE.md` ("Aturan server": butir soft delete — kolom, `liveWhere`, tes penjaga + daftar tunggu, indeks `_live`, `mapLiveDuplicate`, akses mengabaikan terhapus), `docs/ci-cd.md` (pengecualian rollback soft delete persis spek §5 butir 7), `docs/adding-a-module.md` (tabel baru wajib masuk `SOFT_DELETE_TABLES` + migrasi kolom)
- [ ] **Step 1:** Tulis dokumentasi.
- [ ] **Step 2:** `bun run check` (atau bagian non-DB bila terowongan mati, laporkan).
- [ ] **Step 3:** Commit `docs: aturan soft delete dan pengecualian rollback`.
