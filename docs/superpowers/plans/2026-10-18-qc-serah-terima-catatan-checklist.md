# TASK-001 — Paket Implementasi Catatan, Checklist, dan Kartu

> **DIGANTIKAN** oleh docs/superpowers/specs/2026-10-23-serah-terima-catatan-wysiwyg-design.md (dialog detail dan aturan "WH/pemantau tidak boleh berkomentar" tidak berlaku; kanban/kartu dipakai).

**Goal:** Melaksanakan [PRD TASK-001](../../prd/2026-10-18-qc-serah-terima-catatan-checklist.md) tanpa mewajibkan item katalog pada task baru dan tanpa menghilangkan data task lama.

**Architecture:** Mode legacy dan note eksplisit; dokumen JSON blok ber-ID, checklist, komentar beranchor dan revisi; RPC koleksi board; editor Markdown dengan pratinjau langsung; grid kartu serta dialog bersama. Semua rancangan D1–D8 pada PRD masih berupa usulan default.

**Tech stack:** Gunakan stack proyek. Tidak ada pemasangan pustaka editor baru dalam rancangan awal.

Dokumen ini merupakan **rancangan penugasan**, bukan board atau laporan progres. B1–B7 di bawah adalah label brief lokal, bukan ID tiket Sokudo. Buat tiket sebenarnya di backlog dengan isi brief lengkap, `priority`, dan dependensi ketika tool kanban tersedia; lalu dispatch hanya ID tiket tersebut. Semua tiket milik repository `D:\Project\qc`; sesuaikan `target` dengan nama persis repository yang diberikan workspace bila ada beberapa repository.

## Handoff kepada Senior Dev

- Permintaan pengguna pada 2026-10-18: serahkan TASK-001 kepada agent Senior Dev. Owner implementasi utama B1–B4 ditetapkan **Senior Dev (Developer)**; QA, Reviewer, dan DevOps tetap sesuai perannya.
- Status handoff: brief siap diteruskan; agent belum dijalankan karena tool kanban/dispatcher tidak tersedia pada sesi ini. B1–B7 tetap label brief, bukan tiket yang telah dibuat.
- Brief penerima: baca AGENTS.md, RTK.md bila tersedia, PRD tertaut, dan seluruh kontrak area tulis di bawah. Catat baseline `bun run check` serta `bun run build`; mulai dari B1, lanjut B2/B3 setelah kontrak B1 dikunci, lalu integrasi B4. Implementasi mencakup kode aplikasi dan test yang relevan.
- Gunakan D1–D8 sebagai usulan default yang telah didokumentasikan. Permintaan handoff ini menyetujui penerima pekerjaan, bukan mengubah usulan tersebut menjadi keputusan produk yang telah disetujui. Catat keputusan teknis final dan eskalasi perubahan kebutuhan yang belum ditentukan oleh PRD.
- Saat dispatcher tersedia, buat tiket dengan brief lengkap dari bagian terkait, priority dan dependensi, lalu panggil `start_workers` dengan ID tiket sebenarnya serta intent implementasi atau investigasi yang sesuai. Persona ditentukan dispatcher; periksa assignment sebelum mengklaim agent Senior Dev telah menerima pekerjaan.
- Hasil yang harus dikembalikan: diff implementasi, keputusan kontrak, pemetaan AC1–AC15 ke bukti verifikasi, hasil check/build aktual, dan gap yang belum selesai. Ikuti batas tool E2E dan gate Approve pengguna pada bagian B5/B6.

## Urutan dan kontrak kepemilikan

| Paket | Owner | Dependensi | Prioritas yang diusulkan |
|---|---|---|---|
| B1 Kontrak dan fungsi murni | Senior Dev (Developer) | PRD | highest, membuka pekerjaan berikutnya |
| B2 Penyimpanan, RPC, dan audit | Senior Dev (Developer) | B1 | high |
| B3 Editor dan preview | Senior Dev (Developer); konsultasi Designer/Design Systems | B1 | high |
| B4 Kartu dan dialog | Senior Dev (Developer) | B2, B3 | high |
| B5 Strategi serta verifikasi | QA; Test Worker untuk kelompok uji terarah | Strategi dari PRD; eksekusi B2–B4 | high |
| B6 Review keseluruhan | Reviewer | B2–B5 | high |
| B7 Kesiapan operasi | DevOps | Rancangan B2 untuk persiapan; B6 untuk gate rilis | low |

B2 dan B3 dapat berjalan paralel setelah B1. B2 memiliki `gas/`, pendaftaran RPC pada `shared/rpc.ts`, query hooks handover, label/diff audit, dan fixture backend. B3 hanya memiliki komponen/editor helper handover baru dan pengujian komponen tersebut; perubahan editor Markdown umum, bila perlu, sebatas prop opt-in yang tidak mengubah default Item. B4 memiliki komponen kartu/dialog/detail, skema/form handover, rute, filter, dan mock seed. B4 tidak berjalan serentak dengan B2/B3 pada area yang sama.

B1 memiliki tipe baru dan helper murni pada `shared/`, tetapi belum memasukkan method RPC baru ke `RpcContract` yang akan membuat `RouteTable` gagal typecheck sebelum backend tersedia. B2 menambahkan entri kontrak bersama implementasi/registrasi routenya. Developer B3 menerima DTO B1 melalui props/callback, bukan mengimpor hook yang belum tersedia. Perubahan kontrak setelah B1 harus diteruskan ke semua paket yang bergantung; bukan diputuskan diam-diam per komponen.

Tidak ada penugasan Problem Solver saat ini. Jika investigasi anchor atau bundle diperlukan, buat tiket **diagnosis saja** dengan deliverable laporan/opsi/bukti; implementasinya menjadi tiket terpisah. Quick Worker dapat memperbarui dokumentasi mekanis setelah kontrak final. Task Worker hanya untuk implementasi kecil terisolasi bila provider gratis tersedia; tidak memindahkan implementasi utama dari Developer.

## B1 — Define Note Document Contracts And Pure Helpers

### Goal

Mengunci bentuk blok, komentar, revisi, status, dan paste sehingga frontend/backend memakai aturan yang sama.

### Context

- Sumber: PRD bagian 4–7, AC2–AC4, AC6–AC7, AC10–AC13.
- Owner: Senior Dev (Developer). Dependensi: tidak ada implementasi lain.
- Area tulis: `shared/handover.ts`, `shared/handover.test.ts`, file baru `shared/handover-note.ts` dan test, tipe DTO baru di `shared/rpc.ts`.
- Pertahankan kontrak dan fungsi legacy. Jangan mendaftarkan RPC tanpa handler pada paket ini.

### Steps

1. Definisikan discriminated DTO legacy/note, dokumen V1, blok, komentar, anchor, dan bentuk hasil per kartu termasuk kasus dokumen tidak dapat dibaca.
2. Definisikan normalisasi teks tampak Markdown yang identik untuk validasi anchor dan renderer. Tentukan perilaku break/Unicode/link/code dan bukti mapping rentangnya; jangan memakai offset source Markdown sebagai offset teks tampak.
3. Definisikan helper paste, serializer, validasi ID/jenis/versi/ukuran, dan status/progres checklist. Normalisasi tidak boleh menghapus isi clipboard atau mengganti ID blok yang tidak berubah.
4. Tetapkan field milik server: revisi, progres, pelaku/waktu, komentar. Dokumentasikan aturan reset centang dan anchor usang.
5. Tambahkan test untuk contoh PRD, rentang berulang/emoji, dan status zero/partial/full/cancelled. Jalankan test shared dan typecheck yang relevan.

### Acceptance criteria

- DTO cukup untuk implementasi B2/B3 tanpa definisi paralel; keputusan kontrak dicatat pada PRD.
- AC2–AC4/AC6–AC7 bagian murni memiliki bukti test termasuk batas valid/invalid.
- Legacy tetap lolos test; tidak ada kode GAS/DOM pada shared dan tidak menambah identifier global bertabrakan.
- Verifikasi: `bun run --cwd shared test`, `bun run typecheck`. Catat hasil sebenarnya.

## B2 — Implement Note Persistence RPC And Audit

### Goal

Menyimpan dokumen note dan mutasinya dengan izin, revisi, audit, serta pembacaan koleksi kartu.

### Context

- Owner: Senior Dev (Developer). Dependensi: B1.
- Area: `gas/src/modules/handover/{repo,validate,service,routes}.ts`, `gas/src/setup.ts`, `gas/src/routes.ts` bila diperlukan, `gas/test-support/handover-{env,fixtures}.ts`, test handover; `shared/rpc.ts` untuk entri RPC; `web/src/modules/handover/queries.ts`; label/diff audit pada `web/src/modules/access/`.
- Kontrak: PRD bagian 7. B2 adalah satu-satunya penulis kontrak RPC selama implementasi backend.

### Steps

1. Tambahkan kolom mode/dokumen secara aditif melalui skema dan setup proyek. Mode kosong dibaca legacy. Setup idempoten; tidak menulis ulang task lama atau data produksi melalui shell.
2. Implementasikan board koleksi dengan izin lokasi dan penanganan dokumen rusak per task; jangan membuat N pembacaan RPC detail. Perluas get/cancel untuk mode note; endpoint kuantitas/save lama menolak note.
3. Implementasikan saveNote/setNoteChecked/addNoteComment: baca ulang di dalam lock, periksa lokasi aktual, revisi dan status, validasi semua input sebelum tulis, pertahankan progres/komentar server, lalu audit memakai pola proyek.
4. Pastikan note update memerlukan revisi; perubahan teks mereset centang, penghapusan/konversi blok dicentang ditolak, anchor tidak diam-diam pindah. Komentar pada teks usang ditolak.
5. Tambahkan DTO RPC, route registration, query options/mutations dan invalidasi board/detail/audit. Label audit berbahasa Indonesia dan snapshot terbaca tanpa membocorkan isi lokasi lain.
6. Tambahkan test backend, fixture dua klien, izin WH/QC/pemantau/lokasi lain, boundary JSON dan data legacy. Jangan mengubah kode B3/B4.

### Acceptance criteria

- AC1, AC4–AC7, AC10–AC15 untuk lapisan server dibuktikan melalui test.
- No-op, data mode salah, revisi usang, JSON rusak, payload berbahaya, dan status batal ditangani sesuai PRD.
- `bun run --cwd gas test`, typecheck, dan build GAS lulus; shared regression tetap hijau.
- Laporan menyertakan test dan batasan lock/audit; jangan menyebut lock sebagai transaksi lintas sheet.

## B3 — Implement Paste Checklist Editor And Live Preview

### Goal

WH dapat menyusun catatan campuran dengan paste, koreksi jenis blok, dan pratinjau langsung.

### Context

- Owner: Senior Dev (Developer); konsultasi Designer dan Design Systems bila diperlukan.
- Dependensi: B1. Tidak menunggu RPC karena komponen menerima value/onChange/onSubmit melalui props.
- Area: komponen/helper baru di `web/src/modules/handover/components/` dan `lib/`, test terkait; `web/src/modules/markdown/` hanya untuk ekstensi opt-in yang dibutuhkan.
- Kontrak: blok dan helper B1. Jangan menulis form/rute/query B4/B2 atau mengubah default editor Item.

### Steps

1. Bangun editor campuran per blok dengan kontrol jenis satu/beberapa blok, ID stabil, Enter dan paste/undo sesuai PRD.
2. Tampilkan area tulis dan pratinjau bersamaan memakai keamanan render proyek. Sediakan label, error, keadaan disabled, dan penanda perubahan belum disimpan.
3. Bedakan tampilan checkbox preview saat WH mengedit dari checkbox progres QC; editor tidak memberi WH jalan mengirim progres.
4. Siapkan renderer blok yang mengekspos mapping teks tampak B1 untuk seleksi kutipan tanpa memasukkan tombol/checkbox ke rentang teks.
5. Uji paste di posisi kursor/seleksi, CRLF, nomor/bullet/checkbox, baris kosong, paragraf biasa, emoji, batas ukuran, dan preservasi konten saat undo. Uji layar sempit serta regresi editor Item bila komponen umum berubah.

### Acceptance criteria

- AC2, AC3, AC6 bagian mapping, serta AC13 render berlaku.
- Tidak ada RPC per ketikan; tidak ada item/qty wajib di komponen baru.
- Input dan pratinjau dapat dipakai dengan keyboard dan tidak memotong konten berlebih.
- Verifikasi: Vitest hanya file komponen/helper yang terkait, typecheck web; serahkan daftar test yang dijalankan ke QA agar tidak diulang tanpa alasan.

## B4 — Implement Full Cards Detail Dialog And Quote Comments

### Goal

Integrasikan pembuatan task note, kartu lengkap, dialog, centang QC, dan komentar kutipan dengan backend.

### Context

- Owner: Senior Dev (Developer). Dependensi: B2 dan B3.
- Area: `web/src/modules/handover/{schemas,components,lib}/`, rute `web/src/routes/_app/handover/`, mock seed `web/src/lib/rpc/mock-backend.ts` bila perlu.
- Pakai hooks B2 dan renderer/editor B3. Perubahan kontrak harus dikoordinasikan dengan pemilik B2, bukan dibuat sendiri.

### Steps

1. Form task baru memakai note, customer opsional dan LocationField; hapus kewajiban item hanya pada alur baru. Legacy dikenali eksplisit dan tetap mempertahankan qty/progres.
2. Ganti tabel utama dengan kartu berisi seluruh konten dan metadata. Pakai board RPC dan pencarian teks blok; pertahankan status/lokasi/query URL yang ada.
3. Buat dialog detail serta komponen bersama untuk deep link. Pastikan click/select/checkbox/link/composer tidak saling memicu, keyboard focus dan scroll daftar terjaga.
4. Tambahkan seleksi kutipan, action Komentari, draft composer, highlight anchor valid, dan label anchor usang/dihapus. Simpan kutipan sebelum fokus pindah. Sediakan alternatif pemilihan rentang yang dapat dipakai keyboard/sentuh.
5. Terapkan izin per lokasi pada kontrol, keadaan pending/error/conflict, preservasi draft, dan pemuatan ulang ketika respons mutasi hilang. Tidak mengirim ulang komentar otomatis.
6. Isi mock memakai layanan GAS in-memory dan fixture kedua mode; jangan memasukkan mock ke produksi. Tambahkan test integrasi komponen yang menguji perilaku, bukan menyalin implementasi.

### Acceptance criteria

- AC1–AC14 untuk interaksi frontend terbukti pada test terarah dan diverifikasi QA.
- Seluruh isi dapat dibaca pada kartu; dialog tidak diperlukan hanya untuk membaca sisa catatan.
- Jumlah unit legacy dan checklist note tidak tertukar; task note tidak membuka form item lama.
- Verifikasi: test web terkait, `bun run check`, `bun run build`, serta diagnostik LSP untuk file source yang diubah bila tool tersedia.

## B5 — Verify Acceptance Criteria And Legacy Regression

### Goal

Memberikan bukti penerimaan yang bisa ditinjau, termasuk kegagalan dan keterbatasan yang belum diselesaikan.

### Context

- Owner: QA. Test Worker boleh menangani kelompok test yang ditentukan QA sebagai tiket terpisah bila dijalankan paralel.
- Dependensi: strategi dapat dibuat dari PRD; pelaksanaan final setelah B2–B4.
- Area tulis: catatan verifikasi pada `docs/e2e-checklist.md`; kelompok test/flow hanya sesuai kepemilikan yang disepakati. QA tidak mengubah implementasi fitur diam-diam.

### Steps

1. Petakan AC1–AC15 ke bukti unit/backend/component/E2E, hasil aktual, dan gap. Gunakan hasil B1–B4 yang masih relevan; ulangi hanya bila ada perubahan/kegagalan/keraguan konkret.
2. Bagi matriks menjadi paste/editor; centang/status/konflik; seleksi/anchor/XSS; board/dialog/keyboard; legacy/izin/setup. Uji WH, QC, pemantau, dan lokasi lain.
3. Untuk E2E, panggil `e2e_list_flows` dahulu. Inspeksi halaman melalui browser Sokudo bila tersedia; selector harus menunjuk kontrol yang dimaksud secara unik. Root flow YAML wajib header `url`, lalu `---`, lalu urutan langkah; header opsional hanya `name`, `tags`, `env`, `clearState`. Ambil nama langkah dari interpreter. Gunakan `launchApp`/`openLink`/`back` untuk navigasi dan `takeScreenshot` untuk artefak, bukan `snapshot` sebagai langkah YAML.
4. Validasi dengan `e2e_validate` sebelum menyimpan ke `D:\Project\qc\e2e\`, lalu `e2e_run`. Baca bundle kegagalan, perbaiki hanya flow gagal dan maksimal tiga heal per flow per percakapan. Tidak memasang/menggunakan framework browser lain.
5. Bila tool E2E Sokudo tidak tersedia, catat E2E sebagai belum terverifikasi dan berhenti pada bagian E2E tersebut; jangan menggantinya dengan framework lain atau mengklaim pass. Check/build dan component test tidak menggantikan bukti E2E.

### Acceptance criteria

- Matriks AC memuat hasil beserta test/run/artifact yang mendukung, bukan klaim umum “sudah dites”.
- `bun run check` dan `bun run build` final tercatat. Test duplicate hanya diulang jika integrasi/temuan menuntutnya.
- Gap E2E, keputusan produk yang berubah, dan bug terbuka dicatat sebagai input Reviewer, bukan ditutup tanpa bukti.

## B6 — Review Data Compatibility Permissions And Interaction

### Goal

Menilai perubahan akhir terhadap spesifikasi dan risiko yang relevan sebelum kartu implementasi diajukan untuk Approve.

### Context

- Owner: Reviewer. Dependensi: B2–B5.
- Area: diff implementasi dan matriks verifikasi; deliverable review dan temuan, tanpa menggabungkan branch.

### Steps

1. Periksa setiap AC terhadap bukti; fokus pada izin lokasi aktual, batas input, revisi wajib, reset centang, dan anchor teks tampak.
2. Periksa pembacaan legacy, setup idempoten, JSON rusak, kode GAS global, keamanan formula/Markdown, serta cache lokasi.
3. Nilai apakah UX memenuhi kartu lengkap, pratinjau langsung dan komentar seleksi; sebutkan bila WYSIWYG belum menjadi bagian implementasi.
4. Kirim temuan konkret ke tiket implementasi yang tepat; revisi kode tetap dilakukan pemilik area. Setelah perubahan bermakna, uji ulang yang terdampak.

### Acceptance criteria

- Ada verdict jelas beserta blocking finding atau alasan menerima, ditautkan ke AC dan bukti.
- Dependensi belum selesai/keputusan pengguna yang diperlukan disebut eksplisit.
- Branch worker tetap menunggu Approve atau Discard pengguna pada kartunya. Reviewer/PM tidak melakukan merge dan tidak menyebut pekerjaan Done sebelum merged.

## B7 — Prepare Setup Release And Rollback Instructions

### Goal

Menyiapkan langkah rilis yang dapat ditinjau tanpa menjalankan deployment atau migrasi data produksi dari brief ini.

### Context

- Owner: DevOps. Dependensi: kontrak B2 untuk persiapan, hasil B6 untuk rilis.
- Area: `docs/setup-google.md` dan/atau `docs/ci-cd.md`, mengikuti tempat prosedur proyek yang sudah ada.

### Steps

1. Dokumentasikan perubahan kolom aditif, kebutuhan setup, snapshot/backup Spreadsheet, dan cara memeriksa kedua mode setelah rilis.
2. Jelaskan rollback: aplikasi lama tidak memahami task note, sehingga sekadar menurunkan versi aplikasi sesudah task note dibuat bukan rollback yang aman. Pertahankan backup/data note dan gunakan perbaikan maju atau rencana rollback yang sudah diuji.
3. Catat urutan check → build → tinjau artefak → Approve branch worker → langkah rilis oleh pengguna/otorisasi rilis yang terpisah.
4. Perubahan data nyata memakai tool database workspace; statement tulis diajukan melalui kartu, bukan shell atau SQL runnable pada chat. Tidak ada akses data produksi yang diperlukan untuk menyusun instruksi ini.

### Acceptance criteria

- Pengguna mendapat prosedur setup/rollback yang sesuai data dua mode dan batas platform.
- Tidak ada deploy, push GAS, merge worker, atau migrasi produksi yang dijalankan hanya karena brief dokumentasi ini.
- Verifikasi menggunakan fixture/setup test hasil B2 dan artefak build final; tidak mengklaim verifikasi produksi.

## Kriteria kesiapan Build dan rilis

Kesiapan memulai implementasi: PRD tersedia, brief mandiri beserta owner/dependensi jelas, dan B1 mengunci kontrak teknis sebelum B2/B3 mulai menulis. Default produk usulan telah dibedakan dari keputusan pengguna; jika WYSIWYG dipilih, perbarui B1/B3 sebelum implementasi editor. Pelaksana membaca instruksi lokal termasuk `RTK.md` bila kemudian tersedia dan merekam baseline check/build.

Kesiapan hasil untuk review pengguna: seluruh dependensi implementasi telah selesai, QA menyampaikan bukti AC dan gap, Reviewer memberi verdict, serta prosedur operasi tersedia. Jika E2E belum bisa dijalankan, hasil belum boleh disebut terverifikasi end-to-end. Hasil worker disampaikan sebagai menunggu Approve/Discard; hanya Approve pengguna yang menggabungkan branch.

Pada sesi penyusunan dokumen ini tool kanban/dispatcher dan E2E tidak tersedia. Tidak ada tiket sebenarnya dibuat atau worker dijalankan. Ini adalah fallback penugasan yang dapat dieksekusi ketika kapabilitas tersebut tersedia, bukan implementasi fitur TASK-001.
