# CI/CD (GitHub Actions)

Dua workflow di `.github/workflows/`.

## Alur

| Kejadian | Workflow | Hasil |
|---|---|---|
| PR dibuka, dibuka kembali, atau ada commit baru | `test.yml` | `bun run check` lalu `bun run build` (termasuk `verify-dist`) |
| PR **di-merge** ke `dev` | `deploy.yml` (target `dev`) | build, lalu push ke Apps Script `@HEAD` saja; URL `/dev` terbarui, `/exec` tidak berubah |
| PR **di-merge** ke `main` | `deploy.yml` (target `exec`) | build, push, lalu membuat versi baru pada deployment tetap (`gas/deployment.json`); URL `/exec` terbarui |
| Manual (Actions → Deploy GAS → Run workflow) | `deploy.yml` | pilih `dev` atau `exec` |

Catatan:
- PR yang ditutup **tanpa merge** tidak men-deploy apa pun.
- Deploy manual hanya dari branch `main` (target `dev` atau `exec`) atau `dev` (target `dev`); dari ref lain workflow gagal sebelum checkout dan sebelum kredensial dibuat.
- `deploy.yml` menjalankan `bun run check` dan `bun run build` dulu sebagai gerbang; push ke Apps Script hanya terjadi bila keduanya lolos.
- Semua deploy (dev dan exec) berjalan bergantian dalam satu antrean (`deploy-gas`), tanpa membatalkan yang sedang berjalan. Ini perlu karena kedua target menulis ke project Apps Script yang sama dan versi `/exec` dibuat dari `@HEAD`; paralel akan membuat kode dev bisa terbit di `/exec`. Keterbatasan GitHub: hanya satu run yang boleh menunggu, jadi bila dua run antre di belakang deploy yang sedang berjalan, run menunggu yang lebih lama dibatalkan. Bila run `exec` yang dibatalkan, jalankan ulang manual dari `main`.
- Pemicu "PR closed" berasal dari repositori ini sendiri. PR dari fork atau Dependabot tidak menerima secret dari GitHub, sehingga deploy gagal dengan pesan "Secret CLASPRC_JSON belum diisi" (sengaja gagal terlihat, tidak diam-diam).
- Workflow dengan pemicu manual (`workflow_dispatch`) baru muncul di tab Actions setelah file `deploy.yml` ada di branch default (`main`).

## Menyiapkan secret `CLASPRC_JSON`

Workflow deploy memakai kredensial `clasp` milik akun Google pemilik script.

1. Di komputer Anda, login sekali: `clasp login` (bukan `--creds`; cukup akun pemilik script).
2. Salin **seluruh isi** `~/.clasprc.json` (Windows: `C:\Users\<nama>\.clasprc.json`).
3. Di GitHub: repositori → Settings → Secrets and variables → Actions → New repository secret.
   Nama: `CLASPRC_JSON`, nilai: isi berkas tadi.

Berkas itu berisi token akses akun Google Anda. Jangan di-commit (sudah ada di `.gitignore`), jangan ditempel di issue atau PR, dan cabut aksesnya dari akun Google bila bocor. Workflow menulisnya ke runner hanya selama deploy dan menghapusnya di akhir.

## Environment: `gas-dev` dan `gas-exec`

Job deploy memakai environment `gas-<target>`. GitHub membuatnya otomatis saat run pertama, tetapi **pengamanannya Anda atur sendiri** di Settings → Environments, karena workflow tidak bisa membatasi dirinya sendiri (branch yang dispatch bisa mengubah file workflow):

1. **`gas-exec`:** Deployment branches → *Selected branches* → hanya `main`. Tambahkan *Required reviewers* bila ingin persetujuan manual sebelum `/exec`.
2. **`gas-dev`:** Deployment branches → *Selected branches* → `dev` dan `main`.
3. Pindahkan secret `CLASPRC_JSON` dari secret repositori ke **secret environment** (di kedua environment), lalu hapus secret repositori. Dengan begitu token hanya sampai ke job yang berjalan dari branch yang diizinkan.

## Disarankan

- Aktifkan branch protection pada `main` dan `dev`: wajib PR dan wajib check `test` lulus, supaya deploy hanya terjadi dari kode yang teruji.
