# CI/CD (GitHub Actions)

Workflow di `.github/workflows/`: `test.yml`, `deploy.yml` (Apps Script), dan `deploy-worker.yml` (Cloudflare Worker, lihat bagian di bawah).

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
- Deploy dari PR memakai event `pull_request_target`, bukan `pull_request`. Alasannya: pada `pull_request`, GITHUB_REF selalu `refs/pull/N/merge`, sehingga aturan environment "Selected branches" selalu menolaknya ("Branch refs/pull/N/merge is not allowed to deploy"). `pull_request_target` berjalan pada ref branch tujuan (`dev` atau `main`). Job hanya berjalan setelah PR di-merge dan hanya meng-checkout commit hasil merge; jangan menambah langkah yang meng-checkout head PR yang belum di-merge.
- **`deploy.yml` harus ada di branch default (`main`).** Tanpa itu, tombol **Run workflow** (`workflow_dispatch`) tidak muncul dan merge PR ke `dev` tidak memicu deploy sama sekali (teramati: nol run `pull_request_target` selama workflow hanya ada di `dev`). Setelah file masuk ke `main`, keduanya langsung bekerja. Jadi workflow baru atau pemicu baru perlu dibawa ke `main` (PR `dev` → `main`) sebelum pemicu otomatisnya bisa diandalkan.
- Merge PR ke `main` membuat versi baru di `/exec` (target `exec`), jadi PR rilis `dev` → `main` itu sendiri adalah deploy produksi.

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


## Worker Cloudflare (`deploy-worker.yml`)

Backend baru (Cloudflare Worker + D1) memakai workflow tersendiri yang mencerminkan `deploy.yml`. Selama masa migrasi keduanya berjalan berdampingan: `deploy.yml` untuk aplikasi Apps Script lama, `deploy-worker.yml` untuk Worker.

| Kejadian | Workflow | Hasil |
|---|---|---|
| PR dibuka, dibuka kembali, atau ada commit baru | `test.yml` | `bun run check` (mencakup paket `worker`) lalu `bun run build` |
| PR **di-merge** ke `dev` | `deploy-worker.yml` (target `staging`) | check, build, `wrangler d1 migrations apply DB --env staging --remote`, `wrangler deploy --env staging` |
| PR **di-merge** ke `main` | `deploy-worker.yml` (target `production`) | hal yang sama untuk `--env production` (otomatis, tanpa persetujuan manual) |
| Manual (Actions → Deploy Worker → Run workflow) | `deploy-worker.yml` | pilih `staging` atau `production` |

Catatan:
- Aturan keamanan sama dengan `deploy.yml`: `pull_request_target` (hanya setelah merge, hanya checkout `merge_commit_sha`, jangan pernah checkout head PR yang belum di-merge), PR ditutup tanpa merge tidak men-deploy apa pun, dispatch manual hanya dari `main` (staging atau production) atau `dev` (hanya staging) dan ditolak sebelum checkout.
- Satu antrean serial `deploy-worker` tanpa membatalkan yang berjalan.
- Migrasi D1 berjalan **sebelum** kode baru di-deploy, sehingga migrasi wajib kompatibel mundur (hanya menambah tabel/kolom/indeks) karena versi lama masih melayani permintaan.
- Langkah terakhir menguji `GET /api/ping` bila variabel environment `WORKER_URL` diisi; bila kosong, uji asap dilewati.
- `deploy-worker.yml` harus ada di branch default `main` agar pemicunya aktif (alasan sama dengan `deploy.yml`).
- Deploy jembatan Apps Script (proyek `bridge/`) tetap lewat alur `clasp` terpisah: `dev` → HEAD jembatan staging, `main` → versi baru jembatan produksi.

### Environment `worker-staging` dan `worker-production`

Dibuat otomatis pada run pertama; pengamanannya diatur di Settings → Environments:

1. **`worker-production`:** Deployment branches → *Selected branches* → hanya `main`. *Required reviewers* opsional (dimatikan secara bawaan; deploy produksi otomatis saat merge ke `main`).
2. **`worker-staging`:** Deployment branches → *Selected branches* → `dev` dan `main`.
3. Secret **environment** (bukan secret repositori) pada keduanya: `CLOUDFLARE_API_TOKEN`. Buat token di Cloudflare (My Profile → API Tokens) pada **akun "QC"** dengan izin: Workers Scripts (Edit), D1 (Edit), Queues (Edit), Workers Routes bila memakai rute/domain. Id akun (`2256d27ce4dcdcb9ade777cc2650fd81`) bukan rahasia dan sudah ditulis di workflow karena login Wrangler pemilik juga memiliki akun lain.
4. Variabel environment opsional `WORKER_URL` untuk uji asap (staging `https://app-staging.qc-225.workers.dev`, production `https://app.qc-225.workers.dev`).
5. Rahasia aplikasi (`SESSION_SECRET`, `OAUTH_CLIENT_SECRET`, `SYNC_API_TOKEN`, `BRIDGE_SECRET`) diatur sekali dengan `wrangler secret put --env <target>`, bukan lewat GitHub.

Prasyarat akun Cloudflare: subdomain `workers.dev` harus sudah terdaftar pada akun QC (buka menu Workers di dashboard sekali); tanpanya Wrangler gagal dengan galat 10063 / "Worker does not exist" saat deploy dan saat memasang konsumen Queue.

## Disarankan

- Aktifkan branch protection pada `main` dan `dev`: wajib PR dan wajib check `test` lulus, supaya deploy hanya terjadi dari kode yang teruji.
