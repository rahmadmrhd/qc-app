# Stiker Management, tahap 3b-2: instruksi stiker per item

Status: **disetujui pemilik produk 2026-11-10 ("Setuju, susun rencana"); dibangun (2026-11-10), menunggu perbaikan review akhir dan PR.** Butir §3 bertanda "pilihan perancang" ikut disetujui dalam persetujuan itu kecuali dikoreksi kemudian. Tanggal: 2026-11-10.
Induk: `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md` (§6 mencatat keputusan 3b), `docs/superpowers/specs/2026-11-09-stiker-pustaka-gambar-3b1-design.md` (pustaka gambar dan kontrak ke 3b-2), `docs/superpowers/specs/2026-11-08-business-unit-design.md` (keputusan 13, 17-18, 20-21, 23). Cabang kerja: dibuat dari `dev` setelah PR 48 (3b-1) di-merge.

## 1. Tujuan

Tim QC dan tim lain yang membantu (sering kali orang yang tidak paham stiker) perlu tahu **stiker apa yang harus ditempel pada sebuah item dan di mana letaknya**: sebagian ditempel di barang, sebagian di kardus. Tahap ini menyediakan:

1. **Instruksi stiker per item**: satu atau lebih foto (barang, kardus) dari pustaka gambar 3b-1, tiap foto dengan penanda posisi yang menunjuk ke stiker tertentu atau ke sebuah jenis stiker.
2. **Tampilan baca** di detail item (foto dengan label, ditambah daftar di bawahnya yang selalu ada) yang dapat dipahami tanpa pengetahuan QC, nyaman di HP dan desktop.
3. **Pengingat dan penelusuran**: tanda "Belum ada instruksi stiker" dan filter di daftar item, termasuk filter per jenis atau stiker.
4. Pustaka gambar menjadi berguna penuh: jumlah pemakaian nyata, hapus dicegah bila dipakai, urut "paling sering dipakai".

Anti-tujuan: instruksi **opsional dan tidak pernah memblokir penyimpanan item** (penting tetapi tidak dipaksa); tidak ada migrasi isi daftar stiker lama; tidak ada pengelompokan item (tahap 4); tidak ada pemotongan stok (tahap 5).

## 2. Keputusan pemilik produk

Dicatat 2026-11-09 (dari spek 3a §6):
1. Daftar stiker lama di item **diganti total**; isi item dev lama tidak dimigrasikan.
2. Item punya satu atau lebih foto, masing-masing dengan penanda sendiri; foto dipilih dari pustaka atau diunggah baru (otomatis masuk pustaka); foto boleh diberi label BU (opsional).
3. **Penanda gaya tag foto Instagram**: ketuk posisi di foto lalu pilih stiker tertentu atau sebuah jenis; posisi relatif. Jenis diterjemahkan ke stiker menurut BU item.
4. **Tampilan detail: label langsung di foto** (pilihan B), label dapat diketuk untuk melihat gambar contoh, nama, dan petunjuk posisi; item di dua BU menampilkan semua stiker yang cocok, berlabel BU.
5. Yang mengatur instruksi = siapa saja yang berizin ubah item; dapat dilakukan saat menambah item baru atau pada item yang sudah ada; opsional tetapi penting.
6. Manual Book dan Postel ditandai ke stiker tertentu **per item**; pengelompokan item = tahap 4.

Dicatat 2026-11-10 (pembahasan 3b-2):
7. Pembaca beragam (HP, desktop, lainnya) dan sering orang non-QC. **Daftar di bawah foto selalu ada** (juga di desktop), tiap stiker dengan **gambar contoh** terlampir; label di foto adalah pelengkap visual.
8. Foto sama dipakai ulang oleh banyak item lewat pustaka. Saat memilih foto yang sudah dipakai item lain ada opsi **menyalin penanda** dari item itu; hasil salinan tetap bebas diubah per item (ganti stiker/jenis, tambah, hapus).
9. **Tanda "Belum ada instruksi stiker"** di daftar dan detail item diminta pemilik (instruksi opsional tetapi sangat penting).
10. **Filter di daftar item**: "Belum ada instruksi stiker", dan filter per jenis atau stiker dalam dua mode: item yang **memakai** dan item yang **belum memakai** stiker atau jenis itu.
11. Tiap foto punya **catatan** (field teks) yang menjelaskan bagian mana yang sedang dilihat (mis. "Kardus sisi samping"). Catatan milik penempatan (item + foto), bukan nama foto di pustaka.
12. **Aturan LinkField** (2026-11-10, PR 49): setiap field form yang bergantung pada model/tabel lain memakai `LinkField`/`LinkMultiField`. Berlaku bagi pemilihan stiker, jenis, dan BU di editor instruksi; `StickerListField` lama (teks bebas) tidak dipertahankan.

Dicatat 2026-11-10 (setelah review akhir; keputusan pemilik produk):
13. **Peringatan salin ke sasaran nonaktif**: penanda hasil salinan yang menunjuk stiker atau jenis yang sudah nonaktif diberi tanda "nonaktif" di dialog salin dan di baris penanda sebelum Simpan (aturan server tidak berubah: sasaran baru wajib aktif).
14. **Ketuk penanda di detail** menyorot barisnya dan menggulirnya ke area terlihat (penting di HP).
15. **`usageCount` pustaka tetap menghitung semua penempatan** tanpa memandang BU yang terlihat (hanya jumlah yang terlihat; nama item hanya lewat `usages` yang dibatasi BU). Alasan: sejalan dengan FK `RESTRICT` yang menahan hapus. Ditinjau dan dibiarkan.
16. **`stickers.list`/`stickerTypes.list` bagi pemegang `item: ubah`** tetap memakai DTO katalog penuh (termasuk batas minimum dan status menipis). Alasan: bukan data sensitif; menghindari DTO ringkas tambahan. Ditinjau dan dibiarkan.

## 3. Pilihan perancang (belum ditegaskan pemilik; harap dikoreksi bila keliru)

**Batas dan bentuk data**
- Maks. **10 foto per item**, **30 penanda per foto**, catatan foto maks. 200 karakter, catatan penanda maks. 120 karakter. Satu foto pustaka hanya boleh sekali per item. Urutan foto dapat diatur; urutan penanda mengikuti urutan penambahan dan menjadi nomor di foto dan di daftar.
- Posisi penanda disimpan sebagai bilangan bulat **permil** (0-1000) terhadap lebar dan tinggi foto, agar tepat di ukuran tampilan berapa pun.
- Sasaran penanda tepat satu dari: stiker tertentu (`stickerId`) atau jenis (`typeId`). Pilihan baru hanya dari stiker/jenis aktif; yang sudah tersimpan tetap utuh bila kemudian dinonaktifkan.
- Label BU foto (opsional) harus salah satu BU item.
- Tabel baru (migrasi `0007_…`, expand-only, idempoten): **`item_sticker_photos`** (`item_id`, `guide_id` dengan **kunci asing `ON DELETE RESTRICT` ke `sticker_guide_images`** (kontrak 3b-1), `caption`, `bu_id` boleh kosong, `position`; unik pada `item_id + guide_id`) dan **`item_sticker_marks`** (rujukan ke foto dengan `ON DELETE CASCADE`, `x`, `y`, `sticker_id` atau `type_id`, `note`, `position`). Tanpa kunci asing ke stiker/jenis/BU (tidak pernah dihapus, pola 3a). Kolom lama `items.stickers` **tidak dihapus** (expand → contract; penghapusan di rilis berikutnya) dan tidak dibaca atau ditulis lagi.
- Tidak ada backfill dari daftar lama.

**Penyimpanan**
- Instruksi disimpan **bersama item** lewat `items.save` (bagian "Instruksi stiker" di form; ganti-semua dalam satu `batch()`), memakai penjaga versi dan pemeriksaan izin BU yang sudah ada (keputusan 13: level pada semua BU item). Tidak ada rute tulis baru. Rujukan ke foto pustaka, stiker, jenis, dan BU divalidasi sebelum menulis; foto yang tidak ada = `VALIDATION` pada field instruksi.
- DTO item: `stickers` (daftar lama) diganti `stickerPhotos`: foto (`guideId`, nama pustaka, `caption`, `buId`, `marks`), tiap penanda `{ x, y, target, note }`. Pada pembacaan, tiap penanda memuat `resolved`: daftar stiker hasil pencocokan (`id`, nama, alias, berkas contoh, BU penyebab bila item punya beberapa BU, penanda nonaktif) dan `unresolved: true` bila tidak ada yang cocok.
- **Aturan pencocokan jenis → stiker** (satu definisi): penanda berjenis dengan aturan `bu` = stiker aktif jenis itu yang tertaut ke salah satu BU item; aturan `none` = semua stiker aktif jenis itu. Penanda ke stiker tertentu = stiker itu sendiri, tetap tampil walau nonaktif (diberi tanda "nonaktif"). Tidak ada kecocokan = label tetap tampil dengan peringatan "Belum ada stiker {jenis} untuk BU ini"; penyimpanan tidak diblokir.
- Item di luar hak BU user tetap `NOT_FOUND` (bukan `FORBIDDEN`) di semua jalur baru.

**Daftar item**
- Baris daftar memuat `hasInstructions` (item dianggap punya instruksi bila memiliki minimal satu penanda; dihitung dengan `EXISTS`; **keputusan pemilik 2026-11-23, disetujui pemilik produk**: hanya penanda yang bersasaran stiker/jenis HIDUP (tidak terhapus) yang dihitung, juga untuk `instruction=none` dan filter `stickerId`/`typeId`, karena record terhapus tak ikut perhitungan (spek soft delete §4.4); sebelumnya penanda ke stiker terhapus ikut dihitung). Query `items.list` bertambah: `instruction` (`none`), `stickerId` atau `typeId`, dan `stickerMode` (`has` | `missing`). Semua tetap difilter BU di SQL.
- "Memakai stiker S": ada penanda ke S, atau penanda jenis yang menurut aturan di atas menghasilkan S untuk item itu. "Memakai jenis T": ada penanda jenis T atau ke stiker berjenis T. "Belum memakai" = kebalikannya di antara item yang terlihat. Pencocokan dipakai bersama oleh tampilan detail dan filter (satu sumber kebenaran); wajib ada tes yang memastikan keduanya sepakat.
- UI filter: pilihan "Instruksi stiker" (Semua / Belum ada) dan satu pilihan stiker-atau-jenis dengan mode Memakai/Belum memakai. Pilihan stiker-atau-jenis merujuk record model lain, jadi memakai `LinkField` (opsi berurutan per jenis, nama jenis sebagai deskripsi; keputusan pemilik 2026-11-11, spek BU butir 25, menggantikan pengecualian "filter halaman daftar" dan `NativeSelect` dikelompokkan per jenis); pilihan tetap (Semua/Belum ada, Memakai/Belum memakai) memakai `Select`.

**Pustaka (kontrak 3b-1)**
- `guideUsageCountSql` diganti subkueri penempatan; filter "Belum dipakai" dan DTO `usageCount` ikut benar. Hapus pada gambar yang dipakai = `CONFLICT` "Gambar masih dipakai" (galat kunci asing dipetakan; pemeriksaan di `lockGuideStatement` tetap). **Wajib tes `usageCount > 0` = CONFLICT.**
- Urut baru `usageDesc` ("paling sering dipakai") ditambahkan di `GUIDE_SORTS`, kursor keyset memakai jumlah pemakaian.
- Rute baca baru `stickerGuides.usages` (id gambar → item yang memakainya, hanya yang boleh dilihat user, maks. 20) untuk fitur salin penanda; izin `item: lihat`.
- Menghapus foto dari item tidak menghapusnya dari pustaka.

**Antarmuka**
- **Form item, bagian "Instruksi stiker"** (menggantikan `StickerListField`): daftar foto dengan catatan, label BU (`LinkField` ke BU item), dan urutan; tombol tambah foto membuka dialog berkas 3b-1 (sumber pustaka stiker, mode banyak) dan seret-lepas di bagian ini membuka dialog dengan berkas sudah di daftar unggah. Memilih foto yang sudah dipakai item lain menawarkan "Salin penanda dari item …" (daftar dari `stickerGuides.usages`).
- **Editor penanda** per foto: ketuk foto menambah penanda nomor berikutnya; penanda dapat diseret; setiap penanda juga punya baris di bawah foto (jalur utama untuk aksesibilitas dan layar kecil) berisi SATU pilihan sasaran gabungan (`LinkField` "Jenis atau stiker"; sejak 2026-11-26 tanpa pilihan mode: Jenis lebih dulu lalu Stiker, jenis tanpa aturan tidak ditawarkan, label jenis `<nama> (Berdasarkan BU)` atau `<nama> (Berdasarkan Item)`; diputuskan pemilik produk karena jenis tanpa aturan = semua stiker sehingga tak bermakna sebagai sasaran, dan agar pengguna tak perlu memilih mode dulu), catatan, dan hapus. Field itu hanya punya SATU baris "Tambah Stiker" (keputusan pemilik 2026-11-26) yang membuka dialog tambah stiker; jenis baru dibuat dari baris "Tambah Jenis" di dalam dialog itu, jadi tak ada jalur pembuatan jenis langsung dari penanda dan tak ada kondisi "jenis belum punya stiker yang cocok". Model data sasaran tidak berubah; penanda lama yang menunjuk jenis tanpa aturan tetap terbaca.
- **Detail item**: tiap foto dengan penanda bernomor; di desktop nama stiker tampil di samping penanda, di HP hanya nomor. Daftar di bawah foto selalu ada: nomor, gambar contoh, nama (alias bila ada), catatan; ketuk penanda menyorot barisnya. Foto + catatan foto menjelaskan bagian barang atau kardus. Detail yang belum punya instruksi menampilkan tanda "Belum ada instruksi stiker" (dan tombol ke form bagi yang berizin ubah).
- Berkas contoh stiker dan foto pustaka dibaca lewat izin yang sudah ada (`item: lihat` atau `sticker: lihat`); detail item tidak memerlukan `sticker: lihat`.
- Audit item mencatat ringkasan perubahan instruksi (jumlah foto dan penanda) pada riwayat perubahan item yang sudah ada.

**Tes yang dituntut** (di luar tes biasa): jalur `usageCount > 0` = CONFLICT; kunci asing RESTRICT menahan hapus walau dua permintaan berlomba; item di luar hak BU `NOT_FOUND` di detail, daftar, filter, dan `usages`; kesepakatan pencocokan detail dan filter untuk item satu BU, dua BU, tanpa BU cocok, jenis `none`; stiker/jenis nonaktif; duplikat foto per item ditolak; batas 10/30; item dev lama dengan `items.stickers` terisi tetap terbaca dan disimpan tanpa error.

**Pilihan tambahan (hasil pemeriksaan pembangun, 2026-11-10; pilihan perancang, harap dikoreksi bila keliru)**
- **Sumber daftar stiker dan jenis di editor**: rute baca `stickers.list` dan `stickerTypes.list` dilonggarkan menjadi `anyOf` (`sticker: lihat` atau `item: ubah`), hanya untuk baca (tes izin diperbarui). Penyunting item tanpa `sticker: lihat` dapat memilih stiker dan jenis, tetapi tidak membuka halaman Stiker. Tombol "Tambah" di `LinkField` hanya muncul bagi yang berizin `sticker: ubah` (aturan `link-access.ts`); tanpa itu hanya memilih. Model tanpa halaman lihat (jenis, stiker) tanpa tautan "Buka" (pengecualian aturan LinkField yang disetujui 2026-11-10).
- **Label BU foto** murni tampilan (lencana di foto dan di daftar bawah foto); tidak memengaruhi pencocokan jenis→stiker, tidak dipakai filter.
- **Penanda ke stiker tertentu boleh menunjuk stiker apa pun yang aktif**, tidak disaring ke BU item dan tidak divalidasi tautan BU-nya (Manual Book/Postel per item tidak terikat BU). "Memakai stiker S" di filter benar untuk penanda langsung ke S, apa pun BU item. Hanya penanda **jenis** yang bergantung BU: dihitung ulang saat dibaca, sehingga perubahan BU item sesudah simpan hanya mengubah hasil (bisa menjadi peringatan "belum ada stiker"), tanpa validasi ulang saat simpan.
- **Aturan `bu` dan stiker tanpa BU**: stiker tanpa baris `sticker_business_units` tidak pernah cocok untuk jenis ber-aturan `bu` (sesuai makna "menurut BU" di 3a); hasilnya peringatan "belum ada stiker".
- **Salin penanda**: dikerjakan di klien. Item sumber dipilih dari `stickerGuides.usages` (sudah disaring hak BU), penandanya dibaca lewat `items.get` item sumber, lalu disalin **apa adanya** (penanda jenis dan penanda ke stiker tertentu, tanpa disaring BU tujuan). Yang disalin hanya penanda (posisi, sasaran, catatan penanda); **catatan foto tidak ikut** (ditulis per item). Tidak ada rute baru.
- **Item nonaktif** tetap dihitung di `usageCount` dan tampil di `usages` (diberi tanda status), karena kunci asing `RESTRICT` menahan hapus gambar tanpa memandang status item; menghitung yang lain akan membuat jumlah dan galat hapus tidak sejalan. Item tidak pernah dihapus, jadi gambar yang dipakai item arsip memang tetap tertahan.
- **`items.save` bersifat PUT utuh** seperti field item lainnya: `stickerPhotos` wajib ada pada input (daftar kosong = tidak ada instruksi; tidak ada makna "tidak diubah"); klien dan server dirilis bersama. Perubahan yang hanya menyentuh instruksi tetap menaikkan versi item dan memakai pemeriksaan hak BU yang sama dengan pengeditan biasa.

## 4. Diserahkan kepada pembangun

Bentuk komponen editor (cara menyeret, tata letak popover), nama tipe/DTO yang tepat, indeks pendukung filter, dan strategi kursor `usageDesc` (mis. jumlah berubah antar halaman dapat melewatkan atau menggandakan baris; dapat diterima bila didokumentasikan).

## 5. Risiko dan peluncuran

- Migrasi `0007` hanya menambah tabel (expand-only); image sebelumnya tetap berjalan, hanya tidak melihat instruksi baru.
- Rilis ini berhenti membaca/menulis `items.stickers`; isi lama tidak tampil lagi (keputusan 1). Kolom dihapus di rilis berikutnya.
- Catatan rilis (review akhir M8): tab browser yang masih memuat bundel sebelum rilis mengirim `stickers` tanpa `stickerPhotos` sehingga setiap simpan item di tab itu ditolak (422) sampai halaman dimuat ulang; klien dan server dirilis bersama, tidak ada mode kompatibel. Pengguna diminta memuat ulang halaman setelah rilis.
- Filter per stiker memerlukan pencocokan jenis→stiker di SQL; bila lambat pada ribuan item, tambah indeks `item_sticker_marks (sticker_id)` dan `(type_id)`.
