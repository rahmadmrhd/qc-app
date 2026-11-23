# Dashboard pemantauan (Serah Terima, Serial, Laporan, Stok) — desain

Tanggal: 2026-11-23. Status: **rancangan; K1, K4, K5 diputuskan pemilik produk 2026-11-23, K2 dan K3 disetujui pemilik pada hari yang sama; laporan terjadwal lewat surel (bagian 7a) ditambahkan 2026-11-23 dengan K6 diputuskan pemilik**. Rencana implementasi menyusul setelah dokumen disetujui.

## 1. Maksud dan alasan

Pemilik produk ingin satu halaman untuk **memantau** keadaan operasional lintas modul (Serah Terima, Serial Number, Laporan rusak, Stok stiker, Postel) tanpa membuka tiap modul satu per satu. Tiga pemakaian:

1. **Di dalam aplikasi**: pengguna login membuka `/dashboard`. Tiap komponen (widget) hanya tampil bila pengguna berhak atas modul sumbernya, dan datanya hanya dari BU dan Lokasi yang boleh ia baca.
2. **Tautan publik**: pengguna berwenang membagikan sebagian dashboard kepada siapa pun yang memegang tautan (tanpa login). Data yang dibagikan **terisolasi**: hanya yang masuk ke cakupan (BU, Lokasi, rentang tanggal, filter grup, dan daftar widget) yang dipilih saat membagikan. Penonton boleh **mengubah filter, tetapi hanya untuk mempersempit di dalam cakupan itu**; tak ada filter yang dapat memperluasnya (keputusan pemilik 2026-11-23, K1).
3. **Laporan terjadwal lewat surel** (permintaan pemilik 2026-11-23): pengguna berwenang membuat **beberapa** laporan, masing-masing dengan jadwal, penerima, periode, dan isi sendiri. Body surel berbentuk dashboard (kartu angka, grafik sederhana, daftar perhatian) dengan tombol ke tautan publik yang lengkap. Rincian di bagian 7a.

Komponen yang diminta: grafik (line, bar, pie, donut), number card, dan Quick List (tabel atau kartu). Filter **global** (BU, Lokasi, Tanggal) dan filter **per grup** widget dengan field lain (tidak boleh memakai field yang sama dengan filter global).

## 2. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- Satu halaman `/dashboard` dengan grup widget per modul, filter global dan filter per grup.
- Setiap widget dihitung server dari data hidup (soft delete tak dihitung) dan disaring izin + BU + Lokasi pengguna.
- Tautan publik yang bisa dicabut dan kedaluwarsa, dengan cakupan beku dan DTO daftar putih.
- Ramah ponsel; mode terang/gelap dan kontras mengikuti sistem desain yang ada.
- Laporan terjadwal lewat surel: banyak laporan, tiap laporan berkonfigurasi sendiri, body berbentuk dashboard dengan tombol ke tautan publik lengkap (bagian 7a).

**Bukan-tujuan (v1)**
- Tata letak yang disusun sendiri per pengguna (seret-lepas, sembunyikan widget). Tata letak tetap dari registry.
- Ekspor PDF/gambar. (Laporan terjadwal lewat surel TIDAK lagi bukan-tujuan: masuk cakupan sejak 2026-11-23, bagian 7a.)
- Modul Item sebagai grup widget (dapat ditambah belakangan lewat registry yang sama).
- Riwayat potret (snapshot) historis: tren dihitung dari data kejadian yang ada.
- Halaman publik di aplikasi desktop (Electron): tautan publik hanya dibuka di peramban.

**Anti-tujuan (dianggap gagal walau tampak berfungsi)**
- Penonton tautan publik bisa melihat data di luar cakupan beku (BU, Lokasi, rentang, widget, filter grup yang dibekukan) lewat manipulasi URL, query, body, atau header apa pun. Filter penonton hanya boleh **mempersempit** (irisan); hasil dengan filter penonton harus selalu himpunan bagian dari hasil tanpa filter itu.
- Tautan publik membocorkan surel pengguna, catatan atau komentar Serah Terima, foto, id berkas, atau alamat internal.
- Widget tampil untuk pengguna tanpa izin modulnya, atau menghitung baris di luar BU/Lokasinya.
- Tautan publik yang tak dapat dicabut.

## 3. Pendekatan yang dipertimbangkan

**Mesin widget (dipilih pemilik: pendekatan A).**
- A. **Mesin widget deklaratif**: registry metadata di `shared/`, satu rute `dashboard.query` yang menghitung widget yang diminta, halaman publik memakai mesin yang sama dengan cakupan dari baris `dashboard_shares`. Kelebihan: izin, penyaringan BU/Lokasi, dan isolasi publik ditegakkan di satu tempat; menambah widget = satu entri. Kekurangan: registry harus dirancang rapi di awal.
- B. Satu rute REST per widget. Ditolak: penyaringan diulang di tiap rute, versi publik menduplikasi semuanya, satu kelalaian = kebocoran.
- C. Potret yang dihitung saat membagikan. Ditolak: data cepat basi, padahal tujuannya memantau.

**Batas "deklaratif"** (konsekuensi aturan soft delete, `server/src/core/soft-delete-scan.ts`): registry di `shared/` hanya berisi **metadata** (id, grup, jenis visual, izin, filter global yang berlaku, field filter grup). **SQL tiap widget tetap kueri literal** di `server/src/modules/dashboard/widgets/*.ts` dengan `liveWhere(...)` di dalam literalnya. Dilarang membuat pembangun kueri generik (`FROM ${...}` dinamis dilaporkan pemindai dan penyaring yang dirakit lewat `where.push` tak terlihat olehnya; `soft-delete-guard.test.ts` gagal).

**Library grafik.** Komponen `chart` shadcn (di dalamnya `recharts`), dipasang lewat `bunx --bun shadcn@latest add chart` dari `web/`. Alasan: memakai variabel warna tema, sudah dikenal pemakai shadcn di proyek. Alternatif SVG buatan sendiri ditolak (banyak kode: sumbu, tooltip, legenda, aksesibilitas). Diwajibkan dimuat malas (potongan terpisah) dan masuk anggaran 600 KB gzip `verify-dist`.

**Token tautan publik.** Dua opsi: (i) token tanpa keadaan bertanda tangan seperti `public-link.ts` (tak dapat dicabut); (ii) token acak murni di basis data (dapat dicabut). Dipilih **gabungan**: token bertanda tangan **dan** baris `dashboard_shares` untuk pencabutan, karena aturan Kabel REST mewajibkan token bertanda tangan berkedaluwarsa untuk rute publik tanpa sesi, sedangkan pencabutan butuh keadaan.

## 4. Keputusan pemilik (K1-K11, semuanya sudah diputuskan atau disetujui)

Kesebelas butir ini mengubah apa yang dibangun, dan semuanya sudah diputuskan atau disetujui pemilik pada 2026-11-23. K1-K6 diputuskan sebelum pembangunan; K7-K11 diputuskan pemilik produk pada 2026-11-23 atas temuan review akhir Rencana 1 (butir yang bertentangan di bagian lain sudah diubah mengikutinya, bukan hanya diberi catatan).

| # | Pertanyaan | Bawaan usulan | Konsekuensi bila berbeda |
|---|---|---|---|
| K1 | Boleh penonton tautan menyempitkan filter? | **DIPUTUSKAN pemilik 2026-11-23: boleh, asalkan masih di dalam rentang/cakupan yang dibagikan.** Rincian di 7.3 dan 7.4 (penonton hanya mempersempit; nilai di luar cakupan diabaikan lewat irisan, tanpa galat yang membedakan). | — |
| K2 | Siapa boleh membagikan? (**DISETUJUI pemilik 2026-11-23**) | **Izin modul baru `dashboard` (global; level `none`/`manage`)**. `manage` = membuat dan mencabut tautan publik. Melihat dashboard TIDAK butuh izin ini (cukup izin modul sumber widget). Peran yang ada otomatis `none`. | Bila "siapa pun yang boleh melihat widgetnya": tanpa modul baru, tetapi pengguna level `view` dapat menerbitkan data perusahaan ke publik. |
| K3 | Quick List boleh tampil di tautan publik? (**DISETUJUI pemilik 2026-11-23**) | **Boleh**, dengan pratinjau + peringatan saat membagikan, maks. 10 baris, dan **daftar putih kolom** (bagian 7.4). Catatan/komentar Serah Terima, foto, dan surel pengguna tak pernah ikut. | Bila tidak: widget bertipe daftar tak dapat dipilih pada dialog Bagikan. |
| K4 | Masa berlaku tautan | **DIPUTUSKAN pemilik 2026-11-23: dapat dikonfigurasi saat membagikan.** Tetap wajib kedaluwarsa (aturan token bertanda tangan): pilihan 7/30/90/180/365 hari atau tanggal kustom, bawaan 30 hari; plafon 365 hari adalah pilihan saya sebagai pagar, dapat diubah pemilik. | Token memuat `exp`. |
| K5 | Definisi "stok menipis/habis" di dashboard | **DIPUTUSKAN pemilik 2026-11-23: dihitung PER LOKASI.** Satuannya pasangan (stiker, lokasi): menipis bila stok di lokasi itu <= minimum stiker (`min_qty`, sama untuk semua lokasi) dan minimum > 0 dan stok > 0; habis bila stok di lokasi itu <= 0. Hanya stiker aktif dan hanya pasangan yang punya baris di `sticker_stock` (stiker yang tak pernah distok di sebuah lokasi tidak dianggap habis di sana). Catatan: ini **berbeda** dari halaman Stok dan ringkasan harian, yang menghitung dari total semua lokasi (`isLowStock`/`stockDigestSection` di `shared/stickers.ts`, spek stiker 3a); halaman Stok dan surel TIDAK diubah oleh pekerjaan ini, jadi angkanya dapat berbeda dan kartu dashboard memberi keterangan "per lokasi". Karena tak ada perbandingan lintas lokasi, tautan publik tidak membocorkan stok lokasi di luar cakupan. | — |
| K6 | Penerima laporan terjadwal (7a) | **DIPUTUSKAN pemilik 2026-11-23: alamat surel bebas**, termasuk di luar perusahaan (bukan hanya akun terdaftar). Konsekuensi yang diketahui pemilik: isi surel dihitung dari hak PEMILIK laporan, bukan hak penerima, jadi penerima dapat menerima data yang tak akan ia lihat di aplikasi (termasuk baris Quick List, K3). Pemilik laporan bertanggung jawab atas isinya; form memperingatkan. | — |

| K7 | Warna perbandingan periode (delta) pada number card | **DIPUTUSKAN pemilik 2026-11-23: penanda arah baik per widget.** Metadata `deltaGood: 'up' \| 'down'` WAJIB pada setiap widget ber-delta (`shared/dashboard.ts`; widget tanpa delta tidak memilikinya). Panah dan kata ("naik"/"turun"/"tetap") selalu menurut perubahan nyata; WARNA menurut baik atau buruk: searah `deltaGood` = hijau (success), berlawanan = merah (destructive), tak berubah = netral. Nilai v1: `hs.created` naik = baik, `sn.recorded` naik = baik, `rp.opened` turun = baik (laporan rusak dibuka bertambah = memburuk, jadi "naik 50%" tampil merah). Alasan: satu aturan warna tetap menyesatkan untuk widget yang naiknya buruk; teks tetap menyebut arah sehingga tak bergantung warna. | Sebelumnya naik selalu hijau (usulan awal tanpa arah baik/buruk). |
| K8 | Keterangan "BU saat ini" | **DIPUTUSKAN pemilik 2026-11-23: ada di kartu.** Saat filter BU global aktif, kartu widget ber-BU (grup Serial Number dan Laporan) menampilkan penanda "BU saat ini" di samping penanda lain (mekanisme sama dengan "BU tidak berlaku"), karena angkanya memakai BU saat ini, bukan riwayat BU seperti daftar Serial (7.4 butir 5). | Tanpa penanda, angka dapat tampak berbeda dari daftar Serial tanpa penjelasan. |
| K9 | Daftar pilihan filter relasi | **DIPUTUSKAN pemilik 2026-11-23: dicari di server, bukan dipotong 500.** `dashboard.options` menerima masukan opsional aditif (8.2): `kind`, `query`, `cursor`, `limit` (1-100, bawaan 50), dan `ids` (maks. 20) untuk meresolusi nama nilai yang sudah terpilih atau berasal dari URL. Semuanya tetap dalam cakupan hak yang sama (id di luar hak tak mengembalikan nama). Rute tetap `dashboard.options` tanpa `@2` karena penambahannya aditif. Chip filter memakai `LinkMultiField` dengan `onSearchChange`/`hasMore` (aturan field relasi di `CLAUDE.md`). | Sebelumnya semua pilihan (maks. 500) dimuat sekali dan disaring di klien; record ke-501 dst. tak dapat dipilih. |
| K10 | Konkurensi, batas waktu, dan prioritas widget | **DIPUTUSKAN pemilik 2026-11-23:** (a) SEMAFOR GLOBAL PER PROSES (per pool basis data), maks. 6 widget berjalan bersamaan, antrean FIFO, dibagi semua permintaan, menggantikan batas "4 per permintaan" (8.1); modul bersama `server/src/modules/dashboard/limiter.ts` yang kelak juga dipakai laporan terjadwal (7a). (b) Batas waktu 15 detik per widget dihitung SETELAH slot diperoleh, sehingga menunggu antrean tidak menjadi galat palsu; slot dilepas saat widget selesai, gagal, atau melewati batas waktu. (c) Prioritas widget yang tampil: klien hanya meminta dan menyegarkan grup yang berada di dekat viewport (grup di luar layar tidak diminta dan tidak dimuat ulang sampai mendekat; tab tersembunyi tidak menyegarkan), server memproses widget menurut urutan permintaan. (d) Penyegaran mengikuti aturan halaman lain (default `query-client.ts`: berhenti saat tab tersembunyi, muat ulang saat fokus bila basi, galat server dicoba sekali lagi); dashboard tetap menimpa selang menjadi 60 detik karena kueri agregat berat dan cache server 30 detik, widget gagal tidak di-cache sehingga dicoba lagi pada muat ulang berikutnya. | Sebelumnya hingga 5 x 4 = 20 widget bersamaan per halaman terhadap pool 10 koneksi, dan widget yang antre dapat gagal palsu karena batas waktu. |
| K11 | Bentuk keluaran `dashboard.query` | **DIPUTUSKAN pemilik 2026-11-23: array berurutan** `widgets: WidgetResult[]` sesuai urutan permintaan, BUKAN peta `{ [id]: WidgetResult }` (8.2). Alasan: kode dan rencana implementasi sudah memakai array, potret kontrak sudah dibuat, dan urutan array berguna untuk urutan widget di laporan surel (7a). Klien memetakan ke `Map` bila perlu. | Peta berarti mengubah kontrak yang sudah dipotret. |

Pilihan saya sendiri yang dapat dipotong pemilik tanpa mengubah arsitektur: delta "vs periode lalu" pada number card berperiode, rentang tanggal bergulir ("N hari terakhir") pada tautan, grup Postel, dan beberapa widget di katalog (bagian 6).

## 5. Perilaku di dalam aplikasi

### 5.1 Halaman dan navigasi
- Rute `/dashboard` (di bawah `_app`), butir sidebar "Dashboard" tepat di bawah Beranda. Beranda tetap peluncur.
- Butir menu tampil bila pengguna berhak atas minimal satu widget (`permission` `anyOf` modul-modul sumber). Server tetap pihak berwenang: widget tanpa izin tidak dikembalikan.
- Halaman bukan `ListPage`/`ViewPage`/`FormPage`, jadi masuk `ROUTE_EXCEPTIONS` di `scripts/page-frame.test.ts` dengan alasan (halaman agregat, pola yang sama dengan Beranda), tetap memakai `HeadroomFrame`/`HeadroomBar` untuk bar filter. Lebar penuh `<main>`.
- Kata UI santai; judul "Dashboard".

### 5.2 Filter global
Satu bar menempel di atas (`FilterBar` + `FilterChip`, aturan kit): **BU** (`LinkMultiField`), **Lokasi** (`LinkMultiField`), **Tanggal**. Disimpan di search param router (bukan `query-persist`). Kosong = semua yang boleh dibaca pengguna.
- **Tanggal**: preset (7 hari, 30 hari [bawaan], bulan ini, bulan lalu) dan rentang kustom, batas WIB, maksimum **366 hari**. Granularitas deret waktu otomatis dari panjang rentang: harian (<= 31 hari), mingguan (<= 180 hari), selain itu bulanan.
- Setiap widget menyatakan di metadatanya apakah **tiap filter global berlaku** dan kolom tanggal yang dipakai. Filter yang tak berlaku **tidak diam-diam diabaikan**: kartu widget menampilkan penanda ("BU tidak berlaku", "Kondisi saat ini" untuk keadaan sesaat yang tak mengikuti tanggal, "per lokasi" untuk stok). Widget ber-BU (Serial Number dan Laporan) menampilkan "BU saat ini" saat filter BU aktif (K8, 2026-11-23).

### 5.3 Filter per grup
Tiap grup widget punya baris `FilterChip` sendiri di kepala grupnya. **Aturan keras:** field filter grup tidak boleh `bu`, `location`, atau `date` (tes registry menegakkannya). Field per grup:

| Grup | Filter grup |
|---|---|
| Serah Terima | Customer, Status papan |
| Serial Number | Status, Kustodi, Item |
| Laporan | Status laporan (terbuka/tertutup), Hasil |
| Stok Stiker | Jenis stiker, Stiker |
| Postel | Kondisi |

Pilihan record lain (customer, item, jenis stiker, stiker) memakai `LinkField`/`LinkMultiField` (aturan field relasi); enum memakai `Select`/`MultiSelect`. Daftar pilihan hanya memuat yang boleh dibaca pengguna. Pilihan relasi dicari di server (K9, 2026-11-23): mengetik di chip mengirim kata cari ke `dashboard.options` (halaman pertama, maks. 50; bila masih ada sisa tampil petunjuk "persempit pencarian"), dan nama nilai yang sudah terpilih (termasuk dari URL) diresolusi lewat `ids` sehingga chip tidak menulis "tidak dikenal" untuk record yang sah.

### 5.4 Widget dan keadaannya
`WidgetCard` (kartu): judul, penanda keterlibatan filter, isi. Tiap widget punya keadaan **memuat** (skeleton), **galat** (pesan + "Coba lagi", tidak menjatuhkan widget lain), dan **kosong** (pesan netral). Grup tanpa satu pun widget yang boleh dilihat disembunyikan; bila semua kosong: pesan "Anda belum punya akses ke data dashboard".

Penyegaran (K10, 2026-11-23): default `queryClient` (30 detik saat tab terlihat) terlalu rapat untuk kueri agregat; dashboard menimpa menjadi **60 detik** dan menaruh `staleTime` yang sama (alasan dicatat di `queries.ts`). Selebihnya mengikuti halaman lain: berhenti saat tab tersembunyi, muat ulang saat jendela fokus bila basi, galat server dicoba sekali lagi. Hanya grup yang berada di dekat viewport yang diminta dan disegarkan (`useTrackNearViewport`, dua arah; grup yang menjauh berhenti disegarkan, data lama tetap tampil). Widget yang gagal tidak di-cache server dan dicoba lagi pada muat ulang berikutnya. Query dashboard **tidak** masuk whitelist `query-persist`.

Ponsel: kisi dua kolom (number card satu kolom jadi berdampingan dua-dua, kartu lain selebar dua kolom); Quick List menjadi `MobileCard`; filter global satu baris geser (perilaku `FilterBar` yang ada). Desktop: kisi 12 kolom; number card kecil berderet, grafik 6 atau 12 kolom. Number card ber-delta menampilkan panah dan kata menurut arah nyata dengan warna menurut `deltaGood` (K7).

Visual grafik (aturan wajib): warna dari token semantik yang ada (`primary`, `info`, `success`, `warning`, `destructive`, `secondary`), maksimum 6 kategori + "Lainnya"; **jangan hanya warna**: legenda berlabel dan nilai terbaca; tiap grafik punya `role="img"`, `aria-label` ringkasan, dan tabel tersembunyi untuk pembaca layar. Bila menambah token `--chart-*`, pasangannya wajib masuk `web/src/styles.contrast.test.ts` (AA 4,5:1 terang dan gelap); lebih baik memakai ulang token yang ada. Gunakan skill `dataviz` saat membangun.

## 6. Katalog widget v1 (27 widget; dapat dipotong)

Singkatan: **B** = filter BU berlaku, **L** = Lokasi, **T** = Tanggal (kolom), ✗ = tidak berlaku. `Δ` = number card dengan perbandingan periode sebelumnya yang sama panjang (pilihan saya); tiap widget Δ menyatakan arah baiknya di metadata `deltaGood` (K7): `hs.created` naik, `sn.recorded` naik, `rp.opened` turun.

**Serah Terima** — izin: `handover` view ATAU `qc` edit (berlokasi). B ✗ (task tak punya BU). L = `handovers.location_id`.

| Id | Visual | Isi | T |
|---|---|---|---|
| `hs.created` | number Δ | Task dibuat | `created_at` |
| `hs.active` | number | Task aktif (baru + dikerjakan) | ✗ kondisi saat ini |
| `hs.status` | donut | Komposisi status papan | `created_at` |
| `hs.trend` | line | Task dibuat vs selesai per periode | `created_at` / `completed_at` |
| `hs.byLocation` | bar | Task per lokasi | `created_at` |
| `hs.byCustomer` | bar horizontal | 10 customer teratas | `created_at` |
| `hs.avgDuration` | number | Rata-rata durasi selesai | `completed_at` |
| `hs.oldest` | list | 10 task aktif terlama: nomor, customer, lokasi, umur, progres centang | ✗ |

**Serial Number** — izin: `serial` view ATAU `serialservice` view (ber-BU). B = `serials.bu_id`. L = `serials.location_id`.

| Id | Visual | Isi | T |
|---|---|---|---|
| `sn.recorded` | number Δ | Serial dicatat | `created_at` |
| `sn.status` | donut | Komposisi status | `created_at` |
| `sn.trend` | line | Dicatat per periode | `created_at` |
| `sn.byItem` | bar horizontal | 10 item teratas | `created_at` |
| `sn.byBu` | bar | Per BU | `created_at` |
| `sn.custody` | pie | Kustodi QC / dalam pengiriman / servis | `created_at` |
| `sn.transit` | list | Sedang dalam pengiriman: nomor serial, item, dari→ke, lama (hari) | ✗ |

Catatan lokasi: selama pengiriman `serials.location_id` tetap **lokasi asal** dan baru pindah saat diterima (`server/src/modules/serial/act.ts`). Karena itu filter Lokasi pada `sn.*` dan `rp.*` mencocokkan `location_id`; khusus `sn.transit` mencocokkan lokasi asal ATAU tujuan (`transit_to_location_id`) agar serial yang menuju lokasi terpilih tetap terlihat (keputusan saya).

**Laporan rusak** — izin sama dengan Serial. B = `serial_cases.bu_id`. L = lokasi serial induk saat ini (`serials.location_id`; `origin_location_id` kosong sebelum dikirim). Laporan milik serial terhapus tidak dihitung.

| Id | Visual | Isi | T |
|---|---|---|---|
| `rp.open` | number | Laporan terbuka | ✗ kondisi saat ini |
| `rp.opened` | number Δ | Laporan dibuka | `opened_on` |
| `rp.trend` | line | Dibuka vs ditutup per periode | `opened_on` / `closed_on` |
| `rp.result` | donut | Hasil penutupan: rusak vs lolos | `closed_on` |
| `rp.oldest` | list | 10 laporan terbuka terlama: nomor, status serial, lokasi, lama | ✗ |

**Stok Stiker** — izin: `stickerstock` view (berlokasi). B ✗ (stok tak dibatasi BU). L = `sticker_stock.location_id`.

| Id | Visual | Isi | T |
|---|---|---|---|
| `st.out` | number | Pasangan stiker×lokasi yang habis (per lokasi, K5) | ✗ kondisi saat ini |
| `st.low` | number | Pasangan stiker×lokasi yang menipis (per lokasi, K5) | ✗ kondisi saat ini |
| `st.attention` | list | Per baris satu pasangan stiker×lokasi habis/menipis: nama stiker, jenis, lokasi, stok di lokasi itu, minimum | ✗ |
| `st.movement` | bar kelompok | Masuk vs keluar per periode | `ts` entri (kolom waktu `sticker_stock_entries`, bukan `created_at`) |
| `st.byType` | bar | Total stok per jenis | ✗ |

**Postel** — izin: `sticker` view (global). B, L, T ✗.

| Id | Visual | Isi |
|---|---|---|
| `pt.condition` | donut | Berlaku / Segera habis / Kedaluwarsa |
| `pt.expiring` | list | Postel segera habis/kedaluwarsa: nama, nomor aktif, tanggal habis, sisa hari |

Untuk `st.movement`: masuk = entri `kind` `in`; keluar = `out` ditambah pemotongan Serial. Koreksi dan opname tidak dihitung (bukan pergerakan fisik).

## 7. Tautan publik

### 7.1 Model
Tabel baru `dashboard_shares` (migrasi `0032_dashboard.sql`, expand-only, idempoten; `dashboard_reports` bagian 7a ada di migrasi terpisah `0033_dashboard_reports.sql`): `id` (ULID via `newId()`), `title`, `created_by` (surel), `created_at`, `expires_at` (ISO UTC), `revoked_at` dan `revoked_by` (kosong = aktif), `scope` (JSON, lihat bawah). Tidak masuk `SOFT_DELETE_TABLES` (pencabutan = isi `revoked_at`).

`scope` berisi **cakupan beku**:
- `buIds` dan `locationIds`: **himpunan eksplisit hasil resolusi saat membagikan**. Filter kosong di dashboard TIDAK disimpan sebagai "semua": ia diubah menjadi daftar id yang boleh dibaca pembagi saat itu. (Jika "semua" disimpan, pembagi yang kemudian mendapat BU baru ikut membocorkan BU baru ke tautan lama.)
- `locationIds` berlaku sebagai **batas hak** hanya untuk modul berlokasi (Serah Terima, Stok Stiker): himpunan eksplisit = lokasi yang dipilih pembagi, atau bila kosong gabungan lokasi yang boleh dibaca pembagi di modul-modul widget terpilih, lalu **diiris per modul** saat dibuka. Serial dan Laporan hanya dibatasi BU (tak ada izin per lokasi), jadi bagi mereka Lokasi hanyalah **filter**: dipakai hanya bila pembagi memilihnya secara aktif (`locationFiltered: true`), selain itu tidak ada penyaring lokasi (lokasi yang dibuat kemudian ikut, karena lokasi bukan batas isolasi di modul itu; BU tetap beku eksplisit). Pilihan filter Lokasi global di aplikasi = gabungan lokasi yang boleh dibaca pengguna di modul-modul sumber widget (keputusan saya).
- `range`: `{ from, to }` tetap, atau (pilihan saya) `{ rollingDays }`.
- `widgets`: daftar `{ id, filters }` (filter grup yang berlaku, ikut beku).

### 7.2 Token
`v1.<shareId>.<exp>.<sig>` mengikuti `server/src/modules/serial/public-link.ts`: HMAC-SHA256 dengan **kunci turunan berlabel sendiri** dari `SESSION_SECRET` (`qc:dashboard-share-link:v1`, tak dapat dipakai sebagai sesi atau token laporan), verifikasi tanda tangan **tanpa akses DB** lebih dulu, bentuk kanonik tanda tangan wajib, batas panjang. Baru setelah itu baris `dashboard_shares` dicek: tak ada, `revoked_at` terisi, atau lewat `expires_at` = ditolak. Konsekuensi yang dicatat: mengganti `SESSION_SECRET` mematikan semua tautan dashboard (sama dengan tautan laporan). Tautan dapat ditampilkan ulang kapan saja oleh pembagi atau super admin (bisa dihitung ulang dari baris); URL disusun **server** dari `APP_ORIGIN` (di aplikasi desktop origin renderer `app://qc`, jadi klien tak boleh menyusunnya).

### 7.3 Rute dan halaman publik
- Sub-aplikasi di `/api/public` (di luar `API_ROUTES` dan OpenAPI, pola `public-routes.ts`): `GET /api/public/dashboards/<token>` mengembalikan metadata (judul, cakupan, pilihan filter yang boleh dipakai penonton) dan hasil widget pada cakupan beku; `POST /api/public/dashboards/<token>/query` menerima filter penonton (K1) dan mengembalikan hasil yang dipersempit. Tanpa sesi; **semua** penolakan (token salah/kedaluwarsa/dicabut, pembagi nonaktif) 404 problem+json yang sama; kegagalan dibatasi per IP lewat `rate_limits` (kunci `dashboard-share:<ip>`, 20 per 10 menit); `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; token tak dicatat.
- Halaman web `/dashboard-publik/$token`, **di luar** layout `_app` seperti `/laporan/$token`, tanpa navigasi, dengan bar filter yang sama polanya dengan aplikasi tetapi **hanya menawarkan nilai di dalam cakupan beku** (K1), dengan `<meta name="robots" content="noindex">`. Filter penonton ada di search param halaman dan tak pernah mengubah cakupan tersimpan.
- **Aturan filter penonton (K1; rincian pilihan saya):** (1) BU dan Lokasi: pilihan hanya himpunan beku (nama dari cakupan itu); (2) Tanggal: rentang kustom/preset dijepit ke dalam rentang beku (untuk rentang bergulir, relatif terhadap waktu buka); (3) filter grup bertipe enum tetap (Status papan, Status, Kustodi, Hasil, Kondisi, Status laporan): boleh dipersempit bebas; (4) filter grup bertipe relasi (Customer, Item, Jenis stiker, Stiker): hanya bila pembagi memilih nilai tertentu saat membagikan, dan penonton hanya dapat mempersempit di dalam nilai itu; bila pembagi membiarkannya kosong, filter itu **tidak ditawarkan** kepada penonton (menawarkannya berarti membuka daftar nama customer/item/stiker seluruh cakupan). Nilai di luar cakupan dalam permintaan **diabaikan lewat irisan** (tanpa galat yang membedakan, agar tak menjadi oracle); hasil kosong bila irisan kosong. Kepala halaman memuat judul, **periode dan nama BU/Lokasi cakupan**, waktu perbarui, dan "Dibagikan oleh <bagian lokal surel>" (`publicActorName`). Penyegaran 60 detik saat tab terlihat.
- **Pembatas keberhasilan (K1 mengubah ancaman; keputusan saya):** karena penonton anonim memilih filter dan dengan itu kunci cache, permintaan `query` ber-token sah wajib dibatasi per IP dan per token lewat `rate_limits` (angka awal 30 per menit per IP dan 120 per menit per token; final di pembangun), terlampaui = 429 seragam. Tanggal filter penonton dijepit ke rentang beku lalu **dibulatkan ke hari WIB penuh** (tak ada kunci cache per detik), jumlah nilai per filter dibatasi seperti `FILTER_LIST_MAX`, dan widget di luar daftar tautan tak dapat diminta. Ini juga POST pertama di bawah `/api/public`: ia tak memakai cookie sesi, tetapi `csrfGuard` global (`server/src/http/security.ts`) menolak metode non-aman tanpa header CSRF, jadi halaman publik mengirim header yang sama atau rute dikecualikan secara eksplisit; pembangun memverifikasi urutan middleware di `app.ts`/`server.ts` sebelum memutuskan.
- Token bertitik: awalan `/dashboard-publik/` WAJIB dikecualikan di `server/src/http/static.ts` (fallback SPA) dan `SERVER_PATH_DENYLIST` (`web/src/app/pwa/server-paths.ts`; dijaga `scripts/pwa-server-paths.test.ts`), dan format log `qc_masked` nginx di `deploy/nginx/qc.conf.example` diperluas ke awalan itu. **Langkah manual di VPS sebelum merge** (seperti perubahan nginx lain).

### 7.4 Isolasi (jaminan yang wajib dites)
1. Cakupan hanya berasal dari token + baris tersimpan. Parameter penonton (K1) hanya masuk sebagai **irisan**: hasil akhir = cakupan beku ∩ filter penonton ∩ hak pembagi saat itu, sehingga tak ada nilai yang dapat memperluas cakupan, dan hasil dengan filter penonton selalu himpunan bagian dari hasil tanpa filter itu. Tidak ada parameter lain (header, cookie, query tak terdaftar) yang dibaca.
2. Saat dibuka, server memuat pembagi lewat `loadUserContext` dan menghitung **irisan** cakupan beku dengan hak pembagi **saat itu**. Pembagi nonaktif/terhapus = 404 seragam. Pembagi yang **tidak lagi memegang `dashboard: manage`** juga = 404 seragam (keputusan saya, satu aturan dengan laporan terjadwal 7a.4: mencabut hak membagikan harus mematikan tautan lama, bukan hanya mencegah tautan baru). Berlaku juga untuk tautan terbitan laporan terjadwal (pembagi = pemilik laporan). Pembagi yang kehilangan izin modul sebuah widget = widget itu **dihilangkan** (tidak galat, tidak bocor), pembagi yang kehilangan akses ke sebagian BU/Lokasi = irisan menyempit.
3. Mesin yang menghitung widget **sama persis** dengan jalur aplikasi; yang berbeda hanya asal `ResolvedScope` (dari pengguna login + filter vs dari token + baris).
4. DTO publik daftar putih (`shared/dashboard-public.ts`): angka, label agregat, dan kolom Quick List berikut saja: Serah Terima = nomor, customer, lokasi, umur, progres; Serial = nomor serial, item, dari→ke, lama; Laporan = nomor laporan, status serial, lokasi, lama; Stok = nama stiker, jenis, stok cakupan, minimum; Postel = nama, nomor aktif, tanggal habis, sisa hari. Tanpa catatan, komentar, foto, id berkas, surel, id internal selain yang diperlukan kunci baris. Pemetaan ini dilakukan `toPublicDto`; surel laporan terjadwal memakai pasangannya `toEmailDto` (bagian 7a.3), yang menambah `previous` dan `total` hanya untuk surel.
5. **Dua definisi yang ada berbeda dari modul lain** (dinyatakan agar tak jadi temuan):
   - *Stok menipis/habis*: per lokasi sesuai keputusan K5 (bagian 4). Halaman Stok dan ringkasan harian menghitung dari total semua lokasi dan tidak diubah, jadi angka dashboard dapat berbeda; dengan hitungan per pasangan stiker×lokasi dalam cakupan tidak ada informasi lokasi lain yang ikut terbawa.
   - *Filter BU Serial*: daftar Serial memaknai BU sebagai "pernah di BU itu" (riwayat). Dashboard memakai **BU saat ini saja** (`serials.bu_id` / `serial_cases.bu_id`) di aplikasi dan publik, sehingga serial yang sudah pindah tidak ikut terhitung. Angkanya bisa berbeda dari daftar Serial pada filter BU yang sama; kartu memberi keterangan "BU saat ini" saat filter BU aktif (K8, diputuskan pemilik 2026-11-23: berlaku sejak Rencana 1, bukan hanya tautan publik).

### 7.5 Pembuatan dan pengelolaan
- Tombol "Bagikan" di kepala halaman (hanya `dashboard: manage`) membuka `FormDialogShell`: nama tautan, daftar centang widget per grup (hanya yang boleh dilihat pembagi; widget daftar diberi peringatan K3), cakupan awal = filter yang sedang aktif (global + grup, dapat diubah), mode rentang (tetap/bergulir), masa berlaku (K4: pilihan 7/30/90/180/365 hari atau tanggal kustom, bawaan 30 hari, plafon 365 hari), dan untuk tiap filter relasi apakah penonton boleh mempersempitnya (nilai yang dipilih = batas; kosong = tak ditawarkan, lihat 7.3). Sebelum menyimpan ditampilkan ringkasan "Akan terlihat oleh siapa pun yang memegang tautan: periode X, BU A/B, Lokasi C, N widget".
- Batas **50 tautan aktif per pembagi** (satu konstanta + satu tes; keputusan saya agar tabel dan sapuan tak tumbuh tanpa batas).
- "Tautan dibagikan": daftar (nama, pembagi, dibuat, kedaluwarsa, status), **Salin tautan**, **Cabut**. Pemegang `dashboard: manage` melihat daftar semua tautan (nama, pembagi, kedaluwarsa, status) dan dapat mencabutnya (akuntabilitas lewat kolom pembagi); **menyalin tautan hanya oleh pembagi atau super admin**, karena tautan membuka data yang dihitung dari hak pembagi (keputusan saya, lebih ketat dari draf awal). Pencabutan idempoten.
- Audit: `dashboard.share_create` dan `dashboard.share_revoke` (target `dashboard_share:<id>`, tanpa token). Tidak ada pencatatan tampilan oleh publik (rute publik hanya membaca data; tanpa penulisan basis data selain pembatas laju).

## 7a. Laporan terjadwal lewat surel

Ditambahkan 2026-11-23 atas permintaan pemilik. Satu **laporan terjadwal** = jadwal + penerima + periode relatif + isi (cakupan dan widget, sama bentuknya dengan tautan bagikan). Pengguna dengan `dashboard: manage` dapat membuat banyak laporan, masing-masing dengan konfigurasi sendiri. Tiap pengiriman menghasilkan satu surel bertubuh dashboard dengan tombol "Buka dashboard lengkap" ke tautan publik (bagian 7) yang periodenya sama dengan surel.

### 7a.1 Model data
Tabel baru `dashboard_reports` (migrasi `0033_dashboard_reports.sql`, terpisah dari `0032_dashboard.sql` yang memuat `dashboard_shares` beserta kolom `report_id`; expand-only, idempoten): `id` (ULID), `name`, `owner` (surel pembuat), `enabled` (jeda = 0), `schedule` (JSON), `period` (preset), `scope` (JSON: `buIds`, `locationIds`, `locationFiltered`, `widgets` `{ id, filters }`, serta penanda penawaran filter relasi ke penonton tautan, sama dengan 7.1/7.3), `recipients` (JSON larik surel), `link_days` (masa berlaku tautan per pengiriman), `last_run_key`, `last_run_at`, `last_status` (`ok` | `skipped` | `error`) dan `last_note` (alasan singkat tanpa rahasia), `created_at`, `updated_at` (untuk CAS), `version`. Hapus laporan = hapus baris (tercatat di audit) dan **mencabut** tautan yang pernah diterbitkannya; bukan model soft delete.

**Cakupan beku saat disimpan (keputusan saya):** sama dengan 7.1: filter BU dan Lokasi yang kosong diresolusi menjadi himpunan id eksplisit saat laporan **disimpan** (dibuat atau diubah), tidak dihitung ulang tiap kirim. BU atau Lokasi yang dibuat kemudian tidak ikut sampai pemilik menyimpan ulang; form menampilkan himpunan yang berlaku. Saat kirim, himpunan itu tetap diiris dengan hak pemilik saat itu (7a.4).

`dashboard_shares` mendapat kolom `report_id` (NULLABLE): setiap pengiriman membuat **satu baris tautan** milik laporan itu (cakupan beku = cakupan laporan yang sudah diselesaikan menurut hak pemilik saat itu, rentang tetap = periode surel, `expires_at` = waktu kirim + `link_days`). Tautan terbitan laporan tidak dihitung ke batas 50 tautan aktif per pembagi dan tidak muncul di daftar "Tautan dibagikan" biasa (muncul di halaman laporannya). Penyapu per jam menghapus baris tautan terbitan laporan yang sudah lewat `expires_at` lebih dari 30 hari.

### 7a.2 Jadwal dan periode
- Frekuensi: **harian**, **mingguan** (satu hari: Senin-Minggu), **bulanan** (tanggal 1-28 atau "akhir bulan"), pada **jam WIB** (0-23). Menit tidak dipilih: pemeriksa jadwal bangun tiap 5 menit (7a.8), jadi surel terkirim paling lambat sekitar 5 menit dari jam jadwal.
- Periode **relatif dan selalu hari penuh** (berakhir kemarin): "kemarin", "7 hari terakhir", "30 hari terakhir", "minggu lalu" (Senin-Minggu), "bulan lalu". Tanggal tetap tidak ditawarkan (tak masuk akal untuk laporan berulang). Perbandingan "vs periode lalu" memakai periode sebelumnya yang sama panjang (widget bertanda Δ).
- Jatuh tempo: laporan aktif dengan hari terjadwalnya (WIB) hari ini, jam sekarang >= jam terjadwal, dan `last_run_key` belum sama dengan kunci periode berjalan (harian `YYYY-MM-DD`, mingguan `YYYY-Www`, bulanan `YYYY-MM`). Server yang mati pada jam itu masih mengirim pada pemeriksaan berikutnya **di hari terjadwal yang sama**; lewat hari itu periode dilewati begitu saja (tanpa status khusus) dan laporan menunggu jadwal berikutnya (tak ada pengiriman susulan berhari-hari kemudian).
- **Mulai dari jadwal berikutnya (keputusan saya):** saat laporan dibuat, dilanjutkan dari jeda, atau jadwal/periodenya diubah, `last_run_key` diisi kunci periode berjalan bila slot jadwal periode itu sudah lewat, sehingga laporan baru tidak langsung terkirim ke penerima eksternal. Untuk mencoba segera tersedia "Kirim uji".
- Dilewati karena pemilik, widget, atau izin (`skipped`, 7a.4) **tidak** mengisi `last_run_key`: dievaluasi ulang pada pemeriksaan berikutnya di hari terjadwal (pemeriksaan murah sebelum menghitung widget), jadi pemilik yang aktif lagi hari itu tetap dikirimi.
- Klaim: `last_run_key` diisi lewat CAS **sebelum** mengirim (pola `checkPostelExpiryDigest`) dan dipulihkan bila pengiriman gagal, sehingga dua pemeriksaan serentak tidak mengirim dobel dan kegagalan dicoba ulang pada pemeriksaan berikutnya di hari yang sama. Baris tautan dibuat sebelum merender (tombol butuh URL-nya) dan **dihapus bila pengiriman gagal** (kompensasi), jadi percobaan ulang tidak menumpuk baris; bila penghapusan itu sendiri gagal, penyapu membersihkannya. Satu surel per laporan per putaran; laporan diproses berurutan dengan batas waktu per laporan.

### 7a.3 Isi surel (rancangan; mockup diperlihatkan kepada pemilik 2026-11-23, persetujuannya lewat tinjauan dokumen ini)
Body HTML berlebar 600 px yang menirukan dashboard: kepala (nama laporan, jadwal, periode, cakupan), baris **kartu angka** (dengan delta bila ada), grafik sederhana, dan **daftar perhatian**, lalu tombol utama "Buka dashboard lengkap" dengan catatan masa berlaku tautan dan keterangan bahwa tautan hanya menampilkan periode dan cakupan laporan, dan kaki surel (nama laporan, pemilik, "hubungi pemilik untuk berhenti atau mengubah isinya").

Karena klien surel tidak menjalankan JavaScript dan banyak yang membuang SVG dan gambar, visual diterjemahkan ke tabel HTML dengan gaya inline (tanpa gambar, tanpa skrip, tanpa piksel pelacak):

| Visual widget | Di surel |
|---|---|
| number | kartu angka + delta periode lalu (kata menurut arah nyata, warna menurut `deltaGood`, K7) |
| donut / pie | **batang bertumpuk** + legenda berlabel (maks. 6 irisan + "Lainnya") |
| line / bar deret waktu | **kolom** (maks. 31 batang; mingguan/bulanan sesuai granularitas) |
| bar horizontal | batang horizontal berlabel |
| bar kelompok (stok masuk/keluar) | kolom dua warna + legenda |
| list | tabel **5 baris** teratas + "Menampilkan N dari M" |

Aturan: warna tetap berkontras AA di latar putih; nilai selalu tertulis (tak hanya warna); semua teks data di-escape HTML dan dibersihkan dari karakter kontrol dan pengatur arah (`stripControlChars`); satu-satunya tautan di surel adalah tombol ke tautan publik (disusun server dari `APP_ORIGIN`); total HTML <= 90 KB (Gmail memotong sekitar 102 KB); maks. 12 widget per laporan (pilihan saya, mengikuti batas ukuran). **Teks polos** selalu ikut sebagai bagian alternatif (ringkasan angka dan daftar; tautan di baris sendiri). Subjek: `[QC] <nama laporan>, <periode>`.

**Jaminan struktural:** pembuat surel menerima hanya `EmailWidgetData`, hasil mapper berdaftar putih `toEmailDto` di `shared/dashboard-public.ts`, bukan hasil mentah widget, sehingga kolom di luar daftar putih (catatan, komentar, foto, surel pengguna) tak mungkin masuk ke surel. Mapper ini berpasangan dengan `toPublicDto` untuk halaman publik (bagian 7.4 butir 4). `EmailWidgetData` = DTO publik ditambah dua angka: `previous` (nilai periode sebelumnya, untuk delta) dan `total` (jumlah seluruh baris daftar, untuk "Menampilkan N dari M"). `previous` **hanya ada di surel**: halaman publik tidak menampilkan delta karena periode sebelumnya berada di luar rentang beku yang dibagikan; `total` adalah satu angka dalam cakupan dan boleh juga tampil di halaman publik (keputusan saya).

### 7a.4 Perhitungan dan hak
Laporan dihitung oleh **mesin widget yang sama** dengan aplikasi dan tautan publik, dengan `ResolvedScope` = cakupan laporan ∩ hak **pemilik saat itu** (diperiksa lewat `loadUserContext`). Pemilik nonaktif atau terhapus: laporan dilewati (`skipped`, "Pemilik tidak aktif"; kembali berjalan bila pemilik aktif lagi). Pemilik yang tidak lagi memegang `dashboard: manage` juga dilewati (`skipped`, "Pemilik tidak lagi berhak membagikan"), karena dengan penerima eksternal (K6) laporan lama akan menjadi jalur keluar data bagi orang yang haknya sudah dicabut (keputusan saya). Pemilik kehilangan izin sebuah widget: widget itu hilang dari surel; bila tak ada widget yang tersisa: dilewati (`skipped`, "Tidak ada widget yang dapat ditampilkan"). Hasil terakhir ditampilkan di daftar laporan sebagai status dan catatan (tanpa surel peringatan terpisah ke pemilik pada v1).

### 7a.5 Penerima (K6)
Alamat surel bebas, maksimal **20** per laporan, tiap entri satu alamat polos (validator ketat yang sama dengan penerima peringatan Postel, `isPostelRecipient`; dinormalisasi huruf kecil, duplikat dibuang, entri tersimpan lama yang tak lolos dibuang saat kirim). Surel dikirim **satu pesan dengan `bcc`** ke semua penerima (alamat penerima tidak saling terlihat; `to` = alamat pengirim). Pengirim `core/mail.ts` diperluas: `MailMessage` mendapat `html?` dan `bcc?` (kompatibel mundur; transport dan tesnya diperbarui); bila `to` kosong dan `bcc` ada, `createSmtpMailer` mengisi `to` dari alamat pada `settings.from` (dapat berformat "Nama <alamat>") tanpa menambah field `MailMessage`. Nama laporan di subjek dibersihkan dengan `stripControlChars` dan dibatasi 120 karakter. Form memuat peringatan "Isi laporan dihitung dari hak Anda dan terkirim ke semua alamat ini, termasuk di luar perusahaan" dan dialog konfirmasi saat menyimpan perubahan penerima atau widget. **Tanpa tautan "berhenti berlangganan"** pada v1 (penerima menghubungi pemilik; risiko keluhan spam dan kemungkinan tautan berhenti dicatat sebagai pekerjaan lanjutan); tanpa pelacak bukaan atau klik.

### 7a.6 Halaman
Butir sidebar "Dashboard" menjadi grup berisi **Ringkasan** (`/dashboard`) dan **Laporan terjadwal** (`/dashboard/laporan`; hanya `dashboard: manage`). Semua halaman memakai kit (aturan `page-frame.test.ts`):
- `ListPage` + `DataTable`: nama, jadwal ringkas ("Senin 08.00"), periode, jumlah penerima, status terakhir (badge), pengiriman berikutnya; aksi baris: Ubah, Jeda/Lanjutkan, Kirim uji, Hapus (`ConfirmDeleteDialog`); aksi massal Jeda/Lanjutkan.
- `ViewPage`: ringkasan konfigurasi, **Pratinjau surel** (isi HTML dari server ditampilkan dalam `iframe` ber-`sandbox` tanpa izin apa pun dan `srcdoc`; pilihan saya, dapat dipotong), daftar tautan terbitan (kedaluwarsa, status), dan log aktivitas (`ActivityKind` di `shared/audit.ts` ditambah `dashboardReport` dan `dashboardShare`). Pratinjau dan tautan terbitan hanya tampil bagi pemilik atau super admin (7a.7).
- `FormPage` bertab: **Dasar** (nama, jadwal, periode), **Isi** (BU, Lokasi, widget per grup, filter grup, penawaran filter relasi ke penonton: komponen bersama dengan dialog Bagikan agar tak digandakan), **Penerima** (daftar alamat), **Tautan** (`link_days`: 7/14/30/90 hari, bawaan 14, plafon 365; pilihan saya).
- Pilihan record (BU, Lokasi, customer, item, jenis stiker, stiker) memakai `LinkField`/`LinkMultiField`; enum memakai `Select`.

### 7a.7 Rute REST (kelompok `dashboardReports` masuk `API_GROUP_VERSIONS`)
`dashboardReports.list|get|save|setEnabled|remove|sendTest|preview`, semuanya `dashboard: manage`. `save` = PUT utuh dengan CAS `updated_at` (412 bila usang). **Hak ubah:** pemegang `manage` dapat MELIHAT semua laporan (akuntabilitas), tetapi hanya **pemilik atau super admin** yang dapat mengubah, menjeda, mengirim uji, melihat **pratinjau**, melihat atau menyalin tautan terbitan, atau menghapus (pilihan saya). Alasannya, isi dihitung dari hak pemilik: pratinjau dan tautan akan menampilkan data di luar hak pemegang `manage` lain. Pemegang `manage` lain hanya melihat metadata (nama, jadwal, periode, status, jumlah penerima, daftar widget). `sendTest` mengirim satu surel berawalan "[UJI]" **hanya ke surel pemilik**, dibatasi 5 per jam per pemilik lewat `rate_limits`. `preview` mengembalikan HTML surel yang dihitung sekarang (tanpa mengirim dan tanpa membuat tautan: tombol memakai tautan contoh yang tak berfungsi).
Batas: 20 laporan per pemilik (konstanta + tes; pilihan saya).

### 7a.8 Server
`server/src/modules/dashboard/report/`: `repo.ts`, `service.ts` (CRUD, hak, batas), `schedule.ts` (fungsi murni: hari/jam jatuh tempo, kunci periode, resolusi periode relatif ke tanggal WIB; di `shared/dashboard-report.ts` bila dipakai web untuk label "berikutnya"), `render.ts` (fungsi murni: DTO publik → HTML dan teks polos, tanpa I/O), `run.ts` (`checkDashboardReports(env)`: klaim CAS seperti `checkPostelExpiryDigest`, hitung, terbitkan tautan, kirim, simpan status; dipanggil **loop tersendiri** `startDashboardReportLoop` yang bangun tiap 5 menit, mengikuti pola `startNotificationLoop`, BUKAN `schedulerTick` per jam, karena fase tik per jam mengikuti waktu start proses (bukan jam dinding) dan tik itu berurutan dengan penyapu lain sehingga banyak laporan pukul 08.00 akan menunda langkah lain), `sweep.ts` (penyapu tautan terbitan), `routes.ts`. Berjalan hanya bila `Env.MAILER` ada (SMTP terkonfigurasi); bila tak ada, halaman Laporan terjadwal menampilkan peringatan "SMTP belum diatur" dan penjadwal tak berbuat apa pun (pola ringkasan stok).

### 7a.9 Audit dan privasi
Audit `dashboard.report_create|update|delete|pause|resume|send_test` (target `dashboard_report:<id>`; tanpa isi surel dan tanpa token). Alamat penerima dan isi surel tidak dicatat di log aplikasi; galat pengiriman dibersihkan lewat `redactSecrets`.

### 7a.10 Keputusan saya di bagian ini (dapat dipotong pemilik)
Plafon 12 widget per surel; 20 laporan per pemilik; periode relatif hanya lima preset berakhir kemarin; tak ada pengiriman susulan lewat hari terjadwal; tanpa surel peringatan ke pemilik saat dilewati; pratinjau surel di `iframe` tersandbox; hak ubah, pratinjau, dan tautan terbitan hanya pemilik atau super admin; tanpa tautan berhenti berlangganan; laporan baru/dilanjutkan/dijadwal ulang mulai dari jadwal berikutnya; cakupan dibekukan saat disimpan; laporan dilewati bila pemilik kehilangan `dashboard: manage`; delta periode lalu hanya di surel (tidak di halaman publik); pemeriksa jadwal loop 5 menit; baris tautan dihapus bila pengiriman gagal.

### 7a.11 Pengujian
- **Jadwal** (fungsi murni): harian/mingguan/bulanan, "akhir bulan" (Februari, bulan 30/31 hari), jam sebelum dan sesudah jadwal, batas tengah malam WIB, kunci periode, periode relatif (kemarin, 7/30 hari, minggu lalu Senin-Minggu, bulan lalu) termasuk pergantian tahun.
- **Klaim dan idempotensi**: dua pemeriksaan serentak = satu surel; pengiriman gagal memulihkan klaim dan pemeriksaan berikutnya mencoba lagi; hari terjadwal yang sudah lewat tidak dikirim susulan (tanpa status khusus); jeda menghentikan pengiriman.
- **Hak**: pemilik nonaktif/terhapus, pemilik kehilangan izin widget, tak ada widget tersisa, irisan BU/Lokasi menyempit; laporan lain tak terpengaruh.
- **Render**: escape HTML (nama customer berisi `<script>`/tanda kutip), pembersihan karakter kontrol/bidi, tanpa `<script>`, `<img>`, `<link>`, atau URL luar selain tombol; ukuran <= 90 KB pada beban terbesar; teks polos ada dan memuat tautan; tiap jenis visual punya fixture; batang bertumpuk dan kolom tak melebihi lebar.
- **Surel**: `bcc` (penerima tidak terlihat satu sama lain), validator penerima ketat, maks. 20, duplikat dibuang; `core/mail.test.ts` untuk `html` dan `bcc` serta kompatibilitas pemanggil lama (hanya `text`).
- **Tautan**: tiap pengiriman membuat baris `dashboard_shares` ber-`report_id` dengan rentang tetap = periode surel dan `expires_at` = kirim + `link_days`; menghapus laporan mencabut tautannya; penyapu menghapus yang lewat 30 hari; tak dihitung ke batas 50; tautan membuka dashboard publik dengan cakupan sama dengan isi surel.
- **Rute**: hanya `manage`; non-pemilik tak dapat mengubah/menghapus/kirim uji (super admin dapat); batas 20 laporan; `sendTest` hanya ke pemilik dan terbatas 5/jam; CAS 412; masuk tabel `body.test.ts` dan potret kontrak; tak ada `.env` baru.
- **Perilaku jadwal tambahan**: laporan baru, dilanjutkan, atau dijadwal ulang tidak langsung terkirim bila slot periode berjalan sudah lewat; `skipped` (pemilik nonaktif, tak ada widget, pemilik kehilangan `manage`) tidak mengisi `last_run_key` dan kembali berjalan di hari yang sama begitu syaratnya pulih; pemeriksa loop 5 menit tidak tumpang tindih dengan putaran sebelumnya dan terkirim dalam ±5 menit dari jam jadwal; baris tautan dihapus bila pengiriman gagal.
- **Hak lihat**: pemegang `manage` lain tidak dapat memanggil `preview` dan tidak menerima tautan terbitan; hanya pemilik dan super admin. Daftar tautan bagikan (7.5): `url` hanya untuk pembagi atau super admin.
- **DTO**: `toEmailDto` menambah `previous` dan `total`; `toPublicDto` tidak memuat `previous` (tes bahwa halaman publik tak pernah menampilkan delta) dan hanya `total`.
- **Web**: daftar, form (tab, konfirmasi perubahan penerima), pratinjau tersandbox, peringatan SMTP, status laporan; lolos `page-frame.test.ts`, `route-meta-coverage.test.ts`, `no-native-select.test.ts`.
- **Manual sebelum rilis**: periksa tampilan surel di Gmail (web dan aplikasi), Outlook (desktop), dan Apple Mail termasuk mode gelap; periksa surel tidak dipotong dan tombol terlihat.

## 8. Server

### 8.1 Struktur
- `shared/dashboard.ts`: metadata registry (`DASHBOARD_WIDGETS`), tipe DTO widget (uni diskriminatif menurut jenis: `number`, `series`, `parts`, `list`), tipe filter, `bucketFor(from, to)`, validasi rentang (maks. 366 hari, WIB), konstanta batas. Murni, tanpa API runtime/DOM.
- `shared/dashboard-public.ts`: DTO halaman publik.
- `server/src/modules/dashboard/`: `widgets/{handover,serial,report,sticker,postel}.ts` (SQL literal + `liveWhere`), `registry.ts` (peta id→implementasi; tes memastikan sama dengan metadata `shared/`), `scope.ts` (`resolveScope`: pengguna + filter → `ResolvedScope`; satu-satunya tempat irisan hak), `engine.ts` (menjalankan widget lewat semafor, masing-masing `try/catch` dengan batas waktu sehingga satu kegagalan jadi `status: 'error'` pada widget itu), `limiter.ts` (semafor FIFO bersama, K10), `options.ts` (daftar pilihan filter, K9), `routes.ts`, `share-repo.ts`, `share-service.ts`, `share-link.ts` (token), `public-routes.ts`.
- Hak berlokasi dihitung **per modul di dalam handler** (rute dashboard tidak punya satu `permission` modul; pola rute lonceng), memakai penyaring yang sama dengan modulnya (`readableBuIds` untuk Serial; lokasi dari `user.locations` menurut modul untuk Serah Terima dan stok).
- Waktu: kolom ISO UTC (`created_at`, `completed_at`, `entries.created_at`) dibandingkan dengan batas WIB yang dikonversi ke UTC; kolom tanggal WIB (`opened_on`, `closed_on`, `occurred_on`, `transit_on`) dibandingkan langsung. Pengelompokan periode memakai hari WIB (tes kasus 23:30 UTC).
- Cache memori singkat (30 detik) per kunci kanonik (widget + cakupan terselesaikan + filter) untuk melindungi basis data dari pemuatan ulang serentak dan dari rute publik; kunci tak memuat identitas pengguna karena hasil hanya bergantung cakupan. Tambah indeks (mis. `handovers.created_at`; stok sudah punya `(location_id, ts)`) hanya bila `EXPLAIN` menunjukkan perlu; keputusan ada pada pembangun.
- **Konkurensi, batas waktu, dan prioritas** (DIPUTUSKAN pemilik 2026-11-23, K10; menggantikan "4 kueri bersamaan per permintaan" yang semula keputusan saya): satu semafor per proses (kunci = pool basis data), **maks. 6 widget bersamaan** untuk SEMUA permintaan dashboard (dan kelak laporan terjadwal), antrean FIFO menurut urutan permintaan (widget dari permintaan yang lebih dulu, dan dalam satu permintaan menurut urutan daftar, berjalan lebih dulu); 6 dari pool bawaan 10 koneksi menyisakan 4 untuk rute lain, dan `max_connections` VPS 40 tetap aman untuk beberapa proses. Hasil `ok` yang ada di cache tidak memakai slot. Batas waktu 15 detik per widget mulai dihitung SETELAH slot diperoleh; slot dilepas saat widget selesai, gagal, atau melewati batas waktu (kueri yang ditinggalkan karena batas waktu tak dapat dibatalkan dan masih menahan satu koneksi sampai selesai; risiko ini diterima, dibatasi oleh semafor). Prioritas widget yang tampil dijaga klien (hanya grup dekat viewport yang meminta, 5.4), bukan oleh server.
- **Definisi "Task dibuat"** (keputusan saya): semua task yang `created_at`-nya dalam rentang, termasuk yang kemudian dibatalkan (komposisi pembatalan terlihat di `hs.status`).

### 8.2 Rute REST (id baru; kelompok `dashboard` dan `dashboardShares` masuk `API_GROUP_VERSIONS`)
- `dashboard.query` — `POST /dashboard/query`: `{ filter: { buIds?, locationIds?, from, to }, widgets: [{ id, filters? }] }` (maks. 30 widget) → `{ generatedAt, range, bucket, widgets: WidgetResult[] }` (array berurutan menurut permintaan, bukan peta per id; keputusan pemilik 2026-11-23, K11). Hanya widget yang boleh dilihat yang dikembalikan; id tak dikenal = `VALIDATION`. Sesi diperlukan, tanpa izin modul tunggal.
- `dashboard.options` — `GET /dashboard/options`: pilihan filter grup (customer, item, jenis stiker, stiker) terbatas pada yang boleh dibaca pengguna. Masukan opsional aditif (DIPUTUSKAN pemilik 2026-11-23, K9): `kind` (`customers|items|stickerTypes|stickers`; tanpa `kind` = keempat daftar, halaman pertama masing-masing), `query` (maks. 100 karakter, tak peka huruf besar-kecil), `cursor` (dari `next` hasil sebelumnya), `limit` (1-100, bawaan 50), dan `ids` (maks. 20, meresolusi nama; mengabaikan `query`/`cursor`/`limit`); `query`, `cursor`, dan `ids` wajib bersama `kind`. Keluaran: `{ customers, items, stickerTypes, stickers, next? }` dengan `next` = kursor halaman berikutnya per daftar yang masih punya sisa. Id di luar hak atau record terhapus tidak dikembalikan. Rute tidak dinaikkan ke `@2` (penambahan aditif); rute modul lain tidak dipakai ulang.
- Rute publik (di luar `API_ROUTES`, lihat 7.3): `GET /api/public/dashboards/<token>` dan `POST /api/public/dashboards/<token>/query` (badan JSON kecil: filter penonton; masuk tabel batas `body.test.ts` sebagai pengecualian rute publik, batas badan kecil sendiri).
- `dashboardShares.list|create|revoke` — izin `dashboard: manage`. `create` mengembalikan baris dan `url` yang disusun server.
- Laporan terjadwal: `dashboardReports.list|get|save|setEnabled|remove|sendTest|preview` (bagian 7a).
- Ditambahkan: tabel batas JSON di `server/src/http/body.test.ts` untuk rute JSON baru, `bun run api:snapshot` (potret kontrak), fragmen `server/changelog.d/2026XXXX-dashboard.md`.

## 9. Izin
Modul baru `dashboard` (global dan **masuk `SHARED_MODULES`** (`shared/assignments.ts`, keputusan saya) agar levelnya dihitung dari semua penugasan berlaku seperti `qrcode`/`sticker`, bukan hanya dari "Semua lokasi"; `MODULE_LEVELS`: `none`, `manage`; label "Dashboard", petunjuk "Membagikan dashboard secara publik dan mencabut tautan; melihat dashboard cukup dengan izin modul sumber datanya"). Dampak yang ikut dikerjakan: `MODULES`, `MODULE_LABELS`, `MODULE_LEVELS`, `MODULE_LEVEL_HINTS`, form role, tes izin, dan `MODULES_WITHOUT_GUIDE_YET` di `web/src/modules/guide/catalog/module-coverage.test.ts` (dashboard belum punya panduan interaktif; panduannya di luar cakupan v1 dan dicatat). Super admin memegang semua level seperti modul lain. Membuat dan mengelola laporan terjadwal juga butuh `dashboard: manage` (7a).

## 10. Pengujian
- **Registry**: id unik; metadata `shared/` = implementasi server (tes paritas dua arah antara `WIDGET_IDS` dan kunci `WIDGET_IMPLS`); widget ber-delta punya `deltaGood`; tak ada field filter grup yang bernama `bu`/`location`/`date`; tiap widget punya izin; widget daftar mendeklarasikan kolom putihnya.
- **Soft delete**: `soft-delete-guard.test.ts` tetap hijau tanpa entri baru di `SOFT_DELETE_PENDING`; tes bahwa task/serial/laporan terhapus tak dihitung.
- **Hak**: pengguna tanpa modul = widget tak muncul; BU/Lokasi parsial = angka hanya dari irisannya; pengguna tanpa penugasan = nol; filter di luar hak menyempit tanpa galat bocor.
- **Isolasi publik**: token acak/dikutak-katik/kedaluwarsa/dicabut/pembagi nonaktif = 404 identik; hak pembagi dikurangi setelah membagikan = widget hilang atau irisan menyempit; pembagi kehilangan `dashboard: manage` = 404 identik (juga untuk tautan terbitan laporan); kolom DTO sama dengan daftar putih (tes kunci objek); pembatas kegagalan; header `no-store`/`noindex`; filter kosong saat membagikan menjadi himpunan id eksplisit.
- **Filter penonton (K1)**: sifat himpunan bagian (hasil dengan filter penonton ⊆ hasil tanpa filter) diuji untuk tiap kelompok widget; BU/Lokasi/id relasi di luar cakupan beku tidak menambah baris apa pun dan tak mengubah bentuk respons; rentang tanggal di luar rentang beku dijepit; filter relasi yang tak ditawarkan (pembagi tak memilih nilai) diabaikan bila tetap dikirim; widget di luar daftar tautan tak dapat diminta lewat `query`; pembatas keberhasilan per IP dan per token (429), pembulatan tanggal ke hari WIB penuh, dan header CSRF pada `query` publik.
- **Definisi di 7.4 butir 5**: tes stok menipis/habis per pasangan stiker×lokasi (K5: pasangan tanpa baris stok tak dihitung, stiker nonaktif tak dihitung, tidak ada angka lokasi di luar cakupan); BU memakai BU saat ini.
- **Waktu**: batas WIB, bucket harian/mingguan/bulanan, rentang > 366 hari ditolak.
- **Laporan terjadwal**: daftar uji di 7a.11.
- **Web**: widget loading/galat/kosong; penanda filter tak berlaku; filter global di search param; dialog Bagikan (peringatan daftar, ringkasan cakupan); halaman publik tanpa kontrol filter; grafik lolos pemeriksaan aksesibilitas dasar; potongan JS grafik dimuat malas dan `verify-dist` lolos (<= 600 KB gzip); `page-frame.test.ts`, `route-meta-coverage.test.ts`, `mobile-navigation-guard.test.ts` hijau.

## 11. Operasional dan rilis
- Satu PR ke `dev`. Migrasi `0032` dan `0033` expand-only. Tidak ada variabel `.env` baru (token memakai `SESSION_SECRET` yang ada).
- Manual di VPS sebelum merge: perluas `qc_masked` di konfigurasi nginx ke awalan `/dashboard-publik/`.
- Laporan terjadwal butuh SMTP (`SMTP_*`, sudah ada) dan `APP_ORIGIN`; tanpa variabel `.env` baru. Perubahan `core/mail.ts` (body HTML, `bcc`) ikut PR yang sama dan dites di `core/mail.test.ts`.
- Fragmen changelog `feat(dashboard): ...`. Setelah selesai, `CLAUDE.md` diperbarui memuat bagian Dashboard (keputusan di atas, termasuk dua penyimpangan definisi di 7.4).

## 12. Diserahkan kepada pembangun
Bentuk visual persis kartu, pilihan kolom kisi, nama kunci cache, ambang `EXPLAIN`/indeks, tata letak dialog Bagikan, dan tes visual. Semua dengan mengikuti kit CRUD, sistem desain, dan aturan di `CLAUDE.md`.
