fix(notifikasi): aliran notifikasi pindah ke akun baru saat akun berganti tanpa keluar, tidak lagi menampilkan popup akun lama
fix(login): login gagal (Google gagal atau akun tak terdaftar) menampilkan pesan jelas dan menutup jendela login, bukan menggantung
fix(login): login kedua yang dimulai saat penukaran kode lama berjalan tak lagi menutup penerima callback miliknya
fix(muat-ulang): muat ulang tertunda tetap dijalankan setelah inject selesai walau inject masih menutup sesi saat Multi dihentikan
fix(window): menu bawaan (Reload, DevTools) dibuang agar muat ulang tak memotong inject
fix(katalog): item katalog dengan daftar BU rusak ditolak saat parse, bukan membuat halaman Country Lock gagal
chore(countrylock): perbaiki komentar dokumentasi versi jembatan
feat(window): pintasan zoom (Ctrl+=, Ctrl++, Ctrl+-, Ctrl+0) dan layar penuh (F11) berfungsi lagi walau menu bawaan dibuang
feat(login): login ditolak server dibedakan di layar login: akun belum terdaftar (minta admin mendaftarkan) atau login Google gagal (coba lagi)
