// Daftar tunggu tes penjaga soft delete (`soft-delete-guard.test.ts`): kemunculan `FROM`/`JOIN` ke tabel ber-soft-delete
// yang BELUM menyaring record terhapus, termasuk rujukan dinamis (`FROM ${...}`) yang tak dapat diperluas. Kunci = berkas
// relatif akar repo; nilai = `"<tabel>@<urutan kemunculan tabel itu di berkas>#<sidik literal>"` (urutan menghitung semua
// rujukan yang dipindai, tersaring maupun tidak; sidik = isi kueri, jadi mengubah atau menyisipkan kueri membuat entri
// tak cocok). Fragmen FROM tersusun (`HANDOVER_FROM`, `SERIAL_FROM`) diperluas ke tiap kueri pemakainya, jadi entri
// tercatat per pemakai. Dikelompokkan menurut fase redesain yang akan membersihkannya; fase itu WAJIB menghapus entri
// berkasnya setelah menambah penyaring (`${liveWhere('alias')}` di literal kueri; penyaring yang dirakit lewat larik
// `where.push(...)` tak terlihat pemindai, jadi taruh di literal). Entri yang tak lagi cocok membuat tes gagal: "entri basi".
// Kemunculan yang sah tanpa penyaring dicatat di `SOFT_DELETE_EXEMPT` beserta alasannya.

export const SOFT_DELETE_PENDING: Record<string, readonly string[]> = {
  // Modul item/brand membaca tabel milik fase lain (items/brands sendiri sudah disaring di fase 3: lihat EXEMPT):
  // business_units (4c), qr_designs/manual_book_versions/postels (4b), stickers dan turunannya (4a).
  'server/src/modules/item/repo.ts': [
    'item_business_units@1#1236ca45',
    'item_business_units@2#69d917f0',
    'item_business_units@3#f44ff848',
  ],
  'server/src/modules/item/service.ts': ['item_sticker_marks@1#0ea287d8'],
  // Fase 4a (sticker)
  'server/src/modules/sticker/guide-repo.ts': ['users@1#21ba7e4d', 'users@2#efe68088'],
  'server/src/modules/sticker/instruction-service.ts': ['business_units@1#8607d2a9'],
  'server/src/modules/sticker/manual-book.ts': ['manual_book_versions@1#921b68f4'],
  'server/src/modules/sticker/repo.ts': [
    'business_units@1#c2e2358a',
    'business_units@2#2023d3e3',
    'manual_book_versions@1#e7d844e9',
    'manual_book_versions@2#34832c17',
    'manual_book_versions@3#34832c17',
    'manual_book_versions@4#c92928a6',
    'manual_book_versions@5#c92928a6',
    'manual_book_versions@6#37170634',
    'manual_book_versions@7#37170634',
    'manual_book_versions@8#6e617267',
    'manual_book_versions@9#6e617267',
  ],
  // Fase 4b (qrcode, postel)
  // Ekspor Sheets: `files` (pemilik stiker/pustaka fase 4a, QR/postel fase 4b) dan `qr_documents` belum disaring
  // (pemilik `item` sudah, fase 3). Setelah semuanya disaring, pindahkan kuncinya ke SOFT_DELETE_EXEMPT dengan alasan.
  'server/src/modules/jobs/sheets-export.ts': ['*dinamis@1#62151e07'],
  'server/src/modules/qrcode/items.ts': ['stickers@1#1a057869'],
  'server/src/modules/qrcode/repo.ts': [],
  // Fase 4c (access, customer)
  // Fase 4d (serial, handover)
  // Lain-lain (modul yang membaca tabel milik fase lain: notification, desktop catalog, files, digest stok)
  'server/src/modules/files/service.ts': ['item_business_units@1#546f26ad'],
};

/**
 * Kemunculan yang sah tanpa penyaring (mis. penjaga tulis, skrip seed, ekspor yang menyaring secara dinamis), kunci =
 * `"<berkas>#<kunci pemindai>"`, nilai = alasan.
 */
export const SOFT_DELETE_EXEMPT: Record<string, string> = {
  'server/scripts/merge-duplicate-serials.ts#business_units@1#e09896a1':
    'Penampil kode BU pada laporan operator: BU terhapus tetap memberi kode (soft delete 9); skrip hanya membaca untuk tampilan.',
  'server/scripts/merge-duplicate-serials.ts#serial_events@1#f505f433':
    'Skrip operator: anak serial dipindahkan menurut id serial yang baru dipilih HIDUP dan dikunci `FOR UPDATE` di transaksi yang sama (kueri pemilih menyaring `deleted_at`; serial terhapus diabaikan penuh, keputusan pemilik 2026-11-21).',
  'server/scripts/merge-duplicate-serials.ts#serial_stickers@1#762daad2':
    'Skrip operator: anak serial dipindahkan menurut id serial yang baru dipilih HIDUP dan dikunci `FOR UPDATE` di transaksi yang sama (kueri pemilih menyaring `deleted_at`; serial terhapus diabaikan penuh, keputusan pemilik 2026-11-21).',
  'server/scripts/merge-duplicate-serials.ts#serials@3#7bf06089':
    'Skrip operator: anak serial dipindahkan menurut id serial yang baru dipilih HIDUP dan dikunci `FOR UPDATE` di transaksi yang sama (kueri pemilih menyaring `deleted_at`; serial terhapus diabaikan penuh, keputusan pemilik 2026-11-21).',
  'server/scripts/merge-duplicate-serials.ts#business_units@2#71a20bd9':
    'Penampil kode BU pada laporan operator: BU terhapus tetap memberi kode (soft delete 9); skrip hanya membaca untuk tampilan.',
  'server/src/core/cas.ts#*dinamis@1#2d23e851':
    'nameGuardStmt: penjaga TULIS (SELECT ... FOR UPDATE) atas baris merk/customer yang baru dibaca penulis; hapus/pulihkan memakai soft-delete.ts. Tabel dinamis (brands|customers).',
  'server/src/modules/backup/restore.ts#*dinamis@1#4b20ad1c':
    'Pemulihan cadangan: menghitung SEMUA baris tiap tabel di skema pemulihan untuk verifikasi; baris terhapus (soft delete) memang ikut dicadangkan dan harus terhitung.',
  'server/src/core/soft-delete.ts#*dinamis@1#fd86e8cd':
    'versionGuardStmt: penjaga TULIS (SELECT ... FOR UPDATE) atas baris yang baru dibaca perencana hapus/pulihkan; menilai keadaan terhapus lewat parameter `state`, bukan lewat penyaring. Tabel dinamis.',
  'server/src/modules/brand/repo.ts#brands@3#7a248a06':
    'Baca/tulis merk menurut id oleh pemanggil yang menilai `deletedAt` sendiri (hapus, pulihkan, status; rujukan merk item tetap sah walau terhapus).',
  'server/src/modules/brand/repo.ts#brands@5#7a248a06':
    'Baca/tulis merk menurut id oleh pemanggil yang menilai `deletedAt` sendiri (hapus, pulihkan, status; rujukan merk item tetap sah walau terhapus).',
  'server/src/modules/brand/service.ts#brands@3#7a248a06':
    'Baca merk menurut id (hidup atau terhapus) untuk hapus/pulihkan/status; pemanggil menilai `deletedAt`.',
  'server/src/modules/desktop/catalog.ts#brands@1#309d8a43':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/item/repo.ts#items@2#ebd0f806':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#items@6#7dc4cfed':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#brands@1#1b357af7':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#items@9#eab0e51b':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#brands@2#eab0e51b':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/service.ts#brands@1#e236d2d5':
    'JOIN merk untuk nama tampilan/penjaga: item disaring `liveWhere` di kueri yang sama; merk terhapus tetap memberi nama (T1).',
  'server/src/modules/item/service.ts#brands@2#c9e5bc97':
    'JOIN merk untuk nama tampilan/penjaga: item disaring `liveWhere` di kueri yang sama; merk terhapus tetap memberi nama (T1).',
  'server/src/modules/item/service.ts#brands@3#c01510e4':
    'JOIN merk untuk nama tampilan/penjaga: item disaring `liveWhere` di kueri yang sama; merk terhapus tetap memberi nama (T1).',
  'server/src/modules/item/service.ts#brands@4#1d26e0dc':
    'JOIN merk untuk nama tampilan/penjaga: item disaring `liveWhere` di kueri yang sama; merk terhapus tetap memberi nama (T1).',
  'server/src/modules/item/service.ts#brands@5#1d26e0dc':
    'JOIN merk untuk nama tampilan/penjaga: item disaring `liveWhere` di kueri yang sama; merk terhapus tetap memberi nama (T1).',
  'server/src/modules/serial/service.ts#brands@1#4f1cc96e':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/brand/service.ts#items@1#759837a3':
    'Ganti nama merk: mengunci (FOR UPDATE) dan menurunkan ulang `items.key` SEMUA item merk itu, termasuk yang terhapus (T4: kunci item terhapus ikut berubah agar tetap konsisten saat dipulihkan).',
  'server/src/modules/serial/proof/attach.ts#items@1#b355d3af':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/proof/attach.ts#brands@1#b355d3af':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/item/repo.ts#brands@3#66854c46':
    'Penjaga TULIS (SELECT ... FOR UPDATE) atas baris merk yang baru dibaca penulis; menilai `deleted_at` lewat parameter `chosenNow` (merk baru wajib hidup, rujukan tersimpan tetap sah).',
  'server/src/modules/postel/items.ts#brands@1#fbdbcd86':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/postel/items.ts#brands@2#17f8c82a':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/postel/items.ts#items@3#4a02043e':
    'Penampil rujukan: daftar anggota catatan/konfigurasi menampilkan item terhapus bertanda (`deleted`); semua turunan dan hitungan memakai pembaca yang menyaring item hidup.',
  'server/src/modules/postel/items.ts#brands@3#4a02043e':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/postel/items.ts#items@4#8b7dfc72':
    'Penampil rujukan: daftar anggota catatan/konfigurasi menampilkan item terhapus bertanda (`deleted`); semua turunan dan hitungan memakai pembaca yang menyaring item hidup.',
  'server/src/modules/postel/items.ts#brands@4#8b7dfc72':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/postel/items.ts#items@5#02e2a2d0':
    'Baca menurut id: pemanggil menilai `deleted` sendiri (item terhapus hanya sah bila sudah terpasang, rujukan tersimpan T1; pemilihan baru menolaknya).',
  'server/src/modules/postel/items.ts#brands@5#02e2a2d0':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/postel/items.ts#items@6#abf12ed1':
    'Penjaga TULIS klaim item: UPDATE klaim mensyaratkan item aktif dan tidak terhapus (`status`, `deleted_at`) untuk pemasangan baru; yang sudah terpasang tetap dipertahankan (T1).',
  'server/src/modules/postel/items.ts#brands@6#e8d77043':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/qrcode/items.ts#brands@1#7196d9cd':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/qrcode/items.ts#items@2#91289ce5':
    'Penampil rujukan: daftar anggota catatan/konfigurasi menampilkan item terhapus bertanda (`deleted`); semua turunan dan hitungan memakai pembaca yang menyaring item hidup.',
  'server/src/modules/qrcode/items.ts#brands@2#91289ce5':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/qrcode/items.ts#items@3#adbf1807':
    'Baca menurut id: pemanggil menilai `deleted` sendiri (item terhapus hanya sah bila sudah terpasang, rujukan tersimpan T1; pemilihan baru menolaknya).',
  'server/src/modules/qrcode/items.ts#brands@3#adbf1807':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/qrcode/items.ts#items@4#8787746b':
    'Penjaga TULIS klaim item: UPDATE klaim mensyaratkan item aktif dan tidak terhapus (`status`, `deleted_at`) untuk pemasangan baru; yang sudah terpasang tetap dipertahankan (T1).',
  'server/src/modules/qrcode/items.ts#brands@4#b9169b9d':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/access/repo.ts#users@1#1f819367':
    'loadAccessTables memuat SEMUA baris beserta deleted_at/deleted_by: keunikan email dan rujukan tersimpan perlu melihat yang terhapus; daftar, hitungan pemakaian, dan pilihan memilah lewat isLiveRecord.',
  'server/src/modules/access/repo.ts#roles@1#9e3e1828':
    'loadAccessTables memuat SEMUA baris beserta deleted_at/deleted_by: keunikan email dan rujukan tersimpan perlu melihat yang terhapus; daftar, hitungan pemakaian, dan pilihan memilah lewat isLiveRecord.',
  'server/src/modules/access/repo.ts#locations@1#09251e36':
    'loadAccessTables memuat SEMUA baris beserta deleted_at/deleted_by: keunikan email dan rujukan tersimpan perlu melihat yang terhapus; daftar, hitungan pemakaian, dan pilihan memilah lewat isLiveRecord.',
  'server/src/modules/access/repo.ts#business_units@1#9f4fcc3c':
    'loadAccessTables memuat SEMUA baris beserta deleted_at/deleted_by: keunikan email dan rujukan tersimpan perlu melihat yang terhapus; daftar, hitungan pemakaian, dan pilihan memilah lewat isLiveRecord.',
  'server/src/modules/access/repo.ts#business_units@2#9a67ecb7':
    'Ringkasan SEMUA BU termasuk yang terhapus (bertanda `deleted`): BU terhapus tetap memberi nama pada rujukan tersimpan dan tetap memberi hak (keputusan pemilik soft delete 9); pemakai sebagai pilihan/filter menyaring entri `deleted`.',
  'server/src/modules/brand/repo.ts#business_units@2#d9475f00':
    'Penampil rujukan: BU bawaan merk menampilkan kode BU walau BU terhapus; BU terhapus tetap memberi hak dan nama (soft delete 9). Penambahan BU bawaan baru dijaga activeBuGuardStmt dan listBuBriefs (BU terhapus dibaca nonaktif).',
  'server/src/modules/brand/repo.ts#business_units@4#6492887a':
    'Penampil rujukan: BU bawaan merk menampilkan kode BU walau BU terhapus; BU terhapus tetap memberi hak dan nama (soft delete 9). Penambahan BU bawaan baru dijaga activeBuGuardStmt dan listBuBriefs (BU terhapus dibaca nonaktif).',
  'server/src/modules/item/repo.ts#business_units@1#1236ca45':
    'Penampil rujukan: BU item (kode/nama) tampil walau BU terhapus; BU terhapus tetap memberi hak dan nama (soft delete 9), dan syarat tulis "semua BU item" mengabaikannya lewat deletedBuIds.',
  'server/src/modules/customer/repo.ts#customers@4#0305824f':
    'Baca customer menurut id (hidup atau terhapus) untuk perencana ubah status/hapus/pulihkan dan get; pemanggil menilai `deletedAt` sendiri.',
  'server/src/modules/sticker/guide-service.ts#brands@1#45c3a46c':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/item/service.ts#stickers@1#e827a7c8':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/item/service.ts#sticker_types@1#e827a7c8':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/item/service.ts#sticker_types@2#91b309c6':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/item/repo.ts#stickers@1#2e0e05ed':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/sticker/instruction-repo.ts#item_sticker_photos@1#6f472aca':
    'Anak item (foto/penanda instruksi) dimuat menurut id item yang sudah disaring hidup oleh pemanggil (detail item, katalog desktop, penerjemah stiker Serial).',
  'server/src/modules/sticker/instruction-repo.ts#item_sticker_marks@1#be14975d':
    'Anak item (foto/penanda instruksi) dimuat menurut id item yang sudah disaring hidup oleh pemanggil (detail item, katalog desktop, penerjemah stiker Serial).',
  'server/src/modules/sticker/instruction-repo.ts#item_sticker_marks@2#2574375f':
    'Anak item (foto/penanda instruksi) dimuat menurut id item yang sudah disaring hidup oleh pemanggil (detail item, katalog desktop, penerjemah stiker Serial).',
  'server/src/modules/sticker/instruction-service.ts#stickers@1#7b040e33':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/sticker/instruction-service.ts#stickers@2#93bb44dd':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/sticker/instruction-service.ts#sticker_types@1#58d5cdd5':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/sticker/manual-book.ts#stickers@1#a90f3bf0':
    'Baca menurut id oleh pemanggil yang menilai `deletedAt` sendiri (hapus, pulihkan, status, simpan, detail).',
  'server/src/modules/sticker/manual-book.ts#stickers@2#921b68f4':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/sticker/repo.ts#stickers@1#f209c508':
    'Pembaca jenis/stiker untuk penampil rujukan (nama jenis + penanda terhapus) dan penguncian aturan jenis/adopsi: menghitung SEMUA stiker jenis itu termasuk yang terhapus, agar stiker yang dipulihkan kelak tak menyalahi aturan jenisnya; daftar hidup/terhapus disaring di pemanggil (`liveWhere`).',
  'server/src/modules/sticker/repo.ts#sticker_types@1#79b9b73c':
    'Pembaca jenis/stiker untuk penampil rujukan (nama jenis + penanda terhapus) dan penguncian aturan jenis/adopsi: menghitung SEMUA stiker jenis itu termasuk yang terhapus, agar stiker yang dipulihkan kelak tak menyalahi aturan jenisnya; daftar hidup/terhapus disaring di pemanggil (`liveWhere`).',
  'server/src/modules/sticker/repo.ts#stickers@5#429e9da2':
    'Baca menurut id oleh pemanggil yang menilai `deletedAt` sendiri (hapus, pulihkan, status, simpan, detail).',
  'server/src/modules/sticker/repo.ts#sticker_types@2#985384cd':
    'Penjaga/kunci TULIS atas baris yang baru dibaca penulis (SELECT ... LOCK IN SHARE MODE / FOR UPDATE); keadaan dinilai lewat kolom lain: stiker aktif tak pernah terhapus (hapus mensyaratkan bukan Aktif), jadi penjaga tetap menolak stiker terhapus.',
  'server/src/modules/sticker/stock-repo.ts#sticker_types@1#eb2fc28a':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/sticker/stock-repo.ts#sticker_types@2#d6aa860e':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/sticker/stock-repo.ts#stickers@3#88064441':
    'Penjaga/kunci TULIS atas baris yang baru dibaca penulis (SELECT ... LOCK IN SHARE MODE / FOR UPDATE); keadaan dinilai lewat kolom lain: stiker aktif tak pernah terhapus (hapus mensyaratkan bukan Aktif), jadi penjaga tetap menolak stiker terhapus.',
  'server/src/modules/sticker/stock-repo.ts#sticker_types@3#88064441':
    'Penjaga/kunci TULIS atas baris yang baru dibaca penulis (SELECT ... LOCK IN SHARE MODE / FOR UPDATE); keadaan dinilai lewat kolom lain: stiker aktif tak pernah terhapus (hapus mensyaratkan bukan Aktif), jadi penjaga tetap menolak stiker terhapus.',
  'server/src/modules/sticker/stock-repo.ts#stickers@4#a3e7cae4':
    'Penjaga/kunci TULIS atas baris yang baru dibaca penulis (SELECT ... LOCK IN SHARE MODE / FOR UPDATE); keadaan dinilai lewat kolom lain: stiker aktif tak pernah terhapus (hapus mensyaratkan bukan Aktif), jadi penjaga tetap menolak stiker terhapus.',
  'server/src/modules/postel/stickers.ts#stickers@1#1337aea8':
    'Nama stiker terhapus tetap menahan nama (indeks unik lama + spek soft delete butir 13: Postel baru bernama sama ditolak selama Postel lama ada di Terhapus); jalur tulis nama stiker Postel.',
  'server/src/modules/postel/stickers.ts#stickers@3#53d6d36d':
    'Pengadopsi stiker "Postel" bersama yang lama: pengisi satu kali saat start; stiker jenis sistem tak pernah dihapus sendiri (hanya bersama catatannya, 4b).',
  'server/src/modules/qrcode/items.ts#stickers@1#1a057869':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/applicable.ts#sticker_types@1#fbf3edf8':
    'Penampil rujukan: nama/status stiker tampil walau terhapus (penempatan lama di item, versi Manual Book, stiker serial); pemanggil menilai `deleted_at` atau memakai id yang sudah dikenal (soft delete T1, rujukan tersimpan tetap sah).',
  'server/src/modules/item/repo.ts#items@3#d2c69cc7':
    'Pembaca hak Manual Book menurut id item: gabungan ke `qr_designs` memakai `liveWhere`, `items` dibaca menurut id yang sudah lolos penyaring di pemanggil.',
  'server/src/modules/item/repo.ts#items@4#15b163c8':
    'Pembaca penunjuk Postel menurut id item: gabungan ke `postels` memakai `liveWhere`, `items` dibaca menurut id yang sudah lolos penyaring di pemanggil.',
  'server/src/modules/item/repo.ts#items@5#2e0e05ed':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#items@7#a315a2dc':
    'Pembaca stiker Postel menurut id item: `postels` disaring `liveWhere`, `items` dibaca menurut id yang sudah lolos penyaring di pemanggil.',
  'server/src/modules/qrcode/items.ts#manual_book_versions@4#97faa561':
    'Versi Manual Book dibaca menurut id konfigurasi yang dikunci pemanggil (hapus/ekspor); tak ada daftar lintas konfigurasi.',
  'server/src/modules/qrcode/items.ts#manual_book_versions@5#0ab64f55':
    'Penjaga versi Manual Book menurut id konfigurasi yang dikunci pemanggil (`MAX(version)` tak berubah); tak ada daftar lintas konfigurasi.',
  'server/src/modules/qrcode/repo.ts#qr_designs@3#fedda493':
    'Daftar SEMUA konfigurasi (hidup dan terhapus) untuk pembaca internal (pencabutan PDF yatim, simpan menurut id); daftar tampilan memakai `listQrDesigns` dengan penyaring keadaan.',
  'server/src/modules/qrcode/repo.ts#qr_designs@4#ca4f8a7b':
    'Baca konfigurasi menurut id (hidup atau terhapus); pemanggil menilai `deletedAt` (ekspor, hapus/pulihkan, pembaca berhak).',
  'server/src/modules/qrcode/repo.ts#qr_presets@3#ba8689c9':
    'Baca preset menurut id (hidup atau terhapus); pemanggil menilai `deletedAt` (perencana hapus/pulihkan, pembaca berhak).',
  'server/src/modules/qrcode/service.ts#manual_book_versions@2#9e72c7c1':
    'Versi Manual Book dibaca menurut id konfigurasi yang sudah lolos pemeriksaan hak/keadaan di pemanggil.',
  'server/src/modules/qrcode/soft-delete.ts#manual_book_versions@1#3dca0d0d':
    'Stiker versi dibaca menurut id konfigurasi yang dikunci dan sedang dihapus/dipulihkan dalam batch yang sama (harus melihat semua versi, juga untuk konfigurasi yang baru ditandai terhapus).',
  'server/src/modules/qrcode/soft-delete.ts#manual_book_versions@2#8762d12f':
    'Stiker versi dibaca menurut id konfigurasi yang dikunci dan sedang dihapus/dipulihkan dalam batch yang sama (harus melihat semua versi, juga untuk konfigurasi yang baru ditandai terhapus).',
  'server/src/modules/postel/repo.ts#postels@3#ba7e9c63':
    'Baca catatan menurut id (hidup atau terhapus); pemanggil menilai `deletedAt` (hak baca pemulih, simpan, hapus/pulihkan).',
  'server/src/modules/postel/repo.ts#postel_numbers@3#fbcdf7ae':
    'Nomor catatan TERHAPUS menurut id catatan yang sudah lolos pemeriksaan hak di pemanggil: nomor anak ikut `deleted_at` induknya, jadi tak disaring hidup.',
  'server/src/modules/postel/stickers.ts#postels@1#53d6d36d':
    'Pengisi saat start: stiker milik catatan TERHAPUS tetap dihitung sudah berpemilik, jadi tak diadopsi catatan lain (sengaja tanpa penyaring hidup).',
  'server/src/modules/qrcode/items.ts#manual_book_versions@1#1a057869':
    'Versi terbaru per konfigurasi untuk pembentuk tampilan (`designViews`) bagi daftar hidup MAUPUN terhapus; konfigurasi yang diminta sudah disaring keadaannya di pemanggil.',
  'server/src/modules/qrcode/items.ts#manual_book_versions@2#1a057869':
    'Subkueri versi terbaru milik kueri yang sama (menurut id konfigurasi yang sama); keadaan konfigurasi ditentukan pemanggil.',
  'server/src/modules/qrcode/items.ts#manual_book_versions@3#b1ac013b':
    'Pemeriksaan ada-tidaknya versi menurut id konfigurasi yang sudah dimuat/dikunci pemanggil.',
  'server/src/modules/qrcode/service.ts#manual_book_versions@1#97faa561':
    'Versi tertinggi menurut id konfigurasi yang sedang disimpan pemanggil (penentu nama stiker `<nama> v<n>`); keadaan konfigurasi sudah diperiksa.',
  'server/src/modules/files/service.ts#serials@1#6205b838':
    'Pembaca menilai `deleted_at` baris itu sendiri (kolomnya dibaca, bukan disaring): kiriman ulang `clientId`, hak baca berkas/foto bagi pemulih, keadaan foto; serial terhapus hanya terbaca pemegang hak Pulihkan.',
  'server/src/modules/serial/alert-job.ts#business_units@1#b86989f3':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/alert-job.ts#items@1#b86989f3':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/alert-job.ts#brands@1#b86989f3':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/alert-job.ts#locations@1#b86989f3':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/bu-history.ts#serials@1#9e00df83':
    'Semua baris serial dihitung tanpa penyaring keadaan: indeks unik lama `serials_serial` menjangkau baris terhapus juga (jadi syarat pembuatannya menghitung semuanya), pengisi riwayat BU dan kumpulan BU terlibat berlaku untuk serial terhapus agar tetap benar saat dipulihkan.',
  'server/src/modules/serial/bu-history.ts#serials@2#55c321bc':
    'Semua baris serial dihitung tanpa penyaring keadaan: indeks unik lama `serials_serial` menjangkau baris terhapus juga (jadi syarat pembuatannya menghitung semuanya), pengisi riwayat BU dan kumpulan BU terlibat berlaku untuk serial terhapus agar tetap benar saat dipulihkan.',
  'server/src/modules/serial/bu-history.ts#serials@3#4ac5b74b':
    'Semua baris serial dihitung tanpa penyaring keadaan: indeks unik lama `serials_serial` menjangkau baris terhapus juga (jadi syarat pembuatannya menghitung semuanya), pengisi riwayat BU dan kumpulan BU terlibat berlaku untuk serial terhapus agar tetap benar saat dipulihkan.',
  'server/src/modules/serial/bu-history.ts#serials@4#7bbf50f9':
    'Semua baris serial dihitung tanpa penyaring keadaan: indeks unik lama `serials_serial` menjangkau baris terhapus juga (jadi syarat pembuatannya menghitung semuanya), pengisi riwayat BU dan kumpulan BU terlibat berlaku untuk serial terhapus agar tetap benar saat dipulihkan.',
  'server/src/modules/serial/bu-history.ts#serials@5#616ca633':
    'Semua baris serial dihitung tanpa penyaring keadaan: indeks unik lama `serials_serial` menjangkau baris terhapus juga (jadi syarat pembuatannya menghitung semuanya), pengisi riwayat BU dan kumpulan BU terlibat berlaku untuk serial terhapus agar tetap benar saat dipulihkan.',
  'server/src/modules/serial/case-list.ts#locations@1#9fc6c564':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/case-list.ts#business_units@1#9fc6c564':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/case-list.ts#items@1#9fc6c564':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/case-list.ts#brands@1#9fc6c564':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/case-repo.ts#serial_cases@1#ce0211b9':
    'Penghitung nomor laporan: MAX nomor SEMUA laporan, termasuk milik serial terhapus, agar nomor tak pernah dipakai ulang (nomor laporan tetap unik).',
  'server/src/modules/serial/case-repo.ts#serial_cases@2#d60cde70':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/case-repo.ts#serial_cases@3#66ada673':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/case-repo.ts#serials@1#7041f237':
    'Penjaga ketidakcocokan versi (`updated_at`) atas serial menurut id yang baru dibaca penulis; serial yang berubah atau terhapus sejak dibaca mengubah `updated_at`-nya.',
  'server/src/modules/serial/history.ts#serial_events@1#c42b6fdb':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/history.ts#serial_events@2#fc41b582':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/attach.ts#business_units@1#71a9e696':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/proof/repo.ts#serial_proof_photos@1#d2a2206f':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/repo.ts#serial_proof_photos@2#2516c7c7':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/repo.ts#serial_proof_photos@3#cdcf2b13':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/repo.ts#serial_proof_photos@4#11efcca7':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/repo.ts#serial_proof_photos@5#9dc707a0':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/repo.ts#serial_proof_photos@6#094cf888':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/repo.ts#serial_proof_photos@7#6b34f0b2':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/repo.ts#serial_proof_photos@9#b7ceab19':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/proof/service.ts#serials@1#59e484e0':
    'Pembaca menilai `deleted_at` baris itu sendiri (kolomnya dibaca, bukan disaring): kiriman ulang `clientId`, hak baca berkas/foto bagi pemulih, keadaan foto; serial terhapus hanya terbaca pemegang hak Pulihkan.',
  'server/src/modules/serial/proof/sweep.ts#serial_proof_photos@1#ef7e9e83':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/public-routes.ts#business_units@1#fb777380':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/public-routes.ts#serial_events@1#ab0594cd':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/public-routes.ts#serial_events@2#dcf2fc40':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/recheck-entry.ts#business_units@2#71a9e696':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/recheck-entry.ts#serial_events@1#cb0debcf':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/recheck-entry.ts#business_units@4#6f78ec3f':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/recheck-entry.ts#items@1#6f78ec3f':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/recheck-entry.ts#brands@1#6f78ec3f':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#serials@1#ef199223':
    'Pembaca menilai `deleted_at` baris itu sendiri (kolomnya dibaca, bukan disaring): kiriman ulang `clientId`, hak baca berkas/foto bagi pemulih, keadaan foto; serial terhapus hanya terbaca pemegang hak Pulihkan.',
  'server/src/modules/serial/repo.ts#locations@1#ff23409a':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#business_units@1#dcdda19b':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/repo.ts#items@2#dcdda19b':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@1#dcdda19b':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#locations@3#dcdda19b':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@4#dcdda19b':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@5#dcdda19b':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#serial_proof_photos@2#bbce0dc9':
    'Baca serial menurut id, hidup atau terhapus: pemanggil menilai `deleted_at` dan hak sendiri (`loadReadableSerialRow` bagi pemulih, perencana hapus/pulihkan); gabungan tampilan ikut.',
  'server/src/modules/serial/repo.ts#serials@3#bbce0dc9':
    'Baca serial menurut id, hidup atau terhapus: pemanggil menilai `deleted_at` dan hak sendiri (`loadReadableSerialRow` bagi pemulih, perencana hapus/pulihkan); gabungan tampilan ikut.',
  'server/src/modules/serial/repo.ts#business_units@2#bbce0dc9':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/repo.ts#items@3#bbce0dc9':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@2#bbce0dc9':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#locations@6#bbce0dc9':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@7#bbce0dc9':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@8#bbce0dc9':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#serial_cases@2#bbce0dc9':
    'Baca serial menurut id, hidup atau terhapus: pemanggil menilai `deleted_at` dan hak sendiri (`loadReadableSerialRow` bagi pemulih, perencana hapus/pulihkan); gabungan tampilan ikut.',
  'server/src/modules/serial/repo.ts#business_units@3#029cb2ae':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/repo.ts#business_units@4#4a07381f':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/repo.ts#items@4#4a07381f':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@3#4a07381f':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#locations@9#4a07381f':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@10#4a07381f':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@11#4a07381f':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#serial_stickers@1#3f0e2215':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/repo.ts#serial_events@1#daa6e6f2':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/repo.ts#business_units@5#6dc190c6':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/repo.ts#items@5#6dc190c6':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@4#6dc190c6':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#locations@12#6dc190c6':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@13#6dc190c6':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@14#6dc190c6':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#business_units@6#49829cbd':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/repo.ts#items@6#49829cbd':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@5#49829cbd':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#locations@15#49829cbd':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@16#49829cbd':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#locations@17#49829cbd':
    'Penampil rujukan: nama lokasi tampil walau lokasi terhapus (lokasi terhapus dibaca nonaktif, soft delete); jalur tulis memeriksa lokasi hidup (`activeLocationName` memakai `liveWhere`).',
  'server/src/modules/serial/repo.ts#serial_events@2#3b3831f0':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/repo.ts#items@7#205e41f7':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@6#205e41f7':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/report.ts#business_units@1#71a9e696':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/service.ts#item_business_units@1#43393540':
    'Anak serial (kejadian, laporan, foto, stiker) dimuat atau ditulis menurut id serial atau laporan yang sudah lolos pemeriksaan hidup dan hak di pemanggil (`loadReadableSerialRow`, `loadSerialRow`, token laporan publik yang memeriksa serial hidup); tidak ada daftar lintas serial yang tak tersaring.',
  'server/src/modules/serial/service.ts#business_units@1#43393540':
    'Penampil rujukan atau pembaca kode BU menurut id yang sudah divalidasi hidup oleh jalur tulis (`activeItemWritableForBu`, `liveWhere` pada BU target); BU terhapus tetap memberi nama dan hak (soft delete 9).',
  'server/src/modules/serial/service.ts#items@3#122b7dd8':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/handover/repo.ts#customers@1#4f2b2d39':
    'Nama customer untuk tampilan: customer terhapus tetap memberi nama pada task yang memakainya (rujukan tersimpan tetap sah, soft delete T1); task disaring `liveWhere` di kueri yang sama.',
  'server/src/modules/handover/repo.ts#handovers@2#5ad762be':
    'Baca task menurut id atau kunci idempoten, hidup atau terhapus: pemanggil menilai `deletedAt` dan hak sendiri (detail untuk pemulih, perencana hapus/pulihkan, kiriman ulang yang dijawab NOT_FOUND bila task terhapus).',
  'server/src/modules/handover/repo.ts#customers@2#5ad762be':
    'Nama customer untuk tampilan: customer terhapus tetap memberi nama pada task yang memakainya (rujukan tersimpan tetap sah, soft delete T1); task disaring `liveWhere` di kueri yang sama.',
  'server/src/modules/handover/repo.ts#customers@3#75317ae6':
    'Nama customer untuk tampilan: customer terhapus tetap memberi nama pada task yang memakainya (rujukan tersimpan tetap sah, soft delete T1); task disaring `liveWhere` di kueri yang sama.',
  'server/src/modules/handover/repo.ts#handovers@4#5ad762be':
    'Baca task menurut id atau kunci idempoten, hidup atau terhapus: pemanggil menilai `deletedAt` dan hak sendiri (detail untuk pemulih, perencana hapus/pulihkan, kiriman ulang yang dijawab NOT_FOUND bila task terhapus).',
  'server/src/modules/handover/repo.ts#customers@4#5ad762be':
    'Nama customer untuk tampilan: customer terhapus tetap memberi nama pada task yang memakainya (rujukan tersimpan tetap sah, soft delete T1); task disaring `liveWhere` di kueri yang sama.',
  'server/src/modules/handover/repo.ts#customers@5#4f2b2d39':
    'Nama customer untuk tampilan: customer terhapus tetap memberi nama pada task yang memakainya (rujukan tersimpan tetap sah, soft delete T1); task disaring `liveWhere` di kueri yang sama.',
  'server/src/modules/handover/repo.ts#handover_comments@1#8a542173':
    'Anak task (komentar) dimuat atau dihitung menurut id task yang sudah lolos pemuat hidup (`loadForWrite`, papan yang menyaring `liveWhere`) atau pembaca pemulih; tidak ada daftar komentar lintas task.',
  'server/src/modules/handover/repo.ts#handover_comments@2#c4789906':
    'Anak task (komentar) dimuat atau dihitung menurut id task yang sudah lolos pemuat hidup (`loadForWrite`, papan yang menyaring `liveWhere`) atau pembaca pemulih; tidak ada daftar komentar lintas task.',
  'server/src/modules/handover/repo.ts#handovers@6#163599af':
    'Baca task menurut id atau kunci idempoten, hidup atau terhapus: pemanggil menilai `deletedAt` dan hak sendiri (detail untuk pemulih, perencana hapus/pulihkan, kiriman ulang yang dijawab NOT_FOUND bila task terhapus).',
  'server/src/modules/handover/repo.ts#handover_comments@3#5d94ca77':
    'Anak task (komentar) dimuat atau dihitung menurut id task yang sudah lolos pemuat hidup (`loadForWrite`, papan yang menyaring `liveWhere`) atau pembaca pemulih; tidak ada daftar komentar lintas task.',
  'server/src/modules/handover/service.ts#customers@1#26b11ba5':
    'Nama customer untuk tampilan: customer terhapus tetap memberi nama pada task yang memakainya (rujukan tersimpan tetap sah, soft delete T1); task disaring `liveWhere` di kueri yang sama.',
  'server/src/modules/handover/service.ts#customers@2#3e90a9f4':
    'Nama customer untuk tampilan: customer terhapus tetap memberi nama pada task yang memakainya (rujukan tersimpan tetap sah, soft delete T1); task disaring `liveWhere` di kueri yang sama.',
  'server/src/modules/handover/service.ts#handovers@5#9f85b212':
    'Pencarian nomor `ST-…` terbesar menghitung task terhapus juga: nomor tak pernah dipakai ulang (nomor tetap unik).',
  'server/src/modules/handover/service.ts#handover_comments@1#e41ffe5c':
    'Anak task (komentar) dimuat atau dihitung menurut id task yang sudah lolos pemuat hidup (`loadForWrite`, papan yang menyaring `liveWhere`) atau pembaca pemulih; tidak ada daftar komentar lintas task.',
  'server/src/modules/handover/service.ts#handovers@6#b2884254':
    'Kunci baris task (`FOR UPDATE`) pada penulisan komentar yang task-nya baru dimuat hidup oleh `loadForWrite`; penjaga di INSERT komentar menilai `deleted_at` lagi.',
  'server/src/modules/handover/service.ts#handover_comments@2#b1fb09e6':
    'Anak task (komentar) dimuat atau dihitung menurut id task yang sudah lolos pemuat hidup (`loadForWrite`, papan yang menyaring `liveWhere`) atau pembaca pemulih; tidak ada daftar komentar lintas task.',
  'server/src/modules/handover/service.ts#handover_comments@3#b1fb09e6':
    'Anak task (komentar) dimuat atau dihitung menurut id task yang sudah lolos pemuat hidup (`loadForWrite`, papan yang menyaring `liveWhere`) atau pembaca pemulih; tidak ada daftar komentar lintas task.',
  'server/src/modules/notification/push.ts#notifications@1#e392efab':
    'Baris notifikasi dibaca menurut penerima; keberadaan task/serial HIDUP dan hak diperiksa lewat `scopeClause` (lonceng, hitungan) atau `canReadNotification` (push, aliran SSE) saat dibaca/dikirim.',
  'server/src/modules/notification/repo.ts#notifications@1#f36d7108':
    'Baris notifikasi dibaca menurut penerima; keberadaan task/serial HIDUP dan hak diperiksa lewat `scopeClause` (lonceng, hitungan) atau `canReadNotification` (push, aliran SSE) saat dibaca/dikirim.',
  'server/src/modules/notification/repo.ts#notifications@2#4770fffd':
    'Baris notifikasi dibaca menurut penerima; keberadaan task/serial HIDUP dan hak diperiksa lewat `scopeClause` (lonceng, hitungan) atau `canReadNotification` (push, aliran SSE) saat dibaca/dikirim.',
  'server/src/modules/notification/repo.ts#notifications@3#aca741c4':
    'Menandai/membaca satu notifikasi menurut id dan penerima: tanpa data task atau serial yang perlu disaring; lonceng menyaringnya lewat `scopeClause`.',
  'server/src/modules/notification/repo.ts#notifications@4#c088baf7':
    'Baris notifikasi dibaca menurut penerima; keberadaan task/serial HIDUP dan hak diperiksa lewat `scopeClause` (lonceng, hitungan) atau `canReadNotification` (push, aliran SSE) saat dibaca/dikirim.',
};
