# Redesain Fase 2b: Infrastruktur Soft Delete — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Fondasi soft delete yang dipakai modul di fase 3-4: kolom dan indeks unik baru, helper SQL "hidup", tes penjaga yang mencatat setiap query yang belum menyaring, kontrak batch hapus/pulihkan, konteks akses yang mengabaikan record terhapus, dan komponen web "Terhapus".

**Architecture:** Satu migrasi expand-only menambah `deleted_at`/`deleted_by` (`''` = hidup) dan indeks unik `<nama>_live` di samping indeks lama. `server/src/core/soft-delete.ts` memusatkan daftar tabel, potongan SQL `liveWhere`, dan pernyataan hapus/pulihkan ber-CAS. Tes penjaga memindai SQL server untuk `FROM|JOIN <tabel ber-soft-delete>` tanpa penyaring; semua kemunculan hari ini dicatat di daftar tunggu per modul (hijau sekarang), dan tiap fase modul menghapus entrinya — entri basi menggagalkan tes.

**Tech Stack:** Bun, MariaDB 11.8, `server/src/core/db.ts` (`prepare/bind/run`, `batch()`), `core/cas.ts`, vitest (web), `bun test` (server, butuh `bun run db:tunnel`).

**Spec:** `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§4.1-4.6, §5). Kontrak batch: `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` §6.9.

## Global Constraints

- `deleted_at VARCHAR(30) NOT NULL DEFAULT ''`, `deleted_by VARCHAR(254) NOT NULL DEFAULT ''`; `''` = hidup. Bukan `NULL`.
- Migrasi expand-only, idempoten (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`); indeks lama TIDAK dihapus di sini: migrasi contract dibuat sebagai task penutup fase 4d (Task 7) dalam PR yang SAMA, berpenanda `-- qc:contract` (keputusan pemilik 11: pengecualian sadar terhadap expand → contract; setelah rilis, rollback image TIDAK aman, perbaiki ke depan).
- Nilai SQL selalu di-bind (`?`); nama kolom `key` berbacktick.
- Hapus/pulihkan = CAS di dalam `batch()`; satu gagal = tak ada yang berubah; idempoten.
- Batas batch `BATCH_MAX = 100` id unik per permintaan.
- Pengguna dan role terhapus TIDAK memberi hak apa pun; lokasi terhapus berperilaku seperti lokasi nonaktif hari ini; BU terhapus TETAP memberi hak seperti BU nonaktif (hanya hilang dari pilihan/filter; syarat tulis "SEMUA BU item" mengabaikannya) (keputusan pemilik 9).
- `users_email` tetap unik penuh, tanpa `_live` (keputusan pemilik 10). `deleted_at` = ISO UTC (`nowIso`), `deleted_by` = email (T10). Hapus ulang = sukses tanpa audit (T2). Nama indeks di kode memakai helper nama dasar (T3).
- Wajib hijau: `bun run check` (butuh terowongan DB; bila mati laporkan dan jalankan bagian web/typecheck/lint/scripts).

## Review Focus

1. Pengguna terhapus tak dapat login maupun memakai sesi; email-nya tetap terkunci (pengguna baru beremail sama = `CONFLICT`; jalannya memulihkan akun lama). (Task 4)
2. Role terhapus masih tercantum di `role_ids` pengguna → izinnya tidak dihitung; BU terhapus di penugasan pengguna → hak BU tetap berlaku sementara BU itu tak ditawarkan di pilihan. (Task 4)
3. Pulihkan saat kunci unik dipakai record hidup → `CONFLICT` generik, tak ada yang berubah (bergantung indeks `_live`). (Task 2)
4. Hapus dua kali (permintaan ulang) → bukan galat, `deleted_at` asli tidak tertimpa. (Task 2)
5. Kueri baru yang ditambahkan tanpa penyaring → tes penjaga gagal dengan nama berkas dan baris. (Task 3)
6. Nama indeks yang disebut kode (`RETRYABLE_UNIQUE_KEYS`, `error.key === '…'`) cocok dengan skema baik sebelum maupun sesudah migrasi contract. (Task 2)
7. Literal SQL yang memuat `deleted_at` untuk satu alias tidak meloloskan tabel lain dalam literal yang sama; JOIN ke tabel anak tanpa JOIN/penyaring ke induk dilaporkan. (Task 3)

## Pembagian kelas beban

Sonnet: Task 1-5. Haiku: Task 6. Berurutan.

---

### Task 1: Migrasi `0027_soft_delete.sql`

> Prasyarat (koreksi 2026-11-20): cabang sudah menggabung `origin/dev` yang memuat `0026_serial_unik_sistem.sql` (PR 134). Bila nomor 0027 sudah terpakai di `dev` saat dikerjakan, pakai nomor bebas berikutnya.

**Files:**
- Create: `server/migrations/0027_soft_delete.sql`, `server/src/core/soft-delete-migration.test.ts`

Tabel ber-soft-delete (urutan tetap, diekspor juga di Task 2): `users`, `roles`, `locations`, `business_units`, `brands`, `customers`, `items`, `sticker_types`, `stickers`, `qr_designs`, `qr_presets`, `postels`, `postel_numbers` (ikut induknya), `serials`, `handovers`. (`sticker_guide_images` SENGAJA tidak termasuk: gambar Pustaka tetap hapus permanen, keputusan pemilik 2026-11-20, rancangan soft delete §2 butir 6.)

Indeks baru (nama = lama + `_live`, kolom = kolom lama + `deleted_at`): `roles_name_unique_live`, `locations_code_unique_live`, `locations_name_unique_live`, `business_units_code_unique_live`, `business_units_name_unique_live`, `brands_key_live`, `customers_key_live`, `items_key_live`, `sticker_types_name_unique_live`, `sticker_types_kind_unique_live`, `stickers_type_name_unique_live`, `qr_presets_bu_unique_live`, `postel_numbers_key_live`, `postels_sticker_live`, `handovers_number_live`. `users_email` TIDAK mendapat padanan `_live`: tetap unik penuh (keputusan pemilik 10). Indeks serial TIDAK dibuat di migrasi ini: keunikan serial se-sistem (`serials_serial`) dibuat bersyarat oleh `ensureSerialUniqueIndex` (`server/src/modules/serial/bu-history.ts`) karena data lama dapat ganda; pada fase 4d (Task 6-7) `ensureSerialUniqueIndex` diubah ke versi contract: hanya membuat `serials_serial_live` (`serial`, `deleted_at`), menghitung ganda lewat `GROUP BY serial, deleted_at`, dan membuang `serials_serial` lama bila ada (T3). `serials_bu_serial` (lama, dibuang di contract fase 4d) tidak mendapat padanan `_live`.

- [ ] **Step 1: Tes gagal** `soft-delete-migration.test.ts` (harness `createTestEnv`): untuk tiap tabel, `SHOW COLUMNS ... LIKE 'deleted_at'` → `Type` varchar(30), `Null` NO, `Default` ''; `deleted_by` ada; untuk tiap nama indeks `_live`, `SHOW INDEX` → unik, kolom terakhir `deleted_at`; `users_email_live` TIDAK ada dan `users_email` tetap unik penuh; INSERT dua merk dengan `key` sama dan `deleted_at` berbeda masih DITOLAK (indeks lama `brands_key` masih ada — membuktikan expand-only).
- [ ] **Step 2:** `bun run --cwd server test src/core/soft-delete-migration.test.ts` → FAIL.
- [ ] **Step 3:** Tulis migrasi dengan komentar kepala gaya migrasi lain (alasan, EXPAND-ONLY, kompatibel mundur, idempoten, rujukan spek); komentar kepala menyebut bahwa migrasi contract (buang indeks lama) menyusul di PR yang sama (fase 4d Task 7; keputusan pemilik 11).
- [ ] **Step 4:** Tes → PASS; `bun run --cwd server test src/core/migrate.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(server): kolom deleted_at dan indeks unik _live (expand)`.

### Task 2: Inti `core/soft-delete.ts` dan kontrak batch bersama

**Files:**
- Create: `server/src/core/soft-delete.ts`, `server/src/core/soft-delete.test.ts`, `server/src/core/index-names.test.ts`, `shared/batch.ts`, `shared/batch.test.ts`
- Modify: `shared/contract.ts` (ekspor ulang tipe dari `batch.ts` bila pola berkas itu mengharuskan), `server/src/core/cas.ts` (`RETRYABLE_UNIQUE_KEYS` lewat `baseIndexName`), dan setiap pembanding `error.key === '<indeks>'` di `server/src`

**Interfaces:**
- Produces (`shared/batch.ts`): `BATCH_MAX = 100`; `interface IdBatchInput { ids: string[] }`; `interface VersionedBatchInput { items: { id: string; updatedAt: string }[] }`; `interface StatusBatchInput extends IdBatchInput { status: 'active' | 'inactive' }` (rute `setStatus` tunggal hari ini tak membawa `updatedAt` — Item/Merk/Stiker/Jenis/Customer/Pengguna/Lokasi/BU — jadi batch status cukup id; `VersionedBatchInput` hanya untuk model yang rute tunggalnya memeriksa versi); `interface BatchResult<T> { items: T[] }`; `interface SoftDeleteInfo { deletedAt: string; deletedBy: string }`; `type ListStatusFilter = 'active' | 'inactive' | 'deleted' | 'all'`.
- Produces (`core/soft-delete.ts`):
  - `SOFT_DELETE_TABLES` (tuple `as const` urutan Task 1); `type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number]`
  - `liveWhere(alias?: string): string` → `"deleted_at = ''"` / `` `${alias}.deleted_at = ''` ``; `deletedWhere(alias?)` → `deleted_at <> ''`
  - `softDeleteStmt(db: Preparer, table: SoftDeleteTable, id: string, actor: string, now: string): DbStatement` — `UPDATE <table> SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at = ''` (idempoten: baris sudah terhapus = 0 baris, bukan galat; hapus ulang = sukses tanpa audit, `deleted_at` asli tidak tertimpa, `NOT_FOUND` hanya dari `requireExistsStmt` untuk id tak dikenal; T2).
  - `restoreStmt(db, table, id): DbStatement` — `UPDATE … SET deleted_at = '', deleted_by = '' WHERE id = ? AND deleted_at <> ''`; bentrok indeks `_live` saat pulih muncul sebagai `DbError` `duplicate`.
  - `requireExistsStmt(db, table, id): DbStatement` — penjaga CAS untuk `batch()`: gagal (`CAS_FAIL_SQL`) bila baris dengan `id` tidak ada SAMA SEKALI (hidup atau terhapus), sehingga satu id asing membatalkan batch.
  - `validateIdBatch(raw: unknown): IdBatchInput` dan `validateVersionedBatch(raw: unknown): VersionedBatchInput` (di `core/validate.ts` pola yang ada): 1..`BATCH_MAX` id unik, id string tak kosong; pelanggaran = `VALIDATION`.
  - `baseIndexName(name: string): string` — membuang akhiran `_live` (T3). `mapLiveDuplicate(error, conflicts)` — memetakan nama indeks lama ATAU `_live` ke konflik yang sama lewat `baseIndexName` (bungkus `mapDuplicateError` yang ada). `RETRYABLE_UNIQUE_KEYS` (`server/src/core/cas.ts`) dan semua pembanding `error.key === '<indeks>'` di kode memakai `baseIndexName`, bukan nama literal tunggal.
  - `softDeleteWithChildren(db, parent: SoftDeleteTable, children: readonly { table: SoftDeleteTable; fk: string }[], id, actor, now): DbStatement[]` dan `restoreWithChildren(...)` — induk beserta anak yang keunikannya ikut induk (mis. `postel_numbers` lewat `postel_id`) dalam satu `batch()` (T5).
- [ ] **Step 1: Tes gagal**: `shared/batch.test.ts` (`BATCH_MAX` = 100); `soft-delete.test.ts` (DB nyata): hapus merk → `deleted_at` terisi, `deleted_by` = aktor; hapus ulang → `deleted_at` tetap nilai pertama; pulihkan → kosong; pulihkan merk saat ada merk hidup dengan `key` sama (sisipkan langsung dengan id berbeda setelah menghapus indeks lama HANYA di skema tes ini lewat `ALTER TABLE … DROP INDEX IF EXISTS brands_key`; idempoten karena migrasi contract fase 4d Task 6 membuang indeks itu dari templat tes) → `DbError` duplicate dipetakan `CONFLICT`; `batch([requireExistsStmt(…'nope'), softDeleteStmt(…'b1')])` → gagal dan `b1` tetap hidup; `validateIdBatch({ ids: [] })`, 101 id, id ganda → `VALIDATION`; `baseIndexName('brands_key_live')` = `'brands_key'`; `softDeleteWithChildren` untuk `postels` + `postel_numbers` menghapus induk dan nomornya bersamaan, `restoreWithChildren` memulihkan keduanya; dua record berkunci sama dihapus dengan jam digeser (`env.clock`) tidak bentrok; `index-names.test.ts`: setiap nama indeks yang disebut kode (peta `mapDuplicateError`, `RETRYABLE_UNIQUE_KEYS`, pembanding `error.key ===`) lewat `baseIndexName` ada di `information_schema.statistics` skema tes, pada skema expand (lama + `_live`) dan setelah migrasi contract.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(server): inti soft delete dan kontrak batch bersama`.

### Task 3: Tes penjaga query "hidup"

**Files:**
- Create: `server/src/core/soft-delete-guard.test.ts`, `server/src/core/soft-delete-pending.ts`

**Interfaces:**
- Consumes: `SOFT_DELETE_TABLES`.
- Produces: `SOFT_DELETE_PENDING: Record<string, readonly string[]>` di `soft-delete-pending.ts` — kunci = berkas relatif `server/src/...`, nilai = daftar kemunculan `"<TABEL>@<nomor urut kemunculan di berkas>"` yang BELUM menyaring, dikelompokkan dengan komentar per fase modul yang akan membersihkannya (3: item, brand; 4a: sticker; 4b: qrcode, postel; 4c: access, customer; 4d: serial, handover; lain-lain: modul yang membaca tabel lain, mis. notification, desktop catalog, digest). Juga `SOFT_DELETE_EXEMPT: Record<string, string>` — kemunculan yang sah tanpa penyaring (mis. `INSERT`, penulis `soft-delete.ts`, Log Audit, migrator, penampil rujukan) beserta alasan.
- Aturan pemindaian: berkas `.ts` non-tes di `server/src` dan `server/scripts`; dalam tiap literal string/template, setiap `\b(FROM|JOIN)\s+\`?(tabel)\`?\b` untuk tabel di `SOFT_DELETE_TABLES` dianggap tersaring bila literal yang sama memuat `deleted_at` atau interpolasi `${liveWhere(` / `${deletedWhere(`. Literal yang DIAWALI nama tabel ber-soft-delete diikuti alias atau `JOIN` (fragmen FROM tersusun, mis. `HANDOVER_FROM` di `handover/repo.ts`, `SERIAL_FROM` di `serial/repo.ts`: `'handovers h LEFT JOIN ...'`) juga dihitung sebagai kemunculan tabel itu. Tidak tersaring dan tidak ada di `PENDING`/`EXEMPT` → gagal ("<berkas>:<baris> FROM <tabel> tanpa penyaring"). Entri `PENDING`/`EXEMPT` yang tak lagi cocok → gagal ("entri basi"). Penyaringan dinilai PER ALIAS tabel (T5): literal yang menyebut `deleted_at` hanya meloloskan alias/tabel yang disebut (`h.deleted_at`, `liveWhere('c')`), bukan tabel lain dalam literal yang sama. Tabel anak → induk (`CHILD_PARENTS`: `serial_cases`, `serial_events`, `serial_proof_photos`, `serial_stickers` → `serials`; `item_business_units`, `item_sticker_photos`, `item_sticker_marks` → `items`; `manual_book_versions` → `qr_designs`; `handover_comments` → `handovers`; `notifications` → `handovers`/`serials` menurut kolom rujukan): `FROM|JOIN` ke tabel anak wajib disertai JOIN/penyaring ke induknya atau tercantum di `SOFT_DELETE_PENDING`. `UPDATE`/`DELETE`/`EXISTS` di luar cakupan pemindai dan dijaga tes perilaku tiap modul.
- [ ] **Step 1: Tes gagal**: tulis tes penjaga dengan `PENDING` kosong → FAIL dan mencetak semua kemunculan hari ini.
- [ ] **Step 2:** Jalankan → FAIL (daftar).
- [ ] **Step 3:** Isi `SOFT_DELETE_PENDING` dari daftar itu (dikelompokkan per fase) dan `EXEMPT` untuk yang sah.
- [ ] **Step 4:** Tes → PASS. Tambahkan kasus uji mandiri dalam tes: sumber sintetis `"SELECT * FROM items WHERE id = ?"` dilaporkan; `` `SELECT * FROM items WHERE ${liveWhere()}` `` tidak. Sumber sintetis `const X_FROM = 'handovers h LEFT JOIN customers c ON c.id = h.customer_id'` dilaporkan (dua tabel); `FROM handovers h JOIN customers c ON c.id = h.customer_id WHERE h.deleted_at = ''` melaporkan `customers` (penyebutan `deleted_at` untuk `h` tidak meloloskan `c`); `FROM serial_events e WHERE e.serial_id = ?` dilaporkan (anak tanpa induk) sedangkan `FROM serial_events e JOIN serials s ON s.id = e.serial_id AND s.deleted_at = ''` lolos.
- [ ] **Step 5:** Commit `test(server): penjaga query soft delete dengan daftar tunggu per modul`.

### Task 4: Konteks akses mengabaikan record terhapus

**Files:**
- Modify: `server/src/modules/access/context.ts` (`ACCESS_SQL`, `SHARED_ACCESS_SQL`, kueri pengguna aktif), `server/src/core/session.ts` atau pemeriksa akun di `core/router.ts` bila membaca `users` langsung, `server/src/modules/auth/**` yang mencari pengguna menurut email (login Google, dev login, desktop token/handoff)
- Test: `server/src/modules/access/context.test.ts`, tes auth terkait

**Interfaces:** pengguna dicari dengan `email = ? AND deleted_at = ''` (`users_email` tetap unik penuh, jadi tak ada dua baris beremail sama; keputusan pemilik 10); role terhapus tak memberi izin; lokasi terhapus berperilaku seperti lokasi nonaktif hari ini (dibuang dari `me.locations`/`locationIds`); BU terhapus TETAP memberi hak seperti BU nonaktif hari ini (tetap di `UserContext.businessUnits`, sehingga item/serial BU itu tetap terbuka dan dapat diubah) dan hanya dibuang dari pilihan/filter; syarat tulis "level pada SEMUA BU item" (jalur tulis `resolveBuAccess`) mengabaikan BU terhapus (keputusan pemilik 9).
- [ ] **Step 1: Tes gagal**: (a) pengguna terhapus tak dapat login (Google, dev login, token desktop, handoff) dan sesinya ditolak `UNAUTHENTICATED` seperti nonaktif (status apa pun); membuat pengguna baru dengan email pengguna terhapus → `CONFLICT` (indeks `users_email` penuh); (b) role R terhapus di `role_ids` pengguna → izin R tak berlaku; (c) lokasi terhapus di penugasan → diperlakukan sama dengan lokasi nonaktif (tes membandingkan keduanya: tak ada di `locationIds`/`me.locations`); (d) BU terhapus → hak BU tetap sama seperti BU nonaktif (item BU itu tetap dapat dibuka/diubah), BU itu tak ada di pilihan/filter, dan tulis item ber-BU {terhapus, hidup} cukup level pada BU hidup.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi; hapus entri terkait dari `SOFT_DELETE_PENDING`. **Step 4:** PASS (+ tes penjaga).
- [ ] **Step 5:** Commit `fix(server): akses dan sesi memperlakukan pengguna/role/lokasi/BU terhapus sesuai keputusan pemilik`.

### Task 5: Komponen web "Terhapus"

**Files:**
- Create: `web/src/components/soft-delete/deleted-badge.tsx`, `deleted-banner.tsx`, `confirm-delete-dialog.tsx`, `status-filter.ts`, tes masing-masing
- Modify: `web/src/app/query-persist.ts` (query daftar berfilter status `deleted` tidak masuk whitelist; T21), tes `query-persist.test.ts`

**Interfaces:**
- Consumes: `Badge`, `Alert`, `ActionButton`, `ListStatusFilter`, `SoftDeleteInfo` (shared).
- Produces: `DeletedBadge()` → `Badge color="secondary" variant="soft"` "Terhapus"; `DeletedBanner({ info, canRestore, onRestore, restoring })` → `Alert color="destructive"` "Data ini sudah dihapus" + "oleh {deletedBy} pada {tanggal WIB}" + `ActionButton action="restore"` bila `canRestore`; `ConfirmDeleteDialog({ open, onOpenChange, count, subject, usage, onConfirm, busy })` → AlertDialog "Hapus {count} {subject}?" + kalimat "Data dapat dipulihkan dari tampilan Terhapus." + `usage` opsional (mis. "Dipakai 12 item"); `statusFilterOptions(canRestore: boolean): { value: ListStatusFilter; label: string }[]` → Semua status / Aktif / Nonaktif (+ Terhapus bila `canRestore`).
- [ ] **Step 1: Tes gagal** untuk keempatnya (teks persis di atas; tombol Pulihkan hanya bila `canRestore`; opsi Terhapus hanya bila `canRestore`); `ConfirmDeleteDialog` hanya menampilkan `usage` yang diberikan pemanggil (dihitung dari record hidup, T6); `query-persist` tidak menyimpan query daftar berfilter `status: 'deleted'` (T21).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): komponen Terhapus, banner pulihkan, dan konfirmasi hapus`.

### Task 6 (Haiku): Dokumentasi dan verifikasi

**Files:**
- Modify: `CLAUDE.md` ("Aturan server": butir soft delete — kolom, `liveWhere`, tes penjaga + daftar tunggu, indeks `_live`, `mapLiveDuplicate`, akses: pengguna/role terhapus tak memberi hak, lokasi terhapus = nonaktif, BU terhapus tetap memberi hak; `users_email` tetap unik penuh; `baseIndexName`/`softDeleteWithChildren`; SUNTING butir "Migrasi" (tambahkan soft delete ke daftar pengecualian expand → contract: contract dalam PR yang sama, keputusan pemilik 11) dan pernyataan lain yang bertentangan, bukan hanya menambah), `docs/ci-cd.md` (pengecualian rollback soft delete persis spek §5 butir 7: setelah rilis rollback image TIDAK aman, perbaiki ke depan), `docs/adding-a-module.md` (tabel baru wajib masuk `SOFT_DELETE_TABLES` + migrasi kolom)
- [ ] **Step 1:** Tulis dokumentasi.
- [ ] **Step 2:** `bun run check` (atau bagian non-DB bila terowongan mati, laporkan).
- [ ] **Step 3:** Commit `docs: aturan soft delete dan pengecualian rollback`.
