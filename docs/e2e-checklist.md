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
| 24 | Setelah deploy: jalankan `setup` | Laporan menyebut user lama dimigrasi; hak user lama tidak berubah | NFR-L2 |
| 25 | Setelah push Fase A, jalankan `setup` dari editor Apps Script | Google meminta izin Drive sekali; laporan memuat `Folder Drive "QC App Files" siap (...)`; folder muncul di Drive pemilik dan sheet `files` terbuat | FA1 |
| 26 | Jalankan `setup` sekali lagi | Tidak ada folder kedua; id folder sama | FA1 |
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
| 44 | Isi `SYNC_API_TOKEN` 40 karakter di `.env` server lalu mulai ulang server; `GET /sync/ping` dengan token itu; ulangi dengan token < 32 karakter di server uji | 200 untuk token 40 karakter; token server < 32 karakter atau kosong: semua permintaan 401; item/merk hasil impor membawa `rev` (kursor lama tetap valid) | FS2, FS11 |
| 45 | `curl -H "Authorization: Bearer <token>" https://<host>/api/v1/sync/ping`; ulangi tanpa header dan dengan token salah | `{"apiVersion":2,...,"resources":["brands","items"]}`; tanpa header/token salah: 401 problem+json yang sama persis | FS1, FS2 |
| 46 | Kirim 10 token salah berturut-turut dari satu IP, lalu satu dengan token benar dari IP itu dan dari IP lain | Semua 401 yang sama; setelah 10 kali, token benar dari IP itu pun ditolak ±10 menit (IP lain tetap bisa); setelah itu pulih | FS2 |
| 47 | `GET /sync/items?include=detail,stickers,accessories` dari `sinceRev=0` sampai `hasMore: false` | Semua item tepat sekali; `images` berisi id Drive; `detail` memakai `drive:` | FS4 |
| 48 | `POST /sync/items/push` item baru dengan gambar dari folder aplikasi dan Markdown `drive:` | `created`; item muncul di Data Item dengan gambar tampil; audit `sync:desktop` | FS5, FS8, FS10 |
| 49 | Ulangi push yang sama; ubah detail di web lalu push dengan `baseRev` lama | `unchanged`; lalu `conflict` dengan `current`; Log Audit memuat `item.sync.conflict` | FS5, FS6 |
| 50 | `GET /sync/files/{id}` untuk id di folder dan id di luar folder | Byte mentah dengan `Content-Type` dan `ETag`; 404 | FS9 |
| 51 | Ganti nama merk di web lalu pull item | Semua item merk itu muncul lagi dengan nama baru | FS11 |
| 52 | Dorong 50 item (dan 25 item ber-`detail`) dalam satu `POST /sync/items/push` di deployment; catat lama panggilan | Selesai dalam hitungan detik (target < 30 dtk) tanpa 413 (badan < 5 MB); hasil per item lengkap. Bila lambat, turunkan `SYNC_LIMITS.pushMax` | FS5 |
| 53 | Login WH (`handover: edit`): Serah Terima → Tambah task; ketik customer baru, tempel di editor catatan dua baris `CRS310 = 1 unt` dan `RB5009UG = 1 unt` → Simpan | Nomor `ST-YYYYMMDD-001`, status Baru; catatan tampil sebagai dua butir checklist; Log Audit memuat `customer.create` lalu `handover.create` | FC2, FH2, FH3, FH4 |
| 54 | Buat task tanpa mengisi customer (opsional), lalu task kedua di hari yang sama dengan ejaan customer berbeda ("pt. maju  jaya") | Task tanpa customer tersimpan (daftar menampilkan "—", detail "Tanpa customer"); task kedua memakai customer yang sama (ejaan resmi), nomor `-002`, tidak ada customer ganda | FC2, FH4 |
| 55 | Ketik nama customer mirip ("Maju Jaya PT" atau typo) | Petunjuk "Mirip: …, pakai ini?" dapat diklik; tidak memblokir simpan | FC4 |
| 56 | Buka form Tambah task sebagai WH | Hanya ada customer (opsional) dan editor catatan; tidak ada kolom item, tipe, atau qty, dan tidak ada tautan "Tambah item baru" | FH2 |
| 57 | Login QC (`qc: edit`): buka task Baru; centang satu butir, lalu butir kedua; tekan Mark done | Status Baru → Dikerjakan → Selesai; nama dan waktu centang tampil; audit `handover.check` per butir dan `handover.done` | FQ1, FQ2, FQ4 |
| 58 | Dua QC membuka task yang sama dan mencentang butir berbeda, lalu butir yang sama, hampir bersamaan | Tidak ada centang yang hilang; mencentang butir yang sama tidak saling membatalkan | FQ1 |
| 59 | Buka task Dibatalkan sebagai QC lalu sebagai WH; buka task Selesai sebagai QC dan WH | Dibatalkan: QC tidak melihat Mark done, centang ditolak (RPC langsung → `CONFLICT`); "Buka kembali" hanya tampil untuk WH dengan `handover: manage`. Selesai: tidak ada Mark done dan tidak ada Buka kembali | FH7, FQ6 |
| 60 | WH (`handover: edit`) mengubah teks butir yang sudah dicentang; lalu mencoba menghapus butir yang sudah dicentang | Teks diubah: centang butir itu kembali kosong dan tercatat di audit `handover.update`; penghapusan butir tercentang ditolak dengan pesan jelas | FH7 |
| 61 | WH (`handover: manage`) batalkan task (konfirmasi); WH `edit` saja | Task Dibatalkan, baca saja, audit `handover.cancel`; WH `edit` tidak melihat tombol Batalkan | FH8 |
| 62 | User dengan akses lokasi A saja: pilih lokasi lain / buka URL task lokasi B | Tidak ada data lokasi B; detail menampilkan "Task tidak ditemukan di lokasi aktif"; panggilan RPC ke lokasi B → `FORBIDDEN` | FH1, FH6 |
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
| 112 | Sebagai WH (`handover: edit`), di Buat task tempel satu tempelan WhatsApp "Orderan Online" berisi dua baris `= 1 unt` | Satu task dengan usulan customer "Orderan Online" dan dua butir checklist; awalan pesan WhatsApp dibuang bila ada | Desain 2026-10-23 §4.2, §9 (contoh 1) |
| 113 | Pada jalur bulk, tempel empat contoh pemilik secara terpisah (satu per satu) | Hasil 1, 2, 1, dan 3 task; customer sesuai contoh; butir checklist dan paragraf catatan sesuai contoh; WH dapat mengoreksi sebelum simpan | Desain 2026-10-23 §4.3, §9 (contoh 1–4) |
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
