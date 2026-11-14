# PWA Fase 3, Tahap B: Papan dan Detail Task Dapat Dibaca Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Papan Serah Terima dan detail task yang pernah dimuat disimpan di IndexedDB perangkat, tampil instan saat aplikasi dibuka dengan koneksi, dan tetap terbaca (berlabel "data terakhir hh:mm") bila server lalu tidak terjangkau.

**Architecture:** Pembungkus IndexedDB mentah (`qc-device`, toko `columns` dan `tasks`) di `web/src/lib/device-db.ts`. Penyimpan kedua di samping `startQueryPersistence` (`web/src/app/board-persist.ts`) mendengarkan cache TanStack Query: hanya sukses non-`manual` untuk kunci `handovers/board` dan `handovers/one` yang disimpan, ditunda dan digabung. Saat boot, SEBELUM router dibuat dan hanya untuk sesi yang sah, data dipulihkan dengan `setQueryData(..., { updatedAt: savedAt })` (batas baca 1,5 detik). Spanduk Fase 2 memakai predikat kunci baru yang terpisah dari whitelist localStorage.

**Tech Stack:** React 19, TanStack Query, IndexedDB, Vitest + jsdom + `fake-indexeddb` (devDependency baru), Biome.

**Spec:** `docs/superpowers/specs/2026-11-13-pwa-offline-serah-terima-design.md` §6 (Tahap B), §8, §9. Tahap A sudah ter-merge (PR #70).

## Global Constraints

- Basis data `qc-device`, versi 1; toko `columns` (kunci `owner|lokasi-terurut|status`) dan `tasks` (kunci `owner|id`). Tanpa dependensi runtime baru; `fake-indexeddb` hanya devDependency, versinya DIPATOK eksak dan setidaknya 2 minggu lebih tua dari hari ini (periksa `npm view fake-indexeddb time`).
- Maks. 50 task per kolom (`BOARD_MAX_LIMIT`), maks. 100 detail task. **Tanpa kedaluwarsa waktu**: data dihapus hanya saat keluar eksplisit (`useLogout`) atau saat pemilik berbeda login. Sesi kedaluwarsa (401) TIDAK menghapusnya.
- Hanya data milik pemilik sesi yang sah (`me.email`, diverifikasi `GET /api/v1/me` sebelum router dibuat). Tidak ada mode luring: boot dingin tanpa sinyal tetap layar "Tidak ada koneksi" (jangan disentuh).
- Penyimpan hanya menulis dari sukses query non-`manual`. Predikat spanduk TERPISAH dari `PERSISTED_KEYS` di `query-persist.ts` (jangan memperluas whitelist localStorage; papan tidak boleh masuk localStorage).
- Pemulihan sebelum router dibuat, dibatasi 1,5 detik; hasil yang terlambat TIDAK diterapkan.
- Jangan menyimpan Log Audit, customer, item, merk, daftar user, atau berkas.
- Teks UI bahasa Indonesia santai. Tanpa `<select>` bawaan. `bun run lint` dan `bun run --cwd web typecheck` hijau pada akhir tiap task.

## Review Focus

Tiap butir punya tesnya di task pemiliknya:
1. **Penulisan balasan setelah keluar**: flush yang sedang berjalan (menunggu IndexedDB terbuka) atau yang dijadwalkan timer tidak boleh menulis data pemilik lama sesudah `useLogout` membersihkan toko (Task 3 dan 4).
2. **Pemilik berbeda atau versi rekaman usang**: rekaman milik email lain dibuang dan tidak pernah dipulihkan; pembandingan memakai kolom `owner` (kesamaan penuh), bukan awalan kunci, sebab email boleh memuat `|` (Task 3).
3. **IndexedDB tidak ada, ditolak, atau lambat** (mode privat, galat saat buka, > 1,5 dtk): aplikasi boot normal tanpa data pulihan dan tanpa galat; hasil terlambat tidak diterapkan (Task 1 dan 3).
4. **Kolom terpotong tetap bisa memuat berikutnya**: pemotongan hanya pada batas halaman utuh dan `nextCursor` halaman terakhir yang tersisa dipertahankan, jadi "muat lagi" tetap berfungsi (Task 2).
5. **Label waktu tidak berbohong**: data pulihan membawa `savedAt` asli sebagai `dataUpdatedAt`; pemulihan dan patch optimistis (keduanya `manual`) tidak pernah ditulis ulang dengan waktu baru (Task 3).
6. **Task yang hanya terlihat di papan**: detail yang belum pernah dibuka tetap terbuka offline dari data papan, dengan spanduk "data terakhir" yang benar (Task 5).

---

### Task 1: Pembungkus IndexedDB `qc-device`

**Files:**
- Modify: `web/package.json` (devDependency `fake-indexeddb`, versi eksak) dan lockfile
- Create: `web/src/lib/device-db.ts`
- Test: `web/src/lib/device-db.test.ts` (`import 'fake-indexeddb/auto'` hanya di berkas tes ini, bukan di `setup.ts`)

**Interfaces:**
- Produces:
  - `type DeviceStoreName = 'columns' | 'tasks'`
  - `interface DeviceRecord { key: string; owner: string; v: number; savedAt: number; [field: string]: unknown }`
  - `readAllRecords(store: DeviceStoreName): Promise<DeviceRecord[]>` (galat apa pun atau tanpa IndexedDB → `[]`)
  - `writeRecords(store: DeviceStoreName, records: DeviceRecord[], keep: number, guard?: () => boolean): Promise<boolean>`: `guard` dipanggil SINKRON tepat sesudah koneksi didapat dan sebelum transaksi dibuka; `false` → tidak menulis apa pun dan mengembalikan `false`. Satu transaksi `readwrite`: `put` semua rekaman (kunci sama menimpa), lalu bila `count() > keep` hapus rekaman TERLAMA menurut `savedAt` (indeks `savedAt`, `openKeyCursor`) sampai tersisa `keep`. Mengembalikan `true` hanya bila transaksi selesai.
  - `deleteRecords(store: DeviceStoreName, keys: string[]): Promise<void>`
  - `clearDeviceDb(): Promise<void>` (mengosongkan kedua toko)
  - `resetDeviceDbForTests(): void` (menutup koneksi tersimpan)
- Semua fungsi TIDAK PERNAH menolak (reject): tanpa `indexedDB`, galat `open`, `onblocked`, atau transaksi gagal → `[]`/`false`/diam.

- [ ] **Step 1: Tulis tes yang gagal.** `device-db.test.ts`, `beforeEach`: `globalThis.indexedDB = new IDBFactory()` (dari `fake-indexeddb`) lalu `resetDeviceDbForTests()`. Kasus (nama tes bebas, asersi persis ini):
  - `writeRecords` lalu `readAllRecords` mengembalikan rekaman yang sama, termasuk bidang bersarang berisi `undefined` (mis. `data: { pageParams: [undefined] }`; structured clone harus mempertahankannya).
  - Kunci sama menimpa: dua tulis kunci `k1` → satu rekaman, nilai yang kedua.
  - `keep`: tulis 5 rekaman `savedAt` 1..5 dengan `keep` 3 → sisa kunci dengan `savedAt` 3, 4, 5. Lalu tulis 2 rekaman baru `savedAt` 6, 7 dengan `keep` 3 → sisa `savedAt` 5, 6, 7 (pemangkasan menghitung rekaman yang sudah ada).
  - Dua toko terpisah: menulis ke `columns` tidak mengubah `tasks`.
  - `deleteRecords(store, ['k1'])` hanya membuang `k1`; `clearDeviceDb()` mengosongkan kedua toko.
  - `guard` mengembalikan `false` → hasil `false`, toko tetap kosong; `guard` dipanggil tepat sekali.
  - Tanpa IndexedDB (`delete globalThis.indexedDB`): `readAllRecords` → `[]`, `writeRecords` → `false`, `deleteRecords` dan `clearDeviceDb` selesai tanpa galat.
  - `indexedDB.open` yang memicu `onerror` (pabrik tiruan): perilaku sama seperti baris di atas.
- [ ] **Step 2: Jalankan, pastikan gagal.** `bun run --cwd web test src/lib/device-db.test.ts` → gagal (modul belum ada).
- [ ] **Step 3: Implementasikan `web/src/lib/device-db.ts`** sesuai Interfaces. Satu `Promise<IDBDatabase | null>` tersimpan untuk koneksi (di-reset bila `onversionchange` menutupnya atau `open` gagal); `onupgradeneeded` membuat kedua toko dengan `keyPath: 'key'` dan indeks `savedAt`. Bungkus tiap transaksi dalam `try/catch` dan selesaikan ke nilai aman.
- [ ] **Step 4: Jalankan tes, pastikan lulus**, lalu lint dan typecheck.
- [ ] **Step 5: Commit** `feat(pwa): pembungkus IndexedDB qc-device untuk data perangkat`.

---

### Task 2: Fungsi murni snapshot papan dan predikat kunci

**Files:**
- Create: `web/src/modules/handover/lib/board-snapshot.ts`
- Test: `web/src/modules/handover/lib/board-snapshot.test.ts`
- Modify: `web/src/app/server-status.ts` (fungsi `scan`)
- Test: `web/src/app/server-status.test.ts`

**Interfaces:**
- Consumes: `BoardColumnData`, `BOARD_KEY` dari `./board-cache`; `BOARD_STATUSES` dari `./group-board`.
- Produces:
  - `const BOARD_STORE_LIMITS = { tasksPerColumn: 50, detailTasks: 100, columns: 40 } as const`
  - `limitColumnData(data: BoardColumnData, max: number): BoardColumnData`: mempertahankan halaman utuh dari depan selama jumlah item kumulatif ≤ `max`, selalu menyimpan halaman pertama; `pageParams` dipotong sepanjang itu; `nextCursor` halaman terakhir yang tersisa TIDAK diubah. Bila tidak ada yang dipotong, mengembalikan objek yang sama.
  - `type BoardQueryRef = { kind: 'column'; locationIds: string[]; status: HandoverStatus } | { kind: 'task'; id: string; locationIds: string[] }`
  - `parseBoardQueryKey(key: readonly unknown[]): BoardQueryRef | null`: `['handovers','board', string[], status]` (status salah satu `BOARD_STATUSES`) → kolom; `['handovers','one', string, string[]]` → task; selain itu `null`.
  - `isBoardQueryKey(key: readonly unknown[]): boolean`
- `server-status.ts`: `scan` memakai `isPersistedQueryKey(key) || isBoardQueryKey(key)`.

- [ ] **Step 1: Tulis tes yang gagal.** `board-snapshot.test.ts`:
  - `limitColumnData`: tiga halaman 20 item (`nextCursor` `c1`, `c2`, `null`) dengan `max` 50 → dua halaman (40 item), `pageParams` panjang 2, `nextCursor` halaman terakhir = `c2`. Satu halaman 50 item dengan `max` 50 → objek yang sama. Halaman pertama 50 + halaman kedua 20 dengan `max` 50 → hanya halaman pertama (nextCursor tetap milik halaman pertama). Satu halaman 3 item dengan `max` 50 → objek yang sama.
  - `parseBoardQueryKey`: kunci kolom `['handovers','board',['l1','l2'],'new']` → `{ kind:'column', locationIds:['l1','l2'], status:'new' }`; kunci detail `['handovers','one','h1',['l1']]` → `{ kind:'task', id:'h1', locationIds:['l1'] }`; `null` untuk `['handovers','board',['l1']]` (tanpa status), status tak dikenal, `['handovers','options',['l1']]`, `['brands','list']`, dan larik kosong.
  - `isBoardQueryKey` konsisten dengan `parseBoardQueryKey`.
  - `server-status.test.ts` (tambahan): query kolom papan yang berdata lalu gagal `UNAVAILABLE` menyalakan `unavailableSince` = `dataUpdatedAt`-nya; sukses non-manual berikutnya memadamkannya; kunci non-papan non-whitelist tetap diabaikan.
- [ ] **Step 2: Jalankan, pastikan gagal.**
- [ ] **Step 3: Implementasikan** `board-snapshot.ts` dan ubah `scan` di `server-status.ts`.
- [ ] **Step 4: Jalankan tes terfokus (`board-snapshot`, `server-status`, `query-persist`), pastikan lulus**, lint, typecheck.
- [ ] **Step 5: Commit** `feat(pwa): fungsi murni snapshot papan dan predikat spanduk untuk papan`.

---

### Task 3: Penyimpan papan, pemulihan, dan pembersihan

**Files:**
- Create: `web/src/app/board-persist.ts`
- Test: `web/src/app/board-persist.test.ts` (`import 'fake-indexeddb/auto'`, pola reset seperti Task 1; sesi diatur lewat helper modul `@/modules/auth/session`: `initSession`/`clearSession`)

**Interfaces:**
- Consumes: `readAllRecords`, `writeRecords`, `deleteRecords`, `clearDeviceDb` (Task 1); `parseBoardQueryKey`, `isBoardQueryKey`, `limitColumnData`, `BOARD_STORE_LIMITS` (Task 2); `handoverKeys` dari `@/modules/handover/queries`; `getSession` dari `@/modules/auth/session`.
- Produces:
  - `const BOARD_STORE_VERSION = 1`, `const BOARD_RESTORE_TIMEOUT_MS = 1500`, `const BOARD_SAVE_DELAY_MS = 1500`
  - Bentuk rekaman: kolom `{ key, owner, v, savedAt, data: BoardColumnData }`, task `{ key, owner, v, savedAt, locationIds: string[], dto: HandoverDto }`. Kunci: kolom `owner|lokasi-terurut-digabung-koma|status`, task `owner|id`.
  - `restoreBoardCache(queryClient: QueryClient, owner: string, options?: { timeoutMs?: number }): Promise<number>`: membaca kedua toko; membuang (via `deleteRecords`) rekaman yang `owner` ≠ pemilik (kesamaan penuh) atau `v` ≠ `BOARD_STORE_VERSION`; memasang sisanya dengan `setQueryData(kunci, data, { updatedAt: savedAt })` (kolom ke `handoverKeys.column(locationIds, status)` dari kunci rekaman, task ke `handoverKeys.one(id, locationIds)`); melewati kunci yang sudah berdata di cache. Dibalap dengan timeout (`timeoutMs`, bawaan 1500): bila timeout menang, mengembalikan `0` dan hasil baca yang terlambat TIDAK diterapkan. Tidak pernah menolak. Mengembalikan jumlah yang dipasang.
  - `startBoardPersistence(queryClient: QueryClient): { flush(): Promise<void>; stop(): void }`: langganan `getQueryCache()`; pada `event.type === 'updated'` dengan `action.type === 'success' && !action.manual` dan `isBoardQueryKey(query.queryKey)`, mencatat salinan tertunda `{ kunci, data: query.state.data, savedAt: query.state.dataUpdatedAt }` (kunci yang sama menimpa); timer `BOARD_SAVE_DELAY_MS`; juga `flush` saat `visibilitychange` (tersembunyi) dan `pagehide`. `flush` mengosongkan catatan tertunda lalu: bila `getSession().email` kosong → berhenti; menangkap `owner` dan `generation`; menyusun rekaman (kolom lewat `limitColumnData(data, BOARD_STORE_LIMITS.tasksPerColumn)`, `savedAt` per entri) dan memanggil `writeRecords('columns', ..., BOARD_STORE_LIMITS.columns, guard)` dan `writeRecords('tasks', ..., BOARD_STORE_LIMITS.detailTasks, guard)` dengan `guard = () => generation === saatIni && getSession().email === owner`. Event `removed`/`manual` tidak menulis apa pun.
  - `clearBoardStore(): Promise<void>`: menaikkan `generation`, mengosongkan catatan tertunda semua instance, lalu `clearDeviceDb()` (tak pernah menolak).
  - `resetBoardPersistForTests(): void`

- [ ] **Step 1: Tulis tes yang gagal.** Memakai `QueryClient` nyata dan `fetchQuery`/`fetchInfiniteQuery` dengan `queryFn` palsu; `persistence.flush()` dipanggil langsung (tanpa menunggu timer):
  - Sukses non-manual kolom (`handoverKeys.column(['l1'], 'new')`) → setelah `flush`, toko `columns` berisi 1 rekaman dengan `owner`, `v` 1, `savedAt` = `dataUpdatedAt` query, dan `key` = `${owner}|l1|new`. Sukses non-manual detail (`handoverKeys.one('h1', ['l1'])`) → 1 rekaman `tasks` dengan `locationIds` dan `dto`.
  - `setQueryData` (manual) pada kunci papan → setelah `flush`, toko tidak berubah (kosong).
  - Kunci non-papan (`['brands','list']`) tidak ditulis.
  - Tanpa sesi (`getSession().email` kosong) → tidak menulis.
  - Pemotongan: `fetchInfiniteQuery` tiga halaman 20 item lewat `fetchNextPage`/`pages: 3` → rekaman memuat 2 halaman dan `nextCursor` halaman terakhir yang tersisa tetap ada.
  - Pemangkasan jumlah: `writeRecords` dipanggil dengan `keep` 40 untuk `columns` dan 100 untuk `tasks` (pantau lewat `vi.spyOn` atau tulis 101 detail dan periksa sisa 100 terbaru).
  - **Balapan keluar (Review Focus 1)**: (a) sukses fetch, panggil `flush()` TANPA menunggu, segera `clearSession()` lalu `await clearBoardStore()`; setelah semuanya selesai toko kosong. (b) sukses fetch (timer terjadwal), `clearSession()`, `await clearBoardStore()`, lalu `flush()` → toko tetap kosong.
  - `restoreBoardCache`: toko diisi rekaman pemilik `a@x` (satu kolom dua halaman, satu task), pemilik `b@x`, satu rekaman `a@x` ber-`v` 0, dan satu rekaman pemilik `a@x|b` (membuktikan perbandingan penuh) → `restoreBoardCache(qc, 'a@x')` mengembalikan 2; cache berisi data kolom dan task `a@x` dengan `getQueryState(...).dataUpdatedAt === savedAt`; rekaman `b@x`, `v` 0, dan `a@x|b` sudah terhapus dari toko; rekaman `a@x` yang valid tetap ada.
  - Pemilik berbeda: toko berisi hanya rekaman `a@x`, `restoreBoardCache(qc, 'b@x')` → 0 dan toko kosong.
  - **Label waktu (Review Focus 5)**: sesudah pemulihan, `flush()` tidak menulis ulang apa pun (rekaman tetap ber-`savedAt` lama), karena pemasangan pemulihan bersifat manual.
  - Timeout (Review Focus 3): `readAllRecords` ditiru lambat (mis. `vi.mock('@/lib/device-db')` dengan penundaan 100 ms) dan `timeoutMs` 20 → hasil 0 dalam waktu singkat; setelah baca yang lambat selesai, cache tetap kosong.
  - Tanpa IndexedDB (`delete globalThis.indexedDB`): `restoreBoardCache` → 0 tanpa galat; `startBoardPersistence().flush()` dan `clearBoardStore()` tanpa galat.
- [ ] **Step 2: Jalankan, pastikan gagal.**
- [ ] **Step 3: Implementasikan `board-persist.ts`** sesuai Interfaces. `generation` dan catatan tertunda adalah keadaan modul; `clearBoardStore` harus meniadakan juga timer instance aktif (mis. instance mendengarkan `generation` saat timer berbunyi dan membuang catatan lama).
- [ ] **Step 4: Jalankan tes, pastikan lulus**, lint, typecheck.
- [ ] **Step 5: Commit** `feat(pwa): penyimpan dan pemulihan papan Serah Terima di IndexedDB`.

---

### Task 4: Pemasangan di boot dan logout

**Files:**
- Modify: `web/src/main.tsx` (fungsi `start`, cabang `if (me)` dan sesudah `startQueryPersistence`)
- Modify: `web/src/modules/auth/use-logout.ts`
- Test: `web/src/modules/auth/use-logout.test.tsx`

**Interfaces:**
- Consumes: `restoreBoardCache`, `startBoardPersistence`, `clearBoardStore` (Task 3).

- [ ] **Step 1: Tulis tes yang gagal** di `use-logout.test.tsx` (tes yang ada tetap tanpa IndexedDB dan harus tetap lulus): dengan `fake-indexeddb` dan dua rekaman (satu `columns`, satu `tasks`) di toko, menjalankan logout (pola tes yang ada) membuat kedua toko kosong sebelum navigasi ke `/login`; kegagalan pembersihan toko (mis. `clearDeviceDb` yang menolak lewat tiruan) tidak mencegah logout menyelesaikan `clearSession` dan navigasi.
- [ ] **Step 2: Jalankan, pastikan gagal.**
- [ ] **Step 3: Ubah `use-logout.ts`:** sesudah `clearSending()` dan SEBELUM `queryClient.clear()`, `await clearBoardStore()`. Ubah `main.tsx`: pada cabang `if (me)` sesudah `queryClient.setQueryData(meQueryKey, me)` tambahkan `await restoreBoardCache(queryClient, me.email)` (sebelum `createAppRouter`), dan panggil `startBoardPersistence(queryClient)` tepat sesudah `startQueryPersistence(queryClient)`. Jalur boot offline (`me === 'unavailable'`) TIDAK disentuh.
- [ ] **Step 4: Jalankan seluruh tes web** (`bun run --cwd web test`), lint, typecheck, dan `bun run build` (+ `verify-dist`); hasil hijau.
- [ ] **Step 5: Commit** `feat(pwa): pulihkan papan sebelum router dan bersihkan saat keluar`.

---

### Task 5: Detail task dibuka dari data papan

**Files:**
- Modify: `web/src/modules/handover/lib/board-cache.ts` (fungsi baru `findBoardSeed`)
- Modify: `web/src/modules/handover/queries.ts` (`handoverQueryOptions`)
- Modify: `web/src/routes/_app/handover/$handoverId/index.tsx` (satu pemanggilan `useQuery`)
- Test: `web/src/modules/handover/lib/board-cache.test.ts`, `web/src/modules/handover/queries.test.ts`

**Interfaces:**
- Consumes: `BOARD_KEY`, `findHandoverInBoards` yang sudah ada.
- Produces:
  - `interface BoardSeed { dto: HandoverDto; updatedAt: number }`
  - `findBoardSeed(queryClient: QueryClient, id: string): BoardSeed | undefined`: task `id` dari kolom papan yang berdata, dengan `updatedAt` = `dataUpdatedAt` query kolom itu (terbaru bila ada di beberapa kolom).
  - `handoverQueryOptions(id: string, locationIds: readonly string[], seed?: BoardSeed)`: bila `seed` ada, menambah `initialData: seed.dto`, `initialDataUpdatedAt: seed.updatedAt`, dan `refetchOnMount: 'always'` (data papan tampil seketika tetapi selalu dimuat ulang saat dibuka, jadi perilaku daring tidak berubah); tanpa `seed` opsi lama tanpa perubahan.

Alasan: tanpa ini task yang hanya terlihat di papan (belum pernah dibuka) menampilkan "Gagal memuat task" saat offline padahal datanya (termasuk komentar) sudah ada di kartu. Spanduk "data terakhir" tetap benar karena `dataUpdatedAt` asli dipakai dan query berdata yang gagal `UNAVAILABLE` masuk predikat papan (Task 2).

- [ ] **Step 1: Tulis tes yang gagal.** `board-cache.test.ts`: `findBoardSeed` mengembalikan `{ dto, updatedAt }` dengan `updatedAt` waktu data kolom (isi lewat `setQueryData(kunci, data, { updatedAt: 1234 })`), `undefined` bila task tidak ada di papan mana pun. `queries.test.ts`: dengan `QueryClient`, papan berisi task `h1` (`updatedAt` 1234), `api` ditiru menolak `ApiError('UNAVAILABLE', ...)`, `QueryObserver` atas `handoverQueryOptions('h1', ['l1'], seed)` → `result.data` = DTO papan, `result.error.code === 'UNAVAILABLE'`, `getQueryState(kunci).dataUpdatedAt === 1234`; dan `api` yang berhasil → data diganti hasil server (refetch terjadi walau `updatedAt` seed masih baru). Tanpa `seed`, query gagal tanpa data seperti sebelumnya.
- [ ] **Step 2: Jalankan, pastikan gagal.**
- [ ] **Step 3: Implementasikan** `findBoardSeed` dan perluasan `handoverQueryOptions`; di `index.tsx` hitung `seed` dengan `useMemo(() => findBoardSeed(queryClient, handoverId), [queryClient, handoverId])` dan teruskan ke `handoverQueryOptions` (halaman ubah `edit.tsx` tidak berubah: mengubah task di luar cakupan offline).
- [ ] **Step 4: Jalankan tes terfokus dan seluruh tes web**, lint, typecheck.
- [ ] **Step 5: Commit** `feat(pwa): buka detail task dari data papan saat offline`.

---

### Task 6: Dokumen

**Files:**
- Modify: `docs/superpowers/specs/2026-11-13-pwa-offline-serah-terima-design.md` (§6, §9)
- Modify: `docs/prd/2026-10-26-qc-pwa.md`
- Modify: `docs/e2e-checklist.md`
- Modify: `CLAUDE.md`

(Pekerjaan dokumen oleh implementer ringan; tanpa tes.)

- [ ] **Step 1: Spek §6 dan §9.** Tambahkan ke §9 (keputusan saya, mohon dikoreksi): (a) kolom dibatasi 40 rekaman terbaru (pilihan lokasi berganti bisa melahirkan kombinasi kunci tanpa batas); (b) rekaman membawa `v` (`BOARD_STORE_VERSION`) dan `owner`, rekaman usang dibuang agar bentuk DTO yang berubah antar rilis tidak merusak tampilan; (c) pemotongan kolom hanya pada halaman utuh sehingga `nextCursor` tetap sah (bisa kurang dari 50 task); (d) hanya sukses query non-`manual` yang ditulis (hasil mutasi yang dipasang manual baru tersimpan pada muat ulang berikutnya; tidak berdampak karena data pulihan selalu dimuat ulang saat basi); (e) label "data terakhir hh:mm" tampil lewat spanduk Fase 2 saat server gagal dihubungi; selama muat ulang normal sesudah boot tidak ada label (tafsiran "selalu berlabel", mohon dikoreksi); (f) detail task dibuka dari data papan bila belum pernah dibuka (Task 5); (g) flush pada `pagehide` bersifat usaha terbaik (IndexedDB asinkron). Ubah status §6 menjadi "dirancang; dikerjakan di Tahap B" bila perlu.
- [ ] **Step 2: PRD.** Tambah baris FR-P21 "Papan dan detail task dapat dibaca offline (Fase 3 Tahap B)" di tabel §4.4 (ringkas, rujuk spek §6); ubah FR-P16 agar menyebut papan Serah Terima; ubah butir keputusan lama di §11 yang menyatakan board dan isi task tidak disimpan di perangkat menjadi digantikan oleh keputusan 2026-11-13 (Tahap B); tambah entri §11 bertanggal 2026-11-14 untuk Tahap B (apa dibangun, keputusan (a)-(g) di atas sebagai "menunggu pengesahan pemilik produk"); tutup §12 butir 4 (sudah diputuskan: IndexedDB, tanpa kedaluwarsa waktu, dihapus saat keluar, tanpa mode luring); perbarui §2.3 non-goals (pengecualian Serah Terima: dibaca offline) dan catatan NFR-P4 bila perlu.
- [ ] **Step 3: E2E.** Tambah bagian "PWA Fase 3, Tahap B" di `docs/e2e-checklist.md` dengan catatan "BELUM TERUJI di perangkat nyata" dan baris #199-#205 (kolom PRD: `PWA FR-P21`): (199) buka papan online lalu matikan jaringan: spanduk "data terakhir hh:mm", papan tetap terbaca, "muat lagi" pada kolom yang dipotong tetap bekerja saat online; (200) buka kartu yang belum pernah dibuka saat offline: detail terbuka dari data papan; (201) tutup aplikasi, buka dengan jaringan hidup: papan tampil instan lalu diganti data server; (202) boot dingin tanpa sinyal: tetap layar "Tidak ada koneksi"; (203) ganti akun Google di perangkat yang sama: data akun lama tidak terlihat; (204) keluar: buka DevTools Application ▸ IndexedDB `qc-device` kosong; (205) sesi kedaluwarsa (401) lalu login ulang pemilik yang sama: papan lama masih tersedia sebagai data awal.
- [ ] **Step 4: CLAUDE.md.** Pada bagian PWA tambahkan satu kalimat: Fase 3 Tahap B menyimpan papan dan detail task di IndexedDB `qc-device` (`web/src/lib/device-db.ts`, `web/src/app/board-persist.ts`, predikat `isBoardQueryKey` di `modules/handover/lib/board-snapshot.ts` terpisah dari `PERSISTED_KEYS`), per pemilik dan tanpa kedaluwarsa waktu, dibuang saat `useLogout` atau pemilik berbeda; detail dibuka dari data papan lewat `findBoardSeed`.
- [ ] **Step 5: Verifikasi dan commit.** `bun run lint` hijau; `git diff --check` bersih; berkas dokumen tetap LF (`git ls-files --eol`). Commit `docs(pwa): Fase 3 Tahap B di spek, PRD, E2E, dan CLAUDE.md`.
