# PRD — QC App: Data Item & Serah Terima WH → QC (Sub-project 2)

| | |
|---|---|
| **Status** | Draft — menunggu review |
| **Tanggal** | 2026-10-09 |
| **Pemilik** | rahmadm.rhd@gmail.com |
| **Bergantung pada** | `2026-10-08-qc-fondasi-akses.md` (rilis) dan `2026-10-08-qc-lokasi-cabang.md` (sudah di `dev`) |

---

## 1. Ringkasan

Dua modul bisnis pertama QC App:

1. **Data Item**: katalog tipe barang yang **dipakai bersama semua lokasi**: merk, tipe, status *country lock*, daftar stiker yang harus ditempel, kelengkapan aksesoris, galeri gambar lampiran, dan detail/spesifikasi dalam **editor Markdown dengan sisip gambar**.
2. **Serah Terima WH → QC**: **task** yang dibuat Gudang (WH) untuk QC: nama customer + daftar tipe beserta jumlah. QC memperbarui jumlah yang selesai, atau menandai selesai per tipe maupun per task. Field customer dan tipe punya **auto-suggest**, sebab pengguna sering menulis nama yang berbeda untuk hal yang sama.

Fondasi yang dibutuhkan keduanya ikut dibangun: penyimpanan **gambar di Google Drive** dan komponen **editor Markdown**.

## 2. Latar Belakang & Tujuan

### 2.1 Kondisi sekarang
Fondasi akses, lokasi, penugasan, dan audit sudah ada. Menu Data Item dan Serah Terima di beranda masih "Segera hadir". Izin `item`, `handover`, `stock` sudah ada di model izin, tetapi belum ada halaman.

### 2.2 Tujuan
- **G1.** Admin item dapat mengelola katalog item lengkap dengan gambar dan detail Markdown.
- **G2.** WH dapat membuat task serah terima untuk satu lokasi dengan cepat: customer dan tipe tinggal dipilih dari saran saat mengetik.
- **G3.** QC melihat task di lokasinya dan memperbarui progres per tipe, atau menyelesaikannya sekaligus.
- **G4.** Variasi penulisan nama customer dan tipe tidak menghasilkan data ganda.
- **G5.** Hak WH dan hak QC dapat diberikan terpisah lewat role.

### 2.3 Non-goals
- Monitoring Stok (modul `stock`) dan penghitungan stok.
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
| FI3 | Merk + tipe unik (dinormalisasi). | Duplikat ditolak `CONFLICT` dengan pesan di field; alias tidak boleh sama dengan merk+tipe item lain. |
| FI4 | Nonaktifkan dan aktifkan item; tidak ada hapus. | Butuh `item: manage`. Item nonaktif tidak muncul di saran tipe pada task baru; task lama tetap menampilkannya. |
| FI5 | Halaman detail item baca-saja untuk semua yang punya `item: view`. | Menampilkan semua field, galeri, stiker dan kelengkapan sebagai daftar rapi, dan detail Markdown terender. QC memakainya sebagai acuan kerja. |

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
| FH1 | Task milik **satu lokasi**; dibuat pada lokasi yang dipilih di form (lihat `LocationField`). | Butuh `handover: edit` di lokasi tujuan. |
| FH2 | Isi task: **customer** (FC2), **catatan** opsional (maks. 500), dan **baris** `item × qty` (qty bilangan bulat 1–100.000; tiap item sekali per task; minimal satu baris). | Tipe dipilih dari saran (FH3); mengetik tipe di luar katalog tidak dapat disimpan. |
| FH3 | Auto-suggest tipe. | Cocok ke merk, tipe, dan alias; tidak peka huruf besar; abaikan spasi/tanda baca; toleran typo ringan; urutan kata bebas ("galaxy samsung" menemukan "Samsung Galaxy"). Item nonaktif tidak disarankan. Bila tidak ketemu dan user punya `item: edit`, tersedia tautan "Tambah item baru". |
| FH4 | **Nomor task otomatis** `ST-YYYYMMDD-NNN` (urut per hari). | Dibuat di server dalam lock; tidak pernah ganda. |
| FH5 | Status task: **Baru** (belum ada progres), **Dikerjakan**, **Selesai** (semua baris penuh), **Dibatalkan**. | Baru/Dikerjakan/Selesai diturunkan dari baris; Dibatalkan disimpan. |
| FH6 | Daftar task: kolom nomor, customer, lokasi, ringkasan progres (mis. 12/20 unit), status, waktu. Filter status dan pencarian lewat URL; mengikuti **lokasi aktif** header; kolom Lokasi bila lebih dari satu lokasi terpilih. | Butuh `handover: view` atau `qc: edit` di lokasi tersebut. |
| FH7 | Ubah isi task (WH). | Butuh `handover: edit`. Hanya task yang belum Selesai/Dibatalkan. Qty target tidak boleh di bawah qty selesai; baris yang sudah ada progres tidak dapat dihapus. |
| FH8 | Batalkan task (WH). | Butuh `handover: manage`. Task Dibatalkan hanya baca; progres yang sudah tercatat tetap tersimpan di audit. |
| FH9 | Snapshot nama. | Baris menyimpan salinan "merk tipe" saat dibuat sehingga riwayat tetap terbaca bila item diganti nama. |

### 4.6 Pengerjaan QC
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FQ1 | QC memperbarui **qty selesai** per baris. | Butuh `qc: edit` di lokasi task. Nilai 0 ≤ selesai ≤ target; bilangan bulat. |
| FQ2 | **Tandai selesai per tipe**: mengisi qty selesai = target pada baris itu. | Satu klik; dapat diurungkan dengan mengubah qty. |
| FQ3 | **Tandai selesai per task**: semua baris diisi penuh. | Satu klik dengan konfirmasi; mencatat siapa dan kapan. |
| FQ4 | Setiap perubahan progres mencatat pelaku dan waktu per baris. | Tampil di detail task. |
| FQ5 | Halaman detail task menautkan tiap tipe ke halaman detail item (FI5). | QC membuka stiker dan kelengkapan acuan tanpa meninggalkan task. |
| FQ6 | Task Selesai/Dibatalkan tidak dapat diubah QC. | `CONFLICT` dengan pesan jelas. |

### 4.7 Audit
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FAU1 | Aksi baru di `audit_log` dengan snapshot before/after: `item.create/update/activate/deactivate`, `customer.create/rename/activate/deactivate`, `handover.create/update/cancel`, `handover.progress` (per perubahan progres), `handover.complete`. | Tampil di Log Audit dengan label Indonesia. |
| FAU2 | Diff audit yang mudah dibaca untuk item dan task. | Daftar (alias, stiker, kelengkapan, baris task) dibandingkan per entri dengan warna tambah/ubah/hapus; isi Markdown ditampilkan sebagai "diubah" tanpa diff teks penuh. |

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
| **C** | Customer master, Serah Terima, pengerjaan QC, auto-suggest, audit | `...-qc-fase-c-serah-terima.md` |

Tiap fase dirilis dan dapat diuji sendiri.

**Catatan router:** FH6 meminta izin "salah satu dari" (`handover: view` **atau** `qc: edit` di lokasi). Router GAS perlu mendukung izin berupa daftar alternatif; ini ditambahkan di Fase A bersama penanda `qc`.

### 6.2 Model data (sheet baru)
| Sheet | Kolom |
|---|---|
| `files` | `id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by` |
| `items` | `id, brand, model, key, is_country_lock, aliases, stickers, accessories, attachments, detail_md, status, created_at, updated_at, updated_by` (`aliases/stickers/accessories/attachments` = JSON) |
| `customers` | `id, name, key, status, created_at, updated_at, updated_by` |
| `handovers` | `id, number, location_id, customer_id, customer_name, note, status, created_at, created_by, updated_at, updated_by` (`status` tersimpan: `open` / `cancelled`) |
| `handover_lines` | `id, handover_id, item_id, item_label, qty, done_qty, done_at, done_by` |

`key` = merk+tipe (item) atau nama (customer) yang dinormalisasi; dipakai untuk keunikan dan pencocokan.

### 6.3 Kontrak RPC (garis besar; rinci di rencana)
`files.upload`, `files.get`; `items.list`, `items.get`, `items.save`, `items.setStatus`; `customers.list`, `customers.rename`, `customers.setStatus`; `handovers.list`, `handovers.get`, `handovers.save` (membuat customer baru bila perlu), `handovers.cancel`, `handovers.setProgress`, `handovers.completeLine`, `handovers.completeAll`. Rute berlokasi memakai `scope: 'location'` dan `ctx.locationIds` (resep di `docs/adding-a-module.md`).

### 6.4 Gambar dan Markdown
- Drive: `DriveApp` lewat `platform_()` (`driveCreateFile`, `driveReadBase64`); folder utama dibuat `setup`. Izin Drive ditambahkan ke `appsscript.json`; Google meminta persetujuan ulang sekali saat `setup`.
- Dokumen merujuk gambar dengan `qcfile:<fileId>`, bukan URL Drive; izin diperiksa pada setiap `files.get`.
- Pustaka: `react-markdown` + `remark-gfm` (tanpa plugin HTML mentah); editor dibangun sendiri di atas `<textarea>` agar ringan dan sesuai build satu-berkas.

### 6.5 Auto-suggest
Fungsi murni di `shared/` (dites tabel): normalisasi, skor kecocokan (awalan > substring > token tak berurutan > jarak edit kecil), pengurutan. Dipakai untuk saran tipe, saran customer, dan penanda "mirip". Server memakai normalisasi yang sama untuk keunikan.

### 6.6 Konkurensi
Pembaruan progres menyimpan nilai absolut di dalam lock, validasi 0 ≤ selesai ≤ target; bila dua QC mengubah baris yang sama, yang terakhir menang dan keduanya tercatat di audit (tidak ada penguncian optimistis di fase ini).

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
| Gambar yatim (diunggah, lalu dokumen tidak disimpan) | Folder Drive membengkak | Diterima di fase ini; metadata `owner_id` kosong memudahkan pembersihan manual kemudian. |
| XSS lewat Markdown | Pencurian sesi | FA6: tanpa HTML mentah, skema tautan dibatasi, gambar hanya `qcfile:`; tes khusus. |
| Variasi nama tetap lolos | Customer ganda | Normalisasi + penanda mirip + halaman Customer untuk ganti nama; penggabungan di luar lingkup (dicatat). |
| Nomor task ganda | Kekacauan rujukan | Dibuat di server di dalam lock; tes konkurensi logis. |
| Perubahan `item` menjadi global menyentuh izin | Regresi akses | Tes `resolveAccess` ditambah; belum ada data item sehingga dampak data nol. |
| Batas sel 50.000 karakter | Data terpotong | Batas FA7 dan batas jumlah entri; validasi ukuran total JSON di server. |

## 9. Definition of Done
**Fase A**
- [ ] `setup` membuat folder Drive dan sheet `files`; izin Drive tercantum di `appsscript.json`.
- [x] Upload, ambil, dan tampil gambar bekerja dengan pemeriksaan izin dan batas ukuran.
- [x] Editor Markdown (tulis, pratinjau, sisip gambar lewat tombol/paste/seret) dan render aman dites.
- [x] Modul `qc` ada di form Role; `item` global dari semua penugasan; tes `resolveAccess` diperbarui.

**Fase B**
- [ ] CRUD item lengkap dengan alias, stiker, kelengkapan, galeri, detail; keunikan dan nonaktif bekerja.
- [ ] Halaman daftar dan detail item; audit dengan diff yang terbaca.

**Fase C**
- [ ] Customer master dengan pembuatan inline, saran, dan penanda mirip; halaman Customer.
- [ ] Task serah terima (buat, ubah, batalkan) dengan nomor otomatis dan auto-suggest tipe.
- [ ] QC memperbarui qty, menandai selesai per tipe dan per task; status turunan benar.
- [ ] Semua rute berlokasi menegakkan izin per lokasi; audit lengkap.

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
| Nama modul QC dan izin Drive? | "Pengerjaan QC" (kunci `qc`); izin Drive disetujui saat `setup`. |

## 11. Keputusan yang Saya Ambil (mohon dikoreksi bila perlu)
- **`item` global dihitung dari semua penugasan**, bukan hanya "Semua lokasi" (FP2), agar staf cabang dapat memilih dari katalog. `access` tetap hanya dari "Semua lokasi".
- **Customer dikelola di bawah izin `item`** (master data), sedangkan membuatnya inline cukup `handover: edit`.
- **Nomor task per hari** `ST-YYYYMMDD-NNN`, memakai zona waktu script.
- **Penyelesaian bersamaan**: yang terakhir menang (6.6), tidak ada penguncian optimistis.
