# Dialog Unggah Seragam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu `FileDialog` (AlertDialog, kamera in-app, grid/daftar, unggahan latar dengan progres) dipakai semua tempat lampiran, dengan validasi seragam (10 MB) dan seret-lepas merata.

**Architecture:** Dialog hanya mengumpulkan berkas (`onConfirm({ library, files })`); pemilik field menjalankan unggahan lewat hook bersama `useBackgroundUploads` (kunci per pemilik) dan menampilkan kartu progres. Validasi satu pintu (`intakeFiles` + `checkFile`). Kamera dan pustakanya dipindah ke `web/src/components/camera/`. Selama migrasi dialog baru bernama `AttachDialog`; di Task 18 ia diganti namanya menjadi `FileDialog` setelah yang lama dihapus.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest + Testing Library (`bun run --cwd web test <jalur>`), Biome, Radix AlertDialog (`web/src/components/ui/alert-dialog.tsx`), XHR untuk progres unggah.

**Spec:** `docs/superpowers/specs/2026-11-20-dialog-unggah-seragam-design.md`

## Global Constraints

- Semua berkas maksimal `10_485_760` byte (10 MB); satu-satunya kategori non-gambar: `pdf` (hanya Postel dan PDF QR).
- Dialog = `AlertDialog` (klik di luar tidak menutup); Esc/Batal dengan antrean berisi meminta konfirmasi "Buang N berkas?".
- Dilarang `<select>` bawaan; field relasi `LinkField` (CLAUDE.md "Aturan frontend"). Teks UI santai, bahasa Indonesia.
- Seluruh penulisan dibungkus `runBusy` (`web/src/app/pwa/busy.ts`) agar muat ulang otomatis PWA tak memotong unggahan.
- Server tidak diubah. `shared/api.ts` memuat batas biner sebagai literal yang dijaga `shared/api.test.ts`.
- Foto bukti: unggahan = `serialProofs.upload` (draft), pembuangan = `discardProofPhotos`; draf Catat Serial hanya menyimpan foto selesai.
- Cabang XHR di desktop mengikuti hasil Task 1 (`XHR_PROGRESS_ON_DESKTOP`); persen XHR dapat 100% sebelum server selesai: tampilkan fase "Memproses" sampai respons.
- Perintah: tes `bun run --cwd web test <jalur>`; tipe `bun run --cwd web typecheck`; lint `bunx biome check <jalur>`; akhir `bun run check` (butuh `bun run db:tunnel` hidup) dan `bun run build`.

## Review Focus

- Pemilih berkas yang sama dipilih lagi setelah dihapus dari antrean, dan dua berkas bernama sama: kunci antrean tak boleh bentrok (Task 5).
- Pemilik field dilepas saat unggahan berjalan: unggahan dibatalkan dan hasil yang sudah selesai dibuang lewat `onDiscard` (Task 5, 11).
- Beberapa unggahan selesai bersamaan melewati batas foto: field menolak dan membuang kelebihannya (Task 11).
- Berkas tanpa `type` (HEIC/ekstensi saja), 0 byte, PDF pada dialog khusus gambar: pesan seragam (Task 2).
- Izin kamera ditolak: tombol Kamera hilang, Telusuri tetap jalan (Task 8, 9).

---

### Task 1: Uji XHR `onprogress` di Electron (`app://`)

**Files:**
- Create: `<scratchpad>/xhr-spike/` (skrip uji sekali pakai, tidak dikomit)
- Modify: `docs/superpowers/specs/2026-11-20-dialog-unggah-seragam-design.md` (catat hasil di 5.3)

**Interfaces:**
- Produces: keputusan `XHR_PROGRESS_ON_DESKTOP: boolean` yang dipakai Task 3.

- [ ] **Step 1:** Pasang Electron 45 di folder uji (di luar repo atau `bun install` di `desktop/`). Buat skrip utama yang mendaftarkan skema `app` (`standard`, `secure`, `supportFetchAPI`) dan `protocol.handle('app', ...)` yang meneruskan `request.body` ke server HTTP lokal sementara dengan `duplex: 'half'` (meniru `desktop/src/main/api-proxy.ts:152-166`).
- [ ] **Step 2:** Di jendela tersembunyi, kirim berkas 5 MB lewat `XMLHttpRequest` POST ke `app://qc/echo` dengan `upload.onprogress`; cetak jumlah event, nilai `loaded` bertahap, dan ukuran yang diterima server.
- [ ] **Step 3:** Jalankan. Lulus = lebih dari satu event dengan `loaded` naik bertahap DAN server menerima 5 MB utuh. Tulis hasil (lulus/gagal + angka) di spek 5.3 dan tetapkan `XHR_PROGRESS_ON_DESKTOP`.
- [ ] **Step 4:** Commit spek: `docs: hasil uji XHR progres di Electron`.

### Task 2: Konstanta dan validasi seragam

**Files:**
- Modify: `shared/files.ts`, `shared/postel.ts`, `shared/qrcode.ts`, `web/src/components/file-dialog/accept.ts`, `web/src/modules/postel/lib/upload.ts`
- Create: `web/src/components/file-dialog/intake.ts`, `web/src/components/file-dialog/intake.test.ts`
- Test: `web/src/components/file-dialog/accept.test.ts`, `shared/files.test.ts` (buat bila belum ada)

**Interfaces:**
- Produces: `MAX_FILE_BYTES = 10_485_760` (`shared/files.ts`); `FileCategory = 'image' | 'pdf'` (`accept.ts`); `fileMime(file: {name: string; type: string}): string` (jenis dari `type`, cadangan ekstensi; menggantikan `postelFileMime`); `intakeFiles(files: readonly File[], rule: { accept: readonly string[]; maxBytes: number; nameMax?: number; room: number }): { queued: QueuedFile[]; rejected: RejectedFile[] }` dengan `QueuedFile = { key: string; file: File; name: string }` (tipe di `types.ts`, `RejectedFile` dari `use-upload-queue.ts` dipindah ke `types.ts`).

- [ ] **Step 1: Tes gagal** di `shared/files.test.ts`: `MAX_IMAGE_BYTES`, `POSTEL_LIMITS.attachmentMaxBytes`, `QR_LIMITS.documentMaxBytes` semuanya `=== MAX_FILE_BYTES`. Di `accept.test.ts`: `checkFile` PDF di dialog gambar mengembalikan `Format PDF tidak didukung (hanya JPEG, PNG, WebP)`; berkas `type: ''` bernama `a.PNG` lolos lewat `fileMime`; `file.size === 0` → `Berkas kosong`; 10 MB + 1 → `Ukuran melebihi 10 MB`. Di `intake.test.ts`: melebihi `room` → alasan `Maksimal N berkas per unggahan`; kunci `key` unik walau nama sama.
- [ ] **Step 2:** Jalankan `bun run --cwd web test src/components/file-dialog/accept.test.ts src/components/file-dialog/intake.test.ts`; harapan: FAIL.
- [ ] **Step 3:** Implementasikan: tambah `MAX_FILE_BYTES`, turunkan tiga konstanta darinya (`shared/api.ts` tetap literal), `MIME_LABELS['application/pdf'] = 'PDF'`, `fileMime`, `intakeFiles`; `postelFileMime` menjadi re-ekspor `fileMime`.
- [ ] **Step 4:** Jalankan tes yang sama + `bun run --cwd web test shared/api.test.ts`; PASS.
- [ ] **Step 5:** Commit `feat(web): validasi berkas seragam dan batas 10 MB`.

### Task 3: Klien API `onUploadProgress` (XHR)

**Files:**
- Create: `web/src/lib/api/xhr-upload.ts`, `web/src/lib/api/xhr-upload.test.ts`
- Modify: `web/src/lib/api/client.ts` (`ApiCallOptions` baris 32; `perform` baris 154)

**Interfaces:**
- Produces: `ApiCallOptions.onUploadProgress?(loaded: number, total: number): void`; `xhrSend(url: string, init: { method: string; headers: Record<string,string>; body: Blob | string | FormData | undefined; signal?: AbortSignal; onUploadProgress?(loaded: number, total: number): void }): Promise<{ status: number; headers: Headers; text: string }>`.
- Consumes: `isDesktop()` (`web/src/lib/platform.ts`), `XHR_PROGRESS_ON_DESKTOP` dari Task 1 (konstanta di `xhr-upload.ts`).

- [ ] **Step 1: Tes gagal** (XHR palsu): `xhrSend` memanggil `onUploadProgress` bertahap, melempar `ApiError('UNAVAILABLE', 'Tidak ada koneksi')` pada `onerror`, membatalkan lewat `signal.abort()`; `api(...)` dengan `onUploadProgress` pada rute biner memakai `xhrSend` di peramban, tetap `fetch` bila `isDesktop() && !XHR_PROGRESS_ON_DESKTOP`; tanpa callback tetap `fetch`; header CSRF dan `Content-Type` sama dengan jalur `fetch`; status non-2xx dipetakan `errorFromResponse` yang sama.
- [ ] **Step 2:** Jalankan `bun run --cwd web test src/lib/api`; FAIL.
- [ ] **Step 3:** Implementasikan `xhrSend`; di `perform` pilih transport: `callOptions?.onUploadProgress && (!isDesktop() || XHR_PROGRESS_ON_DESKTOP)` → `xhrSend`, selain itu `fetch`. Jangan menduplikasi pemetaan galat: ekstrak bagian setelah respons ke fungsi bersama.
- [ ] **Step 4:** Tes lulus + `bun run --cwd web typecheck`.
- [ ] **Step 5:** Commit `feat(web): progres unggah lewat XHR`.

### Task 4: `FileSource` dan adaptor per modul

**Files:**
- Modify: `web/src/components/file-dialog/types.ts`, `web/src/modules/sticker/lib/guide-source.ts`, `web/src/modules/serial/lib/proof-source.ts`, `web/src/modules/files/queries.ts`
- Create: `web/src/modules/files/file-source.ts`, `web/src/modules/postel/lib/postel-source.ts`, tes pendamping `file-source.test.ts`, `postel-source.test.ts`, `proof-source.test.ts`

**Interfaces:**
- Produces (`types.ts`): `UploadContext = { onProgress?(phase: 'preparing' | 'uploading' | 'processing', fraction: number | null): void; signal?: AbortSignal }`; `FileSource = { key: string; mimeTypes: readonly string[]; nameMax?: number; upload(file: File, name: string, ctx?: UploadContext): Promise<LibraryItem>; onDiscard?(items: readonly LibraryItem[]): void | Promise<void> }`; `FileLibrarySource extends FileSource { list; rename; remove }` (bentuk lama); `isLibrarySource(s: FileSource): s is FileLibrarySource`.
- Produces: `createImageFileSource(opts: { key: string; maxSide?: number }): FileSource` (kecilkan lewat `prepareImage`, unggah `files.upload`; item hasil `thumbUrl`/`previewUrl` kosong, gambar dimuat lewat `useFileUrl`); `itemFileSource` (`maxSide` bawaan) dan `logoFileSource` (`maxSide: 512`); `postelSource` (`postelFiles.upload`, tanpa pengecilan, `mimeTypes: POSTEL_FILE_MIME_TYPES`); `proofSource` memakai `api('serialProofs.upload', input, { onUploadProgress, signal })`, tanpa stub `unused`, `onDiscard: (items) => discardProofPhotos(items.map((i) => i.id))`.

- [ ] **Step 1: Tes gagal:** tiap adaptor meneruskan `onProgress` (fase `preparing` sebelum `uploading` untuk sumber gambar, `processing` setelah byte penuh), menghormati `signal` (abort sebelum unggah mengosongkan panggilan API), dan `proofSource.onDiscard` memanggil `discardProofPhotos`.
- [ ] **Step 2:** Jalankan tes baru; FAIL.
- [ ] **Step 3:** Implementasikan. `guide-source.ts` tetap `FileLibrarySource` dan menambah argumen `ctx` (abaikan bila tak didukung).
- [ ] **Step 4:** Tes + `typecheck` (pemanggil `FileLibrarySource` lama tetap valid).
- [ ] **Step 5:** Commit `feat(web): adaptor sumber unggah per modul`.

### Task 5: Hook `useBackgroundUploads`

**Files:**
- Create: `web/src/components/file-dialog/use-background-uploads.ts`, `web/src/components/file-dialog/use-background-uploads.test.tsx`

**Interfaces:**
- Consumes: `FileSource`, `QueuedFile`, `LibraryItem`, `runBusy`.
- Produces:
  - `UploadPhase = 'waiting' | 'preparing' | 'uploading' | 'processing' | 'failed'`.
  - `UploadEntry = { key: string; owner: string; file: File; name: string; phase: UploadPhase; fraction: number | null; error: string | null }`.
  - `useBackgroundUploads(options: { source: FileSource; concurrency?: number; onUploaded(owner: string, item: LibraryItem): boolean | void }): BackgroundUploads` dengan `BackgroundUploads = { entries: readonly UploadEntry[]; busy: boolean; hasFailed: boolean; forOwner(owner: string): OwnerUploads; cancelOwner(owner: string): void }` dan `OwnerUploads = { entries: readonly UploadEntry[]; busy: boolean; hasFailed: boolean; add(files: readonly QueuedFile[]): void; retry(key: string): void; remove(key: string): void }`.
- Perilaku: konkurensi 3; entri sukses dihapus dari `entries` setelah `onUploaded` mengembalikan bukan-`false`; `false` = hasil dibuang lewat `source.onDiscard`; `remove` membatalkan lewat `AbortController`; seluruh jalannya antrean dibungkus `runBusy`; saat unmount semua unggahan dibatalkan dan hasil yang tiba sesudahnya dibuang lewat `onDiscard`.

- [ ] **Step 1: Tes gagal:** (a) dua berkas bernama sama mendapat kunci berbeda, (b) `retry` mengulang hanya entri `failed`, (c) `remove` pada entri berjalan memanggil `abort` dan tidak memanggil `onUploaded`, (d) unmount saat berjalan memanggil `source.onDiscard` dengan hasil yang datang terlambat, (e) `onUploaded` mengembalikan `false` → `onDiscard` dipanggil, (f) `busy` benar selama ada entri non-`failed`, `hasFailed` benar bila ada `failed`, (g) `forOwner('a')` tidak melihat entri milik `'b'`, `cancelOwner('a')` hanya membatalkan milik `'a'`.
- [ ] **Step 2:** Jalankan; FAIL.
- [ ] **Step 3:** Implementasikan dengan pola `entriesRef` + `commit` seperti `use-upload-queue.ts` (referensi), progres dari `ctx.onProgress`.
- [ ] **Step 4:** Tes lulus.
- [ ] **Step 5:** Commit `feat(web): hook unggah latar bersama`.

### Task 6: Komponen tampilan bersama

**Files:**
- Create: `web/src/components/file-dialog/upload-progress.tsx`, `rejected-list.tsx`, `attachment-view.tsx` (+ tes `attachment-view.test.tsx`)
- Modify: `web/src/components/file-dialog/preview-dialog.tsx`, `index.ts`

**Interfaces:**
- Produces: `UploadProgress({ phase, fraction })` (`role="progressbar"` dengan `aria-valuenow` bila `fraction !== null`, tak-tentu bila `null`; teks "Menyiapkan" / persen / "Memproses"); `RejectedList({ items, onClear })` (panel "N berkas tidak dapat ditambahkan" dari `upload-tab.tsx` yang ada); `AttachmentItem = { id: string; name: string; mime: string; size?: number; renderImage?(variant: 'thumb' | 'large'): ReactNode; onDownload?(): void }`; `AttachmentView({ items: readonly AttachmentItem[]; pending?: readonly UploadEntry[]; layout: 'grid' | 'list'; onRemove?(id: string): void; onRetry?(key: string): void; onCancel?(key: string): void; disabled?: boolean; label?: string })`; `PreviewDialog` menerima `{ item: AttachmentItem | null; onClose }` dan menampilkan `item.renderImage('large')`; helper `libraryItemToAttachment(item: LibraryItem): AttachmentItem`.

- [ ] **Step 1: Tes gagal:** thumbnail diklik membuka pratinjau; item tanpa `renderImage` (PDF) menampilkan ikon + tombol Unduh dan tidak membuka pratinjau; entri `failed` menampilkan pesan + Ulangi + Buang; entri berjalan menampilkan `progressbar`; `layout='grid'` vs `'list'` menghasilkan elemen `ul` dengan kelas berbeda yang dapat dibedakan lewat `data-layout`.
- [ ] **Step 2:** Jalankan; FAIL.
- [ ] **Step 3:** Implementasikan; pakai `ProofPhotoGrid` (`web/src/modules/serial/components/proof-photo-grid.tsx`) sebagai acuan tampilan sel, jangan mengimpornya.
- [ ] **Step 4:** Tes lulus.
- [ ] **Step 5:** Commit `feat(web): tampilan lampiran dan progres bersama`.

### Task 7: Pindahkan pustaka kamera ke `components/camera`

**Files (git mv, perbarui impor, tes ikut):**
- `web/src/modules/serial/lib/{use-camera-stream.ts,use-camera-stream.test.tsx,camera-session.ts,photo-capture.ts,photo-capture.test.ts,use-pinch-zoom.ts}` → `web/src/components/camera/`
- `web/src/modules/serial/components/{scan-camera-controls.tsx,scan-camera-controls.test.tsx}` → `web/src/components/camera/camera-controls.tsx` (+ tes)
- Modify: semua pengimpor (daftar: `grep -rln "use-camera-stream\|camera-session\|photo-capture\|use-pinch-zoom\|scan-camera-controls" web/src`), `web/src/test/setup.ts`.

**Interfaces:**
- Produces: jalur `@/components/camera/*`; tanpa perubahan perilaku atau tanda tangan.

- [ ] **Step 1:** `git mv` berkas di atas, perbarui impor (alias `@/components/camera/...`).
- [ ] **Step 2:** Jalankan `bun run --cwd web test src/modules/serial src/components/camera` dan `typecheck`; semuanya lulus seperti sebelum pemindahan.
- [ ] **Step 3:** Commit `refactor(web): pindahkan pustaka kamera ke components/camera`.

### Task 8: `CameraDialog` umum

**Files:**
- Create (dari `proof-camera.tsx`, `proof-camera-controls.tsx`, `proof-photo-stack.tsx` via `git mv`): `web/src/components/file-dialog/camera/{camera-dialog.tsx,camera-dialog.test.tsx,camera-top-buttons.tsx,shot-stack.tsx}`
- Modify: `web/src/modules/serial/components/stamp-preview.tsx` (tambah `proofCameraStamp`)

**Interfaces:**
- Produces: `CameraStampSlot = { renderToggle(visible: boolean, onToggle: () => void): ReactNode; renderNote(): ReactNode }`; `CameraShot = { key: string; url: string }`; `CameraDialog({ open, onOpenChange, remaining: number, stamp?: CameraStampSlot, shots: readonly CameraShot[], onShot(file: File): void | Promise<void>, onRemoveShot(key: string): void, onUnavailable?(kind: CameraErrorKind): void, onAvailable?(): void })`; `proofCameraStamp(input: StampPreviewInput): CameraStampSlot` (di modul Serial, membungkus `StampToggleButton` dan `StampNote`).
- Perbedaan dari `ProofCameraDialog`: tanpa prop `uploading`; strip memakai `CameraShot` (thumbnail dari object URL), bukan `ProofPhotoRef`.

- [ ] **Step 1: Tes gagal** (pindahkan `proof-camera.test.tsx` menjadi `camera-dialog.test.tsx`, sesuaikan prop): jepretan memanggil `onShot` dengan `File` JPEG; `onShot` yang melempar `Error('Batas 5 foto per entri tercapai')` menampilkan pesannya di kamera; `remaining=0` menonaktifkan rana; tanpa `stamp` tidak ada tombol/catatan cap; dengan `stamp` ada keduanya dan dapat disembunyikan; izin ditolak memanggil `onUnavailable('denied')`.
- [ ] **Step 2:** Jalankan; FAIL.
- [ ] **Step 3:** `git mv` dan ubah: ganti `StampToggleButton/StampNote` dengan `stamp.renderToggle/renderNote`, hapus `uploading`, strip membaca `CameraShot`.
- [ ] **Step 4:** Tes lulus + `typecheck` (`ProofPhotoDialog` sementara diadaptasi ke prop baru agar tetap hijau: pemetaan `ProofPhotoRef` → `CameraShot` memakai `thumbUrl`).
- [ ] **Step 5:** Commit `refactor(web): kamera foto menjadi CameraDialog umum`.

### Task 9: `AttachDialog` (FileDialog terpadu)

**Files:**
- Create: `web/src/components/file-dialog/attach-dialog.tsx`, `attach-dialog.test.tsx`, `file-picker.tsx` (tombol Telusuri + input tersembunyi + `FileDropZone`, satu-satunya tempat input file selain PDF/logo/impor)
- Modify: `web/src/components/file-dialog/index.ts` (ekspor `AttachDialog`), `library-tab.tsx` (terima `FileLibrarySource`)

**Interfaces:**
- Consumes: `intakeFiles`, `AttachmentView`, `RejectedList`, `CameraDialog`, `LibraryTab`, `isLibrarySource`.
- Produces: `FileDialogResult = { library: LibraryItem[]; files: QueuedFile[] }`; `AttachDialogProps = { open; onOpenChange(open: boolean): void; source: FileSource; mode: 'single' | 'multiple'; accept: readonly FileCategory[]; maxBytes?: number (bawaan MAX_FILE_BYTES); maxFiles?: number (bawaan 20); initialFiles?: File[]; initialRejected?: RejectedFile[]; showLibrary?: boolean (bawaan true, efektif hanya bila isLibrarySource(source)); camera?: boolean | { stamp?: CameraStampSlot } (bawaan true bila accept memuat 'image'); title?: string; confirmLabel?: string (bawaan 'Lampirkan'); hideNames?: boolean; onConfirm(result: FileDialogResult): void }`.
- Perilaku: `AlertDialog` (klik di luar tidak menutup); antrean `grid` bila `accept` HANYA `['image']`, selain itu `list`; ubah nama (`InlineName`) hanya bila `source.nameMax` ada dan bukan `hideNames`; konfirmasi menyerahkan hasil dan menutup tanpa mengunggah; Esc/Batal dengan antrean atau pilihan berisi meminta konfirmasi "Buang N berkas?"; jepretan kamera masuk antrean bernama `foto-<epoch>.jpg` dan menghormati sisa kapasitas; mode `single` mengganti isi antrean/pilihan.

- [ ] **Step 1: Tes gagal:** (a) `onConfirm` menerima `files` dengan nama dan tidak memanggil `source.upload`; (b) klik di luar dialog tidak memanggil `onOpenChange(false)`; (c) Esc dengan 2 berkas memunculkan "Buang 2 berkas?" dan Ya menutup; (d) PDF ditolak pada `accept=['image']` dengan `Format PDF tidak didukung (hanya JPEG, PNG, WebP)`; (e) `accept=['image','pdf']` menampilkan layout `list`; (f) tab Pustaka hanya ada bila `isLibrarySource(source)`; (g) izin kamera ditolak menyembunyikan tombol Kamera, Telusuri tetap ada; (h) mode `single`: berkas kedua menggantikan yang pertama; (i) berkas melebihi `maxFiles` ditolak dengan `Maksimal N berkas per unggahan`.
- [ ] **Step 2:** Jalankan; FAIL.
- [ ] **Step 3:** Implementasikan memakai `ui/alert-dialog.tsx`; logika seleksi pustaka dan `initialFiles` mengikuti `file-dialog.tsx` yang lama (referensi).
- [ ] **Step 4:** Tes lulus + `typecheck`.
- [ ] **Step 5:** Commit `feat(web): AttachDialog terpadu`.

### Task 10: Pustaka Gambar dan Instruksi stiker

**Files:**
- Modify: `web/src/modules/sticker/components/guide-library-page.tsx`, `web/src/modules/item/components/sticker-instructions-field.tsx`; tes `guide-library-page` (bila ada) dan `sticker-instructions-field.test.tsx`

**Interfaces:**
- Consumes: `AttachDialog`, `useBackgroundUploads({ source: stickerGuideSource, onUploaded })`, `AttachmentView`.

- [ ] **Step 1: Tes gagal:** Instruksi: setelah "Tambahkan", dialog tertutup, kartu progres tampil untuk foto baru, dan saat unggahan selesai foto menjadi `Photo` baru (`guideId` = id hasil, `marks: []`) lewat `addSelected` yang sudah ada; pilihan Pustaka langsung masuk. Pustaka Gambar: daftar progres tampil di halaman dan `refresh()` dipanggil saat tiap unggahan selesai; toast `N gambar ditambahkan` saat antrean habis.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Ganti `FileDialog` dengan `AttachDialog` (`showLibrary` instruksi = true, Pustaka Gambar = false); `onConfirm` memasukkan `result.library` ke `addSelected` dan `result.files` ke `uploads.forOwner('guides').add`. `onUploaded` menolak (kembalikan `false` bila sudah dipakai item ini; hasil TIDAK dibuang karena `stickerGuideSource.onDiscard` tidak diisi).
- [ ] **Step 4:** Tes lulus + `typecheck`.
- [ ] **Step 5:** Commit `refactor(web): Pustaka Gambar dan instruksi stiker pakai AttachDialog`.

### Task 11: Foto bukti pada Catat Serial (field, halaman, Simpan, penjaga keluar)

**Files:**
- Create: `web/src/modules/serial/lib/use-proof-uploads.ts` (+ tes)
- Modify: `web/src/modules/serial/components/{proof-photo-field.tsx,staging-table.tsx,staging-cards.tsx,record-page.tsx}`, `web/src/modules/serial/lib/leave-guard.ts`; tes `proof-photo-field`/`staging-table.test.tsx`/`record-page` terkait

**Interfaces:**
- Produces: `useProofUploads(options: { max: number; onAdd(owner: string, photo: ProofPhotoRef): void }): BackgroundUploads` (membungkus `useBackgroundUploads` dengan `proofSource`; `onUploaded` mengubah `LibraryItem` menjadi `ProofPhotoRef` lewat `toProofRef`, memanggil `onAdd`, mengembalikan `false` bila baris sudah penuh sehingga hasil dibuang); `ProofPhotoField` menerima `uploads: OwnerUploads` menggantikan dialog sendiri; `hasProofPhotos(rows)` dan `leaveMode` memperhitungkan `uploadsBusy: boolean`.
- Perilaku: tombol "Foto (n)" membuka `AttachDialog` (`source: proofSource`, `accept: ['image']`, `hideNames`, `camera: { stamp: proofCameraStamp(stamp) }`, `maxFiles` = sisa kapasitas) lalu `uploads.add`; seret-lepas ke sel foto; `AttachmentView` menampilkan foto selesai dan kartu progres; Simpan halaman ditahan (dengan pesan "N foto masih diunggah/gagal") selama `uploads.busy || uploads.hasFailed`; baris dihapus/digantikan memanggil `uploads.cancelOwner(row.clientId)`.

- [ ] **Step 1: Tes gagal:** (a) foto selesai masuk `row.proofPhotos` dan kartu progres hilang, (b) `onAdd` yang melewati `max` membuat hasil dibuang lewat `discardProofPhotos`, (c) Simpan nonaktif selagi ada unggahan berjalan dan selagi ada yang gagal, aktif lagi setelah diulang/dibuang, (d) menghapus baris membatalkan unggahannya, (e) keluar halaman saat unggahan berjalan memicu dialog penjaga keluar, (f) beralih tabel↔kartu saat unggahan berjalan tidak menghentikannya.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasikan; hook dipasang di `RecordPage` (bukan di baris). `ProofPhotoDialog` belum dihapus (Task 18).
- [ ] **Step 4:** `bun run --cwd web test src/modules/serial` + `typecheck`.
- [ ] **Step 5:** Commit `refactor(web): foto bukti Catat Serial memakai AttachDialog dan unggah latar`.

### Task 12: Dialog scan wajib foto dan Ubah baris

**Files:**
- Modify: `web/src/modules/serial/components/{strict-scan-dialog.tsx,row-edit-dialog.tsx,record-page.tsx}` + tes terkait

**Interfaces:**
- Consumes: `OwnerUploads`, `useProofUploads` (Task 11).
- Produces: `StrictScanDialogProps` mendapat `ownerId: string` (dibuat `record-page` tiap dibuka) dan `uploads: OwnerUploads`; `StrictScanResult` memuat `clientId: string` (= `ownerId`) agar `addStrictRow` memakainya sebagai `clientId` baris; `RowEditDialogProps` mendapat `uploads: OwnerUploads`.

- [ ] **Step 1: Tes gagal:** (a) "Simpan" aktif bila foto selesai + berjalan ≥ `proofMin`, lalu baris masuk draf dengan foto selesai dan unggahan berjalan lanjut di bawah `clientId` yang sama, (b) Batal/Esc sebelum Simpan memanggil `cancelOwner` dan `discardProofPhotos` untuk foto selesai, (c) Ubah baris menambah foto lewat `AttachDialog` dan foto baru yang dibuang saat Batal ikut dibuang (perilaku `addedRef` yang ada), (d) `ProofPhotoGrid` di `row-edit-dialog` diganti `AttachmentView`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasikan tanpa mengubah alur dua langkah dialog scan.
- [ ] **Step 4:** Tes serial lulus + `typecheck`.
- [ ] **Step 5:** Commit `refactor(web): dialog scan wajib foto dan Ubah baris pakai unggah latar`.

### Task 13: Cek ulang (`act-dialog`) dan unggah ulang foto bukti

**Files:**
- Modify: `web/src/modules/serial/components/{act-dialog.tsx,proof-replace-dialog.tsx,proof-gallery.tsx,proof-problem-banner.tsx}` + tes terkait; `web/src/modules/serial/queries.ts` (bila `useReplaceProof` perlu `onSuccess` kartu)

**Interfaces:**
- Consumes: `useProofUploads`, `AttachDialog` (`mode: 'single'`, `showLibrary: false`, `camera: true` tanpa cap bila data stempel tak tersedia pada `SerialProofPhotoDto`; bila tersedia, pakai `proofCameraStamp`).
- Produces: `ProofReplaceDialog` diganti `useProofReplace(photo): { start(): void; pending: UploadEntry | null; ... }` atau tetap komponen dengan prop `onPicked(file: QueuedFile)`; kartu foto gagal menampilkan bar progres + "Mengganti…"; foto gagal lama tetap terlihat sampai `serialProofs.replace` berhasil.

- [ ] **Step 1: Tes gagal:** (a) Cek ulang: dialog memegang hook sendiri; tombol kirim aksi ditahan saat unggahan berjalan/gagal; menutup dialog membatalkan unggahan dan membuang foto selesai yang belum terkirim, (b) unggah ulang: setelah unggahan selesai memanggil `serialProofs.replace({ photoId, newPhotoId })`, toast sukses, gagal replace memanggil `discardProofPhotos([newPhotoId])` hanya untuk `DISCARD_CODES` (`VALIDATION`, `CONFLICT`, `NOT_FOUND`), (c) berpindah halaman saat unggahan berjalan membatalkan tanpa memanggil `replace`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasikan; perbarui komentar basi di `proof-replace-dialog.tsx`.
- [ ] **Step 4:** Tes serial lulus + `typecheck`.
- [ ] **Step 5:** Commit `refactor(web): Cek ulang dan unggah ulang foto bukti pakai AttachDialog`.

### Task 14: `ImagePicker` dan galeri item

**Files:**
- Modify: `web/src/modules/item/components/{image-picker.tsx,image-gallery-field.tsx,image-thumb.tsx}`, pemanggil `web/src/modules/sticker/components/sticker-form-dialog.tsx` dan `web/src/modules/item/components/item-form.tsx`; tes `image-gallery-field.test.tsx` dan tes `image-picker` (buat bila belum ada)

**Interfaces:**
- Produces: `ImagePickerProps` tetap `{ value: string | null; onChange; label }` + prop baru opsional `onBusyChange?(busy: boolean): void`; `ImageGalleryFieldProps` tambah `onBusyChange?`. Keduanya memakai `AttachDialog` (`source: itemFileSource`, `accept: ['image']`, `hideNames`, mode `single`/`multiple`), `useBackgroundUploads`, `FileDropZone`, dan `AttachmentView` dengan `renderImage` berisi `ImageThumb`; thumbnail diklik membuka `PreviewDialog`.
- Pemanggil menahan Simpan form selagi `onBusyChange(true)`.

- [ ] **Step 1: Tes gagal:** (a) tombol membuka dialog; setelah "Lampirkan" `onChange` dipanggil dengan id hasil unggah, (b) galeri menghormati `max` dan mengurutkan ulang seperti sekarang, (c) thumbnail klik membuka pratinjau besar, (d) seret-lepas gambar ke field mengunggah, (e) `onBusyChange` true selama unggahan berjalan, (f) berkas bukan gambar ditolak dengan pesan seragam.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasikan; hapus `<input type="file">` tersembunyi dan `isAcceptedImage` lokal.
- [ ] **Step 4:** Tes item + sticker lulus + `typecheck`.
- [ ] **Step 5:** Commit `refactor(web): ImagePicker dan galeri item pakai AttachDialog`.

### Task 15: Lampiran Postel

**Files:**
- Modify: `web/src/modules/postel/components/attachments-field.tsx`, `web/src/modules/postel/components/postel-form.tsx`, `web/src/modules/postel/lib/upload.ts`; tes `attachments-field.test.tsx`

**Interfaces:**
- Consumes: `postelSource`, `AttachDialog` (`accept: ['image', 'pdf']`, `showLibrary: false`, `camera: true`, `hideNames`), layout `list`; gambar punya `renderImage` memuat `postelFiles.get` (blob URL), PDF punya `onDownload` (`saveFileDownload`).
- `AttachmentsFieldProps` tetap (`value`, `onChange`, `error?`, `onBusyChange?`).

- [ ] **Step 1: Tes gagal:** PDF dan gambar diterima, 11 berkas ditolak `Maksimal 10 lampiran` melalui `POSTEL_LIMITS.attachmentsMax`, pesan penolakan memakai kalimat seragam (`Ukuran melebihi 10 MB`), gambar klik membuka pratinjau, PDF hanya Unduh, seret-lepas bekerja, `onBusyChange` dipanggil.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasikan; hapus `uploadPostelFile` bila tak dipakai lagi (galat server tetap lewat `postelUploadError`).
- [ ] **Step 4:** Tes postel lulus + `typecheck`.
- [ ] **Step 5:** Commit `refactor(web): lampiran Postel pakai AttachDialog`.

### Task 16: Editor Markdown

**Files:**
- Modify: `web/src/modules/markdown/wysiwyg-editor.tsx`, form pemakai: `modules/item/components/item-form.tsx`, `modules/handover/components/{handover-form.tsx,handover-batch-form.tsx,note-editor.tsx}`, `modules/serial/components/{act-fields.tsx,serial-note-field.tsx}`; tes editor

**Interfaces:**
- Produces: prop opsional `onBusyChange?(busy: boolean): void` pada `WysiwygEditor` (dan penerusnya `NoteEditor`/`serial-note-field`); tombol gambar toolbar membuka `AttachDialog` (`source: itemFileSource`, `accept: ['image']`, `hideNames`, `maxFiles` = sisa `maxImages`); drop/tempel tetap langsung (tanpa dialog) lewat `intakeFiles` + hook; progres di baris status bawah editor memakai `UploadProgress`.
- Perilaku: gambar disisipkan di posisi kursor saat unggahan selesai; editor dilepas = unggahan dibatalkan, tidak ada yang disisipkan.

- [ ] **Step 1: Tes gagal:** toolbar membuka dialog; `onConfirm` memulai unggahan dan `onBusyChange(true/false)`; gambar tersisip setelah selesai; melebihi `maxImages` ditolak `Maksimal N gambar`; unmount saat mengunggah tidak menyisipkan; PDF ditolak seragam.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasikan; ganti `useUploadImage` dan input file tersembunyi; hubungkan `onBusyChange` ke penahan Simpan di form yang punya tombol Simpan.
- [ ] **Step 4:** `bun run --cwd web test src/modules/markdown src/modules/handover src/modules/item src/modules/serial` + `typecheck`.
- [ ] **Step 5:** Commit `refactor(web): editor Markdown pakai AttachDialog dan unggah latar`.

### Task 17: PDF QR dan logo QR (tetap inline)

**Files:**
- Modify: `web/src/modules/qrcode/components/{pdf-source-field.tsx,logo-library-field.tsx}`, pemanggil `qr-design-form.tsx` dan `web/src/routes/_app/qrcode/default/index.tsx`; tes terkait

**Interfaces:**
- `PdfSourceField.onUpload` menjadi `(file: File, replaceId?: string, ctx?: { onProgress(fraction: number | null): void }) => Promise<QrDocumentDto>`; pemanggil meneruskan `onUploadProgress` ke `qrcodes.uploadPdf`.
- Keduanya memakai `FileDropZone`, `intakeFiles` (kategori `pdf` / `image`, `MAX_FILE_BYTES`), `UploadProgress`, `RejectedList`; input file hanya lewat `FilePicker` (Task 9) alih-alih `<Input type="file">`. `LogoLibraryField` memakai `useBackgroundUploads` dengan `logoFileSource` dan `AttachmentView` (grid, pratinjau saat thumbnail diklik).

- [ ] **Step 1: Tes gagal:** PDF bukan `application/pdf` ditolak `Format tidak didukung (hanya PDF)`; PDF 10 MB + 1 → `Ukuran melebihi 10 MB`; seret-lepas PDF memicu dialog konfirmasi yang sama; progres tampil selama unggah; logo: seret-lepas, `Pustaka penuh`, thumbnail klik membuka pratinjau, `onBusyChange` benar.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementasikan; pesan galat ad hoc ("Hanya berkas PDF yang dapat diunggah", "Ukuran PDF maksimal 10 MB") dihapus.
- [ ] **Step 4:** Tes qrcode lulus + `typecheck`.
- [ ] **Step 5:** Commit `refactor(web): PDF dan logo QR memakai validasi dan progres bersama`.

### Task 18: Pembersihan, penamaan, penjaga, dokumentasi

**Files:**
- Delete: `web/src/components/file-dialog/{file-dialog.tsx,file-dialog.test.tsx,upload-tab.tsx,upload-tab.test.tsx,use-upload-queue.ts,use-upload-queue.test.ts}`, `web/src/modules/serial/components/{proof-photo-dialog.tsx,proof-photo-dialog.test.tsx,proof-photo-grid.tsx}`, `web/src/modules/files/use-upload-image.ts` (bila tak dipakai), sisa kode mati bertanda `grep`
- Modify: rename `AttachDialog` → `FileDialog` (`attach-dialog*.tsx` → `file-dialog*.tsx`, semua impor), `CLAUDE.md`, `docs/superpowers/specs/2026-11-16-serial-bukti-foto-qc-design.md`, `docs/superpowers/specs/2026-11-12-serial-number-design.md` (butir bukti foto 59-65), `docs/superpowers/specs/2026-11-20-dialog-unggah-seragam-design.md`, `docs/adding-a-module.md`
- Create: `scripts/no-native-file-input.test.ts`

**Interfaces:** tidak ada baru.

- [ ] **Step 1: Tes gagal:** `scripts/no-native-file-input.test.ts` (pola `no-native-select.test.ts`, `bun:test`) memindai `web/src` dan gagal bila `type="file"` muncul di luar `components/file-dialog/file-picker.tsx`, `modules/serial/components/import-export-bar.tsx` (impor `.qcsn`), dan `modules/markdown/wysiwyg-editor.tsx` bila masih ada; komentar diabaikan. Jalankan `bun test scripts/no-native-file-input.test.ts`; harapan: PASS setelah Task 14-17, FAIL bila ada sisa.
- [ ] **Step 2:** Hapus berkas lama, jalankan rename dengan `git mv` dan perbarui impor (`grep -rl "AttachDialog" web/src`).
- [ ] **Step 3:** Dokumentasi (keputusan pemilik 2026-11-20): `CLAUDE.md` koreksi bullet bukti foto (tanpa `capture`; unggah ulang memakai `FileDialog`; B8 ditutup), ganti sebutan `ProofPhotoDialog`, dan tambah aturan "Aturan frontend": SETIAP lampiran berkas memakai `FileDialog` + `useBackgroundUploads` (kecuali `PdfSourceField`/`LogoLibraryField` inline yang memakai `intakeFiles`, `FileDropZone`, `UploadProgress`); jangan membuat `<input type="file">` baru. Tutup B8 di spek bukti foto dan ubah kalimat alur unggah seketika menjadi alur latar; sesuaikan spek induk Serial Number; tambah catatan di `docs/adding-a-module.md` bagian "Gambar dan Markdown".
- [ ] **Step 4:** Verifikasi penuh: `bun run check` (tunnel hidup) dan `bun run build`; keduanya hijau.
- [ ] **Step 5:** Commit `chore(web): hapus dialog unggah lama dan catat aturan lampiran`.

---

## Self-review

- **Cakupan spek:** 5.1 (Task 9), 5.2 (5), 5.3 (1, 3, 6), 5.4 (6, 14-17), 5.5 (2), 5.6 (9-17), 5.7 (4), 5.8 (10-17), 5.9 (11-13), 5.11 (3, 4, 13, 16), 6 (18), 7 (tes tiap task).
- **Konsistensi tipe:** `QueuedFile`, `RejectedFile`, `FileSource`, `UploadEntry`, `OwnerUploads`, `CameraStampSlot`, `AttachmentItem` didefinisikan sekali (Task 2, 4, 5, 6, 8) dan dipakai dengan nama yang sama setelahnya.
- **Perhatian:** Task 9 sampai 17 memakai `AttachDialog` selama dialog lama masih ada; Task 18 satu-satunya tempat yang menghapus dan mengganti nama.
