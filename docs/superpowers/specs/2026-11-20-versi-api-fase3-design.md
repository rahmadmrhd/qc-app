# Fase 3 versi API: deprecated, paksa pembaruan, dan pagar rilis

Tanggal: 2026-11-20. Turunan dari `2026-11-20-versi-api-ui-dasar-paksa-update-design.md` (bagian 6.7, 6.8, 9 butir 3). Fondasi (fase 1 dan 2) sudah
masuk lewat PR 144; dokumen ini hanya fase 3.

## 1. Maksud
Pemilik produk membuka fase 3 **untuk berjaga-jaga**: bila kelak ada perubahan kontrak API yang merusak, mekanisme mematikan versi lama dan
memaksa klien memperbarui sudah ada dan teruji, bukan dirakit saat darurat. Belum ada rute v2 dan belum ada klien yang rusak; nilainya ada
pada kesiapan.

Pertimbangan penentu: klien yang sudah tersebar (installer desktop lama, tab web lama) tidak dapat diajari perilaku baru belakangan. Mereka
hanya menangani `426`, `minClient`, dan `deprecated` bila kodenya sudah ada di versi yang mereka pegang. Maka fase ini sengaja dikirim SEBELUM
ada rute yang dihapus.

## 2. Cakupan
Satu PR besar (keputusan pemilik 2026-11-20; cara 1 dari tiga yang dipertimbangkan, lihat bagian 4).
**Prasyarat:** halaman daftar unduhan `/desktop` (bagian 5 seri rilis) dibangun lebih dulu di PR terpisah (bagian 5b butir 3); fase 3 baru
dimulai atau dirilis sesudahnya.

Masuk:
1. **Server**: `minClient` di `/api/ping`; status `deprecated` per kelompok diumumkan di ping (sudah ada) dan rutenya menambah header `Deprecation: true`;
   rute di `RETIRED_ROUTES` dijawab `426` problem+json kode `CLIENT_OUTDATED`; kode galat baru `CLIENT_OUTDATED` di `ERROR_CODES`.
2. **Klien web**: respons `426 CLIENT_OUTDATED` atau versi yang dipakai shell ada di `deprecated` memicu pemuatan ulang paksa lewat alur
   `recoverStaleShell`/`update.ts` yang ada, setelah pemeriksaan "ada ketikan belum tersimpan".
3. **Klien desktop**: bila `app.getVersion()` < `minClient.desktop` atau menerima `426`, rute yang butuh API diganti layar penahan "Perlu
   pembaruan". Tombol utama "Perbarui sekarang" menjalankan alur pembaruan yang ada (tanpa "Nanti"); bila pembaruan gagal, layar menampilkan
   teks galat dan **tautan ke halaman daftar unduhan** (`/desktop`, hanya versi yang didukung), dibuka di peramban sistem
   (`shell.openExternal`, alamat dari pengaturan server desktop). `/country-lock` dan draf lokal TIDAK ditahan.
4. **Antrean offline** (`outbox-flush.ts` dan `web/public/sync-sw.js`): entri yang ditolak `426` dibuang ke jalur "ditolak" yang ada dengan
   alasan jelas, bukan dicoba ulang. Klasifikasi galat ada di dua tempat dan dijaga `outbox-parity.test.ts`: ubah keduanya.
5. **Pagar rilis**: `release:prepare server` membuat ulang `shared/api-contract.snapshot.json`; penghapusan rute ditolak bila potret yang
   menandai deprecated berumur kurang dari 24 jam; tes pagar `RETIRED_ROUTES` (id di potret lama harus ada di kontrak sekarang ATAU di
   `RETIRED_ROUTES` dan berstatus deprecated di potret tersebut; sebagian sudah ada di `compareContract`).
6. Dokumen: `CLAUDE.md` (bagian kebijakan versi API), `docs/adding-a-module.md`, `docs/ci-cd.md`, spek rilis desktop, fragmen changelog server
   dan desktop.

Tidak masuk (non-tujuan):
- Rute v2 pertama dan tabel `FEATURE_REQUIRES`/`useFeature` (spek induk 6.5): dibuat saat ada perubahan merusak nyata.
- Versi untuk rute di luar `API_ROUTES` (`/api/desktop/*`, `/auth/*`, `/api/public/*`).
- Mengajari `sync-sw.js` memilih versi (rute yang dipakai antrean offline tetap TIDAK boleh dinaikkan; hanya penanganan 426).
- Tag desktop atau penarikan rilis desktop yang sudah ada; tidak ada perubahan alur rilis selain potret dan pagar.

Anti-tujuan (kegagalan walau lolos tes): layar penahan menutup Country Lock; pemuatan paksa web menghapus ketikan yang belum tersimpan; `minClient`
yang salah nilai memaksa semua installer memperbarui secara tak sengaja; entri antrean offline hilang tanpa jejak.

## 3. Keputusan
Dari pemilik (bagian 3 spek induk, butir 5 dan 6, dan sesi 2026-11-20): deprecated lebih dulu, dihapus di rilis berikutnya; klien lama dipaksa
memperbarui; Country Lock tetap jalan; satu PR besar.

Usulan perancang (dapat diubah pemilik; dicatat sebagai pertanyaan terbuka 10.2 sampai 10.4 spek induk):
- **Nilai awal `minClient.desktop` = `0.0.0`** (tidak memaksa siapa pun saat fase ini dirilis); dinaikkan hanya bersamaan dengan penghapusan
  versi API yang masih dipakai installer lama, lewat PR yang dapat ditinjau. Sumbernya konstanta di kode, bukan variabel lingkungan.
- **Jeda minimum deprecated ke hapus = 24 jam**, ditegakkan `release:prepare server` (antrean offline hidup 24 jam; hotfix bisa menyusul
  hanya beberapa jam setelah rilis yang menandai).
- **Peta `apis` disimpan** (salinan terakhir) agar klien offline tidak kembali ke v1 secara keliru; klien baru yang belum pernah online memakai v1.
- Tombol layar penahan: satu tombol "Perbarui sekarang", tanpa "Nanti" (spek induk 6.8); bila pembaruan gagal, teks galat dan tautan ke
  halaman daftar unduhan (ditetapkan pemilik 2026-11-20, lihat bagian 5b butir 3). Tidak ada tombol "coba lagi" terpisah: tombol utama dapat ditekan lagi.

## 4. Pendekatan yang dipertimbangkan
1. **Satu PR besar, semuanya sekaligus (DIPILIH pemilik).** Selesai sekali jalan; sulit ditinjau karena menyentuh server, web, desktop, skrip rilis.
2. Dua PR, klien dulu (rekomendasi perancang): PR 1 mekanisme klien dan 426, PR 2 pagar rilis. Mengamankan klien yang tersebar lebih awal
   dan lebih mudah ditinjau.
3. Hanya bagian klien, sisanya ditunda: paling kecil, tetapi pagar penghapusan rute belum ada.

Catatan risiko pilihan 1: PR yang besar sebaiknya dikerjakan per fase internal (server, web, desktop, rilis) dengan komit terpisah per fase
supaya tinjauan dapat dilakukan per komit.

## 5. Hal yang diserahkan ke pembangun
Nama berkas, bentuk komponen layar penahan, teks pesan (bahasa santai, mengikuti gaya UI proyek), bentuk fungsi pembantu, tempat menyimpan peta
`apis`, dan susunan tes. Wajib: tes untuk setiap butir cakupan 1 sampai 5, termasuk (a) layar penahan tidak menyentuh `/country-lock`, (b) `426`
membuang entri antrean ke jalur ditolak di halaman DAN di `sync-sw.js`, (c) `release:prepare` menolak penghapusan < 24 jam, (d) ping memuat
`minClient` dan klien lama (tanpa field itu) tetap jalan.

## 5a. Pilihan perancang atas pertanyaan pembangun (dapat diubah pemilik)
1. **Pencocokan rute yang dihapus:** `RETIRED_ROUTES` memuat `{ id, verb, path, removedIn }` (verb dan path disalin dari potret terakhir
   yang memuat rute itu, bentuk templat seperti di `API_ROUTES`). Server mencocokkan verba + templat jalur dan menjawab `426` SEBELUM
   `authorize`, tanpa sesi (jawaban hanya membuka bahwa rute itu pernah ada, yang sudah publik di repositori).
2. **Versi installer ke renderer:** kanal jembatan baru hanya-baca `app.version` (tanpa argumen; mengembalikan semver string) sesuai
   resep kanal baru di `CLAUDE.md`: `BRIDGE_VERSION` naik, `UI_MIN_BRIDGE_VERSION` TIDAK naik; UI melewati gerbang `minClient` bila
   jembatan lama (jalur `426` tetap menutup celahnya). `minClient` dibaca renderer dari `/api/ping` lewat proksi yang sudah ada.
3. **Spanduk vs paksa di web:** versi deprecated saja = spanduk "Aplikasi perlu diperbarui" (tanpa memuat ulang); `426` = pemuatan ulang
   paksa. Ketikan belum tersimpan menunda pemuatan ulang dan spanduk tetap tampil sampai tersimpan atau dibuang. Karena `api()` belum
   memanggil `pickApi`, pemicu "versi yang dipakai shell" diuji dengan data sintetis sampai ada rute v2 pertama.
4. **Cakupan:** `426` dan header `Deprecation` hanya untuk rute di `API_ROUTES`; `minClient` ada di `/api/ping` (publik, tanpa sesi).
   `/auth/*`, `/api/public/*`, `/api/desktop/*`, dan aliran notifikasi tidak ikut.
5. **Penyimpanan peta `apis`:** `localStorage` kunci `qc.api.versions`, bukan per pemilik dan tidak dibuang saat logout (isinya publik dan
   tanpa data pengguna); bukan bagian `query-persist`.

## 5b. Keputusan pemilik atas dua pertanyaan terakhir (2026-11-20, disetujui pemilik produk)
1. **Jalan keluar layar penahan:** layar tetap menahan; tombol utama "Perbarui sekarang" dapat ditekan lagi dan, bila pembaruan gagal, muncul
   tautan ke halaman daftar unduhan (butir 3); server TIDAK mengabaikan
   `minClient` bila rilis desktop belum cukup. Country Lock tetap dapat dibuka. Konsekuensi diterima: bila `minClient` salah dinaikkan,
   pengguna terkunci dari bagian yang butuh API sampai nilainya diturunkan lewat PR; karena itu `minClient` hanya dinaikkan bersamaan
   dengan penghapusan versi API yang masih dipakai installer lama dan setelah installer yang cukup baru terbit.
2. **Jeda 24 jam:** ditegakkan HANYA oleh `release:prepare server` (mode rilis `tag`). Di mode `langsung` (bawaan masa pra-resmi) pemilik
   menjaganya secara manual; tidak ada langkah CI berbasis waktu dan tidak ada field waktu di `API_GROUP_VERSIONS` selain yang dibutuhkan
   potret kontrak. Risiko diterima: di mode `langsung`, rute dapat dihapus lebih cepat dari 24 jam setelah ditandai deprecated.
   Cakupan butir 5 (pagar rilis) di bagian 2 dibaca sesuai ini.
3. **Halaman daftar unduhan dibangun terpisah dan LEBIH DULU (2026-11-20, pemilik produk):** tautan layar penahan menuju halaman `/desktop`
   (bagian 5 seri rilis semver), yang belum ada. Pemilik memutuskan halaman itu dibangun sebagai PR terpisah SEBELUM fase 3, dan hanya
   menampilkan versi yang didukung server (>= `minClient.desktop`); versi yang tak didukung tidak ditampilkan
   (`2026-11-17-changelog-dan-unduh-desktop-web-design.md` 5.3 diubah). Urutan: halaman unduh, lalu fase 3. Fase 3 bergantung pada PR itu
   untuk tautannya dan tidak dirilis lebih dulu daripadanya (tautan akan mati).
   **Status 2026-11-20:** halaman `/desktop` sudah dibangun (rencana `docs/superpowers/plans/2026-11-20-halaman-unduh-desktop.md`); rute `desktop.releases` menyaring dengan konstanta `MIN_CLIENT.desktop`, yang dipakai ulang fase 3.
4. **Pelepasan bertahap installer yang tak didukung (di luar fase 3):** pemilik menghendaki secara bertahap `.sig` installer yang tak lagi
   didukung dilepas (dihapus), lalu installer dihapus dari Drive. Dicatat di `2026-11-17-rilis-desktop-auto-update-design.md` bagian
   retensi; alurnya dirancang terpisah. Fase 3 hanya menyediakan sumber kebenarannya, yaitu `minClient.desktop`.

## 6. Uji perangkat nyata (tidak dapat dipastikan mesin)
Pembaruan paksa installer (checklist E2E desktop bagian K) dan tab web lama; dicatat sebagai butir manual di `docs/e2e-checklist-desktop.md`.
