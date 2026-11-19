# Business Unit (BU): fondasi pembatasan data — desain tahap 1

Status: disetujui pemilik produk 2026-11-08 ("lanjut pengerjaan BU"); rencana implementasi: `docs/superpowers/plans/2026-11-08-business-unit-tahap-1.md`. Tanggal: 2026-11-08.
Cabang kerja: `feat/stiker-management` (dari `origin/dev`).
Diperbarui 2026-11-12: tahap 5 (Serial Number) sudah dibahas dan dirancang di `docs/superpowers/specs/2026-11-12-serial-number-design.md` (disetujui pemilik): serial unik **se-sistem** (diubah pemilik 2026-11-18; semula per BU), modul izin ber-BU `serial` dan `serialservice`, bus event kecil di dalam proses (butir 22 terpenuhi). Diperbarui 2026-11-09 (lagi): bus event ditunda ke tahap 5 (keputusan 22). Diperbarui 2026-11-09: tidak ada backfill hak lama (keputusan 14); ekspor Sheets dikecualikan (16); jawaban berkas lintas BU disamakan (17); unggahan tertunda hanya untuk pengunggahnya (18); §5.3, §5.7, anti-tujuan, dan log keputusan disesuaikan.

## 1. Latar dan tujuan

Pemilik produk ingin fitur **Stiker Management** (katalog stiker, stok per lokasi, instruksi penempelan per item dengan penanda stiker pada gambar, kelak pemotongan stok otomatis saat Serial Number dicatat). Fitur itu tidak dikerjakan sekaligus. Seluruhnya dipecah menjadi tahap (bagian 2), dan **dokumen ini hanya mencakup tahap 1: fondasi BU**.

Mengapa BU lebih dulu: perusahaan punya beberapa Business Unit (setidaknya 3; stiker segel berbeda per BU). Data item, stiker, dan kelak Serial Number harus **dibatasi menurut BU** milik user, dan hak seorang user boleh berbeda per BU (di BU A hanya boleh sebagian aksi, di BU B boleh semuanya). Pembatas itu harus ada sebelum data stiker dan Serial Number dibuat, supaya tidak perlu dibongkar belakangan.

Tolok ukur berhasil: seorang user hanya pernah menerima, dari server, data item milik BU yang boleh ia lihat, dengan level aksi sesuai BU itu; pemilik produk dapat mengatur BU dan penugasan BU user tanpa menyentuh kode; dan tahap berikutnya (stiker, Serial Number) dapat memakai kerangka yang sama tanpa mengubahnya.

## 2. Peta tahap (hanya tahap 1 yang dicakup dokumen ini)

| Tahap | Isi |
|---|---|
| **1. Fondasi BU** | Master BU; penugasan BU per user dengan role per BU; kerangka izin generik "modul ber-BU"; relasi item↔BU; BU bawaan pada merk; komponen `LinkField` untuk Merk dan BU di form item. |
| 2. Event-driven (**ditunda ke tahap 5**, keputusan 22) | Bus event di server. Pendengar bisa dijalankan dalam satu request atau dimasukkan ke antrean (setara Event Listener Laravel; runner job yang ada menjadi calon dasar antrean). Tidak dibangun sebelum tahap 5; dirancang bersama pembahasan Serial Number. |
| 3. Stiker (dipecah **3a katalog dan stok** dan **3b instruksi penempelan**, keputusan 23; spek 3a: `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md`) | Katalog stiker (QC hijau, QC putih, Segel per BU, Country Lock, Warning Frekuensi, Warning Unifi, Manual Book, Postel; masing-masing satu gambar contoh), stok per lokasi dengan stok minimum dan riwayat, instruksi penempelan per item, penanda stiker pada gambar (satu gambar boleh memuat banyak stiker). |
| 4. Manual Book dan Postel (dipecah **4a Manual Book dan Konfigurasi Stiker** dan **4b Postel**; spek 4a: `docs/superpowers/specs/2026-11-10-stiker-manual-book-4a-design.md`, dibangun) | **4a**: preset QR per BU dan konfigurasi QR berbasis item menjadi sumber Manual Book (beberapa tipe item berbagi satu Manual Book; stiker berversi lahir dari ekspor, versi lama `deprecated`), gambar contoh dari hasil ekspor QR, halaman Konfigurasi Stiker dan email ringkasan harian stok menipis. `BU_MODULES` tidak berubah (modul QR tetap global). **4b**: Postel (pengelompokan item, isian sertifikat, peringatan masa berlaku; dibangun 2026-11-12, spek `docs/superpowers/specs/2026-11-11-stiker-postel-4b-design.md`). Stok pada tahap ini diubah manual (belum ada pemotongan otomatis). |
| 5. Serial Number | Pencatatan Serial Number (dibatasi BU) dan pemotongan stok stiker, Manual Book, dan Postel otomatis lewat event. Sengaja dikerjakan terakhir; pembahasan tersendiri sudah dilakukan dan desainnya disetujui pemilik 2026-11-12 (`docs/superpowers/specs/2026-11-12-serial-number-design.md`; dibangun bertahap 5a, 5b, 5c). |

## 3. Keputusan pemilik produk (dicatat 2026-11-08)

1. Stok dan aturan potong stok dikerjakan **di dalam kode proyek ini**, bukan di prosedur tersimpan MySQL QC Desktop.
2. Sistem **event-driven** diterapkan agar fitur tidak saling bersentuhan langsung (semula tahap 2; ditunda ke tahap 5 oleh keputusan 22, tujuannya tetap).
3. **BU dikerjakan lebih dulu** sebagai fondasi stiker dan item.
4. Item dan stiker punya BU lewat **tabel penghubung** (banyak-ke-banyak), bukan kolom JSON.
5. BU **membatasi data**, bukan sekadar label.
6. Hak BU user **berdiri sendiri dari lokasi**: berlaku sama di semua lokasi. Namun setiap BU boleh membawa hak yang berbeda (contoh: di BU A hanya sebagian aksi, di BU B semua).
7. **Handover tidak dibatasi BU**, hanya lokasi (tetap seperti sekarang).
8. **Merk** mendapat field BU bawaan.
9. Field referensi di form (Merk, BU) memakai komponen seperti `LinkModel` di erp_pataya: memilih record yang sudah ada, bisa membuat record baru lewat dialog, dan pilihan ganda tampil sebagai chip.
10. Fitur pencatatan Serial Number kelak juga dibatasi BU; kerangka izin BU harus generik. Pencatatan Serial Number dikerjakan **setelah Manual Book dan Postel** (tahap 5, diputuskan 2026-11-08) dan pembahasan tersendiri sudah dilakukan: desainnya disetujui pemilik 2026-11-12 (`docs/superpowers/specs/2026-11-12-serial-number-design.md`); serial **unik se-sistem** (diubah pemilik 2026-11-18; semula unik per BU: serial yang sama di BU lain kini menjadi cek ulang pada catatan yang sama, dengan riwayat BU di `serial_business_units`, spek `2026-11-18-serial-unik-sistem-design.md`), dengan modul izin ber-BU `serial` (tim QC) dan `serialservice` (tim servis).
11. Saat rilis tidak ada item di staging maupun production, jadi **tidak ada migrasi data item**.
12. **Modul sinkron QC Desktop lama dihapus** (diputuskan 2026-11-08, pemilik produk): QC Desktop dibuat ulang dengan Electron di monorepo ini dan tidak memakai kontrak lama. Rute `/api/v1/sync/*`, `SYNC_API_TOKEN`, kolom `sync_rev` (brands, items), tabel `sync_state`, dan `docs/api/desktop-sync.md` dihapus (migrasi `0002_hapus_sync_rev.sql`, cabang `chore/hapus-sinkron-desktop`, mendahului tahap 1). Karena itu tahap 1 tidak punya jalur sinkron yang perlu difilter BU; bentuk kabel dan otorisasi BU untuk Desktop baru dibahas saat Desktop dirancang (`docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md`).
13. **Mengubah item yang berada di beberapa BU** hanya boleh dilakukan user yang berhak ubah pada **semua BU item itu** (diputuskan 2026-11-08).
14. **Tidak ada backfill hak lama** (diputuskan 2026-11-09, pemilik produk): staging dan production belum punya data merk maupun item, jadi hak `item` pengguna lama tidak dimigrasikan ke penugasan BU. Setelah rilis, user lama tidak punya penugasan BU (tidak melihat item apa pun) sampai pemegang `access: manage` menugaskan BU kepadanya lewat form user; super admin (`ADMIN_EMAIL`) tetap berhak penuh. Ini menegaskan keputusan 11 (tidak ada migrasi data) dan menggantikan rancangan awal §5.7 (satu penugasan Semua BU hasil gabungan role lokasi) yang telah dibuang.
15. **Field `buAssignments` wajib ada saat menyimpan user** (diputuskan 2026-11-09, pemilik produk): permintaan `access.users.save` tanpa `buAssignments` ditolak `VALIDATION` (422), tidak dianggap "pertahankan penugasan yang ada". Alasan: rilis ini mengubah sistem izin; admin dengan tab web lama yang terbuka saat deploy harus memuat ulang agar tidak menyimpan user dari form yang belum mengenal penugasan BU. Dijaga `validate.test.ts` dan `rest.test.ts`.
16. **Ekspor Sheets tidak difilter BU** (diputuskan 2026-11-09, pemilik produk): fitur ekspor Sheets belum dibutuhkan saat ini, jadi `exports.sheets` (hanya `access: manage`) tetap mengekspor seluruh item dan dicatat sebagai pengecualian (d) anti-tujuan. Akan ditinjau bersama fitur Serial Number.
17. **Jawaban berkas lintas BU disamakan** (diputuskan 2026-11-09, pemilik produk): `items.save` yang memasang berkas milik item di BU yang tidak terlihat user dijawab `VALIDATION` seperti berkas tidak dikenal, agar keberadaan berkas lintas BU tidak bisa diuji.
18. **Unggahan yang belum terpasang hanya untuk pengunggahnya** (diputuskan 2026-11-09, pemilik produk): berkas tanpa pemilik (baru diunggah, belum melekat pada item) hanya dapat dibaca dan dipasang oleh pengunggahnya; user lain mendapat `NOT_FOUND` saat membaca (`files.get`) dan `VALIDATION` seperti berkas tak dikenal saat memasang. Berlaku untuk jalur item DAN jalur QR (pustaka logo `qrcodes.saveLogoLibrary`, desain QR): keputusan awal yang mengecualikan QR dibatalkan pemilik produk pada 2026-11-09 setelah review keamanan, karena UI QR mengunggah dan menyimpan pustaka logo oleh manager yang sama. Berkas yang sudah terpasang pada item dan dikirim ke jalur QR dijawab `VALIDATION` seperti berkas tak dikenal (bukan `CONFLICT`). Unggahan item yang tak pernah terpasang BELUM dibersihkan otomatis (hanya dibatasi 50 unggahan menggantung per user); pembersihannya dikerjakan sebagai tugas terpisah di luar BU (diputuskan pemilik 2026-11-09).
19. **BU bawaan merk dibatasi maksimal 50 per merk** (diputuskan 2026-11-09, pemilik produk): batas ukuran kueri yang dijaga validator `brands.save` dan `body.test.ts`.
20. **`LinkField` berupa input teks pencarian dengan chip di dalam input** (diputuskan 2026-11-09, pemilik produk, setelah uji manual di dev): menggantikan bentuk tombol + popover; lihat §5.5.
21. **Tambah dan Buka pada `LinkField` mengikuti `LinkModel` erp, dengan izin** (diputuskan 2026-11-09, pemilik produk): aksi "Tambah {label}" berupa baris di dasar daftar saran (bukan tombol di samping input) dan ada juga di mode banyak pilihan; "Buka" (tombol panah pada mode satu pilihan, label chip pada mode banyak pilihan) mengarah ke **halaman lihat record** (`/item/brands/:id`, `/access/business-units/:id`), bukan ke daftar. Keduanya hanya muncul bila user berhak: Buka merk = `item: view`, Buka BU = `access: view`, Tambah merk = `item: edit`, Tambah BU = `access: manage`. Konsekuensi: dua halaman lihat baru (baca-saja, tanpa rute server baru), dan field BU di form item mendapat dialog "Tambah BU" (BU baru langsung terpilih). Menggantikan butir §5.5 sebelumnya bahwa tombol Tambah/panah berada di samping input.
22. **Bus event (tahap 2) ditunda dan digabung ke tahap 5** (diputuskan 2026-11-09, pemilik produk; [terpenuhi 2026-11-12: bentuknya ditetapkan di `docs/superpowers/specs/2026-11-12-serial-number-design.md` §6, pendengar stok sinkron dalam batch yang sama dan email lewat antrean runner job]): satu-satunya pemakai yang dibayangkan saat ini adalah pemotongan stok otomatis saat Serial Number dicatat (tahap 5); tahap 3 dan 4 mengubah stok manual dan tidak membutuhkannya. Alasan memilih event-driven (kebiasaan dengan Event Listener Laravel) tetap berlaku sebagai arah, tetapi bentuknya (pendengar sinkron dalam satu transaksi dengan pencatatan Serial Number atau pendengar antrean lewat runner job; jaminan tak ganda dan tak hilang pada potong stok) baru dapat diputuskan setelah aturan potong stok dibahas, jadi tidak dibangun lebih dulu sebagai kerangka tanpa pemakai. Urutan pengerjaan menjadi: tahap 3 (Stiker), tahap 4 (Manual Book dan Postel), lalu bus event bersama tahap 5. Peta §2 dan keputusan 2 disesuaikan; tidak ada kode yang berubah.
23. **Tahap 3 dipecah 3a dan 3b; stiker dan stok tidak dibatasi BU** (diputuskan 2026-11-09, pemilik produk): 3a = katalog (jenis dan stiker, dapat ditambah dan dinonaktifkan) dan stok per lokasi dalam butir dengan riwayat, stok opname, batas minimum, dan penanda menipis; 3b = instruksi penempelan (pustaka gambar, penanda gaya tag foto, tampilan label di detail item, menggantikan total daftar stiker lama di item). Stiker dan stok **tidak dibatasi BU** (kecuali batas lokasi untuk stok); tautan BU pada stiker hanya untuk menentukan stiker yang berlaku bagi item. Ini mempersempit keputusan 5 ("BU membatasi data") untuk domain stiker; keputusan 5 tetap berlaku untuk item. Rincian dan pilihan perancang: spek 3a dan catatan 3b di dalamnya.
24. **Semua field relasi di form memakai `LinkField`/`LinkMultiField`** (diputuskan 2026-11-10, pemilik produk, setelah menemukan field Jenis di form stiker memakai `NativeSelect`): setiap field form yang merujuk record model/tabel lain (merk, BU, jenis stiker, preset QR, role, lokasi pada penugasan user, dst.) memakai komponen itu, bukan `NativeSelect`, daftar checkbox, atau teks bebas; ini memperluas keputusan 20-21 yang semula hanya mencakup Merk dan BU di form item. Pengecualian yang disetujui pemilik produk pada 2026-11-10 (jawaban "setuju semua usulan"): enum/daftar tetap (kini dipasang lewat `Select`/`MultiSelect`, butir 25), filter halaman daftar yang bukan relasi, pemilih visual (`LogoPicker`, `ImagePicker`), dan `CustomerCombobox` (teks bebas, customer dibuat otomatis saat task disimpan, FC2; alasan: `LinkField` hanya menerima record yang sudah ada). Aturan Tambah/Buka yang disetujui: model tanpa halaman lihat (jenis stiker, preset QR, lokasi, role) tidak punya tombol Buka dan tidak dibuatkan rute baru; Tambah hanya bila sudah ada dialog tambah (jenis stiker, BU) dan user berhak (`sticker: edit`, `access: manage`); Tambah lokasi/role/preset dari form lain tidak dibuat. `LocationField` ikut aturan ini dengan isinya diganti `LinkField` (API props tetap; logika izin tulis dan lokasi aktif tetap; tanpa Tambah dan Buka; nilai di luar pilihan tulis tetap tampil lewat `labelOf`). Izin Tambah/Buka dipusatkan di `web/src/lib/link-access.ts`. Penerapan: Jenis di form stiker, preset QR (form QR dan dialog "Perbarui sesuai konfigurasi default"), lokasi/BU/role pada penugasan form user, serta Buka/Tambah BU di form stiker dan form merk.
25. **Komponen pilihan tetap `Select`/`MultiSelect` menggantikan `NativeSelect`; filter relasi di halaman daftar memakai `LinkField`** (diputuskan 2026-11-11, pemilik produk, atas permintaan mengubah bentuk komponen select mengikuti `RimbunCode/erp_pataya` dan memastikan field yang terhubung ke model lain selalu memakai `LinkField`): (a) `web/src/components/select.tsx` (`Select` satu pilihan, `MultiSelect` banyak pilihan) dibangun di atas inti `web/src/components/combobox.tsx` yang sama dengan `LinkField`: input yang menyaring daftar saat diketik dengan kata cocok disorot, tombol X opsional (`clearable`), daftar di portal; `NativeSelect` dihapus. Dipakai untuk enum/daftar tetap (status, aturan, cara input, urutan, aksi audit, mode filter). (b) Pengecualian "filter di halaman daftar" pada butir 24 DICABUT untuk filter yang nilainya merujuk record model lain: "Filter jenis" (halaman Stiker) dan "Filter stiker atau jenis" (halaman Item) kini `LinkField` (`localFilter`, kosong = tombol X; opsi jenis/stiker berurutan per jenis dengan nama jenis sebagai deskripsi, menggantikan pengelompokan `<optgroup>`); filter enum tetap memakai `Select`. Pengecualian lain pada butir 24 (pemilih visual, `CustomerCombobox`) tidak berubah.
## 4. Lingkup tahap 1

### Termasuk
- Tabel dan modul server `business-unit` (master BU) beserta halaman kelolanya di web.
- Penugasan BU pada user (di form user modul akses) dan kerangka izin berbasis BU.
- Relasi item↔BU, filter BU di semua jalur baca item, aturan tulis item menurut BU.
- BU bawaan pada merk.
- Komponen `LinkField` (satu pilihan dan banyak pilihan) dan pemakaiannya di field Merk dan BU form item.
- Pembaruan dokumen: PRD item, `CLAUDE.md`, dan catatan keputusan di bagian 3 ini pada PRD terkait (`docs/api/desktop-sync.md` sudah dihapus, lihat keputusan 12).

### Bukan tujuan (non-goals)
- Stiker, stok, Serial Number, bus event, penanda pada gambar, Manual Book, Postel.
- Sinkron QC Desktop (modul lama sudah dihapus, keputusan 12; Desktop baru dibahas terpisah).
- Pembatasan BU pada handover, QR Code, customer, atau merk (merk hanya menyimpan BU bawaan; daftar merk tetap global).
- Mengubah sistem izin lokasi yang ada.

### Anti-tujuan (dianggap gagal walau secara teknis jalan)
- Data item bocor lintas BU lewat jalur mana pun yang dipakai **user**: daftar, jumlah, detail, pencarian, berkas gambar item, OpenAPI, atau `GET /api/v1/me`. Pengecualian yang disengaja: (a) log audit tetap terlihat utuh oleh pemegang `access: view` (administrator); (b) angka `item_count` pada halaman Merk tetap total global (angka saja, tanpa identitas item); (c) tidak ada pengecualian untuk sinkron: modul sinkron lama sudah dihapus (keputusan 12), jadi tidak ada jalur token tanpa user yang melewati filter BU; (d) ekspor ke Google Sheets (`exports.sheets`, hanya `access: manage`) tidak difilter BU (keputusan 16).
- Item yang tidak terlihat oleh siapa pun karena tidak punya BU.
- Melemahkan izin lokasi yang sudah ada. (Hak `item` user lama tidak dimigrasikan; disengaja dan tidak ada data yang terdampak, lihat keputusan 14.)

## 5. Desain

### 5.1 Master BU
- Tabel `business_units`: `id`, `code` (unik, pendek), `name`, `name_key` (unik, huruf kecil), `status` (`active`/`inactive`), kolom audit (`created_at`, `updated_at`, `updated_by`). Mengikuti pola tabel `locations` dan modul `server/src/modules/access/location-service.ts`.
- Dikelola di modul izin `access` (lihat: `access: view`, ubah/nonaktifkan: `access: manage`), sama seperti lokasi. BU nonaktif tidak bisa dipilih untuk data baru tetapi tetap tampil pada data lama.
- BU tidak dihapus (hanya dinonaktifkan), sama seperti lokasi.
- Perubahan BU dicatat di log audit yang ada (`core/audit.ts`).

### 5.2 Penugasan BU dan izin
- Kolom baru `users.bu_assignments` (JSON, pola sama dengan `users.assignments`): daftar `{ buId: string | null, roleIds: string[] }`. `buId = null` berarti **Semua BU**. Berlaku di semua lokasi.
- Daftar **modul ber-BU** didefinisikan di `shared/business-units.ts` (`BU_MODULES`, setara `LOCATION_MODULES`). Tahap 1: `['item']`. Tahap berikutnya menambah stiker, Manual Book/Postel, dan Serial Number tanpa mengubah kerangka.
- Hanya modul ber-BU yang dibaca dari role pada penugasan BU. Role pada penugasan BU **tidak** memberi izin modul lain (`access`, `handover`, dst.).
- `item` dikeluarkan dari `SHARED_MODULES` (yang sekarang dihitung dari semua penugasan lokasi). `qrcode` tetap `SHARED_MODULES`.
- `resolveAccess` menambah hasil `byBu: Record<buId, Record<BuModule, Level>>`: gabungan role penugasan "Semua BU" dan penugasan BU itu (level tertinggi per modul, seperti gabungan lokasi sekarang).
- **Level global `item`** dipakai halaman yang tidak ber-BU (Merk, Customer): sama dengan level tertinggi di antara seluruh penugasan BU user (gaya `SHARED_MODULES`). Daftar BU dan level per BU ikut di `GET /api/v1/me`.
- User tanpa penugasan BU tidak melihat item apa pun (BU terlihat = himpunan kosong).
- UI: form user (modul akses) mendapat bagian "Penugasan BU" (pilih BU atau Semua BU, lalu role-nya), terpisah dari "Penugasan lokasi".

### 5.3 Relasi item↔BU
- Tabel penghubung `item_business_units` (`item_id`, `bu_id`, kunci utama gabungan, indeks pada `bu_id`).
- Setiap item wajib punya minimal satu BU aktif.
- Jalur baca (daftar, jumlah, pencarian, detail, ekspor, OpenAPI) hanya menyertakan item yang beririsan dengan BU yang boleh dilihat user (level ≥ `view` pada BU itu), lewat `EXISTS`/`JOIN` di SQL, bukan filter di klien. Detail item di luar hak = `NOT_FOUND`, bukan "dilarang", agar keberadaan item tidak bocor.
- **Satu item = satu record, boleh punya banyak BU** (keputusan pemilik 4: multi-select). Keunikan `items.key` (merk + tipe) dan kunci alias tetap global; item yang sama tidak diduplikasi per BU. User yang mencoba membuat item yang kuncinya sudah ada (di BU mana pun) mendapat galat konflik generik "item dengan merk dan tipe ini sudah ada" tanpa menyebut BU atau isinya (bocor hanya sebatas fakta bahwa kombinasi itu ada; dianggap wajar karena mencegah duplikat).
- **Berkas gambar item** (`files.get` untuk berkas milik item) memakai pemeriksaan BU yang sama dengan detail item (cari BU lewat pemilik berkas; pelaksana menjaga jalur cache tetap murah). Berkas bukan milik item tidak berubah, kecuali **unggahan yang belum terpasang pada pemilik mana pun**: hanya pengunggahnya yang dapat membaca dan memasangnya, user lain mendapat `NOT_FOUND` seperti berkas tidak ada (keputusan 18). Mencoba memasang berkas milik item BU lain dijawab `VALIDATION` seperti berkas tidak dikenal, bukan `CONFLICT` (keputusan 17; berlaku juga di jalur QR).
- **BU nonaktif:** tidak bisa ditambahkan ke item atau merk, tetapi BU nonaktif yang sudah melekat tetap **memberi** hak lihat/ubah atas item lamanya dan tetap dihitung untuk aturan "minimal satu BU". Menonaktifkan BU tidak diblokir, hanya menampilkan peringatan berisi jumlah item dan user yang masih memakainya.
- **Jalur tulis (keputusan 13):** item yang punya beberapa BU hanya boleh diubah oleh user yang berhak pada **semua** BU item itu (level `edit` atau lebih di setiap BU yang melekat). Aksi `manage` (nonaktifkan item) mengikuti aturan yang sama dengan `edit`. Sebagai konsekuensinya (keputusan saya): user hanya boleh menambahkan BU yang ia sendiri berhak ubah, dan boleh melepas BU mana pun yang sudah melekat karena ia pasti berhak di semuanya. Item dengan satu BU diubah oleh user yang berhak ubah di BU itu.
- Tulis ke tabel penghubung dan ke `items` berada dalam satu `batch()`/transaksi dengan penjaga CAS yang sudah ada; `updated_at` item ikut diperbarui bila himpunan BU berubah.

### 5.4 BU bawaan pada merk
- Tabel penghubung `brand_default_business_units` (`brand_id`, `bu_id`): merk boleh punya **nol atau lebih** BU bawaan. Daftar merk tetap global. Siapa pun yang boleh mengubah merk (level `item` global `edit` ke atas) boleh mengatur BU bawaan, dengan BU aktif mana pun (BU bawaan hanya mengisi otomatis dan tidak memberi hak). BU bawaan hanya dipakai di sisi server dan web. Merk tanpa BU bawaan: field BU di form item kosong dan diisi manual.
- Pada form item, memilih Merk mengisi BU item dari BU bawaan merk **bila user belum memilih BU secara manual**; tetap bisa diubah. BU bawaan di luar hak user disaring, bukan ditolak diam-diam.

### 5.5 Komponen `LinkField` (web)
Perilaku mengikuti `LinkModel` erp_pataya, diadaptasi ke pola proyek ini (TanStack Query, shadcn, tanpa `axios`/model-name generik di server):
- **Bentuk (keputusan 20, 2026-11-09, disetujui pemilik produk setelah uji manual di dev):** field adalah **input teks yang sekaligus menjadi kolom pencarian**, bukan tombol yang membuka popover berisi kolom cari. Mengetik langsung di field mencari dan daftar saran muncul tepat di bawahnya. Pada mode banyak pilihan, **chip terpilih berada di dalam kotak input** (gaya tags-input; Backspace pada input kosong melepas chip terakhir). Alasan: popover dua langkah (buka lalu cari) terasa berat, dan implementasi popover gagal memilih opsi dengan klik mouse serta menutup dialog induk saat Escape.
- Nilai = **record yang sudah ada** (bukan teks bebas). Mengetik hanya mencari; teks tanpa pasangan dikosongkan saat daftar tertutup.
- Pencarian sisi server dengan debounce, batas hasil + petunjuk "ada lagi".
- Aksi **tambah** (keputusan 21) = baris "Tambah {label}" di dasar daftar saran (dapat dicapai dengan keyboard); membuka dialog form master, dan setelah sukses record baru langsung terpilih. Baris hilang bila user tidak punya izin membuat.
- Tombol **panah** (mode satu pilihan) membuka halaman lihat record di tab baru dan hanya ada bila user berhak melihatnya; tombol **X** mengosongkan.
- Mode **banyak pilihan**: nilai terpilih tampil sebagai chip yang bisa dilepas; **label chip adalah tautan** ke halaman lihat record (tab baru, hanya bila user berhak melihatnya), dan baris Tambah tersedia juga.
- Dukungan filter ketergantungan antarfield dan penanda perubahan (diff) disediakan bila dibutuhkan; tidak wajib ada di tahap 1.
- Sumber data diberikan lewat properti (fungsi `queryOptions` per pemakaian), bukan nama model generik, agar tiap sumber tetap lewat jalur REST ber-izin.
- Dipakai di tahap 1 untuk: Merk (satu pilihan, dialog "tambah merk") dan BU (banyak pilihan, di form item).
- Konsekuensi untuk Merk: **merk baru tidak lagi lahir diam-diam dari teks yang diketik** saat item disimpan; merk baru dibuat lewat dialog "tambah". Pembuatan lewat dialog memakai level izin yang sekarang berlaku untuk membuat merk.

### 5.6 Sinkron QC Desktop
- Modul sinkron lama sudah dihapus (keputusan 12), sehingga tahap 1 tidak menyentuh sinkron dan tidak ada celah push/pull yang melewati filter BU. Desain sinkron Desktop Electron (termasuk bentuk kabel dan hak BU) dibahas bersama Desktop baru.

### 5.7 Migrasi skema dan data pengguna
- Migrasi baru (`server/migrations/NNNN_…`), idempoten dan kompatibel mundur (tambah tabel/kolom saja; sesuai aturan expand→contract di `CLAUDE.md`).
- **Bootstrap:** tidak ada BU awal (seed). Pemegang `access: manage` membuat BU pertama lewat halaman BU sebelum item bisa dibuat. "Semua BU" berarti seluruh BU yang ada sekarang dan yang dibuat kemudian.
- **Pengguna lama (keputusan 14, 2026-11-09): tidak ada backfill.** `item` tidak lagi dihitung dari penugasan lokasi dan `users.bu_assignments` kosong dibaca sebagai tanpa penugasan BU. Karena staging dan production belum punya merk atau item, tidak ada data yang hilang aksesnya; pemegang `access: manage` menugaskan BU kepada user lewat form user. Tidak ada kode migrasi data, hanya DDL.

## 6. Kendala dan konvensi yang wajib diikuti
- Aturan server di `CLAUDE.md`: adaptor `Db`, CAS di `batch()`, kolasi `utf8mb4_nopad_bin` dengan kolom `key`/`name_key`, tes memakai MariaDB sungguhan dan tes konkurensi `Promise.all`.
- `shared/` murni tanpa API runtime/DOM; kabel REST lewat satu tabel `API_ROUTES` (`shared/api.ts`) dan kontrak `shared/rpc.ts`; rute baru wajib punya tes REST.
- Komponen UI dari shadcn; server state TanStack Query; form TanStack Form + zod.
- Setiap rute BU memakai `permission` yang tepat dan lolos `authorize` sebelum badan dibaca.
- Variabel konfigurasi baru (bila ada) wajib di `deploy/compose.yml` dan `deploy/.env.example`.
- Pengerjaan mengikuti alur proyek: PR ke `dev` (staging), lalu `main` (production).

## 7. Diserahkan kepada pelaksana
Nama berkas/modul, nama kolom dan indeks persis, bentuk DTO, desain visual halaman BU dan bagian penugasan BU di form user, teks galat, detail debounce/batas hasil `LinkField`, urutan tugas, dan strategi tes.

## 8. Pertanyaan terbuka dan keputusan saya

### Pertanyaan terbuka untuk pemilik produk
- ~~O1. Aturan ubah item yang berbagi beberapa BU~~ **Selesai** (keputusan 13, 2026-11-08, bagian 3).
- ~~O2. Sinkron QC Desktop~~ **Selesai** (keputusan 12, 2026-11-08): modul sinkron lama dihapus; sinkron Desktop baru dibahas terpisah.
- ~~O3. `LocationField` ikut aturan keputusan 24?~~ **Selesai** (keputusan 24, 2026-11-10): ya, isinya diganti `LinkField`.
- ~~O4. Tambah BU/lokasi/role dari form user?~~ **Selesai** (keputusan 24, 2026-11-10): tidak dibuat; form user memakai `LinkField` tanpa baris "Tambah" (lokasi dan role belum punya dialog tambah, dan tambah dari form lain dikecualikan oleh pemilik).
- O5. **Enter pada `LinkField` yang daftarnya tertutup mengirim form induk** (mis. Enter kedua di form user setelah memilih). Perilaku lama sejak form item; menyeragamkannya dengan klaim "tidak pernah mengirim form" mengubah perilaku komponen bersama, jadi menunggu pemilik.

### Keputusan yang diambil setelah pemeriksaan pembaca (silakan koreksi)
- Satu item boleh punya banyak BU; keunikan merk+tipe tetap global; konflik dijawab generik.
- Berkas gambar item mengikuti pemeriksaan BU item.
- BU nonaktif tetap memberi hak atas item lamanya, tidak bisa ditambahkan ke data baru, penonaktifan hanya diberi peringatan.
- Log audit tetap utuh untuk pemegang `access: view`; perubahan BU item tampil di diff audit item.
- `brands.item_count` tetap total global.
- Level global `item` (Merk dan Customer) = tertinggi di antara penugasan BU; artinya `manage` di satu BU saja sudah dapat mengubah merk dan customer yang bersifat global.
- BU bawaan merk: siapa pun yang boleh mengubah merk.
- Tidak ada BU awal; admin membuatnya.
- Keputusan pelaksana (rencana, Keputusan Plan #2-#7): `businessUnits.options` (izin `item: view`) untuk pemilih BU; `ItemSummaryDto`/`ItemDto` membawa `businessUnits` (`{id, code, name}`, semua BU item); `SaveItemInput.brandId` menggantikan nama merk; `LinkField` menerima `options` + `onSearchChange` sebagai properti; `BusinessUnitDto.userCount` = user aktif yang berhak.

### Keputusan yang saya ambil (silakan koreksi)
- BU diatur di modul izin `access`, bukan modul baru.
- BU punya `code` dan `name` unik, status aktif/nonaktif, tanpa hapus.
- Penugasan BU user disimpan sebagai JSON `users.bu_assignments` (pola `users.assignments`), sedangkan relasi data (item, merk) memakai tabel penghubung sesuai permintaan.
- BU bawaan merk boleh banyak (nol atau lebih).
- Item wajib punya minimal satu BU.
- ~~Pengguna lama dimigrasikan ke penugasan **Semua BU** dengan gabungan rolenya, agar hak `item` tidak berubah saat rilis.~~ **Dibatalkan** oleh pemilik produk 2026-11-09 (keputusan 14): tidak ada backfill karena belum ada data merk/item di staging dan production.
- Detail item di luar hak BU dijawab `NOT_FOUND`.
