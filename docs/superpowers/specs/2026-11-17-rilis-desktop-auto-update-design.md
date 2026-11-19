# Rilis aplikasi desktop dan auto-update (bagian 4 dari seri rilis semver)

Status: **disetujui pemilik 2026-11-18** (revisi 3, 2026-11-18: tata letak Drive datar, urutan publish, pemisahan kunci, dan keputusan perancang 1-5 di bagian 7; revisi 2, 2026-11-18: lihat kendala 3.1; revisi 1, 2026-11-17). Seri: 1 fondasi rilis + changelog dan 2 deploy lewat tag
(`2026-11-17-rilis-semver-design.md`), 3 bundling backend (`2026-11-17-bundling-backend-design.md`), **4 dokumen ini**,
5 halaman unduh + tampilan changelog di web (dokumen terpisah).

## 1. Maksud dan alasan
Aplikasi desktop (Electron, Windows) hari ini hanya dapat dipasang dari hasil `bun run build:desktop` pemilik; belum ada rilis
berversi, belum ada pembaruan biner (hanya UI-nya yang diperbarui lewat manifest bertanda tangan), dan GitHub Releases tidak dapat dijadikan sumber unduhan aplikasi: repositori sempat privat, kini publik, dan dapat kembali privat kapan saja (keputusan pemilik 2026-11-18), serta pengguna tidak boleh mengetahui repositori sumbernya. Tujuan: rilis desktop dengan semver (`desktop-vX.Y.Z`),
installer Windows x64 dan arm64 yang dapat diunduh dan **diperbarui otomatis**, changelog per versi, dan jalur pemulihan bila
sebuah rilis bermasalah.

## 2. Cakupan
Di dalam: rilis (PR rilis, workflow, build installer), tempat penyimpanan dan penyajian installer, tanda tangan rilis, pembaruan
otomatis di proses utama desktop. Di luar: halaman unduh dan daftar versi + changelog di web (bagian 5; ia memakai penyimpanan
dan manifest yang ditetapkan di sini), kode-tanda-tangan Authenticode (pertanyaan terbuka 6), macOS/Linux (keputusan pemilik: hanya Windows x64 dan arm64).

## 3. Keputusan yang sudah ada (dari bagian 1-3 dan pemilik)
- Tag `desktop-vX.Y.Z`; versinya di `desktop/package.json`; changelog dari fragmen `desktop/changelog.d/` ke `desktop/CHANGELOG.md`
  (bagian 1); perubahan `shared/` dan `countrylock/` mewajibkan fragmen desktop (bagian 1).
- Rilis dimulai dari PR rilis `release/desktop-vX.Y.Z` (dipotong dari ujung `dev`) ke `main` lewat `bun run release:prepare desktop <bump>`
  (bagian 1, 5.3); merge-nya memicu workflow rilis.
- Build CI desktop adalah pemeriksaan di PR (Windows x64 penuh + arm64 kemas silang; keputusan 2026-11-17); installer sungguhan baru
  dibuat di workflow rilis.
- Pembaruan UI web ke desktop tetap lewat manifest UI bertanda tangan yang ada, terpisah dari pembaruan biner ini.

### 3.1 Kendala rancangan (keputusan pemilik 2026-11-18)
- **Pengguna tidak boleh tahu repositori sumber.** Aplikasi desktop dan halaman web hanya berbicara dengan server QC (`serverUrl`, bawaan
  `https://qc.rhd.my.id`); tak ada URL `github.com`, nama pemilik, atau nama repositori di manifest, dialog pembaruan, galat, maupun
  log. `release-<versi>.json` dan changelog-nya hanya memuat teks untuk pengguna (tanpa tautan PR atau commit).
- **Tahan terhadap perubahan visibilitas repositori.** Repositori boleh dijadikan privat lagi kapan saja tanpa memutus pembaruan
  dan unduhan: sumber unduhan TIDAK BOLEH bergantung pada GitHub (baik API publik maupun aset Release) dan server TIDAK BOLEH memegang
  token baca repositori. GitHub Release privat/publik tetap dibuat, tetapi hanya sebagai arsip pemilik.
- Konsekuensi: penyimpanan di luar GitHub (4.1 pilihan C) dan semua unduhan disalurkan server (stream, bukan pengalihan ke host lain).

## 4. Pendekatan yang dipertimbangkan

### 4.1 Di mana installer disimpan dan siapa yang menyajikannya (tahan repo publik maupun privat)
| Pilihan | Keterangan | Putusan |
|---|---|---|
| A. Server memproksi aset GitHub Release memakai token baca | tanpa penyimpanan baru; tetapi token baca repo privat (PAT berkedaluwarsa, atau GitHub App) hidup di server, dan server yang disusupi membuka seluruh kode sumber | ditolak: hak akses berlebihan |
| B. CI mengunggah installer ke server lewat endpoint HTTP, disimpan di volume VPS | tanpa token repo; tetapi butuh endpoint tulis berbadan ~100 MB (batas badan global server hari ini ~10 MB, jadi memperbesar permukaan serangan memori), volume dan retensi baru | ditolak: permukaan tulis baru |
| A2. Server membaca GitHub Releases publik tanpa token (ditambahkan revisi 2, saat repositori publik) | sederhana, tanpa Drive; tetapi berhenti bekerja begitu repositori kembali privat (butuh token, yaitu pilihan A) dan menjadikan GitHub dependensi pengguna | ditolak: melanggar kendala 3.1 |
| **C. CI mengunggah ke folder Google Drive khusus; server membaca lewat klien Drive yang sudah ada** | memakai kode teruji (`uploadFile` resumable, `downloadFile` stream, penjaga folder), kuota dan peringatan kuota sudah ada, server hanya butuh hak baca satu folder; CI memegang kunci service account penerbit terpisah (tulis hanya di folder itu) | **dipilih** |

Dalam semua pilihan, aset yang sama juga dilampirkan ke GitHub Release privat sebagai arsip pemilik.

### 4.2 Mesin pembaruan di aplikasi
| Pilihan | Keterangan | Putusan |
|---|---|---|
| `electron-updater` dengan provider bawaan `github`/`generic` | matang, tetapi provider `github` di repo privat butuh token di klien (tak boleh), dan tanpa Authenticode ia hanya memverifikasi sha512 dari berkas metadata yang sama dengan sumber unduhan (server disusupi = installer palsu diterima) | ditolak |
| Pengunduh dan pemasang buatan sendiri | kendali penuh, tetapi menulis ulang logika pemasangan NSIS senyap, pengunduhan berlanjut, dan peluncuran ulang | ditolak: menulis ulang hal yang sudah matang |
| **`electron-updater` dengan *provider kustom*** | provider kita mengambil manifest rilis bertanda tangan Ed25519 dari server, **memverifikasi tanda tangan dengan kunci publik tertanam**, baru menyerahkan `UpdateInfo` (url, sha512, ukuran) ke `electron-updater`, yang mengunduh, memeriksa sha512, memasang senyap, dan meluncurkan ulang | **dipilih** (keputusan perancang; kemampuan provider kustom diverifikasi di spike awal rencana, 7) |

## 5. Rancangan

### 5.1 Versi dan berkas
- Versi awal rilis pertama: `1.0.0` (naik dari `0.1.0`); selanjutnya semver (bagian 1).
- `electron-builder.yml`: target `nsis` untuk `x64` dan `arm64`, `artifactName: QC-App-Setup-${version}-${arch}.${ext}`. Skrip `dist` membangun
  keduanya (`--win --x64 --arm64`); `pack`/`pack:all` untuk pemeriksaan CI tidak berubah.
- Installer tidak ditandatangani Authenticode (pertanyaan terbuka 6); integritas dijamin tanda tangan rilis (5.3).

### 5.2 Tata letak Drive (folder `DESKTOP_RELEASES_FOLDER_ID`)
Tata letak **datar** (keputusan pemilik 2026-11-18, menggantikan subfolder per versi di revisi 1-2: satu `listFolder` cukup, tanpa
pembuatan folder per versi, dan penjaga folder klien Google tetap sederhana karena berkas harus anak langsung folder yang dikonfigurasi):
```
<folder rilis>/
  QC-App-Setup-1.2.0-x64.exe
  QC-App-Setup-1.2.0-arm64.exe
  release-1.2.0.json     (manifest rilis, kanonik)
  release-1.2.0.sig      (tanda tangan Ed25519 atas release-1.2.0.json, base64url)
```
`release-<versi>.json`: `{ schema: 1, version, publishedAt, files: [{ name, arch, size, sha512 }], changelog }` (`changelog` = bagian versi itu dari
`desktop/CHANGELOG.md`, teks terstruktur per jenis dari bagian 1; `sha512` = base64 baku 88 karakter, konvensi `electron-updater`).
Versi **tidak terlihat** sampai `release-<versi>.sig` terunggah (urutan unggah: tanda tangan lama dihapus, installer, manifest, terakhir
`.sig`); menarik rilis = menghapus `release-<versi>.sig`. Kontrak murni dan penguraiannya: `shared/desktop-release.ts`.

### 5.3 Tanda tangan rilis
Pasangan kunci Ed25519 **terpisah** dari kunci manifest UI (membatasi dampak bocor), dibuat dengan perkakas yang sama (skrip bangkit
kunci/periksa pasangan diumumkan di `docs/desktop-release-signing.md`, pola `docs/desktop-ui-signing.md`). Kunci privat =
secret `DESKTOP_RELEASE_SIGNING_KEY` pada environment `desktop-release` (dibatasi ke branch `main`); kunci publik = variable
`DESKTOP_RELEASE_PUBLIC_KEY_PEM`, disuntikkan saat build desktop persis seperti `UI_PUBLIC_KEY_PEM` (`ui-public-key.ts`); build rilis
menolak berjalan tanpanya. Server tidak memegang kunci apa pun dan hanya meneruskan.

### 5.4 Server (hanya bagian pembaruan; daftar versi untuk web = bagian 5)
- Konfigurasi `DESKTOP_RELEASES_FOLDER_ID` (ditambah ke `config.ts`, `deploy/compose.yml`, `deploy/.env.example`, dan daftar folder
  terjaga klien Google; dijaga `deploy-files.test.ts`). Kosong = fitur nonaktif (404).
- `GET /api/desktop/app-manifest?arch=x64|arm64` (publik, tanpa sesi, di sub-aplikasi `desktopApp` bersama `ui-manifest`): versi
  tertinggi yang punya `release-<versi>.sig` dan memuat berkas untuk `arch`; jawaban `{ manifest, signature }` (byte persis manifest dan
  tanda tangan dari Drive, tanpa memegang kunci); semua kegagalan = 404
  generik; cache pendek di memori (menit) agar Drive tak dipanggil per permintaan; `ETag`/304.
- `GET /api/desktop/app-file/<versi>/<nama>` (publik, stream `application/octet-stream`, `no-transform`): hanya nama yang tercantum
  di `release-<versi>.json` yang valid dan `release-<versi>.sig`-nya ada; selainnya 404; **pembatas laju 60 unduhan installer per IP per jam**
  (tabel `rate_limits`, kunci `desktop-app-file:<ip>`; keputusan perancang 2, 2026-11-18, di luar rancangan awal; angka 60 menggantikan 20 yang
  diusulkan karena beberapa perangkat di balik satu IP kantor memperbarui bersamaan; dapat dibuang tanpa mengubah kontrak). Publik karena integritas dijaga tanda tangan, sama dengan
  `ui-file` (Country Lock harus dapat diperbarui tanpa login); installer tidak memuat rahasia (isinya sama dengan UI publik).
- Tes: rute dengan klien Drive palsu (daftar putih, 404 seragam, bentuk manifest, versi tanpa `.sig` tak terlihat).

### 5.5 Aplikasi desktop (`desktop/src/main/update/`)
- `app-update-provider.ts`: provider kustom `electron-updater`. Menolak: tanda tangan tak sah, `schema` tak dikenal, versi ≤ versi
  terpasang, arsitektur tanpa berkas, nama berkas bertanda `/`/`..`, `sha512`/`size` tak valid.
- `app-updater.ts`: dimulai hanya bila `app.isPackaged`, bukan mode `--smoke`/`--smoke-ui`, dan `serverUrl` valid (aturan `settings.ts`);
  cek saat start (tertunda) dan tiap 6 jam; **pembaruan tidak pernah dipasang saat inject Country Lock berjalan** (dijaga seperti
  `ui reload`); `autoDownload=false`.
- Pengalaman pengguna: dialog bawaan OS (tanpa kanal jembatan baru, jadi tidak menaikkan `BRIDGE_VERSION`) berisi versi dan ringkasan
  changelog dengan pilihan "Perbarui sekarang" / "Nanti"; "Nanti" menunda hingga cek berikutnya; pembaruan terunduh dipasang
  saat keluar bila belum dipilih. Pembaruan tidak memaksa; versi UI/jembatan yang tak cocok tetap ditangani gerbang `minBridge` yang ada.
- Pembaruan berjalan tanpa login (Country Lock tak butuh login); tanpa Bearer dan tanpa cookie.
- `electron-updater` ditambah ke dependensi desktop (versi dipatok); build desktop menyertakannya di asar.

### 5.6 Workflow rilis desktop (jalur desktop di `release.yml`)
**Diubah 2026-11-19 (keputusan pemilik produk, `2026-11-19-rilis-gabungan-design.md`)**: workflow ini tidak lagi berkas sendiri (`release-desktop.yml`
dihapus); jalurnya menjadi job bersyarat di `release.yml` bersama jalur server, dengan nama job `build-desktop` dan `publish-desktop` (yang di bawah
disebut `build` dan `publish`), `meta` dan `ci` dipakai bersama, dan pemicu `workflow_dispatch` memakai input `komponen`+`versi` (pemulihan) atau `tarik`.
Isi jalur (identitas, `ci` dengan `desktop-check`, build tanpa kunci penandatangan, publish dengan kunci, pemisahan rahasia, penarikan) tidak berubah.
`pull_request_target` (closed, merged, base `main`) dari `release/desktop-vX.Y.Z` (atau cabang gabungan `release/gabungan-server-vX.Y.Z-desktop-vA.B.C`):
1. **meta**: pagar identitas yang sama dengan rilis server (repo sama, cabang cocok regex, `desktop/package.json` pada commit merge
   = versi di nama cabang, merge commit 2 induk, bagian CHANGELOG versi itu ada); logika dipakai bersama (`scripts/release-identity.ts`).
2. **test**: memanggil `ci.yml` pada commit merge dengan `desktop-check` benar (tes desktop, kemas x64+arm64, `verify-pack`); karena desktop
   tak punya staging, **pemeriksaan ini pengganti uji staging** pada rilis desktop.
3. **build** (Windows, environment `desktop-release`): `bun run build:desktop` (x64+arm64) dengan `UI_PUBLIC_KEY_PEM`,
   `DESKTOP_RELEASE_PUBLIC_KEY_PEM`, dan `CATALOG_TOKEN` (secret `DESKTOP_CATALOG_TOKEN`; token katalog memang tertanam di installer; kosong =
   katalog nonaktif pada build ini); `verify-pack` x64 (`QC App.exe --smoke` penuh) dan arm64 (statis); installer diunggah sebagai artefak antar
   job. Job ini **tidak** memegang kunci tanda tangan maupun kunci Drive (lihat bagian 7, keputusan 6).
4. **publish** (Ubuntu, `contents: write`, tanpa `bun install`): `scripts/publish-desktop-release.ts` menghitung sha512 dan ukuran, menulis
   `release-<versi>.json`, menandatanganinya (kunci privat dari secret `DESKTOP_RELEASE_SIGNING_KEY`, diperiksa terhadap kunci publik tertanam), lalu
   mengunggah ke Drive (klien Google yang sama dengan server, kunci SA penerbit dari secret `DESKTOP_DRIVE_PUBLISHER_KEY`, folder dari variable):
   hapus `.sig` lama, installer, manifest, **terakhir** `.sig`; MD5 dan ukuran dari Drive diverifikasi, berkas cacat dibuang; idempoten
   (berkas yang sudah utuh dipakai ulang) sehingga dapat diulang lewat `workflow_dispatch` (`versi`) bila gagal di tengah. **Baru setelah unggahan
   sukses** dibuat tag `desktop-vX.Y.Z` dan GitHub Release berisi catatan rilis (`scripts/changelog.ts extract desktop`) dan installer yang sama
   dengan di Drive (bagian 7, keputusan 7 revisi); pemulihan menimpa lampiran (`--clobber`). Terakhir `pruneInstallers` (gagal = peringatan).
5. **sync-dev**: workflow bersama `sync-dev.yml` (dipakai juga `release.yml`; input `sha`, `version`, `komponen`), kegagalan hanya peringatan.
Penarikan: job `withdraw` terpisah (hanya `workflow_dispatch` dengan `tarik`; menghapus `.sig`).
Izin per job minimal; `contents: write` hanya pada `publish` (`sync-dev` memakai deploy key, token hanya-baca); semua nilai lewat `env`, tanpa `${{ }}` di `run`;
aksi pihak ketiga dipatok SHA; `ci-workflows.test.ts` diperluas (pemicu, izin, regex cabang, urutan unggah, pemisahan rahasia per job). Tanpa saklar
`RELEASE_FLOW` (bagian 7, keputusan 8).

### 5.7 Penarikan dan downgrade
- Rilis bermasalah: `workflow_dispatch` `tarik` (hapus `release-<versi>.sig` versi itu); pembaruan berikutnya memilih versi tertinggi yang tersisa.
  Pengguna yang sudah memperbarui memasang installer versi lama dari halaman unduh (bagian 5); installer NSIS yang lebih lama
  di atas yang baru dapat membutuhkan pencopotan lebih dulu (dicatat saat implementasi).
- Pembaruan otomatis hanya naik (versi > terpasang); downgrade adalah tindakan manual yang disengaja.
- Retensi: dipertahankan 10 versi terbaru (urutan numerik, satu himpunan versi untuk kedua arsitektur; `pruneInstallers` jalan setelah publish dan menghapus
  installer, manifest, dan `.sig` versi yang lebih lama; berkas yang bukan nama rilis tak disentuh); GitHub Release (catatan) tetap. Revisi 3:
  manifest versi lama ikut dihapus agar daftar Drive tak menumpuk dan tak menyisakan manifest yang installernya sudah tak ada.

### 5.8 Dokumentasi
`docs/ci-cd.md` (alur rilis desktop), `docs/desktop-release-signing.md` (kunci, environment, SA penerbit, langkah pemilik),
`docs/setup-google.md` (SA penerbit + folder), `CLAUDE.md` (ringkas), `docs/e2e-checklist-desktop.md` (uji pembaruan di perangkat nyata).

## 6. Risiko dan pertanyaan terbuka
- **Disetujui pemilik 2026-11-18** (dokumen dan rencana): penyimpanan Drive (4.1 C) dan unduhan installer yang **publik** (integritas dari
  tanda tangan, bukan dari kerahasiaan). Catatan revisi 3: installer memuat token katalog bersama (`CATALOG_TOKEN`), jadi "tidak memuat rahasia"
  hanya berlaku untuk rahasia berdampak tinggi; token itu sudah berstatus terdistribusi di installer (CLAUDE.md, katalog Tipe offline) dan
  tidak memberi akses selain katalog item Country lock.
- **Authenticode (belum diputuskan)**: tanpa sertifikat penandatanganan kode, Windows SmartScreen memperingatkan "penerbit tak dikenal"
  saat pemasangan pertama (pembaruan senyap tidak terpengaruh). Opsi (berbayar): sertifikat OV/EV atau Azure Trusted Signing.
  Rancangan ini tidak bergantung padanya dan dapat menambahkannya nanti (`electron-updater` lalu memverifikasi `publisherName`).
- **Serangan pembekuan**: penyerang yang memegang server dapat menahan pembaruan (tak dapat memalsukannya). Diterima.
- **Spike awal rencana**: **selesai sebagian** (rencana Task 1, tes kontrak `updater-contract.test.ts`): provider kustom `electron-updater` 6.8.11
  dapat diturunkan dari `Provider` dan dipakai lewat `setFeedURL({ provider: 'custom', updateProvider })`. Temuan: unduhan butuh `updaterCacheDirName`
  dari `app-update.yml`, sedangkan build `publish: null` tak menghasilkannya; aplikasi menulis berkas itu sendiri dan memakai setter publik
  `updateConfigPath` (bagian 7, keputusan 9). **Belum terbukti** (tetap di checklist K): pemasangan senyap dan peluncuran ulang NSIS per
  pengguna pada perangkat x64 dan arm64 nyata. Bila gagal, jatuh ke pengunduh buatan sendiri (4.2) dengan rancangan keamanan yang sama.
- **Repositori kembali privat atau publik**: tidak berdampak pada pembaruan atau unduhan (kendala 3.1). Yang berubah hanya GitHub Release arsip
  (bagi pemilik). Uji penerimaan: aplikasi dan server berfungsi penuh dengan token GitHub apa pun dicabut.
- **Kuota Drive**: installer ~100 MB x 2 arsitektur x 10 versi; peringatan kuota yang ada berlaku; retensi 5.7.
- **Dua kunci tanda tangan baru** (rilis + SA penerbit) menambah pekerjaan operasi pemilik; didokumentasikan di 5.8.
- Pada desktop non-terkemas (pengembangan) pembaruan nonaktif; uji pembaruan nyata hanya lewat checklist manual.
- Keputusan perancang lain (dapat diubah): dialog OS, bukan layar dalam aplikasi; cek tiap 6 jam; retensi 10 versi; installer publik.

## 7. Catatan keputusan (log, 2026-11-18)
Keputusan 1-5 disetujui pemilik pada 2026-11-18 bersama rencana implementasi; keputusan 6-10 diambil pelaksana saat implementasi. Atas
tinjauan akhir, pemilik pada 2026-11-18 memutuskan: keputusan 7 DIBALIK (installer dilampirkan), keputusan 10 dan M8 disetujui (token katalog
diperlakukan publik), dan M4 disetujui (lihat 11-12). Keputusan **6, 8, dan 9 disetujui pemilik pada 2026-11-19** setelah penjelasan (6: kunci
penandatangan hanya di job `publish`; 8: tanpa saklar `RELEASE_FLOW` karena rilis desktop tak men-deploy production dan salah rilis dapat
ditarik lewat `withdraw`; 9: `app-update.yml` dua baris buatan aplikasi sendiri). Dengan itu semua keputusan 1-12 final.
1. **Tata letak Drive datar** (bukan subfolder per versi): satu folder, nama berkas membawa versi. Mengubah 5.2 revisi 1-2. Alasan: pembacaan dan
   penjaga folder lebih sederhana, tanpa pembuatan folder per versi.
2. **Pembatas laju unduhan installer per IP** (60 per jam; di luar rancangan awal, boleh dibuang): kunci `desktop-app-file:<ip>` di `rate_limits`,
   respons 429 problem+json. Melindungi kuota unduhan Drive dari pemindaian.
3. **`sha512` base64 baku** di manifest (konvensi `electron-updater`), bukan heksa.
4. **"Tidak ada pembaruan"** dikembalikan diam-diam oleh provider sebagai `UpdateInfo` versi terpasang (bukan galat): pengguna tak melihat apa pun
   dan log tak dipenuhi galat palsu.
5. **Urutan publish dibalik**: unggah Drive (installer, manifest, `.sig` terakhir) lebih dulu, baru tag + GitHub Release; Release tak pernah ada
   tanpa unggahan yang sukses. Mengubah urutan di 5.6 revisi 1-2.
6. **Penandatanganan manifest di job `publish`, bukan `build`**: job build menjalankan kode dependensi dan electron-builder, jadi kunci
   penandatangan tidak ditaruh di sana; `publish` tidak memasang dependensi (skrip hanya memakai `node:*`, WebCrypto, dan `fetch`). Mengubah 5.6 butir 3.
7. **Installer DILAMPIRKAN ke GitHub Release** (bersama catatan rilis). Pelaksana semula memutuskan sebaliknya (token katalog tertanam di installer dan
   repositori ini publik), tetapi pemilik memutuskan pada 2026-11-18 bahwa token katalog memang diperlakukan publik (butir 11), sehingga
   melampirkan tak menambah paparan; Release menjadi arsip installer di luar Drive. Pengguna dan aplikasi tetap mengunduh lewat server QC, bukan GitHub.
   Pemulihan `versi` menimpa lampiran (`gh release upload --clobber`) agar sama dengan Drive. Menggantikan keputusan pelaksana semula; sesuai 5.6 butir 4
   revisi 1-2 ("berisi installer"). Bila repositori kembali privat, lampiran hanya terlihat pemilik/kolaborator.
8. **Tanpa saklar `RELEASE_FLOW`** pada jalur desktop (sejak 2026-11-19 bagian dari `release.yml`; saklar hanya berlaku pada jalur server) (rilis desktop tak men-deploy production; `release:prepare` yang menjaga), penarikan lewat
   job `withdraw` terpisah, `ci` memakai `desktop-check` tanpa daftar berkas (semua pemeriksaan, fail-safe), dan `sync-dev.yml` punya grup concurrency
   sendiri.
9. **`app-update.yml` ditulis aplikasi sendiri** (`<userData>/updater/`, lewat setter publik `updateConfigPath`): satu-satunya cara agar provider kustom
   mendapat `updaterCacheDirName` tanpa berkas bawaan builder; dijaga `updater-contract.test.ts`.
10. **Job `build` menerima secret `DESKTOP_CATALOG_TOKEN`** (hanya di langkah build): tanpanya katalog Tipe offline nonaktif pada installer hasil CI.
    **Disetujui pemilik 2026-11-18** (katalog diaktifkan di build CI; nama secret tetap).
11. **Token katalog diperlakukan publik** (pemilik, 2026-11-18; menutup temuan tinjauan M8): installer diunduh siapa saja lewat `app-file` tanpa sesi,
    jadi token yang tertanam di dalamnya efektif terbuka bagi siapa pun yang mengunduh installer. Diterima: token hanya membuka katalog item Country
    lock (tanpa akses lain) dan sudah berstatus terdistribusi (CLAUDE.md, katalog Tipe offline). Konsekuensi: melindungi installer tidak berguna
    untuk menjaga token (lihat keputusan 7); rotasi token (ganti di `.env` VPS dan secret environment lalu rilis ulang) bila perlu.
12. **"Nanti" tidak membungkam sepanjang sesi** (pemilik, 2026-11-18; menutup temuan tinjauan M4; sesuai 5.5): "Nanti" pada dialog tawaran
    menunda hingga cek berikutnya (tiap 6 jam), dan unduhan yang gagal ditawarkan serta dicoba lagi pada cek berikutnya. Versi yang sudah terunduh tak
    ditanyakan atau diunduh lagi (terpasang saat keluar). Kode semula membungkam versi itu sepanjang sesi; diperbaiki di `app-updater.ts`.
