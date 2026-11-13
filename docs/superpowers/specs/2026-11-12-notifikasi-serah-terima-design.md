# Notifikasi Serah Terima: Desain

| | |
|---|---|
| **Tanggal** | 2026-11-12 |
| **Status** | Disetujui pemilik produk (2026-11-12; konfirmasi ulang 2026-11-13). Butir §11 yang belum dikonfirmasi tetap terbuka |
| **Cakupan** | Notifikasi untuk modul Serah Terima: kotak notifikasi (lonceng) di aplikasi dan push |
| **Di luar cakupan** | Email untuk Serah Terima; notifikasi untuk modul lain; saluran desktop native (proyek Desktop); semua pekerjaan PWA di luar push (lihat §9) |
| **Rujukan** | `docs/prd/2026-10-26-qc-pwa.md` (service worker, pemasangan), `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §13 (push ditunda, desktop memakai koneksi langsung) |

Penanda yang dipakai:
- **[Pemilik]** = diputuskan pemilik produk dalam percakapan 2026-11-12.
- **[Pilihan perancang]** = usulan perancang yang belum diucapkan pemilik; boleh diubah.

---

## 1. Latar dan tujuan

Di Serah Terima, sisi WH membuat task untuk dikerjakan sisi QC, dan sisi QC mencentang butir lalu menyelesaikannya. Hari ini tiap pihak harus membuka aplikasi untuk tahu ada perubahan. Tujuan: pihak yang berkepentingan diberi tahu **segera** saat sesuatu terjadi pada task, tanpa dibanjiri.

## 2. Tujuan, non-tujuan, anti-tujuan

**Tujuan**
- G1. Setiap kejadian pada task (§3) menghasilkan notifikasi untuk penerima yang benar [Pemilik].
- G2. Notifikasi aktif secara bawaan untuk semua pengguna sesuai perannya [Pemilik].
- G3. Notifikasi selain centang sampai secepatnya; centang boleh tertunda sampai 5 menit agar tidak spam [Pemilik].

**Non-tujuan**
- N1. Tidak ada email untuk Serah Terima [Pemilik]. Email peringatan sistem yang sudah ada (cadangan, kuota, stok, Postel) tidak berubah.
- N2. Tidak ada notifikasi untuk modul selain Serah Terima pada desain ini.
- N3. Saluran desktop native (Electron) tidak dibangun di sini, tetapi desain saluran harus memungkinkannya (§5).

**Anti-tujuan** (dianggap gagal walau secara teknis jalan)
- A1. Penerima kebanjiran: satu rangkaian centang atau satu tempelan 30 task menghasilkan puluhan notifikasi.
- A2. Dua notifikasi berantai untuk satu aksi (centang butir terakhir yang sekaligus menyelesaikan task).
- A3. Notifikasi bocor ke pengguna yang tidak berhak atas lokasi task, atau tetap sampai ke pengguna yang izinnya sudah dicabut.
- A4. Notifikasi palsu atau ganda: kejadian tanpa perubahan keadaan nyata (mis. centang ulang dari antrean offline dengan nilai yang sama), atau pengiriman ulang yang menggandakan.
- A5. Kejadian hilang: penulisan task sukses tetapi notifikasinya tidak pernah dibuat.

## 3. Kejadian dan penerima

Penerima dihitung dari izin berlokasi yang sudah ada, tanpa tabel pelanggan baru:
- **Sisi QC** = pengguna dengan izin `qc: edit` di lokasi task.
- **Sisi WH** = pengguna dengan izin `handover` (minimal `view`) di lokasi task.
- **Semua yang berhak membaca** = `anyOf` kedua izin di atas (sama dengan izin baca task dan komentar sekarang).

| Kejadian | Penerima | Waktu |
|---|---|---|
| Task baru dibuat | Sisi QC | Langsung [Pemilik] |
| Task diubah (§4.1) | Sisi QC | Langsung [Pemilik] |
| Task dibatalkan | Sisi QC | Langsung [Pemilik] |
| Task dibuka kembali | Sisi QC | Langsung [Pemilik] |
| Task selesai | Sisi WH | Langsung [Pemilik] |
| Butir dicentang | Sisi WH | Ringkasan, jendela 5 menit [Pemilik] |
| Komentar | Semua yang berhak membaca, kecuali penulisnya | Langsung [Pemilik] |

Aturan umum:
- **Pelaku tidak menerima notifikasi atas aksinya sendiri** [Pemilik: "kecuali yang menulis" untuk komentar; diperluas ke semua kejadian sebagai Pilihan perancang].
- Pengguna yang berada di dua sisi sekaligus menerima **satu** notifikasi per kejadian [Pilihan perancang].
- Kejadian hanya dibuat bila keadaan benar-benar berubah. Centang yang dikirim ulang dengan nilai yang sama (antrean offline mengirim ulang) tidak menghasilkan kejadian (A4).

## 4. Penggabungan dan definisi kejadian

### 4.1 "Task diubah"
Memicu bila **customer atau catatan** berubah [Pemilik: "detail task, bukan checklist atau status"; diterapkan sebagai berikut]. Karena butir checklist adalah baris `- [ ]` di dalam catatan, mengubah butir ikut terhitung sebagai perubahan catatan. Mencentang (`setCheck`) dan perubahan status punya kejadian sendiri. Simpan yang tidak mengubah customer maupun catatan (mis. hanya karena centang atau komentar orang lain) tidak menghasilkan apa pun. Pembandingan nilai sebelum dan sesudah dilakukan **di server**, bukan oleh klien.

### 4.2 Penggabungan centang
- Beberapa centang oleh orang yang sama pada task yang sama digabung menjadi satu ringkasan ("A memperbarui N butir di ST-…"). Melepas centang dihitung sama dengan mencentang [Pilihan perancang].
- Jendela **tetap 5 menit sejak centang pertama** dalam rangkaian, bukan menunggu pengguna berhenti, supaya ringkasan pasti terkirim paling lambat 5 menit [Pilihan perancang; angka 5 menit Pemilik].
- **Selesai mengalahkan centang** [Pemilik]: bila task selesai saat ringkasan tertahan, ringkasan itu dilebur ke notifikasi "Task selesai" yang dikirim langsung. Penerima tidak mendapat dua notifikasi berantai (A2).
- Bila task dibatalkan saat ringkasan tertahan, ringkasan tetap dikirim sesuai jadwal [Pilihan perancang].
- Penggabungan dilakukan di server, supaya semburan centang dari antrean offline pun tergabung. Penjadwal yang ada berjalan per jam, jadi pelepasan ringkasan membutuhkan detak pendek tambahan (mis. tiap menit) pada penjadwal [Pilihan perancang].
- **Kunci ringkasan = (task, pelaku)** [Pilihan perancang]: dua orang berbeda yang mencentang task yang sama dalam jendela yang sama masing-masing menghasilkan satu ringkasan.
- **Jumlah "N butir" = butir yang keadaan akhirnya berbeda dari keadaan awal jendela**, dicocokkan lewat teks kanonis butir (`handoverCanonicalText`), bukan indeks, sehingga suntingan catatan di tengah jendela tidak merusak hitungan; butir yang sudah hilang dari catatan dibuang. Bila hasil bersihnya nol (mis. dicentang lalu dilepas), **tidak ada notifikasi** (A4) [Pilihan perancang].
- Saat "Selesai" melebur ringkasan yang tertahan, notifikasi "Task selesai" hanya menyebut yang menyelesaikan; jumlah dari pelaku lain tidak dirinci [Pilihan perancang].
- Batas 5 menit adalah **target, bukan jaminan keras**: bila runner job sedang menjalankan job panjang (mis. cadangan basis data), pelepasan boleh terlambat beberapa menit [Pilihan perancang].

### 4.3 Task baru dari tempelan
`handovers.saveBatch` dapat membuat hingga 30 task dalam satu permintaan. Satu permintaan menghasilkan **satu** notifikasi ringkasan ("N task baru di <lokasi>") bukan N notifikasi [Pilihan perancang; belum dikonfirmasi pemilik].

### 4.4 Kejadian dihitung dari perubahan keadaan [Pilihan perancang]
Status task diturunkan dari centang (`deriveHandoverStatus`), bukan disimpan, dan satu penulisan dapat mengubahnya lewat beberapa jalan (centang terakhir, `setDone` pada task tanpa butir, atau suntingan catatan yang membuang butir terakhir yang belum dicentang). Karena itu kejadian dihitung di jalur tulis bersama dengan membandingkan keadaan **sebelum dan sesudah**, bukan dipetakan dari endpoint:
- **Task selesai** = status berubah menjadi Selesai, apa pun penyebabnya.
- **Task dibuka kembali** = hanya `handovers.reopen` (Dibatalkan menjadi aktif). Task Selesai yang kembali berjalan karena butir dilepas atau ditambah **tidak** menghasilkan kejadian sendiri; perubahannya tampil sebagai centang atau "diubah".
- Satu penulisan yang mengubah catatan sekaligus membuat task selesai menghasilkan "diubah" (ke sisi QC) dan "selesai" (ke sisi WH). Keduanya untuk penerima berbeda, jadi bukan notifikasi berantai (A2).

## 5. Saluran

Satu kejadian di server menghasilkan **satu catatan notifikasi per penerima**. Saluran pengiriman membaca catatan itu, jadi saluran baru dapat ditambahkan tanpa mengubah pembuat notifikasi.

### 5.1 Lonceng di aplikasi
- Selalu bekerja, tanpa izin apa pun dari peramban. Penolakan push tidak memengaruhinya.
- Menampilkan daftar notifikasi pengguna, penanda belum dibaca, jumlah pada ikon lonceng, "tandai semua dibaca", dan membuka task terkait saat diklik [Pilihan perancang].
- Aktif bawaan dan tidak dapat dimatikan [Pilihan perancang].
- **Hak akses diperiksa saat dibaca**, bukan hanya saat notifikasi dibuat [Pilihan perancang]: tiap catatan menyimpan lokasi task, dan daftar, penanda belum dibaca, serta jumlah pada lonceng hanya memuat catatan di lokasi yang masih berhak dibaca pengguna saat ini (izin `handover: view` atau `qc: edit` di lokasi itu). Dengan begitu pengguna yang kehilangan akses lokasi tidak melihat sisa notifikasinya, dan klik tidak berujung `NOT_FOUND` (A3).
- Penyimpanan notifikasi dibatasi umurnya dan dibersihkan berkala (angka di §10, diserahkan ke builder).

### 5.2 Push
- Web Push lewat service worker PWA [Pemilik: push dibutuhkan].
- **Aktif bawaan**: preferensi push menyala untuk semua pengguna [Pemilik]; pengguna boleh mematikannya sendiri [Pilihan perancang].
- **Izin peramban diminta satu kali, tepat setelah login pertama di perangkat itu** pada PWA yang sudah dipasang [Pemilik]. Peramban tidak mengizinkan push dipaksa menyala; dialog izin hanya muncul atas tindakan pengguna.
- **Bila pengguna menolak**: tidak dapat dipaksa dan tidak diminta berulang (permintaan berulang membuat peramban menyembunyikan dialog). Aplikasi menampilkan **banner pengingat** dengan langkah menyalakan kembali menurut perangkat, dibatasi frekuensinya, dan **admin dapat melihat status push per pengguna** [Pemilik].
- Status push per pengguna dihitung dari **hasil pengiriman nyata**, bukan hanya dari "pernah mengizinkan": langganan dapat dihapus peramban atau iOS secara diam-diam, dan server hanya mengetahuinya dari galat saat mengirim.
- iOS: push hanya untuk PWA yang dipasang di layar utama (batasan platform).
- **Logout tidak menghentikan push** [Pemilik, 2026-11-12]: perangkat tetap menerima push untuk pengguna yang sudah logout, selaras dengan keputusan bahwa antrean sinkron tetap berjalan setelah logout. Karena satu langganan push melekat pada peramban (bukan pada akun), satu langganan boleh terhubung ke lebih dari satu pengguna bila beberapa akun login di perangkat yang sama; masing-masing menerima notifikasi miliknya [Pilihan perancang]. Privasi layar kunci dijaga oleh aturan §6 (tanpa isi catatan atau komentar).
- Pengguna yang izinnya dicabut atau akunnya dinonaktifkan berhenti menerima push segera: akun aktif dan izin lokasi diperiksa **saat push dikirim**, bukan hanya saat notifikasi dibuat (A3) [Pilihan perancang].

### 5.3 Desktop (di luar cakupan, tetapi tidak boleh dihalangi)
Electron tidak memakai Web Push; spek Desktop §13 menyebut koneksi langsung ke server dengan notifikasi native. Desain catatan notifikasi dan saluran di atas harus memungkinkan saluran itu ditambahkan nanti.

## 6. Isi dan privasi [Pilihan perancang]

- Push dan lonceng menyebut jenis kejadian, nomor task (`ST-…`), dan nama customer. **Isi catatan dan teks komentar tidak ditampilkan di push** (layar kunci perangkat); lonceng boleh menampilkan cuplikan karena berada di dalam aplikasi yang sudah login. Pemilik belum mengonfirmasi ini.
- Teks berbahasa Indonesia.

## 7. Batasan dari kode yang ada

- Tanpa modul izin baru. Kotak notifikasi milik pengguna sendiri: hanya pemiliknya yang membaca dan menandai dibaca.
- Penerima dihitung dari izin berlokasi yang sama dengan modul Serah Terima (`handover`, `qc`; lokasi `ctx.locationIds`). Pencabutan akses otomatis menghentikan penerimaan.
- Kejadian dicatat dari titik-titik tulis `handover/service.ts` (`save`, `saveBatch`, `cancel`, `reopen`, `setCheck`, `setDone`, `comment`) dengan jaminan: penulisan sukses berarti notifikasinya tercatat, dan penulisan gagal berarti tidak ada notifikasi (A5).
- Mengikuti aturan server proyek (`CLAUDE.md`): migrasi expand-only dengan nomor berikutnya (terakhir `0010`; koordinasikan dengan sesi lain yang menambah migrasi), CAS untuk penulisan yang bergantung pada pembacaan, jalur REST lewat `API_ROUTES` dan `ApiContract`, tes memakai MariaDB sungguhan.
- Penggabungan 5 menit memakai runner job (`src/jobs/runner.ts`, satu job pada satu waktu) dan penjadwal (`src/jobs/`, kini per jam; butuh detak pendek tambahan, §4.2).

## 8. Kriteria sukses

- Task baru: seluruh sisi QC di lokasi itu menerima notifikasi dalam hitungan detik; pembuatnya tidak.
- Satu orang mencentang 10 butir dalam 3 menit: sisi WH menerima **satu** ringkasan paling lambat 5 menit sejak centang pertama.
- Orang yang sama mencentang butir terakhir sehingga task selesai: sisi WH menerima **satu** notifikasi "Task selesai", bukan dua.
- Komentar: semua yang berhak membaca di lokasi itu menerimanya kecuali penulisnya.
- Pengguna tanpa izin di lokasi task tidak pernah menerima notifikasi tentangnya; pengguna yang dinonaktifkan berhenti menerima.
- Pengguna menolak izin push: lonceng tetap menerima semuanya, banner pengingat tampil, dan admin melihat statusnya.
- Centang yang dikirim ulang dengan nilai sama (antrean offline) tidak menghasilkan notifikasi baru.

## 9. Urutan dan ketergantungan

- Bagian server, aturan penerima, penggabungan, dan lonceng **tidak bergantung** pada pekerjaan PWA maupun Desktop dan dapat dikerjakan paralel dengan keduanya.
- **Push bergantung pada Fase 1 PRD PWA** (`docs/prd/2026-10-26-qc-pwa.md`: manifest, aplikasi terpasang, service worker; belum dibangun, tidak ada service worker di `web/` saat ini). Bentuk rencana [Pilihan perancang]: rencana notifikasi membangun sekarang catatan notifikasi, aturan penerima, penggabungan, lonceng, dan **backend siap-push** (tabel langganan, pengirim, status pengiriman, halaman status admin). Handler push di service worker dan permintaan izin setelah login pertama dikerjakan sebagai tahap terpisah setelah Fase 1 PWA tersedia, sehingga bagian push tidak dapat diuji ujung ke ujung sebelum itu.
- Titik singgung dengan sesi lain: `shared/api.ts`, `shared/contract.ts`, nomor migrasi, dan header `web/src/app` (lonceng). Nomor migrasi dipesan dan perubahan sering di-rebase ke `dev`.
- PRD PWA dan `CLAUDE.md` perlu diperbarui bila desain ini disetujui: PRD menyatakan push dan notifikasi di luar cakupan.

## 10. Diserahkan ke builder

Skema tabel notifikasi dan langganan push; pustaka Web Push dan kunci VAPID (penyimpanan rahasia mengikuti aturan `.env`/`compose`); umur penyimpanan notifikasi dan jadwal pembersihan; cara lonceng memperbarui diri (polling saat fokus dan berkala, atau koneksi langsung); teks dan tata letak notifikasi, banner, dan halaman status push admin; batas frekuensi banner pengingat; izin admin untuk melihat status push (usulan: izin modul `access`, memakai izin yang sudah ada). Halaman status hanya memuat status per **pengguna** (aktif, tidak ada langganan, izin ditolak, pengiriman gagal), tanpa pengenal perangkat atau rincian galat [Pilihan perancang].

## 11. Belum dikonfirmasi pemilik

1. Penggabungan `saveBatch` menjadi satu ringkasan (§4.3).
2. Isi push tanpa cuplikan catatan/komentar (§6).
3. Lonceng tidak dapat dimatikan, dan hanya push yang dapat dimatikan pengguna (§5.1, §5.2).
4. ~~Push setelah logout~~ **Diputuskan pemilik 2026-11-12**: perangkat tetap menerima push setelah logout (§5.2). Sisa untuk dikonfirmasi: satu langganan boleh terhubung ke lebih dari satu pengguna di perangkat yang sama.

### Keputusan setelah implementasi
- **Param `loc` pada tautan notifikasi** (diputuskan pemilik produk 2026-11-13, menjawab temuan review akhir): mengklik notifikasi dari lonceng membuka halaman Serah Terima dengan param `?loc=<id lokasi task>`, sehingga task di lokasi yang sedang tidak aktif di pemilih header tetap terbuka. Papan (kanban/kartu) membatasi muatannya ke lokasi itu selama param ada, tanpa penanda filter di tampilan; pemilih lokasi header tidak berubah. Ini sengaja dan bukan cacat. Penanda filter lokasi di papan dapat ditambahkan nanti bila diinginkan.
- **Judul notifikasi `createdBatch`** memuat nama lokasi ("N task baru di <lokasi>"; nama disimpan di kolom `customer_name`), mengikuti §4.3.
- **Allowlist host layanan push** (diputuskan pemilik produk 2026-11-13, menjawab temuan F3 review akhir; menambah perilaku di luar §5.2): endpoint langganan hanya diterima bila hostnya layanan push yang dikenal: `fcm.googleapis.com` dan `android.googleapis.com` (Chrome, Edge, Opera, Brave, Samsung), `*.push.services.mozilla.com` (Firefox), `*.notify.windows.com` (WNS), `*.push.apple.com` (Safari/iOS). Pencocokan pada batas label (nama yang hanya memuat domain itu sebagai awalan atau bagian tengah ditolak). Ditegakkan dua kali: saat `push.subscribe` (422 `VALIDATION`, "Layanan push endpoint ini tidak didukung") dan saat kirim (baris tersimpan yang tak lolos tidak pernah dihubungi; hasil gagal biasa `endpoint ditolak`). Daftar ada di kode (`PUSH_ALLOWED_HOSTS`, `server/src/modules/notification/push-endpoint.ts`), tanpa variabel `.env`. Konsekuensi: peramban yang memakai layanan push lain tidak dapat berlangganan sampai daftar diperbarui di kode. Validasi bentuk (https, port 443, tanpa kredensial, bukan IP/nama lokal), `redirect: 'manual'`, dan batas waktu tetap berlaku.
- **Pemangkasan langganan gagal-terus** (diputuskan pemilik produk 2026-11-13; menambah perilaku di luar §5.2): sebuah langganan dihapus bila `fail_count` >= 10 DAN sukses terakhirnya (atau waktu dibuat, bila belum pernah sukses) lebih dari 7 hari lalu. Syarat waktu mencegah gangguan sesaat layanan push menghapus langganan sehat. Pemangkasan hanya menghapus baris milik penerima yang gagal (bukan baris pengguna lain pada endpoint yang sama) dan terjadi saat pengiriman gagal. Akibatnya status admin pengguna itu berpindah dari "pengiriman gagal" ke "tidak ada langganan" (sinyal yang tepat untuk banner pengingat berlangganan ulang di tahap setelah PWA Fase 1). Konstanta `PUSH_PRUNE_FAIL_COUNT` dan `PUSH_PRUNE_AFTER_MS` di `push.ts`.
