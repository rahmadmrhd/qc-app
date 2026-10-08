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
- Target `exec` secara manual hanya diizinkan dari branch `main`; dari branch lain workflow gagal sebelum menyentuh Apps Script.
- `deploy.yml` menjalankan `bun run check` dan `bun run build` dulu sebagai gerbang; push ke Apps Script hanya terjadi bila keduanya lolos.
- Deploy per target berjalan bergantian (satu pada satu waktu), tanpa membatalkan yang sedang berjalan.
- Workflow dengan pemicu manual (`workflow_dispatch`) baru muncul di tab Actions setelah file `deploy.yml` ada di branch default (`main`).

## Menyiapkan secret `CLASPRC_JSON`

Workflow deploy memakai kredensial `clasp` milik akun Google pemilik script.

1. Di komputer Anda, login sekali: `clasp login` (bukan `--creds`; cukup akun pemilik script).
2. Salin **seluruh isi** `~/.clasprc.json` (Windows: `C:\Users\<nama>\.clasprc.json`).
3. Di GitHub: repositori → Settings → Secrets and variables → Actions → New repository secret.
   Nama: `CLASPRC_JSON`, nilai: isi berkas tadi.

Berkas itu berisi token akses akun Google Anda. Jangan di-commit (sudah ada di `.gitignore`), jangan ditempel di issue atau PR, dan cabut aksesnya dari akun Google bila bocor. Workflow menulisnya ke runner hanya selama deploy dan menghapusnya di akhir.

## Disarankan

- Aktifkan branch protection pada `main` dan `dev`: wajib PR dan wajib check `test` lulus, supaya deploy hanya terjadi dari kode yang teruji.
- Bila ingin persetujuan manual sebelum `/exec`, buat GitHub Environment (mis. `production`) dengan required reviewers lalu tambahkan `environment: production` pada job untuk target `exec`.
