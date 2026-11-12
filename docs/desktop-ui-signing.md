# Penandatanganan UI desktop: langkah pemilik

Aplikasi desktop membawa UI dasar yang dibundel dan dapat mengunduh UI web terbaru. Setiap bundel unduhan diverifikasi dengan **tanda tangan Ed25519** atas manifest (`ui-manifest.json`). Kunci **privat** hanya dipegang pemilik/CI; kunci **publik** tertanam di aplikasi. Rancangan: spek `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §3.4 dan §15 butir 12; sisi server dan build: `docs/ci-cd.md` bagian "Manifest UI bertanda tangan".

## Tanpa kunci: apa yang terjadi

Selama `UI_PUBLIC_KEY_PEM` di `desktop/src/main/ui/public-key.ts` masih `null`, pembaruan UI **nonaktif**: `checkForUpdate` selalu mengembalikan `none` dan aplikasi memakai UI dasar yang terkemas. Semuanya tetap berfungsi (Country Lock offline, login Bearer, semua halaman lewat proxy); yang hilang hanya pembaruan UI tanpa memasang ulang. Bila server belum menandatangani manifest (tanpa secret `ui_signing_key` di build image), `GET /api/desktop/ui-manifest` menjawab 404 dan desktop juga tetap di UI dasar tanpa galat.

## 1. Bangkitkan kunci (sekali, di mesin pribadi)

```
bun run scripts/gen-ui-signing-key.ts C:\jalur\pribadi\qc.ui-signing-key.pem
```

- Nama berkas privat **harus** berakhiran `.ui-signing-key.pem` (ditangkap `.gitignore`); skrip menolak menimpa berkas yang sudah ada.
- Kunci privat ditulis ke berkas itu dan **tidak dicetak**. Kunci publik ditulis ke `qc.ui-signing-key.pub.pem` dan dicetak (bukan rahasia).
- Di Windows izin `0600` tidak berlaku: simpan di folder pribadi, jangan di dalam repositori atau folder yang disinkronkan publik.
- Buat **cadangan** kunci privat di tempat aman (pengelola kata sandi atau brankas terenkripsi). Kunci privat hilang = harus merilis aplikasi desktop baru dengan kunci publik baru.

## 2. Simpan kunci privat sebagai secret GitHub

Simpan ISI berkas `.ui-signing-key.pem` sebagai secret **tingkat repositori** bernama `UI_SIGNING_KEY` (Settings > Secrets and variables > Actions > Repository secrets). Job `image` pada `.github/workflows/deploy-server.yml` tidak memakai `environment`, sehingga secret environment tidak terbaca di sana (lihat `docs/ci-cd.md`). Jangan menempelkan kunci ke issue, PR, log, atau obrolan.

## 3. Pasang secret di build image

Status saat ini: `Dockerfile` sudah menandatangani manifest bila secret BuildKit `ui_signing_key` diberikan, tetapi workflow CI **belum** meneruskannya. Langkah pemasangan (mengubah workflow dan tes penjaganya):

1. Di `.github/workflows/deploy-server.yml`, pada langkah `docker/build-push-action` tambahkan di `with:`
   ```
   secrets: |
     ui_signing_key=${{ secrets.UI_SIGNING_KEY }}
   ```
   (juga di `test.yml` bila image diuji; tanpa itu image hanya tak ditandatangani). Nilai berada di `with`, bukan `run`, jadi aturan "tanpa `${{ }}` di `run`" tidak terlanggar.
2. Sesuaikan `scripts/ci-workflows.test.ts` dan `docs/ci-cd.md` dengan perubahan itu (tes menegakkan pola workflow).
3. Uji lokal tanpa CI: `docker build --secret id=ui_signing_key,src=C:\jalur\pribadi\qc.ui-signing-key.pem -t qc-app .` lalu pastikan `GET /api/desktop/ui-manifest` pada kontainer menjawab 200 dengan `{ manifest, signature }`.

## 4. Tanam kunci publik di aplikasi

Salin isi `qc.ui-signing-key.pub.pem` ke `desktop/src/main/ui/public-key.ts`:

```ts
export const UI_PUBLIC_KEY_PEM: string | null = `-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----
`;
```

Lalu `bun run --cwd desktop test`, `bun run build:desktop`, dan jalankan butir E4-E6 di `docs/e2e-checklist-desktop.md`. Hanya kunci publik yang boleh masuk repositori; jangan mengisi dengan kunci uji. Aplikasi yang sudah terpasang baru mengenal kunci ini setelah pengguna memasang versi aplikasi yang memuatnya.

## 5. Memutar atau mencabut kunci

- **Memutar** (kunci lama curiga bocor, atau berkala): bangkitkan pasangan baru (langkah 1), perbarui secret `UI_SIGNING_KEY`, tanam kunci publik baru (langkah 4), dan **rilis aplikasi desktop baru**. Aplikasi lama yang masih terpasang menolak tanda tangan kunci baru (status `rejected`) dan tetap memakai UI yang sudah ada tanpa rusak; pembaruan UI baru tersedia bagi mereka setelah memasang versi aplikasi yang memuat kunci publik baru. Rencanakan peralihan: umumkan, rilis aplikasi, baru ganti secret.
- **Mencabut** (kunci bocor): ganti secret `UI_SIGNING_KEY` dengan kunci baru (atau hapus secret sehingga manifest tidak ditandatangani dan `ui-manifest` menjawab 404), dan rilis aplikasi dengan kunci publik baru. Penyerang yang memegang kunci lama tetap tidak dapat menyajikan bundel dari server resmi, karena bundel hanya diunduh dari `serverUrl` pengguna; risikonya ada bila ia dapat mengendalikan server tersebut. Bundel yang sudah terpasang di pengguna tidak dibatalkan otomatis; rilis aplikasi baru memuat ulang UI dasar.
- Saran tambahan: catat tanggal pembangkitan kunci, lokasi cadangan, dan siapa yang berhak mengakses secret.
