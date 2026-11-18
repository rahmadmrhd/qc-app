# Alur Catat Serial Number dengan wajib foto bukti dan kamera di dialog foto

Tanggal: 2026-11-18. Status: **RANCANGAN, menunggu persetujuan pemilik produk** (keputusan perancang di §3 perlu dikonfirmasi). Spek induk: `docs/superpowers/specs/2026-11-12-serial-number-design.md`. Spek bukti foto (bagian 2): `docs/superpowers/specs/2026-11-16-serial-bukti-foto-qc-design.md`.

## 1. Tujuan dan latar belakang
Permintaan pemilik produk (2026-11-18): "perbaiki flownya pada saat mencatat Serial Number": (a) item dapat ditandai **wajib foto bukti** dengan jumlah foto minimum; (b) pada form catat, **Default harus diisi dulu** sebelum mulai scan; (c) untuk item wajib foto, scan menjadi **satu barcode per kali**, setelah serial terekam langsung **dialog unggah foto**, dan serial baru masuk tabel draft setelah foto terunggah; (d) dialog foto memberi **pratinjau gambar yang dapat diklik**; (e) dialog foto mendapat **kamera di dalam dialog**, layar penuh, dengan kontrol Switch kamera, Flash, dan Zoom seperti kamera scanner; (f) **cap** ditampilkan saat pengguna memotret.

Alasan (butir 1 spek bukti foto): foto bukti dipakai untuk berjaga-jaga bila customer berkomplain; item tertentu harus selalu berfoto, bukan bergantung pada kedisiplinan pencatat.

## 2. Keputusan pemilik produk (2026-11-18)
1. Kamera di dalam dialog foto **membalik** keputusan 2026-11-16 (butir 62 spek induk; butir 9 spek bukti foto) yang menghapus kamera di dalam aplikasi untuk foto bukti. Butir-butir itu diubah, bukan hanya dicatat di sampingnya (lihat §9).
2. Soal cap: **pratinjau cap di kamera** dipilih. Kamera menampilkan tampilan cap (SN, merk dan tipe, BU, lokasi, pelaku) di atas gambar; cap resmi TETAP digambar server saat Simpan dengan jam server (butir 3 dan 4 spek bukti foto tidak berubah; pratinjau tidak pernah masuk ke berkas foto).
3. Item wajib foto: scan satu barcode, lalu dialog unggah foto, lalu serial masuk tabel draft.
4. Default harus terisi sebelum scan dimulai.

## 3. Keputusan perancang (menunggu konfirmasi pemilik)
A. **Tempat bendera wajib foto: tabel `items`**, bukan tabel `serials` (satu baris `serials` adalah satu unit fisik, sedangkan "wajib foto" adalah sifat item). Kolom `items.proof_required` (TINYINT(1), bawaan 0) dan `items.proof_min` (TINYINT UNSIGNED, bawaan 1, 1 sampai `SERIAL_PROOF_LIMITS.perEntryMax` = 5). Diisi di form Data Item.
B. **Default "terisi"** = Item, Business Unit, Lokasi, dan Tanggal uji terisi. Catatan, Sample, dan pilihan stiker tidak menjadi syarat. Sebelum terisi, kolom scan, tombol kamera, dan tempel dinonaktifkan dengan petunjuk "Isi Default dulu: ...". Draft lama di localStorage dan baris yang sudah ada tidak berubah.
C. **Item wajib foto = satu serial per kali**, juga untuk tempel dan ketik (tempelan berisi lebih dari satu serial ditolak dengan petunjuk), dan kamera scanner dalam mode satu-serial (`single`, seperti Lapor Rusak). Item yang tidak wajib foto tetap memakai alur batch yang ada (tabel internal kamera, tempel banyak serial).
D. **Penegakan di dua sisi**: web (baris draft item wajib foto dengan foto kurang dari minimum berstatus "Butuh n foto" dan memblokir Simpan) dan **server** (`serials.saveBatch` menolak baris item wajib foto dengan `proofPhotoIds` kurang dari minimum; mencakup draft lama dan impor `.qcsn`). **Cek ulang tetap opsional** (bukan tujuan). Mengubah item menjadi wajib foto tidak memengaruhi serial yang sudah tersimpan.
E. **Satu dialog foto untuk semua pintu masuk bukti foto** (kolom Foto di tiap baris draft dan field Bukti foto di dialog Cek ulang): dialog baru "Foto bukti" menggantikan penggunaan `FileDialog` di `ProofPhotoField`. Isi: kisi pratinjau foto (klik = tampilan besar, tombol buang), penghitung "n dari minimum m (maks. 5)", tombol Kamera (membuka kamera layar penuh), Telusuri (multi-pilih berkas), dan di ponsel tombol aplikasi kamera bawaan tetap ada sebagai cadangan.
F. **Kamera foto tersedia di semua perangkat yang punya kamera** (termasuk webcam desktop), bukan hanya mobile. Bila izin kamera ditolak atau `getUserMedia` tidak ada, tombol Kamera tidak tampil dan dialog tetap berfungsi dengan Telusuri atau kamera bawaan.
G. **Pratinjau cap memakai data saat dialog dibuka** (SN, item, BU, lokasi baris) dan jam tertulis "saat disimpan" (jam server baru diketahui saat Simpan). Pada dialog Cek ulang, bila lokasi cek ulang belum dipilih, pratinjau cap tidak ditampilkan. Isi cap resmi bisa berbeda dari pratinjau bila item/lokasi/serial baris diubah sebelum Simpan (perilaku butir 5.1 spek bukti foto tidak berubah); pada alur wajib foto ketiga data itu praktis tetap karena baris langsung dibuat dari Default.
H. **Foto dipotret pada resolusi video** (ideal 1920x1080, jauh di bawah batas server di §5.5 spek bukti foto), disimpan JPEG lalu dikecilkan lewat `prepareImage` yang ada. Tanpa dependensi baru.

## 4. Anti-tujuan dan bukan tujuan
Anti-tujuan: cap permanen yang digambar di klien (dapat dipalsukan); serial masuk tabel draft tanpa foto minimum untuk item wajib foto; foto draft yatim bertumpuk bila dialog dibatalkan (harus dibuang lewat `discardProofPhotos`); kamera yang tetap menyala setelah dialog ditutup.
Bukan tujuan: wajib foto pada Cek ulang, Lapor rusak, atau jalur lain; aturan wajib foto per BU atau per lokasi; merekam video; metadata EXIF; mengubah cap resmi server; mengubah kamera pemindai barcode.

## 5. Pendekatan yang dipertimbangkan
- **Tempat bendera**: (a) `items` (dipilih, A); (b) tabel konfigurasi baru per (item, BU): lebih fleksibel tetapi item sudah memuat BU sebagai relasi banyak dan aturan per BU belum diminta (YAGNI); (c) `serials`: salah tempat, baris itu satu unit.
- **Cap**: (a) pratinjau di kamera, cap resmi server (dipilih pemilik); (b) cap permanen di klien: ditolak pemilik demi keamanan.
- **Kamera**: (a) mengekstrak bagian aliran kamera yang sudah ada di `useCameraScanner` (izin, `getUserMedia`, zoom, torch, ketuk-fokus, nama kamera) menjadi hook bersama `useCameraStream`, lalu hook pemindai dan hook foto memakainya (dipilih: satu tempat untuk kontrol, tidak menggandakan kode); (b) menyalin kode ke hook baru: cepat tetapi ganda. Komponen kontrol mengambang (`scan-camera-controls.tsx`, `zoom-slider.tsx`) dipakai ulang.

## 6. Perilaku
### 6.1 Data dan DTO
- Migrasi `0023_item_wajib_foto.sql` (expand-only, idempoten): `ALTER TABLE items ADD COLUMN IF NOT EXISTS proof_required TINYINT(1) NOT NULL DEFAULT 0` dan `proof_min TINYINT UNSIGNED NOT NULL DEFAULT 1`.
- `ItemDto`/input item: `proofRequired: boolean`, `proofMin: number` (1 sampai 5; bila `proofRequired` salah, `proofMin` diabaikan dan disimpan 1). `items.save` tetap PUT utuh dengan CAS yang ada. Perubahan nilai tercatat di audit item seperti field lain.
- `SerialItemOptionDto` mendapat `proofRequired` dan `proofMin` (web memutuskan alur tanpa permintaan tambahan). Hak baca mengikuti `serials.itemOptions`.
- `serials.saveBatch`: untuk tiap baris, bila item `proof_required`, jumlah `proofPhotoIds` harus >= `proof_min`; kurang = `VALIDATION` per baris dengan pesan yang tidak memuat data item lain ("Item ini wajib foto bukti minimal N").

### 6.2 Web: halaman Catat
1. **Gerbang Default.** Kolom scan, tombol kamera, dan tempel nonaktif sampai Default terisi (B); petunjuk di dekatnya menyebut field yang kosong. Fokus awal ke field Default pertama yang kosong.
2. **Item tidak wajib foto**: alur sekarang tidak berubah (tabel internal kamera, tempel banyak serial, kolom Foto opsional di tiap baris).
3. **Item wajib foto**: kamera scanner dalam mode `single` (tanpa tabel); tempel atau ketik menerima satu serial. Serial yang sah dan belum ada di draft membuka dialog Foto bukti untuk serial itu; serial yang sudah ada di draft = umpan balik "Sudah ada" tanpa dialog. Selama dialog terbuka, scan lain diabaikan.
4. **Dialog Foto bukti** (AlertDialog layar penuh, `size="full"`; bagian kiri/atas = kamera, bagian kanan/bawah = kisi foto, footer tetap): "Simpan ke draft" aktif setelah foto >= minimum; "Batal" membuang foto yang sudah diunggah di dialog (`discardProofPhotos`) dan serial TIDAK ditambahkan. Setelah "Simpan ke draft", baris dibuat dari Default dengan `proofPhotoIds` dan masuk tabel draft; kolom Foto baris tetap dapat menambah sampai 5.
5. **Baris draft item wajib foto** yang fotonya kurang dari minimum (draft lama, impor `.qcsn`, foto dibuang) berstatus "Butuh n foto" dan memblokir Simpan (`rowStatus`).

### 6.3 Web: kamera foto di dialog
- Tata letak: area kamera dengan kontrol mengambang (zoom slider + tombol +/-, Flash, Switch) memakai komponen yang ada; tombol rana (tombol bulat) di bawah area kamera; deretan foto bidik terakhir sebagai kisi; layar penuh, header dan footer tetap (aturan dialog proyek). Dua kolom pada desktop dan landscape, satu kolom pada portrait ponsel (seperti dialog scanner).
- Pengambilan: bingkai video saat ini digambar ke kanvas pada resolusi video, di-encode JPEG, lalu melalui `prepareImage` dan antrean unggah yang ada (`serialProofs.upload`); batas 5 foto per entri dan kuota draft diperlakukan seperti sekarang. Tiap jepretan memberi umpan balik (kilat singkat, getar ringan) dan foto muncul di kisi dengan status unggah.
- **Pratinjau cap**: overlay empat baris di bagian bawah area kamera (SN, "Merk Tipe", "BU · Lokasi", "Disimpan <saat simpan> · Pelaku (Tim)") dengan latar hitam dan huruf putih menyerupai footer cap resmi, plus keterangan "Pratinjau: cap resmi ditambahkan server saat Simpan". Overlay bukan bagian dari gambar yang dipotret dan dapat disembunyikan dengan satu tombol.
- Kamera dilepas saat dialog ditutup atau tab tersembunyi (perilaku hook yang ada). Izin ditolak atau kamera tak ada: tombol Kamera tidak tampil.

### 6.4 Pratinjau gambar yang dapat diklik
Kisi foto di dialog (dan di kolom Foto baris) menampilkan gambar kecil; klik membuka tampilan besar (dialog pratinjau, dapat ditutup dengan Esc) tanpa membuang foto. Tombol buang terpisah per foto.

## 7. Dampak pada dokumen
- Spek induk Serial Number: butir keputusan baru 65 (flow wajib foto, kamera di dialog foto); ubah butir 62 dan kalimat terkait di §4/§5/§8/§9; header Status.
- Spek bukti foto: butir 9 §3, §5.1 (kamera), §5.3 (pratinjau cap), §6.2; CLAUDE.md paragraf Serial Number dan Data Item; `docs/panduan`/Panduan Interaktif bila langkah Catat Serial menyebut urutan lama (cek).
- Rencana implementasi: `docs/superpowers/plans/2026-11-18-serial-catat-wajib-foto.md`.

## 8. Pengujian
- Server: `items.save` menyimpan dan menolak `proofMin` di luar 1 sampai 5; `serials.itemOptions` membawa bendera; `serials.saveBatch` menolak item wajib foto yang fotonya kurang (termasuk impor tanpa foto dan simpan ulang) dan menerima yang cukup; item tak wajib tidak terpengaruh; audit; konkurensi bila bendera item diubah di tengah simpan (CAS yang ada).
- Web: gerbang Default (field kosong menonaktifkan scan dan petunjuk menyebutnya); alur item wajib foto (scan satu serial membuka dialog, Batal membuang foto dan tidak menambah baris, Simpan ke draft menambah baris dengan foto, duplikat tidak membuka dialog, tempel multi-serial ditolak); baris "Butuh n foto"; dialog Foto bukti (kisi pratinjau, klik membuka tampilan besar, buang, penghitung); kamera foto dengan `getUserMedia` palsu (jepret menambah foto, izin ditolak menyembunyikan tombol Kamera, kamera dilepas saat tutup); pratinjau cap (isi, tombol sembunyikan, tidak ada di berkas); hook `useCameraStream` hasil ekstraksi (tes kamera pemindai yang ada tetap lulus).
- Tidak teruji tanpa perangkat nyata: rana, fokus, zoom, torch, izin kamera di iOS PWA, memori ponsel dengan banyak foto.

## 9. Keputusan terbuka dan risiko
- Butir 3 A sampai H menunggu konfirmasi pemilik; yang paling berdampak: A (bendera di item), D (penegakan server, termasuk impor `.qcsn`), E (satu dialog untuk semua pintu masuk foto).
- Risiko: dialog layar penuh dengan kamera + kisi + footer pada layar 360 px (diuji seperti dialog scanner); foto sementara hanya bertahan 7 hari di server (draft lama menyiratkan "foto kedaluwarsa, unggah lagi"); pemakaian memori saat beberapa jepretan berurutan (dikecilkan sebelum antre).
