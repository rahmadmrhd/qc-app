# Bukti foto QC pada Serial Number (bagian 2 dari 4)

Tanggal: 2026-11-16. Status: **DISETUJUI pemilik produk 2026-11-16** (termasuk keputusan perancang di bagian 10); **kode dibangun 2026-11-16** (Task A1-B4), lalu diperbaiki setelah review akhir (putaran D1-D2) dan ditambah foto bermasalah (rancangan tambahan `2026-11-16-serial-bukti-foto-qc-masalah-design.md`). Keputusan pemilik 2026-11-16 tercatat di spek induk butir 60 dan dirujuk di §5.5, §6.3, §6.4, dan §11; verifikasi manual pemilik belum (§11.2 B6). Spek induk: `docs/superpowers/specs/2026-11-12-serial-number-design.md`. Bagian 1 (alur laporan rusak): `docs/superpowers/specs/2026-11-14-serial-laporan-rusak-design.md`. Bagian 3 dan 4 (serial sama di lokasi lain = cek ulang; tag dan notifikasi) di luar dokumen ini.

## 1. Tujuan dan latar belakang
Permintaan pemilik produk (2026-11-14): "tambahkan inputan untuk melampirkan hasil pengujian (bisa lebih dari 1 gambar), dengan timestamp, lokasi, serial number, tipe dan mungkin beberapa informasi perangkat pada setiap gambar yang diunggah."

Tujuannya (pemilik, 2026-11-16): **dokumentasi dan bukti kondisi fisik, kelengkapan, dan sebagainya**, untuk berjaga-jaga bila customer mengajukan komplain: tim dapat memaparkan hasil pemeriksaan QC saat itu. Karena itu foto harus terbawa konteksnya (cap) sekalipun gambarnya disalin keluar aplikasi, dan tidak boleh berubah setelah tersimpan.

Keadaan sekarang: gambar hanya dapat disisipkan di catatan Markdown (maks. 10 per pesan, pemilik berkas `serial`, tanpa cap, dikecilkan di browser ke <= 1 MB). Tidak ada lampiran terpisah dan tidak ada penanda bahwa suatu entri punya bukti foto.

## 2. Tujuan, bukan tujuan, anti-tujuan
Tujuan:
- Lampiran foto **opsional**, lebih dari satu per entri, pada dua momen: **Tambah Serial Number** (per baris draft) dan **Cek ulang** (dialog update).
- Tiap foto bercap permanen (gambar) dengan SN, tipe, merk, BU, lokasi, waktu simpan (server), dan nama pelaku.
- Entri yang punya foto diberi badge **"Bukti foto QC"** (daftar, detail, kartu riwayat).
- Unggah lewat file dialog dengan **kamera langsung**, tanpa tab Pustaka.
- Pembersihan rutin untuk foto draft yang tidak jadi disimpan.

Bukan tujuan: foto pada Lapor rusak, Kirim ke servis, Terima, Diagnosis, atau Catatan (gambar di catatan Markdown tetap seperti sekarang); foto pada tabel batch `.qcsn` (berkas `.qcsn` tidak membawa foto); filter daftar "punya bukti foto"; tampilan foto di halaman publik tautan surel; ekspor foto massal; penghapusan atau penggantian foto yang sudah tersimpan; metadata EXIF (jam ambil, GPS) pada cap; peringatan surel untuk foto gagal.

Anti-tujuan (dianggap gagal walau fungsinya jalan): cap yang berisi data yang bukan data entri tersimpan (mis. lokasi yang masih bisa diubah); foto bukti yang muncul di pustaka gambar stiker atau pustaka lain; foto draft yang tak jadi disimpan menumpuk selamanya (di disk atau Drive); Simpan yang gagal atau macet karena Drive lambat; server yang tak responsif karena menggambar banyak foto.

## 3. Keputusan pemilik produk (2026-11-16)
1. Lampiran bersifat opsional; entri berfoto diberi badge "memiliki bukti foto saat proses QC".
2. Momen: Tambah Serial Number dan Cek ulang (opsi 2).
3. Jam pada cap dari **jam server** saja (opsi A; bukan metadata berkas).
4. Cap digambar **di server**, pada saat Simpan (data cap dibekukan saat Simpan).
5. Foto disimpan **sementara di server**, lalu diproses antrean **per gambar** (gambar cap sampai unggah ke Drive).
6. Font **bitmap** (tanpa dependensi baru).
7. Foto yang diunggah tetapi tak jadi disimpan dibersihkan lewat penjadwal rutin.
8. File dialog fitur ini **tanpa pustaka**; foto bukti tidak boleh tampil di pustaka gambar stiker (pustaka itu dipakai bersama lampiran penempelan stiker).
9. Kamera langsung tersedia di file dialog.
10. **Penjaga keluar untuk draft berfoto bukti** (fitur baru, disetujui 2026-11-16; butir 61 spek induk Serial Number): lihat §5.1.

## 4. Pendekatan yang dipertimbangkan
- **Siapa yang menggambar cap.** (a) Browser: murah, tetapi orang dalam yang paham teknis dapat menggambar cap palsu. (b) **Server, dipilih**: cap tidak dapat dipalsukan lewat klien. Server sudah punya `Bun.Image` bawaan (Bun 1.4.2 dipatok di Dockerfile dan CI): baca JPEG/PNG/WebP, ubah ukuran, simpan JPEG/PNG/WebP. Yang tidak ada: menggambar teks, menempel, masukan piksel mentah, SVG (diuji 2026-11-16). `Bun.Image(...).png()` menghasilkan PNG 8-bit RGBA tidak berinterlasi, dapat diinflate dengan `node:zlib`.
- **Kapan cap digambar.** (a) Saat melampirkan: isi cap bisa salah bila serial/item/lokasi baris draft diubah sesudahnya. (b) Saat Simpan di browser: harus mengunduh dan mengunggah ulang tiap foto, rapuh untuk batch 200 baris. (c) **Saat Simpan di server lewat antrean, dipilih**: data dibekukan saat Simpan, browser tidak mengulang apa pun.
- **Tempat simpan sementara.** (a) Langsung ke Drive saat melampirkan: foto yang tak jadi disimpan mengotori Drive dan butuh hapus lewat Drive. (b) Kolom blob di MariaDB: menggembungkan dump cadangan malam. (c) **Disk server pada volume baru, dipilih**: mengikuti pola `qc-backups`; konsekuensinya perubahan `deploy/compose.yml` dan `.env` di VPS harus dilakukan manual (CI tidak membawanya).
- **Cara menggambar teks.** (a) Pustaka kanvas native: huruf halus, tetapi dependensi native di image Alpine yang tidak dapat diuji di mesin pengembang (docker tidak ada). (b) **Font bitmap dan kode piksel sendiri, dipilih** (keputusan pemilik): tanpa dependensi, deterministik, mudah dites; huruf berbentuk blok.

## 5. Perilaku
### 5.1 Melampirkan (web)
- **Tambah Serial Number**: tiap baris draft punya kolom/tombol "Foto" (jumlah foto) yang membuka file dialog; foto per baris. Item, BU, lokasi, dan serial baris **tidak dikunci**: cap memakai data saat Simpan. Draft menyimpan id foto (bukan gambar). "Kosongkan draft" dan menghapus baris juga membuang foto draft barisnya (upaya terbaik; sisanya disapu).
- **Penjaga keluar (keputusan pemilik produk 2026-11-16, butir 61 spek induk Serial Number):** bila ada baris draft yang memuat foto bukti, navigasi keluar dari Tambah Serial Number menampilkan dialog tiga tombol: "Simpan dulu" (menjalankan Simpan semua baris; pindah halaman hanya bila semua baris tersimpan, bila ada yang gagal tetap di halaman), "Keluar tanpa menyimpan" (draft tetap di localStorage perangkat itu), dan "Tetap di sini". Draft tanpa foto tetap memakai konfirmasi lama (`window.confirm`). Keluar dari aplikasi (tombol Keluar) tidak memunculkan dialog karena draft memang sengaja dibuang; peringatan tutup tab dan muat ulang tetap. Alasan: foto sementara di server hanya bertahan 7 hari dan draft hanya ada di perangkat itu. Implementasi: `web/src/modules/serial/lib/leave-guard.ts`, `leave-proof-dialog.tsx`, `web/src/routes/_app/serial/new.tsx` (commit 11894da9).
- **Cek ulang** (`recheck`, `recheck_pass`, `recheck_fail`): dialog update mendapat field "Bukti foto (opsional)" yang membuka file dialog yang sama.
- **File dialog**: komponen `FileDialog` dengan `showLibrary={false}` (hanya tab Unggah) ditambah **kamera langsung**: tombol kamera membuka pratinjau langsung (akses kamera seperti pemindai, `use-camera-scanner.ts`) dengan tombol "Ambil foto", boleh berturut-turut; tiap foto masuk antrean unggah. Kamera tidak tersedia atau izin ditolak: pesan jelas, "Telusuri" tetap ada. Gambar dikecilkan di browser seperti biasa (`prepareImage`) sebelum diunggah.
- Batas (keputusan saya): maks. 5 foto per entri; maks. 150 foto draft per pengguna sekaligus (cukup untuk sekitar 30 baris berfoto penuh; antrean tunggal memprosesnya dalam hitungan menit); total berkas draft per pengguna 300 MB (`draftBytesPerUser`, keputusan pemilik 2026-11-16, spek induk butir 60c); tiap foto <= 10 MB diterima server (target browser 1 MB); format JPEG, PNG, WebP. Batas dimensi gambar di §5.5.

### 5.2 Setelah Simpan
- Foto menjadi tidak dapat dihapus atau diganti oleh siapa pun lewat aplikasi (kecuali foto berstatus gagal, lihat 5.4).
- Badge "Bukti foto QC" muncul begitu entri tersimpan (juga selama foto masih diproses; kartu foto menunjukkan "menunggu cap"/"gagal").
- Tempat badge dan foto: baris Daftar Serial Number (`SerialRowDto.hasProofPhotos`), kepala detail serial, dan kartu riwayat `recorded`/`recheck*` yang punya foto (kisi gambar kecil; klik membuka tampilan besar; tombol unduh gambar bercap). Foto bukti **tidak** tampil di halaman publik tautan surel.
- Hak baca: pembaca serial atau `serialservice` pada BU serial itu (seperti gambar pesan serial). Foto draft hanya terbaca pengunggahnya.

### 5.3 Cap
Footer **ditambahkan di bawah foto** (tinggi gambar bertambah; isi foto tidak tertutup), latar hitam, huruf putih, empat baris:
```
SN: ABC123
Cisco C9200
BU1 · Surabaya
Disimpan 16 Nov 2026 14:32 WIB · Budi (QC)
```
Baris 3 memakai **lokasi serial sesudah kejadian**: pada Tambah = lokasi baris; pada Cek ulang = lokasi tempat cek ulang dilakukan (dari custody `transit`, itu lokasi tujuan pengiriman karena cek ulang sekaligus menerima unit di QC). Baris 2 = merk lalu tipe item; baris 4 = waktu Simpan menurut server (WIB) dan nama pelaku dengan label tim. Ukuran huruf berskala menurut lebar gambar (terbaca di 640 px sampai 4000 px sisi terpanjang, batas di §5.5); baris terlalu panjang dipotong dengan "…". Glyph: ASCII cetak; huruf Latin bersandi (é, ü, …) dilipat ke huruf dasarnya; karakter lain tampil "?". Batasan yang diterima (§11 A5, disetujui 2026-11-16): huruf dengan kait atau coret (ø, ß, đ) tidak terlipat dan tampil "?". Hasil disimpan sebagai WebP (kualitas tetap), tanpa metadata.

### 5.4 Gagal dan coba lagi
Foto yang gagal diproses (berkas rusak, Drive tak terjangkau berulang) berstatus `failed` dengan alasan singkat. Pelaku yang menyimpan (atau `serial: manage`) dapat "Coba lagi" selama berkas sementaranya masih ada; foto yang tak mungkin pulih (sumber rusak) boleh dibuang agar tak mengganggu. Coba lagi tidak ditawarkan untuk gagal karena ukuran (`canRetry` false; hanya Buang). Foto `failed` yang lewat 14 hari sejak gagal dibuang otomatis oleh penjadwal (`SERIAL_PROOF_LIMITS.failedRetentionDays`, audit sistem `serial.proof_retention`). Buang (`serial.proof_remove`) dan unggah ulang (`serial.proof_reupload`, rancangan tambahan) dicatat di riwayat audit; Coba lagi tidak diaudit. Keputusan pemilik 2026-11-16 (spek induk butir 60b).

### 5.5 Batas ukuran gambar (ditambahkan 2026-11-16, keputusan pemilik butir 60a dan 60e)
Server tidak mengubah ukuran foto sebelum cap (tanpa resize); batas ditegakkan lewat penolakan. Satu fungsi `proofSizeError(width, height, lineCount)` di `server/src/modules/serial/proof/stamp.ts` dipakai saat unggah, di `stampPhoto` (sebelum alokasi), di job (dari ukuran yang tercatat, sebelum berkas dibaca), dan untuk keputusan Coba lagi:
- sisi terpanjang <= 4000 px (`PROOF_MAX_SIDE`);
- luas gambar <= 4,2 juta piksel (`PROOF_MAX_PIXELS`);
- luas kanvas hasil (lebar x (tinggi + footer)) <= 5,25 juta piksel (`PROOF_MAX_CANVAS_PIXELS`).
Akibatnya foto 4000 x 4000 (16 MP) ditolak saat unggah dengan `VALIDATION` "Dimensi gambar terlalu besar". Angka ini menjaga puncak memori cap di bawah batas container 256 MB (temuan review akhir K1 dan I1).

## 6. Arsitektur
### 6.1 Data (migrasi baru, expand-only)
Tabel `serial_proof_photos`: `id`, `serial_id` (kosong selama draft), `event_id` (kosong selama draft), `state` (`draft` | `queued` | `processing` | `done` | `failed`), `created_by`, `created_at`, `mime`, `width`, `height`, `size`, `staged_name` (nama berkas sementara hasil buatan server; tidak pernah dari klien), `snapshot_json` (data cap yang dibekukan saat Simpan: SN, merk, tipe, kode BU, lokasi, nama pelaku, tim, waktu Simpan), `file_id` (baris `files` setelah selesai), `attempts`, `last_error`, `updated_at`. Indeks pada (`state`, `updated_at`) dan (`event_id`). Pemilik berkas baru `serialproof` (`FileOwnerType`) hanya untuk baris `files` yang dibuat saat selesai; tidak ada baris di `sticker_guide_images`, sehingga mustahil tampil di pustaka stiker.

### 6.2 Rute REST (`shared/api.ts`, `shared/contract.ts`)
- `serialProofs.upload` (multipart, batas ukuran per rute, `serial: edit`): validasi tanda tangan byte dan dimensi (`readImageDimensions`), kuota draft per pengguna, tulis berkas sementara, baris `draft`.
- `serialProofs.remove` (hanya `draft` milik sendiri, atau `failed` menurut 5.4).
- `serialProofs.retry` (ditambahkan; disetujui pemilik 2026-11-16, §11 A4) dan `serialProofs.replace` (unggah ulang foto gagal; rancangan tambahan §4.2).
- `serialProofs.get` (unduh/pratinjau: berkas sementara bila belum `done`, Drive lewat `readFile` bila `done`; aturan akses 5.2).
- `serials.saveBatch`: baris mendapat `proofPhotoIds?: string[]`. `serials.act`: `recheck`, `recheck_pass`, `recheck_fail` mendapat `proofPhotoIds?: string[]`. `SerialRowDto.hasProofPhotos`; kartu riwayat memuat daftar foto beserta status.
- Penautan foto ke kejadian terjadi **dalam `batch()` yang sama** dengan penulisan kejadian: klaim CAS per foto (`UPDATE ... SET state='queued', event_id=?, snapshot_json=? WHERE id=? AND state='draft' AND created_by=?`; baris terpengaruh 0 = `CAS_FAIL_SQL`, seluruh batch batal; pesan generik "Ada foto yang tidak dikenal atau sudah dipakai"). Simpan ulang dengan `clientId` yang sama tidak menaut dua kali. `serials.act` tidak punya kunci idempoten: bila dikirim ulang setelah balasan hilang, Simpan kedua gagal oleh versi serial yang usang (`staleError`) dan foto tetap `draft` (disapu setelah 7 hari); ini perilaku yang diterima dan dites.

### 6.3 Antrean dan job
Setelah commit, satu job `serial_proof` per foto dipasang (`enqueueJob`, seperti `serial_alert`; `input` = id foto). Runner (satu job pada satu waktu, lease) menjalankan langkah: (1) baca berkas sementara, gambar cap, simpan hasil bercap di berkas sementara; (2) unggah ke Drive (pembuatan berkas tidak diulang otomatis oleh lapisan permintaan: bila langkah diulang, cek dulu lewat `listFolder` nama `proof-<id>`); (3) satu `batch()`: sisipkan baris `files` (`serialproof`), foto `done`, lalu hapus berkas sementara. Galat sementara diulang (batas percobaan seperti job lain), selebihnya `failed`. **Diubah 2026-11-16 (keputusan pemilik butir 60d):** job dipasang ATOMIK dalam `batch()` Simpan, sehingga penyapu penaut-ulang tidak dibuat. Hitungan percobaan cap disimpan permanen di `serial_proof_photos.attempts` (naik sebelum cap; lewat dari `PROOF_MAX_STAMP_ATTEMPTS` = 3 maka `failed`); Coba lagi mereset hitungan ini (lihat §11 B7).

Menggambar: `Bun.Image` ke PNG, inflate dengan `node:zlib`, buka filter baris PNG (kelima jenis), tambah footer (gambar teks dari tabel font bitmap tertanam), kompres ulang PNG, lalu `Bun.Image` ke WebP. Fungsi murni dan dapat dites tanpa basis data. Tanpa dependensi baru.

### 6.4 Pembersihan
Penjadwal jam-an (yang sudah ada) menghapus foto `draft` berumur > 7 hari (berkas sementara dan baris; tanpa panggilan Drive). Simpan yang merujuk foto yang sudah disapu: `VALIDATION` yang jelas ("Foto sudah kedaluwarsa, unggah ulang"). Foto `queued`/`processing` tidak pernah disapu. Menutup tugas "pembersihan unggahan yatim" untuk jalur ini (keputusan BU 18 hanya mencatatnya belum ada). **Ditambahkan 2026-11-16 (keputusan pemilik butir 60e):** penyapu berkas sementara yatim (jam-an; berkas parsial > 1 jam, berkas nama staged > 24 jam yang tidak dirujuk baris mana pun) dan pembuangan foto `failed` > 14 hari (butir 60b).

### 6.5 Penyebaran
Variabel baru wajib di `server/src/config.ts` dan `deploy/compose.yml` (dijaga `server/src/deploy-files.test.ts`); `PROOF_STAGING_DIR` ditetapkan di compose, bukan di `deploy/.env.example` (disetujui pemilik 2026-11-16, §11 A2), dan variabel operator seperti `PROOF_STAGING_MAX_BYTES` wajib di `deploy/.env.example`; volume bernama baru untuk direktori itu, dan batas total ukuran sementara (menolak unggah baru bila penuh). **Prasyarat rilis**: salin perubahan `deploy/compose.yml` dan isi `.env` di VPS secara manual sebelum push yang men-deploy (CI tidak membawanya); dicatat di `docs/ci-cd.md` dan `docs/deploy-vps.md`. Migrasi tanpa rollback ke image sebelumnya yang membaca skema baru (kolom/tabel baru saja).

## 7. Dampak pada dokumen lain
Spek induk: butir keputusan baru (nomor lanjutan) dan §4 (lampiran), §5.4 (jenis riwayat tidak berubah), §12; `CLAUDE.md`: paragraf Serial Number (rute, tabel, pemilik berkas, volume, job); `docs/ci-cd.md` dan `docs/deploy-vps.md` (prasyarat manual); `docs/setup-google.md` bila folder Drive khusus dipakai (bawaan: folder gambar yang sama dengan `serial`).

## 8. Pengujian dan fokus review
Tes: gambar cap (fungsi murni: tiap jenis filter PNG, gambar sangat kecil 1×1, sangat lebar/tinggi, ambang 4000 px, 4,2 juta piksel, dan 5,25 juta kanvas (§5.5), teks panjang dipotong, karakter non-Latin menjadi "?"); upload (tanda tangan palsu, ukuran, kuota, MIME); penautan CAS (foto milik orang lain, sudah dipakai, kedaluwarsa, dua Simpan serentak merujuk foto yang sama, simpan ulang `clientId`, `serials.act` dikirim ulang setelah balasan hilang, cap lokasi pada cek ulang dari `transit`, batas piksel gambar sebelum inflate PNG); antrean (restart di tengah langkah, lease, Drive mati lalu hidup, langkah unggah diulang tanpa duplikat, `failed` lalu "Coba lagi"); penyapu (foto draft > 7 hari, foto antre tak tersentuh); akses (BU lain = NOT_FOUND, foto draft orang lain, `serialservice` baca); pustaka stiker tidak pernah memuat foto bukti dan sebaliknya (tes dua arah); badge di daftar, detail, dan kartu; file dialog tanpa tab Pustaka, kamera ditolak atau tak ada. Fokus review: disk penuh, proses mati antara commit dan enqueue, server menggambar ratusan foto (job tunggal, tanpa memblokir permintaan), serangan jalur berkas (nama berkas hanya buatan server), beban dump cadangan (foto tidak masuk MariaDB).

## 9. Diserahkan kepada pembangun
Tata letak dan ukuran huruf footer, pilihan font bitmap (domain publik) dan skala, kompresi WebP, nama kolom persis, bentuk antarmuka kisi foto dan dialog kamera, dan angka ambang kecil (batas percobaan, kuota disk). Hal yang tidak boleh diubah tanpa bertanya: cap digambar di server saat Simpan dengan data dibekukan, foto tak dapat dihapus setelah Simpan, tanpa dependensi gambar baru, dan pemisahan dari pustaka stiker.

## 10. Keputusan perancang (disetujui pemilik produk 2026-11-16 bersama bagian 2; perubahan di §5.5, §6.3, §11)
Batas 5 foto per entri dan 150 foto draft per pengguna; ambang sapuan draft 7 hari; pemilik berkas `serialproof`; footer ditambahkan di bawah foto (tidak menimpa isi foto); hasil disimpan WebP; foto bukti tidak tampil di halaman publik dan `.qcsn` tidak membawa foto; gambar dikecilkan di browser sebelum unggah; "Coba lagi" dan pembuangan foto gagal oleh pelaku atau `serial: manage`; lokasi cap = lokasi sesudah kejadian; satu job `serial_proof` per foto (penyapu penaut-ulang dibuang, §11 A1).

## 11. Deviasi implementasi dan catatan terbuka (dicatat 2026-11-16)
Bagian ini mencatat selisih antara kode dan rancangan di atas. Butir A adalah deviasi perancang; sejak 2026-11-16 seluruhnya disetujui pemilik produk (A2-A5 di §11.1, dan rujukan di spek induk butir 61). Butir B adalah catatan terbuka (status per 2026-11-16 ditulis di tiap butir).

### 11.1 Deviasi (A1-A5 DITUTUP 2026-11-16; A2-A5 DISETUJUI pemilik produk 2026-11-16)
A1. **DITUTUP 2026-11-16 (keputusan pemilik butir 60d).** Penyapu penaut-ulang foto `queued` (§6.3) tidak dibuat. Job `serial_proof` dipasang ATOMIK dalam `batch()` Simpan (`serialProofJobStmt` di `server/src/modules/serial/proof/attach.ts`, digabung dengan klaim CAS foto dan penulisan kejadian), sehingga tidak ada foto `queued` tanpa job kecuali batch batal, dan batch yang batal tak meninggalkan apa pun. Penyapu draft (§6.4) tetap ada.
A2. **DISETUJUI 2026-11-16 (pemilik produk): `PROOF_STAGING_DIR` tidak wajib di `deploy/.env.example`.** Variabel hanya di `server/src/config.ts` dan `deploy/compose.yml` (titik pasang volume `qc-proofs`, nilai tetap `/var/lib/qc/proofs`), seperti `BACKUP_LOCAL_DIR`; tes `server/src/deploy-files.test.ts` mencatatnya di daftar pengecualian. `.env.example` hanya menyebutnya dalam komentar dan memuat `PROOF_STAGING_MAX_BYTES`. Alasan: lokasi direktori adalah urusan tata letak kontainer, bukan pengaturan yang diubah operator. §6.5 disesuaikan.
A3. **DISETUJUI 2026-11-16 (pemilik produk): indeks tambahan pada migrasi `0019_bukti_foto_qc.sql`**: `serial_proof_photos_owner (created_by, state)` (hitung kuota draft) dan `serial_proof_photos_serial (serial_id)` (penanda dan riwayat). Alasan: kuota draft dan penanda dibaca pada jalur panas; expand-only, tidak mengubah keputusan.
A4. **DISETUJUI 2026-11-16 (pemilik produk): rute `serialProofs.retry`** (`POST /serial-proofs/{id}/retry`) ditambahkan di luar daftar awal §6.2. Alasan: diperlukan oleh "Coba lagi" di §5.4. §6.2 disesuaikan.
A5. **DISETUJUI 2026-11-16 (pemilik produk), penyimpangan kecil tanpa dampak perilaku:** (a) berkas hasil bercap diberi nama UUID acak, bukan `<staged>.stamped`, karena `ProofStore` hanya menerima nama UUID (jalur berkas tak bisa disusun dari luar); (b) huruf Latin dengan kait atau coret (ø, ß, đ) tidak terlipat dan tampil "?". **Batasan yang diterima**, dicatat di §5.3; (c) "Coba lagi" pada foto `draft` milik sendiri dijawab `CONFLICT`, bukan `NOT_FOUND` (foto belum `failed`, jadi keadaannya tidak cocok).

### 11.2 Catatan terbuka
B1. **DITUTUP 2026-11-16 (keputusan pemilik butir 60e).** Tombol Coba lagi dan Buang tidak lagi menebak pelaku dari nama: `canManage` dan `canRetry` ada di `SerialProofPhotoDto` dan dihitung server (`proof/access.ts`; `canManage` juga mensyaratkan `serial: edit` saat ini). Usul `byMe` tidak dibuat. Kondisi sebelumnya: tombol bisa tampak bagi pengguna yang namanya sama; server tetap menolak.
B2. **Pengembalian ke image sebelum fitur ini.** Migrasi `0019` hanya menambah tabel (aman bagi image lama), tetapi image lama tidak punya handler untuk job `serial_proof`. Migrasi `0020` menambah dua kolom ber-default (aman). Setelah foto pertama tersimpan, jangan kembali ke image lama; perbaiki ke depan. Rincian rollback notifikasi di `docs/ci-cd.md`.
B3. **Tata letak cap pada foto kecil.** Skala huruf `round(lebar/400)` membuat baris 4 (nama pelaku) terpotong pada foto 640 px (sekitar 52 karakter). Tata letak diserahkan ke pembangun (§9); bila pemilik ingin skala lebih kecil, ubah di `stamp.ts`.
B4. **DITUTUP 2026-11-16 (keputusan pemilik butir 60e).** Berkas hasil yatim (proses mati di antara pembuatan berkas bercap dan pencatatan state job) dibuang penyapu yatim jam-an (§6.4): ambang 1 jam untuk berkas parsial dan 24 jam untuk berkas staged. Pemantauan volume tetap disarankan.
B5. **DITUTUP 2026-11-16 (keputusan pemilik butir 60e).** Satu job menggambar satu foto pada satu waktu. Batas dimensi §5.5 menggantikan angka lama 16 MP (4000 x 4000 kini ditolak saat unggah). Puncak RSS tambahan terukur di putaran perbaikan D2: sekitar 78 MB untuk 2048 x 2048; kasus terburuk yang masih lolos batas (4000 x 830) sekitar 91 MB.
B6. **Sisa uji pemilik (tidak dapat dilakukan agen):** kamera ponsel nyata, unggah nyata ke Drive, tampilan cap di perangkat, volume `qc-proofs` dan kuota disk di VPS, serta jatuhnya sapuan draft 7 hari.
B7. **DITUTUP 2026-11-16 (keputusan pemilik produk, butir 61 spek induk Serial Number): dibiarkan seperti implementasi.** `retryProof` mengembalikan `attempts` ke 0 (untuk kegagalan selain ukuran). Akibatnya batas 3 percobaan cap berlaku per siklus gagal lalu Coba lagi, bukan kumulatif; pemilik produk menyetujui perilaku ini dan hitungan kumulatif tidak dibuat. Temuan review D2 (M3).
