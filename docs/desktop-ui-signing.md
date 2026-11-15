# Penandatanganan UI desktop: langkah pemilik

Aplikasi desktop membawa UI dasar yang dibundel dan dapat mengunduh UI web terbaru. Setiap bundel unduhan diverifikasi dengan **tanda tangan Ed25519** atas manifest (`ui-manifest.json`). Kunci **privat** hanya dipegang pemilik/CI; kunci **publik** disuntikkan ke aplikasi desktop **saat build desktop** dari env `UI_PUBLIC_KEY_PEM` (bukan ditulis di source; keputusan pemilik 2026-11-16, spek §3.4). Rancangan: spek `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §3.4 dan §15 butir 12; sisi server dan build: `docs/ci-cd.md` bagian "Manifest UI bertanda tangan".

Kunci publik yang disuntikkan ikut masuk ke paket aplikasi yang ditandatangani installer, jadi tetap menjadi jangkar kepercayaan yang tidak dapat diganti server atau lingkungan runtime pengguna. Yang berubah hanya sumbernya: rotasi kunci tidak lagi butuh perubahan kode dan commit.

## Dua nilai, satu kunci

| Nama | Isi | Jenis di GitHub | Dipakai oleh |
|---|---|---|---|
| `UI_SIGNING_KEY` | Kunci **privat** (PEM PKCS8, berbaris banyak) | **Secret** pada environment `staging` dan `production` | Job `image` di `deploy-server.yml` (menandatangani manifest) |
| `UI_PUBLIC_KEY_PEM` | Kunci **publik**, bentuk **satu baris** (isi base64) | **Variable** (repositori, atau environment `staging` dan `production`) | Build image server (`build-args`, pemeriksaan pasangan) dan build desktop (disuntikkan ke aplikasi) |

`UI_PUBLIC_KEY_PEM` boleh berbentuk PEM berbaris banyak (akhir baris Unix atau Windows), PEM satu baris, PEM dengan `\n` harfiah, atau isi base64 saja; skrip lokal dan langkah CI menormalkannya. Langkah CI mengubahnya menjadi satu baris karena `build-args` berformat satu entri per baris (yang tidak terbaca sebagai kunci publik menggagalkan build tanpa mencetak isinya); `gen-ui-signing-key` mencetak bentuk satu baris yang ringkas.

## Tanpa kunci: apa yang terjadi

- **Aplikasi desktop** dibangun tanpa `UI_PUBLIC_KEY_PEM` (build dev, tes, `pack`): pembaruan UI **nonaktif**. `checkForUpdate` selalu mengembalikan `none` dan aplikasi memakai UI dasar yang terkemas. Semuanya tetap berfungsi (Country Lock offline, login Bearer, semua halaman lewat proxy); yang hilang hanya pembaruan UI tanpa memasang ulang. **Build rilis (`bun run --cwd desktop dist`, juga `build:desktop` di akar) menolak berjalan tanpa kunci** supaya pembaruan UI tidak mati diam-diam pada installer yang dibagikan.
- **Build image server** tanpa secret dan Variable (keduanya kosong): manifest tidak ditandatangani, `GET /api/desktop/ui-manifest` menjawab 404, dan desktop tetap di UI dasar tanpa galat. Build tetap hijau dengan `::warning::`. Bila hanya salah satunya terisi, build **gagal** (konfigurasi setengah jadi).

## 1. Bangkitkan kunci (sekali, di mesin pribadi)

```
bun run scripts/gen-ui-signing-key.ts C:\jalur\pribadi\qc.ui-signing-key.pem
```

- Nama berkas privat **harus** berakhiran `.ui-signing-key.pem` (ditangkap `.gitignore`); skrip menolak menimpa berkas yang sudah ada.
- Kunci privat ditulis ke berkas itu dan **tidak dicetak**. Kunci publik ditulis ke `qc.ui-signing-key.pub.pem` dan dicetak dalam tiga bentuk: PEM, **nilai satu baris untuk `UI_PUBLIC_KEY_PEM`**, dan sidik SHA-256 (bukan rahasia; berguna membandingkan dengan log build).
- Di Windows izin `0600` tidak berlaku: simpan di folder pribadi, jangan di dalam repositori atau folder yang disinkronkan publik.
- Buat **cadangan** kunci privat di tempat aman (pengelola kata sandi atau brankas terenkripsi). Kunci privat hilang = harus merilis aplikasi desktop baru dengan kunci publik baru.

## 2. Simpan kunci privat sebagai secret GitHub (environment terbatas)

1. Job `image` memakai environment yang SAMA dengan target deploy (`staging` untuk merge ke `dev`, `production` untuk merge ke `main`; penempatan pemilik 2026-11-16, menggantikan rancangan awal berupa environment terpisah `ui-signing`). Pastikan aturan *Deployment branches* kedua environment itu tetap terbatas (`staging` ke `dev`, `production` ke `main`). Catatan: `pull_request_target` selalu berjalan dari `main`, apa pun branch tujuan PR.
2. Di **kedua** environment itu, tambahkan **secret** `UI_SIGNING_KEY` berisi ISI berkas `.ui-signing-key.pem` (kunci yang sama boleh dipakai di keduanya).
3. Jangan memakai secret repositori biasa: ia terbaca oleh workflow mana pun di repositori, termasuk yang diubah di branch PR. Jangan menempelkan kunci ke issue, PR, log, atau obrolan.

## 3. Simpan kunci publik sebagai Variable GitHub

Tambahkan **Variable** (bukan secret) `UI_PUBLIC_KEY_PEM` dengan kunci publik dari langkah 1. Variable di repositori maupun di environment `staging`/`production` sama-sama terbaca job `image`; bila ada di keduanya, nilai environment yang dipakai. Bentuk satu baris, PEM berbaris banyak, atau base64 polos semuanya diterima.

## 4. Workflow dan build image (sudah terpasang)

Job `image` pada `.github/workflows/deploy-server.yml` memakai environment target deploy (`${{ needs.meta.outputs.target }}`). Langkah "Siapkan kunci tanda tangan UI" menulis secret ke berkas sementara (izin 0600) dan meneruskannya ke BuildKit lewat `secret-files`; kunci publik dinormalkan menjadi satu baris dan diteruskan lewat `build-args`; berkas dihapus di langkah terakhir. Di `Dockerfile`, `scripts/sign-ui-manifest.ts --require-public-key` memeriksa pasangan kunci SEBELUM menulis `ui-manifest.sig`; tidak berpasangan = build gagal dengan pesan jelas, dan sidik kunci publik dicetak di log. Aturan rolloutnya ada di bagian "Tanpa kunci" di atas. Rinci di `docs/ci-cd.md`.

**LARANGAN: jangan menambahkan `UI_SIGNING_KEY` ke `test.yml` atau workflow lain yang berjalan pada `pull_request`.** Job itu menjalankan kode PR yang belum ditinjau (Dockerfile dan `scripts/` dari HEAD PR); kunci yang tersedia di sana dapat dibocorkan atau dipakai menandatangani bundel UI pilihan penyerang, dan itu meruntuhkan seluruh tujuan tanda tangan (spek §3.4). `scripts/ci-workflows.test.ts` menegakkannya. Image dari `test.yml` memang tidak ditandatangani.

Uji lokal tanpa CI: `docker build --secret id=ui_signing_key,src=C:\jalur\pribadi\qc.ui-signing-key.pem --build-arg UI_PUBLIC_KEY_PEM=<satu baris> -t qc-app .` lalu pastikan `GET /api/desktop/ui-manifest` pada kontainer menjawab 200 dengan `{ manifest, signature }`. Karena nilai `ARG` ikut kunci cache BuildKit, memasang atau memutar kunci otomatis membangun ulang langkah tanda tangan (tidak ada `.sig` lama yang terbawa dari cache).

## 5. Bangun aplikasi desktop dengan kunci publik

Build desktop saat ini dijalankan manual di mesin Anda (belum ada workflow CI untuk installer; menyusul bersama Task 18). Set env dengan nilai yang SAMA dengan Variable, lalu bangun:

```powershell
$env:UI_PUBLIC_KEY_PEM = '<nilai satu baris dari langkah 1>'
bun run build:desktop
```

- Build mencetak sidik kunci yang ditanam (`kunci publik tanda tangan UI ditanam (sidik SHA-256: ...)`); bandingkan dengan sidik dari langkah 1.
- `dist` (dan `build:desktop`) menolak berjalan bila env kosong; nilai yang diberikan tetapi rusak atau bukan Ed25519 SELALU gagal, tanpa mencetak isi nilai.
- Jalankan `bun run --cwd desktop test` dan butir E4-E6 di `docs/e2e-checklist-desktop.md`. Hanya kunci publik yang boleh dipakai di sini; jangan memakai kunci uji. Aplikasi yang sudah terpasang baru mengenal kunci ini setelah pengguna memasang versi aplikasi yang memuatnya.
- Kelak, bila ada workflow CI untuk installer, pakai `vars.UI_PUBLIC_KEY_PEM` (Variable, bukan secret) lewat `env`.

## 6. Pemeriksaan kecocokan kunci (privat ↔ publik)

Kunci privat (menandatangani, di build image server) dan kunci publik (memverifikasi, tertanam di desktop) dipakai di dua pipeline berbeda, jadi pasangan yang tertukar atau salah putar tidak membuat build gagal sendiri: semua desktop hanya menolak setiap pembaruan UI (`rejected`) dan diam di UI lama. Penjaganya:

- **Saat build image (otomatis di CI)**: lihat langkah 4. Pasangan salah = build gagal sebelum tanda tangan ditulis.
- **Skrip khusus** (`scripts/check-ui-key.ts`, `bun run check:ui-key`), untuk dijalankan manual di mesin Anda sebelum merilis desktop (kunci privat memang tak boleh ada di build desktop):

  ```
  bun run check:ui-key --private C:\jalur\pribadi\qc.ui-signing-key.pem --public C:\jalur\pribadi\qc.ui-signing-key.pub.pem --require-public
  ```

  Kunci publik dari `--public <berkas>` atau env `UI_PUBLIC_KEY_PEM` (nilai yang sama dengan Variable CI, satu baris pun diterima); kunci privat dari `--private <berkas>` atau env `UI_SIGNING_KEY_FILE`. Ia memastikan kunci publik Ed25519 sah, kunci privat dapat benar-benar menandatangani, tanda tangannya lolos dengan kunci publik, dan sidiknya sama. `--require-public` menggagalkan bila kunci publik kosong. `--expect <sidik>` (opsional) membandingkan dengan sidik yang Anda catat. Isi kunci tidak pernah dicetak; hanya sidik (publik).

Pemeriksaan ini tidak menggantikan uji E4-E6 di `docs/e2e-checklist-desktop.md` (uji ujung ke ujung di perangkat).

## 7. Memutar atau mencabut kunci

- **Memutar** (kunci lama curiga bocor, atau berkala): bangkitkan pasangan baru (langkah 1), perbarui secret `UI_SIGNING_KEY` dan Variable `UI_PUBLIC_KEY_PEM`, jalankan pemeriksaan di langkah 6, bangun dan **rilis aplikasi desktop baru** dengan kunci publik baru (langkah 5). Aplikasi lama yang masih terpasang menolak tanda tangan kunci baru (status `rejected`) dan tetap memakai UI yang sudah ada tanpa rusak sampai aplikasi diperbarui (setelah itu kembali ke UI dasar, lihat di bawah); pembaruan UI baru tersedia bagi mereka setelah memasang versi aplikasi yang memuat kunci publik baru. Rencanakan peralihan: umumkan, rilis aplikasi, baru ganti secret dan Variable.
- **Mencabut** (kunci bocor): ganti secret `UI_SIGNING_KEY` dengan kunci baru (atau hapus secret dan Variable sehingga manifest tidak ditandatangani dan `ui-manifest` menjawab 404), dan rilis aplikasi dengan kunci publik baru. Penyerang yang memegang kunci lama tetap tidak dapat menyajikan bundel dari server resmi, karena bundel hanya diunduh dari `serverUrl` pengguna; risikonya ada bila ia dapat mengendalikan server tersebut. Bundel yang sudah terpasang di pengguna tidak dibatalkan sampai mereka memasang rilis aplikasi baru: `state.json` mencatat sidik kunci publik dan versi jembatan aplikasi yang menulisnya, dan saat aplikasi diluncurkan dengan kunci atau versi jembatan yang berbeda, bundel aktif, sebelumnya, dan yang menunggu dibuang sehingga aplikasi kembali ke UI dasar yang terkemas (berlaku juga pada rotasi kunci dan pembaruan versi jembatan). Pembaruan UI kemudian diunduh ulang dari server dan diverifikasi dengan kunci yang baru.
- Saran tambahan: catat tanggal pembangkitan kunci, lokasi cadangan, dan siapa yang berhak mengakses secret.
