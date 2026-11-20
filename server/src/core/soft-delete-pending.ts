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
    'qr_designs@1#6d982a3a',
    'manual_book_versions@1#6d982a3a',
    'manual_book_versions@2#6d982a3a',
    'stickers@1#6d982a3a',
    'postels@1#2bbba95b',
    'item_business_units@2#69d917f0',
    'item_business_units@3#f44ff848',
  ],
  'server/src/modules/item/service.ts': [
    'stickers@1#5184736e',
    'sticker_types@1#5184736e',
    'sticker_types@2#4f247cff',
    'item_sticker_marks@1#0ea287d8',
  ],
  // Fase 4a (sticker)
  'server/src/modules/sticker/guide-repo.ts': [
    'item_sticker_photos@1#dae36bcd',
    'users@1#21ba7e4d',
    'users@2#efe68088',
  ],
  'server/src/modules/sticker/instruction-repo.ts': [
    'item_sticker_photos@1#6f472aca',
    'item_sticker_marks@1#be14975d',
    'item_sticker_marks@2#0e97424a',
  ],
  'server/src/modules/sticker/instruction-service.ts': [
    'stickers@1#9204cfe1',
    'stickers@2#93bb44dd',
    'business_units@1#8607d2a9',
    'sticker_types@1#c42f0ce4',
  ],
  'server/src/modules/sticker/manual-book.ts': [
    'stickers@1#a90f3bf0',
    'manual_book_versions@1#921b68f4',
    'stickers@2#921b68f4',
  ],
  'server/src/modules/sticker/repo.ts': [
    'stickers@1#8f1c6a01',
    'sticker_types@1#8f1c6a01',
    'stickers@2#73cccc40',
    'stickers@3#429e9da2',
    'business_units@1#c2e2358a',
    'business_units@2#2023d3e3',
    'sticker_types@2#985384cd',
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
  'server/src/modules/sticker/service.ts': ['postels@1#27c4fac2'],
  'server/src/modules/sticker/stock-repo.ts': [
    'stickers@1#5b8116d4',
    'sticker_types@1#5b8116d4',
    'stickers@2#88064441',
    'sticker_types@2#88064441',
    'stickers@3#a3e7cae4',
    'stickers@4#2be9e855',
    'stickers@5#8f38dd07',
    'sticker_types@3#8f38dd07',
    'stickers@6#27173699',
  ],
  // Fase 4b (qrcode, postel)
  // Ekspor Sheets: `files` (pemilik stiker/pustaka fase 4a, QR/postel fase 4b) dan `qr_documents` belum disaring
  // (pemilik `item` sudah, fase 3). Setelah semuanya disaring, pindahkan kuncinya ke SOFT_DELETE_EXEMPT dengan alasan.
  'server/src/modules/jobs/sheets-export.ts': ['*dinamis@1#62151e07'],
  'server/src/modules/postel/repo.ts': [
    'postels@1#0eefd984',
    'postels@2#b320a3de',
    'postels@3#af56c3ec',
    'postel_numbers@1#3c3bd5ee',
    'postel_numbers@2#5b246666',
  ],
  'server/src/modules/postel/stickers.ts': [
    'stickers@1#72c37a09',
    'stickers@2#a3e7cae4',
    'stickers@3#53d6d36d',
    'postels@1#53d6d36d',
  ],
  'server/src/modules/qrcode/items.ts': [
    'qr_designs@1#7892692c',
    'manual_book_versions@1#1a057869',
    'stickers@1#1a057869',
    'manual_book_versions@2#1a057869',
    'manual_book_versions@3#b1ac013b',
  ],
  'server/src/modules/qrcode/repo.ts': [
    'qr_designs@1#4cd41f80',
    'qr_designs@2#9d843d8b',
    'qr_presets@1#f7133ef0',
  ],
  'server/src/modules/qrcode/service.ts': [
    'qr_designs@1#c70c7365',
    'manual_book_versions@1#97faa561',
    'stickers@1#fc2aad1c',
    'sticker_types@1#fc2aad1c',
    'manual_book_versions@2#fc2aad1c',
  ],
  // Fase 4c (access, customer)
  // Fase 4d (serial, handover)
  'server/scripts/merge-duplicate-serials.ts': [
    'serials@1#5be5daeb',
    'business_units@1#5be5daeb',
    'serials@2#5be5daeb',
    'serial_events@1#f505f433',
    'serial_stickers@1#762daad2',
    'serials@3#7bf06089',
    'serials@4#a56e18ed',
    'business_units@2#a56e18ed',
  ],
  'server/src/modules/handover/repo.ts': [
    'handovers@1#5ad762be',
    'customers@1#5ad762be',
    'handovers@2#8db8ac17',
    'customers@2#8db8ac17',
    'handovers@3#5ad762be',
    'customers@3#5ad762be',
    'handover_comments@1#8a542173',
    'handover_comments@2#c4789906',
    'handovers@4#dd8c76b0',
    'handover_comments@3#5d94ca77',
  ],
  'server/src/modules/handover/service.ts': [
    'handovers@1#b4da9253',
    'customers@1#b4da9253',
    'handovers@2#e5c91c19',
    'handovers@3#9f85b212',
    'handover_comments@1#e41ffe5c',
    'handovers@4#b2884254',
    'handover_comments@2#0dd06e23',
    'handover_comments@3#0dd06e23',
  ],
  'server/src/modules/serial/act.ts': ['business_units@1#3b3c1ebc'],
  'server/src/modules/serial/alert-job.ts': [
    'serials@1#94659661',
    'business_units@1#94659661',
    'locations@1#94659661',
    'serial_cases@1#94659661',
    'serial_events@1#94659661',
  ],
  'server/src/modules/serial/applicable.ts': ['stickers@1#0bbe3d52', 'sticker_types@1#0bbe3d52'],
  'server/src/modules/serial/bu-history.ts': [
    'serials@1#9e00df83',
    'serials@2#55c321bc',
    'serials@3#4ac5b74b',
    'serials@4#616ca633',
  ],
  'server/src/modules/serial/case-list.ts': [
    'serial_events@1#d1858e02',
    'serial_events@2#d1858e02',
    'serial_cases@1#d1858e02',
    'serials@1#d1858e02',
    'locations@1#d1858e02',
    'business_units@1#d1858e02',
  ],
  'server/src/modules/serial/case-repo.ts': [
    'serial_cases@1#ce0211b9',
    'serial_cases@2#d60cde70',
    'serial_cases@3#66ada673',
    'serials@1#7041f237',
  ],
  'server/src/modules/serial/history.ts': ['serial_events@1#c42b6fdb', 'serial_events@2#fc41b582'],
  'server/src/modules/serial/proof/attach.ts': ['business_units@1#71a9e696'],
  'server/src/modules/serial/proof/repo.ts': [
    'serial_proof_photos@1#d2a2206f',
    'serial_proof_photos@2#2516c7c7',
    'serial_proof_photos@3#cdcf2b13',
    'serial_proof_photos@4#11efcca7',
    'serial_proof_photos@5#9dc707a0',
    'serial_proof_photos@6#094cf888',
    'serial_proof_photos@7#6b34f0b2',
    'serial_proof_photos@8#851a9891',
    'serial_proof_photos@9#b7ceab19',
  ],
  'server/src/modules/serial/proof/service.ts': ['serials@1#c9827557'],
  'server/src/modules/serial/proof/sweep.ts': ['serial_proof_photos@1#ef7e9e83'],
  'server/src/modules/serial/public-routes.ts': [
    'business_units@1#fb777380',
    'serial_events@1#ab0594cd',
    'serial_events@2#dcf2fc40',
  ],
  'server/src/modules/serial/recheck-entry.ts': [
    'business_units@1#3b3c1ebc',
    'business_units@2#71a9e696',
    'business_units@3#c7cf9826',
    'serial_events@1#cb0debcf',
    'serials@1#3ef659b5',
    'business_units@4#3ef659b5',
    'business_units@5#129328ee',
  ],
  'server/src/modules/serial/repo.ts': [
    'serials@1#aa389142',
    'locations@1#ff23409a',
    'locations@2#f283f2e8',
    'serial_proof_photos@1#bbce0dc9',
    'serials@2#bbce0dc9',
    'business_units@1#bbce0dc9',
    'locations@3#bbce0dc9',
    'locations@4#bbce0dc9',
    'locations@5#bbce0dc9',
    'serial_cases@1#bbce0dc9',
    'business_units@2#029cb2ae',
    'serial_proof_photos@2#ab57a715',
    'serials@3#ab57a715',
    'business_units@3#ab57a715',
    'locations@6#ab57a715',
    'locations@7#ab57a715',
    'locations@8#ab57a715',
    'serial_cases@2#ab57a715',
    'serial_stickers@1#99ae892d',
    'stickers@1#99ae892d',
    'serial_events@1#daa6e6f2',
    'serial_proof_photos@3#2afb7690',
    'serials@4#2afb7690',
    'business_units@4#2afb7690',
    'locations@9#2afb7690',
    'locations@10#2afb7690',
    'locations@11#2afb7690',
    'serial_cases@3#2afb7690',
    'serial_events@2#3b3831f0',
  ],
  'server/src/modules/serial/report.ts': ['business_units@1#71a9e696', 'serials@1#8f846d75'],
  'server/src/modules/serial/service-locations.ts': ['locations@2#92c7c99c'],
  'server/src/modules/serial/service.ts': [
    'item_business_units@1#43393540',
    'business_units@1#43393540',
    'serials@1#be7ddb50',
  ],
  // Lain-lain (modul yang membaca tabel milik fase lain: notification, desktop catalog, files, digest stok)
  'server/src/modules/desktop/catalog.ts': ['sticker_types@1#122492eb', 'stickers@1#483e4878'],
  'server/src/modules/files/service.ts': ['serials@1#28642dd5', 'item_business_units@1#546f26ad'],
  'server/src/modules/notification/flush.ts': ['handovers@1#f37698e5'],
  'server/src/modules/notification/push.ts': ['notifications@1#e392efab'],
  'server/src/modules/notification/recipients.ts': ['serials@1#c9827557'],
  'server/src/modules/notification/repo.ts': [
    'serials@1#9c8a0b2b',
    'notifications@1#f36d7108',
    'notifications@2#4770fffd',
    'notifications@3#aca741c4',
    'notifications@4#c088baf7',
  ],
  'server/src/modules/notification/serial-proof.ts': [
    'serial_proof_photos@1#45516398',
    'serials@1#45516398',
  ],
  'server/src/modules/sticker/digest.ts': ['stickers@1#aa168eb3', 'sticker_types@1#aa168eb3'],
};

/**
 * Kemunculan yang sah tanpa penyaring (mis. penjaga tulis, skrip seed, ekspor yang menyaring secara dinamis), kunci =
 * `"<berkas>#<kunci pemindai>"`, nilai = alasan.
 */
export const SOFT_DELETE_EXEMPT: Record<string, string> = {
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
  'server/src/modules/item/repo.ts#items@3#e3b205b7':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#items@4#4e671591':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#items@5#6d982a3a':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#items@6#7dc4cfed':
    'Baca menurut id yang SUDAH lolos penyaring hidup di pemanggil (daftar/detail) atau perencana hapus/pulihkan yang menilai `deletedAt` sendiri; JOIN merk = nama untuk tampilan.',
  'server/src/modules/item/repo.ts#items@7#2bbba95b':
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
  'server/src/modules/serial/alert-job.ts#items@1#94659661':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/alert-job.ts#brands@1#94659661':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/case-list.ts#items@1#d1858e02':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/case-list.ts#brands@1#d1858e02':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/recheck-entry.ts#items@1#3ef659b5':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/recheck-entry.ts#brands@1#3ef659b5':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/proof/attach.ts#items@1#b355d3af':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/proof/attach.ts#brands@1#b355d3af':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#items@2#bbce0dc9':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@1#bbce0dc9':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#items@3#ab57a715':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@2#ab57a715':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#items@4#2afb7690':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@3#2afb7690':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/repo.ts#items@5#205e41f7':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
  'server/src/modules/serial/repo.ts#brands@4#205e41f7':
    'Nama merk untuk tampilan/rujukan: merk terhapus tetap memberi nama pada item yang memakainya (keputusan T1, rujukan tersimpan tetap sah).',
  'server/src/modules/serial/service.ts#items@2#122b7dd8':
    'Penampil rujukan: serial menampilkan nama item (LEFT JOIN) walau item terhapus; item terhapus tak dihitung/dipilih di jalur tulis (jalur tulis lain: `activeItemWritableForBu` (serial/repo.ts) menyaring hidup). Penanda "Terhapus" pada tampilan serial = fase 4d.',
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
};
