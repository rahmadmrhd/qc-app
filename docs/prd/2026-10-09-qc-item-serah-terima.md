# PRD — QC App: Data Item & Serah Terima WH → QC (Sub-project 2)

| | |
|---|---|
| **Status** | Draft — menunggu review |
| **Tanggal** | 2026-10-09 |
| **Pemilik** | rahmadm.rhd@gmail.com |
| **Bergantung pada** | `2026-10-08-qc-lokasi-cabang.md` (sudah di `dev`) dan fondasi akses (sesi, izin, audit; rilis) |

---

## 1. Ringkasan

> **Pembaruan 2026-10-23:** Serah terima kini berbasis **catatan**, bukan item katalog. Task tidak lagi memuat baris `item × qty`; daftar item dan jumlah ditempel dari WhatsApp ke editor catatan, diubah menjadi checklist, dicentang QC, dan dapat dikomentari. Ketentuan serah terima di bagian 4.5, 4.6, dan 4.7 di bawah mengikuti dokumen desain [`2026-10-23-serah-terima-catatan-wysiwyg-design.md`](../superpowers/specs/2026-10-23-serah-terima-catatan-wysiwyg-design.md), yang menggantikan ketentuan item/qty di sini. Bagian Data Item, merk, customer, dan sinkronisasi tidak berubah.

> **Pembaruan 2026-11-08 (keputusan pemilik produk):** modul sinkronisasi QC Desktop DIHAPUS: rute REST `/api/v1/sync/*`, token `SYNC_API_TOKEN`, penghitung revisi `sync_rev`, tabel `sync_state`, dan kontrak `docs/api/desktop-sync.md`. Alasan: QC Desktop dibuat ulang (Electron, tampilan sama dengan web ini, di monorepo ini; rencana `docs/superpowers/plans/2026-11-06-qc-desktop-country-lock-fase-0-1.md`) dan tidak memakai kontrak itu; belum ada klien sinkron maupun item di staging/production. Seluruh butir FS1–FS12, kriteria penerimaan Fase B2, risiko token sinkron, dan keputusan penghitung revisi di bawah ditandai dihapus. Butir FS13 (`setup`/`DRIVE_FOLDER_ID`) tidak berubah. Kolom `external_id` (id MySQL) dihapus menyusul pada hari yang sama atas keputusan pemilik produk (butir FI6, migrasi `0003_hapus_external_id.sql`). Kodenya hanya ada di riwayat git.

> **Pembaruan 2026-11-09 (Business Unit tahap 1, disetujui pemilik produk):** hak `item` kini dihitung **per Business Unit (BU)**, bukan dari penugasan lokasi. Item punya satu atau lebih BU; user hanya melihat item di BU yang boleh ia lihat; merk punya BU bawaan; Merk dipilih dari daftar (merk baru lewat dialog tambah). Tidak ada backfill hak `item` pengguna lama (keputusan 14). Rincian di bagian 4.1 (FP2, FP5), 4.3 (FI1, FI2, FI4, FI8), bagian 4.3b (FB1–FB9), dan log keputusan bagian 11. Spek: `docs/superpowers/specs/2026-11-08-business-unit-design.md`.

Dua modul bisnis pertama QC App, ditambah jalur sinkronisasi ke QC Desktop:

1. **Data Item**: katalog tipe barang yang **dipakai bersama semua lokasi**: merk, tipe, status *country lock*, daftar stiker yang harus ditempel, kelengkapan aksesoris, galeri gambar lampiran, dan detail/spesifikasi dalam **editor Markdown dengan sisip gambar**.
2. **Serah Terima WH → QC**: **task** yang dibuat Gudang (WH) untuk QC: nama customer + daftar tipe beserta jumlah. QC memperbarui jumlah yang selesai, atau menandai selesai per tipe maupun per task. Field customer dan tipe punya **auto-suggest**, sebab pengguna sering menulis nama yang berbeda untuk hal yang sama.

3. ~~**Sinkronisasi dengan QC Desktop** (Fase B2)~~ — **Dihapus 2026-11-08** (lihat pembaruan di atas). Teks semula: QC App menjadi sistem utama data item (migrasi dari spreadsheet lama). QC Desktop, yang terhubung ke MySQL di balik VPN, menarik dan mendorong data lewat endpoint API bertoken. QC App tidak pernah berbicara ke MySQL. Kontraknya ada di `docs/api/desktop-sync.md` dan dirancang generik agar stok stiker dan stok manual book dapat menyusul.

Fondasi yang dibutuhkan keduanya ikut dibangun: penyimpanan **gambar di Google Drive** dan komponen **editor Markdown**.

## 2. Latar Belakang & Tujuan

### 2.1 Kondisi sekarang
Fondasi akses, lokasi, penugasan, dan audit sudah ada. Menu Data Item dan Serah Terima di beranda masih "Segera hadir". Izin `item`, `handover`, `stock` sudah ada di model izin, tetapi belum ada halaman.

### 2.2 Tujuan
- **G1.** Admin item dapat mengelola katalog item lengkap dengan gambar dan detail Markdown.
- **G2.** WH dapat membuat task serah terima untuk satu lokasi dengan cepat: menempel daftar item dan jumlah dari WhatsApp ke catatan, yang otomatis menjadi checklist; satu tempelan besar dapat dipecah menjadi beberapa task.
- **G3.** QC melihat task di lokasinya di kanban (desktop) atau daftar kartu (ponsel), mencentang butir yang selesai, menyelesaikan task sekaligus, dan berkomentar pada teks catatan.
- **G4.** Variasi penulisan nama customer dan tipe tidak menghasilkan data ganda.
- **G5.** Hak WH dan hak QC dapat diberikan terpisah lewat role.

### 2.3 Non-goals
- Monitoring Stok (modul `stock`), penghitungan stok, dan sumber daya sinkronisasi stok (dihapus bersama kontrak sinkron, 2026-11-08).
- Aplikasi QC Desktop itu sendiri (proyek terpisah) dan koneksi ke MySQL.
- Notifikasi (email/chat) saat task dibuat atau selesai.
- Pemindaian barcode/QR, serial number per unit.
- Penghapusan permanen item, customer, atau task (hanya nonaktif/batal).
- Penggabungan customer ganda dan pembersihan file Drive yatim (diproses manual dulu).
- Versi/riwayat isi dokumen Markdown selain log audit.

## 3. Pengguna & Peran

| Persona | Deskripsi | Hak yang dibutuhkan |
|---|---|---|
| **Admin Item** | Mengelola katalog pada BU yang ia tugaskan. | `item: manage` pada semua BU item (FB5) |
| **WH (Gudang)** | Membuat dan mengubah task untuk lokasinya. | `handover: edit` atau `manage` di lokasinya |
| **QC** | Mengerjakan task di lokasinya. | `qc: edit` di lokasinya |
| **Pemantau** | Hanya melihat. | `item: view` pada BU yang ditugaskan (FB4), `handover: view` |
| **Super Admin** | `ADMIN_EMAIL`. | Semua. |

## 4. Kebutuhan Fungsional

### 4.1 Izin (perubahan model)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FP1 | Modul izin baru **Pengerjaan QC** (kunci `qc`), berlokasi, level `none` / `edit`. | Tampil di form Role dengan label dan petunjuk level. `qc: edit` membuat user dapat melihat task di lokasinya dan memperbarui progres. |
| FP2 | **`item` dibatasi per Business Unit** (diubah 2026-11-08; menggantikan rancangan "`item` global bersama"). Level `item` dihitung dari penugasan BU user (`users.bu_assignments`, berlaku di semua lokasi), bukan dari penugasan lokasi. Level global `item` untuk halaman non-BU (Merk, Customer) = level **tertinggi di antara seluruh penugasan BU** user. | Staf yang hanya punya penugasan lokasi dengan role ber-`item: view` tidak melihat item. Penugasan BU diatur pemegang `access: manage` (FB2). `access` tetap hanya dari "Semua lokasi". |
| FP3 | `handover` dan `qc` berlokasi: izin dihitung per lokasi seperti mekanisme yang ada. | Task hanya terlihat dan dapat diubah di lokasi yang diizinkan; lokasi terlarang ditolak `FORBIDDEN`. |
| FP4 | Tingkat hak `handover`: `view` melihat task; `edit` membuat dan mengubah isi task; `manage` juga membatalkan task. | Dijelaskan di petunjuk level pada form Role. |
| FP5 | Role yang sudah ada tetap valid. | Isi role tidak berubah, tetapi role dengan `item` hanya berlaku bila dipasang pada penugasan BU (FB2). Penugasan `item` dari lokasi tidak dimigrasikan (tanpa backfill, keputusan 14); pemegang `access: manage` menugaskan BU kepada user lewat form user. Tidak ada data item sebelum rilis ini sehingga tidak ada dampak data. |

### 4.2 Fondasi file dan editor Markdown (Fase A)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FA1 | Gambar disimpan di **folder Drive privat** milik pemilik script, tidak dibagikan publik. | Folder dibuat otomatis oleh `setup`; id-nya disimpan di Script Property. |
| FA2 | Upload gambar lewat API. Frontend mengecilkan gambar sebelum kirim. | Maks. sisi terpanjang 1600 px, dikonversi ke JPEG/WebP; server menolak > 1 MB hasil kompresi, tipe selain JPEG/PNG/WebP, dan input yang bukan gambar valid. |
| FA3 | Gambar tampil lewat API (`files.get`), bukan tautan Drive. | Hanya user login dengan izin pada entitas pemilik gambar yang dapat mengambilnya; data URL di-cache TanStack Query. |
| FA4 | Metadata file di sheet `files`: id, id Drive, MIME, ukuran, lebar, tinggi, pemilik (jenis + id), pembuat, waktu. | Gambar terhubung ke item (lampiran, contoh stiker, atau isi Markdown). |
| FA5 | **Komponen editor Markdown**: tab Tulis / Pratinjau, toolbar (judul, tebal, miring, daftar, tautan, kutipan, kode, **gambar**). | Menempel (paste) atau menyeret gambar ke editor mengunggahnya dan menyisipkan `![alt](qcfile:<id>)`. Tombol gambar membuka pemilih berkas. |
| FA6 | Render Markdown **aman**. | Tanpa HTML mentah; tautan hanya `http`, `https`, `mailto`; gambar hanya skema `qcfile:` yang diselesaikan lewat `files.get`. Skrip dan atribut sembarang tidak pernah dieksekusi. |
| FA7 | Batas ukuran dokumen. | Detail Markdown maks. 20.000 karakter (batas sel Sheets 50.000); lebih dari itu ditolak dengan pesan di field. |

### 4.3 Data Item (Fase B)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FI1 | Daftar item: tabel merk, tipe, country lock, status, jumlah gambar. Pencarian dan filter status lewat URL. | Butuh `item: view` pada minimal satu BU item; hanya item di BU yang boleh dilihat user yang tampil (FB4). |
| FI2 | Field item: **merk** (wajib, dipilih dari daftar merk lewat `LinkField`, maks. 60), **business unit** (wajib, minimal satu BU aktif, banyak pilihan; FB3), **tipe** (wajib, maks. 100), **country lock** (ya/tidak), **nama lain/alias** (daftar teks, maks. 10 @ 100), **stiker** (daftar: nama, catatan posisi/ketentuan, gambar contoh opsional; maks. 30), **kelengkapan** (daftar: nama + jumlah per unit ≥ 1; maks. 30), **gambar lampiran** (maks. 10), **detail Markdown** (FA5). | Butuh `item: edit` pada SEMUA BU item untuk mengubah (FB5); BU yang ditambahkan harus berhak `edit`. |
| FI8 | **Merk adalah tabel master** (`brands`: id, id MySQL, nama, kunci ternormalisasi, status), bukan teks bebas. Item menyimpan `brand_id`. Merk dipilih dari daftar merk yang ada lewat `LinkField`; merk baru hanya dibuat lewat dialog "tambah merk" (dengan audit `brand.create`), tidak lagi lahir diam-diam dari teks yang diketik saat item disimpan (diubah 2026-11-08, spek BU 5.5). Merk punya BU bawaan (FB6). Halaman **Merk** untuk tambah, **ganti nama** (berlaku ke semua item merk itu; kunci item dihitung ulang; audit `brand.update`), dan nonaktifkan/aktifkan. Merk nonaktif tidak dapat dipakai item baru. Izin memakai modul `item` (view/edit/manage; level global, lihat FP2). | Nama merk unik (ternormalisasi); ganti nama yang membuat merk+tipe dua item bentrok ditolak. |
| FI3 | Merk + tipe unik (dinormalisasi). | Duplikat ditolak `CONFLICT` dengan pesan di field; alias tidak boleh sama dengan merk+tipe item lain. |
| FI4 | Nonaktifkan dan aktifkan item; tidak ada hapus. | Butuh `item: manage` pada SEMUA BU item (FB5). Item nonaktif tidak muncul di saran tipe pada task baru; task lama tetap menampilkannya. |
| FI5 | Halaman detail item baca-saja untuk semua yang punya `item: view`. | Menampilkan semua field, galeri, stiker dan kelengkapan sebagai daftar rapi, dan detail Markdown terender. QC memakainya sebagai acuan kerja. |
| ~~FI6~~ | ~~Item membawa **id MySQL** (`external_id`, opsional, unik) yang semula dipakai sinkronisasi.~~ | **Dihapus 2026-11-08** (keputusan pemilik produk): kolom `external_id` (brands dan items), tampilan "ID MySQL" di halaman detail, dan field `externalId` di DTO dihapus lewat migrasi `0003_hapus_external_id.sql`. Alasan: tidak ada yang mengisinya sejak sinkron dihapus dan belum ada item di staging/production. |
| FI7 | Batas field: nama stiker 1–100, catatan stiker ≤ 300, nama kelengkapan 1–100, jumlah kelengkapan 1–999 (bilangan bulat), alias ≤ 10 @ 100, lampiran ≤ 10, stiker ≤ 30, kelengkapan ≤ 30; total JSON per kolom ≤ 40.000 karakter. | Ditegakkan di server (dan di form); lebih dari batas ditolak dengan pesan di field. |

### 4.3b Business Unit (BU, tahap 1)
Spek: `docs/superpowers/specs/2026-11-08-business-unit-design.md`. Hak per BU berdiri sendiri dari lokasi: level `none` / `view` / `edit` / `manage` per BU, sehingga satu user dapat punya hak berbeda di BU A dan BU B.

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FB1 | **Master BU** (`business_units`: kode unik, nama unik tanpa membedakan huruf besar/kecil, status aktif/nonaktif). Dikelola di Pengaturan Akses → Business Unit (`/access/business-units`): lihat butuh `access: view`; tambah dan ubah/nonaktifkan butuh `access: manage`. BU tidak dihapus. | Tidak ada BU awal: pemegang `access: manage` membuat BU pertama. Perubahan tercatat di Log Audit (`businessunit.*`). |
| FB2 | **Penugasan BU user** (`users.bu_assignments`): daftar `{ buId, roleIds }`; `buId` kosong = Semua BU. Terpisah dari penugasan lokasi di form user. Hanya modul ber-BU (`item`) yang dibaca dari role pada penugasan BU; role pada penugasan BU tidak memberi izin modul lain. | `access.users.save` wajib memuat `buAssignments` (tanpa itu ditolak 422, keputusan 15). User tanpa penugasan BU tidak melihat item apa pun (FB4). |
| FB3 | **Item wajib punya minimal satu BU aktif** (relasi banyak-ke-banyak `item_business_units`). Item baru hanya bisa ditambahkan ke BU aktif yang user berhak `edit`. Sebelum ada BU aktif, simpan item ditolak dengan pesan "buat BU dulu". | Item tanpa BU tidak tersimpan. BU nonaktif tidak tampil sebagai pilihan untuk item baru. |
| FB4 | **Filter baca per BU**: daftar, jumlah, pencarian, detail, dan berkas gambar item hanya memuat item yang beririsan dengan BU yang boleh dilihat user (level ≥ `view`). Item di luar hak = `NOT_FOUND`, bukan `FORBIDDEN`. Pengecualian yang disengaja: ekspor Sheets (`exports.sheets`) tidak difilter BU (keputusan 16, bagian 11). | Dua user BU berbeda tidak saling melihat item (daftar, detail, berkas). Tidak ada kebocoran lewat OpenAPI atau `GET /api/v1/me`. |
| FB5 | **Aturan tulis per BU**: mengubah atau menonaktifkan item butuh level pada SEMUA BU item (keputusan 13). Menambah BU ke item hanya ke BU yang user berhak `edit`; melepas BU boleh asal user berhak di semua BU item. | Item A+B dengan `view` di B: terlihat, tetapi tidak bisa diubah. Pesan penolakan tidak menyebut BU lain. |
| FB6 | **BU bawaan merk** (`brand_default_business_units`): merk punya nol atau lebih BU bawaan; daftar merk tetap global. Yang boleh mengubah merk (`item` global `edit`) boleh mengatur BU bawaan. Memilih merk di form item mengisi BU item dari BU bawaan bila user belum memilih BU; BU di luar hak user disaring. BU bawaan tidak memberi hak apa pun. | Merk tanpa BU bawaan: field BU kosong dan diisi manual. |
| FB7 | **BU nonaktif**: tidak bisa ditambahkan ke item atau merk baru, tetapi BU nonaktif yang sudah melekat tetap memberi hak atas item lamanya dan tetap dihitung untuk aturan minimal satu BU. Menonaktifkan BU tidak diblokir; halaman BU hanya menampilkan peringatan berisi jumlah item dan user yang masih memakainya. | Item lama tetap terlihat user di BU nonaktif itu. |
| FB8 | **Konflik keunikan item tetap global** (merk+tipe, nama lain). Pesan konflik generik, tanpa menyebut BU, merk, atau tipe item lain. | Item BU A tidak bisa dibuat dengan merk+tipe yang sama dengan item BU B, dan pesannya tidak menyebut BU B. |
| FB9 | **Level global `item`** (Merk, Customer) = tertinggi di antara seluruh penugasan BU; `manage` di satu BU saja sudah memberi kelola Merk dan Customer. | Tercatat di bagian 11 sebagai keputusan spek. |

### 4.4 Customer (master, Fase C)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FC1 | Tabel master `customers`: nama, kunci normalisasi, status. | Kunci = huruf kecil, tanda baca dibuang, spasi dirapikan; unik. |
| FC2 | **Pembuatan inline.** Pada form task, nama yang belum ada langsung membuat customer baru **tanpa form tambahan**. | Server mencari kunci normalisasi; bila ada, memakai customer itu (ejaan resmi menang); bila tidak, membuat baru, semua di dalam satu lock sehingga dua pengetik nama sama tidak menduplikasi. |
| FC3 | Auto-suggest customer. | Saran muncul saat mengetik: cocok toleran (typo ringan, urutan kata bebas, abaikan tanda baca/huruf besar). Memilih saran memakai customer itu. Daftar customer aktif untuk saran diambil lewat rute **serah terima** (izin `handover`/`qc` di lokasi), bukan rute halaman Customer, sehingga WH tanpa izin `item` tetap mendapat saran. |
| FC4 | Penanda nama mirip. | Bila nama yang diketik mirip (tapi tidak sama) dengan customer yang ada, muncul baris kecil "Mirip: *X*, pakai ini?" yang bisa diklik; tidak memblokir simpan. |
| FC5 | Halaman **Customer**: lihat, ganti nama, nonaktifkan/aktifkan. | Butuh `item: view` untuk melihat dan `item: manage` untuk mengubah. Nama baru tidak boleh bentrok dengan kunci customer lain. Customer nonaktif tidak disarankan pada task baru. |

### 4.5 Serah Terima (Fase C)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FH1 | Task milik **satu lokasi**. Satu batch selalu satu lokasi (dipilih sekali di atas); tiap task dibuat pada lokasi itu lewat `LocationField`. | Butuh `handover: edit` di lokasi tujuan. Desain 2026-10-23 §3 (butir 7). |
| FH2 | Isi task: **customer** (FC2; **opsional**, kosong = task tanpa customer) dan **catatan** Markdown (editor WYSIWYG, maks. **5.000** karakter). Task **tidak lagi memuat item katalog maupun qty**; item dan jumlah ditulis sebagai teks di catatan. | Editor catatan dan batas: Desain 2026-10-23 §4.1. |
| FH3 | **Tempel dari WhatsApp**: tempelan diubah otomatis menjadi checklist (baris `<teks> = <angka><satuan>` menjadi butir; baris lain menjadi paragraf). Pada jalur bulk, tempelan besar dipecah menjadi beberapa task dan hasilnya dicek sebelum disimpan. Menggantikan saran tipe item yang lama. | Saran customer (FC3) tetap berlaku. Desain 2026-10-23 §4.2–4.3. |
| FH4 | **Nomor task otomatis** `ST-YYYYMMDD-NNN` (urut per hari). | Dibuat di server dalam lock; tidak pernah ganda. Dalam satu batch tiap task mendapat nomor sendiri. |
| FH5 | Status task: **Baru** (belum ada butir tercentang), **Dikerjakan** (sebagian butir tercentang), **Selesai** (semua butir tercentang, atau ditandai selesai bila task tanpa butir), **Dibatalkan** (disimpan). | Baru/Dikerjakan/Selesai diturunkan dari centang; Dibatalkan disimpan. Desain 2026-10-23 §4.4. |
| FH6 | Daftar task: **desktop** berbentuk kanban empat kolom (Baru, Dikerjakan, Selesai, Dibatalkan); **ponsel** (< 768 px) berbentuk daftar kartu dengan filter status. Kartu menampilkan nomor, customer, label status, **seluruh** catatan, butir checklist yang dapat dicentang, progres centang (mis. 1/2), dan komentar task (ringkas, dengan tombol tambah komentar). Tidak ada task yang disembunyikan. Mengikuti **lokasi aktif** header. | Butuh `handover: view` atau `qc: edit` di lokasi tersebut. Desain 2026-10-23 §4.6. |
| FH7 | Ubah isi task (WH) dengan pemeriksaan versi (`expectedUpdatedAt`). Mengubah teks butir yang sudah dicentang **mereset** centang butir itu (tercatat di audit); menghapus atau mengonversi butir yang sudah dicentang **ditolak**. | Butuh `handover: edit`. Task Dibatalkan terkunci. Desain 2026-10-23 §4.4. |
| FH8 | Batalkan task (WH), dengan konfirmasi. | Butuh `handover: manage`. Task Dibatalkan hanya baca; centang dan komentar tidak lagi diterima; jejak audit tetap tersimpan. |
| FH9 | Snapshot nama item (**dihapus**). Serah terima tidak lagi merujuk item, sehingga tidak ada baris dan tidak ada snapshot "merk tipe"; catatan disimpan sebagai teks apa adanya. | Tidak berlaku lagi. Desain 2026-10-23 §5. |

### 4.6 Pengerjaan QC
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FQ1 | QC **mencentang tiap butir checklist** pada catatan (atau membatalkan centangnya). Centang bersifat set per butir ("dicentang/tidak"), bukan toggle buta, sehingga dua QC tidak saling membatalkan. Dapat dilakukan dari kartu maupun halaman detail. | Butuh `qc: edit` di lokasi task. Desain 2026-10-23 §4.4. |
| FQ2 | **Selesaikan task** (tombol *Mark done*): mencentang seluruh butir yang belum dicentang; untuk task tanpa butir, menandainya selesai. Tombol hanya tampil pada task Baru dan Dikerjakan. | Satu klik; mencatat siapa dan kapan. Task Selesai tidak dibuka kembali; task tanpa butir juga dapat diselesaikan. Desain 2026-10-23 §4.4, §4.6, §12.1. |
| FQ3 | **Komentar** pada catatan: (a) pilih teks lalu tombol **"Balas"** mengambang (desktop dan ponsel) membuka kotak komentar, menyimpan kutipan, jangkar posisi, isi, pelaku, dan waktu; (b) **komentar umum** tanpa seleksi lewat tombol "Tambah komentar" pada kartu dan halaman detail, dengan `quote: ''` (tidak pernah usang). | Boleh oleh siapa pun yang punya akses lihat ke lokasi (WH, QC, pemantau). Hanya tambah: tidak ada ubah, hapus, atau balasan bersarang. Isi 1–1.000 karakter; maks. 50 komentar atau 40.000 karakter JSON per task, mana lebih dulu. Desain 2026-10-23 §4.5, §12.6–12.8. |
| FQ4 | Setiap perubahan centang dan penyelesaian mencatat pelaku dan waktu; tampil di kartu (pelaku/waktu centang terakhir) dan di halaman detail. | Centang tanpa perubahan tidak menambah audit. Desain 2026-10-23 §4.6. |
| FQ5 | Halaman detail task menampilkan catatan memakai **NoteView** (render baca, centang interaktif, dan komentar), bukan editor WYSIWYG; panel komentar dan riwayat tampil di samping atau di bawah catatan. | Bagi QC butir dapat dicentang; bagi yang hanya melihat baca-saja. Tautan ke halaman item tidak lagi ada karena serah terima tidak merujuk item katalog. Desain 2026-10-23 §4.6. |
| FQ6 | Task Dibatalkan tidak dapat diubah QC: centang, penyelesaian, dan komentar ditolak. Task yang sudah selesai tidak dibuka kembali; "Buka kembali" hanya ada pada task Dibatalkan dan hanya untuk WH dengan `handover: manage`. | `CONFLICT` dengan pesan jelas untuk task Dibatalkan. Desain 2026-10-23 §4.4–4.5, §12.1. |

### 4.7 Audit
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FAU1 | Aksi di `audit_log` dengan snapshot before/after: `item.create/update/activate/deactivate`, `customer.create/rename/activate/deactivate`, `handover.create/update/cancel`, `handover.check/uncheck` (per butir), `handover.done` (selesaikan), `handover.uncancel` (buka kembali task Dibatalkan), `handover.comment`. Aksi `handover.progress` dan `handover.complete` (model lama) dihapus. | Tampil di Log Audit dengan label Indonesia. Centang tanpa perubahan tidak menambah audit. |
| FAU2 | Diff audit yang mudah dibaca untuk item dan task. | Daftar (alias, stiker, kelengkapan) dan butir checklist task dibandingkan per entri dengan warna tambah/ubah/hapus; isi Markdown (detail item dan catatan task) ditampilkan sebagai "diubah" tanpa diff teks penuh. |

### 4.8 ~~Sinkronisasi dengan QC Desktop (Fase B2)~~ — Dihapus 2026-11-08
> **Dihapus 2026-11-08 (keputusan pemilik produk).** Modul sinkronisasi QC Desktop beserta kontrak `docs/api/desktop-sync.md` dihapus karena QC Desktop dibuat ulang dan tidak memakai kontrak ini (lihat pembaruan di bagian 1). Butir FS1–FS12 di bawah tidak berlaku lagi; teks aslinya ada di riwayat git. Penomoran dipertahankan agar rujukan lain tidak bergeser.

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| ~~FS1~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS2~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS3~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS4~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS5~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS6~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS7~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS8~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS9~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS10~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS11~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| ~~FS12~~ | **Dihapus 2026-11-08** (modul sinkron QC Desktop dihapus; keputusan pemilik). | Tidak berlaku. |
| FS13 | Pengamanan folder gambar: `setup` **tidak** menimpa `DRIVE_FOLDER_ID` yang sudah terisi bila foldernya tidak dapat diakses; ia berhenti dengan pesan jelas (mengubah perilaku Fase A yang membuat folder baru). | Properti tidak berubah, laporan `setup` menyebut penyebab; folder baru hanya dibuat bila properti kosong. |

## 5. Kebutuhan Non-Fungsional
| ID | Kebutuhan |
|---|---|
| NFR1 | Semua akses Drive hanya lewat klien Google (`getBridge(env)`, `server/src/core/google/`). |
| NFR2 | Frontend tidak mempercayai klien: validasi ukuran, tipe, dan jumlah dilakukan ulang di server. |
| NFR3 | Auto-suggest berjalan **di klien** atas daftar yang sudah dimuat (item dan customer aktif berjumlah ratusan, bukan jutaan); tanpa panggilan API per ketikan. |
| NFR4 | Tiap potongan JS web tetap ≤ 600 KB gzip setelah penambahan Markdown (dijaga `verify-dist`). |
| NFR5 | Sheet baru memakai pola yang ada (`core/db`, teks aman dari formula injection) dan dibuat otomatis oleh `setup`. |
| NFR6 | Tabel dan formulir dapat dipakai di ponsel (375×812); editor Markdown menumpuk vertikal di layar sempit. |
| NFR7 | Mode terang dan gelap, label Indonesia, tanpa warna sebagai satu-satunya penanda (selaras fondasi). |

## 6. Arsitektur & Keputusan Teknis

### 6.1 Fase
| Fase | Isi | Rencana implementasi |
|---|---|---|
| **A** | Platform Drive, sheet `files`, API file, komponen editor Markdown, penanda `qc` di model izin, `item` menjadi global | `...-qc-fase-a-file-editor.md` |
| **B** | Data Item (CRUD, alias, stiker, kelengkapan, galeri, detail, nonaktif, audit) | `...-qc-fase-b-item.md` |
| **B2** | ~~Kerangka sinkronisasi (`doPost`, token, pembatas, tabel rute sinkron), sumber daya `items`, `sync.file.get`, pengamanan folder `setup`, kontrak `docs/api/desktop-sync.md`~~ (dihapus 2026-11-08) | `...-qc-fase-b2-sinkronisasi.md` |
| **C** | Customer master, Serah Terima, pengerjaan QC, auto-suggest, audit | `...-qc-fase-c-serah-terima.md` |

Tiap fase dirilis dan dapat diuji sendiri. Urutan: A → B → B2 → C (B2 sebelum C agar item sungguhan sudah ada saat task dibuat).

**Catatan router:** FH6 meminta izin "salah satu dari" (`handover: view` **atau** `qc: edit` di lokasi). Router perlu mendukung izin berupa daftar alternatif; ini ditambahkan di Fase A bersama penanda `qc`.

### 6.2 Model data (sheet baru)
| Sheet | Kolom |
|---|---|
| `files` | `id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by` |
| `items` | `id, brand_id, model, key, is_country_lock, aliases, stickers, accessories, attachments, detail_md, status, created_at, updated_at, updated_by` (`aliases/stickers/accessories/attachments` = JSON; kolom `external_id` dihapus 2026-11-08) |
| `business_units` | `id, code, name, name_key, status, created_at, updated_at, updated_by` (`name_key` = nama huruf kecil, unik; migrasi `0004_business_units.sql`) |
| `item_business_units` | `item_id, bu_id` (banyak-ke-banyak; minimal satu BU aktif per item, dijaga aplikasi) |
| `brand_default_business_units` | `brand_id, bu_id` (BU bawaan merk; nol atau lebih, hanya mengisi form) |
| `users` (kolom baru) | `bu_assignments` (JSON `{ buId, roleIds }`; kosong = tanpa penugasan BU; tanpa backfill) |
| ~~`sync_state`~~ | Dihapus 2026-11-08 (migrasi `0002_hapus_sync_rev.sql`). |
| `customers` | `id, name, key, status, created_at, updated_at, updated_by` |
| `handovers` | `id, number, location_id, customer_id, customer_name, note, status, checks, comments, completed_at, completed_by, created_at, created_by, updated_at, updated_by` (`status` tersimpan: `open` / `cancelled`; `note` = Markdown ≤ 5.000 karakter; `checks` = centang per butir (JSON, pelaku dan waktu); `comments` = komentar beranchor (JSON, ≤ 50 per task); `completed_at/completed_by` = penanda selesai untuk task tanpa butir checklist; masing-masing dalam sel sendiri dengan batas JSON 40.000 karakter) |
| ~~`handover_lines`~~ | Tidak dipakai lagi sejak serah terima berbasis catatan (lihat dokumen desain 2026-10-23 §5). Sheet yang sudah ada dibiarkan kosong. |

`key` = merk+tipe (item) atau nama (merk, customer) yang dinormalisasi; dipakai untuk keunikan dan pencocokan.

### 6.3 Kontrak API (garis besar; rinci di rencana)
`files.upload`, `files.get`; `items.list`, `items.get`, `items.save`, `items.setStatus`; `brands.list`, `brands.save`, `brands.setStatus`; `customers.list`, `customers.rename`, `customers.setStatus`; `handovers.options`, `handovers.board` (seluruh isi board satu lokasi dalam satu panggilan), `handovers.get`, `handovers.save` (catatan saja; membuat customer baru bila perlu), `handovers.saveBatch` (atomik per permintaan, maks. 30 task per permintaan di server VPS; formulir bulk mengirim SATU permintaan atomik: gagal = tidak ada yang tersimpan. **Keputusan pemilik produk 2026-11-05** menggantikan batas lama 5 task (semula 10, diturunkan 2026-10-30 demi anggaran CPU platform sebelumnya) karena batas CPU platform sebelumnya tidak ada lagi di VPS), `handovers.cancel`, `handovers.setCheck` (centang per butir, `qc: edit`), `handovers.setDone { id, locationId }` (selesaikan task, `qc: edit`; tanpa field `done`), `handovers.reopen` (buka kembali task Dibatalkan, `handover: manage`), `handovers.comment` (hanya tambah; komentar umum dengan `quote` kosong; izin lihat). Rute `setProgress`, `completeLine`, dan `completeAll` dihapus. Rute berlokasi memakai `scope: 'location'` dan `ctx.locationIds` (resep di `docs/adding-a-module.md`).

### 6.3b ~~Endpoint sinkronisasi~~ — Dihapus 2026-11-08
Modul `server/src/modules/sync/` dan rute `/api/v1/sync/*` dihapus (keputusan pemilik, lihat bagian 1). Rute itu kini 404 problem+json biasa.

### 6.4 Gambar dan Markdown
- Drive: lewat klien Google (`server/src/core/google/`); folder utama dibuat saat pertama dipakai (`docs/setup-google.md`).
- Dokumen merujuk gambar dengan `qcfile:<fileId>`, bukan URL Drive; izin diperiksa pada setiap `files.get`.
- Pustaka: `react-markdown` + `remark-gfm` (tanpa plugin HTML mentah); editor dibangun sendiri di atas `<textarea>` agar ringan dan sesuai build satu-berkas.

### 6.5 Auto-suggest
Fungsi murni di `shared/` (dites tabel): normalisasi, skor kecocokan (awalan > substring > token tak berurutan > jarak edit kecil), pengurutan. Dipakai untuk saran tipe, saran customer, dan penanda "mirip". Server memakai normalisasi yang sama untuk keunikan.

### 6.6 Konkurensi
Centang butir disimpan per butir sebagai set ("dicentang/tidak") di dalam lock, sehingga dua QC tidak saling membatalkan. Isi catatan memakai pemeriksaan versi (`expectedUpdatedAt`): penyimpanan kedua pada versi yang sama ditolak dan drafnya dipertahankan. Dokumen desain 2026-10-23 §4.4 dan §4.5 berlaku untuk serah terima.

## 7. Kualitas & Pengujian
- Fungsi murni (normalisasi dan skor saran, turunan status task) dites tabel dengan nama-nama yang bervariasi.
- Layanan server dites dengan klien Google palsu (`server/test-support/fake-bridge.ts`).
- Tes izin per method: lokasi terlarang, nonaktif, dan tak dikenal untuk rute berlokasi; `item` global dari penugasan lokal.
- Tes frontend untuk editor (sisip gambar, pratinjau aman), form task (saran, pembuatan customer inline, penanda mirip), dan tindakan QC.
- Mock backend memuat data contoh item, customer, dan task agar `bun run dev` dapat dicoba penuh.
- Checklist E2E ditambah tiap fase.

## 8. Risiko & Mitigasi
| Risiko | Dampak | Mitigasi |
|---|---|---|
| Izin Drive baru memicu persetujuan ulang | Pengguna bingung saat `setup` | Dicatat di dokumen rilis dan `docs/setup-google.md`; dilakukan pemilik script sekali. |
| Ukuran bundel naik (Markdown) | Halaman lambat/melebihi batas HtmlService | NFR4; pustaka ringan, tanpa editor WYSIWYG berat. |
| Gambar yatim (diunggah, lalu dokumen tidak disimpan) | Folder Drive membengkak | Maks. 50 berkas belum terpakai per user (`MAX_UNATTACHED_UPLOADS`; menautkan berkas ke entitas membebaskan kuota) dan berkas Drive dibuang bila pencatatan sheet gagal. Kedaluwarsa otomatis berkas yatim belum ada; `owner_id` kosong memudahkan pembersihan manual. |
| XSS lewat Markdown | Pencurian sesi | FA6: tanpa HTML mentah, skema tautan dibatasi, gambar hanya `qcfile:`; tes khusus. |
| Variasi nama tetap lolos | Customer ganda | Normalisasi + penanda mirip + halaman Customer untuk ganti nama; penggabungan di luar lingkup (dicatat). |
| Nomor task ganda | Kekacauan rujukan | Dibuat di server di dalam lock; tes konkurensi logis. |
| Perubahan `item` menjadi per BU menyentuh izin | Regresi akses; user lama tidak melihat item setelah rilis | Tes `resolveAccess` dan filter BU ditambah; tanpa backfill (keputusan 14), dampak data nol karena belum ada item; pemegang `access: manage` menugaskan BU lewat form user. |
| Batas sel 50.000 karakter | Data terpotong | Batas FA7 dan batas jumlah entri; validasi ukuran total JSON di server. |

| ~~Token sinkron bocor~~ | Dihapus 2026-11-08: token dan rute sinkron tidak ada lagi. | - |
| ~~Konflik dua arah menimpa pekerjaan~~ | Dihapus 2026-11-08: tidak ada sinkron dua arah. | - |
| Folder gambar lama salah atau tidak berizin | Gambar tidak terbaca atau folder baru terbuat tanpa disadari | FS13 (setup tidak menimpa), urutan panduan: isi `DRIVE_FOLDER_ID` sebelum `setup`, validasi per id saat push. |
| Migrasi besar melewati batas waktu `doPost` | Sebagian item belum masuk | Batas per panggilan, hasil per item, push idempoten sehingga dapat diulang aman. |
| Desktop merender HTML mentah dari `detail` | XSS di Desktop | Kontrak mewajibkan Desktop tidak merender HTML mentah; QC App tidak pernah merendernya. |

## 9. Definition of Done
**Fase A**
- [ ] `setup` membuat folder Drive dan sheet `files`; izin Drive tercantum di `appsscript.json`.
- [ ] Upload, ambil, dan tampil gambar bekerja dengan pemeriksaan izin dan batas ukuran. (diverifikasi E2E di halaman Item, Fase B)
- [x] Editor Markdown (tulis, pratinjau, sisip gambar lewat tombol/paste/seret) dan render aman dites.
- [x] Modul `qc` ada di form Role; `item` global dari semua penugasan; tes `resolveAccess` diperbarui.

**Fase B**
- [x] CRUD item lengkap dengan alias, stiker, kelengkapan, galeri, detail; keunikan dan nonaktif bekerja.
- [x] Merk sebagai tabel master: saran, buat langsung saat item disimpan, ganti nama, nonaktif, halaman Merk, audit `brand.*`.
- [x] Halaman daftar dan detail item; audit dengan diff yang terbaca.

**Fase B2** — dihapus 2026-11-08 (modul sinkron QC Desktop dihapus; keputusan pemilik):
- [x] `setup` tidak menimpa `DRIVE_FOLDER_ID` yang tidak dapat diakses (FS13).
- ~~Kerangka REST sinkron, pull/push item dan merk, `GET /sync/files/{id}`, migrasi awal dari MySQL via Desktop, dan persetujuan tim Desktop atas `docs/api/desktop-sync.md`~~: tidak berlaku (dihapus 2026-11-08).

**Fase C**
- [x] Customer master dengan pembuatan inline, saran, dan penanda mirip; halaman Customer.
- [x] Task serah terima berbasis catatan (buat, bulk, ubah, batalkan) dengan nomor otomatis, tempel dari WhatsApp, dan kanban/kartu (dokumen desain 2026-10-23 §9).
- [x] QC mencentang butir, menyelesaikan task, dan berkomentar; status turunan Baru/Dikerjakan/Selesai/Dibatalkan benar; board satu API.
- [x] Semua rute berlokasi menegakkan izin per lokasi; audit lengkap.

**Semua fase**
- [ ] `bun run check` hijau, build lolos `verify-dist`, checklist E2E diperbarui dan lulus di deployment.
- [ ] `CLAUDE.md` dan `docs/` diperbarui.

## 10. Pertanyaan yang Sudah Dijawab
| Pertanyaan | Jawaban |
|---|---|
| Item per lokasi atau bersama? | Katalog bersama; serah terima per lokasi. |
| Penyimpanan gambar? | Drive privat, dilayani lewat aplikasi. |
| Pembagian hak WH dan QC? | Dua modul izin terpisah (`handover` untuk WH, `qc` untuk QC). |
| Struktur stiker dan kelengkapan? | Daftar bernama + catatan (stiker boleh bergambar contoh; kelengkapan dengan jumlah). |
| Model customer? | Tabel master; pembuatan inline saat mengetik tanpa form tambahan. |
| Struktur dokumen? | Satu PRD, tiga rencana bertahap. |
| Notifikasi? | Tidak di fase ini. |
| ~~Hubungan spreadsheet sinkron dengan QC App?~~ | Dihapus 2026-11-08: sinkron QC Desktop dihapus. |
| Sumber kebenaran data item? | QC App (sebelumnya dua arah dengan Desktop; sinkron dihapus 2026-11-08). |
| Gambar lama di spreadsheet? | Memakai folder Drive yang sama (`DRIVE_FOLDER_ID` = folder lama). |
| ~~Akses Desktop?~~ | Dihapus 2026-11-08. |
| ~~`isCountryLock` dan token?~~ | Dihapus 2026-11-08. |
| Proyek GAS lama? | Dipensiunkan setelah migrasi (T35, 2026-11-07). Rencana arahan ke REST `/api/v1/sync/*` gugur: sinkron dihapus 2026-11-08. |
| ~~Cara Desktop membaca gambar?~~ | Dihapus 2026-11-08. |
| ~~Field yang disinkronkan?~~ | Dihapus 2026-11-08. |
| ~~Kontrak hanya untuk item?~~ | Dihapus 2026-11-08: kontrak sinkron tidak ada lagi. |
| Nama modul QC dan izin Drive? | "Pengerjaan QC" (kunci `qc`); izin Drive disetujui saat `setup`. |
| Siapa boleh mengubah item yang berada di beberapa BU? | Hanya user yang berhak ubah di semua BU item itu (keputusan 13, 2026-11-08). |
| Hak `item` user lama setelah rilis BU? | Tidak dibackfill (keputusan 14, 2026-11-09); admin menugaskan BU lewat form user. |

## 11. Keputusan yang Saya Ambil (mohon dikoreksi bila perlu)
- ~~**`item` global dihitung dari semua penugasan**, bukan hanya "Semua lokasi" (FP2), agar staf cabang dapat memilih dari katalog.~~ — **Diganti 2026-11-08** (keputusan pemilik produk, Business Unit tahap 1): `item` dibatasi per BU (FP2, FB1–FB5). `access` tetap hanya dari "Semua lokasi".
- **Customer dikelola di bawah izin `item`** (master data), sedangkan membuatnya inline cukup `handover: edit`.
- **Nomor task per hari** `ST-YYYYMMDD-NNN`, memakai zona waktu script.
- **Penyelesaian bersamaan**: centang per butir dan komentar hanya tambah; isi catatan memakai pemeriksaan versi (lihat 6.6).
- ~~**Penghitung revisi sinkron per sumber daya** (`sync_rev`)~~ — Dihapus 2026-11-08 bersama modul sinkron.
- ~~**"Hapus" dari Desktop diterjemahkan jadi nonaktif**~~ — Dihapus 2026-11-08 (tidak ada Desktop sinkron). Item tetap tidak pernah dihapus.
- ~~**Daftar dan teks pada push bersifat "ganti seluruhnya"**~~ — Dihapus 2026-11-08.
- **`setup` tidak lagi membuat folder baru bila `DRIVE_FOLDER_ID` sudah terisi tetapi tidak dapat diakses** (FS13), karena itu hampir pasti folder buatan pengguna (folder gambar lama), bukan folder yang boleh diganti diam-diam.
- **Gambar di Markdown pada kabel memakai `drive:<id>`** dan dipetakan ke `qcfile:` di dalam QC App.
- **Business Unit tahap 1 (2026-11-08, disetujui pemilik produk).** Hak `item` per BU dan penugasan BU user (FB1–FB2), relasi item↔BU dan minimal satu BU (FB3), filter baca dan aturan tulis per BU (FB4–FB5), BU bawaan merk dan `LinkField` (FB6, FI8). Alasan: data item harus dibatasi per BU sebelum data stiker dan Serial Number dibuat. Spek: `docs/superpowers/specs/2026-11-08-business-unit-design.md`.
- **Mengubah item multi-BU hanya oleh user yang berhak di semua BU item (2026-11-08, keputusan 13, disetujui pemilik produk).** Alasan: user BU A tidak boleh mengubah bagian item yang juga dipakai BU B.
- **Merk baru tidak lagi lahir dari teks (2026-11-08, spek 5.5, disetujui pemilik produk).** Menggantikan keputusan FI8 "dibuat langsung saat item disimpan". Alasan: field referensi memakai `LinkField` (pilih yang ada, tambah lewat dialog). Dialog tambah merk memakai level izin merk yang berlaku.
- **Tanpa backfill hak `item` lama (2026-11-09, keputusan 14, disetujui pemilik produk).** Alasan: staging dan production belum punya data merk maupun item. User lama tidak melihat item sampai diberi penugasan BU lewat form user.
- **`buAssignments` wajib saat menyimpan user (2026-11-09, keputusan 15, disetujui pemilik produk).** Alasan: admin dengan tab lama yang terbuka saat deploy harus memuat ulang agar tidak menimpa penugasan BU.
- **Ekspor Sheets tidak difilter BU (2026-11-09, keputusan 16, disetujui pemilik produk).** Alasan: fitur ekspor Sheets belum dibutuhkan saat ini; `exports.sheets` (hanya `access: manage`) tetap mengekspor seluruh item dan dicatat sebagai pengecualian FB4. Ditinjau bersama fitur Serial Number.
- **Jawaban berkas lintas BU disamakan (2026-11-09, keputusan 17, disetujui pemilik produk).** Memasang berkas milik item BU lain dijawab `VALIDATION` seperti berkas tidak dikenal, agar keberadaan berkas lintas BU tidak bisa diuji.
- **Unggahan yang belum terpasang hanya untuk pengunggahnya (2026-11-09, keputusan 18, disetujui pemilik produk).** User lain mendapat `NOT_FOUND` (jalur item; jalur QR tidak berubah). Unggahan item yang tak pernah terpasang belum dibersihkan otomatis (batas 50 per user); pembersihannya dikerjakan sebagai tugas terpisah di luar BU.
