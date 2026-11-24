# Daftar periksa surel laporan dashboard terjadwal

Dipakai SEBELUM rilis fitur laporan terjadwal (spek `docs/superpowers/specs/2026-11-23-dashboard-design.md`, bagian 7a.3 dan 7a.11) dan setiap kali tampilan surel (`server/src/modules/dashboard/report/render.ts`) diubah. Klien surel tidak menjalankan JavaScript dan memperlakukan HTML dengan caranya sendiri, jadi tes otomatis tidak cukup: tabel, warna, dan lebar harus dilihat langsung.

## Persiapan

1. Staging dengan SMTP nyata terisi (`SMTP_*`) dan `APP_ORIGIN` yang benar. Tanpa SMTP, halaman Laporan terjadwal menampilkan peringatan dan Kirim uji nonaktif.
2. Akun pemegang `dashboard: manage` dan izin sumber data sebagian besar widget (Serah Terima, Serial Number, Laporan rusak, Stok Stiker, Postel), supaya semua jenis visual tampil.
3. Buat satu laporan harian berisi widget dari semua grup (maks. 12): angka dengan delta, donut atau pie, deret waktu, batang horizontal, batang kelompok, dan daftar. Isi penerima dengan alamat Gmail, Outlook, dan iCloud milik tim uji.
4. Tekan **Pratinjau surel** di halaman laporan untuk melihat HTML sebelum mengirim (tombol di dalamnya tautan contoh yang tidak berfungsi), lalu **Kirim uji** (surel `[UJI]` hanya ke pemilik; maks. 5 per jam).

## Klien yang diperiksa

Periksa tiap klien di terang dan gelap bila ada:

- Gmail web (Chrome).
- Gmail aplikasi (Android dan iOS).
- Outlook desktop (Windows; mesin render Word) dan, bila ada, Outlook web.
- Apple Mail (macOS dan iOS), termasuk mode gelap.

## Yang harus benar di setiap klien

- [ ] Surel tidak terpotong: tidak ada tulisan "Pesan dipotong" atau "Lihat seluruh pesan" (Gmail memotong sekitar 102 KB; batas kita 90 KB). Coba juga laporan dengan 12 widget dan banyak daftar.
- [ ] Lebar tidak melebihi layar: tak ada gulir horizontal di ponsel, batang tak keluar dari kotaknya.
- [ ] Kartu angka terbaca: nilai besar, label, dan delta periode lalu berisi kata arah (naik atau turun) dan angka, bukan hanya warna.
- [ ] Batang bertumpuk, kolom deret waktu, dan batang horizontal punya label dan nilai tertulis; legenda memuat nama irisan; "Lainnya" muncul bila irisan lebih dari enam.
- [ ] Daftar menampilkan paling banyak 5 baris dengan tulisan "Menampilkan N dari M".
- [ ] Tombol **Buka dashboard lengkap** terlihat jelas (kontras cukup di terang dan gelap), mudah diketuk di ponsel, dan satu-satunya tautan di surel.
- [ ] Tombol membuka halaman publik `/dashboard-publik/...` dengan periode dan cakupan yang sama dengan surel; halaman memuat tanpa login, tanpa kontrol BU/Lokasi di luar cakupan.
- [ ] Catatan masa berlaku tautan dan kalimat "hubungi pemilik untuk berhenti atau mengubah isinya" tampil di kaki surel.
- [ ] Mode gelap: teks tidak hilang (tak ada teks gelap di latar gelap) dan latar kartu tetap terbaca. Catat klien yang membalik warna otomatis.
- [ ] Tidak ada gambar yang dimuat dari luar, tidak ada permintaan jaringan ke domain lain saat surel dibuka (periksa pengaturan "muat gambar jarak jauh" tetap mati).
- [ ] Versi teks polos (tampilkan "Tampilkan teks asli" atau lihat sumber): ringkasan angka dan daftar terbaca, tautan ada di baris sendiri.
- [ ] Penerima tidak melihat alamat satu sama lain (alamat penerima ada di `bcc`; kolom Kepada berisi alamat pengirim).
- [ ] Subjek berbentuk `[QC] <nama laporan>, <periode>`; nama laporan berisi tanda kutip, `<`, atau emoji tampil apa adanya tanpa merusak tampilan.

## Jalur lengkap di staging

- [ ] Kirim uji sampai ke surel pemilik, berawalan `[UJI]`.
- [ ] Laporan harian terjadwal 5-10 menit ke depan terkirim sekali (bukan dobel) dan hasil terakhir di daftar menjadi "Terkirim".
- [ ] Jeda lalu lanjutkan: laporan tidak langsung terkirim saat dilanjutkan (mulai dari jadwal berikutnya).
- [ ] Hapus laporan lalu buka tautan dari surel lama: halaman menampilkan pesan "Tautan tidak berlaku atau terlalu banyak permintaan".
- [ ] Cabut tautan dari View tautan: tombol di surel lama tidak lagi membuka dashboard.
- [ ] Pemilik dinonaktifkan atau kehilangan izin `dashboard: manage`: laporan dilewati dengan catatan yang jelas, tidak ada surel keluar.

## Catatan hasil

Tulis hasil per klien (versi, terang/gelap, lolos atau tidak, tangkapan layar bila ada celah) di PR rilis. Celah tampilan yang hanya terjadi di satu klien lama (mis. Outlook desktop) dan tidak merusak isi dapat diterima oleh pemilik produk; catat keputusannya di spek bagian 13.
