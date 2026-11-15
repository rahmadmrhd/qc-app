# Bukti foto QC pada Serial Number (bagian 2 dari 4)

Tanggal: 2026-11-16. Status: **DISETUJUI pemilik produk 2026-11-16** (termasuk keputusan perancang di bagian 10); **kode dibangun 2026-11-16** (Task A1-B4; verifikasi manual pemilik belum, lihat §11). Spek induk: `docs/superpowers/specs/2026-11-12-serial-number-design.md`. Bagian 1 (alur laporan rusak): `docs/superpowers/specs/2026-11-14-serial-laporan-rusak-design.md`. Bagian 3 dan 4 (serial sama di lokasi lain = cek ulang; tag dan notifikasi) di luar dokumen ini.

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

## 4. Pendekatan yang dipertimbangkan
- **Siapa yang menggambar cap.** (a) Browser: murah, tetapi orang dalam yang paham teknis dapat menggambar cap palsu. (b) **Server, dipilih**: cap tidak dapat dipalsukan lewat klien. Server sudah punya `Bun.Image` bawaan (Bun 1.4.2 dipatok di Dockerfile dan CI): baca JPEG/PNG/WebP, ubah ukuran, simpan JPEG/PNG/WebP. Yang tidak ada: menggambar teks, menempel, masukan piksel mentah, SVG (diuji 2026-11-16). `Bun.Image(...).png()` menghasilkan PNG 8-bit RGBA tidak berinterlasi, dapat diinflate dengan `node:zlib`.
- **Kapan cap digambar.** (a) Saat melampirkan: isi cap bisa salah bila serial/item/lokasi baris draft diubah sesudahnya. (b) Saat Simpan di browser: harus mengunduh dan mengunggah ulang tiap foto, rapuh untuk batch 200 baris. (c) **Saat Simpan di server lewat antrean, dipilih**: data dibekukan saat Simpan, browser tidak mengulang apa pun.
- **Tempat simpan sementara.** (a) Langsung ke Drive saat melampirkan: foto yang tak jadi disimpan mengotori Drive dan butuh hapus lewat Drive. (b) Kolom blob di MariaDB: menggembungkan dump cadangan malam. (c) **Disk server pada volume baru, dipilih**: mengikuti pola `qc-backups`; konsekuensinya perubahan `deploy/compose.yml` dan `.env` di VPS harus dilakukan manual (CI tidak membawanya).
- **Cara menggambar teks.** (a) Pustaka kanvas native: huruf halus, tetapi dependensi native di image Alpine yang tidak dapat diuji di mesin pengembang (docker tidak ada). (b) **Font bitmap dan kode piksel sendiri, dipilih** (keputusan pemilik): tanpa dependensi, deterministik, mudah dites; huruf berbentuk blok.

## 5. Perilaku
### 5.1 Melampirkan (web)
- **Tambah Serial Number**: tiap baris draft punya kolom/tombol "Foto" (jumlah foto) yang membuka file dialog; foto per baris. Item, BU, lokasi, dan serial baris **tidak dikunci**: cap memakai data saat Simpan. Draft menyimpan id foto (bukan gambar). "Kosongkan draft" dan menghapus baris juga membuang foto draft barisnya (upaya terbaik; sisanya disapu).
- **Cek ulang** (`recheck`, `recheck_pass`, `recheck_fail`): dialog update mendapat field "Bukti foto (opsional)" yang membuka file dialog yang sama.
- **File dialog**: komponen `FileDialog` dengan `showLibrary={false}` (hanya tab Unggah) ditambah **kamera langsung**: tombol kamera membuka pratinjau langsung (akses kamera seperti pemindai, `use-camera-scanner.ts`) dengan tombol "Ambil foto", boleh berturut-turut; tiap foto masuk antrean unggah. Kamera tidak tersedia atau izin ditolak: pesan jelas, "Telusuri" tetap ada. Gambar dikecilkan di browser seperti biasa (`prepareImage`) sebelum diunggah.
- Batas (keputusan saya): maks. 5 foto per entri; maks. 150 foto draft per pengguna sekaligus (cukup untuk sekitar 30 baris berfoto penuh; antrean tunggal memprosesnya dalam hitungan menit); tiap foto <= 10 MB diterima server (target browser 1 MB); format JPEG, PNG, WebP.

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
Baris 3 memakai **lokasi serial sesudah kejadian**: pada Tambah = lokasi baris; pada Cek ulang = lokasi tempat cek ulang dilakukan (dari custody `transit`, itu lokasi tujuan pengiriman karena cek ulang sekaligus menerima unit di QC). Baris 2 = merk lalu tipe item; baris 4 = waktu Simpan menurut server (WIB) dan nama pelaku dengan label tim. Ukuran huruf berskala menurut lebar gambar (terbaca di 640 px sampai 4000 px); baris terlalu panjang dipotong dengan "…". Glyph: ASCII cetak; huruf Latin bersandi (é, ü, …) dilipat ke huruf dasarnya; karakter lain tampil "?". Hasil disimpan sebagai WebP (kualitas tetap), tanpa metadata.

### 5.4 Gagal dan coba lagi
Foto yang gagal diproses (berkas rusak, Drive tak terjangkau berulang) berstatus `failed` dengan alasan singkat. Pelaku yang menyimpan (atau `serial: manage`) dapat "Coba lagi" selama berkas sementaranya masih ada; foto yang tak mungkin pulih (sumber rusak) boleh dibuang agar tak mengganggu (satu-satunya penghapusan setelah Simpan; dicatat di riwayat audit).

## 6. Arsitektur
### 6.1 Data (migrasi baru, expand-only)
Tabel `serial_proof_photos`: `id`, `serial_id` (kosong selama draft), `event_id` (kosong selama draft), `state` (`draft` | `queued` | `processing` | `done` | `failed`), `created_by`, `created_at`, `mime`, `width`, `height`, `size`, `staged_name` (nama berkas sementara hasil buatan server; tidak pernah dari klien), `snapshot_json` (data cap yang dibekukan saat Simpan: SN, merk, tipe, kode BU, lokasi, nama pelaku, tim, waktu Simpan), `file_id` (baris `files` setelah selesai), `attempts`, `last_error`, `updated_at`. Indeks pada (`state`, `updated_at`) dan (`event_id`). Pemilik berkas baru `serialproof` (`FileOwnerType`) hanya untuk baris `files` yang dibuat saat selesai; tidak ada baris di `sticker_guide_images`, sehingga mustahil tampil di pustaka stiker.

### 6.2 Rute REST (`shared/api.ts`, `shared/contract.ts`)
- `serialProofs.upload` (multipart, batas ukuran per rute, `serial: edit`): validasi tanda tangan byte dan dimensi (`readImageDimensions`), kuota draft per pengguna, tulis berkas sementara, baris `draft`.
- `serialProofs.remove` (hanya `draft` milik sendiri, atau `failed` menurut 5.4).
- `serialProofs.get` (unduh/pratinjau: berkas sementara bila belum `done`, Drive lewat `readFile` bila `done`; aturan akses 5.2).
- `serials.saveBatch`: baris mendapat `proofPhotoIds?: string[]`. `serials.act`: `recheck`, `recheck_pass`, `recheck_fail` mendapat `proofPhotoIds?: string[]`. `SerialRowDto.hasProofPhotos`; kartu riwayat memuat daftar foto beserta status.
- Penautan foto ke kejadian terjadi **dalam `batch()` yang sama** dengan penulisan kejadian: klaim CAS per foto (`UPDATE ... SET state='queued', event_id=?, snapshot_json=? WHERE id=? AND state='draft' AND created_by=?`; baris terpengaruh 0 = `CAS_FAIL_SQL`, seluruh batch batal; pesan generik "Ada foto yang tidak dikenal atau sudah dipakai"). Simpan ulang dengan `clientId` yang sama tidak menaut dua kali. `serials.act` tidak punya kunci idempoten: bila dikirim ulang setelah balasan hilang, Simpan kedua gagal oleh versi serial yang usang (`staleError`) dan foto tetap `draft` (disapu setelah 7 hari); ini perilaku yang diterima dan dites.

### 6.3 Antrean dan job
Setelah commit, satu job `serial_proof` per foto dipasang (`enqueueJob`, seperti `serial_alert`; `input` = id foto). Runner (satu job pada satu waktu, lease) menjalankan langkah: (1) baca berkas sementara, gambar cap, simpan hasil bercap di berkas sementara; (2) unggah ke Drive (pembuatan berkas tidak diulang otomatis oleh lapisan permintaan: bila langkah diulang, cek dulu lewat `listFolder` nama `proof-<id>`); (3) satu `batch()`: sisipkan baris `files` (`serialproof`), foto `done`, lalu hapus berkas sementara. Galat sementara diulang (batas percobaan seperti job lain), selebihnya `failed`. Penyapu jam-an menaut ulang foto `queued` tanpa job aktif (jaring pengaman bila proses mati di antara commit dan `enqueueJob`).

Menggambar: `Bun.Image` ke PNG, inflate dengan `node:zlib`, buka filter baris PNG (kelima jenis), tambah footer (gambar teks dari tabel font bitmap tertanam), kompres ulang PNG, lalu `Bun.Image` ke WebP. Fungsi murni dan dapat dites tanpa basis data. Tanpa dependensi baru.

### 6.4 Pembersihan
Penjadwal jam-an (yang sudah ada) menghapus foto `draft` berumur > 7 hari (berkas sementara dan baris; tanpa panggilan Drive). Simpan yang merujuk foto yang sudah disapu: `VALIDATION` yang jelas ("Foto sudah kedaluwarsa, unggah ulang"). Foto `queued`/`processing` tidak pernah disapu. Menutup tugas "pembersihan unggahan yatim" untuk jalur ini (keputusan BU 18 hanya mencatatnya belum ada).

### 6.5 Penyebaran
Variabel baru (mis. `PROOF_STAGING_DIR`) wajib di `server/src/config.ts`, `deploy/compose.yml`, dan `deploy/.env.example` (dijaga `server/src/deploy-files.test.ts`), volume bernama baru untuk direktori itu, dan batas total ukuran sementara (menolak unggah baru bila penuh). **Prasyarat rilis**: salin perubahan `deploy/compose.yml` dan isi `.env` di VPS secara manual sebelum push yang men-deploy (CI tidak membawanya); dicatat di `docs/ci-cd.md` dan `docs/deploy-vps.md`. Migrasi tanpa rollback ke image sebelumnya yang membaca skema baru (kolom/tabel baru saja).

## 7. Dampak pada dokumen lain
Spek induk: butir keputusan baru (nomor lanjutan) dan §4 (lampiran), §5.4 (jenis riwayat tidak berubah), §12; `CLAUDE.md`: paragraf Serial Number (rute, tabel, pemilik berkas, volume, job); `docs/ci-cd.md` dan `docs/deploy-vps.md` (prasyarat manual); `docs/setup-google.md` bila folder Drive khusus dipakai (bawaan: folder gambar yang sama dengan `serial`).

## 8. Pengujian dan fokus review
Tes: gambar cap (fungsi murni: tiap jenis filter PNG, gambar sangat kecil 1×1, sangat lebar/tinggi, 4000 px, teks panjang dipotong, karakter non-Latin menjadi "?"); upload (tanda tangan palsu, ukuran, kuota, MIME); penautan CAS (foto milik orang lain, sudah dipakai, kedaluwarsa, dua Simpan serentak merujuk foto yang sama, simpan ulang `clientId`, `serials.act` dikirim ulang setelah balasan hilang, cap lokasi pada cek ulang dari `transit`, batas piksel gambar sebelum inflate PNG); antrean (restart di tengah langkah, lease, Drive mati lalu hidup, langkah unggah diulang tanpa duplikat, `failed` lalu "Coba lagi"); penyapu (foto draft > 7 hari, foto antre tak tersentuh); akses (BU lain = NOT_FOUND, foto draft orang lain, `serialservice` baca); pustaka stiker tidak pernah memuat foto bukti dan sebaliknya (tes dua arah); badge di daftar, detail, dan kartu; file dialog tanpa tab Pustaka, kamera ditolak atau tak ada. Fokus review: disk penuh, proses mati antara commit dan enqueue, server menggambar ratusan foto (job tunggal, tanpa memblokir permintaan), serangan jalur berkas (nama berkas hanya buatan server), beban dump cadangan (foto tidak masuk MariaDB).

## 9. Diserahkan kepada pembangun
Tata letak dan ukuran huruf footer, pilihan font bitmap (domain publik) dan skala, kompresi WebP, nama kolom persis, bentuk antarmuka kisi foto dan dialog kamera, dan angka ambang kecil (batas percobaan, kuota disk). Hal yang tidak boleh diubah tanpa bertanya: cap digambar di server saat Simpan dengan data dibekukan, foto tak dapat dihapus setelah Simpan, tanpa dependensi gambar baru, dan pemisahan dari pustaka stiker.

## 10. Keputusan perancang (belum disetujui pemilik; mohon diperiksa)
Batas 5 foto per entri dan 150 foto draft per pengguna; ambang sapuan draft 7 hari; pemilik berkas `serialproof`; footer ditambahkan di bawah foto (tidak menimpa isi foto); hasil disimpan WebP; foto bukti tidak tampil di halaman publik dan `.qcsn` tidak membawa foto; gambar dikecilkan di browser sebelum unggah; "Coba lagi" dan pembuangan foto gagal oleh pelaku atau `serial: manage`; lokasi cap = lokasi sesudah kejadian; satu job `serial_proof` per foto dengan penyapu penaut ulang.

## 11. Deviasi implementasi dan catatan terbuka (dicatat 2026-11-16)
Bagian ini mencatat selisih antara kode dan rancangan di atas. Butir A adalah deviasi perancang yang BELUM disetujui pemilik produk: tidak dianggap keputusan, dan perubahan perilakunya perlu konfirmasi pemilik dulu. Butir B adalah catatan terbuka.

### 11.1 Deviasi (menunggu konfirmasi pemilik produk)
A1. **Penyapu penaut-ulang foto `queued` (§6.3) tidak dibuat.** Job `serial_proof` dipasang ATOMIK dalam `batch()` Simpan (`serialProofJobStmt` di `server/src/modules/serial/proof/attach.ts`, digabung dengan klaim CAS foto dan penulisan kejadian), sehingga tidak ada foto `queued` tanpa job kecuali batch batal, dan batch yang batal tak meninggalkan apa pun. Penyapu draft (§6.4) tetap ada. Bila pemilik ingin jaring tambahan, penyapu itu dapat ditambahkan lagi.
A2. **`PROOF_STAGING_DIR` tidak ada di `deploy/.env.example`** (§6.5 mensyaratkan ketiga berkas). Variabel hanya di `server/src/config.ts` dan `deploy/compose.yml` (titik pasang volume `qc-proofs`), seperti `BACKUP_LOCAL_DIR`; tes `server/src/deploy-files.test.ts` mencatatnya di daftar pengecualian. `PROOF_STAGING_MAX_BYTES` ada di `.env.example`.
A3. **Indeks tambahan pada migrasi `0019_bukti_foto_qc.sql`**: `serial_proof_photos_owner (created_by, state)` (hitung kuota draft) dan `serial_proof_photos_serial (serial_id)` (penanda dan riwayat). Expand-only; tidak mengubah keputusan.
A4. **Rute `serialProofs.retry`** (`POST /serial-proofs/{id}/retry`) ditambahkan di luar daftar §6.2. Diperlukan oleh "Coba lagi" di §5.4.
A5. **Penyimpangan kecil tanpa dampak perilaku** (cukup dicatat): berkas hasil bercap diberi nama UUID acak, bukan `<staged>.stamped`, karena `ProofStore` hanya menerima nama UUID (jalur berkas tak bisa disusun dari luar); huruf Latin dengan kait atau coret (ø, ß, đ) tidak terlipat dan tampil "?"; "Coba lagi" pada foto `draft` milik sendiri dijawab `CONFLICT`, bukan `NOT_FOUND`.

### 11.2 Catatan terbuka
B1. **Tombol "Coba lagi" dan "Buang" di web menebak pelaku dari nama.** `proof-gallery.tsx` menampilkan tombol bila `serial: manage` pada BU serial, atau `serial: edit` dan nama pelaku kartu sama dengan nama pengguna. Dua pengguna dengan nama sama bisa melihat tombol yang tak berhak; server tetap menolak. Usul: `canManage` dan `byMe` di `SerialProofPhotoDto` dari server. Mengubahnya menambah field DTO; konfirmasi pemilik dulu.
B2. **Pengembalian ke image sebelum fitur ini.** Migrasi `0019` hanya menambah tabel (aman bagi image lama), tetapi image lama tidak punya handler untuk job `serial_proof`. Setelah foto pertama tersimpan, jangan kembali ke image lama; perbaiki ke depan.
B3. **Tata letak cap pada foto kecil.** Skala huruf `round(lebar/400)` membuat baris 4 (nama pelaku) terpotong pada foto 640 px (sekitar 52 karakter). Tata letak diserahkan ke pembangun (§9); bila pemilik ingin skala lebih kecil, ubah di `stamp.ts`.
B4. **Berkas hasil yatim.** Bila proses mati di antara pembuatan berkas bercap dan pencatatan state job, berkas itu tertinggal di disk dan tidak disapu. Dampak kecil (ukuran satu foto); catatan untuk pemantauan volume.
B5. **Pemakaian memori.** Satu job menggambar satu foto pada satu waktu; untuk foto 16 MP (4000 x 4000) puncaknya sekitar 64 MB RGBA ditambah salinan hasil. Batas dimensi unggahan menahannya.
B6. **Sisa uji pemilik (tidak dapat dilakukan agen):** kamera ponsel nyata, unggah nyata ke Drive, tampilan cap di perangkat, volume `qc-proofs` dan kuota disk di VPS, serta jatuhnya sapuan draft 7 hari.
