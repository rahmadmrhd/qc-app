# Foto bukti QC bermasalah: pemberitahuan dan unggah ulang (tambahan rancangan)

Tanggal: 2026-11-16. Status: **disetujui pemilik produk 2026-11-16** (termasuk lima keputusan perancang di §5); **dibangun 2026-11-16** (fakta di §7, risiko dan pertanyaan terbuka di §8). Melengkapi
`2026-11-16-serial-bukti-foto-qc-design.md` (selanjutnya "rancangan induk"); tidak mengganti bagian lain. Keputusan pemilik tercatat di spek induk butir 60 dan 61 (penerima foto pengganti, B7, toast, dan penjaga keluar draft, 2026-11-16).

## 1. Latar dan tujuan

Foto bukti diproses di belakang layar sesudah Simpan (cap, unggah Drive). Bila gagal (`failed`: gambar rusak,
Drive bermasalah, berkas sementara hilang, ukuran melebihi batas), rancangan induk hanya menampilkan kartu gagal di
riwayat dan tombol Coba lagi/Buang. Pemilik meminta (2026-11-16): pengguna **diberi tahu**, detail Serial Number
**menampilkan informasi** bahwa bukti foto bermasalah dan **meminta segera diunggah ulang**.

Tujuan: bukti foto tidak hilang diam-diam; pelaku tahu dan punya jalan memperbaikinya dalam jendela 14 hari sebelum
foto gagal dibuang otomatis (retensi, keputusan pemilik 2026-11-16).

Bukan tujuan: peringatan email (pemilik memilih push dan dalam aplikasi, bukan email); notifikasi ke orang selain
pelaku; preferensi notifikasi per kategori (tetap satu saklar push yang ada); mengubah alur Simpan/Cek ulang.

## 2. Keputusan pemilik (2026-11-16)

1. Pemberitahuan: **banner di detail + badge "Foto bermasalah" di daftar/kartu** DAN **notifikasi push + lonceng
   dalam aplikasi** (modul notifikasi yang ada, diperluas dari khusus Serah Terima).
2. Unggah ulang: **ganti foto dengan cap jujur**. Tombol "Unggah ulang" pada foto bermasalah menggantikan foto itu;
   cap tetap memuat SN/merk/tipe/BU-lokasi/pelaku-simpan yang asli dan menambah satu baris terakhir
   `Diunggah ulang <tgl jam> WIB · <nama>` agar waktu bukti tidak menyesatkan.

## 3. Pendekatan (dipilih pemilik; yang lain dipertimbangkan)

- Unggah ulang: (a) ganti foto, cap jujur, **dipilih**; (b) ganti dengan cap identik snapshot asli (waktu cap bisa
  menyesatkan sebagai bukti); (c) tambah foto baru ke entri tersimpan (membuka jalur tambah-foto di luar momen
  Tambah/Cek ulang).
- Notifikasi: sisi server memasang baris notifikasi di batch yang sama dengan penetapan `failed` (atomik, tanpa
  email), dikirim lewat putaran push yang ada.

## 4. Rancangan

### 4.1 Pemberitahuan

- `shared/serials.ts`/`contract.ts`: `SerialSummaryDto.proofProblemCount` (jumlah foto `failed` pada entri; 0 = tak
  ada). Badge "Foto bermasalah" (daftar, kartu, detail) tampil bila > 0, berdampingan dengan badge "Bukti foto QC".
- Banner di detail Serial Number (semua pembaca entri melihatnya): "Foto bukti QC bermasalah (n foto). Segera unggah
  ulang sebelum dibuang otomatis pada <tanggal gagal + 14 hari>." Tombol "Unggah ulang" hanya bagi yang
  `canManage` pada foto itu (aturan `canManageProof` yang ada). Foto yang gagal karena ukuran hanya dapat diunggah
  ulang atau dibuang (bukan Coba lagi), seperti rancangan induk.
- Notifikasi (lonceng + push) untuk **satu penerima: pemilik baris foto saat itu** (pengunggah foto itu; untuk foto pengganti, pengunggah ulang; keputusan pemilik 2026-11-16), satu per
  foto yang gagal. Jenis baru `serialProofFailed` (VARCHAR, tanpa migrasi). Judul: "Foto bukti QC bermasalah";
  isi: nomor Serial Number saja, **tanpa alasan teknis dan tanpa nama merk/tipe** (alasan hanya tampil di
  aplikasi). Klik membuka detail Serial Number. Dedup per foto (satu notifikasi per kegagalan; kegagalan baru sesudah
  Coba lagi menghasilkan notifikasi baru). `location_id` memakai lokasi saat ini entri; penerima melihat lonceng bila
  masih berhak membaca entri itu (aturan akses sadar jenis: Serial memakai izin `serial`, bukan izin Serah Terima).
  Tag push per foto (bukan per entri). Mengikuti saklar push pengguna yang ada; bila push mati, tetap masuk lonceng.
  Notifikasi lebih tua dari retensi 90 hari yang sudah ada dibuang seperti biasa; tautan ke foto yang sudah dibuang
  tetap membuka detail entri (banner hilang sendiri).

### 4.2 Unggah ulang (ganti foto)

- Rute baru `serialProofs.replace` (`serial: edit`): input `{ photoId (yang gagal), newPhotoId (unggahan draft baru
  lewat `serialProofs.upload` yang ada) }`. Satu `batch()` berpenjaga CAS: klaim draft baru menjadi `queued` dengan
  **snapshot cap milik foto lama** dan tanda `reuploaded` (waktu + pelaku saat ini), hapus baris foto gagal
  (bersyarat `state='failed'`), pasang job `serial_proof` dan audit `serial.proof_reupload`. Gagal salah satu =
  tak ada yang berubah. Berkas sementara foto lama dibuang hanya bila barisnya terhapus.
- Hak: sama dengan Buang/Coba lagi (`canManage`: pelaku atau `serial: manage` pada BU entri, plus `serial: edit`).
- Cap: `stampLines` mendapat baris tambahan hanya untuk foto yang diunggah ulang: `Diunggah ulang <tgl jam> WIB ·
  <nama>` (jam = waktu Replace di server, nama = pengunggah ulang). Foto biasa tidak berubah.
- Berlaku untuk semua penyebab gagal (termasuk ukuran), dalam jendela retensi 14 hari. Kuota 5 foto/entri tetap
  (pengganti menggantikan satu foto, bukan menambah).
- Web: tombol "Unggah ulang" di kartu foto gagal membuka dialog foto bukti (di ponsel: tombol aplikasi kamera bawaan; desktop: telusuri; tanpa pustaka, satu
  foto) lalu memanggil `replace`; kegagalan unggah pengganti ditangani seperti hasil `invalid` yang ada.

### 4.3 Dampak dokumen

Rancangan induk: tujuan "bukan: peringatan surel untuk foto gagal" tetap benar (email tidak dipakai); catat bahwa
notifikasi push/lonceng kini ada (bagian ini). `CLAUDE.md`: bullet bukti foto + bullet notifikasi (kind baru).
Spek induk Serial Number: butir keputusan baru.

## 5. Yang saya putuskan sendiri (mohon dikoreksi bila keliru)

1. Penerima hanya pemilik baris foto saat itu, yaitu pengunggah foto itu (bukan semua pemegang `serial: manage`). **Disetujui pemilik produk 2026-11-16**; untuk foto pengganti, penerimanya pengunggah ulang.
2. Isi push dan lonceng hanya nomor Serial Number, tanpa alasan teknis dan tanpa merk/tipe.
3. Banner terlihat oleh semua pembaca entri; tombol hanya bagi `canManage`.
4. Satu notifikasi per foto gagal (bukan ringkasan per entri); maks. 5 per entri.
5. Tanpa email; tanpa preferensi per kategori.

## 6. Risiko dan hal yang diserahkan ke pembangun

- Dedup/atomik: notifikasi harus dipasang dalam batch yang sama dengan penetapan `failed` dan hanya bila baris benar-
  benar berubah (INSERT bersyarat), agar `onFail` yang berjalan dua kali tak menggandakan.
- Aturan akses lonceng/push sadar jenis (`location_id` entri; jangan melonggarkan akses jenis Serah Terima).
- `NotificationKind` beserta `NOTIFICATION_SIDE`, `notificationTitle`, `handoverUrlOf`/`pushPayloadOf` (url dan tag per
  jenis) di `shared/notifications.ts`, cabang navigasi di `notification-bell.tsx`.
- Tes: dedup, akses, push tag per foto, `replace` (CAS/race dengan Buang/retry/sapuan), cap dengan baris tambahan,
  banner/badge, bel membuka detail Serial.
- Prasyarat deploy: migrasi `0020_notifikasi_serial.sql` (expand-only; dua kolom `serial_id` dan `proof_id`, bukan
  `ref_id`) dan `0021_indeks_notifikasi_serial.sql` (indeks, lihat §7). Tidak ada variabel `.env`, volume, atau langkah VPS baru dari addendum ini. Status tiap butir di atas:
  lihat §7 (fakta implementasi) dan §8 (risiko dan pertanyaan terbuka).

## 7. Implementasi (fakta, dicatat 2026-11-16)

Dibangun di cabang `feat/serial-lampiran-bukti`: `a9c9cedc` (unggah ulang, `proofProblemCount`, `failedAt`/`expiresAt`, cap "Diunggah ulang"), `0aaedc7f` (notifikasi `serialProofFailed`, migrasi 0020), `7cc9e668` (lonceng membuka detail Serial), dan `f8a3307e` (badge, banner, unggah ulang di web). Keputusan 3 (kuota byte) dan 2 (retensi) ada di `9eac7d16`; perbaikan putaran review (K1, I1, I2, M-*) di `762ca96d`, `bd50a5dd`, `2a743cdc`, `5c2bcf0e`, `ad1b5b1d`, `35dc01e6`, dan `4915a329`. Putaran berikutnya: `d49f2883` (`problemPhotos`, migrasi 0021), `d87089cd` (badge kartu riwayat, kunci tombol), dan `6131384e` (banner membaca `problemPhotos`); review independen putaran E: 0 Critical, 0 Important, Minor sudah diperbaiki.

- **Migrasi `0020_notifikasi_serial.sql`** (expand-only, idempoten): `notifications.serial_id` dan `notifications.proof_id` (VARCHAR(100) NOT NULL DEFAULT ''), tanpa indeks baru (tabel kecil, retensi 90 hari).
- **Migrasi `0021_indeks_notifikasi_serial.sql`** (expand-only, idempoten, 2026-11-16): hanya dua indeks pada `notifications`, `notifications_proof (proof_id)` untuk dedup `NOT EXISTS` di `proofFailedNotificationStmt` dan `notifications_serial (serial_id)` untuk klausa baca jenis Serial di lonceng. Tidak mengubah kolom atau data, tanpa efek saat image lama berjalan dan tanpa efek rollback.
- **Jenis `serialProofFailed`** di `shared/notifications.ts`: judul "Foto bukti QC bermasalah", isi nomor Serial Number saja, url `/serial/<id>`, tag push `serialProofFailed:<photoId>`. Fungsi `isSerialNotificationKind` dan `serialUrlOf`; `NOTIFICATION_SIDE` hanya untuk jenis Serah Terima.
- **Pemasangan**: `proofFailedNotificationStmt` (`server/src/modules/notification/serial-proof.ts`) ada di batch `onFail` job. INSERT ... SELECT bersyarat `state='failed' AND updated_at = <waktu gagal>` dan tidak ada notifikasi dengan `proof_id` sama dan `created_at >= updated_at`, jadi `onFail` ganda tidak menggandakan, sedangkan kegagalan baru sesudah Coba lagi menghasilkan notifikasi baru. `wakeNotifications()` dipanggil sesudah commit.
- **Penerima**: `serial_proof_photos.created_by` (pemilik baris foto). `location_id` = lokasi serial saat ini.
- **Akses sadar jenis**: lonceng dan daftar memfilter jenis Serial lewat `serial_id IN (SELECT id FROM serials WHERE bu_id IN readableBuIds(user))`; jenis Serah Terima tetap lewat lokasi (`hasReadAccess`). Push memakai `canReadNotification` dengan BU serial saat kirim. Kedua aturan tidak saling melonggarkan (ada tes regresi).
- **Rute `serialProofs.replace`**: `POST /api/v1/serial-proofs/{photoId}/replace`, badan `{ newPhotoId }`, keluaran DTO foto pengganti (`queued`). Izin `serial: edit` plus `canManageProof` pada foto lama. Galat: foto lama tak terlihat atau bukan hak = `NOT_FOUND`; foto lama bukan `failed` = `CONFLICT`; pengganti tak dikenal, milik orang lain, sudah diklaim, atau sama dengan foto lama = `VALIDATION` generik "Foto tidak dikenal atau sudah dipakai" (field `newPhotoId`); pengganti melampaui batas kanvas 5 baris = `VALIDATION` "Dimensi gambar terlalu besar"; foto lama keburu dicoba ulang, dibuang, atau disapu = `CONFLICT`.
- **Satu `batch()` berpenjaga**: hapus foto lama bersyarat `state='failed'` (dicek jumlah baris), klaim draft pengganti (`state='draft' AND created_by=?`) menjadi `queued` dengan snapshot foto lama plus `reupload: {at, byName}`, pasang job `serial_proof`, dan audit `serial.proof_reupload`. Berkas sementara foto lama dibuang hanya sesudah komit.
- **Cap**: baris kelima `Diunggah ulang <tgl jam> WIB · <nama>` hanya bila snapshot memuat `reupload`. Cap pengganti dinilai dengan lima baris (`proofSizeError(..., lineCount)`).
- **DTO**: `SerialSummaryDto.proofProblemCount` (jumlah foto `failed` per entri; halaman publik tak membawanya), `GetSerialOutput.problemPhotos` (diisi `serials.get`: SEMUA foto `failed` entri, terlepas dari kejadian yang terpotong `EVENTS_MAX`; banner membacanya dari sini, bukan dari riwayat; tak ada di halaman publik), `SerialProofPhotoDto.failedAt` (= `updated_at` saat `failed`) dan `expiresAt` (`failedAt` + 14 hari), `canManage`, dan `canRetry` (false untuk gagal karena ukuran).
- **Retensi**: `sweepExpiredFailedProofs` (penjadwal jam-an) membuang foto `failed` > 14 hari per foto, dengan audit sistem `serial.proof_retention`.
- **Web**: `ProofProblemBanner` (`web/src/modules/serial/components/proof-problem-banner.tsx`) di detail, dengan tanggal WIB dari `expiresAt` terdekat dan satu baris "Unggah ulang" per foto `failed` yang `canManage`; `ProofProblemBadge` di baris daftar, kepala kartu kejadian riwayat, dan header detail; tombol Buang, Coba lagi, dan Unggah ulang pada foto yang sedang diganti dikunci selama replace berjalan (`usePendingReplaceIds`, `locked` di `proof-gallery.tsx`); `ProofReplaceDialog` (`FileDialog` satu foto, tanpa Pustaka; tombol kamera bawaan hanya di mobile, lihat induk butir 62). Galat replace tampil sebagai toast. Detail Serial dan riwayatnya polling `PROOF_POLL_MS` (5 dtk, `web/src/modules/serial/lib/proof-state.ts`) hanya selama ada foto `queued`/`processing`.
- **Lonceng** (`notification-bell.tsx`): jenis Serial membuka `/serial/<id>`; jenis Serah Terima tetap ke `/handover`.
- Penjaga keluar draft berfoto bukti (2026-11-16, keputusan pemilik): lihat rancangan induk §5.1 dan butir 61 spek induk Serial Number. Bukan bagian addendum ini, tetapi memengaruhi draft Tambah Serial Number yang memuat foto bukti.
- Tidak ada variabel `.env`, volume, atau langkah VPS baru dari addendum ini.

## 8. Risiko dan pertanyaan terbuka (dicatat 2026-11-16)

1. **Pemilik foto pengganti: DIPUTUSKAN pemilik produk 2026-11-16.** Penerima notifikasi dan tombol unggah ulang untuk foto pengganti adalah pengunggah ulang (`created_by`, pemilik baris foto saat itu). Bila manajer mengunggah ulang foto milik pelaku lain lalu gagal lagi, notifikasi dan tombol berpindah ke manajer; pelaku awal tidak diberi tahu. Implementasi sudah sesuai. Butir ini tertutup (induk butir 61).
2. **Coba lagi mereset `attempts`: DITUTUP 2026-11-16** (rancangan induk §11 B7, keputusan pemilik produk): dibiarkan, batas 3 percobaan tidak kumulatif. Butir 61 spek induk.
3. **Rollback ke image sebelum 0020 (tidak dicegah).** Skema aman: kolom baru ber-DEFAULT dan indeks 0021 tidak mengubah apa pun bagi image lama. Namun putaran push image lama dapat memproses baris `serialProofFailed` yang tertunda (judul kosong karena `notificationTitle` tanpa cabang default, tautan `/handover`), bila penerimanya punya akses Serah Terima di lokasi itu. Lonceng image lama diduga juga tidak dapat menampilkan judul (belum diuji). Dicatat di `docs/ci-cd.md`.
4. **Ukuran pengganti lebih ketat.** Unggah memeriksa cap dengan footer 4 baris, tetapi replace memakai 5 baris. Foto yang lolos unggah dapat ditolak replace dengan `VALIDATION` pada `newPhotoId` (dialog menampilkan toast).
5. **Galat replace tetap sebagai toast: DITUTUP 2026-11-16 (keputusan pemilik produk).** `FileDialog` menutup sendiri sesudah `onSelect` sinkron; perluasan `FileDialog` (`onSelect` async, dialog tetap terbuka saat gagal) tidak dikerjakan. Butir 61 spek induk.
6. **Polling 5 dtk** hanya selama ada foto antre (tambahan satu GET per 5 dtk). Bisa dicabut bila dianggap berlebihan.
7. **Belum diuji di perangkat nyata** (verifikasi pemilik): tombol kamera bawaan di ponsel pada dialog unggah ulang, tampilan banner dan badge (terang/gelap, ponsel), klik notifikasi push dari perangkat, dan perilaku service worker.
