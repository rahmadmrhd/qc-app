feat(serial): aksi Tempel stiker pada Serial Number di QC (+1 per stiker, potong stok) lewat dialog satu serial dan massal atomik (serials.applyStickersBatch)
feat(qrcode): ekspor massal konfigurasi QR Code Manual Book dari daftar (pilih beberapa, satu alasan bersama untuk versi baru, berurutan dengan laporan per baris)
change(web): aksi utama di halaman View dibatasi maksimal tiga, sisanya di menu Aksi lainnya, dengan bobot menurut status dan pengguna di detail Serial Number dan Laporan
change(serial): riwayat detail Serial Number tampil tanpa lipatan dan jumlah Semua Riwayat sesuai entri yang tampil; badge Terbaru berwarna primary; detail Laporan menampilkan diagram tahap
change(web): aksi massal di bar pilihan tampil bila minimal satu baris terpilih memenuhi syaratnya dan hanya baris itu yang dikirim; katalog Stiker mendapat aksi stok massal (Catat masuk, Catat keluar, Koreksi) ke halaman Entri stok
change(web): aksi stok di detail Stiker pindah ke header (entri Stok bersubmenu); klik baris tabel desktop membuka halaman detail; status Serah Terima di ponsel menjadi chip filter
fix(web): tautan Buka pada field relasi berpindah di tempat pada aplikasi terpasang (PWA) alih-alih membuka jendela baru; celah kosong antara judul dan tab halaman detail Serial Number dihapus; teks tombol secondary kontras (hitam di mode terang, putih di mode gelap); gestur lembar bawah beranimasi mulus
change(ui): bar judul View/Form selebar penuh, tab garis lebih lega, panel samping lebih lebar di layar > 1920 px, dan Beranda desktop berbentuk peluncur ikon
