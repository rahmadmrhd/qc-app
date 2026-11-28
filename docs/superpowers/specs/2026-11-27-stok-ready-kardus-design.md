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
- Serial dari satu BU tidak dapat dikeluarkan oleh pengguna tanpa `serialwh: edit` pada BU itu. Penjualan tidak melepas stok ready BU lain: tiap BU punya data serial sendiri, jadi serial di stok ready BU yang berbeda dari BU pengeluaran dilewati sebagai "Serial tidak ditemukan" *(keputusan pemilik 2026-11-27, lihat bagian 10)*.

## 8. Hak, audit, dan batasan

- Baca halaman: `serialwh: view` per BU. Keluarkan dan catat: `serialwh: edit`. Tanpa modul izin baru.
- Rute baru aditif (tanpa id `@n`): `serialWarehouse.readyStock` (daftar), dan masukan `boxStart`/`boxSize`/penugasan kardus per baris pada `serialWarehouse.submit` mode ready. Potret kontrak dibuat ulang.
- Audit: `serialwh.ready_create` memuat nomor kardus; pengeluaran menulis `serialwh.dispatch_*` seperti sekarang.
- Pengguna BU lain mendapat `NOT_FOUND` seragam, seperti riwayat.
- Migrasi expand-only; rollback image sebelum fitur ini tidak menghapus data dan tidak membaca tabel baru.

## 9. Dikerjakan pembangun, dan pertanyaan terbuka bagi pemilik

Pilihan pembangun (dapat dikoreksi): nama tabel dan kolom; kardus penuh dulu baru ecer pada "Pilih N unit"; tombol salin ke clipboard; pengeluaran lewat scan langsung juga melepas serial dari stok; label menu "Stok Ready".

Putusan pembangun setelah pemeriksaan independen (semuanya pilihan pembangun, dapat dikoreksi):
- **Potongan:** server yang menetapkan kardus, dari urutan global serial (`seq`) di seluruh pengiriman, bukan per potongan. `boxStart`, `boxSize`, dan penugasan kardus per baris ikut header yang di-hash, jadi potongan ulang tidak mengubah hasil. Seluruh rentang nomor kardus (`boxStart` sampai `boxStart + ceil(total / boxSize) - 1`) dipesan sebagai kardus kosong milik pengeluaran pada potongan pertama; potongan berikutnya hanya mengisi kardus yang sudah dipesan secara berurutan, dan kardus pesanan yang tetap kosong (serial dilewati) dihapus saat pengeluaran selesai *(keputusan pemilik 2026-11-27, lihat bagian 10; menggantikan pembuatan kardus per potongan)*. Batas potongan tidak perlu selaras dengan isi kardus.
- **Serial yang dilewati:** kardus dihitung ulang dari serial yang benar-benar tersimpan, jadi tidak ada lubang di nomor dan kardus terakhir menjadi ecer bila perlu. Pratinjau di klien hanya perkiraan dan dialog menampilkan hasil akhir dari server setelah disimpan. Serial yang sudah tercatat WH tetapi tidak punya baris stok ready (mode Penjualan atau data lama) memang tidak pernah masuk Stok Ready.
- **Dibatalkan penyapu:** baris `warehouse_ready_serials` dan kardus yang kosong akibatnya dihapus bersama pembatalan, sehingga nomor kardusnya bebas dipakai lagi. Hanya pencatatan yang selesai yang memegang nomor.
- **Pelepasan serial:** pengisian `released_dispatch_id` dijaga CAS (hanya bila masih kosong). Serial ready yang sudah ada di pengeluaran Penjualan pending lain ditolak seperti aturan "sudah ada di pengeluaran pending" yang ada. Serial yang sudah keluar tidak lagi ada di stok, jadi tidak dapat dipilih ulang.
- **Kapasitas dan Ecer:** kapasitas selalu > 0 untuk kardus baru (isian wajib). "Pilih N unit" memakai urutan nomor kardus saja (tidak bergantung kapasitas), jadi kardus berkapasitas berbeda tidak masalah.
- **Paginasi dan "Pilih N unit":** paginasi menurut kardus dengan kursor (bagian, nomor kardus); satu kardus boleh melebihi ukuran halaman. "Pilih N unit" dihitung server atas seluruh stok yang terfilter (rute daftar menerima `pickCount` dan mengembalikan id terpilih), bukan hanya baris yang dimuat.
- **Draf dan batas:** serial terpilih dikirim ke form Catat Serial WH lewat state router sementara dan masuk ke draf sebagai baris biasa (lolos validasi dan cek BU yang sama). Jumlah terpilih tidak boleh melebihi batas baris draf; bila lebih, tombol "Keluarkan" menolak dengan alasan.

- **Penyimpangan kecil dari agen web (pilihan pembangun, dapat dikoreksi):** (1) batas draf oper `HAND_OFF_ROWS_MAX = 5000` baris (`web/src/modules/serialwh/lib/hand-off.ts`; draf sebesar itu masih jauh di bawah kuota penyimpanan) dipakai sebagai batas "Keluarkan"; (2) "Pilih N unit" berupa isian jumlah di atas tabel Stok Ready (bukan tombol tetap).

Terbuka bagi pemilik produk: tidak ada (keduanya dijawab 2026-11-27 dan sudah dimasukkan di atas).

## 10. Keputusan pemilik setelah review akhir (2026-11-27)

Semua butir di bawah disetujui pemilik produk pada 2026-11-27 setelah review akhir independen.

- **Rentang nomor kardus dipesan di awal.** Potongan pertama membuat semua kardus kosong untuk `total` serial milik pengeluaran itu. Nomor yang masih dipakai kardus terbuka lain (BU + Tipe sama) ditolak langsung pada `boxStart` ("Nomor kardus sudah dipakai"), dijaga indeks unik sehingga dua pencatatan serentak dengan rentang berimpit tidak bisa lolos keduanya. Alasan: tabrakan nomor terdeteksi di awal, bukan di tengah pengiriman potongan. Kardus pesanan yang tetap kosong dihapus saat pengeluaran `done` (nomor bebas, tidak tampil); pembatalan penyapu menghapus semua kardus pengeluaran itu; nomor tertinggi (`maxBoxNumber`) tetap menghitung kardus pesanan milik pengeluaran pending.
- **Penjualan hanya melepas stok ready BU yang sama.** Serial di stok ready BU lain dilewati dengan alasan "Serial tidak ditemukan" (tanpa membocorkan BU), juga dijaga di dalam batch. Alasan: tiap BU punya data serial sendiri.
- **Hanya serial Lolos di QC yang dapat dipilih.** `ReadyStockSerialDto` membawa `status` dan `custody`; hanya `good` + `qc` yang ikut "Pilih N unit" (`pickCount`/`picked`), seperti serial yang sedang diproses.
- **Salin ke clipboard aman dari injeksi rumus.** Sel serial berawalan `=`, `+`, `-`, atau `@` diberi awalan apostrof.
- Pilihan pembangun yang dikoreksi review: kardus yang semua serialnya terhapus hidup menutup nomornya; audit memakai `boxToPlanned`; batas "Pilih N unit" `pickMax` = 5000 (satu konstanta bersama).
- **Batas 2000 kardus per pencatatan ready dipertahankan.** Karena rentang nomor dipesan di awal, satu pencatatan ditolak ("Jumlah kardus terlalu banyak") bila `ceil(total / boxSize)` melebihi `RESERVE_BOXES_MAX = 2000`; contoh: isi 1 per kardus dengan lebih dari 2000 serial. Batas ini ditambah pembangun untuk mencegah satu permintaan menulis ribuan baris kardus; pemilik produk menyetujui dipertahankan pada 2026-11-27.
- Perbaikan review kedua (disetujui sebagai bagian spek): pelepasan stok dan penutupan kardus hanya untuk pencatatan ready berstatus selesai; Penjualan melewati serial yang masih ada di pencatatan ready pending; kardus tertutup tidak dihitung oleh pemeriksaan "sudah tercatat"; nomor kardus tambahan ikut dicek terhadap batas 999999.

## 11. Penyederhanaan alur WH (keputusan pemilik 2026-11-28)

Pemilik produk menilai alur Catat Serial WH terlalu ribet bagi WH. Butir di bawah MENGGANTIKAN bagian 6 dan 7 serta butir lain yang bertentangan; disetujui pemilik produk pada 2026-11-28.

1. **Halaman Stok Ready dihapus** (rute `/serial/gudang/ready`, butir sidebar, tombol "Keluarkan", oper draf, "Pilih N unit", salin clipboard). Tidak ada pengganti tampilan sisa stok lintas pencatatan (pemilik memilih "tidak perlu"). Bentuk tabel per kardus (selang-seling per kardus, kardus penuh lalu ecer) pindah ke bagian Serial Number di detail Riwayat Gudang untuk pencatatan Ready. Rute `serialWarehouse.readyStock` tetap ada di kontrak (penarikan rute mengikuti aturan versi API) dan dipakai dialog untuk nomor kardus awal. Pelepasan stok saat Penjualan selesai (bagian 7 butir 4-5) tetap berlaku di server.
2. **Dialog simpan** (Penjualan) berurutan: Tujuan, Tanggal Keluar (Ready: Tanggal Catat), No SO (opsional; tetap sebelum BU seperti semula), BU, Lokasi, Customer, Tautan Serah Terima, lalu catatan. Memilih SO yang sudah ada mengisi dan mengunci BU dan Customer dari SO itu dan juga mengisi Lokasi dari lokasi task yang tertaut ke SO itu bila semuanya berlokasi sama dan terbaca (satu SO diproses di satu lokasi; keputusan pemilik 2026-11-28); tanpa tautan atau lokasi berbeda-beda, Lokasi tetap dari data serial atau lokasi aktif. Pencarian No SO mencocokkan bagian mana pun dari nomor (`%teks%`), kecocokan persis dan awalan lebih dulu (koreksi pemilik 2026-11-28). Penjualan TANPA No SO diperbolehkan: pengeluaran tetap punya customer, BU, lokasi, dan tautan task, tetapi tidak membuat catatan SO.
3. **Tanggal uji serial baru** tidak lagi ditanyakan: serial baru memakai nilai chip Tanggal uji bila terisi, selain itu tanggal catat/keluar.
4. **BU dan Lokasi terisi otomatis dengan aturan yang sama**: pertama dari data serial yang sudah ada di pilihan; bila semua serial itu sama (BU atau lokasinya) nilai itu dipakai; bila berbeda-beda atau semuanya serial baru, jatuh ke cadangan: BU = satu-satunya BU Item yang boleh ditulis pengguna (selain itu pilih manual), Lokasi = lokasi aktif pengguna (bila tepat satu) atau kosong. (Koreksi pemilik 2026-11-28: BU juga dari data serial lebih dulu.)
5. **Urutan kardus** mengikuti urutan serial masuk pertama kali ke pilihan (scan/ketik/klik tabel), bukan urutan tampil tabel. Lokasi pada dialog juga menjadi lokasi serial baru.
6. **Tautan Serah Terima**: terkunci sampai Lokasi terisi. Setelah itu SEMUA task di lokasi itu langsung tampil (tanpa menunggu customer): hanya yang berstatus Dibatalkan atau terhapus disembunyikan; Selesai ikut tampil. Customer yang terisi hanya MENYARING. Urutan: status (Baru, Sedang dikerjakan, Selesai) lalu tanggal terbaru. Task yang menyebut Item diberi lencana, dan baris catatan yang menyebut Item terpilih ditandai (hijau) sedangkan baris yang menyebut Item lain ditandai (kuning) sebagai petunjuk tambahan di samping lencana; tidak ada peringkat menurut Item. Urutan = `ORDER BY status (Baru, Sedang dikerjakan, Selesai), created_at DESC` (bukan peringkat; keputusan pemilik: task yang tak menyebut Item tetap tampil).
7. **Kartu task** di dialog menampilkan catatan ter-render dengan checkbox (hanya baca), bukan cuplikan teks polos.
8. **Konfirmasi kecocokan**: saat Simpan, bila ada task tertaut yang catatannya tidak menyebut Item terpilih atau memuat baris yang menyebut Item lain, muncul dialog "Apakah daftar permintaan item ini sudah sesuai?" berisi kartu task (catatan ter-render, checkbox) dengan baris yang mungkin tidak cocok ditandai. Pilihan: Sesuai, lanjut simpan / Kembali.
9. **Catatan pembangun (server), 2026-11-28.** Penjualan tanpa No SO: `orderNumber: ''` (tanpa `orderId`) pada mode `order`. Tidak ada baris `warehouse_orders`. Agar kunci unik `warehouse_dispatch_serials_order_serial (order_id, serial_id)` tidak bentrok dengan penanda `''` milik pencatatan Ready, `order_id` pengeluaran itu diisi id pengeluarannya sendiri (ULID, unik); pengeluaran tanpa SO dikenali dari `kind = 'order'` dan `order_id = id` (`isBareSale`). Migrasi `0044_wh_penjualan_tanpa_so.sql` (expand-only) menambah `warehouse_dispatches.customer_id` dan `customer_name` (customer opsional, hanya penyaring task; dengan No SO customer tetap wajib); `bu_id` pengeluaran diisi BU-nya (seperti Ready). Tautan task disimpan di `warehouse_order_handovers` dengan `order_id` = id pengeluaran. Riwayat (daftar, detail, serial), penyapu 7 hari, pelepasan stok ready, dan "pernah keluar" memakai BU dan customer dari baris pengeluaran bila tidak ada SO; "pernah keluar" memuat penjualan tanpa SO dengan `orderId` dan `orderNumber` kosong. Audit bertarget id pengeluaran berlabel `Penjualan <tanggal>` (jenis log `warehouseOrder`, gerbang baca `assertReadableOrderTarget`). Pesan kejadian serial baru: `Dicatat Gudang · Penjualan`. Kandidat task: `locationId` baru, status tampil Baru, Sedang dikerjakan, Selesai (urut peringkat status lalu terbaru), field aditif `note`, `checklist`, `matchedLines`, `mismatchLines`; kursor lama `created~id` ditolak `VALIDATION`. Detail serial Ready membawa `boxId`, `boxNumber`, `capacity`, `boxCount`.
10. **Catatan pembangun (web), 2026-11-28.** Halaman Stok Ready dihapus bersama rute `/serial/gudang/ready`, butir sidebar, `hand-off`, filter, dan tabelnya; `readyMaxBoxQueryOptions` dan `lib/ready-box.ts` (`parsePositiveInt`, `boxPlanSummary`) tetap dipakai dialog. Tabel per kardus pindah ke `dispatch-box-table.tsx` (`DispatchBoxTable`, `rowTone` selang-seling per kardus, kolom Kardus berisi `boxCount/capacity`) dan dipakai `DispatchSerials` otomatis bila baris serial membawa `boxId`. Dialog simpan: No SO opsional (kosong = `orderNumber: ''`, tanpa `orderId`; customer wajib hanya untuk SO baru), isian tanggal uji dan "Lokasi serial baru" diganti satu field Lokasi (`ConfirmValues.locationId`) yang juga dipakai serial baru; BU dan Lokasi awal dihitung `lib/defaults.ts` (urutan: data serial yang sudah ada bila semuanya sama dan sah, lalu chip form, lalu cadangan: satu BU Item yang boleh ditulis, lokasi aktif tunggal via `useOptionalActiveLocations`); SO yang cocok mengisi Lokasi dari `order.locationId` sekali saat SO berganti dan Lokasi tetap dapat diubah. Tanggal uji serial baru: chip Tanggal uji bila terisi, selain itu tanggal keluar (diisi `startSubmit` tanpa mengubah urutan baris, jadi urutan kardus = urutan masuk ke pilihan). Pemilih tautan: prop `locationId` (string, `''` = terkunci; tanpa prop = semua lokasi terbaca, dipakai dialog "Tautkan task" di detail SO), kueri kandidat kini `infiniteQueryOptions` berkursor (`limit` 20, "Muat lebih banyak"), kotak "Tampilkan yang sudah selesai" dihapus, urutan server tidak diurutkan ulang. Kartu task memakai `CandidateNote` (Markdown hanya-baca lewat `MarkdownView` dengan penimpa `li`/`p`, centang dari `checklist`, tinggi dibatasi dan menggulir). Penanda baris: tiap baris sumber catatan diubah ke teks polos lewat `noteToPlainText` lalu dicocokkan ke himpunan `matchedLines` (hijau, ikon CircleCheck) dan `mismatchLines` (kuning, ikon TriangleAlert), dengan teks pembaca layar "Menyebut Item ini/lain" dan legenda; baris tanpa penanda tetap polos. Konfirmasi kecocokan memakai peta task yang pernah dimuat pemilih (`registry`); task yang DTO-nya tak dikenal dilewati. Penjualan tanpa No SO: tautan SO disembunyikan di detail Riwayat (No SO "—") dan log aktivitas memakai id pengeluaran; "pernah keluar" tanpa nomor ditulis "Tanpa No SO". Lokasi di dialog menimpa lokasi SEMUA serial baru (wajib diisi bila ada serial baru; teks "Dipakai juga untuk serial baru."); tanggal uji hanya mengisi yang kosong. Penanda baris dibuat per baris sumber, termasuk baris lanjutan (soft break) dalam satu paragraf atau butir. "Sesuai, lanjut simpan" memeriksa ulang blokir sebelum memanggil `onConfirm`; task asal yang tak ada di `registry` diberi catatan "Task asal belum diperiksa kecocokannya dengan Item" (tidak menahan simpan). Daftar kosong karena filter customer menampilkan "Tidak ada task untuk customer ini di lokasi ini". Belum dicoba di browser sungguhan (hanya tes jsdom).
- **Tautan Penjualan tanpa SO tampil di sisi task** (keputusan pemilik 2026-11-28 atas temuan review): detail task Serah Terima menampilkan juga pengeluaran Penjualan tanpa No SO yang menautkannya (hanya baca, bukan yang Dibatalkan); mengubah tautan tetap hanya dari sisi SO atau dialog simpan.
11. **Pilih dan salin terpilih di detail Riwayat** (keputusan pemilik 2026-11-28). Tabel Serial Number pada detail Riwayat Gudang (`DispatchSerials`, juga di detail SO) punya kotak centang per baris (kit `DataTable` `selection`, pilih rentang bawaan) dan `BulkBar` dengan aksi "Salin terpilih" yang menyalin lewat gestur klik sinkron (cadangan `ClipboardResultDialog`; toast "N Serial Number disalin"). Penjualan = satu SN per baris; pencatatan Ready berkardus = `Kardus<TAB>Serial` dengan baris judul dan apostrof untuk sel berawalan `=+-@` (`readyStockClipboard`). Hanya baris yang sudah dimuat dapat dipilih; "Salin ulang" (semua) tetap menjadi aksi halaman.
- **Urutan sumber BU/Lokasi awal** (konfirmasi 2026-11-28): data serial yang sudah ada lebih dulu, baru chip form, baru cadangan; Lokasi dialog menjadi lokasi semua serial baru.
- **Penempatan tautan Penjualan tanpa SO (pilihan pembangun, dapat dikoreksi; 2026-11-28):** detail task Serah Terima tidak punya tampilan "SO tertaut", jadi daftar hanya-baca `sales` (`WarehouseHandoverContextDto.sales`) ditampilkan di dialog simpan Catat Serial WH (mode Penjualan, di atas No SO), dengan nomor riwayat menaut ke Riwayat Gudang bagi yang berhak di peramban. Menampilkannya di halaman detail task butuh bagian UI baru di modul Serah Terima dan belum dikerjakan.
- **Tanpa serial, tanpa riwayat** (keputusan pemilik 2026-11-28): pengeluaran Gudang (Penjualan ber-SO, Penjualan tanpa SO, dan Ready) tidak boleh berakhir dengan nol serial. `serialWarehouse.submit` untuk pengeluaran satu potongan (total <= ukuran potongan) yang SEMUA barisnya dilewati ditolak `VALIDATION` pada field `rows` SEBELUM menulis apa pun (tanpa nomor riwayat, SO, tautan task, atau kardus). Pengeluaran bertahap yang pada potongan TERAKHIR ternyata tanpa satu pun serial dibatalkan bersih dalam satu `batch()` dan memberi galat yang sama: baris pengeluaran, potongan, kardus ready yang kosong, tautan task yang ditambahkan pengeluaran itu, dan SO yang dibuat khusus olehnya (bila tak punya pengeluaran atau tautan lain) dihapus; nomor riwayat yang sudah terpakai tidak dikembalikan (penghitung hanya naik) dan customer baru yang dibuat bersama SO tetap ada. Pesan: `Tidak ada serial yang dapat dicatat: <jumlah> <alasan>; ...` dengan alasan generik yang sama dengan daftar `skipped` (mis. `2 sudah tercatat wh`). Pengeluaran 0 serial yang sudah ada di basis data tetap tampil normal di daftar dan detail Riwayat (jumlah serial 0); tidak ada migrasi pembersihan (hapus manual bila perlu).
