# Redesain Fase 1: Fondasi — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik (implementasi tanpa review per task → satu review akhir putaran + security review `security-audit` → putaran perbaikan).

**Goal:** Semua halaman web memakai token warna semantik, tombol/badge/alert/toast berwarna × bergaya, kosakata aksi, sidebar baru yang diingat, breadcrumb, isi rata tengah, dan penanda `*` field wajib.

**Architecture:** Token di `web/src/styles.css` dipetakan ke utilitas Tailwind; varian `Button`/`Badge`/`Alert` dirakit `cva` dari dua sumbu (warna × gaya) dengan pemetaan varian lama yang murni dan teruji. Cangkang membaca metadata rute (`staticData.crumb`, `staticData.pageWidth`) sehingga breadcrumb dan lebar isi diatur di satu tempat (`AppShell`), bukan di tiap halaman. Navigasi menjadi pohon (grup → butir / induk bersubmenu) dengan fungsi murni untuk visibilitas, jejak breadcrumb, dan perataan.

**Tech Stack:** React 19, TanStack Router 1.170 (`staticData`), TanStack Query, Tailwind 4 (`@theme inline`), shadcn 4 (`cva` + `cn`), radix-ui, sonner 2, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§6.1-6.4, §6.7 butir field wajib, §6.10 fase 1). Mockup acuan: `docs/superpowers/specs/assets/2026-11-20-redesain-mockup-v3.html`.

## Global Constraints

- Token warna persis tabel spek §6.1 (terang dan gelap); nilai boleh `oklch` setara.
- Tanpa `<select>` bawaan; field relasi tetap `LinkField`/`LinkMultiField` (CLAUDE.md "Aturan frontend").
- Tombol ikon WAJIB punya nama aksesibel = label teks lamanya (tes `getByRole('button', { name })` tak boleh berubah karena ikon).
- Tooltip = shadcn `Tooltip` (`components/ui/tooltip.tsx`), bukan atribut `title`.
- Target `data-tour` yang ada (`sidebar-trigger`, `sidebar-menu`, `user-menu*`, dll.) dipertahankan.
- `localStorage` dibungkus try/catch; gagal = perilaku bawaan, tanpa galat.
- Teks UI santai, tidak kaku; "Serial Number" ditulis lengkap pada judul (memori pemilik).
- Wajib hijau sebelum commit akhir: `bun run --cwd web test`, `bun run typecheck`, `bun run lint`, `bun test scripts/`, `bun run build`. `bun run check` penuh butuh `bun run db:tunnel` hidup; JANGAN mematikan/merestart server dev pengguna di port 3000.
- Fase ini hanya web + dokumen; tanpa perubahan server/migrasi.

## Review Focus

1. `qc.sidebar` di `localStorage` rusak/bukan JSON/akses dilempar galat → sidebar memakai bawaan (terbuka, tanpa submenu ekstra), tanpa crash. (Task 7)
2. Rute aktif berada di submenu yang tertutup tersimpan → induknya tetap terbuka saat halaman dimuat. (Task 7)
3. Halaman detail dibuka langsung sebelum data ada di cache → breadcrumb menampilkan label cadangan lalu nama record begitu query termuat, tanpa galat. (Task 8)
4. Mode ikon: popover submenu dapat dibuka dengan keyboard (Enter/Space) dan ditutup Escape; butir bersubmenu tidak menavigasi. (Task 7)
5. Pemakai varian lama (`variant="destructive"`, `"secondary"`, `"default"`, `"outline"`, `"ghost"`, `"link"`) tetap tampil dengan makna sama (merah tetap merah). (Task 2)

---

## Pembagian kelas beban

- **Sonnet (satu agent, dilanjutkan lewat `SendMessage`)**: Task 1-8, 10, 11.
- **Haiku (satu agent)**: Task 9, 12.
Urutan: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → (9 Haiku ‖ 10 Sonnet) → 11 → 12. Task 9 dan 10 tidak menyentuh berkas yang sama (9: `web/src/routes/**` dan pembungkus `max-w` halaman; 10: kelas warna di `web/src/modules/**`, `web/src/app/**`, dan badge).

---

### Task 1: Token warna semantik

**Files:**
- Modify: `web/src/styles.css`
- Create: `web/src/styles.test.ts`

**Interfaces:**
- Produces: variabel CSS `--success`, `--success-foreground`, `--success-text`, `--warning`, `--warning-foreground`, `--warning-text`, `--info`, `--info-foreground`, `--info-text`, `--destructive-foreground`, `--destructive-text`, `--secondary-text` (di `:root` dan `.dark`); `--secondary`/`--secondary-foreground` diberi nilai abu-abu spek; utilitas Tailwind `bg-success`, `text-success-foreground`, `text-success-text`, `border-success-text`, dst. untuk keenam warna (lewat `@theme inline`: `--color-success: var(--success)`, `--color-success-foreground`, `--color-success-text`, …).

- [ ] **Step 1: Tes gagal** `styles.test.ts`: baca `styles.css` sebagai teks; untuk blok `:root` dan `.dark`, `expect` tiap token di atas ada; `expect` nilai gelap `--success-text` = `#22c55e`, `--info-text` = `#3b82f6`, `--destructive` = `#ef4444`, `--warning` = `#d97706` (atau `oklch` setara bila ditulis oklch: maka tes membandingkan string yang ditulis); `expect` `@theme inline` memuat `--color-success-text: var(--success-text)` dan pasangan lainnya.
- [ ] **Step 2:** `bun run --cwd web test src/styles.test.ts` → FAIL.
- [ ] **Step 3:** Isi token persis tabel spek §6.1. `--primary` tetap netral; `--secondary` = abu-abu spek (bukan abu muda shadcn). Cari pemakai `bg-secondary`/`text-secondary-foreground` di luar `components/ui` yang bermaksud "latar abu muda" dan ganti ke `bg-muted`/`text-muted-foreground`.
- [ ] **Step 4:** Tes → PASS.
- [ ] **Step 5:** Commit `feat(web): token warna semantik terang/gelap`.

### Task 2: Button dan Badge warna × gaya

**Files:**
- Modify: `web/src/components/ui/button.tsx`, `web/src/components/ui/badge.tsx`
- Create: `web/src/components/ui/variant-style.ts`, `web/src/components/ui/variant-style.test.ts`, `web/src/components/ui/button.test.tsx`

**Interfaces:**
- Produces (`variant-style.ts`):
  - `type UiColor = 'primary' | 'secondary' | 'success' | 'warning' | 'info' | 'destructive'`
  - `type UiVariant = 'solid' | 'soft' | 'outline' | 'ghost' | 'link'`
  - `type LegacyVariant = 'default' | 'secondary' | 'destructive'`
  - `resolveStyle(variant?: UiVariant | LegacyVariant, color?: UiColor): { variant: UiVariant; color: UiColor }`
  - `colorVariantClasses(variant: UiVariant, color: UiColor): string` (dipakai `cva` `compoundVariants` atau langsung)
- `Button` props: `variant?: UiVariant | LegacyVariant`, `color?: UiColor`, `size` tetap; atribut `data-variant`/`data-color` = hasil `resolveStyle`. `Badge` sama + `dot?: boolean` (titik `currentColor` 6 px sebelum isi).

- [ ] **Step 1: Tes gagal** `variant-style.test.ts`:
  - `resolveStyle()` → `{ variant: 'solid', color: 'primary' }`
  - `resolveStyle('default')` → solid primary; `resolveStyle('secondary')` → soft secondary; `resolveStyle('destructive')` → soft destructive; `resolveStyle('link')` → link info; `resolveStyle('outline')` → outline primary; `resolveStyle('ghost')` → ghost primary
  - `resolveStyle('soft', 'success')` → soft success; `resolveStyle('destructive', 'warning')` → soft warning (warna eksplisit menang)
  - `colorVariantClasses('solid','success')` memuat `bg-success` dan `text-success-foreground`; `('soft','info')` memuat `text-info-text`; `('outline','destructive')` memuat `border-destructive-text`; `('ghost','primary')` tidak memuat `bg-primary`.
  `button.test.tsx`: `render(<Button variant="destructive">Hapus</Button>)` → tombol `data-color="destructive"` `data-variant="soft"`; `<Badge color="success" variant="soft" dot>Aktif</Badge>` memuat elemen titik `aria-hidden`.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasi. Kelas per gaya mengikuti mockup v3: solid `bg-X text-X-foreground hover:bg-X/90`; soft `bg-X-text/15 text-X-text hover:bg-X-text/25` (primary soft = `bg-muted text-foreground`); outline `border-X-text/50 text-X-text hover:bg-X-text/10` (primary = `border-border text-foreground`); ghost `text-X-text hover:bg-X-text/12` (primary = `text-foreground hover:bg-muted`); link `text-X-text underline-offset-4 hover:underline`. Kelas dasar, ukuran, fokus, dan `aria-invalid` yang ada dipertahankan.
- [ ] **Step 4:** `bun run --cwd web test src/components/ui` → PASS; `bun run --cwd web test` seluruhnya tetap hijau (pemetaan lama menjaga pemakai).
- [ ] **Step 5:** Commit `feat(web): Button dan Badge warna × gaya dengan pemetaan varian lama`.

### Task 3: Alert, toast, dan banner cangkang

**Files:**
- Modify: `web/src/components/ui/alert.tsx`, `web/src/components/ui/sonner.tsx`, `web/src/app/shell/server-status-banner.tsx`, `web/src/app/shell/ui-update-banner.tsx`
- Create: `web/src/components/ui/alert.test.tsx`

**Interfaces:**
- Consumes: `UiColor` (Task 2).
- Produces: `Alert` props `color?: 'neutral' | 'info' | 'success' | 'warning' | 'destructive'` (bawaan `neutral`), `variant?: 'default' | 'destructive'` lama dipetakan (`destructive` → `color="destructive"`), `icon?: boolean` (bawaan `true` bila `color !== 'neutral'`: menyisipkan ikon lucide `Info` / `CircleCheck` / `TriangleAlert` / `CircleX` sebagai anak pertama, `aria-hidden`).

- [ ] **Step 1: Tes gagal** `alert.test.tsx`: `<Alert color="warning">Hati-hati</Alert>` → `role="alert"`, `data-color="warning"`, memuat svg `aria-hidden`; `<Alert variant="destructive">x</Alert>` → `data-color="destructive"`; `<Alert>x</Alert>` tanpa svg sisipan.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Gaya alert berwarna: `border-X-text/35 bg-X-text/10`, ikon dan judul `text-X-text`, teks deskripsi `text-foreground`. Toast: `toastOptions.classNames` untuk `success|error|warning|info` = garis kiri 4 px berwarna token (`border-l-success-text`, `border-l-destructive-text`, …) dan ikon berwarna sama; `--normal-*` tetap. `ServerStatusBanner` memakai `Alert color="warning"` (tetap `role="status"` dan `data-testid="server-status-banner"`; teks sama); `UiUpdateBanner` memakai `Alert color="info"` dengan isi dan tombol sama.
- [ ] **Step 4:** `bun run --cwd web test src/components/ui src/app/shell` → PASS.
- [ ] **Step 5:** Commit `feat(web): Alert berwarna, toast bergaris status, banner cangkang`.

### Task 4: Kosakata aksi (`ActionButton`) dan Tooltip

**Files:**
- Modify: `web/src/components/ui/tooltip.tsx`
- Create: `web/src/components/action-button.tsx`, `web/src/components/action-button.test.tsx`

**Interfaces:**
- Consumes: `Button`, `UiColor`, `UiVariant` (Task 2).
- Produces:
  - `type ActionKind = 'create' | 'save' | 'edit' | 'delete' | 'activate' | 'deactivate' | 'restore' | 'cancel' | 'download' | 'export' | 'upload' | 'print' | 'copy' | 'refresh'`
  - `ACTIONS: Record<ActionKind, { icon: LucideIcon; label: string; color: UiColor; variant: UiVariant; compactVariant: UiVariant }>` — nilai persis tabel spek §6.3 (`restore` = `RotateCcw`, info soft, "Pulihkan"; `export` = `Download`, "Ekspor"; `compactVariant` = `ghost` untuk semua kecuali `create`/`save` = `solid`).
  - `ActionButton(props: { action: ActionKind; label?: string; compact?: boolean; busy?: boolean } & Omit<ComponentProps<typeof Button>, 'color' | 'variant' | 'children'>)`
- `Tooltip` (ui) membungkus dirinya dengan `TooltipProvider` (pola shadcn terbaru) sehingga dapat dipakai tanpa provider induk.

- [ ] **Step 1: Tes gagal** `action-button.test.tsx`:
  - `<ActionButton action="delete" />` → tombol bernama "Hapus", `data-color="destructive"`, `data-variant="soft"`, memuat svg.
  - `<ActionButton action="edit" compact label="Ubah Asus RT-AX55" />` → tombol bernama "Ubah Asus RT-AX55", tanpa teks tampak, `data-variant="ghost"`; `userEvent.hover` → tooltip berisi "Ubah Asus RT-AX55" muncul (`findByRole('tooltip')`).
  - `<ActionButton action="save" busy />` → nonaktif dan berlabel "Menyimpan…" (memakai `BusyLabel`).
  - `<ActionButton action="create" label="Tambah item" />` → nama "Tambah item".
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasi; `compact` → `size="icon-sm"`, `aria-label` = label, ikon `aria-hidden`.
- [ ] **Step 4:** Tes → PASS; seluruh `bun run --cwd web test` hijau (perubahan `Tooltip` tak merusak `SidebarMenuButton tooltip`).
- [ ] **Step 5:** Commit `feat(web): ActionButton kosakata aksi + Tooltip mandiri`.

### Task 5: Penanda field wajib

**Files:**
- Modify: `web/src/components/ui/label.tsx`, `web/src/components/combobox.tsx`, `web/src/components/select.tsx` (teruskan prop), `web/src/components/link-field.tsx` (teruskan prop)
- Test: `web/src/components/link-field.test.tsx`, `web/src/components/select.test.tsx`, Create `web/src/components/ui/label.test.tsx`

**Interfaces:**
- Produces: `Label` prop `required?: boolean` → atribut `data-required` dan bintang lewat CSS pseudo-elemen (`data-[required]:after:content-['*'] after:ml-0.5 after:text-destructive`), BUKAN teks DOM, sehingga `getByLabelText('Merk')` tetap cocok. `ComboboxCommon.required?: boolean` → `Label required` + `aria-required="true"` pada input combobox. Pola untuk input teks biasa (dipakai Task 11): `<Label htmlFor required>` + `<Input aria-required />` (bukan atribut `required` bawaan agar validasi tetap lewat zod, tanpa gelembung peramban).

- [ ] **Step 1: Tes gagal**: `<Label required>Merk</Label>` → `data-required` ada, `textContent` = "Merk"; `LinkField` dengan `required` → `getByLabelText('Merk')` memiliki `aria-required="true"` dan labelnya `data-required`; `Select` sama.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** `bun run --cwd web test src/components` → PASS.
- [ ] **Step 5:** Commit `feat(web): penanda * merah untuk field wajib`.

### Task 6: Model navigasi berpohon

**Files:**
- Modify: `web/src/app/navigation.ts`, `web/src/app/navigation.test.ts`, `web/src/app/navigation-desktop.test.ts`, `web/src/modules/guide/components/guide-banner.tsx`

**Interfaces:**
- Produces (`navigation.ts`):
  - `interface NavItem` (tetap) ; `interface NavParent { id: string; label: string; icon: LucideIcon; children: NavItem[] }` ; `type NavEntry = NavItem | NavParent` ; `interface NavGroup { label: string | null; items: NavEntry[] }`
  - `isNavParent(entry: NavEntry): entry is NavParent`
  - `flattenNavItems(groups: readonly NavGroup[]): NavItem[]`
  - `visibleNavGroups(groups, me, activeLocationIds?, desktop?)` (tanda tangan tetap): menyaring anak; induk tanpa anak terlihat dibuang; grup kosong dibuang.
  - `findNavTrail(groups: readonly NavGroup[], matches: (to: string, fuzzy: boolean) => boolean): { parent: NavParent | null; item: NavItem } | null` — memakai `isNavItemActive`; butir dengan `to` terpanjang yang aktif menang.
  - `NAV_GROUPS` = pohon spek §6.4: grup `null` [Beranda]; "Operasional" [Serah Terima, Country Lock, induk `serial` "Serial Number" (Daftar `/serial`, Laporan `/serial/reports`, Pengaturan `/serial/settings`)]; "Data Master" [induk `item` "Item" (Daftar Item `/item`, Merk `/item/brands`), Customer]; "Stiker & Dokumen" [induk `sticker` "Stiker" (Katalog, Jenis, Stok, Pustaka Gambar, Konfigurasi), induk `manual-book` "Manual Book" (QR Code `/qrcode`, Default QR `/qrcode/default`), Postel `/postel`]; "Pengaturan" [induk `access` "Akses" (Pengguna, Role, Lokasi, Business Unit), induk `system` "Sistem" (Status Push, Log Audit)]. Ikon, izin, `excludes`, `alsoActiveOn`, `visible`, `opensDesktopApp` dibawa dari definisi lama; QR Code mendapat `excludes: ['/qrcode/default']`; Default QR memakai izin yang sama dengan `beforeLoad` rute `/qrcode/default`.

- [ ] **Step 1: Tes gagal** di `navigation.test.ts`: (a) `flattenNavItems(NAV_GROUPS)` memuat `/qrcode/default` dan tak memuat induk; (b) pengguna hanya `item: view` → grup "Data Master" berisi induk `item` dengan dua anak + Customer, dan tak ada grup "Pengaturan"; (c) `findNavTrail` untuk `/item/brands/abc` → parent `item`, item Merk; untuk `/qrcode/default/x/edit` → item Default QR (bukan QR Code); untuk `/` → item Beranda tanpa parent; (d) tes lama tentang izin/`excludes` disesuaikan ke label baru ("Pengguna", "Role").
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasi; `guide-banner.tsx` `pageLabel` memakai `flattenNavItems`.
- [ ] **Step 4:** `bun run --cwd web test src/app src/modules/guide` → PASS.
- [ ] **Step 5:** Commit `feat(web): navigasi berpohon dengan submenu per fitur`.

### Task 7: Sidebar baru (submenu, diingat, popover saat dilipat)

**Files:**
- Modify: `web/src/app/shell/app-sidebar.tsx`, `web/src/app/shell/app-sidebar.test.tsx`, `web/src/app/shell/app-shell.tsx`, `web/src/components/ui/sidebar.tsx` (hapus penulisan cookie `sidebar_state`)
- Create: `web/src/app/shell/sidebar-state.ts`, `web/src/app/shell/sidebar-state.test.ts`, `web/src/components/ui/collapsible.tsx` (lewat `bunx --bun shadcn@latest add collapsible` dari `web/`; bila CLI gagal, tulis manual pembungkus `radix-ui` Collapsible bergaya shadcn)

**Interfaces:**
- Consumes: `NAV_GROUPS`, `visibleNavGroups`, `isNavParent`, `isNavItemActive` (Task 6).
- Produces (`sidebar-state.ts`): `SIDEBAR_STORAGE_KEY = 'qc.sidebar'`; `interface SidebarState { open: boolean; expanded: string[] }`; `readSidebarState(): SidebarState` (bawaan `{ open: true, expanded: [] }` bila kosong/rusak/galat); `writeSidebarState(state: SidebarState): void` (galat ditelan).
- `AppShell`: `SidebarProvider` TERKENDALI (`open` + `onOpenChange` yang menulis `writeSidebarState`), nilai awal dari `readSidebarState().open`. (Catatan: `SidebarProvider` shadcn mengabaikan `_open` bila hanya `onOpenChange` diberikan; jadi wajib `open` juga.)
- `AppSidebar`: grup berlabel `null` tanpa `SidebarGroupLabel`; induk = `Collapsible` + `SidebarMenuSub`; status buka per `id` disimpan di `expanded`; induk yang memuat rute aktif selalu terbuka (tanpa menulis ke penyimpanan). Mode ikon (`state === 'collapsed'` dan bukan ponsel): klik induk membuka `DropdownMenu` `side="right"` `align="start"` berisi label induk + tautan anak; tooltip nama pada butir tanpa anak tetap. Titik panduan (`hasPendingGuide`) pada anak, dan pada induk bila salah satu anaknya. `data-tour="sidebar-menu"` tetap di `SidebarContent`.

- [ ] **Step 1: Tes gagal**:
  - `sidebar-state.test.ts`: kosong → bawaan; `'{bad'` → bawaan; `{"open":false,"expanded":["item"]}` → dibaca; `localStorage.getItem` melempar → bawaan; `writeSidebarState` lalu `readSidebarState` = sama.
  - `app-sidebar.test.tsx`: (a) klik "Item" membuka submenu berisi "Daftar Item" dan "Merk", dan `qc.sidebar.expanded` memuat `item`; (b) rute aktif `/item/brands` dengan `expanded: []` → "Merk" terlihat; (c) mode terlipat: fokus tombol "Stiker", tekan Enter → menu berisi "Katalog" tampil, Escape menutupnya, lokasi tidak berubah; (d) butir induk tidak punya `href`.
  - `app-shell.test.tsx`: `qc.sidebar` `{open:false}` → sidebar dirender `data-state="collapsed"`; klik `SidebarTrigger` → `qc.sidebar.open === true`.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** `bun run --cwd web test src/app` → PASS.
- [ ] **Step 5:** Commit `feat(web): sidebar bersubmenu yang diingat dan popover saat dilipat`.

### Task 8: Breadcrumb dan `PageContainer`

**Files:**
- Create: `web/src/app/route-meta.ts`, `web/src/app/route-meta.test.ts`, `web/src/app/shell/app-breadcrumb.tsx`, `web/src/app/shell/app-breadcrumb.test.tsx`, `web/src/components/page/page-container.tsx`, `web/src/components/ui/breadcrumb.tsx` (lewat `bunx --bun shadcn@latest add breadcrumb`; bila gagal tulis manual sesuai shadcn)
- Modify: `web/src/app/shell/app-shell.tsx`

**Interfaces:**
- Consumes: `findNavTrail`, `NAV_GROUPS` (Task 6).
- Produces (`route-meta.ts`):
  - `type PageWidth = 'narrow' | 'default' | 'full'`
  - `interface CrumbPart { label: string; to?: string; params?: Record<string, string> }`
  - `interface CrumbContext { params: Record<string, string>; queryClient: QueryClient }`
  - `type CrumbSpec = string | ((ctx: CrumbContext) => CrumbPart | CrumbPart[] | undefined)`
  - augmentasi `declare module '@tanstack/react-router' { interface StaticDataRouteOption { crumb?: CrumbSpec; pageWidth?: PageWidth } }`
  - `buildCrumbs(input: { trail: { parent: { label: string } | null; item: { label: string; to: string } } | null; matches: readonly { staticData?: { crumb?: CrumbSpec }; params: Record<string, string> }[]; queryClient: QueryClient }): CrumbPart[]` — urutan: label induk (tanpa `to`), butir nav (`to`), lalu crumb tiap match berurutan (string → `{label}`; fungsi → hasil, `undefined` dilewati). Bila `trail` null dan tak ada crumb → `[]`.
  - `pageWidthOf(matches: readonly { staticData?: { pageWidth?: PageWidth } }[]): PageWidth` — match terdalam yang menyatakan lebar; bawaan `'default'`.
  - `PAGE_WIDTH_CLASS: Record<PageWidth, string>` = `{ narrow: 'max-w-4xl', default: 'max-w-7xl', full: 'max-w-none' }`
- `PageContainer({ width = 'default', className, children })` → `div` `mx-auto w-full` + `PAGE_WIDTH_CLASS[width]`.
- `AppBreadcrumb`: `useMatches()` + `useMatchRoute()` → `findNavTrail` → `buildCrumbs`; berlangganan `queryClient.getQueryCache().subscribe` agar label dari cache diperbarui; tingkat terakhir `BreadcrumbPage` (tanpa tautan), lainnya `BreadcrumbLink asChild` + `Link`. `< 768px` (`useIsMobile`): hanya tingkat terakhir + tombol ikon `ChevronLeft` bernama "Kembali ke {label sebelumnya}" yang menaut ke tingkat sebelumnya yang punya `to`. Dipasang di header `AppShell` tepat setelah `SidebarTrigger`.
- `AppShell` membungkus `children ?? <Outlet />` dengan `PageContainer width={pageWidthOf(useMatches())}`.

- [ ] **Step 1: Tes gagal**:
  - `route-meta.test.ts`: `buildCrumbs` dengan trail `{parent:{label:'Item'}, item:{label:'Daftar Item', to:'/item'}}` + match crumb fungsi yang mengembalikan `[{label:'Asus RT-AX55', to:'/item/$itemId', params:{itemId:'1'}}, {label:'Ubah'}]` → 4 bagian berurutan; fungsi yang mengembalikan `undefined` dilewati; `pageWidthOf([{staticData:{pageWidth:'narrow'}},{staticData:{}}])` → `'narrow'`; `pageWidthOf([])` → `'default'`.
  - `app-breadcrumb.test.tsx` (router uji dengan rute `/item/$itemId` ber-crumb membaca cache `['items','detail',id]`): sebelum cache terisi tampil label cadangan dari crumb (mis. "Detail"); setelah `queryClient.setQueryData` → tampil nama; `navigation` "Daftar Item" berupa tautan ke `/item`; tingkat terakhir tanpa tautan; viewport ponsel → hanya tingkat terakhir + tombol "Kembali ke Daftar Item".
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** `bun run --cwd web test src/app` → PASS.
- [ ] **Step 5:** Commit `feat(web): breadcrumb dari metadata rute dan isi halaman rata tengah`.

### Task 9 (Haiku): Metadata tiap rute dan pembersihan lebar lama

**Files:**
- Modify: semua `web/src/routes/_app/**/*.tsx` (bukan tes), `web/src/routes/country-lock.tsx`; pembungkus `max-w-*` teratas di rute: `handover/new.tsx`, `handover/$handoverId/edit.tsx`, `item/new.tsx`, `item/$itemId/edit.tsx`, `postel/new.tsx`, `postel/$postelId/edit.tsx`, `qrcode/new.tsx`, `qrcode/$designId/edit.tsx`, `qrcode/default/index.tsx`, `qrcode/default/new.tsx`, `qrcode/default/$presetId/edit.tsx`, `serial/new.tsx`, `sticker/settings.tsx`
- Test: `web/src/app/route-meta-coverage.test.ts` (Create)

**Interfaces:**
- Consumes: `CrumbSpec`, `PageWidth` (Task 8).

Aturan `staticData`:
- Rute indeks yang menjadi tujuan butir nav: tanpa `crumb` (nav sudah menamainya).
- `…/new` → `crumb: 'Tambah'`. `forbidden` → `crumb: 'Akses ditolak'`.
- `…/$id` (View) → `crumb` fungsi yang membaca data query yang sama dengan `loader`/komponen rute itu dari `queryClient.getQueryData(<queryOptions>(id).queryKey)` dan mengembalikan nama record (Item: `"${brand} ${model}"`; Merk/BU: nama dari daftar yang dimuat; Serial: nomor serial; Postel: nama Postel; Serah Terima: nomor `ST-…`), atau `{ label: 'Detail' }` bila belum ada.
- `…/$id/edit` → fungsi yang mengembalikan `[{ label: <nama>, to: <rute View>, params }, { label: 'Ubah' }]` bila ada rute View, selain itu `[{ label: <nama> }, { label: 'Ubah' }]`.
- `pageWidth`: `'narrow'` untuk `new`/`edit` Item, Serah Terima, Postel, halaman `settings` (Serial, Stiker), View Item/Merk/BU/Postel; `'default'` untuk semua daftar, QR/Preset `new`/`edit` (form + pratinjau), View Serial dan Serah Terima, Country Lock; `'full'` untuk `/handover` (kanban) dan `/serial/new`.
- Pembungkus `max-w-*` teratas yang tercantum di Files dihapus (kelas lain seperti `space-y-4` dipertahankan) karena lebarnya kini dari `pageWidth`. Pembungkus `max-w` di dalam komponen modul (bukan teratas di rute) tidak disentuh di fase ini.

- [ ] **Step 1: Tes gagal** `route-meta-coverage.test.ts`: impor `routeTree`; telusuri semua rute di bawah `/_app`; setiap rute yang `fullPath`-nya berakhiran `/new`, `/edit`, atau segmen `$param` terakhir WAJIB punya `staticData.crumb`; setiap rute daun punya `pageWidth` atau memakai bawaan secara sengaja (daftar rute yang memakai bawaan ditulis di tes sebagai himpunan eksplisit).
- [ ] **Step 2:** `bun run --cwd web test src/app/route-meta-coverage.test.ts` → FAIL.
- [ ] **Step 3:** Isi `staticData` di tiap rute sesuai aturan; hapus pembungkus `max-w` teratas.
- [ ] **Step 4:** Tes → PASS; `bun run --cwd web test` seluruhnya hijau.
- [ ] **Step 5:** Commit `feat(web): metadata breadcrumb dan lebar halaman per rute`.

### Task 10: Warna mentah → token, badge status berwarna, dan penjaga

**Files:**
- Modify: berkas `web/src/**/*.tsx` di luar `components/ui` yang memakai kelas palet Tailwind mentah (±126 kemunculan di ±32 berkas; temukan lewat pola di Step 1), dan pemakai `Badge` untuk status Aktif/Nonaktif/Menipis/Habis
- Create: `scripts/no-raw-palette.test.ts`

**Interfaces:**
- Consumes: token Task 1, `Badge color/variant/dot` Task 2, `Alert color` Task 3.

Peta penggantian:
- Keluarga warna: `amber|yellow|orange` → `warning`; `red|rose` → `destructive`; `green|emerald` → `success`; `blue|sky` → `info`.
- Latar tipis (`bg-X-50|100|200`, `dark:bg-X-9xx/…`) → `bg-{token}-text/10` (tanpa varian `dark:`); teks (`text-X-5xx…9xx`, `dark:text-X-1xx…4xx`) → `text-{token}-text`; garis (`border-X-…`) → `border-{token}-text/35`; latar pekat (`bg-X-5xx|6xx`) → `bg-{token}` dengan teks `text-{token}-foreground`.
- Blok yang berupa banner/peringatan (kotak berlatar + teks) diganti `Alert color=…` bila strukturnya sederhana; selain itu cukup kelas token.
- Badge status: Aktif → `color="success" variant="soft" dot`; Nonaktif → `color="secondary" variant="soft" dot`; Menipis → `color="warning" variant="soft" dot`; Habis/Kedaluwarsa/Tidak muat → `color="destructive" variant="soft"`; badge kode (BU, lokasi, "Country lock") → `color="secondary" variant="outline"` kecuali yang bermakna status.
- Pengecualian yang TIDAK diganti (warna data, bukan UI): warna yang dipilih pengguna atau warna cetak label QR/PDF; tulis di daftar izin tes beserta alasannya.

- [ ] **Step 1: Tes gagal** `scripts/no-raw-palette.test.ts` (pola `scripts/no-native-select.test.ts`): pindai `web/src` (abaikan `components/ui`, berkas `*.test.*`, komentar); larang `/\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|placeholder|accent|caret)-(?:red|rose|amber|yellow|orange|green|emerald|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)-\d{2,3}\b/`; daftar izin `ALLOWED: Record<string, string>` (berkas → alasan) kosong di awal.
- [ ] **Step 2:** `bun test scripts/no-raw-palette.test.ts` → FAIL dengan daftar pelanggaran.
- [ ] **Step 3:** Ganti sesuai peta; badge status berwarna.
- [ ] **Step 4:** Tes penjaga → PASS; `bun run --cwd web test` hijau (tes yang memeriksa kelas warna lama diperbarui ke kelas token).
- [ ] **Step 5:** Commit `refactor(web): warna mentah ke token semantik dan badge status berwarna`.

### Task 11: Tandai field wajib di semua form

**Files:**
- Modify: komponen form dan dialog form di `web/src/modules/**/components/*form*.tsx`, `*-dialog.tsx` yang berisi field (Item, Merk, BU, Lokasi, Role, Pengguna, Customer, Stiker, Jenis Stiker, stok masuk/keluar/opname, QR + Preset, Postel, Serah Terima, Serial: Catat default/ubah baris/ubah massal/aksi/lapor rusak, pengaturan Stiker/Postel/Serial)

**Interfaces:**
- Consumes: `Label required`, `ComboboxCommon.required` (Task 5).

Aturan: field ditandai wajib bila skema zod form (atau validator `onSubmit`/`onChange` TanStack Form-nya) menolak nilai kosong pada keadaan form itu; field yang wajib bersyarat (mis. Firmware hanya saat Country lock dicentang) ditandai hanya saat syaratnya aktif. Input teks: `<Label required>` + `aria-required` pada input; `LinkField`/`LinkMultiField`/`Select`/`MultiSelect`: prop `required`.

- [ ] **Step 1: Tes gagal** satu per form utama (Item, Merk, Stiker, Postel, Serah Terima, Catat Serial default): `expect(screen.getByLabelText('<nama field>')).toHaveAttribute('aria-required', 'true')` untuk satu field wajib dan `not.toHaveAttribute('aria-required')` untuk satu field opsional; untuk Item: Firmware tidak `aria-required` sampai "Country lock" dicentang.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Tandai semua form.
- [ ] **Step 4:** `bun run --cwd web test` → PASS.
- [ ] **Step 5:** Commit `feat(web): tandai field wajib di semua form`.

### Task 12 (Haiku): `FormHeader` berikon, dokumentasi, changelog, verifikasi akhir

**Files:**
- Modify: `web/src/components/form-header.tsx`, `web/src/components/form-header.test.tsx`, `CLAUDE.md`
- Create: `server/changelog.d/20261120-redesain-fondasi.md`

**Interfaces:**
- Consumes: `ActionButton` (Task 4).

- [ ] **Step 1: Tes gagal** `form-header.test.tsx`: tombol "Batal" dan tombol simpan (label `submitLabel`) memuat svg; saat `submitting` tombol simpan nonaktif dan berteks `busyText`. Tes lama tetap.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** `FormHeader` memakai `ActionButton action="cancel"` dan `ActionButton action="save" type="submit" label={submitLabel} busy={submitting}` (prop lain tetap). CLAUDE.md "Aturan frontend": tambah butir sistem desain (token §6.1 dan tiga nadanya, `Button`/`Badge` `color` × `variant` dengan pemetaan lama sementara, `ActionButton` untuk aksi umum, `Alert color`, tooltip shadcn, `Label required`/`aria-required`, larangan palet mentah dijaga `scripts/no-raw-palette.test.ts`), butir cangkang (navigasi berpohon `NAV_GROUPS`, `qc.sidebar`, `staticData.crumb`/`pageWidth` wajib untuk rute baru, `PageContainer`). Fragmen changelog: baris pertama `jenis: diubah`, lalu satu paragraf santai untuk pengguna tentang tampilan baru (warna status, menu dikelompokkan dan diingat, breadcrumb, tanda * pada isian wajib).
- [ ] **Step 4:** Verifikasi: `bun run --cwd web test`, `bun run typecheck`, `bun run lint`, `bun test scripts/`, `bun run changelog validate`, `bun run build` → semua sukses (catat keluaran ringkas). `bun run check` penuh bila terowongan DB hidup; bila mati, laporkan bahwa tes server tak dijalankan (fase ini tak mengubah server).
- [ ] **Step 5:** Commit `docs: aturan sistem desain dan cangkang + changelog fondasi`.
