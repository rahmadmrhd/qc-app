# PWA Fase 3 Tahap C: Antrean IndexedDB, komentar dan task baru offline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Komentar dan task baru Serah Terima dapat ditulis tanpa sinyal, diantrekan bersama centang dalam SATU antrean IndexedDB, dan terkirim sekali saja (tanpa duplikat) saat server pulih.

**Architecture:** Server mendapat kolom `client_id` unik pada `handovers` dan `handover_comments` (kunci idempoten, pola `serials.client_id`) dan input `clientId` opsional. Di perangkat, toko `outbox` baru di IndexedDB `qc-device` (v2) menjadi sumber kebenaran; tampilan membaca salinan dalam memori (agar `readOutbox` tetap sinkron untuk `useSyncExternalStore`) yang disegarkan lewat `BroadcastChannel('qc-outbox')`. Penguras tunggal (satu kunci `qc-outbox-flush`) membaca IndexedDB di bawah kunci dan mengirim tiga jenis entri (`check`, `comment`, `create`).

**Tech Stack:** Bun + Hono + MariaDB (server), React + TanStack Query, IndexedDB mentah (`device-db.ts`), `fake-indexeddb` (tes, sudah ada), vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-pwa-offline-serah-terima-design.md` (§5 bagian `sending`, §7, §8, §9 butir (i)). PRD: `docs/prd/2026-10-26-qc-pwa.md`. Tahap A (PR #70) dan B (PR #73) sudah ada di `dev`.

## Global Constraints

- Teks UI bahasa Indonesia santai (bukan baku kaku); "Serah Terima" ditulis lengkap pada judul.
- Migrasi expand-only dan idempoten (`IF NOT EXISTS`); nomor **0017** (spek menyebut 0015, tetapi `0015_serial_cases.sql` dan `0016_panduan_interaktif.sql` sudah ada; koreksi mekanis, dicatat di tugas dokumen).
- Tanpa variabel `.env` baru; `deploy-files.test.ts` tidak berubah.
- `clientId`: UUID huruf kecil 36 karakter, validasi ketat, salah = `VALIDATION`.
- Tanpa dependensi runtime baru. Tanpa `<select>` bawaan. Service worker tetap tidak menyimpan respons API.
- Batas: centang 200 entri; komentar + task baru gabungan 50 entri; semua jenis kedaluwarsa 24 jam (`OUTBOX_MAX_AGE_MS`), skew masa depan 5 menit; `saveBatch` maks. 30 task (`HANDOVER_BATCH_MAX`); batas kirim 30 dtk (`OUTBOX_SEND_TIMEOUT_MS`); pemicu pengurasan dan pembatas 3 dtk sama dengan Fase 2.
- Penolakan server (`CONFLICT`/`FORBIDDEN`/`NOT_FOUND`/`VALIDATION`) dan kedaluwarsa = entri dibuang dengan toast beralasan; untuk komentar dan task baru toast bertahan sampai ditutup dan memuat tombol "Salin teks". `UNAVAILABLE`/`INTERNAL`/non-ApiError menahan entri dan menghentikan putaran; `UNAUTHENTICATED` menahan dan melapor.
- Tes server memakai MariaDB sungguhan lewat `bun run db:tunnel` (sudah hidup pada 2026-11-14); `bun run check` penuh wajib hijau sebelum push.
- Jangan menghentikan atau memulai ulang server dev (memori proyek).

## Rulings awal (dari perancang; mohon dikoreksi pemilik)

- R1. Migrasi bernomor 0017, bukan 0015 (lihat Global Constraints).
- R2. `clientId` komentar dan task baru dibuat SEBELUM percobaan kirim online pertama dan dipakai ulang bila entri diantrekan (spek §7.2 menyebut "saat entri ditulis"; dibaca harfiah itu menggandakan data bila kiriman pertama berhasil di server tetapi klien timeout, karena abort dipetakan ke `UNAVAILABLE`).
- R3. `HandoverDto` tidak diberi `clientId` (perubahan kontrak di luar spek). Akibat yang diterima: bila respons hilang dan refetch tiba sebelum kirim ulang, kartu sementara dan kartu server tampil ganda sebentar sampai kirim ulang dideduplikasi server dan entri dihapus. Dicatat di spek §9.
- R4. Kolom `state` entri (`rejected`) spek §7.2 TIDAK ditambah di Tahap C: baru dipakai Tahap D, ditambah di sana bersama penulis pertamanya.
- R5. Pencarian `clientId` di server: setelah izin lokasi kernel dan setelah `loadForWrite` (komentar) atau di dalam percobaan `runCas` sebelum resolusi customer (task baru); sebelum semua validasi bisnis.
- R6. Entri `check` yang bergabung (task+indeks sama) dilakukan sebagai baca-hapus-tulis dalam SATU transaksi IndexedDB; tidak ada penulisan ulang seluruh daftar pemilik dari salinan memori.

## Review Focus

Kegagalan yang paling mungkin menggigit dan tidak dijamin ditangkap tes tiap tugas:

1. Kiriman pertama berhasil di server tetapi klien timeout → entri diantrekan → kirim ulang TIDAK boleh membuat duplikat (`clientId` sama; ada tes di Task 7 dan 8).
2. Baca IndexedDB saat boot gagal atau lewat batas → salinan memori kosong → penulisan berikutnya TIDAK boleh menghapus entri nyata di toko (penulisan per entri, bukan per daftar; Task 3-4).
3. Keluar (logout) dengan permintaan terbang atau tab lain → tidak ada entri yang tertulis ulang sesudah dibuang (Task 4-6).
4. `clientId` milik pelaku/task/lokasi lain → `CONFLICT` generik tanpa bocor isi atau id (Task 1-2).
5. Dua tab menguras bersamaan → satu entri tidak terkirim dua kali (kunci bersama + baca IndexedDB di bawah kunci; Task 5).

---

### Task 1: Server: migrasi 0017, kontrak, komentar idempoten

**Files:**
- Create: `server/migrations/0017_client_id_serah_terima.sql`
- Modify: `shared/contract.ts` (`AddCommentInput.clientId?`, `SaveHandoverBatchInput.tasks[].clientId?`), `shared/handover.ts` (pola dan `isHandoverClientId`), `server/src/modules/handover/{validate,service,repo}.ts`, `server/src/core/cas.ts` (`RETRYABLE_UNIQUE_KEYS`)
- Test: `server/src/modules/handover/comment-idempotent.test.ts` (baru), `server/src/modules/handover/rest.test.ts`

**Interfaces:**
- Produces (kontrak): `AddCommentInput.clientId?: string`; `isHandoverClientId(value: string): boolean` di `shared/handover.ts` (murni; periksa dahulu apakah regex `CLIENT_ID` di `server/src/modules/serial/validate.ts` identik dan pakai bentuk yang sama).
- Produces (repo): `findCommentByClientId(db: Db, clientId: string): Promise<{ id: string; handoverId: string; author: string } | null>`.
- Produces (migrasi): `handovers.client_id VARCHAR(100) NULL` + `UNIQUE KEY handovers_client_id`; `handover_comments.client_id VARCHAR(100) NULL` + `UNIQUE KEY handover_comments_client_id`. Idempoten (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`).

- [ ] **Step 1: Tes gagal dulu** (`comment-idempotent.test.ts`, harness MariaDB seperti tes handover lain): `addComment` dengan `clientId` baru menyimpan `client_id`; pengiriman ulang `clientId` sama oleh pelaku sama pada task sama mengembalikan DTO yang sama, menulis NOL baris komentar baru, NOL audit baru, NOL notifikasi/pending baru, `updatedAt` task tidak berubah; `clientId` milik pelaku lain, atau komentar di task lain, atau lokasi lain → `CONFLICT` dengan pesan generik yang tidak memuat nomor task, email, atau id; `clientId` bukan UUID huruf kecil 36 karakter → `VALIDATION`; `clientId` kosong/tidak ada = perilaku lama; **replay atas task yang kini dibatalkan tetap mengembalikan DTO (bukan `VALIDATION`)**; `Promise.all` dua permintaan `addComment` dengan `clientId` sama → tepat satu baris komentar, kedua jawaban sukses dengan DTO memuat komentar itu tepat sekali.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/handover/comment-idempotent` → GAGAL.
- [ ] **Step 3: Implementasi** migrasi, kontrak, `isHandoverClientId`, validator (`clientId` opsional; ada tetapi tak valid = `VALIDATION` pada field `clientId`), `findCommentByClientId`, dan di `addComment`: setelah `loadForWrite` dan SEBELUM `assertNotCancelled`/batas/kutipan, bila `input.clientId` ada cari komentar; ketemu dan (`handoverId === input.id` dan `author === actor.email`) → kembalikan `dtoOf(env, loaded)` tanpa menulis apa pun; ketemu tetapi bukan milik → `appError('CONFLICT', 'Komentar tidak dapat dikirim ulang')`. `INSERT` komentar ikut menyimpan `client_id` (NULL bila tak ada). Bungkus `env.DB.batch` dengan penanganan `DbError` `duplicate` APA PUN: baca ulang `findCommentByClientId` (InnoDB dapat melaporkan indeks lain untuk baris yang sama, lihat komentar di `serial/service.ts` sekitar baris 440), periksa kepemilikan, kembalikan DTO tanpa menulis; bila bukan karena `clientId` lempar ulang. Tambah `handovers_client_id` dan `handover_comments_client_id` ke `RETRYABLE_UNIQUE_KEYS`.
- [ ] **Step 4: Tes hijau** + tambah kasus `rest.test.ts` untuk kontrak (komentar dengan `clientId` lewat `restCall`, 412/ETag tak berubah) dan jalankan `bun run --cwd server test src/modules/handover` seluruhnya.
- [ ] **Step 5: Commit** `feat(server): clientId idempoten untuk komentar Serah Terima (migrasi 0017)`.

### Task 2: Server: task baru idempoten (`saveBatch`)

**Files:**
- Modify: `shared/contract.ts` (sudah di Task 1 untuk tipe; di sini validator), `server/src/modules/handover/{validate,service,repo}.ts` (`createTasks`, `NewTaskInput.clientId?`, `insertHandoverStmts` menyimpan `client_id`), `server/src/http/body.test.ts`, `docs/ci-cd.md`
- Test: `server/src/modules/handover/create-idempotent.test.ts` (baru)

**Interfaces:**
- Consumes: `isHandoverClientId`, `RETRYABLE_UNIQUE_KEYS` dari Task 1.
- Produces: `findHandoversByClientIds(db: Db, clientIds: readonly string[]): Promise<Map<string, { id: string; locationId: string; createdBy: string }>>` di repo.

- [ ] **Step 1: Tes gagal dulu** (`create-idempotent.test.ts`): `saveBatch` 3 task ber-`clientId` membuat tiga task dan menyimpan `client_id`; kirim ulang yang sama mengembalikan DTO dalam URUTAN INPUT, menulis nol task/customer/nomor/audit/notifikasi baru (penghitung `counters` tak naik); sebagian `clientId` sudah ada dan sebagian belum → `CONFLICT` generik dan TIDAK ada yang tertulis; `clientId` ada tetapi milik pelaku lain atau lokasi lain → `CONFLICT` generik; `clientId` ganda di dalam satu permintaan → `VALIDATION`; `clientId` tak valid → `VALIDATION`; `Promise.all` dua `saveBatch` identik → tepat satu set task, kedua jawaban sukses dengan DTO yang sama; tanpa `clientId` = perilaku lama (task biasa, `handovers.save` tak berubah).
- [ ] **Step 2: Jalankan** tesnya → GAGAL.
- [ ] **Step 3: Implementasi** di `createTasks`: DI DALAM percobaan `runCas`, sebelum `reserveNumbers` dan resolusi customer, cari semua `clientId` permintaan; semua ada dan semua milik (`createdBy === actor.email`, `locationId` sama) → bangun DTO dari baris yang ada urut input (pakai pemuat yang sama dengan `handovers.get`, termasuk `checks` dan nama customer) dan kembalikan tanpa menulis; sebagian ada atau ada yang bukan milik → `appError('CONFLICT', 'Task tidak dapat dikirim ulang')`. Kasus balapan: karena kedua indeks unik kini retryable dan CAS penghitung membatalkan penulis kedua, `runCas` mengulang dan pencarian menemukan baris pemenang. `insertHandoverStmts` menyimpan `client_id`.
- [ ] **Step 4: Tes hijau**; perbarui fixture `saveBatch` di `http/body.test.ts` agar memuat `clientId` (muatan sah terbesar tetap < batas 2 MB); tambah catatan di `docs/ci-cd.md` (bagian migrasi/rollback): image sebelum rilis ini mengabaikan `clientId` sehingga duplikat mungkin lagi, dan tidak melihat entri antrean yang dipindah dari `localStorage` ke IndexedDB; jalankan seluruh `bun run --cwd server test src/modules/handover` dan `bun run --cwd server test src/http`.
- [ ] **Step 5: Commit** `feat(server): task baru idempoten lewat clientId (saveBatch)`.

### Task 3: Toko `outbox` di `device-db` (v2)

**Files:**
- Modify: `web/src/lib/device-db.ts`, `web/src/app/board-persist.ts` (pemanggil pembersihan), `web/src/modules/auth/use-logout.ts` (hanya bila perlu mengganti nama pemanggil)
- Test: `web/src/lib/device-db.test.ts`

**Interfaces:**
- Produces: `DeviceStoreName = 'columns' | 'tasks' | 'outbox'`; `DB_VERSION = 2` (upgrade menambah toko `outbox` tanpa menyentuh dua toko lama).
- Produces: `readOutboxRecords(): Promise<DeviceRecord[] | null>` (`null` = tidak diketahui: tanpa IndexedDB/galat/timeout; `[]` = benar-benar kosong; sengaja berbeda dari `readAllRecords`).
- Produces: `putOutboxRecord(owner: string, record: DeviceRecord, rule: { replaceIf?: (existing: DeviceRecord) => boolean; cap?: { count: (existing: DeviceRecord) => boolean; max: number } }, guard: () => boolean): Promise<'ok' | 'full' | 'failed'>` — dalam SATU transaksi readwrite: pindai rekaman `owner|*` (rentang kunci), hapus yang `replaceIf` benar, hitung sisa yang memenuhi `cap.count`; bila `>= cap.max` batalkan transaksi dan kembalikan `'full'`; selain itu `put`. `guard` dipanggil sinkron tepat sebelum transaksi dibuka; `false` → `'failed'` tanpa menulis.
- Produces: `deleteOutboxRecords(keys: readonly string[]): Promise<boolean>`; `deleteOutboxExceptOwner(owner: string): Promise<boolean>`; `clearBoardStores(): Promise<void>` (hanya `columns` dan `tasks`); `clearAllDeviceStores(): Promise<void>` (ketiganya). `clearDeviceDb` lama dihapus dan SEMUA pemanggilnya dialihkan (audit: `board-persist.ts` memakai `clearBoardStores`; pembersihan saat keluar memakai `clearAllDeviceStores`).
- `writeRecords` (pemangkasan `savedAt`) TIDAK dipakai untuk `outbox`: antrean tidak boleh dipangkas diam-diam.

- [ ] **Step 1: Tes gagal dulu** (`fake-indexeddb`): upgrade v1→v2 menjaga isi `columns`/`tasks`; `readOutboxRecords` mengembalikan `null` saat `indexedDB` tak ada dan `[]` saat kosong; `putOutboxRecord` dengan `replaceIf` mengganti rekaman task+indeks sama dalam satu transaksi (hitung transaksi: satu); tutup transaksi saat `'full'` tidak menulis apa pun; `guard` false → `'failed'`; `deleteOutboxExceptOwner` hanya menyisakan milik owner; `clearBoardStores` TIDAK menyentuh `outbox` (uji mutasi: tes gagal bila `clearBoardStores` menghapus ketiganya); `clearAllDeviceStores` menghapus ketiganya.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/lib/device-db` → GAGAL.
- [ ] **Step 3: Implementasi** sesuai Interfaces (kunci `owner|id`, rentang `IDBKeyRange.bound(`${owner}|`, `${owner}|￿`)`). Semua fungsi tak pernah reject.
- [ ] **Step 4: Tes hijau**, lalu seluruh `bun run --cwd web test src/lib src/app/board-persist src/modules/auth` untuk memastikan pemanggil lama tak rusak; typecheck.
- [ ] **Step 5: Commit** `feat(web): toko outbox IndexedDB (device-db v2)`.

### Task 4: Inti antrean umum + migrasi `localStorage` + port centang

**Files:**
- Create: `web/src/modules/handover/lib/outbox.ts` (tipe dan inti), `web/src/modules/handover/lib/outbox.test.ts`
- Modify: `web/src/modules/handover/lib/check-outbox.ts` (menjadi fasad khusus centang di atas `outbox.ts`; `OutboxEntry` lama dipertahankan sebagai nama tipe centang bila itu meminimalkan perubahan, `OutboxEntry` baru = gabungan), `use-check-queue.ts`, `use-pending-checks.ts`, `use-outbox-summary.ts`, `web/src/main.tsx` (hidrasi pada jalur boot normal DAN offline), semua tes yang ada untuk modul-modul itu (**dipindah/diadaptasi, bukan ditulis ulang**)
- Test: seluruh `check-outbox.test.ts`, `use-check-queue.test.tsx`, `use-pending-checks.test.tsx`, `use-outbox-summary.test.tsx`, `outbox-chip.test.tsx`, `offline-screen.test.tsx` tetap hijau setelah adaptasi

**Interfaces:**
- Produces (tipe): `CheckEntry` (= `OutboxEntry` Fase 2: `id, taskId, locationId, index, text, checked, at`) dengan `kind: 'check'`; `CommentEntry { kind: 'comment'; id; clientId; taskId; locationId; quote; before; after; body; at }`; `CreateEntry { kind: 'create'; id; locationId; tasks: Array<{ clientId: string; customerName: string; note: string }>; at }`; `OutboxEntry = CheckEntry | CommentEntry | CreateEntry`. Rekaman IndexedDB: `{ key: 'owner|id', owner, v: 1, savedAt: at, entry }`.
- Produces (konstanta): `OUTBOX_MAX_CHECKS = 200`, `OUTBOX_MAX_WRITES = 50` (komentar + task baru gabungan), plus `OUTBOX_MAX_AGE_MS`, `OUTBOX_MAX_FUTURE_SKEW_MS`, `isExpiredEntry(entry, now)` (pindah dari `check-outbox.ts`, dipakai semua jenis).
- Produces (inti): `hydrateOutbox(budgetMs?: number): Promise<void>` — satu kali per proses; membaca `readOutboxRecords()` dalam batas waktu (bawaan 1.500 ms; hasil terlambat TIDAK diterapkan; `null`/timeout = salinan kosong tanpa menghapus apa pun di toko), memigrasi kunci `localStorage` `qc.outbox:*` ke toko (tulis, KONFIRMASI, baru hapus kunci lama; gagal = kunci lama dipertahankan dan dicoba lagi pada boot berikutnya), lalu memasang salinan memori. Dipanggil `Promise.all` bersama `restoreBoardCache` agar dua batas waktu tidak berurutan (satu koneksi `getDb` dipakai bersama).
- Produces: `readOutbox(owner: string): OutboxEntry[]` (sinkron dari salinan memori, urut `at`), `countAllOutboxEntries(): number` (semua pemilik, tanpa yang kedaluwarsa), `subscribeOutbox`, `outboxVersion`, `suspendOutboxWrites`/`resumeOutboxWrites`/`outboxWritesSuspended`.
- Produces: `enqueueOutbox(owner: string, entry: Omit<OutboxEntry, 'id'> & { id?: string }): Promise<'ok' | 'full' | 'failed'>` — memanggil `putOutboxRecord` (centang: `replaceIf` task+indeks sama, cap `check` 200; komentar/task baru: cap `comment|create` 50); `writesSuspended` diperiksa sebagai `guard` TEPAT sebelum transaksi; salinan memori diperbarui dan `notify()` dipanggil HANYA setelah penulisan terkonfirmasi, lalu siaran `qc-outbox` `{ type: 'changed' }`. Tanpa pernah menulis ulang seluruh daftar pemilik.
- Produces: `removeOutboxEntries(owner: string, ids: readonly string[]): Promise<void>` (hapus per `id`, salinan memori ikut, siaran), `refreshOutboxFromStore(): Promise<OutboxEntry[] | null>` (baca IndexedDB, perbarui salinan memori; dipakai penguras di bawah kunci), `purgeExpired(owner, now): Promise<OutboxEntry[]>`, `purgeForeignOutboxes(owner): Promise<void>` (`deleteOutboxExceptOwner`), `clearAllOutboxesWithin(budgetMs?: number): Promise<void>` (`clearAllDeviceStores` outbox saja + kunci `localStorage` lama; dibatasi 1.500 ms seperti `clearBoardStoreWithin`; salinan memori langsung dikosongkan).
- Produces: `check-outbox.ts`: `enqueueCheck(owner, entry): Promise<'ok' | 'full' | 'failed'>` (async; mengganti versi sinkron), `hasEntriesForTask(owner, taskId): boolean` (dari salinan memori, semua jenis), `overlayPendingChecks` (tak berubah).
- Siaran: `BroadcastChannel('qc-outbox')`; pesan `changed` membuat tab lain memanggil `refreshOutboxFromStore()` (digabung/ditunda ringan); tanpa `BroadcastChannel` tidak ada yang rusak. Peristiwa `storage` lama untuk `qc.outbox:` dihapus.

- [ ] **Step 1: Tes gagal dulu** (`outbox.test.ts` dengan `fake-indexeddb`): hidrasi memuat entri tiga jenis; baca timeout/`null` TIDAK menghapus entri di toko dan penulisan berikutnya (`enqueueOutbox`) mempertahankan entri lama (uji kegagalan #2 di Review Focus); migrasi `localStorage` memindahkan lalu menghapus kunci hanya setelah tulis terkonfirmasi, dan mempertahankan kunci bila tulis gagal; `enqueueOutbox` centang dengan task+indeks sama menggantikan (satu transaksi); cap centang 200 dan cap komentar+task baru 50 terpisah; `suspendOutboxWrites` setelah memanggil tetapi sebelum transaksi → `'failed'` dan toko tak berubah; penanda "Belum terkirim" (notify) tidak terjadi sebelum tulis terkonfirmasi; `enqueueOutbox` yang gagal tulis tidak memperbarui salinan memori; siaran `changed` ke tab lain memuat ulang salinannya; `clearAllOutboxesWithin` dilepas setelah batas waktu bila IndexedDB macet.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/handover/lib/outbox` → GAGAL.
- [ ] **Step 3: Implementasi** `outbox.ts` sesuai Interfaces; `check-outbox.ts` menjadi fasad; ganti `localStorage` di seluruhnya; `useCheckQueue.queueIt` menjadi async dan menunggu hasil (`'ok'` → lanjut seperti sebelumnya; `'full'`/`'failed'` → perilaku lama: balik + galat biasa); `main.tsx` memanggil `hydrateOutbox` pada jalur boot normal sebelum router dan pada jalur boot offline sebelum layar dirender. `purgeForeignOutboxes`/`purgeExpired` memanggil versi async tanpa menunggu bila pemanggil sinkron tak dapat menunggu (jelaskan di komentar).
- [ ] **Step 4: Port tes Fase 2/Tahap A** (`check-outbox.test.ts`, `use-check-queue.test.tsx`, dll.) ke API baru dengan `fake-indexeddb`; JANGAN menulis ulang skenario, hanya pindahkan arsip dan setup. Jalankan `bun run --cwd web test src/modules/handover src/app src/modules/auth` + typecheck + lint.
- [ ] **Step 5: Commit** `feat(web): antrean umum di IndexedDB (salinan memori, migrasi localStorage)`.

### Task 5: Penguras umum, status `sending` lintas-tab, pengait boot dan keluar

**Files:**
- Modify/Rename: `web/src/modules/handover/lib/check-outbox-flush.ts` → `outbox-flush.ts` (rename git; port tesnya), `outbox-status.ts` (+ siaran), `web/src/app/outbox-sync.ts`, `web/src/modules/auth/use-logout.ts`
- Test: `outbox-flush.test.ts` (dipindah dari `check-outbox-flush.test.ts` + kasus baru), `outbox-status.test.ts`, `outbox-sync.test.ts`, `use-logout.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`refreshOutboxFromStore`, `removeOutboxEntries`, `purgeExpired`, `OutboxEntry`).
- Produces: `FlushDeps.send: (entry: OutboxEntry) => Promise<HandoverDto | HandoverDto[]>`; `sendOutboxEntry(entry)` memilih rute menurut `entry.kind`: `check` → `handovers.setCheck`; `comment` → `handovers.comment` memuat `clientId`; `create` → `handovers.saveBatch` dengan `tasks[].clientId` (urutan task dipertahankan). Semuanya memakai `AbortController` + `OUTBOX_SEND_TIMEOUT_MS`.
- Produces: `FlushDeps.onSent?: (saved: HandoverDto[], entry: OutboxEntry) => void` (dipanggil sinkron SEBELUM entri dihapus, seperti sekarang; larik karena `create` mengembalikan banyak DTO).
- Produces: `FlushResult.rejected`/`expired` memuat entri apa pun jenisnya (untuk toast Task 9); `stoppedBy` tak berubah.
- Produces: `run()` membaca antrean dengan `refreshOutboxFromStore()` di bawah kunci `qc-outbox-flush` TIAP iterasi (IndexedDB = sumber kebenaran; bila `null` hentikan putaran dengan `stoppedBy: 'unavailable'` dan jangan menghapus apa pun); urutan: entri per task menurut `at`, antar task bebas, satu permintaan pada satu waktu; entri `create` dikirim menurut `at` terhadap yang lain pada lokasi sama tanpa jaminan terhadap task lain.
- Produces (`outbox-status.ts`): `beginSendingEntry(id: string): () => void`, `isEntrySending(id: string): boolean`; siaran `qc-outbox` `{ type: 'sending', ids: string[], until: number }` dengan masa berlaku 45 dtk (`SENDING_TTL_MS = 45_000`), tab penerima menyimpan `until` dan tanda kedaluwarsa sendiri (pengirim yang mati tidak membuat penanda macet); `beginSending(taskId, index)` untuk centang LANGSUNG online tetap per-tab; `clearSending()` membuang kedua jenis.
- `startOutboxSync`: memanggil `purgeForeignOutboxes(owner)`/`resumeOutboxWrites()` seperti sekarang; pemicu `drain` memakai `readOutbox(owner).length > 0` dari salinan memori sebagai pintu masuk murah, tetapi isi sebenarnya dibaca penguras di bawah kunci. `useLogout`: `await clearAllOutboxesWithin()` menggantikan `clearAllOutboxes()`.

- [ ] **Step 1: Tes gagal dulu**: skenario klasifikasi galat yang SAMA untuk tiga jenis entri (tabel skenario: `UNAVAILABLE`/`INTERNAL`/non-ApiError → entri tetap & berhenti; `UNAUTHENTICATED` → tetap & lapor; `CONFLICT`/`FORBIDDEN`/`NOT_FOUND`/`VALIDATION` → dibuang & dilaporkan di `rejected` dengan alasan); `comment` mengirim `clientId` entri yang SAMA pada kirim ulang; `create` mengirim `clientId` per task yang sama; entri kedaluwarsa semua jenis dibuang ke `expired`; dua penguras serentak (dua `flushOutbox` dengan kunci `navigator.locks` palsu) mengirim satu entri tepat sekali; IndexedDB `null` menghentikan putaran tanpa menghapus; `isEntrySending` benar selama kirim dan juga di tab lain lewat siaran, dan kedaluwarsa sesudah 45 dtk tanpa pesan lanjutan (timer palsu).
- [ ] **Step 2: Jalankan** tesnya → GAGAL.
- [ ] **Step 3: Implementasi** sesuai Interfaces; `onSent` di `outbox-sync.ts` memasang hasil per kind (`check` dan `comment` memakai `applySavedHandover` dengan penjaga `cacheIsNewer` yang tetap; `create` memasang tiap DTO ke papan `new` lewat `applySavedHandover`) dan memanggil `markStale(audit, customerKeys.all, ['handovers','options'])` untuk `create`.
- [ ] **Step 4: Tes hijau** (`bun run --cwd web test src/modules/handover src/app src/modules/auth`) + typecheck + lint.
- [ ] **Step 5: Commit** `feat(web): penguras antrean umum tiga jenis + status sending lintas tab`.

### Task 6: Siaran keluar (logout) antar-tab

**Files:**
- Create: `web/src/app/session-broadcast.ts`, `web/src/app/session-broadcast.test.ts`
- Modify: `web/src/modules/auth/use-logout.ts`, `web/src/main.tsx` (pasang pendengar pada jalur boot sah), `web/src/app/board-persist.ts` (hentikan penyimpanan dari luar bila perlu)

**Interfaces:**
- Produces: `announceLogout(owner: string): void` (kirim `{ type: 'logout', owner }` di `BroadcastChannel('qc-session')`), `startSessionListener(onLogout: (owner: string) => void): () => void`.
- Perilaku penerima (pada jalur boot sah di `main.tsx`): bila `owner` pesan sama dengan pemilik sesi tab ini → `suspendOutboxWrites()`, `clearSending()`, hentikan `startBoardPersistence` (fungsi stop yang sudah dikembalikan), kosongkan salinan memori antrean; TIDAK menavigasi (sesi tab itu mati lewat jalur 401 yang ada). Pesan dari pemilik lain diabaikan. `useLogout` memanggil `announceLogout` sesudah `suspendOutboxWrites()`.

- [ ] **Step 1: Tes gagal dulu**: pesan logout pemilik sama menangguhkan penulisan antrean dan menghentikan penyimpan papan (penulisan berikutnya `enqueueOutbox` → `'failed'`, `startBoardPersistence` tak menulis); pesan pemilik lain diabaikan; tanpa `BroadcastChannel` tidak galat; pendengar dilepas oleh fungsi stop.
- [ ] **Step 2: Jalankan** → GAGAL. **Step 3: Implementasi.** **Step 4:** hijau + tes `use-logout` + typecheck + lint.
- [ ] **Step 5: Commit** `feat(web): siaran keluar antar tab (tutup batasan banyak tab Tahap B)`.

### Task 7: Komentar offline

**Files:**
- Modify: `web/src/modules/handover/queries.ts` (`useAddComment` memakai `clientId`), `web/src/modules/handover/components/{note-view,handover-detail-view,handover-board-page}.tsx`, `web/src/routes/_app/handover/$handoverId/index.tsx`, `web/src/modules/handover/lib/use-pending-checks.ts` (kembalikan juga `pendingComments`)
- Create: `web/src/modules/handover/lib/send-comment.ts` + tes
- Test: `send-comment.test.ts`, `note-view.test.tsx`, `handover-detail-view.test.tsx`, `use-pending-checks.test.tsx`

**Interfaces:**
- Produces: `sendComment(input: Omit<AddCommentInput, 'clientId'> & { owner: string }, deps): Promise<{ queued: boolean; dto?: HandoverDto }>` — membuat `clientId = crypto.randomUUID()` SEKALI, mencoba `api('handovers.comment', { ...input, clientId })`; `UNAVAILABLE` → `enqueueOutbox(owner, { kind: 'comment', clientId, ... })` dengan `clientId` yang SAMA; hasil `'ok'` → `{ queued: true }`, `'full'`/`'failed'` → lempar `ApiError` biasa agar isi tidak dibuang dari komposer; galat lain dilempar seperti sekarang.
- Produces: `useOutboxOverlay` mengembalikan juga `pendingComments: Array<{ id: string; body: string; quote: string; at: number; status: 'waiting' | 'sending' }>` untuk task itu (komentar kedaluwarsa tak ikut).
- `NoteView` merender `pendingComments` di AKHIR daftar komentar dengan label "Belum terkirim" / "Mengirim…" (teks UI santai); komposer dikosongkan seketika setelah `queued: true` (bukan menunggu server).

- [ ] **Step 1: Tes gagal dulu**: `sendComment` online sukses tanpa menulis antrean; `UNAVAILABLE` mengantre dengan `clientId` yang sama dengan yang dikirim di percobaan pertama (**kegagalan #1 Review Focus**: timeout setelah server menyimpan → penguras mengirim ulang `clientId` itu, server mengembalikan DTO tanpa duplikat — uji dengan `send` palsu yang merekam `clientId` kedua panggilan); `'full'`/`'failed'` melempar galat dan komposer mempertahankan isi; galat `VALIDATION` tidak mengantre; komentar tertunda tampil berlabel di akhir daftar dan label berganti "Mengirim…" lewat `isEntrySending`; setelah `onSent` (DTO server memuat komentar) komentar tertunda hilang tanpa ganda (entri dihapus SESUDAH cache dipasang).
- [ ] **Step 2:** GAGAL. **Step 3:** Implementasi (`useAddComment` pada rute detail dan papan menjadi pemanggil `sendComment`). **Step 4:** hijau + `bun run --cwd web test src/modules/handover` + typecheck + lint.
- [ ] **Step 5: Commit** `feat(web): komentar Serah Terima dapat diantrekan offline`.

### Task 8: Task baru offline

**Files:**
- Modify: `web/src/routes/_app/handover/new.tsx`, `web/src/modules/handover/components/{handover-batch-form,handover-board,handover-card,handover-board-page}.tsx`, `web/src/modules/handover/schemas.ts` (`toSaveHandoverBatchInput` memuat `clientId`), `web/src/app/query-client.ts` (hanya bila `shouldRetry` membuat query `handovers.options` menggantung offline; periksa dan cukup nonaktifkan retry untuk kunci itu bila perlu)
- Create: `web/src/modules/handover/lib/send-create.ts`, `web/src/modules/handover/components/pending-create-card.tsx` + tes
- Test: `send-create.test.ts`, `pending-create-card.test.tsx`, `handover-board.test.tsx`, `new.test.tsx` (baru bila belum ada)

**Interfaces:**
- Produces: `sendCreate(input: SaveHandoverBatchInput & { owner: string }, deps): Promise<{ queued: boolean; dtos?: HandoverDto[] }>` — membuat `clientId` per task SEKALI (sebelum percobaan pertama) dan memakainya ulang bila `UNAVAILABLE` mengantre entri `{ kind: 'create', locationId, tasks }`; aturan `'full'`/`'failed'`/galat lain sama dengan `sendComment`. Entri satu per permintaan (maks. 30 task).
- Produces: `usePendingCreates(owner: string, locationIds: readonly string[]): Array<CreateEntry & { status: 'waiting' | 'sending' }>`.
- `PendingCreateCard`: kartu sementara di kolom Baru (desktop) dan daftar kartu (ponsel) bernomor "—", berlabel status, `aria-disabled` dan TIDAK dapat dibuka (tanpa tautan); satu kartu per task dalam entri. Hanya untuk lokasi yang sedang dipilih.
- `new.tsx`: bila `options` gagal dengan `ApiError` `UNAVAILABLE`, formulir tetap tampil dengan `options` kosong (saran customer tak tersedia; nama diketik bebas); galat lain tetap pesan "Gagal memuat daftar customer."; setelah `queued: true` tampil toast info dan kembali ke daftar, setelah sukses online perilaku lama.

- [ ] **Step 1: Tes gagal dulu**: `sendCreate` mengantre `clientId` per task yang SAMA dengan percobaan pertama (**kegagalan #1**); kartu sementara tampil di kolom Baru dengan "—", tak dapat dibuka, berlabel status; setelah `onSent` kartu digantikan hasil server tanpa kedipan ganda (entri dihapus sesudah cache dipasang); `new.tsx` offline menampilkan formulir dengan opsi kosong dan menyimpan ke antrean; lokasi tak terpilih tak menampilkan kartu sementara; batas 50 (`'full'`) menampilkan galat dan formulir tidak dikosongkan.
- [ ] **Step 2:** GAGAL. **Step 3:** Implementasi. **Step 4:** hijau + `bun run --cwd web test src/modules/handover src/routes` + typecheck + lint.
- [ ] **Step 5: Commit** `feat(web): task baru Serah Terima dapat diantrekan offline`.

### Task 9: Penghitung, daftar popover, dialog keluar, layar offline, toast salin

**Files:**
- Modify: `web/src/app/shell/outbox-chip.tsx`, `web/src/modules/handover/lib/use-outbox-summary.ts`, `web/src/modules/auth/logout-confirm-dialog.tsx`, `web/src/app/shell/offline-screen.tsx`, `web/src/app/outbox-sync.ts` (`announce`)
- Create: `web/src/modules/handover/lib/outbox-labels.ts` (+ tes): `describeEntry(entry): { kind: string; target: string }`
- Test: `outbox-chip.test.tsx`, `logout-confirm-dialog.test.tsx`, `offline-screen.test.tsx`, `outbox-sync.test.ts`

**Interfaces:**
- `useOutboxSummary(owner)` mengembalikan `entries: OutboxEntry[]` (semua jenis, tanpa kedaluwarsa) dan `sending` berdasarkan `isEntrySending(entry.id)` untuk komentar/task baru dan `isItemSending(taskId, index)` untuk centang.
- Chip: hitungan semua jenis; popover memuat baris "jenis, nomor/nama task, waktu" (centang "Centang", komentar "Komentar", task baru "Task baru: <nama customer>").
- Dialog keluar dan layar offline menghitung semua jenis dan semua pemilik (`countAllOutboxEntries` dari salinan memori; layar offline dirender SETELAH `hydrateOutbox`).
- `announce(result)` di `outbox-sync.ts`: centang tetap toast biasa; entri `comment`/`create` yang ditolak atau kedaluwarsa memunculkan `toast.error(..., { duration: Infinity, action: { label: 'Salin teks', onClick } })` dengan alasan dari server; "Salin teks" menyalin `body` komentar atau (task baru) tiap `note` dipisah baris kosong lewat `navigator.clipboard.writeText` (kegagalan klip tidak melempar).

- [ ] **Step 1: Tes gagal dulu**: hitungan chip/dialog/layar offline mencakup tiga jenis dan semua pemilik; popover mencantumkan jenis; toast penolakan komentar bertahan (`duration: Infinity`) dan "Salin teks" memanggil `writeText` dengan isi komentar; kedaluwarsa task baru memuat salinan catatan; toast centang tidak berubah.
- [ ] **Step 2:** GAGAL. **Step 3:** Implementasi. **Step 4:** hijau + seluruh `bun run --cwd web test src/app src/modules/auth src/modules/handover` + typecheck + lint.
- [ ] **Step 5: Commit** `feat(web): penghitung dan peringatan mencakup komentar dan task baru`.

### Task 10: Dokumen

**Files:**
- Modify: `docs/superpowers/specs/2026-11-13-pwa-offline-serah-terima-design.md` (§7.1 nomor migrasi 0017; §7.2 `state` ditunda ke Tahap D; §9 keputusan Tahap C R1-R6 bertanda "menunggu pengesahan pemilik"), `docs/prd/2026-10-26-qc-pwa.md` (FR komentar/task baru offline, §11 entri 2026-11-14 untuk Tahap C, NFR-P4 antrean IndexedDB, §2.3), `docs/e2e-checklist.md` (skenario perangkat nyata #208+ BELUM TERUJI: komentar dan task baru offline lalu pulih, kiriman pertama berhasil tetapi timeout tanpa duplikat, tutup-buka dengan antrean, ganti akun, keluar dengan peringatan dan siaran antar tab, penolakan server beserta "Salin teks", dua tab), `CLAUDE.md` (bagian PWA: antrean IndexedDB, `clientId`, migrasi 0017; bagian Serah Terima: `clientId` pada kontrak)

- [ ] **Step 1:** Perbarui dokumen sesuai daftar; pertahankan LF dan kalimat Tahap B/pemulihan cangkang basi yang sudah ada.
- [ ] **Step 2: Commit** `docs(pwa): Tahap C (antrean IndexedDB, komentar dan task baru offline)`.

## Verifikasi dan penutupan (controller, bukan tugas implementer)

- `bun run check` penuh (terowongan DB hidup) + `bun run build` (`verify-dist`); gagal mesin lambat = jalankan ulang berkas yang gagal sendiri lalu putaran penuh.
- Review akhir independen (Opus, agent baru, diberi diff dan spek tanpa kesimpulan implementer) mencakup kesesuaian spek/regresi DAN `security-audit` terfokus diff (kepemilikan `clientId`, urutan otorisasi → pencarian → validasi, kebocoran data antar pemilik, siaran antar-tab).
- Satu putaran perbaikan oleh implementer yang sama (SendMessage); review diff perbaikan; lalu push dan PR ke `dev` (bukan `main`).
