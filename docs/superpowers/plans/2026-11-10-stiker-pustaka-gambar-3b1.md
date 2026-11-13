# Stiker 3b-1: Pustaka Gambar dan Dialog Berkas Umum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pustaka gambar khusus instruksi stiker (unggah, kisi thumbnail, cari/urut/filter, ganti nama, hapus), dialog berkas umum yang dapat dipakai ulang, dan halaman Pustaka Gambar di menu Stiker.

**Architecture:** Server: tabel `sticker_guide_images` (nama, kunci nama, thumbnail biner) + satu baris `files` per gambar (pemilik `stickerguide`, `owner_id` = id sendiri), rute REST `stickerGuides.*`. Web: komponen dialog umum di `web/src/components/file-dialog/` yang hanya mengenal antarmuka `FileLibrarySource`; adaptor stiker di `web/src/modules/sticker/` mengisinya; halaman memakai komponen yang sama.

**Tech Stack:** Bun + Hono + MariaDB (server), React + TanStack Query/Router + shadcn (web), zod tidak dipakai di server (validator `readObject`), Vitest + Testing Library (web), `bun test` + MariaDB nyata lewat terowongan (server).

**Spec:** `docs/superpowers/specs/2026-11-09-stiker-pustaka-gambar-3b1-design.md` (DISETUJUI pemilik 2026-11-10). Spek induk: `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md` §6.

## Global Constraints
- Batas (satu sumber di `shared/stickers.ts`, `GUIDE_LIMITS`): `libraryMax` 2000, `nameMax` 120, `batchMax` 20, `pageDefault` 40, `pageMax` 100, `thumbMaxBytes` 40_960 (batas keras server), `thumbTargetBytes` 30_720, `thumbSide` 320 (sisi terpanjang target klien), `thumbMaxSide` 400 (batas server). Gambar penuh: `MAX_IMAGE_BYTES` 10_485_760 (terima server), klien mengecilkan lewat `prepareImage` (sisi `MAX_IMAGE_SIDE`, target 1 MB).
- Format gambar: JPEG, PNG, WebP saja. Thumbnail: WebP atau JPEG (tanda tangan byte divalidasi).
- Izin (tanpa modul baru): baca (daftar, thumbnail, gambar penuh) = `item: view` ATAU `sticker: view`; unggah = `item: edit`; ganti nama dan hapus = pengunggah yang masih `item: edit`, atau `item: manage`. Level `item` cukup di BU mana pun (`globalBuLevel`; di rute cukup `{ module: 'item', level: ... }`). Tanpa pembatasan BU.
- Migrasi expand-only dan idempoten (`0006_pustaka_gambar_stiker.sql`); jangan menyunting migrasi lama.
- Nama disimpan tanpa ekstensi, dipangkas, tidak kosong, maks. 120, boleh kembar; `name_key` = `LOWER(name)`. Pencarian meloloskan `%`, `_`, `\`.
- Galat versi/konflik: `appError('CONFLICT', ...)`; pustaka penuh: pesan `Pustaka gambar penuh (2.000 gambar)`.
- Pesan galat dan teks UI berbahasa Indonesia. Rute thumbnail memakai cache `immutable` (server memberi `private, max-age=31536000, immutable`).
- `CLAUDE.md` memuat aturan proyek; ikuti: Db `prepare/bind`, parameter `?`, `batch()` = satu transaksi, kolom `key`/`before`/`after` berbacktick, `Number()` untuk `COUNT/SUM`.

## Review Focus
1. **Format dan ukuran di klien**: HEIC/GIF/PDF dari ponsel, berkas > 10 MB, dan campuran sah+tak sah dalam satu seretan harus ditolak jelas per berkas (dengan nama dan alasan), tidak diam-diam dibuang dan tidak menggagalkan berkas lain.
2. **Unggah sebagian gagal dan ulang**: yang sukses tidak diunggah ulang, "Lampirkan" ditekan dua kali tidak membuat gambar ganda, dialog tetap terbuka bila ada yang gagal.
3. **Kebocoran akses**: pengguna tanpa `item: view`/`sticker: view` tidak membaca daftar, thumbnail, atau gambar penuh; id berkas item/logo/stiker lewat rute thumbnail = `NOT_FOUND`; gambar pustaka tidak dapat dipasang sebagai gambar item/QR/stiker (`planAttachFiles` menolak).
4. **Balapan batas 2.000**: unggahan serentak pada 1.999 gambar menghasilkan tepat satu keberhasilan.
5. **Pencarian dan kursor**: nama berisi `%`, `_`, `\`, emoji, spasi ganda; kursor rusak/kedaluwarsa tidak menjatuhkan server (diperlakukan sebagai tanpa kursor atau `VALIDATION`); halaman kosong; ganti nama saat menggulir tidak merusak daftar.

## File Structure
- Shared: `shared/stickers.ts` (+`GUIDE_LIMITS`, `GUIDE_SORTS`, `guideNameFromFile`), `shared/files.ts` (+`'stickerguide'`), `shared/contract.ts`, `shared/api.ts`.
- Server: `server/migrations/0006_pustaka_gambar_stiker.sql`, `server/src/modules/sticker/guide-repo.ts`, `guide-service.ts`, `guide-validate.ts`, `guide-routes.ts` (didaftarkan di `routes.ts`), tes `guide.test.ts`; ubah `server/src/modules/files/service.ts` (+cabang baca `stickerguide`).
- Web: `web/src/modules/files/thumbnail.ts`, `web/src/components/ui/tabs.tsx` (shadcn), `web/src/components/file-dialog/{types,accept,use-upload-queue,file-drop-zone,upload-tab,library-tab,file-dialog,index}.ts(x)`, `web/src/modules/sticker/lib/guide-source.ts`, `keys.ts`/`queries.ts` (+pustaka), `web/src/modules/sticker/components/guide-library-page.tsx`, `web/src/routes/_app/sticker/library.tsx`, `web/src/app/navigation.ts`.
- Docs: `CLAUDE.md`.

---

### Task 1: Kontrak bersama (shared)
**Model: Haiku** (spesifikasi lengkap).

**Files:** Modify `shared/stickers.ts`, `shared/files.ts`, `shared/contract.ts`, `shared/api.ts`; Test `shared/stickers.test.ts`, `shared/api.test.ts`.

**Interfaces — Produces:**
```ts
// shared/stickers.ts
export const GUIDE_LIMITS = { libraryMax: 2000, nameMax: 120, batchMax: 20, pageDefault: 40, pageMax: 100,
  thumbMaxBytes: 40_960, thumbTargetBytes: 30_720, thumbSide: 320, thumbMaxSide: 400 } as const;
export const GUIDE_SORTS = ['newest', 'oldest', 'nameAsc', 'nameDesc', 'sizeDesc'] as const;
export type GuideSort = (typeof GUIDE_SORTS)[number];
export function guideNameFromFile(filename: string): string; // buang ekstensi terakhir, rapikan spasi, potong nameMax; kosong -> 'Gambar'
// shared/files.ts: FileOwnerType = 'item' | 'qrlogo' | 'sticker' | 'stickerguide'
// shared/contract.ts
export interface StickerGuideDto { id: string; name: string; mime: string; size: number; width: number; height: number;
  uploadedBy: string; uploadedByMe: boolean; createdAt: string; usageCount: number; canRename: boolean; canRemove: boolean }
export interface ListStickerGuidesInput { search?: string; sort?: GuideSort; mine?: boolean; unused?: boolean; cursor?: string; limit?: number }
export interface StickerGuidePageDto { items: StickerGuideDto[]; nextCursor: string | null }
export interface UploadStickerGuideInput { name: string; mime: string; thumbMime: string; width: number; height: number; image: Uint8Array; thumbnail: Uint8Array }
export interface RenameStickerGuideInput { id: string; name: string }
export interface RemoveStickerGuideInput { id: string }
export interface GetStickerGuideThumbInput { id: string }
// ApiContract: 'stickerGuides.list' (->StickerGuidePageDto) | '.upload' (->StickerGuideDto) | '.rename' (->StickerGuideDto)
//   | '.remove' (->{ id: string }) | '.thumbnail' (->FileContentDto)
// shared/api.ts API_ROUTES:
//  list: GET /sticker-guides, query {search:'string', sort:'string', mine:'boolean', unused:'boolean', cursor:'string', limit:'number'}
//  upload: POST /sticker-guides, status 201, query {name:'string', mime:'string', thumbMime:'string', width:'number', height:'number'},
//          binary 'multipart', multipart {parts:['image','thumbnail'], maxBytes: 10_592_256 /* = MAX_IMAGE_BYTES + thumbMaxBytes + 65_536 */, tooLarge:'Ukuran gambar maksimal 10 MB'}
//  rename: PATCH /sticker-guides/{id};  remove: DELETE /sticker-guides/{id}
//  thumbnail: GET /sticker-guides/{id}/thumbnail, etag 'id', binary 'response', download {bytesField:'bytes', mimeField:'mime', echo:['id'], cache:'immutable'}
```
- [ ] **Step 1:** Tes gagal: `guideNameFromFile('Foto Kardus.PNG') === 'Foto Kardus'`, `'a.b.c.jpg' -> 'a.b.c'`, `'  .png' -> 'Gambar'`, `'x'.repeat(200)+'.jpg'` terpotong 120, spasi ganda dirapikan; `api.test.ts`: maxBytes multipart literal = `MAX_IMAGE_BYTES + GUIDE_LIMITS.thumbMaxBytes + 65_536`; semua id baru terdaftar di `ApiContract` dan `API_ROUTES`. Jalankan: `bun run --cwd shared test` atau berkas spesifik; Expected: FAIL.
- [ ] **Step 2:** Implementasikan sesuai blok Interfaces (route DELETE/PATCH/multipart memakai pola entri yang ada; `typecheck` memaksa `RouteTable` server melengkapi id baru, jadi Task 2-4 menutup celah itu; tambahkan stub sementara TIDAK perlu bila typecheck server dijalankan setelah Task 4).
- [ ] **Step 3:** Jalankan tes shared sampai lulus; `bun run typecheck` boleh gagal HANYA pada `RouteTable` server (dilengkapi Task 2-4). Komit: `feat(shared): kontrak pustaka gambar stiker 3b-1`.

---

### Task 2: Migrasi, repo, dan sisi baca server (daftar + thumbnail)
**Model: Sonnet.**

**Files:** Create `server/migrations/0006_pustaka_gambar_stiker.sql`, `server/src/modules/sticker/guide-repo.ts`, `guide-validate.ts`, `guide-routes.ts`, `guide-service.ts` (bagian baca), `guide.test.ts`; Modify `server/src/modules/sticker/routes.ts` (gabungkan `guideRoutes()` ke `stickerRoutes()` atau daftarkan setara; `RouteTable` memaksa lengkap).

**Interfaces — Produces:**
```sql
CREATE TABLE IF NOT EXISTS sticker_guide_images (
  id VARCHAR(100) NOT NULL,            -- = files.id
  name VARCHAR(255) NOT NULL DEFAULT '',
  name_key VARCHAR(255) AS (LOWER(name)) VIRTUAL,
  thumb_mime VARCHAR(32) NOT NULL DEFAULT '',
  thumb MEDIUMBLOB NOT NULL,
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id), KEY sticker_guide_images_name (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
```
```ts
// guide-repo.ts
export function listGuidesStatement(db: Preparer, q: { search: string; sort: GuideSort; mine: string | null /*email*/; unused: boolean; cursor: GuideCursor | null; limit: number }): DbStatement; // limit+1 baris; ORDER BY kunci urut + id (kursor kunci: tidak ada duplikat/lompatan saat unggahan baru)
export function encodeGuideCursor(sort: GuideSort, row: GuideRow): string;
export function parseGuideCursor(sort: GuideSort, text: string): GuideCursor | null; // rusak -> null
export function guideThumbStatement(db: Preparer, id: string): DbStatement; // join files: hanya owner_type='stickerguide' AND status='active'
export function guideUsageCountSql(): string; // SATU tempat; kini mengembalikan '0' (3b-2 menggantinya)
// guide-service.ts
export function listGuides(env: Env, input: ListStickerGuidesInput, actor: UserContext): Promise<StickerGuidePageDto>;
export function readGuideThumb(env: Env, input: GetStickerGuideThumbInput): Promise<FileContentDto>; // NOT_FOUND bila bukan gambar pustaka aktif
```
- Daftar menggabungkan `files` (ukuran, dimensi, `created_at`, `created_by`) dan `users` (nama tampilan via email; tak ketemu -> `'Pengguna'`; JANGAN mengirim email). `canRename`/`canRemove` dihitung dari `actor` (`item: edit` + pengunggah, atau `item: manage`). Filter `mine` = `created_by = actor.email`; `unused` memakai `guideUsageCountSql()`.
- Rute (di `guide-routes.ts`): `stickerGuides.list` & `.thumbnail` dengan `permission: { anyOf: [{ module: 'item', level: 'view' }, { module: 'sticker', level: 'view' }] }`. Validator `guide-validate.ts`: `limit` 1..`pageMax` (bawaan `pageDefault`), `sort` ∈ `GUIDE_SORTS` (bawaan `newest`), `search` maks. 120 (dipangkas), `cursor` string opsional.

- [ ] **Step 1:** Tes gagal di `guide.test.ts` (pola `rest.test.ts` stiker: `createTestEnv`, `seedRole/seedUser`, `app.request`): (a) 401 tanpa sesi, 403 tanpa izin, 200 untuk `item: view` saja dan `sticker: view` saja; (b) paginasi `limit=2` atas 5 baris: dua halaman berurutan tanpa duplikat, lalu `nextCursor: null`; sisipkan baris baru di antara halaman -> tidak menggandakan/melewatkan (urut `newest`); (c) tiap `sort` mengurutkan benar (baris dibuat langsung lewat repo/SQL tes); (d) `search` `100%` dan `a_b` dan `\` hanya cocok harfiah; (e) `mine` dan `unused`; (f) kursor rusak = halaman pertama atau `VALIDATION` (pilih satu, tes menetapkannya); (g) thumbnail: byte + `Content-Type` tetap + `Cache-Control` memuat `private` dan `immutable`; id berkas item/logo = 404; (h) DTO tidak memuat email. Jalankan `bun run --cwd server test src/modules/sticker/guide.test.ts`; Expected: FAIL.
- [ ] **Step 2:** Tulis migrasi, repo, validator, servis baca, rute; daftarkan. Pembuatan baris uji: helper kecil di tes yang menyisipkan baris `files` (pemilik `stickerguide`) + baris pustaka.
- [ ] **Step 3:** Tes lulus (terowongan `bun run db:tunnel` hidup). Biome + typecheck server (typecheck boleh gagal HANYA karena id `stickerGuides.upload|rename|remove` belum punya rute; ditutup Task 3-4). Komit: `feat(server): daftar dan thumbnail pustaka gambar stiker`.

---

### Task 3: Unggah ke pustaka (server)
**Model: Sonnet.**

**Files:** Modify `guide-service.ts`, `guide-validate.ts`, `guide-repo.ts`, `guide-routes.ts`; Test `guide.test.ts`; Modify `server/src/test-support` bila perlu helper multipart (lihat `server/test-support/rest-client.ts` dan `qrcode/rest-binary.test.ts` untuk pola multipart).

**Interfaces — Produces:**
```ts
export function validateUploadGuide(raw: unknown): UploadStickerGuideInput; // name wajib (dipangkas, <= nameMax), mime ∈ IMAGE_MIME_TYPES, thumbMime ∈ {image/webp,image/jpeg}, width/height bilangan bulat 1..MAX_IMAGE_DIMENSION, image <= MAX_IMAGE_BYTES dan tanda tangan cocok mime (matchesImageBytesSignature), thumbnail <= thumbMaxBytes, tanda tangan cocok, tak kosong
export function uploadGuide(env: Env, input: UploadStickerGuideInput, actor: UserContext): Promise<StickerGuideDto>;
```
- Rute `stickerGuides.upload`: izin `{ module: 'item', level: 'edit' }`.
- Urutan seperti `files/service.ts#uploadFile`: Drive dulu (`ensureDriveFolder`, `bridge.createFile`), lalu SATU `batch()` yang memuat penjaga batas, `insertFileStmt` (`ownerType: 'stickerguide'`, `ownerId` = id berkas, tanpa menghitung "unggahan yatim"), dan penyisipan baris pustaka. Bila basis data gagal setelah Drive sukses: `trashFile` + `dropCachedFile` best-effort lalu `INTERNAL` (pola yang ada). Penjaga batas: bila jumlah baris pustaka >= `GUIDE_LIBRARY_MAX` -> `CONFLICT` `Pustaka gambar penuh (2.000 gambar)`, DAN berkas Drive dibuang. Penjaga harus kebal balapan (CAS di `batch()` memakai `CAS_FAIL_SQL`/`isGuardFailure`, atau transaksi dengan kunci); tes menetapkannya.

- [ ] **Step 1:** Tes gagal: (a) 201 + DTO (`usageCount: 0`, `uploadedByMe: true`, nama dirapikan; baris `files` berpemilik `stickerguide`); `item: edit` saja boleh, `sticker: edit` saja 403, `item: view` 403; (b) tanda tangan palsu (PNG berisi byte teks) = `VALIDATION`; thumbnail > 40 KB = `VALIDATION`; thumbnail bertanda tangan GIF = `VALIDATION`; nama kosong/spasi = `VALIDATION`; mime di luar daftar = `VALIDATION`; (c) kegagalan basis data setelah Drive: Drive dibersihkan (`env.BRIDGE` palsu memeriksa `trashFile`) dan tidak ada baris tersisa; (d) pustaka terisi `GUIDE_LIBRARY_MAX` (sisipkan massal lewat SQL) -> `CONFLICT`, Drive dibersihkan; (e) **balapan**: pada `libraryMax - 1` baris, `Promise.all` atas 3 unggahan -> tepat 1 sukses, 2 `CONFLICT`; (f) gambar pustaka tidak dapat dipasang sebagai gambar item/QR/stiker: `planAttachFiles(env, [id], 'sticker'|'item', ...)` melempar (tes langsung pada fungsi). Expected: FAIL.
- [ ] **Step 2:** Implementasikan. `MAX_UNATTACHED_UPLOADS` TIDAK berlaku untuk jalur ini.
- [ ] **Step 3:** Tes lulus; `bun run --cwd server test src/http/body.test.ts` tetap lulus (batas badan global bertambah otomatis; `deploy-files.test.ts` menjaga nginx 11m >= batas — jalankan sendiri). Komit: `feat(server): unggah gambar pustaka stiker dengan batas 2.000`.

---

### Task 4: Ganti nama, hapus, dan akses baca gambar penuh (server)
**Model: Sonnet.**

**Files:** Modify `guide-service.ts`, `guide-validate.ts`, `guide-routes.ts`, `server/src/modules/files/service.ts` (+ tes `files.test.ts` bila ada pola), Test `guide.test.ts`.

**Interfaces — Produces:**
```ts
export function renameGuide(env: Env, input: RenameStickerGuideInput, actor: UserContext): Promise<StickerGuideDto>;
export function removeGuide(env: Env, input: RemoveStickerGuideInput, actor: UserContext): Promise<{ id: string }>;
// files/service.ts: FileViewer tetap; cabang readFile: ownerType 'stickerguide' terbaca bila viewer.canReadStickerFiles (sudah = sticker:view atau item:view)
```
- Izin rute `rename` dan `remove`: `{ module: 'item', level: 'edit' }`; handler menolak (`FORBIDDEN`) bila bukan pengunggah dan bukan `item: manage`. Id bukan gambar pustaka aktif = `NOT_FOUND`.
- Rename: terakhir-menang, `writeAudit` aksi `stickerGuide.rename` (before/after nama) dalam SATU `batch()` dengan UPDATE; nama baru divalidasi sama seperti unggah.
- Remove: bila `usageCount > 0` -> `CONFLICT` `Gambar masih dipakai`; jika tidak, SATU `batch()` berisi `markFilesPendingDelete` + `DELETE` baris pustaka + `writeAudit` aksi `stickerGuide.remove`, lalu `purgePendingFiles` (jalur yang ada). Tes memeriksa audit.
- `readFile`: di cabang `viewer.itemBuIds === null` tambahkan `isGuide = record.ownerType === 'stickerguide' && viewer.canReadStickerFiles`; di cabang `itemBuIds !== null` jenis pemilik non-`item` sudah lolos. `files.get` untuk pemilik `stickerguide` TIDAK dibatasi BU.

- [ ] **Step 1:** Tes gagal: rename oleh pengunggah (`item: edit`) 200 + audit; rename gambar orang lain oleh `item: edit` 403, oleh `item: manage` 200; nama tak valid `VALIDATION`; hapus: pengunggah sukses (baris `files` hilang/`pending_delete`, Drive dibuang, audit tertulis); gambar orang lain 403 untuk `edit`, sukses untuk `manage`; id tak ada 404; `files.get` untuk gambar pustaka: `sticker: view` saja 200, `item: view` saja 200, tanpa keduanya 403/404, pengguna `item` di BU lain tetap 200; gambar pustaka terbaca bahkan oleh pemegang `item: view` yang tak punya BU di mana pun (tak dibatasi BU). Expected: FAIL.
- [ ] **Step 2:** Implementasikan.
- [ ] **Step 3:** `bun run --cwd server test src/modules/sticker src/modules/files` lulus; typecheck server bersih (semua id `ApiContract` kini terisi). Komit: `feat(server): ganti nama, hapus, dan baca gambar penuh pustaka stiker`.

---

### Task 5: Pembuat thumbnail dan tabs shadcn (web)
**Model: Sonnet.**

**Files:** Create `web/src/modules/files/thumbnail.ts`, `web/src/modules/files/thumbnail.test.ts`; Add `web/src/components/ui/tabs.tsx` (`bunx --bun shadcn@latest add tabs` dari folder `web/`).

**Interfaces — Produces:**
```ts
// thumbnail.ts
export interface ThumbnailPlan { side: number; mime: 'image/webp' | 'image/jpeg'; quality: number }
export function thumbnailPlans(): ThumbnailPlan[]; // murni: urutan percobaan: sisi [320,240,160] x format [webp, jpeg] x kualitas [0.8,0.6,0.4]
export async function prepareThumbnail(source: ImageBitmap | Blob | File): Promise<{ mime: string; bytes: Uint8Array }>;
// mencoba tiap rencana sampai blob <= GUIDE_LIMITS.thumbTargetBytes dan tipe blob == mime rencana (peramban yang jatuh balik ke PNG dilewati); gagal semua -> Error('Thumbnail gagal dibuat')
```
- [ ] **Step 1:** Tes gagal untuk bagian murni: `thumbnailPlans()` mulai dari 320 px WebP, memuat JPEG, dan berakhir di 160 px; tidak ada rencana dengan sisi > `thumbMaxSide`. Expected: FAIL.
- [ ] **Step 2:** Implementasikan memakai `fitWithin` dan pola canvas `prepareImage` (`web/src/modules/files/image.ts`). Bagian canvas diverifikasi manual (jsdom tanpa canvas); catat di komentar.
- [ ] **Step 3:** Tes lulus, Biome, typecheck. Komit: `feat(web): pembuat thumbnail dan komponen tabs`.

---

### Task 6: Lapisan data web dan adaptor sumber stiker
**Model: Sonnet.**

**Files:** Modify `web/src/modules/sticker/keys.ts`, `web/src/modules/sticker/queries.ts`; Create `web/src/components/file-dialog/types.ts`, `web/src/modules/sticker/lib/guide-source.ts`, tes `web/src/modules/sticker/lib/guide-source.test.ts`.

**Interfaces — Produces:**
```ts
// web/src/components/file-dialog/types.ts (umum, tanpa kata "stiker")
export type LibrarySort = 'newest' | 'oldest' | 'nameAsc' | 'nameDesc' | 'sizeDesc';
export interface LibraryQuery { search: string; sort: LibrarySort; mine: boolean; unused: boolean }
export interface LibraryItem { id: string; name: string; size: number; width: number; height: number; uploadedBy: string;
  createdAt: string; usageCount: number; canRename: boolean; canRemove: boolean; thumbUrl: string; previewUrl: string }
export interface LibraryPage { items: LibraryItem[]; nextCursor: string | null }
export interface FileLibrarySource {
  key: string;                                  // awalan kunci cache TanStack Query
  mimeTypes: readonly string[];                 // format yang didukung sumber
  list(query: LibraryQuery, cursor: string | null, signal?: AbortSignal): Promise<LibraryPage>;
  upload(file: File, name: string): Promise<LibraryItem>;   // pembuatan thumbnail/pengecilan terjadi DI DALAM adaptor
  rename(id: string, name: string): Promise<LibraryItem>;
  remove(id: string): Promise<void>;
}
// guide-source.ts
export const stickerGuideSource: FileLibrarySource;  // key: 'sticker-guides'; mimeTypes = IMAGE_MIME_TYPES
export function guideThumbUrl(id: string): string;   // `${API_BASE}/sticker-guides/${id}/thumbnail`
export function guidePreviewUrl(id: string): string; // `${API_BASE}/files/${id}`
```
- Pemetaan `StickerGuideDto` -> `LibraryItem` (URL diturunkan dari id). `upload`: `prepareImage(file)` (+`prepareThumbnail` dari bitmap yang sama atau dari file) lalu `api('stickerGuides.upload', {...})`. Gunakan konstanta basis URL yang sudah ada di `web/src/lib/api` (cari `/api/v1`); jangan menulis ulang literal bila konstanta ada.
- `<img src>` langsung memakai cookie sesi; Task 7 dan 10 memverifikasi di peramban bahwa thumbnail termuat dan ter-cache (tab Network: `304`/`from disk cache` pada muat ulang).
- [ ] **Step 1:** Tes gagal (mock `api`): `list` meneruskan `search/sort/mine/unused/cursor` dan memetakan URL; `rename`/`remove` memanggil id yang benar; `upload` memanggil `prepareImage` lalu `prepareThumbnail` (keduanya di-mock) dan mengirim `name/mime/thumbMime/width/height/image/thumbnail`.
- [ ] **Step 2:** Implementasikan; tambah `stickerKeys.guides`. Biome, typecheck. Komit: `feat(web): adaptor sumber pustaka gambar stiker`.

---

### Task 7: Dialog berkas umum, bagian unggah (`accept`, drop-zone, antrean)
**Model: Sonnet.**

**Files:** Create `web/src/components/file-dialog/accept.ts`, `use-upload-queue.ts`, `file-drop-zone.tsx`, `upload-tab.tsx` + tes bersebelahan (`*.test.ts(x)`).

**Interfaces — Produces:**
```ts
// accept.ts
export type FileCategory = 'image';                              // kategori baru ditambah di sini saja
export function resolveAccept(categories: readonly FileCategory[], supported: readonly string[]): string[]; // 'image' -> mime berawalan 'image/' dalam supported
export function checkFile(file: { name: string; size: number; type: string }, rule: { accept: readonly string[]; maxBytes: number }): string | null; // alasan Indonesia atau null
// use-upload-queue.ts
export type QueueStatus = 'waiting' | 'uploading' | 'done' | 'failed';
export interface QueueEntry { key: string; file: File; name: string; status: QueueStatus; error: string | null; result: LibraryItem | null }
export function useUploadQueue(options: { source: FileLibrarySource; accept: readonly string[]; maxBytes: number; maxFiles: number /* GUIDE_LIMITS.batchMax */; concurrency?: number /* 3 */ }): {
  entries: QueueEntry[]; rejected: { name: string; reason: string }[];
  add(files: File[]): void; rename(key: string, name: string): void; remove(key: string): void;
  retry(key: string): void; start(): Promise<LibraryItem[]>;     // mengunggah yang 'waiting'/'failed', mengembalikan SEMUA hasil sukses (termasuk yang sudah sukses sebelumnya) tanpa mengunggah ulang
  clearRejected(): void;
};
// file-drop-zone.tsx
export function FileDropZone(props: { accept: readonly string[]; onFiles(files: File[], rejected: {name: string; reason: string}[]): void; children: ReactNode; className?: string; disabled?: boolean }): JSX.Element;
```
- Nama awal entri = `guideNameFromFile`-setara umum: buang ekstensi (pakai fungsi umum di `accept.ts`, mis. `baseName(filename)`; adaptor stiker tetap menerima nama dari dialog).
- `add` menolak di klien: tipe di luar `accept`, ukuran > `maxBytes`, melebihi `maxFiles` (sisanya ditolak dengan alasan "Maksimal 20 berkas per unggahan"); alasan memuat nama berkas; berkas lolos tetap masuk walau yang lain ditolak.
- `start()` idempoten: entri `done` tidak diunggah lagi; panggilan serentak kedua mengembalikan janji yang sama (tidak menggandakan). Kegagalan satu entri tidak menghentikan yang lain.
- `UploadTab`: daftar entri (nama dapat diklik -> input ubah nama, Enter simpan, Esc batal; ikon tempat sampah; status dan alasan gagal + tombol ulangi), tombol Telusuri (`<input type="file" multiple accept>`), teks `Maksimum 10 MB`, daftar `rejected` yang dapat ditutup; dibungkus `FileDropZone`.
- [ ] **Step 1:** Tes gagal: `resolveAccept(['image'], ['image/png','application/pdf']) = ['image/png']`; `checkFile` HEIC/GIF/PDF/oversize masing-masing beralasan; `useUploadQueue` (sumber palsu): 25 berkas -> 20 masuk + 5 ditolak; campuran sah+tak sah; konkurensi maks. 3 (hitung panggilan `upload` serentak); satu gagal lalu `retry` hanya mengunggah yang gagal; `start()` dua kali serentak = satu rangkaian `upload` per berkas; setelah sukses `start()` lagi tidak memanggil `upload`; komponen: klik nama -> input, Enter menyimpan, Esc membatalkan, drop berkas campuran menampilkan alasan penolakan.
- [ ] **Step 2:** Implementasikan. Teks UI Indonesia.
- [ ] **Step 3:** Tes lulus, Biome, typecheck. Komit: `feat(web): dialog berkas umum, bagian unggah`.

---

### Task 8: Dialog berkas umum, bagian pustaka (kisi, cari, urut, filter, ganti nama, hapus)
**Model: Sonnet.**

**Files:** Create `web/src/components/file-dialog/library-tab.tsx`, `use-infinite-sentinel.ts` + tes.

**Interfaces — Produces:**
```ts
export function LibraryTab(props: {
  source: FileLibrarySource; selection: ReadonlyMap<string, LibraryItem>; mode: 'single' | 'multiple';
  onToggle(item: LibraryItem): void; onPreview(item: LibraryItem): void; accept: readonly string[]; onFiles(files: File[], rejected: { name: string; reason: string }[]): void;
  selectable?: boolean; // bawaan true; false = tampilan halaman (tanpa kotak centang pilih; klik kartu membuka pratinjau)
}): JSX.Element;
// use-infinite-sentinel.ts: hook IntersectionObserver -> memanggil fetchNextPage saat sentinel terlihat; no-op bila API tak ada
```
- Memakai `useInfiniteQuery` (kunci `[source.key, query]`, `initialPageParam: null`, `getNextPageParam: last => last.nextCursor ?? undefined`); cari dengan jeda ketik 300 ms; urut (menu: Terbaru, Terlama, Nama A-Z, Nama Z-A, Ukuran terbesar); filter "Diunggah oleh saya" dan "Belum dipakai" (tombol toggle); kisi 2 kolom di ponsel hingga 5 di desktop; thumbnail `<img loading="lazy">`; kartu: kotak centang pilih, ikon pratinjau, nama (klik -> mode ubah bila `canRename`; Enter/Esc), ikon hapus bila `canRemove` dan `usageCount === 0` (ikon nonaktif + petunjuk "Masih dipakai" bila dipakai) dengan `AlertDialog` konfirmasi.
- Setelah rename/remove: perbarui cache halaman (ganti/buang item di tempat) tanpa memuat ulang seluruh daftar; galat tampil lewat toast. Keadaan kosong `Belum ada gambar` (dan `Tidak ada hasil` saat cari/filter), galat memuat dengan tombol `Coba lagi`. Dibungkus `FileDropZone` (drop di tab Pustaka meneruskan lewat `onFiles`).
- Mode `single`: memilih item lain menggantikan pilihan.
- [ ] **Step 1:** Tes gagal (sumber palsu): halaman pertama tampil; sentinel (IntersectionObserver di-stub) memuat halaman kedua tanpa duplikat; cari mengirim `search` setelah jeda; filter mengirim `mine/unused`; urut mengganti `sort`; klik nama -> ganti nama memanggil `source.rename` dan item diperbarui tanpa memuat ulang; hapus meminta konfirmasi, memanggil `remove`, dan item hilang; item `usageCount>0` tak dapat dihapus; keadaan kosong dan galat; `single` vs `multiple` pada `onToggle`.
- [ ] **Step 2:** Implementasikan.
- [ ] **Step 3:** Tes lulus, Biome, typecheck. Komit: `feat(web): dialog berkas umum, bagian pustaka`.

---

### Task 9: Dialog berkas umum, perakitan
**Model: Sonnet.**

**Files:** Create `web/src/components/file-dialog/file-dialog.tsx`, `index.ts`, `preview-dialog.tsx` + tes `file-dialog.test.tsx`.

**Interfaces — Produces:**
```ts
export interface FileDialogProps {
  open: boolean; onOpenChange(open: boolean): void;
  source: FileLibrarySource; mode: 'single' | 'multiple'; accept: readonly FileCategory[]; maxBytes: number;
  initialFiles?: File[];                       // dari DnD: tab Unggah terbuka dengan berkas sudah di antrean
  title?: string;                              // bawaan 'Pilih gambar'
  onSelect(items: LibraryItem[]): void;
}
export function FileDialog(props: FileDialogProps): JSX.Element;
```
- Dua tab (Unggah, Pustaka) memakai `Tabs`; `initialFiles` membuka tab Unggah. Satu himpunan pilihan dipakai kedua tab. Tombol `Lampirkan (n)`: menjalankan `queue.start()` untuk yang menunggu lalu `onSelect([...pilihanPustaka, ...hasilUnggah])`; bila ada entri gagal, dialog tetap terbuka (tidak memanggil `onSelect`) dan tab Unggah menampilkan yang gagal; yang sudah sukses tidak diunggah lagi pada percobaan berikutnya. Tombol dinonaktifkan selama mengunggah (mencegah klik ganda). Mode `single`: tepat satu item (pilihan pustaka atau satu berkas unggahan; berkas kedua diganti/ditolak dengan pesan).
- Pratinjau besar: ikon pada kartu membuka dialog lapis kedua dengan `previewUrl` (`<img>` besar, tombol tutup).
- Dialog layar penuh di ponsel (kelas responsif `max-sm`). Menutup dialog membersihkan antrean dan pilihan.
- [ ] **Step 1:** Tes gagal (sumber palsu tanpa kata "stiker"): `initialFiles` -> tab Unggah aktif dengan entri; Lampirkan mengunggah lalu memanggil `onSelect` dengan item sukses; satu entri gagal -> dialog tetap terbuka, `onSelect` tak dipanggil, `retry` lalu Lampirkan memanggil `upload` hanya untuk yang gagal dan `onSelect` berisi semuanya; klik Lampirkan dua kali cepat -> satu rangkaian `upload`; pilihan pustaka + unggahan digabung; `single` membatasi satu; menutup dialog membersihkan keadaan; pratinjau membuka gambar `previewUrl`. Expected: FAIL.
- [ ] **Step 2:** Implementasikan; ekspor `FileDialog`, `FileDropZone`, tipe, `resolveAccept` dari `index.ts`.
- [ ] **Step 3:** Tes lulus (`bun run --cwd web test src/components/file-dialog`), Biome, typecheck. Komit: `feat(web): FileDialog umum dengan tab Unggah dan Pustaka`.

---

### Task 10: Halaman Pustaka Gambar, rute, dan menu
**Model: Sonnet.**

**Files:** Create `web/src/modules/sticker/components/guide-library-page.tsx`, `web/src/routes/_app/sticker/library.tsx`, `web/src/modules/sticker/components/guide-library-page.test.tsx`; Modify `web/src/app/navigation.ts`, `web/src/routeTree.gen.ts` (dibangkitkan; ikuti cara proyek: jalankan `bun run --cwd web build` atau perintah pembangkit rute yang dipakai repo), tes navigasi yang menghitung entri menu bila ada.

**Interfaces — Produces:**
```ts
export function GuideLibraryPage(props: { canUpload: boolean }): JSX.Element;
// route '/_app/sticker/library': beforeLoad = izin ATAU: item:view atau sticker:view (lihat requirePermission/can di modules/auth/permissions; bila hanya mendukung satu modul, tulis pemeriksaan anyOf lokal)
```
- Menu: item "Pustaka Gambar" di grup Stiker, ikon `Images` (lucide), `to: '/sticker/library'`, izin tampil: anyOf `item: view` / `sticker: view` (ikuti bentuk `NavPermission`; tambah dukungan anyOf bila belum ada dan tes-nya); tambahkan `'/sticker/library'` ke `excludes` item "Stiker" (`/sticker`) agar tak ikut aktif.
- Halaman: judul, tombol `Unggah gambar` (hanya bila `canUpload` = `can(me, 'item', 'edit')`) membuka `FileDialog` (`mode="multiple"`, `accept={['image']}`, `maxBytes=MAX_IMAGE_BYTES`) pada tab Unggah; di bawahnya kisi pustaka versi halaman memakai `LibraryTab` (tanpa kotak centang pilih: pakai prop `selectable={false}` yang ditambahkan ke `LibraryTab` bila perlu, atau mode tampilan) yang menerima DnD dan membuka `FileDialog` dengan `initialFiles`. Setelah `onSelect`/unggah selesai, invalidasi `[stickerGuideSource.key]`.
- [ ] **Step 1:** Tes gagal: pengguna tanpa `item: edit` tidak melihat tombol unggah tetapi melihat kisi; pengguna dengan `item: edit` melihat tombol; drop berkas membuka dialog dengan antrean; menu memuat "Pustaka Gambar" hanya bagi pemegang izin baca.
- [ ] **Step 2:** Implementasikan; bangkitkan pohon rute.
- [ ] **Step 3:** `bun run --cwd web test`, Biome, `bun run typecheck`, `bun run build` bersih. Verifikasi manual di peramban (server dev pengguna JANGAN dimatikan; bila perlu pakai `preview_start` yang sudah ada): unggah beberapa gambar, thumbnail termuat dan ter-cache, rename, hapus, DnD, mobile 375 px. Komit: `feat(web): halaman Pustaka Gambar di menu Stiker`.

---

### Task 11: Dokumentasi dan verifikasi akhir
**Model: Haiku** untuk dokumen; verifikasi oleh pengendali.

**Files:** Modify `CLAUDE.md` (bullet Stiker: pustaka gambar `stickerguide`, rute `stickerGuides.*`, `guide-*.ts`, komponen `web/src/components/file-dialog/` dan kontrak `FileLibrarySource`, batas `GUIDE_LIMITS`; catatan `client_max_body_size` tetap cukup), `docs/superpowers/specs/2026-11-09-stiker-pustaka-gambar-3b1-design.md` (status: dibangun).

- [ ] **Step 1:** Perbarui dokumen. Komit: `docs: pustaka gambar stiker 3b-1`.
- [ ] **Step 2 (pengendali):** `bun run check` (terowongan hidup); bila `scripts/ci-workflows.test.ts`/`deploy-script.test.ts` melewati batas waktu, jalankan sendirian (catatan memori proyek). Expected: semua hijau.
- [ ] **Step 3 (pengendali):** Review akhir independen (spek + `security-audit` terfokus pada perubahan: otorisasi, validasi biner/thumbnail, LIKE, kebocoran lintas-jenis berkas, balapan batas), putaran perbaikan, lalu push dan PR ke `dev`.
