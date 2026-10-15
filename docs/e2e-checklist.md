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
| 44 | Isi `SYNC_API_TOKEN` 40 karakter lalu `setup` | Laporan "SYNC_API_TOKEN terisi (40 karakter)"; item/merk lama diberi revisi ("N baris diberi revisi sinkron") | FS2, FS11 |
| 45 | `curl -L --data '{"v":1,"method":"sync.ping","token":"<token>","payload":null}' <URL /exec>` | `{"ok":true,"data":{"apiVersion":1,...,"resources":["brands","items"]}}` | FS1 |
| 46 | Kirim 10 token salah berturut-turut, lalu satu dengan token benar | Semua `UNAUTHENTICATED`; setelah 10 kali, token benar pun ditolak ±10 menit; setelah itu pulih (kedaluwarsa cache) | FS2 |
| 47 | `sync.items.pull` dengan `include` penuh dari `sinceRev: 0` sampai `hasMore: false` | Semua item tepat sekali; `images` berisi id Drive; `detail` memakai `drive:` | FS4 |
| 48 | `sync.items.push` item baru dengan gambar dari folder aplikasi dan Markdown `drive:` | `created`; item muncul di Data Item dengan gambar tampil; audit `sync:desktop` | FS5, FS8, FS10 |
| 49 | Ulangi push yang sama; ubah detail di web lalu push dengan `baseRev` lama | `unchanged`; lalu `conflict` dengan `current`; Log Audit memuat `item.sync.conflict` | FS5, FS6 |
| 50 | `sync.file.get` untuk id di folder dan id di luar folder | Isi base64 dan `NOT_FOUND` | FS9 |
| 51 | Ganti nama merk di web lalu pull item | Semua item merk itu muncul lagi dengan nama baru | FS11 |
| 52 | Dorong 50 item (dan 25 item ber-`detail`) dalam satu `sync.items.push` di deployment; catat lama panggilan | Selesai jauh di bawah 6 menit (target < 2 menit); hasil per item lengkap. Bila lambat, turunkan `SYNC_LIMITS.pushMax` | FS5 |
| 53 | Login WH (`handover: edit`): Serah Terima → Tambah task; ketik customer baru, cari dua tipe lewat saran ("es24" dan "galaxy samsung" urutan kata terbalik), atur qty → Simpan | Nomor `ST-YYYYMMDD-001`, status Baru; Log Audit memuat `customer.create` lalu `handover.create` | FC2, FH2, FH3, FH4 |
| 54 | Buat task kedua di hari yang sama dengan ejaan customer berbeda ("pt. maju  jaya") | Memakai customer yang sama (ejaan resmi), nomor `-002`, tidak ada customer ganda di halaman Customer | FC2, FH4 |
| 55 | Ketik nama customer mirip ("Maju Jaya PT" atau typo) | Petunjuk "Mirip: …, pakai ini?" dapat diklik; tidak memblokir simpan | FC4 |
| 56 | Ketik tipe di luar katalog | "Tipe tidak ditemukan di katalog"; tautan "Tambah item baru" hanya untuk user `item: edit`; tipe tak dikenal tidak dapat disimpan | FH2, FH3 |
| 57 | Login QC (`qc: edit`): buka task; ubah qty selesai satu tipe (Tab), "Selesai" per tipe, lalu "Selesaikan semua" (konfirmasi) | Status Baru → Dikerjakan → Selesai; nama dan waktu per baris tampil; audit `handover.progress` dan **satu** `handover.complete` | FQ1–FQ4 |
| 58 | QC mengisi qty selesai di atas target atau pecahan | Ditolak, pesan "Harus bilangan bulat 0–n"; tidak tersimpan | FQ1 |
| 59 | Buka task Selesai atau Dibatalkan sebagai WH dan QC | Kontrol ubah/progres/batal tidak tampil; panggilan langsung ke RPC → `CONFLICT` | FH7, FQ6 |
| 60 | WH ubah task: turunkan qty di bawah qty selesai; hapus baris yang sudah ada progres | Ditolak dengan pesan di bawah daftar baris; baris tanpa progres boleh dihapus; audit `handover.update` | FH7 |
| 61 | WH (`handover: manage`) batalkan task (konfirmasi); WH `edit` saja | Task Dibatalkan, baca saja, audit `handover.cancel`; WH `edit` tidak melihat tombol Batalkan | FH8 |
| 62 | User dengan akses lokasi A saja: pilih lokasi lain / buka URL task lokasi B | Tidak ada data lokasi B; detail menampilkan "Task tidak ditemukan di lokasi aktif"; panggilan RPC ke lokasi B → `FORBIDDEN` | FH1, FH6 |
| 63 | Pilih dua lokasi di header, lalu satu | Daftar menggabungkan task; kolom Lokasi tampil hanya saat lebih dari satu lokasi | FH6 |
| 64 | Halaman Customer: ganti nama, nonaktifkan; buat task dengan customer nonaktif | Pesan "dinonaktifkan; aktifkan dulu di halaman Customer"; ganti nama ke nama customer lain ditolak | FC5 |
| 65 | WH tanpa izin `item` membuka form task | Saran tipe dan customer tetap muncul (rute serah terima) | FC3 |
| 66 | Log Audit: `handover.update` dan `handover.progress` | Baris dibandingkan per entri berwarna, status berlabel Indonesia, qty progres terbaca | FAU1, FAU2 |
| 67 | Ukuran ponsel (375×812) pada daftar, form, dan detail task | Tidak ada gulir horizontal halaman | NFR6 |
