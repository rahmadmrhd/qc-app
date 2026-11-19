# Redesain Tampilan Aplikasi Web: Sistem Desain dan Kit CRUD

Tanggal: 2026-11-20. Status: rancangan, menunggu persetujuan pemilik produk.
Acuan visual: mockup v3 [`assets/2026-11-20-redesain-mockup-v3.html`](assets/2026-11-20-redesain-mockup-v3.html) (berkas HTML mandiri, buka di peramban; disetujui pemilik 2026-11-20). Bila spek dan mockup berbeda, spek yang berlaku.

## 1. Maksud dan alasan

Aplikasi web tumbuh modul demi modul (Item, Stiker, Serial Number, Postel, QR, Serah Terima, Akses). Tiap halaman menata judul, filter, tombol, tabel, dan form-nya sendiri, sehingga tampilan dan perilaku tidak seragam: tombol aksi berupa teks di kanan, warna hanya hitam/abu-abu plus satu merah, tidak ada breadcrumb, isi halaman rata kiri, sidebar lupa keadaannya setelah refresh, dan model kecil tidak punya halaman lihat.

Pemilik produk ingin **satu bahasa desain** yang konsisten, sederhana, informatif (warna menyampaikan makna), dapat dipakai ulang (modul baru tinggal memakai komponen yang sama), dan dapat diperkirakan (komponen yang sama selalu berperilaku sama; aksi massal aman diulang).

## 2. Sasaran, bukan sasaran, anti-sasaran

**Sasaran**
- Token warna semantik (primary, secondary, success, warning, info, destructive) untuk tema terang dan gelap, dipakai tombol, badge, alert/banner, toast, dan kolom kanban.
- Tombol dan badge dengan dua sumbu: warna × gaya (solid, soft, outline, ghost, link).
- Kosakata aksi terpusat: ikon + warna + label tetap per aksi; ikon saja di ruang sempit (tabel), ikon + label di ruang lebar (View, header form).
- Cangkang: sidebar dikelompokkan per fitur dengan submenu, keadaannya diingat, popover submenu saat dilipat; breadcrumb di sebelah tombol sidebar; isi halaman rata tengah.
- Kit CRUD: halaman indeks (Daftar, Kanban, Grid), View, Form Edit (halaman), Form Dialog; Form Edit dan Form Dialog membungkus komponen form yang sama.
- Setiap model punya halaman View; kolom unik dan kolom relasi di daftar menjadi tautan ke View.
- Checkbox per baris + aksi massal lewat rute batch ATOMIK di server.
- Semua field relasi (form dan filter) memakai `LinkField`/`LinkMultiField`, dengan baris "Tambah" bila ada cara membuat record itu dan pengguna berhak.

**Bukan sasaran**
- Mengubah aturan bisnis, izin, atau alur modul (selain menambah View, rute batch, dan "Tambah" di LinkField).
- Halaman publik `/laporan/$token`, halaman login, dan layar offline: hanya ikut token warna, tidak dirombak.
- Aplikasi desktop Electron di luar UI web yang sama (kanal jembatan tidak berubah).

**Anti-sasaran** (gagal walau "berfungsi")
- Halaman yang masih memakai pola lama setelah fase modulnya selesai.
- Aksi massal yang sebagian berhasil sebagian tidak (harus semua atau tidak sama sekali).
- Tombol ikon tanpa nama yang dapat diakses (`aria-label`) atau tanpa tooltip.
- Warna yang pudar/tak terbaca di mode gelap (keputusan pemilik setelah mockup v2).
- Panduan interaktif yang rusak karena target `data-tour` hilang.

## 3. Batasan dari proyek

- Aturan frontend CLAUDE.md tetap berlaku: field relasi wajib `LinkField`/`LinkMultiField`; tanpa `<select>` bawaan; dialog dengan header/footer menempel dan hanya badan menggulir; daftar saran `LinkField` lewat portal; izin Tambah/Buka dipusatkan di `web/src/lib/link-access.ts`; dialog "Tambah" dirender di luar `<form>` induk.
- Komponen shadcn di `web/src/components/ui` (dikecualikan dari lint) boleh diubah; varian shadcn 4 memakai `cva` + `cn`.
- Tes web banyak mencari tombol lewat nama aksesibel (`getByRole('button', { name })`). Tombol ikon WAJIB tetap punya nama yang sama dengan label teks sebelumnya agar tes dan pembaca layar tidak berubah; teks yang memang berubah diikuti perubahan tes.
- Panduan interaktif menyorot elemen lewat `data-tour` dan tes katalog menjaga targetnya ada di kode sumber. Perubahan cangkang/sidebar wajib mempertahankan atau memindahkan target ini (checklist rilis panduan: kosmetik = perbaiki target/teks katalog).
- Rute REST baru mengikuti resep "Menambah rute REST" (CLAUDE.md): `ApiContract`, `API_ROUTES`, validator + handler, `permission`, tes REST, OpenAPI otomatis. Penulisan bergantung baca memakai CAS di dalam `batch()`.
- Rute batch tidak butuh migrasi; bila suatu fase ternyata butuh migrasi, wajib expand-only.
- `bun run check` hijau sebelum tiap commit; build `verify-dist` (anggaran potongan JS 600 KB gzip) tetap lolos.
- Alur kerja pengerjaan mengikuti CLAUDE.md global (putaran sprint, subagent Haiku/Sonnet, review akhir putaran + security review `security-audit` atas perubahan putaran).

## 4. Pendekatan

| | Pendekatan | Untung | Rugi |
|---|---|---|---|
| **A (dipilih)** | Bertahap per fase (fondasi → kit → modul percontohan → modul lain berkelompok); semua fase dalam SATU cabang dan SATU PR ke `dev` (keputusan pemilik 2026-11-20, lihat keputusan 12) | Tiap PR dapat direview; aplikasi tetap jalan di antara fase; kit diuji di kasus nyata sebelum disebar | Selama fase 3-4, sebagian halaman sudah pola baru dan sebagian belum |
| B | Satu cabang besar, semuanya sekaligus | Seragam sekaligus saat rilis | Diff sangat besar, sulit direview; regresi satu modul menahan semua |
| C | Kit dibuat, modul lama dipindah bila sempat | Paling murah di awal | Bertentangan dengan tujuan konsistensi; pola lama bertahan tanpa batas |

Pemilik memilih **A** (2026-11-20). Satu dokumen rancangan ini mencakup semua fase; rencana implementasi ditulis per fase. Fase adalah putaran kerja (implementasi → review akhir putaran → perbaikan) di satu cabang, bukan PR terpisah.

## 5. Keputusan pemilik (2026-11-20)

1. **Setiap model punya halaman View** (bukan hanya model besar). Ini membalik keputusan 2026-11-10 (spek BU keputusan 24, CLAUDE.md bagian "Field relasi") bahwa model tanpa halaman lihat tidak punya tautan "Buka" dan tidak dibuatkan rute baru. Dicatat ulang di CLAUDE.md dan spek BU sebagai bagian fase yang menambah View.
2. **Aksi massal memakai rute batch atomik di server** (bukan panggilan per baris dari klien).
3. **Warna**: primary netral (hitam di terang, putih di gelap), secondary abu-abu, info biru (juga warna tautan), plus success, warning, destructive. Palet mode gelap = mockup v3 (lihat §6.1); palet pastel v2 ditolak.
4. **Gaya**: solid, soft (muted), outline, ghost, link untuk tombol dan badge.
5. **Tooltip** memakai komponen shadcn `Tooltip` (bukan atribut `title`).
6. **Header form** berperilaku sama dengan bar judul halaman daftar (muncul lagi saat gulir naik sedikit); **tab form selalu menempel**.
7. **Sidebar dilipat**: menu bersubmenu membuka popover berisi submenunya saat diklik.
8. **Kanban**: warna kolom mengikuti warna badge dari nilai yang dikelompokkan.
9. Banner, alert, dan toast mengikuti mockup (soft + ikon status; toast dengan garis kiri berwarna).
10. Pengelompokan sidebar dan pola halaman pada mockup v3 disetujui.
11. **Semua model memakai soft delete**, dapat **dipulihkan**, model berstatus wajib Nonaktif sebelum dihapus, keunikan menyertakan `deleted_at`, dan menghapus data master tidak menghapus data yang merujuknya. Dirinci di rancangan terpisah [Soft Delete untuk Semua Model](2026-11-20-soft-delete-design.md); aksi Hapus/Pulihkan dan rute batch hapus di dokumen ini mengikuti rancangan itu.
12. **Semua fase digabung dalam satu PR** ke `dev` (bukan satu PR per fase); pemilik menyetujui di muka rencana implementasi setiap fase (2026-11-20). Akibatnya penilaian pola percontohan (fase 3) oleh pemilik di staging tidak menjadi gerbang sebelum fase 4; percontohan tetap dikerjakan lebih dulu agar kit teruji di kasus nyata, dan pemilik menilai keseluruhan saat PR.

## 6. Rancangan

### 6.1 Token warna

Di `web/src/styles.css`, setiap warna semantik punya tiga token, didaftarkan di `@theme inline` agar tersedia sebagai utilitas Tailwind (`bg-success`, `text-success-foreground`, `text-success-text`, dst.):

- `--X`: latar solid.
- `--X-foreground`: teks di atas latar solid.
- `--X-text`: warna teks/ikon/garis di atas latar halaman (dipakai soft, outline, ghost, link, alert, toast, kolom kanban).

| Warna | Terang: solid / fg / text | Gelap: solid / fg / text |
|---|---|---|
| primary | `#18181b` / `#fafafa` / `#18181b` | `#fafafa` / `#18181b` / `#fafafa` |
| secondary | `#71717a` / `#fff` / `#52525b` | `#52525b` / `#fafafa` / `#a1a1aa` |
| success | `#16a34a` / `#fff` / `#15803d` | `#16a34a` / `#fff` / `#22c55e` |
| warning | `#f59e0b` / `#1c1917` / `#b45309` | `#d97706` / `#fff` / `#f59e0b` |
| info | `#2563eb` / `#fff` / `#1d4ed8` | `#2563eb` / `#fff` / `#3b82f6` |
| destructive | `#dc2626` / `#fff` / `#b91c1c` | `#ef4444` / `#fff` / `#ef4444` |

Nilai boleh ditulis dalam `oklch` setara (gaya file saat ini) asalkan tampil sama dengan mockup v3. Token shadcn lama (`--primary`, `--secondary`, `--destructive`, `--muted`, dst.) tetap ada dan dipetakan ke nilai di atas; `--secondary` shadcn (latar abu muda untuk tombol sekunder lama) diganti maknanya menjadi abu-abu sesuai tabel, dan pemakai lama dimigrasi (§6.2). Sorotan komentar `::highlight(qc-comment)` tidak berubah.

### 6.2 Tombol, badge, alert, toast

- `Button` dan `Badge` (`components/ui/button.tsx`, `badge.tsx`) menerima `color` (`primary` | `secondary` | `success` | `warning` | `info` | `destructive`, bawaan `primary`) dan `variant` (`solid` | `soft` | `outline` | `ghost` | `link`, bawaan `solid`). Kombinasi primary + soft/outline/ghost memakai abu netral (bukan hitam pekat), seperti mockup.
- **Kompatibilitas**: nilai `variant` lama dipetakan otomatis: `default` → solid primary; `outline` → outline primary; `ghost` → ghost primary; `secondary` → soft secondary; `destructive` → soft destructive; `link` → link info. Pemetaan ini sementara: fase 4 terakhir menghapusnya setelah tak ada pemakai (dijaga tes/grep).
- `Alert` (`components/ui/alert.tsx`) mendapat `color` dengan ikon bawaan per warna (info `Info`, success `CircleCheck`, warning `TriangleAlert`, destructive `CircleX`); dipakai banner aplikasi (`ServerStatusBanner`, `UiUpdateBanner`, banner panduan, banner foto bermasalah, dll.).
- **Toast** (`components/ui/sonner.tsx`): `toast.success|error|warning|info` tampil dengan garis kiri dan ikon berwarna sesuai token. Pemanggil yang ada (`toast.success`, `toast.error`) tidak perlu diubah.
- **Badge status** memakai `soft` + titik warna untuk keadaan (Aktif = success, Nonaktif = secondary, Menipis = warning, Habis/Kedaluwarsa = destructive, Dalam pengiriman = info); badge kode (BU, lokasi) memakai `outline secondary`. Pemetaan status→warna per modul ditulis sekali per modul di satu fungsi (mis. `itemStatusBadge`), bukan di tiap pemakai.

### 6.3 Kosakata aksi

Komponen `ActionButton` (`web/src/components/action-button.tsx`) dengan `action` dari daftar tetap; tiap aksi menentukan ikon lucide, warna, gaya, dan label bawaan:

| action | Ikon | Warna/gaya | Label |
|---|---|---|---|
| `create` | `Plus` | primary solid | Tambah |
| `save` | `Save` | primary solid | Simpan |
| `edit` | `Pencil` | primary outline (ghost saat `compact`) | Ubah |
| `delete` | `Trash2` | destructive soft (ghost saat `compact`) | Hapus |
| `activate` | `Power` | success soft | Aktifkan |
| `deactivate` | `PowerOff` | warning soft | Nonaktifkan |
| `restore` | `RotateCcw` | info soft | Pulihkan |
| `cancel` | `X` | primary outline | Batal |
| `download` / `export` | `Download` | secondary soft | Unduh / Ekspor |
| `upload` | `Upload` | secondary soft | Unggah |
| `print` | `Printer` | secondary soft | Cetak |
| `copy` | `Copy` | secondary ghost | Salin |
| `refresh` | `RefreshCw` | secondary ghost | Muat ulang |

- Prop `label` menimpa teks (mis. "Tambah item"); prop `compact` = ikon saja, ukuran kecil, `aria-label` = label lengkap (mis. "Ubah Asus RT-AX55"), dan dibungkus shadcn `Tooltip` berisi label.
- Aturan pemakaian: tabel/kartu/kanban = `compact`; View, header form, bar judul, bar aksi massal = ikon + label.
- Aksi yang tidak umum (mis. "Terima", "Kirim ke servis") tetap tombol biasa dengan `color`/`variant` yang tepat; boleh ditambahkan ke daftar bila muncul di ≥ 2 modul.
- Aksi destruktif tetap memakai dialog konfirmasi yang ada.

### 6.4 Cangkang aplikasi

**Sidebar** (`app/navigation.ts`, `app/shell/app-sidebar.tsx`):

```
Beranda
OPERASIONAL
  Serah Terima
  Country Lock
  Serial Number      ▸ Daftar · Laporan · Pengaturan
DATA MASTER
  Item               ▸ Daftar Item · Merk
  Customer
STIKER & DOKUMEN
  Stiker             ▸ Katalog · Jenis · Stok · Pustaka Gambar · Konfigurasi
  Manual Book        ▸ QR Code · Default QR
  Postel
PENGATURAN
  Akses              ▸ Pengguna · Role · Lokasi · Business Unit
  Sistem             ▸ Status Push · Log Audit
```

- `NavGroup` mendapat `items` yang boleh berupa butir biasa atau butir bersubmenu (`children: NavItem[]`). Izin dihitung per anak; butir induk tampil bila minimal satu anak tampil; induk tanpa halaman sendiri.
- Default QR (`/qrcode/default`) kini menu sendiri (sebelumnya hanya dibuka dari halaman QR).
- **Keadaan diingat**: terbuka/terlipat sidebar dan submenu yang terbuka disimpan di `localStorage` (`qc.sidebar`, bukan per akun), dibaca saat `SidebarProvider` dibuat (`defaultOpen` dari penyimpanan), dibungkus try/catch. Submenu yang memuat rute aktif selalu terbuka. Cookie `sidebar_state` bawaan shadcn tidak dipakai lagi.
- **Mode ikon**: klik butir bersubmenu membuka `Popover`/`DropdownMenu` di kanan ikon berisi judul grup + submenu; butir tanpa submenu menampilkan tooltip nama (perilaku `SidebarMenuButton tooltip` yang ada). Di ponsel (sheet) submenu tampil berlipat biasa.
- Titik penanda panduan (`hasPendingGuide`) berlaku untuk butir anak; induk menampilkan titik bila salah satu anaknya punya.
- `isNavItemActive`, `excludes`, `alsoActiveOn` tetap; tes navigasi diperbarui.

**Header**: `[SidebarTrigger] Breadcrumb ……… LocationPicker · OutboxChip · NotificationBell · ThemeToggle · UserMenu`.

- **Breadcrumb** (`app/shell/app-breadcrumb.tsx`, komponen shadcn `breadcrumb`): disusun dari `useMatches()`; tiap rute menyatakan labelnya lewat `staticData.crumb` (teks tetap, mis. "Data Item") atau fungsi yang membaca data loader / cache query yang sudah ada (nama record di halaman View/Ubah) tanpa permintaan jaringan tambahan. Grup sidebar menjadi tingkat pertama tanpa tautan bila tidak punya halaman (mis. "Item › Daftar Item › Asus RT-AX55 › Ubah"). Di layar < 768 px hanya tingkat terakhir + tombol kembali ke tingkat sebelumnya.

**Isi halaman**: `PageContainer` (`web/src/components/page/page-container.tsx`) dengan `width`: `narrow` (form, View, pengaturan; ±900 px), `default` (daftar, grid; ±1180 px), `full` (kanban, tabel yang memang lebar). Selalu `mx-auto` (rata tengah). `main` di `AppShell` tetap memberi padding; setiap rute membungkus isinya dengan `PageContainer` pada fase 1. Tes yang menjaga bahwa setiap komponen halaman memakai salah satu kerangka §6.5-6.7 baru diaktifkan di akhir fase 4d (sebelumnya halaman pola lama sah).

### 6.5 Halaman indeks

Kerangka `ListPage` (`web/src/components/page/list-page.tsx`):

```
┌ Judul                          [aksi sekunder] [+ Tambah] ┐ ← bar "headroom"
│ [cari…] [Status: Aktif ✕] [+ Merk] [+ Business Unit] …   │
├──────────────────────────────────────────────────────────┤
│ isi: DataTable | KanbanBoard | GridView                   │
└ bar aksi massal (muncul bila ada pilihan)                 ┘
```

- **Bar headroom** (judul + aksi + filter): menempel di bawah header aplikasi; tersembunyi saat pengguna menggulir turun melewati ambang, muncul lagi begitu menggulir naik sedikit (≥ beberapa piksel), berbayang saat melayang. Elemen yang "mengikuti" (header tabel, tab form) memakai offset dari tinggi bar saat terlihat. Hook bersama `useHeadroom()` (`web/src/hooks/use-headroom.ts`) dipakai `ListPage` dan `FormPage`; menghormati `prefers-reduced-motion` (tanpa animasi). Bila halaman tidak cukup panjang untuk menggulir, bar diam.
- **Filter**: komponen `FilterBar` dengan kolom cari + chip filter. Filter yang aktif tampil sebagai chip berisi nilai (+ tombol hapus); filter yang belum diisi tampil sebagai chip "+ Nama". Nilai filter tetap di search params Router (pola yang ada). Filter relasi memakai `LinkField`/`LinkMultiField` (di dalam popover chip), enum memakai `Select`/`MultiSelect`.

**DataTable** (`web/src/components/data-table/`):
- Header tabel `sticky`, offset mengikuti bar headroom.
- Kolom kiri: checkbox (bila halaman punya aksi massal), lalu kolom aksi (`ActionButton compact`). Tidak ada tombol "Lihat".
- Kolom unik (nama/kode/nomor record) = tautan ke View record itu; kolom relasi = tautan ke View model relasi. Tautan memakai warna `info-text`, garis bawah saat hover, dan komponen `Link` Router (klik tengah/Ctrl membuka tab baru). Tautan relasi hanya bila pengguna berhak membaca record tujuan (fungsi di `lib/link-access.ts`); bila tidak, teks biasa.
- Checkbox kepala = pilih semua baris yang SUDAH dimuat (daftar infinite); bar massal menyebut jumlah dan menyediakan aksi massal modul + "Batalkan pilihan". Pilihan dibuang saat filter berubah.
- Baris kosong, galat muat, dan "Muat lebih banyak" seragam.
- Di layar < 768 px tabel boleh menggulir horizontal; halaman yang sudah punya tampilan kartu ponsel (mis. staging Serial) mempertahankannya.

**KanbanBoard**: kolom dengan lebar minimum (±290 px) dan gulir horizontal bila tak muat; `ListPage` di atasnya (filter sama). Warna kolom (garis atas, latar tipis, garis kiri kartu) mengikuti warna badge nilai yang dikelompokkan (mis. status Serah Terima). Kartu memakai tautan ke View. Papan ponsel yang ada tetap.

**GridView**: kisi kartu mengikuti `LibraryTab` Pustaka Gambar (kartu bergambar, nama, aksi `compact`, pencarian/urutan/filter di `FilterBar`). Pustaka Gambar menjadi pemakai pertama; `components/file-dialog` tetap memakai kisinya untuk dialog berkas.

### 6.6 Halaman View

Kerangka `ViewPage` (`web/src/components/page/view-page.tsx`): bar headroom berisi judul record + badge status + aksi (ikon + label: Ubah, Aktifkan/Nonaktifkan, Hapus, aksi modul), tab bila isi panjang (mis. Detail · Gambar · Riwayat), isi berupa daftar label–nilai (`dl`) per section, panel samping (≥ 1024 px; di bawah isi pada layar sempit) berisi pembuat, terakhir diubah, dan tautan ke data terkait (mis. "128 Serial Number"). Nilai relasi = tautan ke View-nya.

**View baru** (model yang belum punya halaman lihat):

| Model | Rute View baru | Dibuka dari |
|---|---|---|
| Customer | `/customer/$customerId` | daftar Customer, task Serah Terima |
| Stiker | `/sticker/$stickerId` | Katalog, Stok, instruksi item, Postel, Manual Book |
| Jenis Stiker | `/sticker/types/$typeId` | daftar Jenis, Katalog |
| Desain QR (Manual Book) | `/qrcode/$designId` | daftar QR, View Item |
| Preset QR (Default QR) | `/qrcode/default/$presetId` | daftar Default QR, form QR |
| Pengguna | `/access/users/$userId` | daftar Pengguna, Log Audit |
| Role | `/access/roles/$roleId` | daftar Role, View Pengguna |
| Lokasi | `/access/locations/$locationId` | daftar Lokasi, View Pengguna, Serial |

Halaman Ubah yang sudah ada (`…/$id/edit`) tetap; model yang hari ini diubah lewat dialog boleh tetap memakai Form Dialog dari View dan daftar. View Laporan Serial memakai halaman detail Serial yang ada (tab laporan). Log Audit dan Status Push hanya-baca tanpa View sendiri; entri audit menaut ke View entitasnya bila ada.

Konsekuensi: `LinkField` "Buka" (`openHref`) tersedia untuk semua model di atas; fungsi izin baru di `lib/link-access.ts` (mis. `customerLinkAccess`, `userLinkAccess`, `roleLinkAccess`, `locationLinkAccess`, `qrDesignLinkAccess`, `qrPresetLinkAccess`), dan `stickerTypeLinkAccess`/`stickerLinkAccess` mendapat `openHref`.

### 6.7 Form Edit dan Form Dialog

- Setiap model punya satu komponen form (`<Model>Form`) yang hanya berisi field + validasi + submit, tanpa kerangka halaman/dialog. Ia dibungkus:
  - `FormPage` (`web/src/components/page/form-page.tsx`): bar headroom berisi judul (+ badge status saat ubah) dan aksi (Batal, aksi tambahan, Simpan, ikon + label) menggantikan `FormHeader`; tab `sticky` di bawahnya; `PageContainer narrow`.
  - `FormDialog` (yang ada, `components/form-dialog.tsx`): header dan footer dialog; tab di dalam badan dialog bila form bertab.
  - Form yang hari ini ditulis dua kali (halaman dan dialog) disatukan.
- **Tab** (`FormTabs`): dipakai bila form punya ≥ 3 section atau lebih panjang dari satu layar; satu tab boleh berisi beberapa section (judul section + kisi 2 kolom di ≥ 768 px). Galat validasi di tab lain ditandai titik merah pada judul tab, dan submit yang gagal pindah ke tab pertama yang bergalat.
- **Field wajib**: label bertanda `*` merah (`text-destructive`) lewat prop `required` pada `Label` dan pada komponen field (`LinkField`, `LinkMultiField`, `Select`, `MultiSelect`, dan pembungkus input teks). Penanda dibaca pembaca layar sebagai "wajib" (`aria-required` pada kontrol; bintang `aria-hidden`).
- Bentuk field mengikuti mockup (latar `muted`, tanpa border tebal); fokus tetap memakai `ring`.

### 6.8 LinkField: Tambah dan audit

- Fase 4 mengaudit semua field relasi di form dan filter tiap modul; yang belum memakai `LinkField`/`LinkMultiField` dipindah.
- Baris "Tambah {model}" (`onCreate`) tersedia untuk setiap model yang punya cara membuat record (form dialog atau halaman), bila pengguna berhak membuat. Bila pembuatan model itu hanya lewat halaman penuh (mis. Item), "Tambah" membuka Form Dialog yang membungkus form yang sama (§6.7), lalu record baru langsung terpilih. Pengecualian yang tetap: lokasi pada `LocationField` (tanpa Tambah/Buka, aturan yang ada) dan model yang pembuatannya tidak ada di UI (mis. Customer dibuat otomatis lewat `CustomerCombobox`, yang tetap teks bebas).

### 6.9 Rute batch atomik

Untuk setiap aksi massal di tabel berikut, satu rute REST baru per modul, mengikuti pola `serials.updateBatch`. Hapus dan Pulihkan mengikuti [rancangan soft delete](2026-11-20-soft-delete-design.md) (§4.3: model berstatus wajib Nonaktif dulu; §4.5: Pulihkan dari tampilan "Terhapus"):

| Modul | Rute batch | Aksi massal di UI |
|---|---|---|
| Item | `items.setStatusBatch`, `items.removeBatch`, `items.restoreBatch` | Aktifkan, Nonaktifkan, Hapus, Pulihkan |
| Merk | `brands.*` (sama) | sama |
| Customer | `customers.*` (sama) | sama |
| Stiker | `stickers.*` (sama) | sama |
| Jenis Stiker | `stickerTypes.*` (sama) | sama |
| Pengguna | `access.users.*` (sama) | sama |
| Lokasi | `access.locations.*` (sama) | sama |
| Business Unit | `access.businessUnits.*` (sama) | sama |
| Role | `access.roles.removeBatch`, `restoreBatch` | Hapus, Pulihkan |
| QR Code | `qrcodes.removeBatch`, `restoreBatch` | Hapus, Pulihkan |
| Default QR | `qrcodes.removePresetBatch`, `restorePresetBatch` | Hapus, Pulihkan |
| Postel | `postels.removeBatch`, `restoreBatch` | Hapus, Pulihkan |
| Pustaka Gambar | `stickerGuides.removeBatch`, `restoreBatch` | Hapus, Pulihkan |
| Serial Number | `serials.updateBatch` (ada), `serials.removeBatch`, `restoreBatch` | Ubah massal, Hapus, Pulihkan |
| Serah Terima | `handovers.removeBatch`, `restoreBatch` | Hapus, Pulihkan (di tampilan daftar/"Terhapus"; papan kanban tanpa checkbox) |

Kontrak bersama:
- Masukan: `{ items: { id, updatedAt? }[], status? }` (`updatedAt` untuk model yang memakai CAS `updated_at`), maks. 100 id per permintaan (`BATCH_MAX`), id unik.
- **Atomik**: semua perubahan dalam satu `batch()`/`transaction()` dengan penjaga CAS per baris; satu gagal = tak ada yang berubah. Kegagalan karena versi usang memakai `staleError` dan respons menyebut id yang usang agar UI dapat memuat ulang; record tak ditemukan/di luar hak = `NOT_FOUND` seragam untuk seluruh permintaan (tanpa membocorkan id mana yang ada).
- **Idempoten**: menyetel status yang sudah sama = tanpa perubahan dan bukan galat; menghapus record yang sudah tidak ada = `NOT_FOUND` (sama dengan rute tunggal).
- **Aturan bisnis sama dengan rute tunggal**: logika per record dipanggil dari fungsi service yang sama (bukan disalin), termasuk penjaga khusus (jenis sistem stiker tak dapat dinonaktifkan, `guardLatest` Manual Book, hak per BU item pada SEMUA BU, akun sendiri, role yang masih dipakai, dll.; aturan hapus/pulihkan mengikuti rancangan soft delete §4.3 dan §5). Bila satu record melanggar, seluruh batch ditolak dengan pesan yang menyebut alasannya secara generik.
- Izin rute = izin rute tunggal yang setara; audit log per record seperti rute tunggal.
- UI: setelah sukses, cache diperbarui dengan hasil server (`upsertInList`/`removeFromList`) dan toast "N item dinonaktifkan"; setelah gagal, toast galat + pilihan tetap terpasang.

### 6.10 Fase dan cakupan

| Fase | Isi | Selesai bila |
|---|---|---|
| 1. Fondasi | §6.1-6.4 (token, Button/Badge/Alert/toast, `ActionButton`, Tooltip, sidebar + popover + penyimpanan, breadcrumb, `PageContainer` dipasang di semua rute), `required` pada label | Semua halaman memakai token dan cangkang baru; pemetaan varian lama aktif; tes hijau |
| 2. Kit CRUD | `ListPage`, `useHeadroom`, `FilterBar`, `DataTable`, `KanbanBoard`, `GridView`, `ViewPage`, `FormPage`, `FormTabs`; Pustaka Gambar sebagai pemakai `GridView` | Komponen kit punya tes sendiri; satu halaman nyata (Pustaka Gambar) memakai kit |
| 2b. Infrastruktur soft delete | Kolom `deleted_at`, indeks unik baru (expand), helper penyaring + tes penjaga, pola rute remove/restore, tampilan "Terhapus" (rancangan soft delete §4.6) | Tes penjaga aktif; belum ada modul yang memakai Hapus baru |
| 3. Percontohan | Item + Merk sepenuhnya di kit, termasuk batch status, tautan kolom, form bertab, Form Dialog "Tambah Merk"/"Tambah item" | Pola teruji di Item/Merk sebelum disebar (penilaian pemilik saat PR, keputusan 12) |
| 4a | Stiker (Katalog, Jenis, Stok, Konfigurasi) + View Stiker dan Jenis + batch | |
| 4b | Manual Book (QR, Default QR) + Postel + View QR dan Preset + batch | |
| 4c | Akses (Pengguna, Role, Lokasi, BU, Log Audit, Status Push) + Customer + View baru + batch | |
| 4d | Serial Number (Daftar, Laporan, Pengaturan, Catat) + Serah Terima (Kanban) + Country Lock | Pemetaan varian lama dihapus; tak ada halaman pola lama |

Tiap fase: rencana implementasi sendiri, commit di cabang yang sama (satu PR untuk semua fase, keputusan 12), catatan changelog (`server/changelog.d/`), dan pembaruan CLAUDE.md (struktur `components/page`, `data-table`, aturan View untuk semua model, aturan aksi massal) pada fase yang memperkenalkannya. Panduan interaktif: target `data-tour` dipertahankan; langkah tur yang menyorot sidebar diperbarui (kosmetik) pada fase 1.

## 7. Diserahkan kepada pembangun

- Nama berkas/komponen di luar yang disebut di sini, susunan internal `DataTable` (pakai atau tanpa TanStack Table), dan ambang piksel headroom.
- Nilai `oklch` setara token dan ukuran persis lebar `PageContainer`.
- Pemetaan status→warna badge per modul, mengikuti makna di §6.2.
- Urutan tab dan pembagian section tiap form, mengikuti aturan §6.7.
- Rincian validator dan bentuk respons galat rute batch, dalam kontrak §6.9.

## 8. Jawaban atas review pembangun (keputusan perancang, 2026-11-20)

Pertanyaan dari pemeriksaan pembangun independen yang dijawab perancang tanpa mengubah apa yang diminta pemilik; pemilik dapat mengoreksinya saat menyetujui dokumen ini.

1. **Data View baru.** Tujuh model belum punya rute `get` per record (Customer, Stiker, Jenis Stiker, Pengguna, Role, Lokasi, Preset QR; Desain QR sudah punya `qrcodes.get`). Fase yang menambah View-nya juga menambah rute `<model>.get` (kontrak, izin, tes REST) dengan izin = izin baca `list` yang setara dan DTO = DTO baris daftar yang sudah ada (tidak membuka data baru). Halaman View boleh menampilkan data dari cache daftar lebih dulu lalu memuat `get`; tautan yang dibuka langsung tetap bekerja. Record di luar hak = `NOT_FOUND`. Ini menambah lingkup server fase 4 dan termasuk dalam "Bukan sasaran" sebagai bagian dari View.
2. **Panel "data terkait"** di View hanya memakai data yang sudah ada di DTO (pembuat/terakhir diubah bila ada) dan tautan ke halaman daftar terfilter (mis. "Lihat Serial Number item ini" ke `/serial` dengan filter item), tanpa rute hitungan baru.
3. **Mockup** dikomit sebagai `docs/superpowers/specs/assets/2026-11-20-redesain-mockup-v3.html`.
4. **Tes kerangka halaman** baru aktif di akhir fase 4d (lihat §6.4); setiap PR fase tetap hijau.
5. **Checkbox** hanya ada di halaman yang punya aksi massal di §6.9. Log Audit, Status Push, Stok Stiker, Laporan Serial, Country Lock, papan kanban Serah Terima, dan tab riwayat tanpa checkbox. Daftar Serial Number mendapat checkbox + "Ubah massal" (lokasi/item/BU) memakai `serials.updateBatch` dan dialog `bulk-edit-dialog` yang sudah ada, serta Hapus/Pulihkan massal (soft delete, keputusan 11).
6. **Penjaga usang pada batch** mengikuti rute tunggal model itu: model yang rute tunggalnya memakai CAS `updated_at`/ETag mengirim `updatedAt` per id; model yang rute tunggalnya tanpa penjaga versi (mis. hapus) tidak. Penjaga khusus (akun sendiri, super admin, jenis sistem, dll.) menolak SELURUH batch dengan pesan generik; baris yang statusnya sudah sama tetap bukan galat (idempoten) dan tidak menulis audit.
7. **Model yang hari ini diubah lewat dialog** (Merk, Customer, Lokasi, Role, Pengguna, Business Unit, Stiker, Jenis Stiker) tetap diubah lewat Form Dialog yang dibuka dari View dan dari daftar; tidak ada rute `…/$id/edit` baru. Model yang sudah punya halaman Ubah (Item, Postel, QR, Preset QR, Serah Terima) tetap memakai `FormPage`.
8. **Halaman detail yang sudah ada** (Item, Merk, BU, Postel, Serial, Serah Terima) dipindah ke `ViewPage` pada fase modulnya (Item dan Merk di fase 3, Postel di 4b, BU di 4c, Serial dan Serah Terima di 4d).
9. **Panduan interaktif**: langkah tur yang menyorot butir sidebar yang kini berada di submenu membuka submenu induknya lebih dulu, memakai mekanisme `langkah.buka` yang ada (diperluas bila perlu, tetap murni UI tanpa mengisi field atau memanggil rute tulis); target `data-tour` tetap dijaga tes katalog.
