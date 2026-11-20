# Redesain Tampilan Aplikasi Web: Sistem Desain dan Kit CRUD

Tanggal: 2026-11-20. Status: disetujui pemilik produk (2026-11-20), termasuk keputusan lanjutan §5 butir 13-23 dan jawaban perancang §8 (butir 10-19, ruling 2026-11-20).
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
- Setiap model punya halaman View (kecuali gambar Pustaka, butir 23); kolom unik dan kolom relasi di daftar menjadi tautan ke View.
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
- Warna yang pudar/tak terbaca di mode gelap (keputusan pemilik setelah mockup v2); pasangan teks/latar solid yang gagal WCAG AA 4,5:1 (butir 21).
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

1. **Setiap model punya halaman View** (bukan hanya model besar; gambar Pustaka dikecualikan, butir 23). Ini membalik keputusan 2026-11-10 (spek BU keputusan 24, CLAUDE.md bagian "Field relasi") bahwa model tanpa halaman lihat tidak punya tautan "Buka" dan tidak dibuatkan rute baru. Dicatat ulang di CLAUDE.md dan spek BU sebagai bagian fase yang menambah View; spek BU keputusan 24 sudah diberi catatan pengganti bertanggal 2026-11-20 (butir 18).
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

**Keputusan lanjutan pemilik (2026-11-20, atas inventaris fase 4):**

13. **Serial Number tanpa ubah massal**: daftar Serial tidak punya aksi "Ubah massal" (BU serial hanya berpindah lewat Cek ulang sejak rancangan serial unik se-sistem). Checkbox daftar Serial hanya untuk Hapus/Pulihkan massal; `serials.updateBatch` tidak dipakai UI daftar. Menggantikan §8 butir 5 bagian "Ubah massal".
14. **Serah Terima tanpa aksi massal**: tidak ada rute `handovers.removeBatch`/`restoreBatch` dan tidak ada tampilan daftar ber-checkbox. Hapus dan Pulihkan dilakukan per task dari halaman View task; task terhapus dilihat lewat filter "Terhapus" pada papan (tanpa checkbox). Alasan pemilik: aksi massal tidak dibutuhkan untuk kanban.
15. **Stiker `deprecated` boleh langsung dihapus** (syarat hapus stiker = bukan Aktif); `deprecated` tetap tidak dapat diaktifkan lagi, termasuk lewat batch status.
16. **Gambar Pustaka stiker tetap HAPUS PERMANEN** (tidak memakai soft delete) dan tetap DITOLAK bila masih dipakai penempatan item, seperti hari ini; tanpa Pulihkan. Batas 2.000 gambar tidak berubah. Rancangan soft delete diperbarui sesuai keputusan ini.

**Keputusan lanjutan pemilik (2026-11-20, atas audit spek; dijawab dan disetujui pemilik produk):**

17. **Lebar halaman**: View = `default` (ikut mockup, muat panel samping); form dan pengaturan = `narrow` (kecuali form QR Code dan Default QR = `default`, butir 26); daftar/grid = `default`; kanban dan tabel lebar = `full`; Country Lock = `default` (jalur tanpa cangkang: tanpa breadcrumb dan tanpa `PageContainer` dari `AppShell`). Nilai kelas: `narrow` = `max-w-4xl`, `default` = `max-w-7xl`, `full` = `max-w-none`. Alasan: View memuat panel samping, sedangkan form tetap nyaman dibaca.
18. **Baris "Tambah" di `LinkField` untuk SEMUA model yang dapat dibuat di UI**, termasuk Item (lewat Form Dialog), Role, Lokasi, dan Preset QR. Menggantikan spek BU keputusan 24 bagian "Tambah lokasi/role/preset dari form lain tidak dibuat" dan komentar `itemLinkAccess` "tanpa Tambah". Item baru dari dialog hanya dapat memilih BU yang boleh diedit pengguna (jadi langsung muncul di pilihan pemanggil). Lokasi kini punya View, sehingga `LinkField` lokasi pada penugasan pengguna dan `SerialLocationField` mendapat Buka bila berhak; `LocationField` (form tulis modul berlokasi) tetap tanpa Tambah/Buka.
19. **"Pilih semua" memilih SEMUA baris yang sudah dimuat; aksi massal dikirim BERTAHAP** per `BATCH_MAX` (100) id. Tiap tahap atomik di server; keseluruhan TIDAK atomik. Bila satu tahap gagal, tahap berikutnya tidak dikirim; toast "N dari M berhasil; sisanya gagal: <alasan>", id yang sudah berhasil dibuang dari pilihan, yang gagal/belum terkirim tetap terpilih, daftar dimuat ulang. Bila `NOT_FOUND` (id dihapus orang lain), daftar dimuat ulang dan id yang tak ada lagi dibuang dari pilihan. Kontrak server tetap atomik per permintaan (§6.9). Alasan: pengguna tidak perlu mengulang tiap 100 baris.
20. **Log Audit menaut ke View** entitasnya lewat kolom baru `audit_log.target_id` (expand-only); hanya entri baru tertaut, entri lama tetap teks.
21. **Kontras WCAG AA**: semua pasangan teks/latar solid WAJIB lolos 4,5:1. Diperluas ke soft, alert, `--card`, dan teks muted oleh butir 24. Nilai yang gagal digeser (§6.1); palet v3 TETAP dicatat sebagai acuan mockup yang disetujui, berdampingan dengan nilai akhir beserta alasannya; angka akhir ditentukan tes kontras.
22. **Tabel di ponsel (< 768 px)**: aksi baris diringkas menjadi satu tombol "⋯" berlabel (menu); checkbox tetap; tabel menggulir horizontal; kolom unik tetap terlihat.
23. **Gambar Pustaka dikecualikan dari "setiap model punya View"**: pratinjau dan daftar pemakai tetap di dialog (tanpa rute View).
24. **Kontras AA juga untuk soft dan alert** (2026-11-20, pemilik produk, atas review akhir fase 1): selain pasangan solid (butir 21), teks `-text` di atas latar halaman (`--background`), kartu (`--card`), latar soft badge (tint 15%) dan latar alert/banner (tint 10%), serta `muted-foreground` di atas `--muted`, WAJIB ≥ 4,5:1 di kedua mode. Nada `-text` yang gagal digelapkan/diterangkan; nilai akhir dicatat di §6.1 berdampingan dengan palet v3. Alasan: badge status dan banner adalah tampilan warna yang paling sering dibaca dan berteks kecil.
25. **Country Lock di dalam cangkang memakai breadcrumb dan lebar `default`** (2026-11-20, pemilik produk): bila pengguna sudah masuk, Country Lock dirender di dalam `AppShell` dan mendapat breadcrumb serta `PageContainer` seperti halaman lain; "tanpa breadcrumb/`PageContainer`" hanya berlaku untuk jalur tanpa cangkang (belum masuk). Menggantikan bagian Country Lock di butir 17 dan §6.4.
26. **Form QR Code dan Default QR memakai lebar `default`** (2026-11-20, pemilik produk): form itu berdampingan dengan pratinjau label, jadi dikecualikan dari "form = `narrow`" (butir 17). Form lain, termasuk Lapor Rusak (`/serial/report`), tetap `narrow`.
27. **Bar headroom tersembunyi tetap `inert`, tanpa "muncul saat fokus"** (2026-11-20, pemilik produk, atas review akhir fase 2 temuan I1): spek sebelumnya meminta `inert` sekaligus muncul kembali saat `focus-within`, padahal isi subpohon `inert` tak dapat difokus sehingga jalur fokus itu tak pernah terpicu di peramban. Diputuskan: bar tersembunyi `inert` dan HANYA muncul lagi lewat gulir naik; tidak ada pemunculan karena fokus. Konsekuensi yang diterima: selama bar tersembunyi, kolom cari/filter/tombol Tambah/judul halaman tak terjangkau keyboard dan pembaca layar sampai pengguna menggulir naik. Menggantikan kalimat `focus-within` di §6.5 dan §8 butir 11.
28. **Tab form di dialog menempel tepat di bawah header dialog** (2026-11-20, pemilik produk, atas review akhir fase 2 temuan M1): "offset 0" menimpa judul karena `DialogHeader` juga menempel di penggulir yang sama. Offset tab = tinggi header dialog (atau tab dirender di dalam header). Menggantikan "offset 0" di §6.7 dan §8 butir 15.

## 6. Rancangan

### 6.1 Token warna

Di `web/src/styles.css`, setiap warna semantik punya tiga token, didaftarkan di `@theme inline` agar tersedia sebagai utilitas Tailwind (`bg-success`, `text-success-foreground`, `text-success-text`, dst.):

- `--X`: latar solid.
- `--X-foreground`: teks di atas latar solid.
- `--X-text`: warna teks/ikon/garis di atas latar halaman (dipakai soft, outline, ghost, link, alert, toast, kolom kanban).

**Palet v3** (acuan mockup yang disetujui pemilik; dicatat apa adanya). Pasangan solid/foreground yang gagal AA 4,5:1 digeser di tabel "Nilai akhir" di bawahnya (butir 21).

| Warna | Terang: solid / fg / text | Gelap: solid / fg / text |
|---|---|---|
| primary | `#18181b` / `#fafafa` / `#18181b` | `#fafafa` / `#18181b` / `#fafafa` |
| secondary | `#71717a` / `#fff` / `#52525b` | `#52525b` / `#fafafa` / `#a1a1aa` |
| success | `#16a34a` / `#fff` / `#15803d` | `#16a34a` / `#fff` / `#22c55e` |
| warning | `#f59e0b` / `#1c1917` / `#b45309` | `#d97706` / `#fff` / `#f59e0b` |
| info | `#2563eb` / `#fff` / `#1d4ed8` | `#2563eb` / `#fff` / `#3b82f6` |
| destructive | `#dc2626` / `#fff` / `#b91c1c` | `#ef4444` / `#fff` / `#ef4444` |

**Nilai akhir (AA, keputusan pemilik 21).** Hanya token yang berubah dari palet v3; yang tidak tercantum tetap. Alasan: latar solid dengan teks `-foreground` di bawah 4,5:1, dan (keputusan 24) teks `-text`/muted di atas latar soft, alert, `--card`, atau `--muted` di bawah 4,5:1.

| Token | v3 | Nilai akhir | Alasan |
|---|---|---|---|
| success solid (terang) | `#16a34a` | `#15803d` | teks putih di `#16a34a` ±3,3:1 |
| success solid (gelap) | `#16a34a` | `#15803d` | sama |
| warning solid (gelap) | `#d97706` | `#b45309` | teks putih di `#d97706` ±3,2:1 |
| destructive solid (gelap) | `#ef4444` | `#dc2626` | teks putih di `#ef4444` ±3,8:1 |
| success-text (terang) | `#15803d` | `#166534` | keputusan 24: di atas tint soft 15% ±4,1:1 dan alert 10% ±4,4:1 |
| warning-text (terang) | `#b45309` | `#92400e` | keputusan 24: soft ±4,1:1, alert ±4,4:1 |
| muted-foreground (terang) | `oklch(0.556 0 0)` | `oklch(0.53 0 0)` | keputusan 24: di atas `--muted` ±4,35:1 |
| info-text (gelap) | `#3b82f6` | `#60a5fa` | keputusan 24: soft di atas `--card` ±4,1:1 |
| destructive-text (gelap) | `#ef4444` | `#f87171` | keputusan 24: soft di atas `--card` ±4,1:1 |

Angka di atas adalah acuan terkini; yang berwenang adalah tes kontras (`web/src/styles.contrast.test.ts`), yang menghitung setiap pasangan solid/foreground dan `-text` di atas `--background`/`--card`, latar soft (tint 15%) dan alert (tint 10%), serta `muted-foreground` di atas `--muted` pada tema terang dan gelap, dan boleh menggeser nilai lagi bila ada pasangan yang masih gagal (perubahan dicatat di tabel ini). Nilai boleh ditulis dalam `oklch` setara (gaya file saat ini) asalkan tampil sama dengan tabel yang berlaku (nilai akhir untuk token yang tercantum, v3 untuk sisanya). Token shadcn lama (`--primary`, `--secondary`, `--destructive`, `--muted`, dst.) tetap ada dan dipetakan ke nilai di atas; `--secondary` shadcn (latar abu muda untuk tombol sekunder lama) diganti maknanya menjadi abu-abu sesuai tabel, dan pemakai lama dimigrasi (§6.2). Sorotan komentar `::highlight(qc-comment)` tidak berubah.

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
- Aturan pemakaian: tabel/kartu/kanban = `compact`; View, header form, bar judul, bar aksi massal = ikon + label. Di layar < 768 px aksi baris tabel diringkas menjadi satu tombol "⋯" berlabel (§6.5, butir 22).
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

- **Breadcrumb** (`app/shell/app-breadcrumb.tsx`, komponen shadcn `breadcrumb`): disusun dari `useMatches()`; tiap rute menyatakan labelnya lewat `staticData.crumb` (teks tetap, mis. "Data Item") atau fungsi yang membaca data loader / cache query yang sudah ada (nama record di halaman View/Ubah) tanpa permintaan jaringan tambahan. Grup sidebar menjadi tingkat pertama tanpa tautan bila tidak punya halaman (mis. "Item › Daftar Item › Asus RT-AX55 › Ubah"). Di layar < 768 px hanya tingkat terakhir + tombol kembali ke tingkat sebelumnya. Setiap rute non-indeks (bukan tujuan butir nav) WAJIB punya `crumb`, termasuk `/serial/report`; `/` dan jalur tanpa cangkang (Country Lock, halaman publik, login) tanpa breadcrumb; header diuji pada lebar 360 px. Judul `h1` halaman memakai nama lengkap ("Daftar Serial Number", "Data Item"), dan `GuideBanner.pageLabel` memakai label induk bila label anak generik ("Daftar", "Laporan", "Pengaturan").

**Isi halaman**: `PageContainer` (`web/src/components/page/page-container.tsx`) dengan `width` (keputusan 17): `narrow` = `max-w-4xl` (form, pengaturan), `default` = `max-w-7xl` (View, daftar, grid, Country Lock), `full` = `max-w-none` (kanban, tabel yang memang lebar). Selalu `mx-auto` (rata tengah). `main` di `AppShell` tetap memberi padding; setiap rute membungkus isinya dengan `PageContainer` pada fase 1 (lewat `AppShell`; Country Lock berada di luar cangkang: tanpa breadcrumb dan tanpa `PageContainer` dari `AppShell`, halamannya memasang `PageContainer width="default"` sendiri). Tes yang menjaga bahwa setiap komponen halaman memakai salah satu kerangka §6.5-6.7 baru diaktifkan di akhir fase 4d (sebelumnya halaman pola lama sah).

### 6.5 Halaman indeks

Kerangka `ListPage` (`web/src/components/page/list-page.tsx`):

```
┌ Judul                          [aksi sekunder] [+ Tambah] ┐ ← bar "headroom"
│ [cari…] [Status: Aktif ✕] [+ Merk] [+ Business Unit] …   │
├──────────────────────────────────────────────────────────┤
│ isi: DataTable | KanbanBoard | GridView                   │
└ bar aksi massal (muncul bila ada pilihan)                 ┘
```

- **Bar headroom** (judul + aksi + filter): menempel di bawah header aplikasi; tersembunyi saat pengguna menggulir turun melewati ambang, muncul lagi begitu menggulir naik sedikit (≥ beberapa piksel), berbayang saat melayang. Elemen yang "mengikuti" (header tabel, tab form) memakai offset dari tinggi bar saat terlihat. Hook bersama `useHeadroom()` (`web/src/hooks/use-headroom.ts`) dipakai `ListPage` dan `FormPage`; menghormati `prefers-reduced-motion` (tanpa animasi). Bila halaman tidak cukup panjang untuk menggulir, bar diam. Saat tersembunyi bar diberi `inert` (tak dapat difokus) dan hanya muncul kembali lewat gulir naik; tidak ada pemunculan karena fokus (keputusan 27). Elemen yang di-scroll-ke (mis. target tur) memakai `scroll-margin-top` = tinggi header + bar headroom.
- **Filter**: komponen `FilterBar` dengan kolom cari + chip filter. Filter yang aktif tampil sebagai chip berisi nilai (+ tombol hapus); filter yang belum diisi tampil sebagai chip "+ Nama". Nilai filter tetap di search params Router (pola yang ada). Filter relasi memakai `LinkField`/`LinkMultiField` (di dalam popover chip), enum memakai `Select`/`MultiSelect`.

**DataTable** (`web/src/components/data-table/`):
- Header tabel `sticky`, offset mengikuti bar headroom.
- Kolom kiri: checkbox (bila halaman punya aksi massal), lalu kolom aksi (`ActionButton compact`; di layar < 768 px menu "⋯", lihat bawah). Checkbox baris memakai `aria-label` "Pilih <nama>"; tombol ikon-saja di layar sentuh tetap ber-`aria-label`. Tidak ada tombol "Lihat".
- Kolom unik (nama/kode/nomor record) = tautan ke View record itu; kolom relasi = tautan ke View model relasi. Tautan memakai warna `info-text`, garis bawah saat hover, dan komponen `Link` Router (klik tengah/Ctrl membuka tab baru). Tautan relasi hanya bila pengguna berhak membaca record tujuan (fungsi di `lib/link-access.ts`); bila tidak, teks biasa.
- Checkbox kepala = pilih SEMUA baris yang SUDAH dimuat (daftar infinite; keputusan 19); bar massal menyebut jumlah dan menyediakan aksi massal modul + "Batalkan pilihan". Pilihan dibuang saat filter berubah. Aksi massal dikirim bertahap per `BATCH_MAX` (§6.9).
- Baris kosong, galat muat, dan "Muat lebih banyak" seragam.
- Di layar < 768 px (keputusan 22) tabel menggulir horizontal; kolom unik tetap terlihat; aksi baris diringkas menjadi satu tombol "⋯" berlabel (menu berisi aksi lengkap); checkbox tetap; halaman yang sudah punya tampilan kartu ponsel (mis. staging Serial) mempertahankannya.

**KanbanBoard**: kolom dengan lebar minimum (±290 px) dan gulir horizontal bila tak muat; `ListPage` di atasnya (filter sama). Warna kolom (garis atas, latar tipis, garis kiri kartu) mengikuti warna badge nilai yang dikelompokkan (mis. status Serah Terima). Kartu memakai tautan ke View. Papan ponsel yang ada tetap. Mode `height="viewport"`: kolom menggulir sendiri (dengan `ScrollRootProvider`, kartu lazy, dan "Muat lebih banyak" per kolom) sementara bar headroom diam; tinggi dihitung dengan banner aplikasi yang sedang tampil. Chip "Terhapus" ada di bar filter desktop.

**GridView**: kisi kartu mengikuti `LibraryTab` Pustaka Gambar (kartu bergambar, nama, aksi `compact`, pencarian/urutan/filter di `FilterBar`). Pustaka Gambar menjadi pemakai pertama; `components/file-dialog` tetap memakai kisinya untuk dialog berkas. `GridView` mendukung `selection` opsional (checkbox kartu); kontrol cari/urut/filter Pustaka pindah ke `FilterBar` di halaman Pustaka, sedangkan dialog berkas tetap memakai kontrol lama.

### 6.6 Halaman View

Kerangka `ViewPage` (`web/src/components/page/view-page.tsx`): bar headroom berisi judul record + badge status + aksi (ikon + label: Ubah, Aktifkan/Nonaktifkan, Hapus, aksi modul), tab bila isi panjang (mis. Detail · Gambar · Riwayat), isi berupa daftar label–nilai (`dl`) per section, panel samping (≥ 1024 px; di bawah isi pada layar sempit) berisi "Dibuat" (hanya bila DTO punya `createdBy`/`createdAt`), "Diubah oleh … · kapan" (dari `updatedBy`/`updatedAt`), dan tautan ke data terkait tanpa angka hitungan (mis. "Lihat Serial Number item ini"); tab (mis. "Serial Number", "Riwayat") dan angka pada mockup hanya ilustrasi. Nilai relasi = tautan ke View-nya.

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

Halaman Ubah yang sudah ada (`…/$id/edit`) tetap; model yang hari ini diubah lewat dialog boleh tetap memakai Form Dialog dari View dan daftar. View Laporan Serial memakai halaman detail Serial yang ada (tab laporan). Log Audit dan Status Push hanya-baca tanpa View sendiri; entri audit BARU menaut ke View entitasnya lewat `audit_log.target_id` (keputusan 20; entri lama tetap teks). Gambar Pustaka dikecualikan dari View (keputusan 23): pratinjau dan daftar pemakai tetap di dialog. Setelah Hapus dari View: navigasi ke indeks induk + toast "Dihapus" (dengan aksi "Pulihkan" bagi pemegang izin).

Konsekuensi: `LinkField` "Buka" (`openHref`) tersedia untuk semua model di atas; fungsi izin baru di `lib/link-access.ts` (mis. `customerLinkAccess`, `userLinkAccess`, `roleLinkAccess`, `locationLinkAccess`, `qrDesignLinkAccess`, `qrPresetLinkAccess`), dan `stickerTypeLinkAccess`/`stickerLinkAccess` mendapat `openHref`. Lokasi kini punya View: `LinkField` lokasi pada penugasan pengguna dan `SerialLocationField` mendapat Buka bila berhak (`locationLinkAccess`); `LocationField` tetap tanpa Tambah/Buka (butir 18).

### 6.7 Form Edit dan Form Dialog

- Setiap model punya satu komponen form (`<Model>Form`) yang hanya berisi field + validasi + submit, tanpa kerangka halaman/dialog. Ia dibungkus:
  - `FormPage` (`web/src/components/page/form-page.tsx`): bar headroom berisi judul (+ badge status saat ubah) dan aksi (Batal, aksi tambahan, Simpan, ikon + label) menggantikan `FormHeader`; tab `sticky` di bawahnya; `PageContainer narrow`.
  - `FormDialog` (yang ada, `components/form-dialog.tsx`): header dan footer dialog; tab di dalam badan dialog bila form bertab.
  - Form yang hari ini ditulis dua kali (halaman dan dialog) disatukan.
- **Tab** (`FormTabs`): dipakai bila form punya ≥ 3 section atau lebih panjang dari satu layar; satu tab boleh berisi beberapa section (judul section + kisi 2 kolom di ≥ 768 px). Galat validasi di tab lain ditandai titik merah pada judul tab, dan submit yang gagal pindah ke tab pertama yang bergalat.
- **Field wajib**: label bertanda `*` merah (`text-destructive`) lewat prop `required` pada `Label` dan pada komponen field (`LinkField`, `LinkMultiField`, `Select`, `MultiSelect`, dan pembungkus input teks). Penanda dibaca pembaca layar sebagai "wajib" (`aria-required` pada kontrol; bintang `aria-hidden`).
- Bentuk field mengikuti mockup (latar `muted`, tanpa border tebal); fokus tetap memakai `ring`.
- `FormDialogShell` punya `size` (lebar dialog sesuai isi); tab form di dalam dialog menempel tepat di bawah header dialog yang juga menempel (offset = tinggi header dialog, bukan offset headroom halaman; keputusan 28); pada dialog bertumpuk (mis. "Tambah merk" dari form item) Escape menutup yang teratas saja.

### 6.8 LinkField: Tambah dan audit

- Fase 4 mengaudit semua field relasi di form dan filter tiap modul; yang belum memakai `LinkField`/`LinkMultiField` dipindah.
- Baris "Tambah {model}" (`onCreate`) tersedia untuk SEMUA model yang dapat dibuat di UI (keputusan 18): Item (lewat Form Dialog yang membungkus form yang sama, §6.7; BU yang dapat dipilih di dialog hanya yang boleh diedit pengguna, sehingga item baru langsung muncul di pilihan pemanggil), Role, Lokasi, Preset QR, dan model lain yang sudah punya dialog, bila pengguna berhak membuat; record baru langsung terpilih. Pengecualian yang tetap: `LocationField` (form tulis modul berlokasi: tanpa Tambah/Buka) dan model yang pembuatannya tidak ada di UI (mis. Customer dibuat otomatis lewat `CustomerCombobox`, yang tetap teks bebas). Tautan "Buka" tersedia untuk semua model ber-View, termasuk lokasi pada penugasan pengguna dan `SerialLocationField` bila berhak.

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
| Pustaka Gambar | `stickerGuides.removeBatch` (hapus permanen; seluruh batch ditolak bila satu gambar masih dipakai; keputusan 16) | Hapus |
| Serial Number | `serials.removeBatch`, `restoreBatch` (tanpa ubah massal; keputusan 13) | Hapus, Pulihkan |
| Serah Terima | Tidak ada (keputusan 14); `handovers.remove`/`restore` tunggal dari View task | Tidak ada aksi massal |

Kontrak bersama:
- Masukan: `IdBatchInput { ids }`, `StatusBatchInput { ids, status }`, dan `VersionedBatchInput { items: { id, updatedAt }[] }` (hanya untuk model yang rute tunggalnya CAS `updated_at`/ETag), maks. 100 id per permintaan (`BATCH_MAX`), id unik.
- **Atomik per permintaan** (klien mengirim bertahap, keputusan 19): semua perubahan dalam satu `batch()`/`transaction()` dengan penjaga CAS per baris; satu gagal = tak ada yang berubah. Kegagalan karena versi usang memakai `staleError` dan respons menyebut id yang usang agar UI dapat memuat ulang; record tak ditemukan/di luar hak = `NOT_FOUND` seragam untuk seluruh permintaan (tanpa membocorkan id mana yang ada).
- **Idempoten**: menyetel status yang sudah sama = tanpa perubahan dan bukan galat; menghapus record yang sudah terhapus = sukses tanpa audit baru (`deleted_at` asli tidak tertimpa); `NOT_FOUND` hanya untuk id tak dikenal atau di luar hak.
- **Aturan bisnis sama dengan rute tunggal**: logika per record dipanggil dari fungsi service yang sama (bukan disalin), termasuk penjaga khusus (jenis sistem stiker tak dapat dinonaktifkan, `guardLatest` Manual Book, hak per BU item pada SEMUA BU, akun sendiri, role yang masih dipakai, dll.; aturan hapus/pulihkan mengikuti rancangan soft delete §4.3 dan §5). Bila satu record melanggar, seluruh batch ditolak dengan pesan yang menyebut alasannya secara generik.
- Izin rute = izin rute tunggal yang setara; audit log per record seperti rute tunggal.
- UI: pilihan lebih dari `BATCH_MAX` dikirim bertahap lewat helper klien bersama (`runChunkedBatch`; keputusan 19): tiap tahap atomik, keseluruhan tidak. Setelah sukses, cache diperbarui dengan hasil server (`upsertInList`/`removeFromList`) dan toast "N item dinonaktifkan". Bila satu tahap gagal, tahap berikutnya tidak dikirim; toast "N dari M berhasil; sisanya gagal: <alasan>", id yang berhasil dibuang dari pilihan, yang gagal/belum terkirim tetap terpilih, daftar dimuat ulang; `NOT_FOUND` = daftar dimuat ulang dan id yang tak ada lagi dibuang dari pilihan. Saat `UNAVAILABLE` (luring) aksi massal = toast galat (tidak diantrekan), dan query daftar "Terhapus" tidak masuk whitelist `query-persist`.

### 6.10 Fase dan cakupan

| Fase | Isi | Selesai bila |
|---|---|---|
| 1. Fondasi | §6.1-6.4 (token, Button/Badge/Alert/toast, `ActionButton`, Tooltip, sidebar + popover + penyimpanan, breadcrumb, `PageContainer` dipasang di semua rute), `required` pada label | Semua halaman memakai token dan cangkang baru; pemetaan varian lama aktif; tes hijau |
| 2. Kit CRUD | `ListPage`, `useHeadroom`, `FilterBar`, `DataTable`, `KanbanBoard`, `GridView`, `ViewPage`, `FormPage`, `FormTabs`; Pustaka Gambar sebagai pemakai `GridView` | Komponen kit punya tes sendiri; satu halaman nyata (Pustaka Gambar) memakai kit |
| 2b. Infrastruktur soft delete | Kolom `deleted_at`, indeks unik baru (expand; contract di penutup 4d dalam PR yang sama), helper penyaring + tes penjaga, pola rute remove/restore, tampilan "Terhapus" (rancangan soft delete §4.6) | Tes penjaga aktif; belum ada modul yang memakai Hapus baru |
| 3. Percontohan | Item + Merk sepenuhnya di kit, termasuk batch status, tautan kolom, form bertab, Form Dialog "Tambah Merk"/"Tambah item" | Pola teruji di Item/Merk sebelum disebar (penilaian pemilik saat PR, keputusan 12) |
| 4a | Stiker (Katalog, Jenis, Stok, Konfigurasi) + View Stiker dan Jenis + batch | |
| 4b | Manual Book (QR, Default QR) + Postel + View QR dan Preset + batch | |
| 4c | Akses (Pengguna, Role, Lokasi, BU, Log Audit, Status Push) + Customer + View baru + batch | |
| 4d | Serial Number (Daftar, Laporan, Pengaturan, Catat) + Serah Terima (Kanban) + Country Lock + migrasi contract soft delete (task penutup; soft delete keputusan 11) | Pemetaan varian lama dihapus; tak ada halaman pola lama; indeks unik lama dibuang |

Tiap fase: rencana implementasi sendiri, commit di cabang yang sama (satu PR untuk semua fase, keputusan 12), catatan changelog (`server/changelog.d/`), dan pembaruan CLAUDE.md (struktur `components/page`, `data-table`, aturan View untuk semua model, aturan aksi massal) pada fase yang memperkenalkannya. Pembaruan itu juga MENYUNTING pernyataan CLAUDE.md, `docs/adding-a-module.md`, `docs/e2e-checklist*.md`, dan teks langkah panduan yang kini bertentangan (bukan hanya menambah); tes yang mencari tombol "Lihat" diubah (perubahan yang memang diminta spek). Panduan interaktif: target `data-tour` dipertahankan; langkah tur yang menyorot sidebar diperbarui (kosmetik) pada fase 1.

## 7. Diserahkan kepada pembangun

- Nama berkas/komponen di luar yang disebut di sini, susunan internal `DataTable` (pakai atau tanpa TanStack Table), dan ambang piksel headroom.
- Nilai `oklch` setara token (lebar `PageContainer` sudah ditetapkan di §6.4, keputusan 17).
- Pemetaan status→warna badge per modul, mengikuti makna di §6.2.
- Urutan tab dan pembagian section tiap form, mengikuti aturan §6.7.
- Rincian validator dan bentuk respons galat rute batch, dalam kontrak §6.9.

## 8. Jawaban atas review pembangun (keputusan perancang, 2026-11-20)

Pertanyaan dari pemeriksaan pembangun independen yang dijawab perancang tanpa mengubah apa yang diminta pemilik; pemilik dapat mengoreksinya saat menyetujui dokumen ini.

1. **Data View baru.** Sembilan model belum punya rute `get` per record (Customer, Stiker, Jenis Stiker, Pengguna, Role, Lokasi, Preset QR, Merk, Business Unit; Desain QR sudah punya `qrcodes.get`). `brands.get` ditambahkan di fase 3 (izin `item: view`, record terhapus hanya bagi `item: manage`). Fase yang menambah View-nya juga menambah rute `<model>.get` (kontrak, izin, tes REST) dengan izin = izin baca `list` yang setara dan DTO = DTO baris daftar yang sudah ada (tidak membuka data baru). Halaman View boleh menampilkan data dari cache daftar lebih dulu lalu memuat `get`; tautan yang dibuka langsung tetap bekerja. Record di luar hak = `NOT_FOUND`. Ini menambah lingkup server fase 4 dan termasuk dalam "Bukan sasaran" sebagai bagian dari View.
2. **Panel "data terkait"** di View hanya memakai data yang sudah ada di DTO (pembuat/terakhir diubah bila ada) dan tautan ke halaman daftar terfilter (mis. "Lihat Serial Number item ini" ke `/serial` dengan filter item), tanpa rute hitungan baru dan tanpa angka hitungan; "Dibuat" hanya bila DTO punya `createdBy`/`createdAt` (rincian di §6.6).
3. **Mockup** dikomit sebagai `docs/superpowers/specs/assets/2026-11-20-redesain-mockup-v3.html`.
4. **Tes kerangka halaman** baru aktif di akhir fase 4d (lihat §6.4); setiap PR fase tetap hijau. Pengecualian kerangka yang tercantum bernama di tes: tabel draft Catat Serial (+ kartu ponsel), riwayat/log dalam tab View (`DetailList`/tabel sederhana), dan Pustaka logo di halaman Default QR; tombol "Konfigurasi default" di halaman QR dipertahankan sebagai pintasan.
5. **Checkbox** hanya ada di halaman yang punya aksi massal di §6.9. Log Audit, Status Push, Stok Stiker, Laporan Serial, Country Lock, papan kanban Serah Terima, dan tab riwayat tanpa checkbox. Daftar Serial Number mendapat checkbox untuk Hapus/Pulihkan massal saja (soft delete, keputusan 11; "Ubah massal" dibatalkan oleh keputusan 13, 2026-11-20).
6. **Penjaga usang pada batch** mengikuti rute tunggal model itu: model yang rute tunggalnya memakai CAS `updated_at`/ETag memakai `VersionedBatchInput { items: { id, updatedAt }[] }`; model yang rute tunggalnya tanpa penjaga versi memakai `IdBatchInput { ids }` atau `StatusBatchInput { ids, status }`. Penjaga khusus (akun sendiri, super admin, jenis sistem, dll.) menolak SELURUH batch dengan pesan generik; baris yang statusnya sudah sama, atau yang sudah terhapus saat dihapus lagi, tetap bukan galat (idempoten) dan tidak menulis audit; `NOT_FOUND` hanya untuk id tak dikenal atau di luar hak.
7. **Model yang hari ini diubah lewat dialog** (Merk, Customer, Lokasi, Role, Pengguna, Business Unit, Stiker, Jenis Stiker) tetap diubah lewat Form Dialog yang dibuka dari View dan dari daftar; tidak ada rute `…/$id/edit` baru. Model yang sudah punya halaman Ubah (Item, Postel, QR, Preset QR, Serah Terima) tetap memakai `FormPage`.
8. **Halaman detail yang sudah ada** (Item, Merk, BU, Postel, Serial, Serah Terima) dipindah ke `ViewPage` pada fase modulnya (Item dan Merk di fase 3, Postel di 4b, BU di 4c, Serial dan Serah Terima di 4d).
9. **Panduan interaktif** (menggantikan rumusan awal "langkah tur yang menyorot butir sidebar membuka submenu induknya"; ruling perancang 2026-11-20): tidak ada langkah tur yang menyorot butir sidebar. Yang diperlukan: `ListPage`/`FormPage`/`LinkCell` meneruskan `data-tour` (target `qr-header`, `qr-new`, `serial-new`, `serial-open` yang pindah ke tautan kolom, `serial-row-actions`, `case-open`, `handover-card-actions`, dan tombol simpan `FormHeader`/`FormPage`); `GuideStep.buka` diperluas dengan `{ tab }` (murni UI, mengaktifkan tab form ber-`data-form-tab`) dan mesin tur memeriksa keterlihatan target; `scroll-margin-top` = tinggi header + bar headroom; `halamanKecuali` panduan diperluas untuk rute View baru (`/qrcode/$id`, `/qrcode/default*`, `/handover/$id`, dst.) pada fase modulnya. Tur tetap tidak mengisi field atau memanggil rute tulis; target `data-tour` dijaga tes katalog.

Putaran audit 2026-11-20 (keputusan perancang; pemilik dapat mengoreksi):

10. **Kanban viewport**: `KanbanBoard` punya mode `height="viewport"` (kolom menggulir sendiri dengan `ScrollRootProvider` + kartu lazy + `LoadMore` per kolom; bar headroom diam); chip "Terhapus" di bar filter desktop; tinggi diuji dengan banner tampil.
11. **Aksesibilitas**: bar headroom tersembunyi diberi `inert` dan hanya muncul lewat gulir naik (keputusan 27); checkbox baris `aria-label` "Pilih <nama>"; tombol ikon-saja di layar sentuh tetap `aria-label` (juga menu "⋯" di ponsel).
12. **Pustaka Gambar**: `GridView` mendukung `selection` opsional; kontrol cari/urut/filter Pustaka pindah ke `FilterBar` di halaman Pustaka (dialog berkas tetap kontrol lama).
13. **`FormHeader` dihapus** di penutup 4d bila tak ada pemakai (dijaga `page-frame.test.ts`).
14. **Breadcrumb**: setiap rute non-indeks punya `crumb` (termasuk `/serial/report`); `/` dan jalur tanpa cangkang tanpa breadcrumb (Country Lock di dalam cangkang MEMAKAI breadcrumb, keputusan 25); header diuji 360 px; `h1` = nama lengkap; `GuideBanner.pageLabel` memakai label induk bila label anak generik (§6.4).
15. **Dialog**: `FormDialogShell` punya `size`; tab sticky di dialog menempel tepat di bawah header dialog (keputusan 28); dialog bertumpuk: Escape menutup yang teratas saja.
16. **Luring**: aksi massal saat `UNAVAILABLE` = toast galat (tidak diantrekan); query daftar "Terhapus" tidak masuk whitelist `query-persist`.
17. **Setelah Hapus dari View**: navigasi ke indeks induk + toast "Dihapus" (dengan "Pulihkan" bagi pemegang izin).
18. **Dokumen per fase**: CLAUDE.md (menyunting pernyataan yang bertentangan, bukan hanya menambah), `docs/adding-a-module.md`, `docs/e2e-checklist*.md`, teks langkah panduan; tes yang mencari tombol "Lihat" diubah. PRD QR (FQR50) dan spek Serial (butir 41) diberi catatan "diubah redesain 2026-11-20".
19. **Lebar `PageContainer`**: `narrow` = `max-w-4xl`, `default` = `max-w-7xl`, `full` = `max-w-none` (spek menyebut nilai Tailwind ini, bukan px perkiraan; §6.4).
