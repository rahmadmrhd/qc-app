fix(serial): aksi alur menolak tanggal kejadian sebelum tanggal laporan dibuka; kiriman ulang Tempel stiker massal mengembalikan hasil tersimpan sebelum memeriksa ulang hak
fix(serial): kiriman ulang Catat Serial yang sudah pindah BU tak lagi dianggap duplikat; hak kelola foto bukti kini mengikuti hak tulis BU serial saat ini
fix(serial): halaman publik laporan membatasi pencarian berkas pada pesan yang memuat id berkas dan detail laporan membaca kejadian penutup menurut laporan itu
fix(auth): login desktop yang gagal (Google atau akun tak terdaftar) kini dikirim ke loopback atau qc:// dengan kode error dan state; penukaran kode ke Google ber-batas waktu 10 detik
fix(access): simpan pengguna, role, lokasi, dan ganti nama BU dijaga versi (CAS) sehingga dua penyimpan serentak tak saling menimpa; log aktivitas membaca satu tabel, bukan keempatnya
fix(customer): ganti nama customer dijaga versi dan membaca dua baris saja; simpan batch Serah Terima membaca customer menurut kunci, bukan seluruh daftar
fix(qrcode): flag overflow ditulis bersyarat versi dan hidup; tampilan dan simpan satu konfigurasi tak lagi menyapu semua konfigurasi dan item
fix(item): kursor daftar item stabil untuk kunci kembar (kursor gabungan kunci dan id); ganti nama merk memeriksa tabrakan alias hanya pada item hidup
fix(sticker): adopsi jenis Manual Book buatan orang kini mengaktifkannya; riwayat stok multi-lokasi dibaca per lokasi lewat indeks
fix(postel): riwayat ubah mencatat jumlah item hidup pada snapshot sebelum, sama dengan sesudah
fix(notification): pengiriman push memuat langganan sekali per putaran dan tak berhenti diam-diam saat satu baris gagal; aliran SSE satu kueri per pengguna dan ditutup rapi saat shutdown
fix(jobs): jobs.get membuka job non-QR hanya bagi pembuatnya; ekspor Sheets mengantre job dan audit dalam satu batch dan tak lagi memuat berkas stiker, Postel, atau serial terhapus
fix(files): unggah gambar membaca dimensi dari header byte dan menolak sisi lebih dari 4000 px alih-alih memercayai klaim klien
fix(desktop): katalog menghitung stiker dan instruksi dari semua BU item seperti web; hanya pilihan BU di form inject yang menyaring BU terhapus/nonaktif; pembaca rilis tak menyimpan hasil indeks basi
fix(sticker): filter daftar item menghitung hanya penanda bersasaran hidup, sepakat dengan hasil terjemahan detail dan hasInstructions
fix(google): unduhan berkas Drive ber-batas waktu sampai header diterima
perf(db): indeks papan Serah Terima, log audit per aksi, daftar serial menurut waktu catat, dan notifikasi belum dibaca; batch rekaman memakai paling banyak 4 perencana serentak
fix(deploy): deploy.sh mengabaikan putusnya SSH (HUP dan PIPE) agar rollback tetap berjalan dan jejaknya masuk .deploy.log
test(server): tes penjaga soft delete dua arah dan pemindai regex di dalam template; templat skema tes memeriksa GET_LOCK; seed dev mengosongkan semua tabel data
chore(server): hapus sheetsDump yang tak terpakai; berkas migrasi wajib bernama NNNN_huruf_kecil.sql
fix(access): simpan Pengguna, Role, Lokasi, dan BU menerima expectedUpdatedAt opsional (If-Match); versi basi ditolak 412 sehingga dua admin tak saling menimpa; klien lama tanpa field tetap jalan
