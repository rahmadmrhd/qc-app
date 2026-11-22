# Revisi tampilan lanjutan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menerapkan revisi UI lanjutan (filter, log aktivitas, detail laporan Serial, kit ponsel/desktop) dalam satu PR ke `dev`.

**Architecture:** Perubahan kit bersama dulu (`web/src/components/**`), lalu halaman, lalu dua rute server baru (`activity.list`, `serialCases.get`) dengan UI-nya, lalu filter jamak server, lalu dialog layar penuh (menunggu kajian pemilik), dokumen, dan review.

**Tech Stack:** React + TanStack (Router/Query/Form), Tailwind, shadcn/Radix, Bun + Hono + MariaDB, vitest (web) dan `bun test` (server).

**Spec:** `docs/superpowers/specs/2026-11-22-revisi-tampilan-lanjutan-design.md`. Peta kode: `.superpowers/sdd/2026-11-22-revisi-tampilan-lanjutan/peta-kode.md` (nomor "Peta §n" di bawah).

## Global Constraints

- Semua ketetapan spek §2 mengikat; tafsiran bertanda "(konfirmasi)" boleh dipakai apa adanya. Peta kode memuat berkas, baris, dan tes yang terdampak untuk tiap butir.
- Gerbang ponsel tunggal = `useIsMobile`/`isPhoneViewport()` (< 768); angka 768/704 hanya di `web/src/lib/layout.ts` (dijaga `layout.test.ts`); varian `narrow:`/`wide:` bukan `md:` untuk berkas yang dijaga.
- Aturan CLAUDE.md akar berlaku: kit CRUD, `LinkField` untuk relasi, `Select` bukan `<select>`, warna `-text`, tanpa palet mentah, overlay lewat kit (`useBackToClose`), `useBlocker` lewat `leaveBlocker`, route-meta-coverage, page-frame, mobile-navigation-guard, no-legacy-variants.
- Teks UI bahasa Indonesia santai; "Serial Number" lengkap pada judul.
- Server: kontrak API kompatibel mundur (field jamak OPSIONAL, tanpa id `@2`); rute baru terdaftar di `API_ROUTES`, `ApiContract`, validator, handler, tes REST, lalu `bun run api:snapshot`. Migrasi expand-only bernama `0031_*`. Kueri baru ke tabel ber-soft-delete memakai `liveWhere`.
- Tes server butuh terowongan DB (`bun run db:tunnel`, hidup di sesi ini; `QC_TEST_SHARDS=1`, satu berkas per perintah); tes web per folder dengan vitest. Berkas CRLF (mis. spek redesain): edit dengan Python `newline=''`.
- Tiap tugas: komit terpisah dengan trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; jangan push; jangan menyentuh server dev 3000/8788/3001 atau terowongan.

## Review Focus

- Klik kartu: klik pada tautan/checkbox/tombol/⋯ di dalam kartu TIDAK boleh ikut membuka detail; klik saat mode pilih hanya mengubah pilihan; seleksi teks tidak membuka detail.
- `activity.list`: pengguna tanpa hak baca rekaman (BU lain, serial terhapus tanpa manage, lokasi di luar penugasan) mendapat `NOT_FOUND` seragam; tidak ada nilai sebelum/sesudah di DTO; `kind` tak dikenal = `VALIDATION`.
- `serialCases.get`: laporan milik serial yang tak boleh dibaca = `NOT_FOUND`; laporan serial terhapus = `NOT_FOUND`.
- Filter jamak: daftar kosong/duplikat/lebih dari 20 nilai ditolak; field tunggal lama tetap bekerja; id yang bukan milik hak pengguna tidak membuka data baru.
- Bar `fixed` ponsel tidak menutupi isi terakhir halaman dan ikut naik saat papan ketik muncul (`--kb`); mode pilih tidak menampilkan dua bar.
- Tombol kembali ponsel menutup popover/lembar filter, lembar notifikasi, dan dialog layar penuh baru tanpa meninggalkan halaman.

---

### Task 1: Kit — jarak, FAB, kolom Kanban, warna tab (B4, B6, B8, D2)
**Files:** `web/src/components/page/{view-page,headroom-bar,list-page,form-page,fab,scroll-to-top,form-tabs}.tsx`, `web/src/components/ui/{tabs,dialog,sheet}.tsx`, `web/src/components/kanban/kanban-board.tsx`, `web/src/styles.css`, tes terkait (Peta §4, §6, §8, §22).
- [ ] Ubah nilai jarak, ukuran FAB/ScrollToTop (`size-14`/`size-12`, `aboveFab` dan `pb` mengikuti), `min-w-[340px]`, variabel `--tabs-surface`; perbarui tes yang mengunci (`kit-mobile.test.tsx:150`, `kanban-board.test.tsx:49`, `handover-board.test.tsx:142`, `view-page.test.tsx`, `list-page.test.tsx`) dan tes kontras bila nilai token berubah.
- [ ] Jalankan vitest `web/src/components` dan `web/src/modules/handover`; komit.

### Task 2: Kit — bar aksi ponsel fixed, judul, ActionButton emphasis (P2, B13)
**Files:** `sticky-action-bar.tsx`, `form-page.tsx`, `view-page.tsx`, `list-page.tsx`, `action-button.tsx`, `app-shell.tsx` (Peta §13).
- [ ] `ActionButton` prop `emphasis?: 'primary'` (solid primary, mengganti varian outline untuk aksi itu); `ViewPage` memakainya untuk aksi utama di bar bawah ponsel.
- [ ] `StickyActionBar` ponsel `fixed inset-x-0 bottom-[var(--kb,0px)]`, mengukur dirinya ke `--action-bar-h`; halaman berbar memberi padding bawah; `<h1>` `sr-only` di ponsel (List/View/Form), `FormPage` ponsel tanpa bar atas.
- [ ] Perbarui tes (`kit-mobile`, `form-page`, `view-page`, `record-page-frame`, `list-page`); komit.

### Task 3: Kit — mode pilih ponsel satu bar, BulkBar desktop di atas (P5, D1)
**Files:** `components/data-table/{bulk-bar,selection-bar,data-cards,data-table,use-long-press-select}.tsx`, `components/grid/grid-view.tsx`, `components/page/list-page.tsx`, `modules/serial/components/staging-cards.tsx` (Peta §16, §17).
- [ ] Konteks mode pilih (`selecting`, `exit`, `selectAll`, `count`) diisi `useLongPressSelect`/`ListPage`; ponsel: `BulkBar` memuat Batalkan pilihan, "N dipilih", Pilih semua, aksi; hilangkan `SelectionBar` atas di ponsel (`DataCards`, `GridView`); pertahankan fokus awal ke tombol batal dan `LongPressHint`/`StartSelectButton`.
- [ ] Desktop: `ListPage` merender `bulkBar` SEBELUM `children`; urutan Batalkan pilihan, jumlah, spacer, aksi; offset header tabel sticky mengikuti tinggi bar.
- [ ] Perbarui tes (`mobile-select`, `kit-mobile`, `data-table`, `staging-cards`, tes rute `-index.test.tsx` yang memakai bar); komit.

### Task 4: Kit — kartu diklik, label aksi pendek, submenu aksi (B9, P4, B10 kit)
**Files:** `data-table/{data-cards,data-table,row-actions}.tsx`, `mobile/mobile-card.tsx`, `kanban/kanban-board.tsx`, `modules/handover/components/handover-card.tsx`, semua tabel pemakai `RowAction` (Peta §9, §15).
- [ ] `DataTable rowTo?: (row) => { to: string; params?: Record<string,string> }`/`onOpen`; `MobileCard onOpen`; penjaga klik sesuai spek B9 (`closest`, mode pilih, seleksi teks); `HandoverCard` badan membuka detail dengan penjaga yang sama.
- [ ] `RowAction.shortLabel?: string` dipakai menu ponsel; `RowAction.submenu?: RowAction[]` (desktop: tombol dengan satu dropdown; PONSEL: TANPA submenu, dirender sebagai GRUP datar di menu ⋯ yang sama dengan label grup, `DropdownMenuGroup`/`DropdownMenuLabel`/`DropdownMenuSeparator`; keputusan pemilik: tidak ada popover/dropdown bersarang di ponsel) dan isi `shortLabel` di semua tabel pemakai (daftar di Peta §15).
- [ ] Tes: klik kartu membuka tujuan; klik tautan/checkbox/⋯ tidak ganda; mode pilih; label pendek; perbarui tes yang mengunci label panjang; komit.

### Task 5: Sidebar dan batas ~830 px (B11, B12, P8)
**Files:** `web/src/app/shell/app-sidebar.tsx`, `sidebar-state.ts`, `web/src/components/ui/sidebar.tsx`, `web/src/app/navigation.ts`, `shell/launcher.tsx`, `app/nav-search.ts` (Peta §11, §12, §20).
- [ ] Submenu: hanya induk aktif terbuka, reset saat rute berubah, tanpa menyimpan `expanded`.
- [ ] Sidebar 768–959 px sebagai overlay (spacer = rel ikon); tes `layout`, `use-is-desktop`, `app-shell*`, `app-sidebar*` disesuaikan.
- [ ] `NavItem.hideOnPhone` untuk Aplikasi Desktop dan Country Lock; sidebar dan `Launcher` meneruskan gerbang ponsel; tes navigasi; komit.

### Task 6: Filter — chip tanpa popover bersarang dan multi-value klien (B1, B2, B2b klien)
**Files:** `components/page/filter-bar.tsx`, `components/combobox.tsx`, `components/select.tsx`, `components/link-field.tsx`, semua halaman pemakai `FilterChip` (Peta §1, §2).
- [ ] `FilterChip` ikon `ListFilter`; varian chip combobox tunggal (satu lapisan: kolom cari + opsi) dan jamak; chip non-combobox tetap berpopover; `useBackToClose` untuk lapisan itu; migrasikan semua pemakai; filter klien-saja menjadi jamak (URL search param array).
- [ ] Perbarui `filter-bar.test.tsx` dan ±16 tes halaman yang memakai `pickSelect`; komit.
- [ ] (B2c) Ponsel: chip apa pun membuka lembar bawah (`Sheet side="bottom"`) dengan isi chip (kolom cari + opsi untuk combobox); desktop tetap popover. `useBackToClose` lewat kit.
- [ ] (B2e) Seragamkan chip Status: ganti label "Tampilan" → "Status" di `handover-board-page.tsx`, `serial-filters.tsx`, `routes/_app/access/roles/index.tsx`; opsi dari `statusFilterOptions`/`liveStatusFilterOptions`; samakan `display` bawaan dan penempatan; perbarui tes yang mencari label "Tampilan" (`pickSelect`, tes rute, panduan bila menyebutnya).

### Task 6b: Lembar bawah dengan gestur melebar (B2d)
**Files:** `web/src/components/ui/sheet.tsx` (+ tes baru `sheet.test.tsx`), pemakai: lembar filter, `modules/location/components/location-sheet.tsx`, `app/shell/user-menu.tsx`, mode `sheet` di `components/combobox.tsx`.
- [ ] Untuk `side="bottom"`: pegangan seret (pointer events, `touch-action: none` pada pegangan), tiga keadaan `collapsed` (tinggi isi, maks 85dvh) / `expanded` (100dvh, tanpa sudut membulat, safe-area) / tertutup; ambang seret ≥ 48 px atau kecepatan; transisi `transform/height` menghormati `prefers-reduced-motion`; `useBackToClose` utuh; tes gestur dengan `PointerEvent` (naik = expanded, turun dari expanded = collapsed, turun dari collapsed = `onOpenChange(false)`); komit.

### Task 7: Halaman — QR Detail, daftar Item ponsel, stok, notifikasi (B5, P3, B10, P9)
**Files:** `modules/qrcode/components/qr-design-form*.tsx`, `modules/guide/catalog/qrcode*.ts`, `modules/item/components/items-table.tsx`, `modules/sticker/components/stickers-page.tsx`, `modules/notification/notification-bell.tsx` (Peta §5, §14, §10, §21).
- [ ] Tab `item`+`sumber` → tab `detail` satu section "Detail"; panduan dan tes ikut; `data-tour` utuh.
- [ ] Item: `model` `mobile: 'title'`, merk meta. Stiker: kolom "Aksi stok" dihapus, entri "Stok" bersubmenu di kolom Aksi.
- [ ] Notifikasi ponsel `Sheet side="bottom"`, `runAfterOverlays`; tes; komit.
- [ ] (B5b) `ACTIONS.export` ikon `CloudUpload` (`action-button.tsx`) dengan label selalu tampak (`RowAction.showLabel?: boolean` di kit Task 4: tombol baris desktop ikon + teks, bukan ikon-saja); `qr-designs-table.tsx` dan `qr-design-view.tsx`: Unduh PDF + Unduh PNG digabung jadi satu aksi `download` bersubmenu (`RowAction.submenu` dari Task 4; desktop satu dropdown, ponsel grup datar "Unduh" berisi PDF dan PNG); `label` panjang tetap untuk aria; perbarui tes `qr-designs-table`/`qr-design-view`/panduan yang menyebut tombol unduh.

### Task 8: Server — `activity.list` dan migrasi indeks (B3 server)
**Files:** `server/migrations/0031_audit_target_id_index.sql`, `shared/{contract,api}.ts`, `server/src/modules/activity/*` (baru: `validate`, `service`, `routes`), tes REST, `scripts` potret (Peta §3).
- [ ] Tes dulu: izin per `kind`, `NOT_FOUND` seragam, DTO tanpa nilai, kursor, `VALIDATION`; lalu implementasi; `bun run api:snapshot`; komit.

### Task 9: Web — log aktivitas di panel kanan View (B3 web)
**Files:** `components/page/view-page.tsx` (`ViewMeta`), `modules/activity/{queries,components}`, 14 View pemakai `ViewMeta` (Peta §3).
- [ ] Komponen `ActivityLog` (10 terbaru, muat lebih banyak, catatan riwayat lama) dan pasang di semua View; Serial memakai `serials.history`; tes; komit.

### Task 10: Server + web — detail laporan Serial dan Riwayat kartu laporan (B7)
**Files:** `shared/{contract,api}.ts`, `server/src/modules/serial/{case-detail,routes}.ts`, tes REST, `web/src/routes/_app/serial/reports/{index,$caseId}.tsx`, `serial-detail-page.tsx`, `timeline-tabs.tsx`, `case-list-page.tsx`, `route-meta-coverage.test.ts`, `scripts/page-frame.test.ts` (Peta §7).
- [ ] `serialCases.get` (tes dulu) → halaman View laporan → kartu laporan di Riwayat → daftar Laporan membuka detail; `routeTree.gen.ts`; `api:snapshot`; komit.

### Task 11: Web — aksi View Serial ponsel (P7)
**Files:** `view-page.tsx` (aksi ponsel "N utama + Lainnya"), `serial-detail-page.tsx`, `act-buttons.tsx`, panduan `catalog/serial.ts` bila target pindah (Peta §19).
- [ ] `ACTIONS.reportDamage` (ikon `TriangleAlert`, warna `warning`/`destructive` sesuai kit) di `action-button.tsx`; `serial-detail-page.tsx` menaruh Lapor Rusak (hanya bila `report_failure` tersedia) tepat sebelum Ubah di `actionItems` untuk SEMUA ukuran layar (desktop: bar judul; ponsel: bar bawah [Lapor Rusak][Ubah][Lainnya]); hapus duplikatnya dari `ActButtons`; tes `serial-detail-page`, `view-page`, katalog; komit.

### Task 12: Filter jamak sisi server (B2b server)
**Files:** `shared/contract.ts` (+ validator), `server/src/modules/{item,serial,handover}/*`, `server/src/core/audit.ts`, tes REST, UI filter terkait (Peta §2).
- [ ] Field jamak opsional + SQL `IN (...)` (tes dulu: tunggal lama tetap, jamak menang, batas 20, hak tak melebar); UI memakainya; `api:snapshot`; komit.

### Task 13: Dialog layar penuh di ponsel (P6) — DISETUJUI pemilik 2026-11-22 (spek P6)
**Files:** `modules/guide/components/guide-menu-dialog.tsx`, `modules/serial/components/{edit-serial-dialog,row-edit-dialog,bulk-edit-dialog,act-dialog}.tsx`, `modules/qrcode/components/sheet-preview-dialog.tsx`, `modules/countrylock/components/record-dialog.tsx`, dan `modules/sticker/components/stock-history.tsx` (ditambah pemilik: layar penuh + kartu riwayat di ponsel); `label-preview.tsx` TIDAK diubah, dialog tak terukur (CopyMarks, PreviewDialog, ProofGallery, Export/ApplyPreset/ExportChangeWarning, InjectProgress, Credential) TIDAK diubah (Peta §18).
- [ ] Riwayat stok di ponsel: daftar entri dirender sebagai `MobileCard` (judul = jenis entri/waktu, badge, meta: selisih, stok sesudah, lokasi, pelaku, alasan); desktop tetap tabel; tes ponsel.
- [ ] Di < 768 px dialog nomor 1–8 dan 10 (spek P6) menjadi layar penuh seperti `FormDialogContent` (`max-md:` full, dvh, safe-area, keyboard `--vvh`); desktop tidak berubah. Pakai `FormDialog*` langsung bila `FormDialogShell` (butuh `<form>`) tidak cocok; AlertDialog konfirmasi tetap dialog; header/footer tetap menempel.
- [ ] Tes ponsel per dialog (kelas layar penuh/`data-size`), tombol kembali ponsel menutup dialog; perbarui tes yang terdampak; komit.

### Task 14: Dokumen, changelog, penutupan keputusan
- [ ] Catat keputusan 2026-11-22 (butir 1–2 dan seluruh tafsiran) di spek soft delete, spek Serial unik se-sistem, `docs/ci-cd.md`; perbarui CLAUDE.md akar; fragmen `server/changelog.d/20261122-revisi-tampilan-lanjutan.md`; `bun run api:snapshot --check`; komit.

### Task 15: Review akhir
- [ ] Reviewer independen (diff + spek, tanpa kesimpulan implementer) + `security-audit` terfokus (`activity.list`, `serialCases.get`, filter jamak); putaran perbaikan; gerbang `bun run check` (butuh tunnel) atau vitest/bun test per area; PR ke `dev`.
