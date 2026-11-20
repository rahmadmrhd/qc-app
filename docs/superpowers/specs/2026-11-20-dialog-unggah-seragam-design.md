# Dialog unggah berkas seragam (satu `FileDialog`)

Tanggal: 2026-11-20. Status: keputusan disetujui pemilik produk 2026-11-20 (kecuali yang ditandai "(keputusan perancang)"); **dibangun 2026-11-20** (Task 1-18; penamaan akhir komponen `FileDialog`, `AttachDialog` hanya nama kerja selama pengerjaan); hasil uji Task 1 (XHR di Electron) tercatat di 5.3; uji perangkat nyata menunggu pemilik. Bagian 1 menggambarkan keadaan SEBELUM pekerjaan ini.

## 1. Tujuan dan latar belakang

Pemilik produk melihat bahwa unggah berkas di aplikasi web terasa tidak konsisten: dialog foto bukti QC, dialog instruksi stiker, dan beberapa pemilih berkas inline berperilaku dan terlihat berbeda. Pemeriksaan kode (2026-11-20) menemukan:

- Dua dialog unggah: `FileDialog` (`web/src/components/file-dialog/`, 3 pemakai: Instruksi stiker per item, halaman Pustaka Gambar, unggah ulang foto bukti gagal) dan `ProofPhotoDialog` + `ProofCameraDialog` (`web/src/modules/serial/components/`, 3 pemanggil: `proof-photo-field`, `row-edit-dialog`, `strict-scan-dialog`).
- Enam pemilih inline tanpa dialog: `ImagePicker` (contoh stiker), `ImageGalleryField` (galeri item), editor Markdown (tombol gambar toolbar), `AttachmentsField` (Postel), `PdfSourceField` (PDF QR), `LogoLibraryField` (logo QR).
- Perbedaan perilaku: waktu unggah (`FileDialog` saat "Lampirkan"; foto bukti seketika), antrean dan Ulangi (hanya `FileDialog`), seret-lepas (tidak merata), pesan validasi (empat set kalimat berbeda), batas ukuran tampil, label dan judul, indikator progres, dan komponen pemilih (`<Input type="file">` bawaan peramban pada PDF dan logo).
- Dokumentasi basi: komentar di `proof-replace-dialog.tsx`, butir B8 spek bukti foto QC, dan `CLAUDE.md` menyebut dialog unggah ulang memakai atribut `capture`; atribut itu tidak ada lagi (kamera bawaan sistem sudah diganti kamera di dalam aplikasi, keputusan pemilik 2026-11-18).

Tujuan: SATU komponen dialog untuk semua lampiran, dengan perilaku dan tampilan yang sama, dan aturan pemakaiannya tercatat agar fitur baru memakainya.

## 2. Tujuan, bukan tujuan, anti-tujuan

Tujuan:
- Satu `FileDialog` menggantikan `FileDialog` lama + `ProofPhotoDialog` + `ProofCameraDialog`.
- Semua tempat lampiran memakai dialog itu, kecuali `PdfSourceField` dan `LogoLibraryField` (tetap inline, tetapi memakai validasi, seret-lepas, dan indikator progres yang sama).
- Unggahan berjalan di latar setelah dialog menutup, dengan progres terlihat di field pemanggil.
- Validasi dan pesan galat seragam; semua berkas maksimal 10 MB.
- Pratinjau dialog saat thumbnail diklik di semua tampilan lampiran inline.

Bukan tujuan:
- Mengubah rute server, batas dimensi foto bukti, cap foto bukti, atau aturan pustaka (hapus, ubah nama, jumlah pemakaian).
- Menambah fitur Pustaka ke tempat yang tak punya pustaka.
- Pratinjau PDF di dalam aplikasi (PDF tetap diunduh).
- Menyimpan unggahan yang belum selesai ke penyimpanan lokal (draf tidak menyimpan berkas yang masih berjalan).

Anti-tujuan (dianggap gagal walau secara teknis berfungsi):
- Foto bukti QC kehilangan kamera, pratinjau cap, atau penegakan minimum foto.
- Pengguna dapat menyimpan form selagi ada unggahan berjalan atau gagal.
- Foto bukti QC yang selesai diunggah setelah dialog/form ditutup tertinggal sebagai berkas yatim yang tak terbuang (untuk sumber lain lihat 5.11 butir 2: yatim dibiarkan seperti sekarang).

## 3. Kendala

- Pengguna pada ponsel dan aplikasi desktop (Electron, `app://qc`, `/api` diteruskan proses utama): progres unggah harus tidak merusak jalur desktop.
- `fetch` tidak melaporkan progres unggah; persen asli butuh `XMLHttpRequest`.
- Aturan proyek: field relasi `LinkField`, dilarang `<select>` bawaan, dialog dengan header/footer tetap (`CLAUDE.md`, "Aturan frontend"). Komponen baru patuh.
- `runBusy` (`web/src/app/pwa/busy.ts`): setiap penulisan yang sedang berjalan menandai registri sibuk agar muat ulang otomatis PWA tidak memotongnya.
- Batas 10 MB sudah sama di tiga konstanta (`MAX_IMAGE_BYTES`, `POSTEL_LIMITS.attachmentMaxBytes`, `QR_LIMITS.documentMaxBytes`); rute biner di `shared/api.ts` memuat angka literal yang dijaga tes.
- Foto bukti: unggahan menjadi `draft` di server (`serialProofs.upload`), pembuangan lewat `discardProofPhotos`; draf Catat Serial menyimpan hanya rujukan (`ProofPhotoRef`), tidak menyimpan berkas.

## 4. Pendekatan

Pertanyaan: siapa yang memegang unggahan setelah dialog menutup (keputusan pemilik: opsi "b", dialog menutup langsung, unggahan lanjut di latar dengan progres di field pemanggil, Simpan ditahan sampai selesai)?

1. **Dialog mengumpulkan berkas; pemilik field menjalankan unggahan lewat hook bersama (DIPILIH, keputusan perancang).** Sederhana, sejalan dengan form yang sudah menahan Simpan, dan hasil yang selesai setelah pemilik lepas dibuang oleh hook itu sendiri. Kekurangan: unggahan berhenti bila pemilik dilepas (dibatalkan dan dibersihkan); untuk baris Catat Serial hook dipasang di level halaman karena baris dapat lepas saat tata letak tabel/kartu berganti.
2. Pengelola unggahan global yang hidup lebih lama dari komponen. Tidak dipilih: hasil unggahan tak punya pemilik bila form ditutup, butuh pembersihan yatim, antrean lintas rute, dan tes yang jauh lebih berat, padahal tiap form sudah menahan Simpan.
3. Dialog tetap memegang unggahan sampai selesai (opsi "a" pemilik). Ditolak pemilik.

## 5. Desain

### 5.1 `FileDialog` terpadu

Satu komponen di `web/src/components/file-dialog/`, dirender sebagai `AlertDialog` (klik di luar dialog tidak menutup; Esc dan tombol Batal menutup; bila antrean berisi, penutupan lewat Esc/Batal meminta konfirmasi "Buang N berkas?" (keputusan perancang)). Bagian:

- Tab "Unggah" (selalu) dan tab "Pustaka" (hanya bila `showLibrary` dan sumber punya pustaka, seperti sekarang).
- Area seret-lepas + tombol "Telusuri" + tombol "Kamera" (kamera di dalam aplikasi; tampil bila `camera` aktif, peramban mendukung, dan izin tidak diblokir; bawaan aktif untuk dialog yang menerima gambar).
- Antrean: bila permintaan HANYA gambar, tampil sebagai grid thumbnail (seperti kisi dialog Foto bukti sebelumnya); bila memuat PDF (Postel), tampil sebagai daftar (thumbnail kecil untuk gambar, ikon untuk PDF). Ubah nama per entri hanya bila sumber punya `nameMax` dan `hideNames` tidak diset (mis. Pustaka, instruksi stiker); foto bukti dan lampiran tanpa pustaka menyembunyikan nama.
- Panel "berkas tidak dapat ditambahkan" satu bentuk untuk semua (daftar nama + alasan, tombol tutup).
- Tombol konfirmasi ("Lampirkan" bawaan; label per pemanggil boleh diubah) dan "Batal". Konfirmasi TIDAK mengunggah di dalam dialog: ia menyerahkan hasil ke pemanggil dan menutup dialog.
- Kontrak keluaran: `onConfirm({ library: LibraryItem[]; files: QueuedFile[] })` dengan `QueuedFile = { key, file, name }`. `library` = pilihan dari tab Pustaka (sudah di server); `files` = berkas baru yang akan diunggah pemanggil. Mode `single` memakai satu berkas atau satu pilihan, mode `multiple` memakai `maxFiles` (sisa kapasitas dari pemanggil).
- Props utama: `open`, `onOpenChange`, `accept` (kategori `'image'` dan `'pdf'`), `maxBytes` (bawaan `MAX_FILE_BYTES`), `mode`, `maxFiles`, `source` (hanya untuk tab Pustaka dan aturan nama), `showLibrary`, `camera` (boolean atau `{ stamp?: StampPreviewInput }`), `title`, `confirmLabel`, `hideNames`, `initialFiles`, `initialRejected`.
- Kamera: `ProofCameraDialog` dan `use-camera-stream`, `photo-capture`, `camera-session`, kontrol kamera dipindah ke `components/file-dialog/camera/` dan digeneralisasi; pratinjau cap foto bukti menjadi slot opsional (`stamp`). Jepretan masuk antrean dialog sebagai `File` (tidak diunggah seketika). Strip thumbnail kamera mengikuti antrean dialog.

### 5.2 Unggahan latar: `useBackgroundUploads`

Hook bersama (menggantikan `useUploadQueue`) yang dipasang pemilik field:

- Masukan: `FileSource` (adaptor), `onUploaded(item, queued)`, opsi `concurrency` (3), `label`.
- State per entri: `waiting`, `preparing` (pengecilan gambar), `uploading` (persen bila tersedia), `done`, `failed` (pesan), dengan aksi `retry(key)`, `remove(key)` (membatalkan lewat `AbortController` bila sedang berjalan).
- `busy` (ada entri belum `done`/`removed`) dipakai pemanggil untuk menahan Simpan; entri `failed` juga menahan Simpan sampai diulang atau dibuang (anti-tujuan 2).
- Seluruh antrean dibungkus `runBusy` agar muat ulang otomatis PWA tertunda.
- Saat pemilik dilepas: unggahan berjalan dibatalkan, dan hasil yang sudah selesai tetapi belum diklaim dibuang lewat `onDiscard` sumber (mis. `discardProofPhotos`), seperti pola `aliveRef` di `ProofPhotoDialog` sekarang.
- Hasil selesai menambah item ke nilai field lewat `onUploaded`; field menolak (dan membuang hasil) bila melewati batas.

### 5.3 Progres

- Indikator per berkas: bar progres (`<progress>`/`role="progressbar"`) dengan tahap "Menyiapkan" (pengecilan, tanpa persen) lalu persen unggah.
- Persen unggah asli: `api()` menerima `callOptions.onUploadProgress`; bila diberikan, rute biner memakai `XMLHttpRequest` (header, CSRF, galat, dan pemetaan `UNAVAILABLE` sama dengan jalur `fetch`). Tanpa callback tetap `fetch`.
- Aplikasi desktop (keputusan pemilik produk 2026-11-20: "uji dulu"): `/api` melewati protokol `app://` yang diteruskan proses utama (`api-proxy.ts`, `net.fetch`, badan permintaan dialirkan langsung ke server tanpa buffer). XHR dengan badan biner di skema itu belum terbukti, jadi langkah PERTAMA rencana adalah uji kecil di Electron nyata (skema `app://` dengan `protocol.handle` yang meneruskan badan seperti proksi asli; kirim berkas lewat XHR; periksa `upload.onprogress` terisi bertahap dan unggahan sampai utuh). Hasil uji menentukan: terisi = desktop memakai cabang XHR yang sama dengan peramban; tidak terisi atau unggahan gagal = desktop tetap lewat `fetch` dengan bar tak-tentu "Mengunggah" (dipilih lewat deteksi di `isDesktop()`), dan penghitungan byte di proses utama (event jembatan) dicatat sebagai pekerjaan lanjutan di luar PR ini. Hasil uji dicatat di spek ini.
- **Hasil uji Electron (2026-11-20): GAGAL, `XHR_PROGRESS_ON_DESKTOP = false`.** Uji sekali pakai (tidak dikomit) di Electron 45.0.0 (Node 24.22.0), jendela tersembunyi, skema `app` terdaftar `standard`/`secure`/`supportFetchAPI` seperti `desktop/src/main/index.ts`, dan `protocol.handle('app')` meneruskan `request.body` ke server HTTP lokal lewat `net.fetch` dengan `duplex: 'half'` (meniru `api-proxy.ts`). Berkas 5 MB (5.242.880 byte) dikirim lewat `XMLHttpRequest` POST ke `app://qc/echo`, dua kali jalan: unggahan SELALU sampai utuh (server menerima 5.242.880 byte, status 200), tetapi `xhr.upload` hanya memicu `loadstart`; **nol event `progress` dan event `load` upload tidak terpicu** (`loaded` tidak pernah terisi). Kontrol memakai halaman `http://127.0.0.1` biasa (tanpa protokol kustom): `progress` terpicu (1 event, `loaded` = 5.242.880 karena loopback terlalu cepat untuk bertahap) dan `load` upload terpicu, jadi skrip uji sahih dan kegagalan ada pada skema kustom. Keputusan: desktop memakai cabang `fetch` dengan bar tak-tentu "Mengunggah"; penghitungan byte di proses utama dicatat sebagai pekerjaan lanjutan. Pengujian di perangkat nyata (paket terpasang) tetap sisa uji pemilik.
- Persen XHR menghitung byte yang diserahkan ke jaringan, sehingga dapat mencapai 100% sebelum server selesai: setelah 100% label berganti "Memproses" sampai respons diterima.
- Kartu progres tampil di field pemanggil (sel grid/daftar dengan bar), bukan di dalam dialog.

### 5.4 Tampilan lampiran dan pratinjau

Komponen bersama `AttachmentView` (grid atau daftar sesuai jenis) yang menampilkan: item selesai (thumbnail), item sedang diunggah (kartu progres, Ulangi bila gagal, buang), dan tombol buang. Mengklik thumbnail gambar membuka `PreviewDialog` (satu pratinjau, sumber gambar `previewUrl`); `ProofPhotoGrid` digantikan atau menjadi turunannya. PDF: tombol "Unduh" (tidak ada pratinjau). Gambar hanya pratinjau dan TIDAK punya tombol Unduh, juga pada lampiran Postel (keputusan pemilik produk 2026-11-20; `AttachmentView` menampilkan Unduh hanya untuk item tanpa `renderImage`).

Tempat pemakaian: galeri item, contoh stiker (`ImagePicker`), lampiran Postel, foto bukti, instruksi stiker (kartu foto sudah punya pratinjau sendiri; kartu menunggu unggah memakai kartu progres yang sama), logo QR (thumbnail klik membuka pratinjau).

### 5.5 Validasi seragam

- Satu konstanta `MAX_FILE_BYTES = 10_485_760` di `shared/files.ts`; `MAX_IMAGE_BYTES`, `POSTEL_LIMITS.attachmentMaxBytes`, dan `QR_LIMITS.documentMaxBytes` diturunkan dari/disamakan dengannya, dijaga tes (literal di `shared/api.ts` tetap dijaga `api.test.ts`).
- Satu `checkFile` (`components/file-dialog/accept.ts`) untuk semua tempat, dengan kategori `pdf` selain `image`, jenis dari `file.type` dengan cadangan ekstensi (`postelFileMime` dilebur), dan satu set kalimat: "Format X tidak didukung (hanya …)", "Berkas kosong", "Ukuran melebihi 10 MB", "Maksimal N berkas". Semua pesan "Hanya gambar JPEG, PNG, atau WebP" dan padanannya di picker/galeri/editor/PDF/logo dihapus.
- Foto bukti: batas dimensi hanya ditegakkan di server (`proofSizeError`, `server/src/modules/serial/proof/stamp.ts`); klien tidak menambah pemeriksaan dimensi (gambar sudah dikecilkan ke `MAX_IMAGE_SIDE` sebelum naik), jadi tidak ada hook validasi per-sumber. (Dikoreksi saat menyusun rencana, 2026-11-20.)
- Panel penolakan satu komponen (`RejectedList`).

### 5.6 Seret-lepas

`FileDropZone` membungkus semua tempat lampiran: galeri item, contoh stiker, lampiran Postel, instruksi stiker (sudah), Pustaka Gambar (sudah), foto bukti (pada field, bukan hanya di dialog), `PdfSourceField`, `LogoLibraryField`. Editor Markdown: drop dan tempel tetap langsung menyisipkan (tanpa dialog) dengan progres dan validasi yang sama; tombol gambar toolbar membuka `FileDialog`. Pemanggil menyerahkan berkas yang dijatuhkan ke hook unggah (tempat tanpa dialog) atau membuka dialog dengan `initialFiles` (tempat dengan nama/pustaka: instruksi stiker, Pustaka Gambar).

### 5.7 Adaptor sumber

`FileLibrarySource` menjadi `FileSource`: `key`, `mimeTypes`, `nameMax?`, `upload(file, name, { onProgress, signal })`, dan `list`/`rename`/`remove` OPSIONAL (hanya sumber berpustaka). Adaptor: `stickerGuideSource` (ada), `proofSource` (ada, tanpa pustaka), baru `itemFileSource` (`files.upload`, untuk galeri item, contoh stiker, penyisipan editor; thumbnail lewat `files.get`), dan `postelSource` (`postelFiles.upload`, tanpa pengecilan). Adaptor menerima `prepareImage` per sumber (pengecilan menurut sumber, mis. logo 512 px tetap di `LogoLibraryField`).

### 5.8 Tempat dan perubahan

| Tempat | Sekarang | Setelah |
|---|---|---|
| Instruksi stiker per item | `FileDialog` + Pustaka | `FileDialog` baru + Pustaka; foto baru tampil sebagai kartu progres lalu kartu foto |
| Pustaka Gambar (halaman) | `FileDialog` tanpa pustaka | idem; progres sebagai daftar di halaman; daftar dimuat ulang saat selesai |
| Unggah ulang foto bukti | `FileDialog` tanpa pustaka, tanpa kamera | `FileDialog` baru tanpa pustaka, dengan kamera; satu foto; penggantian lewat `serialProofs.replace` setelah unggah selesai |
| Foto bukti (Catat, Ubah baris, Cek ulang, `strict-scan-dialog`) | `ProofPhotoDialog` + kamera | `FileDialog` baru dengan kamera + pratinjau cap, unggah latar; hook dipasang di level halaman Catat Serial |
| `ImagePicker` (contoh stiker) | tombol + input tersembunyi | tombol membuka `FileDialog` (satu gambar), seret-lepas, thumbnail klik = pratinjau |
| `ImageGalleryField` (galeri item) | tombol + input tersembunyi | `FileDialog` (banyak gambar), seret-lepas, pratinjau |
| `AttachmentsField` (Postel) | tombol + input tersembunyi | `FileDialog` (gambar + PDF, daftar), seret-lepas, pratinjau gambar; hanya PDF yang diunduh, lampiran gambar hanya pratinjau tanpa tombol Unduh (keputusan pemilik produk 2026-11-20: Unduh pada gambar tidak dipulihkan; sebelumnya alur lama memberi Unduh pada setiap lampiran) |
| Editor Markdown | tombol toolbar + drop/tempel | tombol toolbar membuka `FileDialog`; drop/tempel tetap langsung; progres dan validasi seragam |
| `PdfSourceField` | `<Input type="file">` + konfirmasi bagikan | tetap inline dan alur konfirmasi sama; tambah seret-lepas, validasi dan galat seragam, progres seragam |
| `LogoLibraryField` | `<Input type="file">` | tetap inline; tambah seret-lepas, validasi seragam, progres seragam, thumbnail klik = pratinjau |

### 5.9 Catat Serial (kasus khusus)

- Baris draf menyimpan hanya foto selesai (`ProofPhotoRef`); entri belum selesai ada di hook halaman, dikunci ke `row.clientId`, dan ditampilkan pada sel/kartu baris itu.
- Simpan (ke server) ditahan selama ada entri belum selesai atau gagal di baris mana pun; pesan menyebut jumlahnya.
- Item wajib foto: foto yang masih diunggah dihitung terhadap minimum di dialog scan (`strict-scan-dialog`), tetapi baris baru valid untuk disimpan hanya bila semua foto selesai dan jumlahnya mencapai minimum; foto gagal yang dibuang dapat menurunkan di bawah minimum dan ditolak seperti sekarang.
- Penjaga keluar halaman (`LeaveProofDialog`) menghitung juga unggahan berjalan.
- Muat ulang halaman saat unggah berjalan: entri hilang (tidak disimpan di draf); `runBusy` mencegah muat ulang otomatis PWA.
- Dialog scan item wajib foto (`strict-scan-dialog`), keputusan perancang: `clientId` baris dibuat saat dialog dibuka (sebelum foto pertama), hook halaman memegang unggahan atas kunci itu. "Simpan" di dialog aktif bila jumlah foto (selesai + sedang diunggah) mencapai minimum, lalu memasukkan baris ke draf dengan foto yang sudah selesai; unggahan yang masih berjalan lanjut di bawah kunci yang sama dan baris tidak dapat disimpan ke server sampai semuanya selesai. Batal/Esc/menutup dialog sebelum "Simpan" membatalkan unggahan berjalan dan membuang foto yang sudah selesai (perilaku pembuangan sekarang tetap).
- Ubah baris, ubah massal, dan hapus baris: hook halaman dikunci ke `clientId` baris. Baris yang dihapus atau digantikan membatalkan unggahan berjalan miliknya dan membuang foto selesai yang tak lagi terpakai. Pada mode desktop terkontrol (draf di SQLite lewat `useDraftRows`), draf tetap hanya menyimpan foto selesai; hook halaman berada di atas `useDraftRows`, tidak menulis ke SQLite.
- Dialog Cek ulang (`act-dialog`): fotonya tak punya baris draf, jadi hook dipasang di dialog itu sendiri (pemilik form); menutup dialog membatalkan unggahan berjalan dan membuang foto selesai yang belum terkirim, dan tombol kirim aksi ditahan selama ada unggahan berjalan atau gagal.

### 5.11 Keputusan perancang dari pemeriksaan pembuat

1. **Pemilik di luar form Simpan.** Aturan umum: pemilik hook = komponen yang memiliki nilai field; saat pemilik dilepas, unggahan berjalan dibatalkan.
2. **Arti "membuang hasil" per sumber (tanpa mengubah server).** Foto bukti: dibuang lewat `serialProofs.remove`/`discardProofPhotos` seperti sekarang. Pustaka stiker (`stickerGuides.upload`): hasil unggahan adalah entri pustaka yang disengaja, TIDAK dibuang (pada halaman Pustaka Gambar hasilnya memang tujuan; pada instruksi stiker, gambar yang terunggah tetapi tak jadi dipakai tetap berada di pustaka seperti sekarang). `files.upload` (item, contoh stiker, editor) dan `postelFiles.upload`: tidak ada rute hapus, yatim dibiarkan (toleransi yang sudah tercatat di `CLAUDE.md`). Jadi `FileSource.onDiscard` OPSIONAL, hanya diisi sumber foto bukti. Pekerjaan ini tidak menyentuh server. Dikonfirmasi pemilik produk 2026-11-20 (L1): unggahan pustaka stiker yang dibatalkan atau selesai terlambat tetap berada di pustaka bersama dan tidak diberi `stickerGuideSource.onDiscard`; alasan: gambar pustaka bersama bisa saja sudah dipakai pengguna lain, jadi membuangnya otomatis berisiko. Dikonfirmasi pemilik produk 2026-11-20 (L3): membuang draf dapat ikut menghapus foto bukti berstatus `failed` yang sudah tersimpan bila halaman masih memegang id-nya (skenario langka: dua tab atau simpan sebagian; perilaku yang sama dengan sebelumnya, tercatat di audit `serial.proof_remove`); perbaikannya butuh perubahan server (rute `remove` dibatasi ke status `draft`), jadi ditunda ke tugas terpisah dan pekerjaan ini tetap tidak menyentuh server.
3. **Editor Markdown.** Semua editor yang memakainya (item, catatan serah terima, pesan aksi serial, `serial-note-field`) berbagi `wysiwyg-editor.tsx`, jadi perubahannya satu tempat. Sumber unggah tetap `files.upload` lewat adaptor `itemFileSource` (tanpa mengubah pemilik berkas di server). Progres tampil di baris status yang sudah ada di bawah editor (bar kecil + "Mengunggah gambar…"), tidak ada simpul sisipan sementara; gambar disisipkan di posisi kursor saat unggahan selesai, seperti sekarang. Editor mendapat prop opsional `onBusyChange(busy)` (pola yang sama dengan `AttachmentsField` dan `PdfSourceField`) yang dihubungkan oleh form yang punya tombol Simpan. Bila editor dilepas selagi mengunggah, unggahan dibatalkan dan tidak ada yang disisipkan.
4. **Unggah ulang foto bukti.** Hook dipasang di komponen yang membuka dialog (galeri foto atau banner masalah). Kartu foto gagal yang sedang diganti menampilkan bar progres dan teks "Mengganti…", dan foto gagal lama tetap terlihat sampai `serialProofs.replace` berhasil; bila unggahan atau penggantian gagal, kartu kembali ke keadaan gagal dengan pesan dan Unggah ulang tersedia lagi. Berpindah halaman saat unggahan berjalan membatalkan unggahan (tidak memanggil `replace`).
5. **Desktop dan XHR.** Lihat 5.3: peramban memakai XHR; desktop mengikuti hasil uji Electron di awal pekerjaan (XHR bila terbukti, selain itu `fetch` + bar tak-tentu). Tidak ada pengalihan otomatis dari XHR ke `fetch` saat gagal di tengah unggahan (galat XHR dilaporkan sebagai galat jaringan yang sama seperti `fetch`).

6. **Dialog Catat Serial desktop tidak menutup diam-diam saat ada unggahan foto (keputusan pemilik produk 2026-11-20, hasil review akhir, Minor 7).** Menutup `RecordDialog` (Country Lock desktop) melepas `RecordPage`, sehingga pemilik hook dilepas dan unggahan foto yang berjalan dibatalkan tanpa peringatan. Aturan: selama ada unggahan foto berjalan atau gagal (`blocking` pada `useBackgroundUploads`, dilaporkan `RecordPage` lewat `onUploadsPendingChange`), menutup dialog lewat X, Esc, atau klik di luar meminta konfirmasi (AlertDialog "Tutup dan buang foto?" dengan "Tetap di sini" dan "Tutup dan buang foto"); tanpa unggahan tertunda dialog menutup biasa. Baris draf tidak dibuang; setelah konfirmasi unggahan dibatalkan dan hasil yang terlambat dibuang lewat jalur `onDiscard` yang sudah ada. Penutupan otomatis setelah semua baris tersimpan (`onAllSaved`) tidak menampilkan konfirmasi. Alasan: pengguna tidak sadar foto yang sedang diunggah ikut hilang saat dialog ditutup.

### 5.10 Kode yang dihapus atau dipindah

Dihapus (selesai 2026-11-20): `ProofPhotoDialog` dan `ProofPhotoGrid` (dilebur), `use-upload-queue.ts` dan `upload-tab.tsx` (diganti hook latar dan dialog terpadu), `use-upload-image.ts` dan `useUploadFile`, input file tersembunyi dan penanganan unggah per-field (galeri, picker, Postel, editor), set pesan validasi ganda. Dipindah: kamera dan pendukungnya ke `components/file-dialog/camera/`. `ProofCameraDialog` tidak lagi dialog terpisah milik modul Serial.

## 6. Dokumentasi yang diubah dalam pekerjaan ini

- `CLAUDE.md` (proyek): koreksi bullet Serial/bukti foto (tidak ada `capture`; dialog unggah ulang memakai `FileDialog`), ganti bagian foto bukti yang menyebut `ProofPhotoDialog`, dan tambah aturan di "Aturan frontend": SETIAP lampiran berkas memakai `FileDialog` + `useBackgroundUploads` (kecuali `PdfSourceField`/`LogoLibraryField` yang inline tetapi memakai validasi dan seret-lepas bersama); jangan membuat input file sendiri.
- Spek bukti foto QC (`2026-11-16-serial-bukti-foto-qc-design.md`): tutup B8 (keputusan pemilik 2026-11-20: unggah ulang memakai dialog unggah yang sama dengan kamera di dalam aplikasi), ubah kalimat yang menyebut `ProofPhotoDialog` dan unggah seketika menjadi alur baru, dan catat bahwa foto diunggah di latar setelah dialog menutup.
- Spek induk Serial Number (butir bukti foto 59-65): catat perubahan alur unggah (latar, Simpan ditahan) dan tutup pertanyaan terbuka terkait.
- `docs/adding-a-module.md`: tambah catatan singkat pemakaian `FileDialog` untuk modul yang butuh lampiran (bila bagian tentang lampiran/berkas ada; bila tidak, bagian baru).
- Komentar kode basi (`proof-replace-dialog.tsx` dan sejenisnya) diperbarui.
- Changelog: fragmen `server/changelog.d/` TIDAK diperlukan (hanya FE; fragmen hanya untuk server/desktop); PR ke `dev` wajib membawa fragmen atau label `tanpa-changelog` bila mengubah kode server/desktop. (perancang: PR ini mengubah web dan `shared/`; builder memeriksa apakah `shared/` memerlukan fragmen server.)

## 7. Pengujian

- Unit: `checkFile` (kategori `pdf`, cadangan ekstensi), `useBackgroundUploads` (konkurensi, retry, hapus, batalkan, buang hasil yatim saat unlink, `busy`), konstanta 10 MB sama di tiga tempat.
- Komponen: `FileDialog` (grid vs daftar, kamera, konfirmasi buang, AlertDialog tidak menutup oleh klik luar), tiap host (galeri, picker, Postel, editor, PDF, logo, instruksi, Pustaka, foto bukti), kartu progres, pratinjau saat thumbnail diklik.
- Klien API: `onUploadProgress` (XHR) memetakan galat, CSRF, dan `UNAVAILABLE` sama seperti `fetch`.
- Catat Serial: Simpan ditahan selama unggah berjalan atau gagal, minimum foto, penjaga keluar. Kriteria penerimaan (5.11 butir 6): dialog Catat Serial desktop yang ditutup selagi ada unggahan berjalan atau gagal meminta konfirmasi, "Tetap di sini" menjaga dialog dan unggahan, "Tutup dan buang foto" menutup serta membatalkan unggahan tanpa membuang baris draf, dan tanpa unggahan tertunda dialog menutup langsung. Lampiran gambar Postel tidak punya tombol Unduh, PDF punya (5.4).
- Uji manual (pemilik): kamera ponsel nyata, progres di aplikasi desktop, unggah besar pada jaringan lambat.

## 8. Diserahkan ke pembuat rencana (terjawab saat pembangunan)

Jawaban singkat: `ProofPhotoGrid` dihapus (digantikan `AttachmentView`); kartu progres dan grid di `attachment-view.tsx`; pratinjau cap di kamera tersedia lewat slot `stamp` (`proofCameraStamp`), sedangkan dialog unggah ulang foto bukti tidak memakai pratinjau cap (cap resmi tetap digambar server); progres XHR diuji di jsdom lewat `xhr-upload.test.ts` dan di Electron lewat Task 1.

- Pembagian berkas dan urutan migrasi per tempat; apakah `ProofPhotoGrid` dilebur atau menjadi pembungkus.
- Bentuk persis kartu progres dan tata letak grid pada layar sempit.
- Apakah dialog unggah ulang foto bukti dapat menampilkan pratinjau cap (bergantung data yang tersedia pada `SerialProofPhotoDto`).
- Cara menguji progres XHR di lingkungan tes (jsdom) dan di desktop.

## 9. Pertanyaan terbuka

- **Terjawab 2026-11-20:** progres unggah dengan persen asli di aplikasi desktop (`app://` + proksi proses utama) tidak terbukti pada uji Electron (5.3), jadi desktop memakai bar tak-tentu (`XHR_PROGRESS_ON_DESKTOP = false`). Pengujian di perangkat nyata (bukan hanya skrip uji) tetap tercatat sebagai sisa uji pemilik.
- Pratinjau PDF di dalam aplikasi: tidak dibuat; dapat ditambah kemudian.

## 10. Catatan keputusan (untuk disalin ke spek terkait saat diterapkan)

2026-11-20, pemilik produk: satu `FileDialog` untuk semua lampiran (menyerap `ProofPhotoDialog` + `ProofCameraDialog`); inline diarahkan ke dialog itu kecuali `PdfSourceField` dan `LogoLibraryField`; unggahan setelah "Lampirkan" berjalan di latar dengan progres di form dan Simpan ditahan; dialog memakai `AlertDialog`; grid untuk permintaan khusus gambar; kamera di dalam aplikasi tersedia; seret-lepas merata di semua tempat lampiran; validasi dan pesan seragam dengan batas 10 MB untuk semua berkas; thumbnail inline dapat diklik untuk pratinjau; aturan pemakaian dicatat di `CLAUDE.md`. Menutup B8 spek bukti foto QC.

2026-11-20, pemilik produk (keputusan atas review akhir): (1) lampiran gambar Postel tetap hanya pratinjau, Unduh hanya untuk PDF (5.4); (2) dialog Catat Serial desktop meminta konfirmasi bila ditutup selagi ada unggahan foto berjalan atau gagal (5.11 butir 6); (3) unggahan pustaka stiker yang dibatalkan tetap di pustaka bersama (5.11 butir 2, L1); (4) kamera bawaan sistem (`capture`) dihapus dan diganti kamera di dalam aplikasi (butir 67 spek induk Serial Number disetujui). (5) perbaikan L3 (buang draf menghapus foto `failed` tersimpan) ditunda ke tugas terpisah karena butuh perubahan server (5.11 butir 2).
