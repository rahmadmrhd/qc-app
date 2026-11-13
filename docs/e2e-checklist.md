# Checklist E2E manual (di URL /exec)

Siapkan: akun A = `ADMIN_EMAIL`; akun B terdaftar dengan role ber-`access: view`; akun C tidak terdaftar.

| # | Langkah | Hasil yang diharapkan | PRD |
|---|---|---|---|
| 1 | Buka URL `/exec` di jendela privat | Halaman login dengan tombol "Masuk dengan Google" | FR-A1 |
| 2 | Login dengan akun A | Kembali ke aplikasi, beranda tampil, URL tanpa `?code=`/`&state=` | FR-A1, FR-A6 |
| 3 | Refresh halaman (F5) | Tetap login, tidak muncul "Login gagal" | FR-A3, FR-A6 |
| 4 | Buka Pengaturan Akses → Users, refresh | Tetap di halaman Users (hash di URL) | FR-A6 |
| 5 | Buat role "Pemantau" (access: Lihat) dan user B dengan role itu | Tersimpan, tercatat di sheet `audit_log` | FR-M2, FR-M5, FR-M7 |
| 6 | Login sebagai B di browser lain | Melihat Users/Roles tanpa tombol Tambah/Ubah | FR-P5 |
| 7 | Sebagai B, di console DevTools frame aplikasi jalankan `google.script.run.withSuccessHandler(console.log).api('access.users.save', JSON.stringify({email:'x@y.com',name:'X',status:'active',roleIds:[]}), localStorage.getItem('qc.session'))` | Respons `"code":"FORBIDDEN"` | FR-P4 |
| 8 | Sebagai A, nonaktifkan B; B klik menu apa pun | B kembali ke halaman login | FR-A5 |
| 9 | Login dengan akun C | Pesan "Email … belum terdaftar" beserta emailnya | FR-A2 |
| 10 | Sebagai A, coba nonaktifkan akun sendiri / hapus role yang dipakai | Ditolak dengan pesan jelas | FR-M3, FR-M6 |
| 11 | Logout | Kembali ke login; login ulang berhasil | FR-A4 |
| 12 | Buka `#/tidak-ada` | Halaman 404 | FR-S3 |
| 13 | Buka di ponsel | Sidebar menjadi menu geser, tabel bisa digulir | FR-S1, NFR-7 |
| 14 | Isi nama user `=1+1`, buka sheet `users` | Sel berisi teks `=1+1`, bukan `2` | NFR-1 |
| 15 | Ganti tema ke Gelap, refresh; lalu ganti ke Ikuti sistem | Tema bertahan setelah refresh tanpa kedipan putih; toast ikut tema | FR-S4 |
| 16 | Buat dua lokasi (mis. JKT dan BDG) di Pengaturan Akses → Lokasi | Tersimpan, tercatat di `audit_log` (`location.create`) | FR-L1–L4 |
| 17 | Edit user B: tambah penugasan JKT = role Manajer dan BDG = role Pemantau | Tersimpan; tabel Users merangkum penugasan per lokasi | FR-AS1, FR-AS4 |
| 18 | Login sebagai B | Pemilih lokasi tampil di header ("Semua lokasi"); memilih satu lokasi mengubah label dan bertahan setelah refresh | FR-C1, FR-C2 |
| 19 | Nonaktifkan lokasi BDG, muat ulang B | BDG hilang dari pemilih | FR-L3, FR-P8 |
| 20 | Pasang role ber-Pengaturan Akses pada penugasan lokasi tertentu (bukan Semua lokasi) | Menu Pengaturan Akses tidak tampil untuk user itu | FR-P7 |
| 21 | Di console frame aplikasi, panggil `api` method berlokasi dengan `locationIds` berisi lokasi yang tidak diizinkan | `"code":"FORBIDDEN"`, tidak ada data | FR-E2 |
| 22 | Admin non-super mengedit penugasannya sendiri hingga kehilangan Kelola global | Ditolak dengan pesan jelas | FR-AS5 |
| 23 | Buka Log Audit, detail `user.update` yang mengubah penugasan | Diff menampilkan lokasi dan role yang ditambah, diubah, dihapus | FR-AU2, FR-AU3 |
| 24 | (Tidak berlaku lagi: migrasi `setup` aplikasi Apps Script lama; skema MariaDB dibuat migrasi server saat start) | - | NFR-L2 |
| 25 | Dengan Google terkonfigurasi (`docs/setup-google.md`), unggah gambar pertama | Folder lampiran dibuat di bawah `GOOGLE_ROOT_FOLDER_ID` (atau memakai `ATTACHMENTS_FOLDER_ID`) dan id-nya tercatat di tabel `settings`; berkas muncul di Drive | FA1 |
| 26 | Unggah gambar kedua (atau mulai ulang server lalu unggah) | Tidak ada folder kedua; id folder sama | FA1 |
| 27 | (Fase B) Di halaman Item, sisipkan gambar ke detail Markdown lewat tombol, tempel, dan seret; simpan | Gambar terunggah (≤ 1 MB, ≤ 1600 px), tampil di pratinjau dan di halaman detail setelah muat ulang; baris `files` bertanda pemilik item | FA2, FA3, FA5 |
| 28 | (Fase B) Login sebagai user dengan `item: view` saja, coba unggah lewat console `api('files.upload', ...)`; lalu sisipkan Markdown berisi `<script>`, `[x](javascript:alert(1))`, dan gambar `https://` | Unggah `FORBIDDEN`; Markdown tampil sebagai teks/tautan mati tanpa eksekusi dan tanpa memuat gambar eksternal | FA3, FA6 |
| 29 | Buat item lengkap di Data Item: merk, tipe, country lock, dua nama lain, dua stiker (satu bergambar contoh), dua kelengkapan, tiga gambar galeri, detail Markdown dengan gambar disisipkan lewat tombol, tempel, dan seret | Tersimpan; halaman detail menampilkan semuanya; semua gambar tampil dan hanya terbuka bila login | FI2, FI5, FA5 |
| 30 | Unggah foto asli > 4 MB (mis. dari kamera) | Terunggah tanpa galat; ukuran tersimpan ≤ 1 MB dan sisi terpanjang ≤ 1600 px | FA2 |
| 31 | Buat item dengan tipe "es-24 250w" bila "ES 24 250W" (merk sama) sudah ada | Ditolak, pesan di bawah field Tipe | FI3 |
| 32 | Beri nama lain yang sama dengan nama lain item lain | Ditolak, pesan di bawah field Nama lain | FI3 |
| 33 | Login sebagai user `item: view`, buka Data Item | Daftar dan detail terlihat; tidak ada tombol Tambah, Ubah, Nonaktifkan | FI1, FI4 |
| 34 | Login sebagai user `item: edit`, ubah sebuah item | Berhasil; tidak ada tombol Nonaktifkan | FI4 |
| 35 | Login sebagai user `item: manage`, nonaktifkan lalu aktifkan item | Status berubah; item nonaktif tetap muncul dengan filter "Nonaktif" | FI4 |
| 36 | Buka Log Audit, detail `item.update` yang mengubah kelengkapan dan detail | Kelengkapan tampil per entri berwarna; "Isi Markdown diubah" tanpa hash; tidak ada isi Markdown penuh | FAU1, FAU2 |
| 37 | Cari "es24" di daftar item | Menemukan "ES 24 250W" | FI1 |
| 38 | Sisipkan `<script>alert(1)</script>` dan `[x](javascript:alert(1))` ke detail lalu simpan dan buka detail | Tampil sebagai teks/tautan mati; tidak ada dialog; tidak ada gambar eksternal termuat | FA6 |
| 39 | Buat item dengan merk yang belum ada (ketik "Mikrotik2") | Petunjuk "Merk baru … akan dibuat"; setelah simpan merk muncul di halaman Merk dan Log Audit mencatat `brand.create` | FI8 |
| 40 | Ketik merk dengan huruf berbeda ("ubiquiti") untuk merk yang ada | Petunjuk memakai merk yang sudah ada; tidak ada merk kedua | FI8 |
| 41 | Di halaman Merk ganti nama merk yang dipakai beberapa item | Nama di daftar dan detail semua item berubah; ganti ke nama merk lain ditolak; `brand.update` di Log Audit | FI8 |
| 42 | Nonaktifkan merk lalu buat item baru dengan merk itu | Ditolak: "aktifkan dulu di halaman Merk" | FI8 |
| 43 | Isi `DRIVE_FOLDER_ID` dengan id folder yang tidak ada lalu jalankan `setup` | Laporan "Folder Drive TIDAK dapat diakses"; properti tidak berubah; tidak ada folder baru | FS13 |
| 44 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 45 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 46 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 47 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 48 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 49 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 50 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 51 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 52 | ~~dihapus 2026-11-08~~ | Modul sinkron QC Desktop dihapus; baris dipertahankan agar nomor tidak bergeser | - |
| 53 | Login WH (`handover: edit`): Serah Terima → Tambah task (langsung form bulk, satu kartu); ketik customer baru, tempel di editor catatan kartu dua baris `CRS310 = 1 unt` dan `RB5009UG = 1 unt` → Simpan | Nomor `ST-YYYYMMDD-001`, status Baru; catatan tampil sebagai dua butir checklist; Log Audit memuat `customer.create` lalu `handover.create` | FC2, FH2, FH3, FH4 |
| 54 | Buat task tanpa mengisi customer (opsional), lalu task kedua di hari yang sama dengan ejaan customer berbeda ("pt. maju  jaya") | Task tanpa customer tersimpan (daftar menampilkan "—", detail "Tanpa customer"); task kedua memakai customer yang sama (ejaan resmi), nomor `-002`, tidak ada customer ganda | FC2, FH4 |
| 55 | Ketik nama customer mirip ("Maju Jaya PT" atau typo) | Petunjuk "Mirip: …, pakai ini?" dapat diklik; tidak memblokir simpan | FC4 |
| 56 | Buka form Tambah task sebagai WH | Langsung form bulk tanpa pengalih "Satu task"/"Banyak task": lokasi, panel Tempel dari WhatsApp, dan satu kartu berisi customer (opsional) dan editor catatan; tidak ada kolom item, tipe, atau qty, dan tidak ada tautan "Tambah item baru" | FH2 |
| 57 | Login QC (`qc: edit`): buka task Baru; centang satu butir, lalu butir kedua; tekan Mark done | Status Baru → Dikerjakan → Selesai; nama dan waktu centang tampil; audit `handover.check` per butir dan `handover.done` | FQ1, FQ2, FQ4 |
| 58 | Dua QC membuka task yang sama dan mencentang butir berbeda, lalu butir yang sama, hampir bersamaan | Tidak ada centang yang hilang; mencentang butir yang sama tidak saling membatalkan | FQ1 |
| 59 | Buka task Dibatalkan sebagai QC lalu sebagai WH; buka task Selesai sebagai QC dan WH | Dibatalkan: QC tidak melihat Mark done, centang ditolak (API langsung → `CONFLICT`); "Buka kembali" hanya tampil untuk WH dengan `handover: manage`. Selesai: tidak ada Mark done dan tidak ada Buka kembali | FH7, FQ6 |
| 60 | WH (`handover: edit`) mengubah teks butir yang sudah dicentang; lalu mencoba menghapus butir yang sudah dicentang | Teks diubah: centang butir itu kembali kosong dan tercatat di audit `handover.update`; penghapusan butir tercentang ditolak dengan pesan jelas | FH7 |
| 61 | WH (`handover: manage`) batalkan task (konfirmasi); WH `edit` saja | Task Dibatalkan, baca saja, audit `handover.cancel`; WH `edit` tidak melihat tombol Batalkan | FH8 |
| 62 | User dengan akses lokasi A saja: pilih lokasi lain / buka URL task lokasi B | Tidak ada data lokasi B; detail menampilkan "Task tidak ditemukan di lokasi aktif"; panggilan API ke lokasi B → `FORBIDDEN` | FH1, FH6 |
| 63 | Pilih dua lokasi di header, lalu satu | Daftar menggabungkan task; kolom Lokasi tampil hanya saat lebih dari satu lokasi | FH6 |
| 64 | Halaman Customer: ganti nama, nonaktifkan; buat task dengan customer nonaktif | Pesan "dinonaktifkan; aktifkan dulu di halaman Customer"; ganti nama ke nama customer lain ditolak | FC5 |
| 65 | WH tanpa izin `item` membuka form task | Saran customer tetap muncul (rute serah terima) | FC3 |
| 66 | Log Audit: `handover.update`, `handover.check`, dan `handover.done` | Isi catatan tampil sebagai "diubah" tanpa diff teks penuh; butir checklist dibandingkan per entri berwarna; status berlabel Indonesia | FAU1, FAU2 |
| 67 | Ukuran ponsel (375×812) pada daftar, form, dan detail task | Tidak ada gulir horizontal halaman | NFR6 |
| 68 | Buka form ubah item/task yang sama di dua tab; simpan di tab 1 lalu simpan di tab 2 | Tab 2 ditolak: "sudah diubah orang lain; muat ulang halaman…"; data tab 1 tidak tertimpa | Konkurensi optimistis |
| 69 | Buat item bertipe `0815`, `1/2`, atau `2026-10-15`, lalu buka daftar dan detail | Tipe tampil persis seperti diketik (bukan 815 atau tanggal); sel sheet berformat teks | Sel teks |
| 70 | Tekan Mark done pada task tanpa butir checklist (catatan berupa paragraf saja); lalu buka Log Audit | Task Selesai; Mark done tidak lagi tampil untuk task Selesai; satu baris `handover.done` | FQ2, FAU1 |
| 71 | Centang satu butir, lalu batal centang dari halaman detail; buka Log Audit | Dua baris audit `handover.check` dan `handover.uncheck`, masing-masing dengan pelaku dan waktu | FQ1, FQ4 |
| 72 | Pengaturan Akses → Role: modul "QR Code Label" tampil dengan level Lihat/Ubah/Kelola | Level tersimpan dan menentukan tombol di halaman QR Code | FQR/izin |
| 73 | Jalankan `setup` setelah deploy | Laporan memuat folder "QC App QR" dan "QC App QR Dokumen" siap; sheet `qr_designs` dan `qr_documents` ada | FS13 serupa |
| 74 | Buat konfigurasi: title, subtitle, link, footer, ukuran diubah | Pratinjau 3 × 3 berubah seketika; overflow memunculkan peringatan merah | FQR2, FQR3 |
| 75 | Tekan "Pratinjau lembar" | Dialog menampilkan lembar 10 × 14 dengan garis potong; menutupnya tanpa efek | FQR4 |
| 76 | Pakai logo (unggah), lalu buat konfigurasi lain dan pilih "Pakai logo dari konfigurasi lain" | Logo muncul di QR tanpa unggah ulang; QR tetap terbaca saat dipindai dari layar | FQR5, NFR3 |
| 77 | Duplikat konfigurasi | Form buat terisi penuh, judul "(salinan)"; logo ikut tanpa unggah | FQR6 |
| 78 | Ekspor (dialog konfirmasi → Simpan ke Drive) | Folder "QC App QR" berisi PDF dan PNG; status Sudah diekspor dengan pelaku dan waktu | FQR10 |
| 79 | Buka PDF hasil: ukuran halaman | 300 × 420 mm, 1 halaman, 140 label, garis potong tipis; cetak 100% dan ukur label = 30 mm | NFR4 |
| 80 | Ubah judul lalu lihat daftar; Ekspor ulang | Status "Berubah sejak ekspor"; dialog memperingatkan penimpaan; berkas lama masuk sampah Drive | FQR9, FQR11 |
| 81 | Dua tab: ubah konfigurasi di tab 1, ekspor di tab 2 dengan halaman lama | Tab 2 ditolak (CONFLICT) tanpa menulis berkas | FQR12 |
| 82 | Unduh PDF/PNG sebagai user level Lihat | Berkas terunduh lewat aplikasi; user tanpa akses folder Drive tetap bisa | FQR13 |
| 83 | Sumber link "PDF di Drive": unggah PDF | Dialog menyebut berbagi publik; setelah konfirmasi URL berbagi tampil dan dapat dibuka di jendela penyamaran | FQR15, FQR16 |
| 84 | Ganti PDF pada konfigurasi yang memakainya | URL tetap sama (Drive API v3 lewat UrlFetch bekerja); dokumen baru terbuka di URL lama | FQR17 |
| 85 | Hapus konfigurasi | Berkas ekspor ke sampah; PDF sumber dan logo tetap ada | FQR7, FQR18 |
| 86 | Link 300 karakter dengan QR 12 mm | Peringatan "QR terlalu padat"; ekspor tetap boleh | R4 |
| 87 | Title berisi huruf Mandarin atau emoji | Ditolak dengan pesan karakter tidak didukung | R5 |
| 88 | Ukuran ponsel (375 × 812) pada daftar dan form | Tidak ada gulir horizontal halaman | NFR5 |
| 89 | Aktifkan miring, garis bawah, coret, dan huruf kapital pada title/subtitle/footer | Pratinjau, PNG, dan PDF hasil ekspor menampilkan gaya yang sama (garis bawah/coret sepanjang teks) | FQR19 |
| 90 | Pilih bingkai "Siku di sudut" lalu "Kotak penuh"; ubah tebal, jarak, lengkung, panjang siku | Bingkai tampil di pratinjau/PNG/PDF; bila isi jadi tidak muat muncul banner galat dan ekspor ditolak | FQR20 |
| 91 | Unggah logo lebar (mis. 3:1) dan logo tinggi | Logo tidak terdistorsi dan tidak dipaksa persegi; QR tetap terbaca | FQR21 |
| 92 | Klik pratinjau 3 × 3; buka pratinjau lembar lalu zoom (tombol dan Ctrl + roda) | Tampilan diperbesar terbuka; lembar bisa di-zoom 50–400% dan digulir | FQR22 |
| 93 | Isi form lalu tekan "Simpan dan ekspor" | Tersimpan, dialog konfirmasi ekspor terbuka otomatis di daftar; setelah konfirmasi status "Sudah diekspor" | FQR24 |
| 94 | Simpan konfigurasi yang isinya tidak muat | Daftar menampilkan lencana "Tidak muat" dan tombol Ekspor nonaktif; "Simpan dan ekspor" nonaktif di form | FQR25 |
| 95 | Hapus konfigurasi bersumber PDF yang terakhir; buka link PDF di jendela penyamaran | Link tidak lagi dapat dibuka publik; pakai PDF itu lagi di konfigurasi baru → dapat dibuka lagi | FQR26 |
| 96 | Tekan "Lihat PDF" pada form; klik link di kolom Link pada daftar | PDF terbuka di Drive pada tab baru | FQR27 |
| 97 | Di form QR isi "Link atau ID berkas Drive" (PDF milik pemilik script) lalu "Salin dari Drive" | Salinan muncul di folder dokumen aplikasi, dibagikan via link, menjadi PDF sumber; berkas asli tidak berubah/tidak dibagikan | FQR28 |
| 98 | Salin dari link non-Drive, berkas non-PDF, atau berkas yang tidak bisa diakses | Ditolak dengan pesan jelas | FQR28 |
| 99 | Simpan konfigurasi PDF lalu cek nama berkas di Drive; ekspor lalu ganti PDF | Nama `{title}-{subtitle}-{timestamp}.pdf`; bila PDF sudah terpasang, unggah/salin dari Drive hanya mengganti isi (URL tetap), tanpa opsi PDF baru | FQR30, FQR31 |
| 100 | Pengelola (kelola) buka "Konfigurasi default", isi title/footer/ukuran/bingkai, tambah 2 logo ke pustaka, pilih logo awal, Simpan | Tersimpan; tanpa tombol ekspor; pengguna edit/lihat tidak melihat tombol "Konfigurasi default" | FQR32 |
| 101 | Pengguna edit buat QR baru | Isian awal sama dengan default dan logo awal terpilih; logo hanya dipilih dari pustaka (tanpa unggah) | FQR33, FQR34 |
| 102 | Ubah default lalu buka QR lama | QR lama tidak berubah | FQR33 |
| 103 | Atur luas logo+latar 15% (maks.) dengan logo lebar, coba isi 16% | Nilai di atas 15% ditolak/dijepit; luas logo+latar = persen yang diatur; QR terbaca saat dipindai | FQR35 |
| 104 | Pengelola tambah 2 konfigurasi default (nama berbeda) di Konfigurasi default; nama kembar ditolak | Keduanya tampil di daftar; nama sama (beda huruf besar) ditolak | FQR36 |
| 105 | Buat QR baru sebagai pengguna edit | Hanya pemilih default yang tampil; setelah memilih, isian terisi; Simpan nonaktif sebelum memilih; memilih default lain mengisi ulang | FQR38 |
| 106 | Pengguna edit mengekspor QR; pengguna lihat tidak melihat tombol Ekspor; pengguna edit tidak melihat tombol Konfigurasi default maupun Hapus | Ekspor berhasil untuk edit; default dan hapus hanya kelola | FQR10, FQR32 |
| 107 | Setelah `setup` pada data lama berisi default tunggal | Muncul satu default "Default" dengan isi lama; pustaka logo tetap | FQR39 |
| 108 | Buka ubah QR lalu klik "Perbarui sesuai konfigurasi default", pilih default, hilangkan centang Footer, Terapkan | Title/Subtitle/Logo terisi dari default, Footer tetap; gaya, ukuran, bingkai ikut; tersimpan hanya setelah Simpan | FQR40 |
| 109 | Ubah "Jarak antarbagian" pada QR tanpa subtitle | Posisi QR tidak bergeser; hanya jarak title ↔ subtitle berubah | FQR41 |
| 110 | Daftar QR tidak punya tombol Duplikat; pakai PDF yang sudah dipakai QR lain pada QR kedua | Tombol Duplikat tidak ada; PDF yang sudah dipakai QR lain ditolak; tidak ada info "dipakai N konfigurasi" | FQR42 |
| 111 | Ubah QR yang sudah punya PDF: unggah ulang, lalu "Ganti dari Drive" | Tidak ada opsi "Pakai PDF baru"; keduanya mengganti isi dan URL tetap (dengan konfirmasi) | FQR43 |
| 112 | Sebagai WH (`handover: edit`), di panel Tempel dari WhatsApp pada Tambah task, tempel satu tempelan "Orderan Online" berisi dua baris `= 1 unt` lalu Pecah | Langsung muncul satu kartu (tanpa pratinjau atau tombol "Tambahkan ke batch") dengan usulan customer "Orderan Online" dan catatan di editor (dua butir checklist, bukan teks `- [ ]` mentah); kotak tempelan kosong dan tampil "1 task ditambahkan ke batch."; awalan pesan WhatsApp dibuang bila ada | Desain 2026-10-23 §4.2, §9 (contoh 1) |
| 113 | Pada jalur bulk, tempel empat contoh pemilik secara terpisah (satu per satu) | Hasil 1, 2, 1, dan 3 task; customer sesuai contoh; butir checklist dan paragraf catatan sesuai contoh; kartu langsung ditambahkan saat Pecah; WH dapat mengoreksi customer dan catatan di kartu sebelum Simpan semua | Desain 2026-10-23 §4.3, §9 (contoh 1–4) |
| 114 | Pada batch, biarkan satu task tidak valid (mis. catatan > 5.000 karakter) lalu Simpan semua | Tidak ada task yang tersimpan; task bermasalah ditunjuk; draf seluruh task tetap utuh | Desain 2026-10-23 §4.3, §9 |
| 115 | Di kartu, centang satu butir; tekan Mark done; lalu lihat kartu di kolom Selesai | Kartu pindah kolom tanpa muat ulang dan tanpa membuka detail; Mark done mencentang semua butir; kartu Selesai tidak menampilkan Mark done maupun Buka kembali | Desain 2026-10-23 §4.4, §4.6, §12.1 |
| 116 | Sebagai QC, pilih teks catatan di desktop lalu di ponsel 375 px, tekan "Balas", kirim komentar | Tombol "Balas" muncul di dekat seleksi (tanpa klik kanan); komentar tampil dengan kutipan yang ditandai | Desain 2026-10-23 §4.5 |
| 117 | Sebagai pemantau (hanya `handover: view`), pilih teks lalu kirim komentar; coba centang butir | Komentar tersimpan; butir tidak dapat dicentang | Desain 2026-10-23 §4.4, §4.5 |
| 118 | Buka Serah Terima di desktop (≥ 768 px), lalu di ponsel 375 px | Desktop: kanban empat kolom (Baru, Dikerjakan, Selesai, Dibatalkan); ponsel: daftar kartu dengan filter; seluruh catatan tampil tanpa dipotong; tidak ada task yang hilang; di desktop hanya daftar kartu tiap kolom yang bergulir, judul kolom tetap | Desain 2026-10-23 §4.6, §12.2 |
| 119 | Buka tombol More pada kartu sebagai QC saja, lalu sebagai WH dengan `handover: edit`, lalu WH dengan `handover: manage` pada task Baru, Selesai, dan Dibatalkan | QC hanya melihat Mark done dan tidak ada More; More berisi Ubah pada task Selesai; Batalkan pada task Baru/Dikerjakan (bila `manage`); pada task Dibatalkan More tidak tampil | Desain 2026-10-23 §4.6, §12.1 |
| 120 | Buka task dengan catatan mendekati 5.000 karakter berisi banyak baris | Seluruh catatan tampil di kartu dan halaman detail, tidak ada teks yang dipotong | Desain 2026-10-23 §4.6 |
| 121 | Buka Detail Item yang berisi Markdown dan gambar lama, lalu sisipkan gambar baru dan simpan (tema terang dan gelap) | Markdown dan gambar lama tampil dengan makna sama; gambar baru tersisip dan tersimpan; editor WYSIWYG tampil dengan toolbar | Desain 2026-10-23 §4.1 |
| 122 | Pada jalur bulk (Tempel dari WhatsApp), tempel contoh pemilik nomor 5 (tujuh pesan WhatsApp) | 7 task berurutan: `D~net` (3 butir), `Cv. Prisma` (1 butir, 5 Set), `Indo Akses` (1 butir), `Indo Akses` (2 butir), `Cv. Prisma` (1 butir, 50 Set), `Surya Dexacom` (1 butir), `Dutakom` (1 butir); awalan WhatsApp dibuang; baris judul tidak menjadi butir | Desain 2026-10-23 §4.3, §9 (contoh 5) |
| 123 | Pada jalur bulk, tempel contoh pemilik nomor 6 | 2 task: `Orderan Online dari 3 resi` (1 butir) dan `Alokasi SAS, pengambilan nyicil` (7 butir); koma di tengah judul dipertahankan, baris kosong setelah judul diabaikan | Desain 2026-10-23 §4.3, §9 (contoh 6) |
| 124 | Pada jalur bulk, coba tambah task ke-31 (tombol Tambah/tempel) | Ditolak di UI: batas 30 task per formulir; draf utuh | Desain 2026-10-23 §4.3 |
| 124b | Tempel 25 task WhatsApp lalu Simpan semua | Tersimpan semua dalam SATU permintaan atomik (nomor berurutan); tidak ada task ganda | Keputusan pemilik 2026-10-26; diubah 2026-11-05 (batas kelompok dibuang) |
| 124c | Pada 25 task, buat task ke-8 bermasalah (mis. customer nonaktif) lalu Simpan semua | TIDAK ADA task yang tersimpan (atomik); draf tetap 25 kartu; kartu ke-8 ditandai; setelah diperbaiki, Simpan semua mengirim ulang seluruh 25 sekaligus (tanpa duplikat) | Keputusan pemilik 2026-10-26; menggantikan kelompok 10 -> 5 (2026-10-30) pada 2026-11-05 |
| 125 | Pada satu batch, pilih lokasi sekali di atas; isi tiga kartu dengan customer berbeda (satu kosong), lalu Simpan semua | Ketiga task tersimpan di lokasi yang sama; customer kosong diperbolehkan; tidak ada pemilih lokasi per kartu | Desain 2026-10-23 §4.3; FH1 |
| 126 | Pada form batch, tekan gandakan pada sebuah kartu | Kartu baru berisi catatan yang sama dengan customer kosong | Desain 2026-10-23 §4.3 (cara C) |
| 127 | Sebagai WH dengan `handover: manage`, buka task Dibatalkan lalu tekan Buka kembali; ulangi sebagai WH dengan `handover: edit` saja | Task kembali ke status turunan dari centang (centang tidak hilang), audit `handover.uncancel`; WH `edit` tidak melihat tombol Buka kembali. Buka kembali tidak tampil untuk task Baru, Dikerjakan, atau Selesai | Desain 2026-10-23 §12.1 |
| 128 | Sebagai QC, tekan "Tambah komentar" pada kartu tanpa memilih teks; kirim isi; lalu buka detail task | Komentar tampil di kartu dan detail tanpa kutipan; komentar umum tidak pernah ditandai usang | Desain 2026-10-23 §12.6, §12.7 |
| 129 | Pilih teks pada catatan di kartu daftar lalu tekan "Balas" dan kirim; ulangi dari halaman detail | Kedua jalur menyimpan kutipan yang ditandai di catatan; memilih teks di kartu tidak membuka detail | Desain 2026-10-23 §4.5, §12.6 |
| 130 | Kirim komentar 1.001 karakter | Ditolak dengan pesan batas 1.000 karakter; teks tetap di kotak komentar | Desain 2026-10-23 §12.8 |
| 131 | Tambah komentar ke-51 pada sebuah task; pada task lain, tambah komentar 1.000 karakter berulang hingga total JSON melampaui 40.000 karakter | Ditolak dengan pesan yang menyebut batas 50 komentar atau 40.000 karakter, mana lebih dulu; komentar sebelumnya tetap | Desain 2026-10-23 §12.8 |
| 132 | Tempel atau ketik catatan dengan 301 butir checklist (mis. 301 baris `- [ ] item`) lalu Simpan | Ditolak di UI dan server dengan pesan pada catatan yang menyebut batas 300 butir; draf tetap utuh | Desain 2026-10-23 §12.9 |
| 133 | Catatan 5.001 karakter (tanpa butir checklist) lalu Simpan, di form tunggal dan di batch | Ditolak di UI dan server; draf tidak hilang; pada batch tidak ada task yang tersimpan | Desain 2026-10-23 §4.3, §4.4 |
| 134 | Desktop (≥ 768 px) dengan banyak kartu di satu kolom, lalu gulir kolom itu | Hanya daftar kartu kolom itu yang bergulir; judul dan hitungan kolom tetap di atas; halaman tidak bergulir vertikal untuk papan | Desain 2026-10-23 §12.2 |
| 135 | Lihat kolom Selesai dan Dikerjakan di desktop dan ponsel, dalam tema terang dan gelap | Selesai hijau, Dikerjakan biru, Baru netral, Dibatalkan muted; label status terbaca | Desain 2026-10-23 §12.3 |
| 136 | Siapkan task Dikerjakan dengan progres 2/3 dan 1/3, task Baru, Selesai, dan Dibatalkan; buka daftar desktop dan ponsel | Urutan: Baru, Dikerjakan (progres lebih sedikit selesai di atas), Selesai, Dibatalkan; di dalam status, terbaru di atas | Desain 2026-10-23 §12.4 |
| 137 | Pilih teks pada catatan yang sudah memiliki komentar, dalam tema terang dan gelap | Kutipan disorot dengan latar semitransparan lembut; warna teks tidak berubah dan tetap terbaca | Desain 2026-10-23 §12.5 |
| 138 | Login sebagai user BU A dan user BU B (masing-masing `item: view` di BU-nya), buka Data Item | Daftar, jumlah, dan pencarian hanya memuat item BU masing-masing; item BU lain tidak muncul | BU FB4 |
| 139 | Sebagai user BU A, buka detail dan berkas gambar item BU B lewat URL atau panggilan API langsung (console frame) | `"code":"NOT_FOUND"` (bukan FORBIDDEN); tidak ada isi berkas | BU FB4 |
| 140 | Buat item di BU A dan BU B; beri user `item: view` di B dan `item: edit` di A; login sebagai user itu | Item A+B terlihat; tombol Ubah dan Nonaktifkan tidak tampil; `items.save` langsung ditolak `FORBIDDEN` | BU FB5 |
| 141 | Buat merk dengan BU bawaan BU A; di form item pilih merk itu tanpa memilih BU; lalu pilih merk tanpa BU bawaan | Field BU terisi BU A dan tetap bisa diubah; merk tanpa BU bawaan membuat field BU kosong | BU FB6 |
| 142 | Nonaktifkan BU C yang masih dipakai item dan user (halaman Business Unit); lalu buat item baru | Peringatan menampilkan jumlah item dan user; penonaktifan tetap berhasil; BU C tidak bisa dipilih untuk item baru; item lama tetap terlihat user BU C | BU FB7 |
| 143 | Login sebagai user lama yang belum punya penugasan BU (setelah rilis) | Daftar item kosong; detail item mana pun `NOT_FOUND`; setelah admin menugaskan BU di form user dan user memuat ulang, item BU itu muncul | BU FB2, FB4; keputusan 14 |
| 144 | Di form item, ketik nama merk yang sudah ada dengan huruf berbeda; lalu ketik merk baru tanpa menekan dialog "tambah" | Merk yang ada dipilih, tidak ada merk ganda; merk baru hanya lahir lewat dialog "tambah merk" (audit `brand.create`); teks yang diketik saja tidak membuat merk | BU FI8 (spek 5.5) |
| 145 | Sebagai user yang hanya berhak di BU A, buat item dengan merk+tipe yang sudah ada di BU B | Ditolak `CONFLICT` dengan pesan generik; pesan tidak menyebut BU B, merk, atau tipe item BU B | BU FB8 |
| 146 | Admin membuka form user yang sudah terbuka sebelum rilis, lalu menyimpan tanpa memuat ulang | Ditolak 422 (`buAssignments` wajib); setelah memuat ulang dan menyimpan, berhasil | BU FB2; keputusan 15 |
| 147 | Buat BU di `/access/business-units`, lalu coba menghapusnya | Tidak ada tombol hapus; BU baru dan perubahannya tercatat di Log Audit | BU FB1 |
| 148 | Sebagai admin (`access: manage`), jalankan ekspor Sheets (`exports.sheets`) bila fitur dipakai | Memuat seluruh item tanpa filter BU (pengecualian yang disengaja, keputusan 16; fitur belum dipakai) | BU FB4 (pengecualian) |
| 149 | Unggah gambar item lalu, sebagai user lain dengan `item: view`, buka UUID-nya sebelum item disimpan | `NOT_FOUND`; pengunggah tetap melihat pratinjaunya (keputusan 18) | BU FB4 |
| 150 | Simpan item di BU A dengan id berkas milik item BU B | `VALIDATION` seperti berkas tidak dikenal, tanpa menyebut item lain (keputusan 17) | BU FB4 |
| 151 | Buat Postel di `/postel/new` dengan dua item, satu nomor sertifikat (tanggal habis, tautan), catatan, lalu simpan | Postel tersimpan; nama turunan dari tipe kedua item (mis. "M5-200/400"); kedua item tertaut; stiker "Postel" muncul di katalog Stiker (jenis sistem Postel); nomor tampil Aktif | Spek 4b |
| 152 | Pada Postel itu tambah nomor baru lalu simpan | Nomor baru Aktif; nomor sebelumnya berlabel "Lama" dan tetap tampil; hanya nomor Lama yang punya tombol hapus | Spek 4b |
| 153 | Ubah tanggal habis sebuah nomor lalu simpan; buka Riwayat perubahan | Riwayat memuat entri dengan tanggal habis lama dan baru, pelaku, dan waktu; peringatan email nomor itu mulai lagi menurut ambang berikutnya | Spek 4b |
| 154 | Buat Postel lain dan pilih item yang sudah milik Postel pertama | Ditolak dengan pesan item sudah milik catatan Postel lain (menyebut nomor Aktifnya); tidak ada yang tersimpan | Spek 4b |
| 155 | Pada form Postel unggah lampiran PDF dan gambar, simpan, lalu unduh keduanya dari detail | Kedua lampiran tersimpan; unduhan bernama `lampiran-<id>.<ekstensi>` dengan isi yang sama; berkas bukan PDF/gambar dan berkas di atas 10 MB ditolak; lebih dari 10 lampiran ditolak | Spek 4b |
| 156 | Di `/postel` pakai filter "Segera habis" dan "Kedaluwarsa" | Catatan terfilter menurut kondisi nomor Aktifnya; nomor Lama yang kedaluwarsa tidak membuat catatan berlabel Kedaluwarsa | Spek 4b |
| 157 | Di Konfigurasi Stiker atur peringatan Postel (aktifkan, penerima, jam, ambang, pengulangan) lalu tunggu penjadwal (staging dengan SMTP diatur) | Email diterima berisi nama Postel, nomor, tanggal habis, sisa hari, dan tautan; tanpa nama atau jumlah item; tidak terkirim dua kali untuk nomor dan ambang yang sama | Spek 4b |
| 158 | Di Stok Stiker tambah stok stiker "Postel" lalu lihat riwayat stok | Stok bertambah dan riwayat tercatat seperti stiker lain; menipis dihitung dari minimum stiker | Spek 4b |
| 159 | Di item yang tertaut Postel, tambah instruksi penempelan dengan penanda ke jenis Postel | Tampilan baca item menampilkan stiker "Postel" pada penanda itu; item tanpa Postel menampilkan "belum ada stiker" | Spek 4b |
| 160 | Di daftar item pakai label dan filter "Belum ada Postel" (sebagai pengguna dengan `sticker: view`; lalu sebagai pengguna yang hanya punya `item: view`) | Hanya item aktif tanpa catatan Postel yang tampil; item yang sudah ber-Postel tidak berlabel; kedua jenis pengguna sama-sama melihat label dan filter (seperti Manual Book); pada detail item pengguna tanpa `sticker: view` hanya melihat keterangan "Belum ada Postel" untuk item tanpa Postel, tanpa ringkasan catatan | Spek 4b §7 butir 5 (keputusan pemilik 2026-11-12) |
| 161 | Di katalog nonaktifkan stiker "Postel" lalu aktifkan kembali; coba ubah namanya | Dapat dinonaktifkan dan diaktifkan kembali kapan saja; nama terkunci (ditolak), gambar dan minimum boleh diubah | Spek 4b |
| 162 | Masuk sebagai pengguna dengan `sticker: view` saja lalu buka `/postel` dan detailnya | Daftar dan detail terbaca; tidak ada tombol Ubah, Tambah, atau Hapus; membuka `/postel/new` atau `/postel/<id>/edit` langsung ditolak (izin `sticker: edit` diperlukan) | Spek 4b |
| 163 | Di `/postel` cari memakai nomor Lama sebuah catatan, lalu model item (tanpa merk) dan sebagian nomor Aktif | Catatan itu tampil pada tiap pencarian; pencarian tak peka huruf besar/kecil; nomor yang tidak ada di catatan mana pun menampilkan "Tidak ada Postel yang cocok." | Spek 4b |
| 164 | Di `/sticker/settings` isi "Kirim setiap (hari)" pada ringkasan stok menipis dengan 3, simpan, lalu biarkan stok menipis dan tunggu tiga hari jam kirim | Ringkasan terkirim pada hari pertama, tidak terkirim hari ke-2 dan ke-3, terkirim lagi hari ke-4 selama masih ada stok menipis; nilai 0 atau 366 ditolak dengan pesan; nilai 1 = tiap hari seperti sebelumnya | Spek 4a keputusan 14 (pemilik 2026-11-12) |

## Notifikasi Serah Terima (tahap 5)

Spek: `docs/superpowers/specs/2026-11-12-notifikasi-serah-terima-design.md` (matriks §3). Uji di staging dengan tiga akun: WH (`handover: edit` di lokasi JKT), QC (`qc: edit` di JKT), dan akun ketiga untuk pencabutan akses. Lonceng ada di header (ikon dengan jumlah belum dibaca). Pelaku tidak pernah menerima notifikasi atas aksinya sendiri.

| # | Langkah | Hasil yang diharapkan | Spek |
|---|---|---|---|
| N1 | WH membuat task baru di JKT | QC menerima satu notifikasi "task baru" dengan cuplikan isi catatan (satu baris, tanpa penanda daftar); WH tidak menerima apa pun | §3 Task baru dibuat, §6 |
| N2 | WH mengubah catatan task | QC menerima satu notifikasi "diubah" dengan cuplikan catatan yang baru; WH tidak menerima | §3 Task diubah, §6 |
| N3 | QC mengubah catatan task | WH tidak menerima notifikasi "diubah" (sisi QC saja yang menerima) | §3 Task diubah |
| N4 | WH membatalkan task (akun `handover: manage`) | QC menerima notifikasi "dibatalkan" | §3 Task dibatalkan |
| N5 | WH membuka kembali task Dibatalkan | QC menerima notifikasi "dibuka kembali" | §3 Task dibuka kembali |
| N6 | QC menekan Mark done pada task | WH menerima satu notifikasi "selesai"; QC tidak | §3 Task selesai |
| N7 | QC mencentang satu butir | Tidak ada notifikasi langsung; WH menerima ringkasan setelah paling lambat 5 menit | §3 Butir dicentang |
| N8 | WH menulis komentar pada task | QC menerima notifikasi komentar; WH (penulis) tidak | §3 Komentar |
| N9 | QC menulis komentar pada task | WH menerima notifikasi komentar; QC (penulis) tidak | §3 Komentar |
| N10 | Akun yang punya `qc: edit` dan `handover: view` sekaligus di JKT; WH membuat task | Akun itu menerima TEPAT satu notifikasi | §3 aturan umum |
| N11 | Kirim ulang centang dengan nilai yang sama (mis. panggilan API langsung) | Tidak ada kejadian baru; jumlah notifikasi tidak bertambah | §3 (keadaan benar-benar berubah) |
| N12 | QC mencentang lima butir dalam sekitar dua menit pada satu task, lalu tunggu | WH menerima TEPAT satu ringkasan, paling lambat 5 menit sejak centang pertama | §4.2 |
| N13 | QC mencentang butir terakhir pada task | WH menerima satu notifikasi "selesai", tidak ada ringkasan centang tambahan untuk rangkaian itu | §4.2 |
| N14 | Tandai satu notifikasi dibaca, lalu "tandai semua dibaca" | Penanda belum dibaca dan jumlah pada ikon lonceng hilang | §5.1 |
| N15 | Admin mencabut akses lokasi JKT dari akun WH, lalu WH membuka lonceng | Notifikasi JKT tidak tampil lagi; tidak ada galat | §5.1 |
| N16 | WH membuka notifikasi dari lokasi yang tidak sedang aktif di header | Task terbuka (tidak `NOT_FOUND`). Celah diketahui: halaman detail memakai lokasi aktif, sehingga muncul "Task tidak ditemukan di lokasi aktif" (belum diperbaiki) | §5.1 |
| N17 | Dengan VAPID kosong (push nonaktif), lonceng tetap dipakai | Lonceng tampil dan terisi; tidak ada galat di konsol | §5.1 |
| N18a | **Belum teruji di perangkat nyata; butuh `VAPID_*` terisi di staging.** Android (Chrome, aplikasi terpasang): login pertama | Dialog "Aktifkan notifikasi?" tampil; klik Aktifkan memunculkan dialog izin peramban SEKALI; setelah Izinkan, notifikasi muncul saat WH membuat task di lokasi QC itu (aplikasi tertutup juga) | §5.2 |
| N18b | Klik notifikasi push | Aplikasi terbuka/terfokus di task terkait dengan `?loc=` benar; tidak ada tab kosong | §5.2 |
| N18c | Login pertama di aplikasi terpasang, jawab "Nanti" | Tidak ditanya lagi pada muat ulang; menu profil "Notifikasi push" menawarkan "Aktifkan di perangkat ini" | §5.2 |
| N18d | Tolak izin peramban | Tidak ada permintaan ulang; banner pengingat dengan langkah sesuai platform tampil, tidak lagi dalam 7 hari setelah ditutup; Status Push admin menunjukkan "Izin ditolak"; lonceng tetap menerima semuanya | §5.2 |
| N18e | Nyalakan kembali izin lewat pengaturan peramban/OS lalu fokuskan aplikasi | Banner hilang, perangkat tertaut otomatis, push diterima | §5.2 |
| N18f | Matikan kotak "Terima notifikasi push" di menu profil, lalu picu notifikasi | Tidak ada push; lonceng tetap terisi; Status Push admin menunjukkan "Dimatikan pengguna"; menyalakan kembali memulihkan push | §5.2 |
| N18g | Logout lalu picu notifikasi untuk akun itu | Perangkat tetap menerima push (keputusan pemilik 2026-11-12); login akun lain di perangkat yang sama = kedua akun menerima notifikasinya masing-masing | §5.2 |
| N18h | iPhone/iPad (iOS 16.4+): buka di Safari biasa, lalu pasang ke layar utama dan login | Di Safari biasa pengaturan push menjelaskan harus dipasang dan tidak meminta izin; setelah dipasang alurnya sama seperti N18a | §5.2 |
| N18i | Desktop Chrome dan Firefox (aplikasi terpasang dan tab biasa) | Tab biasa: izin hanya lewat menu profil; terpasang: dialog pra-izin; push diterima | §5.2 |
| N18j | Buka `/access/push` sebagai admin (`access: view`) dan sebagai pengguna tanpa izin itu | Admin melihat tabel status (bermasalah dulu) tanpa pengenal perangkat; pengguna tanpa izin tidak melihat menunya dan tidak dapat membuka halamannya | §10 |

## PWA Fase 1

> **BELUM TERUJI di perangkat nyata (Android, iOS, desktop); wajib dijalankan di staging sebelum rilis.**

| # | Langkah | Hasil yang diharapkan | PRD |
|---|---|---|---|
| 165 | Pasang aplikasi di Android Chrome lewat menu "Pasang aplikasi" atau "Tambahkan ke layar utama" | Aplikasi terpasang dengan ikon QC; terbuka tanpa bilah alamat (mode mandiri) | PWA FR-P2, FR-P4, FR-P5 |
| 166 | Pasang di iOS Safari lewat "Tambahkan ke Layar Utama", lalu buka dari ikon | Aplikasi mandiri membuka halaman aplikasi, bukan peramban; ikon 180×180 tampil; menu "Pasang aplikasi" menampilkan petunjuk singkat | PWA FR-P2, FR-P4, FR-P5 |
| 167 | Pasang di desktop (Chrome atau Edge) lewat butir "Pasang aplikasi" di menu pengguna | Jendela aplikasi terbuka sendiri dengan ikon QC; tidak ada pop-up pemasangan yang mengganggu | PWA FR-P4, FR-P5 |
| 168 | Buka aplikasi, tutup, lalu buka lagi (kunjungan kedua) | Cangkang tampil lebih cepat; berkas JS/CSS berhash yang tidak berubah tidak diunduh ulang (DevTools → Network) | PWA FR-P6 |
| 169 | Buka rute langsung (mis. `/handover`) lalu refresh saat mode pesawat | Cangkang tampil dari cache; aplikasi menampilkan keadaan galat jaringan yang jelas, bukan halaman kosong | PWA FR-P7 |
| 170 | Login Google penuh di mode terpasang (Android dan iOS) | Callback OAuth selesai; aplikasi kembali dalam keadaan sudah login | PWA FR-P8 |
| 171 | Buka `/auth/callback?code=x&state=y` langsung di peramban | Dijawab server, bukan cangkang `index.html` | PWA FR-P8 |
| 172 | Deploy versi baru ke staging saat tidak ada formulir terisi, lalu pindah halaman di aplikasi yang sudah terpasang | Setelah pindah halaman, versi baru dimuat sendiri tanpa spanduk | PWA FR-P11, FR-P12 |
| 173 | Deploy versi baru saat ada formulir terisi tanpa disimpan (mis. draf task), lalu tunggu | Spanduk "Ada versi baru" muncul dan menyebut ada formulir belum tersimpan; halaman TIDAK dimuat ulang otomatis; isian tetap utuh; setelah "Muat ulang" ditekan, versi baru dimuat | PWA FR-P13, FR-P12 |
| 174 | Ganti tema ke Gelap, lalu ke Terang, di dalam aplikasi | Warna bilah sistem (`theme-color`) di Android ikut berubah sesuai tema | PWA FR-P3 |
| 175 | Keluar (logout) dari aplikasi terpasang, lalu periksa DevTools → Application → Storage dan Cache | Data perangkat dibersihkan (cache query tersimpan dan data pengguna tidak tersisa); login ulang berhasil | PWA FR-P14 |
| 176 | Buka DevTools → Application → Manifest dan Service Workers | Manifest terbaca tanpa galat (nama, ikon, `theme_color`); service worker aktif; Console tanpa galat | PWA FR-P1, FR-P6 |
| 177 | Saat spanduk tampil (formulir belum tersimpan), simpan atau kosongkan formulir | Spanduk hilang sendiri; versi baru dimuat otomatis pada pemicu berikutnya (pindah halaman atau tab kembali terlihat) | PWA FR-P12 |
| 178 | Centang checklist tepat ketika versi baru sudah siap (centang sedang dikirim) | Centang tidak terputus dan tidak hilang; muat ulang otomatis ditunda sampai penulisan selesai | PWA FR-P12, FR-P13 |
| 179 | Dengan tidak ada formulir terisi, pindah ke aplikasi lain lalu kembali ke tab aplikasi | Bila versi baru sudah siap, versi baru dimuat ulang otomatis | PWA FR-P12 |
| 180 | Tekan "Muat ulang" di spanduk, lalu segera tekan "Nanti" | Tombol "Nanti" tidak aktif selama fase pengambilalihan (sampai sekitar 25 detik); sesudahnya "Nanti" hanya menyembunyikan spanduk selama pemuatan halaman itu, dan tidak membatalkan penunggu service worker | PWA FR-P12 |
| 181 | Pada formulir terisi, lakukan penulisan singkat (mis. centang yang selesai dalam kurang dari 1 detik) | Spanduk tidak berkedip; spanduk hanya muncul bila formulir belum tersimpan (seketika) atau keadaan sibuk lebih dari sekitar 1 detik | PWA FR-P13 |
| 182 | Muat potongan rute yang gagal (mis. versi baru sudah menghapus potongan lama, atau saat pindah ke rute lazy yang gagal) lalu pindah halaman | Spanduk "Ada versi baru" tampil tanpa muat ulang seketika; pada perpindahan halaman berikutnya halaman dimuat ulang otomatis hanya bila aman (tidak ada formulir terisi dan tidak ada penulisan berjalan) | PWA FR-P11, FR-P12 |

## Panduan interaktif (2026-11-13)

Spek: `docs/superpowers/specs/2026-11-13-panduan-interaktif-design.md` (bagian 4.2-4.7). Uji di staging dengan akun individu, akun bersama (sudah ditandai di Pengaturan Akses), akun WH (`handover: view`/`edit`), dan akun QC (`qc: edit`). Pengguna yang sudah menyelesaikan panduan `dasar` tidak ditawari panduan `baru`-nya.

| # | Langkah | Hasil yang diharapkan | Spek |
|---|---|---|---|
| G1 | Login pertama dengan akun individu yang belum pernah menjawab sapaan | Dialog "Mau tur singkat?" tampil sekali; "Nanti" tidak ditanya lagi pada muat ulang dan menu profil "Panduan" tetap ada | 4.4 Sapaan login |
| G2 | Mulai tur "Dasar layout" dari sapaan atau menu profil > Panduan | Sidebar, pemilih lokasi, lonceng, tema, dan menu profil disorot berurutan; tidak ada field yang terisi atau berubah | 4.5 |
| G3 | Jalankan tur Serah Terima dengan akun WH, lalu dengan akun QC | Langkah sesuai sisi akun (langkah tanpa izin dilewati, bukan tampil sebagai teks); tur berhenti sebelum tombol simpan/kirim; di tab Network tidak ada permintaan tulis handover | 4.5, 4.1 |
| G4 | Buka ikon info "Tempel dari WhatsApp" setelah tur selesai | Ikon tetap ada di tempatnya; demo bergerak berjalan, tombol jeda dan titik adegan bisa diketuk; titik penanda hilang setelah pernah dibuka | 4.6 |
| G5 | Ikon info di perangkat tanpa gerakan (kurangi gerakan di OS) dan saat offline | Keterangan tampil sebagai daftar langkah bernomor; tidak ada galat di konsol | 4.6 |
| G6 | Selesaikan tur dengan akun individu di peramban A, lalu login akun sama di peramban B | Panduan yang sudah selesai tidak ditawarkan lagi di peramban B; penanda dimuat dari server | 4.3 |
| G7 | Selesaikan tur dengan akun bersama di peramban A, lalu login akun sama di peramban B | Panduan ditawarkan lagi di peramban B (disengaja); di peramban A tetap tidak ditawarkan | 4.3 |
| G8 | Ulangi tur dari menu profil "Ulangi" pada panduan yang sudah selesai | Tur berjalan dari awal tanpa mengubah penanda selain yang ditulis saat tur selesai | 4.4 |
| G9 | Ubah satu akun dari individu ke bersama lalu kembali ke individu di Pengaturan Akses | Setelah diubah ke bersama, panduan ditawarkan lagi di tiap perangkat; setelah kembali ke individu, ditawarkan sekali lagi bila belum pernah selesai di database | 4.3 Mengubah jenis akun |
| G10 | Buka `/handover` pertama kali (panduan belum selesai) | Banner "Pertama kali di ...? Ada panduan N langkah." tampil dengan Mulai, Nanti, dan Sudah paham; N hanya menghitung langkah yang lolos izin akun | 4.4 Banner |
| G11 | Tekan "Nanti" lalu buka tab baru aplikasi | Banner tidak tampil di sesi tab itu; di sesi tab baru banner muncul lagi selama panduan belum selesai | 4.4 Banner |
| G12 | Tekan "Sudah paham" pada banner panduan `dasar` | Banner hilang dan tidak muncul lagi; panduan `baru` yang tercakup ikut tertutup; panduan tetap ada di menu profil "Panduan" | 4.4, 4.2 |
| G13 | Lihat sidebar saat ada panduan belum selesai, lalu selesaikannya | Titik penanda pada item sidebar yang bersangkutan tampil, lalu hilang setelah panduan selesai | 4.4 Titik penanda |
| G14 | Akun tanpa izin `handover` (mis. hanya `item: view`) | Panduan Serah Terima tidak ditawarkan di kartu, banner, atau menu; tidak ada titik penanda di menu Serah Terima | 4.2 |
| G15 | Akun individu saat `guides.list` gagal (matikan jaringan lalu buka aplikasi) | Tidak ada penawaran panduan sama sekali (tidak menampilkan "semua belum selesai"); aplikasi tetap berfungsi | 4.3 Pemuatan |
| G16 | Buka peramban yang belum memasang PWA di Android Chrome dan iOS Safari | Panduan "Pasang PWA" ditawarkan; setelah dipasang dan dibuka dari ikon, panduan itu tidak ditawarkan lagi, dan tidak tampil di menu "Panduan" | 4.3 Diturunkan, 4.4 Menu |
| G17 | Login di aplikasi terpasang dengan izin notifikasi `default` (bersamaan dengan dialog pra-izin push) | Panduan push tidak muncul bersamaan dengan dialog pra-izin; penawarannya menunggu dialog itu selesai | 4.3 Diturunkan |
| G22 | Buka Safari iOS di tab biasa (bukan aplikasi terpasang), atau server staging tanpa `VAPID_*`, lalu buka menu "Panduan" | Panduan "Aktifkan push" tidak ditawarkan dan tidak tampil di menu (keputusan 2026-11-14, butir A dan B); "Pasang PWA" hanya tampil bila pemasangan memang tersedia | 4.3 Diturunkan, 4.4 Menu |
| G23 | Matikan kotak "Terima notifikasi push" di menu profil, lalu buka menu "Panduan" | Panduan "Aktifkan push" tidak tampil (`userEnabled` = `false`, butir A) | 4.3 Diturunkan |
| G18 | Di ponsel (layar sempit), mulai tur yang menyorot menu sidebar | Sidebar terbuka lebih dulu bila perlu; kartu tur tidak menutupi item sidebar yang sedang disorot; langkah berikutnya tetap berjalan | 4.5, dan tes fokus kartu tur vs sidebar ponsel |
| G19 | Di perangkat nyata (Android Chrome dan iOS Safari, aplikasi terpasang dan tab biasa): jalankan tur dengan sentuhan | Kartu tur dapat digeser/dibaca, tombol Lanjut dan Lewati dapat diketuk, tidak ada elemen yang tertutup keyboard; tur tidak macet saat pindah rute | 4.5 |
| G20 | Tooltip dengan klip (bila sudah direkam) dibuka di jaringan lambat | Klip diunduh hanya saat tooltip dibuka (`preload="none"`); tanpa klip, tampil daftar langkah bernomor; tidak ada klip yang dipra-cache oleh service worker | 4.6, 9 |
| G24 | Buka ikon info "Tempel dari WhatsApp" (tooltip, lalu juga dari langkah tur Serah Terima), terang dan gelap, layar sempit 375 px | Demo berurutan: chat WhatsApp tiruan (bilah atas hijau, latar chat, bubble putih berekor dengan nama pengirim dan jam, tanpa bracket mentah) -> tekan lama satu bubble (bilah pilihan "1", bubble tersorot biru muda) -> ketuk pesan lain (angka bertambah) -> ikon salin dan toast "Disalin" -> kotak tempel -> Pecah -> kartu task; terbaca di terang dan gelap; tanpa scroll horizontal; tanpa logo WhatsApp | 4.6, butir E 2026-11-14 |
| G21 | Pengguna tanpa izin apa pun pada modul panduan yang dimaksud membuka rute tujuan tur langsung | Tur tidak memunculkan target yang tak berhak; langkah dilewati atau jatuh ke penjelasan teks; tidak macet | 4.5 |

## PWA Fase 2

> **BELUM TERUJI di perangkat nyata (Android, iOS, desktop); wajib dijalankan di staging sebelum rilis.**

| # | Langkah | Hasil yang diharapkan | PRD |
|---|---|---|---|
| 183 | Matikan jaringan (mode pesawat), lalu buka aplikasi terpasang dari ikon | Layar "Tidak ada koneksi" dengan tombol "Coba lagi", bukan halaman login; setelah jaringan kembali, "Coba lagi" memuat aplikasi dalam keadaan login | PWA FR-P7, FR-P15 |
| 184 | Saat sudah login dan beranda terbuka, matikan jaringan, lalu pindah ke halaman yang memuat data tersimpan (mis. Merk) | Spanduk "Server sedang tidak tersedia — menampilkan data terakhir (hh:mm)" tampil dengan jam data; halaman lain tanpa data tersimpan menampilkan galat biasa dengan "Coba lagi" | PWA FR-P16 |
| 185 | Nyalakan jaringan lagi dan tunggu atau buka halaman lain | Spanduk hilang sendiri setelah permintaan berikutnya berhasil | PWA FR-P16 |
| 186 | Buka detail task, matikan jaringan, lalu centang satu butir (dan klik butir yang sama lagi) | Centang tampak tersimpan dengan penanda "Belum terkirim"; satu toast info (tidak menumpuk); tidak ada toast galat | PWA FR-P17 |
| 187 | Nyalakan jaringan lagi (tanpa memuat ulang halaman) | Centang tertunda terkirim sendiri, penanda hilang; centang tampil dengan nama dan waktu dari server; riwayat audit mencatat satu centang per butir | PWA FR-P17 |
| 188 | Centang saat offline, tutup aplikasi, buka lagi saat online | Centang tertunda terkirim saat aplikasi dibuka; tidak ada yang hilang atau terkirim ganda | PWA FR-P17 |
| 189 | Centang saat offline, lalu minta orang lain menyelesaikan atau membatalkan task itu sebelum Anda online | Saat online muncul "N perubahan centang tidak dapat dikirim" beserta alasannya; entri dibuang dan tidak diulang | PWA FR-P18 |
| 190 | Ubah jam perangkat maju lebih dari 24 jam setelah mengantre centang offline, lalu online | Entri dibuang dengan pemberitahuan kedaluwarsa; tidak terkirim | PWA FR-P19 |
| 191 | Centang saat offline, lalu Keluar; login sebagai pengguna lain di perangkat yang sama dan online | Antrean pemilik pertama tidak pernah terkirim; DevTools → Application → Local Storage tidak menyisakan kunci `qc.outbox:*` | PWA FR-P14, FR-P19 |
| 192 | Saat offline, coba aksi lain (buat task, simpan item, tambah komentar) | Galat biasa; tidak diantrekan; dapat diulang manual setelah online | PWA FR-P17 |

## PWA Fase 3, Tahap A

> **BELUM TERUJI di perangkat nyata; wajib dijalankan di staging sebelum rilis.**

| # | Langkah | Hasil yang diharapkan | PRD |
|---|---|---|---|
| 193 | Saat offline, centang beberapa butir di dua task | Chip di header menampilkan "N belum terkirim"; butir yang diantrekan bertanda "Belum terkirim" | PWA FR-P20 |
| 194 | Nyalakan jaringan lagi | Chip menjadi "Mengirim X dari N…" lalu hilang setelah semua terkirim; penanda butir hilang | PWA FR-P20 |
| 195 | Online dengan jaringan lambat (throttling); centang satu butir | Penanda "Mengirim…" tampil lalu hilang saat server menjawab | PWA FR-P20 |
| 196 | Dengan antrean tersisa, pilih Keluar | Dialog "Keluar sekarang?" menyebut jumlah; Batal tidak membuang apa pun; Tetap keluar membuang antrean; angka di dialog mengikuti antrean selagi dialog terbuka, dan bila semua sudah terkirim teksnya menjadi "Semua perubahan sudah terkirim. Aman untuk keluar." | PWA FR-P20 |
| 197 | Offline dengan antrean tersisa, tutup lalu buka aplikasi | Layar "Tidak ada koneksi" menyebut "N perubahan menunggu dikirim. Hubungkan ke jaringan, lalu coba lagi agar terkirim."; entri yang sudah lewat 24 jam tidak dihitung | PWA FR-P20 |
| 198 | Buka di ponsel sempit (375 px) saat ada antrean | Chip hanya ikon dan angka; header tidak meluap; ketuk chip membuka daftar singkat (jenis, nomor task atau "Task lain", jam) | PWA FR-P20 |
