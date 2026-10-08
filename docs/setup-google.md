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
5. **Clients → Create client → Web application**. *Authorized redirect URIs*: URL `/exec` dari langkah 5 (persis, tanpa garis miring di akhir).
6. Salin **Client ID** dan **Client secret**.

## 7. Script Properties (tahap 2)
| Key | Isi |
|---|---|
| `OAUTH_CLIENT_ID` | Client ID |
| `OAUTH_CLIENT_SECRET` | Client secret |
| `OAUTH_REDIRECT_URI` | URL `/exec` dari langkah 5 (sama persis dengan di Google Cloud) |

Jalankan `setup` sekali lagi — laporan harus "Script Properties lengkap."

## 8. Deploy & coba
```bash
bun run deploy
```
Buka URL `/exec`, klik **Masuk dengan Google** dengan akun `ADMIN_EMAIL`, lalu buat role dan user di menu **Pengaturan Akses**.

## Troubleshooting
| Gejala | Penyebab & solusi |
|---|---|
| Google menampilkan `redirect_uri_mismatch` | `OAUTH_REDIRECT_URI` dan redirect URI di Google Cloud harus identik dengan URL `/exec`. |
| "Aplikasi belum dapat dibuka. Hubungi admin." | Lihat **Executions** di editor; biasanya Script Property belum lengkap. |
| "Login gagal" | State login kedaluwarsa (> 6 jam) atau dipakai ulang — klik tombol login sekali lagi. |
| "Email … belum terdaftar" | Tambahkan email tersebut di menu Users (status Aktif). |
| URL berubah setelah deploy | Selalu pakai `bun run deploy` (memperbarui deployment ID yang sama), jangan membuat deployment baru. |
| Paksa semua user logout | Ganti `SESSION_SECRET`. |
