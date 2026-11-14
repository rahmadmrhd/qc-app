# Serial Number: alur laporan rusak yang dipangkas (bagian 1 dari 4), rancangan

Tanggal: 2026-11-14. Pemilik produk: Rahmad. Mengubah spek induk `docs/superpowers/specs/2026-11-12-serial-number-design.md` (terutama §3 butir 40, §4.3, §4.6, §5.2, §5.3, §9) dan menggantikan sebagian keputusan 5b. Alur 5b yang sudah ter-merge ke `dev` (PR 69, baru di staging, data hanya data uji) adalah titik awal.

## 1. Tujuan dan latar belakang
Setelah memakai 5b, pemilik produk menilai alur laporan kerusakan terlalu panjang dan terlalu banyak langkah: Tidak lolos, identifikasi kerusakan, dan perbaikan QC terpisah; ada update "nyatakan rusak" terpisah dari diagnosis; ada kirim antar gudang yang tidak diperlukan; field Kerusakan memaksa mengisi dua kali (field dan catatan). Laporan juga tidak punya halaman sendiri, sehingga tim servis harus menelusuri daftar serial. Bagian 1 memangkas alur dan menambah halaman laporan. Bagian 2 sampai 4 (di luar dokumen ini): (2) lampiran hasil pengujian dengan cap pada gambar, (3) serial yang sama di lokasi lain dianggap cek ulang, (4) tag role/user di editor dan notifikasi.

### Tujuan
- Satu proses "Dilaporkan" menggantikan Tidak lolos, identifikasi, dan perbaikan QC.
- Satu dialog update di baris riwayat, dengan tombol sesuai status.
- Halaman Lapor Rusak (ketik Serial Number, cocokkan) dan halaman Laporan (hanya daftar laporan), dan Lapor rusak tetap dapat dibuka dari detail serial.
- Surel "rusak" memuat catatan penuh dan tautan bertanda tangan yang membuka detail laporan tanpa login.
- Cek ulang: stiker berupa daftar centang yang menambah satu per stiker.

### Anti-tujuan
- Tidak membuat mekanisme klaim vendor atau unit pengganti: itu catatan saja (§2 butir 5).
- Tidak mengerjakan lampiran bertanda, serial lintas lokasi, tag dan notifikasi (bagian 2 sampai 4).
- Tidak membuka akses tulis lewat tautan bertanda tangan.

## 2. Keputusan pemilik produk (2026-11-14)
1. Persetujuan 15 default perancang 5b (butir 40 spek induk: OQ-3, 6 sampai 17, 19, 20). Yang bertentangan dengan dokumen ini digantikan (lihat §3 dan §5).
2. Pendekatan **A**: status baru ditulis di server, web, dan basis data; data lama dipetakan satu kali lewat migrasi data. Alasan: 5b baru di staging dengan data uji; pengecualian serupa `0002` dan `0003` (rilis yang gagal diperbaiki ke depan, tanpa rollback).
3. Terima tetap ada di kedua sisi (servis dan QC); memulai diagnosis langsung (atau cek ulang langsung di QC) berarti unit dianggap sudah diterima.
4. Lapor rusak pada serial yang sudah punya laporan aktif ditolak, dengan tautan ke laporan aktif itu. Lapor pada serial berstatus Rusak (final) ditolak.
5. Serial Rusak boleh diberi catatan (klaim vendor, unit pengganti): hanya catatan, tanpa mekanisme baru; unit pengganti dicatat sebagai serial baru lewat Tambah Serial Number.
6. Lokasi tim servis menjadi konfigurasi (`LinkMultiField`); kirim ke servis membacanya. Kirim antar lokasi dihapus total.
7. Surel "rusak" dikirim hanya ketika tim servis menyatakan Rusak. Subjek memuat Serial Number, tipe item, dan kode BU. Isi dan tautan bertanda tangan: §5.8.
8. Halaman publik tautan menampilkan linimasa laporan dalam lingkup nomor LP itu dan detail unit (§5a); pemilik menerima bahwa percakapan internal selama laporan terbuka ikut terbaca pemegang tautan.
9. Pengguna yang membuka tautan sambil login dengan izin pada serial itu masuk ke halaman biasa dengan semua izinnya.
10. Putaran penyempurnaan (pemilik produk, 2026-11-14), hasil review akhir: (a) **K2** terima otomatis (diagnosis atau cek ulang dari `transit`) ditolak dengan `VALIDATION` "Terima dulu unitnya di lokasi aktif" bila lokasi tujuan nonaktif; unit tidak pernah mendarat otomatis di lokasi nonaktif; (b) **K3** lokasi QC asal diisi saat laporan dibuka (lokasi unit saat dilaporkan, termasuk Lapor Rusak) dan diperbarui saat Kirim ke servis; laporan lama tanpa asal memakai lokasi unit sekarang (tanpa fallback ke lokasi saat dicatat); (c) **K4** daftar Laporan menampilkan hasil (Lolos/Rusak) dan tanggal selesai untuk laporan tertutup, status serial sekarang, lokasi saat ini dengan posisi (Di QC, Dalam pengiriman, Di servis), serta lama (aktif: hari pada status; tertutup: lama pengerjaan); (d) **K8** linimasa di aplikasi dan halaman publik sama-sama urut LAMA DI ATAS (seq naik), kartu dilipat kecuali yang terbaru (paling bawah), tombol "Muat yang lebih lama" di atas daftar; (e) **S3** log akses nginx menyamarkan token tautan (`deploy/nginx/qc.conf.example`: `map` + `log_format qc_masked`); (f) opsi filter "Semua laporan" dipertahankan (melampaui §4.5 atas persetujuan pemilik); (g) DTO publik memuat `caseId` agar pemegang berizin mendarat di tab LP laporan itu.

## 3. Pilihan perancang (belum dilihat pemilik; dapat ditolak per butir)
a. Nilai status di basis data: `good`, `reported`, `at_service`, `diagnosis`, `service_repair`, `recheck`, `broken` (§5.1). `failed` dan `qc_repair` dilebur ke `reported`.
b. Catatan wajib pada Lapor rusak, cek ulang gagal, dan Rusak; pada aksi lain opsional.
c. Lapor rusak satu serial per laporan (dengan pemindai atau kamera); lapor massal ditunda.
d. Halaman Laporan memakai menu tersendiri di grup Serial Number.
e. Kembali dari servis ke QC otomatis ke lokasi QC saat dilaporkan; tidak ada field lokasi.
f. Konfigurasi lokasi servis yang kosong berarti semua lokasi aktif (agar alur tidak macet sebelum admin mengisinya).
g. Hak mengubah konfigurasi lokasi servis sama dengan daftar penerima surel (`canManageSerialSettings`).
h. `serials.locationOptions` dikembalikan hanya untuk `serial: edit` (keputusan OQ-4 2026-11-13 tidak diperlukan lagi).
i. Nama pelaku yang menyatakan Rusak ikut di surel dan halaman publik.
j. Halaman publik menyembunyikan angka stok stiker dan alamat surel pengguna; nama pelaku tampil.
k. Gambar pada surel tidak disematkan (jumlahnya disebut, dilihat lewat tautan).
l. Surel tetap teks polos (`core/mail.ts` hanya mendukung teks).
m. Terima otomatis menulis dua kejadian (`receive` lalu aksinya) dalam satu `batch()` (§4.1).
n. Lokasi QC asal diisi saat Kirim ke servis; Terima (QC) meminta lokasi hanya bila lokasi asal sudah nonaktif.
o. Cek ulang tanpa field lokasi; Cek ulang massal 5c memakai kontrak stiker centang.
p. Rute baru `serials.serviceLocations` memberi lokasi servis efektif bagi `serial: edit`.
q. Pembacaan serial oleh `serialservice` tidak dibatasi status (tetap seperti 5b); hanya aksi yang dibatasi.

## 4. Perilaku
### 4.1 Status dan alur
Status serial (`serials.status`, `VARCHAR(32)` tanpa batasan): `good` Lolos, `reported` Dilaporkan, `at_service` Di servis (custody `transit` lalu `service`), `diagnosis` Diagnosis, `service_repair` Sedang diperbaiki, `recheck` Menunggu cek ulang (custody `transit` lalu `qc`), `broken` Rusak (final). Custody tetap `qc`/`transit`/`service`.

| Aksi | Dari (status, custody) | Hasil | Modul |
|---|---|---|---|
| Lapor rusak | `good` (custody `qc`) atau serial baru | `reported`, membuka laporan (`LP-…`); catatan wajib | `serial` |
| Kirim ke servis | `reported` | `at_service`, custody `transit`; lokasi tujuan dari konfigurasi lokasi servis | `serial` |
| Terima (servis) | `at_service`, `transit` | custody `service`, lokasi = lokasi servis | `serialservice` |
| Diagnosis, dengan pilihan status | `at_service` (custody `transit` atau `service`; `transit` berarti diterima otomatis), `diagnosis`, `service_repair`, custody `service` | pilihan: `diagnosis`; `service_repair`; Selesai → `recheck`, custody `transit`, tujuan lokasi QC asal; Rusak → `broken`, laporan ditutup (`outcome` `broken`), surel (catatan wajib) | `serialservice` |
| Terima (QC) | `recheck`, `transit` | custody `qc`, lokasi = lokasi QC asal | `serial` |
| Cek ulang, hasil lolos | `reported`, `recheck` (custody `qc` atau `transit`; `transit` berarti diterima otomatis), `good` | `good`; bila ada laporan ditutup (`outcome` `good`); stiker bertambah | `serial` |
| Cek ulang, hasil gagal | `good` | `reported`, membuka laporan (catatan wajib); stiker bertambah | `serial` |
| Cek ulang, hasil gagal | `reported`, `recheck` | `reported`; laporan tetap terbuka; stiker bertambah | `serial` |
| Catatan | semua status termasuk `broken` | tetap | `serial` (semua), `serialservice` (status servis: `at_service`, `diagnosis`, `service_repair`) |

Dihapus: Tidak lolos, identifikasi kerusakan, perbaikan QC sebagai aksi tersendiri, "nyatakan rusak" sebagai aksi tersendiri, `send`/`receive` antar lokasi, `send` kembali ke QC (diganti Selesai), dan field Kerusakan. Kasus (`serial_cases`) dan nomor `LP-YYYYMMDD-NNN` tetap; kolom `damage` dibiarkan (tidak diisi lagi), dihapus pada rilis berikutnya. Aksi di luar tabel ditolak seperti 5b (`CONFLICT`, `FORBIDDEN`, `VALIDATION`). Satu laporan aktif per serial (diperiksa di server, bukan hanya UI); permintaan serentak diselesaikan lewat CAS seperti 5b.

Pemeriksaan "lokasi tujuan harus beda dengan lokasi sekarang" (`act.ts`) dicabut: kirim dari QC Surabaya ke servis Surabaya sah.

Aksi `serialservice` tetap dibatasi menurut STATUS serial (butir 14 spek induk; `diagnosis` ditambahkan ke `SERVICE_STATUSES` di `shared/serial-flow.ts`). **Pembacaan tidak dibatasi status**, seperti 5b: `serialservice: view` membaca semua serial di BU-nya.

**Terima otomatis.** Diagnosis dari custody `transit` (atau cek ulang dari custody `transit` di QC) menulis DUA kejadian dalam satu `batch()`: `receive` otomatis (tanggal dan lokasi sama dengan aturan Terima biasa, termasuk "tanggal tidak sebelum tanggal kirim", sehingga aturan itu berlaku untuk tanggal dialog) lalu kejadian aksinya. Linimasa dan hitungan "N hari belum diterima" tidak berubah. Stok stiker pada cek ulang dihitung di lokasi SESUDAH terima otomatis.

**Lokasi QC asal.** Diisi saat Kirim ke servis dengan lokasi unit saat itu (kolom di laporan; laporan lama yang sudah dikirim diisi dari lokasi asal kejadian kirim, yang lain tidak perlu karena diisi saat kirim). Terima (QC) memulihkannya sebagai lokasi unit. Bila lokasi itu sudah nonaktif, dialog Terima (QC) meminta lokasi aktif lain (satu-satunya kasus field lokasi muncul di sana). Sejak keputusan 10b, asal juga diisi saat laporan dibuka (lokasi unit saat dilaporkan); Terima otomatis ke lokasi nonaktif ditolak (keputusan 10a).

### 4.2 Cek ulang dan stiker
Daftar stiker pada cek ulang berupa centang, awalnya kosong. Tiap stiker yang dicentang menambah **1** pada jumlah tempel serial itu dan memotong stok 1 di lokasi cek ulang (entri stok terkait kejadian), termasuk stiker yang belum pernah ditempel. Stiker `inactive` tidak dapat dicentang; `deprecated` boleh (butir 24). Menggantikan 5b (§5.2: masukan jumlah naik); kontrak `recheck.stickers` berubah dari jumlah absolut menjadi daftar id yang dicentang, dan Cek ulang massal 5c (§12 spek induk) memakai kontrak baru. Cek ulang tidak lagi punya field `locationId` (pindah lokasi = bagian 3); lokasi cek ulang = lokasi unit (setelah terima otomatis bila `transit`). Cek ulang gagal pada `reported`/`recheck` berlaku untuk custody `qc` atau `transit`. Tambah Serial Number tidak berubah (masih memilih stiker dan jumlah di awal).

### 4.3 Lapor Rusak
Halaman Lapor Rusak (menu di grup Serial Number, `serial: edit`) dan tombol Lapor rusak di detail serial berbagi satu komponen dan satu aturan:
- Ketik atau pindai Serial Number (normalisasi `normalizeSerial`, spek §5.1). Dicocokkan dengan serial di BU yang dapat ditulis pengguna; bila ada di lebih dari satu BU, pengguna memilih BU.
- Ditemukan, `good`: tampil ringkasan unit dan kolom catatan (wajib); tombol Lapor membuka laporan dan meneruskan riwayat serial itu.
- Ditemukan, punya laporan aktif: ditolak "sudah ada laporan aktif" dengan tautan ke laporan itu (nomor LP). Ditemukan, `broken`: ditolak "unit ini sudah dinyatakan rusak". Keduanya tidak membuat kejadian.
- Tidak ditemukan: form meminta item (menentukan BU; bila item ada di dua BU atau lebih, pilih BU), lokasi, dan catatan; serial dibuat langsung berstatus `reported` dengan kejadian `recorded` lalu `report_failure`, tanggal uji = hari ini WIB, satu transaksi.
- Pesan galat dan data masuk tetap generik soal BU lain (spek BU keputusan 13).

Tambah Serial Number tidak punya kolom status dan "Catat langsung Tidak lolos" dihapus; `saveBatch` dan `.qcsn` hanya `good` (baris berstatus lain dianggap bermasalah). Menggantikan butir 40 (d).

### 4.4 Dialog update dan riwayat
Di detail serial, tombol update berada di baris yang sama dengan label "Riwayat", satu tombol per aksi yang tersedia (`availableActions`, satu sumber dengan server). Tiap tombol membuka dialog: catatan (Markdown; gambar pesan maks. 10 seperti 5b), tanggal kejadian, dan isian khas: Kirim ke servis (lokasi bila konfigurasi servis punya lebih dari satu lokasi aktif; otomatis bila hanya satu), Diagnosis (pilihan status: Diagnosis, Sedang diperbaiki, Selesai, Rusak), Cek ulang (hasil dan centang stiker, §4.2), Terima (tanggal; tidak lebih awal dari tanggal kirim). Field update lama yang inline di halaman diganti dialog ini. Riwayat diurutkan LAMA DI ATAS (seq naik; keputusan 10d): entri terbaru ada di paling bawah, diberi badge "Terbaru" dan satu-satunya yang terbuka; entri lama dilipat (judul, pelaku, tanggal, pratinjau satu baris) dan dibuka satu klik.

### 4.5 Halaman Laporan
Rute `/serial/reports`, menu "Laporan" di grup Serial Number, tampil bagi pemegang `serial` atau `serialservice` pada minimal satu BU. Daftar laporan saja (bukan serial): nomor LP, serial, item (merk dan tipe), BU, status, lama pada status sekarang, pelapor, ringkasan (baris pertama catatan laporan, maks. 120 karakter); sejak keputusan 10c juga hasil dan tanggal selesai (laporan tertutup), lokasi saat ini, dan lama; filter status (aktif, selesai, semua) dan BU; baris menuju detail serial pada tab laporan itu. Tim servis (hanya `serialservice`) melihat semua laporan di BU-nya (pembacaan tidak dibatasi status), filter bawaan "aktif", dan dapat menindak dari detail pada status servis. Berkursor seperti `serials.list`.

### 4.6 Konfigurasi lokasi tim servis
`/serial/settings` mendapat bagian "Lokasi tim servis" (`LinkMultiField`, lokasi aktif), global, disimpan di tabel `settings` (kunci baru; ETag/`If-Match` sendiri), hak `canManageSerialSettings`. Kosong = semua lokasi aktif. Lokasi nonaktif yang masih tercantum diabaikan saat memilih tujuan; bila setelah itu tak ada yang aktif, dipakai semua lokasi aktif. Kirim ke servis membaca daftar ini di server (klien mengirim lokasi hanya bila ada lebih dari satu pilihan; server memvalidasi bahwa lokasi termasuk daftar). Klien mendapat daftar efektif lewat rute baru `serials.serviceLocations` (`serial: edit`, mengembalikan hanya lokasi servis efektif sesuai aturan di atas; tidak memuat daftar penerima surel dan tidak membuka `serialSettings.get`).

### 4.7 Surel "rusak"
Dikirim hanya saat aksi Diagnosis dengan pilihan Rusak berhasil (job `serial_alert` seperti 5b, at-least-once). Penerima = daftar `SERIAL_ALERT`. Teks polos:
- Subjek: `Serial Number rusak: <serial> (<tipe item>, <kode BU>)`.
- Badan: serial, item (merk dan tipe), BU, nomor LP, lokasi unit, tanggal dilaporkan, tanggal dinyatakan rusak, nama pelaku yang menyatakan rusak, catatan penuh dari update Rusak (Markdown diubah jadi teks yang terbaca; gambar disebut jumlahnya; `@nama` ditulis biasa), tautan bertanda tangan dan tanggal berlakunya.
- Tidak dimuat: angka stok, alamat surel pengguna.
Menggantikan butir 40 (i).

### 4.8 Tautan bertanda tangan dan halaman publik
- Token: id laporan, waktu kedaluwarsa, tanda tangan HMAC dengan kunci turunan dari `SESSION_SECRET` (label tujuan khusus, sehingga tidak dapat dipakai membuat sesi; tanpa variabel `.env` baru). Perbandingan tanda tangan tetap-waktu.
- Kedaluwarsa = tanggal laporan selesai (ditutup) + 30 hari, akhir hari WIB. Untuk surel Rusak, laporan ditutup saat itu juga.
- Halaman publik (route di luar layout login, mis. `/laporan/<token>`) hanya baca: linimasa laporan dalam lingkup nomor LP itu (§5a) dan detail unit dengan DTO publik khusus (daftar putih field; tanpa angka stok, tanpa alamat surel). Gambar pesan dilayani lewat rute biner bertoken yang memeriksa bahwa berkas milik pesan pada laporan itu.
- Token salah atau kedaluwarsa dijawab 404 yang sama; kegagalan dibatasi per IP dengan tabel `rate_limits` yang sudah ada; `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; token tidak dicatat di log aplikasi, dan log akses nginx menyamarkannya (keputusan 10e).
- Pemegang tautan yang login dan berizin pada serial itu diarahkan ke halaman biasa pada tab LP laporan itu (`caseId` di DTO publik, semua izin normal); yang tidak berizin atau tidak login melihat halaman publik. Token tidak pernah menambah izin.
- Diterima: tautan tidak dapat dicabut per laporan sebelum kedaluwarsa dan terbaca oleh siapa pun yang menerima forward surel; pencabutan massal hanya lewat mengganti `SESSION_SECRET` (mengeluarkan semua sesi). Bila kelak perlu, tambah penanda pencabut per laporan.

### 4.9 Migrasi data (satu kali, idempoten)
Nomor migrasi berikutnya setelah `0016`. `failed`, `qc_repair` → `reported`. `at_service`, `service_repair`, `recheck`, `broken`, `good` tetap. Serial `good` berkustodi `transit` (sisa kirim antar lokasi) → custody `qc`, lokasi = lokasi tujuan. Laporan lama diisi lokasi QC asal dari kejadian kirim ke servis bila ada. Kejadian lama tidak diubah (hanya bertambah); riwayat lama yang bertipe aksi yang sudah dihapus tetap dirender dengan label lamanya.

## 5. Dampak pada dokumen lain (dikerjakan bersama kodenya)
Spek induk: §3 butir 40 diperbarui (persetujuan; (b),(c),(d),(i),(p) digantikan; OQ-4 dan 5 dicabut), butir baru 43 dan seterusnya untuk keputusan di atas, §4.3 (laporan: lokasi asal), §4.6 (surel dan tautan), §5.2 (stiker centang), §5.3 (tabel), §9 (halaman Lapor Rusak dan Laporan), §11. `CLAUDE.md` bullet Serial Number dan aturan REST bertoken. `docs/ci-cd.md` (rollback ke image 5b membaca status baru; tautan bertanda tangan bergantung `SESSION_SECRET`). `docs/adding-a-module.md` bila ada pelajaran. Kode: komentar dan tes OQ-13 di `server/src/modules/serial/alert-job.ts` (surel tanpa pesan, nama, atau surel pelaku) diganti sesuai §4.7.

## 5a. Lingkup linimasa laporan (keputusan pemilik 2026-11-14)
Linimasa laporan, baik di tab laporan maupun di halaman publik, adalah **kejadian yang termasuk lingkup nomor LP itu**: yang membawa `caseId` laporan tersebut, dari dibuka sampai ditutup (lapor, kirim, terima, diagnosis, cek ulang, catatan selama laporan terbuka, termasuk terima otomatis). Di luar lingkup dan TIDAK ditampilkan: pencatatan awal serial, laporan lain pada serial yang sama (tiap LP punya linimasanya sendiri), dan catatan yang ditulis sesudah Rusak (klaim vendor, unit pengganti: `caseId` kosong karena laporan sudah ditutup). Catatan itu tetap terbaca di riwayat serial (internal, `serials.history`). Detail unit pada halaman publik (serial, item, BU, lokasi, tanggal uji, sample) tidak berubah. Ini mempertahankan perilaku kode saat ini dan melindungi catatan klaim vendor dari pemegang tautan.

## 6. Pendekatan yang dipertimbangkan
- **A (dipilih)**: ganti status di mana-mana, data lama dipetakan sekali. Paling bersih; risiko rollback diterima karena baru di staging.
- B: nilai lama dibiarkan dan hanya tampilan digabung. Ditolak: satu arti dua nilai, baris tabel mati, setiap filter menggabungkan.
- C: dua kosakata sampai rilis berikutnya (expand lalu contract). Ditolak: dua rilis dan kode ganda untuk data uji.

## 7. Pengujian dan fokus review
Tabel transisi baru (semua baris, penolakan state dan permission, transisi serentak), pemetaan migrasi, satu laporan aktif per serial di bawah permintaan serentak, Lapor Rusak (ditemukan, tidak ditemukan, laporan aktif, Rusak, BU ganda, BU tak berhak tetap generik), diagnosis langsung dari `transit`, kirim dari QC ke servis di lokasi yang sama, konfigurasi lokasi servis kosong/nonaktif, stiker centang (stiker baru, `inactive`, stok), surel Rusak (isi, tanpa stok dan surel pengguna, at-least-once), tautan bertanda tangan (token benar, salah, kedaluwarsa tepat H+30, dipalsukan, token laporan lain, login berizin dan tidak berizin, gambar milik laporan lain ditolak), `body.test.ts` dan `EXAMPLES` untuk rute baru, tes kesepakatan `availableActions` web dan server. Review akhir mencakup security review (rute tanpa sesi, DTO publik, HMAC, pembatasan laju).

## 8. Diserahkan kepada pembangun
Nama kunci pengaturan lokasi servis, nama rute REST dan id kontrak baru, bentuk DTO publik, penyimpanan lokasi QC asal (kolom di laporan atau data kejadian), penyajian ringkasan laporan (turunan atau kolom), cara rute bertoken lolos kernel REST yang kini mewajibkan sesi, tata letak dialog dan baris tombol, teks pesan galat (santai tapi jelas, "Serial Number" lengkap, butir 32).
