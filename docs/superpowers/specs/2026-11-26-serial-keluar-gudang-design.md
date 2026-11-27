# Serial Number: Keluar Gudang (WH), peringatan scan ulang QC, dan filter pencatat

Tanggal: 2026-11-26. Status: rancangan, revisi mockup dan cakupan pilih rentang sudah disetujui pemilik produk (2026-11-26); butir "Keputusan saya" di bagian 9 yang belum bertanda dikonfirmasi tetap usulan pembangun. Kode sudah dibuat di cabang `feat/serial-keluar-gudang` (belum di-merge; belum diuji di staging atau perangkat nyata). Migrasi `0040_serial_keluar_gudang.sql`. Status diperbarui 2026-11-27.
Spek terkait: `2026-11-12-serial-number-design.md` (induk), `2026-11-18-serial-unik-sistem-design.md`, `2026-11-18-serial-catat-wajib-foto-design.md`, `2026-11-13-serial-number-5b` (alur status).

## 1. Intinya

Tim WH mencatat serial number (SN) barang yang keluar untuk sebuah pesanan (SO) di Excel/spreadsheet mereka. Tim QC juga mencatat SN di aplikasi ini. Data yang di-scan WH bercampur: sebagian sudah dicatat QC, sebagian baru selesai dikerjakan dan belum dicatat QC.

Tujuannya efisiensi dua arah:
- WH **tidak scan ulang** SN yang sudah dicatat QC; cukup mencari dan memilihnya.
- QC **mendapat datanya** dari scan WH untuk SN yang belum sempat dicatat.

Rancangan ini punya tiga bagian:
- **A. Keluar Gudang**: halaman form baru untuk WH: pilih serial yang sudah ada atau buat bila belum ada, lalu salin daftar SN ke clipboard sebagai satu pengeluaran pada sebuah SO. Ada halaman Riwayat.
- **B. Peringatan scan ulang QC**: saat QC menyimpan di layar Catat, serial yang sudah tercatat di BU dan lokasi yang sama diberi peringatan "lanjut atau tidak".
- **C. Filter "Dicatat oleh"** di daftar Serial dengan pilihan banyak pengguna.

Alur lapangan (cerita pemilik): QC bekerja harian (acak) atau menurut pesanan. Bila ada permintaan pesanan, QC menyiapkan barang yang sudah jadi atau mengerjakannya dulu. WH lalu men-scan SN yang keluar dan mencatatnya di Excel. Satu SO bisa berisi ribuan serial dan beberapa Tipe.

## 2. Tujuan, bukan tujuan, anti-tujuan

Tujuan:
- WH menyelesaikan satu pengeluaran dengan satu kali scan per SN, tanpa mengetik ulang data QC.
- SN yang belum ada otomatis tercatat (status Lolos) sehingga QC tidak perlu mencatatnya lagi, kecuali melampirkan foto bukti bila item mewajibkannya.
- Setiap pengeluaran terekam per SO dan bisa disalin ulang dari Riwayat tanpa scan ulang.
- Satu SO dengan ribuan serial tetap bisa diselesaikan.

Bukan tujuan (versi ini):
- **Export** (tombol Export di form dan Riwayat ditunda; modelnya disiapkan supaya mudah ditambah).
- Mengubah atau menghapus pengeluaran yang sudah tersimpan.
- Mengubah status, posisi (custody), atau BU serial ketika keluar. Pengeluaran hanya catatan.
- Alur retur khusus (menandai barang kembali). Serial yang sama tetap boleh keluar lagi (lihat 5.4).
- Notifikasi ke QC, dashboard, dan dukungan aplikasi desktop. Fitur ini hanya web.
- Mengimpor file Excel WH. Panduan interaktif untuk halaman baru (masuk `MODULES_WITHOUT_GUIDE_YET`).

Anti-tujuan (gagal walau tampak jalan):
- Scan WH merusak atau menimpa data QC yang sudah ada.
- Serial sampah akibat salah ketik (karena itu serial baru tetap draf sampai pengeluaran dikonfirmasi).
- Stok stiker terpotong dua kali untuk satu serial.
- Izin Gudang membocorkan catatan, riwayat, atau pelaku serial lintas BU.
- Pengeluaran besar yang gagal di tengah dan meninggalkan keadaan tak jelas.

## 3. Pendekatan yang dipertimbangkan

1. **Halaman baru + modul server sendiri (dipilih pemilik).** Memakai komponen yang ada (input scan, pemilih Item/BU, pola draf Catat), tetapi layar dan data baru terpisah. Rute kirim membuat serial baru, catatan pengeluaran, dan potongan stok stiker. Paling banyak berkas baru, tetapi QC tidak terganggu dan bentuknya persis form yang diminta.
2. **Memperluas daftar Serial dengan "mode keluar".** Kode paling sedikit, tetapi daftar tidak punya baris draf dan filter `serials` dibatasi 50 serial di URL (`SERIAL_LIMITS.listSerialsMax`). Risiko regresi ke QC paling besar. Ditolak.
3. **Menambah mode WH di layar Catat.** Sudah punya draf, scan, kamera, tetapi Catat dibangun di atas aturan QC (gerbang Default, foto bukti, cek ulang lintas BU); mode WH akan penuh percabangan. Ditolak.

## 4. Keputusan pemilik produk (2026-11-26)

1. WH dikenali lewat **izin modul** (bukan pilihan di form dan bukan lokasi). Izin **per BU**: item dan BU untuk serial baru dibatasi pada BU yang diizinkan.
2. Scan = mencari serial (apa pun BU-nya) dan membuatnya bila belum ada. Satu pengeluaran hanya satu Tipe (Item). Beda Tipe = dialog error. Tanggal uji berbeda = warning.
3. Filter di halaman juga menjadi isian bawaan untuk serial baru. Tanpa filter, tabel menampilkan semua serial yang cocok.
4. Serial baru dari scan WH berstatus draf sampai WH menekan **Salin ke clipboard** (atau kelak Export). Itulah tombol kirim form.
5. Dialog konfirmasi berisi: tanggal keluar/pencatatan, customer, No SO, catatan, dan **BU** (WH memilih BU saat menyimpan).
6. **Satu catatan per SO, dan satu SO satu BU.** Beberapa kali Salin/Export dengan SO yang sama masuk ke catatan SO yang sama (satu SO bisa beberapa Tipe).
7. Satu SO bisa berisi **ribuan serial**; tidak ada batas 200 per SO.
8. Halaman **Riwayat** untuk melihat catatan dan menyalin ulang.
9. Bisa dimulai dari **Serah Terima**. Satu task bisa beberapa SO, dan satu SO bisa tertaut ke beberapa task (jarang).
10. Item **wajib foto bukti**: serial baru buatan WH dikecualikan dari wajib foto, diberi badge "Butuh foto", dan dialog konfirmasi menampilkan banner warning untuk mengingatkan QC melampirkan foto bukti.
11. Badge **"Tercatat WH"** pada serial; filter di form untuk mengecualikan yang sudah tercatat.
12. Serial yang sudah ada tetapi **BU-nya berbeda dari BU SO**: **boleh dengan warning**.
13. Serial yang sudah dikeluarkan WH di satu BU **boleh keluar lagi di BU lain** (kasus transaksi internal: pesanan customer di BU B tetapi barang ada di BU A).
14. Poin B: peringatan "lanjut atau tidak" saat QC menyimpan serial yang sudah tercatat di lokasi/BU yang sama. Poin C: filter "Dicatat oleh" pengguna.
15. Stiker pada pencatatan WH berarti "menambahkan bila belum tertempel", bukan menempel ulang.
16. **Revisi mockup (pemilik, 2026-11-26):** No SO pada dialog konfirmasi **dibuat otomatis** bila belum ada, seperti pembuatan customer pada Serah Terima (ketik saja, tanpa langkah "Buat SO" terpisah).
17. **Item adalah field wajib** (bukan chip filter): bertanda bintang, dan **terkunci** begitu ada serial yang dipilih, dengan pesan di bawahnya (selesaikan pengeluaran Tipe ini atau batalkan pilihan). BU, Lokasi, dan Tanggal uji **tetap chip filter**.
18. Menautkan task Serah Terima dari dialog harus **tanpa mencari atau menghafal**: pemilih menyajikan task customer itu sendiri (lihat 5.5).
19. Pilihan baris mendukung **shift-klik (rentang) di desktop** dan **pilih tarik di ponsel** (lihat 5.13).
20. **Dikonfirmasi pemilik 2026-11-26:** tabel kosong ("Pilih Item atau scan serial untuk mulai") sampai Item terisi. Ini menggantikan keputusan awal "tanpa filter, tabel menampilkan semua serial".
21. **Pemilik 2026-11-26:** pilih rentang berlaku untuk **semua tabel di halaman indeks dan semua tempat lain yang memakai tabel/kartu berkotak centang** (rincian cakupan di 5.13), bukan hanya halaman Keluar Gudang.
22. **Pemilik 2026-11-26:** satu kolom Serial Number (scan sekaligus cari) sebaris dengan Item di desktop; di ponsel Item di atas kolom scan.
23. **Dikonfirmasi pemilik 2026-11-26:** pencocokan nama Item pada catatan Serah Terima dengan pembersihan tanda baca, spasi, dan huruf kecil; dipakai sebagai petunjuk, bukan tautan permanen (5.14).
24. **Disetujui pemilik produk 2026-11-27:** baris bermasalah **dilewati**, tidak menggagalkan seluruh potongan, mengikuti pola pencatatan Serial Number oleh QC (hasil per baris, baris bermasalah tetap di draf). Menggantikan "potongan itu gagal" pada 5.7. Alasan: satu SN yang berubah di tengah pengiriman tidak boleh menahan SO; pengeluaran macet tidak lagi muncul untuk kasus baris, sehingga rute pembatalan pengeluaran `pending` tidak dibuat. Pengeluaran yang semua barisnya dilewati tetap selesai dengan 0 serial (pilihan implementer, belum dikonfirmasi pemilik).
25. **Disetujui pemilik produk 2026-11-27:** serial baru yang dibuat pengeluaran yang kemudian dibatalkan penyapu tetap bertanda `wh_created` (diterima apa adanya).
26. **Disetujui pemilik produk 2026-11-27:** jumlah serial yang melebihi kolom INT dijawab `VALIDATION` rapi, tanpa batas buatan (spek tetap "tanpa batas jumlah").
27. **Disetujui pemilik produk 2026-11-27:** tanggal kejadian `recorded` serial baru = tanggal keluar yang diisi pengguna.
28. **Disetujui pemilik produk 2026-11-27:** detail SO di Riwayat memuat panel **Log aktivitas** (`warehouseOrder`; aksi `serialwh.dispatch_create`, `dispatch_done`, `links_update`, `dispatch_cancel`; hanya ringkasan jumlah, tanpa daftar SN).
30. **Disetujui pemilik produk 2026-11-27 (menyempurnakan 5.4 dan 5.9):** hasil scan lintas BU membawa boolean `recorded` (ada pengeluaran selesai di BU mana pun, sama dengan lencana di daftar Serial) dan rujukan pengeluaran. Untuk SO di BU yang **tidak terbaca** pengguna, rujukan hanya memuat **kode BU dan tanggal keluar**, tanpa No SO dan tanpa id SO; untuk BU terbaca rujukan lengkap. Info "pernah keluar" untuk BU tak terbaca tampil sebagai info "BU lain" tanpa No SO. Alasan: lencana tetap konsisten, daftar transaksi SO BU lain tidak terbuka. Kuota rujukan dipisah (maks. 20 terbaca, 20 tak terbaca).
29. **Disetujui pemilik produk 2026-11-27:** logout **ditahan dengan peringatan** selama ada kiriman Keluar Gudang berjalan (draf tetap dibuang saat logout, bagian terkirim dibatalkan otomatis setelah 7 hari); lencana task "Menyebut Item ini" tetap generik; dialog hasil muncul setelah tiap pengeluaran.

## 5. Bagian A: Keluar Gudang

### 5.1 Izin

Modul baru `serialwh`, label "Gudang Serial Number", level `none` / `view` / `edit`, **per BU** (masuk `BU_MODULES` di `shared/business-units.ts`, mengikuti pola `serialservice`).
- `view`: membuka Riwayat dan detailnya, termasuk **Salin ulang** (hanya membaca, tidak menulis apa pun).
- `edit`: memakai form Keluar Gudang (juga tombol dari Serah Terima) dan membuat pengeluaran pada BU itu.
Tambahkan ke `MODULES`, `MODULE_LABELS`, `MODULE_LEVELS`, hint, form role, penugasan BU, dan semua tes yang mengenumerasi modul.

### 5.2 Halaman dan navigasi

- `/serial/gudang` "Keluar Gudang" (form), `/serial/gudang/riwayat` (daftar catatan SO), `/serial/gudang/riwayat/$orderId` (detail). Butir sidebar di grup Serial Number, terlihat bagi `serialwh: view`; form butuh `edit`.
- Memakai kit halaman proyek (`ListPage`/`ViewPage`/`FormPage` sesuai jenis halaman, `scripts/page-frame.test.ts`), `crumb` rute, dan `staticData` sesuai aturan cangkang.

### 5.3 Form

Istilah: "Tipe" = satu Item (`itemId`; Item di proyek ini = merk + tipe). "Satu Tipe" berarti satu `itemId`, dan "Tipe beda" dibandingkan lewat `itemId`.

Bagian atas terdiri dari dua jenis isian yang sengaja dibedakan tampilannya:
- **Field wajib: Item** (satu Tipe). Berupa `LinkField` berlabel dengan bintang (`Label required`), bukan chip, supaya terasa sebagai kewajiban. Pilihan Item = item pada BU yang punya `serialwh: edit` (dipersempit chip BU bila terisi; tidak butuh izin Item). **Terkunci** selama ada serial yang dipilih (termasuk serial draf baru): tampil nonaktif dengan ikon gembok dan **pesan di bawah field**: "Terkunci karena N serial sudah dipilih. Selesaikan pengeluaran Tipe ini, atau [Batalkan pilihan]." Tautan "Batalkan pilihan" mengosongkan pilihan (dengan konfirmasi bila ada serial draf baru yang akan terbuang) dan membuka kunci. Item juga menyaring tabel.
- **Chip filter: BU, Lokasi, Tanggal uji** (satu tanggal), plus pencarian teks dan saklar "Sembunyikan yang sudah tercatat WH di BU ini" (bawaan menyala). Chip ini juga menjadi isian bawaan serial baru (BU = BU pengeluaran/SO; ketiganya wajib terisi sebelum scan dapat membuat serial baru, lihat 5.4). Pilihan BU = BU dengan `serialwh: edit`. Chip yang terisi menyaring tabel; yang kosong tidak menyaring. Memakai pola chip filter proyek (`FilterChip`, draf `useChipDraft`).

**Tata letak (pemilik 2026-11-26):** hanya **satu kolom Serial Number** yang berfungsi sebagai scan sekaligus pencarian (tidak ada kolom "Cari serial" terpisah). Mengetik menyaring tabel (tertunda sebentar); scan atau Enter memilih serial persis itu (atau membuat draf baru bila belum ada, lihat 5.4). Desktop: field Item dan kolom Serial Number **satu baris**, chip BU/Lokasi/Tanggal uji dan saklar di baris berikutnya. Ponsel: **Item di atas, kolom Serial Number di bawahnya** (Item bergulir pergi, kolom scan menempel di atas layar).

Di bawahnya: input scan (pemindai fisik, kamera opsional memakai komponen yang ada), lalu tabel serial.
- **Tabel kosong sebelum Item terisi**: selama Item kosong, tabel menampilkan keadaan kosong "Pilih Item atau scan serial untuk mulai" (satu pengeluaran hanya satu Tipe, jadi tabel campur Tipe tidak berguna dan bisa sangat besar). Scan serial yang sudah ada mengisi Item otomatis (lalu terkunci karena sudah ada pilihan).
- **Daftar tabel** (Item terisi) memuat serial Item itu pada BU yang boleh dilihat pengguna (izin `serialwh`), berpaginasi, dipersempit chip yang terisi.
- **Hasil scan** dicari **lintas BU** (apa pun BU-nya) dengan kolom minimal; serial yang dipilih lewat scan tetap tampil di tabel walau di luar filter atau di luar BU yang boleh dilihat. Pilihan bertahan saat filter diganti.

Kolom minimal: kotak centang, SN, Item, BU saat ini, Lokasi, Tanggal uji, Status, badge ("Tercatat WH", "Draf baru", "Butuh foto"). Tanpa catatan, riwayat, atau pelaku (lihat 5.9).

Draf (pilihan, serial draf baru, isian filter) disimpan di perangkat WH per pengguna (seperti draf Catat) dan tahan muat ulang. Karena satu pengeluaran bisa ribuan serial, tabel draf dan pilihan harus tetap cepat (paginasi atau virtualisasi). **Tidak ada batas jumlah serial** per pengeluaran maupun per SO (keputusan pemilik 2026-11-26); batas teknis 200 serial hanya berlaku per potongan kirim (5.7), bukan per pengeluaran. Draf dan tabel harus tetap cepat berapa pun jumlahnya.

### 5.4 Hasil scan

SN dinormalisasi dengan `normalizeSerial` (huruf besar, MAC jadi 12 heksadesimal). Hasilnya:

| Keadaan serial | Hasil |
|---|---|
| Sudah ada, satu Tipe dengan field Item (atau Item masih kosong), status Lolos dan posisi QC | Dipilih; bila Item kosong, field Item terisi Tipe serial itu |
| Sudah ada, Tipe beda dari Item, **belum ada serial yang dipilih** | Dialog konfirmasi "Ganti Item ke X?" (Ganti / Batal); Ganti = isi Item dengan Tipe serial itu lalu pilih serialnya |
| Sudah ada, Tipe beda dari Item, **sudah ada serial yang dipilih** (Item terkunci) | **Dialog error**, tidak dipilih; pesan menyebut "Selesaikan pengeluaran Tipe ini atau batalkan pilihan" |
| Sudah ada dan tanggal ujinya beda dari serial lain yang dipilih | Dipilih, **warning** pada baris |
| Sudah ada, **BU saat ini berbeda dari BU yang dipilih di form** | Dipilih, **warning** pada baris ("serial ada di BU X, SO ini BU Y"); BU serial tidak berubah |
| Sudah tercatat WH di **SO yang sama** | Pesan "Sudah ada di SO ini"; tidak dipilih |
| Sudah tercatat WH di SO lain pada **BU yang sama** | Dipilih, **warning** ("sebelumnya keluar di SO X, tanggal Y"; mungkin duplikat atau retur) |
| Sudah tercatat WH di SO pada **BU lain** | Dipilih, hanya info ("sebelumnya keluar di SO X, BU A"); ini transaksi internal yang sah |
| Sudah ada tetapi status bukan Lolos atau posisi bukan QC | Pesan menyebut status/posisi; tidak dapat dipilih |
| Ada di sistem tetapi terhapus | Diperlakukan "belum ada" (aturan soft delete yang ada: mencatat ulang = record baru) |
| Belum ada | **Baris draf baru** memakai isian bawaan (field Item serta chip BU, Lokasi, Tanggal uji); bila ada yang kosong, scan ditahan dengan pesan yang menyebut isian mana yang kurang ("Pilih Item dulu", atau "Isi BU, Lokasi, dan Tanggal uji dulu") dan field/chip yang kurang disorot; BU harus yang diizinkan |
| Sudah ada di tabel/pilihan sesi ini | Diabaikan dan barisnya disorot |

Scan serial yang sudah ada **tidak menulis apa pun** (tanpa kejadian, tanpa stiker, tanpa cek ulang). Karena itu aturan "stiker tambah bila belum tertempel" praktis hanya berlaku pada serial baru, yang stikernya otomatis baru semua.

"Tercatat WH" artinya serial ada di minimal satu pengeluaran yang sudah selesai. Centang "Sembunyikan yang sudah tercatat WH di BU ini" menyembunyikan serial yang sudah ada di pengeluaran pada BU terpilih; serial yang pernah keluar di BU lain tetap tampil.

Item tidak dapat diganti selama ada pilihan (terkunci, 5.3); mengganti Item berarti membatalkan pilihan lebih dulu. Ganti chip BU ketika ada pilihan: warning BU per serial dihitung ulang.

### 5.5 Dialog konfirmasi

Dibuka oleh **Salin ke clipboard** (tombol kirim form; tombol Export belum ada). Isi:
- **Tanggal keluar/pencatatan**: bawaan hari ini (WIB), tidak boleh setelah hari ini.
- **No SO** (wajib): kolom ketik dengan saran SO yang sudah ada (pencarian sambil mengetik; diurutkan SO pada BU form lebih dulu, lalu yang terbaru). **SO baru dibuat otomatis saat disimpan**, persis pola customer pada Serah Terima: tidak ada langkah "Buat SO" terpisah. Teks yang cocok persis (tanpa beda huruf besar/kecil, setelah normalisasi) dengan SO yang ada = memilih SO itu; teks lain = SO baru, ditandai lencana **"SO baru"** di dalam field dengan keterangan "Dibuat saat disimpan". Normalisasi: buang spasi pinggir, tanpa karakter kontrol atau pengatur arah teks (`hasControlChars`), maks. 40 karakter; unik se-sistem tanpa beda huruf besar/kecil. Dibangun mengikuti `CustomerCombobox` (`web/src/modules/handover/components/customer-combobox.tsx`): daftar saran muncul **langsung di bawah field**, juga di ponsel (tanpa halaman atau layar pemilih terpisah; field digulir ke area terlihat saat papan ketik muncul, memakai `useFocusIntoView`). Seperti `CustomerCombobox`, ini pengecualian aturan "field relasi wajib `LinkField`" (teks bebas yang membuat record otomatis); catat di bagian pengecualian CLAUDE.md saat implementasi.
- **BU**: terisi dari chip BU; **terkunci** bila SO sudah ada (satu SO satu BU, mengikuti BU SO itu). Bila BU SO yang ada berbeda dari BU form, pilihan BU form diganti ke BU SO itu dan warning BU per serial dihitung ulang. Untuk SO baru, BU boleh diubah (BU dengan `serialwh: edit`).
- **Customer** (wajib): master customer yang ada, boleh ketik baru (dibuat otomatis seperti di Serah Terima, `lookupCustomerForWrite`). Bila SO sudah ada, customer terisi dan terkunci dari catatan SO itu.
- **Tautan Serah Terima** (opsional, boleh banyak): **pemilih tanpa pencarian wajib**. Begitu customer terisi, dialog langsung menampilkan daftar **task customer itu yang masih berjalan** (belum Selesai atau Dibatalkan) pada lokasi yang boleh dibaca pengguna, terbaru dulu, maks. 5 baris, tiap baris = kotak centang + nomor task, tanggal, cuplikan satu baris catatan, dan lencana status; satu ketukan = tertaut. Task yang sudah tertaut ke SO ini tampil lebih dulu, tercentang. Di bawah daftar: kolom "Cari task lain" (nomor, customer, atau isi catatan) dan saklar "Tampilkan yang sudah selesai". Daftar kosong menampilkan "Tidak ada task berjalan untuk customer ini" (tautan bersifat opsional, tombol simpan tidak terhalang). Tidak ada centang otomatis (tautan salah menjadi derau data); bila memulai dari task (5.11) task itu sudah tercentang. Tautan juga dapat ditambah atau dilepas kemudian dari detail Riwayat (5.10).
- **Catatan** (opsional, maks. 1.000 karakter).
- Ringkasan: jumlah serial, berapa yang baru, Tipe, rentang tanggal uji.
- **Banner warning foto** (tampil bila ada serial baru milik item wajib foto): "Serial baru untuk item wajib foto dicatat tanpa foto bukti. Ingatkan tim QC untuk melampirkan foto bukti QC."
- **Warning tanggal uji beda** dan **warning BU berbeda** bila berlaku, masing-masing dengan jumlah serialnya.
- Bila memulai dari task Serah Terima dan SO terpilih belum tertaut ke task itu: task itu sudah tercentang di bagian Tautan, dengan info "SO ini akan ditautkan ke task ...".

Tombol: "Simpan & salin" dan Batal.

### 5.6 Isi clipboard dan kegagalan menyalin

Teks polos, **satu SN per baris**, dinormalisasi, dengan urutan seperti di tabel. Salin ulang dari Riwayat memakai format yang sama. Pengeluaran sudah tersimpan saat menyalin, jadi bila penulisan clipboard gagal (izin peramban atau gestur kedaluwarsa setelah menunggu server) tampilkan dialog hasil dengan area teks dan tombol "Salin lagi", bukan mengulang pengiriman.

### 5.7 Kirim (server)

Pengeluaran besar dikirim **bertahap**: klien memecah daftar serial menjadi potongan paling banyak **200 serial** (`SERIAL_LIMITS.batchRows`), tiap potongan satu transaksi atomik (`batch()`) dan idempoten lewat `clientId` pengeluaran + nomor potongan. Rute (nama final diserahkan ke pembangun, mis. `serialWarehouse.submit`) menerima: `clientId`, nomor potongan dan jumlah potongan, kolom tetap pengeluaran (tanggal keluar, No SO atau id SO, customer, BU, `handoverId?`, catatan), dan serial pada potongan itu (id serial yang sudah ada, atau data serial baru: serial, itemId, lokasi, tanggal uji).
- Potongan pertama membuat catatan SO (bila baru) dan pengeluaran berstatus **sedang disimpan**; potongan berikutnya menambah serial; setelah semua potongan 0..N-1 masuk, server menandai pengeluaran **selesai**. Kolom tetap pada tiap potongan harus sama dengan potongan pertama.
- Hasil rute pada potongan terakhir memuat daftar SN lengkap untuk clipboard.
- **Gagal di tengah**: potongan yang sudah masuk tetap tersimpan (serial baru adalah record nyata). Draf di perangkat WH menyimpan potongan yang sudah terkirim dan melanjutkan dari potongan berikutnya. Pengeluaran yang belum selesai tampil di Riwayat sebagai "Belum selesai" dengan "Lanjutkan" (membuka form dengan draf bila ada) dan tidak dapat disalin sebelum selesai. Pengeluaran yang tidak selesai dalam 7 hari dibatalkan otomatis oleh penyapu (keanggotaan serialnya dilepas; serial baru yang sudah dibuat tetap ada). Pembangun boleh mengganti batas hari.

Aturan:
- Semua serial pada satu pengeluaran satu Tipe; serial yang sudah ada harus berstatus Lolos, posisi QC, dan tidak terhapus. **Satu serial tidak boleh dua kali pada SO yang sama** (indeks unik per SO + serial). Serial boleh ada di beberapa SO berbeda (kasus transaksi internal antar-BU dan retur); hanya itu pembatas keunikannya.
- Pemanggil harus memegang `serialwh: edit` pada **BU SO**. Serial yang sudah ada di BU lain tetap boleh dipilih (warning), tetapi tidak berubah.
- Serial baru: item milik BU SO dan aktif, BU aktif, lokasi aktif; tanggal uji valid dan tidak setelah hari ini; SN unik se-sistem (indeks `serials_serial_live`). Dibuat dengan status Lolos, posisi QC, BU = BU SO, kejadian `recorded` bertanda sumber Gudang. Stiker: semua stiker yang berlaku bagi Item+BU dengan `defaultQty`, dan stok terpotong lewat bus event yang sama dengan pencatatan biasa (`serial.recorded`). Alasannya: stiker fisik sudah ditempel QC dan stok harus turun satu kali. Cek ulang QC kemudian memakai stiker bawaan kosong sehingga tidak dobel. Nilai wajib yang tidak ada di form (`sample`, `note`): `sample` = tidak, `note` otomatis "Dicatat Gudang · SO <no>".
- **Foto bukti dikecualikan** untuk serial baru buatan WH walau item wajib foto.
- Balapan serial: bila serial draf ternyata sudah dibuat orang lain saat potongan dikirim: dengan Item yang sama dan memenuhi semua syarat serial yang sudah ada (5.4) = diperlakukan sebagai serial yang sudah ada (tanpa menulis ulang stiker, stok, atau kejadian); selain itu (Item beda, status/posisi tidak memenuhi, atau sudah ada di SO ini) **baris itu dilewati**, bukan menggagalkan potongan (keputusan pemilik 2026-11-27, butir 24 di bagian 4): baris lain di potongan yang sama tetap tersimpan, dan respons memuat `skipped` (SN + alasan singkat) untuk potongan itu serta `skippedTotal` gabungan pada potongan terakhir. Baris yang dilewati tidak menjadi anggota SO, tetap di draf klien, dan boleh dikeluarkan ulang ke SO yang sama. Hanya galat tingkat potongan atau header (hak, BU/SO/customer, Item tidak dapat dipakai untuk serial baru, hash atau total berubah, `clientId` konflik) yang masih menggagalkan seluruh potongan dan membiarkan draf utuh.
- Balapan SO/customer: SO dan customer baru dibuat dalam transaksi yang sama dengan potongan pertama. Bila dua kiriman membuat No SO yang sama bersamaan, yang kalah **bergabung** ke SO yang menang bila customer dan BU-nya sama; selain itu `CONFLICT` dengan pesan generik. Customer baru memakai pencarian-atau-buat yang idempoten (`lookupCustomerForWrite`).
- Pengiriman membawa **daftar `handoverIds`** (opsional, maks. 20). Server memeriksa bahwa pemanggil boleh membaca tiap task (izin `handover` pada lokasi task); tidak boleh hanya UI. Task tak terbaca atau terhapus = `NOT_FOUND`. Tautan SO-task ditambahkan bila belum ada (satu SO boleh tertaut ke beberapa task); tautan yang sudah ada tidak dihapus oleh pengiriman.
- Rute baca untuk pemilih tautan (nama final ke pembangun, mis. `serialWarehouse.handoverCandidates`): `serialwh: edit`, masukan `customer` (nama atau id), `q`, `includeFinished`, `soId?` (agar yang sudah tertaut ikut dan tercentang), `limit`/kursor; keluaran hanya nomor task, tanggal, cuplikan catatan (`notificationPreviewText`-gaya, satu baris), status, dan penanda tertaut; disaring lokasi yang boleh dibaca pemanggil lewat pemuat baca task yang sama dengan `handovers.get`. Task terhapus tak pernah muncul.
- Rute ubah tautan SO-task (mis. `serialWarehouse.setLinks`): `serialwh: edit` pada BU SO, PUT daftar `handoverIds` utuh dengan CAS pada catatan SO (atau tambah/lepas satu), audit tersendiri; hanya mengubah tautan, bukan pengeluaran.

### 5.8 Data (nama dapat disesuaikan pembangun)

Migrasi expand-only, idempoten (nomor bebas berikutnya, saat ini 0038):
- Catatan SO: id ULID (`newId()`), No SO, kunci ternormalisasi unik, **`bu_id`** (tetap setelah dibuat), customer, catatan umum, pembuat dan waktu.
- Tautan SO ke task Serah Terima: tabel penghubung (SO, task), banyak-ke-banyak; task tidak berubah oleh tautan ini.
- Pengeluaran: id, SO, Item (Tipe), tanggal keluar, catatan, mode (`clipboard`; kelak `export`), **status (`pending`/`selesai`)**, jumlah potongan, `client_id` unik, jumlah serial, pembuat dan waktu.
- Baris pengeluaran: id pengeluaran, id serial, SN salinan, urutan, **unik per (SO, serial)**.
- Tanda "dibuat Gudang" pada serial (kolom atau penanda yang bisa difilter dan diindeks).
- Badge "Tercatat WH" **dihitung** (serial ada di baris pengeluaran yang selesai), bukan kolom status. Badge "Butuh foto" **dihitung**: serial dibuat Gudang, item wajib foto, dan jumlah foto bukti belum mencapai minimum item; hilang sendiri setelah QC melampirkan foto lewat Cek ulang.
- Audit: aksi untuk pembuatan pengeluaran (target = id catatan SO).

### 5.9 Hak baca lintas BU

Izin Gudang per BU. Hasil scan dicari lintas BU, tetapi hanya mengungkap kolom minimal (setara pengungkapan minimal `serials.lookupMany`): SN, Item, BU saat ini, Lokasi, Tanggal uji, Status, badge. Tidak pernah catatan, riwayat kejadian, pelaku, atau foto serial dari BU di luar hak. Daftar tabel tanpa scan dibatasi pada BU yang diizinkan. Detail lengkap serial tetap lewat izin `serial`/`serialservice` dan BU masing-masing. Riwayat menampilkan catatan SO pada BU yang diizinkan (`serialwh: view`).

### 5.10 Riwayat

- Daftar catatan SO: No SO, BU, customer, jumlah pengeluaran, jumlah serial, tanggal terakhir, status ("Belum selesai" bila ada pengeluaran sedang disimpan), tautan task Serah Terima bila ada; filter customer, teks, BU, dan tanggal; berpaginasi.
- Detail: header SO dengan **bagian "Task Serah Terima"** (daftar task tertaut, tiap baris membuka task bila pengguna boleh membacanya, dan tombol "Tautkan task" yang membuka pemilih yang sama dengan dialog konfirmasi, serta tombol lepas per task; hanya bagi `serialwh: edit`), dan daftar pengeluaran (tanggal, Tipe, jumlah, pelaku, catatan, status) dengan tabel serialnya (berpaginasi) dan tombol **Salin ulang** (hanya pengeluaran selesai). Pengeluaran dan serialnya hanya baca; yang dapat diubah hanya tautan task. Serial terhapus tampil dengan penanda "Terhapus" dan tetap ikut tersalin (SN sudah tersimpan sebagai salinan).

### 5.11 Dari Serah Terima

Task Serah Terima mendapat aksi "Keluar Gudang" bagi pemegang `serialwh: edit` (pada minimal satu BU) yang juga dapat membaca task itu, tidak tampil untuk task terhapus. Membuka `/serial/gudang?handover=<id>`: customer pada dialog terisi dari task, task itu tercentang di bagian Tautan, No SO kosong; SO yang sudah tertaut ke task itu disarankan lebih dulu. SO baru yang dibuat dari sini tertaut ke task itu; memilih SO yang sudah ada menambah tautan ke task ini (dengan info di dialog). Satu task boleh punya banyak SO dan satu SO boleh tertaut ke beberapa task. Task tidak menyimpan SO. Detail task tidak menampilkan SO terkait di versi ini; hanya Riwayat Gudang yang menautkan balik ke task. Ini jalur satu klik dari sisi task; jalur dari sisi Gudang tanpa menghafal task = pemilih berbasis customer di dialog (5.5), dan koreksi susulan = "Tautkan task" di detail Riwayat (5.10).

### 5.12 Rancangan tampilan (desktop dan mobile)

Mockup resolusi tinggi: `docs/superpowers/specs/mockups/2026-11-26-keluar-gudang-mockup.html` (desktop: form, dialog konfirmasi, Riwayat; mobile: form dan scan, hasil scan, konfirmasi, progres, Riwayat). Prinsip UI/UX:

Desktop:
- Satu halaman kerja: baris isian di atas (field **Item** wajib berbintang di kiri, **chip filter** BU, Lokasi, Tanggal uji di sebelahnya), **kolom Serial Number tunggal (scan sekaligus cari) sebaris dengan Item**, ringkasan (jumlah dipilih, draf baru, warning) di sebelahnya, chip filter dan saklar di baris berikutnya, lalu tabel. Tombol utama "Salin ke clipboard (N)" di bar judul. Item terkunci tampil dengan gembok dan pesan di bawah field.
- **Shift+klik** pada kotak centang memilih rentang (5.13); petunjuk singkat di kaki tabel.
- Hasil scan terakhir tampil sebagai satu baris umpan balik (hijau/kuning/merah) dan barisnya disorot di tabel, tanpa dialog untuk kasus biasa. Dialog error hanya untuk Tipe berbeda.
- Warning dikelompokkan sebagai banner ringkas di atas tabel (tanggal uji beda, BU berbeda, pernah keluar), masing-masing bisa dibuka untuk melihat serialnya.

Mobile (ponsel; pemindai fisik Bluetooth dan kamera keduanya didukung):
- **Urutan dari atas: field Item, lalu kolom Serial Number** (satu kolom untuk scan dan cari). Item bergulir pergi; **kolom Serial Number menempel di atas layar**, selalu terlihat (input besar + tombol kamera); fokus kembali ke input setelah tiap scan supaya pemindai fisik bisa dipakai tanpa menyentuh layar. Getar dan nada singkat untuk sukses, getar ganda untuk error (bila perangkat mendukung).
- **Item = field wajib** penuh lebar tepat di bawah kolom scan (berlabel, bintang merah), terkunci dengan gembok dan pesan "Terkunci karena N serial sudah dipilih. Selesaikan pengeluaran ini, atau Batalkan pilihan" bila ada pilihan. BU, Lokasi, dan Tanggal uji = deretan **chip filter** yang bisa digeser; menekan chip membuka lembar bawah (pola chip filter proyek), bukan form panjang.
- **Pilih tarik** pada daftar kartu (5.13).
- Daftar serial = kartu padat (`MobileCard`): kotak centang di kiri, SN (monospace) sebagai judul, Item dan BU di bawahnya, badge status; baris yang baru di-scan berada paling atas dan disorot sebentar.
- **Bar bawah menempel** berisi satu tombol utama "Salin ke clipboard" dengan jumlah, selalu terjangkau satu tangan; aksi sekunder (Riwayat, Kosongkan pilihan) di menu ⋯ di bar judul.
- Kesalahan Tipe berbeda tampil sebagai lembar bawah dengan satu tombol "Mengerti"; warning lain sebagai toast yang bisa ditekan untuk rincian.
- Dialog konfirmasi = **layar penuh** dengan field bertumpuk, banner di atas tombol, dan tombol "Simpan & salin" menempel di bawah (mengikuti aturan dialog form ponsel proyek).
- Penyimpanan ribuan serial menampilkan **progres** (dialog tak dapat ditutup tidak sengaja, bisa dilanjutkan bila terputus); setelah selesai, hasil dengan "Salin lagi" dan "Buka riwayat".
- Target sentuh minimal 44 px, teks input minimal 16 px, tanpa tabel horizontal (kartu), sesuai aturan ramah ponsel proyek.

### 5.14 Mencocokkan nama Item pada catatan Serah Terima

Usulan pemilik (2026-11-26): catatan task menyebut nama barang dengan format yang berbeda-beda, jadi cocokkan otomatis dengan nama Item setelah **membersihkan tanda baca dan spasi dan menjadikan huruf kecil**. Rincian di bawah adalah usulan saya dan menunggu konfirmasi.

Fakta yang membentuk rancangan: task Serah Terima **tidak punya kolom Item** (isinya catatan Markdown bebas dan checklist), dan satu catatan bisa menyebut beberapa barang. Karena itu hasil pencocokan **tidak disimpan sebagai tautan permanen**; ia dihitung saat dibutuhkan dan dipakai sebagai petunjuk.

- **Fungsi murni di `shared/`** (mis. `detectItemsInNote(noteText, items)`): teks catatan diubah ke teks polos (`noteToPlainText`), dinormalisasi memakai `normalizeKey` yang sudah ada (huruf kecil, tanda baca menjadi spasi), lalu dicocokkan terhadap nama Item (`itemKey(merk, tipe)`) dalam **bentuk rapat** (tanpa spasi dan tanda baca), sehingga "Tenda AX-300", "tenda ax 300", dan "TENDA_AX300" sama. Varian **hanya tipe** ("AX300") dicoba juga, tetapi dipakai hanya bila unik di antara item yang dipertimbangkan.
- **Penjaga batas** (agar cocok yang salah tak terjadi karena spasi dibuang): kecocokan harus berbatas bukan-huruf-angka pada teks yang spasinya masih utuh, jadi "AX300" tidak cocok di dalam "AX3000" atau "MAX300"; implementasinya memetakan indeks teks rapat ke teks bernormalisasi. Nama rapat kurang dari 4 karakter dilewati. Dua Item yang namanya sama setelah dirapatkan keduanya dilaporkan (tidak diputuskan diam-diam).
- **Cakupan item**: hanya Item hidup dan aktif pada BU dengan `serialwh: edit` milik pengguna.
- **Pemakaian 1, memulai dari task** (`?handover=<id>`): bila **tepat satu** Item terdeteksi, field Item terisi otomatis dengan banner "Terisi dari catatan task (N baris menyebut Tenda AX300). Ubah"; bila beberapa, tampil chip saran "Terdeteksi di catatan: AX300 (3 baris), SG8 (2 baris)" yang mengisi Item dengan satu ketukan (tidak diisi otomatis); bila nol, tanpa petunjuk. Item terisi otomatis boleh diganti selama belum ada pilihan serial.
- **Pemakaian 2, pemilih tautan task** (5.5): untuk tiap task kandidat dihitung apakah catatannya menyebut Item yang sedang terisi; task yang menyebutnya diberi lencana "Menyebut Tenda AX300" dan diurutkan lebih dulu. Ini **peringkat, bukan filter** (catatan yang menulis nama dengan cara lain tetap bisa ditautkan manual). Server menghitung penanda ini pada rute kandidat memakai fungsi murni yang sama.
- **Tidak dilakukan**: menyimpan Item pada task, menautkan otomatis tanpa dilihat pengguna, dan menebak jumlah per Item dari catatan.
- Risiko: nama yang ditulis sangat berbeda ("AX 3 ratus") atau singkatan tak terdeteksi, dan catatan yang menyebut Tipe sebagai bagian kalimat lain dapat menghasilkan saran yang tidak relevan; keduanya hanya berdampak sebagai saran yang bisa diabaikan.
- Pengujian: fungsi murni (variasi tanda baca/spasi/huruf, batas "AX300" vs "AX3000", varian tipe saja unik atau ganda, nama pendek, dua item bernama sama, catatan berisi tautan dan gambar), rute kandidat (penanda dan urutan), dan form (isi otomatis tunggal, chip saran untuk beberapa).

### 5.15 Saran Item otomatis saat mengetik checklist Serah Terima (pemilik 2026-11-26, dikonfirmasi; rincian saya)

Keputusan pemilik: **bukan mention**, dan **tanpa pemicu `@`** (`@` sudah berarti mention pengguna). Saat pengguna mengetik di baris checklist catatan Serah Terima, sistem otomatis mencari di daftar Item dan menyarankan nama yang cocok, supaya tidak perlu mengetik penuh. Deteksi otomatis pada teks yang sudah ada (5.14) tetap dipakai untuk lencana dan Keluar Gudang.

- **Kapan muncul**: hanya saat mengetik (bukan saat menempel, jadi konversi tempelan WhatsApp tidak berubah) di **baris checklist** (butir berkotak centang). Setelah minimal 3 karakter; yang dicocokkan adalah **sampai 3 kata terakhir** yang sedang diketik, memakai pencarian toleran yang sudah ada (`suggestMatches` di `shared/suggest.ts`, normalisasi `normalizeKey`: huruf kecil, tanda baca dan spasi diabaikan), sehingga "tenda ax-3" menyarankan "Tenda AX300".
- **Tampilan**: daftar saran kecil di bawah kursor (maks. 6 baris, nama Item = merk + tipe). Di ponsel berupa baris saran di atas papan ketik. Tab menerima saran teratas; panah atas/bawah memilih lalu Enter menerima yang disorot; Enter tanpa memilih tetap membuat baris baru (tidak dibajak); Esc menutup. Pilihan **mengganti potongan yang diketik dengan nama Item sebagai teks polos**, tanpa Markdown atau penanda apa pun, jadi tidak ada format baru, tidak ada dampak pada pencocokan centang atau jangkar komentar.
- **Dasar teknis**: satu dependensi `@tiptap/suggestion` (versi dipatok sama dengan paket Tiptap lain, 3.31.4) dengan pencocok kustom (`findSuggestionMatch`) tanpa karakter pemicu, diaktifkan lewat `extraExtensions` `NoteEditor`; dibatasi pada simpul daftar tugas.
- **Hak dan data**: saran hanya memuat Item yang boleh dibaca pengguna (hak `item` per BU) dan hidup serta aktif; katalog dimuat sekali untuk editor (bukan per ketikan) dan disaring di klien. Pengguna tanpa hak Item tidak melihat saran dan menulis seperti biasa.
- **Lencana deteksi** (5.14): setelah catatan tersimpan atau saat diketik, lencana nama Item muncul di ujung baris dan ringkasan di bawah editor; dihitung (tidak disimpan). Untuk pembaca tanpa hak Item, server yang menghitung dan hanya mengembalikan nama Item yang memang tertulis di catatan.
- **Tidak dilakukan**: mention dengan `@`, tautan permanen catatan ke Item, mengubah catatan lama otomatis, dan saran di luar baris checklist.
- Pengujian: pencocok saran (tanpa pemicu, 3 kata terakhir, minimal 3 karakter, toleran tanda baca), hanya di baris checklist, tidak muncul saat menempel, Enter tidak dibajak, pilihan menyisipkan teks polos, pengguna tanpa hak Item tak melihat saran.
- Dikerjakan sebagai bagian rencana Keluar Gudang (butuh fungsi pencocokan 5.14 yang sama); bila ternyata terlalu besar, dipisah menjadi tugas terakhir yang bisa di-merge terpisah.

### 5.13 Pilih rentang: shift-klik (desktop) dan pilih tarik (ponsel)

Kebutuhan: memilih ratusan serial di tabel tanpa mengetuk satu per satu. Hari ini kit pilihan baris (`useRowSelection`, `DataTable`, `DataCards`, `GridView`) hanya punya `toggle` dan `setAll`, dan tekan lama pada `useLongPressSelect` batal bila jari bergeser; jadi keduanya fitur baru di kit.

**Desktop: shift-klik.**
- Klik kotak centang menyimpan **jangkar** (baris terakhir yang diklik). **Shift+klik** pada baris lain memilih (atau melepas) seluruh baris dari jangkar sampai baris itu, mengikuti keadaan baris jangkar (jangkar tercentang = rentang dicentang; jangkar tak tercentang = rentang dilepas). Hanya baris yang sedang dimuat; teks tidak ikut terseleksi (`preventDefault` pada mousedown Shift, atau `user-select: none` sesaat). Shift+klik tanpa jangkar = klik biasa.
- Dukungan keyboard setara: Shift+Spasi pada kotak centang yang terfokus memilih rentang dari jangkar. Kotak centang header tetap memilih semua baris yang dimuat.

**Ponsel: pilih tarik** (dua jalan masuk, aksi sama):
- **Tekan lama lalu langsung tarik tanpa melepas jari**: mode pilih aktif seperti biasa (tekan lama ~500 ms), lalu menyeret ke bawah/atas memilih semua kartu yang dilewati; menyeret kembali melepas yang terlewati (pilihan = rentang dari kartu awal sampai kartu di bawah jari, seperti galeri foto).
- **Sudah di mode pilih**: menyeret vertikal yang **dimulai dari lajur kotak centang** (strip kiri kartu) memilih/melepas rentang; menyeret dari bagian kartu lain tetap menggulir halaman. Keadaan dimulai menurut baris pertama yang disentuh (tak tercentang = memilih; tercentang = melepas).
- Mendekati tepi atas atau bawah area gulir, daftar **menggulir otomatis** selama jari ditahan (kecepatan naik makin dekat tepi). Getar singkat (bila perangkat mendukung) tiap batas rentang bergeser. Mengangkat jari menyelesaikan; ketuk satu kartu tetap mengubah satu pilihan.
- Selama menyeret, `touch-action` pada lajur kotak centang `none` agar gulir peramban tidak merebut gestur; gestur dibatalkan oleh `pointercancel`.
- Tanpa mengubah perilaku yang ada bila tidak dipakai: ketukan dan tekan lama tanpa menarik tetap persis seperti sekarang.

**Cakupan (keputusan pemilik 21): semua tabel/kartu berkotak centang.** Hasil inventarisasi 2026-11-26. Sebagian besar lewat satu titik di kit:
1. `DataTable` (kolom kotak centang desktop) dan `DataCards` (ponsel, tekan lama): seluruh halaman daftar yang memakai `selection` = Pengguna, Role, Lokasi, Business Unit, Customer, Merk, Item, Postel, daftar QR, preset default QR, Katalog Stiker, Jenis Stiker, daftar Serial, Laporan terjadwal dashboard, dan tabel baru Keluar Gudang. Satu perubahan di kit mencakup semuanya.
2. `GridView` (desktop dan ponsel): Pustaka Gambar stiker dan `LibraryTab` (kartu pustaka; di dialog pilih berkas, `selection`/`onToggle` berupa `Map`, jadi rentang harus menghormati batas jumlah berkas dialog itu, dan bila batas tercapai rentang berhenti di batas dengan toast).
3. **Draf Serial** (Catat Serial, Lapor Rusak, dialog Catat Country Lock): `staging-table.tsx` (kotak centang bawaan `input`, `onSelect`/`onSelectAll`) dan `staging-cards.tsx` (adaptor `RowSelection`). Catatan pembangun: adaptor `staging-cards` sekarang **mengabaikan daftar id pada `setAll`** (memanggil `onSelectAll(on)` untuk semua baris), jadi rentang menuntut prop baru (mis. `onSelectMany(ids, selected)`) dari `record-page`, bukan memakai `setAll` apa adanya.
Tidak termasuk (bukan pilihan baris): checklist task Serah Terima (`note-view`), kotak centang di dalam form (peran, penugasan, pilihan bagian preset QR, daftar BU/lokasi pada editor cakupan dashboard). Daftar yang terakhir itu berupa daftar opsi form; dapat ditambah bila pemilik mau.

Bentuk di kit (nama final ke pembangun): fungsi murni rentang (`rangeBetween(orderedIds, anchorId, targetId)`), pelacak jangkar yang dipakai `DataTable`, `GridView`, dan `staging-table`, dan ekstensi `useLongPressSelect` untuk menyeret (menerima daftar id berurutan atau menghitung dari DOM). `RowSelection.setAll(ids, on)` yang ada sudah cukup untuk menerapkan rentang pada pemakai `useRowSelection`.

Pengujian kit: shift-klik (maju, mundur, tanpa jangkar, jangkar tak tercentang, baris yang menghilang setelah refetch, batas jumlah pada dialog pilih berkas), seret (mulai dari kartu tercentang atau tidak, kembali melepas, `pointercancel`, gulir otomatis dengan penghitung waktu palsu), adaptor draf Serial (rentang hanya mengubah baris yang dituju), tidak ada regresi pada `use-long-press-select.test`, `mobile-select.test`, `select-mode.test`, `data-table.test`, `grid-view.test`, dan tes draf Serial. Karena menyentuh banyak halaman, satu tes integrasi minimal per jenis kerangka (DataTable, GridView, draf Serial) cukup; tes tiap halaman tidak perlu diulang.

## 6. Bagian B: peringatan scan ulang QC

Di layar Catat (QC), baris yang serialnya sudah ada tampil sebagai "Cek ulang" (perilaku sekarang). Saat **Simpan**, bila ada baris yang **BU-nya sama dengan BU serial saat ini dan lokasinya sama dengan lokasi unit saat ini**, tampilkan dialog "Lanjut atau tidak?" berisi jumlah serial, daftar SN (maks. 20 lalu "dan N lainnya"), serta siapa dan kapan pencatatan terakhir. Pilihan "Lanjut menyimpan" meneruskan simpan seperti biasa; "Batal" kembali ke tabel dengan draf utuh. Peringatan hanya saat Simpan, bukan per scan. Contoh: kemarin AB12 dicatat di BU A, lokasi Gudang 1; hari ini QC scan AB12 lagi dengan BU A dan lokasi Gudang 1: peringatan muncul. Dengan lokasi atau BU lain: tidak ada peringatan (cek ulang yang wajar).
- "Terakhir" = BU saat ini (`serials.bu_id`) dan **lokasi unit saat ini** (`serials.location_id`), dibandingkan dengan BU dan lokasi yang diisi pada baris Catat. Lokasi pencatatan awal atau lokasi per kejadian lama tidak dipakai.
- Termasuk serial buatan WH: lokasinya adalah lokasi dari form WH, dan peringatan menyebut pencatatnya sebagai Gudang.
- "Siapa dan kapan" = pelaku dan waktu **kejadian terbaru** serial itu (bukan pembuat catatan pertama; filter "Dicatat oleh" di Bagian C tetap pembuat pertama, karena tujuannya berbeda).
- `serials.lookupMany` membawa lokasi unit, waktu, dan nama pelaku kejadian terbaru **hanya bila BU saat ini serial itu termasuk BU yang boleh dibaca pengguna** (izin `serial`/`serialservice`); izin `serialwh` saja tidak membuka pengungkapan ini. Selain itu tetap pengungkapan minimal seperti sekarang.

## 7. Bagian C: filter "Dicatat oleh"

- Ganti centang "Dicatat oleh saya" di `serial-filters.tsx` dengan chip pilihan banyak pengguna (`LinkMultiField` dengan draf chip, `useChipDraft`, batas `FILTER_LIST_MAX` 20); "Saya" tampil sebagai saran pertama.
- Server: parameter jamak aditif pada `serials.list` (mis. `createdBys`, daftar dipisah koma; field tunggal `createdBy` tetap berlaku demi kompatibilitas; jamak menang dan menyempitkan, aturan `readFilterList`; tanpa id `@2`).
- Pilihan: rute opsi pengguna ringan (mis. `serials.creatorOptions`; pencarian, `ids`, kursor), tanpa izin `access`, hanya memuat pengguna yang pernah mencatat serial yang bisa dibaca pemanggil; entri pencatat tanpa baris pengguna ditampilkan dengan email. Agar tidak memindai tabel besar: pencarian dimulai dari 2 karakter, hasil dibatasi lewat `limit`, dan pembangun menambah indeks pada pembuat serial bila diperlukan. "Saya" selalu tampil sebagai saran pertama, walau belum pernah mencatat.
- "Dicatat oleh" = pembuat catatan pertama serial (bukan pencatat cek ulang). Serial buatan WH tercatat atas nama pengguna WH.
- Perbarui teks panduan `serial-daftar` yang menyebut "Dicatat oleh saya" dan tes `serial-list-page.test.tsx`.
- **Keputusan pemilik 2026-11-26 (disetujui pemilik produk; menutup pertanyaan terbuka):** param `createdBys` boleh memuat email pencatat lain di URL peramban, tautan yang dibagikan, dan log akses nginx (sakelar lama hanya memuat email sendiri). Alasan: email itu sudah terlihat oleh pengguna yang sama di kolom "Dicatat oleh" daftar serial, jadi tidak ada informasi baru yang terungkap, dan pencatat tanpa baris pengguna hanya punya email. Alternatif id pengguna atau token tidak dipakai. Perluasan dari butir 42(b) spek Serial Number.

## 8. Perubahan pada daftar dan detail Serial

- Badge "Tercatat WH" dan "Butuh foto" pada baris dan kartu ponsel; filter `whRecorded` (ya/belum) dan `needsProof` (butuh foto) di chip enum; kolom ringkasan DTO ditambah aditif.
- Detail Serial: kejadian `recorded` buatan Gudang tampil "Dicatat Gudang · SO <no>".

## 9. Keputusan saya (belum dikonfirmasi pemilik)

1. Serial berstatus selain Lolos atau berposisi selain QC **tidak dapat dikeluarkan**.
2. Scan serial yang sudah ada **tidak menulis apa pun**; aturan "tambah bila belum tertempel" praktis hanya untuk serial baru, dan bagian "stiker beda BU tertempel ulang" tidak lagi relevan.
3. Pengeluaran **tidak mengubah status, posisi, atau BU** serial.
4. **Tanpa batas jumlah serial** per pengeluaran (pemilik, 2026-11-26). Pengiriman tetap dipecah per 200 serial sebagai mekanisme teknis (satu transaksi per potongan), dengan status "sedang disimpan" dan pembatalan otomatis setelah 7 hari bila tak selesai.
5. Daftar tabel (tanpa scan) hanya menampilkan serial pada BU yang diizinkan; hasil scan lintas BU dengan kolom minimal. **Dikonfirmasi pemilik 2026-11-26.**
6. Aturan ulang keluar: sama SO = ditolak; SO lain di BU yang sama = warning; BU lain = info saja. Centang "Sembunyikan yang sudah tercatat WH" berlaku per BU terpilih.
7. Pengeluaran dan catatan SO **tidak dapat diubah atau dihapus** di versi ini (kecuali pembatalan otomatis pengeluaran yang tidak selesai). **Pengecualian: tautan task Serah Terima** pada SO boleh ditambah dan dilepas dari detail Riwayat (usulan saya sebagai jalan keluar bila tautan terlewat di dialog).
8. Format clipboard satu SN per baris.
9. Customer memakai master customer dengan pembuatan otomatis; SO unik se-sistem tanpa beda huruf besar/kecil.
10. Serial draf yang ternyata sudah ada saat dikirim diperlakukan sebagai serial yang sudah ada bila Item sama.
11. Bagian B hanya saat Simpan, tidak per scan; "terakhir" = BU dan lokasi saat ini. **Arti "terakhir" dikonfirmasi pemilik 2026-11-26.**
12. "Dicatat oleh" = pembuat catatan pertama.
13. Panduan interaktif untuk halaman baru ditunda (`MODULES_WITHOUT_GUIDE_YET`).
14. Badge dan filter `whRecorded`/`needsProof` dihitung dengan `EXISTS` pada `serials.list` dan tidak menghitung serial terhapus.
15. **Tabel kosong selama Item belum terisi** (keadaan kosong "Pilih Item atau scan serial untuk mulai"), menggantikan "tanpa filter menampilkan semua". Alasan: Item kini field wajib dan satu pengeluaran hanya satu Tipe. **Dikonfirmasi pemilik 2026-11-26.**
16. Scan serial bertipe lain saat **belum ada pilihan** menawarkan "Ganti Item ke X?"; saat sudah ada pilihan = dialog error (Item terkunci).
17. Pemilih tautan task: tanpa centang otomatis, maks. 5 task berjalan milik customer itu, plus pencarian dan saklar "yang sudah selesai". Rute baca khusus untuk pemilih (5.7).
18. Shift-klik dan pilih tarik dibangun **di kit** dan mencakup semua tabel/kartu berkotak centang (cakupan di 5.13), **sesuai permintaan pemilik 2026-11-26**; risiko regresi ditutup tes kit.
19. Maks. 40 karakter untuk No SO.

## 10. Diserahkan ke pembangun

Nama rute, tabel, kolom, dan komponen; bentuk kolom tanda "dibuat Gudang"; urutan butir menu; apakah tabel form memakai satu rute daftar khusus Gudang atau menyesuaikan `serials.list`; cara tahan lama draf (kunci penyimpanan, versi, ukuran untuk ribuan baris); cara paginasi atau virtualisasi tabel; penanganan gestur clipboard (mis. `ClipboardItem` dengan promise); indeks tambahan untuk filter `whRecorded`/`needsProof`; batas hari pembatalan otomatis; teks pesan galat selama sesuai gaya bahasa UI proyek.

## 11. Dokumen yang ikut diubah saat implementasi

- `2026-11-12-serial-number-design.md`: modul `serialwh`, fitur Keluar Gudang, filter pencatat jamak, peringatan scan ulang (catat sebagai keputusan pemilik 2026-11-26); ubah butir yang bertentangan.
- `2026-11-18-serial-unik-sistem-design.md`: serial baru juga dapat lahir dari Keluar Gudang.
- `2026-11-18-serial-catat-wajib-foto-design.md`: pengecualian wajib foto untuk pencatatan Gudang beserta badge "Butuh foto".
- `CLAUDE.md`: bullet Serial Number, daftar pengecualian "field relasi wajib `LinkField`" (tambah combobox No SO), bagian kit DataTable (shift-klik dan pilih tarik); `MODULES_WITHOUT_GUIDE_YET`, fragmen `server/changelog.d/` dan `desktop/changelog.d/` (perubahan `shared/`), potret kontrak (`bun run api:snapshot`), `docs/e2e-checklist` bila ada.

## 12. Pengujian

Tes server per aturan di 5.4 dan 5.7 (termasuk izin per BU, Tipe campur, serial dua kali pada SO yang sama, serial yang sama pada SO BU berbeda, indeks unik, potongan idempoten dan pengiriman ulang, potongan gagal di tengah lalu dilanjutkan, penyapu pengeluaran tak selesai, balapan dua kiriman, pemotongan stok stiker satu kali, serial terhapus), tes pengungkapan minimal lintas BU, tes web (form, Item terkunci dan pesannya, dialog, SO baru otomatis, pemilih tautan task, banner foto, draf tahan muat ulang untuk ribuan baris, Riwayat, tautan task di detail), tes kit pilih rentang (5.13), tes server rute kandidat task dan ubah tautan (hak lokasi task, task terhapus), tes paritas dan penjaga proyek yang ada (`page-frame`, `no-native-select`, kontras, soft delete guard untuk tabel baru bila relevan), lalu `bun run check`.

## 13. Risiko

- Serial baru dari WH tanpa foto bukti melemahkan kebijakan foto; ditutup dengan badge, banner, dan filter "Butuh foto" bagi QC.
- Pengiriman bertahap membuat pengeluaran sempat setengah jadi; ditutup dengan status "sedang disimpan", lanjutkan dari draf, dan pembatalan otomatis.
- Serial boleh keluar berkali-kali, jadi "Tercatat WH" tidak berarti "belum pernah keluar di BU lain"; warning dan info per kasus yang menjaganya.
- Clipboard bergantung gestur peramban; ada dialog cadangan.
- Pengeluaran tidak dapat diubah: salah catat harus ditangani di versi berikutnya (belum ada jalur koreksi).
