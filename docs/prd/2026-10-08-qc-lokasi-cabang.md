# PRD — QC App: Lokasi/Cabang & Penugasan Akses (Sub-project 1b)

| | |
|---|---|
| **Status** | Diimplementasi — menunggu rilis dan verifikasi di deployment |
| **Tanggal** | 2026-10-08 |
| **Pemilik** | rahmadm.rhd@gmail.com |
| **Bergantung pada** | fondasi akses (sesi, izin, audit; sudah dirilis) |

---

## 1. Ringkasan

QC App akan dipakai di **beberapa lokasi/cabang**. Satu orang bisa bekerja di lebih dari satu lokasi dan **memiliki hak berbeda di tiap lokasi** (mis. mengelola Data Item di Cabang A, tetapi hanya melihat di Cabang B). Dokumen ini menambahkan konsep **Lokasi** dan **penugasan user ke lokasi** pada sistem akses, serta pemilih lokasi aktif di header.

Dokumen ini hanya mencakup **fondasi** lokasi. Penerapan lokasi pada data Item, Serah Terima, dan Stok ditetapkan di PRD modul masing-masing; modul-modul itu cukup memakai mekanisme izin per lokasi yang disiapkan di sini.

## 2. Latar Belakang & Tujuan

### 2.1 Kondisi sekarang
User memiliki satu atau lebih role; role berisi level per modul (`none` < `view` < `edit` < `manage`); level efektif adalah yang tertinggi dari semua role. Semuanya **global** — tidak mengenal lokasi.

### 2.2 Tujuan
- **G1.** Admin dapat mendaftarkan lokasi dan mengubah status aktif/nonaktif-nya lewat UI.
- **G2.** Admin dapat menugaskan satu user ke beberapa lokasi, dengan role yang berbeda di tiap lokasi, serta ke "Semua lokasi".
- **G3.** User memilih satu atau beberapa **lokasi aktif** dari header; tampilan modul berlokasi mengikuti pilihan itu.
- **G4.** Server menegakkan izin **per lokasi** pada setiap pemanggilan; pilihan lokasi di header tidak pernah dipercaya begitu saja.
- **G5.** Perilaku semua user yang sudah ada tidak berubah setelah migrasi.

### 2.3 Non-goals
- Data Item, Serah Terima, Monitoring Stok per lokasi (PRD modul masing-masing).
- **Admin cabang** (pendelegasian pengelolaan akses per lokasi); Pengaturan Akses tetap global dan dikelola pusat.
- Perpindahan stok atau barang antar lokasi.
- Hierarki lokasi (wilayah → cabang). Lokasi berupa daftar datar.

## 3. Pengguna & Peran

| Persona | Deskripsi | Kebutuhan |
|---|---|---|
| **Super Admin** | `ADMIN_EMAIL`. | Kelola di semua modul dan semua lokasi, termasuk lokasi baru. |
| **Admin Pusat** | User dengan `access: manage` pada penugasan "Semua lokasi". | Mengelola lokasi, user, role, penugasan, dan melihat log audit. |
| **Staf lokasi** | User dengan penugasan pada satu atau beberapa lokasi. | Bekerja di lokasi yang ditugaskan sesuai haknya di tiap lokasi. |
| **Staf lintas lokasi** | User dengan penugasan "Semua lokasi". | Hak yang sama di setiap lokasi aktif, termasuk lokasi yang dibuat kemudian. |

## 4. Kebutuhan Fungsional

### 4.1 Lokasi
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-L1 | Daftar lokasi. | Halaman **Lokasi** di menu Pengaturan Akses: tabel kode, nama, status. Butuh `access:view`. |
| FR-L2 | Tambah dan ubah lokasi. | Field `code` (unik, huruf besar/angka/tanda hubung, maks. 10) dan `name` (wajib, maks. 100). Butuh `access:manage`. Kode tidak dapat diubah setelah dibuat. |
| FR-L3 | Nonaktifkan dan aktifkan lokasi. | Lokasi **tidak dapat dihapus**. Lokasi nonaktif tidak muncul di pemilih header dan tidak bisa menjadi tujuan penulisan; data historisnya tetap ada. |
| FR-L4 | Kode dan nama unik. | Kode atau nama yang sudah dipakai (tanpa membedakan huruf besar) ditolak dengan `CONFLICT` dan pesan di field terkait. |

### 4.2 Penugasan user ke lokasi
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-AS1 | User memiliki daftar **penugasan**: pasangan *lokasi* + *satu atau beberapa role*. Lokasi kosong berarti **"Semua lokasi"**. | Form User punya bagian **Penugasan** dengan baris lokasi + role; tambah dan hapus baris. |
| FR-AS2 | Satu baris per lokasi. | Dua penugasan untuk lokasi yang sama (atau dua "Semua lokasi") ditolak dengan `VALIDATION`. |
| FR-AS3 | Lokasi dan role pada penugasan harus dikenal. | Id tak dikenal ditolak dengan `VALIDATION`. Lokasi nonaktif boleh tetap tertera pada penugasan lama, tetapi tidak dapat ditambahkan baru. |
| FR-AS4 | Tabel Users merangkum penugasan. | Tiap user menampilkan ringkasan "Lokasi: role, role" (mis. "Semua lokasi: Manajer · Cabang B: Pemantau"). |
| FR-AS5 | Tidak mengunci diri sendiri. | User non-super-admin tidak dapat menyimpan perubahan yang menghilangkan `access:manage` global miliknya sendiri; ditolak dengan `CONFLICT` dan pesan jelas. Aturan "tidak menonaktifkan akun sendiri" tetap berlaku. |

### 4.3 Aturan izin
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-P6 | Izin user U di lokasi L untuk modul M (`item`, `handover`, `stock`) = **level tertinggi** dari semua role pada penugasan U untuk L, digabung dengan role pada penugasan "Semua lokasi". | Contoh: Semua lokasi = `item:view`; Cabang A = `item:manage` ⇒ di Cabang A `manage`, di Cabang B `view`. |
| FR-P7 | Modul `access` (Pengaturan Akses) bersifat **global**. | Levelnya hanya dihitung dari penugasan "Semua lokasi". Role pada penugasan lokasi tertentu mengabaikan modul `access`. |
| FR-P8 | Lokasi nonaktif. | Penugasan pada lokasi nonaktif tidak berlaku. Penugasan "Semua lokasi" hanya berlaku di lokasi aktif. |
| FR-P9 | Super admin. | `ADMIN_EMAIL` memiliki `manage` di semua modul dan semua lokasi aktif, walau sheet kosong. |
| FR-P10 | User tanpa penugasan. | Dapat login, tidak melihat modul apa pun (perilaku sama dengan user tanpa role sekarang). |
| FR-P11 | Level yang tersedia per modul tetap mengikuti `MODULE_LEVELS`. | Role dan validasi level tidak berubah. |

### 4.4 Lokasi aktif (pemilih di header)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-C1 | Pemilih **multi-select** lokasi aktif di header. | Menawarkan lokasi aktif yang user punya izin apa pun di sana (level di atas `none` pada minimal satu modul berlokasi). Disembunyikan bila user hanya memiliki satu lokasi. |
| FR-C2 | Pilihan tersimpan dan disaring. | Disimpan di browser; saat dimuat, lokasi yang tidak lagi valid (nonaktif, hak dicabut) dibuang. Default saat belum ada pilihan: semua lokasi yang diizinkan. |
| FR-C3 | Menu dan halaman mengikuti izin. | Item menu modul berlokasi tampil bila user punya level yang cukup di minimal satu lokasi aktif terpilih. Halaman 403 bila tidak. |
| FR-C4 | Aksi menulis memilih lokasi tujuan. | Form modul berlokasi memiliki field **Lokasi** yang hanya menawarkan lokasi aktif terpilih yang boleh ditulis user. Mengubah baris yang sudah ada mengikuti lokasi baris itu. Bila tidak ada satu pun, tombol aksi nonaktif dengan keterangan. |
| FR-C5 | Daftar menggabungkan lokasi terpilih. | Tabel modul berlokasi memiliki kolom Lokasi bila lebih dari satu lokasi terpilih. |

### 4.5 Penegakan di server
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-E1 | Method modul berlokasi membawa lokasi. | Baca: `locationIds` (tidak kosong). Tulis: `locationId` tunggal. Method `access.*` tetap global dan tidak membawa lokasi. |
| FR-E2 | Router memeriksa **tiap** lokasi yang diminta. | Lokasi harus ada, aktif, dan level user di sana mencukupi. Satu saja yang gagal ⇒ `FORBIDDEN` untuk seluruh permintaan (tidak dibuang diam-diam). |
| FR-E3 | Handler hanya menerima lokasi yang sudah lolos. | Handler memakai daftar lokasi tervalidasi dari konteks, bukan dari input mentah. |
| FR-E4 | `auth.me` memuat izin global dan per lokasi. | Respons: izin global (termasuk `access`) dan daftar lokasi aktif yang boleh diakses beserta izin efektif di tiap lokasi. |
| FR-E5 | Perubahan akses langsung berlaku. | Mengubah penugasan, role, atau status lokasi membatalkan cache konteks (mekanisme versi cache yang sudah ada). |

### 4.6 Audit
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-AU1 | Aksi lokasi tercatat. | `location.create`, `location.update`, `location.activate`, `location.deactivate` dengan snapshot `before`/`after` `{code, name, status}`. |
| FR-AU2 | Snapshot user memuat penugasan. | Perubahan penugasan tercatat pada `user.create`/`user.update` (mis. `assignments`). |
| FR-AU3 | Log Audit menampilkan diff penugasan per lokasi. | Detail entri menampilkan tiap lokasi sebagai baris (nama lokasi, bukan id, bila diketahui) dengan role yang ditambah, dihapus, atau tetap; lokasi yang ditambah/dihapus ditandai. |

## 5. Kebutuhan Non-Fungsional
| ID | Kategori | Kebutuhan |
|---|---|---|
| NFR-L1 | Keamanan | Pemeriksaan lokasi hanya di server. Pilihan header, `localStorage`, dan input tidak dipercaya. |
| NFR-L2 | Kompatibilitas | Migrasi tidak mengubah hak user mana pun; aman diulang. |
| NFR-L3 | Kinerja | Konteks user per permintaan tetap dari cache; perhitungan izin per lokasi tidak membaca sheet tambahan pada jalur panas. |
| NFR-L4 | Skala | Saat ini kurang dari 5 lokasi; dirancang nyaman hingga sekitar 10. Lebih banyak tetap berfungsi, tetapi pemilih header tidak memiliki pencarian (ditambahkan bila perlu). |
| NFR-L5 | Aksesibilitas | Pemilih lokasi dan bagian Penugasan dapat dioperasikan dengan keyboard dan memiliki label; perubahan tidak hanya ditandai warna. |

## 6. Arsitektur & Keputusan Teknis

### 6.1 Data model
| Sheet | Perubahan |
|---|---|
| `locations` (baru) | `id`, `code` (unik), `name`, `status` (`active`/`inactive`), `created_at`, `updated_at`, `updated_by` |
| `users` | Kolom baru `assignments` (JSON): `[{"locationId": "<id>"\|null, "roleIds": ["<id>", ...]}]`. Kolom `role_ids` lama dikosongkan setelah migrasi dan tidak dipakai lagi. |
| `roles` | Tidak berubah (global). |
| `audit_log` | Tidak berubah (bentuk `before`/`after`); isi snapshot user bertambah `assignments`. |

### 6.2 Model izin
- Penugasan `locationId = null` ("Semua lokasi") berlaku di setiap lokasi aktif dan menjadi sumber izin global untuk modul `access`.
- `computeUserContext_` menghasilkan: izin global (hanya dari penugasan "Semua lokasi") dan peta `locationId → PermissionMap` untuk lokasi aktif (gabungan penugasan lokasi itu dan penugasan "Semua lokasi"). `access` hanya ada pada izin global.
- Level efektif tetap "tertinggi dari semua role" (`mergePermissions`), dipanggil per kelompok role.

### 6.3 Kontrak RPC
- Spesifikasi izin rute bertambah cakupan: `scope: 'global'` (default, perilaku sekarang) atau `scope: 'location'`. Rute berlokasi memvalidasi `locationIds` atau `locationId` terhadap peta izin konteks sebelum handler dijalankan.
- Method baru: `access.locations.list`, `access.locations.save`, `access.locations.setStatus`. `access.users.save` menerima `assignments` menggantikan `roleIds`. `auth.me` diperluas (FR-E4).
- Frontend: `can(me, module, level)` tetap untuk modul global; ditambah `canAt(me, module, level, locationId)` dan `locationsWith(me, module, level)`.

### 6.4 Migrasi (di dalam `setup`)
1. Buat sheet `locations` (kosong) bila belum ada.
2. Tambah header `assignments` pada `users`.
3. Untuk tiap user dengan `role_ids` tidak kosong dan `assignments` kosong: isi `assignments` dengan satu penugasan "Semua lokasi" berisi role itu, lalu kosongkan `role_ids`.
Idempoten; tidak ada lokasi yang perlu dibuat agar aplikasi tetap berfungsi seperti sekarang.

### 6.5 Keputusan yang diambil
1. Lokasi hanya dinonaktifkan, tidak dihapus (menjaga rujukan data historis).
2. Pengaturan Akses hanya dari penugasan "Semua lokasi" (admin cabang ditunda).
3. Lokasi yang diminta tetapi tak diizinkan ditolak seluruhnya (bukan disaring) agar bug UI terlihat.
4. Default pilihan lokasi di header: semua lokasi yang diizinkan.
5. Role tetap global agar tidak berlipat ganda per lokasi.

## 7. Kualitas & Pengujian
- **Izin:** tabel kasus untuk FR-P6–P10 (penugasan lokasi vs "Semua lokasi", gabungan level tertinggi, lokasi nonaktif, `access` global, super admin, user tanpa penugasan).
- **Router:** lokasi tak dikenal, nonaktif, level kurang di salah satu lokasi, `locationIds` kosong, `locationId` ganda atau bukan teks.
- **Layanan akses:** validasi penugasan (duplikat, id tak dikenal), aturan tidak-mengunci-diri, pembatalan cache.
- **Migrasi:** `role_ids` → `assignments`, idempoten, user tanpa role, sel rusak tidak ditimpa.
- **Audit:** snapshot penugasan dan diff per lokasi.
- **FE:** pemilih lokasi (default, penyaringan lokasi tak valid, penyimpanan), bagian Penugasan di form User, halaman Lokasi, guard menu dan route per lokasi, field Lokasi pada form tulis.
- **Quality gate:** `bun run check` hijau; E2E manual (checklist ditambah): user dengan hak berbeda di dua lokasi, panggilan `api` langsung dengan lokasi yang tidak diizinkan ⇒ `FORBIDDEN`.

## 8. Risiko & Mitigasi
| Risiko | Dampak | Mitigasi |
|---|---|---|
| Developer modul baru lupa mendeklarasikan `scope: 'location'` | Modul berlokasi memeriksa izin global | Spesifikasi izin rute wajib memuat `scope`; tes tabel rute dan resep `docs/adding-a-module.md` diperbarui. |
| Admin salah menaruh penugasan (mis. role ber-`access` pada lokasi tertentu) dan mengira berlaku | Hak tidak sesuai harapan | Form Penugasan menjelaskan bahwa Pengaturan Akses hanya dari "Semua lokasi"; keterangan hak efektif di UI. |
| Migrasi gagal setengah jalan | User kehilangan role sementara | Migrasi per baris, urutan: isi `assignments` lebih dahulu baru kosongkan `role_ids`; idempoten. |
| Pembacaan `users` makin lebar (JSON `assignments`) | Respons lebih lambat | Konteks user di-cache; penugasan tetap satu sel per user. |
| Pemilih header membingungkan bila lokasi bertambah banyak | UX | Saat ini < 5 lokasi, daftar sederhana cukup; tambahkan pencarian bila melewati sekitar 10. |

## 9. Definition of Done
- [ ] Sheet `locations` dan kolom `assignments` terbuat otomatis oleh `setup`; user lama tetap punya hak yang sama.
- [x] Admin dapat membuat, mengubah, dan menonaktifkan lokasi dari UI.
- [x] Form User dapat mengatur penugasan; tabel Users merangkumnya.
- [x] Pemilih lokasi multi-select di header bekerja sesuai FR-C1–C5.
- [x] Panggilan RPC langsung dengan lokasi yang tidak diizinkan ditolak `FORBIDDEN`.
- [x] Log Audit menampilkan perubahan penugasan dan lokasi.
- [ ] `bun run check` hijau; checklist E2E diperbarui dan lulus.
- [x] `docs/adding-a-module.md` menjelaskan cara membuat modul berlokasi.

## 10. Pertanyaan yang Sudah Dijawab
1. **Jumlah lokasi:** saat ini kurang dari 5; pemilih header tanpa pencarian sudah cukup.
2. **Kode lokasi:** huruf besar, angka, dan tanda hubung (mis. `JKT-01`), maksimal 10 karakter.
3. **Penugasan "Semua lokasi":** otomatis berlaku juga di lokasi yang dibuat kemudian.
