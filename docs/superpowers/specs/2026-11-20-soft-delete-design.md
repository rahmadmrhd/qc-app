# Soft Delete untuk Semua Model

Tanggal: 2026-11-20. Status: disetujui pemilik produk (2026-11-20), dengan keputusan lanjutan §2 butir 6-15 dan jawaban perancang §5 (termasuk putaran audit 2026-11-20, butir 11-21).
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
5. Menghapus data master **tidak** menghapus data yang merujuknya (contoh pemilik: menghapus Tipe A tidak menghapus serial bertipe A). Pengecualian: lokasi terhapus berperilaku seperti lokasi nonaktif (butir 9).

Keputusan lanjutan pemilik (2026-11-20, atas inventaris fase 4 redesain; rancangan redesain keputusan 13-16):

6. **Gambar Pustaka stiker dikecualikan**: tetap hapus permanen dan tetap ditolak bila masih dipakai, tanpa Pulihkan (tabel `sticker_guide_images` tidak ber-`deleted_at`).
7. **Stiker `deprecated` boleh langsung dihapus** (syarat hapus stiker = bukan Aktif).
8. **Serah Terima** dihapus/dipulihkan per task (tanpa rute batch); task terhapus terlihat lewat filter "Terhapus" di papan.

Keputusan lanjutan pemilik (2026-11-20, atas audit spek; dijawab dan disetujui pemilik produk):

9. **BU dan lokasi terhapus.** BU terhapus TETAP memberi hak seperti BU nonaktif hari ini (item/serial milik BU itu tetap dapat dibuka dan diubah); ia hanya hilang dari semua pilihan dan filter, dan syarat tulis "level pada SEMUA BU item" MENGABAIKAN BU terhapus. Lokasi terhapus berperilaku sama dengan lokasi nonaktif hari ini (task/izin berlokasi di lokasi itu tak terbaca); ini pengecualian eksplisit terhadap butir 5 untuk lokasi. Alasan: menghapus master tidak boleh memutus akses ke data yang masih hidup (butir 5), sedangkan lokasi sudah punya semantik nonaktif yang jelas.
10. **Email pengguna terhapus TIDAK dipakai ulang.** `users_email` tetap unik penuh (tidak mendapat `_live`); untuk memakai email itu lagi, pulihkan akun lama. Alasan: akun baru tidak boleh mewarisi jejak akun lama dan audit tidak ambigu.
11. **Migrasi contract (buang indeks unik lama) dalam PR yang SAMA** dengan redesain, bukan rilis berikutnya. Ini pengecualian sadar terhadap aturan expand → contract proyek (CLAUDE.md "Migrasi", `docs/ci-cd.md`): setelah rilis, rollback image ke sebelum soft delete TIDAK aman; bila deploy gagal, perbaiki ke depan, jangan rollback (seperti pengecualian 0002/0003/0010/0017). Migrasi berpenanda `-- qc:contract`. Alasan: nama/kode record terhapus dapat dipakai ulang sejak rilis pertama.
12. **Hapus/Pulihkan Serial Number** butuh `serial: manage` pada SEMUA BU dalam riwayat BU serial itu (`serial_business_units`), bukan hanya BU saat ini.
13. **Memulihkan Desain QR/Postel juga memulihkan stikernya**: stiker versi terbaru milik record itu yang menjadi `deprecated`/`inactive` karena penghapusan kembali `inactive` (dapat diaktifkan lagi). Postel baru bernama sama ditolak selama Postel lama ada di Terhapus (nama stiker lama masih memegang `stickers_type_name_unique`); pesan menyarankan memulihkan yang lama bagi pemegang izin Pulihkan.
14. **Gambar Pustaka**: pemakaian oleh item TERHAPUS diabaikan; gambar boleh dihapus bila hanya dipakai item terhapus. Penempatan (`item_sticker_photos` + `item_sticker_marks`) milik item terhapus yang merujuk gambar itu ikut dihapus permanen dalam transaksi yang sama (FK RESTRICT); item itu kehilangan penempatan tersebut bila kelak dipulihkan. Gambar yang dipakai item hidup tetap ditolak. Alasan: item terhapus tidak boleh menahan penghapusan gambar selamanya.
15. **Default disetujui**: (a) Hapus/Pulihkan Postel = `sticker: edit`; (b) penerima surel (stok, Postel, Serial rusak) adalah alamat bebas, tetap menerima sampai admin mengubah, walau penggunanya dihapus; (c) nama customer di Serah Terima menaut ke View customer hanya bagi `item: view` (izin tak diubah); (d) Role boleh dihapus bila tak dipakai PENGGUNA HIDUP.

## 3. Sasaran, bukan sasaran, anti-sasaran

**Sasaran**: kolom `deleted_at` + penyaringan di semua jalur baca, aksi Hapus/Pulihkan (tunggal dan batch) dengan audit, tampilan "Terhapus" per modul, keunikan yang menghormati penghapusan, rujukan ke record terhapus tetap tampil.

**Bukan sasaran**: penghapusan permanen (purge) dan retensi otomatis; mengubah arti Nonaktif; menghapus data turunan (riwayat, event, stok, komentar) secara terpisah.

**Anti-sasaran**: record terhapus yang masih muncul di daftar, pilihan `LinkField`, filter, katalog desktop, surel, notifikasi, atau perhitungan (mis. stok menipis); record terhapus yang masih memberi HAK (role, pengguna, lokasi; BU terhapus sengaja tetap memberi hak seperti BU nonaktif, butir 9); dua record hidup dengan kunci unik yang sama; data rujukan yang ikut hilang atau rusak tampilannya.

## 4. Rancangan

### 4.1 Kolom dan keunikan

- Tiap tabel model mendapat `deleted_at VARCHAR(30) NOT NULL DEFAULT ''` (ISO UTC lewat `nowIso`; `''` = hidup) dan `deleted_by VARCHAR(254) NOT NULL DEFAULT ''` (email pelaku). Sengaja BUKAN `NULL`: di MariaDB `NULL` dalam indeks unik dianggap selalu berbeda, sehingga `UNIQUE (key, deleted_at)` dengan `NULL` tidak menjaga apa pun di antara record hidup. Dua record berkunci sama yang dihapus pada waktu yang sama bentrok pada `UNIQUE (key, deleted_at)`: tes yang menghapus dua record berkunci sama menggeser jam (`env.clock`).
- Setiap indeks unik yang bermakna bisnis diganti dengan versi berakhiran `deleted_at`: `roles_name_unique`, `locations_code_unique`, `locations_name_unique`, `business_units_code_unique`, `business_units_name_unique`, `brands_key`, `customers_key`, `items_key`, `sticker_types_name_unique`, `sticker_types_kind_unique`, `stickers_type_name_unique`, `qr_presets_bu_unique`, `postel_numbers_key`, `postels_sticker`, `serials_serial` (kunci unik se-sistem, sudah dibangun di `dev` lewat PR 134 dan dibuat bersyarat oleh `ensureSerialUniqueIndex`; padanan `_live` dibuat di fungsi yang sama; pada versi contract fungsi itu hanya membuat `serials_serial_live (serial, deleted_at)`, menghitung ganda lewat `GROUP BY serial, deleted_at`, dan membuang `serials_serial` lama bila ada), `handovers_number`. Koreksi perancang 2026-11-20: `serial_cases_number` dikeluarkan dari daftar karena laporan rusak tidak terhapus sendiri (ikut serialnya, §5 butir 10), jadi nomornya tak pernah perlu dipakai ulang; `serials_bu_serial` lama tidak mendapat padanan `_live` dan dibuang oleh `ensureSerialUniqueIndex` hanya SETELAH `serials_serial_live` berhasil dibuat (keputusan perancang 2026-11-20: selama ada serial ganda lintas BU, indeks lama tetap menjaga keunikan per BU). `users_email` TETAP unik penuh dan tidak mendapat `_live` (keputusan 10). Indeks teknis (`*_client_id`, `*_seq`, `manual_book_versions_design_version`) tidak diubah.
- Kunci alias item (`item_alias_keys`) dan kunci pencarian lain yang berupa tabel terpisah mengikuti record induknya: dibuang dari pencocokan saat induk terhapus dan dipulihkan bersamanya dengan rincian (§5 butir 14): hapus item membuang baris aliasnya; pulihkan membangun ulang setelah memeriksa tabrakan secara aplikasi terhadap `items.key` dan alias item hidup (gagal = `CONFLICT` generik); ganti nama merk memperbarui `items.key` item terhapus juga; `assertItemNamesFree`/`aliasCollides` mengabaikan item terhapus. Anak lain yang keunikannya ikut induk (mis. `postel_numbers`) memakai helper `softDeleteWithChildren` (§5 butir 15).
- **Expand → contract dalam SATU PR** (keputusan 11): migrasi pertama MENAMBAH kolom dan indeks unik baru di samping indeks lama (expand); migrasi terakhir PR yang sama (berpenanda `-- qc:contract`, task penutup fase 4d) membuang indeks lama. Akibatnya nama/kode record terhapus dapat dipakai ulang sejak rilis ini. Ini pengecualian sadar terhadap aturan expand → contract proyek: setelah rilis, rollback image ke sebelum soft delete TIDAK aman (§5 butir 7). `mapDuplicateError` di tiap modul dipetakan ke nama indeks `_live`; kode memakai helper nama dasar (buang akhiran `_live`) untuk `RETRYABLE_UNIQUE_KEYS` (`server/src/core/cas.ts`) dan semua pembanding `error.key === '<indeks>'`, dan tes menegaskan setiap nama indeks yang disebut kode ada di skema (§5 butir 13).

### 4.2 Penyaringan baca

- Semua jalur baca (daftar, `get`, opsi/pilihan, pencarian, filter, hitungan, katalog desktop, digest surel, notifikasi, penjadwal, ekspor, laporan publik) menyaring `deleted_at = ''`, KECUALI:
  - penampil rujukan (lihat 4.4),
  - tampilan "Terhapus" dan rute `get` dengan `includeDeleted` milik pemegang izin Pulihkan,
  - Log Audit.
- Penyaringan dipusatkan: satu helper SQL per tabel (mis. `liveSql('items', alias)`) dan tes penjaga yang memindai SQL repo agar setiap `FROM`/`JOIN` ke tabel ber-soft-delete memakai helper itu atau tercantum di daftar pengecualian bernama. Tes ini wajib hijau sebelum modul dianggap selesai.
- `get` record terhapus oleh pengguna tanpa izin Pulihkan = `NOT_FOUND` (sama dengan record di luar hak).
- **Hak dan akses**: role terhapus tidak memberi izin apa pun; pengguna terhapus tidak dapat masuk dan sesinya ditolak seperti akun nonaktif; lokasi terhapus berperilaku seperti lokasi nonaktif hari ini (izin/task berlokasi di sana tak terbaca; pengecualian atas keputusan 5); BU terhapus TETAP memberi hak seperti BU nonaktif hari ini (item/serial BU itu tetap dapat dibuka dan diubah), hanya hilang dari semua pilihan dan filter, dan syarat tulis "level pada SEMUA BU item" mengabaikan BU terhapus (keputusan 9).

### 4.3 Aturan hapus

| Model | Syarat sebelum hapus | Catatan |
|---|---|---|
| Item, Merk, Customer, Stiker, Jenis Stiker, Pengguna, Lokasi, Business Unit | Sudah **Nonaktif** (Stiker: bukan Aktif, jadi `deprecated` boleh langsung; keputusan 7) | Model berstatus = model besar pengaruh (keputusan 2) |
| Role | Tidak dipakai PENGGUNA HIDUP mana pun (penjaga "Role masih dipakai oleh N user" yang ada dipertahankan; pengguna terhapus tidak menghalangi, keputusan 15d) | Role tak punya status |
| Desain QR (Manual Book), Preset QR, Postel | Tidak ada syarat status | Desain QR yang sudah punya versi Manual Book kini BOLEH dihapus (penolakan hari ini dicabut karena jejaknya tetap tersimpan). Stiker milik Desain QR/Postel yang dihapus menjadi `deprecated` (bila stok > 0) atau `inactive`, seperti hapus Postel hari ini; memulihkan record itu mengembalikan stiker versi terbarunya menjadi `inactive` (keputusan 13). Berkas Drive (PDF ekspor, PNG, PDF sumber) TIDAK dibuang/dicabut berbaginya agar pemulihan utuh; penyapu yatim (`cleanupQrDocuments`, dll.) menganggap pemilik terhapus sebagai pemilik sah. |
| Gambar Pustaka stiker | Tidak dipakai penempatan item HIDUP mana pun (pemakaian oleh item terhapus diabaikan, keputusan 14) | DIKECUALIKAN dari soft delete (keputusan 6): hapus permanen, tanpa Pulihkan; penempatan milik item terhapus yang merujuk gambar itu ikut dihapus permanen dalam transaksi yang sama (keputusan 14) |
| Serial Number | Tidak ada syarat status (status Serial adalah alur, bukan aktif/nonaktif) | Stok stiker yang sudah dipotong TIDAK dikembalikan (stiker sudah terpasang fisik); laporan rusak aktif milik serial itu ikut tak tampil, tidak ditutup |
| Serah Terima | Tidak ada syarat status; berbeda dari Batalkan | Antrean notifikasi tunggu task itu dibuang seperti saat `done`. Hanya tunggal (keputusan 8) |

- Izin Hapus dan Pulihkan = level **`manage`** modul itu (modul ber-BU: pada SEMUA BU record; Serial Number: pada SEMUA BU dalam riwayat BU serial itu (`serial_business_units`), bukan hanya BU saat ini, keputusan 12; modul berlokasi: pada lokasi record), kecuali modul yang hari ini sudah menghapus dengan izin lain yang mempertahankan aturannya: pustaka gambar (pengunggah atau `item: manage`) dan Postel (`sticker: edit`, keputusan 15a).
- Rute: `<model>.remove` (tunggal, menggantikan `DELETE` permanen yang ada; jalur dan verba boleh tetap) dan `<model>.removeBatch`, `<model>.restore`, `<model>.restoreBatch`, mengikuti kontrak batch atomik di rancangan redesain §6.9 (semua atau tidak sama sekali, idempoten: menghapus yang sudah terhapus = sukses tanpa audit; `NOT_FOUND` hanya untuk id tak dikenal atau di luar hak). Bentuk masukan: `IdBatchInput { ids }`, `StatusBatchInput { ids, status }`, dan `VersionedBatchInput { items: { id, updatedAt }[] }` (hanya untuk model yang rute tunggalnya CAS).
- Audit: `<model>.delete` dan `<model>.restore` per record.
- **Perilaku hapus hari ini yang DICABUT** (§5 butir 21): Desain QR: penolakan bila sudah ber-versi, pelepasan item (`manual_book_design_id` dikosongkan), dan trash/pencabutan berbagi berkas ekspor; Postel: pelepasan item (`postel_id`), penghapusan nomor, dan pembuangan lampiran. Tes lama yang menegaskan perilaku itu diubah mengikuti spek ini.

### 4.4 Rujukan ke record terhapus (keputusan 5)

- Tidak ada penghapusan berantai: serial, task, stok, item, instruksi, riwayat, dan data lain yang merujuk record terhapus tetap ada dan tetap dapat dibuka/diubah.
- Tampilan rujukan menampilkan nama record terhapus dengan penanda "Terhapus" (badge `secondary`), dan tautannya ke View hanya bagi pemegang izin Pulihkan.
- `LinkField` tidak menawarkan record terhapus untuk pilihan baru; nilai yang sudah tersimpan tetap tampil (sebagai chip bertanda "Terhapus") dan dipertahankan saat form disimpan tanpa diubah: SERVER menerima id yang TIDAK berubah dari nilai tersimpan walau record itu terhapus (atau nonaktif); id baru harus hidup (dan aktif bila aturan kini menuntut). Berlaku untuk merk/BU item, penempatan stiker, item/lokasi serial, dan role/lokasi/BU penugasan pengguna (§5 butir 11). Mengganti nilai itu dengan record hidup boleh; memilih record terhapus lagi tidak.
- Aturan turunan yang menghitung dari record hidup (mis. `stickersForType` aturan BU/`group`, menipis, katalog desktop, filter BU item) mengabaikan record terhapus sebagaimana record nonaktif diabaikan hari ini, atau lebih ketat.

### 4.5 Pulihkan

- Tampilan "Terhapus" di halaman daftar tiap modul (pilihan di filter Status: Aktif / Nonaktif / Terhapus), hanya bagi pemegang izin Pulihkan; berisi kolom Dihapus oleh dan Dihapus pada, aksi Pulihkan (tunggal dan massal).
- Record dipulihkan dalam keadaan **Nonaktif** (untuk model berstatus) sehingga pemulihan tidak langsung memengaruhi pilihan/hak; pengguna mengaktifkannya sendiri.
- Pemulihan ditolak (`CONFLICT`, pesan generik) bila kunci uniknya kini dipakai record hidup lain. Pulihkan semua model memanggil penjaga keunikan aplikasi yang SAMA dengan simpan (nama Manual Book, alias item, serial saat indeks belum terpasang, dll.), bukan hanya mengandalkan indeks (§5 butir 14). Memulihkan Desain QR/Postel juga memulihkan stikernya (keputusan 13).
- View record terhapus (untuk pemegang izin) menampilkan banner `destructive` "Data ini sudah dihapus" + tombol Pulihkan.

### 4.6 Urutan pengerjaan

Infrastruktur (kolom, indeks baru, helper `liveSql`, tes penjaga, pola rute remove/restore, komponen UI "Terhapus") dibangun sebagai fase tersendiri sebelum fase 3 redesain. Lalu setiap modul mendapat soft delete-nya dalam fase redesain yang sama dengan View dan batch-nya (fase 3: Item, Merk; 4a: Stiker, Jenis; 4b: QR, Preset, Postel; 4c: Akses, Customer; 4d: Serial, Serah Terima). Migrasi contract (hapus indeks lama) dibuat satu kali sebagai task penutup fase 4d, dalam PR yang sama (keputusan 11); tidak ada rilis terpisah.

## 5. Jawaban atas review pembangun (keputusan perancang, 2026-11-20)

Diputuskan perancang dari keputusan pemilik (§2) tanpa pertanyaan tambahan; pemilik dapat mengoreksinya saat menyetujui.

**Prinsip umum: tampilan memakai record terhapus, perhitungan bisnis tidak.** Record terhapus tetap tampil di tempat ia dirujuk (nama + penanda "Terhapus"), tetapi setiap aturan, hitungan, keunikan, pilihan, hak, dan proses latar memperlakukannya seolah tidak ada.

1. **Relasi "paling banyak satu" (Item↔Desain QR Manual Book, Item↔Postel).** Hapus tidak mengubah kolom rujukan di item (`items.manual_book_design_id`, `items.postel_id`). Karena prinsip umum, item yang rujukannya terhapus dihitung "Belum ada QR Manual Book"/"Belum ada Postel" (label, filter, katalog, aturan `group`), dan item itu boleh dipasang ke Desain QR/Postel lain (yang menimpa rujukan lama). Saat dipulihkan, item yang masih menunjuk ke record itu otomatis kembali terhubung; item yang sudah dipasang ke record lain tidak ikut. Nama Postel turunan dan klaim item dihitung dari item hidup dengan rujukan ke record hidup.
2. **Penjaga "sedang dipakai"** tidak dipakai untuk soft delete (keputusan 5: rujukan tetap utuh), KECUALI Role (butir 7) dan gambar Pustaka (keputusan pemilik 6, tetap hapus permanen). Dialog konfirmasi hapus menampilkan jumlah pemakaian bila ada (mis. "Dipakai 12 item"), dihitung dari record HIDUP saja (butir 16). FK `ON DELETE RESTRICT`/`SET NULL`/`CASCADE` yang ada tetap di skema tetapi tidak terpicu karena baris tidak dihapus.
3. **Pulihkan anak saat induknya terhapus** (Item dengan Merk terhapus, Stiker dengan Jenis terhapus, Pengguna dengan lokasi/BU terhapus): diizinkan; induk tetap tampil "Terhapus". Item/stiker itu tidak dapat diaktifkan selama induknya terhapus bila aturan aktivasi yang ada mensyaratkan induk aktif; selain itu bebas.
4. **Jenis sistem** (`manual_book`, `postel`) tidak dapat dihapus (selalu aktif, tak memenuhi syarat Nonaktif). **Stiker sistem** tidak punya aksi Hapus sendiri; ia mengikuti induknya (Desain QR/Postel), sesuai §4.3.
5. **Serial Number** mendapat soft delete di fase 4d, SETELAH rancangan "Serial unik se-sistem" (2026-11-18) dibangun; indeks unik serial dibuat untuk bentuk se-sistem + `deleted_at`. Serial yang dicatat ulang setelah dihapus adalah record BARU (id, riwayat, laporan, foto terpisah); memulihkan yang lama ditolak selama serial yang sama hidup.
6. **Penjaga keunikan di kode** (`assertManualBookNameFree`, `assertManualBookStickerNameFree`, `brandKeyGuardStmt`, `item_alias_keys`, kunci customer saat task disimpan, pengadopsian jenis Postel, dll.) WAJIB mengabaikan record terhapus; tes penjaga §4.2 mencakupnya. Nomor sertifikat milik Postel terhapus boleh dipakai lagi (tabel nomor ikut ber-`deleted_at` lewat helper `softDeleteWithChildren`, butir 15, sehingga `postel_numbers_key_live` membebaskan nomor). Nama historis stiker Manual Book tetap dihormati selama stikernya sendiri hidup.
7. **Rollback image lama TIDAK aman setelah rilis** (diubah 2026-11-20 oleh keputusan pemilik 11). Migrasi contract (buang indeks unik lama) ada di PR yang sama dengan redesain, jadi image sebelum soft delete (yang tidak mengenal `deleted_at`) di atas skema baru melihat record terhapus muncul kembali dan dapat melihat dua record berkunci sama (satu terhapus, satu hidup). Bila deploy gagal, perbaiki ke depan, jangan rollback image (seperti pengecualian 0002/0003/0010/0017). Migrasi contract berpenanda `-- qc:contract`, sehingga pagar downgrade skema (`schema_guard`) tak pernah melewatinya. Aturan produk (model berstatus wajib Nonaktif, Role hanya bila tak dipakai) tetap berlaku tetapi tidak lagi dipakai sebagai alasan rollback aman. Pengecualian dicatat di `docs/ci-cd.md`. Semua fase dirilis dalam satu PR (keputusan pemilik 2026-11-20, rancangan redesain keputusan 12).
8. **Pengguna terhapus**: aksesnya berakhir sama seperti akun nonaktif hari ini (sesi cookie dan token Bearer desktop ditolak saat dipakai, aliran SSE ditutup, langganan push tidak dikirimi). Email-nya TIDAK boleh dipakai akun baru: `users_email` tetap unik penuh; untuk memakai email itu lagi, pulihkan akun lama (keputusan pemilik 10; menggantikan rumusan awal "boleh dipakai akun baru"). Super admin dan akun sendiri tidak dapat dihapus, sama dengan aturan nonaktif.
9. **Turunan data** (lihat prinsip umum): `hasInstructions`, stok menipis/habis, ringkasan surel, penerima peringatan, katalog desktop, nama Postel turunan, dan aturan `stickersForType` dihitung dari record hidup saja.
10. **Cakupan**: yang punya Hapus/Pulihkan hanya model di tabel §4.3. Anak (nomor Postel, versi Manual Book, event serial, laporan rusak, komentar dan butir Serah Terima, penempatan stiker, kunci alias) ikut induknya dan tidak punya hapus sendiri; perilaku hapus anak yang ada hari ini tetap (mis. menghapus nomor Postel Lama tetap permanen sebagai bagian dari mengubah Postel). Pustaka logo QR (`qr_defaults`) tidak berubah. Gambar Pustaka stiker tidak termasuk soft delete (keputusan pemilik 6).

Putaran audit 2026-11-20 (keputusan perancang, dalam batas keputusan pemilik butir 9-15; pemilik dapat mengoreksi):

11. **Rujukan tersimpan dipertahankan (T1)**: server menerima id yang tidak berubah dari nilai tersimpan walau record itu terhapus/nonaktif (aturan di §4.4); id baru harus hidup. Tiap rencana fase menambah tesnya untuk model yang disentuhnya.
12. **Hapus ulang dan bentuk masukan (T2)**: hapus ulang record terhapus = sukses tanpa audit baru (`deleted_at` asli tidak tertimpa); `NOT_FOUND` hanya untuk id tak dikenal atau di luar hak. Masukan batch: `IdBatchInput`, `StatusBatchInput`, `VersionedBatchInput` (§4.3).
13. **Nama indeks di kode (T3)**: `RETRYABLE_UNIQUE_KEYS` dan semua pembanding `error.key === '<indeks>'` memakai helper nama dasar; tes menegaskan nama indeks yang disebut kode ada di skema. Karena contract dalam PR yang sama, `ensureSerialUniqueIndex` versi contract hanya membuat `serials_serial_live (serial, deleted_at)`, menghitung ganda lewat `GROUP BY serial, deleted_at`, dan membuang `serials_serial` lama bila ada.
14. **Alias dan pulihkan (T4)**: `item_alias_keys` (PK `key`): hapus item membuang baris aliasnya; pulihkan membangun ulang setelah memeriksa tabrakan terhadap `items.key` dan alias item hidup (gagal = `CONFLICT` generik); ganti nama merk memperbarui `items.key` item terhapus juga; `assertItemNamesFree`/`aliasCollides` mengabaikan item terhapus. Pulihkan semua model memanggil penjaga keunikan aplikasi yang sama dengan simpan.
15. **Anak dan tes penjaga (T5)**: `postel_numbers` dan anak lain dengan keunikan ikut induk lewat helper `softDeleteWithChildren`. Tes penjaga §4.2: aturan per alias tabel (literal yang menyebut `deleted_at` untuk alias lain tidak meloloskan tabel itu); daftar tabel anak → induk (`serial_cases`, `serial_events`, `serial_proof_photos`, `serial_stickers`, `item_business_units`, `item_sticker_photos`, `item_sticker_marks`, `manual_book_versions`, `handover_comments`, `notifications`): JOIN ke anak wajib disertai JOIN/saring ke induk atau tercantum di daftar tunggu. `UPDATE`/`DELETE`/`EXISTS` di luar cakupan pemindai dijaga tes perilaku.
16. **Hitungan (T6)**: `brands.item_count` = item HIDUP, disesuaikan dalam `batch()` hapus/pulihkan item; hitungan pemakaian di dialog konfirmasi hapus = record hidup.
17. **Draft, antrean, katalog luring (T7)**: `serials.saveBatch` menolak dengan pesan per baris (indeks baris + "Item/Lokasi/BU sudah dihapus"); katalog desktop membuang entri terhapus setelah sinkron berikutnya (diterima).
18. **Kiriman ulang ber-`clientId` (T8)** untuk record yang sudah terhapus = `NOT_FOUND` (antrean memperlakukannya rejected).
19. **Stiker terhapus di Cek ulang (T9)**: ditolak di `recheck` (`stickerIds`) seperti `inactive`.
20. **Waktu dan privasi (T10)**: `deleted_at` = ISO UTC (`nowIso`), `deleted_by` = email. Risiko diterima: data pengguna terhapus tetap tersimpan (purge bukan sasaran, §3).
21. **Perilaku hapus yang dicabut (T24)**: daftar lengkap di §4.3 (QR: tolak bila ber-versi, lepas item, trash ekspor; Postel: lepas item, hapus nomor, buang lampiran).

## 6. Diserahkan kepada pembangun

- Bentuk helper SQL dan cara tes penjaga mengenali query.
- (Sudah diputuskan 2026-11-20 dan tidak lagi diserahkan: cara kunci alias mengikuti induknya, §4.1 dan §5 butir 14; format `deleted_at`/`deleted_by`, §4.1.)
- Pesan galat persis, dalam aturan pesan generik yang ada.
