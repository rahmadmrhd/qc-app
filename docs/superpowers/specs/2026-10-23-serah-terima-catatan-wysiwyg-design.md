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
10. Halaman daftar: **kanban untuk desktop, kartu untuk ponsel**; kartu langsung memperlihatkan **seluruh** catatan agar QC tidak membuka task satu per satu; **tidak ada task yang disembunyikan**; tiap kartu punya tombol **Mark done** dan **More**.

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
3. Baris item = baris yang memuat pemisah jumlah **`=` atau `:` diikuti angka** (spasi di sekitarnya bebas; satuan bervariasi: "unt", "unit", "pcs", "Set", dsb.; contoh `RB 1100 X4    :3 unit (1 unit sudah di ciwo)`, `SFP C++++ 8 unit = 5 Set`) menjadi **butir checklist** dengan teks apa adanya (termasuk keterangan di dalam tanda kurung pada baris itu).
4. Baris lain (judul, catatan seperti "kirim via J&T…") tetap **paragraf**, tidak ikut dicentang.
5. Awalan bullet atau nomor pada baris dibuang; penanda Markdown `- [ ]`/`- [x]` dikenali tanpa checkbox bertumpuk.
6. WH dapat mengubah satu baris dari checklist ke paragraf atau sebaliknya lewat toolbar. Paste di tengah teks mempertahankan teks sebelum dan sesudahnya; undo mengembalikan keadaan sebelum paste.
7. Menempel di editor satu task **tidak memecah** task dan tidak mengisi customer; pemecahan hanya pada jalur bulk (bagian 4.3), yang sejak 2026-11-13 menjadi satu-satunya jalur membuat task (bagian 12 butir 14) **[pilihan saya]**.

### 4.3 Bulk
- **Satu-satunya jalur membuat task** (keputusan pemilik 2026-11-13, bagian 12 butir 14): halaman Tambah task tidak lagi punya mode "Satu task"; task tunggal = satu kartu.
- Lokasi dipilih satu kali di atas dan berlaku untuk seluruh batch; customer dipilih per task (kosong diperbolehkan).
- **Cara A:** satu halaman dengan beberapa kartu form (customer + editor Catatan per kartu); tombol tambah/hapus kartu; satu tombol "Simpan semua".
- **Cara B:** area "Tempel dari WhatsApp" menerima tempelan besar, memecahnya menjadi task, dan **langsung menambahkan hasil pemecahan sebagai kartu ke batch** lewat satu tombol "Pecah" (tanpa pratinjau dan tanpa langkah "Tambahkan" terpisah; bagian 12 butir 14); WH mengecek dan mengedit customer dan catatan di kartu (editor Catatan yang sama) sebelum "Simpan semua". Aturan pemecahan **[diperbarui 2026-10-23 setelah contoh WhatsApp tambahan]**: (a) setiap **pesan WhatsApp** (baris berawalan `[tanggal, jam] Nama:`) memulai blok baru; (b) baris **judul** = baris non-item yang **langsung diikuti baris item** (baris kosong di antaranya diabaikan), **apa pun simbol akhirnya, termasuk tanpa simbol** (contoh `D~net`, `Cv. Prisma,`, `Indo Akses,`, `Lintasmaya :`, `Orderan Pak OKY -`) dan boleh berada di baris yang sama dengan awalan WhatsApp (`[19/8, 10.53] Mas_Hendra WHJH: D~net` → judul `D~net`); judul memulai task baru dan tidak masuk `note`; (c) usulan customer = teks judul dengan tanda baca akhir (`: - , ;`) dan spasi dibuang, tidak ada kata yang dibuang; (d) baris item dan baris non-item lain setelah judul masuk ke task itu sampai judul/pesan berikutnya; baris non-item yang berada di antara dua baris item tanpa baris kosong dianggap judul task berikutnya (WH dapat mengoreksi di pratinjau) **[pilihan saya]**; (e) teks sebelum judul pertama (bila ada) menjadi task tanpa customer; (f) pesan dengan customer yang sama (mis. `Indo Akses` dua kali) tetap menjadi task terpisah **[pilihan saya]**.
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
- **Desktop:** kanban empat kolom **Baru, Dikerjakan, Selesai, Dibatalkan** menurut status. Kartu berpindah kolom sendiri saat centang berubah; tanpa drag-and-drop.
- **Ponsel:** satu daftar kartu (terbaru di atas) dengan label status dan filter (Semua, Baru, Dikerjakan, Selesai). Pemisahan desktop/ponsel mengikuti titik putus layar `md` Tailwind (768 px) **[pilihan saya]**. Filter ponsel (Semua, Baru, Dikerjakan, Selesai, Dibatalkan) hanya menyaring tampilan; bawaannya "Semua".
- **Isi kartu:** nomor, customer, label status, **seluruh isi catatan** (tidak dipotong dan tidak ada "Lihat semua") sebagai teks Markdown yang dirender, dengan butir checklist yang **dapat dicentang langsung dari kartu** oleh QC dengan `qc: edit` (baca-saja bagi lainnya), progres centang (mis. 1/2), jumlah komentar, dan pelaku/waktu centang terakhir. Klik badan kartu membuka halaman detail lengkap (komentar dan riwayat); mencentang, menekan tautan, atau menekan tombol di kartu tidak boleh sekaligus membuka detail.
- **Tombol pada setiap kartu:** **Mark done** dan **More**. *Mark done* (izin `qc: edit`) menyelesaikan task (mencentang semua butir; untuk task tanpa butir menandainya selesai); pada kartu yang sudah selesai tombol ini menjadi aksi membuka kembali. *More* membuka menu aksi lain, dan **tombol More hanya ada bila pengguna itu punya minimal satu aksi di dalamnya**; bila tidak ada, tombolnya tidak ditampilkan sama sekali. Isi menu **[pilihan saya]**: *Ubah* (butuh `handover: edit`) dan *Batalkan* (butuh `handover: manage`, dengan konfirmasi); aksi yang tidak diizinkan tidak muncul. Tidak ada aksi Hapus (serah terima tidak pernah dihapus, hanya dibatalkan, sesuai perilaku sekarang dan agar jejak audit utuh); membuka detail cukup lewat klik badan kartu. Jadi pengguna yang hanya QC melihat Mark done tanpa More.
- **Tidak ada yang disembunyikan:** seluruh task tampil, termasuk Dibatalkan (kolom keempat di kanban; label dan filter di ponsel) dan semua task Selesai tanpa batas jumlah atau tanggal. Konsekuensinya waktu muat board tumbuh seiring jumlah task; pembangun mengukur dan **melapor bila board satu lokasi melewati sekitar 300 task** agar kita memutuskan langkah berikutnya, bukan memangkasnya sendiri.
- Seluruh isi board (catatan, state centang, jumlah komentar) diambil dalam **satu RPC** untuk lokasi terpilih, bukan satu panggilan `get` per kartu; pemantauan lokasi, filter, dan posisi gulir tidak hilang setelah mencentang atau kembali dari halaman detail. Keadaan kosong, galat, dan "belum memilih lokasi" punya tampilan jelas; data satu task yang rusak tidak menghilangkan kartu lain.
- Halaman detail menampilkan catatan di editor yang sama: bagi QC centang dapat diklik, bagi yang hanya melihat bersifat baca-saja; panel komentar tampil di samping atau di bawah.
- Form buat/ubah task memakai editor Catatan; pemilihan item dihapus.

## 5. Model data (arah, rincian diserahkan ke pembangun)
- Sheet `handovers` tetap; kolom `note` menjadi Markdown (≤ 5.000 karakter). Ditambah penyimpanan terpisah untuk status centang (siapa dan kapan), komentar, dan penanda selesai untuk task tanpa checklist; masing-masing dalam sel sendiri agar batas sel Sheets (50.000 karakter) tidak habis, dengan batas JSON per sel mengikuti konvensi proyek (40.000 karakter).
- `handover_lines` dan seluruh ketergantungan ke katalog item (rujukan item, label item, qty, done_qty, saran item) dihapus dari kode serah terima; sheet kosong yang sudah ada dibiarkan.
- RPC `handovers.save` menerima catatan saja (tanpa baris item). RPC `setProgress`, `completeLine`, `completeAll` digantikan oleh operasi centang per butir, selesaikan task, dan komentar; ditambah `handovers.saveBatch` dan `handovers.board` (isi lengkap kartu dalam satu panggilan). Komentar memakai izin baca (`anyOf` WH/QC lihat, berlokasi); centang memakai `qc: edit`; isi dan batch memakai `handover: edit`; pembatalan tetap `handover: manage`.

## 6. Batasan proyek yang berlaku
Aturan di `CLAUDE.md`, render Markdown aman, teks Sheets aman dari formula injection, form TanStack Form + zod, komponen shadcn, aturan performa (batching RPC, cache, `withRequestCache_`), dan jangan menaruh kode mock di build produksi. Dokumen yang wajib ikut diperbarui: PRD, `docs/e2e-checklist.md`, `CLAUDE.md`.

## 7. Library editor dan ukuran bundel
Saya memilih **Tiptap** (ekstensi daftar tugas dan Markdown) **[pilihan saya]**; pemilik hanya meminta pengalaman seperti Tiptap. Bundel produksi saat ini sekitar 2,4 MB (±955 KB gzip) dengan editor lama. Anggaran: tambahan paling banyak sekitar 450 KB mentah dan 150 KB gzip **[pilihan saya]**; bila lebih, pembangun melapor dan memilih alternatif sebelum lanjut. Editor lama (`markdown-editor.tsx` dan `edit-ops.ts`) dihapus bila tidak lagi dipakai.

## 8. Dokumen yang diganti
- `docs/prd/2026-10-18-qc-serah-terima-catatan-checklist.md`: ditandai digantikan oleh dokumen ini (dialog detail dan aturan "WH/pemantau tidak boleh berkomentar" tidak berlaku; kanban/kartu dipakai, dengan bentuk yang ditetapkan di bagian 4.6).
- `docs/prd/2026-10-09-qc-item-serah-terima.md` (FH1–FH9, FQ1–FQ6): diperbarui agar tidak lagi menyebut item katalog dan qty pada serah terima.

## 9. Contoh penerimaan (disetujui pemilik)
Tempelan WhatsApp nyata dan hasil yang benar:

1. `Orderan Online :` / `CRS310 = 1 unt` / `RB5009UG = 1 unt` → **1 task**, usulan customer "Orderan Online", dua butir checklist.
2. `[22/10, 10.57] Mas_Aden JH: CV.Prisma :` / `V1600GS-ZF = 200 unit` / `[22/10, 11.01] Mas_Aden JH: HND Gemilang :` / `VT-861 = 1 unit` → **2 task** (CV.Prisma: satu butir; HND Gemilang: satu butir); awalan WhatsApp dibuang.
3. `Orderan Pak OKY - ` / `CCR2116 = 1 unit (Kirim dari SBY - TANPA DOKUMENT APAPUN)` / `kirim via J&T Merah kalo bisa` / (kosong) / `Mintol foto SN - Foto Unit sebelum packing & setelah packing` → **1 task**, usulan customer "Orderan Pak OKY" (WH dapat mengoreksi); satu butir checklist; dua baris terakhir tetap paragraf catatan.
4. `Lintasmaya :` / `AF 5XHD = 16 unt` (kosong) `Mitra Tower :` / `RD-5G34 = 8 unt` (kosong) `CV. Tepian :` / `RD-5G34 = 5 unt` / `POE 24-12W = 50 unt` → **3 task**; yang ketiga punya dua butir checklist.

5. (Contoh tambahan pemilik; tanpa simbol, koma, dan pemisah `:`)
   `[19/8, 10.53] Mas_Hendra WHJH: D~net` / `RB 1100 X4               :3 unit (1 unit sudah di ciwo)` / `CCR2116-12G-4S+   : 3 unit` / `CCR2004-16G-2S+    : 2 unit` / `[28/9, 10.14] Mas_Aden JH: Cv. Prisma,` / `Paket V1600G1-B (AC+DC 48V) with SFP C++++ 8 unit = 5 Set` / `[28/9, 10.49] Mas_Aden JH: Indo Akses,` / `CCR2116-12g-4S+ = 2 unit` / `[28/9, 11.53] Mas_Aden JH: Indo Akses,` / `SFP C++++ = 10 unit` / `PX20 ++++ = 10 unit` / `[29/9, 12.30] Mas-Indi: Cv. Prisma,` / `Paket V1600G1-B (AC+DC 48V) with SFP C++++ 8 unit = 50 Set` / `[2/10, 08.57] Mas_Aden JH: Surya Dexacom,` / `POE-24V-12W Gig = 3 unit` / `[2/10, 15.41] Mas_Aden JH: Dutakom,` / `U6-Pro = 1 unit` → **7 task**: `D~net` (3 butir; butir pertama `RB 1100 X4 :3 unit (1 unit sudah di ciwo)` dengan spasi dirapikan), `Cv. Prisma` (1 butir, 5 Set), `Indo Akses` (1 butir), `Indo Akses` (2 butir), `Cv. Prisma` (1 butir, 50 Set), `Surya Dexacom` (1 butir), `Dutakom` (1 butir).

6. (Contoh tambahan pemilik; judul berisi angka/koma, baris kosong setelah judul, item tanpa satuan) `[2/10, 08.35] Mas_Hendra WHJH: Orderan Online dari 3 resi` / `UAP-AC-IW : 6 unit` / `[7/10, 08.23] Mas-Indi: Alokasi SAS, pengambilan nyicil` / (kosong) / `AF-5XHD-EU = 20` / `LBE-M5-23-EU = 20` / `RD-5G30 = 6` / `RD-5G30-LW = 20` / `U6-Mesh-Pro-EU = 10` / `UAP-AC-PRO-EU = 30` / `USW-Flex-2.5G-5-EU = 3` → **2 task**: `Orderan Online dari 3 resi` (1 butir) dan `Alokasi SAS, pengambilan nyicil` (7 butir; usulan customer memuat koma di tengah, hanya tanda baca AKHIR yang dibuang).

Kriteria lain yang dapat diuji:
- Di desktop daftar tampil sebagai kanban empat kolom (Baru, Dikerjakan, Selesai, Dibatalkan) dan di ponsel (< 768 px) sebagai daftar kartu; **seluruh** catatan tampil di kartu tanpa dipotong dan tidak ada task yang disembunyikan; mencentang di kartu memindahkan kartu ke kolom yang sesuai tanpa memuat ulang halaman dan tanpa membuka detail.
- Tombol **Mark done** pada kartu menyelesaikan task (dan membukanya kembali bila sudah selesai); pengguna tanpa `qc: edit` tidak melihat Mark done aktif. Tombol **More** hanya tampil bila ada minimal satu aksi yang boleh dilakukan pengguna (Ubah atau Batalkan); pengguna yang hanya QC tidak melihat More.
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
1. Kanban (desktop) dan kartu (ponsel), seluruh catatan tanpa dipotong, tanpa task yang disembunyikan, serta tombol Mark done dan More mengikuti permintaan Anda; yang saya pilih: titik putus 768 px, klik badan kartu membuka halaman detail, kolom Dibatalkan sebagai kolom keempat, isi menu More (hanya Ubah dan Batalkan; tanpa Hapus karena serah terima tidak pernah dihapus), dan aksi Mark done berubah menjadi "buka kembali" pada kartu selesai.
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

## 12. Addendum setelah uji coba pemilik (2026-10-23) — MENGGANTIKAN bagian yang bertentangan

Keputusan pemilik produk setelah mencoba aplikasi dan membaca review akhir. Bila bertentangan dengan bagian 3–11, bagian ini yang berlaku.

1. **Tombol aksi kartu menurut status.** *Mark done* hanya pada status **Baru** dan **Dikerjakan**. Pada **Selesai** tidak ada Mark done dan tidak ada "Buka kembali" (task selesai tidak dibuka kembali; server menolak `setDone` dengan `done: false` — kontrak menjadi `handovers.setDone { id, locationId }` tanpa field `done`). **"Buka kembali" hanya ada pada status Dibatalkan** (izin `handover: manage`, RPC baru `handovers.reopen`): mengembalikan task Dibatalkan menjadi tidak dibatalkan (status turunan dari centang yang ada; centang tidak hilang), diaudit (`handover.uncancel`). *More* tetap hanya bila ada aksi: *Ubah* (bukan untuk task Dibatalkan) dan *Batalkan* (bukan untuk Selesai/Dibatalkan).
2. **Kanban: hanya daftar kartu per kolom yang bergulir.** Judul kolom dan status/hitungan kolom tetap di atas (tidak ikut bergulir); tiap kolom punya area gulir sendiri untuk kartunya. Halaman desktop tidak bergulir vertikal untuk papan. Ponsel: daftar kartu bergulir normal.
3. **Warna status.** Selesai = **hijau**, Dikerjakan = **biru** (label status, aksen kolom/kartu; terang dan gelap, kontras memadai). Baru netral; Dibatalkan muted.
4. **Urutan.** Daftar (di tiap kolom kanban dan di daftar kartu ponsel) mengurutkan **yang belum selesai di atas**: peringkat status Baru → Dikerjakan → Selesai → Dibatalkan; di dalam status, terbaru dahulu (`updatedAt` menurun); pada Dikerjakan, progres lebih sedikit selesai di atas **[pilihan saya]** lalu terbaru.
5. **Sorotan kutipan komentar harus terbaca**: warna sorotan tidak boleh mengganggu atau menurunkan kontras teks (latar semitransparan lembut di terang dan gelap; teks tidak berubah warna).
6. **Komentar di halaman daftar.** Komentar dapat dibaca dan ditambah langsung pada kartu (tanpa membuka detail): kartu menampilkan komentar task (semua, ringkas) dan tombol tambah komentar. Karena itu `handovers.board` **tetap mengirim isi komentar** (tidak hanya jumlah); keputusan sisi review "board hanya jumlah" DIBATALKAN. Risiko payload board yang besar diterima pemilik; tidak ada pembatas laju/hapus/paginasi.
7. **Komentar tanpa seleksi.** Komentar dapat ditambahkan **langsung tanpa memilih teks**: tombol "Tambah komentar" pada kartu dan halaman detail membuka kotak komentar; komentar umum ini bertanda `quote: ''` (tanpa kutipan, tidak pernah "usang"). Memilih teks dan tombol "Balas" mengambang tetap ada. Validator: `quote` boleh kosong; `body` wajib 1–1.000 karakter.
8. **Batas komentar:** per komentar 1.000 karakter (tetap); total per task **maks. 50 komentar ATAU 40.000 karakter JSON, mana lebih dulu**, dengan pesan galat yang menjelaskan.
9. **Batas butir:** satu catatan maks. **300 butir checklist**; lebih dari itu ditolak di validator `save`/`saveBatch` (dan di UI) dengan pesan jelas pada `note`.
10. **Bundel:** pemilik meminta **pemuatan malas (lazy load) bagian yang tidak dibutuhkan di awal atau jarang dipakai** (pustaka PDF/ekspor QR, dan bila layak editor Tiptap). Karena aplikasi satu berkas, ini membutuhkan pemuatan potongan dari server (`google.script.run`) dan harus divalidasi di Apps Script sungguhan; dikerjakan sebagai pekerjaan terpisah setelah perbaikan ini. Sementara itu tambahan +165 KB gzip dan `MAX_INDEX_BYTES` 3,3 MB diterima.
11. **Dibatalkan merah; detail dibuka lewat badan kartu, nomor, atau Ubah.** Status Dibatalkan berwarna merah (label, aksen kartu, kolom; terang dan gelap). Diubah oleh keputusan pemilik 2026-11-22 (lihat `2026-11-22-revisi-tampilan-lanjutan-design.md` B9; sebelumnya "badan kartu TIDAK membuka detail"): badan kartu kini membuka detail task, dengan penjaga klik agar tidak salah klik: klik pada centang, komposer komentar, tombol footer, tautan, dan kontrol interaktif lain di kartu, klik dari luar DOM kartu (menu/dialog), dan klik saat ada teks terseleksi TIDAK membuka detail. Detail juga tetap dapat dibuka lewat klik nomor task, atau lewat opsi Ubah di menu More (membuka halaman ubah).
12. **Simpan tidak CONFLICT bila hanya centang berubah.** Form ubah mengirim keadaan dasar (`base`: catatan, customer, status) saat dibuka. Jika `updatedAt` sudah berbeda, simpan tetap berhasil selama catatan dan customer masih sama dengan `base` dan status tidak berpindah ke atau dari Selesai (centang, komentar, dan progres yang masuk di tengah tidak memicu CONFLICT; centang terkini dipertahankan lewat `reconcileChecks`). Catatan/customer berubah, atau status menjadi Selesai/Dibatalkan, tetap CONFLICT. Tanpa skema sheet baru.
13. **Centang instan dengan antrean serial.** Klik centang langsung tampil (update optimistis, hanya butir itu; penanda halus "Menyimpan…"). `handovers.setCheck` dikirim serial per task (task berbeda paralel; tiap klik satu RPC); respons server menimpa cache setelah antrean task kosong. Bila gagal, hanya butir itu dikembalikan dengan pesan galat dan antrean lanjut; CONFLICT memuat ulang task. Mark done, Batalkan, dan Buka kembali menunggu antrean centang task itu kosong.
14. **Tambah task hanya bulk; hasil pecah tampil di editor (2026-11-13, keputusan pemilik produk).** Form Tambah task tidak lagi memiliki mode "Satu task" maupun pengalih mode: halaman `/handover/new` langsung memakai form bulk (lokasi sekali, panel Tempel dari WhatsApp, kartu task; task tunggal = satu kartu, judul "Tambah task"). Form ubah (`/handover/$handoverId/edit`) tetap satu task. Pada panel Tempel dari WhatsApp, tombol "Pecah" kini langsung menambahkan hasilnya sebagai kartu ke batch (kartu kosong awal diganti), tanpa area pratinjau dan tanpa tombol "Tambahkan ke batch"; koreksi customer dan catatan dilakukan di kartu, yang memakai editor Catatan (Tiptap) sehingga tampilannya konsisten. Bila hasil pecah melebihi sisa slot (maks. 30), tidak ada kartu yang ditambahkan, pesan galat tampil, dan teks tempelan dipertahankan; bila tidak ada task yang dikenali, tampil pesan dan tidak ada kartu. Setelah berhasil, kotak tempelan dikosongkan dan tampil pesan "N task ditambahkan ke batch.". Mengubah bagian 4.2 butir 7, 4.3, dan kebutuhan tampilan pratinjau pecahan; kontrak REST (`handovers.save`/`saveBatch`) tidak berubah. Alasan: satu jalur lebih sederhana dan pratinjau yang sama dengan hasil akhir mengurangi kejutan.
