# Stok Ready dan Kardus: rancangan

Tanggal: 2026-11-27. Turunan dari spek Keluar Gudang (`2026-11-26-serial-keluar-gudang-design.md`, bagian 5.16 mode Ready Stock). Status: menunggu persetujuan pemilik produk. Jawaban pemilik 2026-11-27: nomor kardus berurutan **per Tipe**; data ready sebelum fitur ini **diabaikan** (belum ada di production); nomor boleh **direset ke 1** bila stok ready habis; tujuan sistem hanya **membantu WH mencatat ke Excel/spreadsheet** (WH punya SOP sendiri), jadi cakupan dijaga sederhana.

## 1. Maksud dan alasan

Tim WH mencatat serial sebagai **Ready Stock** (tanpa SO) untuk mencapai target barang ready. Kebiasaan WH: unit di ready stock disimpan per kardus, kardusnya diberi **nomor urut**, dan saat barang dikeluarkan mereka mengikuti urutan nomor itu (boleh loncat bila ada alasan). Hari ini WH menyimpan data itu di Excel, lalu menandai mana yang akan keluar.

Yang diminta pemilik produk:

1. Dari Ready Stock, WH bisa **meneruskan** unit menjadi pengeluaran (Penjualan) dan **memilih serial mana saja** yang keluar, tanpa scan ulang.
2. Aplikasi mencatat **nomor kardus** (tidak selalu mulai dari 1; bisa melanjutkan nomor dari sistem lama WH) dan mengelompokkan serial menurut **jumlah unit per kardus** per Tipe.
3. Satu **halaman khusus Stok Ready** menampilkan semua serial ready, dikelompokkan per kardus dengan warna baris selang-seling.
4. **Ecer** (jumlah tidak utuh satu kardus) tidak boleh digabung dengan kardus baru.

## 2. Tujuan, bukan tujuan, dan anti-tujuan

**Tujuan**
- WH tidak perlu lagi Excel untuk tahu isi dan urutan kardus ready.
- Mengeluarkan N unit mengikuti urutan kardus butuh sedikit klik.
- Jumlah unit per kardus yang berubah (desain kemasan baru pabrik) tidak merusak data kardus lama.

**Bukan tujuan**
- Mencetak label kardus, atau melacak lokasi rak.
- Mengembalikan serial yang sudah keluar ke stok ready (tidak ada "urungkan").
- Menggabungkan atau menata ulang isi kardus yang sudah tercatat (memindah serial antar kardus).
- Mengubah alur Penjualan dan peringatan scan ulang yang sudah ada.

**Anti-tujuan:** ecer yang tercampur diam-diam dengan kardus baru; nomor kardus ganda untuk Tipe yang sama; kardus lama berubah kapasitasnya karena master Item diubah.

## 3. Pendekatan yang dipertimbangkan

- **A. Nomor kardus ditempel di tiap serial.** Paling sedikit tabel, tetapi ecer harus dihitung ulang dan nomor tidak konsisten antar serial sekardus.
- **B. Kardus sebagai data tersendiri (dipilih pemilik, 2026-11-27).** Kapasitas dan nomor melekat pada kardus; ecer = kardus yang sisanya kurang dari kapasitas.
- **C. Label teks bebas per serial.** Tidak dapat diurutkan, diberi warna, atau dicek bentrok dengan andal.

Dipilih **B**: pengelompokan, warna selang-seling, bagian ecer terpisah, dan perubahan kemasan semuanya bergantung pada kardus sebagai satu objek.

## 4. Data

Migrasi `0043_stok_ready_kardus.sql`, expand-only dan idempoten.

- `items.box_size INT NOT NULL DEFAULT 0` (pcs/kardus; 0 = belum diisi). Diisi di form Data Item; menjadi nilai awal saat entry ready, tetap dapat diubah di sana.
- `warehouse_ready_boxes`: `id`, `bu_id`, `item_id`, `number` (INT, nomor kardus), `capacity` (INT, isi kardus **saat dicatat**), `dispatch_id` (pencatatan ready asal), `created_at`, `created_by`. Nomor unik per BU dan Tipe **selama kardusnya masih berisi stok** (keputusan pemilik): kolom `closed_key VARCHAR(100) NOT NULL DEFAULT ''` diisi id kardus saat kardus kosong (semua serialnya sudah keluar), dan indeks unik `(bu_id, item_id, number, closed_key)`. Dengan begitu nomor yang kardusnya sudah kosong boleh dipakai lagi, termasuk mulai lagi dari 1 setelah stok habis. Riwayat kardus lama tetap tersimpan. *(Bentuk kolom pilihan pembangun.)*
- `warehouse_ready_serials`: `serial_id` (unik), `box_id`, `dispatch_id` (pencatatan ready asal), `seq`, `released_dispatch_id` (kosong = masih di stok; terisi = pengeluaran Penjualan selesai yang mengeluarkannya).
- Serial yang dicatat ready sebelum fitur ini **tidak diisi balik** dan tidak tampil di Stok Ready (keputusan pemilik: belum ada datanya di production; data uji di staging diabaikan). Tidak ada kelompok "Tanpa kardus".

Definisi turunan (satu fungsi murni di `shared/serial-warehouse.ts`, dipakai server dan web):
- **Di stok** = baris `warehouse_ready_serials` dengan `released_dispatch_id` kosong, serial hidup, dan pencatatan readynya selesai.
- **Sisa kardus** = jumlah serial di stok pada kardus itu. **Penuh** = sisa >= kapasitas; **Ecer** = sisa < kapasitas (baik karena dicatat tidak penuh maupun karena sebagian sudah keluar).

Nama tabel dan kolom di atas adalah pilihan pembangun.

## 5. Mencatat Ready Stock dengan kardus

Di dialog simpan Catat Serial WH, pilihan Tujuan "Ready Stock" menambah dua isian:
- **Nomor kardus awal**: bawaan = nomor tertinggi yang ada untuk BU dan Tipe itu + 1 (1 bila belum ada); bisa diubah untuk melanjutkan nomor dari sistem lama WH. Ditolak bila bentrok dengan nomor yang sudah ada.
- **Isi per kardus**: bawaan = `items.box_size`; bisa diubah; wajib terisi (> 0) bila Item belum punya `box_size`.

Sistem mengelompokkan serial yang akan disimpan **menurut urutan baris di tabel**: tiap N serial = satu kardus, nomor naik satu. Kelompok terakhir yang kurang dari N menjadi kardus ecer. Dialog menampilkan pratinjau ("Kardus 12-14 penuh (10 unit), kardus 15 ecer (5 unit)") Nomor kardus per serial **tidak** dapat diubah satu per satu (dijaga sederhana, menurut tujuan membantu pencatatan WH); yang dapat diubah hanya nomor awal dan isi per kardus.

Aturan: entri ready **selalu membuat kardus baru**, tidak pernah menambah isi kardus yang sudah ada. Ini yang menjaga ecer tidak tercampur dengan kardus baru. Satu pencatatan boleh memuat banyak kardus. Kardus ikut transaksi yang sama dengan penyimpanan serial dan idempoten lewat `clientId` yang sudah ada (kiriman ulang tidak membuat kardus ganda).

## 6. Halaman Stok Ready

Rute `/serial/gudang/ready` ("Stok Ready"; butir sidebar di grup Serial Number, terlihat bagi `serialwh: view`).

- Daftar semua serial di stok, diurutkan menurut nomor kardus lalu urutan di kardus. Dua bagian: **Kardus penuh** dan **Ecer** (di bawahnya; berisi kardus kurang dari kapasitas). Kardus penuh dan ecer tidak pernah tercampur dalam satu blok.
- Baris diwarnai **selang-seling per kardus** (A/B). Warna dari token yang sudah ada; satu kardus selalu satu warna.
- Kolom: Kardus (nomor dan "isi/kapasitas"), Tipe, Serial Number, BU, tanggal dicatat. Filter: BU, Tipe, pencarian serial atau nomor kardus. Berpaginasi menurut kardus agar satu kardus tidak terpotong antar halaman.
- Tombol **"Salin ke clipboard"** menyalin serial terpilih (atau semua yang terfilter) sebagai teks tab-terpisah, kolom Kardus dan Serial, siap ditempel ke Excel atau spreadsheet *(pilihan pembangun, menurut tujuan sistem ini)*.
- Serial yang sedang ada di pengeluaran Penjualan belum selesai ditampilkan **"Sedang diproses"** dan tidak dapat dipilih.
- Ringkasan di atas daftar: jumlah unit, jumlah kardus penuh, jumlah ecer, per Tipe bila difilter.

## 7. Meneruskan ke pengeluaran

- Kotak centang per serial (kit pilih rentang yang sudah ada) dan per kardus (memilih satu kardus sekaligus).
- Pembantu **"Pilih N unit sesuai urutan"**: WH mengisi jumlah, sistem memilih mengikuti nomor kardus naik, kardus penuh lebih dulu lalu ecer *(pilihan pembangun)*; hasilnya hanya tanda centang yang dapat diubah bebas (loncat tetap boleh). Contoh: 35 unit, isi 10 → kardus 1, 2, 3 penuh dan 5 serial dari kardus 4.
- Tombol aksi **"Keluarkan ke Penjualan"** (bagi `serialwh: edit`) membuka form Catat Serial WH dengan Tujuan Penjualan dan serial terpilih sudah berada di draf. No SO, customer, tautan Serah Terima, dan peringatan memakai dialog yang sudah ada; tidak ada alur keluar baru.
- Pengeluaran selesai yang memuat serial ready **mengisi `released_dispatch_id`** pada transaksi yang sama dengan penyelesaiannya, sehingga serial keluar dari Stok Ready. Ini berlaku juga bila WH men-scan serial itu langsung di form tanpa lewat halaman Stok Ready *(pilihan pembangun)*. Pengeluaran yang dibatalkan penyapu tidak melepas apa pun.
- Serial dari satu BU tidak dapat dikeluarkan oleh pengguna tanpa `serialwh: edit` pada BU itu.

## 8. Hak, audit, dan batasan

- Baca halaman: `serialwh: view` per BU. Keluarkan dan catat: `serialwh: edit`. Tanpa modul izin baru.
- Rute baru aditif (tanpa id `@n`): `serialWarehouse.readyStock` (daftar), dan masukan `boxStart`/`boxSize`/penugasan kardus per baris pada `serialWarehouse.submit` mode ready. Potret kontrak dibuat ulang.
- Audit: `serialwh.ready_create` memuat nomor kardus; pengeluaran menulis `serialwh.dispatch_*` seperti sekarang.
- Pengguna BU lain mendapat `NOT_FOUND` seragam, seperti riwayat.
- Migrasi expand-only; rollback image sebelum fitur ini tidak menghapus data dan tidak membaca tabel baru.

## 9. Dikerjakan pembangun, dan pertanyaan terbuka bagi pemilik

Pilihan pembangun (dapat dikoreksi): nama tabel dan kolom; kardus penuh dulu baru ecer pada "Pilih N unit"; tombol salin ke clipboard; pengeluaran lewat scan langsung juga melepas serial dari stok; label menu "Stok Ready".

Putusan pembangun setelah pemeriksaan independen (semuanya pilihan pembangun, dapat dikoreksi):
- **Potongan:** server yang menetapkan kardus, dari urutan global serial (`seq`) di seluruh pengiriman, bukan per potongan. `boxStart`, `boxSize`, dan penugasan kardus per baris ikut header yang di-hash, jadi potongan ulang tidak mengubah hasil. Kardus yang melintasi batas potongan dibuat sekali (dicari lewat nomornya) dan potongan berikutnya hanya menambah serial ke kardus itu. Batas potongan tidak perlu selaras dengan isi kardus.
- **Serial yang dilewati:** kardus dihitung ulang dari serial yang benar-benar tersimpan, jadi tidak ada lubang di nomor dan kardus terakhir menjadi ecer bila perlu. Pratinjau di klien hanya perkiraan dan dialog menampilkan hasil akhir dari server setelah disimpan. Serial yang sudah tercatat WH tetapi tidak punya baris stok ready (mode Penjualan atau data lama) memang tidak pernah masuk Stok Ready.
- **Dibatalkan penyapu:** baris `warehouse_ready_serials` dan kardus yang kosong akibatnya dihapus bersama pembatalan, sehingga nomor kardusnya bebas dipakai lagi. Hanya pencatatan yang selesai yang memegang nomor.
- **Pelepasan serial:** pengisian `released_dispatch_id` dijaga CAS (hanya bila masih kosong). Serial ready yang sudah ada di pengeluaran Penjualan pending lain ditolak seperti aturan "sudah ada di pengeluaran pending" yang ada. Serial yang sudah keluar tidak lagi ada di stok, jadi tidak dapat dipilih ulang.
- **Kapasitas dan Ecer:** kapasitas selalu > 0 untuk kardus baru (isian wajib). "Pilih N unit" memakai urutan nomor kardus saja (tidak bergantung kapasitas), jadi kardus berkapasitas berbeda tidak masalah.
- **Paginasi dan "Pilih N unit":** paginasi menurut kardus dengan kursor (bagian, nomor kardus); satu kardus boleh melebihi ukuran halaman. "Pilih N unit" dihitung server atas seluruh stok yang terfilter (rute daftar menerima `pickCount` dan mengembalikan id terpilih), bukan hanya baris yang dimuat.
- **Draf dan batas:** serial terpilih dikirim ke form Catat Serial WH lewat state router sementara dan masuk ke draf sebagai baris biasa (lolos validasi dan cek BU yang sama). Jumlah terpilih tidak boleh melebihi batas baris draf; bila lebih, tombol "Keluarkan" menolak dengan alasan.

Terbuka bagi pemilik produk: tidak ada (keduanya dijawab 2026-11-27 dan sudah dimasukkan di atas).
