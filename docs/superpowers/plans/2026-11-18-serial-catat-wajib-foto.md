# Catat Serial wajib foto, kamera foto, dan tabel draft kartu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item dapat ditandai wajib foto bukti (minimum n); halaman Catat Serial menjadi terarah (Default dulu, dialog scanner dua langkah untuk item strict), dialog Foto bukti memakai kamera di dalam aplikasi dengan pratinjau cap, dan tabel draft mendapat bar aksi Edit/Hapus/Batalkan pilihan, dialog ubah massal, serta kartu di ponsel.

**Architecture:** Bendera `items.proof_required` + `items.proof_min` mengalir lewat `ItemDto` → `SerialItemOptionDto` → web (`ItemBuValue.proofMin`, `StagingRow.proofMin`); server menegakkan minimum di `serials.saveBatch`. Aliran kamera diekstrak dari `useCameraScanner` menjadi `useCameraStream` yang dipakai pemindai dan kamera foto. Dialog `StrictScanDialog` (dua langkah) dan `ProofPhotoDialog` (kamera + telusuri + kisi) menggantikan `FileDialog` pada foto bukti. Tabel draft: satu tampilan terender menurut lebar layar (`useIsDesktop`).

**Tech Stack:** Bun + Hono + MariaDB (bun:test), React + TanStack + Tailwind (vitest, Testing Library), zod 4, tanpa dependensi baru.

**Spec:** `docs/superpowers/specs/2026-11-18-serial-catat-wajib-foto-design.md` (DISETUJUI 2026-11-18). Spek induk: `docs/superpowers/specs/2026-11-12-serial-number-design.md`; spek bukti foto: `docs/superpowers/specs/2026-11-16-serial-bukti-foto-qc-design.md`.

## Global Constraints
- Migrasi expand-only dan idempoten; nomor berikut = `0024_item_wajib_foto.sql`; daftar migrasi wajib ditambah di `server/src/core/migrate.test.ts` (array nama, setelah `0023_firmware_item.sql`).
- Tanpa dependensi baru. Tanpa `<select>`/`<option>`; relasi memakai `LinkField`/`LinkMultiField`; enum memakai `Select` (`web/src/components/select.tsx`).
- Dialog: header dan footer tetap, hanya badan yang menggulir (CLAUDE.md "Dialog dan alert dialog"); dialog layar penuh = `AlertDialogContent size="full"`; dialog bertumpuk dirender di luar `<form>` induk.
- Teks UI santai ("Butuh 2 foto lagi", bukan baku kaku); serapan asing boleh (scan, default, draft).
- Batas: `SERIAL_PROOF_LIMITS.perEntryMax` = 5 (maks. foto per entri, juga batas atas `proof_min`); `SERIAL_LIMITS.batchRows` = 200.
- Cap resmi digambar server saat Simpan (tidak berubah); pratinjau cap di kamera hanya tampilan, tidak pernah masuk berkas foto.
- Cek ulang tetap opsional (tanpa minimum). Kamera pemindai barcode dan perilaku item non-strict tidak berubah (tes yang ada tetap lulus tanpa diubah kecuali dinyatakan).
- Tes web: `cd web && bunx vitest run <path>` (ulang berkas yang timeout sendirian); tes server: `bun run --cwd server test <path>` (butuh `bun run db:tunnel`); wajib hijau: `bun run typecheck`, `bunx biome check --write <berkas>`, `bun run build` (potongan JS <= 600 KB gzip).
- Commit per kelompok logis, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; tanpa push; jangan menyentuh server dev (3000/8788).

## Review Focus
1. Draft lama di localStorage (baris tanpa `proofMin`) untuk item yang kemudian wajib foto: server menolak baris dengan pesan per baris; web menampilkannya tanpa mengosongkan foto baris dan tanpa menghilangkan baris (`isProofRejection` tidak boleh mengenali pesan baru).
2. Langkah konfirmasi strict: serial diedit menjadi tak sah atau duplikat (terhadap draft) memblokir Simpan; foto tetap terpasang saat serial diedit; Scan ulang membuang foto dengan konfirmasi.
3. Batal/Esc/tutup saat foto masih mengunggah: tidak ada foto draft yatim (`discardProofPhotos`), tidak ada pembaruan state setelah unmount, kamera dilepas.
4. Kamera foto: izin ditolak atau tak ada `getUserMedia` = tombol Kamera tidak tampil dan Telusuri/kamera bawaan tetap berfungsi; batas 5 foto dan kuota draft ditolak dengan pesan jelas; bingkai gagal dienkode tidak membuat dialog macet.
5. Tabel draft 200+ baris: hanya satu tampilan (tabel atau kartu) terender; pilihan baris bertahan saat layar diputar/diubah ukurannya; Hapus massal membuang foto draft semua baris terpilih.

---

### Task 1: Item wajib foto (server, shared)

**Files:**
- Create: `server/migrations/0024_item_wajib_foto.sql`
- Modify: `server/src/core/migrate.test.ts`, `shared/contract.ts` (`ItemDto`, `SaveItemInput`), `shared/serials.ts`, `server/src/modules/item/{repo,service,validate}.ts`, `server/src/modules/jobs/sheets-export.ts` (daftar kolom `items`), `web/src/modules/access/components/audit-diff-view.tsx` (`FIELD_LABELS`)
- Test: create `server/src/modules/item/proof-required.test.ts` (pola: `firmware.test.ts`); extend `validate.test.ts`

**Interfaces:**
- Produces: `ItemDto.proofRequired: boolean`, `ItemDto.proofMin: number`; `SaveItemInput.proofRequired?: boolean`, `SaveItemInput.proofMin?: number` (tidak dikirim = pertahankan nilai tersimpan, create = false/1, pola `resolveItemFirmware`); `shared/serials.ts`: `export function proofMinimumOf(item: { proofRequired: boolean; proofMin: number }): number` (0 bila tidak wajib, selain itu `proofMin`).

- [ ] **Step 1: Write failing tests** di `proof-required.test.ts`: (a) create dengan `proofRequired:true, proofMin:3` mengembalikan `ItemDto` bernilai sama dan `items.get` memuatnya; (b) `proofMin` 0 dan 6 ditolak 422 dengan galat field `proofMin`; (c) `proofRequired:false` menyimpan `proofMin` = 1 walau dikirim 4; (d) klien lama tanpa field mempertahankan nilai tersimpan pada PUT; (e) mengubah hanya `proofRequired` bukan dianggap "hanya status" (`itemContentEquals`) dan masuk audit `item.update` (snapshot memuat dua field); (f) CAS `expectedUpdatedAt` usang tetap 412. Tambah tes `proofMinimumOf` di `shared/serials.test.ts`.
- [ ] **Step 2: Run to verify fail:** `bun run --cwd server test src/modules/item/proof-required.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Migrasi: `ALTER TABLE items ADD COLUMN IF NOT EXISTS proof_required TINYINT(1) NOT NULL DEFAULT 0` dan `proof_min TINYINT UNSIGNED NOT NULL DEFAULT 1`. Ikuti jejak kolom `firmware` end-to-end: `ItemRecord`/`ItemRow`, `ITEM_COLUMN_LIST`, `toItem` (angka lewat `Number()`), `insertItemStmts`, `updateItemStmts`, `toItemDto`, `itemSnapshot`, `itemContentEquals`, `ComparableItem`, pembuatan `fields` di penyimpan, `validateSaveItem` (boolean opsional + int 1..`SERIAL_PROOF_LIMITS.perEntryMax`; pesan Indonesia, `reader.fail('proofMin', ...)`), kolom di `sheets-export.ts`, label audit ("Wajib foto", "Minimum foto"). `listItemPage` tidak perlu diubah.
- [ ] **Step 4: Run** tes item penuh: `bun run --cwd server test src/modules/item` dan `src/core/migrate.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(item): kolom wajib foto bukti dan minimum foto`.

### Task 2: Penegakan minimum foto di serial (server)

**Files:**
- Modify: `shared/contract.ts` (`SerialItemOptionDto`), `server/src/modules/serial/service.ts` (`queryItemOptions`, `OptionRow`, `SerialLookupMemo`, `createSerialOnce`), `server/src/modules/serial/proof/attach.ts` (hanya bila perlu pesan bersama)
- Test: extend `server/src/modules/serial/rest.test.ts` (itemOptions), `record-batch.test.ts` (saveBatch), `server/test-support/item-fixtures.ts` (`SeedItem` mendapat `proofRequired?`, `proofMin?` untuk menyemai kolom)

**Interfaces:**
- Consumes: Task 1 (`proofMinimumOf`, kolom `items.proof_required/proof_min`).
- Produces: `SerialItemOptionDto.proofRequired: boolean`, `SerialItemOptionDto.proofMin: number` (mode `itemIds` memakai query yang sama); `SerialLookupMemo.proofMinOf(itemId: string): Promise<number>` (memo per item); pesan galat baris: `Item ini wajib foto bukti minimal ${n}` (hasil `invalid` per baris via `failRow`, TIDAK diawali "Foto sudah kedaluwarsa"/"Ada foto yang tidak dikenal").

- [ ] **Step 1: Write failing tests:** (a) `serials.itemOptions` (query dan `itemIds`) membawa `proofRequired/proofMin` item; (b) `saveBatch` baris item wajib foto min 2 dengan 0 foto dan 1 foto = `invalid` bermakna pesan di atas, baris lain dalam batch yang sama tetap `created`; dengan 2 foto draft sah = `created`; (c) item tak wajib tanpa foto tetap `created`; (d) kirim ulang `clientId` yang sama setelah sukses = idempoten (tidak mengevaluasi ulang aturan); (e) bendera item diubah antara dua permintaan: permintaan kedua memakai nilai terbaru.
- [ ] **Step 2: Run to verify fail:** `bun run --cwd server test src/modules/serial/record-batch.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Tambah kolom di SELECT/`OptionRow`/pemetaan `queryItemOptions`; `proofMinOf` di memo membaca dua kolom item; di `createSerialOnce` setelah pemeriksaan item/BU dan SEBELUM `planProofs`: bila `proofMinOf(row.itemId)` > `row.proofPhotoIds?.length ?? 0` maka `failRow`. Tidak mengubah `planProofAttach`.
- [ ] **Step 4: Run** `bun run --cwd server test src/modules/serial` dan `src/http/body.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(serial): server menegakkan minimum foto bukti per item`.

### Task 3: Form Data Item (web)

**Files:**
- Modify: `web/src/modules/item/schemas.ts` (`ITEM_FIELD_KEYS`, `itemFormSchema`, `toItemFormDefaults`, `toSaveItemInput`), `web/src/modules/item/components/item-form.tsx`, `item-detail-view.tsx`, `web/src/modules/item/queries.ts` (hanya bila ringkasan berubah)
- Test: `item-form.test.tsx` (pola checkbox+field bersyarat), `schemas.test.ts`, `item-detail-view.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`ItemDto`, `SaveItemInput`).

- [ ] **Step 1: Write failing tests:** form: checkbox "Wajib foto bukti" menampilkan field "Minimum foto" (angka, bawaan 1) hanya saat dicentang; kirim `onSubmit` dengan `proofRequired:true, proofMin:2`; nilai di luar 1..5 menampilkan galat dan tidak mengirim; galat server `proofMin` tampil di field; `toSaveItemInput` mengirim `proofMin: 1` bila tidak wajib; `toItemFormDefaults(item)` mengisi dari `ItemDto`; detail: lencana "Wajib foto (min 2)".
- [ ] **Step 2: Run to verify fail:** `cd web && bunx vitest run src/modules/item` → FAIL.
- [ ] **Step 3: Implement** mengikuti pola `isCountryLock`/`firmware` (Checkbox + `form.Subscribe` untuk field bersyarat; `Input type="number"`, `FieldError` memuat `serverError('proofMin')`).
- [ ] **Step 4: Run** `bunx vitest run src/modules/item src/modules/access` → PASS.
- [ ] **Step 5: Commit** `feat(item): form wajib foto bukti`.

### Task 4: `useCameraStream` (ekstraksi aliran kamera)

**Files:**
- Create: `web/src/modules/serial/lib/use-camera-stream.ts`
- Modify: `web/src/modules/serial/lib/use-camera-scanner.ts`
- Test: tes yang ada tidak diubah (`camera-scan-dialog.test.tsx`, `scan-camera-controls.test.tsx`, `camera-controls.test.ts`); tambah `use-camera-stream.test.tsx`

**Interfaces:**
- Produces: `export function useCameraStream(options: { open: boolean; deviceId: string }): CameraStream` dengan `CameraStream` = semua field `UseCameraScanner` saat ini (`videoRef`, `state`, `devices`, `activeDeviceId`, `torchSupported`, `torchOn`, `setTorch`, `zoom`, `zoomRange`, `setZoom`, `tapFocusSupported`, `focusAt`, `retry`) ditambah `reportError(kind: CameraErrorKind): void` (agar pemindai dapat melaporkan `'loader'`). `useCameraScanner` = `useCameraStream` + engine + loop tick, mengembalikan objek yang sama seperti sekarang. `ScanCameraControls` tetap menerima tipe yang sama (alias `UseCameraScanner = CameraStream`).

- [ ] **Step 1: Write failing test** `use-camera-stream.test.tsx` (pola `fakeStream`/`setMediaDevices` dari `camera-scan-dialog.test.tsx`): membuka stream tanpa engine mengubah status ke `scanning` setelah video siap; menutup (`open:false`) menghentikan track; tab tersembunyi menjeda; zoom/torch dari kemampuan track; `reportError('loader')` menjadikan `state` error.
- [ ] **Step 2: Run to verify fail:** `cd web && bunx vitest run src/modules/serial/lib/use-camera-stream.test.tsx` → FAIL.
- [ ] **Step 3: Implement** memindahkan bagian umum (izin, `getUserMedia`, visibilitas, torch, zoom, ketuk-fokus, enumerasi kamera, `retry`) tanpa mengubah perilaku; bagian khusus pemindaian (`createEngine`, loop `tick`, confirmer, `onPayload`) tetap di `useCameraScanner`.
- [ ] **Step 4: Run** `bunx vitest run src/modules/serial` (semua tes kamera lama hijau tanpa perubahan) + `bun run typecheck` → PASS.
- [ ] **Step 5: Commit** `refactor(serial): ekstrak aliran kamera ke useCameraStream`.

### Task 5: Dialog Foto bukti, kamera foto, pratinjau cap

**Files:**
- Create: `web/src/modules/serial/components/{proof-photo-dialog,proof-camera,proof-photo-grid,stamp-preview}.tsx`, `web/src/modules/serial/lib/{stamp-preview,photo-capture}.ts`
- Modify: `web/src/modules/serial/components/proof-photo-field.tsx` (ganti `FileDialog` dengan `ProofPhotoDialog`, pakai `ProofPhotoGrid`), `staging-table.tsx` dan `act-dialog.tsx` (meneruskan `stamp`)
- Test: tiap komponen `*.test.tsx`; `lib/*.test.ts`; sesuaikan `proof-photo-field.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`useCameraStream`), `ScanCameraControls`, `proofSource`, `toProofRef`, `discardProofPhotos`, `prepareImage`, `ProofPhotoRef`.
- Produces:
  - `export interface StampPreviewInput { serial: string; itemLabel: string; buLabel: string; locationLabel: string; actorName: string; actorTeam: string }`; `export function stampPreviewLines(input: StampPreviewInput): string[]` → empat baris persis spek bukti foto §5.3 (`SN: …`, `itemLabel`, `buLabel · locationLabel`, `Disimpan saat Simpan · actorName (actorTeam)`); lokasi kosong → baris 3 tanpa lokasi.
  - `captureFrame(video: HTMLVideoElement, name: string): Promise<File>` (kanvas pada resolusi video, JPEG kualitas 0.9; galat bila video belum siap).
  - `ProofPhotoGridProps { photos: ProofPhotoRef[]; onRemove?(photo: ProofPhotoRef): void; disabled?: boolean; label?: string }` (klik gambar membuka dialog pratinjau besar yang menutup dengan Esc; tombol buang terpisah).
  - `ProofPhotoDialogProps { open: boolean; onOpenChange(open: boolean): void; existingCount: number; max: number; stamp?: StampPreviewInput; onAdd(photos: ProofPhotoRef[]): void }`: tombol Kamera (hanya bila `cameraSupported()`), Telusuri (`<input type=file multiple accept=image/*>`), di ponsel tombol aplikasi kamera bawaan (`capture`) sebagai cadangan; tiap berkas diunggah lewat `proofSource.upload` (status per berkas, galat lewat `describeError`); kisi foto baru; footer `Batal | Tambahkan` (Batal = `discardProofPhotos` foto baru; Tambahkan aktif bila ada foto baru).
  - `ProofCameraDialogProps { open; onOpenChange; remaining: number; stamp?: StampPreviewInput; onShot(file: File): Promise<void>; shots: ProofPhotoRef[] }`: AlertDialog `size="full"`, dua kolom pada md/landscape dan satu kolom pada portrait, `ScanCameraControls` + tombol rana, `StampPreview` overlay (tombol sembunyikan), kilat dan getar ringan per jepretan, kamera dilepas saat tutup.
  - `ProofPhotoFieldProps` ditambah `stamp?: StampPreviewInput`.

- [ ] **Step 1: Write failing tests:** `stampPreviewLines` (empat baris, lokasi kosong, label panjang tidak dipotong di sini); `captureFrame` (kanvas palsu menghasilkan `File` bertipe JPEG); `ProofPhotoGrid` (klik gambar membuka pratinjau besar, Esc menutup, buang memanggil `onRemove`); `ProofPhotoDialog` (tombol Kamera tersembunyi tanpa `getUserMedia`; Telusuri mengunggah dan menampilkan kisi; batas `max - existingCount` menolak kelebihan dengan pesan; Batal membuang foto baru; Tambahkan memanggil `onAdd`; galat unggah per berkas tampil dan tidak menahan yang lain); `ProofCameraDialog` (rana memanggil `onShot` dengan berkas; pratinjau cap tampil dan dapat disembunyikan; overlay bukan bagian berkas; kamera dilepas saat tutup; izin ditolak menampilkan pesan dan "Coba lagi"); `ProofPhotoField` memakai dialog baru dan tetap memperlihatkan "Foto (n)".
- [ ] **Step 2: Run to verify fail:** `cd web && bunx vitest run src/modules/serial/components/proof-photo` → FAIL.
- [ ] **Step 3: Implement** komponen di atas (pola layout dan kontrol mengambang dari `camera-scan-dialog.tsx`; getar/kilat dari `lib/scan-feedback.ts`); `stamp` pada `staging-table.tsx` dibangun dari baris + `useMe()` (nama dan tim), pada `act-dialog.tsx` hanya bila lokasi cek ulang terpilih (jika tidak, tanpa pratinjau).
- [ ] **Step 4: Run** `bunx vitest run src/modules/serial src/components/file-dialog` + `bun run typecheck` → PASS (`FileDialog` tetap dipakai pemakai lain).
- [ ] **Step 5: Commit** `feat(serial): dialog Foto bukti dengan kamera dan pratinjau cap`.

### Task 6: Gerbang Default dan bendera wajib foto di draft (web)

**Files:**
- Modify: `web/src/modules/serial/components/item-bu-field.tsx` (`ItemBuValue.proofMin`), `lib/draft.ts` (`StagingRow.proofMin?`, `Defaults.proofMin`, `addSerials`, `applyBulk`), `components/staging-table.tsx` (`rowStatus`), `components/record-page.tsx` (gerbang + `defaults()`), `lib/import-verify.ts` (bawa `proofMin`), pemakai `ItemBuValue` lain (`row-detail-dialog.tsx`, `bulk-edit-bar.tsx`, `edit-serial-dialog.tsx`, `serial-filters.tsx`) hanya sebatas tipe
- Test: `lib/draft.test.ts`, `staging-table.test.tsx`, `record-page-default-gate.test.tsx` (baru), `record-page*.test.tsx` yang ada (mock `ITEMS` mendapat `proofRequired:false, proofMin:1`)

**Interfaces:**
- Consumes: Task 2 (`SerialItemOptionDto.proofRequired/proofMin`), `proofMinimumOf`.
- Produces: `ItemBuValue.proofMin: number` (0 = tidak wajib; `EMPTY_ITEM_BU.proofMin = 0`); `StagingRow.proofMin?: number` (undefined = 0); `lib/draft.ts`: `export function missingDefaults(d: { itemId: string; buId: string; locationId: string; testDate: string }): string[]` (label field kosong: "Item", "Business Unit", "Lokasi", "Tanggal uji"); `rowStatus` menambah status error `Butuh ${n} foto lagi` bila `(row.proofMin ?? 0) > row.proofPhotos.length`, setelah pemeriksaan lain.

- [ ] **Step 1: Write failing tests:** `missingDefaults` (kombinasi); `rowStatus` item strict dengan 1 dari 3 foto = error "Butuh 2 foto lagi", cukup = ok, `proofMin` undefined = ok; `addSerials` menyalin `proofMin` dari Defaults; `applyBulk` ganti item memperbarui `proofMin` (patch membawa `proofMin`); halaman Catat: kolom scan, tombol kamera, dan area tempel nonaktif sampai Default terisi dan petunjuk menyebut field yang kosong ("Isi Default dulu: Item, Lokasi"); draft lama tanpa `proofMin` tetap dimuat; pesan server "Item ini wajib foto bukti minimal 2" ditampilkan di baris tanpa mengosongkan foto (`isProofRejection` tidak mengenalinya).
- [ ] **Step 2: Run to verify fail:** `cd web && bunx vitest run src/modules/serial/lib/draft.test.ts src/modules/serial/components/record-page-default-gate.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** `ItemBuField` mengisi `proofMin` dari `known: Map<string, SerialItemOptionDto>` (`proofRequired ? proofMin : 0`); gerbang di `record-page.tsx` (disabled + petunjuk `role="status"`, fokus awal ke field kosong pertama); `SerialScanInput`/`CameraScanButton` sudah punya `disabled`.
- [ ] **Step 4: Run** `bunx vitest run src/modules/serial` + `bun run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(serial): gerbang Default dan aturan wajib foto pada draft`.

### Task 7: Dialog scanner dua langkah untuk item strict

**Files:**
- Create: `web/src/modules/serial/components/{strict-scan-dialog,scan-camera-pane}.tsx`
- Modify: `camera-scan-dialog.tsx` (memakai `ScanCameraPane` hasil ekstraksi, perilaku tidak berubah), `camera-scan-button.tsx` (prop `strict`), `serial-scan-input.tsx` (prop `strict`, jalur tempel/ketik/pemindai fisik), `record-page.tsx` (membangun konteks strict, `addStrictRow`)
- Test: `strict-scan-dialog.test.tsx` (baru), `serial-scan-input.test.tsx`, `camera-scan-button.test.tsx`, `record-page-strict.test.tsx` (baru); tes dialog kamera lama tidak diubah

**Interfaces:**
- Consumes: Task 4, 5 (`ProofPhotoDialog`, `ProofPhotoGrid`, `StampPreviewInput`), Task 6 (`ItemBuValue.proofMin`, `missingDefaults`).
- Produces:
  - `ScanCameraPane({ camera, flash, onViewportClick, ... })`: viewport video, bingkai `SCAN_FRAME`, galat kamera + "Coba lagi", kontrol mengambang; diekstrak dari `CameraScanBody` tanpa perubahan perilaku.
  - `export interface StrictInfo { itemLabel: string; buLabel: string; locationLabel: string; testDate: string; proofMin: number; stamp: Omit<StampPreviewInput, 'serial'> }`
  - `StrictScanDialogProps { open: boolean; onOpenChange(open: boolean): void; initialSerial?: string; info: StrictInfo; isKnown: IsKnown; onConfirm(result: { serial: string; photos: ProofPhotoRef[] }): void; createEngine?: () => Promise<BarcodeEngine>; now?: () => number }`. `initialSerial` ada → mulai di langkah 2; tidak → langkah 1.
  - `SerialScanInputProps.strict?: { info: StrictInfo; isKnown: IsKnown; onConfirm: StrictScanDialogProps['onConfirm'] }`; `CameraScanButtonProps.strict?: SerialScanInputProps['strict']`.

- [ ] **Step 1: Write failing tests:** langkah 1: bacaan sah pertama (serial belum ada di draft) membawa ke langkah 2; serial yang sudah ada di draft memberi umpan balik "Sudah ada" dan tetap di langkah 1; tanpa tabel hasil. Langkah 2: kartu informasi memuat item, BU, lokasi, tanggal, "Wajib foto minimal N"; field Serial dapat diedit (normalisasi, karakter kontrol ditolak, duplikat terhadap draft = pesan di field); Simpan nonaktif sampai foto >= minimum, serial tidak sah, atau duplikat, dengan petunjuk "Butuh 2 foto lagi"; Tambah foto membuka `ProofPhotoDialog` dan foto yang ditambahkan muncul di kisi; mengedit serial mempertahankan foto; Scan ulang meminta konfirmasi bila ada foto lalu membuangnya (`discardProofPhotos`) dan kembali ke langkah 1; Batal dan Esc membuang foto (dengan konfirmasi bila ada) dan menutup tanpa `onConfirm`; Simpan memanggil `onConfirm({serial, photos})` lalu menutup. Input: tempel satu serial pada item strict membuka dialog di langkah 2; tempelan multi-serial = `rejected` + catatan "Item ini wajib foto: satu serial per kali"; item non-strict tidak berubah (tes lama hijau). Halaman: `addStrictRow` membuat baris dari Default dengan `proofPhotoIds` dan `proofMin`; dua dialog tidak terbuka bersamaan.
- [ ] **Step 2: Run to verify fail:** `cd web && bunx vitest run src/modules/serial/components/strict-scan-dialog.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Ekstrak `ScanCameraPane` lebih dulu (tes dialog kamera lama sebagai jaring pengaman), lalu `StrictScanDialog` (AlertDialog `size="full"`, dua kolom md/landscape, satu kolom portrait; footer tetap; dialog konfirmasi bertumpuk di luar konten). Lepas kamera saat langkah 2 (hook dibuka hanya di langkah 1).
- [ ] **Step 4: Run** `bunx vitest run src/modules/serial` + `bun run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(serial): dialog scanner dua langkah untuk item wajib foto`.

### Task 8: Tabel draft: bar aksi, dialog ubah massal, kartu ponsel

**Files:**
- Create: `web/src/hooks/use-is-desktop.ts` (pindahkan `useIsDesktop` dari `handover-board.tsx`, yang kemudian mengimpornya), `web/src/modules/serial/components/{selection-bar,bulk-edit-dialog,staging-cards,confirm-remove-dialog}.tsx`
- Modify: `staging-table.tsx` (kolom diringkas), `row-detail-dialog.tsx` → diperluas menjadi dialog "Ubah baris" (nama berkas dan ekspor `RowEditDialog` di `row-edit-dialog.tsx`; hapus berkas lama), `record-page.tsx`; hapus `bulk-edit-bar.tsx` (isi form pindah ke `bulk-edit-dialog.tsx`)
- Test: `selection-bar.test.tsx`, `bulk-edit-dialog.test.tsx`, `staging-cards.test.tsx`, `row-edit-dialog.test.tsx`, `staging-table.test.tsx`, `record-page.test.tsx` (sesuaikan), `web/src/hooks/use-is-desktop.test.ts`

**Interfaces:**
- Consumes: `applyBulk`, `BulkPatch`, `rowStatus`, `StagingRow`, `ProofPhotoField`/`ProofPhotoGrid`, `discardProofPhotos`, `proofIdsOf`.
- Produces:
  - `useIsDesktop(): boolean` (query `(min-width: 768px)`, default true tanpa `matchMedia`).
  - `SelectionBarProps { count: number; onEdit(): void; onRemove(): void; onClear(): void }` (muncul hanya bila `count > 0`; "n dipilih", Edit, Hapus, Batalkan pilihan; menempel di bawah pada layar sempit).
  - `BulkEditDialogProps { open: boolean; count: number; onApply(patch: BulkPatch): void; onClose(): void }` (form lama dengan `idPrefix="bulk"`, "Terapkan ke n baris", Kosong = tidak diubah; menutup setelah terapkan; pilihan dipertahankan).
  - `ConfirmRemoveDialogProps { open: boolean; count: number; photoCount: number; onConfirm(): void; onCancel(): void }`.
  - `StagingCardsProps` sama dengan `StagingTableProps` (`rows`, `onSelect`, `onSelectAll`, `onOpenDetail`, `disabled`); kartu `memo` per baris: centang, nomor, Serial, lencana status; "Merk Tipe · BU"; "Lokasi · tanggal"; lencana (Sample, jumlah foto, "Butuh n foto"); ketuk kartu → `onOpenDetail`.
  - `RowEditResult { serial: string; item: ItemBuValue; location: { id: string; label: string }; testDate: string; sample: boolean; note: string; stickers: StagingSticker[]; proofPhotos: ProofPhotoRef[] }`; `RowEditDialogProps { row: StagingRow; commitSerial(serial: string): string | null; onClose(): void; onApply(result: RowEditResult): void }` (satu kolom form, `LinkField` untuk relasi, kisi foto + Tambah foto).
  - `StagingTable` kolom: centang, No, Serial (edit langsung), Item (dua baris: "Merk Tipe" dan BU, lencana Sample bila ada), Lokasi dan tanggal uji (dua baris), Foto (`ProofPhotoField`), Status, Aksi (Detail, Hapus); tanpa scroll horizontal pada >= 1024 px.

- [ ] **Step 1: Write failing tests:** bar aksi hanya muncul bila ada baris tercentang dan memuat tepat Edit, Hapus, Batalkan pilihan (Batalkan mengosongkan semua centang); Edit membuka `BulkEditDialog` dan "Terapkan" hanya mengubah kolom terisi (perilaku `applyBulk` sama) lalu menutup dengan pilihan tetap; Hapus membuka konfirmasi yang menyebut jumlah foto ikut dibuang, Konfirmasi menghapus dan memanggil `discardProofPhotos` untuk semua foto baris; lebar < 768 px merender kartu tanpa elemen `<table>` dan lebar >= 768 px merender tabel tanpa kartu (satu tampilan; `matchMedia` palsu); pilihan bertahan saat tampilan berganti; ketuk kartu membuka `RowEditDialog` dengan semua kolom; edit serial duplikat di dialog ditolak; item strict menampilkan "Butuh n foto" pada kartu; `useIsDesktop` bereaksi pada perubahan query.
- [ ] **Step 2: Run to verify fail:** `cd web && bunx vitest run src/modules/serial/components/selection-bar.test.tsx src/hooks/use-is-desktop.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Pindahkan hook tanpa mengubah perilaku `handover-board`; pindahkan isi form `bulk-edit-bar.tsx` ke dialog (aturan dialog proyek: header/footer tetap); perluas dialog detail baris; `record-page.tsx` merangkai `useIsDesktop`, bar aksi, dialog, konfirmasi hapus, `applyDetail(result: RowEditResult)`; atribut `data-tour` dipertahankan di elemen yang masih ada (`serial-row`, `serial-row-select`, `serial-row-actions` pada tabel; padanan pada kartu) dan `serial-bulk` dipindah ke bar aksi.
- [ ] **Step 4: Run** `bunx vitest run src/modules/serial src/modules/handover src/hooks` + `bun run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(serial): tabel draft dengan bar aksi, ubah massal dalam dialog, dan kartu di ponsel`.

### Task 9: Panduan Interaktif, dokumen, dan verifikasi akhir

**Files:**
- Modify: `web/src/modules/guide/catalog/serial.ts` (`SERIAL_CATAT`: langkah dan `version`), tabel versi bersama di `shared/` (cari `GUIDE_VERSIONS`), `web/src/modules/guide/catalog/serial.test.ts` (daftar 7 langkah) dan `guides-parity.test.ts` bila perlu; `docs/superpowers/specs/2026-11-12-serial-number-design.md` (butir keputusan 65; ubah butir 62 dan kalimat §4/§5/§8/§9 yang bertentangan), `docs/superpowers/specs/2026-11-16-serial-bukti-foto-qc-design.md` (butir 9 §3, §5.1 kamera, §5.3 pratinjau cap, §6.2), `CLAUDE.md` (paragraf Serial Number dan Data Item), migrasi 0024 di daftar bila disebut
- Test: `serial.test.ts`, `guides-parity.test.ts`

**Interfaces:**
- Consumes: Task 3 sampai 8 (target `data-tour` yang final).

- [ ] **Step 1: Write failing test:** perbarui `serial.test.ts` ke daftar langkah baru (urutan `[target, advance, waitFor]`): Default, scan (`serial-scan`, menunggu `serial-row`), draft, baris (`serial-row-actions` pada tabel; teks netral untuk kartu), pilih baris (`serial-row-select`, menunggu `serial-bulk` yang kini bar aksi), aksi pilihan (`serial-bulk`: Edit membuka dialog ubah massal; Hapus; Batalkan pilihan), simpan; sebut aturan item wajib foto di langkah scan.
- [ ] **Step 2: Run to verify fail:** `cd web && bunx vitest run src/modules/guide/catalog/serial.test.ts` → FAIL.
- [ ] **Step 3: Implement** teks dan target langkah, naikkan `version` di panduan dan tabel versi bersama; tulis dokumen sesuai spek §7 (butir 65 memuat keputusan 2026-11-18, alasan, pemilik produk yang menyetujui, dan membalik butir 62).
- [ ] **Step 4: Verifikasi akhir:** `bun run typecheck`, `bunx biome check`, `cd web && bunx vitest run` (seluruh web, ulang yang timeout sendirian), `bun run --cwd server test src/modules/item src/modules/serial src/core/migrate.test.ts src/http/body.test.ts`, `bun run build` (laporkan potongan JS terbesar).
- [ ] **Step 5: Commit** `docs(serial): panduan interaktif dan keputusan wajib foto bukti`.
