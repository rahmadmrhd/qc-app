# PWA Fase 3 Tahap D: Background Sync (`sync-sw.js`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Di Chrome/Edge, antrean tulis offline (centang, komentar, task baru) terkirim sendiri oleh service worker begitu sinyal kembali, walau aplikasi sudah ditutup; peramban tanpa `SyncManager` tetap dilayani penguras halaman.

**Architecture:** Skrip klasik `web/public/sync-sw.js` (pola `push-sw.js`, diimpor lewat `workbox.importScripts`, tidak dipra-cache) memasang pendengar `sync` untuk tag `qc-outbox`. Skrip membaca toko `outbox` di IndexedDB `qc-device` yang sudah ada (Tahap C), mengambil kunci Web Locks `qc-outbox-flush` bersama penguras halaman, memverifikasi pemilik sesi lewat `GET /api/v1/me`, lalu mengirim entri berurutan dengan klasifikasi galat yang sama dengan penguras halaman. Penolakan dan kedaluwarsa hanya DITANDAI `rejected` (tanpa tab terbuka toast tak bisa tampil); penguras halaman berikutnya mengumumkan dan membuangnya. Halaman mendaftarkan `registration.sync.register('qc-outbox')` setelah entri tertulis. Server tidak berubah.

**Tech Stack:** Skrip service worker klasik (JS biasa), IndexedDB mentah, Web Locks, BroadcastChannel, Workbox `generateSW` (`vite-plugin-pwa`), vitest + `fake-indexeddb` 6.2.7 (sudah ada), `vm`-style `new Function('self', SOURCE)`.

**Spec:** `docs/superpowers/specs/2026-11-13-pwa-offline-serah-terima-design.md` (§3 cara memasukkan kode ke SW, §5 `sending`, §7.2, §7b, §8, §9 R4 dan butir Tahap C). PRD: `docs/prd/2026-10-26-qc-pwa.md`. Tahap A, B, C sudah di `dev` (PR #70, #73, #76).

## Global Constraints

- Teks UI bahasa Indonesia santai; "Serah Terima" ditulis lengkap pada judul.
- Tanpa perubahan server, migrasi, atau variabel `.env`. Server sudah menyajikan semua berkas selain `/assets/` dengan `no-cache` (`server/src/http/static.ts`), jadi `sync-sw.js` ikut tanpa perubahan.
- Service worker TIDAK boleh men-cache atau menjawab `/api`, `/auth`, `/sync` dan tak menyimpan respons API (FR-P8, NFR-P3). `sync-sw.js` hanya MENGIRIM dan hanya ke origin sendiri; tanpa `injectManifest` (konfigurasi Fase 1 tidak berubah selain daftar `importScripts`/`globIgnores`).
- `sync-sw.js` skrip klasik: hanya memakai `self.*` (`self.indexedDB`, `self.fetch`, `self.navigator.locks`, `self.BroadcastChannel`, `self.clients`, `self.registration`), tanpa `import`/`export`, supaya dapat dimuat tes lewat `new Function('self', SOURCE)(fakeSelf)` seperti `web/src/modules/push/push-sw.test.ts`.
- Tanpa dependensi baru. Anggaran chunk dan pra-cache (≤ 5 MB, tiap potongan JS ≤ 600 KB gzip) tidak berubah.
- Konstanta yang dipakai di dua tempat dan HARUS sama (dijaga tes kesetaraan, Tugas 4): DB `qc-device`, toko `outbox`, `RECORD_VERSION` 1, jenis `check|comment|create`, umur maks. 24 jam, skew masa depan 5 menit, batas kirim 30 dtk, kunci `qc-outbox-flush`, saluran `qc-outbox`, masa berlaku `sending` 45 dtk, `ERROR_CODES`, `API_BASE` `/api/v1`, header `X-Requested-With: qc` untuk verba selain GET, jalur dan badan tiga rute.
- Klasifikasi galat (sama dengan penguras halaman): fetch gagal/abort, 429, 503 = `UNAVAILABLE`; problem+json ber-`code` valid = kode itu (412 = `CONFLICT`); 401 polos `UNAUTHENTICATED`; 403 `FORBIDDEN`; 413 `VALIDATION`; selain itu `INTERNAL`. `UNAVAILABLE`/`INTERNAL` menahan dan menghentikan putaran; `UNAUTHENTICATED` menahan tanpa mengulang; `CONFLICT`/`FORBIDDEN`/`NOT_FOUND`/`VALIDATION` = penolakan.
- Perintah verifikasi web: `bun run --cwd web test <jalur>`, `bun run --cwd web typecheck`, `bunx biome check <berkas>`; `bun run build` lalu `bun run scripts/verify-dist.ts` untuk keluaran. Tes server tidak perlu (server tak berubah), jadi terowongan DB tidak dibutuhkan; `bun run check` penuh tetap dijalankan sebelum push bila terowongan tersedia, atau tes web + typecheck + Biome + build bila tidak (catat mana yang dipakai).
- Jangan menghentikan atau memulai ulang server dev (memori proyek).

## Rulings awal (dari perancang; mohon dikoreksi pemilik)

- D1. `state?: 'rejected'` dan `reason?: string` berada di ENTRI (bukan di rekaman), sesuai spek §7.2; ditambahkan sebagai field opsional pada ketiga jenis. `RECORD_VERSION` tidak naik: bundel lama mengabaikan field itu dan akan mengirim ulang entri tersebut, server menolaknya lagi, dan toast lama tampil (hasil akhir sama).
- D2. `readOutbox(owner)` (dipakai tampilan) menyembunyikan entri `rejected`; `readOutboxAll(owner)` menyertakannya (untuk pemicu penguras). `countAllOutboxEntries` dan peringatan keluar tidak menghitungnya (sudah ditolak, tinggal diumumkan). Entri `rejected` tetap memakai tempat di batas 50/200 sampai diumumkan.
- D3. SW menandai entri kedaluwarsa (> 24 jam atau > 5 menit di masa depan) sebagai `rejected` dengan alasan "Kedaluwarsa: lebih dari 24 jam sejak dibuat" (spek §7b butir 3, semua jenis). Penguras halaman mengumumkannya sebagai penolakan biasa.
- D4. Hanya entri milik pemilik sesi (`/api/v1/me`, email dibandingkan persis dengan `owner`) yang dikirim. `/me` gagal jaringan/5xx/429/503 = lempar galat (peramban menjadwalkan ulang); 401 atau 4xx lain, atau email beda = selesai tanpa mengirim dan TANPA ulang.
- D5. Tanpa `navigator.locks` SW tidak mengirim apa pun (tanpa melempar): kunci bersama adalah pengaman utama terhadap kirim ganda; jalur halaman tetap berjalan.
- D6. SW menyiarkan `sending`/`sending-done` hanya untuk entri `comment` dan `create` (centang memakai penanda per tab, tidak disiarkan; sama dengan `markSending` penguras halaman), dan `changed` setiap toko diubah.
- D7. SW memberi tahu jendela terbuka lewat `postMessage({ type: 'qc-outbox-synced', taskIds, created, rejected })`; halaman menanggapinya dengan menandai query Serah Terima basi, membaca ulang toko, dan memicu penguras (yang mengumumkan entri `rejected`).
- D8. Pendaftaran sync juga diulang oleh halaman saat penguras berhenti `unavailable`/`server-error` dengan entri tersisa (menutup antrean lama yang pendaftarannya tak pernah ada atau sudah dipakai habis). Tag yang sama digabung peramban.
- D9. Pendaftaran tidak pernah ditunggu pemanggil: `navigator.serviceWorker.ready` bisa tak pernah selesai (dev, SW belum aktif); semua galat ditelan.
- D10. Pengait uji `self.__qcSyncTest?.({ constants })` di akhir skrip hanya untuk tes kesetaraan konstanta; tidak berefek di produksi.

## Review Focus

1. Entri `rejected` diumumkan TEPAT sekali dan tidak pernah dikirim ulang oleh halaman maupun SW (Tugas 2 dan 3).
2. Entri yang ditandai `rejected` lalu tertimpa centang baru task+indeks sama: penggantian diam-diam diterima (aksi baru pengguna menggantikan yang lama), tetapi komentar/task baru `rejected` tidak pernah tertimpa (Tugas 1).
3. Akun lain login di perangkat sama sebelum antrean pemilik pertama dibuang: SW tidak mengirim (Tugas 3).
4. IndexedDB belum ada, toko `outbox` tak ada, rekaman versi lebih baru atau rusak: tidak galat, tidak menghapus apa pun (Tugas 3).
5. Keluar (logout) sesudah sync didaftarkan: toko kosong atau `/me` 401, tidak ada yang terkirim (Tugas 3).
6. SW dan penguras halaman berjalan bersamaan: kunci bersama + `clientId` mencegah duplikat (Tugas 4).

## File Structure

- Create `web/public/sync-sw.js` — skrip SW (Tugas 3).
- Create `web/src/modules/handover/lib/sync-sw.test.ts` — tes SW di `new Function` dengan `self` palsu + `fake-indexeddb` (Tugas 3).
- Create `web/src/modules/handover/lib/outbox-parity.test.ts` — tes kesetaraan SW ↔ halaman (Tugas 4).
- Create `web/src/app/pwa/background-sync.ts` + `.test.ts` — pendaftaran sync dari halaman (Tugas 6).
- Create `web/src/app/outbox-sw-bridge.ts` + `.test.ts` — penerima pesan SW di halaman (Tugas 6).
- Modify `web/src/lib/device-db.ts`, `web/src/modules/handover/lib/{outbox.ts,outbox-channel.ts,outbox-flush.ts,use-outbox-summary.ts,use-pending-checks.ts,use-pending-creates.ts}`, `web/src/app/outbox-sync.ts` (Tugas 1, 2, 6).
- Modify `web/src/app/pwa/pwa-config.ts` + `pwa-config.test.ts`, `scripts/verify-dist.ts` + `scripts/verify-dist.test.ts` (Tugas 5).
- Modify docs: spek §9/§10, PRD §11 + FR-P, `CLAUDE.md`, `docs/e2e-checklist.md` (Tugas 7).

---

### Task 1: Bentuk `state` pada entri dan ekspor konstanta bersama

**Model:** Sonnet (menyentuh antrean yang sensitif data).

**Files:**
- Modify: `web/src/lib/device-db.ts` (ekspor `DEVICE_DB_NAME`, `DEVICE_DB_VERSION`), `web/src/modules/handover/lib/outbox.ts`, `web/src/modules/handover/lib/outbox-channel.ts` (ekspor `OUTBOX_CHANNEL_NAME`), `web/src/app/outbox-sync.ts` (ekspor `OUTBOX_FLUSH_LOCK`)
- Test: `web/src/modules/handover/lib/outbox.test.ts` (tambahkan)

**Interfaces:**
- Produces (outbox.ts): field opsional `state?: 'rejected'; reason?: string` pada `CheckEntry`, `CommentEntry`, `CreateEntry`; `export const OUTBOX_RECORD_VERSION = 1`; `export const OUTBOX_ENTRY_KINDS = ['check', 'comment', 'create'] as const`; `export function readOutboxAll(owner: string): OutboxEntry[]` (semua entri termasuk `rejected`); `readOutbox(owner)` TANPA entri `rejected`; `countAllOutboxEntries()` tanpa entri `rejected`; `export function setOutboxEnqueuedHandler(handler: (() => void) | null): void` (dipanggil sesudah `enqueueOutbox` mengembalikan `'ok'`, kegagalan handler ditelan).
- Produces (device-db.ts): `export const DEVICE_DB_NAME = 'qc-device'`, `export const DEVICE_DB_VERSION = 2`. outbox-channel.ts: `export const OUTBOX_CHANNEL_NAME = 'qc-outbox'`. outbox-sync.ts: `export const OUTBOX_FLUSH_LOCK = 'qc-outbox-flush'`.
- Consumes: bentuk entri Tahap C (`outbox.ts`).

- [ ] **Step 1: Tulis tes yang gagal** di `outbox.test.ts`: (a) `isOutboxEntry` menerima entri dengan `state: 'rejected', reason: 'x'` dan menolak `state: 'lain'` atau `state: 'rejected'` tanpa `reason` string; (b) rekaman yang berisi entri `rejected` ditaruh di fake-indexeddb → setelah `refreshOutboxFromStore(owner)`: `readOutbox(owner)` TIDAK memuatnya, `readOutboxAll(owner)` memuatnya, `countAllOutboxEntries()` 0, nilai kembalian `refreshOutboxFromStore` memuatnya; (c) `enqueueOutbox` centang task+indeks sama menggantikan entri centang `rejected` yang lama, sedangkan komentar `rejected` tidak tertimpa komentar baru; (d) `setOutboxEnqueuedHandler` dipanggil tepat sekali setelah `'ok'`, tidak dipanggil pada `'full'`/`'failed'`, dan handler yang melempar tidak menggagalkan `enqueueOutbox`.
- [ ] **Step 2: Jalankan tes, pastikan gagal** — `bun run --cwd web test src/modules/handover/lib/outbox.test.ts`; Expected: gagal (fungsi/field belum ada).
- [ ] **Step 3: Implementasi** sesuai Interfaces. `isOutboxEntry`: bila `state` ada harus `'rejected'` dan `reason` string; selain itu entri dianggap rusak (`classifyRecord` → `'broken'`). Salin memori tetap menyimpan semuanya; hanya `readOutbox`/`countAll...` yang menyaring. Ganti literal `RECORD_VERSION`, nama DB, nama saluran, nama kunci dengan konstanta ekspor; tidak ada perubahan perilaku lain.
- [ ] **Step 4: Jalankan tes** — file yang sama, lalu `bun run --cwd web test src/modules/handover src/app` untuk regresi; Expected: PASS. `bun run --cwd web typecheck` bersih.
- [ ] **Step 5: Commit** — `feat(web): bentuk state rejected pada entri antrean dan ekspor konstanta bersama (Tahap D)`.

### Task 2: Penguras halaman mengumumkan entri `rejected`

**Model:** Sonnet.

**Files:**
- Modify: `web/src/modules/handover/lib/outbox-flush.ts`, `web/src/app/outbox-sync.ts`, `web/src/modules/handover/lib/use-outbox-summary.ts` / `use-pending-checks.ts` / `use-pending-creates.ts` bila memakai jalur yang tak lewat `readOutbox`
- Test: `web/src/modules/handover/lib/outbox-flush.test.ts`, `web/src/app/outbox-sync.test.ts`

**Interfaces:**
- Consumes: Tugas 1 (`state`, `reason`, `readOutboxAll`).
- Produces: perilaku — `flushOutbox` tidak pernah memanggil `deps.send` untuk entri `rejected`; entri itu dibuang dari toko (`removeOutboxEntries`) dan masuk `result.rejected` dengan `reason: entry.reason`. `drain()` dan pemicu awal di `startOutboxSync` memakai `readOutboxAll(owner)` untuk memutuskan "ada pekerjaan".

- [ ] **Step 1: Tulis tes yang gagal** — `outbox-flush.test.ts`: toko berisi satu entri komentar `rejected` + satu centang normal → `send` dipanggil hanya untuk centang; `result.rejected` memuat entri komentar dengan `reason` dari entri; entri komentar terhapus dari toko; tidak diumumkan dua kali pada putaran berikutnya; entri `rejected` yang juga kedaluwarsa muncul di `rejected` saja, tidak di `expired`. `outbox-sync.test.ts`: dengan hanya entri `rejected` di toko, `startOutboxSync` tetap memicu penguras (toast penolakan tampil, untuk komentar/task baru dengan "Salin teks" dan bertahan).
- [ ] **Step 2: Jalankan tes, pastikan gagal** — `bun run --cwd web test src/modules/handover/lib/outbox-flush.test.ts src/app/outbox-sync.test.ts`.
- [ ] **Step 3: Implementasi** — di awal tiap iterasi `run()` setelah `refreshOutboxFromStore`: kumpulkan entri `state === 'rejected'` yang belum dicoba, buang sekaligus lewat satu `removeOutboxEntries`, tambahkan ke `result.rejected` (`reason: entry.reason ?? 'Ditolak server'`), tandai `tried`, lanjutkan. Pemilihan `next` mengabaikan entri `rejected`. `outbox-sync.ts`: ganti pemeriksaan `readOutbox(owner).length === 0` (di `drain` dan pemulihan salinan kosong) dengan `readOutboxAll`.
- [ ] **Step 4: Jalankan tes** — dua berkas di atas + `bun run --cwd web test src/modules/handover src/app`; typecheck; `bunx biome check` berkas yang diubah.
- [ ] **Step 5: Commit** — `feat(web): penguras halaman mengumumkan entri rejected dari service worker (Tahap D)`.

### Task 3: `sync-sw.js` dan tesnya

**Model:** Sonnet (logika inti lintas IndexedDB, kunci, jaringan, siaran).

**Files:**
- Create: `web/public/sync-sw.js`
- Test: `web/src/modules/handover/lib/sync-sw.test.ts`

**Interfaces:**
- Consumes: bentuk rekaman toko `outbox` (Tugas 1): `{ key: '<owner>|<id>', owner, v: 1, savedAt, seq, entry }`; entri tiga jenis dengan `state?`/`reason?`.
- Produces: pendengar `self.addEventListener('sync', ...)` untuk tag `qc-outbox` (tag lain diabaikan); perilaku di bawah. Pengait uji `self.__qcSyncTest?.({ constants })` dengan objek konstanta (kunci: `DB_NAME`, `STORE`, `RECORD_VERSION`, `KINDS`, `MAX_AGE_MS`, `MAX_FUTURE_SKEW_MS`, `SEND_TIMEOUT_MS`, `FLUSH_LOCK`, `CHANNEL`, `SENDING_TTL_MS`, `API_BASE`, `ERROR_CODES`, `TAG`).

Perilaku peristiwa `sync` (`event.waitUntil(promise)`):
1. Tanpa `self.navigator.locks`: selesai tanpa kirim (D5). Selain itu `locks.request(FLUSH_LOCK, work)`.
2. `work`: buka `self.indexedDB.open(DB_NAME)` TANPA nomor versi; bila toko `outbox` tak ada, atau IndexedDB tak ada/gagal: tutup dan selesai tanpa menyentuh apa pun. Koneksi menutup diri pada `onversionchange` dan ditutup di akhir.
3. Baca semua rekaman; pertahankan hanya yang `v === RECORD_VERSION`, `entry.kind` dikenal, bentuk entri valid (padanan `isOutboxEntry`), dan BELUM `state: 'rejected'`. Rekaman versi lebih baru, jenis tak dikenal, atau rusak: dibiarkan (tidak dihapus). Tak ada yang tersisa: selesai.
4. Pemilik: `GET /api/v1/me` (`credentials: 'same-origin'`, `Accept: application/json`, batas 30 dtk) → D4.
5. Entri milik pemilik itu diurut `savedAt`, `seq`, `key`; kirim berurutan. Sebelum tiap kirim baca ulang rekamannya (hilang atau sudah `rejected` = lewati). Kedaluwarsa → tandai `rejected` (D3). Kirim: permintaan sesuai jenis (jalur, verba, badan di bawah), `credentials: 'same-origin'`, `cache: 'no-store'`, header `Accept`, `Content-Type: application/json`, `X-Requested-With: qc`, batas 30 dtk lewat `AbortController`.
   - `check`: `PUT /api/v1/handovers/{id}/checks`, badan `{ locationId, index, text, checked }` (`id` = `taskId`, di-`encodeURIComponent`).
   - `comment`: `POST /api/v1/handovers/{id}/comments`, badan `{ locationId, quote, before, after, body, clientId }`.
   - `create`: `POST /api/v1/handovers/batch`, badan `{ locationId, tasks: [{ customerName, note, clientId }] }`.
6. Hasil: sukses (2xx) → hapus rekaman, catat `taskId` (check/comment) atau `created = true`; penolakan → tandai `rejected` dengan `reason` (teks sama dengan `describeError` halaman: `detail ?? title ?? bawaan`, ditambah `": " + nilai unik fields yang beda dari pesan` bila ada; bawaan 403 "Permintaan ditolak", 413 "Badan permintaan terlalu besar"); `UNAVAILABLE`/`INTERNAL` → hentikan putaran dan, SETELAH pemberitahuan di langkah 7, lempar `Error` agar peramban menjadwalkan ulang; `UNAUTHENTICATED` → hentikan putaran, selesai tanpa melempar.
7. Siaran dan pemberitahuan: `BroadcastChannel(CHANNEL)` — `{ type: 'sending', ids: [entry.id], until: Date.now() + SENDING_TTL_MS }` sebelum dan `{ type: 'sending-done', ids }` sesudah tiap kirim `comment`/`create` (D6); `{ type: 'changed' }` setelah tiap hapus/tandai. Bila ada yang terkirim atau ditolak: `clients.matchAll({ type: 'window', includeUncontrolled: true })` lalu `postMessage({ type: 'qc-outbox-synced', taskIds, created, rejected })` ke tiap jendela (D7). Semua panggilan siaran dan postMessage ditelan galatnya.

- [ ] **Step 1: Tulis tes yang gagal** di `sync-sw.test.ts`. Pembantu: muat skrip via `new Function('self', SOURCE)(fakeSelf)`; `fakeSelf` membawa `indexedDB` (fake-indexeddb), `fetch` (`vi.fn`), `navigator.locks` (`request: (name, cb) => cb()` yang mencatat nama), `BroadcastChannel` palsu yang mencatat pesan, `clients.matchAll`, `setTimeout`/`AbortController` asli. Benih toko lewat `putOutboxRecord` dari `device-db` dengan rekaman bentuk Tugas 1. Tes (nama persis): `sync dengan tag lain diabaikan`; `tanpa navigator.locks tidak mengirim apa pun`; `IndexedDB tidak ada atau toko outbox tak ada: selesai tanpa galat dan tanpa menghapus`; `rekaman versi lebih baru dan jenis tak dikenal dibiarkan`; `/me beda email: tidak mengirim, entri tetap`; `/me 401: tidak mengirim dan tidak melempar`; `/me gagal jaringan atau 503: melempar agar dijadwalkan ulang`; `ketiga jenis dikirim berurutan menurut savedAt lalu seq dengan jalur, verba, header, dan badan yang benar`; `sukses menghapus rekaman dan menyiarkan changed, sending, sending-done (check tanpa sending)`; `penolakan menandai rejected dengan reason dan TIDAK menghapus`; `kedaluwarsa menandai rejected`; `UNAVAILABLE dan INTERNAL menghentikan putaran, entri tetap, melempar setelah pemberitahuan`; `UNAUTHENTICATED menghentikan tanpa melempar`; `batas 30 dtk memetakan ke UNAVAILABLE (timer palsu)`; `jendela terbuka menerima qc-outbox-synced dengan taskIds, created, rejected`; `entri pemilik lain tidak disentuh`; `entri rejected tidak dikirim lagi`; `rekaman yang dihapus halaman di tengah putaran dilewati`.
- [ ] **Step 2: Jalankan tes, pastikan gagal** — `bun run --cwd web test src/modules/handover/lib/sync-sw.test.ts`; Expected: gagal (berkas belum ada).
- [ ] **Step 3: Implementasi `web/public/sync-sw.js`** sesuai perilaku di atas, dalam satu IIFE seperti `push-sw.js`; komentar kepala memuat rujukan spek §7b, tes, dan alasan duplikasi logika. Fungsi kecil bernama: `openDb`, `readRecords`, `sendEntry(entry)` (mengembalikan `{ kind: 'ok' | 'rejected' | 'hold' | 'unauth', reason? }`), `errorFromResponse(status, text)`, `describe(error)`, `markRejected(db, key, reason)`, `deleteRecord(db, key)`, `notifyClients(summary)`.
- [ ] **Step 4: Jalankan tes** — berkas di atas, lalu `bun run --cwd web test src/modules/handover src/modules/push`; Expected: PASS. `bunx biome check web/public/sync-sw.js web/src/modules/handover/lib/sync-sw.test.ts` (perhatikan: Biome memformat skrip klasik; ikuti konfigurasi yang sudah dipakai `push-sw.js`).
- [ ] **Step 5: Commit** — `feat(web): sync-sw.js mengirim antrean lewat Background Sync (Tahap D)`.

### Task 4: Tes kesetaraan halaman ↔ service worker

**Model:** Sonnet.

**Files:**
- Test: `web/src/modules/handover/lib/outbox-parity.test.ts` (baru; tanpa mengubah kode produksi kecuali tes menemukan selisih)

**Interfaces:**
- Consumes: Tugas 1 (ekspor konstanta), Tugas 2 (`flushOutbox`, `sendOutboxEntry`), Tugas 3 (`sync-sw.js` dan pengait `__qcSyncTest`).
- Produces: satu tabel skenario `SCENARIOS` dalam berkas tes: `{ name, respond: Response | 'network-error' | 'abort', kinds, expectEntry: 'removed' | 'rejected' | 'unchanged', expectReason?: string, swThrows: boolean }`.

- [ ] **Step 1: Tulis tes** — (a) `konstanta sama`: muat `sync-sw.js`, tangkap `constants` lewat pengait, bandingkan dengan `DEVICE_DB_NAME`, `OUTBOX_RECORD_VERSION`, `OUTBOX_ENTRY_KINDS`, `OUTBOX_MAX_AGE_MS`, `OUTBOX_MAX_FUTURE_SKEW_MS`, `OUTBOX_SEND_TIMEOUT_MS`, `OUTBOX_FLUSH_LOCK`, `OUTBOX_CHANNEL_NAME`, `SENDING_TTL_MS`, `ERROR_CODES` (`@shared/contract`), `API_BASE`; (b) `permintaan sama`: untuk tiap jenis, panggilan `fetch` dari `sendOutboxEntry` (halaman) dan dari SW identik pada URL, verba, header (`X-Requested-With`, `Content-Type`, `Accept`), dan badan JSON; (c) tabel `SCENARIOS` (untuk tiap jenis entri): sukses 200/201, problem+json `CONFLICT` dengan `detail`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION` dengan `fields`, 412 problem+json (jadi `CONFLICT`), 401 polos, 403 polos, 413 polos, 429, 503, 500 polos, 502 HTML, respons 200 bukan JSON, fetch melempar, abort — untuk masing-masing jalankan halaman (`flushOutbox` dengan `send: sendOutboxEntry`) dan SW (peristiwa `sync`) terhadap toko yang diisi sama, lalu bandingkan keadaan akhir rekaman (`removed`/`rejected` dengan `reason` identik/`unchanged`) dan bahwa SW melempar tepat untuk `UNAVAILABLE`/`INTERNAL`; (d) `rekaman ditandai SW lolos isOutboxEntry dan diumumkan halaman` (siklus penuh: SW menandai → `flushOutbox` halaman menghasilkan `rejected` dengan alasan itu → rekaman hilang); (e) `kirim ganda dicegah`: SW dan penguras halaman dijalankan bersamaan dengan kunci Web Locks palsu yang benar-benar menserialkan; satu entri komentar hanya memicu SATU `fetch` ke jalur komentar secara total.
- [ ] **Step 2: Jalankan tes** — `bun run --cwd web test src/modules/handover/lib/outbox-parity.test.ts`. Bila ada selisih nyata (mis. teks `reason`), PERBAIKI `sync-sw.js` agar sama dengan halaman (bukan sebaliknya), dengan tes tetap menjadi hakim.
- [ ] **Step 3: Jalankan regresi** — `bun run --cwd web test src/modules/handover src/app`; typecheck; Biome.
- [ ] **Step 4: Commit** — `test(web): kesetaraan penguras halaman dan sync-sw.js (Tahap D)`.

### Task 5: Konfigurasi PWA dan `verify-dist`

**Model:** Haiku (mekanis, spesifikasi lengkap).

**Files:**
- Modify: `web/src/app/pwa/pwa-config.ts`, `web/src/app/pwa/pwa-config.test.ts`, `scripts/verify-dist.ts`, `scripts/verify-dist.test.ts`

**Interfaces:**
- Produces: `workbox.importScripts` = `['push-sw.js', 'sync-sw.js']`; `workbox.globIgnores` memuat keduanya; `checkPwa` menambah pemeriksaan: `push-sw.js` dan `sync-sw.js` ada di dist, keduanya disebut sebagai argumen `importScripts` di `sw.js`, dan tidak ada di daftar pra-cache.

- [ ] **Step 1: Tulis tes yang gagal** — `pwa-config.test.ts`: `importScripts` sama dengan `['push-sw.js', 'sync-sw.js']`, `globIgnores` memuat keduanya, `public/sync-sw.js` ada. `verify-dist.test.ts` (kelompok `checkPwa`): dist sehat memuat kedua berkas dan `sw.js` yang mengimpornya lolos; tiap pelanggaran (berkas hilang, tak diimpor, ikut pra-cache) memberi galat bernama jelas. Perbarui fixture dist sehat yang ada agar memuat kedua berkas.
- [ ] **Step 2: Jalankan tes, pastikan gagal** — `bun run --cwd web test src/app/pwa/pwa-config.test.ts` dan `bun test scripts/verify-dist.test.ts` (atau runner `bun run scripts/test-scripts.ts`).
- [ ] **Step 3: Implementasi** sesuai Interfaces; komentar `pwa-config.ts` diperbarui (daftar skrip impor).
- [ ] **Step 4: Verifikasi keluaran nyata** — `bun run build` (menjalankan `verify-dist`); Expected: `verify-dist OK`. Periksa `server/dist/sw.js` memuat `sync-sw.js` dan `server/dist/sync-sw.js` ada. Hapus apa pun yang dibuat build di luar `server/dist` (git-ignored).
- [ ] **Step 5: Commit** — `feat(web): impor sync-sw.js di service worker dan periksa keluarannya (Tahap D)`.

### Task 6: Pendaftaran sync di halaman dan jembatan pesan SW

**Model:** Sonnet.

**Files:**
- Create: `web/src/app/pwa/background-sync.ts` (+ `.test.ts`), `web/src/app/outbox-sw-bridge.ts` (+ `.test.ts`)
- Modify: `web/src/app/outbox-sync.ts` (+ `outbox-sync.test.ts`)

**Interfaces:**
- Consumes: `setOutboxEnqueuedHandler` (Tugas 1), `refreshOutboxFromStore`, `markStale` (`@/lib/query-cache`), `handoverKeys`, `customerKeys`, `accessKeys`.
- Produces: `export const BACKGROUND_SYNC_TAG = 'qc-outbox'`; `export function registerBackgroundSync(deps?: { sw?: Pick<ServiceWorkerContainer, 'ready'>; hasSyncManager?: () => boolean }): void` (fire-and-forget, tak pernah melempar atau menolak, tanpa `SyncManager` = tidak berbuat apa pun, D9); `export function startOutboxSwBridge(deps: { queryClient: QueryClient; owner: string; onSynced: () => void; sw?: Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'> }): () => void` (mendengar `message` dari SW; bentuk pesan divalidasi ketat: `type === 'qc-outbox-synced'`, `taskIds` larik string, `created` boolean, `rejected` angka; lainnya diabaikan; mengembalikan fungsi berhenti).

- [ ] **Step 1: Tulis tes yang gagal** — `background-sync.test.ts`: tanpa `SyncManager` tak ada panggilan; dengan `SyncManager` memanggil `ready.then(reg => reg.sync.register('qc-outbox'))`; `ready` yang tak pernah selesai atau `register` yang menolak tidak menimbulkan galat atau menggantung pemanggil. `outbox-sw-bridge.test.ts`: pesan valid → `invalidateQueries({ queryKey: handoverKeys.all })`, `markStale(accessKeys.audit)`, bila `created` juga `customerKeys.all` dan `['handovers','options']`, memanggil `refreshOutboxFromStore(owner)` lalu `onSynced`; pesan salah bentuk atau tipe lain diabaikan; fungsi berhenti melepas pendengar. `outbox-sync.test.ts`: `startOutboxSync` memasang `setOutboxEnqueuedHandler(registerBackgroundSync)` dan melepasnya saat berhenti; penguras yang berhenti `unavailable`/`server-error` dengan entri tersisa memanggil `registerBackgroundSync` (D8) dan yang berhenti `none` tidak; jembatan dipasang dan dilepas bersama penyinkron, dengan `onSynced` = pemicu penguras.
- [ ] **Step 2: Jalankan tes, pastikan gagal** — tiga berkas tes di atas.
- [ ] **Step 3: Implementasi** sesuai Interfaces. Di `startOutboxSync`: pasang handler (`setOutboxEnqueuedHandler(() => registerBackgroundSync())`), jembatan (`startOutboxSwBridge({ queryClient, owner, onSynced: trigger })`), dan panggil `registerBackgroundSync()` di `drainNow` bila `result.stoppedBy` ∈ {`unavailable`, `server-error`} dan masih ada entri (`readOutboxAll(owner).length > 0`); lepaskan semuanya di fungsi berhenti.
- [ ] **Step 4: Jalankan tes** — tiga berkas + `bun run --cwd web test src/app src/modules/handover`; typecheck; Biome.
- [ ] **Step 5: Commit** — `feat(web): daftarkan Background Sync dan tanggapi pesan service worker (Tahap D)`.

### Task 7: Dokumen dan verifikasi akhir

**Model:** Haiku untuk dokumen; verifikasi penuh dijalankan controller.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-13-pwa-offline-serah-terima-design.md` (§7.2 bentuk entri memuat `state`/`reason`, §7b, §9 blok "Keputusan Tahap D" memuat D1–D10 sebagai keputusan perancang yang menunggu pengesahan pemilik, daftar "belum teruji"), `docs/prd/2026-10-26-qc-pwa.md` (§11 entri 2026-11-15 Tahap D; FR Background Sync sesuai FR-P yang ada, §2.3 bila perlu), `CLAUDE.md` (bullet PWA: `sync-sw.js`, tag `qc-outbox`, entri `rejected`, pendaftaran sync, aturan klasifikasi sama), `docs/e2e-checklist.md` (skenario baru di bawah #224, semua "belum teruji")

- [ ] **Step 1:** Perbarui dokumen. Skenario e2e (perangkat nyata, Chrome/Edge Android dan desktop, satu per butir): centang/komentar/task baru offline lalu tutup aplikasi, aktifkan sinyal → terkirim tanpa membuka aplikasi dan terlihat saat dibuka; ponsel dikunci; tutup aplikasi di tengah antrean lalu buka dengan sinyal; ganti akun di perangkat sama dengan antrean akun lama (tidak terkirim); keluar dengan antrean (tidak terkirim); server menolak saat aplikasi tertutup lalu aplikasi dibuka (toast beralasan muncul tepat sekali, "Salin teks" untuk komentar/task); Firefox/Safari (tanpa `SyncManager`): tetap terkirim saat aplikasi dibuka; dua tab terbuka saat sync berjalan (tanpa duplikat).
- [ ] **Step 2: Verifikasi penuh** — `bun run typecheck`, `bun run lint`, `bun run --cwd web test`, `bun run build` (`verify-dist OK`); bila terowongan DB hidup, `bun run check` penuh. Catat hasil dan yang tidak dijalankan.
- [ ] **Step 3: Commit** — `docs(pwa): Tahap D Background Sync (spek, PRD, CLAUDE.md, e2e)`.

---

## Self-Review

- **Spec coverage:** §7b berkas/pendaftaran (T3, T5, T6), peristiwa `sync` langkah 1-4 (T3), kejar-kejaran (T4), keamanan (batasan global + T3 pemilik), tes kesetaraan (T4), `verify-dist` (T5), R4 `state` (T1, T2), dokumen §10 (T7), e2e §8 (T7). Peringatan keluar tidak berubah: entri `rejected` tidak dihitung (T1).
- **Type consistency:** `state`/`reason`, `readOutboxAll`, `setOutboxEnqueuedHandler`, `registerBackgroundSync`, `startOutboxSwBridge`, tag `qc-outbox`, pesan `qc-outbox-synced` dipakai dengan nama sama di semua tugas.
- **Proportion:** spek §7b ±15 baris; rencana memuat tujuh tugas karena tiga keputusan lintas-lapisan (bentuk `state`, pemilik sesi, pengumuman penolakan) harus dikunci sebelum kode.
