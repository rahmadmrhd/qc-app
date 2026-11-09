# Stiker Management, tahap 3b-1: pustaka gambar dan dialog berkas umum

Status: **menunggu persetujuan pemilik produk.** Tanggal: 2026-11-09.
Induk: `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md` (§6 mencatat keputusan 3b), `docs/superpowers/specs/2026-11-08-business-unit-design.md` (keputusan 23). Cabang kerja: `feat/stiker-pustaka-gambar` (dari `dev` setelah PR 47 untuk 3a di-merge).
Tahap 3b dipecah dua (disetujui pemilik 2026-11-09): **3b-1** (dokumen ini) lalu **3b-2** (penempatan gambar di item, penanda gaya tag foto, tampilan label di detail item, penggantian daftar stiker lama).

## 1. Tujuan

Orang yang mengatur item (siapa saja yang berizin ubah item) perlu melampirkan gambar acuan penempelan stiker ke item tanpa mengunggah ulang gambar yang sama berkali-kali (hemat ruang Drive dan waktu). Tahap ini menyediakan:

1. **Pustaka gambar** khusus instruksi stiker (kolam gambar terpisah dari lampiran item).
2. **Dialog berkas umum** untuk memilih atau mengunggah berkas dari sebuah pustaka; dirancang agar dapat dipakai di tempat lain.
3. **Halaman Pustaka Gambar** (menu Stiker) tempat pustaka dikelola: dilihat, diunggah, diganti namanya, dan dihapus. Halaman ini membuat 3b-1 sudah berguna sendiri sebelum 3b-2 menempelkan gambar ke item.

Anti-tujuan: pustaka tidak boleh menjadi tempat lampiran item biasa, dan aturan berkas item tahap 1 (keputusan 17-18 spek BU) tidak boleh berubah.

## 2. Keputusan pemilik produk (dicatat 2026-11-09)

1. **Pustaka gambar** adalah kolam gambar khusus instruksi stiker, terbuka bagi siapa saja yang mengakses instruksi, tanpa batas BU. Bukan lampiran item biasa.
2. **Dialog berkas = komponen umum** (di `web/src/components/`), fleksibel dan konsisten dipakai di tempat lain, idempoten: mendukung satu atau banyak file, filter tipe file, batas ukuran, dan sumber pustaka yang dapat diganti. Pada 3b-1 hanya satu sumber: gambar instruksi stiker.
3. **Filter tipe tidak terlalu spesifik**: kategori seperti "image" otomatis mencakup semua format gambar, tetapi tetap mematuhi format yang dapat disimpan di Drive dan diterima server. Server sekarang hanya menerima JPEG, PNG, WebP; tipe lain dikembangkan sesuai kebutuhan nanti.
4. **Dua tab**: *Unggah* dan *Pustaka*.
   - *Unggah*: daftar file yang akan diunggah; nama file dapat diklik untuk masuk **mode ubah nama**; ikon tempat sampah membuang file dari pilihan; tombol Telusuri dan Lampirkan; teks batas ukuran ("Maksimum 10 MB"). Rujukan tampilan: tangkapan layar dialog unggah dari aplikasi lain milik pemilik.
   - *Pustaka*: **kisi thumbnail** seperti pemilih file Google Drive, **gulir tanpa batas** (tanpa halaman bernomor), **pencarian nama file**, **pengurutan**, dan filter **"Diunggah oleh saya"** dan **"Belum dipakai"**.
5. **Seret dan lepas (DnD)** di tiga tempat: tab Unggah, tab Pustaka, dan langsung di form item. DnD ke form item **tetap membuka dialog** dengan file yang dilepas sudah berada di daftar unggahan, sebagai tahap konfirmasi dan ganti nama sebelum benar-benar diunggah. (Form item adalah 3b-2; 3b-1 menyediakan komponen drop-zone-nya.)
6. **Unggah baru tetap boleh** dari dialog bila gambar tidak ada di pustaka; gambar yang diunggah otomatis masuk pustaka.
7. **Ganti nama dan hapus**: nama file diklik lalu langsung masuk mode ubah (di daftar unggahan dan di kisi pustaka). Ganti nama oleh pengunggah atau pemegang izin kelola item; hapus hanya bila gambar tidak dipakai item mana pun.
8. **Pencarian lewat nama file**: pustaka menyimpan nama file (diambil dari nama file saat unggah, dapat diganti); tidak ada kolom keterangan terpisah.
9. **Thumbnail** dibuat di browser saat unggah (sekitar 320 px, di bawah 30 KB), disimpan di basis data, dan dimuat dengan cache browser panjang; gambar penuh baru diambil dari Drive saat dilihat atau dipilih.
10. **Kotak "Public"** pada rujukan tidak dibuat (pustaka sudah terbuka bagi pengguna instruksi).

## 3. Pilihan perancang (belum ditegaskan pemilik; harap dikoreksi bila keliru)

**Izin**
- **Baca** (daftar, thumbnail, gambar penuh): pemegang `item: lihat` atau `sticker: lihat`. Tidak dibatasi BU.
- **Unggah**: pemegang `item: ubah` (kata pemilik: siapa saja yang berizin ubah item). Pemegang `sticker: ubah` tidak otomatis boleh mengunggah.
- **Ganti nama dan hapus**: pengunggah (yang masih berizin `item: ubah`) atau pemegang `item: kelola`.
- **Halaman Pustaka Gambar** di grup menu Stiker; terlihat bagi pemegang `item: lihat` atau `sticker: lihat`. Aksi unggah/ganti nama/hapus muncul sesuai izin di atas.

**Data**
- Jenis pemilik berkas baru `stickerguide`. Satu gambar pustaka = satu baris `files` (pemilik `stickerguide`, `owner_id` = id berkasnya sendiri, tercatat sejak unggah sehingga tidak masuk hitungan "unggahan yatim" dan tidak memakai `MAX_UNATTACHED_UPLOADS`) + satu baris tabel pustaka baru (id = id berkas, nama, kunci nama tak-peka-huruf untuk pencarian, thumbnail biner beserta tipenya). Ukuran, dimensi, pengunggah, dan waktu diambil dari baris `files`.
- Nama disimpan **tanpa ekstensi**, dipangkas, tidak kosong, maks. 120 karakter, dan boleh kembar (nama berkas kamera sering sama; tanpa aturan keunikan).
- Migrasi expand-only dan idempoten (`0006_…`). Tidak ada backfill.
- Hapus = tandai `pending_delete` di `files` dan hapus baris pustaka dalam satu `batch()`, lalu buang di Drive memakai jalur yang sudah ada (`markFilesPendingDelete` + `purgePendingFiles`).
- Jumlah pemakaian (`usageCount`) ada di DTO sejak sekarang, bernilai 0 sampai 3b-2 menambah penempatan di item. Perhitungannya satu fungsi/kueri tunggal agar 3b-2 hanya mengganti satu tempat. **Kontrak ke 3b-2:** tabel penempatan memakai kunci asing ke tabel pustaka dengan `ON DELETE RESTRICT`, sehingga "hapus hanya bila tidak dipakai" dijaga basis data secara atomik (galat kunci asing dipetakan ke `CONFLICT` "Gambar masih dipakai"), bukan sekadar pemeriksaan sebelum hapus.
- Rename: terakhir-menang (tanpa `If-Match`); hanya mengubah nama.
- Audit: ganti nama dan hapus masuk `audit_log`; unggah tidak (sama seperti stok, rekamannya ada di tabel).

**Komponen dialog (tiga lapis)**
1. Tampilan umum di `web/src/components/` (dialog, tab, kisi, daftar unggah, drop-zone), yang tidak mengenal stiker.
2. Adaptor data per jenis pustaka (3b-1: gambar instruksi stiker) di `web/src/modules/sticker/`, sebuah objek `FileLibrarySource` yang memuat: kueri tak-hingga untuk daftar (parameter cari/urut/filter), `upload`, `rename`, `remove`, kemampuan per item (`canRename`, `canRemove`), dan pembentuk URL thumbnail/gambar penuh.
3. Rute server per jenis pustaka (3b-1: `stickerGuides.*`).

Props dialog: `source`, `mode: 'single' | 'multiple'`, `accept` (kategori: `'image'`; kategori baru dapat ditambah tanpa mengubah dialog; hasil akhir = irisan kategori dengan format yang didukung sumber), `maxBytes`, `initialFiles?` (dari DnD), `onSelect(items)`. Idempoten: berkas yang sudah sukses diunggah tidak diunggah lagi; menekan Lampirkan dua kali tidak membuat gambar ganda.

**Perilaku dialog**
- Satu himpunan pilihan dipakai kedua tab. Tombol "Lampirkan (n)" mengunggah dulu yang masih menunggu di tab Unggah, lalu mengembalikan semua pilihan (gambar pustaka yang dipilih + yang baru diunggah). Pada mode `single`, memilih yang lain mengganti pilihan.
- Unggah dikerjakan per berkas (maksimal 3 serentak), tiap berkas punya status sendiri (menunggu, mengunggah, sukses, gagal dengan alasan dan tombol ulangi). Berkas gagal tidak menggagalkan yang lain; dialog tetap terbuka bila ada yang gagal.
- Berkas di luar kategori atau melebihi `maxBytes` ditolak di sisi klien dengan nama berkas dan alasannya (tidak diam-diam dibuang).
- Batas per unggahan: 20 berkas, 10 MB per berkas sumber (sama dengan `MAX_IMAGE_BYTES`). Klien mengecilkan gambar (sisi maks. `MAX_IMAGE_SIDE`, target 1 MB, memakai `prepareImage` yang ada) dan membuat thumbnail (sisi terpanjang 320 px, WebP, target < 30 KB, kualitas diturunkan bertahap; batas keras server 40 KB).
- Klik pada nama (di daftar unggahan dan di kisi pustaka, bila `canRename`) masuk mode ubah; Enter menyimpan, Esc membatalkan.
- Pratinjau besar: ikon kecil pada tiap thumbnail membuka gambar penuh (thumbnail 320 px sering tak cukup membedakan stiker).
- Pustaka: ukuran halaman 40 item; pencarian dengan jeda ketik; kisi 2 kolom di ponsel dan dialog layar penuh di ponsel; keadaan kosong ("Belum ada gambar") dan galat memuat dengan tombol coba lagi.
- Pengurutan: terbaru (bawaan), terlama, nama A-Z, nama Z-A, ukuran terbesar. "Paling sering dipakai" **ditunda ke 3b-2** (sebelum ada penempatan opsinya akan mati).
- Memuat halaman berikutnya lewat gulir tak hingga tidak boleh menggandakan atau melewatkan gambar bila ada unggahan baru di antara halaman (paginasi kunci, bukan offset).
- Drop-zone: pembungkus yang menampilkan sorotan saat berkas diseret, menyaring berkas menurut `accept`, lalu memanggil `onFiles(files)`. Di 3b-1 dipakai di dialog dan halaman Pustaka Gambar.

**Kabel dan keamanan**
- Rute REST baru: `stickerGuides.list` (cursor, `search`, `sort`, `mine`, `unused`), `stickerGuides.upload` (multipart: gambar, thumbnail, nama, lebar, tinggi; Drive dulu lalu baris basis data dengan rollback best-effort seperti `uploadFile`), `stickerGuides.rename`, `stickerGuides.remove`, `stickerGuides.thumbnail` (biner, cache `immutable`). Gambar penuh lewat `files.get` yang ada, dengan cabang akses baru untuk pemilik `stickerguide` (pemegang `sticker: lihat` atau `item: lihat`; diperiksa SEBELUM cache isi).
- Server memvalidasi gambar dan thumbnail dengan tanda tangan byte dan MIME yang dikenali, batas ukuran, dan dimensi; thumbnail disajikan dengan tipe tetap hasil validasi. Nama dirender sebagai teks (tanpa HTML); pencarian meloloskan karakter khusus `LIKE`; id berkas selalu berasal dari baris pustaka (tidak pernah id Drive dari klien).
- Pemuatan thumbnail: `<img>` dengan pemuatan malas dan cache peramban panjang; pembangun memilih URL langsung (cookie sesi) atau cara setara, dengan syarat tetap diperiksa izin dan tetap ter-cache.

**Hasil builder check (2026-11-09; keputusan kecil perancang, dapat dikoreksi pemilik)**
- **Format thumbnail**: server menerima WebP atau JPEG (tanda tangan byte divalidasi). Klien mencoba WebP dulu; bila peramban jatuh balik ke format lain atau target 30 KB tak tercapai, klien memakai JPEG dan menurunkan sisi terpanjang bertahap (320, 240, 160 px) sebelum menyerah; bila tetap gagal, berkas itu berstatus gagal dengan alasan jelas.
- **Makna izin `item`**: cukup dimiliki di BU mana pun (level tertinggi di antara penugasan BU, `globalBuLevel`), bukan harus di semua BU; konsisten dengan "tanpa batas BU" dan dengan cara `files.upload` memeriksa `item: edit`.
- **Pengunggah di DTO**: hanya nama tampilan sebagai teks, tanpa email.

**Keputusan pemilik (2026-11-09, atas pertanyaan builder check): batas global 2.000 gambar di pustaka.** Alasan: gambar pustaka tidak dihitung sebagai unggahan yatim, sehingga tanpa batas satu pemegang izin ubah item bisa menghabiskan kuota Drive. Unggahan ditolak dengan galat `CONFLICT` berpesan jelas ("Pustaka gambar penuh (2.000)") bila jumlah gambar aktif sudah mencapai batas; pemeriksaan dan penyisipan dijaga agar unggahan serentak tidak melampaui batas (penjaga di dalam `batch()`, bukan hitung-lalu-tulis). Batas berupa konstanta di `shared/stickers.ts` (`GUIDE_LIBRARY_MAX`). Tidak ada pembatas laju per pengguna.

**Bukan keputusan pemilik tapi dicatat:** nama berkas sumber tidak disimpan di Drive (nama Drive tetap `<uuid>.<ext>` seperti lampiran lain); gambar yang sama persis tidak dideteksi ganda.

## 4. Bukan tujuan (non-goals)
- Penempatan gambar di item, penanda, tampilan label di detail item, penggantian daftar stiker lama, opsi urut "paling sering dipakai" (semuanya 3b-2).
- Format selain JPEG/PNG/WebP (HEIC/GIF/PDF dll.); penerapan dialog di modul lain (QR, item biasa) meski komponennya dirancang agar bisa.
- Folder/tag/album, hapus atau ganti nama massal, deteksi gambar ganda.
- Pembersihan otomatis unggahan yatim (tugas terpisah yang ditunda pemilik).
- Notifikasi apa pun.

## 5. Kriteria selesai
- Pengguna berizin dapat mengunggah satu atau beberapa gambar (lewat dialog atau DnD di halaman Pustaka Gambar), mengganti nama dengan klik nama, melihat kisi dengan gulir tak hingga, mencari, mengurutkan, memfilter "Diunggah oleh saya" dan "Belum dipakai", melihat pratinjau, dan menghapus gambar milik sendiri (atau semua bila `item: kelola`).
- Pemegang `item: lihat` atau `sticker: lihat` tanpa izin ubah hanya dapat melihat; pengguna tanpa kedua izin itu tidak dapat membaca daftar, thumbnail, maupun gambar penuh; tidak ada pembatasan BU.
- Dialog umum bekerja untuk `single`/`multiple`, `accept`, `maxBytes`, dan `initialFiles` dengan sumber uji palsu (membuktikan tidak terikat stiker).
- Tes server (izin per rute, galat unggah dan rollback, paginasi stabil terhadap unggahan baru, pencarian dengan karakter `LIKE`, tanda tangan thumbnail), tes web (dialog, daftar unggah, ganti nama, drop-zone), typecheck, Biome, dan build bersih. Pembuatan thumbnail memakai canvas peramban sehingga diverifikasi manual di peramban.
- `CLAUDE.md` diperbarui (jenis pemilik `stickerguide`, rute, komponen dialog).

## 6. Diserahkan kepada pembangun
Nama tabel/kolom/indeks dan rute pasti, bentuk DTO dan cursor, pembagian berkas komponen, urutan tugas, bentuk kabel multipart, ukuran halaman dan jeda ketik, tata letak halaman, serta salinan teks antarmuka.

## 7. Langkah berikutnya
Builder check (subagent) -> persetujuan pemilik -> rencana implementasi (`superpowers:writing-plans`) -> eksekusi subagent-driven. 3b-2 dirancang setelah 3b-1 selesai; catatannya ada di spek 3a §6.
