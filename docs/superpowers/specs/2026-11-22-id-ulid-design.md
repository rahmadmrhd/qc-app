# ID baris basis data: ULID (dan jalan ke BINARY(16))

Status: keputusan pemilik produk 2026-11-22; kode aplikasi di cabang lokal `claude/id-ulid` (belum di-merge). Skrip penulisan
ulang data lama TIDAK ada di repo (bagian 1 butir 7). Tahap 2 (tipe kolom `BINARY(16)`) menunggu migrasi tahap 1 sukses di
produksi dan dibahas terpisah.

## 1. Keputusan

1. **ID baris baru = ULID huruf kecil 26 karakter** (`shared/ids.ts`: `isUlid`, `formatUlid`, `nextUlidState`;
   `server/src/core/id.ts`: `newId()`), menggantikan `crypto.randomUUID()` untuk kolom `id`. Awalan 48 bit waktu membuat
   penyisipan selalu di ujung indeks klaster InnoDB; kolasi `utf8mb4_nopad_bin` membandingkan byte sehingga urutan teksnya
   benar tanpa pengaturan tambahan. Huruf kecil dipilih agar selaras dengan konvensi "huruf kecil" yang ada; validator menolak
   huruf besar (tidak dinormalisasi diam-diam).
2. **Semua ID lama (UUID v4 dan v5) ditulis ulang menjadi ULID** oleh skrip operator lokal (bagian 1 butir 7; jalur B pada
   diskusi). Waktu ULID tiap baris lama = `created_at` barisnya, jadi urutan kronologis data lama terjaga.
3. **Tahap 2 (nanti, setelah tahap 1 sukses):** ubah tipe kolom ID menjadi `BINARY(16)` lewat migrasi expand → contract.
   Karena seluruh ID sudah ULID, bentuk teks (base32) tunggal dan dapat dibentuk ulang dari 16 byte tanpa ambiguitas.
4. Catatan perancang: UUIDv7 akan membuat tahap 2 lebih mulus tanpa menulis ulang ID lama, tetapi pemilik memilih ULID dan
   menulis ulang seluruh data. Keputusan ini sah; konsekuensinya ada di bagian 4.
5. **Nama unduhan turunan memakai 8 karakter AKHIR ID** (bagian acak), bukan 8 karakter awal (diusulkan perancang,
   disetujui pemilik produk 2026-11-22, menutup bagian 6e butir 1). Delapan karakter awal ULID seluruhnya waktu (10 karakter
   pertama = 48 bit waktu), sehingga berkas yang dibuat dalam selang sekitar satu detik akan bernama sama; ini regresi
   yang timbul dari pergantian ke ULID, jadi diperbaiki di kode bersama perubahan ini. Berlaku untuk lampiran Postel
   (`lampiran-<8 akhir id>.<ekstensi>`, `server/src/modules/postel/attachments.ts`) dan foto bukti QC
   (`bukti-<8 akhir id>.<ekstensi>`, `server/src/modules/serial/proof/repo.ts`). Akibat langsung: nama unduhan berkas yang
   sama BERUBAH setelah ID-nya ditulis ulang (kosmetik; tak ada yang bergantung pada nama itu). Format di spek Postel 4b
   (`2026-11-11-stiker-postel-4b-design.md`) ikut disesuaikan.
6. **Hash isi QR dihitung ulang oleh skrip migrasi, TANPA ekspor ulang** (keputusan pemilik produk 2026-11-22, menutup
   bagian 6a; opsi 1). `qrContentHash` memuat `logoFileId` (ID baris `files`) dan teks label, jadi penulisan ulang ID
   mengubah isi yang di-hash. Alasan: tanpa penghitungan ulang semua konfigurasi QR berlogo menjadi `stale` palsu dan ekspor
   berikutnya melahirkan versi Manual Book baru (stok terbelah). SYARAT dari pemilik produk: "jangan sampai export ulang":
   langkah ini HANYA mengganti nilai `qr_designs.exported_hash` dan `manual_book_versions.content_hash`; tidak boleh
   memicu atau menyiapkan ekspor, versi Manual Book baru, stiker baru, perubahan stok, tugas, atau pemanggilan Drive, dan
   tidak mengubah `updated_at`, `exported_at`, `exported_by`, `export_pdf_drive_id`, `export_png_drive_id`, atau status
   konfigurasi. Rancangan dan jaminannya di bagian 4 (butir 5).
7. **Skrip migrasi dan tabel petanya TIDAK masuk repo** (keputusan pemilik produk 2026-11-22: "aku tidak ingin kode migrasi
   masuk ke dalam repo, cukup di lokal saja"). Skrip penulisan ulang ID adalah alat sekali pakai milik pemilik yang disimpan
   lokal (folder `server/ops-lokal/`, diabaikan git lewat `.gitignore` di dalamnya, tanpa pemeriksaan CI). Akibatnya:
   (a) tidak ada migrasi `0031`: skrip membuat tabel `id_ulid_map` sendiri (`CREATE TABLE IF NOT EXISTS`; dry-run tidak
   menulis apa pun, termasuk tidak membuat tabel; arah `--revert` menolak bila tabel belum ada) dan tabel itu dibuang manual
   (`DROP TABLE id_ulid_map`) setelah masa pantau; (b) kode aplikasi QR tidak diubah demi skrip: skrip membawa SALINAN lokal
   penurun isi label (dari `qrcode/repo.ts` dan `qrcode/service.ts`), dan tes lokalnya membandingkan hasilnya dengan jalur
   aplikasi sebenarnya; (c) tak ada pengecualian pemindai soft-delete atau entri tes migrasi untuk skrip di repo; (d) bagian 4
   dan 6 di bawah tetap mendokumentasikan rancangan, jaminan, dan prosedur skrip sebagai catatan keputusan, BUKAN sebagai
   kode di repo. Alasan: operasi sekali pakai yang tak perlu dipelihara, diuji CI, atau dibawa ke produksi; permukaan repo
   lebih kecil. Risiko yang diterima pemilik: skrip tak ikut tinjauan dan riwayat repo, dan hilang bila folder lokal hilang
   (cadangkan sendiri); salinan penurun isi QR dapat basi bila aplikasi mengubah isi label sebelum skrip dijalankan (tes
   lokal menangkapnya). **Satu-satunya pengecualian: lapisan terjemahan ID lama di server (butir 10, 2026-11-23)**; skrip,
   pembuatan tabel peta, dan penulisan ulang data tetap di luar repo.

8. **Keputusan pemilik produk 2026-11-22 atas bagian 6b, 6c, dan 6d** (semua mengikuti rekomendasi perancang kecuali masa
   pantau):
   (a) **6b, tempat dan gladi:** skrip dijalankan dari mesin pemilik (checkout lokal) lewat terowongan SSH, tanpa perubahan
   infrastruktur; SATU gladi di staging WAJIB sebelum jendela produksi, dan durasi nyatanya dipakai menentukan panjang
   jendela (pindah ke VPS hanya bila durasi terukur terlalu panjang). Alasan: tanpa perubahan infrastruktur dan
   memberi angka nyata, bukan tebakan.
   (b) **6c, cadangan dan jalan pulang:** dump baru WAJIB tepat setelah `qc-app` berhenti dan sebelum `--apply`. Prosedur
   "pulihkan cadangan" = pulihkan dump ke skema BARU lewat `backup/restore.ts`, lalu arahkan `DATABASE_URL` aplikasi ke
   skema itu (restore.ts tidak dapat dan tidak diubah untuk menimpa `qc_production`). Kriteria: `--revert` bila skrip
   berjalan sampai verifikasi dan hanya verifikasi yang gagal (peta utuh); pulihkan cadangan bila skrip mati di tengah
   dan tak dapat dilanjutkan, `--revert` sendiri gagal verifikasi, atau aplikasi sempat menulis ke DB di antara `--apply`
   dan pemulihan. Prosedur pulih ini dicoba pada gladi staging. Alasan: jalur pulih nyata tanpa melonggarkan pagar
   `restore.ts`.
   (c) **6d, urutan dan masa pantau:** urutan `qc_dev` (gladi pertama), staging (gladi nyata), lalu produksi. Tahap 2
   (`BINARY(16)`) hanya dimulai bila SEMUA lingkungan yang dimigrasikan lolos verifikasi, masa pantau di produksi
   SATU MINGGU selesai tanpa masalah (pemilik memilih satu minggu, bukan dua minggu yang direkomendasikan), dan tak ada
   kode yang masih mengharapkan ID berbentuk UUID.

9. **Verifikasi jumlah baris per tabel sumber dilonggarkan menjadi "tidak lebih banyak dari peta"** (diusulkan perancang,
   disetujui pemilik produk 2026-11-22, menutup bagian 6e butir 2). Alasan: tanpa pelonggaran, `--revert` setelah aplikasi
   menghapus permanen satu baris (mis. `files`) selalu gagal verifikasi walau datanya utuh; penghapusan selama jendela
   tetap tertangkap pemeriksaan terhadap garis dasar. Bagian 4 butir 6 sudah diselaraskan.

10. **Lapisan terjemahan ID lama sementara di server MASUK repo** (keputusan pemilik produk 2026-11-23, menutup bagian 5
    butir 1 dengan pilihan (b); membalik sebagian butir 7: "kode lain yang hanya melayani migrasi itu tidak masuk repo").
    Alasan pemilik: klien (antrean offline Serah Terima, draf Serial Number web dan desktop, `pending.db`, berkas `.qcsn`,
    bookmark, tab yang terbuka) membawa ID lama; pemilik tidak mau bergantung pada disiplin 9 pengguna mengosongkan state
    sebelum jendela. Lapisan menerjemahkan ID lama yang dikirim klien ke ID baru lewat tabel peta `id_ulid_map` sebelum
    validasi dan izin, sehingga semua state klien tetap berfungsi. Rancangan dan batasnya di bagian 4a. Lapisan bersifat
    SEMENTARA: dicabut lewat PR setelah masa pantau satu minggu dan sapu akhir (bagian 4a, "Pencabutan"). Yang tetap di luar
    repo: skrip migrasi, pembuatan dan pengisian tabel `id_ulid_map`, serta penulisan ulang data. Prosedur jendela butir 3
    (pengosongan antrean dan draf) kini disarankan, bukan wajib.

## 2. Yang TIDAK diubah (sengaja)

| Hal | Alasan |
|---|---|
| `client_id` (kunci idempoten klien: `serials`, `serial_events`, `handovers`, `handover_comments`, `sticker_stock_entries`) | Bukan ID baris. Antrean offline di perangkat pengguna masih membawa nilainya; mengubahnya membuat kiriman ulang menggandakan data. Pembuat `clientId` di web/desktop tetap UUID dan validatornya (`HANDOVER_CLIENT_ID`, `STOCK_CLIENT_ID`) tetap UUID huruf kecil. Dikecualikan dengan nama kolom di skrip (`EXCLUDED_COLUMNS`), bukan hanya karena nilainya tak ada di peta: di produksi `serials.client_id` berbentuk UUID. |
| `crypto.randomUUID()` untuk nilai yang harus tak tertebak | Request id, batas multipart Drive (`core/google/drive.ts`), nama berkas sementara foto bukti dan berkas `.partial` (`serial/proof/store.ts`; validatornya `NAME_PATTERN` dan terpisah dari ID baris). ULID hanya 80 bit acak dan awalannya membuka waktu pembuatan. |
| ID eksternal (`drive_id`, `*_drive_id`, id folder Google) | Bukan ID kita; skrip menulis ulang berdasarkan NILAI yang ada di peta, jadi tak pernah menyentuhnya. |
| ID bukan UUID (`qr_defaults.id = 'default'`) | Tidak berpola UUID: tak masuk peta. |
| Token UUID di teks yang tidak ada di peta (mis. teks tautan Markdown di `items.detail_md`) | Hanya token yang ada di peta diganti. |

## 3. Penyimpangan dari prinsip yang ada (disetujui pemilik 2026-11-22)

- Skrip operator meng-UPDATE riwayat yang secara prinsip hanya bertambah: `serial_events.id`/`serial_id`/`data_json`,
  `audit_log.target_id`/`before`/`after`. Isi kejadian (waktu, pelaku, pesan) tidak diubah; hanya ID di dalamnya. Skrip ada di
  luar repo (bagian 1 butir 7), jadi tes statis `events-append-only.test.ts` (yang hanya memindai `server/src`) tak
  menyentuhnya.
- Kriteria penerimaan lama "ID = UUID" (`CLAUDE.md`, komentar kontrak) tidak berlaku untuk ID baris; tetap berlaku untuk
  `clientId`.

## 4. Cara kerja skrip dan jaminannya

Skrip operator lokal (di luar repo, bagian 1 butir 7); rinci di header skripnya. Ringkasnya, berurutan:

1. **Peta global** `id_ulid_map` (dibuat skrip sendiri, tanpa migrasi di repo): satu baris per baris berPK tunggal `id`
   bertipe VARCHAR dan berpola UUID. Waktu ULID = `created_at` baris itu, jadi urutan kronologis data lama terjaga.
2. **Garis dasar invarian** (jumlah baris tiap tabel, yatim kunci asing, jumlah baris yang merujuk entitas per kolom)
   dihitung SEBELUM penulisan pertama dan disimpan di tabel `settings` pada kunci `ID_ULID_BASELINE:<arah>`
   (`forward`/`revert`), supaya run lanjutan setelah terputus tetap membandingkan dengan keadaan sebelum penulisan
   pertama, bukan keadaan setengah jalan. Kunci itu dihapus setelah verifikasi lolos.
3. **Penulisan ulang berbasis NILAI** di setiap kolom `VARCHAR(>=36)` (tanpa daftar kolom yang dipelihara tangan; kolom
   `client_id` dikecualikan dengan nama).
4. **Penulisan ulang per token** hanya untuk token berpola UUID yang ADA di peta, pada (a) kolom teks panjang (JSON audit,
   `data_json`, penugasan pengguna, Markdown) dan (b) kolom VARCHAR GABUNGAN yang menyisipkan ID di dalam teks lain,
   mis. `audit_log.target` (`postel:<id>`, `serial:<id>`), yang tak pernah cocok pada langkah 3 karena nilainya bukan ID
   persis. Pembaruan teks dikirim berbatch: satu `UPDATE ... CASE` per potongan (paling banyak 200 baris dan 1 MB;
   tabel berkunci utama gabungan diperbarui per baris), bukan satu pernyataan per baris, agar tidak terkena latensi
   per-baris lewat terowongan.
5. **Hash isi QR dihitung ulang** (bagian 1 butir 6; setelah penulisan ulang
   kolom dan sebelum verifikasi; dilewati bila tabel QR tak ada). Satu transaksi, stateless, idempoten, dua arah.
   Bentuk "sebelum" isi label dibangun dengan memetakan balik ID lewat peta berlawanan arah; bentuk "sesudah" = data
   sekarang. Versi Manual Book: bila `qrContentHash(snapshot bentuk-sebelum)` (dicoba dengan `linkSource` `url` dan `pdf`,
   karena snapshot tak memuatnya) sama dengan `content_hash` tersimpan, kolom itu diganti hash bentuk-sesudah; tak cocok =
   dibiarkan (sudah tak konsisten sejak sebelum migrasi). Desain terekspor (juga yang terhapus lunak): sama dengan hash
   bentuk-sebelum isi sekarang = diganti hash bentuk-sesudah (desain `current` tetap `current`); selain itu sama dengan
   `content_hash` LAMA sebuah versi desain itu = diganti `content_hash` BARU versi itu (desain yang diedit setelah ekspor
   tetap `stale`, pembanding ekspornya benar); selain itu dibiarkan. Penurunan isi label memakai salinan lokal fungsi murni
   aplikasi (bagian 1 butir 7); skrip TIDAK mengimpor kode ekspor, tugas, atau Drive. UPDATE
   hanya kolom hash dengan penjaga nilai lama, tanpa menyentuh `updated_at`. Dry-run melaporkan perkiraan
   `qrHashesRehashed` (desain dan versi); `--apply` melaporkan jumlah yang benar-benar berubah.
6. **Verifikasi** (gagal = kode keluar 1, aplikasi jangan dinyalakan): tak ada ID lama tersisa di kolom mana pun, baik nilai
   persis maupun token; jumlah baris, yatim FK, dan baris yang merujuk entitas sama dengan garis dasar; hitungan status QR
   (desain `current`/`stale`/tanpa ekspor, versi konsisten/tak konsisten, dan desain yang hash versi TERBARUNYA sama dengan hash isi sekarang, yaitu syarat "tak perlu versi baru" pada ekspor) sama dengan garis dasar (bidang opsional
   garis dasar; dihitung dari bentuk ID mana pun, jadi harus sama sebelum dan sesudah); jumlah baris per
   tabel sumber TIDAK LEBIH BANYAK dari jumlah baris peta untuk tabel itu; selisih kurang (baris yang dihapus permanen
   aplikasi setelah migrasi) dilaporkan sebagai `terhapusSejakMigrasi`, bukan kegagalan. Penghapusan SAAT jendela migrasi
   tetap tertangkap pemeriksaan jumlah baris terhadap garis dasar. (Aturan lama "sama dengan" diganti; disetujui pemilik
   2026-11-22, bagian 1 butir 9.)

Batch kecil (`--batch`, bawaan 2000, tiap batch satu transaksi), idempoten, dapat dilanjutkan (baris yang sudah ditulis
ulang tak lagi cocok), dan punya jalan pulang `--revert` memakai peta yang sama. Dry-run adalah bawaan (hanya `SELECT`);
menulis butuh `--apply --confirm-database <skema> --aplikasi-berhenti`. Opsi `onProgress` pada `runMigration` hanya
dipakai tes untuk menyela di tengah jalan (menguji kelanjutan); tidak ada flag CLI-nya.

**Skrip TIDAK ada di repo maupun image Docker** (bagian 1 butir 7). Ia disimpan lokal di checkout milik pemilik dan dijalankan
dari mesin yang punya akses ke DB target, dengan `DATABASE_URL` yang ditetapkan untuk sesi itu (mis. lewat terowongan SSH);
bukan di dalam kontainer `qc-app`. Tempat menjalankan: mesin pemilik lewat terowongan SSH (bagian 1 butir 8a).

Fakta produksi (diukur read-only 2026-11-22, `qc_production`, MariaDB 11.8.9): `serials` sekitar 208 ribu baris,
`serial_events` 220 ribu, `serial_business_units` 208 ribu; database sekitar 538 MB (data 236 MB, indeks 301 MB) sedangkan
`innodb_buffer_pool_size` 128 MB. 207.953 dari 208.037 serial ber-ID UUID v5 (hasil migrasi data lama), 84 ber-ID UUID v4.
Hanya 6 kunci asing nyata; sekitar 77 kolom `*_id` lain tidak dijaga kunci asing, sebab itu penulisan ulang berbasis nilai dan
verifikasi jumlah rujukan per kolom adalah jaring pengaman utama.

### 4a. Lapisan terjemahan ID lama di server (keputusan 2026-11-23, bagian 1 butir 10)

Kode: `server/src/core/legacy-ids.ts` (tes `legacy-ids.test.ts`), dipasang SATU kali di kernel REST (`server/src/http/rest.ts`,
`innerHandlerFor`) tepat setelah `fromRequestParts` merakit input (parameter jalur, query, dan badan) dan sebelum `execute`
(validasi, izin berlokasi, handler). Satu titik pasang menutup semua rute, juga yang dipakai antrean offline, `sync-sw.js`,
proksi desktop, dan impor `.qcsn`, tanpa mengubah modul mana pun.

- **Apa yang diterjemahkan:** setiap nilai STRING (rekursif pada objek dan larik biasa, kedalaman paling banyak 20; byte dan
  Blob dilewati) yang PERSIS berpola UUID huruf kecil (`LEGACY_UUID_PATTERN`) dan ada di `id_ulid_map.old_id` diganti
  `new_id`. Kunci bernama `clientId` dilewati (kunci idempoten klien, bukan ID baris). ID yang tak ada di peta dibiarkan.
- **Yang tidak diterjemahkan (batas yang diterima):** token UUID di dalam teks bebas (mis. Markdown); ID yang sudah ditulis
  klien ke teks bebas sebelum pencabutan disapu oleh skrip yang sama (idempoten) pada sapu akhir. Token tautan laporan publik
  bertanda tangan (`serial_cases` kosong di produksi, jadi tak ada tautan beredar; bagian 5 butir 2). `Last-Event-ID` aliran
  notifikasi desktop (kosmetik, bagian 5 butir 1 baris 5).
- **Keadaan peta:** tabel dibuat dan diisi skrip operator, bukan migrasi. Lapisan mendeteksinya sendiri: tabel tak ada =
  tanpa pekerjaan; status dicek ulang paling sering tiap 30 detik. Tanpa variabel `.env` baru.
- **Arah:** lapisan hanya aktif bila data berada di keadaan SESUDAH migrasi (ID baru). Setelah `--revert` data kembali ke UUID
  tetapi peta masih ada, dan menerjemahkan UUID ke ULID yang sudah tak ada akan merusak semuanya. Karena itu lapisan menguji
  arah sebelum bekerja: sampel baris peta pada tabel stabil (`users`, `locations`, `business_units`, `roles`, `brands`,
  `sticker_types`) diperiksa; aktif hanya bila `new_id` ditemukan dan `old_id` tidak; selain itu mati.
- **Keamanan dan keandalan:** terjemahan terjadi SEBELUM validasi dan izin berlokasi, jadi hak akses dinilai atas record hasil
  terjemahan seperti permintaan biasa; peta tak pernah dikirim ke klien; paling banyak 2.000 kandidat unik per permintaan
  (dicari per 500; sisanya dibiarkan, jadi akan "tidak ditemukan" seperti ID asing); galat basis data TIDAK ditelan
  (`UNAVAILABLE` seperti rute lain), kecuali "tabel tak ada" yang berarti tak ada pekerjaan.
- **Pencabutan:** setelah masa pantau satu minggu dan sebelum tahap 2: (1) jalankan ulang skrip migrasi sekali sebagai sapu akhir
  (menulis ulang sisa ID lama yang masuk lewat teks bebas), (2) `DROP TABLE id_ulid_map` (lapisan otomatis tanpa pekerjaan),
  (3) PR yang menghapus `legacy-ids.ts`, pemasangannya, dan butir 10 ini menjadi catatan sejarah.

### Prosedur jendela pemeliharaan (rencana; belum dijalankan di mana pun)

1. Deploy image yang memuat `newId()` (tanpa migrasi baru; aplikasi tetap hidup; ID baru sudah ULID, ID lama masih UUID).
2. Pastikan cadangan harian terbaru ada (`BACKUP_FOLDER_ID`) dan periksa ruang disk VPS (`OPTIMIZE` butuh sekitar 2x tabel).
3. Umumkan jendela pemeliharaan dan minta pengguna melakukan tindakan pra-migrasi berikut. Sejak keputusan 2026-11-23
   (lapisan terjemahan, bagian 4a) ini DISARANKAN, bukan wajib: state klien ber-ID lama diterjemahkan server. Tetap baik
   dilakukan bila mudah, sebagai jaring pengaman (rincian state di risiko 1):
   - Web (Serah Terima): buka aplikasi dalam keadaan online dan tunggu antrean offline terkirim (chip antrean kosong);
     entri yang masih tersisa di antrean hilang saat dikirim ke server yang ID-nya sudah berubah.
   - Web (Serial Number): simpan semua draf tabel; draf BERFOTO bukti sebaiknya disimpan dulu (foto draf di server ikut
     ditulis ulang, tetapi draf di peramban membawa ID lama sehingga Simpan menolak fotonya) atau dibuang dan dibuat ulang
     setelah jendela. Tutup tab yang terbuka atau muat ulang setelah jendela.
   - Desktop: buka aplikasi online, unggah atau kosongkan `pending.db` (entri pending) dan draf `draft.db`, dan pastikan
     tidak ada peristiwa Multi yang tertahan (biarkan UI meng-ack peristiwa `injected` sebelum jendela).
   - Jangan mengimpor berkas `.qcsn` yang diekspor sebelum jendela (membawa ID item/BU/lokasi/stiker lama); ekspor ulang
     setelah jendela.
4. Hentikan `qc-app`. Jalankan dry-run, lalu `--apply --confirm-database qc_production --aplikasi-berhenti` (dari checkout,
   bukan dari dalam kontainer; lihat bagian 4). Dump baru wajib tepat sebelum `--apply` (bagian 1 butir 8b).
5. Verifikasi lolos → nyalakan aplikasi, periksa `/api/ping` dan beberapa halaman, serta pastikan tak ada konfigurasi QR
   berlogo yang berstatus `stale` palsu dan tak ada ekspor ulang yang perlu dilakukan (hash dihitung ulang oleh skrip, bagian 4 butir 5). Gagal → `--revert` atau pulihkan
   cadangan ke skema baru (kriteria memilih: bagian 1 butir 8b).
6. Setelah masa pantau: lanjut tahap 2; tabel `id_ulid_map` dibuang manual (`DROP TABLE id_ulid_map`) setelah tahap 2 selesai
   (`--revert` bergantung padanya, jadi jangan dibuang lebih awal).
   Tahap 2 hanya dimulai bila SEMUA lingkungan yang akan dimigrasikan sudah lolos verifikasi dan masa pantau produksi satu
   minggu selesai (bagian 1 butir 8c).

## 5. Risiko dan pertanyaan terbuka (menunggu keputusan pemilik)

1. **State di sisi klien menyimpan ID lama** dan menjadi tidak valid setelah migrasi. Tiap butir di bawah sudah dicocokkan
   ke kodenya (2026-11-22); kolom "Pulih sendiri?" memisahkan yang aman dari yang menimbulkan kehilangan atau galat.
   Pilihan penanganan: (a) prosedur pemeliharaan (kosongkan antrean dan draf dulu, langkah 3 prosedur di atas) atau
   (b) lapisan terjemahan sementara di server yang memakai `id_ulid_map`. Rekomendasi perancang: (a) untuk tahap ini;
   (b) hanya bila ada draf desktop yang tak bisa dikosongkan. **DITUTUP 2026-11-23: pemilik produk memilih (b), lapisan
   terjemahan ID sementara di server** (bagian 1 butir 10; rancangan di bagian 4a). Kolom "Pulih sendiri?" di bawah menggambarkan
   keadaan TANPA lapisan; dengan lapisan, butir 4 sampai 10 diterjemahkan di server saat dikirim, dengan batas yang
   tercantum di bagian 4a.

   | # | State klien (kode) | Pulih sendiri? | Akibat bila tak dibereskan |
   |---|---|---|---|
   | 1 | Pilihan lokasi aktif web: `localStorage` `qc.locations` (`ACTIVE_LOCATIONS_STORAGE_KEY`, `modules/location/active-locations*.ts`) | Ya | `normalizeSelection` membuang ID yang tak ada dan kembali ke SEMUA lokasi bila tak ada yang tersisa; pilihan filter lokasi hilang, tanpa galat |
   | 2 | Target inject desktop: `localStorage` `qc.countrylock.target` (`buId`, `locationId`; `use-inject-target.ts`) | Sebagian | ID lama tak ada di katalog baru: nilai efektif dikosongkan (nilai tersimpan tidak dibuang, hanya diabaikan sampai pilihan diubah); BU/Lokasi harus dipilih ulang (inject mewajibkan semua field), satu lokasi aktif terisi sendiri |
   | 3 | Cache query web: `localStorage` `qc.cache.v3` (`app/query-persist.ts`) | Ya | Dipulihkan saat boot lalu dimuat ulang dari server; data berID lama hanya tampil sekejap |
   | 4 | Antrean offline Serah Terima: IndexedDB `qc-device` toko `outbox` (`handover/lib/outbox.ts`), termasuk kunci lama `localStorage` `qc.outbox:<email>` yang dimigrasikan ke toko itu saat boot; entri membawa `taskId` dan `locationId` | **Tidak** | Entri yang belum terkirim ditolak server, dibuang tanpa diulang, dan diumumkan sebagai ditolak. Centang HILANG; komentar dan task baru masih bisa disalin lewat tombol "Salin teks". Entri `NOT_FOUND` memakai teks tetap "Task sudah dihapus" (menyesatkan di kasus ini). Papan/detail di `qc-device` (`board-persist.ts`) ditimpa muat ulang |
   | 5 | `Last-Event-ID` aliran notifikasi desktop (`<createdAt>\|<id>`; hanya di memori proses utama, `notify/notification-stream.ts`) | Ya (kosmetik) | Sambung ulang membaca notifikasi dengan `created_at >= since` dan hanya menyaring ID lama: notifikasi terakhir yang sudah dikirim dapat terkirim SEKALI lagi dengan ID baru (popup ganda); tidak ada yang hilang |
   | 6 | `pending.db` desktop (berkas TERPISAH dari `draft.db`; menyimpan `bu_id`, `location_id`, `item_id`) | **Tidak** | Dimigrasikan ke draft saat draft dimuat (`pending-migration.ts`) dengan ID lama apa adanya (hanya entri tanpa ID yang ditandai `unresolved`): baris ditolak saat Simpan ("Item tidak ditemukan atau tidak bisa dipakai", "Lokasi tidak ditemukan"). Label (Tipe, BU, lokasi) ikut terbawa sehingga operator dapat memilih ulang, tetapi serial yang tak dibereskan sebelum jendela merepotkan |
   | 7 | Tabel `multi_injected` di `draft.db` (peristiwa `injected` Multi: `itemId`, `buId`, `locationId`, ditahan sampai UI meng-ack; `store/multi-event-store.ts`) | **Tidak** | Peristiwa yang masih tertahan menjadi baris draft ber-ID lama, sama dengan butir 6 |
   | 8 | Draf tabel Serial Number: `localStorage` `qc.serial.draft:<email>` (web) dan snapshot `draft.db` (desktop): `itemId`, `buId`, `locationId`, dan pilihan stiker eksplisit | **Tidak** | `serials.saveBatch` menolak baris ("Item tidak ditemukan atau tidak bisa dipakai", "Lokasi tidak ditemukan", "Stiker tidak berlaku bagi item ini"); data baris tetap utuh dan perlu dipilih ulang satu per satu |
   | 9 | Foto bukti di draf (`proofPhotos: ProofPhotoRef[]` dalam draf butir 8; `serial/lib/draft-store.ts`) | **Tidak** | Baris `serial_proof_photos` berstatus `draft` di server ikut ditulis ulang, tetapi draf membawa ID lama: Simpan menolak dengan "Foto sudah kedaluwarsa, unggah ulang" dan thumbnail tak termuat; foto perlu diunggah ulang. Foto `draft` yang tak disimpan disapu server setelah 7 hari (`draftSweepDays`), jadi draf berfoto yang lebih tua dari itu sudah tak bisa disimpan walau tanpa migrasi |
   | 10 | Berkas `.qcsn` yang sudah diekspor ke disk pengguna (`shared/serial-file.ts`: `itemId`, `buId`, `locationId`, `stickerId`) | **Tidak** | Mengimpornya setelah migrasi menghasilkan baris ber-ID lama yang ditolak saat Simpan (galat jelas, bukan kerusakan data diam-diam); jangan diimpor, ekspor ulang |
   | 11 | Cache katalog desktop `userData/catalog/files/<id>` (`catalog/catalog-store.ts`, `catalog-sync.ts`) | Ya | ETag katalog berubah sehingga potret penuh diunduh ulang; ID berkas yang berubah berarti SEMUA gambar diunduh ulang sekali. Berkas lama TIDAK menumpuk: `store.prune` dipanggil setelah tiap sinkron sukses dan membuang berkas yang tak dirujuk potret baru. (Dugaan awal "tidak pernah dipangkas" sudah diperiksa dan keliru.) |
   | 12 | Tab web yang tetap terbuka melewati jendela (state dalam memori, toast notifikasi) | Tidak (muat ulang) | Daftar lonceng kembali dengan ID baru, sehingga notifikasi belum dibaca dianggap "baru" dan memunculkan toast (digabung bila > 3, `notification/toast.ts`); aksi pada ID lama gagal `NOT_FOUND`. Minta pengguna memuat ulang tab setelah jendela |
2. Token tautan laporan publik (`/laporan/<token>`) memuat `caseId` bertanda tangan: tautan yang sudah terkirim lewat surel
   menjadi 404 setelah migrasi. Saat diukur, `serial_cases` kosong di produksi (tak ada tautan yang beredar); periksa ulang
   sebelum menjalankan.
3. Bookmark `/serial/<id>` dan sejenisnya menjadi 404 (ID berubah). Hal yang sama berlaku untuk tautan yang SUDAH
   terkirim atau tampil: surel peringatan masa berlaku Postel yang memuat `APP_ORIGIN/postel/<id>`
   (`server/src/modules/postel/digest.ts`), serta notifikasi push dan popup OS yang sudah tampil (tujuan klik `/handover/<id>?loc=<id lokasi>`
   atau `/serial/<id>`, `shared/notifications.ts`). Tidak ada yang hilang di basis data; hanya tautannya yang mengarah ke halaman tak ditemukan. Surel
   peringatan berikutnya memuat ID baru, jadi masalahnya terbatas pada pesan yang sudah beredar.
4. Produksi berada di migrasi 0026 sedangkan `dev` sudah sampai 0030+: skrip menemukan skema secara dinamis (kolom seperti
   `audit_log.target_id` dan `deleted_at` hanya ikut diproses bila ada), tetapi deploy 0027–0030 harus lebih dulu.
5. `id_ulid_map` dibuat skrip, bukan migrasi, tetapi tetap ikut dump cadangan; `backup/restore.ts` membandingkan hasil pulih
   dengan skema sumber dan tidak memakai daftar tabel dari migrasi, jadi tabel itu tidak menghalangi pemulihan.
6. Rehearsal pada salinan produksi (cadangan dipulihkan ke skema baru) sangat disarankan sebelum hari-H; perlu persetujuan
   pemilik karena memuat data produksi.

## 6. Menunggu keputusan pemilik

Semua butir bagian ini (6a sampai 6e) sudah ditutup 2026-11-22 (lihat masing-masing dan bagian 1 butir 6, 8, dan 9). Di luar
bagian ini masih terbuka penanganan state klien (bagian 5 butir 1). Rekomendasi perancang hanyalah usulan; belum diputuskan dan tidak
boleh dikerjakan sebagai keputusan sebelum pemilik produk menjawab.
Setelah dijawab, keputusan dicatat di bagian 1 (dengan tanggal absolut dan penyetujunya) dan butir yang bersangkutan di
sini ditutup.

### 6a. Hash isi QR memuat ID file logo (DITUTUP 2026-11-22)

**Keputusan pemilik produk 2026-11-22: opsi 1, skrip menghitung ulang hash, dengan syarat TANPA ekspor ulang** (dicatat di
bagian 1 butir 6).

Latar: `qrContentHash` (`shared/qrcode.ts`) memasukkan `logoFileId` (dan teks label) ke dalam hash isi. Penulisan ulang ID
file membuat `qr_designs.exported_hash` dan `manual_book_versions.content_hash` (`0008_manual_book_4a.sql`) tidak lagi sama
dengan hash yang dihitung dari konten sekarang; tanpa penanganan, SEMUA konfigurasi QR berlogo menjadi `stale`
(`qrExportStatus`) dan ekspor berikutnya melahirkan versi Manual Book baru (stiker versi lama `deprecated`/`inactive`,
stok terbelah, alasan ekspor ulang wajib). Konfigurasi tanpa logo tidak terpengaruh.

Yang dikerjakan: langkah baru di skrip migrasi (bagian 4 butir 5) menghitung ulang kedua kolom hash, dua arah (maju dan
`--revert`), stateless dan idempoten, memakai salinan lokal penurun isi label murni aplikasi. Syarat pemilik: langkah ini
hanya mengganti nilai dua kolom hash; tidak mengekspor, tidak membuat versi atau stiker, tidak mengubah stok, tidak
membuat tugas, tidak memanggil Drive, dan tidak mengubah `updated_at`, `exported_*`, atau status konfigurasi. Opsi yang
tidak dipilih: (2) mengeluarkan `logoFileId` dari hash (mengubah semantik dan semua hash, tetap perlu penghitungan ulang),
(3) menerima dampaknya dan mengekspor ulang manual (versi Manual Book ganda dan stok terbelah).

Pengujian (tes lokal skrip, di luar repo): status ekspor menurut jalur aplikasi (`findQrDesign`,
`qrDesignContent`, `qrExportStatus`) sama sebelum dan sesudah migrasi; hash versi sama dengan hash snapshot baru; desain yang
diedit setelah ekspor tetap `stale` dengan pembanding yang cocok versi; hash yang memang tak konsisten sebelum migrasi tak
disentuh; `--revert` mengembalikan semua hash dan kolom lain persis; dijalankan ulang tak mengubah apa pun; kolom lain dan
jumlah baris tabel stiker, stok, tugas, dan berkas tak berubah; verifikasi gagal bila hitungan status berbeda.

### 6b. Tempat menjalankan skrip dan kewajiban gladi (DITUTUP 2026-11-22)

**Keputusan pemilik produk 2026-11-22: opsi 1 (mesin pemilik lewat terowongan SSH) dengan satu gladi wajib di staging** (bagian 1 butir 8a).

Skrip tidak ada di repo maupun image (bagian 1 butir 7), jadi tempat menjalankannya harus dipilih.

| Opsi | Konsekuensi |
|---|---|
| 1. Dari mesin pengembang tempat skrip lokal berada, lewat terowongan SSH | Tanpa perubahan infrastruktur. Setiap kueri membawa latensi terowongan (itu sebabnya hitungan digabung per tahap dan pembaruan teks berbatch); durasi lebih panjang dan bergantung koneksi pengembang selama jendela |
| 2. Di VPS dekat DB (checkout + Bun di VPS) | Tercepat dan stabil terhadap putusnya koneksi; butuh Bun dan checkout di VPS, yang tidak diwajibkan oleh `docs/deploy-vps.md` sekarang |
| 3. Kontainer sekali pakai dari image yang sama | TIDAK tersedia sejak keputusan bagian 1 butir 7: skrip tak ada di repo sehingga tak dapat ikut image |

Gladi: apakah rehearsal pada salinan produksi (cadangan dipulihkan ke skema baru lewat `backup/restore.ts`) WAJIB sebelum
hari-H. Perlu persetujuan karena memuat data produksi. Rekomendasi perancang: opsi 1 untuk tahap ini (paling kecil
perubahannya), dengan satu gladi wajib yang juga mengukur durasi nyata untuk menentukan panjang jendela; pindah ke
opsi 2 bila durasi terukur terlalu panjang. (Keputusan: sesuai rekomendasi.)

### 6c. Cadangan segar, pemulihan produksi, dan kriteria pulang (DITUTUP 2026-11-22)

**Keputusan pemilik produk 2026-11-22: dump baru wajib, pulih ke skema baru lalu arahkan aplikasi, kriteria `--revert`/pulihkan seperti usulan** (bagian 1 butir 8b).

1. **Dump baru** tepat setelah aplikasi berhenti dan sebelum `--apply` (cadangan harian bisa berumur hampir sehari dan
   tak memuat penulisan terakhir). Opsi: `mariadb-dump` manual dari kontainer `qc-db` ke `qc-backups`, atau
   mengandalkan cadangan harian terbaru (kehilangan data hingga sehari bila perlu pulih).
2. **Prosedur "pulihkan cadangan" yang benar-benar mengganti DB produksi.** `backup/restore.ts` hanya memulihkan ke
   skema BARU atau kosong dan menolak skema aplikasi yang sedang dipakai, jadi ia tidak dapat menimpa `qc_production`.
   Opsi: (i) pulihkan ke skema baru lalu arahkan `DATABASE_URL` aplikasi ke skema itu; (ii) kosongkan `qc_production` lalu
   impor dump secara manual (menyimpang dari pagar `restore.ts`); (iii) tidak menyediakan jalur ini dan hanya
   mengandalkan `--revert`. Prosedur terpilih harus ditulis dan dicoba pada gladi.
3. **Kapan `--revert`, kapan pulihkan cadangan.** Usulan: `--revert` bila skrip berjalan sampai verifikasi dan hanya
   verifikasi yang gagal (peta utuh); pulihkan cadangan bila skrip mati di tengah dengan keadaan yang tak bisa dilanjutkan,
   `--revert` sendiri gagal verifikasi, atau aplikasi sempat menulis ke DB di antara `--apply` dan pemulihan.

Rekomendasi perancang: dump baru wajib (butir 1), jalur (i) untuk butir 2, kriteria butir 3 seperti usulan.
(Keputusan: sesuai rekomendasi.)

### 6d. Urutan lingkungan dan syarat tahap 2 (DITUTUP 2026-11-22)

**Keputusan pemilik produk 2026-11-22: urutan dev, staging, produksi; masa pantau produksi SATU MINGGU sebelum tahap 2** (bagian 1 butir 8c).

Usulan urutan: (1) `qc_dev` lewat `bun run db:seed` (gladi pertama; tes skrip sudah berjalan di skema sementara), (2)
staging `qc-dev.rhd.my.id` sebagai gladi nyata pada data staging, (3) produksi. Syarat memulai tahap 2 (`BINARY(16)`):
SEMUA lingkungan yang dimigrasikan sudah lolos verifikasi, masa pantau di produksi selesai, dan tak ada kode yang masih
mengharapkan ID berbentuk UUID. Lamanya masa pantau: satu minggu (diputuskan).

### 6e. Dua perilaku yang ditambahkan perancang di luar teks keputusan (DITUTUP 2026-11-22)

1. **Nama unduhan memakai 8 karakter akhir ID** (bagian 1 butir 5). Teknisnya benar dan murah, tetapi menambah perilaku
   di luar keputusan pemilik "ganti ke ULID". Rekomendasi perancang: setujui. Alternatif: tetap 8 karakter awal dan
   menerima nama kembar untuk unggahan dalam selang sekitar satu detik (nama hanya kosmetik karena berkas dipetakan lewat
   ID, bukan nama). **Disetujui pemilik produk 2026-11-22** (bagian 1 butir 5).
2. **Verifikasi `jumlah baris sumber = peta` dilonggarkan menjadi `tidak lebih banyak dari peta`** (bagian 4 butir 6).
   Tanpa pelonggaran, `--revert` setelah aplikasi menghapus permanen satu baris (mis. `files`) selalu gagal verifikasi
   walau datanya utuh; dengan pelonggaran, selisih kurang dilaporkan di `terhapusSejakMigrasi` dan penghapusan SAAT
   jendela migrasi tetap tertangkap pemeriksaan jumlah baris terhadap garis dasar. Rekomendasi perancang: setujui
   pelonggaran. Alternatif: pertahankan "sama dengan" dan tangani selisih secara manual. **Disetujui pemilik produk 2026-11-22**
   (bagian 1 butir 9).

Keputusan sudah dicatat di bagian 1 (butir 5 dan 9) dan bagian 4 butir 6 diselaraskan.

### Butir yang sudah ditutup oleh pemeriksaan kode

Dugaan "cache katalog desktop tidak pernah dipangkas sehingga berkas lama menumpuk" TIDAK benar: `catalog-sync.ts`
memanggil `store.prune` setelah tiap sinkron sukses (risiko 1, butir 11). Tidak ada perubahan desktop yang perlu
diputuskan untuk hal ini.
