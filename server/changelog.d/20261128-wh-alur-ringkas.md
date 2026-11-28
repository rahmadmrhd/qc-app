feat(serialwh): Penjualan Gudang boleh tanpa No SO (customer opsional, tautan task tetap bisa) dan tampil di Riwayat Gudang
feat(serialwh): kandidat task Serah Terima dipersempit per lokasi, memuat catatan dan checklist, urut status lalu terbaru, dengan penanda baris cocok dan tidak cocok
feat(serialwh): detail pencatatan Ready menampilkan nomor, kapasitas, dan isi kardus tiap serial

fix(serialwh): pencatatan tanpa serial yang dapat dicatat ditolak dengan alasan, tanpa riwayat kosong; kandidat task memakai filter lokasi dengan benar

feat(serialwh): Catat Serial WH hanya satu tujuan (catatan): nomor WH/<BU>/<YYMM>-<urutan>, kardus awal dan isi per kardus, catatan Markdown, link Serah Terima opsional, serial yang sama boleh dicatat ulang
