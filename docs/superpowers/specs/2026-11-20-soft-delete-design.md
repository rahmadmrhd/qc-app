# Soft Delete untuk Semua Model

Tanggal: 2026-11-20. Status: rancangan, menunggu persetujuan pemilik produk.
Terkait: [Redesain tampilan](2026-11-20-redesain-tampilan-design.md) (aksi Hapus, Pulihkan, dan rute batch hapus memakai fitur ini).

## 1. Maksud dan alasan

Hari ini model master (Item, Merk, Customer, Stiker, Jenis Stiker, Pengguna, Lokasi, Business Unit) hanya dapat dinonaktifkan, sedangkan Role, Postel, Desain QR, Preset QR, dan gambar Pustaka dihapus permanen (`DELETE FROM`). Akibatnya: daftar "Nonaktif" menumpuk dengan record yang sebenarnya sudah tidak dipakai, dan penghapusan yang ada menghilangkan jejaknya.

Pemilik produk (2026-11-20) memutuskan **semua model memakai soft delete**: Hapus dan Nonaktif berbeda arti.
- **Nonaktif**: record tetap ada di daftar (filter "Nonaktif"), tidak dapat dipilih untuk data baru, dapat diaktifkan lagi.
- **Hapus**: record hilang dari daftar, pilihan, dan pencarian, tetapi barisnya tetap tersimpan, dapat **dipulihkan**, dan data yang merujuknya tetap utuh.

## 2. Keputusan pemilik (2026-11-20)

1. Semua model memakai soft delete; penghapusan tetap menyimpan record.
2. Model yang besar pengaruhnya wajib **dinonaktifkan dulu** sebelum dapat dihapus.
3. Record terhapus **dapat dipulihkan**.
4. Kolom unik diubah menyertakan `deleted_at` (contoh pemilik: `UNIQUE (serial, deleted_at)`), sehingga nilai record terhapus dapat dipakai lagi oleh record baru.
5. Menghapus data master **tidak** menghapus data yang merujuknya (contoh pemilik: menghapus Tipe A tidak menghapus serial bertipe A).

## 3. Sasaran, bukan sasaran, anti-sasaran

**Sasaran**: kolom `deleted_at` + penyaringan di semua jalur baca, aksi Hapus/Pulihkan (tunggal dan batch) dengan audit, tampilan "Terhapus" per modul, keunikan yang menghormati penghapusan, rujukan ke record terhapus tetap tampil.

**Bukan sasaran**: penghapusan permanen (purge) dan retensi otomatis; mengubah arti Nonaktif; menghapus data turunan (riwayat, event, stok, komentar) secara terpisah.

**Anti-sasaran**: record terhapus yang masih muncul di daftar, pilihan `LinkField`, filter, katalog desktop, surel, notifikasi, atau perhitungan (mis. stok menipis); record terhapus yang masih memberi HAK (role, penugasan); dua record hidup dengan kunci unik yang sama; data rujukan yang ikut hilang atau rusak tampilannya.

## 4. Rancangan

### 4.1 Kolom dan keunikan

- Tiap tabel model mendapat `deleted_at VARCHAR(30) NOT NULL DEFAULT ''` (ISO WIB/UTC sesuai kolom waktu lain di tabel itu; `''` = hidup) dan `deleted_by VARCHAR(...) NOT NULL DEFAULT ''`. Sengaja BUKAN `NULL`: di MariaDB `NULL` dalam indeks unik dianggap selalu berbeda, sehingga `UNIQUE (key, deleted_at)` dengan `NULL` tidak menjaga apa pun di antara record hidup.
- Setiap indeks unik yang bermakna bisnis diganti dengan versi berakhiran `deleted_at`: `users_email`, `roles_name_unique`, `locations_code_unique`, `locations_name_unique`, `business_units_code_unique`, `business_units_name_unique`, `brands_key`, `customers_key`, `items_key`, `sticker_types_name_unique`, `sticker_types_kind_unique`, `stickers_type_name_unique`, `qr_presets_bu_unique`, `postel_numbers_key`, `postels_sticker`, `serials_bu_serial` (atau kunci unik se-sistem bila rancangan "Serial unik se-sistem" 2026-11-18 lebih dulu dibangun), `handovers_number`, `serial_cases_number`. Indeks teknis (`*_client_id`, `*_seq`, `manual_book_versions_design_version`) tidak diubah.
- Kunci alias item (`item_alias_keys`) dan kunci pencarian lain yang berupa tabel terpisah mengikuti record induknya: dibuang dari pencocokan saat induk terhapus dan dipulihkan bersamanya (cara persisnya diserahkan ke pembangun, asalkan alias record terhapus tidak memblokir nama baru).
- **Expand → contract**: rilis pertama MENAMBAH kolom dan indeks unik baru di samping indeks lama (expand-only; image lama tetap jalan karena semua baris `deleted_at = ''`). Indeks lama dihapus di rilis berikutnya lewat migrasi berpenanda `-- qc:contract`. Akibatnya, memakai ulang nama/kode record terhapus baru mungkin setelah rilis contract; sebelum itu bentrok unik ditolak seperti sekarang. `mapDuplicateError` di tiap modul dipetakan ke nama indeks baru (dan lama, selama masa transisi).

### 4.2 Penyaringan baca

- Semua jalur baca (daftar, `get`, opsi/pilihan, pencarian, filter, hitungan, katalog desktop, digest surel, notifikasi, penjadwal, ekspor, laporan publik) menyaring `deleted_at = ''`, KECUALI:
  - penampil rujukan (lihat 4.4),
  - tampilan "Terhapus" dan rute `get` dengan `includeDeleted` milik pemegang izin Pulihkan,
  - Log Audit.
- Penyaringan dipusatkan: satu helper SQL per tabel (mis. `liveSql('items', alias)`) dan tes penjaga yang memindai SQL repo agar setiap `FROM`/`JOIN` ke tabel ber-soft-delete memakai helper itu atau tercantum di daftar pengecualian bernama. Tes ini wajib hijau sebelum modul dianggap selesai.
- `get` record terhapus oleh pengguna tanpa izin Pulihkan = `NOT_FOUND` (sama dengan record di luar hak).
- **Hak dan akses**: role terhapus tidak memberi izin apa pun; pengguna terhapus tidak dapat masuk dan sesinya ditolak seperti akun nonaktif; penugasan ke lokasi/BU terhapus diabaikan dalam perhitungan hak.

### 4.3 Aturan hapus

| Model | Syarat sebelum hapus | Catatan |
|---|---|---|
| Item, Merk, Customer, Stiker, Jenis Stiker, Pengguna, Lokasi, Business Unit | Sudah **Nonaktif** | Model berstatus = model besar pengaruh (keputusan 2) |
| Role | Tidak dipakai pengguna mana pun (penjaga "Role masih dipakai oleh N user" yang ada dipertahankan) | Role tak punya status; penjaga ini juga membuat rollback image lama aman (lihat §5 butir 7) |
| Desain QR (Manual Book), Preset QR, Postel, gambar Pustaka | Tidak ada syarat status | Desain QR yang sudah punya versi Manual Book kini BOLEH dihapus (penolakan hari ini dicabut karena jejaknya tetap tersimpan). Stiker milik Desain QR/Postel yang dihapus menjadi `deprecated` (bila stok > 0) atau `inactive`, seperti hapus Postel hari ini. Berkas Drive (PDF ekspor, PNG, PDF sumber) TIDAK dibuang/dicabut berbaginya agar pemulihan utuh; penyapu yatim (`cleanupQrDocuments`, dll.) menganggap pemilik terhapus sebagai pemilik sah. Gambar Pustaka yang dipakai boleh dihapus (lihat §5 butir 2) |
| Serial Number | Tidak ada syarat status (status Serial adalah alur, bukan aktif/nonaktif) | Stok stiker yang sudah dipotong TIDAK dikembalikan (stiker sudah terpasang fisik); laporan rusak aktif milik serial itu ikut tak tampil, tidak ditutup |
| Serah Terima | Tidak ada syarat status; berbeda dari Batalkan | Antrean notifikasi tunggu task itu dibuang seperti saat `done` |

- Izin Hapus dan Pulihkan = level **`manage`** modul itu (modul ber-BU: pada SEMUA BU record; modul berlokasi: pada lokasi record), kecuali modul yang hari ini sudah menghapus dengan izin lain (mis. pustaka gambar: pengunggah atau `item: manage`) yang mempertahankan aturannya.
- Rute: `<model>.remove` (tunggal, menggantikan `DELETE` permanen yang ada; jalur dan verba boleh tetap) dan `<model>.removeBatch`, `<model>.restore`, `<model>.restoreBatch`, mengikuti kontrak batch atomik di rancangan redesain §6.9 (semua atau tidak sama sekali, idempoten: menghapus yang sudah terhapus = bukan galat).
- Audit: `<model>.delete` dan `<model>.restore` per record.

### 4.4 Rujukan ke record terhapus (keputusan 5)

- Tidak ada penghapusan berantai: serial, task, stok, item, instruksi, riwayat, dan data lain yang merujuk record terhapus tetap ada dan tetap dapat dibuka/diubah.
- Tampilan rujukan menampilkan nama record terhapus dengan penanda "Terhapus" (badge `secondary`), dan tautannya ke View hanya bagi pemegang izin Pulihkan.
- `LinkField` tidak menawarkan record terhapus untuk pilihan baru; nilai yang sudah tersimpan tetap tampil (sebagai chip bertanda "Terhapus") dan dipertahankan saat form disimpan tanpa diubah. Mengganti nilai itu dengan record hidup boleh; memilih record terhapus lagi tidak.
- Aturan turunan yang menghitung dari record hidup (mis. `stickersForType` aturan BU/`group`, menipis, katalog desktop, filter BU item) mengabaikan record terhapus sebagaimana record nonaktif diabaikan hari ini, atau lebih ketat.

### 4.5 Pulihkan

- Tampilan "Terhapus" di halaman daftar tiap modul (pilihan di filter Status: Aktif / Nonaktif / Terhapus), hanya bagi pemegang izin Pulihkan; berisi kolom Dihapus oleh dan Dihapus pada, aksi Pulihkan (tunggal dan massal).
- Record dipulihkan dalam keadaan **Nonaktif** (untuk model berstatus) sehingga pemulihan tidak langsung memengaruhi pilihan/hak; pengguna mengaktifkannya sendiri.
- Pemulihan ditolak (`CONFLICT`, pesan generik) bila kunci uniknya kini dipakai record hidup lain.
- View record terhapus (untuk pemegang izin) menampilkan banner `destructive` "Data ini sudah dihapus" + tombol Pulihkan.

### 4.6 Urutan pengerjaan

Infrastruktur (kolom, indeks baru, helper `liveSql`, tes penjaga, pola rute remove/restore, komponen UI "Terhapus") dibangun sebagai fase tersendiri sebelum fase 3 redesain. Lalu setiap modul mendapat soft delete-nya dalam fase redesain yang sama dengan View dan batch-nya (fase 3: Item, Merk; 4a: Stiker, Jenis; 4b: QR, Preset, Postel, Pustaka; 4c: Akses, Customer; 4d: Serial, Serah Terima). Migrasi contract (hapus indeks lama) dibuat satu kali setelah semua modul selesai dan dirilis.

## 5. Jawaban atas review pembangun (keputusan perancang, 2026-11-20)

Diputuskan perancang dari keputusan pemilik (§2) tanpa pertanyaan tambahan; pemilik dapat mengoreksinya saat menyetujui.

**Prinsip umum: tampilan memakai record terhapus, perhitungan bisnis tidak.** Record terhapus tetap tampil di tempat ia dirujuk (nama + penanda "Terhapus"), tetapi setiap aturan, hitungan, keunikan, pilihan, hak, dan proses latar memperlakukannya seolah tidak ada.

1. **Relasi "paling banyak satu" (Item↔Desain QR Manual Book, Item↔Postel).** Hapus tidak mengubah kolom rujukan di item (`items.manual_book_design_id`, `items.postel_id`). Karena prinsip umum, item yang rujukannya terhapus dihitung "Belum ada QR Manual Book"/"Belum ada Postel" (label, filter, katalog, aturan `group`), dan item itu boleh dipasang ke Desain QR/Postel lain (yang menimpa rujukan lama). Saat dipulihkan, item yang masih menunjuk ke record itu otomatis kembali terhubung; item yang sudah dipasang ke record lain tidak ikut. Nama Postel turunan dan klaim item dihitung dari item hidup dengan rujukan ke record hidup.
2. **Penjaga "sedang dipakai"** tidak dipakai untuk soft delete (keputusan 5: rujukan tetap utuh), KECUALI Role (butir 7). Dialog konfirmasi hapus menampilkan jumlah pemakaian bila ada (mis. "Dipakai 12 item"). FK `ON DELETE RESTRICT`/`SET NULL`/`CASCADE` yang ada tetap di skema tetapi tidak terpicu karena baris tidak dihapus.
3. **Pulihkan anak saat induknya terhapus** (Item dengan Merk terhapus, Stiker dengan Jenis terhapus, Pengguna dengan lokasi/BU terhapus): diizinkan; induk tetap tampil "Terhapus". Item/stiker itu tidak dapat diaktifkan selama induknya terhapus bila aturan aktivasi yang ada mensyaratkan induk aktif; selain itu bebas.
4. **Jenis sistem** (`manual_book`, `postel`) tidak dapat dihapus (selalu aktif, tak memenuhi syarat Nonaktif). **Stiker sistem** tidak punya aksi Hapus sendiri; ia mengikuti induknya (Desain QR/Postel), sesuai §4.3.
5. **Serial Number** mendapat soft delete di fase 4d, SETELAH rancangan "Serial unik se-sistem" (2026-11-18) dibangun; indeks unik serial dibuat untuk bentuk se-sistem + `deleted_at`. Serial yang dicatat ulang setelah dihapus adalah record BARU (id, riwayat, laporan, foto terpisah); memulihkan yang lama ditolak selama serial yang sama hidup.
6. **Penjaga keunikan di kode** (`assertManualBookNameFree`, `assertManualBookStickerNameFree`, `brandKeyGuardStmt`, `item_alias_keys`, kunci customer saat task disimpan, pengadopsian jenis Postel, dll.) WAJIB mengabaikan record terhapus; tes penjaga §4.2 mencakupnya. Nomor sertifikat milik Postel terhapus boleh dipakai lagi (`postel_numbers_key` menyertakan `deleted_at` induk lewat kolom turunan atau tabel nomor ikut ber-`deleted_at`; caranya diserahkan ke pembangun). Nama historis stiker Manual Book tetap dihormati selama stikernya sendiri hidup.
7. **Rollback image lama.** Image sebelum soft delete tidak mengenal `deleted_at`, jadi record terhapus muncul kembali bila image di-rollback. Risikonya dibatasi: (a) model berstatus wajib Nonaktif sebelum dihapus, sehingga image lama melihatnya Nonaktif (pengguna terhapus tidak dapat masuk, lokasi/BU/role tak memberi hak baru); (b) Role hanya dapat dihapus bila tak dipakai; (c) sisanya (QR, Preset, Postel, Pustaka, Serial, Serah Terima terhapus tampil lagi) diterima dan dicatat sebagai pengecualian rollback di `docs/ci-cd.md`, seperti pengecualian 5a. Karena semua fase dirilis dalam satu PR (keputusan pemilik 2026-11-20, rancangan redesain keputusan 12), infrastruktur dan aksi Hapus terbit bersama; pembatasan (a)-(c) tetap berlaku, sedangkan migrasi contract (hapus indeks lama) tetap di rilis berikutnya.
8. **Pengguna terhapus**: aksesnya berakhir sama seperti akun nonaktif hari ini (sesi cookie dan token Bearer desktop ditolak saat dipakai, aliran SSE ditutup, langganan push tidak dikirimi). Email-nya boleh dipakai akun baru (id baru; audit lama tetap milik record lama). Super admin dan akun sendiri tidak dapat dihapus, sama dengan aturan nonaktif.
9. **Turunan data** (lihat prinsip umum): `hasInstructions`, stok menipis/habis, ringkasan surel, penerima peringatan, katalog desktop, nama Postel turunan, dan aturan `stickersForType` dihitung dari record hidup saja.
10. **Cakupan**: yang punya Hapus/Pulihkan hanya model di tabel §4.3. Anak (nomor Postel, versi Manual Book, event serial, laporan rusak, komentar dan butir Serah Terima, penempatan stiker, kunci alias) ikut induknya dan tidak punya hapus sendiri; perilaku hapus anak yang ada hari ini tetap (mis. menghapus nomor Postel Lama tetap permanen sebagai bagian dari mengubah Postel). Pustaka logo QR (`qr_defaults`) tidak berubah.

## 6. Diserahkan kepada pembangun

- Bentuk helper SQL dan cara tes penjaga mengenali query.
- Cara kunci alias/kunci pencarian terpisah mengikuti induknya (4.1).
- Panjang kolom `deleted_by` dan apakah `deleted_at` memakai format waktu tabel itu atau ISO seragam.
- Pesan galat persis, dalam aturan pesan generik yang ada.
