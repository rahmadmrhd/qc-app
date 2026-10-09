# Setup Google (sekali per lingkungan)

Semua langkah memakai akun pemilik script (mis. `qcspectrum123@gmail.com`).

## 1. Spreadsheet database
Buat spreadsheet baru (atau pakai yang ada). Salin ID dari URL `https://docs.google.com/spreadsheets/d/<ID>/edit`.

## 2. Push kode pertama
```bash
bun run push
```
> `clasp push --force` **menimpa semua file** di project Apps Script. Simpan dulu isi lama bila perlu (`clasp pull` ke folder sementara di luar repo).

## 3. Script Properties (tahap 1)
Buka editor: `cd gas && clasp open-script` (atau script.google.com). **Project Settings → Script Properties**, tambahkan:

| Key | Isi |
|---|---|
| `SPREADSHEET_ID` | ID dari langkah 1 |
| `SESSION_SECRET` | string acak ≥ 32 karakter, mis. hasil `bun -e "console.log(crypto.randomUUID() + crypto.randomUUID())"` |
| `ADMIN_EMAIL` | email super admin |

## 4. Jalankan `setup`
Di editor pilih fungsi `setup` → **Run** → izinkan akses. Log menampilkan laporan; sheet `users`, `roles`, `audit_log` dibuat.

## 5. Deployment pertama
```bash
cd gas
clasp deploy --description "v1"
clasp deployments
```
Salin **deployment ID** (bukan `@HEAD`) ke `gas/deployment.json`, lalu commit file itu. URL aplikasi: `https://script.google.com/macros/s/<deploymentId>/exec`. Pastikan di **Deploy → Manage deployments** tertulis *Execute as: Me* dan *Who has access: Anyone*.

## 6. Google Cloud OAuth client
Di https://console.cloud.google.com (akun yang sama):
1. Buat project baru, mis. "QC App".
2. **Google Auth Platform → Branding/OAuth consent screen**: User type **External**, nama aplikasi "QC App", email dukungan.
3. **Data access / Scopes**: tambahkan `openid` dan `.../auth/userinfo.email` saja.
4. **Audience**: klik **Publish app** sehingga status **In production** (scope ini tidak memerlukan verifikasi Google).
5. **Clients → Create client → Web application**. *Authorized redirect URIs*: daftarkan **kedua** URL, persis dan tanpa garis miring di akhir: URL `/exec` dari langkah 5 dan URL `/dev` (sama, tetapi berakhiran `/dev`). Aplikasi memakai URL yang sedang melayani halaman, jadi keduanya cukup didaftarkan sekali dan tidak perlu diubah saat deploy. Google Cloud tidak menyediakan API untuk mengubah daftar ini, hanya Console.
6. Salin **Client ID** dan **Client secret**.

## 7. Script Properties (tahap 2)
| Key | Isi |
|---|---|
| `OAUTH_CLIENT_ID` | Client ID |
| `OAUTH_CLIENT_SECRET` | Client secret |
| `OAUTH_REDIRECT_URI` | **Opsional, biasanya dikosongkan.** Bila kosong, aplikasi memakai URL web app yang sedang berjalan (`/dev` atau `/exec`). Isi hanya bila ingin memaksa satu URL tertentu (override); nilainya harus persis sama dengan yang terdaftar di Google Cloud. |

Jalankan `setup` sekali lagi — laporan harus "Script Properties lengkap." dan menyebut apakah redirect URI otomatis atau override.

## 7b. Izin Drive (mulai Fase A Data Item)
Aplikasi menyimpan gambar item di folder Drive privat bernama **QC App Files** (milik akun pemilik script, tidak dibagikan). Manifest `appsscript.json` kini memuat scope `https://www.googleapis.com/auth/drive`. Setelah `bun run push`, jalankan fungsi `setup` dari editor dengan akun pemilik: Google meminta persetujuan izin Drive **sekali**. `setup` lalu membuat folder dan menyimpan id-nya di Script Property `DRIVE_FOLDER_ID` (jangan diubah manual). Berkas dibaca hanya dari folder ini: bila folder dihapus atau dipindah ke tempat sampah, jalankan `setup` lagi (membuat folder baru dan memperbarui properti), tetapi **gambar lama di folder yang hilang tidak lagi terbaca** dan upload baru masuk folder baru.

## 8. Deploy & coba
```bash
bun run deploy
```
Buka URL `/exec`, klik **Masuk dengan Google** dengan akun `ADMIN_EMAIL`, lalu buat role dan user di menu **Pengaturan Akses**.

## Troubleshooting
| Gejala | Penyebab & solusi |
|---|---|
| Google menampilkan `redirect_uri_mismatch` | URL yang dipakai aplikasi tidak terdaftar di Google Cloud. Halaman galat Google menampilkan `redirect_uri` yang dikirim; daftarkan persis nilai itu (mis. URL `/dev` atau `/exec`). Bila `OAUTH_REDIRECT_URI` diisi, nilai itu yang dipakai dan harus identik dengan yang terdaftar; kosongkan agar otomatis. |
| "Aplikasi belum dapat dibuka. Hubungi admin." | Lihat **Executions** di editor; biasanya Script Property belum lengkap. |
| "Login gagal" | State login kedaluwarsa (> 6 jam) atau dipakai ulang — klik tombol login sekali lagi. |
| "Email … belum terdaftar" | Tambahkan email tersebut di menu Users (status Aktif). |
| URL berubah setelah deploy | Selalu pakai `bun run deploy` (memperbarui deployment ID yang sama), jangan membuat deployment baru. |
| Paksa semua user logout | Ganti `SESSION_SECRET`. |
| Unggah gambar gagal "Terjadi kesalahan" setelah update | Izin Drive belum disetujui: jalankan `setup` sekali dari editor (bagian 7b). Lihat **Executions** untuk galat `DriveApp`. |
