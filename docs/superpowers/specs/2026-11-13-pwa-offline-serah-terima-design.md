# PWA Fase 3: Serah Terima tetap bisa dipakai saat sinyal hilang

Tanggal: 2026-11-13. Status: **disetujui pemilik produk, 2026-11-13** (rencana implementasi dibuat per tahap; Tahap A diimplementasikan lebih dulu). PRD induk: `docs/prd/2026-10-26-qc-pwa.md` (Fase 1 dan 2 sudah ter-merge: PR #57 dan #68).

## 1. Maksud dan alasan

Tim QC bekerja di gudang yang sering kehilangan sinyal. Saat ini, begitu server tidak terjangkau: papan Serah Terima tidak bisa dibuka, komentar dan task baru gagal dengan galat (isi yang diketik hilang atau harus diketik ulang), dan hanya centang yang diantrekan (Fase 2). Pengguna juga tidak bisa membedakan "data ini sudah tersimpan di server" dari "data ini masih di ponsel saya".

Tujuan: QC dapat **membaca papan, mencentang, menulis komentar, dan membuat task baru** tanpa sinyal, dan **selalu tahu** mana yang belum tersimpan, mana yang sedang dikirim, dan mana yang gagal.

Keputusan pemilik produk (percakapan 2026-11-13, dicatat ulang di PRD saat disetujui):
- Centang langsung berubah di layar, dengan penanda bila belum terkirim.
- Komentar dan task baru ikut diantrekan saat offline, dengan penanda yang sama.
- Mengubah, membatalkan, menyelesaikan, dan membuka ulang task **dilewati dulu**.
- Pengiriman tertunda juga memakai **Background Sync** di service worker (Chrome/Edge), supaya terkirim walau aplikasi sudah ditutup; peramban lain tetap mengirim saat aplikasi terbuka.
- Membuka aplikasi dingin tanpa koneksi tetap menampilkan layar "Tidak ada koneksi". Itu **disengaja**: layar itu memaksa pengguna terhubung ke jaringan. Tidak ada mode luring dari sesi tersimpan.
- Keluar (logout) menampilkan peringatan bila masih ada yang belum terkirim. Menutup aplikasi (bukan keluar) tidak menghentikan Background Sync.
- Komentar dan task baru yang ditolak server dibuang dengan toast, seperti centang.
- Papan disimpan di perangkat (IndexedDB): hanya task di lokasi pengguna, terkunci per pemilik akun, **tanpa kedaluwarsa waktu**, dihapus **hanya saat keluar (logout)** atau saat akun lain login. Ini **menggantikan** butir PRD §11 "Board dan isi task tidak disimpan di perangkat" dan menjawab §12 butir 4.

## 2. Tujuan, bukan-tujuan, anti-tujuan

**Tujuan**
- G1. Penanda yang konsisten untuk semua tulisan yang diantrekan: Belum terkirim dan Mengirim; penolakan server diumumkan lewat toast.
- G2. Papan dan task yang terakhir dimuat dapat dibaca saat server tidak terjangkau sesudah sesi terverifikasi, dan tampil instan saat aplikasi dibuka dengan koneksi; ditandai "data terakhir hh:mm".
- G3. Komentar dan task baru yang ditulis offline terkirim otomatis saat server pulih, tanpa duplikat.
- G4. Di Chrome/Edge, antrean terkirim sendiri begitu sinyal kembali walau aplikasi ditutup atau layar terkunci (Background Sync); di peramban lain terkirim saat aplikasi dibuka.

**Bukan-tujuan**
- Mengubah/membatalkan/menyelesaikan/membuka ulang task offline.
- Mode luring: memulihkan sesi dari data tersimpan saat server tak terjangkau di boot dingin (ditolak pemilik produk; layar "Tidak ada koneksi" tetap).
- Mengandalkan Background Sync saja: peramban tanpa `SyncManager` (Safari/iOS, Firefox) tetap dilayani pengiriman saat aplikasi terbuka.
- Menyimpan Log Audit, daftar user, item, merk, QR, atau data modul lain untuk dibaca offline (kecuali yang sudah ada di whitelist `query-persist`).
- Sinkron antar perangkat, atau penyelesaian bentrok yang cerdas: penolakan server dilaporkan, bukan digabung.

**Anti-tujuan** (dianggap gagal walau secara teknis jalan)
- Data yang diketik pengguna hilang diam-diam.
- Task atau komentar ganda karena pengiriman ulang.
- Data pengguna lain terlihat di perangkat bersama setelah keluar atau ganti akun.

## 3. Pendekatan yang dipertimbangkan

Penyimpanan papan di perangkat:
- A. Perluas `query-persist` (localStorage): sederhana, tetapi batas 2 juta karakter dan penulisan sinkron; empat kolom dengan catatan sampai 5.000 karakter per task mudah melewatinya.
- **B. IndexedDB milik sendiri (dipilih):** kapasitas besar, tidak memblokir layar. Biaya: kode baru dan `fake-indexeddb` untuk tes.
- C. Cache respons API di service worker: ditolak, melanggar NFR-P3.

Pengiriman tertunda:
- Hanya saat aplikasi terbuka: ditolak sebagai satu-satunya jalur, karena centang yang dibuat sebelum sinyal hilang baru terkirim setelah QC membuka aplikasi lagi.
- **Dua jalur sekaligus (dipilih, keputusan pemilik 2026-11-13):** (1) pengiriman saat aplikasi terbuka sebagai dasar untuk semua peramban, pola yang sama dengan Fase 2; (2) Background Sync di service worker sebagai penambah di Chrome/Edge. Keduanya membaca **satu antrean di IndexedDB**. Konsekuensi: antrean centang Fase 2 ikut pindah dari `localStorage` ke IndexedDB, karena service worker tidak dapat membaca `localStorage`.

Cara memasukkan kode ke service worker:
- `injectManifest` (service worker kita tulis penuh dalam TypeScript): ditolak. Mengganti `generateSW` berarti menulis ulang konfigurasi Fase 1 yang sudah lolos review (pra-cache, denylist navigasi, mode `prompt`).
- **Skrip klasik `sync-sw.js` yang diimpor lewat `workbox.importScripts` (dipilih):** pola yang sama dengan `web/public/push-sw.js` yang sudah ada. Konfigurasi Fase 1 tidak berubah. Logika klasifikasi galat ada di dua tempat (halaman dan skrip ini), dijaga sama oleh tes kesetaraan (§7b).

Pencegah duplikat:
- **Kolom `client_id` unik di server (dipilih)**, bukan mengganti `id` bikinan server. Pola yang sama dengan `serials.client_id` (Serial Number 5a).

## 4. Pembagian tahap (empat PR berurutan, tiap tahap punya rencana implementasi sendiri)

| Tahap | Isi | Menyentuh server |
|---|---|---|
| A | Penanda status dan penghitung untuk centang (antrean centang masih `localStorage`) | Tidak |
| B | Papan dan detail task dapat dibaca offline | Tidak |
| C | Satu antrean IndexedDB untuk semua jenis (centang dipindah), komentar dan task baru diantrekan offline | Ya (migrasi + kontrak) |
| D | Background Sync (`sync-sw.js`) di Chrome/Edge | Tidak |

C bergantung pada B (komentar hanya bisa ditulis pada task yang bisa dibuka offline). D bergantung pada C (service worker hanya dapat membaca IndexedDB). A berdiri sendiri.

## 5. Tahap A: penanda status dan penghitung

Teks UI santai, bahasa Indonesia.

**Dua status yang terlihat** untuk setiap tulisan yang diantrekan:
- `waiting` "Belum terkirim": ada di antrean, tidak sedang dikirim.
- `sending` "Mengirim…": permintaannya sedang berjalan.

Penolakan server tidak punya status tampil: entrinya dibuang dengan toast (§7.4). Penanda internal `rejected` hanya jembatan sementara dari service worker ke halaman (§7b).

Sumber status `sending`: penguras antrean menandai entri sebelum permintaan dan membersihkannya sesudahnya. Pada tahap A (antrean masih `localStorage`) penandanya penyimpan kecil dalam memori per tab: hanya tab yang sedang mengirim (pemegang kunci `navigator.locks`) yang menampilkan `sending`, tab lain `waiting` (diterima untuk tahap ini). Mulai tahap C pengirim (halaman maupun service worker) menyiarkan `sending` lewat `BroadcastChannel` `qc-outbox` dengan masa berlaku 45 detik, sehingga semua tab ikut menampilkannya dan pengirim yang mati di tengah jalan tidak membuat penanda macet. Status `sending` tidak disimpan: setelah aplikasi dibuka ulang semua entri kembali `waiting`.

**Centang yang dikirim langsung saat online** (bukan dari antrean) juga menampilkan "Mengirim…" selama permintaan belum selesai. Layar berubah seketika (optimistis); penanda hilang saat server menjawab. Bila gagal `UNAVAILABLE`, penanda berganti "Belum terkirim" (masuk antrean).

**Penanda per butir** (detail task dan kartu papan), bentuknya:

```
☑ Cek kemasan   ⏳ Belum terkirim      →   ☑ Cek kemasan   ⟳ Mengirim…      →   ☑ Cek kemasan   Budi, 14:05
```

**Penghitung di header** (chip di samping lonceng, `role="status"`, hanya tampil bila ada entri):
- `⏳ 3 belum terkirim` → `⟳ Mengirim 2 dari 3…` → hilang.
- Menghitung seluruh jenis antrean. Mengetuknya membuka daftar singkat (popover): jenis, nomor/nama task, waktu. Hitungan mengabaikan entri yang sudah lewat 24 jam (akan dibuang pengurasan berikutnya).

**Peringatan saat keluar** (disetujui pemilik produk, 2026-11-13): keluar (logout) membuang seluruh antrean (FR-P14). Bila ada entri yang belum terkirim, dialog konfirmasi keluar menyebut jumlahnya ("N perubahan belum terkirim akan hilang") dengan tombol Batal dan Tetap keluar. Angkanya dibaca langsung dari antrean selama dialog terbuka (bukan potret saat dibuka); bila turun menjadi nol, teks dialog berubah menjadi "Semua perubahan sudah terkirim. Aman untuk keluar." Hitungan mengabaikan entri kedaluwarsa dan mencakup semua pemilik yang akan dibuang.

**Layar "Tidak ada koneksi" saat boot** (keputusan saya): selain pesan Fase 2, menampilkan jumlah perubahan yang belum terkirim dan belum kedaluwarsa di perangkat: "N perubahan menunggu dikirim. Hubungkan ke jaringan, lalu coba lagi agar terkirim." Hanya hitungan (semua pemilik di perangkat), tanpa isi dan tanpa memerlukan sesi. Kalimat sengaja tidak menjanjikan pengiriman otomatis: entri kedaluwarsa (> 24 jam) atau milik akun lain akan dibuang, bukan dikirim.

## 6. Tahap B: baca offline

**Penyimpanan.** IndexedDB, basis data `qc-device`, versi 1, tanpa dependensi (IndexedDB mentah dengan pembungkus kecil sendiri). Toko:
- `columns`: kunci `owner|lokasi-terurut|status` → `{ savedAt, data }` (data query infinite kolom itu, dipotong maks. 50 task: `BOARD_MAX_LIMIT`). Maks. 40 kolom terbaru (`BOARD_STORE_LIMITS.columns`).
- `tasks`: kunci `owner|id` → `{ savedAt, locationIds, dto }` (hasil `handovers.get`, memuat komentar), maks. 100 task terbaru.

**Aturan.**
- Hanya data milik `owner` (email pemilik sesi yang sah). Pemilik berbeda saat boot: semua dibuang.
- **Tanpa kedaluwarsa waktu** (keputusan pemilik 2026-11-13): data dihapus hanya saat keluar eksplisit atau saat pemilik berbeda login. Konsekuensi: data bisa sangat lama, jadi tampilan dari penyimpanan diberi label "data terakhir hh:mm" (waktu simpan) lewat spanduk Fase 2 saat server gagal dihubungi; selama muat ulang normal sesudah boot tidak ada label (§9 butir e), dan data diganti hasil server begitu server terjangkau. Jumlah tetap dibatasi (maks. 50 task per kolom, 40 kolom, 100 detail task; pemotongan hanya pada halaman utuh, lihat §9).
- Setiap rekaman membawa `v` (`BOARD_STORE_VERSION`) dan `owner`; rekaman dengan `v` lain dibuang saat pemulihan (§9 butir b).
- Dibuang seluruhnya saat keluar eksplisit (`useLogout`, bersama `clearAllOutboxes`). Sesi kedaluwarsa (401) tidak membuangnya (konsisten dengan antrean Fase 2).
- Tidak menyimpan: Log Audit, customer, item, merk, daftar user, berkas.

**Integrasi dengan TanStack Query** (memakai mesin Fase 2, bukan jalur baru):
- Penyimpan kedua di samping `startQueryPersistence`: langganan cache untuk kunci `handovers/board/...` dan `handovers/one/...`, menulis ke IndexedDB (ditunda dan digabung), hanya query berstatus `success` yang bukan `manual`.
- Saat boot, **sebelum router dibuat**, data dipulihkan dari IndexedDB ke cache dengan `setQueryData(..., { updatedAt: savedAt })` (tampil instan, lalu dimuat ulang di latar bila basi). Pembacaan IndexedDB dibatasi 1,5 detik; lewat itu aplikasi jalan tanpa data pulihan.
- Spanduk Fase 2 memakai predikat sendiri (baru), TERPISAH dari `PERSISTED_KEYS` yang menjadi whitelist localStorage di `query-persist.ts` (memperluas whitelist itu akan menulis papan ke localStorage, pendekatan A yang ditolak). Predikat baru mencocokkan awalan kunci `handovers/board` dan `handovers/one` (kunci memuat larik lokasi dan status, jadi bukan kecocokan string `root/sub`), sehingga spanduk "Server sedang tidak tersedia — menampilkan data terakhir (hh:mm)" Fase 2 otomatis menyala untuk papan.
- Penerapan optimistis centang dan overlay antrean (`useOutboxOverlay`) tetap menempel di atas data pulihan.

**Boot saat tanpa sinyal: tidak ada mode luring** (keputusan pemilik 2026-11-13). Saat `loadMe` gagal `UNAVAILABLE`, layar "Tidak ada koneksi" Fase 2 (FR-P7) tetap tampil, dan itu **disengaja**: layar itu memaksa pengguna terhubung ke jaringan sebelum bekerja. Sesi tidak pernah dipulihkan dari data tersimpan tanpa verifikasi server. Karena itu data papan tersimpan dipakai untuk: (a) tampil instan saat aplikasi dibuka dengan koneksi lalu diganti hasil server (stale-while-revalidate); (b) sesi yang sudah terverifikasi lalu server tak terjangkau (spanduk "data terakhir"), termasuk membuka task yang belum pernah dimuat pada sesi itu; (c) server lambat atau putus sesudah boot.

## 7. Tahap C: komentar dan task baru offline

### 7.1 Server (perubahan kontrak kecil, expand-only)

Migrasi `0018_client_id_serah_terima.sql` (idempoten, `IF NOT EXISTS`; nomor 0015 yang semula tertulis sudah dipakai `0015_serial_cases.sql`, lihat §9 Tahap C R1):
- `handovers.client_id VARCHAR(100) NULL` + `UNIQUE KEY handovers_client_id`.
- `handover_comments.client_id VARCHAR(100) NULL` + `UNIQUE KEY handover_comments_client_id`.
- Nullable agar baris lama dan image lama tetap valid (rollback aman). NULL berganda diizinkan indeks unik.

Kontrak (`shared/contract.ts`, `shared/api.ts` tidak berubah, hanya input):
- `AddCommentInput.clientId?: string`.
- `SaveHandoverBatchInput.tasks[].clientId?: string`. Ini satu-satunya jalur pembuatan task di web (`routes/_app/handover/new.tsx`); `handovers.save` dan `SaveHandoverInput` tidak berubah karena hanya dipakai untuk mengubah task, yang dilewati.
- Format: UUID 36 karakter huruf kecil (validasi ketat; ditolak `VALIDATION` bila tidak).

Semantik idempoten:
- `clientId` belum ada: dibuat seperti biasa, `client_id` ikut tersimpan.
- `clientId` sudah ada **dan** milik pelaku yang sama pada lokasi/task yang sama: tidak menulis apa pun (tanpa audit dan tanpa notifikasi kedua), mengembalikan DTO yang ada seperti respons asli.
- `clientId` ada tetapi milik pelaku/task/lokasi lain: `CONFLICT` berpesan generik.
- `saveBatch` atomik: bila sebagian `clientId` sudah ada, harus semuanya ada (atomisitas menjaminnya); campuran = `CONFLICT`.
- Dua permintaan serentak dengan `clientId` sama: penulis kedua gagal di indeks unik (`handovers_client_id` / `handover_comments_client_id`). Modul handover tidak memakai `mapDuplicateError`: `createTasks` hanya mengulang lewat `runCas` untuk `RETRYABLE_UNIQUE_KEYS` (`core/cas.ts`) dan `addComment` tidak memakai `runCas`. Jadi jalur baru dibuat di kedua fungsi: tangkap `DbError` `duplicate` pada dua indeks itu, baca ulang barisnya, periksa kepemilikan, kembalikan DTO. Tes konkurensi memakai `Promise.all` atas permintaan nyata. Implementasi (2026-11-14): `addComment` menangkap `DbError` `duplicate` apa pun dan galat penjaga batas, lalu mencari ulang `clientId`; DTO hanya dikembalikan bila barisnya milik pelaku itu, selain itu galat asli dilempar ulang.
- **Urutan pemeriksaan** (keputusan saya): autentikasi dan izin lokasi (kernel REST) → pencarian `clientId` → validasi bisnis (task dibatalkan, batas komentar, customer, kutipan) → tulis. Pencarian sebelum validasi bisnis agar kiriman ulang atas data yang sudah tersimpan tidak ditolak dan dibuang dengan toast (mis. task dibatalkan sesudah komentar tersimpan); sesudah izin lokasi agar DTO tak sampai ke pelaku yang sudah kehilangan akses. Pada `saveBatch` pencarian dilakukan dua kali: sebelum validasi customer (agar kiriman ulang tidak ditolak karena customer kini nonaktif) dan di dalam percobaan `runCas` sebelum `reserveNumbers` (balapan dua permintaan). Lihat §9 Tahap C.
- Rollback image sebelum rilis ini mengabaikan `clientId` (risiko duplikat kembali; dicatat di `docs/ci-cd.md`).

### 7.2 Antrean di perangkat

IndexedDB `qc-device` versi 2, toko `outbox`, kunci `owner|id` (modul `outbox.ts`; penulisan per entri, tidak pernah menulis ulang daftar dari salinan memori). Tiga jenis entri:
- `check`: `{ id, taskId, locationId, index, text, checked, at }`, sama dengan `OutboxEntry` Fase 2; seluruh aturan Fase 2 tetap (maks. 200 entri, kedaluwarsa 24 jam, gabung per task+indeks, penghapusan per `id`, penulisan ditahan saat keluar). Dipindah dari `localStorage` `qc.outbox:<email>` oleh migrasi sekali jalan saat boot: baca kunci lama, tulis ke IndexedDB, baru hapus kunci lama (bila penulisan gagal kunci lama dipertahankan dan dipakai lagi pada boot berikutnya).
- `comment`: `{ id, clientId, taskId, locationId, quote, before, after, body, at }`. Kolom `state` ditunda ke Tahap D (§9 Tahap C, R4).
- `create`: `{ id, locationId, tasks: [{ clientId, customerName, note }], at }` (satu entri = satu permintaan `saveBatch`, maks. 30 task, `HANDOVER_BATCH_MAX`; tanpa `state`, lihat R4). `clientId` dibuat **sebelum percobaan kirim online pertama** (R2) dan **tidak berubah** pada kirim ulang maupun saat diantrekan.

Aturan:
- Entri ditulis ke IndexedDB dan **dikonfirmasi tertulis** SEBELUM layar menampilkan "Belum terkirim". Bila penulisan gagal (kuota/penyimpanan diblokir), pengguna melihat galat biasa dan isi tidak dibuang dari formulir.
- Hanya `UNAVAILABLE` saat pengiriman pertama yang mengantre. Galat lain (validasi, izin) ditampilkan seperti sekarang, tanpa antre.
- Tampilan membaca **salinan dalam memori** yang dimuat dari IndexedDB sebelum router dibuat dan diperbarui lewat `BroadcastChannel` `qc-outbox` (dari tab lain dan dari service worker); `useOutboxOverlay` tetap sinkron.
- Keluar di satu tab disiarkan ke tab lain milik akun yang sama lewat `BroadcastChannel` `qc-session`: tab penerima berhenti menulis antrean dan papan, lalu (sejak 2026-11-14, A3, §9 Tahap C) memuat ulang sekali saat kembali fokus atau terlihat bila sesinya sah. Tab pengirim tidak memuat ulang.
- Maks. 50 entri untuk komentar dan task baru (centang tetap 200, hitungan terpisah). Semua jenis entri kedaluwarsa 24 jam (FR-P19) dan dibuang dengan pemberitahuan (§7.4).
- Urutan: entri per task dikirim berurutan menurut `at`; antar task bebas, satu permintaan pada satu waktu. Memakai kunci `qc-outbox-flush` yang sama dengan penguras centang (satu penguras, dua sumber).
- Pengurasan: klasifikasi galat sama dengan centang (§Fase 2): `UNAVAILABLE`/`INTERNAL`/non-ApiError menahan dan menghentikan putaran; `UNAUTHENTICATED` melaporkan dan menahan; kode penolakan (`CONFLICT`/`FORBIDDEN`/`NOT_FOUND`/`VALIDATION`) membuang entri dan mengumumkannya lewat toast beserta alasannya (§7.4). Pemicu, pembatas 3 detik, batas 30 detik per kiriman, dan pemblokiran saat keluar sama dengan Fase 2.

- Komentar, task baru, dan query opsi formulir memakai `networkMode: 'always'` (lihat §9 Tahap C, penyesuaian implementasi), agar kiriman yang bisa diantrekan gagal `UNAVAILABLE` seketika.

### 7.3 Tampilan

- **Komentar tertunda:** muncul di akhir daftar komentar task dengan label "Belum terkirim" / "Mengirim…". Komposer langsung dikosongkan setelah entri tertulis (bukan menunggu server).
- **Task baru tertunda:** kartu sementara di kolom Baru, bernomor "—" (nomor `ST-…` dibuat server), berlabel status, **tidak dapat dibuka** sampai terkirim (tidak punya id server). Setelah terkirim, kartu sementara diganti hasil server saat entrinya dihapus dari antrean. `HandoverDto` tidak memuat `clientId` (R3), sehingga tidak ada dedup di sisi tampilan: bila refetch tiba sebelum kirim ulang, kartu sementara dan kartu server dapat tampil ganda sebentar (diterima, §9 Tahap C).
- Formulir task baru offline: sekarang `routes/_app/handover/new.tsx` tidak merender formulir sama sekali bila `handovers.options` gagal (hanya teks "Gagal memuat daftar customer"). Diubah: bila galatnya `UNAVAILABLE`, formulir tetap tampil dengan `options` kosong (saran customer tidak tersedia karena daftar customer tidak disimpan; nama diketik bebas, customer dibuat server saat terkirim, FC2). Galat lain tetap seperti sekarang.
- Pilihan lokasi memakai `me.locations` (sudah di whitelist).

### 7.4 Penolakan server

Komentar atau task baru yang ditolak server (`CONFLICT`/`FORBIDDEN`/`NOT_FOUND`/`VALIDATION`), atau yang kedaluwarsa 24 jam, **dibuang dengan toast**, sama seperti centang (keputusan pemilik 2026-11-13), dengan alasan dari server ("Task sudah dibatalkan", "Lokasi tidak dapat diakses", dst.). Karena isinya ketikan pengguna, toast memuat tombol **"Salin teks"** dan bertahan sampai ditutup (keputusan saya, agar isi tidak hilang diam-diam). Sejak 2026-11-14 (A2, §9 Tahap C) teks yang disalin untuk task baru memuat nama customer: per task `Customer: <nama>`, baris kosong, lalu catatan; nama kosong berarti hanya catatan; antar task dipisah baris kosong. Komentar tidak berubah. Tidak ada "Coba lagi": penolakan tidak berubah dengan mengirim ulang. Penanda `rejected` hanya jembatan sementara dari service worker ke halaman (§7b).

## 7b. Tahap D: Background Sync (Chrome/Edge)

**Berkas.** `web/public/sync-sw.js` (skrip klasik, diimpor lewat `workbox.importScripts` di `pwa-config.ts` seperti `push-sw.js`, tidak dipra-cache). Hanya memasang pendengar `sync` untuk tag `qc-outbox`.

**Pendaftaran.** Setelah entri ditulis ke antrean, halaman memanggil `registration.sync.register('qc-outbox')` bila `SyncManager` ada (kegagalan diabaikan; jalur dasar tetap jalan). Tanpa `SyncManager` tidak ada yang berubah. Menutup aplikasi (bukan keluar) tidak menghentikan Background Sync; keluar (logout) membuang antrean sehingga tidak ada yang dikirim sesudahnya.

**Saat peristiwa `sync` tiba** (aplikasi mungkin tertutup), skrip:
1. Mengambil kunci `navigator.locks` `qc-outbox-flush` (kunci yang sama dengan penguras halaman, sehingga hanya satu pengirim di seluruh konteks).
2. Memeriksa pemilik sesi lewat `GET /api/v1/me` (cookie sesi ikut terkirim otomatis). Email hasilnya harus sama dengan pemilik entri; beda atau 401 = **tidak mengirim apa pun**, entri tetap, hasil dibiarkan untuk pengirim halaman. Ini menutup celah "akun lain login di perangkat yang sama sebelum antrean pemilik pertama dibuang".
3. Mengirim entri milik pemilik itu berurutan (urutan per task menurut `at`), dengan batas 30 detik per permintaan dan klasifikasi galat yang sama dengan penguras halaman: `UNAVAILABLE`/`INTERNAL`/galat jaringan melempar galat agar peramban menjadwalkan ulang (Chrome mencoba beberapa kali dengan jeda menaik); kode penolakan dan kedaluwarsa (> 24 jam) pada SEMUA jenis entri hanya ditandai `rejected` dengan alasan oleh service worker, TIDAK dibuang, karena tanpa tab terbuka toast tak dapat tampil; penguras halaman berikutnya mengumumkannya lewat toast (§7.4) lalu membuangnya. Dengan begitu tidak ada entri yang hilang tanpa pemberitahuan (keputusan saya).
4. Menyiarkan perubahan lewat `BroadcastChannel` `qc-outbox` dan, bila ada tab terbuka, mengirim pesan agar cache query memuat ulang task terkait. Notifikasi peramban tidak ditambah (lonceng dan push server yang sudah ada tetap pengabar).

**Kejar-kejaran dengan jalur halaman.** Penguras halaman tetap memakai pemicu Fase 2 (`online`, tab terlihat, fokus, sukses query). Kunci bersama dan penghapusan per `id` menjamin satu entri tidak dikirim dua kali; `clientId` (komentar, task) dan sifat idempoten centang menjadi pengaman kedua.

**Keamanan.** Skrip tidak menyimpan atau menerima kredensial; hanya memakai cookie sesi yang sudah ada dan hanya ke origin sendiri. Isi entri (teks komentar, catatan) hanya ada di IndexedDB dengan aturan pemilik dan pembuangan yang sama seperti bagian lain.

**Tes kesetaraan.** Tabel skenario tunggal (jenis galat → tindakan terhadap entri) dijalankan terhadap penguras halaman dan terhadap `sync-sw.js` yang dimuat di `vm` dengan global service worker palsu; hasil keduanya harus sama.

## 8. Kualitas dan pengujian

- Tahap D: tes `sync-sw.js` di `vm` (peristiwa `sync`, pemeriksaan pemilik, galat dijadwalkan ulang, penolakan, kunci bersama, siaran), tes kesetaraan dengan penguras halaman, tes bahwa konfigurasi `pwa-config.ts` memuat `importScripts` `sync-sw.js`, dan tes `verify-dist` bahwa berkasnya ada di keluaran. `SyncManager` tak ada = tidak mendaftar dan tidak galat.
- Unit (vitest, jsdom + `fake-indexeddb` sebagai devDependency, versi dipin ≥ 2 minggu): pembungkus IndexedDB, tanpa kedaluwarsa waktu (dihapus hanya saat logout atau pemilik berbeda), pemulihan sebelum router, penyimpan kedua (hanya `success` non-`manual`), antrean komentar/task (penulisan terkonfirmasi sebelum penanda, urutan per task, `clientId` tetap pada kirim ulang, klasifikasi galat, penolakan dan kedaluwarsa dibuang dengan toast dan tombol "Salin teks"), status `sending`, penghitung header, dialog keluar.
- Server (MariaDB sungguhan): idempotensi `clientId` di `createTasks` (tunggal dan batch) dan `addComment`, klaim serentak `Promise.all`, `clientId` milik pelaku lain → `CONFLICT` generik, tanpa audit/notifikasi pada pengiriman ulang, `rest.test.ts` untuk kontrak baru, `deploy-files.test.ts` tak berubah (tanpa variabel `.env` baru).
- `scripts/verify-dist.ts`: ditambah pemeriksaan bahwa `sync-sw.js` (dan `push-sw.js`, yang selama ini belum diperiksa) ada di `server/dist` dan tidak dipra-cache; anggaran chunk tidak berubah (pembungkus IndexedDB kecil).
- `docs/e2e-checklist.md`: skenario perangkat nyata (belum teruji): boot dingin tanpa sinyal tetap layar "Tidak ada koneksi" dengan jumlah antrean, centang/komentar/task baru offline lalu pulih, tutup-buka aplikasi dengan antrean, ganti akun, keluar dengan peringatan, penolakan server, dua tab.

## 9. Keputusan yang saya ambil dan pertanyaan terbuka

Keputusan saya (mohon dikoreksi):
- IndexedDB mentah dengan pembungkus kecil, bukan pustaka `idb`: menghindari dependensi baru.
- Status `sending` tidak disimpan; disiarkan lewat `BroadcastChannel` dengan masa berlaku 45 detik (tahap A: per tab).
- Antrean centang dipindah ke IndexedDB di tahap C (konsekuensi Background Sync yang dipilih pemilik); risiko regresi kode Fase 2 ditutup dengan memindahkan seluruh tesnya, bukan menulis ulang.
- `sync-sw.js` berupa skrip klasik terpisah (bukan `injectManifest`) agar konfigurasi Fase 1 tidak berubah.
- Service worker memeriksa pemilik sesi lewat `/api/v1/me` sebelum mengirim.
- Pencarian `clientId` di server sesudah izin lokasi tetapi sebelum validasi bisnis (§7.1).
- Entri (semua jenis) yang ditolak/kedaluwarsa saat dikuras service worker ditandai `rejected` dan diumumkan oleh halaman berikutnya (§7b).
- Halaman task baru tetap menampilkan formulir saat `handovers.options` gagal `UNAVAILABLE` (§7.3).
- Predikat spanduk dipisah dari whitelist localStorage (§6); `verify-dist` diperluas untuk `sync-sw.js`/`push-sw.js` (§8).
- Toast penolakan/kedaluwarsa untuk komentar dan task baru memuat tombol "Salin teks" dan bertahan sampai ditutup.
- Layar "Tidak ada koneksi" saat boot menampilkan jumlah perubahan yang belum terkirim (hanya hitungan).
- Penanda `rejected` hanya jembatan sementara service worker ke halaman, bukan status yang terlihat pengguna.
- Pencegah duplikat lewat `client_id`, `id` tetap dibuat server.

Keputusan pemilik produk atas pertanyaan terbuka (2026-11-13):
- **O1. Boot ke mode luring: DITOLAK.** Layar "Tidak ada koneksi" tetap, disengaja agar pengguna terhubung ke jaringan (§6).
- **O2. Peringatan saat keluar** bila ada antrean: DISETUJUI (§5).
- **O3. Penolakan komentar/task:** dibuang dengan toast seperti centang, bukan disimpan (§7.4).
- **O4. Penyimpanan papan:** tetap di IndexedDB, tanpa kedaluwarsa waktu, dihapus hanya saat logout (§6). Saya menunjukkan bahwa tanpa mode luring manfaatnya terbatas pada tampil instan dan sesi yang sudah terverifikasi; pemilik memilih tetap menyimpannya.

Yang masih menunggu: persetujuan dokumen ini secara keseluruhan.

Keputusan saya untuk Tahap B (2026-11-14; mohon dikoreksi; **menunggu pengesahan pemilik produk**):
- (a) Kolom dibatasi 40 rekaman terbaru (`BOARD_STORE_LIMITS.columns`): pilihan lokasi yang berganti bisa melahirkan kombinasi kunci tanpa batas. Ukuran terburuk tidak dibatasi byte (40 kolom x 50 task, DTO membawa komentar); praktisnya jauh lebih kecil karena task berulang antar kolom. Bila kuota penyimpanan terlampaui, penulisan gagal diam-diam sampai keluar.
- (b) Rekaman membawa `v` (`BOARD_STORE_VERSION`) dan `owner`; rekaman usang dibuang agar bentuk DTO yang berubah antar rilis tidak merusak tampilan. Pembuangan rekaman pemilik lain tetap dijalankan walau pemulihan melewati batas 1,5 dtk, dan data pulihan divalidasi bentuknya sebelum dipasang; rekaman rusak dibuang.
- (c) Pemotongan kolom hanya pada halaman utuh (`board-snapshot.ts`), sehingga `nextCursor` tetap sah; akibatnya sebuah kolom yang tersimpan bisa memuat kurang dari 50 task.
- (d) Hanya sukses query non-`manual` yang ditulis. Hasil mutasi yang dipasang manual baru tersimpan pada muat ulang berikutnya; tidak berdampak karena data pulihan selalu dimuat ulang saat basi.
- (e) Label "data terakhir hh:mm" tampil lewat spanduk Fase 2 saat server gagal dihubungi. Selama muat ulang normal sesudah boot tidak ada label. Tafsiran "selalu berlabel" di §6 dikoreksi ke tafsiran ini.
- (f) Detail task dibuka dari data papan bila belum pernah dibuka (`findBoardSeed`, Task 5), dan hanya bila lokasi task itu termasuk lokasi yang boleh dibaca pengguna di rute itu. Jawaban server `NOT_FOUND`/`FORBIDDEN` selalu otoritatif; data seed tidak ditampilkan menggantikannya. Pesan untuk `FORBIDDEN` ditampilkan sama seperti `NOT_FOUND`, "Task tidak ditemukan di lokasi aktif.", karena `handovers.get` hanya memberi `FORBIDDEN` untuk pemeriksaan lokasi dan pesan itu tidak mengungkap keberadaan task. Penolakan server bersifat latch: sesudah `NOT_FOUND`/`FORBIDDEN`, galat `UNAVAILABLE` berikutnya pada query yang sama tidak boleh memunculkan lagi data seed atau data lama yang tadi ditolak. `refetchOnMount: 'always'` menambah satu permintaan setiap detail dibuka (detail yang baru dimuat kurang dari 60 dtk tetap dimuat ulang).
- (g) Flush pada `pagehide` bersifat usaha terbaik, karena penulisan IndexedDB bersifat asinkron. Pembersihan toko saat keluar dibatasi waktu 1,5 dtk sehingga Keluar tidak pernah menggantung. Bila IndexedDB benar-benar macet (tak pernah menjawab), pembersihan itu dilepas setelah 1,5 dtk sehingga isi toko TIDAK terhapus saat itu; rekaman tersebut baru dibuang pada boot pemilik lain atau Keluar berikutnya yang berhasil, dan tidak pernah dipulihkan bagi pemilik lain (pemilik diperiksa saat pemulihan).
- (h) Label "data terakhir" dapat terlalu baru bagi sebagian isi kolom pulihan setelah "muat lagi" berhasil, karena semantik TanStack: `dataUpdatedAt` hanya satu per query. Diterima.
- (i) Batasan banyak tab yang sama seperti antrean (PRD §11 2026-11-13 butir 9): keluar tidak disiarkan antar tab, sehingga tab lain pemilik yang sama dapat menulis ulang papan pemilik lama sebelum dibuang oleh boot pemilik lain atau keluar berikutnya, dan tab dengan sesi lama di memori dapat menyimpan data di bawah `owner` lama bila akun berganti di tab lain. Diterima untuk Tahap B; siaran keluar direncanakan di Tahap C (ditutup 2026-11-14, lihat §9 Tahap C). Tab penerima siaran keluar yang tertahan kini dimuat ulang sekali saat sesi sah kembali (A3, 2026-11-14), sehingga tidak lagi tertahan selamanya.

### Keputusan Tahap C (2026-11-14)

Disetujui pemilik produk pada 2026-11-14 ("Ya, eksekusi"). Butir yang berbeda dari atau melengkapi spek di atas sudah diubah di §7.1-§7.3 dan §9 ini:
- **R1. Nomor migrasi 0018, bukan 0015.** Alasan: `0015_serial_cases.sql` dan `0016_panduan_interaktif.sql` sudah ada, dan `0017_laporan_rusak.sql` (PR Serial laporan rusak) masuk ke `dev` lebih dulu (2026-11-14). Diubah: §7.1 (nama berkas migrasi).
- **R2. `clientId` dibuat sebelum percobaan kirim online pertama.** Alasan: pada timeout klien, kiriman yang sudah tersimpan di server dipetakan `UNAVAILABLE`; membuat `clientId` saat entri ditulis akan menggandakan data. Diubah: §7.2 (`clientId` dibuat sebelum kirim pertama, tidak berubah saat antre maupun kirim ulang).
- **R3. `HandoverDto` tanpa `clientId`.** Risiko yang diterima: bila refetch tiba sebelum kirim ulang, kartu sementara dan kartu server tampil ganda sebentar sampai entri dihapus. Diubah: §7.3 (dedup lewat `clientId` di tampilan dihapus dari spek). Pemilik menerima risiko ini.
- **R4. Kolom `state` (penanda `rejected`) ditunda ke Tahap D.** Alasan: penanda itu hanya jembatan service worker dan ditambahkan bersama penulisnya di Tahap D. Diubah: §7.2 (bentuk entri tanpa `state`). Pertanyaan tentang bentuk entri ditutup untuk Tahap C; §7b tidak berubah.
- **R5. Urutan pencarian `clientId` di server.** Sesudah izin lokasi dan sebelum validasi bisnis; untuk task baru dilakukan juga di dalam percobaan `runCas` sebelum `reserveNumbers` dan sebelum validasi customer (§7.1). Tidak mengubah prinsip §7.1.
- **R6. Entri centang yang digabung dilakukan sebagai baca-hapus-tulis dalam satu transaksi IndexedDB.** Tidak ada penulisan ulang daftar pemilik dari salinan memori (menutup Review Focus 2 Tahap C). Tidak mengubah aturan gabung §7.2.

Keputusan tambahan (usulan dari review putaran perbaikan 3; disetujui pemilik produk 2026-11-14):
- **A2. Salin teks task baru memuat nama customer.** Teks per task: `Customer: <nama>`, baris kosong, lalu catatan; nama kosong berarti hanya catatan; antar task dipisah baris kosong. Alasan: batch sampai 30 task tidak dapat dipetakan ke customer-nya bila hanya catatan yang disalin. Diubah: §7.4 (format salin teks task baru). Komentar tidak berubah.
- **A3. Tab tertahan setelah siaran keluar dimuat ulang sekali saat sesi sah kembali.** Tab penerima siaran keluar tetap tertahan. Saat tab kembali fokus atau terlihat, bila `auth.me` menyatakan sesi sah (akun apa pun), tab memuat ulang SEKALI. Tidak ada panggilan jaringan saat tab tersembunyi. Sesi tidak sah atau server tidak terjangkau = tetap tertahan, dicoba lagi pada fokus berikutnya. Tab pengirim siaran tidak memuat ulang. Masukan formulir yang belum disimpan di tab itu hilang; entri antrean tetap aman di IndexedDB. Bila sesi milik akun berbeda, boot berjalan sebagai login biasa dan antrean akun lama dibuang (`purgeForeignOutboxes`). Alasan: tanpa ini tab tertahan tidak pernah pulih dan fitur offline di tab itu mati diam-diam. Diubah: §7.2 (perilaku siaran keluar) dan batasan tab penerima pada §9 Tahap B butir (i), yang kini ditutup untuk sesi yang sah kembali.

Penyesuaian implementasi di luar rencana, disahkan pemilik produk pada 2026-11-15 (dicatat agar reviewer di kemudian hari tahu ini disengaja dan tidak menemukannya lagi sebagai temuan):
- **P1. `networkMode: 'always'`** pada mutasi komentar dan task baru serta query opsi formulir. Alasan: tanpa ini react-query menahan mutasi selagi peramban luring, sehingga galat `UNAVAILABLE` tidak pernah tiba dan kiriman tidak pernah masuk antrean (§7.2).
- **P2. Pesan siaran `sending-done`** menghapus penanda "Mengirim..." di tab lain saat kirim selesai, tanpa menunggu masa berlaku 45 dtk. Alasan: penanda yang basi menyesatkan pengguna tab lain.
- **P3. Rekaman antrean membawa `seq`** sebagai pemecah urutan bila `at` kembar. Alasan: dua entri pada milidetik yang sama tidak boleh berurutan acak.
- **P4. `hasEntriesForTask` menghitung semua jenis entri**, sehingga centang pada task yang masih punya komentar antre ikut diantrekan. Alasan: tanpa ini centang dapat terkirim mendahului komentar yang dibuat lebih dulu dan urutan di server terbalik.
- **P5. Penguras mengambil ulang isi toko saat start** bila salinan memori kosong (hidrasi gagal atau terlambat). Alasan: salinan kosong tidak boleh dibaca sebagai antrean kosong (`null` ≠ kosong).

Risiko yang tersisa:
- A3 membuang masukan formulir yang belum disimpan di tab yang dimuat ulang; antrean tetap aman. Ini konsekuensi langsung dari muat ulang yang disetujui pemilik produk (2026-11-14).
- A3 memetakan galat server selain `UNAVAILABLE` ke "tidak sah": tab tetap tertahan dan dicoba lagi pada fokus berikutnya (aman, tidak memuat ulang). Dicatat untuk diketahui; belum dikonfirmasi pemilik secara eksplisit.
- Keluar membersihkan antrean dan papan secara paralel dengan satu anggaran 1,5 dtk (diperbaiki pada putaran perbaikan 1; sebelumnya dua anggaran berurutan).

Belum diuji di perangkat nyata (lihat `docs/e2e-checklist.md` #208-#224).

## 10. Dampak ke dokumen lain (dikerjakan saat tiap tahap)

- PRD `docs/prd/2026-10-26-qc-pwa.md`: §2.3 (bukan aplikasi offline penuh, kini ada pengecualian Serah Terima), §4.4 FR baru, NFR-P4 (data papan di IndexedDB tanpa batas waktu sampai logout, antrean teks), §11 butir keputusan 2026-11-13 (menggantikan "Board dan isi task tidak disimpan di perangkat"), §12 butir 4 ditutup.
- `CLAUDE.md`: bagian PWA (antrean kini IndexedDB, `sync-sw.js`, penyimpan papan), Serah Terima, dan aturan migrasi (0015). Catatan: aturan lama "Service worker tidak boleh men-cache `/api`..." tetap; `sync-sw.js` hanya MENGIRIM, tidak menyimpan respons.
- Desain/PRD Fase 1 mencatat "tanpa kode service worker tulisan tangan": sudah tidak berlaku sejak `push-sw.js`; PRD §6.1 diperbarui.
- `docs/ci-cd.md`: catatan rollback `client_id`.
- `docs/e2e-checklist.md`: bagian "PWA Fase 3".
