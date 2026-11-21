# Redesain Tampilan Aplikasi Web: Sistem Desain dan Kit CRUD

Tanggal: 2026-11-20. Status: disetujui pemilik produk (2026-11-20), termasuk keputusan lanjutan §5 butir 13-23 dan jawaban perancang §8 (butir 10-19, ruling 2026-11-20). Disesuaikan 2026-11-21 setelah merge `origin/dev` ke cabang redesain: butir 30-32 (halaman Stiker dan Stok digabung, `FileDialog` wajib untuk lampiran, kebijakan versi API) beserta penyuntingan §3, §6.4, §6.6, §6.7, §6.9, §6.10, dan §8 butir 5; pertanyaan terbuka §9 dijawab pemilik 2026-11-21 (butir 33-36); keputusan ramah ponsel 2026-11-21 (butir 37, dilengkapi butir 38: jangkauan jempol, pilih tahan-lama, keyboard layar; prototipe disetujui pemilik) menyunting butir 22, §6.5, §6.6, §6.7, §6.10 dan menambah §6.11.
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
- Kebijakan versi API (CLAUDE.md, `shared/api-versions.ts`, `shared/api-snapshot.ts`; butir 32; disesuaikan 2026-11-21 setelah merge `origin/dev`): kontrak selalu kompatibel mundur. Redesain hanya MENAMBAH id rute dan kunci query/field DTO opsional; id, verb, path, dan kunci query yang sudah ada tidak dihapus atau diubah. Potret `shared/api-contract.snapshot.json` tidak diperbarui di redesain ini (hanya lewat `bun run api:snapshot` oleh rilis).
- Lampiran berkas memakai `FileDialog` terpadu (CLAUDE.md "Lampiran berkas wajib `FileDialog`", spek `2026-11-20-dialog-unggah-seragam-design.md`; butir 31; disesuaikan 2026-11-21): halaman dan form yang dibangun atau dipindah ke kit tidak membuat `<input type="file">` baru dan menahan Simpan selama unggahan latar berjalan atau gagal.
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

17. **Lebar halaman**: View = `default` (ikut mockup, muat panel samping); form dan pengaturan = `narrow` (kecuali form QR Code dan Default QR = `default`, butir 26); daftar/grid = `default`; kanban dan tabel lebar = `full`; Country Lock = `default` (di dalam cangkang bila sudah masuk, dengan breadcrumb dan `PageContainer` dari `AppShell`, butir 25; hanya jalur belum masuk tanpa cangkang yang tanpa breadcrumb; disesuaikan 2026-11-21). Nilai kelas: `narrow` = `max-w-4xl`, `default` = `max-w-7xl`, `full` = `max-w-none`. Alasan: View memuat panel samping, sedangkan form tetap nyaman dibaca.
18. **Baris "Tambah" di `LinkField` untuk SEMUA model yang dapat dibuat di UI**, termasuk Item (lewat Form Dialog), Role, Lokasi, dan Preset QR. Menggantikan spek BU keputusan 24 bagian "Tambah lokasi/role/preset dari form lain tidak dibuat" dan komentar `itemLinkAccess` "tanpa Tambah". Item baru dari dialog hanya dapat memilih BU yang boleh diedit pengguna (jadi langsung muncul di pilihan pemanggil); pengecualian: pemilih Item modul Serial Number memakai IRISAN BU `item: edit` dan `serial: edit` (butir 29). Lokasi kini punya View, sehingga `LinkField` lokasi pada penugasan pengguna dan `SerialLocationField` mendapat Buka bila berhak; `LocationField` (form tulis modul berlokasi) tetap tanpa Tambah/Buka.
19. **"Pilih semua" memilih SEMUA baris yang sudah dimuat; aksi massal dikirim BERTAHAP** per `BATCH_MAX` (100) id. Tiap tahap atomik di server; keseluruhan TIDAK atomik. Bila satu tahap gagal, tahap berikutnya tidak dikirim; toast "N dari M berhasil; sisanya gagal: <alasan>", id yang sudah berhasil dibuang dari pilihan, yang gagal/belum terkirim tetap terpilih, daftar dimuat ulang. Bila `NOT_FOUND` (id dihapus orang lain), daftar dimuat ulang dan id yang tak ada lagi dibuang dari pilihan. Kontrak server tetap atomik per permintaan (§6.9). Alasan: pengguna tidak perlu mengulang tiap 100 baris.
20. **Log Audit menaut ke View** entitasnya lewat kolom baru `audit_log.target_id` (expand-only); hanya entri baru tertaut, entri lama tetap teks.
21. **Kontras WCAG AA**: semua pasangan teks/latar solid WAJIB lolos 4,5:1. Diperluas ke soft, alert, `--card`, dan teks muted oleh butir 24. Nilai yang gagal digeser (§6.1); palet v3 TETAP dicatat sebagai acuan mockup yang disetujui, berdampingan dengan nilai akhir beserta alasannya; angka akhir ditentukan tes kontras.
22. **Tabel di ponsel (< 768 px)** (disunting 2026-11-21 oleh butir 37; semula "tabel menggulir horizontal"): daftar data tampil sebagai KARTU BERTUMPUK, bukan tabel gulir horizontal; judul/tautan di atas, field penting berlabel, status sebagai badge, aksi lewat satu tombol "⋯" berlabel (menu), checkbox di pojok kartu. Tabel penuh tetap di >= 768 px.
23. **Gambar Pustaka dikecualikan dari "setiap model punya View"**: pratinjau dan daftar pemakai tetap di dialog (tanpa rute View).
24. **Kontras AA juga untuk soft dan alert** (2026-11-20, pemilik produk, atas review akhir fase 1): selain pasangan solid (butir 21), teks `-text` di atas latar halaman (`--background`), kartu (`--card`), latar soft badge (tint 15%) dan latar alert/banner (tint 10%), serta `muted-foreground` di atas `--muted`, WAJIB ≥ 4,5:1 di kedua mode. Nada `-text` yang gagal digelapkan/diterangkan; nilai akhir dicatat di §6.1 berdampingan dengan palet v3. Alasan: badge status dan banner adalah tampilan warna yang paling sering dibaca dan berteks kecil.
25. **Country Lock di dalam cangkang memakai breadcrumb dan lebar `default`** (2026-11-20, pemilik produk): bila pengguna sudah masuk, Country Lock dirender di dalam `AppShell` dan mendapat breadcrumb serta `PageContainer` seperti halaman lain; "tanpa breadcrumb/`PageContainer`" hanya berlaku untuk jalur tanpa cangkang (belum masuk). Menggantikan bagian Country Lock di butir 17 dan §6.4.
26. **Form QR Code dan Default QR memakai lebar `default`** (2026-11-20, pemilik produk): form itu berdampingan dengan pratinjau label, jadi dikecualikan dari "form = `narrow`" (butir 17). Form lain, termasuk Lapor Rusak (`/serial/report`), tetap `narrow`.
27. **Bar headroom tersembunyi tetap `inert`, tanpa "muncul saat fokus"** (2026-11-20, pemilik produk, atas review akhir fase 2 temuan I1): spek sebelumnya meminta `inert` sekaligus muncul kembali saat `focus-within`, padahal isi subpohon `inert` tak dapat difokus sehingga jalur fokus itu tak pernah terpicu di peramban. Diputuskan: bar tersembunyi `inert` dan HANYA muncul lagi lewat gulir naik; tidak ada pemunculan karena fokus. Konsekuensi yang diterima: selama bar tersembunyi, kolom cari/filter/tombol Tambah/judul halaman tak terjangkau keyboard dan pembaca layar sampai pengguna menggulir naik. Menggantikan kalimat `focus-within` di §6.5 dan §8 butir 11.
28. **Tab form di dialog menempel tepat di bawah header dialog** (2026-11-20, pemilik produk, atas review akhir fase 2 temuan M1): "offset 0" menimpa judul karena `DialogHeader` juga menempel di penggulir yang sama. Offset tab = tinggi header dialog (atau tab dirender di dalam header). Menggantikan "offset 0" di §6.7 dan §8 butir 15.
29. **Pemilih Item di form Serial Number mendapat baris "Tambah item" dengan BU dialog = irisan BU tempat pengguna memegang `item: edit` DAN `serial: edit`** (2026-11-20, pemilik produk, atas review akhir fase 3 temuan I4): berlaku untuk Catat/Default, Ubah baris, Ubah massal (dan Lapor Rusak, yang memakai komponen yang sama); BU terhapus dan nonaktif tidak ditawarkan; irisan kosong = baris Tambah disembunyikan; baris Cek ulang (item terkunci) tetap tanpa Tambah, sedangkan baris asal Country Lock hanya mengunci serialnya: Item-nya boleh diganti dan memperoleh Tambah item seperti baris lain (diputuskan pemilik produk 2026-11-20 atas temuan N7 review perbaikan fase 3; kode memang begitu sejak awal, butir ini disunting agar sesuai); item baru langsung terpilih dan muncul di pilihan. Alasan: `serials.itemOptions` hanya memuat BU `serial: edit`, jadi item di BU tanpa hak itu tak akan muncul di pilihan pemanggil. Fungsi izin: `serialItemCreateAccess` di `web/src/lib/link-access.ts`; `ItemFormDialog` menerima `allowedBuIds`.

**Keputusan pemilik yang diadopsi setelah merge `origin/dev` (2026-11-21; ketiganya diputuskan pemilik produk pada 2026-11-20 di jalur `dev`, redesain menyesuaikan):**

30. **Halaman Stok Stiker digabung ke halaman Stiker** (keputusan pemilik 2026-11-20; sumber: spek Stiker 3a, catatan pada butir 7, dan CLAUDE.md). `/sticker` memuat katalog dan stok dalam SATU tabel: kolom Stok, kolom Per lokasi bila lebih dari satu lokasi terpilih, tombol judul "Stok opname", dan menu "Stok" per baris (Catat masuk, Catat keluar, Koreksi, Riwayat). Butir sidebar "Stok Stiker" dihapus; `/sticker/stock` hanya mengalihkan ke `/sticker`; stok opname = halaman sendiri `/sticker/opname` (`routes/_app/sticker/opname.tsx`, `opname-page.tsx`); `stock-page.tsx` dan `opname-dialog.tsx` sudah tidak ada. Izin halaman = `sticker: view` ATAU `stickerstock: view` di minimal satu lokasi (pemegang stok saja melihat tabel dari baris stok, tanpa kolom BU/minimum dan aksi katalog; pemegang katalog saja tanpa kolom dan aksi stok). Konsekuensi: tidak ada halaman, rute, atau butir menu Stok terpisah; View Stiker dibuka dari halaman Stiker (bukan dari "Stok"); fase 4a memigrasikan halaman gabungan itu ke kit sebagai satu `DataTable`. Menggantikan pernyataan lama bahwa "Stok Stiker" adalah halaman tanpa checkbox (§8 butir 5) dan butir sidebar "Stok" (§6.4). Checkbox/aksi massal dan entri stok batch pada halaman gabungan diputuskan di butir 33; isi View Stiker di butir 34.
31. **Semua lampiran berkas memakai `FileDialog` terpadu** (keputusan pemilik 2026-11-20; spek `2026-11-20-dialog-unggah-seragam-design.md`; sudah masuk CLAUDE.md). Aturan untuk fase 4: setiap lampiran gambar/PDF memakai `FileDialog` (`web/src/components/file-dialog/`: Unggah/Pustaka, seret-lepas, Kamera) dan unggahan latar `useBackgroundUploads` (`UploadProgress`/`AttachmentView`, Ulangi, batal) dengan `onBusyChange`/`blocking` yang menahan Simpan selama ada unggahan berjalan ATAU gagal (`FormPage`/`FormDialogShell` `submitDisabled`); pemilik hook = komponen pemegang nilai, dilepas = unggahan dibatalkan (`FormTabs` mempertahankan semua panel sehingga pindah tab tidak membatalkan; unggahan yang dimulai di tab `ViewPage` dipegang pemilik di atas `ViewPage`, mis. `ProofReplaceProvider`). `FileDialog` tidak mengunggah sendiri (`onConfirm({ library, files })`); sumber unggah = `FileSource` per modul (`modules/files/file-source.ts`, `modules/sticker/lib/guide-source.ts`, `modules/serial/lib/proof-source.ts`, `modules/postel/lib/postel-source.ts`). Tidak boleh ada `<input type="file">` baru (hanya `FilePicker`; dijaga `scripts/no-native-file-input.test.ts`). Pengecualian inline: `PdfSourceField` dan `LogoLibraryField` (modul QR) tanpa dialog tetapi wajib memakai `FilePicker`, `FileDropZone`, `intakeFiles`, dan `UploadProgress`. Komponen di `web/src/components/**` tidak boleh mengimpor `@/modules/**`; kamera umum di `components/camera` dan `components/file-dialog/camera`. Di form, lampiran gambar Postel hanya pratinjau (tanpa Unduh) dan PDF diunduh (View Postel: butir 35); menutup dialog Catat Serial desktop selagi unggahan foto berjalan meminta konfirmasi. Berlaku di 4a (Pustaka Gambar, gambar contoh pada form stiker, instruksi stiker di form item), 4b (form QR, lampiran Postel), dan 4d (Serial: Catat, Lapor, Ubah baris, Cek ulang, unggah ulang foto; editor catatan Serah Terima). Menyunting §3 dan §6.7.
32. **Kebijakan versi API menjadi batasan fase 4** (keputusan pemilik 2026-11-20; CLAUDE.md "Kebijakan versi API", `shared/api-versions.ts`, `shared/api-snapshot.ts`). Kontrak selalu kompatibel mundur; perubahan merusak = id baru `<idDasar>@<n>` berdampingan dengan v1 (belum diperlukan oleh redesain). Fase 4 hanya MENAMBAH id rute (`get`, `*Batch`, `remove`, `restore`, dan `stickerStock.recordBatch|adjustBatch`, butir 33) beserta kunci query dan field DTO opsional (`status`, `deleted`, `deleted?`, `typeDeleted?`, dst.). Tidak boleh menghapus id, mengganti nama id, atau mengubah verb, path, atau kunci query id yang ada: `stickers.setStatus`, `stickerTypes.setStatus`, `customers.rename`, `serials.updateBatch` (tetap ada walau UI daftar tak memakainya, butir 13), dan `stickerGuides.remove` tetap; `qrcodes.delete`, `qrcodes.deletePreset`, `postels.remove`, dan `access.roles.delete` tetap dengan masukan, keluaran, verb, dan path yang sama (hanya semantiknya berubah dari hapus keras ke hapus lunak; penafsiran kompatibilitas diputuskan di butir 36). Jalur batch baru mengikuti awalan jalur yang sudah dipakai tabel `API_ROUTES` (mis. `/users/batch/status`, bukan `/access/users/batch/status`) dan rute statis didaftarkan sebelum `{id}`. Rute yang dipakai antrean luring PWA dan `web/public/sync-sw.js` tetap v1. Potret `shared/api-contract.snapshot.json` TIDAK diperbarui di redesain ini (hanya lewat `bun run api:snapshot`, dikerjakan rilis); tes kompatibilitas potret harus tetap hijau.

**Jawaban pemilik atas pertanyaan terbuka §9 (2026-11-21, via chat; disetujui pemilik produk):**

33. **Halaman Stiker gabungan: aksi massal katalog DAN entri stok batch** (2026-11-21, pemilik produk). (a) Tabel Stiker tetap punya checkbox + aksi massal katalog (Aktifkan, Nonaktifkan, Hapus, Pulihkan) bagi `sticker: manage`, hanya pada baris katalog. (b) Tambahan permintaan pemilik: stok MASUK, KELUAR, dan KOREKSI harus dapat dicatat secara BATCH "seperti opname" (banyak stiker sekaligus dalam satu halaman/alur; lembar × isi per lembar tetap berlaku sesuai spek stok butir 7). Pemeriksaan kode: hanya opname yang batch (`stickerStock.opname`, halaman `/sticker/opname`); `stickerStock.record` dan `stickerStock.adjust` per stiker. Maka fase 4a menambah (aditif, id lama tak berubah): rute `stickerStock.recordBatch` (masuk/keluar) dan `stickerStock.adjustBatch` (koreksi), atomik dalam satu `batch()`, ditulis HANYA lewat `stock-service`; dan SATU halaman web "Entri stok" (`/sticker/entry`) bermode Masuk/Keluar/Koreksi dengan susunan seperti halaman opname (satu lokasi per entri, cari + filter jenis, baris per stiker, `CountInput` lembar × isi untuk Masuk/Keluar, selisih bertanda untuk Koreksi, satu alasan untuk seluruh batch pada Keluar/Koreksi, konfirmasi keluar bila belum disimpan). Opname yang sudah ada tidak ditulis ulang. Bentuk "satu halaman bermode" dan batas (satu lokasi, satu alasan) adalah asumsi perancang yang terbuka-eksplisit di rencana 4a Task 2b/4b. Alasan: pemilik mencatat banyak stiker sekaligus dalam satu kali kerja, dan menambah daripada mengubah menjaga kebijakan versi API (butir 32). Menyunting butir 30, §6.9, dan §8 butir 5.
34. **View Stiker memuat detail stiker, stok, dan riwayat stok** (2026-11-21, pemilik produk): `/sticker/$stickerId` bukan hanya tautan. Isinya DUA bagian yang keduanya wajib: (a) DETAIL stiker itu sendiri (jenis sebagai tautan, nama asli, alias, BU sebagai tautan, batas minimum, gambar, status, dan "Asal" untuk stiker sistem: tautan ke Desain QR/Postel) dan (b) stok: STOK per lokasi (lokasi terpilih di header yang boleh dilihat), aksi stok untuk stiker itu (Catat masuk, Catat keluar, Koreksi bagi `stickerstock: edit`/`manage` pada lokasi; tautan ke opname untuk stiker itu), dan tab RIWAYAT stok (`StockHistory`). Logika stok dipakai ulang dari halaman Stiker (diekstrak, bukan disalin). Menggantikan asumsi "hanya tautan" (§9 butir 2 lama). Data stok di isi View adalah data record, bukan "angka hitungan" yang dilarang di panel samping (§8 butir 2). Alasan: pemilik ingin melihat dan mengubah stok satu stiker dari halamannya sendiri.
35. **View Postel: lampiran gambar memakai pratinjau seragam, PDF tetap diunduh** (2026-11-21, pemilik produk): daftar lampiran di View Postel mengikuti aturan form (gambar = pratinjau lewat tampilan lampiran seragam tanpa Unduh; PDF tetap diunduh karena belum ada pratinjau PDF). Menyatakan keputusan dev "Unduh gambar dipulihkan" diperbarui oleh aturan ini; yang bertentangan di docs diseragamkan (rencana 4b), yang ada di kode (`AttachmentList` di `postel-view.tsx`) dijadwalkan sebagai pekerjaan 4b Task 5. Menggantikan asumsi §9 butir 4 lama.
36. **Hapus keras menjadi lunak pada id lama tetap v1** (2026-11-21, keputusan perancang/koordinator berdasarkan spek soft delete §4.3, "jalur dan verba boleh tetap"; pemilik menyetujui kebijakan soft delete di butir 11): `qrcodes.delete`, `qrcodes.deletePreset`, `postels.remove`, dan `access.roles.delete` tetap id v1 dengan masukan/keluaran/verb/path yang sama; yang berubah hanya perilaku (record tersimpan dan dapat dipulihkan), bukan kontrak, sehingga tidak butuh `@2`. Menggantikan asumsi §9 butir 3 lama.
37. **Ramah ponsel lintas fase** (2026-11-21, pemilik produk menyetujui; alasan: pemakai utama sering membuka aplikasi dari ponsel, tabel gulir horizontal dan dialog form kecil tidak nyaman dipakai di layar sempit): website HARUS nyaman dipakai di SEMUA ukuran layar, terutama penataan layout; tampilan ponsel sangat penting. Dua keputusan rinci: (a) di < 768 px daftar data tampil sebagai KARTU BERTUMPUK (judul/tautan di atas, field penting berlabel, status sebagai badge, aksi lewat menu "⋯" berlabel, checkbox di pojok kartu), tabel penuh tetap di >= 768 px; (b) form dalam dialog di < 768 px tampil LAYAR PENUH (header dan tombol Simpan tetap terlihat, field satu kolom), sedangkan dialog kecil (konfirmasi, `AlertDialog`) tetap di tengah. Menyunting butir 22, §6.5 (aturan DataTable < 768 px, bar aksi massal), §6.6 (tab View), §6.7 (dialog dan tab form), §6.10 (baris Fase 2c), dan menambah kriteria penerimaan lintas fase di §6.11. Kit (mode kartu `DataTable`, `FormDialogShell` layar penuh, `BulkBar` melekat bawah, padding, ukuran target sentuh) dikerjakan LEBIH DULU oleh tugas terpisah "Fase 2c: Ramah ponsel" di cabang utama; fase 4 membangun di atasnya dan memakai API kit hasilnya, tanpa membuat varian kartu sendiri. Pernyataan di CLAUDE.md dijadwalkan di Task dokumentasi tiap fase.
38. **Pola jangkauan jempol, pilih tahan-lama, dan keyboard layar** (2026-11-21, pemilik produk menyetujui rancangan beserta prototipe interaktif; alasan: tombol yang sering dipakai harus berada di zona jempol, pilih massal lewat checkbox yang selalu tampil memakan ruang, dan field serta daftar pilihan tidak boleh tertutup keyboard layar): (a) aksi per kartu di kanan lewat menu "⋯"; (b) pilih massal di ponsel dimulai dengan menahan kartu (±500 ms, getar singkat, batal bila jari bergeser > ~8 px; cadangan: butir "Pilih" di menu "⋯" kartu), checkbox hanya tampil selama mode pilih, header berubah menjadi "N dipilih" + ✕ + Pilih semua, bar aksi massal menempel di bawah maksimal 2 aksi + "⋯"; petunjuk "tahan kartu untuk memilih" tampil SEKALI per perangkat (`localStorage` `qc.hint.long-press`); (c) tombol "Tambah" daftar di ponsel = FAB 48-56 px mengambang di kanan bawah; (d) halaman View di ponsel: aksi utama "Ubah" di bar bawah menempel (`StickyActionBar`), aksi lain di "⋯"; (e) `FormPage` di ponsel: Batal + Simpan di `StickyActionBar` bawah, bar judul hanya judul + tombol kembali; (f) keyboard layar: `<meta viewport>` memuat `interactive-widget=resizes-content`, hook `useVisualViewport` menulis `--vvh`/`--vv-top`/`--kb`, dialog layar penuh bertinggi `var(--vvh, 100dvh)`, field yang difokus digulir ke tengah (`scrollIntoView`), popup `Select`/`MultiSelect`/`LinkField`/`LinkMultiField` memakai `visualViewport` (bukan `innerHeight`) dan membuka di ruang sisa di atas keyboard (cadangan bottom sheet bila ruang < 3 baris); (g) Catat Serial Number: bar bawah menempel berisi Simpan N serial + kamera + "⋯", pilih tahan-lama menggantikan checkbox yang selalu tampil. Menambah kriteria 12-15 di §6.11. Prototipe: artifact `https://claude.ai/artifact/JEHtdsQ9o8FEe9VavRWp8R`.
39. **Kit CRUD ponsel yang utuh dan seragam** (2026-11-21, pemilik produk meminta: konsisten, sederhana, dapat dipakai ulang, idempoten, informatif, sesuai kaidah UI/UX; "bangun CRUD kit khusus ponsel agar reusable dan konsisten antar halaman"): pola ponsel TIDAK dibuat per halaman. Seluruhnya disediakan kit (inventaris dan aturan di §6.12) dan setiap halaman daftar/View/form/dialog di fase 3-4 hanya MERAKIT komponen kit; halaman tidak boleh membuat tata letak kartu, bar bawah, mode pilih, FAB, keadaan kosong/galat/muat, atau penanganan keyboard sendiri. Kit melengkapi butir 37-38 dan menambah: anatomi kartu tunggal (`MobileCard`) yang dipakai juga oleh `GridView` dan kartu draft Serial, keadaan seragam (kosong, galat + coba lagi, kerangka muat, hitungan hasil, tombol "ke atas"), dan perlindungan kiriman ganda/idempotensi pada setiap aksi tulis. Tes penjaga kerangka (§6.4, aktif di akhir fase 4d) diperluas untuk memeriksa pemakaian kit ponsel.
40. **Ambang tata letak ponsel/desktop menurut lebar area isi** (2026-11-21, pemilik produk menyetujui keputusan implementer kit atas temuan review; alasan: sidebar tersemat 256 px menyisakan `<main>` ~500 px di tablet 768 px, sehingga kanban Serah Terima dan tabel rusak bila ambang memakai lebar layar): (a) peralihan tata letak ponsel (kartu, bar bawah, FAB, mode pilih) dan desktop (tabel penuh, bar atas) mengikuti lebar `<main>` >= 704 px (`useIsDesktop`; layar < 704 px = ponsel; di luar cangkang/jsdom jatuh ke lebar viewport 768 px), BUKAN lebar layar 768 px; menggantikan "< 768 px"/">= 768 px" pada butir 22, 37, dan 38, §6.5, §6.7, §6.11; (b) varian `touch:` (target sentuh 44 px, input >= 16 px) berlaku pada `max-width: 767px` ATAU `pointer: coarse` (menggantikan "< 768 px" di §6.11 butir 3 dan 4); (c) JS dan CSS memakai SATU sumber ambang agar tak ada celah (reviewer 2c, I9); angka 704 dan 768 hanya boleh didefinisikan di sumber itu.
41. **Navigasi ponsel dan perilaku back seperti stack** (2026-11-21, pemilik produk menyetujui prototipe `https://claude.ai/artifact/3JtSALGhY1MXmn4Kavis2F` v2 dan metode "sisipkan induk otomatis"; alasan: menu sangat banyak dan back web memakai riwayat linear, berbeda dengan stack di Android/iOS; pemilik meminta andalkan tombol back sistem dan tidak ada riwayat navigasi buatan di menu): (a) header ponsel: ☰ SELALU di kiri, lalu judul/breadcrumb ringkas (tingkat terakhir) tepat di sebelahnya, TANPA tombol kembali di header; kembali memakai back sistem (menggantikan rumusan "tombol kembali + tingkat terakhir" di §6.4 dan kriteria §6.11 butir 10, dan implementasi awal K1 yang memindahkan breadcrumb ke baris terpisah); (b) beranda ponsel = peluncur: kolom cari menu + kotak ikon modul sesuai izin pengguna; panel menu (geser dari kiri, juga dibuka dengan tarik dari tepi kiri layar) berisi kolom cari menu dan grup akordeon (grup yang memuat halaman aktif terbuka, tertutup otomatis setelah memilih halaman); TIDAK ada "Terakhir dibuka", favorit, atau riwayat navigasi apa pun di beranda maupun panel (keputusan pemilik); (c) aturan riwayat (disunting 2026-11-21, pemilik menyetujui: aturan push/replace/pop berlaku di SEMUA layar termasuk desktop dan Electron, agar form yang sudah disimpan tidak muncul lagi saat back; hanya `useBackToClose`, yaitu overlay masuk riwayat, yang khusus ponsel): setiap overlay (ponsel) (dialog, panel menu, lembar pilihan, kamera, mode pilih) menambah satu entri riwayat lewat hook `useBackToClose` sehingga back menutup overlay lebih dulu; perubahan filter, pencarian, urutan, dan tab memakai `replace`; pindah level (daftar -> Lihat -> Ubah) memakai `push`; pindah modul lewat menu memakai `replace`; simpan form Tambah = `replace` ke Lihat record baru; simpan form Ubah = pop kembali ke Lihat asal (bila entri sebelumnya bukan Lihat record itu, `replace` ke Lihat); hapus dari Lihat = pop ke daftar; tombol Batal form = pop (bila entri sebelumnya bukan halaman induknya, `replace` ke induk); (d) sisipan induk untuk tautan langsung: saat sebuah halaman dalam dibuka tanpa riwayat aplikasi sebelumnya (tautan langsung, push notifikasi, bookmark, buka dari luar), sebelum merender aplikasi menyisipkan rantai induk logisnya (rantai breadcrumb sampai Beranda, mis. Beranda -> Daftar Serial -> Lihat Serial) di bawah halaman itu lewat `history.replaceState`/`pushState`, sehingga back sistem naik satu tingkat dan baru keluar dari aplikasi dari Beranda; (e) tes penjaga kerangka (§6.4, 4d) diperluas: overlay baru wajib memakai `useBackToClose` dan navigasi filter/tab/pencarian tidak boleh memakai `push`. Menambah kriteria 16-19 di §6.11.
42. **Header ponsel: lonceng, avatar, dan lokasi aktif terlihat** (2026-11-21, pemilik produk menyetujui prototipe `https://claude.ai/artifact/EFAbJNCh4KV5Le2tvhthvY`; alasan: lima kontrol header desktop tidak muat di 360 px, dan lokasi aktif yang tersembunyi di menu membuat pemakai lupa menggantinya lalu mencatat di lokasi yang salah): (a) header ponsel hanya berisi ☰, judul/breadcrumb ringkas, lonceng notifikasi (dengan angka belum dibaca), dan avatar; (b) avatar membuka LEMBAR dari bawah (bukan dropdown pojok) berisi: kartu pengguna (nama dan surel; peran belum tampil karena data pengguna dari server belum memuatnya, keputusan pemilik 2026-11-21), baris Lokasi aktif (membuka pemilih lokasi), baris Antrean offline (hanya bila ada, tampil jumlahnya; avatar diberi titik penanda selama ada antrean), pilihan Tema (Terang/Gelap/Sistem), baris Notifikasi push (membuka dialog pengaturan push yang sudah ada: saklar akun dan perangkat; keputusan pemilik 2026-11-21), Panduan, dan Keluar; pemilih tema dan chip antrean tidak lagi menjadi tombol header di ponsel; (c) pada halaman yang membaca lokasi aktif (Serah Terima, stok dan Opname Stiker, dan Catat Serial Number; daftar Serial Number dan Lapor Rusak tidak membaca lokasi aktif sehingga tidak menampilkannya; keputusan pemilik 2026-11-21), lokasi aktif tampil sebagai BARIS KEDUA di bawah judul header (ikon pin + nama + panah; "N lokasi" bila lebih dari satu, "Semua lokasi" bila seluruhnya); halaman yang tidak bergantung lokasi (mis. Data Item, Akses) tidak menampilkannya; keadaan "belum dipilih" tampil dengan warna peringatan dan ikon peringatan; area tekan baris itu >= 44 px; (d) ketuk baris lokasi membuka lembar pemilih lokasi (daftar centang, "Pilih semua", tombol "Terapkan (n)" yang nonaktif bila tidak ada pilihan, tidak boleh berakhir tanpa lokasi); (e) di form tulis, lokasi tetap field yang wajib dikonfirmasi; nilai awalnya diambil dari lokasi aktif dan disorot, dengan keterangan "Nilai awal diambil dari lokasi aktif. Periksa sebelum menyimpan." (sorotan dan keterangan cukup, tanpa langkah konfirmasi tambahan; keputusan pemilik 2026-11-21); (f) saat aplikasi dibuka kembali di ponsel setelah tidak aktif >= 4 jam dan pengguna punya lebih dari satu lokasi (keputusan pemilik 2026-11-21), tampil dialog "Lokasi aktif: <nama>. Apakah lokasi ini masih benar?" dengan tombol Ganti dan Sudah benar (disetujui sebagai bagian prototipe); (g) judul tetap terbaca di 360 px karena baris lokasi tidak memakai lebar horizontal. Menambah kriteria 20-22 di §6.11 dan menyunting kriteria 16.

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
  Stiker             ▸ Katalog (katalog + stok) · Jenis · Pustaka Gambar · Konfigurasi
  Manual Book        ▸ QR Code · Default QR
  Postel
PENGATURAN
  Akses              ▸ Pengguna · Role · Lokasi · Business Unit
  Sistem             ▸ Status Push · Log Audit
```

- `NavGroup` mendapat `items` yang boleh berupa butir biasa atau butir bersubmenu (`children: NavItem[]`). Izin dihitung per anak; butir induk tampil bila minimal satu anak tampil; induk tanpa halaman sendiri.
- Default QR (`/qrcode/default`) kini menu sendiri (sebelumnya hanya dibuka dari halaman QR).
- Tidak ada butir menu "Stok" (butir 30; disesuaikan 2026-11-21 setelah merge `origin/dev`): butir "Katalog" (`/sticker`) memuat katalog sekaligus stok dan tampil bagi pemegang `sticker: view` ATAU `stickerstock: view` (lokasi); opname dan entri stok batch dibuka dari tombol "Stok opname" dan "Entri stok" di halaman itu (`/sticker/opname`, `/sticker/entry`; butir 33), dan `/sticker/stock` hanya mengalihkan ke `/sticker`.
- **Keadaan diingat**: terbuka/terlipat sidebar dan submenu yang terbuka disimpan di `localStorage` (`qc.sidebar`, bukan per akun), dibaca saat `SidebarProvider` dibuat (`defaultOpen` dari penyimpanan), dibungkus try/catch. Submenu yang memuat rute aktif selalu terbuka. Cookie `sidebar_state` bawaan shadcn tidak dipakai lagi.
- **Mode ikon**: klik butir bersubmenu membuka `Popover`/`DropdownMenu` di kanan ikon berisi judul grup + submenu; butir tanpa submenu menampilkan tooltip nama (perilaku `SidebarMenuButton tooltip` yang ada). Di ponsel (sheet) submenu tampil berlipat biasa.
- Titik penanda panduan (`hasPendingGuide`) berlaku untuk butir anak; induk menampilkan titik bila salah satu anaknya punya.
- `isNavItemActive`, `excludes`, `alsoActiveOn` tetap; tes navigasi diperbarui.

**Header**: `[SidebarTrigger] Breadcrumb ……… LocationPicker · OutboxChip · NotificationBell · ThemeToggle · UserMenu`.

- **Breadcrumb** (`app/shell/app-breadcrumb.tsx`, komponen shadcn `breadcrumb`): disusun dari `useMatches()`; tiap rute menyatakan labelnya lewat `staticData.crumb` (teks tetap, mis. "Data Item") atau fungsi yang membaca data loader / cache query yang sudah ada (nama record di halaman View/Ubah) tanpa permintaan jaringan tambahan. Grup sidebar menjadi tingkat pertama tanpa tautan bila tidak punya halaman (mis. "Item › Daftar Item › Asus RT-AX55 › Ubah"). Di layar < 768 px hanya tingkat terakhir + tombol kembali ke tingkat sebelumnya. Setiap rute non-indeks (bukan tujuan butir nav) WAJIB punya `crumb`, termasuk `/serial/report`; `/` dan jalur tanpa cangkang (halaman publik, login, dan Country Lock saat belum masuk) tanpa breadcrumb; Country Lock di dalam cangkang (sudah masuk) MEMAKAI breadcrumb (butir 25; disesuaikan 2026-11-21); header diuji pada lebar 360 px. Judul `h1` halaman memakai nama lengkap ("Daftar Serial Number", "Data Item"), dan `GuideBanner.pageLabel` memakai label induk bila label anak generik ("Daftar", "Laporan", "Pengaturan").

**Isi halaman**: `PageContainer` (`web/src/components/page/page-container.tsx`) dengan `width` (keputusan 17): `narrow` = `max-w-4xl` (form, pengaturan), `default` = `max-w-7xl` (View, daftar, grid, Country Lock), `full` = `max-w-none` (kanban, tabel yang memang lebar). Selalu `mx-auto` (rata tengah). `main` di `AppShell` tetap memberi padding; setiap rute membungkus isinya dengan `PageContainer` pada fase 1 (lewat `AppShell`; Country Lock di dalam cangkang bila pengguna sudah masuk, sehingga mendapat breadcrumb dan `PageContainer` `default` seperti halaman lain, butir 25; hanya jalur belum masuk yang tanpa cangkang, tanpa breadcrumb, dengan pembungkus ringan sendiri; disesuaikan 2026-11-21). Tes yang menjaga bahwa setiap komponen halaman memakai salah satu kerangka §6.5-6.7 baru diaktifkan di akhir fase 4d (sebelumnya halaman pola lama sah).

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
- Kolom kiri: checkbox (bila halaman punya aksi massal), lalu kolom aksi (`ActionButton compact`; di layar < 768 px kartu dengan menu "⋯", lihat bawah). Checkbox baris memakai `aria-label` "Pilih <nama>"; tombol ikon-saja di layar sentuh tetap ber-`aria-label`. Tidak ada tombol "Lihat".
- Kolom unik (nama/kode/nomor record) = tautan ke View record itu; kolom relasi = tautan ke View model relasi. Tautan memakai warna `info-text`, garis bawah saat hover, dan komponen `Link` Router (klik tengah/Ctrl membuka tab baru). Tautan relasi hanya bila pengguna berhak membaca record tujuan (fungsi di `lib/link-access.ts`); bila tidak, teks biasa.
- Checkbox kepala = pilih SEMUA baris yang SUDAH dimuat (daftar infinite; keputusan 19); bar massal menyebut jumlah dan menyediakan aksi massal modul + "Batalkan pilihan". Pilihan dibuang saat filter berubah. Aksi massal dikirim bertahap per `BATCH_MAX` (§6.9).
- Baris kosong, galat muat, dan "Muat lebih banyak" seragam.
- Di layar < 768 px (keputusan 22 dan 37; disunting 2026-11-21) `DataTable` TIDAK menggulir horizontal: setiap baris menjadi KARTU BERTUMPUK. Setiap pemakai `DataTable` mendefinisikan tata letak kartunya lewat peran kolom (judul = kolom unik berupa tautan ke View, badge = status, meta = field penting berlabel, tersembunyi = kolom yang hanya tampil di tabel penuh); aksi baris menjadi satu tombol "⋯" berlabel (menu berisi aksi lengkap); checkbox di pojok kartu; header tabel tidak dipakai. Tabel penuh dengan header `sticky` hanya di >= 768 px. Halaman yang sudah punya tampilan kartu ponsel (mis. staging Serial) mempertahankannya. Bar aksi massal menempel di bawah layar pada ponsel (§6.11). Mode kartu dan peran kolom disediakan kit oleh Fase 2c (butir 37).

**KanbanBoard**: kolom dengan lebar minimum (±290 px) dan gulir horizontal bila tak muat; `ListPage` di atasnya (filter sama). Warna kolom (garis atas, latar tipis, garis kiri kartu) mengikuti warna badge nilai yang dikelompokkan (mis. status Serah Terima). Kartu memakai tautan ke View. Papan ponsel yang ada tetap. Mode `height="viewport"`: kolom menggulir sendiri (dengan `ScrollRootProvider`, kartu lazy, dan "Muat lebih banyak" per kolom) sementara bar headroom diam; tinggi dihitung dengan banner aplikasi yang sedang tampil. Chip "Terhapus" ada di bar filter desktop.

**GridView**: kisi kartu mengikuti `LibraryTab` Pustaka Gambar (kartu bergambar, nama, aksi `compact`, pencarian/urutan/filter di `FilterBar`). Pustaka Gambar menjadi pemakai pertama; `components/file-dialog` tetap memakai kisinya untuk dialog berkas. `GridView` mendukung `selection` opsional (checkbox kartu); kontrol cari/urut/filter Pustaka pindah ke `FilterBar` di halaman Pustaka, sedangkan dialog berkas tetap memakai kontrol lama.

### 6.6 Halaman View

Kerangka `ViewPage` (`web/src/components/page/view-page.tsx`): bar headroom berisi judul record + badge status + aksi (ikon + label: Ubah, Aktifkan/Nonaktifkan, Hapus, aksi modul), tab bila isi panjang (mis. Detail · Gambar · Riwayat; daftar tab dapat digeser horizontal di layar sempit, butir 37), isi berupa daftar label–nilai (`dl`) per section, panel samping (≥ 1024 px; di bawah isi pada layar sempit) berisi "Dibuat" (hanya bila DTO punya `createdBy`/`createdAt`), "Diubah oleh … · kapan" (dari `updatedBy`/`updatedAt`), dan tautan ke data terkait tanpa angka hitungan (mis. "Lihat Serial Number item ini"); tab (mis. "Serial Number", "Riwayat") dan angka pada mockup hanya ilustrasi. Nilai relasi = tautan ke View-nya.

**View baru** (model yang belum punya halaman lihat):

| Model | Rute View baru | Dibuka dari |
|---|---|---|
| Customer | `/customer/$customerId` | daftar Customer, task Serah Terima |
| Stiker | `/sticker/$stickerId` | Halaman Stiker (katalog + stok digabung, butir 30), instruksi item, Postel, Manual Book |
| Jenis Stiker | `/sticker/types/$typeId` | daftar Jenis, Katalog |
| Desain QR (Manual Book) | `/qrcode/$designId` | daftar QR, View Item |
| Preset QR (Default QR) | `/qrcode/default/$presetId` | daftar Default QR, form QR |
| Pengguna | `/access/users/$userId` | daftar Pengguna, Log Audit |
| Role | `/access/roles/$roleId` | daftar Role, View Pengguna |
| Lokasi | `/access/locations/$locationId` | daftar Lokasi, View Pengguna, Serial |

Halaman Ubah yang sudah ada (`…/$id/edit`) tetap; model yang hari ini diubah lewat dialog boleh tetap memakai Form Dialog dari View dan daftar. View Laporan Serial memakai halaman detail Serial yang ada (tab laporan). Log Audit dan Status Push hanya-baca tanpa View sendiri; entri audit BARU menaut ke View entitasnya lewat `audit_log.target_id` (keputusan 20; entri lama tetap teks). Gambar Pustaka dikecualikan dari View (keputusan 23): pratinjau dan daftar pemakai tetap di dialog. Setelah Hapus dari View: navigasi ke indeks induk + toast "Dihapus" (dengan aksi "Pulihkan" bagi pemegang izin).

**View Stiker** (butir 34, 2026-11-21): selain detail stiker (jenis, nama asli, alias, BU, batas minimum, gambar, status, "Asal" stiker sistem) View memuat stok per lokasi, aksi stok (masuk, keluar, koreksi, tautan opname), dan tab riwayat stok; kedua bagian wajib ada. Stok di isi View adalah data record, bukan angka hitungan panel samping.
Konsekuensi: `LinkField` "Buka" (`openHref`) tersedia untuk semua model di atas; fungsi izin baru di `lib/link-access.ts` (mis. `customerLinkAccess`, `userLinkAccess`, `roleLinkAccess`, `locationLinkAccess`, `qrDesignLinkAccess`, `qrPresetLinkAccess`), dan `stickerTypeLinkAccess`/`stickerLinkAccess` mendapat `openHref`. Lokasi kini punya View: `LinkField` lokasi pada penugasan pengguna dan `SerialLocationField` mendapat Buka bila berhak (`locationLinkAccess`); `LocationField` tetap tanpa Tambah/Buka (butir 18).

### 6.7 Form Edit dan Form Dialog

- Setiap model punya satu komponen form (`<Model>Form`) yang hanya berisi field + validasi + submit, tanpa kerangka halaman/dialog. Ia dibungkus:
  - `FormPage` (`web/src/components/page/form-page.tsx`): bar headroom berisi judul (+ badge status saat ubah) dan aksi (Batal, aksi tambahan, Simpan, ikon + label) menggantikan `FormHeader`; tab `sticky` di bawahnya; `PageContainer narrow`.
  - `FormDialog` (yang ada, `components/form-dialog.tsx`): header dan footer dialog; tab di dalam badan dialog bila form bertab.
  - Form yang hari ini ditulis dua kali (halaman dan dialog) disatukan.
- **Tab** (`FormTabs`): dipakai bila form punya ≥ 3 section atau lebih panjang dari satu layar; satu tab boleh berisi beberapa section (judul section + kisi 2 kolom di ≥ 768 px). Galat validasi di tab lain ditandai titik merah pada judul tab, dan submit yang gagal pindah ke tab pertama yang bergalat. Daftar tab dapat digeser horizontal di < 768 px (butir 37).
- **Field wajib**: label bertanda `*` merah (`text-destructive`) lewat prop `required` pada `Label` dan pada komponen field (`LinkField`, `LinkMultiField`, `Select`, `MultiSelect`, dan pembungkus input teks). Penanda dibaca pembaca layar sebagai "wajib" (`aria-required` pada kontrol; bintang `aria-hidden`).
- Bentuk field mengikuti mockup (latar `muted`, tanpa border tebal); fokus tetap memakai `ring`.
- **Field berlampiran** (butir 31; disesuaikan 2026-11-21): form yang memuat lampiran memakai `FileDialog` + `useBackgroundUploads`; tombol Simpan (`FormPage`/`FormDialogShell` lewat `submitDisabled`) nonaktif selama ada unggahan berjalan atau gagal (`onBusyChange`/`blocking`). Karena `FormTabs` tidak melepas panel tab, pindah tab tidak membatalkan unggahan.
- `FormDialogShell` punya `size` (lebar dialog sesuai isi); tab form di dalam dialog menempel tepat di bawah header dialog yang juga menempel (offset = tinggi header dialog, bukan offset headroom halaman; keputusan 28); pada dialog bertumpuk (mis. "Tambah merk" dari form item) Escape menutup yang teratas saja. Di < 768 px (disunting 2026-11-21, butir 37) `FormDialogShell` tampil LAYAR PENUH: header dan footer (tombol Simpan) tetap terlihat, field satu kolom, tinggi memakai `dvh` dan padding `env(safe-area-inset-*)`; `size` hanya berlaku di >= 768 px. Dialog kecil (konfirmasi, `AlertDialog`) tetap di tengah. Layar penuh ini disediakan kit oleh Fase 2c.

### 6.8 LinkField: Tambah dan audit

- Fase 4 mengaudit semua field relasi di form dan filter tiap modul; yang belum memakai `LinkField`/`LinkMultiField` dipindah.
- Baris "Tambah {model}" (`onCreate`) tersedia untuk SEMUA model yang dapat dibuat di UI (keputusan 18): Item (lewat Form Dialog yang membungkus form yang sama, §6.7; BU yang dapat dipilih di dialog hanya yang boleh diedit pengguna, sehingga item baru langsung muncul di pilihan pemanggil; pengecualian pemilih Item Serial Number: irisan BU `item: edit` dan `serial: edit`, butir 29), Role, Lokasi, Preset QR, dan model lain yang sudah punya dialog, bila pengguna berhak membuat; record baru langsung terpilih. Pengecualian yang tetap: `LocationField` (form tulis modul berlokasi: tanpa Tambah/Buka) dan model yang pembuatannya tidak ada di UI (mis. Customer dibuat otomatis lewat `CustomerCombobox`, yang tetap teks bebas). Tautan "Buka" tersedia untuk semua model ber-View, termasuk lokasi pada penugasan pengguna dan `SerialLocationField` bila berhak.

### 6.9 Rute batch atomik

Untuk setiap aksi massal di tabel berikut, satu rute REST baru per modul, mengikuti pola `serials.updateBatch`. Hapus dan Pulihkan mengikuti [rancangan soft delete](2026-11-20-soft-delete-design.md) (§4.3: model berstatus wajib Nonaktif dulu; §4.5: Pulihkan dari tampilan "Terhapus"):

| Modul | Rute batch | Aksi massal di UI |
|---|---|---|
| Item | `items.setStatusBatch`, `items.removeBatch`, `items.restoreBatch` | Aktifkan, Nonaktifkan, Hapus, Pulihkan |
| Merk | `brands.*` (sama) | sama |
| Customer | `customers.*` (sama) | sama |
| Stiker | `stickers.*` (sama) | sama, pada halaman Stiker gabungan katalog + stok (butir 30; aksi massal hanya pada baris katalog, butir 33) |
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
| 2c. Ramah ponsel (kit; tugas terpisah di cabang utama, dikerjakan LEBIH DULU dari fase 4, butir 37) | `DataTable` mode kartu < 768 px (peran kolom judul/badge/meta/tersembunyi), `FormDialogShell` layar penuh < 768 px, `BulkBar` melekat bawah, padding dan ukuran target sentuh, tab dapat digeser; kriteria §6.11 | Kit memenuhi §6.11 pada 360 dan 768 px; halaman fase 3 (Item, Merk) dan Pustaka Gambar lolos pemeriksaan |
| 3. Percontohan | Item + Merk sepenuhnya di kit, termasuk batch status, tautan kolom, form bertab, Form Dialog "Tambah Merk"/"Tambah item" | Pola teruji di Item/Merk sebelum disebar (penilaian pemilik saat PR, keputusan 12) |
| 4a | Stiker (halaman Stiker = katalog + stok digabung, Jenis, Pustaka Gambar, Konfigurasi, halaman opname, halaman Entri stok batch) + View Stiker (dengan stok dan riwayat, butir 34) dan Jenis + batch katalog + rute entri stok batch | |
| 4b | Manual Book (QR, Default QR) + Postel + View QR dan Preset + batch | |
| 4c | Akses (Pengguna, Role, Lokasi, BU, Log Audit, Status Push) + Customer + View baru + batch | |
| 4d | Serial Number (Daftar, Laporan, Pengaturan, Catat) + Serah Terima (Kanban) + Country Lock + migrasi contract soft delete (task penutup; soft delete keputusan 11) | Pemetaan varian lama dihapus; tak ada halaman pola lama; indeks unik lama dibuang | Gerbang tiap fase 3-4 juga mencakup kriteria ramah ponsel §6.11 (diperiksa pada 360 dan 768 px; butir 37).

Tiap fase: rencana implementasi sendiri, commit di cabang yang sama (satu PR untuk semua fase, keputusan 12), catatan changelog (`server/changelog.d/`), dan pembaruan CLAUDE.md (struktur `components/page`, `data-table`, aturan View untuk semua model, aturan aksi massal) pada fase yang memperkenalkannya. Pembaruan itu juga MENYUNTING pernyataan CLAUDE.md, `docs/adding-a-module.md`, `docs/e2e-checklist*.md`, dan teks langkah panduan yang kini bertentangan (bukan hanya menambah); tes yang mencari tombol "Lihat" diubah (perubahan yang memang diminta spek). Panduan interaktif: target `data-tour` dipertahankan; langkah tur yang menyorot sidebar diperbarui (kosmetik) pada fase 1.

### 6.11 Ramah ponsel: kriteria penerimaan lintas fase (butir 37)

Berlaku untuk kit (Fase 2c) dan SETIAP halaman yang dimigrasi di fase 3 dan 4. Kit-nya dikerjakan lebih dulu oleh Fase 2c; fase 4 memakai API kit hasilnya dan tidak membuat varian kartu atau dialog layar penuh sendiri.

1. **Lebar uji**: 360, 390, 768, 1024, dan 1440 px.
2. **Tanpa gulir horizontal HALAMAN pada 360 px**: `document.documentElement.scrollWidth <= window.innerWidth`. Gulir horizontal internal hanya pada yang memang disebut: `KanbanBoard`, tabel draft Catat Serial (>= 768 px; di < 768 px kartu `staging-cards`), daftar tab, dan area kode/tabel dalam isi Markdown.
3. **Target sentuh**: elemen interaktif utama (tombol, tautan baris, checkbox, menu "⋯", tab, item sidebar) >= 44 x 44 px di < 768 px (area tekan boleh lebih besar dari ikonnya). Disunting 2026-11-21 (butir 40): berlaku di < 768 px ATAU pada penunjuk sentuh kasar (`pointer: coarse`, varian `touch:`), sehingga tablet dan layar sentuh ikut mendapat target 44 px.
4. **Input teks >= 16 px** di < 768 px (mencegah zoom otomatis iOS saat fokus). Disunting 2026-11-21 (butir 40): berlaku juga pada penunjuk sentuh kasar (varian `touch:`).
5. **Dialog form layar penuh** di < 768 px dengan padding `env(safe-area-inset-*)` dan satuan `dvh` (bukan `vh`); header dan footer (Simpan) tetap terlihat; field satu kolom. Dialog kecil (konfirmasi, `AlertDialog`) tetap di tengah.
6. **Daftar data < 768 px = kartu bertumpuk** (butir 22 dan 37): judul/tautan, field penting berlabel, badge status, menu "⋯" berlabel, checkbox di pojok kartu; setiap `DataTable` mendefinisikan peran kolom untuk tata letak kartunya.
7. **Bar aksi massal** (`BulkBar`) menempel di bawah layar pada ponsel (di atas area aman bawah) dan tidak menutupi kartu terakhir (ada ruang bawah di daftar).
8. **Tab** (`FormTabs`, tab `ViewPage`) dapat digeser horizontal; tab aktif digulir ke dalam pandangan.
9. **Daftar saran** `LinkField`/`LinkMultiField`/`Select`/`MultiSelect` terbuka di dalam layar (tidak terpotong) dan tidak tertutup keyboard layar (`visualViewport`).
10. **Breadcrumb ringkas** (butir 41, disunting 2026-11-21): di ponsel hanya tingkat terakhir, tepat di kanan ☰, TANPA tombol kembali di header (kembali = back sistem; §6.4).
11. **Teks tidak terpotong tanpa jalan keluar**: `truncate` hanya bila ada tooltip, teks penuh di View, atau arah lain (bungkus baris) untuk membaca isinya.
12. **Jangkauan jempol** (butir 38): aksi utama halaman (Simpan form, Ubah di View, Simpan draft Serial) berada di `StickyActionBar` bawah pada ponsel; Tambah daftar = FAB.
13. **Pilih tahan-lama** (butir 38): di < 768 px kartu tanpa checkbox sampai mode pilih aktif lewat tahan (atau "Pilih" di "⋯"); keluar dengan ✕ atau saat pilihan kosong.
14. **Keyboard layar** (butir 38): field difokus dan popup pilihan terlihat penuh di atas keyboard (`visualViewport`); dialog layar penuh menyusut mengikuti viewport visual sehingga Simpan tetap terlihat.
15. **Konfirmasi aksi destruktif massal/draft**: "Kosongkan draft" dan hapus massal selalu meminta konfirmasi.
16. **Header ponsel** (butir 41-42): ☰ di kiri + judul ringkas di sebelahnya pada 360 px tanpa judul terpotong menjadi nol lebar; tanpa tombol kembali; hanya lonceng dan avatar di kanan, keduanya >= 44 px.
17. **Peluncur dan panel menu** (butir 41): beranda ponsel punya kolom cari menu + kotak modul (sesuai izin); panel menu punya cari menu dan akordeon; tanpa "Terakhir dibuka"/riwayat.
18. **Back seperti stack** (butir 41): back sistem menutup overlay lebih dulu (ponsel), tidak mengurai filter/tab, tidak kembali ke form yang sudah disimpan (semua layar).
19. **Tautan langsung** (butir 41): halaman dalam yang dibuka tanpa riwayat mendapat rantai induk (sampai Beranda) sehingga back naik satu tingkat.
20. **Lokasi aktif terlihat** (butir 42): halaman berlokasi menampilkan lokasi aktif di baris kedua header; halaman tidak berlokasi tidak; "belum dipilih" berwarna peringatan; area tekan >= 44 px.
21. **Lembar avatar dan pemilih lokasi** (butir 42): lembar avatar memuat pengguna, lokasi aktif, antrean (bila ada), tema, push, Panduan, Keluar; pemilih lokasi tidak dapat diterapkan tanpa pilihan.
22. **Konfirmasi lokasi** (butir 42): di ponsel, bila pengguna punya lebih dari satu lokasi, setelah tidak aktif >= 4 jam, dialog konfirmasi lokasi tampil sekali saat dibuka kembali; form tulis menyorot lokasi bawaan dan meminta konfirmasi.

**Verifikasi (gerbang fase)**: tiap halaman yang dimigrasi diperiksa di peramban pada 360 dan 768 px (`resize_window`) dan hasilnya (tanpa gulir horizontal halaman, kartu/dialog layar penuh tampil, aksi terjangkau) dicatat di ringkasan fase. Tes otomatis: tes lebar 360 px tiap `DataTable` (mode kartu merender judul, badge, meta; kolom tersembunyi tidak muncul) dan tes komponen kit untuk ukuran target, ukuran font input, dan dialog layar penuh. CLAUDE.md memuat aturan ini dan dijadwalkan di Task dokumentasi tiap fase.

### 6.12 Kit CRUD ponsel: inventaris dan kaidah (butir 39)

Satu kit, satu perilaku. Komponen di bawah ada di `web/src/components/**` (bukan di modul), diuji sendiri, dan dipakai oleh semua halaman CRUD. Kaidah UI/UX yang menjadi dasarnya:

| Kaidah | Penerapan di kit |
|---|---|
| Konsisten | Satu anatomi kartu `MobileCard` (judul/tautan, subjudul, badge status, baris meta berlabel, "⋯" di kanan) dipakai `DataTable` mode kartu, `GridView`, dan kartu draft Serial. Posisi aksi, urutan tombol (Batal kiri, aksi utama kanan/lebar), warna, ikon, dan label sama di semua halaman lewat `ActionButton`/`ACTIONS`. |
| Sederhana | Satu aksi utama per layar di `StickyActionBar`; aksi sekunder di "⋯"; maksimal 2 aksi + "⋯" di bar massal; field satu kolom; tanpa gerak/animasi yang menghalangi (`prefers-reduced-motion`). |
| Reusable | Halaman merakit `ListPage`+`DataTable`/`GridView`, `ViewPage`, `FormPage`/`FormDialogShell`, `StickyActionBar`, `BulkBar`, `useLongPressSelect`, `Fab`, `ListState`; tidak ada CSS ponsel per modul (dijaga tes penjaga, §6.4). |
| Idempoten | Setiap aksi tulis mematikan tombolnya selama berjalan (`busy` di `ActionButton`; `submitting` di `FormPage`/`FormDialogShell`) sehingga ketukan ganda tidak mengirim dua kali; aksi massal lewat `useBulkAction` (satu proses per waktu); hapus/nonaktifkan/pulihkan pada keadaan yang sudah sama = sukses tanpa efek (sisi server sudah demikian); kiriman yang dapat diulang membawa `clientId` (pola yang ada) dan galat jaringan menjadi toast dengan "Coba lagi". |
| Informatif | `ListState` seragam: kerangka muat (kartu abu), keadaan kosong (alasan + ajakan aksi, mis. "Belum ada merk. Tambah merk"), keadaan kosong karena filter ("Tidak ada hasil untuk filter ini" + tombol hapus filter), galat awal (pesan + "Coba lagi"), hitungan hasil ("N item"), indikator muat berikutnya; toast hasil aksi menyebut jumlah dan memuat "Urungkan"/"Pulihkan" bila ada jalan kembali; alasan tombol nonaktif tampil (`disabled-reason`); konfirmasi destruktif menyebut apa dan berapa yang terdampak. |
| Dapat dijangkau | Target >= 44 px, aksi di zona jempol (butir 38), fokus tidak menutup field, bar bawah mengikuti safe-area dan keyboard, gestur selalu punya jalur alternatif tanpa gestur (butir "Pilih" di "⋯"). |

Inventaris wajib (nama bisa disesuaikan implementer, perannya tidak): `MobileCard` (anatomi kartu), `StickyActionBar` (bar bawah menempel), `Fab` (Tambah), `useLongPressSelect` + mode pilih di `DataTable`/`GridView`, `BulkBar` ponsel, `ListState` (kosong/kosong-karena-filter/galat/kerangka/hitungan), `ScrollToTop`, `useVisualViewport` + penanganan keyboard di dialog/popup, `ViewPage` dengan bar bawah, `FormPage` dengan bar bawah. Setiap komponen punya tes lebar 360 px. Halaman fase 3-4 dinyatakan selesai hanya bila memakai komponen ini tanpa varian lokal.


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
5. **Checkbox** hanya ada di halaman yang punya aksi massal di §6.9 (disesuaikan 2026-11-21 setelah merge `origin/dev`: Stok Stiker bukan lagi halaman sendiri, butir 30). Log Audit, Status Push, Laporan Serial, Country Lock, papan kanban Serah Terima, dan tab riwayat tanpa checkbox. Halaman Stiker gabungan (katalog + stok) mendapat checkbox untuk aksi massal katalog (Aktifkan, Nonaktifkan, Hapus, Pulihkan) hanya bagi pemegang `sticker: manage` dan hanya pada baris katalog; pemegang stok saja tidak melihat checkbox; entri stok tetap hanya-tambah dan dicatat secara batch lewat halaman "Entri stok" dan "Stok opname", bukan lewat checkbox tabel (butir 33). Halaman "Entri stok" dan "Stok opname" tanpa checkbox. Daftar Serial Number mendapat checkbox untuk Hapus/Pulihkan massal saja (soft delete, keputusan 11; "Ubah massal" dibatalkan oleh keputusan 13, 2026-11-20).
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

## 9. Pertanyaan terbuka untuk pemilik (2026-11-21, setelah merge `origin/dev`): TERJAWAB

Empat pertanyaan yang timbul dari penggabungan Stok ke halaman Stiker, kebijakan versi API, dan aturan lampiran dijawab 2026-11-21 dan dicatat sebagai keputusan bernomor; tidak ada yang tersisa memblokir.

1. Aksi massal di halaman Stiker gabungan: dijawab ya (checkbox + aksi massal katalog bagi `sticker: manage`), ditambah entri stok masuk/keluar/koreksi secara batch, butir 33.
2. Stok di View Stiker: dijawab View memuat detail stiker DAN stok per lokasi, aksi stok, dan riwayat, butir 34.
3. Hapus keras menjadi lunak pada id lama: dijawab tetap v1, butir 36 (spek soft delete §4.3).
4. Lampiran gambar di View Postel: dijawab pratinjau seragam, PDF tetap diunduh, butir 35.

**Asumsi perancang yang masih terbuka-eksplisit (tidak memblokir; pemilik dapat mengoreksi):** (a) entri stok batch berupa SATU halaman "Entri stok" bermode Masuk/Keluar/Koreksi (bukan tiga halaman), (b) satu lokasi per entri batch, (c) satu alasan untuk seluruh batch pada Keluar dan Koreksi (disalin ke tiap baris riwayat), (d) maksimal `STICKER_LIMITS.opnameRows` (100) baris per permintaan. Rincian di rencana 4a Task 2b dan 4b.
