# Revisi tampilan lanjutan, putaran 2 (rancangan)

Tanggal: 2026-11-22. Pemilik produk: Rahmad (semua keputusan di bawah disetujui atau diputuskan pemilik pada tanggal ini, kecuali yang ditandai "Tafsiran" = keputusan implementer/perancang yang perlu ditinjau pemilik). Lanjutan spek `2026-11-22-revisi-tampilan-lanjutan-design.md` (PR 153, sudah ter-merge); cabang kerja `claude/revisi-tampilan-lanjutan-2` dari `dev` terbaru.

Sumber: daftar perbaikan pemilik 2026-11-22 (sesudah PR 153) berikut lima gambar. Hasil riset kode per area ada di `.superpowers/sdd/2026-11-22-revisi-lanjutan-2/research-{serial,qr,filter,layout,mobile}.md` (tidak dikomit; ringkasannya ada di sini).

## 1. Keputusan pemilik (jawaban langsung, 2026-11-22)

| # | Pertanyaan | Keputusan |
|---|---|---|
| K1 | Semantik Tempel stiker | **+1 per stiker yang dicentang** (konsisten dengan stiker pada Cek ulang); tanpa isian jumlah. |
| K2 | Bulk Tempel stiker untuk serial berbeda Item/BU | **Kelompok per (Item, BU)**: satu bagian daftar centang per kelompok; kelompok tanpa centang dilewati. |
| K3 | Sidebar overlay 768-959 px, keadaan tertutup | **Tetap rel ikon 3 rem** (klausa rel spek B12 TIDAK dibalik); yang diperbaiki adalah ketidaksinkronan transisi (ikon/label/lebar berganti tidak serentak). |
| K4 | Lebar kolom konten View/form yang terpusat | **80 rem** (`max-w-7xl`, nilai `pageWidth: default` apa adanya); panel samping 18 rem menempel di tepi kanan `<main>`. |

## 2. Butir dan rancangan

### A. Serial Number
- **R1 Tempel stiker (detail dan bulk)**: aksi alur baru `apply_stickers` pada `serials.act` (`shared/serials.ts` `SERIAL_ACTIONS`, baris baru di AKHIR `SERIAL_FLOW`: dari `good`/`reported`/`recheck`, custody `qc`, status/posisi tetap, tanpa pesan wajib, modul `serial`), kejadian baru `stickers_applied` ("Stiker ditempel", kelompok riwayat "Perubahan data"; kolom `type` VARCHAR(32), tanpa migrasi). Efek = `stickerRaise` yang sama dengan cek ulang: +1 per centang, potong stok 1 di lokasi unit serial (stok boleh negatif), CAS `updated_at`, stiker `inactive` ditolak, stiker baru wajib ada di `applicableStickersOf(item, BU)`. Bulk: rute baru `serials.applyStickersBatch` (`POST /serials/batch/stickers`, didaftarkan sebelum `/serials/{id}`), `serial: edit`, atomik lewat `runRecordBatch` (maks. 100 id; satu gagal = semua batal, pesan galat menyebut nomor serialnya), body `{ clientId, occurredOn, message, rows: [{ id, stickerIds }] }`, idempoten lewat `serial_events.client_id = <clientId>:<serialId>`. Daftar: checkbox tersedia bagi pemegang `serial: edit` (bukan hanya `manage`), tombol "Tempel stiker" di `BulkBar` bila SEMUA baris terpilih dapat ditempeli (status/custody/BU), dialog mengelompokkan per (Item, BU) (maks. 10 kelompok per pengiriman; lebih dari itu = tombol nonaktif dengan alasan). Tanpa aksi per baris Tempel stiker (diminta bulk saja) dan tanpa Urungkan (stok tak dapat dibalik). Tafsiran: aksi hanya saat unit di QC (custody `qc`); stok dipotong di lokasi serial, tanpa pilihan lokasi.
- **R2 Lapor rusak di daftar**: `RowAction` `reportDamage` (sebelum Ubah) pada daftar Serial, tampil hanya bila `canReportDamage` dari data ringkasan (status `good` + custody `qc` + hak); membuka `ActDialog` `report` setelah memuat detail Serial (pola `editRow`).
- **R3 Semua aksi ke header**: hook bersama `use-serial-actions` menghasilkan `ViewAction[]` + dialog untuk detail Serial dan detail Laporan. Susunan: Lapor rusak (primer), Ubah data (primer), Tempel stiker (bukan primer), "Update" (entri bersubmenu: Kirim ke servis, Terima, Diagnosis, Cek ulang, Catatan), Hapus/Pulihkan. `ActButtons` di tab Riwayat dihapus; `ViewPage` mendapat prop `actionsTour` agar target panduan `serial-actions` pindah ke header (katalog: `buka: { tab: 'riwayat' }` dihapus dari dua langkah itu, teks diperbarui, versi panduan tidak naik). Detail Laporan: aksi hanya untuk laporan TERBUKA (Update ▾ dan Tempel stiker; tanpa Lapor rusak/Ubah data), memuat `SerialDto` induk saat dibutuhkan.
- **R4** Hapus tautan "Lihat semua laporan" dan "Buka Serial Number" di panel kanan detail Laporan (tautan serial di ringkasan tetap).
- **R5 Label "Lama"**: detail Laporan = "Durasi penanganan" (terbuka: "Berjalan N hari · di status ini M hari"; tertutup: "Selesai dalam N hari"), daftar Laporan = "Durasi" (isi terbuka "N hari di status ini"), panel pengiriman = "Lama di perjalanan" (selaras linimasa). Catat di spek laporan rusak (butir 10c) bahwa isi kolom daftar diperjelas, bukan diubah artinya.
- **R6 Riwayat tanpa tab**: `TimelineTabs` diganti kontrol tombol ghost bergaya header + `ChevronDown` yang membuka `DropdownMenu` radio; label tombol mengikuti pilihan ("Semua Riwayat", "Riwayat Pengecekan", "Riwayat Perubahan Data"); hitungan per opsi ada di butir menu; keadaan lokal (bukan search param); `data-tour="serial-timeline"` pindah ke baris tombol.

### B. QR Code Manual Book
- **R7 Ekspor massal**: tanpa rute server baru (render PDF/PNG/pratinjau ada di peramban; satu konfigurasi per permintaan). Hook baru `useBulkQrExport` + dialog `BulkExportDialog` (konfirmasi: jumlah per jenis, satu ALASAN bersama bila ada yang melahirkan versi baru, peringatan timpa; berjalan: status per baris dan "Berhenti setelah yang ini"; selesai: ringkasan). Berurutan satu per satu; lanjut walau satu gagal dan dilaporkan; berhenti penuh pada `UNAVAILABLE`; ulang sekali setelah galat basi; dibungkus `beginBusy` dan `useUnsavedChanges`. Tafsiran: konfigurasi "Sudah diekspor" (hash sama) DILEWATI sebagai "Sudah terbaru"; konfigurasi tak lengkap (nama kosong, tanpa item, overflow, terhapus) dilewati dan dilaporkan; maks. 50 konfigurasi per putaran; checkbox dan tombol Ekspor tersedia bagi `qrcode: edit` (Hapus tetap `manage`).

### C. Filter
- **R8 Tahan sampai tertutup**: mekanisme terpusat "draf di dalam chip, komit saat chip menutup" (`components/page/filter-draft.ts` + `FilterChip`): `MultiSelect`/`LinkMultiField`/kontrol tanggal/centang di dalam chip menyimpan perubahan lokal dan memanggil `onChange` halaman SEKALI saat chip menutup (Esc, klik luar, tombol kembali, seret turun, X). Kontrol satu pilihan tetap komit seketika (chip menutup sendiri). Tombol hapus chip dan kolom cari (debounce 350 ms) tidak berubah. Tafsiran: Esc/klik luar tetap MENERAPKAN draf; tombol chip menampilkan nilai lama sampai komit.
- **R9 Bug ponsel multi-value menutup sendiri**: akar = `deferNavigateUnderOverlays` menutup lembar bawah pada setiap `navigate` selama lembar terbuka; R8 menyelesaikannya karena tak ada `navigate` selagi lembar terbuka.

### D. Ponsel
- **R10** Menu aksi lebih lebar: `DropdownMenuContent` `w-max min-w-[max(trigger,8rem)] touch:min-w-56 max-w-[calc(100dvw-1rem)]` + `collisionPadding={8}`; `PopoverContent` "Aksi lainnya" di BulkBar `min-w-56`.
- **R11** Jarak kosong di bawah daftar saran combobox: spacer in-flow dihapus; ruang gulir dipasang di UJUNG kontainer gulir (`--list-room` di `<html>`, dipakai `<main>` dan penggulir dialog), daftar tetap `fixed` tepat di bawah input.
- **R12** Bar aksi massal ponsel SATU baris: [checkbox tri-state (semua / indeterminate / kosong)] [n dipilih] [jarak] [aksi]; klik saat semua terpilih = kosongkan, selain itu = pilih semua; tanpa tombol "Batalkan pilihan" (keluar lewat kosongkan, tombol/gestur kembali, Esc); >2 aksi = aksi pertama berlabel + ⋯; `Checkbox` indeterminate diperbaiki (ikon minus + isi kotak). Desktop tidak berubah. Bar Serial (`selection-bar.tsx`) cabang ponsel ikut. Tafsiran: teks saat 0 terpilih "Pilih item".
- **R13 Sidebar overlay (K3)**: tetap rel ikon, perbaiki sinkron transisi (implementer memilih mekanisme; arah yang direkomendasikan riset: di rentang overlay kontainer tetap selebar penuh dan keadaan tertutup digeser `translateX(calc(-100% + 3rem))` sehingga hanya `transform` yang beranimasi dan label terpotong, bukan disembunyikan seketika; elemen yang berganti diskret saat `data-collapsible` berubah harus ikut transisi atau tak berubah di rentang overlay). Wajib diverifikasi di peramban pada 768/820/959 px (buka/tutup berulang).

### E. Desktop
- **R14 Tabel**: `DataTable` desktop memakai pembungkus gulir DUA SUMBU berketinggian terbatas (`fit="viewport"` bawaan, rumus bersama `useViewportFit` dengan kanban; `fit="content"` bagi tabel di dalam View/Postel), header `sticky top-0` di dalamnya, kolom checkbox dan Aksi `sticky left` (offset hanya dari lebar kolom checkbox tetap), `border-separate border-spacing-0`, latar sel sticky opak, bayangan tepi saat tergulir, `role="region" tabIndex=0`; `SidebarInset` `overflow-x-clip` (jaring pengaman). Konsekuensi diterima (riset §A): pada daftar desktop gulir halaman digantikan gulir di dalam tabel dan bar judul selalu terlihat.
- **R15 Detail lebar penuh (K4)**: `PageContainer` selalu `w-full`; `PageContent` (`mx-auto` + `PAGE_WIDTH_CLASS`) memusatkan konten View/Form; `ViewPage`/`FormPage` bar judul + tab bleed penuh ke tepi `<main>` (varian `wide:`), `ViewPage` badan = grid [isi terpusat | aside 18 rem `border-l` menempel di tepi kanan, sticky, tinggi penuh], ambang dua kolom lewat container query pada pembungkus badan (JANGAN pada `<main>`/`FormPage`: ada turunan `position: fixed`); di sempit aside ditumpuk di bawah isi. `FormPage` ikut bleed + isi terpusat (tanpa aside). Tafsiran: judul/aksi di bar sejajar kolom isi terpusat.
- **R16 Index full width**: semantik `staticData.pageWidth` menjadi batas konten View/Form; halaman daftar, grid, dan kanban selalu selebar `<main>` (hapus `pageWidth: 'full'` di `/handover`); Beranda, `/desktop`, `/forbidden`, Country Lock dibungkus `PageContent`; `route-meta-coverage.test.ts` dipecah per jenis rute.

## 3. Di luar cakupan / tidak dikerjakan
- Aksi per baris Tempel stiker di daftar (hanya bulk, sesuai permintaan).
- Item gaya ERPNext pada panel kanan (Assign, Attachments, Tags, Share): panel tetap `ViewMeta` + log aktivitas.
- Kolom judul sticky kiri (hanya checkbox dan Aksi).
- Rute server batch untuk ekspor QR (tidak realistis, riset QR §2).
- Panduan interaktif baru untuk fitur baru: hanya memperbarui teks langkah `serial-actions`/`serial-timeline`/`serial-bulk` yang menyebut elemen yang berubah.

## 4. Verifikasi
- Server/shared: `bun run api:snapshot` (196 -> 197 rute), tes `shared/serial-flow`, `serials`, validator, `act-flow`, konkurensi `Promise.all` untuk batch stiker (aturan CLAUDE.md); fragmen changelog server dan desktop (perubahan `shared/` memicu keduanya).
- Web: tes per komponen yang berubah, `route-meta-coverage`, `scripts/page-frame`, `mobile-navigation-guard`, penjaga `scripts/*`.
- Peramban (wajib untuk R11, R13, R14, R15 yang tak terjangkau jsdom): 360/393, 704, 768/820/959, 1024, 1440 px; sidebar terbuka/terlipat/overlay; mode gelap.
- Tidak dapat diuji dari sini: gestur sentuh di perangkat nyata, papan ketik iOS, Electron.
