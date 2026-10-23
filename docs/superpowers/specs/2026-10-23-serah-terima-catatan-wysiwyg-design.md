# Desain: Serah Terima berbasis Catatan (editor WYSIWYG, checklist, komentar, bulk)

Tanggal: 2026-10-23. Menggantikan arah PRD `2026-10-18-qc-serah-terima-catatan-checklist.md` dan rencana pelaksanaannya (lihat "Dokumen yang diganti"). Keputusan di bawah berasal dari percakapan dengan pemilik produk; yang berupa tebakan atau pilihan saya diberi tanda **[pilihan saya]** dan dikumpulkan di bagian "Pilihan yang saya ambil".

## 1. Maksud dan alasan

Saat WH membuat task serah terima, mereka sudah memegang teks permintaan (hampir selalu tempelan dari WhatsApp) berisi daftar item beserta jumlahnya. Memilih item katalog satu per satu hanya menambah pekerjaan, jadi item katalog tidak lagi dipakai di serah terima. Daftar item dan jumlahnya cukup ditempel ke **Catatan**. QC membaca catatan itu, mencentang tiap baris pekerjaan yang sudah selesai (atau langsung menyelesaikan satu task), dan dapat memberi komentar pada bagian teks tertentu. WH juga sering menerima beberapa permintaan sekaligus dalam satu tempelan, jadi pembuatan task harus bisa bulk.

Berhasil berarti: WH menempel tempelan WhatsApp, melihat task yang terbentuk dengan benar, mengoreksi seperlunya, dan menyimpan dalam hitungan detik; QC mengerjakan task tanpa pernah menyentuh katalog item.

## 2. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- Catatan serah terima berupa editor Markdown WYSIWYG (tampil langsung di tempat, tanpa tab Pratinjau dan tanpa tampilan berdampingan) dengan toolbar tipis di atasnya, mirip Tiptap.
- Editor yang sama menggantikan **semua** editor Markdown di aplikasi (saat ini hanya kolom Detail di form Item).
- Tempelan WhatsApp diubah otomatis secara mekanis menjadi checklist.
- QC mencentang tiap baris atau menyelesaikan seluruh task sekaligus.
- Teks catatan dapat dipilih lalu dikomentari lewat tombol "Balas" yang mengambang.
- Task dapat dibuat bulk, termasuk dari satu tempelan besar yang dipecah menjadi beberapa task.
- Daftar serah terima berbentuk **kanban di desktop dan daftar kartu di ponsel**, dengan isi catatan dan checklist langsung tampil di kartu sehingga QC tidak perlu membuka task satu per satu.

**Bukan-tujuan**
- Tidak ada drag-and-drop antar kolom kanban dan tidak ada status manual baru: kartu berpindah kolom hanya karena status turunan berubah (centang). Tidak ada dialog detail; klik kartu membuka halaman detail.
- Tidak memahami isi baris: nama item, jumlah, dan satuan tidak diurai menjadi data. Tidak ada AI atau penebak item. Jumlah hanya tulisan di catatan.
- Tidak ada pelacakan jumlah parsial atau melebihi target.
- Tidak ada balasan bersarang, penyelesaian utas, ubah, atau hapus komentar; tidak ada notifikasi atau kolaborasi mengetik bersamaan.
- Tidak mengubah katalog item, merk, atau sinkronisasi QC Desktop. Serah terima tidak masuk sinkronisasi.
- Tidak ada migrasi task lama: belum ada task di sheet mana pun.

**Anti-tujuan (gagal walau tampak jalan)**
- Tempelan terpecah salah lalu tersimpan tanpa WH sempat memeriksa.
- Centang QC hilang atau berpindah diam-diam setelah catatan diedit.
- Satu task dalam batch gagal tetapi yang lain tersimpan sebagian.
- HTML, skrip, atau URL berbahaya dari tempelan atau komentar dieksekusi.
- Bundel aplikasi membengkak tanpa terkontrol.

## 3. Keputusan pemilik produk

1. Item dan jumlah dimasukkan ke Catatan; item katalog tidak dipakai di Serah Terima.
2. Catatan adalah editor Markdown WYSIWYG dengan toolbar; berlaku untuk semua editor Markdown.
3. Batas catatan: **5.000 karakter**.
4. Sumber tempelan: **WhatsApp**; satu baris satu item beserta jumlahnya, kadang ada baris catatan.
5. Pemecahan tempelan menjadi task, aturan baris item, dan perlakuan baris catatan disetujui lewat contoh di bagian 9.
6. QC mencentang tiap baris pekerjaan atau menyelesaikan satu task langsung.
7. Satu batch **selalu satu lokasi**; customer boleh berbeda antar task. Cara masuk: (A) banyak form dalam satu halaman, (B) satu tempelan besar dipecah otomatis lalu dicek, (C) satu catatan yang sama untuk beberapa customer.
8. Komentar: pilih teks di catatan, lalu **tombol "Balas" mengambang muncul saat teks dipilih, di desktop maupun ponsel** (bukan menu klik kanan). **Siapa pun yang bisa melihat task** boleh berkomentar (WH, QC, pemantau).
9. Belum ada task sama sekali, sehingga model data boleh diganti tanpa jalur kompatibilitas.
10. Halaman daftar: **kanban untuk desktop, kartu untuk ponsel**; kartu langsung memperlihatkan detail catatan agar QC tidak membuka task satu per satu.

## 4. Perilaku

### 4.1 Editor Catatan (WYSIWYG)
- Satu komponen editor menggantikan `modules/markdown/markdown-editor.tsx`. Tampil langsung di tempat; toolbar tipis di atas berisi minimal: tebal, miring, daftar berbutir, daftar bernomor, checklist, kutipan.
- Format simpan tetap **Markdown** (teks biasa di sel Sheets). Pada form Item, Markdown yang sudah tersimpan harus tetap termuat dan tersimpan kembali tanpa perubahan makna, dan **penyisipan gambar** (tombol, paste, seret lewat modul `files`) beserta aturan render aman (HTML dibatasi, URL dibatasi) tetap berfungsi.
- Konversi tempelan WhatsApp, butir checklist, dan komentar **hanya aktif pada editor Catatan serah terima**. Editor Detail Item hanya berubah tampilannya menjadi WYSIWYG (toolbar yang sama, tanpa konversi WhatsApp) dan perilaku selebihnya tidak berubah **[pilihan saya]**. Catatan serah terima tidak mendukung penyisipan gambar **[pilihan saya]**.
- Batas catatan serah terima 5.000 karakter, ditegakkan di server dan di UI tanpa membuang draf. Batas Detail Item tidak berubah.
- Ponsel 375 px dan tema terang/gelap harus berfungsi.

### 4.2 Menempel dari WhatsApp
Perubahan terjadi saat paste di editor, memakai aturan mekanis (tanpa memahami isi):
1. Normalisasi CRLF; buang awalan pesan WhatsApp `[tanggal, jam] Nama:` yang ikut tersalin.
2. Format WhatsApp diubah ke format editor: `*tebal*`, `_miring_`, `~coret~`.
3. Baris berpola **`<teks> = <angka><satuan opsional>`** (ada tanda `=` diikuti angka; satuan bervariasi: "unt", "unit", "pcs", dsb.) menjadi **butir checklist** dengan teks apa adanya (termasuk keterangan di dalam tanda kurung pada baris itu).
4. Baris lain (judul, catatan seperti "kirim via J&T…") tetap **paragraf**, tidak ikut dicentang.
5. Awalan bullet atau nomor pada baris dibuang; penanda Markdown `- [ ]`/`- [x]` dikenali tanpa checkbox bertumpuk.
6. WH dapat mengubah satu baris dari checklist ke paragraf atau sebaliknya lewat toolbar. Paste di tengah teks mempertahankan teks sebelum dan sesudahnya; undo mengembalikan keadaan sebelum paste.
7. Menempel di editor satu task **tidak memecah** task dan tidak mengisi customer; pemecahan hanya pada jalur bulk (bagian 4.3) **[pilihan saya]**.

### 4.3 Bulk
- Lokasi dipilih satu kali di atas dan berlaku untuk seluruh batch; customer dipilih per task (kosong diperbolehkan).
- **Cara A:** satu halaman dengan beberapa kartu form (customer + editor Catatan per kartu); tombol tambah/hapus kartu; satu tombol "Simpan semua".
- **Cara B:** area "Tempel dari WhatsApp" menerima tempelan besar, memecahnya menjadi task, dan **menampilkan hasil pemecahan untuk dicek dan diedit sebelum disimpan**. Aturan pemecahan: baris **judul** (baris tanpa `=` yang berakhir `:` atau `-` setelah dirapikan, setelah awalan WhatsApp dibuang) memulai task baru; teks judul (tanpa tanda baca akhir) menjadi **usulan** customer yang dapat diganti WH, dan tidak dibuang kata apa pun darinya **[pilihan saya]**; baris item dan baris lain setelah judul masuk ke task itu sampai judul berikutnya; teks sebelum judul pertama (bila ada) menjadi task tanpa customer.
- **Cara C:** tombol pada sebuah kartu untuk menggandakannya (catatan sama, customer kosong) agar satu catatan dapat dipakai untuk beberapa customer **[pilihan saya]**.
- Penyimpanan batch **atomik**: semua task tersimpan atau tidak ada yang tersimpan; bila gagal, WH melihat task mana yang bermasalah dan drafnya utuh. Maksimal **30 task per batch** **[pilihan saya]**. Tiap task mendapat nomor sendiri (`ST-YYYYMMDD-NNN`, dialokasikan berurutan di dalam lock) dan audit sendiri. Customer baru dibuat seperti sekarang (inline saat disimpan).

### 4.4 Checklist, centang, dan status
- Setiap butir checklist dapat dicentang oleh QC (izin `qc: edit` di lokasi task). Centang menyimpan pelaku dan waktu, tersimpan lewat reload, dan dapat dibatalkan. Pembaruan centang bersifat idempoten per butir (set "dicentang/tidak"), bukan toggle buta, agar dua QC tidak saling membatalkan.
- "Selesaikan task" mencentang seluruh butir yang belum dicentang. Task **tanpa butir checklist** tetap dapat ditandai selesai dan dibuka lagi lewat tombol yang sama **[pilihan saya]**.
- Status turunan: **Baru** (tidak ada yang dicentang), **Dikerjakan** (sebagian), **Selesai** (semua butir tercentang, atau ditandai selesai bila tanpa butir), **Dibatalkan** (disimpan, seperti sekarang).
- WH (izin `handover: edit`) dapat mengubah isi catatan. Mengubah teks butir yang sudah dicentang **mereset** centang butir itu dan tercatat di audit; menghapus atau mengonversi butir yang sudah dicentang **ditolak** **[pilihan saya]**; mengubah urutan butir mempertahankan centang. Task Dibatalkan tidak menerima perubahan isi, centang, atau komentar.
- Perubahan isi memakai pemeriksaan versi (`expectedUpdatedAt`); bila ditolak karena perubahan lain, draf WH dipertahankan dan hasil terbaru dapat dimuat.

### 4.5 Komentar
- Memilih teks di catatan (desktop dan ponsel) langsung memunculkan tombol **"Balas"** mengambang di dekat seleksi; menekannya membuka kotak komentar kecil. Tidak ada menu klik kanan.
- Komentar menyimpan: kutipan teks terpilih, jangkar posisi (cukup untuk menemukan kutipan lagi walau teks berulang), isi komentar, pelaku, dan waktu. Kutipan ditandai di catatan; daftar komentar menampilkan kutipan dan isinya.
- Boleh oleh siapa pun yang punya akses **lihat** ke lokasi task (WH atau QC, termasuk yang hanya bisa melihat). Hanya menambah: tidak ada ubah, hapus, atau balasan bersarang **[pilihan saya]**.
- Bila teks kutipan kemudian berubah atau hilang, komentar ditandai **usang** tetapi tetap tampil dengan kutipan aslinya; kutipan usang tidak ditandai seolah masih valid. Mengubah urutan atau mencentang tidak memindahkan komentar.
- Batas: isi komentar 1.000 karakter, maksimal 50 komentar per task **[pilihan saya]**. Isi komentar dirender aman (tanpa HTML).

### 4.6 Daftar (kanban/kartu) dan detail
- **Desktop:** kanban tiga kolom **Baru, Dikerjakan, Selesai** menurut status turunan. Kartu berpindah kolom sendiri saat centang berubah; tanpa drag-and-drop.
- **Ponsel:** satu daftar kartu (terbaru di atas) dengan label status dan filter (Semua, Baru, Dikerjakan, Selesai). Pemisahan desktop/ponsel mengikuti titik putus layar `md` Tailwind (768 px) **[pilihan saya]**.
- **Isi kartu:** nomor, customer, label status, isi catatan sebagai teks Markdown yang dirender (butir checklist yang **dapat dicentang langsung dari kartu** oleh QC dengan `qc: edit`; baca-saja bagi lainnya), progres centang (mis. 1/2), jumlah komentar, dan pelaku/waktu centang terakhir. Catatan yang panjang dipotong dengan tombol "Lihat semua" **[pilihan saya]**; klik badan kartu membuka halaman detail lengkap (komentar dan riwayat). Mencentang atau menekan tautan di kartu tidak boleh sekaligus membuka detail.
- **Task Dibatalkan** disembunyikan secara bawaan dan tampil lewat pilihan "Tampilkan dibatalkan" **[pilihan saya]**. Kolom Selesai memuat task selesai terbaru saja dengan tombol "muat lebih lama" **[pilihan saya]**.
- Seluruh isi board (catatan, state centang, jumlah komentar) diambil dalam **satu RPC** untuk lokasi terpilih, bukan satu panggilan `get` per kartu; pemantauan lokasi, filter, dan posisi gulir tidak hilang setelah mencentang atau kembali dari halaman detail. Keadaan kosong, galat, dan "belum memilih lokasi" punya tampilan jelas; data satu task yang rusak tidak menghilangkan kartu lain.
- Halaman detail menampilkan catatan di editor yang sama: bagi QC centang dapat diklik, bagi yang hanya melihat bersifat baca-saja; panel komentar tampil di samping atau di bawah.
- Form buat/ubah task memakai editor Catatan; pemilihan item dihapus.

## 5. Model data (arah, rincian diserahkan ke pembangun)
- Sheet `handovers` tetap; kolom `note` menjadi Markdown (≤ 5.000 karakter). Ditambah penyimpanan terpisah untuk status centang (siapa dan kapan), komentar, dan penanda selesai untuk task tanpa checklist; masing-masing dalam sel sendiri agar batas sel Sheets (50.000 karakter) tidak habis, dengan batas JSON per sel mengikuti konvensi proyek (40.000 karakter).
- `handover_lines` dan seluruh ketergantungan ke katalog item (rujukan item, label item, qty, done_qty, saran item) dihapus dari kode serah terima; sheet kosong yang sudah ada dibiarkan.
- RPC `handovers.save` menerima catatan saja (tanpa baris item). RPC `setProgress`, `completeLine`, `completeAll` digantikan oleh operasi centang per butir, selesaikan task, dan komentar; ditambah `handovers.saveBatch` dan `handovers.board` (isi lengkap kartu dalam satu panggilan). Komentar memakai izin baca (`anyOf` WH/QC lihat, berlokasi); centang memakai `qc: edit`; isi dan batch memakai `handover: edit`; pembatalan tetap `handover: manage`.

## 6. Batasan proyek yang berlaku
Aturan kode GAS di `CLAUDE.md` (akhiran `_`, nama top-level unik, tulis lewat `core/db` di dalam `withLock`, API GAS hanya lewat `platform_()`, tanpa API JS yang tidak ada di Apps Script), render Markdown aman, teks Sheets aman dari formula injection, form TanStack Form + zod, komponen shadcn, aturan performa (batching RPC, cache, `withRequestCache_`), dan jangan menaruh kode mock di build produksi. Dokumen yang wajib ikut diperbarui: PRD, `docs/e2e-checklist.md`, `CLAUDE.md`.

## 7. Library editor dan ukuran bundel
Saya memilih **Tiptap** (ekstensi daftar tugas dan Markdown) **[pilihan saya]**; pemilik hanya meminta pengalaman seperti Tiptap. Bundel produksi saat ini sekitar 2,4 MB (±955 KB gzip) dengan editor lama. Anggaran: tambahan paling banyak sekitar 450 KB mentah dan 150 KB gzip **[pilihan saya]**; bila lebih, pembangun melapor dan memilih alternatif sebelum lanjut. Editor lama (`markdown-editor.tsx` dan `edit-ops.ts`) dihapus bila tidak lagi dipakai.

## 8. Dokumen yang diganti
- `docs/prd/2026-10-18-qc-serah-terima-catatan-checklist.md` dan `docs/superpowers/plans/2026-10-18-qc-serah-terima-catatan-checklist.md`: ditandai digantikan oleh dokumen ini (dialog detail dan aturan "WH/pemantau tidak boleh berkomentar" tidak berlaku; kanban/kartu dipakai, dengan bentuk yang ditetapkan di bagian 4.6).
- `docs/prd/2026-10-09-qc-item-serah-terima.md` (FH1–FH9, FQ1–FQ6): diperbarui agar tidak lagi menyebut item katalog dan qty pada serah terima.

## 9. Contoh penerimaan (disetujui pemilik)
Tempelan WhatsApp nyata dan hasil yang benar:

1. `Orderan Online :` / `CRS310 = 1 unt` / `RB5009UG = 1 unt` → **1 task**, usulan customer "Orderan Online", dua butir checklist.
2. `[22/10, 10.57] Mas_Aden JH: CV.Prisma :` / `V1600GS-ZF = 200 unit` / `[22/10, 11.01] Mas_Aden JH: HND Gemilang :` / `VT-861 = 1 unit` → **2 task** (CV.Prisma: satu butir; HND Gemilang: satu butir); awalan WhatsApp dibuang.
3. `Orderan Pak OKY - ` / `CCR2116 = 1 unit (Kirim dari SBY - TANPA DOKUMENT APAPUN)` / `kirim via J&T Merah kalo bisa` / (kosong) / `Mintol foto SN - Foto Unit sebelum packing & setelah packing` → **1 task**, usulan customer "Orderan Pak OKY" (WH dapat mengoreksi); satu butir checklist; dua baris terakhir tetap paragraf catatan.
4. `Lintasmaya :` / `AF 5XHD = 16 unt` (kosong) `Mitra Tower :` / `RD-5G34 = 8 unt` (kosong) `CV. Tepian :` / `RD-5G34 = 5 unt` / `POE 24-12W = 50 unt` → **3 task**; yang ketiga punya dua butir checklist.

Kriteria lain yang dapat diuji:
- Di desktop daftar tampil sebagai kanban tiga kolom dan di ponsel (< 768 px) sebagai daftar kartu; mencentang di kartu memindahkan kartu ke kolom yang sesuai tanpa memuat ulang halaman dan tanpa membuka detail; catatan panjang dipotong dengan "Lihat semua".
- Board satu lokasi dimuat dengan satu RPC (bukan satu per task); satu task berdata rusak tidak menghilangkan kartu lain.
- Task dengan catatan > 5.000 karakter ditolak utuh di server dan UI tanpa kehilangan draf.
- Batch dengan satu task tidak valid tidak menyimpan apa pun dan menunjuk task yang bermasalah.
- Akses ke task lokasi lain ditolak tanpa membocorkan isi; QC tanpa `handover: edit` tidak dapat menyimpan isi; pengguna tanpa `qc: edit` tidak dapat mencentang; pemantau (lihat saja) dapat berkomentar.
- Mengedit teks butir yang sudah dicentang mereset centang butir itu dan tercatat di audit; menghapus butir yang sudah dicentang ditolak.
- Dua klien yang menyimpan isi pada versi yang sama tidak saling menimpa: yang kedua ditolak dan drafnya dipertahankan.
- Markdown Detail Item yang sudah ada tetap termuat dan tersimpan kembali sama maknanya di editor baru, termasuk gambar.
- Create, ubah, centang, batal centang, selesaikan, komentar, dan batal menghasilkan audit dengan pelaku dan perubahan yang terbaca; centang tanpa perubahan tidak menambah audit.
- Tidak ada HTML atau skrip dari tempelan, Markdown, atau komentar yang dieksekusi.
- `bun run check` dan `bun run build` lulus.

## 10. Diserahkan kepada pembangun
Pilihan ekstensi Tiptap dan cara serialisasi Markdown; algoritma jangkar komentar; format penyimpanan centang dan komentar; bentuk persis RPC; tata letak mikro (posisi tombol, panel komentar); penyetelan batas yang tidak disebut; urutan pekerjaan; cara memasok data uji WhatsApp; dan apakah pemecah tempelan ditaruh di `shared/` (murni, tanpa API GAS atau DOM) agar dipakai FE dan dites bersama.

## 11. Pilihan yang saya ambil (mohon diperiksa)
1. Kanban (desktop) dan kartu (ponsel) mengikuti permintaan Anda; yang saya pilih: titik putus 768 px, kartu memuat catatan terpotong dengan "Lihat semua", klik kartu membuka halaman detail, task dibatalkan disembunyikan secara bawaan, kolom Selesai dibatasi ke yang terbaru dengan "muat lebih lama".
2. Menempel di editor satu task tidak memecah task.
3. Usulan customer = teks judul apa adanya tanpa tanda baca akhir.
4. Cara C berupa tombol gandakan kartu.
5. Maksimal 30 task per batch; komentar 1.000 karakter, 50 per task, hanya tambah.
6. Task tanpa checklist dapat ditandai selesai dan dibuka lagi.
7. Menghapus butir yang sudah dicentang ditolak; mengubah teksnya mereset centang.
8. Tiptap, dengan anggaran bundel tambahan ±450 KB mentah / ±150 KB gzip.
9. "Balas" diartikan komentar pada teks terpilih, bukan utas balas-membalas.
10. Konversi WhatsApp, checklist, dan komentar hanya di editor Catatan serah terima; editor Item hanya berubah tampilan. Catatan serah terima tanpa gambar.
11. Bila ada dua butir bertulisan sama dalam satu task, pencocokan centang saat catatan diedit memakai urutan kemunculan; pembangun menentukan algoritma persisnya.
