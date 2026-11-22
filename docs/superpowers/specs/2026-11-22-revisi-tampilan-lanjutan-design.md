# Revisi tampilan lanjutan (setelah redesain) — rancangan

Tanggal: 2026-11-22. Pemilik produk: pengguna sesi ini. Lanjutan `2026-11-20-redesain-tampilan-design.md` dan `2026-11-20-soft-delete-design.md` (PR #152 sudah di `dev`). Satu PR ke `dev`.

Peta kode per butir: `.superpowers/sdd/2026-11-22-revisi-tampilan-lanjutan/peta-kode.md` (git-ignored, arsip kerja). Nomor butir di bawah = nomor di peta itu.

## 1. Keputusan pemilik (2026-11-22)

1. Deploy: `deploy/deploy.sh` TIDAK diubah untuk menolak rollback otomatis setelah migrasi contract `0030`; cukup didokumentasikan (sudah di `docs/ci-cd.md`). Pemilik menyetujui ("biarkan").
2. Serial ganda lintas BU yang sama-sama TERHAPUS pada `deleted_at` yang sama dibiarkan dan diselesaikan manual oleh operator bila terjadi (skrip penyatuan mengabaikan serial terhapus). Pemilik menyetujui ("biarkan").
3. Daftar revisi UI di bawah dikerjakan dalam SATU PR.
4. Dialog dengan tinggi aktual > 50% tinggi layar ponsel 6 inci (393x852; ukur `getBoundingClientRect`, bukan estimasi CSS) dijadikan layar penuh seperti `FormDialog`; AlertDialog (konfirmasi hapus, peringatan, informasi) tetap dialog. DAFTARNYA ditunjukkan ke pemilik dan dikaji dulu SEBELUM dikerjakan (`survei-dialog.md`).

## 2. Ketetapan desain per butir

Keputusan yang ditandai **(konfirmasi)** adalah tafsiran yang diambil agar pekerjaan tidak berhenti; dicatat di laporan akhir untuk ditinjau.

### Lintas perangkat

- **B1 ikon chip filter**: ganti ikon `Plus` pada `FilterChip` yang belum terisi menjadi `ListFilter` (lucide). Tidak ada ikon "+" pada chip.
- **B2 filter tanpa popover bersarang**: chip untuk `Select`/`MultiSelect`/`LinkField`/`LinkMultiField` TIDAK lagi `Popover` yang membungkus combobox; chip itu sendiri adalah pemicu, dan satu-satunya lapisan terbuka berisi kolom cari + daftar opsi (di ponsel tetap lembar bawah bila ruang sempit, dengan `useBackToClose`). Chip yang isinya bukan combobox murni (Tanggal uji, Pencatat, Customer, Diunggah oleh saya/Belum dipakai, Stiker/Jenis dua kontrol) tetap berpopover. Popover itu dan daftar combobox WAJIB menutup dengan tombol kembali ponsel.
- **B2c filter di ponsel = lembar bawah** (tambahan pemilik 2026-11-22): di ponsel (< 768 px) menekan chip filter APA PUN (combobox maupun chip berisi kontrol lain) membuka lembar bawah berisi opsi/kontrolnya (kolom cari + daftar bagi combobox), bukan popover. Desktop tetap popover satu lapis.
- **B2d lembar bawah dapat dilebarkan dengan gestur** (tambahan pemilik 2026-11-22): semua lembar bawah (`Sheet side="bottom"`: lembar filter, Lokasi aktif, akun, notifikasi, dan mode `sheet` combobox) punya pegangan di atas; menyeret ke atas melebarkannya menjadi layar penuh (100dvh), menyeret ke bawah dari layar penuh mengembalikannya ke tinggi awal, dan menyeret ke bawah dari tinggi awal menutupnya. Tombol kembali ponsel tetap menutup (`useBackToClose`). Diterapkan sekali di `ui/sheet.tsx` (bukan per pemakai).
- **B2e filter Status konsisten**: halaman Serah Terima, daftar Serial, dan daftar Role memakai label chip "Tampilan" sedangkan halaman lain "Status"; semuanya diseragamkan menjadi chip **"Status"** dengan opsi yang sama polanya (model tanpa status aktif/nonaktif: Hidup/Terhapus lewat `liveStatusFilterOptions`; model berstatus: Semua status/Aktif/Nonaktif/(Terhapus) lewat `statusFilterOptions`), perilaku `display` bawaan (null = chip belum aktif) dan penempatan chip seragam. Filter status per kolom papan Serah Terima (Baru/Dikerjakan/…) tetap terpisah.
- **B2b filter multi-value** pada field yang mendukung: (a) semua filter klien-saja (merk, customer, jenis stiker, stiker `typeId`, QR, Postel `condition`, pengguna, role, lokasi, BU) langsung multi; (b) filter server ditambah field jamak OPSIONAL berdampingan dengan field tunggal lama (kompatibel mundur, tanpa id `@2`; field tunggal tetap diterima, bila keduanya dikirim yang jamak menang): items `brandIds`, `buIds`, `typeIds`; serials `buIds`, `itemIds`, `locationIds`, `statuses`, `custodies`; serialCases `buIds`; handovers.board `customerIds`; audit `actions`. Filter enum tetap tunggal (Status/Tampilan/Urut); Postel Kondisi multi-value, keputusan pemilik 2026-11-22 (filter klien-saja, `filterPostels` menerima daftar `conditions`). Batas jamak 20 nilai per field. **(konfirmasi: cakupan server)** Pengecualian (keputusan pemilik 2026-11-22, "skip"): filter Stiker/Jenis pada daftar Item TETAP satu pilihan karena pemilihnya mencampur stiker tunggal (`stickerId`) dan jenis (`typeId`); tidak dijadikan multi-value di UI, walau server menerima `typeIds`.
- **B3 log aktivitas** (panel kanan View): rute baca baru `activity.list` (`GET /activity`, query `kind`, `id`, `cursor`, `limit`) mengembalikan `ActivityEntryDto { id, ts, actor, action, changedFields? }` — TANPA nilai sebelum/sesudah (menghindari kebocoran lintas BU, mengikuti pola `postels.history`). Otorisasi per `kind` memakai pemuat rekaman yang sama dengan rute baca View model itu (tidak terbaca = `NOT_FOUND`); `kind` pengguna/role/lokasi/BU memakai `access: view`. Penyimpanan: `audit_log.target_id` + migrasi expand-only `0031_audit_target_id_index.sql` (indeks `(target_id, ts, id)`); entri lama (`target_id = ''`, sebelum 2026-11-20) tidak punya riwayat, dan panel menampilkan catatan "Riwayat sebelum 20 Nov 2026 tidak lengkap". Serial memakai `serial_events` (`serials.history`, sudah BU-gated) sebagai sumber log; QR memakai audit + `qrcodes.versions` tetap di tab Versi. Panel `ViewMeta` tetap menampilkan Dibuat/Diubah oleh di atas daftar log (10 terbaru + "Muat lebih banyak"). **(konfirmasi: nilai ubahan tidak ditampilkan)**
- **B4 jarak header–body View**: kurangi total ±56 px menjadi ±32 px: `HeadroomBar` `pb-3`→`pb-1`, `Tabs` `gap-2`→`gap-1`, `TabsList` `pb-2`→`pb-1`, `TabsContent` `pt-4`→`pt-3`; `gap-3` frame tetap 12 px (`FRAME_GAP_PX` kanban tidak berubah). Berlaku sama di `ListPage`/`FormPage` bila memuat bar yang sama.
- **B5 form QR**: tab `item` dan `sumber` digabung menjadi SATU tab dan satu section "Detail" (id tab `detail`, label "Detail"; isi: item Manual Book, preset, nama, lalu sumber link). Perubahan id tab menyentuh panduan (`catalog/qrcode.ts` `buka:{tab:'detail'}`), tes katalog, dan tes form; target `data-tour` `qr-items`, `qr-preset`, `qr-name`, `qr-source` tetap. Perubahan kosmetik: versi panduan tidak naik.
- **B5b aksi QR Code Manual Book** (pemilik 2026-11-22): penyebab tiga ikon unduh serupa = `ACTIONS.export` dan `ACTIONS.download` sama-sama memakai ikon `Download` (`action-button.tsx`), ditambah dua aksi Unduh PDF dan Unduh PNG. Ketetapan: (a) `ACTIONS.export` memakai ikon `CloudUpload` (ekspor = unggah ke folder Drive) sehingga berbeda dari unduh, DIGABUNG dengan label teks yang selalu tampak (keputusan pemilik: ikon + label khusus agar tidak membingungkan): di tabel desktop tombol Ekspor tidak ikon-saja tetapi ikon + teks "Ekspor"/"Ekspor ulang" (`RowAction.showLabel`), di View dan form QR `ActionButton action="export"` sudah berlabel; di menu ⋯ ponsel butir berikon + label singkat. (b) DESKTOP: Unduh PDF dan Unduh PNG digabung jadi SATU tombol "Unduh" (`ACTIONS.download`) yang membuka satu dropdown berisi "Unduh PDF" dan "Unduh PNG" (`RowAction.submenu` desktop; juga di View QR). (c) PONSEL: ikon Ekspor sama (`CloudUpload`; bila ikon dinilai tak sesuai, cukup teks tanpa ikon); Unduh PDF/PNG di menu ⋯ sebagai grup datar "Unduh" (tanpa submenu), label singkat "PDF" dan "PNG" di bawah label grup. Tombol Unduh hanya tampil bila sudah diekspor (seperti sekarang).
- **B6 tombol mengambang**: `Fab` 48→56 px (`size-14`), `ScrollToTop` 44→48 px (`size-12`) di ponsel; posisi `aboveFab` dan padding bawah halaman disesuaikan.
- **B7 detail laporan Serial**: rute REST `serialCases.get` (`GET /serial-cases/{id}`) mengembalikan `SerialCaseDetailDto` (baris laporan + `closedBy`/`closedByTeam` turunan event penutup + status Serial kini + ringkasan). Izin dan batas BU = `loadReadableSerialRow` serial induk (laporan serial terhapus = `NOT_FOUND`). Halaman `/serial/reports/$caseId` (`ViewPage`): ringkasan (nomor, Serial Number, item, BU, pelapor, dibuka, ditutup + penutup, hasil, status kini, lokasi) dan linimasa kejadian laporan itu (`serials.history` dengan `caseId`). Tab Riwayat di detail Serial: kejadian tanpa laporan tetap tampil seperti semula, kejadian milik satu laporan diringkas menjadi SATU kartu laporan (nomor, pelapor, status kini, selesai kapan dan oleh siapa) yang membuka halaman detail laporan. Daftar Laporan (`/serial/reports`) juga membuka detail laporan. **(konfirmasi: tafsiran "dipangkas jadi 1 kartu per laporan")**
- **B8 warna tab mode gelap**: `TabsList` memakai variabel CSS `--tabs-surface` (bawaan `var(--background)`); `DialogContent`/`SheetContent` menyetelnya ke `var(--popover)`.
- **B9 kartu diklik**: `DataTable`/`DataCards` menerima `rowTo(row)` (tujuan View) dan `MobileCard` menerima `onOpen`; klik badan kartu membuka View. Klik diabaikan bila target `closest('a,button,[role=checkbox],input,[aria-haspopup],[data-no-longpress],[data-no-open]')`, saat mode pilih (klik = ubah pilihan; `onClickCapture` `useLongPressSelect` menang), atau bila ada teks terseleksi. `role="link"`/tombol aksesibel tetap lewat tautan judul. `KanbanBoard`/`HandoverCard`: badan kartu kini membuka detail task, menggantikan keputusan lama "badan kartu tidak bisa diklik" (keputusan pemilik 2026-11-22); centang, komposer komentar, tombol footer, dan tautan tetap berfungsi mandiri. Kartu tanpa halaman View (draft Serial, Pustaka Gambar) tidak berubah.
- **B10 aksi stok**: kolom "Aksi stok" di Stiker dihapus; aksi stok (Catat masuk, Catat keluar, Koreksi, Riwayat) masuk ke kolom Aksi yang ada sebagai satu entri "Stok" bersubmenu (`RowAction.submenu`). Di DESKTOP: tombol "Stok" dengan satu dropdown. Di PONSEL (keputusan pemilik 2026-11-22): TANPA submenu; menu ⋯ yang sama menampilkan aksi stok sebagai GRUP (label grup "Stok" + butir datar berlabel singkat Catat masuk, Catat keluar, Koreksi, Riwayat, dipisah pemisah). `RowAction.submenu` karena itu dirender sebagai grup datar di ponsel.
- **Aturan lintas butir (pemilik 2026-11-22): di ponsel tidak boleh ada popover/dropdown bersarang.** Menu aksi memakai grup datar (bukan submenu), chip filter membuka lembar bawah (bukan popover yang memuat combobox), dan daftar combobox di dalam lembar/dialog dirender di tempat (bukan lapisan melayang kedua) bila ruang memungkinkan. Pengguna yang hanya berizin stok (tanpa katalog) tetap mendapat kolom Aksi berisi entri Stok.
- **B11 sidebar**: hanya induk yang memuat rute aktif yang terbuka; `expanded` tidak lagi disimpan dan dikosongkan pada tiap perubahan rute; mengetuk induk lain membukanya sementara.
- **B12 batas ~830 px** (disetujui pemilik 2026-11-22: "pada viewport >= 768 hingga < 960 tampilan desktop untuk komponen di dalam main; sidebar menjadi overlay"): mode desktop vs ponsel konsisten menurut viewport: pada 768–959 px sidebar yang dibuka menjadi OVERLAY (melayang di atas isi, tidak mendorong), spacer isi tetap selebar rel ikon 3 rem, sehingga lebar `<main>` ≥ 704 untuk viewport ≥ 768 dan `useIsDesktop` tidak lagi berbalik saat sidebar dibuka/ditutup. Di bawah 768 px tidak berubah (Sheet). Tes `layout`/`use-is-desktop`/`app-sidebar*` disesuaikan.

### Khusus ponsel (viewport < 768 px; tidak memengaruhi desktop)

- **P1 tombol mengambang diperbesar** (lihat B6).
- **P2 bar aksi bawah**: `StickyActionBar` berposisi `fixed inset-x-0 bottom-[var(--kb,0px)]` selebar layar; halaman berbar memberi padding bawah setinggi bar (`pb` mengikuti variabel `--action-bar-h` yang diukur bar itu). Tombol utama (mis. "Ubah") berwarna primary solid (prop baru `ActionButton emphasis="primary"`). Judul ganda dihapus: `<h1>` `ListPage`/`ViewPage`/`FormPage` menjadi `sr-only` di ponsel (judul navbar yang tampak) dan `FormPage` ponsel tanpa bar atas ←/judul (kembali = tombol sistem). **(konfirmasi: gambar 1 tidak dapat saya lihat; tafsiran: navbar satu-satunya judul tampak)**
- **P3 Daftar Data Item**: judul kartu = Tipe (kolom `model` `mobile: 'title'`; merk jadi meta berlabel).
- **P4 label aksi per kartu**: `RowAction.shortLabel` (Ubah, Pilih, Hapus, Aktifkan, Nonaktifkan, Pulihkan, Kloning, Ekspor, Unduh PDF, Unduh PNG, Lihat); menu ponsel memakai `shortLabel`; aria-label desktop tetap panjang.
- **P5 mode pilih**: satu bar bawah (`BulkBar` ponsel) memuat: "Batalkan pilihan", "N dipilih", "Pilih semua", lalu aksi; `SelectionBar` atas dihilangkan di ponsel untuk `DataCards`/`GridView`. Keadaan mode pilih dibagi lewat konteks yang diisi `useLongPressSelect` (fokus awal ke tombol batal dipertahankan).
- **P6 dialog**: lihat keputusan 1.4 dan `survei-dialog.md`.
- **P6 dialog layar penuh (DISETUJUI pemilik 2026-11-22: nomor 1–8 dan 10 menjadi layar penuh di ponsel, nomor 9 tetap dialog; hasil ukur aktual viewport 393x852, ambang > 50% = > 426 px; rincian `survei-dialog.md`)**:

  | # | Dialog | Berkas | Tinggi | % | Rekomendasi |
  |---|---|---|---|---|---|
  | 1 | Panduan | `modules/guide/components/guide-menu-dialog.tsx` | 820 px | 96% | Layar penuh |
  | 2 | Ubah data serial | `modules/serial/components/edit-serial-dialog.tsx` | 797 px | 94% | Layar penuh |
  | 3 | Ubah baris (Catat Serial) | `row-edit-dialog.tsx` | 820 px | 96% | Layar penuh |
  | 4 | Ubah massal (Catat Serial) | `bulk-edit-dialog.tsx` | 820 px | 96% | Layar penuh |
  | 5 | Update Serial, aksi Cek ulang | `act-dialog.tsx` | 820 px | 96% | Layar penuh |
  | 6 | Update Serial, aksi Lapor rusak | `act-dialog.tsx` | 673 px | 79% | Ikut #5 (satu komponen) |
  | 7 | Update Serial, aksi Tambah catatan | `act-dialog.tsx` | 653 px | 77% | Ikut #5 |
  | 8 | Pratinjau lembar QR | `modules/qrcode/components/sheet-preview-dialog.tsx` | 671 px (zoom 100%); 442 px (50%); 809 px (maks) | 79% | Layar penuh |
  | 9 | Zoom pratinjau label QR | `modules/qrcode/components/label-preview.tsx` | 473 px | 56% | Opsional (dibiarkan) |
  | 10 | Catat Serial Country Lock | `modules/countrylock/components/record-dialog.tsx` | 820 px (dari kode; tak dapat dibuka di peramban) | 96% | Layar penuh |

  Tambahan pemilik 2026-11-22: **Riwayat stok stiker** (`modules/sticker/components/stock-history.tsx`, 22–35% untuk 1–4 baris) JUGA menjadi layar penuh di ponsel, dan isinya di ponsel dirender sebagai kartu riwayat (`MobileCard`: waktu + jenis entri sebagai judul/badge, selisih, stok sesudah, lokasi, pelaku, alasan sebagai meta berlabel) agar konsisten dengan daftar kartu lain; tabel tetap di desktop. Dialog yang tidak terukur (CopyMarksDialog, PreviewDialog, ProofGallery, ExportDialog, ApplyPresetDialog, ExportChangeWarning, InjectProgress, CredentialDialog, dan dialog teks pendek) DIABAIKAN atas keputusan pemilik ("tampilan desktop app"): tidak diubah. Aksi `ActDialog` selain Cek ulang/Lapor rusak/Catatan ikut layar penuh karena komponennya sama.

  Sudah layar penuh (tak diubah): Catat masuk/keluar/Koreksi stok, form Tambah/Ubah Item, Merk, Customer, BU, FileDialog. Di bawah 50% (tetap dialog): Kloning ke BU lain 45%, Lembar Lokasi aktif 46%, Lembar Akun 40%, Notifikasi push 39%, Batalkan task 29%, Kosongkan draft 27%, Riwayat stok 22–35% (1–4 baris; lewat 50% di sekitar 8 baris). Tak terukur (data seed tak ada / hanya desktop): aksi Update Serial lain, CopyMarksDialog (39–61% dari kode), PreviewDialog dan ProofGallery (maks. 90dvh), ExportDialog, ApplyPresetDialog, ExportChangeWarning, InjectProgress (48–52%), CredentialDialog, dan dialog teks pendek. AlertDialog (konfirmasi hapus, peringatan, informasi) tetap dialog.

- **P7 aksi View Serial** (diperjelas pemilik 2026-11-22: Lapor Rusak = action button di sebelah tombol Ubah, di semua ukuran layar): "Lapor Rusak" menjadi `ActionButton` (jenis baru `reportDamage` di `ACTIONS`) berdampingan dengan "Ubah" pada `ViewPage actionItems`; desktop = dua tombol di bar judul, ponsel = bar bawah [Lapor Rusak] [Ubah] [Lainnya]. "Lainnya" memuat aksi alur sisanya (Kirim ke servis, Terima, Diagnosis, Cek ulang, Catatan) dan Hapus/Pulihkan. Lapor Rusak hanya bila diizinkan tabel transisi (`report_failure`); bila tidak, hanya [Ubah] [Lainnya]. Tombol Lapor rusak tidak diduplikasi di `ActButtons` tab Riwayat. Target tur `serial-actions` dipertahankan pada daftar aksi (panduan diperbarui bila target pindah).
- **P8** "Aplikasi Desktop" dan "Country Lock" disembunyikan dari sidebar/peluncur di ponsel (`NavItem.hideOnPhone`, gerbang `useIsMobile`); rute tetap dapat dibuka lewat URL.
- **P9** popover notifikasi menjadi lembar bawah (`Sheet side="bottom"`) di ponsel; membuka butir lewat `runAfterOverlays`.

### Khusus desktop

- **D1 bar aksi massal** dirender DI ATAS tabel (di bawah bar judul, sebelum header tabel) dengan urutan: tombol "Batalkan pilihan", jumlah dipilih, spacer, tombol aksi; ikut terukur dalam `--headroom-offset` agar header tabel sticky tetap benar.
- **D2 lebar minimum kolom Kanban** 290→340 px (tes dan dokumentasi ikut).

## 3. Penutupan keputusan lama

- Spek soft delete dan spek Serial unik se-sistem: catat keputusan 2026-11-22 butir 1–2 (menutup pertanyaan terbuka/risikonya).
- `docs/ci-cd.md` sudah memuat catatan rollback otomatis; tambahkan rujukan keputusan pemilik 2026-11-22.
- CLAUDE.md akar diperbarui untuk: kit (Fab/ScrollToTop, StickyActionBar fixed ponsel, BulkBar desktop di atas, `rowTo`, `RowAction.shortLabel/submenu`, FilterChip tanpa popover bersarang), rute `activity.list`, `serialCases.get`, batas 768–959, serta keputusan kartu Kanban diklik.

## 4. Pengujian dan rilis

- Server: tes REST `activity.list`, `serialCases.get`, filter jamak; potret kontrak `bun run api:snapshot`.
- Web: tes kit/halaman yang terdampak diperbarui (peta kode memuat daftarnya); penjaga `scripts/*` hijau.
- Fragmen changelog `server/changelog.d/20261122-revisi-tampilan-lanjutan.md` (dan desktop bila tersentuh).
- Review independen + `security-audit` terfokus pada `activity.list`, `serialCases.get`, dan filter jamak.

## 5. Status implementasi dan tafsiran implementer (dicatat 2026-11-22)

Seluruh butir sudah diimplementasikan dan dikomit di cabang `claude/revisi-tampilan-lanjutan` (belum di-push/merge): tahap 1 `e867085e`..`aa9beade` (B4, B6, B8, B9, B11, B12, D1, D2, P1, P2, P4, P5, P8, B10 kit), tahap 2 `2ab3ac60`..`363bca9a` (B1, B2, B2c, B2d, B2e, B5, B5b, P3, P7, P9, B10), tahap 3 `f053c630`..`3623507d` (perbaikan temuan review tahap 1 dan filter jamak di UI), server `48c94215`, `a2be1b22`, `0b1320ef` (B3, B7, B2b server), dialog `39600e33`, `dc7fe13d` (P6), tampilan `af7cfe18`, `ac21c28c` (B3, B7 web). Belum ada uji di perangkat/peramban nyata (gestur sentuh, seret lembar, dialog layar penuh, overlay sidebar hanya diuji jsdom).

| Butir | Status |
|---|---|
| B1, B2, B2c, B2d | Diimplementasikan |
| B2b | Sebagian diimplementasikan: server menyediakan semua field jamak (items `brandIds`/`buIds`/`typeIds`, serials, serialCases, handovers.board, audit); UI memakainya di Item (merk, BU), Serial, Laporan (BU), papan Serah Terima (customer), Log Audit (aksi), Jenis stiker, dan Postel (kondisi). Filter Stiker/Jenis pada daftar Item TETAP satu pilihan (diputuskan pemilik 2026-11-22, lihat butir 6). Filter klien-saja pada halaman yang belum punya chip jamak belum dikerjakan |
| B2e | Diimplementasikan (Serial menggabungkan Terhapus ke chip Status atas keputusan pemilik 2026-11-22) |
| B3 | Diimplementasikan |
| B4, B5, B5b, B6, B8, B9, B10, B11, B12 | Diimplementasikan |
| B7 | Diimplementasikan |
| P1 sampai P9, D1, D2 | Diimplementasikan |

Tafsiran implementer yang perlu ditinjau pemilik (tidak mengubah keputusan pemilik di bagian 1 dan 2):

1. **B5**: "satu section Detail" diimplementasikan sebagai satu TAB "Detail" yang tetap memuat section-section lama (judul section dipertahankan karena menjadi target `data-tour`).
2. **B2**: memilih satu nilai pada chip combobox kini menutup chip (sebelumnya popover tetap terbuka); mode jamak tetap terbuka. Mode `sheet` combobox (daftar `fixed` dekat papan ketik) bukan `ui/sheet`, jadi tidak punya pegangan seret.
3. **B3**: log tanpa nilai; catatan "Riwayat sebelum 20 Nov 2026 tidak lengkap" tampil kecuali `createdAt` record >= 20 Nov 2026 WIB (DTO tanpa `createdAt` selalu menampilkannya); tab Riwayat Postel (selisih nilai) dipertahankan; log Serial = 10 entri terbaru `serials.history` dengan tautan ke tab Riwayat.
4. **B7**: tab Pengecekan dan Perubahan data di detail Serial tetap per kejadian (hanya tab Semua meringkas kartu laporan); pelapor dan penutup pada kartu diturunkan dari kejadian yang sudah termuat (kartu menulis "Pelapor ada di riwayat yang lebih lama" bila halaman lama belum dimuat) agar tak ada N+1 `serialCases.get`; `?case=` dialihkan ke halaman detail laporan.
5. **P2/D1**: `FormPage` ponsel tanpa `badge` tidak lagi memuat bar atas kosong (judul `sr-only` dan target tur dipertahankan); bar aksi massal desktop menahan headroom selama ada pilihan; mode pilih 0 butir (lewat tombol "Pilih") menampilkan bar bawah penuh.
6. **B2b item (DITUTUP, keputusan pemilik 2026-11-22)**: filter Stiker/Jenis pada daftar Item tetap satu pilihan dan tidak dijadikan jamak, karena pilihannya mencampur stiker tunggal (`stickerId`, tak boleh bersama `typeIds`) dan jenis. Pemilik memutuskan skip; bukan pertanyaan terbuka. Field server `typeIds` tetap tersedia.
7. **B12**: di rentang 768-959 px sidebar mulai tertutup dan buka/tutupnya tidak menulis pilihan tersimpan layar lebar; `useIsDesktop` menambahkan lebar scrollbar halaman klasik ke lebar `<main>` agar invarian >= 704 pada viewport 768 terjaga.
8. **P8**: `hideOnPhone` tidak berlaku di aplikasi desktop (Electron) berjendela sempit.
9. **P6**: gerbang layar penuh dialog memakai CSS `max-md:` (bukan JS), sama dengan `FormDialogContent`; hasil ukur 393x852 dari survei; dialog tak terukur dan `AlertDialog` tidak diubah.
10. **B2b server**: field jamak dikirim sebagai daftar dipisah koma, maks. 20 nilai, jamak menang atas tunggal, hanya menyempitkan hak baca; `typeIds` ditolak bersama `stickerId`.
