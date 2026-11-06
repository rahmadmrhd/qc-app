# CI/CD (GitHub Actions)

Workflow di `.github/workflows/`: `test.yml` (PR), `deploy-server.yml` (server Bun + MariaDB di VPS, bagian pertama di bawah), dan `deploy.yml` (Apps Script lama, dipensiunkan di T34/T35). Aksi lokal bersama: `.github/actions/mariadb` (MariaDB 11.8 dengan `deploy/mariadb/qc.cnf` untuk tes server). `deploy-worker.yml` (Cloudflare) sudah dihapus; rencana Cloudflare dibatalkan 2026-11-05.

## Server di VPS (`deploy-server.yml`)

Alur satu run: **`meta`** (menentukan environment, menolak kombinasi terlarang) -> **`check`** (`bun run check` dengan MariaDB sungguhan di runner, tanpa tunnel) -> **`image`** (`docker buildx build` + dorong ke `ghcr.io/<pemilik>/qc-app:<SHA commit penuh>`; build web `bun run build` + `verify-dist` terjadi di dalam Dockerfile; cache `gha`) -> **`deploy`** (SSH ke VPS, uji asap URL publik).

| Kejadian | Environment | Catatan |
|---|---|---|
| push ke `feat/migrasi-cloudflare` atau `dev` | `dev` (staging, `qc-dev.rhd.my.id`) | `exec` TIDAK PERNAH dari branch ini |
| push ke `main` | `exec` (production, `qc.rhd.my.id`) | |
| Manual (Actions -> Deploy Server -> Run workflow) | pilihan `dev`/`exec` | `exec` hanya dari `main`; `dev` dari `main`, `dev`, atau `feat/migrasi-cloudflare`; ref lain ditolak oleh job `meta` sebelum checkout dan sebelum rahasia dibaca |

Perubahan hanya di `docs/**`, `**/*.md`, `gas/**`, `bridge/**` tidak memicu deploy (tidak masuk ke image).

### Mengapa pemicu `push`, bukan hanya `workflow_dispatch`

GitHub hanya menjalankan (dan menampilkan tombol) `workflow_dispatch` bila berkas workflow ada di **branch default** (`main`), yang dibekukan sampai cutover (spek §13 butir 1). Dokumentasi GitHub (Events that trigger workflows, diperiksa 2026-11-06): `workflow_dispatch` hanya memicu run bila berkas workflow ada di branch default, sedangkan `push` berlaku untuk workflow yang belum di-merge ke branch default. Karena itu staging sebelum cutover memakai `push` ke `feat/migrasi-cloudflare`; `workflow_dispatch` ikut ditulis agar kelak aktif sendiri begitu berkas ada di `main`. Yang tidak diverifikasi dari dokumentasi: perilaku tepat tombol Run workflow pada branch non-default dan bahwa berkas yang dipakai run `push` adalah versi pada commit yang di-push (tersirat oleh dokumentasi, tak disebut eksplisit; pengalaman `deploy.yml` di bawah konsisten).

### Saat cutover (T34)

1. Hapus `feat/migrasi-cloudflare` dari `on.push.branches` di `deploy-server.yml` DAN dari kedua `case` di job `meta` (push dan dispatch); `scripts/ci-workflows.test.ts` menegakkan daftar branch, jadi perbarui tesnya bersamaan.
2. Dalam PR yang sama: hapus `deploy.yml` (GAS) dan, pada environment `dev`, ganti aturan *Deployment branches* menjadi hanya `dev` dan `main`.
3. Merge PR ke `main` otomatis men-deploy production (`exec`). Aktifkan *Required reviewers* pada environment `exec` bila ingin persetujuan manual.

### Yang HARUS dibuat pemilik di GitHub (workflow tidak dapat mengaturnya sendiri)

Repositori -> Settings -> Environments:

1. **Environment `dev`**: *Deployment branches and tags* -> *Selected branches* -> `feat/migrasi-cloudflare`, lalu tambahkan `dev` dan `main`.
2. **Environment `exec`**: *Selected branches* -> hanya `main`. Disarankan *Required reviewers* (production).
3. **Secret environment** (BUKAN secret repositori; buat di KEDUA environment dengan nilai milik masing-masing):

| Nama | Isi |
|---|---|
| `DEPLOY_SSH_KEY` | kunci PRIVAT SSH khusus deploy (ed25519) untuk environment itu, hasil langkah 9 `docs/deploy-vps.md` (satu pasang per environment; publiknya dipasang di `authorized_keys` VPS dengan `command="/root/apps/qc-app/deploy.sh --only <env>"`) |
| `DEPLOY_HOST_KEY` | baris `known_hosts` host VPS, mis. `[<host>]:<port> ssh-ed25519 AAAA...` dari `ssh-keyscan -p <port> -t ed25519 <host>`; bandingkan sidik jarinya dengan `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` di VPS SEBELUM menyimpan (kunci host dipatok: koneksi ke host lain ditolak, tanpa `StrictHostKeyChecking=no`) |
| `DEPLOY_HOST` | alamat VPS (IP atau nama) |
| `DEPLOY_PORT` | port SSH VPS (non-standar) |
| `DEPLOY_USER` | `root` (akses lewat kunci `command=` terbatas, dikonfirmasi pemilik 2026-11-06) |

4. **Variabel environment** (Variables, bukan Secrets): `APP_URL` = `https://qc-dev.rhd.my.id` (environment `dev`) dan `https://qc.rhd.my.id` (environment `exec`), tanpa garis miring penutup. Dipakai uji asap `GET <APP_URL>/api/ping`.
5. **Token baca GHCR di VPS** (bukan di GitHub): paket `qc-app` dibuat privat bila repositori privat. Pilihan: (a) **PAT classic dengan scope `read:packages`** milik pemilik, `docker login ghcr.io -u <pengguna>` sekali di VPS (tersimpan di `/root/.docker/config.json`, izin 600): paket tetap privat, tetapi token berumur panjang di VPS dan terkait akun pemilik, jadi buat khusus untuk ini dan atur kedaluwarsa; (b) **jadikan paket publik** (Package settings -> Change visibility): tanpa token di VPS, tetapi isi image (kode aplikasi; rahasia tak ada di image) dapat diunduh siapa pun. Rekomendasi: (a). Image tidak memuat rahasia (tes `server/src/deploy-files.test.ts`).
6. Tidak ada rahasia lain di GitHub: `GITHUB_TOKEN` otomatis (izin `packages: write` hanya di job `image`); rahasia aplikasi (`.env`, kunci service account) hanya di VPS.

### Urutan uji pertama (setelah pemilik mengatur di atas)

1. Pastikan VPS siap (`docs/deploy-vps.md`, termasuk kunci SSH deploy langkah 9 dan `docker login ghcr.io`).
2. Dispatch tidak tersedia sebelum cutover; cukup push ke `feat/migrasi-cloudflare` (atau komit kosong: `git commit --allow-empty -m "ci: uji deploy staging"`). Perhatikan tab Actions: `meta` -> `check` -> `image` -> `deploy`.
3. Bila `image` gagal di `buildx`, perbaiki Dockerfile (build BuildKit di Actions belum pernah dijalankan; yang terbukti hanya pembangun klasik di VPS).
4. Bila `deploy` gagal "Secret environment ... belum diisi" atau "Host key verification failed", periksa daftar di atas. Kode keluar skrip VPS: 0 sukses, 1 gagal dan dikembalikan ke tag sebelumnya, 4 gagal dan pengembalian juga gagal (periksa VPS manual), 2 ditolak atau `.env` salah, 3 deploy lain sedang berjalan.
5. Uji pemulihan sekali di staging: dorong komit yang memecahkan `/api/ping` dan pastikan job gagal dan VPS kembali ke tag lama.

### Keamanan workflow (ditegakkan `scripts/ci-workflows.test.ts`)

- Tidak ada `pull_request`/`pull_request_target` pada `deploy-server.yml`: kode PR tak tepercaya tidak pernah menyentuh rahasia deploy.
- Semua aksi pihak ketiga pada `deploy-server.yml`, `test.yml`, dan aksi lokal dipatok ke SHA commit (tag mayor di komentar; diambil 2026-11-06). Perbarui dengan sengaja, bukan otomatis. (`deploy.yml` GAS lama dikecualikan: dihapus di T34.)
- `permissions` minimal: `contents: read` di tingkat atas; hanya job `image` yang `packages: write`; job `deploy` `permissions: {}` dan tanpa checkout.
- Tidak ada `${{ }}` di dalam skrip `run`: nilai lewat `env`, sehingga tak ada injeksi ekspresi.
- Antrean serial per environment (`concurrency` `deploy-server-<env>`, tanpa membatalkan yang berjalan; GitHub hanya menyimpan satu run menunggu, yang lebih lama dibatalkan). Pengaman kedua: `deploy.sh` memakai kunci per lingkungan (kode 3).
- Kunci host dipatok; kunci privat ditulis ke runner dengan izin 600 dan dihapus di langkah `always()`.
- Uji asap publik yang gagal (mis. DNS/Cloudflare) menggagalkan job TANPA mengembalikan VPS otomatis: kesehatan aplikasi sudah diperiksa `deploy.sh` di VPS (kembali ke tag sebelumnya bila gagal); kegagalan publik dapat bersumber dari Cloudflare/DNS, bukan aplikasi.

### TIDAK terverifikasi sampai pemilik memasang secret dan menjalankannya

`deploy-server.yml` dan `.github/actions/mariadb` belum pernah dijalankan di GitHub: hanya diuji lokal (`scripts/ci-workflows.test.ts`: mengurai YAML, menegakkan aturan, menjalankan skrip `meta` dengan bash). Belum terbukti: `docker run` MariaDB + `qc.cnf` di runner, `bun run check` penuh di runner (tanpa tunnel), build BuildKit Dockerfile (job `image` di `test.yml` dan `deploy-server.yml`), dorong ke GHCR dan visibilitas paket, SSH dengan kunci host dipatok ke VPS, ekspresi `concurrency`/`environment`, dan uji asap.

## Apps Script lama (`deploy.yml`; dihapus di T34)

Ringkasan sebelum migrasi; berlaku selama `main` masih jalur GAS.

### Alur

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

### Menyiapkan secret `CLASPRC_JSON`

Workflow deploy memakai kredensial `clasp` milik akun Google pemilik script.

1. Di komputer Anda, login sekali: `clasp login` (bukan `--creds`; cukup akun pemilik script).
2. Salin **seluruh isi** `~/.clasprc.json` (Windows: `C:\Users\<nama>\.clasprc.json`).
3. Di GitHub: repositori → Settings → Secrets and variables → Actions → New repository secret.
   Nama: `CLASPRC_JSON`, nilai: isi berkas tadi.

Berkas itu berisi token akses akun Google Anda. Jangan di-commit (sudah ada di `.gitignore`), jangan ditempel di issue atau PR, dan cabut aksesnya dari akun Google bila bocor. Workflow menulisnya ke runner hanya selama deploy dan menghapusnya di akhir.

### Environment: `gas-dev` dan `gas-exec`

Job deploy memakai environment `gas-<target>`. GitHub membuatnya otomatis saat run pertama, tetapi **pengamanannya Anda atur sendiri** di Settings → Environments, karena workflow tidak bisa membatasi dirinya sendiri (branch yang dispatch bisa mengubah file workflow):

1. **`gas-exec`:** Deployment branches → *Selected branches* → hanya `main`. Tambahkan *Required reviewers* bila ingin persetujuan manual sebelum `/exec`.
2. **`gas-dev`:** Deployment branches → *Selected branches* → `dev` dan `main`.
3. Pindahkan secret `CLASPRC_JSON` dari secret repositori ke **secret environment** (di kedua environment), lalu hapus secret repositori. Dengan begitu token hanya sampai ke job yang berjalan dari branch yang diizinkan.

## Disarankan

- Aktifkan branch protection pada `main` dan `dev`: wajib PR dan wajib check `test` lulus, supaya deploy hanya terjadi dari kode yang teruji.
