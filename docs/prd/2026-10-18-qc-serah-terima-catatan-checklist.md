# PRD — TASK-001: Serah Terima QC–WH Berbasis Catatan

> **DIGANTIKAN** oleh docs/superpowers/specs/2026-10-23-serah-terima-catatan-wysiwyg-design.md (dialog detail dan aturan "WH/pemantau tidak boleh berkomentar" tidak berlaku; kanban/kartu dipakai).

| | |
|---|---|
| Tanggal | 2026-10-18 |
| Sumber permintaan | TASK-001, “Fitur Serah Terima QC-WH” |
| Jenis dokumen | Spesifikasi implementasi; keputusan usulan dibedakan dari permintaan pengguna |
| PRD sebelumnya | [Data Item & Serah Terima](2026-10-09-qc-item-serah-terima.md), terutama FH1–FH9, FQ1–FQ6, FAU1–FAU2 |

## 1. Masalah dan tujuan

Workflow WH saat ini cukup menyalin permintaan ke catatan. Memilih satu per satu item katalog menambah pekerjaan yang tidak dibutuhkan. QC membutuhkan checklist dan komentar pada kalimat tertentu, sementara catatan dapat berisi instruksi biasa. Daftar harus memperlihatkan isi pekerjaan tanpa membuka setiap task.

Tujuan: WH membuat task dari hasil paste tanpa memilih item; QC membaca instruksi, mencentang pekerjaan, dan memberi komentar pada kutipan; seluruh informasi task tersedia pada kartu dan dialog detail.

### Bukti dari proyek

- `web/src/modules/handover/components/handover-form.tsx` memakai `Textarea` untuk catatan dan `ItemLinesField` untuk item × qty.
- `shared/handover.ts`, `server/src/modules/handover/validate.ts`, dan `web/src/modules/handover/schemas.ts` membatasi catatan 500 karakter dan mewajibkan minimal satu baris item.
- `shared/contract.ts` memisahkan summary daftar dari detail berisi baris; `web/src/routes/_app/handover/index.tsx` menampilkan `HandoversTable` dan menavigasi ke halaman detail.
- `web/src/modules/markdown/markdown-editor.tsx` sudah memiliki editor Tulis/Pratinjau; `markdown-view.tsx` merender Markdown dengan pembatasan HTML dan URL.
- `server/src/modules/handover/service.ts` sudah memiliki lock, audit, dan pemeriksaan `expectedUpdatedAt` pada perubahan isi. Kode saat ini mengizinkan koreksi progres task selesai; bagian lama rencana Fase C yang melarangnya tidak dipakai sebagai acuan perilaku baru.

## 2. Pengguna dan izin

| Pengguna | Tindakan |
|---|---|
| WH, `handover: edit` pada lokasi task | Membuat/mengubah isi, customer opsional, dan struktur checklist/paragraf |
| WH, `handover: manage` | Hak WH serta membatalkan task yang belum selesai |
| QC, `qc: edit` pada lokasi task | Membaca, mengubah centang, dan menambahkan komentar pada kutipan |
| Pemantau, `handover: view` | Membaca isi, progres, dan komentar |

Izin lokasi, lokasi aktif header, nomor otomatis, customer opsional, dan audit mengikuti fondasi yang ada. Hak WH tidak otomatis memberikan hak progres/komentar QC. Menambah role baru tidak diperlukan.

## 3. Cakupan

- Task baru berbasis catatan campuran paragraf dan checklist tanpa relasi wajib ke katalog item.
- Konversi paste menjadi checklist, koreksi jenis baris, dan pratinjau langsung.
- Centang/batal centang tersimpan, pelaku/waktu, dan status turunan.
- Seleksi kalimat/kutipan, aksi “Komentari”, dan komentar tersimpan dengan konteks kutipan.
- Kartu berisi informasi lengkap dan dialog detail yang mempertahankan konteks daftar.
- Kompatibilitas task lama, batas akses lokasi, audit, dan penanganan perubahan bersamaan.

Di luar cakupan: drag-and-drop kanban, status manual baru, analisis AI untuk menebak item, parsing jumlah unit dari teks, katalog baru, chat/notifikasi, reply/resolve/edit/hapus komentar, kolaborasi mengetik bersamaan, serta konversi massal task lama. Upload gambar baru khusus catatan tidak ditambahkan pada iterasi ini; editor Item dan izin berkasnya tetap memakai alur yang sudah ada.

## 4. Keputusan dan asumsi

### Sudah dinyatakan pengguna

| ID | Keputusan |
|---|---|
| U1 | Pengisian task tidak perlu menambahkan item satu per satu. |
| U2 | Hasil paste otomatis menjadi checklist; isi juga dapat berupa catatan biasa. |
| U3 | Pratinjau editor berubah langsung saat mengetik. Pengguna menyebut pengalaman seperti Tiptap, bukan kewajiban menggunakan paket Tiptap. |
| U4 | QC dapat berkomentar pada teks terpilih dan mencentang pekerjaan. |
| U5 | Kartu/kanban menampilkan informasi langsung; klik membuka dialog detail keseluruhan. |

### Usulan default untuk implementasi

| ID | Usulan, alasan, dan konsekuensi |
|---|---|
| D1 | Pilih grid kartu dengan badge status. Lebih sederhana daripada kolom kanban dan tidak memerlukan aturan perpindahan status; tetap memenuhi pilihan “Card atau kanban”. |
| D2 | Gunakan editor Markdown dengan area tulis dan pratinjau yang tampil bersamaan. Di layar sempit keduanya ditumpuk. Ini memenuhi pratinjau realtime, tetapi bukan penyuntingan langsung pada teks terformat. WYSIWYG penuh menjadi perubahan rancangan bila memang dibutuhkan. |
| D3 | Paste pada blok kosong atau paste beberapa baris menghasilkan checklist per baris tidak kosong. Paste satu baris di tengah teks mengikuti jenis blok aktif. Tombol “Jadikan catatan” dan “Jadikan checklist” berlaku pada satu atau beberapa blok. Tidak menebak makna kalimat; pengguna dapat mengoreksi hasil tanpa mencari item. |
| D4 | Gunakan blok dengan ID stabil dan Markdown sebagai isi; bukan offset seluruh dokumen. Komentar menyimpan kutipan dan posisi dalam teks tampak satu blok. |
| D5 | Simpan dokumen, keadaan checklist, dan komentar di satu JSON berversi pada baris task. Ini mengurangi penulisan lintas sheet; konsekuensinya semua mutasi dokumen berbagi revisi dan batas sel. |
| D6 | Task lama tetap memakai item/qty dan riwayat aslinya. Task baru memakai mode catatan. Tidak ada konversi otomatis yang dapat menghilangkan progres kuantitas. |
| D7 | Task berisi paragraf saja boleh disimpan, berstatus Baru, menampilkan “Tanpa checklist”. Belum ada aksi selesai manual untuk kasus ini. |
| D8 | Komentar hanya ditambahkan oleh QC; WH/pemantau dapat membacanya. Komentar tidak mengubah status pengerjaan. |

Asumsi: teks paste adalah permintaan manusia, bukan format impor terstruktur; customer dan lokasi tetap berguna seperti alur lama; realtime berarti pratinjau lokal saat mengetik, bukan sinkronisasi antaruser atau autosave. Dokumen ini tidak menganggap D1–D8 sebagai keputusan yang sudah disetujui pengguna.

### Pilihan teknis penting

| Persoalan | Pilihan | Rekomendasi dan konsekuensi |
|---|---|---|
| Editor | Perluas renderer/editor yang ada; atau tambahkan editor WYSIWYG | Pilih komponen yang ada untuk kebutuhan pratinjau. WYSIWYG memerlukan kontrak impor/ekspor dan seleksi editor yang berbeda; putuskan sebelum mengganti pendekatan. |
| Isi kanonis | Satu string Markdown beserta offset; atau daftar blok ber-ID | Pilih blok: mengurutkan/menyisipkan baris tidak memindahkan komentar ke baris lain. Memerlukan serializer dan renderer khusus handover. |
| Penyimpanan | JSON per task; atau sheet terpisah untuk blok/komentar | Pilih JSON untuk iterasi sederhana. Jika volume nyata melampaui batas, desain sheet terpisah melalui pekerjaan lanjutan, bukan menghapus komentar lama. |
| Data lama | Konversi semua qty menjadi centang; atau dua mode eksplisit | Pilih dua mode. Kuantitas parsial dan over-target tidak dapat diwakili centang tanpa kehilangan makna. |

## 5. Alur utama

### 5.1 WH membuat task

1. Dari daftar, pilih Tambah task; pilih lokasi yang boleh ditulis dan customer bila ada.
2. Paste permintaan ke editor. Paste multiline tanpa penanda menghasilkan checklist per baris; paste satu baris pada blok kosong juga menjadi checklist, sedangkan paste satu baris di tengah teks mengikuti jenis blok aktif. CRLF/LF dinormalisasi, baris kosong memisahkan kelompok tanpa menjadi checklist kosong.
3. Bullet/nomor daftar dibuang sebagai penanda, isinya tetap. Penanda Markdown `- [ ]`/`- [x]` dikenali tanpa checkbox bertumpuk; task baru menyimpan semua pekerjaan belum dicentang karena progres milik QC.
4. Instruksi biasa diubah menjadi paragraf. Jenis blok dapat dibalik tanpa kehilangan teks. Enter dalam checklist membuat checklist berikutnya; Enter pada checklist kosong mengubahnya menjadi paragraf.
5. Pratinjau langsung menunjukkan paragraf, format Markdown, dan checkbox. Perubahan masih lokal sampai Simpan.
6. Simpan membuat nomor task dan mengembalikan task dengan revisi server; kartu langsung tersedia. Tidak ada item/qty yang wajib dipilih.

Paste memakai teks clipboard, tidak memasukkan HTML mentah. Paste di tengah blok mempertahankan teks sebelum/sesudah seleksi; blok pertama mempertahankan ID dan blok tambahan mendapat ID baru. Penggantian teks membuat anchor komentar pada blok terdampak menjadi usang sesuai bagian 5.3. Undo mengembalikan isi, urutan, dan jenis blok hasil satu aksi paste. UI tidak memotong paste yang melampaui batas.

### 5.2 QC mengerjakan task

1. QC melihat kartu sesuai lokasi aktif, status, dan pencarian URL.
2. QC mencentang/batal centang langsung pada kartu atau dialog. Tombol/checkbox/link/seleksi teks tidak memicu pembukaan dialog kartu.
3. Server memeriksa lokasi, izin QC, revisi, dan status Dibatalkan sebelum menulis.
4. Progres ditampilkan sebagai “n/m checklist”, bukan unit. Paragraf tidak dihitung. Nol checklist = Baru; sebagian = Dikerjakan; semua dengan total > 0 = Selesai; batal selalu Dibatalkan.
5. Batal centang pada task Selesai membukanya kembali. Penambahan checklist oleh WH juga dapat membukanya kembali. Mengubah jenis blok yang sudah dicentang atau menghapusnya ditolak; QC perlu membatalkan centangnya terlebih dahulu.

WH boleh menyunting teks blok yang sudah dicentang, tetapi perubahan teks harus mengembalikan blok menjadi belum dicentang agar pekerjaan yang berubah diverifikasi lagi; audit merekam reset ini. Mengurutkan ulang blok atau mengubah customer tidak mereset progres. Simpan isi tidak boleh mengatur centang, pembuat komentar, atau timestamp dari klien.

### 5.3 QC mengomentari kutipan

1. Seleksi teks tampak di dalam satu blok catatan/checklist pada kartu atau dialog menampilkan aksi “Komentari”. Seleksi kosong tidak menampilkan aksi; seleksi lintas blok menampilkan petunjuk untuk memilih teks dalam satu baris.
2. Saat aksi dipilih, kutipan disalin ke draft sehingga seleksi tidak hilang ketika composer mendapat fokus. QC menulis komentar dan menyimpan. Body komentar wajib berisi teks selain spasi; rentang kutipan wajib tidak kosong dan berada dalam batas teks blok.
3. Komentar menampilkan kutipan, isi teks biasa, nama pelaku, dan waktu. Kutipan ditandai pada blok bila anchor masih valid; memilih komentar memfokuskan kutipannya.
4. Anchor terikat ke `blockId`, versi teks, serta rentang UTF-16 `[start, end)` pada teks tampak kanonis. Teks kanonis menggabungkan text node Markdown, mengubah pemisah baris menjadi LF, dan tidak menyertakan kontrol, penanda Markdown, atau URL tujuan tautan. Algoritme harus sama pada validasi dan tampilan.
5. Rentang harus menghasilkan `quote` yang sama pada versi yang dikirim. Kutipan berulang dibedakan oleh rentang dan ID blok; tidak dicari lalu dipindahkan secara heuristik.
6. Perubahan centang, urutan blok, customer, atau komentar lain mempertahankan anchor. Setiap perubahan isi Markdown blok menaikkan versi teks dan membuat komentar lama pada blok tersebut bertanda “Teks telah berubah”. Penghapusan blok mempertahankan komentar beserta kutipannya sebagai “Teks telah dihapus”. Tidak ada perpindahan anchor diam-diam.

### 5.4 Kartu dan dialog

Kartu memuat nomor, lokasi, customer atau “Tanpa customer”, status, seluruh isi catatan/checklist, progres, seluruh komentar dengan kutipan, serta informasi pembuat/perubahan. Tidak ada line-clamp atau “buka untuk membaca sisa catatan”. Tanggal/pelaku centang dapat dilihat bersama entri checklist. Task lama menampilkan seluruh baris item/qty dan catatan.

Klik area kartu yang bukan kontrol membuka dialog. Sediakan tombol “Buka detail” untuk akses keyboard, tanpa tombol bersarang. Dialog memakai data/revisi yang sama, menampilkan semua informasi serta aksi sesuai izin. Tutup/Escape mengembalikan fokus ke pemicu dan mempertahankan filter serta posisi daftar. Tautan detail task lama tetap dapat dibuka langsung; rute detail menampilkan komponen detail yang sama dengan penanganan kedua mode.

## 6. Alur kegagalan

| Keadaan | Perilaku |
|---|---|
| Dokumen kosong atau melebihi batas | Galat field; draft tetap tersedia; tidak menyimpan sebagian isi. |
| Simpan/centang/komentar memakai revisi lama | `CONFLICT`; tampilkan data terbaru dan pertahankan draft teks/komentar untuk diterapkan ulang secara sadar. |
| Respons jaringan hilang | Jangan menyatakan berhasil atau otomatis mengirim ulang komentar; muat ulang keadaan server untuk memastikan hasil. |
| Akses lokasi hilang atau ID milik task lain | Penolakan mengikuti pola `FORBIDDEN`/`NOT_FOUND` proyek; isi lokasi lain tidak dikirim. |
| Task dibatalkan | Semua isi/progres/komentar baru ditolak; detail dan riwayat masih terbaca. |
| Kutipan sudah berubah saat komentar dikirim | Tolak dengan `CONFLICT`; draft komentar tetap ada dan pengguna memilih kutipan lagi. |
| JSON tersimpan rusak/versi tidak didukung | Tampilkan galat yang jelas untuk task tersebut; jangan fallback menjadi dokumen kosong yang dapat ditimpa. Kartu lain tetap dapat dibaca. |
| Mutasi checklist gagal | Centang tetap pada hasil server atau di-rollback; ada pesan galat dan kontrol dapat dicoba lagi. |

## 7. Kontrak antarkomponen — usulan untuk dikunci pada B1

### Data

- `contentMode: 'legacy' | 'note'`; mode kosong pada data tersimpan berarti legacy. Mode sebuah task tidak berubah lewat form.
- `NoteDocumentV1`: `version: 1`, `revision` bilangan bulat server, `blocks`, `comments`.
- `NoteBlock`: `id`, `kind: 'paragraph' | 'check'`, `markdown`, `textVersion`, `checked`, `progressAt`, `progressBy`. Metadata progres mencatat perubahan centang terakhir, termasuk batal centang/reset. Paragraf tidak memiliki progres aktif. ID unik dalam task dan bertahan saat reorder; versi teks dikelola server.
- `NoteComment`: `id`, `blockId`, `textVersion`, `start`, `end`, `quote`, `body`, `createdAt`, `createdBy`. Pelaku/waktu berasal dari server. Komentar lama tidak hilang ketika blok dihapus.
- Tambahkan `content_mode` dan `document_json` pada `HANDOVERS_TABLE`; `note`/`handover_lines` tetap menyimpan data legacy. Dokumen JSON adalah sumber kebenaran task note; jangan menyinkronkan salinan Markdown kanonis kedua ke `note`.
- Gunakan field progres checklist yang terpisah dari `doneUnits`/`totalUnits` legacy; tipe DTO dibedakan oleh mode sehingga UI tidak menampilkan centang sebagai unit.

### API dan query

| Kontrak | Input/hasil dan aturan |
|---|---|
| `handovers.board` baru | `locationIds`, `status`, `cursor?`, `limit?` (2026-10-26): satu kolom kanban per panggilan, **berhalaman** (bawaan 20 dan maks. 50 task per halaman; semula 3); hasil kartu note dengan semua isi, komentar, metadata, dan revisi, plus `nextCursor` dan `total`. Satu pengambilan per halaman, bukan satu API detail per kartu. Keputusan pemilik 2026-10-26 (CPU ≤ 8 ms per rute di platform sebelumnya; kartu tetap penuh, ukuran halaman dikecilkan; lihat spek migrasi §7.4) **digantikan 2026-11-05 (disetujui pemilik produk): batas 3 hanyalah anggaran CPU platform sebelumnya yang tidak ada lagi di VPS; bawaan 20 dan maks. 50 seperti Apps Script (spek migrasi VPS §19 butir 2)**. |
| `handovers.get` diperluas | Input lama; output dibedakan mode, memuat isi lengkap task yang boleh dibaca. |
| `handovers.saveNote` baru | ID opsional, lokasi, customer, blok `id/kind/markdown`, `expectedRevision` wajib pada update. Create menghasilkan ID blok bila belum ada; klien tidak mengirim progres/komentar sebagai sumber kebenaran. |
| `handovers.setNoteChecked` baru | Task/lokasi, block ID, boolean `checked` absolut, `expectedRevision`; izin `qc: edit`. Nilai sama pada revisi saat ini tidak membuat audit/progres palsu. |
| `handovers.addNoteComment` baru | Task/lokasi, anchor, body, `expectedRevision`; izin `qc: edit`; mengembalikan task dengan revisi baru. |
| `handovers.cancel` lama | Mendukung kedua mode; hanya `handover: manage`, tidak membatalkan task Selesai sesuai perilaku saat ini. |

API progres kuantitas dan `handovers.save` lama menolak task note; API note menolak legacy. `completeAll` lama tidak dipakai untuk mode note. Rute baca memakai `anyOf` WH-view/QC-edit, seluruh rute tetap `scope: 'location'`; ID task harus cocok dengan lokasi yang diperiksa. Mutasi note dilakukan dalam satu lock, membaca ulang dokumen, memvalidasi revisi, menghitung status, dan menulis task serta audit melalui pola proyek. Lock bukan transaksi lintas sheet; jangan menjanjikan rollback atomik audit yang tidak disediakan platform.

Tambahkan query key koleksi board dan invalidasi daftar/detail/audit setelah mutasi. Bentuk list lama tetap dapat dipertahankan untuk kompatibilitas; pencarian board mencakup nomor, customer, dan seluruh teks blok. Perubahan lokasi aktif tidak boleh menampilkan cache dari lokasi sebelumnya.

## 8. Acceptance criteria

| ID | Skenario yang dapat diuji |
|---|---|
| AC1 | WH membuat task dengan lokasi dan teks, customer kosong, tanpa item/qty; task tersimpan dan tampil pada board. Teks hanya spasi ditolak. |
| AC2 | Paste `Router A 2 pcs\nSwitch B 1 pcs\nKirim sore` menghasilkan tiga checklist berurutan; mengubah baris ketiga menjadi paragraf mempertahankan teks dan total menjadi dua. CRLF, baris kosong, bullet, dan Markdown checkbox tidak membuat duplikat/entri kosong. |
| AC3 | Paste di tengah teks mempertahankan bagian sebelum/sesudah; undo mengembalikan keadaan sebelumnya. Mengetik/mengubah blok memperbarui pratinjau tanpa mengganti tab atau mengirim API. |
| AC4 | QC mencentang dua checklist secara bertahap: Baru → Dikerjakan → Selesai. Reload mempertahankan centang/pelaku/waktu. Batal centang membuka lagi; paragraf tidak dihitung. |
| AC5 | WH tanpa `qc: edit` dan pemantau ditolak oleh server saat memanggil mutasi centang/komentar; QC tanpa WH-edit tidak dapat menyimpan isi. Akses task lokasi lain ditolak tanpa membocorkan isi. |
| AC6 | Seleksi kutipan tunggal, termasuk format Markdown, emoji, dan kutipan berulang, menampilkan Komentari dan menyimpan komentar pada rentang yang benar. Seleksi kosong/lintas blok ditangani sesuai spesifikasi. |
| AC7 | Reorder/centang tidak memindahkan komentar. Edit isi menandainya berubah; penghapusan blok mempertahankan komentar sebagai teks dihapus. Kutipan usang tidak dapat dikomentari seolah masih valid. |
| AC8 | Kartu menampilkan seluruh informasi yang disebut bagian 5.4, termasuk catatan panjang dan komentar. Klik kartu membuka dialog; centang, tautan, seleksi, dan composer tidak membuka dialog tanpa sengaja. |
| AC9 | Dialog dapat digunakan dengan keyboard, fokus kembali ketika ditutup, dan filter/lokasi/posisi daftar tidak hilang. Halaman detail langsung mendukung kedua mode. |
| AC10 | Dua klien pada revisi sama tidak saling menimpa isi/progres/komentar. Mutasi kedua ditolak, draft dipertahankan, refresh memperlihatkan hasil pertama. |
| AC11 | Task legacy tetap menampilkan snapshot item, qty parsial/over-target, status, catatan, dan audit aslinya. Setup berulang tidak menggandakan/mengonversi data; endpoint lama tidak menulis task note. |
| AC12 | Dibatalkan tidak menerima perubahan isi, centang, atau komentar. Perubahan teks checklist yang dicentang mereset centang dengan audit; penghapusan/konversi checklist dicentang ditolak. |
| AC13 | HTML/script/URL berbahaya dari paste, Markdown, dan komentar tidak dijalankan. Payload melebihi batas ditolak utuh di server dan UI tanpa kehilangan draft. |
| AC14 | Board mengambil isi tiap kolom lewat API `handovers.board` berhalaman (20 task per halaman bawaan, maks. 50; semula 3 sampai 2026-11-05; halaman berikutnya dimuat otomatis saat kolom digulir, infinite scroll) tanpa N panggilan `get`; catatan, centang, dan komentar kartu dirender saat kartu mendekati layar (lazy render); error/kosong/lokasi tak dipilih punya tampilan jelas. JSON rusak satu task tidak menimpa data atau menghilangkan kartu lain. (Diubah 2026-10-26, disetujui pemilik, dari "satu API board untuk seluruh koleksi".) |
| AC15 | Create/update/reset/check/uncheck/comment/cancel menghasilkan audit dengan pelaku dan perubahan yang terbaca; no-op centang tidak menambah audit. `bun run check` dan `bun run build` lulus. |

## 9. Kebutuhan nonfungsional dan dependensi

- Ikuti keamanan render FA6 dan format teks Sheets; penulisan mengikuti aturan server di `CLAUDE.md` (CAS atau kunci baris, nilai selalu di-bind).
- Usulan batas teknis memakai pola proyek: jumlah karakter sumber Markdown seluruh blok ditambah body komentar maksimum 20.000 (`shared/files.ts`/FA7); JSON terserialisasi maksimum 40.000 karakter (FI7). Keduanya diverifikasi di server. Ini adaptasi batas proyek untuk dokumen baru, bukan kebutuhan bisnis yang telah disetujui. Kutipan/metadata tetap ikut batas JSON.
- Ponsel 375×812 dan tema terang/gelap mengikuti NFR proyek. Catatan panjang membungkus tanpa memotong isi; checkbox dan aksi komentar berlabel dan dapat diakses keyboard. Tanpa seleksi sentuh yang andal, sediakan aksi per blok untuk memilih rentang kutipan melalui input teks.
- Tidak menetapkan SLA/angka latensi baru. Ukuran artefak produksi tetap mengikuti `verify-dist` proyek; dependensi baru memerlukan bukti bahwa batas build masih dipenuhi.
- Dependensi: fondasi lokasi/izin/audit, komponen Markdown, shadcn Dialog/Card, TanStack Query/Form/Router, memory backend dan fixture handover.
- Data produksi tidak diubah dalam pekerjaan spesifikasi ini. DevOps menyiapkan urutan setup/back-up/rollback aplikasi sebelum rilis; perubahan data aktual tetap melalui alur persetujuan database workspace.

## 10. Pertanyaan terbuka dan kesiapan Build

Pertanyaan produk yang belum dijawab: apakah yang dibutuhkan WYSIWYG langsung atau pratinjau berdampingan; apakah paragraf tanpa checklist memerlukan selesai manual; apakah WH kelak boleh ikut berkomentar. Contoh paste nyata akan membantu mengevaluasi D3; perilaku default sudah dinyatakan agar implementasi tidak menebak semantik teks.

Kesiapan Build dinilai terhadap: kontrak B1 terdokumentasi dan dapat diuji, pemilik area tulis jelas, fixture legacy tersedia, serta baseline check/build dicatat oleh pelaksana. D1–D8 adalah usulan default yang bisa dikerjakan tanpa klaim persetujuan; perubahan ke WYSIWYG atau status manual harus memperbarui kontrak/spec terlebih dahulu. Menandai pekerjaan selesai membutuhkan bukti AC1–AC15 dan hasil review, bukan hanya tersedianya dokumen ini.

Sesi penyusunan ini hanya memiliki alat filesystem/shell: tool pencarian semantik, kanban/dispatcher, diagnostik LSP, dan E2E Sokudo tidak tersedia. `RTK.md` yang dirujuk instruksi tidak ditemukan pada root proyek atau direktori induk yang diperiksa. Tidak ada worker yang telah dijalankan, tiket kanban yang dibuat, test aplikasi yang dijalankan, ataupun kode aplikasi yang diubah.
