# PRD — QC App: Data Item & Serah Terima WH → QC (Sub-project 2)

| | |
|---|---|
| **Status** | Draft — menunggu review |
| **Tanggal** | 2026-10-09 |
| **Pemilik** | rahmadm.rhd@gmail.com |
| **Bergantung pada** | `2026-10-08-qc-fondasi-akses.md` (rilis) dan `2026-10-08-qc-lokasi-cabang.md` (sudah di `dev`) |

---

## 1. Ringkasan

> **Pembaruan 2026-10-23:** Serah terima kini berbasis **catatan**, bukan item katalog. Task tidak lagi memuat baris `item × qty`; daftar item dan jumlah ditempel dari WhatsApp ke editor catatan, diubah menjadi checklist, dicentang QC, dan dapat dikomentari. Ketentuan serah terima di bagian 4.5, 4.6, dan 4.7 di bawah mengikuti dokumen desain [`2026-10-23-serah-terima-catatan-wysiwyg-design.md`](../superpowers/specs/2026-10-23-serah-terima-catatan-wysiwyg-design.md), yang menggantikan ketentuan item/qty di sini. Bagian Data Item, merk, customer, dan sinkronisasi tidak berubah.

Dua modul bisnis pertama QC App, ditambah jalur sinkronisasi ke QC Desktop:

1. **Data Item**: katalog tipe barang yang **dipakai bersama semua lokasi**: merk, tipe, status *country lock*, daftar stiker yang harus ditempel, kelengkapan aksesoris, galeri gambar lampiran, dan detail/spesifikasi dalam **editor Markdown dengan sisip gambar**.
2. **Serah Terima WH → QC**: **task** yang dibuat Gudang (WH) untuk QC: nama customer + daftar tipe beserta jumlah. QC memperbarui jumlah yang selesai, atau menandai selesai per tipe maupun per task. Field customer dan tipe punya **auto-suggest**, sebab pengguna sering menulis nama yang berbeda untuk hal yang sama.

3. **Sinkronisasi dengan QC Desktop** (Fase B2): QC App menjadi sistem utama data item (migrasi dari spreadsheet dan proyek GAS lama). QC Desktop, yang terhubung ke MySQL di balik VPN, **menarik dan mendorong** data lewat endpoint API bertoken. QC App tidak pernah berbicara ke MySQL. Kontraknya ada di `docs/api/desktop-sync.md` dan dirancang generik agar stok stiker dan stok manual book dapat menyusul.

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
- Monitoring Stok (modul `stock`), penghitungan stok, dan sumber daya sinkronisasi stok (kontrak hanya menetapkan konvensi, lihat `docs/api/desktop-sync.md` bagian 4).
- Aplikasi QC Desktop itu sendiri (proyek terpisah) dan koneksi ke MySQL.
- Notifikasi (email/chat) saat task dibuat atau selesai.
- Pemindaian barcode/QR, serial number per unit.
- Penghapusan permanen item, customer, atau task (hanya nonaktif/batal).
- Penggabungan customer ganda dan pembersihan file Drive yatim (diproses manual dulu).
- Versi/riwayat isi dokumen Markdown selain log audit.

## 3. Pengguna & Peran

| Persona | Deskripsi | Hak yang dibutuhkan |
|---|---|---|
| **Admin Item** | Mengelola katalog. | `item: manage` |
| **WH (Gudang)** | Membuat dan mengubah task untuk lokasinya. | `handover: edit` atau `manage` di lokasinya |
| **QC** | Mengerjakan task di lokasinya. | `qc: edit` di lokasinya |
| **Pemantau** | Hanya melihat. | `item: view`, `handover: view` |
| **Super Admin** | `ADMIN_EMAIL`. | Semua. |

## 4. Kebutuhan Fungsional

### 4.1 Izin (perubahan model)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FP1 | Modul izin baru **Pengerjaan QC** (kunci `qc`), berlokasi, level `none` / `edit`. | Tampil di form Role dengan label dan petunjuk level. `qc: edit` membuat user dapat melihat task di lokasinya dan memperbarui progres. |
| FP2 | **`item` menjadi modul global bersama** (keluar dari `LOCATION_MODULES`). Level global `item` = level **tertinggi dari semua penugasan** user (lokasi mana pun, termasuk "Semua lokasi"). | Staf yang hanya ditugaskan di satu lokasi dengan role ber-`item: view` dapat memilih item dari katalog. Berbeda dengan `access`, yang tetap hanya dari "Semua lokasi". |
| FP3 | `handover` dan `qc` berlokasi: izin dihitung per lokasi seperti mekanisme yang ada. | Task hanya terlihat dan dapat diubah di lokasi yang diizinkan; lokasi terlarang ditolak `FORBIDDEN`. |
| FP4 | Tingkat hak `handover`: `view` melihat task; `edit` membuat dan mengubah isi task; `manage` juga membatalkan task. | Dijelaskan di petunjuk level pada form Role. |
| FP5 | Role yang sudah ada tetap valid. | Role dengan `item` tetap berlaku; level `item` kini berlaku global (lihat FP2). Tidak ada data item sebelum rilis ini sehingga tidak ada dampak data. |

### 4.2 Fondasi file dan editor Markdown (Fase A)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FA1 | Gambar disimpan di **folder Drive privat** milik pemilik script, tidak dibagikan publik. | Folder dibuat otomatis oleh `setup`; id-nya disimpan di Script Property. |
| FA2 | Upload gambar lewat RPC. Frontend mengecilkan gambar sebelum kirim. | Maks. sisi terpanjang 1600 px, dikonversi ke JPEG/WebP; server menolak > 1 MB hasil kompresi, tipe selain JPEG/PNG/WebP, dan input yang bukan gambar valid. |
| FA3 | Gambar tampil lewat RPC (`files.get`), bukan tautan Drive. | Hanya user login dengan izin pada entitas pemilik gambar yang dapat mengambilnya; data URL di-cache TanStack Query. |
| FA4 | Metadata file di sheet `files`: id, id Drive, MIME, ukuran, lebar, tinggi, pemilik (jenis + id), pembuat, waktu. | Gambar terhubung ke item (lampiran, contoh stiker, atau isi Markdown). |
| FA5 | **Komponen editor Markdown**: tab Tulis / Pratinjau, toolbar (judul, tebal, miring, daftar, tautan, kutipan, kode, **gambar**). | Menempel (paste) atau menyeret gambar ke editor mengunggahnya dan menyisipkan `![alt](qcfile:<id>)`. Tombol gambar membuka pemilih berkas. |
| FA6 | Render Markdown **aman**. | Tanpa HTML mentah; tautan hanya `http`, `https`, `mailto`; gambar hanya skema `qcfile:` yang diselesaikan lewat `files.get`. Skrip dan atribut sembarang tidak pernah dieksekusi. |
| FA7 | Batas ukuran dokumen. | Detail Markdown maks. 20.000 karakter (batas sel Sheets 50.000); lebih dari itu ditolak dengan pesan di field. |

### 4.3 Data Item (Fase B)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FI1 | Daftar item: tabel merk, tipe, country lock, status, jumlah gambar. Pencarian dan filter status lewat URL. | Butuh `item: view`. |
| FI2 | Field item: **merk** (wajib, maks. 60), **tipe** (wajib, maks. 100), **country lock** (ya/tidak), **nama lain/alias** (daftar teks, maks. 10 @ 100), **stiker** (daftar: nama, catatan posisi/ketentuan, gambar contoh opsional; maks. 30), **kelengkapan** (daftar: nama + jumlah per unit ≥ 1; maks. 30), **gambar lampiran** (maks. 10), **detail Markdown** (FA5). | Butuh `item: edit` untuk menambah/mengubah. |
| FI8 | **Merk adalah tabel master** (`brands`: id, id MySQL, nama, kunci ternormalisasi, status, `sync_rev`), bukan teks bebas. Item menyimpan `brand_id`. Mengetik merk di form item memberi saran dari merk yang ada; merk yang belum ada **dibuat langsung saat item disimpan** (tanpa form tambahan, dengan audit `brand.create`). Halaman **Merk** untuk tambah, **ganti nama** (berlaku ke semua item merk itu; kunci item dihitung ulang; audit `brand.update`), dan nonaktifkan/aktifkan. Merk nonaktif tidak dapat dipakai item baru. Izin memakai modul `item` (view/edit/manage). | Nama merk unik (ternormalisasi); ganti nama yang membuat merk+tipe dua item bentrok ditolak. |
| FI3 | Merk + tipe unik (dinormalisasi). | Duplikat ditolak `CONFLICT` dengan pesan di field; alias tidak boleh sama dengan merk+tipe item lain. |
| FI4 | Nonaktifkan dan aktifkan item; tidak ada hapus. | Butuh `item: manage`. Item nonaktif tidak muncul di saran tipe pada task baru; task lama tetap menampilkannya. |
| FI5 | Halaman detail item baca-saja untuk semua yang punya `item: view`. | Menampilkan semua field, galeri, stiker dan kelengkapan sebagai daftar rapi, dan detail Markdown terender. QC memakainya sebagai acuan kerja. |
| FI6 | Item membawa **id MySQL** (`external_id`, opsional, unik) yang dipakai sinkronisasi. | Tampil baca-saja di halaman detail; tidak dapat diisi dari form. Diisi oleh sinkronisasi. |
| FI7 | Batas field: nama stiker 1–100, catatan stiker ≤ 300, nama kelengkapan 1–100, jumlah kelengkapan 1–999 (bilangan bulat), alias ≤ 10 @ 100, lampiran ≤ 10, stiker ≤ 30, kelengkapan ≤ 30; total JSON per kolom ≤ 40.000 karakter. | Ditegakkan di server (dan di form); lebih dari batas ditolak dengan pesan di field. |

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

### 4.8 Sinkronisasi dengan QC Desktop (Fase B2)
> **Keputusan pemilik 2026-11-05/06 (migrasi VPS, spek `docs/superpowers/specs/2026-11-05-migrasi-vps-docker-rest-design.md` §2 butir 6 dan §19 butir 7):** kontrak sinkron dikonversi dari amplop RPC (`doPost`/`POST /sync`, token di badan) menjadi **REST `/api/v1/sync/*` dengan `Authorization: Bearer`**, versi API 2. Alasan: kontrak belum dipakai klien mana pun, jadi tidak ada jalur kompatibilitas. Butir FS1, FS2, FS4, FS5, FS9, FS12, FS13, §6.3b, risiko token bocor, daftar periksa Fase B2, dan keputusan di bawah diubah sesuai; batas peninggalan CPU edge (pull dengan detail 50, push 5 item) dikembalikan ke nilai kontrak (200 dan 50/25). Bentuk item/merk dan semantik `rev`/`baseRev`/`overwrite` tidak berubah.

Kontrak lengkap (rute, payload, contoh, aturan konflik): `docs/api/desktop-sync.md`.

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FS1 | Rute REST `/api/v1/sync/*` untuk QC Desktop (`GET /sync/ping`, `GET /sync/brands`, `POST /sync/brands/push`, `GET /sync/items`, `POST /sync/items/push`, `GET /sync/files/{id}`); tanpa amplop: sukses = badan JSON apa adanya, galat = problem+json; API berversi lewat `apiVersion` (2). | `GET /sync/ping` mengembalikan versi API dan daftar sumber daya; `POST /sync` (kabel lama) menjawab 404. |
| FS2 | Autentikasi HANYA `Authorization: Bearer <SYNC_API_TOKEN>` (satu token bersama ≥ 32 karakter, dibandingkan waktu-konstan; tidak pernah di badan atau URL; cookie sesi tidak diterima); 10 token salah dalam 10 menit memblokir IP klien itu 10 menit. | Tanpa token valid tidak ada data atau rute yang terungkap; semua kegagalan sebelum autentikasi (header hilang, bukan Bearer, token salah, diblokir, token server belum diset) menjawab 401 problem+json yang sama persis ("Token tidak valid"); IP lain tidak terpengaruh. |
| FS3 | Jalur sinkron **terpisah** dari REST sesi: tabel rute sinkron sendiri (`SYNC_API_ROUTES`); handler tidak pernah menerima konteks user; pelaku tercatat `sync:desktop`. | Token sinkron tidak dapat memanggil rute REST web, dan sebaliknya (sesi sah tanpa Bearer di rute sinkron = 401). |
| FS4 | `GET /sync/items`: kursor `rev` (query `sinceRev`), paginasi (`limit`, `hasMore`, `nextRev`; 500 per halaman, 200 bila `include` memuat `detail`), `include` opsional untuk field berat. | Menarik dari `sinceRev: 0` sampai `hasMore: false` mengembalikan semua item tepat sekali. |
| FS5 | `POST /sync/items/push`: upsert per item dengan hasil per item (`created`, `updated`, `unchanged`, `conflict`, `invalid`, `error`); pencocokan `uid` → `id` (MySQL) → merk+tipe ternormalisasi; pemetaan id MySQL ke item QC App; `isCountryLock` boolean (teks "true"/"false" diterima); `active: false` = nonaktif. | Mendorong ulang permintaan yang sama menghasilkan `unchanged` (idempoten); kegagalan satu item tidak membatalkan yang lain; ≤ 50 item per panggilan (≤ 25 bila memuat `detail`; lebih banyak = 422 dengan `fields.items`), badan ≤ 5 MB; hasil per item tetap di badan 200. |
| FS6 | Konflik dua arah: `baseRev` lebih lama dari `rev` sekarang **dan** nilai berbeda → `conflict` beserta nilai terkini; `overwrite: true` melewati pemeriksaan. | Tidak ada perubahan pada item yang konflik; nilai sama persis → `unchanged`. |
| FS7 | Field sinkron: merk, tipe, isCountryLock, images, detail, stickers, accessories, active. **Alias tidak disinkronkan.** Field yang tidak dikirim tidak diubah; daftar/teks yang dikirim (termasuk kosong) menggantikan nilai tersimpan. | Push tanpa `detail` tidak mengosongkan detail. |
| FS8 | Gambar dirujuk dengan **id Drive**: `images`, `stickers[].image`, dan `![alt](drive:<id>)` di Markdown. Tiap id harus berada di folder aplikasi; berkas yang belum tercatat didaftarkan otomatis di tabel `files`. Pada push hanya rujukan `drive:` yang diterima di Markdown. | Id di luar folder → item `invalid`; menghapus id dari `images` tidak menghapus berkas Drive. |
| FS9 | `GET /sync/files/{id}` mengembalikan byte mentah (tanpa base64) dengan `Content-Type` berkas dan `ETag` = id, untuk berkas di folder aplikasi (≤ 8 MB), bertoken. | Id di luar folder → 404; berkas > 8 MB → 413. |
| FS10 | Setiap item yang dibuat, diubah, atau konflik dicatat di audit dengan pelaku `sync:desktop` dan snapshot before/after. | Terlihat di Log Audit dengan diff yang terbaca. |
| FS11 | Perubahan field sinkron di QC App menaikkan `sync_rev` sehingga muncul di pull berikutnya; perubahan alias tidak. | Tes: ubah alias → tidak muncul di pull; ubah detail → muncul. |
| FS12 | Kerangka generik: sumber daya baru (stok stiker, stok manual book) mendaftar ke `SYNC_API_ROUTES` dan tabel handler sinkron tanpa mengubah kerangka; konvensi stok (Desktop master, snapshot absolut `{ key, qty, asOf }`) tercatat di kontrak. | Bagian "Menambah sumber daya baru" di kontrak. |
| FS13 | Pengamanan folder gambar: `setup` **tidak** menimpa `DRIVE_FOLDER_ID` yang sudah terisi bila foldernya tidak dapat diakses; ia berhenti dengan pesan jelas (mengubah perilaku Fase A yang membuat folder baru). | Properti tidak berubah, laporan `setup` menyebut penyebab; folder baru hanya dibuat bila properti kosong. |

## 5. Kebutuhan Non-Fungsional
| ID | Kebutuhan |
|---|---|
| NFR1 | Semua penulisan sheet di dalam `withLock`; semua akses Drive hanya lewat `platform_()` (aturan GAS proyek). |
| NFR2 | Frontend tidak mempercayai klien: validasi ukuran, tipe, dan jumlah dilakukan ulang di server. |
| NFR3 | Auto-suggest berjalan **di klien** atas daftar yang sudah dimuat (item dan customer aktif berjumlah ratusan, bukan jutaan); tanpa panggilan RPC per ketikan. |
| NFR4 | Ukuran `gas/dist/index.html` tidak melebihi 1,5 MB setelah penambahan Markdown (pantau di `verify-dist`). |
| NFR5 | Sheet baru memakai pola yang ada (`core/db`, teks aman dari formula injection) dan dibuat otomatis oleh `setup`. |
| NFR6 | Tabel dan formulir dapat dipakai di ponsel (375×812); editor Markdown menumpuk vertikal di layar sempit. |
| NFR7 | Mode terang dan gelap, label Indonesia, tanpa warna sebagai satu-satunya penanda (selaras fondasi). |

## 6. Arsitektur & Keputusan Teknis

### 6.1 Fase
| Fase | Isi | Rencana implementasi |
|---|---|---|
| **A** | Platform Drive, sheet `files`, RPC file, komponen editor Markdown, penanda `qc` di model izin, `item` menjadi global | `...-qc-fase-a-file-editor.md` |
| **B** | Data Item (CRUD, alias, stiker, kelengkapan, galeri, detail, nonaktif, audit) | `...-qc-fase-b-item.md` |
| **B2** | Kerangka sinkronisasi (`doPost`, token, pembatas, tabel rute sinkron), sumber daya `items`, `sync.file.get`, pengamanan folder `setup`, kontrak `docs/api/desktop-sync.md` | `...-qc-fase-b2-sinkronisasi.md` |
| **C** | Customer master, Serah Terima, pengerjaan QC, auto-suggest, audit | `...-qc-fase-c-serah-terima.md` |

Tiap fase dirilis dan dapat diuji sendiri. Urutan: A → B → B2 → C (B2 sebelum C agar item sungguhan sudah ada saat task dibuat).

**Catatan router:** FH6 meminta izin "salah satu dari" (`handover: view` **atau** `qc: edit` di lokasi). Router GAS perlu mendukung izin berupa daftar alternatif; ini ditambahkan di Fase A bersama penanda `qc`.

### 6.2 Model data (sheet baru)
| Sheet | Kolom |
|---|---|
| `files` | `id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by` |
| `items` | `id, brand, model, key, is_country_lock, aliases, stickers, accessories, attachments, detail_md, status, created_at, updated_at, updated_by` (`aliases/stickers/accessories/attachments` = JSON; ditambah `external_id` (id MySQL) dan `sync_rev` (revisi sinkron)) |
| `sync_state` | `resource, seq, updated_at` (penghitung revisi per sumber daya; diubah di dalam lock) |
| `customers` | `id, name, key, status, created_at, updated_at, updated_by` |
| `handovers` | `id, number, location_id, customer_id, customer_name, note, status, checks, comments, completed_at, completed_by, created_at, created_by, updated_at, updated_by` (`status` tersimpan: `open` / `cancelled`; `note` = Markdown ≤ 5.000 karakter; `checks` = centang per butir (JSON, pelaku dan waktu); `comments` = komentar beranchor (JSON, ≤ 50 per task); `completed_at/completed_by` = penanda selesai untuk task tanpa butir checklist; masing-masing dalam sel sendiri dengan batas JSON 40.000 karakter) |
| ~~`handover_lines`~~ | Tidak dipakai lagi sejak serah terima berbasis catatan (lihat dokumen desain 2026-10-23 §5). Sheet yang sudah ada dibiarkan kosong. |

`key` = merk+tipe (item) atau nama (merk, customer) yang dinormalisasi; dipakai untuk keunikan dan pencocokan.

### 6.3 Kontrak RPC (garis besar; rinci di rencana)
`files.upload`, `files.get`; `items.list`, `items.get`, `items.save`, `items.setStatus`; `brands.list`, `brands.save`, `brands.setStatus`; `customers.list`, `customers.rename`, `customers.setStatus`; `handovers.options`, `handovers.board` (seluruh isi board satu lokasi dalam satu panggilan), `handovers.get`, `handovers.save` (catatan saja; membuat customer baru bila perlu), `handovers.saveBatch` (atomik per permintaan, maks. 30 task per permintaan di Apps Script maupun server VPS; formulir bulk mengirim SATU permintaan atomik: gagal = tidak ada yang tersimpan. **Keputusan pemilik produk 2026-11-05** menggantikan batas Worker 5 task (semula 10, diturunkan 2026-10-30 demi anggaran CPU edge) karena batas CPU edge tidak ada lagi di VPS), `handovers.cancel`, `handovers.setCheck` (centang per butir, `qc: edit`), `handovers.setDone { id, locationId }` (selesaikan task, `qc: edit`; tanpa field `done`), `handovers.reopen` (buka kembali task Dibatalkan, `handover: manage`), `handovers.comment` (hanya tambah; komentar umum dengan `quote` kosong; izin lihat). Rute `setProgress`, `completeLine`, dan `completeAll` dihapus. Rute berlokasi memakai `scope: 'location'` dan `ctx.locationIds` (resep di `docs/adding-a-module.md`).

### 6.3b Endpoint sinkronisasi
`registerSyncRest` (`server/src/modules/sync/rest.ts`) mendaftarkan enam rute `SYNC_API_ROUTES` (`shared/api.ts`) pada `/api/v1`, memeriksa token Bearer dan pembatas per IP, lalu memanggil tabel handler sinkron (`server/src/modules/sync/routes.ts`); badan push dibatasi 5 MB. Id handler (`sync.ping`, `sync.items.pull`, `sync.items.push`, `sync.brands.*`, `sync.file.get`) tetap sebagai nama internal dan `operationId` OpenAPI. Versi lama (`doPost` di `gas/src/main.ts`, amplop `{ v, method, token, payload }`) hanya tinggal di aplikasi GAS yang dipensiunkan di T35. Detail di `docs/api/desktop-sync.md`.

### 6.4 Gambar dan Markdown
- Drive: `DriveApp` lewat `platform_()` (`driveCreateFile`, `driveReadBase64`); folder utama dibuat `setup`. Izin Drive ditambahkan ke `appsscript.json`; Google meminta persetujuan ulang sekali saat `setup`.
- Dokumen merujuk gambar dengan `qcfile:<fileId>`, bukan URL Drive; izin diperiksa pada setiap `files.get`.
- Pustaka: `react-markdown` + `remark-gfm` (tanpa plugin HTML mentah); editor dibangun sendiri di atas `<textarea>` agar ringan dan sesuai build satu-berkas.

### 6.5 Auto-suggest
Fungsi murni di `shared/` (dites tabel): normalisasi, skor kecocokan (awalan > substring > token tak berurutan > jarak edit kecil), pengurutan. Dipakai untuk saran tipe, saran customer, dan penanda "mirip". Server memakai normalisasi yang sama untuk keunikan.

### 6.6 Konkurensi
Centang butir disimpan per butir sebagai set ("dicentang/tidak") di dalam lock, sehingga dua QC tidak saling membatalkan. Isi catatan memakai pemeriksaan versi (`expectedUpdatedAt`): penyimpanan kedua pada versi yang sama ditolak dan drafnya dipertahankan. Dokumen desain 2026-10-23 §4.4 dan §4.5 berlaku untuk serah terima.

## 7. Kualitas & Pengujian
- Fungsi murni (normalisasi dan skor saran, turunan status task) dites tabel dengan nama-nama yang bervariasi.
- Layanan GAS dites lewat memory platform (diperluas dengan Drive palsu).
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
| Perubahan `item` menjadi global menyentuh izin | Regresi akses | Tes `resolveAccess` ditambah; belum ada data item sehingga dampak data nol. |
| Batas sel 50.000 karakter | Data terpotong | Batas FA7 dan batas jumlah entri; validasi ukuran total JSON di server. |

| Token sinkron bocor | Pihak luar dapat menulis atau membaca item | Token panjang acak di variabel lingkungan server, hanya di header `Authorization` (tidak pernah di URL atau badan, tidak dicatat di log), pembatas percobaan salah per IP, pelaku tercatat di audit, rotasi dengan mengganti variabel. |
| Konflik dua arah menimpa pekerjaan | Data berubah diam-diam | `baseRev` dan status `conflict`; audit before/after memungkinkan pemulihan; `overwrite` harus eksplisit. |
| Folder gambar lama salah atau tidak berizin | Gambar tidak terbaca atau folder baru terbuat tanpa disadari | FS13 (setup tidak menimpa), urutan panduan: isi `DRIVE_FOLDER_ID` sebelum `setup`, validasi per id saat push. |
| Migrasi besar melewati batas waktu `doPost` | Sebagian item belum masuk | Batas per panggilan, hasil per item, push idempoten sehingga dapat diulang aman. |
| Desktop merender HTML mentah dari `detail` | XSS di Desktop | Kontrak mewajibkan Desktop tidak merender HTML mentah; QC App tidak pernah merendernya. |

## 9. Definition of Done
**Fase A**
- [ ] `setup` membuat folder Drive dan sheet `files`; izin Drive tercantum di `appsscript.json`.
- [ ] Upload, ambil, dan tampil gambar bekerja dengan pemeriksaan izin dan batas ukuran. (diverifikasi E2E di halaman Item, Fase B: unggah via google.script.run, tampil data URL di sandbox HtmlService, penolakan izin)
- [x] Editor Markdown (tulis, pratinjau, sisip gambar lewat tombol/paste/seret) dan render aman dites.
- [x] Modul `qc` ada di form Role; `item` global dari semua penugasan; tes `resolveAccess` diperbarui.

**Fase B**
- [x] CRUD item lengkap dengan alias, stiker, kelengkapan, galeri, detail; keunikan dan nonaktif bekerja.
- [x] Merk sebagai tabel master: saran, buat langsung saat item disimpan, ganti nama, nonaktif, halaman Merk, audit `brand.*`.
- [x] Halaman daftar dan detail item; audit dengan diff yang terbaca.

**Fase B2**
- [x] Kerangka REST sinkron (token Bearer, pembatas percobaan salah per IP, problem+json, tabel rute sinkron) dites, termasuk token salah seragam 401 dan pembatasan (T25, 2026-11-06; sebelumnya `doPost`).
- [x] `GET /sync/items` dan `POST /sync/items/push` dengan semua field, hasil per item, dan konflik dua arah; tes kesesuaian terhadap contoh di `docs/api/desktop-sync.md`.
- [x] `GET /sync/files/{id}` terbatas pada folder aplikasi.
- [x] `setup` tidak menimpa `DRIVE_FOLDER_ID` yang tidak dapat diakses (FS13).
- [x] `GET /sync/brands` dan `POST /sync/brands/push` (merk master dua arah).
- [ ] Migrasi awal dari MySQL dicoba end-to-end dengan QC Desktop dan hasil pull cocok dengan MySQL.
- [ ] Tim Desktop menyetujui `docs/api/desktop-sync.md`.

**Fase C**
- [x] Customer master dengan pembuatan inline, saran, dan penanda mirip; halaman Customer.
- [x] Task serah terima berbasis catatan (buat, bulk, ubah, batalkan) dengan nomor otomatis, tempel dari WhatsApp, dan kanban/kartu (dokumen desain 2026-10-23 §9).
- [x] QC mencentang butir, menyelesaikan task, dan berkomentar; status turunan Baru/Dikerjakan/Selesai/Dibatalkan benar; board satu RPC.
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
| Hubungan spreadsheet sinkron dengan QC App? | QC App menjadi sistem utama (migrasi dari spreadsheet dan proyek GAS lama); Desktop menarik/mendorong lewat API. |
| Sumber kebenaran data item? | Dua arah (aturan konflik FS6). |
| Gambar lama di spreadsheet? | Memakai folder Drive yang sama (`DRIVE_FOLDER_ID` = folder lama). |
| Akses Desktop? | Endpoint API di QC App (GAS) dengan token. |
| `isCountryLock` dan token? | Boolean; satu token bersama. |
| Proyek GAS lama? | Dipensiunkan setelah migrasi; Desktop diarahkan ke REST `/api/v1/sync/*` QC App (keputusan 2026-11-05/06; sebelumnya `/exec`). |
| Cara Desktop membaca gambar? | `GET /sync/files/{id}` (byte mentah). |
| Field yang disinkronkan? | Semua (merk, tipe, country lock, gambar, detail Markdown, stiker, kelengkapan) kecuali alias. |
| Kontrak hanya untuk item? | Tidak: generik; stok stiker dan stok manual book menyusul (Desktop master, snapshot absolut). |
| Nama modul QC dan izin Drive? | "Pengerjaan QC" (kunci `qc`); izin Drive disetujui saat `setup`. |

## 11. Keputusan yang Saya Ambil (mohon dikoreksi bila perlu)
- **`item` global dihitung dari semua penugasan**, bukan hanya "Semua lokasi" (FP2), agar staf cabang dapat memilih dari katalog. `access` tetap hanya dari "Semua lokasi".
- **Customer dikelola di bawah izin `item`** (master data), sedangkan membuatnya inline cukup `handover: edit`.
- **Nomor task per hari** `ST-YYYYMMDD-NNN`, memakai zona waktu script.
- **Penyelesaian bersamaan**: centang per butir dan komentar hanya tambah; isi catatan memakai pemeriksaan versi (lihat 6.6).
- **Penghitung revisi sinkron per sumber daya** (`sync_rev`) hanya naik bila field sinkron berubah; perubahan alias tidak menaikkannya.
- **"Hapus" dari Desktop diterjemahkan jadi nonaktif** (`active: false`), karena item dirujuk task dan tidak pernah dihapus.
- **Daftar dan teks pada push bersifat "ganti seluruhnya"; field yang tidak dikirim tidak diubah.**
- **`setup` tidak lagi membuat folder baru bila `DRIVE_FOLDER_ID` sudah terisi tetapi tidak dapat diakses** (FS13), karena itu hampir pasti folder buatan pengguna (folder gambar lama), bukan folder yang boleh diganti diam-diam.
- **Gambar di Markdown pada kabel memakai `drive:<id>`** dan dipetakan ke `qcfile:` di dalam QC App.
