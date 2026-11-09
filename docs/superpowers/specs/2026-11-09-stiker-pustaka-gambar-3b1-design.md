# Stiker Management, tahap 3b-1: pustaka gambar dan dialog berkas umum

Status: **DRAFT, brainstorming berlangsung; belum disetujui pemilik produk.** Tanggal: 2026-11-09.
Induk: `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md` (§6 mencatat keputusan 3b), `docs/superpowers/specs/2026-11-08-business-unit-design.md` (keputusan 23). Cabang dasar: `feat/stiker-management` (PR 47 untuk 3a, belum di-merge saat catatan ini ditulis).
Tahap 3b dipecah dua (disetujui pemilik 2026-11-09): **3b-1** (dokumen ini: pustaka gambar dan dialog berkas umum) lalu **3b-2** (penempatan gambar di item, penanda gaya tag foto, tampilan label di detail item, penggantian daftar stiker lama). 3b-1 dirancang dan dibangun lebih dulu.

## 1. Tujuan

Orang yang mengatur item (siapa saja yang berizin ubah item) perlu melampirkan gambar acuan penempelan stiker ke item tanpa mengunggah ulang gambar yang sama berkali-kali (hemat ruang Drive dan waktu). Tahap ini menyediakan **pustaka gambar** khusus instruksi stiker dan **dialog berkas umum** untuk memilih atau mengunggah file dari pustaka, yang dirancang agar dapat dipakai di tempat lain. Hasil 3b-1 sudah berguna sendiri: gambar bisa diunggah ke pustaka, dipilih, diganti namanya, dan dihapus; penempatan di item dan penanda menyusul di 3b-2.

## 2. Keputusan pemilik produk (dicatat 2026-11-09)

1. **Pustaka gambar** adalah kolam gambar khusus instruksi stiker, terbuka bagi siapa saja yang mengakses instruksi, tanpa batas BU. Bukan lampiran item biasa: aturan berkas item tahap 1 (keputusan 17-18 spek BU) tetap utuh.
2. **Dialog berkas = komponen umum** (di `web/src/components/`), fleksibel dan konsisten dipakai di tempat lain: mendukung satu atau banyak file, filter tipe file, batas ukuran, dan sumber pustaka yang dapat diganti. Pada 3b-1 hanya satu sumber: gambar instruksi stiker.
3. **Filter tipe tidak terlalu spesifik**: kategori seperti "image" otomatis mencakup semua format gambar, tetapi tetap mematuhi format yang dapat disimpan di Drive dan diterima server. Server sekarang hanya menerima gambar JPEG, PNG, WebP; tipe lain dikembangkan sesuai kebutuhan nanti.
4. **Dua tab**: *Unggah* dan *Pustaka*.
   - *Unggah*: daftar file yang akan diunggah; nama file dapat diklik untuk masuk **mode ubah nama**; ikon tempat sampah membuang file dari pilihan; tombol Telusuri dan Lampirkan; teks batas ukuran ("Maksimum 10 MB"). Rujukan tampilan: tangkapan layar dialog unggah dari aplikasi lain milik pemilik.
   - *Pustaka*: **kisi thumbnail** seperti pemilih file Google Drive, **gulir tanpa batas** (tanpa halaman bernomor), **pencarian nama file**, **pengurutan** (usul: terbaru sebagai bawaan, terlama, nama A–Z, nama Z–A, ukuran, paling sering dipakai), dan filter **"Diunggah oleh saya"** dan **"Belum dipakai"** (disetujui).
5. **Seret dan lepas (DnD)** di tiga tempat: tab Unggah, tab Pustaka, dan langsung di form item. DnD ke form item **tetap membuka dialog** dengan file yang dilepas sudah berada di daftar unggahan, sebagai tahap konfirmasi dan ganti nama sebelum benar-benar diunggah ke pustaka.
6. **Unggah baru tetap boleh** dari dialog bila gambar tidak ada di pustaka; gambar yang diunggah otomatis masuk pustaka.
7. **Ganti nama dan hapus**: nama file diklik lalu langsung masuk mode ubah (di daftar unggahan dan di kisi pustaka). Ganti nama oleh pengunggah atau pemegang izin kelola item; hapus hanya bila gambar tidak dipakai item mana pun (rekomendasi perancang, disetujui pemilik).
8. **Pencarian lewat nama file**: pustaka menyimpan nama file (asli saat unggah, dapat diganti); tidak ada kolom keterangan terpisah.
9. **Thumbnail** dibuat di browser saat unggah (sekitar 320 px, di bawah 30 KB), disimpan di basis data, dan dimuat dengan cache browser panjang; gambar penuh baru diambil dari Drive saat dilihat atau dipilih (disetujui pemilik).
10. **Kotak "Public"** pada rujukan tidak dibuat (pustaka sudah terbuka bagi pengguna instruksi).

## 3. Pilihan perancang (belum ditegaskan pemilik; harap dikoreksi bila keliru)
- Jenis pemilik berkas baru (mis. `stickerguide`) untuk gambar pustaka; terbaca oleh pemegang `item: lihat` atau `sticker: lihat` (3b-2 menampilkannya di detail item); dapat diunggah oleh pemegang `item: ubah`.
- Komponen dialog terdiri dari tiga lapis: tampilan (`web/src/components/`), adaptor data per jenis pustaka (3b-1: gambar instruksi stiker), dan rute server per jenis pustaka; dialog tidak mengenal stiker.
- Tabel pustaka menyimpan: id berkas, nama, thumbnail, pengunggah, waktu, ukuran, dimensi; jumlah pemakaian dihitung dari penempatan di item (3b-2; sebelum itu 0, sehingga "Belum dipakai" dan hapus berlaku untuk semua).
- Batas (nama file, jumlah file per unggahan, ukuran halaman gulir) diserahkan kepada pembangun.

## 4. Bukan tujuan (non-goals)
- Penempatan gambar di item, penanda, tampilan label di detail item, penggantian daftar stiker lama (3b-2).
- Tipe file selain gambar di server; penerapan dialog di modul lain (QR, item biasa) meski komponennya dirancang agar bisa.
- Pembersihan otomatis unggahan yatim (tugas terpisah yang ditunda pemilik).

## 5. Langkah berikutnya
Brainstorming 3b-1 hampir lengkap. Sisa: konfirmasi ringkasan ini dengan pemilik, tulis desain final, builder check (subagent), persetujuan, lalu rencana implementasi (`superpowers:writing-plans`). Catatan 3b-2 ada di spek 3a §6.
