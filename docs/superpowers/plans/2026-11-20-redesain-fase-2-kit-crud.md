# Redesain Fase 2: Kit CRUD — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik (implementasi → satu review akhir putaran + `security-audit` → perbaikan).

**Goal:** Komponen kerangka halaman yang dipakai ulang semua modul: `ListPage` (bar headroom), `FilterBar`, `DataTable`, `KanbanBoard`, `GridView`, `ViewPage`, `FormPage`/`FormDialogShell` + `FormTabs`; Pustaka Gambar menjadi pemakai nyata pertama.

**Architecture:** Satu hook `useHeadroom` mengatur bar judul yang muncul lagi saat gulir naik dan menulis variabel CSS `--headroom-offset` pada kerangka; elemen pengikut (header tabel, tab form) memakai `top: var(--headroom-offset)`. Form ditulis sekali sebagai elemen `<form id>` berisi field; `FormPage` dan `FormDialogShell` hanya menyediakan header/footer yang tombol submit-nya menaut lewat atribut `form={formId}`, sehingga satu komponen form dipakai di halaman dan dialog tanpa disalin.

**Tech Stack:** React 19, TanStack Router (`Link`), Tailwind 4, shadcn 4 (`ui/tabs` varian `line`, `ui/popover`, `ui/checkbox`, `ui/skeleton`), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§6.5-6.7, §8 butir 5-8). Mockup: `docs/superpowers/specs/assets/2026-11-20-redesain-mockup-v3.html` (layar 2-5).

## Global Constraints

- Memakai fondasi fase 1: `Button`/`Badge` `color`×`variant`, `ActionButton` (`compact` = ikon + tooltip + `aria-label`), `Alert color`, token `*-text`, `PageContainer` via `staticData.pageWidth`.
- Header aplikasi setinggi `3.5rem` (`h-14`, sticky); bar headroom menempel tepat di bawahnya.
- Tautan kolom: warna `text-info-text`, garis bawah saat hover, komponen `Link` Router.
- Checkbox dan kolom aksi di KIRI tabel; tanpa tombol "Lihat".
- Kanban: lebar minimum kolom 290 px, gulir horizontal; warna kolom dari `UiColor` nilai yang dikelompokkan.
- Tanpa `<select>` bawaan; filter relasi `LinkField`/`LinkMultiField`, enum `Select`/`MultiSelect`.
- Aksi massal (keputusan pemilik 19): "Pilih semua" memilih SEMUA baris yang sudah dimuat; pengiriman bertahap per `BATCH_MAX` lewat helper bersama `runChunkedBatch` (tiap tahap atomik di server, keseluruhan tidak; tahap gagal menghentikan tahap berikutnya). Luring (`UNAVAILABLE`) = toast galat, tidak diantrekan.
- Tabel < 768 px (keputusan pemilik 22): aksi baris = satu tombol "⋯" berlabel (menu), checkbox tetap, tabel menggulir horizontal, kolom unik tetap terlihat.
- Aksesibilitas (keputusan perancang T15): bar headroom tersembunyi `inert` dan muncul lagi saat `focus-within`; checkbox baris `aria-label` "Pilih <nama>"; tombol ikon-saja tetap `aria-label`; `scroll-margin-top` = tinggi header + bar.
- Kerangka meneruskan `data-tour` lewat prop (`ListPage`, `FormPage`, `LinkCell`) agar target panduan tidak hilang (T13).
- `prefers-reduced-motion: reduce` → tanpa animasi geser.
- Wajib hijau: `bun run --cwd web test`, `bun run typecheck`, `bun run lint`, `bun test scripts/`, `bun run build`. Jangan sentuh server dev pengguna (port 3000).

## Review Focus

1. Halaman lebih pendek dari layar → bar headroom tidak pernah tersembunyi (tak ada "lompatan"). (Task 1)
2. Tabel di dalam pembungkus ber-`overflow-x-auto` mematikan `position: sticky` header → header tabel tetap menempel di ≥ 768 px. (Task 3)
3. Filter berubah saat ada baris terpilih → pilihan dikosongkan agar aksi massal tak mengenai baris yang tak terlihat. (Task 3)
4. Submit form gagal validasi di tab yang tidak aktif → tab pertama yang bergalat diaktifkan dan bertanda titik merah. (Task 7)
5. Tombol Simpan di header halaman/footer dialog berada di luar elemen `<form>` → tetap men-submit form yang benar lewat `form={formId}`, juga saat dua form ada di layar (halaman + dialog Tambah). (Task 7)
6. Aksi massal atas > 100 id: tahap kedua gagal → tahap pertama tetap berlaku, id yang berhasil dibuang dari pilihan, sisanya tetap terpilih, toast "N dari M berhasil; sisanya gagal: …". (Task 3)
7. Bar headroom tersembunyi tidak dapat difokus lewat Tab (`inert`); menerima fokus lagi (mis. Shift+Tab) memunculkannya. (Task 1)
8. `KanbanBoard height="viewport"` dengan banner status server tampil: kolom tidak terpotong dan tidak ada gulir halaman ganda. (Task 4)

## Pembagian kelas beban

Sonnet (agent inti fase 1, dilanjutkan; compact dulu bila konteksnya tak relevan): Task 1-7. Haiku: Task 8. Berurutan.

---

### Task 1: `useHeadroom` dan `ListPage`

**Files:**
- Create: `web/src/hooks/use-headroom.ts`, `web/src/hooks/use-headroom.test.ts`, `web/src/components/page/list-page.tsx`, `web/src/components/page/list-page.test.tsx`

**Interfaces:**
- Produces:
  - `useHeadroom(options?: { revealAfter?: number; delta?: number }): { ref: RefCallback<HTMLElement>; hidden: boolean; floating: boolean; height: number }` — `revealAfter` bawaan 200 (px gulir sebelum boleh sembunyi), `delta` bawaan 4 (px gerak minimum). Sembunyi bila gulir turun > `delta` dan `scrollY > revealAfter` DAN dokumen lebih tinggi dari `innerHeight + height`; muncul bila gulir naik > `delta`; `floating` = `scrollY > 0`. Pendengar `scroll` pasif pada `window`; tinggi lewat `ResizeObserver` (tanpa RO: ukur sekali).
  - `HEADER_HEIGHT = '3.5rem'`; `headroomOffset(hidden: boolean, height: number): string` → `` `calc(3.5rem + ${hidden ? 0 : height}px)` ``.
  - `HeadroomBar({ children, className })` — `div` `sticky top-14 z-20 bg-background`, `data-hidden`, `data-floating`, terjemahan `-translate-y-[calc(100%+3.5rem)]` saat tersembunyi (tanpa transisi bila reduced motion), bayangan + garis bawah saat `floating`. Menulis `--headroom-offset` ke elemen kerangka induk lewat konteks `HeadroomContext` (`{ offset: string }`). Saat `hidden` bar diberi atribut `inert` dan `focus-within`/`onFocusCapture` memunculkannya lagi (T15); prop `pinned?: boolean` (bawaan false) mematikan sembunyi (dipakai Kanban viewport, T14). Kerangka memasang `scroll-margin-top: calc(3.5rem + <tinggi bar>)` pada target scroll (`[data-tour]`, `:target`) lewat `--headroom-offset`.
  - `ListPage({ title, actions?, filters?, bulkBar?, children }: { title: ReactNode; actions?: ReactNode; filters?: ReactNode; bulkBar?: ReactNode; children: ReactNode })` — kerangka: `HeadroomBar` (baris judul `h1` + `actions` kanan, lalu `filters`), isi, lalu `bulkBar` (sticky bawah). Elemen akar memasang `style={{ '--headroom-offset': offset }}`. `ListPage` menerima `tour?: string` (→ `data-tour` pada bar judul), `actionsTour?: string` (→ `data-tour` pada pembungkus `actions`), dan `pinned?: boolean` (diteruskan ke `HeadroomBar`).
- [ ] **Step 1: Tes gagal**: `use-headroom.test.ts` dengan `window.scrollY` dan `document.documentElement.scrollHeight` dipalsukan: gulir 0→300 → `hidden` true; 300→296 → `hidden` false; halaman pendek (scrollHeight ≤ innerHeight + height) gulir turun → tetap `hidden` false; `headroomOffset(false, 96)` = `'calc(3.5rem + 96px)'`. `list-page.test.tsx`: merender `h1` judul, slot `actions`, `filters`, `bulkBar`; akar punya `--headroom-offset`; bar tersembunyi memiliki `inert` dan kembali tak-`inert` saat salah satu anaknya menerima fokus; `tour`/`actionsTour` muncul sebagai `data-tour`; `pinned` tak pernah `hidden`.
- [ ] **Step 2:** `bun run --cwd web test src/hooks/use-headroom.test.ts src/components/page` → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Tes → PASS.
- [ ] **Step 5:** Commit `feat(web): bar headroom dan kerangka ListPage`.

### Task 2: `FilterBar` dan `FilterChip`

**Files:**
- Create: `web/src/components/page/filter-bar.tsx`, `web/src/components/page/filter-bar.test.tsx`

**Interfaces:**
- Produces:
  - `FilterBar({ search, children }: { search?: { value: string; onChange: (value: string) => void; placeholder: string; label: string }; children?: ReactNode })` — kolom cari (ikon `Search`, `aria-label` = `label`) + chip.
  - `FilterChip({ label, display, onClear, children }: { label: string; display?: string | null; onClear?: () => void; children: ReactNode })` — `display` kosong → tombol garis putus "+ {label}"; terisi → chip padat "{label}: **{display}**" (nilai berwarna `text-info-text`) + tombol `X` bernama "Hapus filter {label}". Klik chip membuka `Popover` berisi `children` (tempat `LinkField`/`Select`/dll.; portal daftar combobox tetap berfungsi di dalam popover).
- [ ] **Step 1: Tes gagal**: chip kosong bernama "+ Merk" (atau berteks "Merk" dengan ikon plus); klik → popover berisi anak tampil; chip terisi menampilkan "Status: Aktif" dan tombol "Hapus filter Status" memanggil `onClear`; mengetik di kolom cari memanggil `onChange`.
- [ ] **Step 2:** Jalankan → FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): FilterBar dan FilterChip`.

### Task 3: `DataTable`, `LinkCell`, `BulkBar`, `useRowSelection`

**Files:**
- Create: `web/src/components/data-table/data-table.tsx`, `link-cell.tsx`, `bulk-bar.tsx`, `row-actions.tsx` (tombol ikon ≥ 768 px, menu "⋯" < 768 px), `use-row-selection.ts`, `index.ts`, `web/src/lib/run-chunked-batch.ts`, dan tes `data-table.test.tsx`, `use-row-selection.test.ts`, `run-chunked-batch.test.ts`

**Interfaces:**
- Produces:
  - `interface DataColumn<T> { id: string; header: ReactNode; cell: (row: T) => ReactNode; align?: 'left' | 'right'; className?: string }`
  - `DataTable<T>(props: { rows: readonly T[]; rowKey: (row: T) => string; columns: readonly DataColumn<T>[]; label: string; selectLabel?: (row: T) => string; actions?: (row: T) => readonly RowAction[]; selection?: RowSelection; empty?: ReactNode; isError?: boolean; isLoading?: boolean; hasMore?: boolean; loadingMore?: boolean; onLoadMore?: () => void })` — tabel TANPA pembungkus `overflow-x-auto` di ≥ 768 px (agar sticky bekerja; di < 768 px pembungkus gulir horizontal boleh). `thead th` `sticky top-[var(--headroom-offset,3.5rem)] z-10 bg-muted`. Kolom kiri: checkbox (bila `selection`) lalu kolom "Aksi" (bila `actions`), keduanya lebar minimum. Kepala checkbox: `aria-label="Pilih semua"`, keadaan `indeterminate` bila sebagian; memilih SEMUA baris yang sudah dimuat (keputusan pemilik 19). Checkbox baris `aria-label` "Pilih {selectLabel(row)}". `interface RowAction { id: string; action: ActionKind; label: string; onSelect: () => void; disabled?: boolean; busy?: boolean; hidden?: boolean }` (`label` = nama aksesibel lengkap, mis. "Ubah Asus RT-AX55"): ≥ 768 px tiap entri = `ActionButton compact`; < 768 px (keputusan pemilik 22) satu tombol "⋯" ber-`aria-label` "Aksi {selectLabel(row)}" yang membuka `DropdownMenu` berisi entri berikon + label; di < 768 px tabel menggulir horizontal dan kolom data pertama (kolom unik) `sticky left` berlatar `bg-background`; checkbox tetap. Baris terpilih berlatar `bg-info-text/8`. Kosong → `empty` (bawaan "Tidak ada data yang cocok."); `isError` → `Alert color="destructive"` "Gagal memuat data. Coba muat ulang."; `hasMore` → tombol "Muat lebih banyak" (`loadingMore` → "Memuat…", nonaktif).
  - `interface RowSelection { selected: ReadonlySet<string>; toggle: (id: string) => void; setAll: (ids: readonly string[], on: boolean) => void; remove: (ids: readonly string[]) => void; clear: () => void; count: number }` (`remove` membuang id yang sudah selesai diproses, keputusan pemilik 19)
  - `useRowSelection(resetKey: unknown): RowSelection` — mengosongkan pilihan setiap `resetKey` berubah (dipakai dengan objek filter terserialisasi).
  - `LinkCell({ to, params, search, tour, children }: { to: LinkProps['to']; params?: Record<string, string>; search?: Record<string, unknown>; tour?: string; children: ReactNode })` — `Link` `font-medium text-info-text hover:underline underline-offset-4`.
  - `BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode })` — tak dirender bila `count === 0`; "{count} dipilih" + `children` (tombol `ActionButton` non-compact) + `ActionButton action="cancel" label="Batalkan pilihan"`; sticky bawah, berbayang.
- [ ] **Step 1: Tes gagal**: (a) kolom urutan: checkbox, Aksi, lalu kolom data; (b) klik "Pilih semua" memilih semua baris termuat, klik lagi mengosongkan; (c) `useRowSelection` dengan `resetKey` berubah → `count` 0; (d) `LinkCell` merender `<a href="/item/1">` berkelas `text-info-text`; (e) `BulkBar` count 0 → tak ada; count 3 → teks "3 dipilih" dan tombol "Batalkan pilihan" memanggil `onClear`; (f) `th` memiliki kelas `sticky`; (g) `isError` → `role="alert"`; (h) `runChunkedBatch` 250 id → tiga panggilan berurutan (100, 100, 50); tahap kedua gagal → tahap ketiga tidak dikirim, `doneIds` 100, `failedIds` 150, ringkasan "100 dari 250 berhasil; sisanya gagal: …"; galat `NOT_FOUND` → `notFound` true; (i) `selection.remove(ids)` membuang hanya id itu; (j) kolom aksi: ≥ 768 px tombol ikon per `RowAction`, < 768 px satu tombol "Aksi <nama>" yang membuka menu berisi tiap aksi; checkbox baris punya `aria-label` "Pilih <nama>"; `LinkCell tour="x"` → `data-tour="x"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. `runChunkedBatch<T>(ids: readonly string[], send: (chunk: string[]) => Promise<readonly T[]>, options?: { size?: number }): Promise<ChunkedBatchOutcome<T>>` (`size` bawaan `BATCH_MAX`; berurutan satu tahap pada satu waktu; berhenti di tahap pertama yang gagal): `interface ChunkedBatchOutcome<T> { total: number; doneIds: string[]; results: T[]; failedIds: string[]; error?: unknown; notFound: boolean }` (`failedIds` = tahap gagal + yang belum terkirim); `batchSummary(outcome, verb): { kind: 'success' | 'partial' | 'error'; message: string }` → "N item {verb}" bila semua berhasil, "N dari M berhasil; sisanya gagal: {describeError}" bila sebagian. Pemanggil: memasang `results` ke cache, `selection.remove(doneIds)`, memuat ulang daftar bila `failedIds` tidak kosong, dan bila `notFound` memuat ulang lalu membuang id yang tak ada lagi dari pilihan; `UNAVAILABLE` = toast galat tanpa antrean. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): DataTable dengan pilihan baris, sel tautan, menu aksi ponsel, bar aksi massal, dan pengiriman bertahap`.

### Task 4: `KanbanBoard`

**Files:**
- Create: `web/src/components/kanban/kanban-board.tsx`, `kanban-board.test.tsx`

**Interfaces:**
- Consumes: `UiColor` (fase 1).
- Produces: `interface KanbanColumn<T> { key: string; label: string; color: UiColor; items: readonly T[]; total?: number; hasMore?: boolean; loadingMore?: boolean; onLoadMore?: () => void }`; `KanbanBoard<T>({ columns, itemKey, renderCard, label, emptyText, height = 'auto' }: { columns: readonly KanbanColumn<T>[]; height?: 'auto' | 'viewport'; itemKey: (item: T) => string; renderCard: (item: T) => ReactNode; label: string; emptyText?: string })` — wadah `flex gap-3 overflow-x-auto`; tiap kolom `min-w-[290px] flex-1`, garis atas 3 px + latar tipis + bingkai dari `--color-{color}-text`, kepala berisi `Badge color={color} variant="soft"` + jumlah (`total ?? items.length`); kartu dibungkus bingkai kiri berwarna; "Muat lebih banyak" per kolom bila `hasMore`. `role="region"` `aria-label` = `label`; tiap kolom `role="group"` `aria-label` = label kolom. Mode `height="viewport"` (keputusan perancang T14): wadah setinggi `calc(100dvh - 3.5rem - <tinggi bar headroom> - <tinggi banner aplikasi yang tampil>)`, tiap kolom menggulir sendiri secara vertikal (`overflow-y-auto`; `ScrollRootProvider` per kolom + kartu lazy + `LoadMore` per kolom), bar headroom tidak bersembunyi (`ListPage pinned`); mode `auto` = perilaku di atas.
- [ ] **Step 1: Tes gagal**: dua kolom ("Baru" secondary, "Selesai" success) → dua `group` bernama sesuai, kepala memuat jumlah, kolom berkelas `min-w-[290px]`, badge `data-color` sesuai; kolom kosong menampilkan `emptyText` (bawaan "Kosong"); mode `viewport`: wadah berkelas tinggi `dvh`, kolom `overflow-y-auto`, "Muat lebih banyak" per kolom memanggil `onLoadMore` kolom itu, dan tinggi memperhitungkan banner aplikasi yang tampil (diuji dengan `ServerStatusBanner` dirender).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): KanbanBoard berwarna per kolom`.

### Task 5: `GridView` dan Pustaka Gambar

**Files:**
- Create: `web/src/components/grid/grid-view.tsx`, `grid-view.test.tsx`
- Modify: `web/src/components/file-dialog/library-tab.tsx` (pakai `GridView` untuk kisi, skeleton, kosong, galat, sentinel), `web/src/modules/sticker/components/guide-library-page.tsx` (pakai `ListPage` + `FilterBar`; tombol Unggah = `ActionButton action="upload" label="Unggah gambar"`)

**Interfaces:**
- Produces: `GridView<T>({ items, itemKey, renderItem, label, isLoading, isError, onRetry, empty, hasMore, loadingMore, onLoadMore, className }: { items: readonly T[]; itemKey: (item: T) => string; renderItem: (item: T) => ReactNode; label: string; isLoading?: boolean; isError?: boolean; onRetry?: () => void; empty?: ReactNode; hasMore?: boolean; loadingMore?: boolean; onLoadMore?: () => void; className?: string; selection?: RowSelection; selectLabel?: (item: T) => string })` — kisi `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5` (kelas yang sama dengan `LibraryTab` hari ini), 10 `Skeleton aspect-square` saat memuat, sentinel infinite (`use-infinite-sentinel.ts` yang ada) + tombol cadangan tanpa `IntersectionObserver`. Kartu tetap milik pemanggil (`renderItem`).
- [ ] **Step 1: Tes gagal** `grid-view.test.tsx`: merender `renderItem` per butir dalam `role="list"` bernama `label`; `isLoading` → 10 skeleton; `isError` → teks galat + tombol "Coba lagi" memanggil `onRetry`; kosong → `empty`; dengan `selection` tiap kartu punya checkbox ber-`aria-label` "Pilih <nama>" dan tanpa `selection` tidak ada checkbox (keputusan perancang T16). Halaman Pustaka mengendalikan cari/urut lewat `FilterBar`. Tes `library-tab.test.tsx` dan halaman pustaka yang ada tetap hijau tanpa diubah perilakunya.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi + refaktor `LibraryTab` dan halaman Pustaka (kolom cari/urut/filter `LibraryTab` TETAP untuk dialog berkas; di halaman Pustaka kontrol cari/urut/filter pindah ke `FilterBar` (cari + chip Urut + chip filter yang ada) dan judul + tombol Unggah berada di `ListPage`; keputusan perancang T16). Gambar Pustaka tidak punya View: pratinjau dan daftar pemakai tetap di dialog (keputusan pemilik 23).
- [ ] **Step 4:** `bun run --cwd web test src/components src/modules/sticker` → PASS.
- [ ] **Step 5:** Commit `feat(web): GridView dan Pustaka Gambar di kerangka ListPage`.

### Task 6: `ViewPage`, `ViewSection`, `DetailList`

**Files:**
- Create: `web/src/components/page/view-page.tsx`, `view-page.test.tsx`, `use-after-delete.ts`, `use-after-delete.test.tsx`

**Interfaces:**
- Produces:
  - `ViewPage({ title, badge, actions, tabs, aside, banner, children }: { title: ReactNode; badge?: ReactNode; actions?: ReactNode; tabs?: readonly { id: string; label: ReactNode; content: ReactNode }[]; aside?: ReactNode; banner?: ReactNode; children?: ReactNode })` — `HeadroomBar` berisi `h1` + `badge` + `actions` (aksi ikon + label); `banner` di bawahnya (dipakai kelak untuk "Data ini sudah dihapus"); bila `tabs`: `Tabs` varian `line`, daftar tab `sticky top-[var(--headroom-offset)]`, tab aktif tersimpan di search param `tab` lewat prop terkendali opsional `tab`/`onTabChange` (tanpa itu state lokal); isi + `aside` dalam kisi `lg:grid-cols-[1fr_16rem]` (aside di bawah pada layar sempit, `border-l` di lebar).
  - `ViewSection({ title, children })` — `section` + `h2` kecil.
  - `DetailList({ items }: { items: readonly { label: string; value: ReactNode; hidden?: boolean }[] })` — `dl` dua kolom (`grid-cols-[10rem_1fr]` di ≥ 640 px), butir `hidden` dilewati, nilai kosong (`null`/`''`) tampil "—".
  - `ViewMeta({ createdBy?, createdAt?, updatedBy?, updatedAt?, links? })` — isi standar `aside` (keputusan perancang T12): "Dibuat oleh … · kapan" HANYA bila DTO punya `createdBy`/`createdAt`; "Diubah oleh … · kapan" dari `updatedBy`/`updatedAt` bila ada; `links: { label: string; to: LinkProps['to']; search?: Record<string, unknown> }[]` = tautan ke data terkait TANPA angka hitungan (mis. "Lihat Serial Number item ini"). Tab ("Serial Number", "Riwayat") dan angka pada mockup hanya ilustrasi.
  - `useAfterDelete({ indexTo, canRestore, onRestore })` → fungsi yang dipanggil setelah Hapus dari View berhasil: navigasi ke `indexTo` (indeks induk) lalu `toast.success('Dihapus')` dengan aksi "Pulihkan" hanya bila `canRestore` (keputusan perancang T22).
- [ ] **Step 1: Tes gagal**: judul `h1`; tab "Detail"/"Riwayat" berpindah isi saat diklik; `DetailList` menampilkan "—" untuk nilai kosong dan melewati `hidden`; `aside` dirender; `banner` dirender di atas isi; `ViewMeta` tanpa `createdBy` tidak menampilkan "Dibuat", menampilkan "Diubah oleh …" bila ada, dan tautan `links` tanpa angka; `useAfterDelete` menavigasi ke `indexTo` dan toast "Dihapus" memuat aksi "Pulihkan" hanya bila `canRestore`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): kerangka ViewPage dengan tab dan daftar detail`.

### Task 7: `FormPage`, `FormDialogShell`, `FormTabs`, `FormSection`

**Files:**
- Create: `web/src/components/page/form-page.tsx`, `form-tabs.tsx`, `form-section.tsx`, `web/src/components/form-dialog-shell.tsx`, tes `form-page.test.tsx`, `form-tabs.test.tsx`, `form-dialog-shell.test.tsx`

**Interfaces:**
- Consumes: `FormDialog*` (`components/form-dialog.tsx`), `ActionButton`, `HeadroomBar`.
- Produces:
  - Pola form bersama: komponen form model merender `<form id={formId} onSubmit=…>` berisi field saja (tanpa judul/tombol). Pembungkus menaruh tombol submit di luar form dengan `form={formId}`.
  - `FormPage({ formId, title, badge, onCancel, submitting, submitLabel = 'Simpan', busyText = 'Menyimpan…', submitDisabled, extra, children })` — `HeadroomBar` berisi `h1` + `badge` + [`ActionButton cancel`, `extra`, `ActionButton save type="submit" form={formId} label={submitLabel} busy={submitting} disabled={submitDisabled}`]; `data-tour` pada pembungkus tombol diteruskan lewat prop `actionsTour?: string`; `tour?: string` memasang `data-tour` pada bar judul dan `saveTour?: string` pada tombol Simpan (T13).
  - `FormDialogShell({ open, onOpenChange, formId, title, description, submitting, submitLabel = 'Simpan', size, children })` — `FormDialog` + header + badan (form) + footer [`ActionButton cancel` menutup, `ActionButton save type="submit" form={formId}`]; dialog "Tambah" dirender di luar `<form>` induk (aturan CLAUDE.md tetap). `size?: 'sm' | 'md' | 'lg' | 'xl'` (bawaan `md`) memetakan lebar `DialogContent`; form bertab di dialog memakai `FormTabs` dengan `stickyTop="0px"` (daftar tab menempel di atas badan dialog, di dalam penggulir dialog; keputusan perancang T20); pada dialog bertumpuk Escape menutup yang teratas saja.
  - `FormTabs({ tabs, value, onValueChange }: { tabs: readonly { id: string; label: string; content: ReactNode; hasError?: boolean }[]; value?: string; onValueChange?: (id: string) => void; stickyTop?: string })` — `Tabs` varian `line`; daftar tab `sticky top-[var(--headroom-offset,3.5rem)] z-10 bg-background`; tab `hasError` diberi titik `bg-destructive` + `aria-describedby` "ada isian yang belum benar". Semua isi tab tetap ter-mount (`forceMount` + `hidden`) agar nilai dan validasi field di tab lain tetap hidup. Tiap pemicu dan panel tab membawa `data-form-tab="<id>"` (target `GuideStep.buka { tab }`, T13); `stickyTop` bawaan `var(--headroom-offset,3.5rem)`, di dialog `0px`.
  - `firstTabWithError(tabs): string | undefined`.
  - `FormSection({ title, description, children, columns = 2 })` — `section` + judul + kisi `md:grid-cols-2` (atau 1).
- [ ] **Step 1: Tes gagal**: (a) `FormPage` + `<form id="f">` dengan validasi gagal: klik "Simpan" di header memicu `onSubmit` form `f`; (b) `FormDialogShell` dalam halaman yang juga punya `FormPage` (dua form berbeda id) → Simpan dialog hanya men-submit form dialog; (c) `FormTabs`: tab "Detail" dan "Gambar", field wajib di "Gambar" kosong → `hasError` true → titik tampil; `firstTabWithError` = `'gambar'`; isi tab tak aktif tetap ada di DOM tetapi `hidden`; (d) `submitting` → tombol simpan nonaktif "Menyimpan…"; (e) `FormTabs` di dalam `FormDialogShell`: daftar tab `sticky` dengan `top: 0px` dan tiap tab punya `data-form-tab`; (f) dua dialog bertumpuk: Escape menutup dialog teratas saja; (g) `FormDialogShell size="lg"` memakai kelas lebar yang berbeda dari `md`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): FormPage, FormDialogShell, dan FormTabs untuk satu form di halaman dan dialog`.

### Task 8 (Haiku): Dokumentasi kit dan verifikasi

**Files:**
- Modify: `CLAUDE.md` ("Aturan frontend": butir "Kit CRUD" — daftar komponen dan berkasnya, pola `formId`, aturan DataTable (checkbox+aksi kiri, tanpa "Lihat", kolom unik/relasi `LinkCell`), Kanban (termasuk `height="viewport"`), GridView (`selection`), ViewPage (`ViewMeta`, `useAfterDelete`); aturan aksi massal: pilih semua = semua yang dimuat, kirim bertahap lewat `runChunkedBatch`, luring = toast galat; menu "⋯" di ponsel; `inert` pada bar headroom; halaman baru WAJIB memakai kerangka ini; SUNTING pernyataan CLAUDE.md yang kini bertentangan (bukan hanya menambah) dan periksa `docs/e2e-checklist*.md` serta teks langkah panduan yang menyebut tombol/halaman yang berubah), `docs/adding-a-module.md` (bagian UI: rujuk kit)
- [ ] **Step 1:** Tulis dokumentasi.
- [ ] **Step 2:** Verifikasi: `bun run --cwd web test`, `bun run typecheck`, `bun run lint`, `bun test scripts/`, `bun run build` → sukses.
- [ ] **Step 3:** Commit `docs: aturan kit CRUD`.
