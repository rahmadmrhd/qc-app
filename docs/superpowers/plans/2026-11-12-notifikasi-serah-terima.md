# Notifikasi Serah Terima Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap kejadian pada task Serah Terima menghasilkan notifikasi untuk penerima yang benar (lonceng di aplikasi, dan backend push yang siap), dengan penggabungan centang 5 menit.

**Architecture:** Kejadian dihitung di jalur tulis `handover/service.ts` dari keadaan sebelum dan sesudah, lalu pernyataan SQL notifikasi digabung ke `batch()` penulisan yang sama (seperti `writeAudit`), sehingga atomik. Centang digabung lewat tabel tunggu yang dilepas oleh satu putaran latar sendiri (di luar antrean job). Lonceng membaca notifikasi per penerima dengan pemeriksaan hak akses saat dibaca; push dikirim oleh putaran yang sama lewat antarmuka `PushSender` yang disuntik (seperti `MAILER`).

**Tech Stack:** Bun + Hono + MariaDB (`Db`), `shared/` murni, React + TanStack Query di `web/`, `web-push` atau WebCrypto untuk pengirim push (diputuskan di Task 7).

**Spec:** `docs/superpowers/specs/2026-11-12-notifikasi-serah-terima-design.md` (disetujui pemilik 2026-11-12). Pelaksana membaca spek dan `CLAUDE.md`.

## Global Constraints

- Penerima dikunci dengan **email ternormalisasi** (`normalizeEmail`, `server/src/core/email.ts`), bukan `users.id`.
- Jendela penggabungan centang `CHECK_WINDOW_MS = 300_000` (5 menit, tetap sejak centang pertama); detak putaran latar notifikasi 30 detik; umur notifikasi `NOTIFICATION_RETENTION_DAYS = 90` (pilihan perancang).
- Sisi QC = `qc: edit` di lokasi task; sisi WH = `handover: view` ke atas di lokasi task; "semua" = salah satunya. Hanya lokasi **aktif**.
- Migrasi expand-only, idempoten (`IF NOT EXISTS`), nomor `0011` dan `0012` (terakhir di `dev` saat ini `0010`; pesan nomor ke sesi lain dan periksa `ls server/migrations` sebelum mulai).
- `Db`: parameter `?` berurutan, nilai selalu di-bind, kolom `key`/`before`/`after` berbacktick, `SUM`/`COUNT` dibungkus `Number()`, kolasi `utf8mb4_nopad_bin`. Penulisan yang bergantung pada pembacaan dijaga CAS di `batch()` atau `FOR UPDATE`.
- Tidak membaca `process.env` di luar `config.ts` dan `main.ts`. Variabel baru di `server/src/config.ts` wajib ada di `deploy/compose.yml` DAN `deploy/.env.example` (dijaga `server/src/deploy-files.test.ts`). `loadConfig` tidak boleh gagal karena variabel push (kosong atau tak valid = push dinonaktifkan).
- Rute baru: id di `shared/contract.ts` (`ApiContract`) dan `shared/api.ts` (`API_ROUTES`), validator dan handler di modul, daftarkan di `server/src/routes.ts` (`ALL_API_IDS` dan `getRoutes()`), tes `rest.test.ts` lewat `restClient`/`restCall`. Rute JSON bermuatan badan wajib masuk tabel `server/src/http/body.test.ts`.
- `shared/` murni (tanpa API runtime/DOM). Teks UI bahasa Indonesia. Web: TanStack Query, tanpa `<select>` bawaan, notifikasi **tidak** masuk whitelist `web/src/app/query-persist.ts`.
- Tes server memakai MariaDB sungguhan lewat tunnel (`bun run db:tunnel`); jam terkendali lewat `env.NOW`. `bun run check` hijau sebelum commit.
- Di luar rencana ini: handler push di service worker, permintaan izin setelah login pertama, banner pengingat, halaman status push admin, tombol preferensi push, saluran desktop. Semuanya menunggu Fase 1 PRD PWA; rencana ini hanya menyediakan API servernya.

## Review Focus

1. Centang yang dikirim ulang dari antrean offline dengan nilai sama tidak boleh menghasilkan kejadian apa pun (Task 4).
2. Pengguna yang berhak di dua sisi (izin `handover` dan `qc` sekaligus) menerima **satu** notifikasi per kejadian, bukan dua (Task 3).
3. Akses yang dicabut setelah notifikasi dibuat: lonceng tidak menampilkannya dan push tidak dikirim (Task 6 dan 7).
4. Satu centang lalu dilepas pada butir yang sama dalam jendela, serta centang butir terakhir yang menyelesaikan task, tidak boleh menghasilkan ringkasan hantu atau dua notifikasi berantai (Task 5).
5. Satu permintaan `saveBatch` berisi 30 task menghasilkan tepat satu ringkasan per penerima, bukan 30 (Task 4).

---

### Task 1: Aturan murni notifikasi di `shared/`

**Files:**
- Create: `shared/notifications.ts`, `shared/notifications.test.ts`

**Interfaces:**
- Produces (dipakai Task 2-8):
  - `NOTIFICATION_KINDS = ['created','createdBatch','updated','cancelled','reopened','done','checked','commented'] as const`; `type NotificationKind`.
  - `type NotificationSide = 'qc' | 'wh' | 'all'`; `NOTIFICATION_SIDE: Record<NotificationKind, NotificationSide>` (created, createdBatch, updated, cancelled, reopened = `qc`; done, checked = `wh`; commented = `all`).
  - `CHECK_WINDOW_MS`, `NOTIFICATION_RETENTION_DAYS`, `NOTIFICATION_PREVIEW_MAX = 140`.
  - `interface NotificationDto { id: string; kind: NotificationKind; handoverId: string; locationId: string; number: string; customerName: string; actor: string; count: number; preview: string; createdAt: string; readAt: string }` (`handoverId`/`number` kosong untuk `createdBatch`; `readAt` kosong = belum dibaca).
  - `notificationTitle(n: Pick<NotificationDto, 'kind' | 'actor' | 'number' | 'count'>): string` (teks Indonesia, tabel di Step 3).
  - `interface HandoverSnap { status: HandoverStatus; customerId: string; note: string }`; `type HandoverAction = 'create' | 'save' | 'check' | 'done' | 'cancel' | 'reopen' | 'comment'`.
  - `handoverEventsOf(action: HandoverAction, before: HandoverSnap | null, after: HandoverSnap): NotificationKind[]` (`status` = status **turunan**, `deriveHandoverStatus`).
  - `pushPayloadOf(n: NotificationDto): { title: string; body: string; url: string; tag: string }`.

- [ ] **Step 1: Tulis tes `handoverEventsOf` dan teks** dalam `shared/notifications.test.ts`: `create` → `['created']`; `save` dengan `note` berbeda → `['updated']`; `save` dengan `customerId` berbeda → `['updated']`; `save` tanpa beda keduanya → `[]`; `save` yang mengubah catatan sekaligus membuat status `in_progress`→`done` → `['updated','done']`; `check` tanpa transisi → `['checked']`; `check` yang membuat `in_progress`→`done` → `['done']` (tanpa `checked`); `done` dengan transisi → `['done']`, tanpa transisi (sudah done) → `[]`; `cancel` → `['cancelled']`; `reopen` → `['reopened']`; `comment` → `['commented']`; task `done` yang kembali `in_progress` lewat `check` (lepas centang) → `['checked']`, bukan kejadian "dibuka kembali".
- [ ] **Step 2: Tes `pushPayloadOf`**: `body` memuat nomor dan nama customer saja; untuk `commented` dan `updated` dengan `preview` berisi teks rahasia, `title` dan `body` TIDAK memuat teks itu; `url` = `/handover/<handoverId>`, atau `/handover` bila `handoverId` kosong; `tag` = `<kind>:<handoverId>`.
- [ ] **Step 3: Implementasi** semua simbol di atas di `shared/notifications.ts`. Teks judul: created "{actor} membuat task {number}"; createdBatch "{actor} membuat {count} task baru"; updated "{actor} mengubah task {number}"; cancelled "{actor} membatalkan task {number}"; reopened "{actor} membuka kembali task {number}"; done "{actor} menyelesaikan task {number}"; checked "{actor} memperbarui {count} butir di {number}"; commented "{actor} mengomentari task {number}".
- [ ] **Step 4: Jalankan** `bun run --cwd shared test notifications` → PASS.
- [ ] **Step 5: Commit** `feat(shared): aturan murni notifikasi Serah Terima`.

---

### Task 2: Migrasi dan repo notifikasi

**Files:**
- Create: `server/migrations/0011_notifikasi.sql`, `server/src/modules/notification/repo.ts`, `server/src/modules/notification/repo.test.ts`

**Interfaces:**
- Consumes: `NotificationDto`, `NotificationKind` (Task 1); `Db`, `DbStatement` (`server/src/core/db.ts`).
- Produces:
  - Tabel `notifications(id, recipient, kind, handover_id, location_id, number, customer_name, actor_email, actor_name, count, preview, created_at, read_at, push_state)`: `id` UUID kunci utama; `recipient` email ternormalisasi; `read_at` `''` = belum dibaca; `push_state` `'pending'|'sent'|'skipped'|'failed'` bawaan `'pending'`; indeks `(recipient, created_at, id)` dan `(push_state, created_at)`.
  - Tabel `notification_pending(handover_id, actor_email, location_id, number, customer_name, actor_name, first_at, release_at)` kunci utama `(handover_id, actor_email)`, indeks `release_at`.
  - Tabel `notification_pending_items(handover_id, actor_email, item_key, item_text, occurrence, parity)` kunci utama `(handover_id, actor_email, item_key)`; `item_key` = hash teks kanonis butir + `#` + `occurrence`.
  - `interface NewNotification { recipient: string; kind: NotificationKind; handoverId: string; locationId: string; number: string; customerName: string; actorEmail: string; actorName: string; count: number; preview: string; createdAt: string }`.
  - `insertNotificationStmts(db: Db, rows: readonly NewNotification[]): DbStatement[]`
  - `listNotifications(env: Env, recipient: string, opts: { locationIds: readonly string[]; limit: number; before?: string }): Promise<{ items: NotificationDto[]; nextCursor: string | null }>` (kursor = `createdAt|id`; `locationIds` kosong = hasil kosong tanpa kueri)
  - `countUnread(env: Env, recipient: string, locationIds: readonly string[]): Promise<number>`
  - `markRead(env: Env, recipient: string, id: string, now: string): Promise<boolean>` dan `markAllRead(env: Env, recipient: string, now: string): Promise<number>`
  - `purgeOldNotifications(env: Env): Promise<number>` (lebih tua dari `NOTIFICATION_RETENTION_DAYS`, menurut `nowOf(env)`).

- [ ] **Step 1: Tulis tes `repo.test.ts`** (`createTestEnv`): urutan daftar terbaru dulu; kursor menghasilkan halaman berikutnya tanpa tumpang tindih; `locationIds` memfilter dan kosong = `[]`; `countUnread` memakai filter lokasi yang sama; `markRead` pada id milik orang lain mengembalikan `false` dan tidak mengubah apa pun; `markAllRead` hanya milik pemanggil; `purgeOldNotifications` membuang baris berumur 91 hari dan menyisakan 89 hari (jam `env.NOW`).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/notification/repo` → FAIL.
- [ ] **Step 3: Tulis migrasi** `0011_notifikasi.sql` (tiga tabel di atas, `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin`, `IF NOT EXISTS`) dan implementasi repo mengikuti pola `server/src/modules/postel/repo.ts`.
- [ ] **Step 4: Jalankan tes** → PASS (templat tes memperbarui diri dari hash migrasi).
- [ ] **Step 5: Commit** `feat(server): tabel dan repo notifikasi`.

---

### Task 3: Penentuan penerima

**Files:**
- Create: `server/src/modules/notification/recipients.ts`, `server/src/modules/notification/recipients.test.ts`

**Interfaces:**
- Consumes: `NotificationSide` (Task 1); `loadUserContext` (`server/src/modules/access/context.ts`, satu definisi hak akses; JANGAN menulis ulang perhitungan izin); `seedHandoverEnv`/`ENV` (`server/test-support/handover-env.ts`).
- Produces:
  - `interface Recipient { email: string; name: string }`
  - `resolveRecipients(env: Env, input: { locationId: string; side: NotificationSide; excludeEmail: string }): Promise<Recipient[]>`: membaca email semua user `status = 'active'` dari tabel `users`, memuat `UserContext` tiap user (`Promise.all`), menyaring menurut `user.locations[locationId]` (`qc >= edit`, atau `handover >= view`, atau salah satunya untuk `all`), membuang `excludeEmail` (dinormalisasi), dan menghapus duplikat email. Admin super yang tidak terdaftar di `users` tidak ikut (pilihan perancang).
  - `hasReadAccess(user: Pick<UserContext, 'locations'>, locationId: string): boolean`: `handover >= view` atau `qc >= edit` di lokasi itu (dipakai Task 6 dan 7).

- [ ] **Step 1: Tulis tes** (`seedHandoverEnv`): sisi `qc` di `loc-a` = `qc@` saja; sisi `wh` = `wh@`, `whedit@`, `viewer@`, `multi@` (tidak `noaccess@`, tidak `qc@`); `all` = gabungan tanpa duplikat; user yang punya peran `handover` **dan** `qc` di `loc-a` muncul **sekali** pada `all`; `excludeEmail` dengan huruf besar tetap mengecualikan; user `inactive` tidak ikut; `locOff` (lokasi nonaktif) menghasilkan `[]`; `hasReadAccess` benar untuk `viewer@`, `qc@`, salah untuk `noaccess@` dan untuk lokasi lain.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/notification/recipients` → FAIL.
- [ ] **Step 3: Implementasi** kedua fungsi.
- [ ] **Step 4: Jalankan tes** → PASS.
- [ ] **Step 5: Commit** `feat(server): penentuan penerima notifikasi menurut izin lokasi`.

---

### Task 4: Pembuat notifikasi di jalur tulis Serah Terima

**Files:**
- Create: `server/src/modules/notification/emit.ts`, `server/src/modules/notification/emit.test.ts`
- Modify: `server/src/modules/handover/service.ts` (`createTasks`, `saveHandover`, `writeTaskChange`, `addComment`; ekspor `progressOf`)

**Interfaces:**
- Consumes: `handoverEventsOf`, `NOTIFICATION_SIDE` (Task 1); `insertNotificationStmts` (Task 2); `resolveRecipients` (Task 3); `HandoverRecord` (`handover/repo.ts`); `deriveHandoverStatus` (`shared/handover.ts`).
- Produces:
  - `interface HandoverChange { action: HandoverAction; actor: ActorRef; now: string; before: HandoverRecord | null; after: HandoverRecord; customerName: string; commentBody?: string; toggledItem?: { text: string; occurrence: number } }`
  - `planNotifications(env: Env, change: HandoverChange): Promise<DbStatement[]>`: menghitung kejadian lewat `handoverEventsOf` (status turunan sebelum dan sesudah), menyelesaikan penerima, dan mengembalikan pernyataan `INSERT` notifikasi. Untuk kejadian `checked` mengembalikan pernyataan tabel tunggu (Task 5), bukan baris notifikasi. Untuk `done` menyertakan pernyataan yang membuang tabel tunggu task itu (Task 5).
  - `planCreateNotifications(env: Env, input: { records: readonly HandoverRecord[]; actor: ActorRef; now: string }): Promise<DbStatement[]>`: satu task → `created`; dua task atau lebih → SATU `createdBatch` per penerima (`count` = jumlah task, `handoverId` dan `number` kosong).
  - Nama pelaku untuk tampilan: `users.name` bila ada, selain itu email (satu kueri).

- [ ] **Step 1: Tulis tes integrasi `emit.test.ts`** lewat `seedHandoverEnv` dan `callRest` (tabel spek §3): `handovers.save` baru oleh `wh@` → baris `created` untuk `qc@`, tidak untuk `wh@`; `save` dengan catatan berubah → `updated` ke QC; `save` identik → nol baris baru; `cancel` → `cancelled` ke QC; `reopen` → `reopened` ke QC; `setDone` oleh `qc@` → `done` ke `wh@`, `whedit@`, `viewer@`, `multi@`; `comment` oleh `qc@` → `commented` ke semua kecuali `qc@`; `comment` oleh `wh@` → tidak ke `wh@`. **Review Focus 1:** `setCheck` dengan nilai sama dua kali berturut-turut → jumlah baris notifikasi dan tunggu tidak bertambah pada pengiriman kedua. **Review Focus 5:** `saveBatch` 30 task → tepat satu baris `createdBatch` per penerima QC dengan `count = 30`; `saveBatch` 1 task → `created`. Atomik: `cancel` pada task Selesai (galat `CONFLICT`) → nol baris notifikasi; `save` basi (412) → nol baris. Suntingan catatan yang membuang butir terakhir yang belum dicentang sehingga task `done` → `updated` ke QC DAN `done` ke WH.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/notification/emit` → FAIL.
- [ ] **Step 3: Implementasi `emit.ts`** dan sambungkan ke `service.ts`: panggil `planNotifications`/`planCreateNotifications` di dalam closure `runCas` SESUDAH semua early return idempoten dan pernyataannya digabung ke `env.DB.batch([...])` yang sama (di `addComment`, ditaruh setelah `writeAudit`). `writeTaskChange` menerima argumen tambahan `event: HandoverAction` (dan `toggledItem` untuk centang) dari pemanggilnya; ekspor `progressOf` bila perlu. Jangan mengubah urutan penjaga CAS yang ada.
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/handover src/modules/notification` → PASS (tes Serah Terima yang ada tidak boleh berubah).
- [ ] **Step 5: Commit** `feat(server): kejadian Serah Terima menghasilkan notifikasi atomik`.

---

### Task 5: Penggabungan centang dan putaran latar

**Files:**
- Create: `server/src/modules/notification/flush.ts`, `server/src/modules/notification/flush.test.ts`
- Modify: `server/src/modules/notification/emit.ts` (pernyataan tabel tunggu), `server/src/jobs/runner.ts` (`startNotificationLoop`, ekspor `startLoop` bila perlu, `purgeOldNotifications` di `schedulerTick`), `server/src/server.ts` (daftarkan penghenti)

**Interfaces:**
- Consumes: tabel `notification_pending`, `notification_pending_items` (Task 2); `resolveRecipients` (Task 3).
- Produces:
  - Dari `planNotifications` untuk `checked`: `INSERT ... ON DUPLICATE KEY UPDATE` yang membuat baris tunggu `(handover_id, actor_email)` dengan `first_at = now` dan `release_at = now + CHECK_WINDOW_MS` TANPA mengubahnya pada centang berikutnya (jendela tetap sejak centang pertama), serta `INSERT ... ON DUPLICATE KEY UPDATE parity = 1 - parity` untuk butir yang dicentang atau dilepas.
  - `flushDueCheckSummaries(env: Env): Promise<number>`: untuk tiap baris tunggu yang `release_at <= nowIso(env)`: klaim atomik (`DELETE ... WHERE` dengan periksa `meta.changes`, pola `claimStep`), hitung N = butir `parity = 1` yang teks kanoniknya masih ada di checklist catatan task sekarang, bila `N > 0` selesaikan penerima sisi `wh` (kecuali pelaku) dan tulis satu baris `checked` per penerima dengan `count = N`; kembalikan jumlah ringkasan yang terkirim.
  - `startNotificationLoop(env: Env, options?: { intervalMs?: number }): () => Promise<void>` (bawaan 30 detik; menjalankan `flushDueCheckSummaries`, dan `deliverPendingPushes` setelah Task 7), terpisah dari antrean job sehingga job panjang (cadangan) tidak menundanya.
  - `schedulerTick` juga memanggil `purgeOldNotifications`.

- [ ] **Step 1: Tulis tes `flush.test.ts`** (jam `env.NOW`): 10 centang berbeda oleh `qc@` dalam 3 menit lalu flush pada menit 5 → satu baris `checked` `count = 10` per penerima WH (flush pada menit 4:59 → nol); centang ke-2 pada menit 3 tidak memundurkan `release_at` (jendela tetap sejak yang pertama). **Review Focus 4:** centang lalu lepas butir yang sama → flush menghasilkan nol baris; centang butir terakhir sehingga task selesai → tepat satu `done` ke WH, dan baris tunggu serta butirnya hilang (tidak ada `checked` menyusul), termasuk baris tunggu milik pelaku lain; dua pelaku berbeda → dua baris `checked` terpisah (kunci `(task, pelaku)`); `cancel` saat tunggu → ringkasan tetap terkirim; butir yang dihapus dari catatan sebelum flush tidak dihitung; `Promise.all([flush, flush])` → hasil sama dengan satu flush (tidak ada ringkasan ganda); `schedulerTick` membuang notifikasi berumur > 90 hari.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/notification/flush` → FAIL.
- [ ] **Step 3: Implementasi** pernyataan tunggu, `flushDueCheckSummaries`, dan `startNotificationLoop`; sambungkan penghentinya di `createServer` (`stops`, hanya bila `background !== false`).
- [ ] **Step 4: Jalankan** `bun run --cwd server test src/modules/notification src/jobs` → PASS.
- [ ] **Step 5: Commit** `feat(server): penggabungan centang 5 menit dan putaran latar notifikasi`.

---

### Task 6: Rute lonceng (REST)

**Files:**
- Create: `server/src/modules/notification/{validate,service,routes}.ts`, `server/src/modules/notification/rest.test.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/routes.ts`

**Interfaces:**
- Consumes: `listNotifications`, `countUnread`, `markRead`, `markAllRead` (Task 2); `hasReadAccess` (Task 3).
- Produces:
  - `'notifications.list'`: `GET /notifications` query `limit` (bawaan 30, maks 100) dan `before` → `{ items: NotificationDto[]; unread: number; nextCursor: string | null }`.
  - `'notifications.markRead'`: `POST /notifications/{id}/read` → `{ ok: true }`; id milik orang lain atau tak ada → `NOT_FOUND`.
  - `'notifications.markAllRead'`: `POST /notifications/read-all` → `{ count: number }`.
  - Tanpa `permission` modul (hanya sesi, seperti `auth.me`); lokasi yang boleh dibaca dihitung dari `ctx.user.locations` lewat `hasReadAccess` pada SETIAP baca (Review Focus 3): lokasi tanpa hak atau nonaktif tidak ikut daftar maupun hitungan belum dibaca.

- [ ] **Step 1: Tulis tes `rest.test.ts`**: pengguna hanya melihat miliknya; pengguna yang kehilangan izin lokasi (ubah penugasan lalu panggil lagi) tidak melihat notifikasi lokasi itu dan `unread` turun; lokasi dinonaktifkan → tersembunyi; `markRead` id orang lain → `NOT_FOUND`; `markAllRead` hanya baris pemanggil; tanpa sesi → 401; `limit` di atas 100 dibatasi; id kontrak terdaftar (`shared/api.test.ts` hijau).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/notification/rest` → FAIL.
- [ ] **Step 3: Implementasi** kontrak, tabel rute, validator, servis, dan `ALL_API_IDS`/`getRoutes()`.
- [ ] **Step 4: Jalankan** `bun run --cwd shared test` dan tes modul → PASS.
- [ ] **Step 5: Commit** `feat(server): rute REST lonceng notifikasi`.

---

### Task 7: Backend push siap pakai

**Files:**
- Create: `server/migrations/0012_push_notifikasi.sql`, `server/src/modules/notification/push.ts` (pengirim dan putaran kirim), `server/src/modules/notification/push-routes.ts` (atau digabung `routes.ts`), `server/src/modules/notification/web-push.ts` (pengirim nyata), `server/test-support/fake-push.ts`, `server/src/modules/notification/push.test.ts`, `server/src/modules/notification/push-rest.test.ts`
- Modify: `server/src/core/env.ts` (`PUSH?: PushSender`), `server/src/config.ts`, `server/src/server.ts` (`envFromConfig` memasang `PUSH`), `deploy/compose.yml`, `deploy/.env.example`, `shared/contract.ts`, `shared/api.ts`, `server/src/routes.ts`, `server/src/http/body.test.ts`, `server/package.json` (bila memakai `web-push`)

**Interfaces:**
- Consumes: `pushPayloadOf` (Task 1); tabel `notifications.push_state` (Task 2); `hasReadAccess`, `loadUserContext` (Task 3).
- Produces:
  - Tabel `push_subscriptions(endpoint_hash CHAR(64), recipient, endpoint TEXT, p256dh, auth, created_at, last_ok_at, last_error_at, last_error, fail_count)` kunci `(endpoint_hash, recipient)` (satu langganan boleh milik beberapa pengguna di perangkat yang sama); tabel `notification_prefs(recipient, push_enabled TINYINT bawaan 1, permission VARCHAR(12) bawaan 'default', updated_at)`.
  - `interface PushSender { send(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<{ ok: true } | { ok: false; gone: boolean; error: string }> }`; `createWebPushSender(config: { publicKey: string; privateKey: string; subject: string }): PushSender`; variabel `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` opsional (`config.vapid: null | {...}`).
  - `deliverPendingPushes(env: Env): Promise<number>`: untuk tiap `notifications.push_state = 'pending'`: bila `env.PUSH` tak ada atau umur > 10 menit → `skipped`; **saat kirim** periksa akun masih aktif dan `hasReadAccess` pada lokasinya (Review Focus 3), preferensi `push_enabled`, dan ada langganan, jika tidak → `skipped`; kirim ke semua langganan penerima; `gone` (404/410) → hapus langganan; minimal satu sukses → `sent` dan `last_ok_at`; semua gagal → `failed` dan `fail_count + 1`. Muatan dari `pushPayloadOf`. Dipanggil `startNotificationLoop` (Task 5).
  - Rute: `'push.config'` `GET /push/config` → `{ enabled: boolean; publicKey: string }`; `'push.subscribe'` `POST /push/subscriptions` body `{ endpoint, p256dh, auth }`; `'push.unsubscribe'` `POST /push/unsubscribe` body `{ endpoint }`; `'push.setPreference'` `PUT /push/preference` body `{ enabled: boolean }`; `'push.reportPermission'` `PUT /push/permission` body `{ state: 'granted' | 'denied' | 'default' }`; `'push.status'` `GET /push/status` dengan `permission: { module: 'access', level: 'view' }` → `Array<{ email: string; name: string; state: 'active' | 'none' | 'failing' | 'disabled' | 'denied' }>` (per pengguna, tanpa pengenal perangkat atau galat).

- [ ] **Step 1: Spike pengirim.** Tambahkan `web-push` (versi dipin yang sudah berumur ≥ 2 minggu) dan buktikan di bawah Bun bahwa `createWebPushSender` mengirim ke server push palsu lokal dengan muatan terenkripsi yang dapat didekripsi tes. Bila `web-push` tidak jalan di Bun, tulis enkripsi RFC 8291 dengan WebCrypto; catat pilihan di komentar berkas.
- [ ] **Step 2: Tulis tes `push.test.ts`** dengan `fake-push.ts` (merekam pengiriman, dapat diatur sukses, gagal, atau `gone`): terkirim ke semua langganan penerima; `gone` menghapus langganan; semua gagal → `failed`; **Review Focus 3:** akun dinonaktifkan atau izin lokasi dicabut sebelum kirim → `skipped` dan nol pengiriman; preferensi dimatikan → `skipped`; tanpa langganan → `skipped`; isi muatan tidak memuat `preview` (teks komentar atau catatan); dua akun berbagi satu `endpoint` masing-masing menerima notifikasinya sendiri.
- [ ] **Step 3: Tulis tes `push-rest.test.ts`**: subscribe idempoten (dua kali = satu baris), unsubscribe, preferensi, laporan izin; `push.status` menghitung `active`/`none`/`failing`/`disabled`/`denied` dengan benar dan hanya untuk pengguna `access: view`; endpoint non-https ditolak `VALIDATION`; tambahkan ketiga rute bermuatan ke `http/body.test.ts`.
- [ ] **Step 4: Implementasi** migrasi, `PushSender`, `deliverPendingPushes`, rute, konfigurasi (`config.ts` + `compose.yml` + `.env.example`; `deploy-files.test.ts` hijau), dan sambungkan `envFromConfig`.
- [ ] **Step 5: Jalankan** `bun run --cwd server test src/modules/notification src/deploy-files` → PASS.
- [ ] **Step 6: Commit** `feat(server): backend push notifikasi (langganan, preferensi, pengirim)`.

---

### Task 8: Lonceng di aplikasi web

**Files:**
- Create: `web/src/modules/notification/queries.ts`, `web/src/modules/notification/notification-bell.tsx`, `web/src/modules/notification/notification-bell.test.tsx`
- Modify: `web/src/app/shell/app-shell.tsx`

**Interfaces:**
- Consumes: `notifications.list`, `notifications.markRead`, `notifications.markAllRead` (Task 6); `notificationTitle`, `NotificationDto` (Task 1); `api(id, input)` (`web/src/lib/api`).
- Produces: `notificationsQueryOptions()` (`refetchInterval` 60 dtk dan `refetchOnWindowFocus`), `useMarkRead()`, `useMarkAllRead()`, komponen `NotificationBell` yang ditaruh di header antara `LocationPicker` dan `ThemeToggle`.

- [ ] **Step 1: Tulis tes `notification-bell.test.tsx`** (vitest + testing-library, pola tes web yang ada): menampilkan jumlah belum dibaca pada ikon (sembunyi bila 0, "99+" bila lebih); daftar memakai `notificationTitle` dan nama customer; klik butir menandainya dibaca lalu menavigasi ke `/handover/<id>` (atau `/handover` bila `handoverId` kosong); "Tandai semua dibaca" memanggil rute dan mengosongkan penanda; keadaan kosong menampilkan teks Indonesia; kunci query notifikasi TIDAK ada di whitelist `query-persist`.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/notification` → FAIL.
- [ ] **Step 3: Implementasi** query, mutasi dengan pemasangan hasil ke cache (`web/src/lib/query-cache.ts`), komponen popover (shadcn yang sudah ada), dan sisipan di `app-shell.tsx`.
- [ ] **Step 4: Jalankan** tes web penuh `bun run --cwd web test` → PASS.
- [ ] **Step 5: Commit** `feat(web): lonceng notifikasi di header`.

---

### Task 9: Dokumen dan pemeriksaan akhir

**Files:**
- Modify: `CLAUDE.md` (butir modul `notification` di "Struktur", aturan: kejadian dihitung di jalur tulis dan digabung ke `batch()`, putaran latar terpisah dari antrean job, kunci penerima = email, variabel VAPID dan catatan "isi manual di VPS sebelum push yang men-deploy"), `docs/e2e-checklist.md` (bagian notifikasi)

- [ ] **Step 1: Tulis pembaruan dokumen.** Daftar E2E manual di staging: tiap baris matriks spek §3 dicoba dengan dua akun (WH dan QC); satu rangkaian centang menghasilkan satu ringkasan ≤ 5 menit; centang butir terakhir menghasilkan satu "selesai"; pencabutan akses menghilangkan notifikasi dari lonceng; push diuji setelah tahap service worker.
- [ ] **Step 2: Jalankan** `bun run check` (tunnel hidup) → hijau, dan `bun run build` → lolos `verify-dist`.
- [ ] **Step 3: Commit** `docs: notifikasi Serah Terima di CLAUDE.md dan daftar E2E`.

---

## Self-Review

- **Cakupan spek:** §3 matriks → Task 3-4; §4.1-4.4 → Task 1, 4, 5; §5.1 → Task 6, 8; §5.2 sisi server (langganan, preferensi, status, pengiriman, pemeriksaan saat kirim, logout tidak menghentikan push) → Task 7, sedangkan izin peramban, banner, dan halaman admin menunggu Fase 1 PRD PWA (dinyatakan di Global Constraints); §6 → `pushPayloadOf` Task 1 dan 7; §7 → Global Constraints; §8 → daftar E2E Task 9.
- **Konsistensi tipe:** `NotificationDto`, `NewNotification`, `HandoverChange`, `Recipient`, `PushSender` dipakai dengan nama sama di semua task; `planNotifications` (Task 4) memakai pernyataan tabel tunggu yang didefinisikan di Task 5, dan `deliverPendingPushes` (Task 7) dipanggil dari `startNotificationLoop` (Task 5).
- **Proporsi:** rencana hanya memuat tanda tangan, nilai spek, dan nama tes; badan fungsi diserahkan ke pelaksana.
