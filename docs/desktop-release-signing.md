# Rilis aplikasi desktop: langkah pemilik

Aplikasi desktop dirilis dengan semver (`desktop-vX.Y.Z`, installer Windows x64 dan arm64) dan **memperbarui dirinya sendiri**. Installer disimpan di **Google Drive** dan disalurkan oleh **server QC**: pengguna dan aplikasi tidak pernah menyentuh GitHub, jadi repositori boleh kembali privat dan token GitHub boleh dicabut tanpa memengaruhi pembaruan (keputusan pemilik 2026-11-18, spek `docs/superpowers/specs/2026-11-17-rilis-desktop-auto-update-design.md` kendala 3.1). Integritas dijaga **tanda tangan Ed25519** atas manifest rilis yang diverifikasi aplikasi dengan kunci publik tertanam, jadi server dan Drive tidak perlu dipercaya. Alur workflow: `docs/ci-cd.md` ("Rilis aplikasi desktop"); pola kunci: `docs/desktop-ui-signing.md` (kunci manifest UI, **terpisah** dari kunci rilis ini).

## Nama yang dipakai

Semua nilai di bawah disimpan pada **environment GitHub `desktop-release`** (Settings > Environments), yang dibatasi ke ref `main` (aturan *Deployment branches*). Jangan memakai secret repositori biasa: ia terbaca workflow mana pun, termasuk yang diubah di branch PR.

| Nama | Isi | Jenis | Dipakai oleh |
|---|---|---|---|
| `DESKTOP_RELEASE_SIGNING_KEY` | Kunci **privat** Ed25519 penandatangan rilis (PEM PKCS8, berbaris banyak) | **Secret** | Job `publish` (menandatangani `release-<versi>.json`) |
| `DESKTOP_DRIVE_PUBLISHER_KEY` | Isi JSON kunci **service account penerbit** (hanya berhak menulis folder rilis) | **Secret** | Job `publish` dan `withdraw` |
| `DESKTOP_CATALOG_TOKEN` | Token katalog Tipe offline (nilai SAMA dengan `DESKTOP_CATALOG_TOKEN` di `.env` VPS) | **Secret** | Langkah build installer (tertanam di installer; `CATALOG_TOKEN` pada build lokal). Kosong = katalog nonaktif pada build CI |
| `DESKTOP_RELEASE_PUBLIC_KEY_PEM` | Kunci **publik** rilis, bentuk **satu baris** (isi base64) | **Variable** | Build installer (ditanam di aplikasi) dan `publish` (memeriksa pasangan sebelum menandatangani) |
| `DESKTOP_RELEASES_FOLDER_ID` | Id folder Drive rilis | **Variable** | `publish` dan `withdraw` |
| `UI_PUBLIC_KEY_PEM` | Kunci publik manifest UI (sama dengan yang dipakai build image server) | **Variable** | Build installer (pembaruan UI web; lihat `docs/desktop-ui-signing.md`) |

Kunci privat penandatangan **tidak** ada di job `build` (yang menjalankan kode dependensi dan electron-builder) dan **tidak** ada di server. Job `publish` tidak memasang dependensi apa pun.

## 1. Bangkitkan kunci rilis (sekali, di mesin pribadi)

```
bun run scripts/gen-release-signing-key.ts C:\jalur\pribadi\qc.release-signing-key.pem
```

- Nama berkas privat **harus** berakhiran `.release-signing-key.pem` (ditangkap `.gitignore`); skrip menolak menimpa berkas yang sudah ada.
- Kunci privat ditulis ke berkas itu dan **tidak dicetak**. Kunci publik ditulis ke `qc.release-signing-key.pub.pem` dan dicetak dalam tiga bentuk: PEM, **nilai satu baris untuk `DESKTOP_RELEASE_PUBLIC_KEY_PEM`**, dan sidik SHA-256.
- Di Windows izin `0600` tidak berlaku: simpan di folder pribadi, jangan di dalam repositori atau folder yang disinkronkan publik. Buat **cadangan** kunci privat di tempat aman. Kunci privat hilang atau bocor = harus merilis aplikasi dengan kunci publik baru (lihat "Rotasi").
- Kunci ini **berbeda** dari kunci manifest UI; jangan memakai berkas yang sama.

## 2. Siapkan folder Drive dan service account penerbit

1. Buat folder Drive khusus rilis (mis. `QC App Rilis Desktop`) di akun pemilik. Catat **id folder** (bagian terakhir URL). Folder ini **bukan** anak folder induk aplikasi: server hanya mengenalnya lewat `DESKTOP_RELEASES_FOLDER_ID`.
2. Buat service account **penerbit** terpisah dari service account server (`docs/setup-google.md` S1, tanpa peran IAM project): kuncinya hanya dipakai CI dan hanya perlu menulis folder ini. Unduh kunci JSON-nya.
3. Bagikan folder: service account **penerbit** sebagai **Editor**, dan service account **server** (yang sudah ada) sebagai **Viewer** (server hanya membaca; `docs/setup-google.md` S9).
4. Folder harus berisi hanya berkas rilis: `QC-App-Setup-<versi>-<arch>.exe`, `release-<versi>.json`, `release-<versi>.sig` (tata letak **datar**, keputusan pemilik 2026-11-18). Berkas lain diabaikan server dan penyapu retensi.

## 3. Isi environment `desktop-release`

1. Settings > Environments > New environment `desktop-release`; *Deployment branches* = hanya `main`.
2. **Secret**: `DESKTOP_RELEASE_SIGNING_KEY` (ISI berkas `.release-signing-key.pem`), `DESKTOP_DRIVE_PUBLISHER_KEY` (ISI JSON kunci service account penerbit), `DESKTOP_CATALOG_TOKEN` (nilai yang sama dengan `.env` VPS; boleh dikosongkan, katalog Tipe offline lalu nonaktif pada installer hasil CI).
3. **Variable**: `DESKTOP_RELEASE_PUBLIC_KEY_PEM` (nilai satu baris dari langkah 1), `DESKTOP_RELEASES_FOLDER_ID`, dan `UI_PUBLIC_KEY_PEM` (Variable repositori yang sudah ada boleh dipakai).
4. Jangan menempelkan kunci ke issue, PR, log, atau obrolan.

## 4. Konfigurasi server (VPS)

Tambahkan di `.env` setiap environment (`staging` dan `production`) lalu `docker compose up -d` **sebelum** push yang men-deploy (perubahan `.env` tidak dibawa CI; `docs/ci-cd.md`):

```
DESKTOP_RELEASES_FOLDER_ID=<id folder rilis>
```

Kosong = fitur nonaktif: `GET /api/desktop/app-manifest` dan `/api/desktop/app-file/...` menjawab 404 dan aplikasi tidak menawarkan pembaruan. Rute (publik, tanpa sesi): `app-manifest?arch=x64|arm64` (versi tertinggi yang punya `.sig`, mengembalikan `{ manifest, signature }`) dan `app-file/<versi>/<nama>` (aliran installer; hanya nama yang tercantum di manifest; dibatasi 60 unduhan per IP per jam). Server tidak memegang kunci rilis apa pun.

## 5. Merilis

1. Dari `dev`: `bun run release:prepare desktop <patch|minor|major|X.Y.Z>` (menyiapkan cabang `release/desktop-vX.Y.Z` yang menaikkan `desktop/package.json` dan merangkum fragmen `desktop/changelog.d/`; rinci di `docs/ci-cd.md`), lalu buka PR cabang itu ke `main`. Rilis pertama: `1.0.0`.
2. Merge PR itu ke `main` dengan **merge commit** (squash/rebase ditolak pagar identitas). `release-desktop.yml` berjalan: `meta` -> `ci` -> `build` -> `publish` -> `sync-dev`.
3. `publish` mengunggah installer, `release-<versi>.json`, lalu `release-<versi>.sig` **terakhir**: versi baru baru terlihat pengguna saat `.sig` ada. Setelah itu tag `desktop-vX.Y.Z` dan GitHub Release (catatan rilis dan installer x64 + arm64 yang sama dengan di Drive; keputusan pemilik 2026-11-18, token katalog diperlakukan publik) dibuat, dan Drive dibersihkan ke 10 versi terbaru.
4. Run gagal di tengah: jalankan ulang lewat Actions > Release Desktop > Run workflow, input `versi` (tag yang sudah ada pada commit yang sama dilewati; installer dibangun ulang dan NSIS tidak reproducible, jadi MD5-nya berbeda dan installer yang sudah live ditimpa. `.sig` lama dihapus lebih dulu, sehingga versi itu hilang dari server selama unggah ulang (sekitar 200 MB) dan tetap hilang bila run gagal sampai dijalankan ulang; pengguna yang sedang mengunduh pada saat itu gagal verifikasi `sha512` dan mencoba lagi pada cek berikutnya. Jalankan pemulihan di luar jam kerja bila versinya sudah terlihat pengguna).
5. Pemeriksaan: `GET https://qc.rhd.my.id/api/desktop/app-manifest?arch=x64` menjawab 200 dengan `signature`; pasang versi sebelumnya dan ikuti `docs/e2e-checklist-desktop.md` bagian J.

## 6. Menarik rilis bermasalah

Actions > Release Desktop > Run workflow, input `tarik` = versi (mis. `1.2.0`), **kosongkan** `versi`. Job `withdraw` menghapus HANYA `release-<versi>.sig`: server berhenti menyajikan versi itu dan pembaruan berikutnya memilih versi tertinggi yang tersisa. Installer, manifest, dan tag tetap ada untuk penelusuran. Pengguna yang sudah memperbarui tidak diturunkan otomatis (pembaruan hanya naik); mereka memasang installer versi lama secara manual, dan NSIS dapat meminta pencopotan lebih dulu.

## 7. Rotasi dan pencabutan

- **Kunci rilis bocor atau hilang**: bangkitkan pasangan baru (langkah 1), perbarui secret dan Variable, lalu rilis aplikasi baru dengan kunci publik baru. Aplikasi lama (kunci publik lama) tidak akan menerima manifest yang ditandatangani kunci baru: pengguna harus memasang installer baru secara manual satu kali.
- **Kunci service account penerbit bocor**: hapus kunci itu di Google Cloud Console, buat yang baru, ganti secret `DESKTOP_DRIVE_PUBLISHER_KEY`. Penyerang dengan kunci ini hanya dapat menaruh berkas di Drive; tanpa kunci rilis ia tidak dapat membuat manifest yang diterima aplikasi.
- **Token GitHub dicabut atau repositori dijadikan privat**: tidak berdampak pada pembaruan (hanya GitHub Release arsip bagi pemilik).

## 8. Build lokal untuk uji

```powershell
$env:UI_PUBLIC_KEY_PEM = '<satu baris>'
$env:DESKTOP_RELEASE_PUBLIC_KEY_PEM = '<satu baris>'
$env:CATALOG_TOKEN = '<token katalog>'   # opsional
bun run build:desktop
```

`dist` menolak berjalan tanpa kedua kunci publik. Build lokal ini tidak mengunggah apa pun; penerbitan hanya lewat `release-desktop.yml`. Pembaruan otomatis hanya aktif pada aplikasi **terkemas** (`app.isPackaged`) dengan kunci publik rilis tertanam; build pengembangan tidak pernah memeriksa pembaruan.
