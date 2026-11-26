change(web): menu Katalog diganti nama menjadi Katalog & Stok
feat(sticker): form stiker baru punya Stok awal (jumlah + lokasi), dicatat server sebagai stok masuk Stok awal dalam satu batch dengan pembuatan stiker
feat(sticker): form Jenis stiker punya Minimum stok bawaan (sama dengan Konfigurasi; mengubahnya butuh izin Kelola)
feat(sticker): batas minimum stiker baru terisi dari minimum bawaan jenisnya; tanpa minQty server memakai default jenis
change(sticker): jenis sistem Manual Book dan Postel dijamin ada sejak server start, tampil di daftar Jenis walau belum ada konfigurasi atau catatan
