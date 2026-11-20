# Checklist uji manual: QC App Desktop (Country Lock + seluruh halaman web)

Dijalankan pemilik pada perangkat nyata sebelum Fase 2 ditulis (rencana `docs/superpowers/plans/2026-11-06-qc-desktop-country-lock-fase-0-1.md` Task 18, dan `docs/superpowers/plans/2026-11-12-qc-desktop-penuh-login-bearer-ui-hibrid.md` Task H8). Kolom **Hasil** dikosongkan: isi dengan Lulus / Gagal beserta catatan (tanggal, versi aplikasi, temuan). Temuan yang menyimpang dari spek (`docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md`) menunggu keputusan pemilik; jangan diperbaiki sepihak.

## Prasyarat

- Laptop Windows 10/11 x64 **bersih** (tanpa Node, Bun, atau Git) dan satu laptop/PC lain sebagai pembanding berisi **aplikasi WPF Country Lock lama**.
- Installer: `desktop/dist-app/QC-App-Setup-<versi>-<arch>.exe` (`<arch>` = `x64` atau `arm64`; dibuat `bun run build:desktop`, atau diunduh dari Drive hasil `release.yml`; pasang per pengguna, tanpa hak admin). Untuk uji tanpa installer: `bun run build && bun run --cwd desktop pack`, lalu `desktop/dist-app/win-unpacked/QC App.exe`.
- Paket skrip: folder `Country Lock2` (berisi `config.QC`, `MIKROTIK\`, `UBIQUITI\`).
- Router jump Mikrotik (alamat sesuai `server.ip` di `config.QC`) dan perangkat uji: satu Ubiquiti dan satu Mikrotik, keduanya **bukan** perangkat produksi.
- Akun QC terdaftar di server (staging `https://qc-dev.rhd.my.id` atau production `https://qc.rhd.my.id`) dan peramban sistem yang dapat login Google.
- **Gerbang spike perangkat nyata sudah lulus** (`docs/superpowers/spikes/2026-11-hardware-spike.md`, rencana Fase 0-1 Task 9 Step 6) sebelum bagian D dijalankan.
- Folder data aplikasi (`userData`, di bawah `%APPDATA%`) berisi `settings.json` (folder paket, alamat server), `auth.json` (token terenkripsi), `pending.db`, dan `ui\` (bundel UI terunduh). Hapus folder ini untuk mengulang dari keadaan bersih.

Kata sandi perangkat tidak boleh muncul di layar progres, log, atau berkas mana pun; periksa di setiap langkah inject.

## A. Pemasangan dan Country Lock tanpa server

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| A1 | Di laptop bersih, jalankan `QC App Setup <versi>.exe` | Terpasang per pengguna tanpa permintaan hak admin; pintasan tersedia; aplikasi terbuka | |
| A2 | Di mesin yang sama jalankan `"QC App.exe" --smoke` dari folder pasang | Mencetak JSON dengan `node` berawalan `24.`, `ssh2: true`, `sqlite: true` | |
| A3 | Jalankan `"QC App.exe" --smoke-ui` | Mencetak `{"bridgeVersion":N}` (N sama dengan `BRIDGE_VERSION` di `countrylock/src/bridge-channels.ts`) lalu keluar | |
| A4 | Putuskan jaringan (atau pastikan server tak terjangkau), hapus folder `userData`, buka aplikasi | Aplikasi terbuka dari UI dasar tanpa galat fatal; tidak ada layar kosong | |
| A5 | Buka halaman Country Lock (menu atau `app://qc/country-lock`) tanpa login | Halaman tampil tanpa meminta login; belum ada paket terpilih | |
| A6 | Pilih folder paket `Country Lock2` lewat dialog | Paket termuat; daftar merk dan firmware dari `config.QC` tampil; skrip yang hilang (bila ada) tercantum sebagai peringatan, bukan galat | |
| A7 | Pilih folder yang tidak berisi `config.QC` | Pesan galat jelas; paket aktif sebelumnya tidak berubah | |
| A8 | Tutup lalu buka aplikasi | Folder paket terakhir diingat dan termuat otomatis | |

## B. Login Bearer lewat peramban sistem

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| B1 | Dengan server menyala, buka halaman selain Country Lock | Diarahkan ke layar login desktop (bukan layar login web biasa) | |
| B2 | Klik tombol login | Jendela kecil bergaya popup (mode aplikasi Chrome/Edge bila peramban bawaan salah satunya; selain itu peramban biasa) terbuka di halaman login Google server; aplikasi menampilkan "Lanjutkan login di browser…" | |
| B3 | Selesaikan login Google di jendela popup | Peramban kembali ke `http://127.0.0.1:<port>/callback?...` dan menampilkan "Login berhasil" (jendela mencoba menutup sendiri; tanpa dialog "Buka aplikasi ini?"); aplikasi masuk ke beranda tanpa muat ulang manual. Tanpa registrasi `qc://` (mis. `electron .`) tetap berhasil | |
| B4 | Periksa URL peramban dan layar aplikasi | Tidak ada token/kode yang tampil di aplikasi; `auth.json` di folder `userData` tidak memuat token polos | |
| B5 | Tutup dan buka aplikasi | Tetap masuk (token terenkripsi bertahan) | |
| B6 | Klik tautan `qc://auth?code=x&state=yyyyyyyy` (atau salin ulang tautan B3 yang sudah dipakai) saat tidak ada login berjalan | Diabaikan: tidak ada perubahan status login, tidak ada galat yang tampil | |
| B7 | Mulai login, jangan selesaikan; mulai login kedua; selesaikan tautan dari login pertama | Tautan login pertama diabaikan; hanya login terbaru yang dapat selesai | |
| B8 | Selesaikan login, lalu buka tautan callback yang sama sekali lagi | Callback kedua diabaikan; status tetap masuk | |
| B9 | Tunggu lebih dari 10 menit setelah mulai login, lalu buka tautan callback | Diabaikan; login harus dimulai ulang | |
| B10 | Nonaktifkan akun di server (admin), lalu muat ulang halaman | Kembali ke layar login (token ditolak server, token lokal dihapus) | |

## C. Semua halaman web dan logout

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| C1 | Buka satu per satu semua menu (Item, Merk, Handover, QR Code, Stiker, Postel, Pengaturan Akses, dst.) | Setiap halaman terbuka dan datanya termuat | |
| C2 | Buat/ubah satu data (mis. merk uji) dan unggah satu gambar item ukuran ~5 MB | Tersimpan; gambar tampil kembali | |
| C3 | Unduh satu berkas (mis. PDF QR atau lampiran Postel) | Berkas terunduh utuh | |
| C4 | Dari DevTools (bila dapat dibuka) jalankan `fetch('/api/openapi.json')` dan `fetch('/auth/login')` | Ditolak 403 `application/problem+json`; hanya `/api/v1/*`, `/api/ping`, `/auth/logout` yang diteruskan | |
| C5 | Menu Country Lock tampil di sidebar | Menu tampil hanya bila peran memberi izin Country Lock (modul `countrylock`), baik di desktop maupun di peramban | |
| C6 | Logout | Kembali ke layar login; `auth.json` terhapus; Country Lock tetap dapat dibuka tanpa login | |
| C7 | Login ulang | Berhasil seperti B2-B3 | |

## D. Country Lock dengan perangkat nyata

Jalankan hanya setelah gerbang spike lulus. Selalu bandingkan dengan aplikasi WPF lama pada perangkat sejenis.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| D1 | Pilih merk Ubiquiti dan firmware yang sesuai; hubungkan perangkat Ubiquiti | Ping perangkat dan router jump hijau; serial terbaca otomatis tiap ping sukses | |
| D2 | Klik baca info | Model, serial, dan negara tampil; kredensial salah memunculkan "Permission denied!!!" (bukan galat jaringan umum) | |
| D3 | Inject Ubiquiti (manual) | Progres bergerak (menghubungkan, mengirim, berjalan, selesai); setelah perangkat reboot negara terkunci ke **Indonesia**, sama dengan hasil aplikasi WPF lama pada perangkat sejenis | |
| D4 | Ulangi D1-D3 untuk perangkat Mikrotik | Hasil sama dengan aplikasi WPF lama (negara terkunci, skrip RouterOS berjalan sampai selesai) | |
| D5 | Selama inject, periksa layar progres dan seluruh teks yang tampil | Kata sandi tidak muncul (diganti `****`), juga bentuk yang di-escape; tidak ada urutan kendali terminal mentah | |
| D6 | Mulai inject lalu klik batal | Inject berhenti, status "dibatalkan", dapat dimulai lagi | |
| D7 | Nyalakan auto-inject dan sambungkan perangkat baru | Inject berjalan otomatis sekali; setelah sukses interface bridge router berganti ke berikutnya | |
| D8 | Sambungkan lagi perangkat dengan serial yang **sudah** tercatat di pending | Tidak di-auto-inject; tampil sebagai "sudah terdaftar"; inject manual tetap mungkin dan mencatat waktu inject ulang pada entri yang sama | |
| D9 | Cabut perangkat saat inject berjalan | Mengikuti kebijakan putus koneksi (putus setelah ada keluaran dianggap selesai; putus lebih awal = gagal); tidak ada hang | |
| D10 | Tutup paksa aplikasi (Task Manager > Akhiri tugas) saat ada beberapa entri pending, lalu buka lagi | Semua entri pending masih ada (`pending.db`) | |
| D11 | Hapus satu entri pending | Entri hilang dan tetap hilang setelah aplikasi dibuka ulang | |

## E. Server mati dan pembaruan UI

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| E1 | Matikan server (atau putuskan jaringan) saat aplikasi terbuka dan sudah masuk | Halaman selain Country Lock menampilkan pesan "tidak dapat terhubung"; aplikasi tidak crash | |
| E2 | Pada keadaan E1, buka Country Lock dan lakukan ping/baca info/inject | Berjalan normal (tidak bergantung server) | |
| E3 | Nyalakan server kembali | Halaman lain pulih tanpa memulai ulang aplikasi | |
| E4 | Prasyarat: aplikasi dibangun dengan `UI_PUBLIC_KEY_PEM` terisi (kunci publik disuntikkan saat build; `docs/desktop-ui-signing.md`, log build mencetak sidiknya) dan server menyajikan manifest bertanda tangan kunci pasangannya. Deploy versi web baru ke staging, buka aplikasi, tunggu pemeriksaan (saat dibuka, saat jendela fokus, atau sampai 1 jam) | Bundel baru terunduh di `userData\ui\versions\`; UI baru terpakai pada peluncuran berikutnya atau setelah tombol "Muat ulang" (spanduk muat ulang menyusul di web); tidak diterapkan saat inject berjalan | |
| E5 | Aplikasi dibangun tanpa `UI_PUBLIC_KEY_PEM` (build dev/`pack`; build rilis `dist` menolak ini) | Tidak ada unduhan UI; aplikasi tetap memakai UI dasar tanpa galat | |
| E6 | Rusak-kan bundel di server uji (ubah satu berkas tanpa menandatangani ulang, atau pakai manifest bertanda tangan kunci lain) | Bundel ditolak; UI aktif tidak berubah; tidak ada berkas setengah jadi di `userData\ui\staging` | |
| E7 | Terapkan bundel yang sengaja gagal dimuat (uji pengembang) dua kali berturut-turut | Aplikasi kembali ke bundel sebelumnya, lalu ke UI dasar; versi itu tidak diunduh ulang | |

## F. Tautan protokol dan instans tunggal

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| F1 | Di peramban biasa buka halaman Country Lock web | Menampilkan ajakan membuka aplikasi desktop (tautan `qc://country-lock`), bukan jembatan | |
| F2 | Klik tautan itu dengan aplikasi tertutup | Aplikasi terbuka di halaman Country Lock | |
| F3 | Klik lagi dengan aplikasi sudah terbuka | Tidak ada jendela kedua; jendela yang ada fokus | |
| F4 | Buka `qc://lain`, `qc://country-lock/x`, atau `qc://country-lock?a=1` | Diabaikan (tidak membuka rute apa pun) | |

## G. Notifikasi desktop (SSE) dan tray

Prasyarat: masuk di aplikasi desktop; satu akun lain (peramban biasa atau perangkat lain) yang dapat membuat task/komentar di lokasi yang sama.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| G1 | Buka menu profil | Tidak ada butir "Notifikasi push" (hanya di peramban); tidak ada dialog/banner izin push | |
| G2 | Dengan jendela QC App TIDAK fokus (terminimalkan atau pindah ke aplikasi lain), akun lain menulis komentar pada task di lokasi Anda | Dalam hitungan detik muncul notifikasi Windows berjudul "<nama> mengomentari task <nomor>" dengan cuplikan isi | |
| G3 | Klik notifikasi | Jendela QC App tampil dan fokus, lalu membuka halaman Serah Terima task itu | |
| G4 | Tutup jendela (X) | Jendela hilang, ikon QC App tetap di tray, balon "QC App tetap berjalan" muncul sekali; proses tidak berhenti | |
| G5 | Dengan jendela tersembunyi, akun lain menulis komentar lagi | Notifikasi Windows tetap muncul; klik membuka jendela lagi | |
| G6 | Klik ikon tray, lalu pilih "Keluar" dari menu tray | Klik membuka jendela; "Keluar" menutup aplikasi sepenuhnya (ikon tray hilang) | |
| G7 | Matikan jaringan 30 dtk, buat komentar dari akun lain, nyalakan jaringan | Aplikasi tersambung ulang sendiri; komentar yang masih di bawah 10 menit muncul sebagai notifikasi (sekali, tanpa ganda) | |
| G8 | Keluar dari akun (menu profil), lalu tutup jendela | Aplikasi benar-benar tertutup (bukan ke tray); tidak ada notifikasi lagi untuk akun itu | |
| G9 | Cabut izin lokasi akun dari admin, lalu akun lain menulis komentar di lokasi itu | Tidak ada notifikasi untuk akun yang dicabut | |
| G10 | Buka aplikasi di dua perangkat dengan akun yang sama | Keduanya menerima notifikasi (batas 3 koneksi per akun) | |
| G11 | Buka akun yang sama di peramban biasa dengan 4 tab sekaligus, lalu akun lain menulis komentar | Notifikasi Windows di aplikasi desktop tetap muncul (aliran web punya bucket terpisah dan tidak menggusur desktop); keempat tab peramban lonceng-nya berubah dalam hitungan detik | |
| G12 | Di aplikasi desktop dengan jendela TIDAK fokus, akun lain menulis komentar lalu amati lonceng di header | Notifikasi Windows DAN angka/daftar lonceng di header berubah bersamaan dalam hitungan detik, tanpa muat ulang (sinyal jembatan v4 dari proses utama; lonceng desktop sengaja tidak membuka aliran SSE sendiri) | |
| G13 | Tutup jendela ke tray, akun lain menulis komentar, lalu buka jendela dari tray | Lonceng sudah memuat notifikasi baru (tanpa menunggu polling) | |
| G15 | Dengan jendela QC App TERLIHAT dan FOKUS (jangan pindah jendela), akun lain menulis komentar | TIDAK ada popup Windows (dilewati karena Anda sedang melihat aplikasi), tetapi angka/daftar lonceng di header berubah dalam hitungan detik; pindah ke aplikasi lain lalu komentar berikutnya memunculkan popup lagi | |
| G14 | Pasang UI baru (bundel) di aplikasi desktop berjembatan lama v3 | UI tetap berjalan dan lonceng berubah lewat polling sekitar 10 detik (tanpa galat di konsol); pembaruan UI tidak terhenti | |

## H. Serah-terima Country Lock dari peramban

Prasyarat: aplikasi desktop terpasang dengan `qc://` terdaftar (atau `QC_DEV_REGISTER_PROTOCOL=1`); dua akun, keduanya berizin Country Lock; staging (production belum punya rute login desktop).

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| H1 | Di peramban, login sebagai akun A tanpa izin Country Lock | Butir Country Lock tidak ada di sidebar; membuka `/country-lock` lalu menekan tombol menampilkan pesan belum punya izin | |
| H2 | Beri izin Country Lock, muat ulang, tekan butir Country Lock di sidebar (desktop belum login) | Peramban menawarkan membuka QC App; aplikasi desktop terbuka di Country Lock, langsung masuk sebagai akun A tanpa dialog | |
| H3 | Ulangi H2 saat desktop sudah login sebagai akun A | Aplikasi desktop hanya membuka Country Lock; tidak ada dialog | |
| H4 | Di peramban login sebagai akun B, tekan butir Country Lock (desktop masih akun A) | Dialog "Peramban masuk sebagai B, sedangkan aplikasi desktop sedang masuk sebagai A" dengan tombol "Lanjut sebagai B" dan "Tetap dengan A" (bawaan Tetap) | |
| H5 | Pilih "Tetap dengan A" | Country Lock terbuka, akun desktop tetap A | |
| H6 | Ulangi H4, pilih "Lanjut sebagai B" | Halaman dimuat ulang; akun desktop kini B; data akun A tidak terlihat | |
| H7 | Salin tautan `qc://country-lock?handoff=...` dari H2, buka lagi setelah lewat 60 detik atau untuk kedua kalinya | Dialog "Tautan dari peramban sudah kedaluwarsa"; akun tidak berubah | |
| H8 | Jalankan inject Country Lock (perangkat nyata), lalu tekan butir Country Lock di peramban | Dialog "Country Lock sedang berjalan"; inject tidak terganggu | |
| H9 | Tekan butir Country Lock di peramban saat aplikasi desktop belum terpasang | Tidak ada yang terbuka; halaman `/country-lock` tetap tampil dengan tombol "Buka di aplikasi desktop" | |

## I. Katalog Tipe offline

Prasyarat: server (staging) sudah memuat rute katalog dengan `DESKTOP_CATALOG_TOKEN` terisi di `.env` VPS; build desktop dibuat dengan env `CATALOG_TOKEN` bernilai SAMA (`CATALOG_TOKEN=... bun run build:desktop`). Minimal satu item `isCountryLock` aktif dengan instruksi stiker.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| I1 | Buka aplikasi desktop (tanpa login) dengan server terjangkau, buka Country Lock | Baris judul halaman Country Lock menampilkan tombol sinkron dengan "Sinkron terakhir: <waktu>" (dan tombol itu TIDAK ada di navbar/halaman lain) (layar lebar; di layar sempit hanya ikon, waktu ada di tooltip); panel "Katalog Tipe" TIDAK ada; dropdown Tipe, Business Unit, dan Lokasi tampil di form inject | |
| I2 | Pilih Merk, buka dropdown Tipe dan ketik sebagian nama | Hanya Tipe milik merk itu yang tampil dan tersaring sesuai ketikan | |
| I3 | Matikan jaringan (atau hentikan server), tutup lalu buka aplikasi, buka Country Lock | Dropdown Tipe, BU, dan Lokasi tetap terisi dari cache; tombol sinkron di halaman Country Lock berwarna amber dan tooltipnya "Tidak dapat terhubung ke server" tanpa menghapus katalog | |
| I4 | Ubah instruksi/stiker sebuah item di web, tunggu deploy/memo server (30 dtk), tekan Sinkronkan | Perubahan muncul; gambar baru terunduh | |
| I5 | Build desktop tanpa `CATALOG_TOKEN` | Tombol sinkron di navbar dan dropdown Tipe/BU/Lokasi tidak tampil; Country Lock tetap berjalan seperti biasa | |
| I6 | Build dengan `CATALOG_TOKEN` salah | Setelah menekan tombol sinkron: tooltipnya "Server menolak sinkron"; tidak ada galat lain | |
| I7 | Hapus berkas di `<userData>/catalog/files/`, tekan Sinkronkan | Berkas yang hilang diunduh ulang | |
| I8 | Di web, buka item Country lock (mis. Ubiquiti AF-5XHD), pilih Firmware (mis. AF-5XHD), simpan; di desktop tekan Sinkronkan, pilih Merk lalu Tipe itu di dropdown Tipe | Firmware terisi (AF-5XHD) dan terkunci; mengosongkan Tipe (x) atau mengganti Merk membuka Firmware | |
| I9 | Pilih Tipe yang firmware-nya kosong atau kodenya tidak ada di paket skrip | Alasan tampil; Firmware kosong dan tetap dipilih manual | |
| I11 | Inject berhasil dengan Tipe terpilih, lalu lihat daftar antrean pending | Kolom Tipe memuat nama Tipe (bukan "-"); tanpa Tipe terpilih kolom tetap "-" | |
| I12 | Pilih Tipe yang punya satu BU; lalu Tipe yang punya dua BU; lalu Tipe tanpa BU | BU terisi sendiri pada Tipe satu BU; pada Tipe dua BU kosong dan hanya dua BU itu yang ditawarkan; pada Tipe tanpa BU kolom BU nonaktif dan kosong | |
| I13 | Pilih BU dan Lokasi, inject, lalu lihat daftar pending; tutup dan buka lagi aplikasi | Kolom BU dan Lokasi memuat "<kode> - <nama>"; setelah dibuka lagi pilihan terakhir masih terpilih | |
| I14 | Matikan jaringan, buka aplikasi, inject dengan BU dan Lokasi terpilih | Pilihan BU/Lokasi tetap tersedia dari cache dan tercatat di pending | |
| I15 | Ubah nama sebuah lokasi di web (atau nonaktifkan), tekan tombol sinkron di halaman Country Lock | Pilihan Lokasi mengikuti perubahan; lokasi nonaktif hilang dan pilihan lama yang sudah tak ada dibuang | |
| I16 | Munculkan dialog Kredensial perangkat (tombol Kredensial) | Password tampil apa adanya, tidak tersamar | |
| I17 | Biarkan salah satu dari Merk/Tipe/Firmware/BU/Lokasi kosong, sambungkan perangkat | Tombol Inject nonaktif; petunjuk "Wajib diisi sebelum inject: ..." menyebut yang kurang; dengan Auto Inject menyala perangkat TIDAK diinject sampai form lengkap, lalu jalan sendiri | |
| I18 | Hapus folder `<userData>/catalog`, buka aplikasi tanpa jaringan | Inject nonaktif dengan petunjuk "Katalog belum tersinkron: tekan tombol sinkron di halaman Country Lock" | |
| I19 | Inject beberapa perangkat dengan Tipe, BU, dan Lokasi terpilih (sudah login, akun ber-`serial: edit`) | Tiap serial muncul sebagai baris di ringkasan "Draft Serial Number" di halaman (form Catat tidak ada di halaman); setelah tombol "Catat Serial Number" ditekan, dialog menampilkan baris yang sama dengan kolom Serial berupa teks terkunci (tooltip "Serial dari perangkat, tidak dapat diubah"); Item = Tipe, BU dan Lokasi sesuai form | |
| I20 | Di dialog Catat Serial Number: tambah serial manual lewat Default (Item, BU, Lokasi) + kolom scan/tempel; ubah massal dan Ubah baris pada baris campuran | Baris manual masuk ke tabel yang sama dan serialnya dapat diubah; baris hasil inject tetap terkunci di tabel dan dialog Ubah baris | |
| I21 | Item wajib foto bukti: tambah foto lewat Ubah baris (kamera atau berkas) lalu Simpan ke staging | Foto terunggah lewat proksi Bearer (tidak gagal multipart), Simpan sukses, serial muncul di halaman Serial Number web dengan asal Country Lock dan foto bukti | |
| I22 | Tutup aplikasi dengan baris di draft, buka lagi; juga coba tanpa login dan dengan akun tanpa izin `serial: edit` | Draft utuh setelah dibuka lagi; tanpa login/izin: ringkasan hanya-baca dengan alasan, inject tetap jalan dan menambah baris; entri pending lama (jika ada) pindah ke draft | |
| I23 | Draft penuh (1000 baris) atau berkas `draft.db` dirusak sengaja | Penuh: Inject dan Auto Inject nonaktif dengan alasan; rusak: galat tampil, Inject nonaktif, draft tidak ditimpa | |
| I10 | Di web, matikan centang Country lock pada item berfirmware, simpan | Kolom Firmware hilang dan tersimpan kosong; item keluar dari katalog desktop pada sinkron berikutnya | |

## J. Mode Multi-Device

Prasyarat: build dengan katalog aktif (`CATALOG_TOKEN`), paket skrip Ubiquiti, router jump Mikrotik yang terjangkau lewat `server.ip` di `config.QC` dan memuat DHCP lease; beberapa perangkat Ubiquiti pabrikan di jaringan yang sama. Tombol mode "Tunggal | Multi-Device" hanya tampil pada jembatan >= 9.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| J1 | Buka Country Lock, pilih mode Multi-Device, isi Merk (Ubiquiti), Tipe, Firmware, BU, Lokasi, tekan Mulai | Tabel perangkat terisi dari DHCP lease (MAC, IP, status); field yang kosong membuat Mulai nonaktif dengan petunjuk | |
| J2 | Satu perangkat pabrikan terhubung, Inject All | Perangkat berstatus Berjalan lalu Sukses; satu baris baru di ringkasan "Draft Serial Number" dengan Tipe/BU/Lokasi batch | |
| J3 | Banyak perangkat (>= 6) sekaligus, concurrency bawaan 4 | Paling banyak 4 inject berjalan bersamaan, sisanya antre; semua akhirnya Sukses atau Gagal dengan alasan | |
| J4 | Ubah concurrency di tengah batch (mis. 4 menjadi 2 lalu 8) | Tidak ada galat; inject yang berjalan tidak terputus; batas baru berlaku untuk antrean berikutnya | |
| J5 | Perangkat Sukses lalu dicabut dan dipasang lagi, atau lease berganti IP (IP berpindah ke perangkat lain) | MAC dikenali walau IP berpindah; perangkat yang sudah Sukses tidak diinject ulang otomatis; IP diambil alih perangkat lain terdeteksi | |
| J6 | Cabut perangkat yang sedang berjalan | Status menjadi terputus setelah masa tenggang 60 dtk; baris hilang dari tabel setelah tenggang; tak ada retry tak berujung | |
| J7 | Salah satu perangkat menolak kredensial bawaan | Panel kredensial muncul; sesudah kredensial diisi perangkat dicoba lagi; kredensial sama tidak dicoba berulang pada IP yang sama dalam sesi | |
| J8 | Tekan Stop Antrean, lalu Cancel All saat banyak perangkat berjalan | Stop: yang berjalan selesai, antrean berhenti; Cancel All: semua inject dibatalkan, tak ada baris draft untuk yang batal | |
| J9 | Muat ulang UI (Ctrl+R) atau tutup-buka jendela di tengah batch | Batch tetap berjalan di proses utama; setelah UI kembali, tabel dan hitungan pulih; baris `injected` yang belum di-ack tidak hilang dan tidak ganda | |
| J10 | Mulai inject tunggal, lalu coba mulai Multi (dan sebaliknya) | Yang kedua ditolak dengan pesan jelas; mode pertama tidak terganggu | |
| J11 | Tombol "Siapkan bridge router" (bila tersedia), juga saat ada perangkat antri atau injecting | Saat tidak ada inject: dialog menyebut host dan perintah, bridge disiapkan sekali dan hasilnya tampil; kegagalan tampil sebagai pesan, bukan crash. Saat ada inject (tunggal atau Multi) berjalan: tombol nonaktif dengan petunjuk, dan host menolak bila dipaksa. Selama bridge disiapkan: Inject All dan tombol Siapkan nonaktif, inject manual dan Auto Inject ditahan (inject tunggal ditolak), lalu Auto Inject berjalan lagi setelah selesai | |
| J12 | Draft penuh (1000 baris) atau draft rusak di tengah batch | Inject baru ditahan dengan alasan; perangkat yang sudah berjalan tidak menghilangkan baris; setelah ruang tersedia, penahanan dilepas | |
| J13 | Serial yang sudah ada di draft/terdaftar muncul lagi sebagai perangkat | Tidak diinject ulang otomatis (ditandai sudah terdaftar); Inject All juga melewatinya (keputusan pemilik 2026-11-19), sedangkan tombol Inject di baris perangkat itu tetap bisa meng-inject manual | |
| J14 | Server SSH router mati atau perintah lease gagal | Pesan galat tampil, batch yang berjalan tidak crash, pemindaian dicoba lagi berjenjang | |
| J15 | Jalankan di build dengan jembatan lama (< 9) | Tombol mode Multi tidak tampil; mode tunggal normal | |

## K. Pembaruan otomatis (rilis desktop)

Prasyarat: environment `desktop-release`, folder Drive, dan `DESKTOP_RELEASES_FOLDER_ID` di `.env` VPS sudah dipasang (`docs/desktop-release-signing.md`). Dua versi rilis berurutan, mis. N = `1.0.0` dan N+1 = `1.0.1`, sudah diterbitkan lewat `release.yml`; installer N diambil dari Drive (bukan dari GitHub). Uji pada Windows x64 **dan** Windows arm64 (ulangi K2-K9 di tiap arsitektur). Pembaruan hanya aktif pada aplikasi terpasang (`app.isPackaged`) yang dibangun dengan kunci publik rilis.

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| K1 | Terbitkan N, pasang installer N (`QC-App-Setup-<N>-<arch>.exe`) pada laptop bersih | Muncul peringatan SmartScreen "penerbit tak dikenal" (belum ada Authenticode); setelah "Tetap jalankan" terpasang per pengguna tanpa hak admin | |
| K2 | Terbitkan N+1; buka aplikasi N, tunggu sekitar 90 detik (cek pertama) | Dialog bawaan OS "QC App versi N+1 tersedia" berisi catatan rilis dan tombol "Perbarui sekarang" / "Nanti" | |
| K3 | Pilih "Nanti"; biarkan aplikasi terbuka | Tidak ada dialog lagi untuk versi yang sama pada sesi itu; cek berikutnya 6 jam kemudian | |
| K4 | Tutup dan buka lagi aplikasi, tunggu dialog, pilih "Perbarui sekarang" | Unduhan berjalan tanpa login; muncul dialog "Pembaruan siap dipasang" | |
| K5 | Pilih "Nanti saat keluar", tutup aplikasi sepenuhnya (keluar dari tray), buka lagi | Aplikasi sudah versi N+1 (periksa Properti > Detail pada `QC App.exe`) tanpa wizard | |
| K6 | Ulangi J2-J4 lalu pilih "Mulai ulang sekarang" | Aplikasi tertutup, terpasang senyap, dan terbuka lagi sebagai N+1 | |
| K7 | Mulai inject Country Lock (perangkat uji), biarkan berjalan saat cek pembaruan jatuh tempo | Tidak ada dialog dan tidak ada restart selama inject; dialog muncul setelah inject selesai | |
| K8 | Tarik N+1 (`tarik` = N+1) lalu buka aplikasi N | Tidak ada tawaran pembaruan ke N+1 (server hanya menyajikan versi bertanda tangan terbaru yang tersisa) | |
| K9 | Hubungkan ke server dengan Drive/folder rilis kosong atau `DESKTOP_RELEASES_FOLDER_ID` kosong | Tidak ada dialog dan tidak ada galat yang terlihat pengguna; Country Lock dan halaman lain normal | |
| K10 | Ganti `DESKTOP_RELEASE_PUBLIC_KEY_PEM` di build uji dengan kunci lain, pasang, terbitkan rilis dari kunci asli | Aplikasi menolak manifest (tanda tangan tak sah): tidak ada tawaran pembaruan, log aplikasi menyebut penolakan | |
| K11 | Ubah repositori menjadi **privat** dan/atau cabut token GitHub apa pun, ulangi K2-K5 | Pembaruan tetap berfungsi penuh (tak ada permintaan ke GitHub dari aplikasi atau server) | |
| K12 | Unduh `app-file` dengan nama di luar manifest atau versi tanpa `.sig` (curl) | 404 seragam; lebih dari 60 unduhan installer per jam dari satu IP = 429 | |

Halaman unduh di web (spek `2026-11-17-changelog-dan-unduh-desktop-web-design.md` 5.3, dibangun 2026-11-20), diuji di PERAMBAN (bukan di dalam aplikasi desktop):

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| K13 | Masuk di peramban Windows (x64 lalu ARM bila ada), buka menu "Aplikasi Desktop" (`/desktop`) | Kartu "Versi terbaru" menampilkan tombol "Unduh untuk Windows x64" (atau ARM) yang sesuai; daftar "Versi yang didukung" memuat versi terbit beserta ukuran | |
| K14 | Unduh installer dari tombol, jalankan `Get-FileHash -Algorithm SHA512 <berkas>` di PowerShell | Hash sama dengan checksum yang tampil di halaman (tombol "Salin" menyalin nilainya) | |
| K15 | Buka `/desktop` dari macOS/Linux/ponsel | Kalimat "Aplikasi desktop baru tersedia untuk Windows" tanpa tombol utama; tautan di daftar tetap ada | |
| K16 | Tarik rilis terbaru (hapus `.sig`), muat ulang halaman setelah memo 5 menit | Versi yang ditarik tidak tampil lagi; folder rilis kosong = "Belum ada versi yang tersedia untuk diunduh", `DESKTOP_RELEASES_FOLDER_ID` kosong = "Unduhan belum tersedia" | |
| K17 | Buka aplikasi desktop terpasang | Butir "Aplikasi Desktop" tidak ada di sidebar | |

## Pengisian hasil

- Penguji dan tanggal: 
- Versi aplikasi (`desktop/package.json`) dan commit: 
- Perangkat yang dipakai (model, firmware): 
- Ringkasan temuan dan keputusan lanjut: 
