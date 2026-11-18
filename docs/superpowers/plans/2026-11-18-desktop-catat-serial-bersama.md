# Desktop: Catat Serial Number memakai komponen web bersama, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman Country Lock desktop memuat `RecordPage` (Catat Serial Number web) dengan draft tersimpan di SQLite; hasil inject menjadi baris draft ber-Serial terkunci.

**Architecture:** Jembatan v8 menambah `draft.load/save` (snapshot tunggal di SQLite). Satu hook renderer `useDraftRows(bridge)` memiliki tabel draft; `RecordPage` mendapat mode terkontrol lewat prop `draft` (tanpa `localStorage`). Inject menambah baris lewat hook itu. Pending lama dimigrasikan sekali lalu tak dipakai UI.

**Tech Stack:** Electron 45 (`node:sqlite`, vitest), React + TanStack, zod (`countrylock/` memakai `bun:test`), Bun.

**Spec:** `docs/superpowers/specs/2026-11-18-desktop-catat-serial-bersama-design.md` (baca bersama rencana ini).

## Global Constraints

- `shared/` murni; logika Country Lock tidak masuk `shared/`. `countrylock/` tidak mengimpor `shared/` (parity batas lewat tes web).
- Batas draft: `SERIAL_LIMITS.tableRows` = 1000 baris; JSON snapshot maks. 8 MB (`DRAFT_MAX_BYTES = 8 * 1024 * 1024`).
- `BRIDGE_VERSION` = 8, `DRAFT_BRIDGE_VERSION` = 8, `UI_MIN_BRIDGE_VERSION` = 8, `MIN_BRIDGE_VERSION` tetap 2.
- Tidak ada elemen `<select>` bawaan; field relasi memakai `LinkField` (komponen `RecordPage` sudah patuh).
- Tes server/`check` butuh tunnel MariaDB; tugas ini tak menyentuh server. Tes yang dipakai: `bun run --cwd countrylock test`, `bun run --cwd desktop test`, `bun run --cwd web test <jalur>`, `bun run --cwd web typecheck`/`bun run check` di akhir.
- Teks UI berbahasa Indonesia santai; "Serial Number" ditulis lengkap pada judul.
- Commit per tugas, bahasa Indonesia, akhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `draft.load` gagal (berkas rusak): inject diblokir dan draft tidak pernah ditimpa snapshot kosong (Task 5, 6).
2. Draft penuh 1000 baris: Inject dan Auto Inject nonaktif; serial hasil inject tak hilang diam-diam (Task 5, 6).
3. Serial hasil inject yang sudah ada di draft tidak digandakan, termasuk MAC `58:D6:..` vs `58D6...` (draft memakai `normalizeSerial` shared, bukan versi `countrylock/`) (Task 5).
4. Serial hasil inject tak sah menurut `serialProblem`: baris tetap tersimpan, bertanda `invalid` dengan pesan, tidak hilang (Task 5).
5. Perubahan terakhir dalam 500 ms sebelum jendela ditutup: snapshot disimpan seketika saat unmount dan saat inject menambah baris (Task 5).
6. Belum login atau tanpa `serial: edit`: draft tampil hanya-baca dan tak dapat disimpan; `RecordPage` tidak dirender (Task 7).

---

### Task 1: Kontrak jembatan v8 (`countrylock/`)

**Files:**
- Modify: `countrylock/src/bridge-channels.ts`, `countrylock/src/bridge-contract.ts`, `countrylock/src/ui-manifest.ts`
- Test: `countrylock/src/bridge-contract.test.ts`

**Interfaces:**
- Produces (`bridge-channels.ts`): `BRIDGE_VERSION = 8`; `DRAFT_BRIDGE_VERSION = 8`; `BRIDGE_CHANNELS.draftLoad = 'qc:draft:load'`, `.draftSave = 'qc:draft:save'`; `DRAFT_MAX_ROWS = 1000`; `DRAFT_MAX_BYTES = 8 * 1024 * 1024`.
- Produces (`bridge-contract.ts`): `QcBridge.draft: { load(): Promise<unknown[]>; save(rows: readonly unknown[]): Promise<void> }`; `BRIDGE_ARGS.draftLoad = z.tuple([])`; `BRIDGE_ARGS.draftSave = z.tuple([DraftRowsSchema])`; `DraftRowsSchema = z.array(z.record(z.string(), z.unknown())).max(DRAFT_MAX_ROWS)` ditambah `refine` panjang `JSON.stringify` <= `DRAFT_MAX_BYTES`.
- Produces (`ui-manifest.ts`): `UI_MIN_BRIDGE_VERSION = 8`.

- [ ] **Step 1: Tes gagal** di `bridge-contract.test.ts`: `draftSave` menerima `[[]]` dan `[[{ serial: 'A' }]]`; menolak 1001 baris, baris non-objek (`[['x']]`), dan JSON > `DRAFT_MAX_BYTES` (satu baris berisi string 9 MB); `draftLoad` menolak argumen; tes `UI_MIN_BRIDGE_VERSION` yang ada tetap benar (`<= BRIDGE_VERSION`, `>= MIN_BRIDGE_VERSION`) dan `BRIDGE_VERSION` = 8.
- [ ] **Step 2: Jalankan** `bun run --cwd countrylock test src/bridge-contract.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasi** konstanta, kanal, skema, tipe `QcBridge.draft`, dan naikkan `UI_MIN_BRIDGE_VERSION` ke 8 (perbarui komentar: UI memakai kanal `draft`). Kanal `pending.*` TETAP ada (kompatibilitas dan migrasi).
- [ ] **Step 4: Jalankan** `bun run --cwd countrylock test` — Expected: PASS semua.
- [ ] **Step 5: Commit** `feat(countrylock): kontrak jembatan v8, kanal draft.load/save`.

### Task 2: Penyimpanan draft SQLite di proses utama (`desktop/`)

**Files:**
- Create: `desktop/src/main/store/draft-store.ts`, `desktop/src/main/store/draft-store.test.ts`
- Modify: `desktop/src/main/ipc.ts` (+ `ipc.test.ts` bila ada tes kanal serupa), `desktop/src/preload/index.ts`, `desktop/src/main/index.ts`

**Interfaces:**
- Produces: `interface DraftStore { load(): unknown[]; save(rows: readonly unknown[]): void; close(): void }`; `openDraftStore(file: string): DraftStore`. Tabel `serial_draft (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at TEXT NOT NULL)`; pragma sama dengan `openPendingStore` (`busy_timeout`, WAL, `synchronous = FULL`). `save` dalam `BEGIN IMMEDIATE`: array kosong = `DELETE`, selain itu upsert; `load` mengembalikan `[]` bila tak ada baris, MELEMPAR `Error('Draft tersimpan rusak: ...')` bila JSON tak terbaca atau bukan array (draft tak boleh ditimpa diam-diam).
- Consumes: `IpcDeps.draft: DraftStore`; handler `BRIDGE_CHANNELS.draftLoad` / `draftSave` memanggil `parseArgs(BRIDGE_ARGS.draftSave, args)`; preload `draft: { load: () => invoke(draftLoad), save: (rows) => invoke(draftSave, rows) }`.

- [ ] **Step 1: Tes gagal** `draft-store.test.ts` (berkas sementara, `DatabaseSync`): muat awal = `[]`; simpan lalu muat mengembalikan objek yang sama (urutan terjaga); simpan ulang menimpa; simpan `[]` lalu muat = `[]`; berkas tertutup lalu dibuka ulang tetap memuat; JSON rusak yang ditulis langsung ke tabel membuat `load` melempar; berkas yang sama dengan `pending.db`-style (tabel `pending` sudah ada) tetap terbuka.
- [ ] **Step 2: Jalankan** `bun run --cwd desktop test src/main/store/draft-store.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasi** `openDraftStore`, kabel IPC/preload, dan `index.ts`: buka `join(userData, 'draft.db')` dengan penanganan galat seperti `pending` di `index.ts` (berkas rusak: beri tahu pengguna dan teruskan store yang `load`/`save`-nya melempar galat itu, jangan hapus berkas); tutup di jalur shutdown yang sama dengan `pending.close()`.
- [ ] **Step 4: Tes IPC**: tambah ke tes kanal yang ada (atau `ipc.test.ts` baru bila belum ada): `draftSave` menolak argumen salah bentuk dan tidak memanggil store; `draftLoad` mengembalikan isi store.
- [ ] **Step 5: Jalankan** `bun run --cwd desktop test` dan `bun run --cwd desktop typecheck` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(desktop): penyimpanan draft SQLite dan kanal draft.load/save`.

### Task 3: `RecordPage` mode terkontrol (`draft`) + parser draft bersama

**Files:**
- Modify: `web/src/modules/serial/lib/draft-store.ts`, `web/src/modules/serial/lib/draft.ts`, `web/src/modules/serial/components/record-page.tsx`
- Test: `web/src/modules/serial/lib/draft-store.test.ts`, `web/src/modules/serial/components/record-page-controlled.test.tsx` (baru)

**Interfaces:**
- Produces (`draft-store.ts`): `parseDraftRows(raw: unknown): StagingRow[]` (isi `loadDraft` saat ini: array, `readRow` per entri, dedupe `clientId`, batas `SERIAL_LIMITS.tableRows`; bukan array = `[]`); `loadDraft` memanggilnya.
- Produces (`draft.ts`): `interface DraftControl { rows: StagingRow[]; replace(next: StagingRow[]): void; saveFailed?: boolean }`.
- Produces (`record-page.tsx`): `RecordPageProps.draft?: DraftControl` dan `RecordPageProps.hideTitle?: boolean`. Dengan `draft`: `rows = draft.rows`; `setAllRows(next)` mengisi `rowsRef.current = next` lalu `draft.replace(next)`; efek autosave, simpan saat unmount, `clearDraft` (setelah Simpan penuh, simpan di luar halaman, tombol "Kosongkan draft") dan `resumeDraftWrites` dilewati; `draftFailed` mengikuti `draft.saveFailed`. Tanpa `draft`: perilaku web tak berubah (semua tes `record-page*.test.tsx` lama tetap hijau).

- [ ] **Step 1: Tes gagal** `record-page-controlled.test.tsx` (render dengan `useMe`/provider seperti `record-page.test.tsx`): dengan `draft={{ rows: [dua baris], replace }}` tabel menampilkan dua baris dan `localStorage` kosong sepanjang tes; menambah serial lewat kolom scan memanggil `replace` dengan tiga baris; "Kosongkan draft" memanggil `replace([])` dan TIDAK menyentuh `localStorage`; `hideTitle` menyembunyikan heading "Catat Serial Number"; `saveFailed: true` menampilkan peringatan "Draft tidak tersimpan otomatis". Tambah tes `parseDraftRows` (array rusak = `[]`, entri rusak dibuang, dedupe, batas 1000).
- [ ] **Step 2: Jalankan** kedua berkas tes — Expected: FAIL.
- [ ] **Step 3: Implementasi** sesuai Interfaces; semua pemanggilan `saveDraft`/`clearDraft`/`resumeDraftWrites` di `record-page.tsx` dibungkus syarat "bukan mode terkontrol".
- [ ] **Step 4: Jalankan** `bun run --cwd web test src/modules/serial` — Expected: PASS semua (termasuk tes lama).
- [ ] **Step 5: Commit** `feat(serial): RecordPage mode draft terkontrol dan parseDraftRows bersama`.

### Task 4: Kunci Serial untuk baris `countrylock`

**Files:**
- Modify: `web/src/modules/serial/components/staging-table.tsx`, `web/src/modules/serial/components/row-edit-dialog.tsx`
- Test: `web/src/modules/serial/components/staging-table.test.tsx`, `web/src/modules/serial/components/row-edit-dialog.test.tsx`

**Interfaces:**
- Produces: `SerialCell` menerima baris dan, bila `row.source === 'countrylock'`, merender teks serial hanya-baca (tanpa `<input>`; `aria-label` `Serial <serial>` dipertahankan pada elemen teks) dengan `title="Serial dari perangkat, tidak dapat diubah"`; `RowEditDialog` menonaktifkan `#edit-serial` untuk baris itu dan menampilkan keterangan yang sama, serta tidak memanggil `commitSerial` (serial dikembalikan apa adanya).

- [ ] **Step 1: Tes gagal**: tabel dengan baris `source: 'countrylock'` tidak punya textbox bernama "Serial AB12" (ada teks), sedangkan baris `manual` tetap punya; dialog untuk baris `countrylock` memiliki field serial `disabled` dan `onApply` menerima `serial` yang sama; baris `manual` tetap dapat diubah.
- [ ] **Step 2: Jalankan** tes kedua berkas — Expected: FAIL.
- [ ] **Step 3: Implementasi** sesuai Interfaces (kartu ponsel `staging-cards.tsx` tidak mengubah serial; tak perlu diubah).
- [ ] **Step 4: Jalankan** `bun run --cwd web test src/modules/serial` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(serial): serial baris hasil inject terkunci di tabel dan dialog ubah baris`.

### Task 5: Hook `useDraftRows`, baris inject, migrasi pending (`web/src/modules/countrylock/`)

**Files:**
- Create: `web/src/modules/countrylock/lib/injected-row.ts`, `lib/pending-migration.ts`, `use-draft-rows.ts` dan tes sebelahnya (`*.test.ts`/`use-draft-rows.test.tsx`), `lib/draft-limits.test.ts`
- Modify: `web/src/modules/countrylock/fake-bridge.ts` (tambah `draft` + `draftRows: unknown[]` untuk tes; `pending` tetap)

**Interfaces:**
- Produces (`lib/injected-row.ts`): `interface InjectedRowInput { serial: string; itemId: string; itemLabel: string; buId: string; buLabel: string; locationId: string; locationLabel: string }`; `buildInjectedRow(input: InjectedRowInput, ctx: { clientId: string; now: Date }): StagingRow` — `source: 'countrylock'`, `serial: normalizeSerial(input.serial)` (shared), `testDate: todayWib(ctx.now.getTime())`, `capturedAt: ctx.now.toISOString()`, `sample: false`, `note: ''`, `stickers: null`, `proofPhotos: []`, `selected: false`; bila `serialProblem(serial) !== null` tambah `result: 'invalid'` dan `message: 'Serial tidak sah: ' + <alasan>` (baris tetap dibuat); `itemId === ''` menambah `unresolved: ['item']` dan `locationId === ''` menambah `'location'` (dua-duanya bila keduanya kosong).
- Produces (`lib/pending-migration.ts`): `pendingToRow(entry: PendingEntry, newId: () => string): StagingRow` (`clientId = entry.clientId ?? newId()`, `itemLabel = entry.tipe`, tanggal uji `entry.date`, `capturedAt = entry.timestamp`; tanpa `itemId` => `unresolved: ['item']`, tanpa `locationId` => `['location']`, keduanya bila keduanya hilang; BU/lokasi diisi bila ada); `mergePending(rows: StagingRow[], entries: readonly PendingEntry[], newId): { rows: StagingRow[]; absorbed: PendingEntry[] }` — entri yang serialnya (web-normalisasi) atau `clientId`-nya sudah ada di draft tidak ditambah tetapi tetap `absorbed`; tidak melewati batas 1000 (sisa tidak `absorbed`).
- Produces (`use-draft-rows.ts`): `interface DraftRows { status: 'loading' | 'ready' | 'error'; error: string | null; rows: StagingRow[]; saveFailed: boolean; isFull: boolean; isRegistered(serial: string): boolean; replace(next: StagingRow[]): void; addInjected(input: InjectedRowInput): Promise<'added' | 'duplicate' | 'full'> }`; `useDraftRows(bridge: QcBridge): DraftRows`.
- Perilaku hook: memuat `bridge.draft.load()` sekali (`parseDraftRows`), lalu (jembatan punya `pending`) menjalankan migrasi: `bridge.pending.list()` -> `mergePending` -> simpan snapshot -> `bridge.pending.remove(serial)` untuk tiap `absorbed`; galat migrasi tak menggagalkan muat (pending tersisa, diulang pada pemuatan berikutnya). `status: 'error'` bila `load` gagal: tidak ada penulisan sama sekali. `replace` menyimpan tertunda 500 ms (`AUTOSAVE_DELAY_MS`); `addInjected` menyimpan seketika dan menunggu hasilnya; `unmount` menyimpan snapshot terakhir bila ada perubahan belum tersimpan; kegagalan simpan mengisi `saveFailed`. `isRegistered` memakai `normalizeSerial` shared.

- [ ] **Step 1: Tes gagal** — `injected-row.test.ts`: MAC `aa:bb:cc:dd:ee:ff` menjadi `AABBCCDDEEFF`, `testDate` = `todayWib`, serial tak sah (mis. berisi karakter kontrol atau kosong setelah normalisasi) menghasilkan `result: 'invalid'`. `pending-migration.test.ts`: entri lengkap menjadi baris lengkap dengan `clientId` yang sama; tanpa item/lokasi => `unresolved` sesuai; duplikat serial dan `clientId` terdampak `absorbed` tanpa baris baru; batas 1000 menahan sisa. `use-draft-rows.test.tsx` (jembatan palsu): memuat draft tersimpan; `addInjected` menambah dan menyimpan seketika, serial yang sama kedua kali = `'duplicate'` tanpa baris baru (juga varian MAC), baris ke-1001 = `'full'`; `load` melempar => `status: 'error'` dan `bridge.draft.save` tak pernah dipanggil, termasuk setelah `replace`; `replace` menyimpan setelah 500 ms (fake timers) dan `unmount` memaksa simpan; migrasi memindahkan pending lama ke draft lalu menghapusnya dari pending, dan kegagalan `pending.remove` tidak menggandakan baris pada muat berikutnya. `draft-limits.test.ts`: `DRAFT_MAX_ROWS === SERIAL_LIMITS.tableRows`.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/countrylock` — Expected: FAIL.
- [ ] **Step 3: Implementasi** semua berkas di atas dan perluas `fake-bridge.ts` (`draft.load/save` di memori; `draftRows` terbaca tes).
- [ ] **Step 4: Jalankan** tes yang sama — Expected: PASS untuk berkas baru (tes halaman lama yang bergantung pada pending dibenahi di Task 7).
- [ ] **Step 5: Commit** `feat(countrylock): useDraftRows, baris hasil inject, migrasi pending ke draft`.

### Task 6: `useCountryLock` menulis ke draft (bukan pending)

**Files:**
- Modify: `web/src/modules/countrylock/use-country-lock.ts`
- Test: `web/src/modules/countrylock/use-country-lock.test.tsx` (baru bila belum ada) atau diperluas di `components/catalog-use.test.tsx`

**Interfaces:**
- Consumes: `DraftRows` (Task 5).
- Produces: `useCountryLock(bridge: QcBridge, draft: DraftRows): UseCountryLock`; `UseCountryLock` kehilangan `pending` dan aksi `refreshPending`/`removePending`, dan mendapat `injectBlocker: string | null` = galat muat draft, atau `'Draft penuh (maks. 1000 baris): simpan atau hapus beberapa baris dulu.'` bila `draft.isFull`, selain itu `null`.
- Perilaku: `runInject` kembali tanpa melakukan apa pun bila `injectBlocker !== null` atau `draft.status !== 'ready'`; sukses inject memanggil `draft.addInjected({ serial, itemId: tipe.id, itemLabel: tipe.name, buId, buLabel, locationId, locationLabel })` (nilai dari `targetRef`/`tipeRef` saat inject dimulai; bila `tipe`/BU/lokasi kosong karena katalog tak aktif, inject tetap jalan dan field kosong dikirim sebagai string kosong: `buildInjectedRow` menandainya `unresolved` sehingga pengguna melengkapinya di tabel); hasil `'duplicate'` menambah log "Serial sudah ada di draft." dan `'full'` tak mungkin terjadi (diblokir sebelum mulai) tetapi bila terjadi menambah log peringatan. Auto Inject: kondisi `state.autoInject && canInject(state) && !draft.isRegistered(state.serial)` menggantikan `shouldAutoInject(state, pending)`; `injectedSerialsRef` memakai `normalizeSerial` shared. `localDate`/`PENDING_*` tak dipakai lagi di berkas ini.

- [ ] **Step 1: Tes gagal** (jembatan palsu + `useDraftRows` nyata, `renderHook`): inject sukses menambah satu baris `countrylock` dengan Item/BU/Lokasi dari pilihan; serial yang sama (varian MAC) saat inject ulang tidak menggandakan dan menambah log; draft penuh (isi 1000 baris) => `injectBlocker` terisi dan `bridge.inject.run` tak dipanggil walau `inject()` dipanggil, juga lewat Auto Inject; `draft.status === 'error'` => diblokir; Auto Inject tidak menjalankan inject untuk serial yang sudah ada di draft.
- [ ] **Step 2: Jalankan** — Expected: FAIL.
- [ ] **Step 3: Implementasi** sesuai Interfaces; hapus `bridge.pending.*` dari hook ini.
- [ ] **Step 4: Jalankan** tes hook — Expected: PASS.
- [ ] **Step 5: Commit** `feat(countrylock): hasil inject menjadi baris draft Catat Serial Number`.

### Task 7: Halaman Country Lock memuat `RecordPage`; hapus kode Fase 5

**Files:**
- Modify: `web/src/modules/countrylock/components/country-lock-page.tsx`, `web/src/routes/country-lock.tsx`
- Create: `web/src/modules/countrylock/components/draft-summary.tsx`
- Delete: `components/pending-list.tsx`, `use-upload-pending.ts`, `lib/upload.ts`, `lib/upload.test.ts`, `components/pending-upload.test.tsx`
- Test: `components/country-lock-page.test.tsx`, `components/catalog-use.test.tsx` (diperbarui), `components/country-lock-catat.test.tsx` (baru)

**Interfaces:**
- Produces: `CountryLockPage({ bridge, canRecord?: boolean })` (bawaan `false`; prop `signedIn`/`saveBatch` dihapus). `useDraftRows(bridge)` dipanggil di sini dan hasilnya diberikan ke `useCountryLock(bridge, draft)` dan `RecordPage`. Bagian bawah halaman: `draft.status === 'loading'` -> "Memuat draft..."; `'error'` -> `Alert` destruktif berisi `draft.error`; `canRecord` -> `<RecordPage draft={{ rows: draft.rows, replace: draft.replace, saveFailed: draft.saveFailed }} hideTitle />`; selain itu `<DraftSummary rows={draft.rows} reason={...} />` (`reason`: "Masuk dulu untuk mengunggah ke Daftar Serial Number" bila belum login, "Akun ini tidak punya izin mencatat Serial Number" bila sudah login tanpa izin; hanya-baca: serial, Tipe (`itemLabel`), BU, lokasi). `injectBlocker` menonaktifkan tombol Inject dan menampilkan teksnya di bawah tombol. Kontainer luar `max-w-7xl`, kartu Perangkat tetap dibatasi `max-w-4xl`.
- Produces (`routes/country-lock.tsx`): `canRecord = withShell && hasPermission(me, 'serial', 'edit')` (pakai pembaca izin yang sama dengan `requirePermission`/`canWriteSerials`; baca `me` dari cache query `meQueryOptions`), diteruskan ke `CountryLockPage`.

- [ ] **Step 1: Tes gagal** `country-lock-catat.test.tsx`: dengan `canRecord`, halaman menampilkan Default/kolom scan `RecordPage` tanpa heading "Catat Serial Number" dan baris draft dari jembatan palsu tampil; inject sukses di halaman menambah baris terkunci di tabel; tambah serial manual lewat kolom scan menyimpan ke `bridge.draftRows`; tanpa `canRecord` hanya `DraftSummary` + alasan, tanpa kolom scan; `draft.load` gagal => alert galat dan Inject nonaktif; draft penuh => teks pemblokir. Perbarui `catalog-use.test.tsx` (asersi pending -> `bridge.draftRows`: Item/BU/Lokasi dan `source: 'countrylock'`) dan `country-lock-page.test.tsx` (hapus kasus pending/unggah, pertahankan sisanya).
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/countrylock` — Expected: FAIL.
- [ ] **Step 3: Implementasi** halaman, rute, `DraftSummary`; hapus berkas Fase 5 dan impornya (`PENDING_UPLOAD_BRIDGE_VERSION` tak dipakai UI).
- [ ] **Step 4: Jalankan** `bun run --cwd web test src/modules/countrylock src/modules/serial src/routes`, lalu `bun run --cwd web typecheck` dan Biome pada berkas yang diubah — Expected: PASS/bersih.
- [ ] **Step 5: Commit** `feat(desktop): halaman Country Lock memakai Catat Serial Number bersama`.

### Task 8: Dokumen, build penuh, verifikasi Electron nyata

**Files:**
- Modify: `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` (§6.6, §9 Fase 5, §15 butir 14: ganti rancangan pending+unggah dengan keputusan pemilik 2026-11-18 ini, tutup butir terbuka "foto bukti dari desktop", catat tanggal absolut dan bahwa pemilik produk yang menyetujui), `CLAUDE.md` (ganti kalimat "Unggah antrean pending (Fase 5...)" dengan ringkasan draft SQLite + `RecordPage` terkontrol + jembatan v8 + `UI_MIN_BRIDGE_VERSION` 8), `docs/e2e-checklist-desktop.md` (I19-I22 diganti: inject -> baris terkunci, tambah manual, foto bukti, Simpan ke staging, draft bertahan setelah aplikasi ditutup, migrasi pending lama), `docs/superpowers/specs/2026-11-18-desktop-catat-serial-bersama-design.md` (catat bahwa `shouldAutoInject` di `countrylock/` tak lagi dipakai UI; Auto Inject memakai `isRegistered` draft bernormalisasi web karena MAC).

- [ ] **Step 1: Perbarui dokumen** sesuai daftar di atas.
- [ ] **Step 2: Jalankan** `bun run --cwd countrylock test`, `bun run --cwd desktop test`, `bun run --cwd desktop typecheck`, `bun run --cwd web test src/modules/countrylock src/modules/serial`, `bun run build:web` — Expected: semua hijau. (`bun run check` penuh butuh tunnel dan dijalankan CI.)
- [ ] **Step 3: Verifikasi Electron nyata** (bangun `build:web` + `desktop build` dengan `CATALOG_TOKEN` staging, jalankan dengan folder data uji): inject dengan perangkat tiruan atau lewat mock; baris muncul terkunci; tambah serial manual; foto bukti (kamera/berkas) terunggah lewat proksi Bearer ke staging; Simpan; draft bertahan setelah aplikasi ditutup. Bila unggah foto gagal lewat proksi, perbaiki `desktop/src/main/api-proxy.ts` dan tambah tesnya.
- [ ] **Step 4: Commit** `docs(desktop): catat keputusan Catat Serial Number bersama` dan push cabang, buka PR (periksa status PR cabang lebih dulu).
