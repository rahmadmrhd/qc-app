# Serah Terima berbasis Catatan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serah terima memakai Catatan (editor Markdown WYSIWYG) sebagai pengganti item katalog, dengan checklist dari tempelan WhatsApp, komentar pada teks terpilih, pembuatan bulk, dan daftar kanban (desktop) / kartu (ponsel).

**Architecture:** Logika murni (konversi tempelan, pemecah batch, model checklist, jangkar komentar) di `shared/` agar dites sekali dan dipakai GAS dan FE. Backend memakai tabel `handovers` dengan kolom baru untuk status centang dan komentar (tanpa `handover_lines`); satu RPC `handovers.board` mengisi seluruh papan. FE memakai satu komponen editor Tiptap, dipakai di Catatan serah terima dan menggantikan editor Detail Item.

**Tech Stack:** Bun, TypeScript, Google Apps Script + Sheets (lewat `core/db`), React, TanStack Query/Router/Form, zod, shadcn, Tailwind v4, Tiptap (baru), vitest/bun:test.

**Spec:** `docs/superpowers/specs/2026-10-23-serah-terima-catatan-wysiwyg-design.md`

## Global Constraints

- Catatan serah terima maks. **5.000 karakter**; komentar maks. **1.000 karakter**, maks. **50 komentar per task**; batch maks. **30 task**, atomik (semua atau tidak sama sekali); satu batch satu lokasi.
- Format simpan catatan **Markdown**; konversi WhatsApp, checklist, dan komentar **hanya** di editor Catatan serah terima; editor Detail Item hanya berubah tampilan (WYSIWYG, toolbar sama, gambar tetap, tanpa konversi WhatsApp). Catatan serah terima tanpa gambar.
- Aturan baris item WhatsApp: `<teks> = <angka><satuan opsional>`; baris judul: tanpa `=`, berakhir `:` atau `-`; baris lain = paragraf; awalan `[tanggal, jam] Nama:` dibuang; `*x*`, `_x_`, `~x~` WhatsApp → format editor.
- Izin: centang/selesai `qc: edit`; isi dan batch `handover: edit`; batal `handover: manage`; komentar = izin baca (WH atau QC lihat, berlokasi). Semua rute berlokasi (`scope: 'location'`).
- Status: Baru / Dikerjakan / Selesai diturunkan dari centang (atau penanda selesai untuk task tanpa butir); Dibatalkan disimpan. Tidak ada aksi Hapus.
- UI: kanban empat kolom (Baru, Dikerjakan, Selesai, Dibatalkan) di ≥ 768 px, daftar kartu + filter di < 768 px; seluruh catatan tampil tanpa dipotong; tidak ada task disembunyikan; tombol **Mark done** di setiap kartu; **More** hanya bila ada aksi (Ubah, Batalkan); klik badan kartu membuka halaman detail.
- Anggaran bundel tambahan Tiptap: ≤ ±450 KB mentah dan ±150 KB gzip; lebih dari itu pembangun berhenti dan melapor.
- Aturan proyek (`CLAUDE.md`): fungsi top-level `gas/src` berakhiran `_` dan namanya unik (juga terhadap `shared/`); tulis lewat `core/db` di dalam `withLock`; API GAS hanya lewat `platform_()`; tanpa API JS yang tidak ada di Apps Script (`URL`, `atob`, `Object.hasOwn`, dll.); render Markdown aman (tanpa HTML mentah); form TanStack Form + zod; komponen shadcn; cache query lewat `web/src/lib/query-cache.ts`; setelah mengubah `gas/` jalankan `bun run build`; `bun run check` wajib hijau sebelum commit.
- Belum ada task di sheet mana pun: tanpa jalur kompatibilitas data lama. Sheet `handover_lines` dibiarkan; kodenya dihapus.

## Review Focus

Masukan yang tidak disebut spesifikasi tetapi paling mungkin merusak pemakaian nyata (tiap baris diuji di task yang disebut):

1. Tempelan WhatsApp dengan CRLF, tab, emoji, dan `_`/`*` di dalam nama model (`RB_5009_X = 1 unit`, `2*3 = 6 unit`) tidak boleh berubah menjadi miring/tebal (Task 1).
2. Dua QC mencentang butir yang sama, atau WH menyunting catatan sehingga indeks butir bergeser: perintah centang memakai `text` sebagai penjaga dan menolak `CONFLICT` bila tidak cocok; mencentang dua kali bersifat idempoten (Task 5).
3. Butir bertulisan sama muncul dua kali, diurutkan ulang, atau diedit setelah dicentang: urutan kemunculan dipakai untuk mencocokkan; edit mereset; hapus ditolak (Task 2 dan 4).
4. Satu task tidak valid dalam batch tidak boleh menyimpan apa pun maupun menghabiskan nomor `ST-…` (Task 4).
5. Komentar pada kutipan yang berulang atau berformat (tebal, emoji): kutipan ditemukan lagi; setelah teks diedit komentar ditandai usang; isi komentar dirender sebagai teks biasa tanpa HTML (Task 2 dan 7).

## Catatan eksekusi (aturan `CLAUDE.md` global)

Task 1–5 dan 6–9 butuh penilaian: **satu agent Sonnet** yang dilanjutkan lewat `SendMessage` antar task. Task 10 mekanis (penghapusan, dokumen): **satu agent Haiku**, dilanjutkan bila ada pekerjaan ringan lain. Reviu hanya **sekali di akhir** atas seluruh branch oleh model yang lebih tinggi, lalu satu gelombang perbaikan. Subagent tidak boleh men-spawn subagent. Urutan: 1 → 2 → 3 → 4 → 5; 6 berdiri sendiri; 7 setelah 1, 2, 6; 8 setelah 4 dan 7; 9 setelah 5 dan 7; 10 terakhir.

---

### Task 1: Konversi tempelan WhatsApp dan pemecah batch (`shared/`)

**Files:**
- Create: `shared/handover-paste.ts`
- Test: `shared/handover-paste.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function stripWhatsappPrefix(line: string): string;
  export function convertWhatsappFormatting(line: string): string; // *x*→**x**, _x_→*x*, ~x~→~~x~~, hanya di batas kata
  export function isChecklistLine(line: string): boolean;          // memuat "=" diikuti angka
  export function isHeaderLine(line: string): boolean;             // tanpa "=", berakhir ":" atau "-" (setelah trim)
  export function whatsappToNoteMarkdown(raw: string): string;     // satu tempelan: butir "- [ ] x", sisanya paragraf
  export interface ParsedHandoverTask { customerSuggestion: string; note: string }
  export function splitWhatsappBatch(raw: string): ParsedHandoverTask[];
  ```
- Aturan keluaran: butir berurutan rapat (`- [ ] a\n- [ ] b`); paragraf dan blok checklist dipisah satu baris kosong; baris kosong ganda diringkas. `splitWhatsappBatch`: baris judul memulai task baru dan **tidak** masuk `note`; `customerSuggestion` = teks judul tanpa `:`/`-` akhir dan spasi; teks sebelum judul pertama menjadi task dengan `customerSuggestion: ''`; task dengan `note` kosong dibuang; masukan kosong menghasilkan `[]`.

- [ ] **Step 1: Tulis tes yang gagal** — nama tes dan nilai pasti:
  - `empat contoh WhatsApp pemilik` — contoh 1: `splitWhatsappBatch('Orderan Online :\nCRS310 = 1 unt\nRB5009UG = 1 unt')` → `[{ customerSuggestion: 'Orderan Online', note: '- [ ] CRS310 = 1 unt\n- [ ] RB5009UG = 1 unt' }]`. Contoh 2 (dengan awalan `[22/10, 10.57] Mas_Aden JH: CV.Prisma :` dan `[22/10, 11.01] Mas_Aden JH: HND Gemilang :`) → dua task, `CV.Prisma` dan `HND Gemilang`, masing-masing satu butir. Contoh 3 (`Orderan Pak OKY - `, butir `CCR2116 = 1 unit (Kirim dari SBY - TANPA DOKUMENT APAPUN)`, lalu dua paragraf) → satu task, `note` = `'- [ ] CCR2116 = 1 unit (Kirim dari SBY - TANPA DOKUMENT APAPUN)\n\nkirim via J&T Merah kalo bisa\n\nMintol foto SN - Foto Unit sebelum packing & setelah packing'`. Contoh 4 → tiga task (`Lintasmaya`, `Mitra Tower`, `CV. Tepian`), task ketiga dua butir.
  - `whatsappToNoteMarkdown mempertahankan judul sebagai paragraf` — `'Orderan Online :\nCRS310 = 1 unt'` → `'Orderan Online :\n\n- [ ] CRS310 = 1 unt'`.
  - `CRLF, tab, spasi ganda, dan emoji` — masukan `'A = 1 unit\r\nB\t= 2 unt 😀\r\n'` menghasilkan dua butir bersih.
  - `format WhatsApp` — `'*Penting* kirim _sore_ ~batal~'` → `'**Penting** kirim *sore* ~~batal~~'`; **tidak** berubah: `'RB_5009_X = 1 unit'`, `'2*3 = 6 unit'`, `'snake_case_word'`.
  - `bullet, nomor, dan penanda checkbox` — `'- A = 1\n1. B = 2\n- [x] C = 3'` → tiga butir `- [ ]` tanpa awalan ganda.
  - `isChecklistLine / isHeaderLine` — tabel kasus: `'X = 1 unit'` true/false; `'Kirim sore'` false/false; `'CV.Prisma :'` false/true; `'Orderan Pak OKY -'` false/true; `'A = 1 :'` (ada `=`) bukan judul.
  - `masukan kosong dan hanya judul` — `splitWhatsappBatch('')` → `[]`; `'Judul :'` → `[]`.
- [ ] **Step 2: Jalankan, pastikan gagal** — `bun test shared/handover-paste.test.ts` → Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasi** semua fungsi di atas di `shared/handover-paste.ts`. Murni (tanpa API GAS/DOM, tanpa `URL`/`atob`). Konversi format memakai pencocokan batas kata (awalan di awal/setelah spasi atau tanda baca; akhiran sebelum spasi/tanda baca/akhir).
- [ ] **Step 4: Jalankan, pastikan lolos** — `bun test shared/handover-paste.test.ts` → Expected: PASS semua.
- [ ] **Step 5: Commit** — `git add shared/handover-paste.ts shared/handover-paste.test.ts && git commit -m "feat(handover): konversi tempelan WhatsApp dan pemecah batch (shared)"`

### Task 2: Model checklist, status turunan, dan jangkar komentar (`shared/`)

**Files:**
- Modify: `shared/handover.ts` (hapus `ProgressLine`, `progressTotals`, `HANDOVER_LIMITS.qtyMax/lines`; pertahankan `dateKeyOf`, `handoverNumber`, `nextHandoverSequence`, `customerKey`)
- Create: `shared/handover-checklist.ts`, `shared/handover-comments.ts`
- Test: `shared/handover.test.ts` (perbarui), `shared/handover-checklist.test.ts`, `shared/handover-comments.test.ts`

**Interfaces:**
- Produces (`shared/handover.ts`):
  ```ts
  export const HANDOVER_LIMITS: { note: 5000; customerName: 100; comment: 1000; comments: 50; batch: 30; stateJson: 40000 };
  export type HandoverStoredStatus = 'open' | 'cancelled';
  export type HandoverStatus = 'new' | 'in_progress' | 'done' | 'cancelled';
  export function deriveHandoverStatus(stored: HandoverStoredStatus, progress: { total: number; done: number; completed: boolean }): HandoverStatus;
  ```
  Aturan: `cancelled` bila disimpan; `done` bila (`total > 0 && done === total`) atau (`total === 0 && completed`); `in_progress` bila `done > 0`; selain itu `new`.
- Produces (`shared/handover-checklist.ts`):
  ```ts
  export interface ChecklistEntry { index: number; text: string }        // butir "- [ ]" / "- [x]" tingkat atas, berurutan
  export interface CheckState { text: string; by: string; at: string }   // hanya butir tercentang; dicocokkan lewat (text, kemunculan ke-k)
  export function extractChecklist(note: string): ChecklistEntry[];
  export function normalizeNoteChecks(note: string): string;              // "- [x]" → "- [ ]" (centang hanya milik QC)
  export function reconcileChecks(oldNote: string, checks: CheckState[], newNote: string): {
    checks: CheckState[]; resets: Array<{ from: string; to: string }>; removed: string[];
  };
  export function matchChecks(note: string, checks: CheckState[]): Array<CheckState | null>; // sejajar dengan extractChecklist
  ```
  Aturan `reconcileChecks`: cocokkan butir tercentang ke butir baru berdasarkan (teks, kemunculan ke-k) sehingga pengurutan ulang mempertahankan centang; butir tercentang yang tidak cocok dan pada urutan checklist yang sama kini berteks lain = **disunting** (reset, masuk `resets`); yang tidak cocok dan tidak punya pasangan posisi = **dihapus/dikonversi** (masuk `removed`).
- Produces (`shared/handover-comments.ts`):
  ```ts
  export interface CommentAnchor { quote: string; before: string; after: string }   // konteks ≤ 20 karakter per sisi
  export function noteToPlainText(note: string): string;                              // penanda Markdown dibuang, blok dipisah "\n"
  export function makeAnchor(plain: string, start: number, end: number): CommentAnchor;
  export function locateAnchor(plain: string, anchor: CommentAnchor): { start: number; end: number } | null; // null = usang
  ```

- [ ] **Step 1: Tulis tes yang gagal:**
  - `deriveHandoverStatus` — tabel: `('open',{total:2,done:0,completed:false})`→`new`; `(…done:1…)`→`in_progress`; `(…done:2…)`→`done`; `('open',{total:0,done:0,completed:true})`→`done`; `('open',{total:0,done:0,completed:false})`→`new`; `('cancelled',…)`→`cancelled`.
  - `extractChecklist` — `'- [ ] A\n- [x] B\nteks\n  - [ ] bersarang'` → dua butir (A, B) dengan indeks 0 dan 1 (bersarang diabaikan); `normalizeNoteChecks('- [x] B')` → `'- [ ] B'`.
  - `reconcileChecks mempertahankan centang saat diurutkan ulang` — butir `A`,`B` dengan `B` tercentang, catatan baru `B` lalu `A` → `checks` masih berisi `B`, `removed: []`, `resets: []`.
  - `reconcileChecks: duplikat bertulisan sama` — `X`,`X` dengan satu tercentang (kemunculan ke-1); menyunting kemunculan ke-2 tidak menyentuh centang pertama.
  - `reconcileChecks: edit mereset, hapus ditolak` — `RD = 8` tercentang diganti `RD = 9` pada posisi sama → `resets: [{from:'RD = 8',to:'RD = 9'}]`, `checks: []`; butir tercentang dihapus tanpa pasangan → `removed: ['RD = 8']`; butir tercentang diubah menjadi paragraf → `removed`.
  - `noteToPlainText` — `'**tebal** dan *miring*\n\n- [ ] Router A = 2'` → `'tebal dan miring\nRouter A = 2'`; emoji dipertahankan.
  - `anchor: kutipan berulang` — teks `'kirim sore. kirim sore.'`, pilih kemunculan kedua → `makeAnchor` lalu `locateAnchor` mengembalikan rentang kemunculan kedua, bukan pertama.
  - `anchor usang` — setelah `plain` diedit sehingga kutipan hilang `locateAnchor` → `null`; kutipan yang masih ada tetapi konteksnya berubah tetap ditemukan bila kutipan unik.
- [ ] **Step 2: Jalankan, pastikan gagal** — `bun test shared/handover.test.ts shared/handover-checklist.test.ts shared/handover-comments.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementasi** semua tanda tangan di atas. Pencocokan butir memakai urutan kemunculan; `locateAnchor` mencari kutipan lalu memilih kemunculan yang konteks `before/after`-nya paling cocok.
- [ ] **Step 4: Jalankan, pastikan lolos** — perintah Step 2 → Expected: PASS. Juga `bun run typecheck` (akan gagal di `gas/` dan `web/` karena tipe lama dihapus; itu diperbaiki Task 3–9: pastikan hanya `shared/` yang bersih).
- [ ] **Step 5: Commit** — `git add shared && git commit -m "feat(handover): model checklist, status turunan, dan jangkar komentar (shared)"`

### Task 3: Model data, kontrak RPC, dan validator (`gas/` + `shared/rpc.ts`)

**Files:**
- Modify: `shared/rpc.ts` (bagian handover), `gas/src/modules/handover/repo.ts`, `gas/src/modules/handover/validate.ts`, `gas/src/modules/handover/routes.ts`, `gas/src/routes.test.ts`, `gas/src/setup.ts` (hapus `HANDOVER_LINES_TABLE` dari daftar), `gas/test-support/handover-fixtures.ts`, `gas/test-support/handover-env.ts`
- Test: `gas/src/modules/handover/validate.test.ts` (baru), `gas/src/routes.test.ts`

**Interfaces:**
- Produces (`shared/rpc.ts`):
  ```ts
  export interface HandoverChecklistItemDto { index: number; text: string; checked: boolean; by: string; at: string }
  export interface HandoverCommentDto { id: string; quote: string; before: string; after: string; body: string; author: string; at: string; stale: boolean }
  export interface HandoverDto {
    id: string; number: string; locationId: string; customerId: string; customerName: string;
    note: string; status: HandoverStatus; checklist: HandoverChecklistItemDto[];
    comments: HandoverCommentDto[]; completedAt: string; completedBy: string;
    createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  }
  export interface SaveHandoverInput { id?: string; expectedUpdatedAt?: string; locationId: string; customerName: string; note: string }
  export interface SaveHandoverBatchInput { locationId: string; tasks: Array<{ customerName: string; note: string }> }
  export interface SetCheckInput extends HandoverRefInput { index: number; text: string; checked: boolean }
  export interface SetDoneInput extends HandoverRefInput { done: boolean }
  export interface AddCommentInput extends HandoverRefInput { quote: string; before: string; after: string; body: string }
  export interface HandoverOptionsDto { customers: HandoverOptionCustomerDto[]; inactiveCustomerNames: string[] }
  ```
  Kontrak RPC: `handovers.options`, `handovers.board` (`ListHandoversInput` → `HandoverDto[]`), `handovers.get`, `handovers.save`, `handovers.saveBatch` (→ `HandoverDto[]`), `handovers.cancel`, `handovers.setCheck`, `handovers.setDone`, `handovers.comment` (semua → `HandoverDto`). Hapus `handovers.list`, `setProgress`, `completeLine`, `completeAll`, `HandoverSummaryDto`, `HandoverLineDto`, `SaveHandoverLineInput`, `SetProgressInput`, `CompleteLineInput`, `HandoverOptionItemDto`.
- Produces (`repo.ts`): kolom `HANDOVERS_TABLE` ditambah `checks` (JSON `CheckState[]`), `comments` (JSON komentar), `completed_at`, `completed_by`; `HandoverRecord` memuat `checks: CheckState[]`, `comments: StoredComment[]` (`StoredComment = Omit<HandoverCommentDto, 'stale'>`), `completedAt`, `completedBy`. `listHandovers_`, `insertHandover_`, `updateHandover_` tetap; JSON diurai aman (rusak = `[]`); hapus semua fungsi `*HandoverLine*`.
- Izin rute: `board`/`get`/`options`/`comment` = `READ_PERMISSION` yang ada (`anyOf` handover+qc view, `scope: 'location'`); `save`/`saveBatch` = `handover: edit`; `cancel` = `handover: manage`; `setCheck`/`setDone` = `qc: edit` (semuanya `scope: 'location'`).
- Validator: `validateSaveHandover_` (catatan ≤ 5.000, nama customer ≤ 100), `validateSaveHandoverBatch_` (1–30 task, tiap task divalidasi seperti di atas; galat menyebut nomor task: `fields: { tasks: 'Task 3: …' }`), `validateSetCheck_`, `validateSetDone_`, `validateAddComment_` (body ≤ 1.000, `quote` tidak kosong ≤ 500, konteks ≤ 40).

- [ ] **Step 1: Tulis tes yang gagal** — `validate.test.ts`: catatan 5.001 karakter ditolak (`fields.note`); batch kosong dan batch 31 task ditolak; batch dengan task ke-3 bercatatan terlalu panjang → `fields.tasks` memuat `Task 3`; `validateSetCheck_({id,locationId,index:-1,…})` ditolak; komentar kosong dan 1.001 karakter ditolak. `routes.test.ts`: tabel rute memuat metode baru dengan izin sesuai daftar di atas (termasuk `anyOf` baca untuk `comment`).
- [ ] **Step 2: Jalankan, pastikan gagal** — `bun test gas/src/modules/handover/validate.test.ts gas/src/routes.test.ts` → Expected: FAIL.
- [ ] **Step 3: Implementasi** kontrak, repo, validator, dan tabel rute (handler sementara melempar `INTERNAL` "belum diimplementasi"; diisi Task 4–5). Perbarui fixture `handover(...)` (kolom baru, hapus `handoverLine`) dan `seedHandoverEnv`.
- [ ] **Step 4: Jalankan, pastikan lolos** — perintah Step 2 → Expected: PASS. (`bun run typecheck` untuk `gas/` masih memerlukan Task 4–5; tes lama `handover-*.test.ts` akan dihapus/ditulis ulang di sana.)
- [ ] **Step 5: Commit** — `git add shared gas && git commit -m "feat(handover): model data catatan, kontrak RPC, dan validator"`

### Task 4: Sisi baca, simpan, dan simpan batch (`gas/`)

**Files:**
- Modify: `gas/src/modules/handover/service.ts` (ganti seluruh isi), `gas/src/modules/handover/routes.ts`
- Test: `gas/src/modules/handover/handover-read.test.ts`, `handover-write.test.ts` (tulis ulang; hapus `handover-progress.test.ts` di Task 5)

**Interfaces:**
- Consumes: Task 2 (`extractChecklist`, `matchChecks`, `normalizeNoteChecks`, `reconcileChecks`, `deriveHandoverStatus`, `locateAnchor`, `noteToPlainText`, `HANDOVER_LIMITS`), Task 3 (DTO, repo).
- Produces (`service.ts`):
  ```ts
  export function toHandoverDto_(h: HandoverRecord, customerNames: ReadonlyMap<string, string>): HandoverDto; // checklist, status, komentar usang dihitung di sini
  export function handoverBoard_(locationIds: readonly string[]): HandoverDto[];     // satu pembacaan tabel, terbaru dahulu
  export function getHandoverDto_(input: GetHandoverInput): HandoverDto;
  export function handoverOptions_(): HandoverOptionsDto;                             // customers + inactiveCustomerNames
  export function saveHandover_(input: SaveHandoverInput, actor: ActorRef): HandoverDto;
  export function saveHandoverBatch_(input: SaveHandoverBatchInput, actor: ActorRef): HandoverDto[];
  ```
- Perilaku `saveHandover_`: dalam `withLock`; `expectedUpdatedAt` basi → `CONFLICT`; task Dibatalkan ditolak; catatan dinormalkan (`normalizeNoteChecks`); pada ubah, `reconcileChecks` dijalankan: `removed.length > 0` → `VALIDATION` pada `note` yang menyebut butirnya; `resets` dicatat di audit `handover.update` (before/after memuat catatan dan butir yang direset); customer opsional (kosong = tanpa customer; baru = dibuat seperti sekarang).
- `saveHandoverBatch_`: **validasi seluruh task lebih dulu** (catatan, customer, batas), baru dalam satu `withLock` mengalokasikan nomor berurutan (`nextHandoverSequence` terhadap nomor yang ada + yang sudah dialokasikan dalam batch), membuat customer baru satu kali per `customerKey` yang sama, menyisipkan, dan menulis audit `handover.create` per task. Galat mana pun sebelum penulisan = tidak ada yang tertulis dan tidak ada nomor terpakai.

- [ ] **Step 1: Tulis tes yang gagal** — nama tes: `board mengembalikan seluruh task lokasi dalam satu pembacaan, terbaru dahulu` (hitung `sheet.calls` ≤ 2 pada `handovers`), `board menolak lokasi yang tidak boleh dibaca (FORBIDDEN) dan tidak membocorkan task lokasi lain`, `board mengisi checklist dari catatan beserta status centang dan status turunan`, `save membuat task bernomor ST-YYYYMMDD-001 tanpa customer; catatan 5.000 karakter diterima, 5.001 ditolak`, `save menormalkan "- [x]" menjadi tidak tercentang`, `save mengubah catatan: urutan ulang mempertahankan centang; edit butir tercentang mereset dan masuk audit; menghapus butir tercentang ditolak VALIDATION`, `save dengan expectedUpdatedAt basi → CONFLICT`, `save pada task Dibatalkan ditolak`, `QC tanpa handover:edit tidak dapat save (FORBIDDEN)`, `saveBatch menyimpan 3 task dengan nomor 001..003 dan satu customer baru untuk nama yang sama (customerKey)`, `saveBatch: satu task tidak valid → tidak ada task, tidak ada customer baru, nomor berikutnya tetap 001` (Review Focus 4), `saveBatch 31 task ditolak`, `saveBatch menulis audit handover.create per task`.
- [ ] **Step 2: Jalankan, pastikan gagal** — `bun test gas/src/modules/handover` → Expected: FAIL.
- [ ] **Step 3: Implementasi** fungsi di atas dan daftarkan handler `handovers.board/get/options/save/saveBatch` di `routes.ts` (memakai `ctx.locationIds`). Hapus semua kode qty/baris/item (`listItems_`, `brandNameMap_`, `lineError_`, dst.).
- [ ] **Step 4: Jalankan, pastikan lolos** — perintah Step 2 → Expected: PASS (kecuali tes progres lama yang dihapus di Task 5).
- [ ] **Step 5: Commit** — `git add gas && git commit -m "feat(handover): board, simpan catatan, dan simpan batch atomik"`

### Task 5: Centang, selesai, komentar, dan batal (`gas/`)

**Files:**
- Modify: `gas/src/modules/handover/service.ts`, `routes.ts`
- Delete: `gas/src/modules/handover/handover-progress.test.ts`
- Test: `gas/src/modules/handover/handover-check.test.ts`, `handover-comment.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function setCheck_(input: SetCheckInput, actor: ActorRef): HandoverDto;
  export function setDone_(input: SetDoneInput, actor: ActorRef): HandoverDto;
  export function addComment_(input: AddCommentInput, actor: ActorRef): HandoverDto;
  export function cancelHandover_(input: HandoverRefInput, actor: ActorRef): HandoverDto; // perbarui: tanpa deriveHandoverStatus lama
  ```
- `setCheck_`: dalam `withLock`; indeks harus ada dan `text` harus sama dengan teks butir pada indeks itu, kalau tidak `CONFLICT` ("catatan berubah; muat ulang"); `checked: true` pada butir yang sudah tercentang atau `false` pada yang belum = tidak ada perubahan (tanpa audit, tanpa menaikkan `updatedAt`); perubahan menulis pelaku dan waktu di `checks` dan audit `handover.check`/`handover.uncheck`; task Dibatalkan ditolak.
- `setDone_`: `done: true` mencentang semua butir yang belum tercentang (pelaku/waktu sama) dan, bila tidak ada butir, mengisi `completedAt/By`; `done: false` mengosongkan semua centang dan penanda selesai; audit `handover.done`/`handover.reopen`; idempoten.
- `addComment_`: izin baca saja; task Dibatalkan ditolak; maksimal 50 komentar (`VALIDATION`); kutipan harus ditemukan lewat `locateAnchor` pada `noteToPlainText(note)` (kalau tidak `VALIDATION` "kutipan tidak ditemukan"); menyimpan komentar dengan id, pelaku, waktu; audit `handover.comment`.
- `cancelHandover_`: ditolak (`CONFLICT`) bila status turunan `done`; selebihnya seperti sekarang.

- [ ] **Step 1: Tulis tes yang gagal** — nama tes: `setCheck mencentang butir, menyimpan pelaku/waktu, dan mengubah status Baru→Dikerjakan→Selesai`, `setCheck dua kali dengan checked:true idempoten (tanpa audit kedua)`, `setCheck dengan text yang tidak cocok dengan indeks → CONFLICT` (Review Focus 2), `setCheck oleh pengguna tanpa qc:edit → FORBIDDEN`, `setCheck pada task Dibatalkan ditolak`, `setDone mencentang semua butir; setDone(false) membuka kembali`, `setDone pada task tanpa butir mengisi completedAt dan statusnya Selesai`, `cancel ditolak untuk task Selesai`, `comment oleh pengguna hanya-lihat (handover:view) berhasil`, `comment dengan kutipan yang tidak ada ditolak`, `comment ke-51 ditolak`, `comment pada kutipan berulang menyimpan konteks yang benar` dan `komentar menjadi stale:true setelah catatan diedit sehingga kutipan hilang` (Review Focus 5), `isi komentar berisi <script> dikembalikan apa adanya sebagai teks (tanpa penafsiran)`, `semua mutasi menulis audit dengan pelaku`.
- [ ] **Step 2: Jalankan, pastikan gagal** — `bun test gas/src/modules/handover` → Expected: FAIL pada tes baru.
- [ ] **Step 3: Implementasi** keempat fungsi dan daftarkan handler `handovers.setCheck/setDone/comment/cancel` di `routes.ts`. Hapus `setProgress_`, `completeLine_`, `completeAll_` dan validator lamanya.
- [ ] **Step 4: Jalankan, pastikan lolos** — `bun test gas` dan `bun run --cwd gas typecheck` → Expected: PASS / tanpa galat.
- [ ] **Step 5: Commit** — `git add gas && git commit -m "feat(handover): centang, selesai, komentar, dan batal"`

### Task 6: Editor Markdown WYSIWYG (Tiptap) dan penggantian editor Item (`web/`)

**Files:**
- Create: `web/src/modules/markdown/wysiwyg-editor.tsx`, `web/src/modules/markdown/wysiwyg-toolbar.tsx`
- Modify: `web/src/modules/item/components/item-form.tsx`, `web/package.json` (+ `bun.lock`)
- Delete (setelah tak terpakai): `web/src/modules/markdown/markdown-editor.tsx`, `edit-ops.ts`, dan tesnya
- Test: `web/src/modules/markdown/wysiwyg-editor.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface WysiwygEditorProps {
    id: string; value: string; onChange: (markdown: string) => void;
    maxLength?: number; disabled?: boolean; labelledBy?: string;
    mode?: 'item' | 'note';           // 'item': toolbar + gambar; 'note': tanpa gambar, memakai extensions tambahan
    extraExtensions?: import('@tiptap/core').Extensions;   // dipakai Task 7 (paste WhatsApp)
    onReady?: (editor: import('@tiptap/core').Editor) => void;
  }
  export function WysiwygEditor(props: WysiwygEditorProps): JSX.Element;
  ```
- Toolbar tipis di atas: tebal, miring, daftar berbutir, daftar bernomor, checklist (`taskList`), kutipan; mode `item` menambah tombol gambar (unggah/paste/seret lewat modul `files` seperti editor lama).

- [ ] **Step 1: Pasang dependensi** — `cd web && bun add @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-image` dan paket serialisasi Markdown Tiptap yang aktif dipelihara (`@tiptap/markdown` bila tersedia, jika tidak `tiptap-markdown`); pilih versi yang sudah ≥ 2 minggu. Catat ukuran `gas/dist/index.html` sebelum dan sesudah (`bun run build`) di pesan commit.
- [ ] **Step 2: Tulis tes yang gagal** — `wysiwyg-editor.test.tsx`: `memuat dan menyimpan kembali Markdown Detail Item yang ada tanpa mengubah makna` (sampel: judul, daftar, tabel GFM, `![alt](gambar)` dengan sintaks yang dipakai `markdown-view.tsx`); `tombol checklist menghasilkan "- [ ] "`; `tombol tebal pada seleksi menghasilkan **x**`; `maxLength menolak masukan melebihi batas` ; `disabled bersifat baca-saja`; `mode note tidak menampilkan tombol gambar; mode item menampilkannya`; `tidak ada HTML mentah di keluaran` (sisipkan `<script>` → tidak dieksekusi/dihapus).
- [ ] **Step 3: Jalankan, pastikan gagal** — `cd web && bunx vitest run src/modules/markdown` → Expected: FAIL.
- [ ] **Step 4: Implementasi `WysiwygEditor` dan `WysiwygToolbar`**; ganti `MarkdownEditor` di `item-form.tsx` dengan `mode="item"` (props sama: `id`, `labelledBy`, `value`, `onChange`). Pertahankan label/aria seperti editor lama.
- [ ] **Step 5: Jalankan** — `bunx vitest run src/modules/markdown src/modules/item` → Expected: PASS; hapus editor lama dan `edit-ops` bila tidak ada lagi pemakai; `bun run typecheck`.
- [ ] **Step 6: Ukur bundel** — `bun run build`; bandingkan dengan Step 1; bila melebihi anggaran (≈ +450 KB mentah / +150 KB gzip) **berhenti dan laporkan**.
- [ ] **Step 7: Commit** — `git add web bun.lock && git commit -m "feat(markdown): editor WYSIWYG Tiptap menggantikan editor Detail Item"`

### Task 7: Editor Catatan serah terima dan tampilan catatan dengan komentar (`web/`)

**Files:**
- Create: `web/src/modules/handover/components/note-editor.tsx`, `note-view.tsx`, `comment-composer.tsx`, `web/src/modules/handover/lib/paste-extension.ts`
- Test: tes berdampingan tiap file

**Interfaces:**
- Consumes: Task 1, Task 2 (`noteToPlainText`, `makeAnchor`), Task 6 (`WysiwygEditor`).
- Produces:
  ```ts
  export function whatsappPasteExtension(): import('@tiptap/core').Extension;   // paste → whatsappToNoteMarkdown → konten editor; hanya jalur teks biasa
  export function NoteEditor(props: { id: string; value: string; onChange: (md: string) => void; labelledBy?: string; disabled?: boolean }): JSX.Element; // WysiwygEditor mode 'note' + ekstensi paste, maxLength 5000
  export interface NoteViewProps {
    note: string; checklist: HandoverChecklistItemDto[]; comments: HandoverCommentDto[];
    canCheck: boolean; canComment: boolean;
    onCheck: (item: { index: number; text: string }, checked: boolean) => void;
    onComment: (input: { quote: string; before: string; after: string; body: string }) => Promise<void> | void;
  }
  export function NoteView(props: NoteViewProps): JSX.Element;
  ```
- Perilaku `NoteView`: merender Markdown aman (`MarkdownView` yang ada) dengan butir checklist sebagai checkbox berlabel yang dapat diklik bila `canCheck` (menampilkan pelaku/waktu pada butir tercentang); kutipan komentar disorot; **setiap teks dipilih di dalam catatan (desktop dan ponsel) memunculkan tombol "Balas" mengambang di dekat seleksi** (mendengarkan `selectionchange`, bukan klik kanan); menekannya membuka `CommentComposer` kecil; komentar tampil sebagai daftar (kutipan + isi + pelaku/waktu), yang usang diberi label "usang". Isi komentar dirender sebagai teks biasa.

- [ ] **Step 1: Tulis tes yang gagal** — `paste-extension`: `menempel teks WhatsApp menghasilkan butir checklist dan paragraf`, `menempel di tengah teks mempertahankan teks sebelum/sesudah dan undo mengembalikannya`, `tempelan HTML/rich diabaikan atau dibersihkan (tanpa script)`. `NoteView`: `mencentang memanggil onCheck dengan index dan text`, `canCheck false → checkbox disabled`, `memilih teks memunculkan tombol Balas; tanpa seleksi tidak ada` (mock `window.getSelection`), `Balas membuka composer dan kirim memanggil onComment dengan quote/before/after`, `komentar usang diberi label`, `isi komentar <img onerror> tampil sebagai teks`, `tombol Balas dapat dijangkau keyboard`.
- [ ] **Step 2: Jalankan, pastikan gagal** — `cd web && bunx vitest run src/modules/handover/components/note-editor src/modules/handover/components/note-view src/modules/handover/lib` → Expected: FAIL.
- [ ] **Step 3: Implementasi** ketiga komponen dan ekstensi paste (memakai `whatsappToNoteMarkdown` dari `@shared/handover-paste`).
- [ ] **Step 4: Jalankan, pastikan lolos** — perintah Step 2 → Expected: PASS.
- [ ] **Step 5: Commit** — `git add web && git commit -m "feat(handover): editor Catatan (paste WhatsApp) dan tampilan catatan dengan centang dan komentar"`

### Task 8: Form task tunggal dan bulk (`web/`)

**Files:**
- Modify: `web/src/modules/handover/schemas.ts`, `components/handover-form.tsx`, `components/customer-combobox.tsx` (hanya bila perlu), `web/src/routes/_app/handover/new.tsx`, `web/src/routes/_app/handover/$handoverId/edit.tsx`, `web/src/modules/handover/queries.ts`
- Create: `components/handover-batch-form.tsx`, `components/whatsapp-paste-panel.tsx`
- Delete: `components/item-lines-field.tsx` (+ tesnya)
- Test: tes berdampingan

**Interfaces:**
- Consumes: Task 3 (`SaveHandoverInput`, `SaveHandoverBatchInput`), Task 4 (RPC `save`, `saveBatch`, `options`), Task 7 (`NoteEditor`), Task 1 (`splitWhatsappBatch`).
- Produces (`queries.ts`): `useSaveHandover()`, `useSaveHandoverBatch()` (menyisipkan hasil ke cache board lewat `upsertInList` dari `@/lib/query-cache` dan menandai `accessKeys.audit` basi tanpa refetch).
- Produces: `HandoverBatchForm` — lokasi dipilih sekali; daftar kartu form (`CustomerCombobox` + `NoteEditor` per task); tombol tambah, hapus, dan **gandakan** kartu (catatan sama, customer kosong); area `WhatsappPastePanel`: tempelan besar → `splitWhatsappBatch` → pratinjau hasil (usulan customer dapat diganti, tiap catatan dapat disunting) → "Tambahkan ke batch"; tombol "Simpan semua (N)"; galat server `fields.tasks` menandai kartu bermasalah dan draf tetap utuh.

- [ ] **Step 1: Tulis tes yang gagal** — `handover-form.test.tsx`: `form task tunggal tidak punya pemilihan item; mengirim save {locationId, customerName, note}`, `catatan di atas 5.000 karakter menampilkan galat tanpa mengosongkan draf`. `handover-batch-form.test.tsx`: `lokasi dipilih sekali untuk seluruh batch`, `tambah/hapus/gandakan kartu`, `Simpan semua mengirim saveBatch dengan semua task`, `galat server pada task ke-2 menandai kartu ke-2 dan mempertahankan semua draf`, `batch di atas 30 task menonaktifkan tambah`. `whatsapp-paste-panel.test.tsx`: `empat contoh pemilik terpecah 1, 2, 1, 3 task dengan usulan customer`, `usulan customer dapat diganti sebelum ditambahkan`, `tempelan kosong tidak menambah task`.
- [ ] **Step 2: Jalankan, pastikan gagal** — `cd web && bunx vitest run src/modules/handover/components src/modules/handover/schemas` → Expected: FAIL.
- [ ] **Step 3: Implementasi** form tunggal (editor Catatan, customer opsional), halaman `/handover/new` dengan peralihan "Satu task / Banyak task (bulk)", halaman ubah memakai form tunggal dengan `expectedUpdatedAt`, serta skema zod baru. Hapus `ItemLinesField`.
- [ ] **Step 4: Jalankan, pastikan lolos** — perintah Step 2 → Expected: PASS.
- [ ] **Step 5: Commit** — `git add web && git commit -m "feat(handover): form task tunggal dan bulk (paste WhatsApp, gandakan, simpan semua)"`

### Task 9: Board kanban/kartu, kartu, dan halaman detail (`web/`)

**Files:**
- Create: `web/src/modules/handover/components/handover-board.tsx`, `handover-card.tsx`, `lib/group-board.ts`
- Modify: `web/src/modules/handover/queries.ts`, `web/src/routes/_app/handover/index.tsx`, `web/src/routes/_app/handover/$handoverId/index.tsx`, `components/handover-detail-view.tsx`
- Delete: `components/handovers-table.tsx`, `lib/filter-handovers.ts` (diganti), tesnya
- Test: tes berdampingan

**Interfaces:**
- Consumes: Task 4–5 RPC, Task 7 (`NoteView`), `@/lib/query-cache`.
- Produces (`queries.ts`): `handoverBoardQueryOptions(locationIds: readonly string[])` (RPC `handovers.board`), `useSetCheck()`, `useSetDone()`, `useAddComment()`, `useCancelHandover()` — tiap mutasi memasang `HandoverDto` hasil server ke cache board dan detail (`upsertInList`, `setQueryData`) tanpa menunggu refetch.
- Produces (`lib/group-board.ts`): `groupBoard(items: HandoverDto[]): Record<HandoverStatus, HandoverDto[]>` (tiap kolom terbaru dahulu) dan `filterByStatus(items, status | 'all')`.
- Produces: `HandoverBoard` (≥ `md`: empat kolom; < `md`: daftar kartu dengan filter Semua/Baru/Dikerjakan/Selesai/Dibatalkan, bawaan Semua; semua task tampil, tanpa pemotongan); `HandoverCard` — nomor, customer, label status, `NoteView` (seluruh catatan, centang langsung), progres (mis. 1/2), jumlah komentar, pelaku/waktu centang terakhir; tombol **Mark done** (aktif bila `qc: edit`; pada kartu Selesai menjadi aksi buka kembali; menyembunyikan/menonaktifkan sesuai izin), tombol **More** hanya bila ada aksi (Ubah bila `handover: edit`, Batalkan bila `handover: manage` dengan konfirmasi); klik badan kartu membuka `/handover/$handoverId`; klik centang/tautan/tombol tidak membuka detail. Seluruh board dimuat satu RPC; keadaan kosong, galat, dan "belum memilih lokasi" punya tampilan jelas.
- Halaman detail: `NoteView` penuh (centang, komentar), tombol sesuai izin, riwayat/pelaku.

- [ ] **Step 1: Tulis tes yang gagal** — `group-board.test.ts`: `mengelompokkan ke empat status, terbaru dahulu`. `handover-card.test.tsx`: `menampilkan seluruh catatan panjang tanpa dipotong`, `Mark done memanggil setDone(true); pada kartu Selesai memanggil setDone(false)`, `Mark done dinonaktifkan tanpa qc:edit`, `More tidak dirender untuk pengguna yang hanya QC`, `More berisi Ubah dan Batalkan sesuai izin; Batalkan meminta konfirmasi`, `klik centang tidak membuka detail; klik badan membuka detail`. `handover-board.test.tsx`: `layar lebar memakai empat kolom; layar sempit memakai daftar kartu dengan filter` (mock `matchMedia`), `task Dibatalkan dan Selesai ikut tampil`, `mencentang memindahkan kartu ke kolom yang sesuai tanpa memuat ulang`, `board memuat satu RPC untuk satu lokasi` (hitung panggilan mock), `data satu task rusak tidak menghilangkan kartu lain`.
- [ ] **Step 2: Jalankan, pastikan gagal** — `cd web && bunx vitest run src/modules/handover` → Expected: FAIL.
- [ ] **Step 3: Implementasi** komponen, query, dan rute; pertahankan pemilih lokasi header dan `readableLocationIds`. Hapus `HandoversTable` dan `filterHandovers` bila tak terpakai.
- [ ] **Step 4: Jalankan, pastikan lolos** — perintah Step 2 → Expected: PASS; `bun run typecheck`.
- [ ] **Step 5: Verifikasi di peramban** — `bun run dev` (mock backend): buat task dari tempelan WhatsApp, centang, Mark done, komentar lewat tombol Balas, lebar desktop dan 375 px, tema gelap; lampirkan tangkapan layar di PR.
- [ ] **Step 6: Commit** — `git add web && git commit -m "feat(handover): board kanban/kartu, kartu dengan Mark done dan More, serta halaman detail"`

### Task 10: Pembersihan, dokumen, dan verifikasi akhir (agent Haiku)

**Files:**
- Modify: `web/src/lib/rpc/mock-backend.ts` (seed handover tanpa item), `gas/test-support/*` sisa, `docs/prd/2026-10-09-qc-item-serah-terima.md` (FH1–FH9, FQ1–FQ6, FAU1–FAU2), `docs/prd/2026-10-18-qc-serah-terima-catatan-checklist.md` dan `docs/superpowers/plans/2026-10-18-qc-serah-terima-catatan-checklist.md` (catatan "DIGANTIKAN oleh `docs/superpowers/specs/2026-10-23-serah-terima-catatan-wysiwyg-design.md`" di bagian atas), `docs/e2e-checklist.md`, `CLAUDE.md`
- Test: seluruh suite

**Interfaces:** Consumes semua task sebelumnya; tidak menghasilkan antarmuka baru.

- [ ] **Step 1: Cari sisa rujukan lama** — `grep` untuk `handover_lines`, `HandoverLine`, `itemLines`, `setProgress`, `completeLine`, `doneQty`, `item-lines-field`, `HandoverSummaryDto` di `gas/`, `shared/`, `web/`, dan `docs/` yang aktif; hapus atau perbarui seluruh sisa (kecuali sheet `handover_lines` di Sheets).
- [ ] **Step 2: Perbarui dokumen** — PRD 2026-10-09: ganti ketentuan item/qty pada serah terima dengan catatan + checklist (rujuk dokumen desain); tandai PRD dan rencana 2026-10-18 digantikan; `docs/e2e-checklist.md`: tambah baris E2E (tempel WhatsApp → task, bulk dari tempelan, centang + Mark done, komentar lewat Balas, kanban vs kartu 375 px, More hanya bila ada aksi, editor Detail Item WYSIWYG dengan gambar); `CLAUDE.md`: perbarui butir serah terima (Task berbasis catatan, `shared/handover-paste.ts`, `handover-checklist.ts`, `handover-comments.ts`, editor `wysiwyg-editor.tsx`, RPC baru) dan hapus rujukan item/qty.
- [ ] **Step 3: Jalankan verifikasi penuh** — `bun run check` → Expected: seluruh tes hijau tanpa galat tipe/lint; `bun run build` → Expected: `verify-dist OK`; catat ukuran `gas/dist/index.html` terhadap awal Task 6.
- [ ] **Step 4: Commit** — `git add -A -- docs CLAUDE.md gas shared web && git commit -m "chore(handover): bersihkan sisa item/qty dan perbarui dokumen"`
