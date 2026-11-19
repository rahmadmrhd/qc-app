# Serial Number unik se-sistem, cek ulang lintas BU, dan kode laporan baru: rancangan

Tanggal: 2026-11-18. Status: **DISETUJUI pemilik produk 2026-11-18** (butir §11 1-2, 4, 6-9 sesuai usulan; butir 3 dan 5 diubah pemilik, lihat §11). Induk: `2026-11-12-serial-number-design.md` (butir 4 §3 dibalik; butir 67 mencatat keputusan awal), `2026-11-18-serial-catat-wajib-foto-design.md` (butir N: BU serial bebas).

## 1. Tujuan dan latar belakang

BU serial kini dapat dipilih bebas saat mencatat (butir N), sehingga serial yang sama mudah masuk ke dua BU dan menjadi dua catatan dengan riwayat terpisah. Pemilik produk memutuskan (2026-11-18): **satu Serial Number = satu catatan di seluruh sistem**. Mencatat serial yang sudah ada, dengan BU atau lokasi berbeda, menjadi **kejadian cek ulang** pada catatan itu. Juga diputuskan: kode laporan berganti format.

Keputusan pemilik (semua 2026-11-18):
1. Serial unik se-sistem; entri serial yang sama = riwayat cek ulang, seperti catat ulang di lokasi lain.
2. Ada **tabel penghubung serial-BU** (opsi "catatan punya beberapa BU"); `serials.bu_id` tetap berarti **BU saat ini**.
3. Filter BU di daftar tetap menampilkan serial yang **pernah** lewat BU itu.
4. BU yang boleh dipilih pada cek ulang = **BU saat ini + BU yang belum pernah terlibat**; BU yang pernah dilewati dan sudah ditinggalkan tidak boleh. Contoh: A lalu B; berikutnya hanya B atau BU lain yang belum pernah, bukan A. Bawaan field BU = BU saat ini.
5. Serial dengan **laporan aktif** (Dilaporkan, di servis, Diagnosis, Sedang diperbaiki, Menunggu cek ulang): entri lewat Catat **ditolak** ("sudah ada laporan aktif"), di BU mana pun.
6. **Cek ulang: lolos** (aksi `recheck` hasil lolos dan `recheck_pass`) boleh sekaligus **memindahkan BU**; tidak perlu dua langkah.
7. **Kode laporan** menjadi `LP/<kode BU>/YYMM-iiii` (mis. `LP/SBY/2611-0042`); kode lama tidak diubah.

## 2. Anti-tujuan dan bukan tujuan

- Tidak menyatukan catatan serial ganda yang sudah ada secara otomatis tanpa laporan (lihat §8, skrip dengan mode uji coba).
- Tidak mengubah aturan item-BU di Data Item, izin per BU, atau stok stiker (stok tetap per lokasi, bukan BU).
- Pemindahan BU **tidak** dilakukan pada hasil tidak lolos (`recheck_fail`, `recheck` gagal).
- Tidak membuat jenis kejadian baru; pindah BU dicatat di data kejadian `recheck`.

## 3. Pendekatan yang dipertimbangkan

- **A. Tabel `serial_business_units` + `serials.bu_id` = BU saat ini (dipilih pemilik).** Filter BU dan aturan "belum pernah" satu query; indeks sederhana.
- B. Riwayat BU hanya dari kejadian: tanpa tabel baru, tetapi filter daftar mahal dan rapuh. Ditolak.
- C. Pindahkan BU tanpa riwayat (BU lama hilang dari filter): bertentangan dengan keputusan 3. Ditolak.

## 4. Model data

### 4.1 Tabel `serial_business_units` (migrasi baru, expand-only)
`serial_id` (PK bagian), `bu_id` (PK bagian), `first_at` (ISO UTC, saat BU itu mulai terlibat), `left_at` (ISO UTC atau `''`; terisi saat serial meninggalkan BU itu). Indeks sekunder (`bu_id`, `serial_id`) untuk filter daftar. **Invarian**: `serials.bu_id` selalu punya baris dengan `left_at = ''`; paling banyak satu baris per serial berstatus "saat ini". Isi awal (backfill idempoten): satu baris per serial dari `serials.bu_id`, `first_at = created_at`. Backfill yang sama dijalankan lagi tiap start server (`INSERT ... SELECT ... WHERE NOT EXISTS`, seperti `backfillPostelStickers`) agar rollback ke image lama yang menulis serial tanpa baris penghubung tetap pulih saat maju lagi.

### 4.2 Keunikan serial
Indeks baru `serials_serial` (unik pada `serial`) menggantikan `serials_bu_serial` (indeks lama dipertahankan sampai rilis berikutnya: expand, lalu contract). Migrasi membuat indeks unik lewat SQL bersyarat: bila **belum ada serial ganda** lintas BU, indeks dibuat; bila ada, dilewati tanpa menggagalkan start (hanya peringatan log; keunikan dijaga di aplikasi, §5.1) sampai skrip penyatuan (§8) dijalankan dan indeks dibuat pada start berikutnya (`ensureSerialUniqueIndex` idempoten saat boot). Peta konflik (`mapDuplicateError`/`SERIAL_CONFLICTS`) mendapat nama indeks baru.

### 4.3 Kolom lain
- `serial_cases.number`: `VARCHAR(32)` diperlebar menjadi `VARCHAR(64)` (nomor baru memuat kode BU; kode BU maks. 32 pada skema, validasi lokasi memakai maks. 10).
- `serial_events`: bila belum ada, tambah `client_id VARCHAR(100) NULL` dengan indeks unik (banyak NULL boleh) agar kejadian `recheck` dari Catat idempoten (kirim ulang setelah jaringan putus tidak menggandakan cek ulang dan potongan stok). Pelaksana memeriksa skema; bila kolom pengenal serupa sudah ada, memakainya.

## 5. Perilaku server

### 5.1 `serials.saveBatch` untuk serial yang sudah ada
Tiap baris (satu per serial ternormalisasi): server mencari serial **secara global**.
- **Tidak ada**: dibuat seperti sekarang (BU bebas, butir N).
- **Ada, tanpa laporan aktif, bukan Rusak**: menjadi **cek ulang lolos**, juga bila BU dan lokasinya sama dengan catatan (tidak ada lagi hasil `duplicate` untuk serial yang sudah ada; kirim ulang karena jaringan putus dicegah oleh pengenal kejadian, §4.3). Pemakaian field baris: `testDate` menjadi `occurredOn` kejadian dan **tidak** menimpa `serials.test_date` (tanggal uji pertama, butir 13 spek induk); `locationId` baris menjadi lokasi cek ulang **dan** `serials.location_id` ikut pindah ke lokasi itu (unit kini berada di sana; dicatat di `data.locationId/locationName`); `note` baris menjadi pesan kejadian `recheck` (bukan mengganti catatan serial); `sample` baris diabaikan (atribut sample serial tidak berubah). Hasil baris baru `rechecked` (bersama `created|duplicate|invalid|error`). Syarat: pengguna `serial: edit` di BU target (`canWriteBu(target)`), **tidak** harus punya hak di BU saat ini; BU target ∈ {BU saat ini} ∪ {BU tanpa baris di `serial_business_units`}; item baris sama dengan item catatan (bila beda: baris `invalid` dengan pesan yang menyebut item catatan, tanpa mengubah item; pengguna mengubah item lewat detail serial bila memang salah tipe). **Syarat item aktif dan terlihat (butir N) TIDAK diterapkan pada jalur cek ulang**: item catatan adalah acuan, jadi serial dengan item nonaktif atau di luar cakupan item pengguna tetap dapat dicek ulang bila BU target boleh ditulis; konsekuensinya `itemLabel` terungkap (§7); foto bukti dan lokasi dihormati seperti cek ulang biasa (item wajib foto tetap menuntut foto, lokasi baris menjadi lokasi cek ulang); stiker yang dicentang pada baris bertambah satu per stiker dan memotong stok di lokasi (jalur `stickerRaise`, stiker berlaku menurut BU target). **Bawaan baris Cek ulang: tidak ada stiker tercentang** (sama seperti aksi Cek ulang sekarang); pencatat mencentang hanya stiker yang ditempel lagi.
- **Ada dengan laporan aktif** (`open_case_id <> ''`): baris `invalid`, pesan "Serial ini sedang ada laporan aktif; selesaikan lewat halaman laporannya." Tanpa efek.
- **Ada berstatus Rusak**: baris `invalid`, pesan "Unit ini sudah dinyatakan rusak."
- Dilakukan dalam satu `batch()` dengan CAS `updated_at` serial: bila usang, muat ulang dan nilai ulang dari awal (bisa berubah menjadi `invalid`). Pindah BU menulis: `UPDATE serials SET bu_id`, `UPDATE serial_business_units SET left_at` pada baris lama, `INSERT` baris BU baru (kunci utama ganda = BU itu pernah terlibat, penjaga gagal, nilai ulang dan tolak). Kejadian `recheck` membawa `data.bu = { fromId, fromCode, toId, toCode }` hanya bila BU berubah. Konkurensi dua pencatat dengan serial sama: satu `created`, satu `rechecked` atau `duplicate` (indeks unik menjadi penjaga akhir).
- Ingat: kunci unik global ditangkap sebagai `duplicate` bila pembuatan serentak kalah; kirim ulang akan melewati jalur cek ulang.

### 5.2 `serials.act`
- Input `recheck` (hasil lolos) dan `recheck_pass` mendapat `buId?` (kosong = BU saat ini). Aturan BU target sama (§1 butir 4); hak: pengguna yang sudah berhak menindak serial (`modulesOn(user, BU saat ini)`) **dan** `canWriteBu(target)`. `recheck_fail` dan `recheck` gagal tidak menerima `buId` (ditolak `VALIDATION` bila diisi).
- `recheck_pass` pada laporan aktif: laporan ditutup seperti sekarang; `serial_cases.bu_id` tetap BU saat laporan dibuka; serial pindah BU sesuai `buId`.
- Aksi lain tidak berubah (selalu memakai BU saat ini).

### 5.3 Visibilitas dan filter
- **Baca** (daftar, detail, linimasa, berkas bukti dan gambar pesan, notifikasi daftar): serial terlihat bila `serials.bu_id` ATAU salah satu BU di `serial_business_units` berada dalam BU yang dapat dibaca pengguna. Satu fragmen SQL bersama (`readableSerialSql(buIds)` memakai `s.bu_id IN (...) OR s.id IN (SELECT serial_id FROM serial_business_units WHERE bu_id IN (...))`; bentuk dua jalan menoleransi baris penghubung yang belum terisi). BU lama membaca **seluruh** riwayat serial itu, termasuk kejadian sesudah serial pindah.
- **Tulis dan tindak** (ubah serial, aksi servis, laporan, kunci `canManageProof`): hanya BU saat ini (tidak berubah).
- **Filter BU** di daftar: serial yang pernah berada di BU itu (`serial_business_units`). Kolom BU di tabel tetap BU saat ini; detail menampilkan "Pernah di: A, C" bila ada riwayat.
- Laporan (kasus): visibilitas tetap menurut `serial_cases.bu_id` (BU saat dibuka); pembaca serial melihat semua kasus serial itu pada detailnya.
- Perf: daftar 200 ribu lebih serial (data lama) wajib diukur pada filter BU baru sebelum rilis (§9).

### 5.4 Pencarian dan Lapor Rusak
- `serials.lookup`: kini paling banyak satu kecocokan (unik); `matches` tetap hanya serial yang dapat ditulis pengguna pada BU saat ini. Bila serial ada tetapi BU saat ini di luar hak tulis pengguna, respons memuat `elsewhere: { buCode }` (BU saat ini saja, tanpa data lain), dan halaman Lapor Rusak menampilkan peringatan: "Serial ini ada di BU <kode> dan Anda tidak punya akses untuk melaporkannya." (keputusan pemilik 2026-11-18). Pemilih BU di halaman Lapor Rusak menjadi tidak berguna dan dibuang. `serials.reportNew` pada serial yang sudah ada tetap `CONFLICT` generik.
- `serials.reportNew`: cek duplikat menjadi global (pesan generik "Serial sudah terdaftar").
- Rute baru `serials.lookupMany` (maks. 200 serial, izin `serial: edit`) untuk draft Catat: tiap serial yang sudah ada dijawab `{ serial, id, itemId, itemLabel, buId, buCode, status, hasOpenCase, recheckBuIds }` dengan `recheckBuIds` = BU yang boleh dipilih pengguna ini (BU tulisnya ∩ aturan §1 butir 4). **Pengungkapan minimal**: hanya itu (tanpa catatan, riwayat, atau nama lokasi); lihat §11 butir 1.

### 5.5 Kode laporan
`LP/<kode BU>/YYMM-iiii`: `kode BU` = kode BU saat laporan dibuka (kode BU tidak dapat diubah, sehingga nomor stabil), `YYMM` = tahun-bulan WIB saat dibuat, `iiii` = urutan 4 digit **per (BU, bulan)** mulai 0001 (lebih dari 9999 memanjang). Penghitung CAS `counters` berkunci `lp:<KODEBU>:<YYMM>` (pengganti `lp:YYYYMMDD`); bila baris penghitung belum ada, nilai awal dari `MAX` nomor berawalan itu (cadangan seperti sekarang). Nomor lama (`LP-YYYYMMDD-NNN`) tidak diubah dan tetap valid; pencarian daftar Laporan tetap awalan (`LIKE 'q%'`) sehingga `LP/SBY/2611` dan `LP-2026` sama-sama bekerja. Nomor tidak dipakai di jalur URL (rute memakai UUID dan token), sehingga `/` aman; pemisah kursor daftar tetap `|`. `serialCaseNumber` (shared) menerima `(buCode, yymm, seq)`; teks di panduan, dokumen, dan tes disesuaikan.

## 6. Perilaku web

- Draft Catat: tiap serial baru yang ditambahkan memicu `serials.lookupMany` (dikumpulkan per kelompok). Baris serial yang sudah ada tampil sebagai **baris Cek ulang**: lencana "Cek ulang", item dan BU saat ini dari catatan (item tidak dapat diubah), field BU dibatasi ke `recheckBuIds` dengan bawaan BU saat ini bila termasuk (kosong bila pengguna tak punya hak di BU itu), lokasi dan tanggal dari Default seperti biasa, foto bukti sesuai item wajib foto, stiker yang berlaku menurut BU terpilih dengan **semua tidak tercentang** (dicentang hanya untuk stiker yang ditempel lagi). Baris yang serialnya punya laporan aktif atau Rusak langsung tampil bermasalah dengan pesan §5.1, tidak dapat disimpan.
- Hasil simpan menambah hitungan "n dicek ulang" (toast sukses murni tetap, ringkasan campuran inline). Duplikat dalam draft tetap menurut serial saja (sudah sesuai keunikan global).
- Dialog aksi Cek ulang dan Cek ulang: lolos di detail serial: field BU (`LinkField`, hanya untuk hasil lolos), bawaan BU saat ini, pilihan sesuai aturan §1 butir 4.
- Detail serial: "Pernah di" dan kejadian `recheck` yang memuat perpindahan tampil sebagai "Pindah BU: A → B" di linimasa.
- Panduan Interaktif `serial-catat` dan `docs/e2e-checklist.md` ditambah langkah cek ulang lintas BU.

## 7. Keamanan dan privasi

- Penegakan hak tetap di server; web hanya membatasi pilihan.
- Kebocoran lintas BU yang **disengaja dan minimal**: pencatat BU mana pun dapat mengetahui bahwa sebuah serial sudah ada (dari `lookupMany` dan hasil simpan) beserta item, BU saat ini, dan status. Ini konsekuensi langsung dari aturan "entri serial sama menjadi cek ulang lintas BU". Tidak ada catatan, riwayat, nama lokasi, atau data pelaku. Menunggu persetujuan (§11).
- Pindah BU melalui jalur Catat dapat dilakukan pengguna yang tidak berhak di BU asal; konsekuensinya BU asal kehilangan hak tulis (tetap membaca). Dicatat di linimasa sebagai kejadian berpelaku.
- Pesan galat tanpa nama BU lain selain yang sudah diungkap di atas.

## 8. Migrasi dan peluncuran (expand, lalu contract)

1. **Migrasi 1** (otomatis saat start): tabel `serial_business_units`, backfill, perlebar `serial_cases.number`, kolom `client_id` kejadian bila perlu, indeks unik bersyarat. Aman bagi image lama.
2. **Skrip `scripts/merge-duplicate-serials.ts`** (operator, mode uji coba bawaan): mendaftar serial ganda lintas BU; penyatuan = catatan **terbaru menang** (tanggal lalu id), baris lama dilipat ke riwayat serial pemenang (kejadian `note` "Digabung dari BU X" dan baris di `serial_business_units`), sesuai aturan migrasi data lama. Aturan penyatuan: **pemenang** = catatan dengan laporan aktif; bila tak ada, yang berstatus Rusak; bila tak ada, yang terbaru (tanggal uji lalu id terbesar). Seluruh data catatan yang kalah **dipindahkan ke pemenang**, bukan dihapus: kejadian (nomor `seq` disusun ulang menurut waktu dengan kejadian `note` "Digabung dari BU X" di titik penyatuan), kasus laporan, jumlah tempel stiker (`serial_stickers`: bila stiker sama, jumlah dijumlahkan), entri stok (`serial_id` ikut diarahkan), foto bukti, dan notifikasi; token halaman publik memakai `caseId` sehingga tetap berlaku. Catatan yang kalah dihapus setelah semua pindah, dalam satu transaksi per serial. BU catatan yang kalah masuk `serial_business_units` sebagai "sudah ditinggalkan" (terkunci dari cek ulang berikutnya, sama seperti BU lain yang pernah dilewati). Mode uji coba mencetak rencana per serial tanpa menulis. Wajib dijalankan di staging dan produksi sebelum indeks unik dibuat; laporan CSV (berisi serial, jangan di-commit).
3. **Skrip migrasi data lama (PR 114/117) wajib diselaraskan** (dikonfirmasi pemilik 2026-11-18: migrasi data lama **belum** dijalankan di produksi): melipat serial yang sama lintas BU (bukan hanya dalam satu BU; yang lebih lama masuk riwayat pemenang, BU-nya masuk `serial_business_units` sebagai sudah ditinggalkan) dan mengisi `serial_business_units` untuk setiap serial yang ditulisnya. **Urutan rilis dikunci**: fitur ini (tahap 2) dan penyelarasan skrip (tahap 4) sampai produksi **sebelum** migrasi data lama dijalankan di produksi; skrip penyatuan (butir 2) tetap disiapkan untuk serial ganda yang mungkin sudah dicatat pengguna di produksi.
4. **Contract** (rilis berikutnya): hapus indeks `serials_bu_serial`.
5. Kode laporan baru berlaku seketika; nomor lama tetap.
6. Rollback: image sebelumnya membaca `serials.bu_id` saja; tidak ada penghapusan skema.

## 9. Pengujian

- Server: unik global (indeks dan jaga aplikasi), `saveBatch` ke serial yang ada (cek ulang lolos pada BU saat ini, BU belum pernah, BU yang pernah ditinggalkan ditolak, laporan aktif ditolak, Rusak ditolak, item beda ditolak, foto wajib, stok terpotong di lokasi dan stiker sesuai BU target, idempoten lewat `clientId`), konkurensi (`Promise.all` dua BU dengan serial sama: tepat satu `created`), `recheck`/`recheck_pass` dengan `buId` (hak, aturan BU, pindah BU, laporan ditutup, `recheck_fail` menolak `buId`), visibilitas baca lewat riwayat BU dan filter BU, `lookupMany`, `reportNew` global, migrasi dan backfill idempoten, indeks bersyarat dengan dan tanpa serial ganda, skrip penyatuan, nomor laporan baru (urutan per BU dan bulan, balapan, cadangan `MAX`).
- Web: baris Cek ulang di draft (lookup, lencana, field BU dibatasi, pesan penolakan), dialog aksi dengan field BU, hasil `rechecked`, linimasa pindah BU, filter BU, tampilan nomor baru. Tes performa (manual) daftar dengan filter BU pada data staging berisi 200 ribu serial.

## 10. Urutan pengerjaan (usulan)

1. **PR kecil dan mandiri: kode laporan baru** (§5.5), karena tidak bergantung pada bagian lain.
2. **Server unik + cek ulang lintas BU** (§4, §5.1 sampai §5.4, migrasi, skrip penyatuan).
3. **Web** (§6) dan dokumen (spek induk butir 4 dan 67, `CLAUDE.md`, panduan, checklist).
4. **Penyelarasan skrip migrasi data lama** (§8 butir 3) dan peluncuran.

## 11. Keputusan perancang yang menunggu persetujuan pemilik

1. **Pengungkapan lintas BU minimal** (§7): pencatat BU mana pun melihat item, BU saat ini, dan status serial yang sudah ada. Alternatif: hanya "serial sudah tercatat" tanpa detail (item tak bisa dicocokkan di draft, jadi item beda tidak terdeteksi sebelum simpan).
2. **Item beda = ditolak** (bukan mengubah item diam-diam); pengguna mengubah item lewat detail serial.
3. **Stiker pada cek ulang lewat Catat** (**diubah pemilik 2026-11-18**): bawaan **tidak tercentang**, sama seperti cek ulang sekarang; stiker yang dicentang (ditempel lagi) masing-masing bertambah satu dan memotong stok satu di lokasi cek ulang.
4. **BU lama membaca seluruh riwayat serial** (termasuk sesudah pindah), tetapi tidak dapat menulis.
5. **Lapor Rusak** tetap menuntut hak tulis di BU saat ini serial (**ditambah pemilik 2026-11-18**: pengguna tanpa hak mendapat peringatan "Serial ini ada di BU <kode> dan Anda tidak punya akses untuk melaporkannya").
6. **Hak untuk pindah BU lewat Catat**: cukup hak tulis di BU target (tidak perlu hak di BU saat ini).
7. **Serial sama di BU dan lokasi yang sama juga menjadi cek ulang** (tidak ada `duplicate` lagi untuk serial yang sudah ada). Alasan: seragam dengan "catat ulang"; pengaman kirim ganda ada pada pengenal kejadian; pencatat dapat tidak mencentang stiker bila tidak ingin memotong stok.
8. **Pemakaian field baris pada cek ulang** (§5.1): `testDate` hanya menjadi tanggal kejadian; lokasi unit ikut pindah ke lokasi baris; `note` menjadi pesan kejadian; `sample` diabaikan.
9. **Jalur cek ulang tidak menerapkan syarat item aktif/terlihat** (item catatan adalah acuan).
