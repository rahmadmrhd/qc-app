# Stiker Management, tahap 3a: katalog stiker dan stok

Status: disetujui pemilik produk 2026-11-09 ("Setuju"). Tanggal: 2026-11-09.
Induk: `docs/superpowers/specs/2026-11-08-business-unit-design.md` (peta tahap §2; keputusan 1-22). Cabang kerja: `feat/stiker-management`.
Tahap 3 dipecah dua (disetujui pemilik 2026-11-09): **3a** (dokumen ini: katalog dan stok) lalu **3b** (instruksi penempelan: pustaka gambar, penanda pada gambar, tampilan di item; dirancang terpisah setelah 3a). Bagian 6 mencatat keputusan 3b agar tidak hilang.

Pembaruan tahap 5 (2026-11-12, keputusan pemilik produk; spek `docs/superpowers/specs/2026-11-12-serial-number-design.md`): **stok boleh menjadi negatif akibat pemotongan Serial Number otomatis**, agar kekurangan stiker terlihat; stok keluar manual dan opname **tetap tidak boleh** membuat stok negatif. Kendala `CHECK (qty >= 0)` di `0005_stiker.sql` dicabut oleh migrasi tahap 5 (pelonggaran kompatibel mundur), stiker `deprecated` menjadi `inactive` saat total stok `<= 0`, dan pemotongan tidak pernah dikembalikan otomatis. Butir di bawah yang bertentangan (anti-tujuan "stok negatif", butir 8, dan `sticker_stock` "tidak boleh negatif") dibaca menurut pembaruan ini.

Pembaruan tahap 4b (2026-11-12; spek `docs/superpowers/specs/2026-11-11-stiker-postel-4b-design.md`): jenis sistem `postel` (aturan `group`) berisi satu stiker "Postel" yang dibuat otomatis saat catatan Postel pertama disimpan; pada form katalog hanya minimum, alias, status, dan gambarnya yang dapat diubah (nama terkunci), dan stiker itu dapat dinonaktifkan serta diaktifkan kembali kapan saja.

Pembaruan tahap 4a (2026-11-10, disetujui pemilik produk; spek `docs/superpowers/specs/2026-11-10-stiker-manual-book-4a-design.md`): status stiker bertambah `deprecated` (Usang: digantikan versi Manual Book yang lebih baru; hanya dapat menjadi nonaktif, tak boleh menerima stok masuk), `sticker_types` mendapat `system_kind` (jenis sistem Manual Book/Postel dikelola aplikasi) dan `default_min_qty`, aturan jenis bertambah `group` (menurut kelompok item; hanya jenis sistem, tak dipilih pengguna), perhitungan `low` (menipis) mengabaikan stiker bukan `active` (nonaktif dan `deprecated`), dan halaman **Konfigurasi Stiker** (`/sticker/settings`, `sticker: manage`) memuat minimum bawaan per jenis dan email ringkasan harian stok menipis. Butir keputusan di bawah yang bertentangan (daftar aturan jenis di butir 2; notifikasi di butir 9 dan non-goals: sekarang ada email ringkasan harian, bukan notifikasi dalam aplikasi) dibaca menurut pembaruan ini.

Status implementasi (2026-11-09): bagian server dan shared sudah diimplementasikan (Tugas 1-6); halaman web sedang dikerjakan (Jenis dan Stiker selesai, halaman Stok menyusul di Tugas 9). Data contoh dev dan dokumen (Tugas 10) ikut dalam tahap yang sama.

## 1. Latar dan tujuan

Tim QC menempelkan beberapa jenis stiker pada barang. Pemilik produk menyebut tiga masalah nyata: (1) di gudang banyak item dengan ketentuan stiker yang berbeda-beda sehingga susah diingat; (2) stok stiker menipis tanpa disadari padahal pemesanan makan waktu lama; (3) posisi tempel perlu acuan yang konsisten. Tahap 3a menjawab masalah 2 dan menyiapkan fondasi masalah 1 dan 3 (katalog yang dirujuk oleh 3b).

Tolok ukur berhasil: admin dapat mengelola jenis dan stiker; petugas dapat mencatat stok masuk, keluar, koreksi, dan stok opname per lokasi dengan riwayat lengkap; dan sistem menandai stiker yang total stoknya sudah di bawah atau sama dengan batas minimum, sehingga pemesanan dapat dilakukan lebih awal.

## 2. Cakupan

### Termasuk (3a)
- **Jenis stiker**: dapat ditambah, diubah, dan dinonaktifkan (tidak dihapus).
- **Stiker**: dapat ditambah, diubah, dan dinonaktifkan. Memuat nama, alias opsional, jenis, satu gambar contoh, daftar BU yang tertaut (boleh banyak), dan satu batas minimum.
- **Stok per lokasi**, dalam satuan butir, dengan pencatatan masuk, keluar, koreksi, dan stok opname, serta riwayat tak berubah.
- **Penanda "menipis"** di halaman stok dan daftar stiker.
- Izin (modul baru `sticker` dan `stickerstock`), menu, halaman web, rute REST, migrasi, data contoh dev, dokumen (`CLAUDE.md`, `docs/adding-a-module.md` bila perlu, PRD).

### Bukan tujuan (non-goals)
- Instruksi penempelan, pustaka gambar, penanda pada gambar, tampilan di detail item (3b).
- Pengelompokan item untuk Manual Book dan Postel, stok berkelompok, tautan ke hasil ekspor QR (tahap 4).
- Pemotongan stok otomatis dan bus event (tahap 5; keputusan 22 spek BU; dirancang di `docs/superpowers/specs/2026-11-12-serial-number-design.md`).
- **Notifikasi** stok menipis (menunggu pembangunan PWA); 3a hanya menandainya di layar.
- Pelacakan stok per batch cetak.
- Pembatasan BU pada stiker dan stok.

### Anti-tujuan
- Stok negatif akibat stok keluar manual atau opname (stok negatif hanya boleh akibat pemotongan Serial Number otomatis; keputusan pemilik 2026-11-12) atau catatan yang bisa diubah diam-diam: riwayat tidak boleh diedit atau dihapus.
- Membuat tim QC menghitung ulang konversi lembar ke butir secara manual berulang-ulang.

## 3. Keputusan pemilik produk (dicatat 2026-11-09)

1. **Stiker dan stok tidak dibatasi BU.** Siapa pun yang berizin mengelola stok dapat mengelola stok untuk BU mana pun, tetapi **tetap dibatasi lokasi**. Tautan BU pada stiker hanya dipakai untuk menentukan stiker mana yang berlaku bagi sebuah item (3b), bukan untuk membatasi akses.
2. **Jenis stiker membawa aturan penentuan stiker**: menurut BU item, menurut kelompok item (`group`, dibangun di tahap 4a hanya untuk jenis sistem; tidak dipilih pengguna di form jenis), atau tanpa syarat. Contoh sekarang: QC Hijau (Spectrum, Teakwave), QC Putih (Voltech), Segel berbeda per BU (menurut BU); Manual Book dan Postel (menurut kelompok item, tahap 4); stiker lain tanpa syarat, dengan kemungkinan berubah di masa depan.
3. **Jenis dan stiker dapat ditambah dan dinonaktifkan** oleh admin (bukan daftar tetap di kode).
4. **Stiker punya nama dan alias**: nama untuk admin, alias (opsional) untuk tampilan tim QC. Contoh: nama "QC Spectrum/Teakwave", alias "Stiker Hijau". Bila alias ada, alias yang tampil.
5. **Stok hanya total butir**, tanpa pelacakan batch (isi per lembar berbeda tiap batch cetak). Stok dicatat per lokasi dan dijumlahkan.
6. **Batas minimum satu angka per stiker**, berlaku untuk total semua lokasi (bukan per lokasi).
7. **Alat stok masuk dan stok opname menerima lembar × isi per lembar**: satu atau beberapa baris "jumlah lembar × isi per lembar" (isi boleh berbeda per baris) ditambah butir lepas; sistem menjumlahkannya menjadi butir. Stok opname menetapkan stok menjadi angka hasil hitung dan mencatat selisihnya sebagai penyesuaian di riwayat. *(Keputusan pemilik 2026-11-20: stok opname berupa HALAMAN sendiri `/sticker/stock/opname`, bukan dialog, agar tidak tertutup tanpa sengaja (meninggalkan halaman dengan hitungan belum disimpan meminta konfirmasi). Daftar stiker pada halaman itu dapat dicari menurut nama dan disaring menurut jenis stiker (boleh banyak jenis, `LinkMultiField`); hitungan stiker yang tersaring dari tampilan tetap ikut tersimpan. Label isian "Butir lepas" menjadi "Butir" (bahasa terlalu baku); riwayat stok menulis "5 butir", bukan "5 lepas". Perilaku server tidak berubah.)*
8. **Stok diubah manual** di tahap 3 dan 4; pemotongan otomatis menunggu Serial Number (tahap 5; dirancang 2026-11-12 di `docs/superpowers/specs/2026-11-12-serial-number-design.md`: dipotong menurut daftar centang stiker yang ditempel, tanpa pengembalian otomatis).
9. **Notifikasi menipis di dalam aplikasi ditunda** sampai PWA dibangun. *(Tahap 4a, keputusan pemilik 2026-11-10: peringatan stok menipis berupa satu email ringkasan harian, diatur di halaman Konfigurasi Stiker; notifikasi dalam aplikasi tetap menunggu PWA.)*

### Pilihan perancang yang belum ditegaskan pemilik (harap dikoreksi bila keliru)
- **Izin**: dua modul izin baru, bukan memakai ulang `stock` (modul `stock` sudah ada dengan arti "Monitoring Stok yang belum QC", hanya level lihat, tanpa halaman; mengubah artinya akan mengubah makna izin role yang memegangnya). `sticker` bersifat global (katalog: jenis, stiker, batas minimum). `stickerstock` bersifat berlokasi (`LOCATION_MODULES`, stok per lokasi). Level kedua modul: lihat, ubah, kelola. `stickerstock`: lihat = baca stok dan riwayat; ubah = catat masuk dan keluar; kelola = koreksi dan stok opname. `sticker`: lihat = baca katalog; ubah = tambah/ubah stiker dan jenis, termasuk batas minimum; kelola = nonaktifkan dan aktifkan.
- **Penanda "Menipis"** (boolean, dihitung dari total seluruh lokasi) terlihat oleh pemegang `sticker: lihat` atau `stickerstock: lihat`. Angka total yang tampil hanya jumlah lokasi yang berhak dilihat user, supaya angka lokasi lain tidak bocor.
- **Stiker atau jenis nonaktif**: stok masuk ditolak bila stikernya ATAU jenisnya nonaktif (jenis nonaktif menolak masuk walau stikernya masih aktif); keluar, koreksi, dan opname tetap boleh (menghabiskan sisa). Stiker nonaktif tidak dihitung "Menipis". Menonaktifkan jenis tidak mengubah status stikernya (tidak ada penurunan otomatis), tetapi stiker baru tidak bisa dibuat di bawah jenis nonaktif. Diperjelas 2026-11-09 setelah review akhir; `StickerStockDto` membawa `typeStatus` agar UI menyembunyikan tombol Masuk.
- **Stok opname**: klien mengirim stok yang dilihatnya; bila stok sudah berubah, ditolak sebagai usang (`staleError`) dan petugas menghitung ulang. Satu permintaan boleh memuat banyak pasangan stiker×lokasi dan bersifat atomik (semua atau tidak ada). Koreksi adalah perubahan bertanda (+/−) dengan alasan wajib; opname adalah "tetapkan menjadi".
- **Keunikan katalog**: nama stiker unik per jenis tanpa membedakan huruf besar/kecil (kolom `key` seperti item); alias tidak unik. Jenis sebuah stiker tidak dapat diubah setelah dibuat; aturan penentuan sebuah jenis tidak dapat diubah setelah ada stikernya. Perubahan katalog (termasuk batas minimum) tercatat di log audit yang sudah ada. **Penjaga versi**: simpan jenis dan stiker saat UBAH wajib membawa `expectedUpdatedAt` (header `If-Match`); versi usang dijawab 412 lewat `staleError` dan tidak menulis apa pun (diputuskan 2026-11-09 setelah review akhir, mengikuti pola `items.save`).
- **Berkas gambar contoh**: jenis pemilik baru `sticker`; dapat dibaca user yang memegang `sticker: lihat` atau `item: lihat` (3b menampilkannya di detail item); dapat dipasang hanya oleh `sticker: ubah`.
- **Stok per lokasi**: baris stok dibuat saat catatan pertama; hanya lokasi aktif yang dapat menerima catatan baru; lokasi yang dinonaktifkan tidak dapat menerima catatan dan riwayatnya tidak terbaca lewat aplikasi (izin per lokasi hanya berlaku untuk lokasi aktif, termasuk bagi super admin), sedangkan stok yang tersisa di sana tetap dihitung pada total penanda "Menipis". Diputuskan 2026-11-09 (pemilik produk, mengikuti rekomendasi review akhir): menggantikan kalimat awal "tetap terbaca di riwayat"; mengubah itu butuh perubahan inti izin dan ditunda sampai ada kebutuhan nyata. Stok opname: konfirmasi saat mengganti lokasi bila sudah ada hitungan ditunda (hitungan dihapus tanpa konfirmasi, seperti sekarang). User dengan penugasan "Semua lokasi" boleh mencatat di lokasi aktif mana pun.
- **Aturan jenis di 3a**: hanya dua nilai yang berfungsi, "menurut BU" dan "tanpa syarat". Nilai "menurut kelompok item" ditambahkan di tahap 4 bersama kelompok itemnya.
- **Tumpang tindih BU**: dua stiker aktif sejenis boleh menautkan BU yang sama; 3b menampilkan semua yang cocok.
- **Data awal**: jenis dan stiker awal dibuat admin lewat halaman kelola; hanya data contoh dev yang diisi seed.

## 4. Arah rancangan data (bentuk pasti diserahkan ke pembangun)

- `sticker_types`: id, nama, aturan penentuan, status, urutan.
- `stickers`: id, jenis, nama, alias, berkas gambar contoh (satu), batas minimum (butir), status, versi untuk penjaga CAS.
- `sticker_business_units`: tabel penghubung stiker ↔ BU (pola yang sama dengan `item_business_units`; keputusan 4 spek BU).
- `sticker_stock`: stiker, lokasi, jumlah butir; kunci gabungan stiker+lokasi; tidak boleh negatif kecuali akibat pemotongan Serial Number otomatis (keputusan pemilik 2026-11-12; kendala `CHECK` dicabut oleh migrasi tahap 5).
- `sticker_stock_entries` (riwayat, hanya ditambah): stiker, lokasi, jenis catatan (masuk, keluar, koreksi, opname), perubahan butir, stok sesudahnya, rincian input (lembar, isi per lembar, butir lepas) bila ada, alasan, pengguna, waktu.
- Migrasi baru `NNNN_*.sql`, hanya DDL dan expand-only.
- Penulisan stok memakai pola CAS di dalam `batch()` (lihat "Aturan server" `CLAUDE.md`); keluar yang melebihi stok ditolak.
- Gambar contoh memakai modul berkas yang ada (jenis pemilik baru di `FileOwnerType`, penautan lewat `planAttachFiles`).

## 5. Perilaku yang diharapkan

- **Halaman** (menu baru): Jenis stiker, Stiker (daftar, form dengan `LinkMultiField` untuk BU dan unggah gambar contoh, aktif/nonaktif), Stok (per stiker: total, rincian per lokasi yang boleh dilihat, penanda "Menipis", catat masuk/keluar/koreksi, alat stok opname, riwayat).
- **Menipis** berarti total semua lokasi ≤ batas minimum (stiker aktif dengan batas > 0; stiker nonaktif dan `deprecated` tidak dihitung menipis, tahap 4a; email ringkasan harian juga memuat bagian "Habis" untuk stiker aktif bertotal <= 0 apa pun minimumnya, keputusan pemilik 2026-11-13, spek Serial Number §3 butir 28). Penanda dihitung server dari total seluruh lokasi walau pengguna hanya berhak atas sebagian lokasi; angka rinci hanya untuk lokasi yang berhak.
- **Stok keluar dan koreksi** wajib alasan singkat; masuk dan opname boleh tanpa alasan.
- **Nonaktif** menyembunyikan stiker/jenis dari pilihan baru tetapi riwayat dan stok tetap terbaca.
- Pola proyek: REST lewat `API_ROUTES`, validasi server, versi usang lewat `staleError`, tes MariaDB sungguhan, komponen shadcn, `LinkField` untuk pilihan BU, `FormDialog` untuk form dialog.

## 6. Keputusan yang dicatat untuk 3b (belum dirancang)

- **Daftar stiker lama di item diganti total** oleh sistem penanda (kolom lama tidak dihapus segera; aturan migrasi expand → contract). Isi item dev lama tidak dimigrasikan.
- **Pustaka gambar** terbuka untuk siapa saja yang mengakses instruksi stiker, tanpa batas BU, tetapi hanya berisi gambar yang diunggah untuk tujuan instruksi (kolam terpisah, bukan lampiran item; aturan berkas item tahap 1, keputusan 17-18, tetap utuh).
- **Item punya satu atau lebih gambar**, masing-masing dengan penanda sendiri (kardus untuk Manual Book dan Postel, perangkat untuk stiker lain); gambar dapat dipilih dari pustaka; gambar boleh diberi label BU (opsional).
- **Penanda gaya tag foto Instagram**: ketuk posisi di gambar lalu pilih stiker tertentu atau sebuah jenis; posisi disimpan relatif. Jenis diterjemahkan ke stiker menurut BU item.
- **Tampilan di detail item: label langsung di gambar** (pilihan B pemilik), label dapat diketuk untuk melihat gambar contoh, nama, dan petunjuk posisi; di ponsel label menjadi daftar di bawah gambar.
- **Item di dua BU**: semua stiker yang cocok ditampilkan, berlabel BU (jarang terjadi; tahap 5 menuntaskannya lewat BU Serial Number).
- Di 3b, Manual Book dan Postel ditandai ke stiker tertentu per item; pengelompokannya di tahap 4.
- **3b dipecah** (2026-11-09): **3b-1** pustaka gambar dan dialog berkas umum (draf: `docs/superpowers/specs/2026-11-09-stiker-pustaka-gambar-3b1-design.md`), **3b-2** penempatan di item, penanda, tampilan label, dan penggantian daftar lama (draf: `docs/superpowers/specs/2026-11-10-stiker-instruksi-item-3b2-design.md`, dibahas 2026-11-10; keputusan pembahasan tercatat di §2 draf itu).
- **Untuk 3b-2** (keputusan pemilik 2026-11-09): yang mengatur instruksi stiker = siapa saja yang berizin ubah item; dilakukan saat menambah item baru atau pada item yang sudah ada; sifatnya opsional tetapi penting. Gambar dipilih dari pustaka atau diunggah baru (otomatis masuk pustaka). Penanda dan label seperti di atas (label langsung di gambar, pilihan B pemilik). Pilihan perancang (belum ditegaskan): penanda diberi catatan pendek opsional (pengganti kolom catatan posisi daftar lama), editor penanda berada di form item sebagai bagian "Instruksi stiker", dan item yang belum punya instruksi diberi penanda "Belum ada instruksi stiker" di daftar dan detail (pengingat tanpa memaksa).

## 7. Diserahkan kepada pembangun
Nama tabel dan kolom pasti, bentuk DTO, tata letak halaman, urutan tugas, batas ukuran (panjang nama, jumlah baris opname per permintaan, ukuran halaman riwayat), dan isi data contoh dev.
