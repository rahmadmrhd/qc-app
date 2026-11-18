# Rilis aplikasi desktop dan auto-update (bagian 4 dari seri rilis semver)

Status: **menunggu persetujuan pemilik** (revisi 1, 2026-11-17). Seri: 1 fondasi rilis + changelog dan 2 deploy lewat tag
(`2026-11-17-rilis-semver-design.md`), 3 bundling backend (`2026-11-17-bundling-backend-design.md`), **4 dokumen ini**,
5 halaman unduh + tampilan changelog di web (dokumen terpisah).

## 1. Maksud dan alasan
Aplikasi desktop (Electron, Windows) hari ini hanya dapat dipasang dari hasil `bun run build:desktop` pemilik; belum ada rilis
berversi, belum ada pembaruan biner (hanya UI-nya yang diperbarui lewat manifest bertanda tangan), dan repositori privat sehingga
GitHub Releases tidak dapat dipakai langsung oleh aplikasi maupun pengguna. Tujuan: rilis desktop dengan semver (`desktop-vX.Y.Z`),
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

## 4. Pendekatan yang dipertimbangkan

### 4.1 Di mana installer disimpan dan siapa yang menyajikannya (repo privat)
| Pilihan | Keterangan | Putusan |
|---|---|---|
| A. Server memproksi aset GitHub Release memakai token baca | tanpa penyimpanan baru; tetapi token baca repo privat (PAT berkedaluwarsa, atau GitHub App) hidup di server, dan server yang disusupi membuka seluruh kode sumber | ditolak: hak akses berlebihan |
| B. CI mengunggah installer ke server lewat endpoint HTTP, disimpan di volume VPS | tanpa token repo; tetapi butuh endpoint tulis berbadan ~100 MB (batas badan global server hari ini ~10 MB, jadi memperbesar permukaan serangan memori), volume dan retensi baru | ditolak: permukaan tulis baru |
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
```
<folder rilis>/
  1.2.0/
    QC-App-Setup-1.2.0-x64.exe
    QC-App-Setup-1.2.0-arm64.exe
    release.json        (manifest rilis, kanonik)
    release.sig         (tanda tangan Ed25519 atas release.json, base64url)
```
`release.json`: `{ schema: 1, version, publishedAt, files: [{ name, arch, size, sha512 }], changelog }` (`changelog` = bagian versi itu dari
`desktop/CHANGELOG.md`, teks terstruktur per jenis dari bagian 1). Versi **tidak terlihat** sampai `release.sig` terunggah
(urutan unggah: installer, `release.json`, terakhir `release.sig`); menarik rilis = menghapus `release.sig` versi itu.

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
  tertinggi yang punya `release.sig` dan memuat berkas untuk `arch`; jawaban `{ manifest, signature }`; semua kegagalan = 404
  generik; cache pendek di memori (menit) agar Drive tak dipanggil per permintaan; `ETag`/304.
- `GET /api/desktop/app-file/<versi>/<nama>` (publik, stream `application/octet-stream`, `no-transform`): hanya nama yang tercantum
  di `release.json` yang valid dan `release.sig`-nya ada; selainnya 404. Publik karena integritas dijaga tanda tangan, sama dengan
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

### 5.6 Workflow rilis desktop (`release-desktop.yml`)
`pull_request_target` (closed, merged, base `main`) dari `release/desktop-vX.Y.Z`:
1. **meta**: pagar identitas yang sama dengan rilis server (repo sama, cabang cocok regex, `desktop/package.json` pada commit merge
   = versi di nama cabang, merge commit 2 induk, bagian CHANGELOG versi itu ada); logika dipakai bersama (`scripts/release-identity.ts`).
2. **test**: memanggil `ci.yml` pada commit merge dengan `desktop-check` benar (tes desktop, kemas x64+arm64, `verify-pack`); karena desktop
   tak punya staging, **pemeriksaan ini pengganti uji staging** pada rilis desktop.
3. **build** (Windows, environment `desktop-release`): `bun run build:desktop` (x64+arm64) dengan `UI_PUBLIC_KEY_PEM` dan
   `DESKTOP_RELEASE_PUBLIC_KEY_PEM`; hitung sha512 dan ukuran; tulis `release.json`; tanda tangani; `verify-pack` pada installer x64
   hasil rilis (`QC App.exe --smoke`).
4. **publish**: buat tag `desktop-vX.Y.Z` dan GitHub Release privat berisi installer + changelog (`scripts/changelog.ts extract desktop`);
   unggah ke Drive berurutan (installer, `release.json`, `release.sig`) memakai `scripts/publish-desktop-release.ts` (klien Google yang sama dengan
   server, kunci SA penerbit dari secret `DESKTOP_DRIVE_PUBLISHER_KEY`, folder dari variable); idempoten (timpa menurut nama) sehingga
   dapat diulang lewat `workflow_dispatch` (`versi`) bila gagal di tengah.
5. **sync-dev**: seperti rilis server (bagian 1, 5.4).
Izin per job minimal; `contents: write` hanya pada `publish` (`sync-dev` memakai deploy key, token hanya-baca); semua nilai lewat `env`, tanpa `${{ }}` di `run`;
aksi pihak ketiga dipatok SHA; `ci-workflows.test.ts` diperluas (pemicu, izin, regex cabang, urutan unggah).

### 5.7 Penarikan dan downgrade
- Rilis bermasalah: `workflow_dispatch` `tarik` (hapus `release.sig` versi itu); pembaruan berikutnya memilih versi tertinggi yang tersisa.
  Pengguna yang sudah memperbarui memasang installer versi lama dari halaman unduh (bagian 5); installer NSIS yang lebih lama
  di atas yang baru dapat membutuhkan pencopotan lebih dulu (dicatat saat implementasi).
- Pembaruan otomatis hanya naik (versi > terpasang); downgrade adalah tindakan manual yang disengaja.
- Retensi: biner dipertahankan untuk 10 versi terbaru per arsitektur (skrip `prune`, jalan setelah publish); `release.json` dan GitHub Release tetap.

### 5.8 Dokumentasi
`docs/ci-cd.md` (alur rilis desktop), `docs/desktop-release-signing.md` (kunci, environment, SA penerbit, langkah pemilik),
`docs/setup-google.md` (SA penerbit + folder), `CLAUDE.md` (ringkas), `docs/e2e-checklist-desktop.md` (uji pembaruan di perangkat nyata).

## 6. Risiko dan pertanyaan terbuka
- **Menunggu persetujuan pemilik**: seluruh dokumen; terutama dua keputusan perancang: penyimpanan Drive (4.1 C) dan unduhan installer
  yang **publik** (integritas dari tanda tangan, bukan dari kerahasiaan; installer tidak memuat rahasia).
- **Authenticode (belum diputuskan)**: tanpa sertifikat penandatanganan kode, Windows SmartScreen memperingatkan "penerbit tak dikenal"
  saat pemasangan pertama (pembaruan senyap tidak terpengaruh). Opsi (berbayar): sertifikat OV/EV atau Azure Trusted Signing.
  Rancangan ini tidak bergantung padanya dan dapat menambahkannya nanti (`electron-updater` lalu memverifikasi `publisherName`).
- **Serangan pembekuan**: penyerang yang memegang server dapat menahan pembaruan (tak dapat memalsukannya). Diterima.
- **Spike awal rencana (wajib sebelum implementasi)**: memastikan provider kustom `electron-updater` dapat dipakai tanpa `app-update.yml`
  yang dibuat electron-builder, dan bahwa flag pemasangan senyap/peluncuran ulang bekerja untuk NSIS per pengguna pada arm64 dan x64.
  Bila gagal, jatuh ke pengunduh buatan sendiri (4.2) dengan rancangan keamanan yang sama.
- **Kuota Drive**: installer ~100 MB x 2 arsitektur x 10 versi; peringatan kuota yang ada berlaku; retensi 5.7.
- **Dua kunci tanda tangan baru** (rilis + SA penerbit) menambah pekerjaan operasi pemilik; didokumentasikan di 5.8.
- Pada desktop non-terkemas (pengembangan) pembaruan nonaktif; uji pembaruan nyata hanya lewat checklist manual.
- Keputusan perancang lain (dapat diubah): dialog OS, bukan layar dalam aplikasi; cek tiap 6 jam; retensi 10 versi; installer publik.
