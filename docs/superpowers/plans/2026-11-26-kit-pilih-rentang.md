# Kit Pilih Rentang (shift-klik dan pilih tarik) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Semua tabel dan kartu berkotak centang mendukung pilih rentang: shift-klik (dan Shift+Spasi) di desktop, pilih tarik di ponsel.

**Architecture:** Satu fungsi murni `rangeBetween` dan satu hook jangkar `useRangeSelect` (desktop) dipakai `DataTable`, `GridView`, tab pustaka dialog berkas, dan tabel draf Serial. Pilih tarik (ponsel) menjadi ekstensi `useLongPressSelect` yang sudah ada (jalan masuk: tekan lama lalu tarik, atau tarik dari lajur kotak centang) dan dipakai `DataCards`, `GridView`, dan `StagingCards`. Tanpa perubahan server.

**Tech Stack:** React 19, TypeScript, Radix Checkbox (`web/src/components/ui/checkbox.tsx`), Vitest + Testing Library (`bun run --cwd web test <berkas>`).

**Spec:** `docs/superpowers/specs/2026-11-26-serial-keluar-gudang-design.md` bagian 5.13 (cakupan dan perilaku) dan keputusan 18-21.

## Global Constraints

- Teks UI dan komentar berbahasa Indonesia sehari-hari; istilah asing umum boleh.
- Tanpa mengubah perilaku bila fitur tidak dipakai: ketukan biasa dan tekan lama tanpa menarik tetap persis seperti sekarang (`use-long-press-select`, `mobile-select`, `select-mode`, `data-table`, `grid-view` tes yang ada tetap hijau).
- Pilihan hanya atas baris yang sedang dimuat dan **dapat dipilih** (`rowSelectable`/`isSelectable` false dilewati).
- Ambang ponsel/desktop hanya lewat `useIsDesktop` dan `lib/layout.ts`; jangan menulis angka 704/768 baru.
- Komponen di `web/src/components/**` tidak boleh mengimpor `@/modules/**`.
- Tes memakai timer asli untuk tekan lama (`web/src/test/long-press.ts`, `LONG_PRESS_MS` = 500); jangan menurunkan ambang.
- Biome bersih (`bunx biome check <berkas>`), `bun run --cwd web typecheck` bersih.

## Review Focus

- Baris hilang saat refetch atau halaman berikutnya dimuat di tengah gestur: jangkar/pemulaan tak valid diperlakukan "tanpa jangkar", tidak melempar galat.
- Rentang yang melintasi baris `rowSelectable` false: baris itu tidak ikut berubah.
- Dialog pilih berkas dengan batas jumlah (`maxFiles`): rentang berhenti di batas, tidak melebihi, dan memberi tahu pengguna.
- Seret mundur ke atas melepas pilihan yang terlewati (bukan hanya menambah), dan `pointercancel` di tengah gestur meninggalkan pilihan sebagian tanpa galat.
- Gulir halaman biasa di ponsel (jari bukan di lajur kotak centang, tanpa tekan lama) tetap menggulir dan tidak memilih apa pun.

---

## File Structure

- Buat `web/src/components/data-table/selection-range.ts` (fungsi murni `rangeBetween`) + `selection-range.test.ts`.
- Buat `web/src/components/data-table/use-range-select.ts` (hook jangkar shift-klik) + `use-range-select.test.tsx`.
- Buat `web/src/components/data-table/use-drag-select.ts` (pengendali seret + gulir otomatis) + `use-drag-select.test.tsx`.
- Ubah `use-long-press-select.ts` (opsi `ids`, atribut `data-select-id`, jalur seret), `data-table.tsx`, `data-cards.tsx`, `index.ts` (ekspor), `web/src/components/grid/grid-view.tsx`, `web/src/components/file-dialog/library-tab.tsx` dan `file-dialog.tsx`, `web/src/modules/serial/components/staging-table.tsx`, `staging-cards.tsx`, `record-page.tsx`.
- Dokumen: `CLAUDE.md` (bullet kit CRUD), `server/changelog.d/20261126-pilih-rentang.md`.

### Task 1: `rangeBetween` dan `useRangeSelect`

**Files:**
- Create: `web/src/components/data-table/selection-range.ts`, `web/src/components/data-table/use-range-select.ts`
- Test: `selection-range.test.ts`, `use-range-select.test.tsx` (folder yang sama)

**Interfaces:**
- Produces:
  - `rangeBetween(orderedIds: readonly string[], anchorId: string, targetId: string): string[]` — id dari anchor sampai target inklusif menurut urutan `orderedIds`, arah mana pun; `[]` bila salah satunya tidak ada.
  - `useRangeSelect(options: { ids: readonly string[]; isSelected: (id: string) => boolean; apply: (ids: readonly string[], on: boolean) => void }): { checkboxProps: (id: string) => { onClick: (event: MouseEvent<HTMLElement>) => void; onMouseDown: (event: MouseEvent<HTMLElement>) => void } }`

- [ ] **Step 1: Tes `rangeBetween`** — kasus: maju `['a','b','c','d']` a→c = `['a','b','c']`; mundur c→a = `['a','b','c']`; satu baris a→a = `['a']`; id tak ada = `[]`.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/components/data-table/selection-range.test.ts` — Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasi `rangeBetween`** dengan dua `indexOf`.
- [ ] **Step 4: Tes hook** (render komponen kecil dengan tiga `Checkbox` memakai `checkboxProps`): klik biasa pada b lalu shift-klik pada d memanggil `apply(['b','c','d'], true)`; klik b (pilih) lalu b lagi (lepas) lalu shift-klik d memanggil `apply(['b','c','d'], false)` (keadaan jangkar = hasil klik terakhir pada jangkar); shift-klik tanpa jangkar tidak memanggil `apply` dan membiarkan toggle bawaan; jangkar yang id-nya hilang dari `ids` dianggap tanpa jangkar; setelah shift-klik jangkar pindah ke baris yang diklik (shift-klik berikutnya dihitung dari sana); `mousedown` dengan Shift memanggil `preventDefault` (teks tak terseleksi).
- [ ] **Step 5: Implementasi `useRangeSelect`.** `onClick`: tanpa Shift (atau tanpa jangkar valid) simpan jangkar `{ id, on: !isSelected(id) }` lalu biarkan toggle bawaan berjalan; dengan Shift panggil `event.preventDefault()` (Radix menghormati `defaultPrevented`, jadi toggle bawaan tidak jalan), `apply(rangeBetween(ids, anchor.id, id), anchor.on)`, lalu pindahkan jangkar ke `id`. Simpan opsi di `ref` agar penangan stabil.
- [ ] **Step 6: Jalankan kedua berkas tes** — Expected: PASS. Commit: `feat(web): rangeBetween dan useRangeSelect untuk pilih rentang`.

### Task 2: DataTable desktop

**Files:**
- Modify: `web/src/components/data-table/data-table.tsx` (sel kotak centang baris, sekitar baris 301-309), `web/src/components/data-table/index.ts` (ekspor `rangeBetween`, `useRangeSelect`)
- Test: `web/src/components/data-table/data-table.test.tsx` (tambah kasus)

**Interfaces:**
- Consumes: `useRangeSelect`, `RowSelection.setAll(ids, on)`.

- [ ] **Step 1: Tes** — tabel 5 baris dengan `selection`; klik kotak centang baris 1, shift-klik baris 4: baris 1-4 `aria-checked=true`, baris 5 false. Kasus kedua: baris 3 `rowSelectable` false (tanpa kotak centang): shift-klik rentang 1→5 memilih 1, 2, 4, 5 saja. Kasus ketiga: header "Pilih semua" tidak berubah perilakunya.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/components/data-table/data-table.test.tsx` — Expected: kasus baru FAIL.
- [ ] **Step 3: Implementasi.** Di `DataTable`: `useRangeSelect({ ids: selectableIds, isSelected: (id) => selection?.selected.has(id) ?? false, apply: (rangeIds, on) => selection?.setAll(rangeIds, on) })`; sebarkan `checkboxProps(id)` ke `Checkbox` baris (`onCheckedChange` tetap `toggle`). Pastikan `Checkbox` meneruskan `onClick`/`onMouseDown` ke akarnya (periksa `ui/checkbox.tsx`; ia menyebarkan `...props`).
- [ ] **Step 4: Jalankan** seluruh `src/components/data-table` — Expected: PASS (tes lama tak berubah). Commit: `feat(web): shift-klik memilih rentang di DataTable`.

### Task 3: GridView dan pustaka gambar (desktop)

**Files:**
- Modify: `web/src/components/grid/grid-view.tsx` (kotak centang kartu, baris 169-177), `web/src/components/file-dialog/library-tab.tsx` (kotak centang mode jamak, baris 333-339; prop baru `onSelectRange`), `web/src/components/file-dialog/file-dialog.tsx` (implementasi, dekat `toggle` baris 188-202)
- Test: `grid-view.test.tsx`, `web/src/components/file-dialog/library-tab.test.tsx` (atau tes dialog yang ada)

**Interfaces:**
- Produces: `LibraryTab` prop opsional `onSelectRange?: (items: readonly LibraryItem[], on: boolean) => void`.
- Consumes: `useRangeSelect`, `maxFiles`/`capacity` di `file-dialog.tsx`.

- [ ] **Step 1: Tes GridView** — kisi dengan `selection` di lebar desktop: klik kartu 1, shift-klik kartu 3 memilih 1-3; kartu `isSelectable` false dilewati.
- [ ] **Step 2: Tes pustaka dialog** — mode jamak `maxFiles = 3`, 6 gambar: klik gambar 1 lalu shift-klik 6 memilih hanya 1-3 dan menampilkan toast "Maksimal 3 berkas" (teks persis boleh disesuaikan gaya proyek; asersi memeriksa toast dipanggil); mode `single` tidak mendukung rentang (shift-klik = klik biasa).
- [ ] **Step 3: Jalankan** kedua tes — Expected: FAIL.
- [ ] **Step 4: Implementasi.** `GridView`: `useRangeSelect` atas `selectableIds`. `LibraryTab` (mode jamak): `useRangeSelect({ ids: items.map(id), isSelected: selection.has, apply: (ids, on) => onSelectRange?.(items.filter(...), on) })`; `FileDialog` mengimplementasikan `onSelectRange` dengan menambah item satu per satu sampai `capacity` (mengikuti aturan kuota yang sama dengan `toggle`), lalu toast bila ada yang terpotong.
- [ ] **Step 5: Jalankan** `src/components/grid` dan `src/components/file-dialog` — Expected: PASS. Commit: `feat(web): pilih rentang di GridView dan pustaka dialog berkas`.

### Task 4: Draf Serial (desktop) dan prop `onSelectMany`

**Files:**
- Modify: `web/src/modules/serial/components/record-page.tsx` (setelah `selectAll`, baris 634-637; pemanggil di baris ~1213 dan ~1229), `staging-table.tsx` (prop baru, kotak centang `input` baris ~265-273), `staging-cards.tsx` (adaptor `RowSelection` baris 157-167)
- Test: `staging-table.test.tsx`, `staging-cards.test.tsx` (yang ada) dan tes `record-page`

**Interfaces:**
- Produces: prop `onSelectMany: (clientIds: readonly string[], selected: boolean) => void` pada `StagingTable` dan `StagingCards`; di `record-page`: `selectMany` stabil (`useCallback`) yang memperbarui hanya baris dengan id itu lewat `setAllRows`.
- Perbaikan wajib: adaptor `StagingCards` memetakan `setAll(ids, on)` ke `onSelectMany(ids, on)` (sebelumnya mengabaikan `ids` dan memanggil `onSelectAll`).

- [ ] **Step 1: Tes** — `StagingTable` dengan 5 baris dan `onSelectMany` mock: klik kotak baris 2, shift-klik baris 4 memanggil `onSelectMany(['c2','c3','c4'], true)`; klik biasa tetap memanggil `onSelect`. `StagingCards`: panggilan `selection.setAll(['c2','c3'], true)` lewat gestur mengubah hanya baris itu (tidak semua baris). `record-page`: `selectMany` hanya mengubah baris yang dituju.
- [ ] **Step 2: Jalankan** tes serial terkait (`bun run --cwd web test src/modules/serial/components/staging`) — Expected: FAIL.
- [ ] **Step 3: Implementasi** seperti Interfaces; `StagingTable` memakai `useRangeSelect` dengan `checkboxProps` pada `input` bawaan (handler `onClick`/`onMouseDown`; `onChange` tetap `onSelect`). Perbarui semua pemanggil dan tes yang merender dua komponen ini.
- [ ] **Step 4: Jalankan** `src/modules/serial` — Expected: PASS. Commit: `feat(web): pilih rentang di draf Serial (onSelectMany)`.

### Task 5: Pengendali seret (ponsel)

**Files:**
- Create: `web/src/components/data-table/use-drag-select.ts`
- Modify: `web/src/components/data-table/use-long-press-select.ts`
- Test: `use-drag-select.test.tsx`; tambah ke `mobile-select.test.tsx`

**Interfaces:**
- Produces:
  - `useLongPressSelect(selection: RowSelection | undefined, enabled: boolean, options?: { ids?: readonly string[] })` — tanda tangan lama utuh; `bind(id)` kini juga mengembalikan `'data-select-id': id`. Tanpa `options.ids`, seret nonaktif (perilaku lama).
  - Penanda lajur: elemen apa pun dengan atribut `data-select-lane` (mis. pembungkus kotak centang) memulai seret saat mode pilih aktif.
  - `useDragSelect(args: { selection: RowSelection; ids: readonly string[] })` mengembalikan `{ begin(startId: string, pointer: { x: number; y: number; id: number }, on: boolean): void; move(x: number, y: number): void; end(): void; dragging: boolean }`.
- Perilaku `begin`: ambil snapshot pilihan; `move` memakai `document.elementFromPoint(x, y)?.closest('[data-select-id]')` untuk mencari id target; pilihan yang diinginkan = snapshot ditambah (`on`) atau dikurangi (`!on`) `rangeBetween(ids, startId, targetId)`; terapkan selisih terhadap pilihan sekarang lewat `selection.setAll` (dua panggilan: tambah dan lepas); `navigator.vibrate?.(8)` saat target berganti. Gulir otomatis: loop `requestAnimationFrame` selama `dragging`; bila y dalam 56 px dari tepi atas/bawah wadah gulir terdekat (ancestor `overflow-y: auto|scroll`, selain itu `window`), gulir hingga 18 px/frame sebanding kedekatan tepi lalu hitung ulang target dari koordinat terakhir. Selama seret dari tekan lama, pasang `touchmove` non-pasif di `document` yang memanggil `preventDefault` (jari belum menggulir karena belum bergeser melewati toleransi); lepas saat `end`.

- [ ] **Step 1: Tes `useDragSelect`** (stub `document.elementFromPoint`): seret dari baris 2 ke baris 5 memilih 2-5; kembali ke baris 3 menyisakan 2-3 (melepas yang terlewati); seret dengan `on=false` mulai dari baris terpilih melepas rentang; id target tak ada (di luar daftar) tidak mengubah; `end()` menghentikan gulir otomatis (tes dengan `vi.useFakeTimers` dan `requestAnimationFrame` palsu: `window.scrollBy` dipanggil dengan nilai negatif dekat tepi atas, positif dekat tepi bawah, dan tidak dipanggil setelah `end`).
- [ ] **Step 2: Tes integrasi di `mobile-select.test.tsx`** — jalan masuk 1: `pointerDown` pada kartu 2, tunggu `LONG_PRESS_MS`, `pointerMove` ke koordinat kartu 4 (stub `elementFromPoint`) lalu `pointerUp`: kartu 2-4 terpilih. Jalan masuk 2: pada mode pilih (kartu 1 terpilih), `pointerDown` pada elemen `data-select-lane` kartu 3 lalu `pointerMove` ke kartu 5: kartu 3-5 ikut terpilih. Gulir biasa: `pointerDown` pada badan kartu (bukan lajur) saat mode pilih lalu `pointerMove` jauh tidak memilih apa pun. `pointerCancel` di tengah seret tidak melempar dan meninggalkan pilihan sebagian.
- [ ] **Step 3: Jalankan** `bun run --cwd web test src/components/data-table` — Expected: kasus baru FAIL, kasus lama PASS.
- [ ] **Step 4: Implementasi `useDragSelect`** dan sambungkan di `useLongPressSelect`: setelah timer tekan lama menembak dan `options.ids` ada, panggil `begin(id, ..., true)` (pilihan awal baris itu sudah di-toggle); `onPointerMove` meneruskan ke `move` bila sedang seret, selain itu perilaku toleransi lama; `onPointerDown` pada elemen di dalam `[data-select-lane]` saat `selecting` memulai `begin(id, ..., !selection.selected.has(id))` dan mencegah entri tekan lama; `onPointerUp`/`onPointerCancel` memanggil `end`. Pastikan klik yang menyusul seret ditelan (flag `fired` yang sama) dan pendengar `scroll` yang memanggil `cancel` tidak mengakhiri seret.
- [ ] **Step 5: Jalankan** seluruh `src/components/data-table` — Expected: PASS. Commit: `feat(web): pilih tarik di ponsel (useDragSelect)`.

### Task 6: Pasang seret di DataCards, GridView, StagingCards

**Files:**
- Modify: `data-cards.tsx` (baris 66 dan pembungkus `leading` baris 142-150), `grid-view.tsx` (baris 94 dan pembungkus kotak centang 169-177), `staging-cards.tsx` (baris 169-172 dan kotak centang kartu)
- Test: `data-table/mobile-select.test.tsx`, `grid-view.test.tsx`, `staging-cards.test.tsx`

**Interfaces:**
- Consumes: opsi `ids` dan `data-select-lane` dari Task 5.

- [ ] **Step 1: Tes** — untuk tiap tiga komponen: di lebar ponsel pada mode pilih, seret dari lajur kotak centang kartu ke-2 ke kartu ke-4 memilih tiga kartu (tabel/kisi memakai `selection` nyata, kartu draf memakai `onSelectMany`); kartu `isSelectable` false dilewati.
- [ ] **Step 2: Jalankan** ketiganya — Expected: FAIL.
- [ ] **Step 3: Implementasi.** Teruskan `{ ids }` (id terpilih-able berurutan: `ids` di `DataCards`, `selectableIds` di `GridView`, `ids` di `StagingCards`) ke `useLongPressSelect`; bungkus kotak centang mode pilih dengan elemen `data-select-lane` berukuran sentuh 44 px dan kelas `touch-none` (hanya lajur itu yang `touch-action: none`).
- [ ] **Step 4: Jalankan** `bun run --cwd web test src/components src/modules/serial` — Expected: PASS. Commit: `feat(web): pilih tarik terpasang di DataCards, GridView, StagingCards`.

### Task 7: Dokumentasi dan pemeriksaan penuh

**Files:**
- Modify: `CLAUDE.md` (bullet "Kit CRUD", bagian aturan DataTable dan ponsel: satu kalimat tentang pilih rentang beserta tiga tempat pemakaian), buat `server/changelog.d/20261126-pilih-rentang.md` (satu baris: `feat(web): pilih rentang dengan shift-klik di desktop dan pilih tarik di ponsel untuk semua tabel dan kartu berkotak centang`)

- [ ] **Step 1:** Perbarui dua berkas di atas.
- [ ] **Step 2:** Jalankan `bun run --cwd web typecheck`, `bunx biome check web/src docs` (hanya berkas yang diubah), dan `bun run --cwd web test` — Expected: semua hijau. (`bun run check` penuh membutuhkan terowongan database hidup.)
- [ ] **Step 3: Verifikasi manual** di server dev (`bun run dev`) bila terowongan hidup: shift-klik di `/item`, seret di ponsel (viewport 390) pada `/item` dan Catat Serial. Catat hasil; jika tak dapat dijalankan, laporkan sebagai belum diverifikasi.
- [ ] **Step 4: Commit:** `docs: catat pilih rentang di CLAUDE.md dan changelog`.
