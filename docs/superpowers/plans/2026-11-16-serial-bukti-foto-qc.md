# Bukti foto QC pada Serial Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Foto bukti pemeriksaan QC (opsional, bercap permanen dari server) pada Tambah Serial Number dan Cek ulang, dengan badge "Bukti foto QC".

**Architecture:** Foto diunggah ke disk server (status `draft`), ditaut ke kejadian dalam `batch()` yang sama dengan penulisan kejadian (CAS) sekaligus memasang satu job `serial_proof` per foto; runner menggambar footer cap (`Bun.Image` + `node:zlib` + font bitmap), mengunggah ke Drive, lalu menulis baris `files` (pemilik `serialproof`). Web: file dialog tanpa pustaka dengan kamera langsung, kolom Foto di tabel draft, field di dialog Cek ulang, badge dan kisi foto.

**Tech Stack:** Bun 1.4.2 (`Bun.Image`), Hono, MariaDB, React + TanStack, vitest (web), `bun test` (shared, server).

**Spec:** `docs/superpowers/specs/2026-11-16-serial-bukti-foto-qc-design.md` (disetujui pemilik 2026-11-16). Bacaan wajib juga: `CLAUDE.md` (aturan server, `shared/`, frontend), `docs/superpowers/specs/2026-11-12-serial-number-design.md`.

## Global Constraints
- Cap digambar **di server saat Simpan** dari `snapshot_json` yang dibekukan saat Simpan; **tanpa dependensi gambar baru** (hanya `Bun.Image`, `node:zlib`, font bitmap tertanam). Jangan memakai `atob`/`btoa`/base64 di `server/src` (pagar `files.test.ts`).
- Batas: 5 foto per entri; 150 foto `draft` per pengguna; unggah <= 10 MB (`MAX_IMAGE_BYTES`); JPEG/PNG/WebP; sapuan draft 7 hari. Foto tersimpan tidak dapat dihapus/diganti kecuali yang `failed` (retry/buang).
- Pemilik berkas baru `serialproof`; tidak ada baris di `sticker_guide_images`; foto bukti tidak tampil di halaman publik; `.qcsn` tidak membawa foto.
- Migrasi expand-only idempoten (`IF NOT EXISTS`). Variabel `.env` baru wajib di `server/src/config.ts`, `deploy/compose.yml`, `deploy/.env.example` (dijaga `server/src/deploy-files.test.ts`).
- Frontend: dilarang `<select>`; dialog header/footer tetap (CLAUDE.md "Dialog dan alert dialog"); teks UI santai, "Serial Number" lengkap pada judul; izin Tambah/Buka lewat `web/src/lib/link-access.ts`.
- Pesan galat generik soal BU lain (spek BU keputusan 13); foto milik pengguna lain dijawab `VALIDATION` "Ada foto yang tidak dikenal atau sudah dipakai".
- Tiap tugas: tes dulu (gagal), implementasi, tes hijau, commit (pesan Indonesia, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Tes server: `bun run --cwd server test <jalur>` (butuh `bun run db:tunnel`; satu berkas bisa memakan beberapa menit); web: `cd web && bunx vitest run <jalur>`; shared: `cd shared && bun test <berkas>`. Bun: `export PATH="$HOME/.bun/bin:$PATH"`. Jangan menyentuh server dev pengguna (3000/8788).

## Keputusan rencana
- Job `serial_proof` dipasang **atomik di dalam `batch()` Simpan** (`insertJobStmt`, pola `serialAlertJobStmt`), sehingga tidak ada celah "commit tanpa job" dan penyapu penaut ulang di rancangan §6.3 **tidak diperlukan** (dihapus; jaring pengaman yang tak lagi punya skenario).
- Kolom `snapshot_json` diisi saat klaim; cap hanya membaca snapshot, tidak pernah membaca tabel lain.
- Pemilik `serialproof` mendapat cabang sendiri di `readFile` (aturan akses = BU serial seperti `serial`).

## Review Focus
1. Foto draft sudah disapu (> 7 hari) lalu Simpan: pesan jelas, entri tidak tersimpan setengah (Task A5).
2. Dua Simpan serentak merujuk foto yang sama: tepat satu menang, yang kalah gagal bersih (Task A5).
3. Gambar rusak, 1×1, sangat lebar, atau piksel ekstrem: `failed` dengan alasan, bukan server mati atau memori habis (Task A2, A6).
4. Proses mati di antara langkah job: tidak ada berkas Drive ganda dan tidak ada foto hilang (Task A6).
5. Foto bukti tidak pernah muncul di pustaka stiker, dan gambar pustaka stiker tidak dapat dipasang sebagai bukti (Task A4, A6).

---

## BAGIAN A: shared dan server

### Task A1: Skema, konstanta, dan repo foto bukti
**Files:** Create `server/migrations/0019_bukti_foto_qc.sql`, `server/src/modules/serial/proof/repo.ts`, `server/src/modules/serial/proof/repo.test.ts`, `server/src/modules/serial/proof/job.ts` (kerangka). Modify `shared/serials.ts`, `shared/files.ts` (tipe pemilik), `shared/contract.ts` (tipe DTO dan `JobKind`), `server/src/modules/jobs/consumer.ts` (`handlerOf`).
**Interfaces (Produces):**
- `shared/serials.ts`: `SERIAL_PROOF_LIMITS = { perEntryMax: 5, draftPerUserMax: 150, draftSweepDays: 7 }`, `SERIAL_PROOF_STATES = ['draft','queued','processing','done','failed'] as const`, `type SerialProofState`.
- `shared/files.ts`: `FileOwnerType` ditambah `'serialproof'`.
- `shared/contract.ts`: `SerialProofPhotoDto { id; state: SerialProofState; mime; size; width; height; filename; error: string | null }`; `UploadSerialProofInput { mime; bytes: Uint8Array; width: number; height: number }`; `GetSerialProofInput { id }`; `SerialProofContentDto { id; mime; bytes: Uint8Array; filename }`; `RemoveSerialProofInput { id }`; `RetrySerialProofInput { id }`; `SerialSummaryDto.hasProofPhotos: boolean`; `SerialEventDto.proofPhotos: SerialProofPhotoDto[]`; `SerialRowInput.proofPhotoIds?: string[]`; tiap varian `recheck`/`recheck_pass`/`recheck_fail` di `SerialActInput` mendapat `proofPhotoIds?: string[]`; `JobKind` ditambah `'serial_proof'` DI TUGAS INI bersama **kerangka** `proof/job.ts` (`export const serialProofHandler: JobHandler` yang `run` melempar `appError('INTERNAL', 'Belum diimplementasi')`) dan cabang `serial_proof` di `handlerOf` (`jobs/consumer.ts`), agar typecheck server tetap hijau (switch `handlerOf` tidak punya cabang bawaan) dan Task A5 dapat memasang baris job; Task A6 mengisi isinya.
- `proof/repo.ts` (semua menerima `Preparer`/`Env.DB`): `insertDraftStmt(db, row)`, `findProof(db, id)`, `countDraftsOf(db, email)`, `claimDraftStmts(db, { ids, email, serialId, eventId, snapshotJson })` (UPDATE ber-CAS `WHERE id=? AND state='draft' AND created_by=?`; baris terpengaruh 0 memicu `CAS_FAIL_SQL`), `setProofState(...)`, `listProofsByEvents(db, eventIds)`, `listStaleDrafts(db, beforeIso)`, `deleteProofStmt`.
Tabel `serial_proof_photos` persis kolom rancangan §6.1 (`id`, `serial_id`, `event_id`, `state` + `CHECK`, `created_by`, `created_at`, `mime`, `width`, `height`, `size`, `staged_name`, `snapshot_json`, `file_id`, `attempts`, `last_error`, `updated_at`), indeks (`state`,`updated_at`) dan (`event_id`).
- [ ] Tes: migrasi idempoten (jalankan dua kali); `claimDraftStmts` menolak (CAS gagal) foto milik orang lain, foto bukan `draft`, dan id ganda; `listProofsByEvents` memetakan baris ke DTO tanpa `staged_name`/`snapshot_json`.
- [ ] Tes gagal; implementasi; tes hijau (`bun run --cwd server test src/modules/serial/proof/repo.test.ts` dan `src/core/migrate.test.ts`); `bun run typecheck` (galat tipe di `web/` karena `SerialSummaryDto`/`SerialEventDto` baru dicatat, diperbaiki di Bagian B).
- [ ] Commit `feat(serial): skema dan kontrak foto bukti QC`.

### Task A2: Penggambar cap (fungsi murni)
**Files:** Create `server/src/modules/serial/proof/font.ts` (tabel glyph bitmap domain publik, ASCII 32-126), `png.ts`, `stamp.ts`, `stamp.test.ts`.
**Interfaces (Produces):**
- `export interface ProofSnapshot { serial; brand; model; buCode; locationName; actorName; actorTeam: 'qc' | 'service'; savedAt: string /* ISO */ }`
- `export function stampLines(snapshot: ProofSnapshot): string[]` (4 baris persis rancangan §5.3: `SN: …`, `<merk> <tipe>`, `<kode BU> · <lokasi>`, `Disimpan <tgl jam> WIB · <nama> (<tim>)`; huruf bersandi dilipat ke dasar via NFD, karakter lain `?`, kontrol dibuang).
- `export async function stampPhoto(input: { bytes: Uint8Array; snapshot: ProofSnapshot }): Promise<{ bytes: Uint8Array; mime: 'image/webp'; width: number; height: number }>`: `Bun.Image(bytes).png().bytes()` → buka filter PNG (kelima jenis; hanya 8-bit RGBA tak berinterlasi yang diterima, selain itu lempar galat) → footer hitam di BAWAH foto (tinggi bertambah) dengan huruf putih berskala menurut lebar (terbaca 640-4000 px), baris terlalu panjang dipotong `…` → PNG ulang (filter 0, `deflateSync`) → `Bun.Image(...).webp()`.
- `PROOF_MAX_PIXELS` (konstanta, 40 juta piksel): gambar melebihi dilempar `appError('VALIDATION', …)` SEBELUM inflate.
- [ ] Tes: `stampLines` (potong, lipat huruf, karakter non-Latin jadi `?`, waktu WIB dari ISO UTC); `stampPhoto` memakai gambar uji yang dibangkitkan di tes (`Bun.Image` dari PNG kecil di-resize 640×480 dan 4000×30, 1×1) dan memeriksa: tinggi hasil = tinggi asal + tinggi footer, piksel footer hitam, ada piksel putih di footer, piksel foto di atas footer tidak berubah (bandingkan sampel), masukan JPEG dan WebP sama-sama diterima, masukan sampah dilempar `VALIDATION`, piksel > `PROOF_MAX_PIXELS` ditolak tanpa mengalokasikan.
- [ ] Tes gagal; implementasi; tes hijau (`bun test server/src/modules/serial/proof/stamp.test.ts` lewat runner server).
- [ ] Commit `feat(serial): penggambar cap foto bukti (font bitmap, tanpa dependensi)`.

### Task A3: Penyimpanan sementara di disk dan konfigurasi
**Files:** Create `server/src/modules/serial/proof/store.ts`, `store.test.ts`. Modify `server/src/config.ts`, `server/src/core/env.ts`, `server/src/server.ts` (membuat store), `deploy/compose.yml`, `deploy/.env.example`, `server/.env.example`, `server/src/deploy-files.test.ts`, `server/test-support` (store sementara per `createTestEnv`).
**Interfaces (Produces):**
- `export interface ProofStore { write(name: string, bytes: Uint8Array): Promise<void>; read(name: string): Promise<Uint8Array | null>; remove(name: string): Promise<void>; totalBytes(): Promise<number> }`, `export function createProofStore(dir: string): ProofStore`, `export function newStagedName(): string` (UUID acak buatan server; nama berkas TIDAK pernah dari klien; `read/write/remove` menolak nama selain pola UUID untuk mencegah lintas jalur).
- `Env.PROOF_STORE?: ProofStore`; konfigurasi `PROOF_STAGING_DIR` (bawaan `./data/proofs` di dev, `/var/lib/qc/proofs` di compose dengan volume bernama baru `qc-proofs`) dan `PROOF_STAGING_MAX_BYTES` (bawaan 2 GiB).
- [ ] Tes: tulis/baca/hapus; nama tak valid (`../x`, kosong) ditolak; `totalBytes` benar; `loadConfig` membaca variabel; `deploy-files.test.ts` lulus dengan variabel baru di compose dan `.env.example`.
- [ ] Tes gagal; implementasi; tes hijau (`store.test.ts`, `src/deploy-files.test.ts`, `src/config.test.ts`).
- [ ] Commit `feat(serial): penyimpanan sementara foto bukti di disk server`.

### Task A4: Rute unggah, ambil, buang, dan coba lagi
**Files:** Create `server/src/modules/serial/proof/service.ts`, `proof/validate.ts`, `proof/rest.test.ts`. Modify `shared/api.ts`, `shared/contract.ts` (`ApiContract`), `shared/api.test.ts` (EXAMPLES), `server/src/modules/serial/routes.ts`, `server/src/http/body.test.ts`, `server/src/modules/files/service.ts` (`readFile`: cabang `serialproof`; `planAttachFiles`: pemilik `serialproof` tidak dapat dipasang lewat jalur lain, dijawab `VALIDATION` generik).
**Interfaces (Produces):**
- Rute: `serialProofs.upload` (`POST /serial-proofs`, `binary: 'request'`, query `width`/`height` seperti `files.upload`, `maxBytes` 10_485_760, `status: 201`, `location`), `serialProofs.get` (`GET /serial-proofs/{id}`, `binary: 'response'`, TANPA `etag` dan `download.cache: 'revalidate'`: isinya berubah dari foto asli menjadi hasil bercap pada id yang sama, jadi ETag `id` atau `immutable` akan menyajikan foto basi), `serialProofs.remove` (`DELETE /serial-proofs/{id}`), `serialProofs.retry` (`POST /serial-proofs/{id}/retry`). Izin: unggah/buang/coba lagi `serial: edit` (global; BU diperiksa saat tautan), `get` `serial: view` atau `serialservice: view`.
- `uploadProof(env, input, actor): Promise<SerialProofPhotoDto>` (tanda tangan byte, dimensi terbaca, kuota `draftPerUserMax`, batas total `PROOF_STAGING_MAX_BYTES`, tulis berkas lalu baris `draft`); `getProof(env, id, viewer): Promise<SerialProofContentDto>` (draft: hanya pembuat; `queued/processing/failed`: berkas sementara bila ada, aturan BU serial; `done`: lewat `readFile` Drive); `removeProof(env, id, actor)` (hanya `draft` milik sendiri, atau `failed` oleh pelaku/`serial: manage`); `retryProof(env, id, actor)` (hanya `failed` dengan berkas sementara masih ada: kembali `queued` + job baru dalam satu batch).
- [ ] Tes REST (`restClient`/`restCall`): unggah sah, tanda tangan palsu, ukuran kelewat, kuota 150 terlewati, disk penuh ditolak; ambil draft oleh orang lain = NOT_FOUND; ambil milik BU lain = NOT_FOUND; buang foto bukan draft ditolak; retry hanya `failed`; **pustaka stiker**: `stickerGuides.list` tidak memuat foto bukti, dan `planAttachFiles` menolak id foto bukti dari jalur item/QR/stiker; `body.test.ts` memuat rute unggah baru.
- [ ] Tes gagal; implementasi; tes hijau (`proof/rest.test.ts`, `src/http/body.test.ts`, `shared/api.test.ts`, `src/modules/files/files.test.ts`).
- [ ] Commit `feat(serial): rute unggah dan ambil foto bukti QC`.

### Task A5: Menautkan foto saat Simpan (Tambah dan Cek ulang)
**Files:** Create `server/src/modules/serial/proof/attach.ts`, `proof/attach.test.ts`. Modify `server/src/modules/serial/validate.ts` (baris `saveBatch` dan aksi `recheck*` menerima `proofPhotoIds`), `server/src/modules/serial/service.ts` (`createSerialOnce`), `server/src/modules/serial/act.ts`, `server/src/modules/serial/history.ts` dan `service.ts` (`toEvent`, `toSummary`: `proofPhotos`, `hasProofPhotos`), `server/src/modules/serial/repo.ts` (kolom/subkueri `hasProofPhotos`).
**Interfaces (Consumes):** A1 repo, A2 `ProofSnapshot`, `insertJobStmt`/`JOB_SYSTEM_ACTOR` (`modules/jobs`).
**Interfaces (Produces):** `export async function planProofAttach(env: Env, ids: readonly string[] | undefined, ctx: { user: UserContext; serialId: string; eventId: string; snapshot: Omit<ProofSnapshot, 'savedAt'>; now: string }): Promise<DbStatement[]>` — memvalidasi (maks. `perEntryMax`, tanpa id ganda, semua `draft` milik `user.email`; gagal = `VALIDATION` "Ada foto yang tidak dikenal atau sudah dipakai"; foto yang sudah disapu = `VALIDATION` "Foto sudah kedaluwarsa, unggah ulang"), lalu mengembalikan pernyataan klaim CAS (`snapshot_json` = snapshot ditambah `savedAt: ctx.now`, waktu server saat Simpan, jadi jam cap tidak bergantung kapan job berjalan) dan satu `serial_proof` job per foto (`input: { photoId }`). Pemanggil menaruhnya di `batch()` yang sama dengan `insertEventStmt`. Snapshot: `brand`/`model`/`buCode`/`locationName`/`actorName` dari data yang sudah dimuat pemanggil; lokasi = lokasi serial **sesudah kejadian** (cek ulang dari `transit` memakai `transit_to_location`).
- [ ] Tes: Simpan baris dengan 2 foto menaut keduanya (state `queued`, `event_id` terisi, 2 job `serial_proof` `queued`); Simpan ulang `clientId` sama tidak menaut dua kali; foto orang lain/sudah dipakai/ganda/> 5 ditolak dan **tidak ada entri tersimpan**; foto draft yang sudah disapu = pesan kedaluwarsa; **dua Simpan serentak (`Promise.all`) merujuk foto sama: tepat satu sukses**; `recheck`, `recheck_pass`, `recheck_fail` menaut foto, dan snapshot cek ulang dari `transit` memakai lokasi tujuan; `serials.act` dikirim ulang setelah balasan hilang gagal stale dan foto tetap `draft`; DTO: `hasProofPhotos` benar di daftar/detail dan `proofPhotos` ada di kejadian terkait (status campur `queued`/`done`).
- [ ] Tes gagal; implementasi; tes hijau (`proof/attach.test.ts`, `act-flow.test.ts`, `rest.test.ts`, `src/modules/serial` yang terdampak).
- [ ] Commit `feat(serial): menautkan foto bukti saat Simpan dan Cek ulang`.

### Task A6: Job `serial_proof`, pembersih draft, dan pembacaan berkas selesai
**Files:** Create `proof/job.test.ts`, `proof/sweep.ts`, `proof/sweep.test.ts`. Modify `server/src/modules/serial/proof/job.ts` (isi kerangka dari A1), `server/src/jobs/runner.ts` (`schedulerTick`: `sweepProofDrafts`), `server/src/modules/files/service.ts` (jika `readFile` perlu cabang `serialproof`; dikerjakan di A4, di sini dites untuk foto `done`).
**Interfaces (Produces):** `export const serialProofHandler: JobHandler` — langkah 0: baca berkas sementara + `stampPhoto` (snapshot dari baris) → tulis hasil bercap ke store (`<staged_name>.stamped`), state `processing`; langkah 1: unggah ke folder gambar Drive (nama `proof-<id>.webp`; sebelum unggah, bila langkah diulang cek `listFolder` nama itu dan pakai yang ada; simpan `driveId` ke `ctx.state` lewat `ctx.save()` segera); langkah 2: satu `batch()` menyisipkan baris `files` (pemilik `serialproof`, `owner_id` = id serial, `created_by` = pembuat foto), menandai foto `done` + `file_id`, lalu hapus berkas sementara. `onFail`: foto `failed` + `last_error` ringkas (tanpa jalur/rahasia), berkas asli dipertahankan untuk retry. `export async function sweepProofDrafts(env: Env): Promise<number>` menghapus berkas dan baris foto `draft` berumur > `draftSweepDays` hari; `queued/processing/failed` tidak pernah disapu.
- [ ] Tes: jalur sukses lewat `runPendingJobs` dengan klien Google palsu (`env.BRIDGE`): foto menjadi `done`, baris `files` benar, berkas sementara terhapus, unduhan lewat `serialProofs.get` melayani gambar bercap dengan tinggi lebih besar dari asal; **langkah unggah diulang** (simulasi gagal setelah unggah sebelum langkah 2) tidak membuat berkas Drive ganda; **Drive mati** diulang lalu `failed` setelah `JOB_MAX_ATTEMPTS`, lalu `serialProofs.retry` memproses ulang sampai `done`; gambar rusak/piksel ekstrem = `failed` dengan alasan (bukan job macet); `sweepProofDrafts` membuang draft > 7 hari dan tak menyentuh yang lain; foto bukti tidak muncul di `stickerGuides.list` dan tidak ada baris di `sticker_guide_images`.
- [ ] Tes gagal; implementasi; tes hijau (`proof/job.test.ts`, `proof/sweep.test.ts`, `src/jobs/runner.test.ts`).
- [ ] Commit `feat(serial): job cap dan unggah foto bukti, pembersih draft`.

## BAGIAN B: web

### Task B1: Kamera foto, adaptor sumber, dan field foto
**Files:** Create `web/src/modules/serial/lib/use-photo-camera.ts` (+ tes), `web/src/modules/serial/lib/proof-source.ts` (+ tes), `web/src/modules/serial/components/proof-photo-field.tsx` (+ tes), `web/src/modules/serial/components/proof-camera-tab.tsx`. Modify `web/src/components/file-dialog/` (prop opsional `cameraTab?: ReactNode`/slot tab kamera tanpa mengubah perilaku pemakai lain), `web/src/modules/serial/queries.ts` (`useUploadProof`, `proofKeys`), dan fixture tes web yang membangun `SerialSummaryDto`/`SerialEventDto` (field baru `hasProofPhotos`/`proofPhotos` wajib; typecheck web harus kembali hijau di tugas ini).
**Interfaces (Produces):** `usePhotoCamera({ enabled }): { videoRef; state: CameraState; capture(): Promise<File | null> }` memakai `classifyCameraError`/`CAMERA_ERROR_TEXT`/`cameraSupported` dari `use-camera-scanner.ts`; `proofSource: FileLibrarySource` (hanya `upload`; `list/rename/remove` melempar karena `showLibrary={false}`); `ProofPhotoField({ value: ProofPhotoRef[]; onChange; max: number; disabled?: boolean })` dengan `ProofPhotoRef { id; mime; size; thumbUrl }`: tombol "Foto" (jumlah), membuka `FileDialog` (`showLibrary={false}`, tab Unggah + tab Kamera), unggah lewat `prepareImage` + `serialProofs.upload`, kisi kecil dengan tombol buang (memanggil `serialProofs.remove`), batas `max`.
- [ ] Tes: tanpa tab Pustaka; kamera ditolak/tak ada menampilkan pesan dan "Telusuri" tetap ada; "Ambil foto" beberapa kali menambah ke antrean; batas 5 menonaktifkan tombol; buang memanggil rute hapus; galat unggah tampil per foto.
- [ ] Tes gagal; implementasi; tes hijau; `bunx biome check --write` pada berkas tersentuh.
- [ ] Commit `feat(serial-web): field foto bukti dengan kamera langsung`.

### Task B2: Kolom Foto di Tambah Serial Number
**Files:** Modify `web/src/modules/serial/lib/draft.ts` (`StagingRow.proofPhotos: ProofPhotoRef[]`, `toRowInput` mengirim `proofPhotoIds`), `draft-store.ts` (muat/simpan, draf lama tanpa field = `[]`), `components/staging-table.tsx` (kolom/tombol Foto), `components/record-page.tsx` (menangani galat foto kedaluwarsa per baris; "Kosongkan draft" dan hapus baris memanggil `serialProofs.remove` upaya terbaik), tes terkait.
- [ ] Tes: baris dengan foto mengirim `proofPhotoIds`; draf lama tetap terbaca; hapus baris dan Kosongkan draft memanggil hapus foto; respons `VALIDATION` "Foto sudah kedaluwarsa" menandai baris dengan pesan dan foto dibuang dari baris (baris tetap di draft); `.qcsn` tidak membawa foto (ekspor tak memuat, impor menghasilkan baris tanpa foto).
- [ ] Tes gagal; implementasi; tes hijau (`record-page*.test.tsx`, `staging-table.test.tsx`, `draft*.test.ts`).
- [ ] Commit `feat(serial-web): kolom foto bukti di tabel draft`.

### Task B3: Field foto di dialog Cek ulang
**Files:** Modify `web/src/modules/serial/components/act-dialog.tsx` (state `proofPhotos`, `ProofPhotoField` untuk `kind === 'recheck'`, `buildInput` menyertakan `proofPhotoIds` pada `recheck`/`recheck_pass`/`recheck_fail`), `act-dialog.test.tsx`.
- [ ] Tes: field hanya ada pada Cek ulang (tidak pada Kirim/Terima/Diagnosis/Catatan/Lapor); `proofPhotoIds` terkirim bila ada foto dan tidak ada bila kosong; galat kedaluwarsa tampil di dialog.
- [ ] Tes gagal; implementasi; tes hijau.
- [ ] Commit `feat(serial-web): foto bukti pada cek ulang`.

### Task B4: Badge dan kisi foto
**Files:** Create `web/src/modules/serial/components/proof-badge.tsx`, `proof-gallery.tsx` (+ tes). Modify `serial-list-page.tsx` (badge di baris bila `hasProofPhotos`), `serial-detail-page.tsx` (badge di kepala), `timeline.tsx` (kisi pada kartu `recorded`/`recheck*` bila `event.proofPhotos.length > 0`), tes terkait.
**Interfaces:** `ProofBadge()` ("Bukti foto QC"); `ProofGallery({ photos: SerialProofPhotoDto[]; canRetry: boolean })`: kisi gambar kecil (`serialProofs.get`), label "menunggu cap" untuk `queued/processing`, "gagal" + tombol "Coba lagi" (`serialProofs.retry`) dan "Buang" untuk `failed`, klik membuka tampilan besar, tombol unduh `bukti-<8 id>.webp`. Jangan tampilkan di halaman publik (`public-report-page.tsx` tidak berubah).
- [ ] Tes: badge tampil di daftar/detail/kartu hanya bila ada foto; status campur tampil benar; retry/buang memanggil rute lalu memuat ulang; halaman publik tidak memuat foto bukti (tes `public-report-page` dengan kejadian berfoto).
- [ ] Tes gagal; implementasi; tes hijau; seluruh tes web serial (`bunx vitest run src/modules/serial`).
- [ ] Commit `feat(serial-web): badge dan kisi foto bukti QC`.

## BAGIAN C: dokumen dan verifikasi akhir

### Task C1: Dokumen dan verifikasi
**Files:** Modify `docs/superpowers/specs/2026-11-12-serial-number-design.md` (butir keputusan baru bernomor lanjutan + penyesuaian §4/§5 yang menyebut lampiran), `CLAUDE.md` (paragraf Serial Number: rute `serialProofs.*`, tabel, pemilik `serialproof`, volume `qc-proofs`, job, sapuan), `docs/ci-cd.md` dan `docs/deploy-vps.md` (prasyarat manual: salin `deploy/compose.yml`, buat volume dan isi `.env` di VPS SEBELUM push yang men-deploy; migrasi 0019 tanpa rollback ke image lama yang tak mengenal tabel), `docs/superpowers/specs/2026-11-16-serial-bukti-foto-qc-design.md` (catat deviasi: penyapu penaut ulang dihapus, job atomik).
- [ ] `bun run typecheck` hijau di semua area; `bunx biome check .` tanpa galat baru; seluruh tes web (`cd web && bunx vitest run`), tes shared, dan tes server modul `serial`, `files`, `jobs`, `http/body`, `deploy-files`, `config` hijau; `bun run build` (`verify-dist`, potongan JS terbesar <= 600 KB gzip; laporkan ukurannya).
- [ ] Verifikasi manual terhadap browser dan Google sungguhan **tidak dapat dilakukan agen**; tuliskan sebagai sisa uji pemilik (kamera ponsel, unggah nyata ke Drive, tampilan cap, volume di VPS).
- [ ] Commit `docs(serial): bukti foto QC (spek, CLAUDE.md, prasyarat penyebaran)`.
