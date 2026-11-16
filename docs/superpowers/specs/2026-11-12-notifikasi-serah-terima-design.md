# Notifikasi Serah Terima: Desain

| | |
|---|---|
| **Tanggal** | 2026-11-12 |
| **Status** | Disetujui pemilik produk (2026-11-12; konfirmasi ulang 2026-11-13). Seluruh butir §11 sudah dijawab pemilik pada 2026-11-13 |
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
- **Logout tidak menghentikan push** [Pemilik, 2026-11-12]: perangkat tetap menerima push untuk pengguna yang sudah logout, selaras dengan keputusan bahwa antrean sinkron tetap berjalan setelah logout. Karena satu langganan push melekat pada peramban (bukan pada akun), satu langganan boleh terhubung ke lebih dari satu pengguna bila beberapa akun login di perangkat yang sama; masing-masing menerima notifikasi miliknya [Pilihan perancang]. Data yang tampil di layar kunci mengikuti §6 (ditampilkan penuh, keputusan pemilik 2026-11-13); pemilik menilai data Serah Terima tidak begitu sensitif, termasuk di perangkat yang dipakai bergantian.
- Pengguna yang izinnya dicabut atau akunnya dinonaktifkan berhenti menerima push segera: akun aktif dan izin lokasi diperiksa **saat push dikirim**, bukan hanya saat notifikasi dibuat (A3) [Pilihan perancang].

### 5.3 Desktop
Electron tidak memakai Web Push (tanpa service worker, izin peramban ditolak `lockDownSession`, tanpa FCM). **Keputusan pemilik 2026-11-16**: aplikasi desktop menerima notifikasi lewat **aliran SSE dari server** (`GET /api/v1/notifications/stream`, Bearer desktop saja) yang dikelola proses utama dan ditampilkan sebagai notifikasi Windows, **selalu aktif** (tanpa saklar; UI push web tersembunyi di desktop) dan aplikasi **tetap berjalan di tray** saat jendela ditutup selama masuk. Rinciannya di "Keputusan notifikasi desktop" pada bagian keputusan di bawah.

## 6. Isi dan privasi [Pilihan perancang]

- **Data ditampilkan penuh di push dan lonceng** [Pemilik, 2026-11-13, menggantikan usulan semula yang menyembunyikan isi di push]: jenis kejadian, nomor task (`ST-…`), nama customer, dan **cuplikan isi**: isi catatan untuk task baru dan task diubah, teks komentar untuk komentar. Tujuannya agar pengguna menangkap task lebih cepat tanpa membuka aplikasi. Alasan pemilik: data Serah Terima tidak begitu sensitif. Cuplikan dibentuk SAAT notifikasi dibuat dan disimpan; lonceng dan push menampilkan nilai tersimpan yang sama. Diratakan menjadi satu baris: penanda daftar/centang dibuang, escape Markdown dan entitas HTML yang dihasilkan editor didekode (mis. `RB\_5009` menjadi `RB_5009`, `&amp;` menjadi `&`), karakter kontrol, pemisah baris Unicode, dan pengatur arah teks dibuang, baris digabung dengan " · ". Dipotong 140 karakter (`NOTIFICATION_PREVIEW_MAX`); ringkasan centang dan "N task baru" (`createdBatch`) tanpa cuplikan karena yang diringkas banyak butir/task.
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
- **Tahap klien push dikerjakan 2026-11-13** (rencana `docs/superpowers/plans/2026-11-13-push-klien.md`, setelah Fase 1 PWA tersedia di `dev`): handler push di service worker, izin peramban, banner, saklar, dan halaman status admin. Rincian keputusan perancangnya di "Keputusan klien push" di bawah.
- Titik singgung dengan sesi lain: `shared/api.ts`, `shared/contract.ts`, nomor migrasi, dan header `web/src/app` (lonceng). Nomor migrasi dipesan dan perubahan sering di-rebase ke `dev`.
- PRD PWA dan `CLAUDE.md` perlu diperbarui bila desain ini disetujui: PRD menyatakan push dan notifikasi di luar cakupan.

## 10. Diserahkan ke builder

Skema tabel notifikasi dan langganan push; pustaka Web Push dan kunci VAPID (penyimpanan rahasia mengikuti aturan `.env`/`compose`); umur penyimpanan notifikasi dan jadwal pembersihan; cara lonceng memperbarui diri (polling saat fokus dan berkala, atau koneksi langsung); teks dan tata letak notifikasi, banner, dan halaman status push admin; batas frekuensi banner pengingat; izin admin untuk melihat status push (usulan: izin modul `access`, memakai izin yang sudah ada). Halaman status hanya memuat status per **pengguna** (aktif, tidak ada langganan, izin ditolak, pengiriman gagal), tanpa pengenal perangkat atau rincian galat [Pilihan perancang].

## 11. Konfirmasi pemilik

Semua butir sudah dijawab (2026-11-13):
1. ~~Penggabungan `saveBatch` menjadi satu ringkasan (§4.3).~~ **Disetujui pemilik 2026-11-13.**
2. ~~Isi push tanpa cuplikan catatan/komentar (§6).~~ **Diubah pemilik 2026-11-13**: data ditampilkan penuh, termasuk cuplikan isi di push (§6).
3. ~~Lonceng tidak dapat dimatikan, dan hanya push yang dapat dimatikan pengguna (§5.1, §5.2).~~ **Disetujui pemilik 2026-11-13.**
4. ~~Push setelah logout~~ **Diputuskan pemilik 2026-11-12**: perangkat tetap menerima push setelah logout (§5.2). ~~Satu langganan boleh terhubung ke lebih dari satu pengguna di perangkat yang sama.~~ **Disetujui pemilik 2026-11-13.**

### Keputusan setelah implementasi
- **Nomor migrasi** (2026-11-13): migrasi notifikasi adalah `0013_notifikasi.sql` dan `0014_push_notifikasi.sql`. Semula `0011` dan `0012`, direnomori sebelum PR dibuka karena `dev` sudah memakai `0011_postel_stiker_per_catatan.sql` dan `0012_serial_number.sql`. Belum pernah diterapkan di environment mana pun, jadi renomor aman.
- **Param `loc` pada tautan notifikasi** (diputuskan pemilik produk 2026-11-13, menjawab temuan review akhir): mengklik notifikasi dari lonceng membuka halaman Serah Terima dengan param `?loc=<id lokasi task>`, sehingga task di lokasi yang sedang tidak aktif di pemilih header tetap terbuka. Papan (kanban/kartu) membatasi muatannya ke lokasi itu selama param ada, tanpa penanda filter di tampilan; pemilih lokasi header tidak berubah. Ini sengaja dan bukan cacat. Penanda filter lokasi di papan dapat ditambahkan nanti bila diinginkan.
- **Judul notifikasi `createdBatch`** memuat nama lokasi ("N task baru di <lokasi>"; nama disimpan di kolom `customer_name`), mengikuti §4.3.
- **Allowlist host layanan push** (diputuskan pemilik produk 2026-11-13, menjawab temuan F3 review akhir; menambah perilaku di luar §5.2): endpoint langganan hanya diterima bila hostnya layanan push yang dikenal: `fcm.googleapis.com` dan `android.googleapis.com` (Chrome, Edge, Opera, Brave, Samsung), `*.push.services.mozilla.com` (Firefox), `*.notify.windows.com` (WNS), `*.push.apple.com` (Safari/iOS). Pencocokan pada batas label (nama yang hanya memuat domain itu sebagai awalan atau bagian tengah ditolak). Ditegakkan dua kali: saat `push.subscribe` (422 `VALIDATION`, "Layanan push endpoint ini tidak didukung") dan saat kirim (baris tersimpan yang tak lolos tidak pernah dihubungi; hasil gagal biasa `endpoint ditolak`). Daftar ada di kode (`PUSH_ALLOWED_HOSTS`, `server/src/modules/notification/push-endpoint.ts`), tanpa variabel `.env`. Konsekuensi: peramban yang memakai layanan push lain tidak dapat berlangganan sampai daftar diperbarui di kode. Validasi bentuk (https, port 443, tanpa kredensial, bukan IP/nama lokal), `redirect: 'manual'`, dan batas waktu tetap berlaku.
- **Pemangkasan langganan gagal-terus** (diputuskan pemilik produk 2026-11-13; menambah perilaku di luar §5.2): sebuah langganan dihapus bila `fail_count` >= 10 DAN sukses terakhirnya (atau waktu dibuat, bila belum pernah sukses) lebih dari 7 hari lalu. Syarat waktu mencegah gangguan sesaat layanan push menghapus langganan sehat. Pemangkasan hanya dinilai bila kegagalan yang sedang terjadi berasal dari layanan push (respons HTTP non-2xx) atau dari endpoint tersimpan yang tak lagi lolos kebijakan (`endpoint ditolak`); galat sisi server (`jaringan`, `timeout`, `internal`: egress mati, kunci VAPID rusak) tidak memicunya, meski tetap menaikkan `fail_count` untuk status admin. Pemangkasan hanya menghapus baris milik penerima yang gagal (bukan baris pengguna lain pada endpoint yang sama) dan terjadi saat pengiriman gagal. Akibatnya status admin pengguna itu berpindah dari "pengiriman gagal" ke "tidak ada langganan" (sinyal yang tepat untuk banner pengingat berlangganan ulang di tahap setelah PWA Fase 1). Konstanta `PUSH_PRUNE_FAIL_COUNT` dan `PUSH_PRUNE_AFTER_MS` di `push.ts`.

### Keputusan klien push (tahap klien, 2026-11-13; pilihan perancang, sesuai §5.2 dan §10)
- **Service worker**: handler `push` dan `notificationclick` ada di `web/public/push-sw.js`, diimpor Workbox lewat `workbox.importScripts` (titik perluasan PWA; bukan `injectManifest`) dan tidak dipra-cache. Push dengan muatan kosong atau rusak tetap menampilkan notifikasi generik ("QC App"), karena peramban mewajibkan setiap push terlihat. Tautan klik hanya path same-origin (ditolak: `//`, skema, garis miring terbalik, spasi atau karakter kontrol; jatuh ke `/`). Klik memfokuskan window aplikasi yang terbuka lalu menavigasinya, atau membuka window baru.
- **Dialog pra-izin**: dialog bawaan peramban tidak dapat dipaksa dan hanya muncul atas gestur pengguna, jadi izin diminta lewat tombol "Aktifkan" pada dialog aplikasi (hanya PWA terpasang dan izin belum ditentukan). "Nanti" atau menutup dialog = tidak ditanya lagi di perangkat itu untuk akun itu (penanda per email); pengguna tetap dapat menyalakannya dari menu profil "Notifikasi push". Satu perangkat dengan beberapa akun: tiap akun ditanya sekali.
- **Izin sudah diberikan**: perangkat ditautkan ke akun yang masuk secara diam-diam, sekali per sesi tab (langganan peramban yang sama dikirim ke akun itu; akun kedua di perangkat yang sama ikut tertaut, selaras §5.2). Bila kunci VAPID server berubah, langganan lama dilepas dan dibuat ulang.
- **Izin ditolak**: tidak pernah diminta ulang. Banner pengingat tampil paling sering sekali per 7 hari per pengguna (`BANNER_INTERVAL_MS`), dicatat saat ditampilkan, dengan langkah menyalakan kembali menurut platform (iOS, Android, desktop). Izin peramban dilaporkan ke server tiap berubah (`push.reportPermission`) dan dicek ulang saat jendela fokus.
- **Preferensi**: `push.config` membawa `userEnabled` (bawaan aktif) agar klien menampilkan saklar tanpa rute baru. Preferensi dimatikan = tidak ada dialog, banner, atau penautan otomatis. Lonceng tidak terpengaruh.
- **Halaman admin** `/access/push` ("Status Push", izin `access: view`): tabel nama, email, dan lima status (Aktif, Belum berlangganan, Pengiriman gagal, Dimatikan pengguna, Izin ditolak), bermasalah dulu, dengan ringkasan jumlah dan pencarian; tanpa pengenal perangkat atau rincian galat (§10).
- **iOS**: di Safari biasa (belum dipasang) pengaturan hanya menjelaskan cara memasang ke layar utama; izin tidak diminta.
- **Belum teruji di perangkat nyata**: uji ujung ke ujung butuh `VAPID_*` terisi di staging (E2E N18).
- **Laporan izin ke server** (hasil review klien, 2026-11-13): server menyimpan SATU nilai izin per pengguna, jadi klien melaporkannya hanya dari PWA terpasang dan tidak pernah melaporkan `default` (atau `denied` dari tab peramban biasa): tanpa ini tab desktop pengguna yang sama dapat menimpa `denied` dari ponselnya, atau sebaliknya, dan status admin keliru. Penyimpanan izin per langganan/perangkat sengaja tidak dilakukan (mengubah perilaku server dan pemetaan status admin); status admin tetap dihitung dari langganan dan hasil pengiriman nyata (§5.2).
- **Banner izin ditolak bersifat per perangkat**: tampil di perangkat/peramban yang izinnya `denied` walau pengguna menerima push di perangkat lain; itu disengaja (langkah menyalakan kembali berbeda per perangkat) dan dibatasi 7 hari.
- **Penautan dicoba ulang** saat jendela kembali TERLIHAT/fokus bila gagal dalam sesi tab yang sama, paling banyak 3 kali gagal per pemasangan (mis. host layanan push ditolak server); satu alur penautan pada satu waktu per akun (dialog pengaturan dan onboarding berbagi alur; akun berbeda tidak berbagi). Laporan izin dari dialog pengaturan mengikuti aturan yang sama dengan onboarding (hanya PWA terpasang, tanpa `default`). Dialog pengaturan menyegarkan statusnya saat penautan selesai dan, bila push dimatikan, hanya menampilkan alasannya. Status "Aktif di perangkat ini" di pengaturan menuntut langganan peramban DAN penautan ke akun ini pada sesi ini.
- **Keterbatasan diketahui**: bila kunci VAPID server diganti, klien hanya melepas baris milik akun yang sedang masuk; akun lain di perangkat yang sama tampil "Pengiriman gagal" sampai membuka aplikasi lagi (tertaut ulang otomatis) atau dipangkas (`PUSH_PRUNE_*`). Penanda onboarding di localStorage memuat email per akun yang pernah masuk di perangkat itu (selaras "penanda per email"; email sudah ada pula di cache query yang dipersist).
- **Pengiriman push seketika** (diminta pemilik produk 2026-11-13: tunda sampai 30 dtk dinilai terlalu lama; menambah mekanisme di luar rancangan semula, perilaku tetap dalam §5.2 dan §8 "dalam hitungan detik"): setelah `batch()` penulis notifikasi di-commit, `handover/service.ts` memanggil `wakeNotifications()` dan putaran latar langsung berjalan; detak jaring pengaman diturunkan dari 30 menjadi 10 dtk (ringkasan centang yang jatuh tempo terlepas paling lama 10 dtk setelah 5 menit). Penggabungan centang 5 menit tidak berubah. Sisa tunda tinggal waktu pengiriman layanan push (FCM, Mozilla, Apple, WNS), biasanya satu sampai beberapa detik.

### Keputusan notifikasi desktop (2026-11-16; keputusan pemilik: mekanisme SSE, tetap di tray, selalu aktif)
- **Mekanisme**: Web Push tidak dapat dipakai di Electron, dan koneksi langsung dari proses utama ke server dipilih ketimbang polling. Server menyediakan `GET /api/v1/notifications/stream` (SSE) di sub-aplikasi sendiri yang dipasang sebelum kernel REST (`server/src/modules/notification/stream-routes.ts`): sengaja **di luar `API_ROUTES` dan OpenAPI** karena responsnya berumur panjang, satu-satunya rute `/api/v1` dengan sifat itu. Aturan kernel tetap diikuti: sesi diperiksa sebelum apa pun, galat problem+json, `no-store`. Hanya token **Bearer desktop** yang diterima (cookie web ditolak 401).
- **Sumber kebenaran tetap tabel `notifications`**: aliran hanya mendorong baris baru milik penerima. Pemicunya putaran notifikasi yang sama dengan push (`notificationTick` memanggil `pumpNotificationStreams` setelah `flushDueCheckSummaries` dan `deliverPendingPushes`; `wakeNotifications()` membuatnya seketika, detak jaring pengaman 10 dtk). Hak lokasi diperiksa saat kirim (`hasReadAccess`), akun dan izin dimuat ulang tiap 5 menit, koneksi ditutup saat token kedaluwarsa atau akun nonaktif. Isi bingkai = `pushPayloadOf` (judul, isi, `url`, `tag`), jadi isi dan privasi sama dengan push (§6; data tampil penuh, keputusan pemilik 2026-11-13).
- **Sambung ulang**: id bingkai `<createdAt ISO>|<id>`; klien yang tersambung ulang mengirim `Last-Event-ID` dan menerima tunggakan yang belum basi (maks. 50 butir, umur maks. 10 menit = `PUSH_MAX_AGE_MS`); koneksi baru tanpa `Last-Event-ID` hanya menerima notifikasi sejak terbuka (riwayat ada di lonceng). Jendela kueri mundur 30 dtk dari penanda terakhir untuk baris yang di-commit terlambat, tetapi tidak pernah melewati titik awal koneksi; id yang sudah terkirim diingat (300 terakhir) agar tidak ganda.
- **Batas**: maks. 3 koneksi per pengguna (yang tertua ditutup), 500 total (503 problem+json `UNAVAILABLE` di atasnya); detak jantung (komentar SSE) tiap 5 dtk karena idle timeout Bun 10 dtk; `x-accel-buffering: no` dan `no-transform` agar nginx dan Cloudflare tidak menahan aliran. Satu proses server: koneksi disimpan di memori (tanpa antrean antar-proses); `stop()` menutup semua aliran lebih dulu.
- **Klien desktop** (`desktop/src/main/notify/`): `notification-stream.ts` (Bearer dari penyimpan token di proses utama, token tak pernah ke renderer; jeda sambung ulang 2-60 dtk berlipat, pengawas idle 20 dtk; 401 = token dibersihkan hanya bila masih token yang dipakai, lalu status login diumumkan), `sse.ts` (pengurai murni), `notice.ts` (validasi: judul/isi dipotong, karakter kontrol dibuang, tautan hanya jalur dalam aplikasi), `notifier.ts` (dedupe per id; klik = tampilkan jendela lalu buka jalur lewat `reloadGate`, jadi ditunda bila inject Country Lock berjalan), `background.ts` (lem Electron: `Notification` dan `Tray`). Mulai saat masuk (peluncuran dengan token tersimpan, atau login selesai) dan berhenti saat keluar atau 401.
- **Tray**: selama masuk, menutup jendela hanya menyembunyikannya (balon sekali "QC App tetap berjalan"); menu tray "Buka QC App" dan "Keluar" (keluar sungguhan); keluar dari akun, `app.quit()`, atau mematikan Windows menutup jendela seperti biasa. Aplikasi belum dijalankan otomatis saat Windows menyala (di luar cakupan; tanpa itu notifikasi hanya datang selama aplikasi berjalan).
- **Tanpa saklar** (pilihan pemilik "selalu aktif"): butir menu "Notifikasi push" dan seluruh UI push web (pra-izin, banner, panduan perangkat) tersembunyi di desktop lewat `pushSupported()` yang mengembalikan false bila `isDesktop()`. Preferensi `userEnabled` server tidak berlaku bagi desktop.
- **Belum teruji di perangkat nyata**: uji ujung ke ujung (notifikasi Windows muncul, klik membuka task, tray, sambung ulang) menunggu build desktop terhadap staging.
