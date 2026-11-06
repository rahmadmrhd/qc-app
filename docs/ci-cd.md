# CI/CD (GitHub Actions)

Workflow di `.github/workflows/`: `test.yml` (PR), `deploy-server.yml` (server Bun + MariaDB di VPS, bagian pertama di bawah), dan `deploy.yml` (Apps Script lama, dipensiunkan di T34/T35). Aksi lokal bersama: `.github/actions/mariadb` (MariaDB 11.8 dengan `deploy/mariadb/qc.cnf` untuk tes server). `deploy-worker.yml` (Cloudflare) sudah dihapus; rencana Cloudflare dibatalkan 2026-11-05.

## Server di VPS (`deploy-server.yml`)

Alur satu run: **`meta`** (menentukan environment dan commit yang dibangun, menolak kombinasi terlarang) -> **`check`** (`bun run check` dengan MariaDB sungguhan di runner, tanpa tunnel) -> **`image`** (`docker buildx build` + dorong ke `ghcr.io/<pemilik>/qc-app:<SHA commit penuh>`; build web `bun run build` + `verify-dist` terjadi di dalam Dockerfile; cache `gha`) -> **`deploy`** (SSH ke VPS, uji asap URL publik).

| Kejadian | Environment | Catatan |
|---|---|---|
| PR **di-merge** ke `dev` (`pull_request_target`, closed + merged) | `dev` (staging, `qc-dev.rhd.my.id`) | membangun commit hasil merge (`merge_commit_sha`); PR yang ditutup tanpa merge dilewati |
| PR **di-merge** ke `main` (`pull_request_target`, closed + merged) | `exec` (production, `qc.rhd.my.id`) | sama; PR rilis `dev` -> `main` itu sendiri adalah deploy production |
| push ke `feat/migrasi-cloudflare` (**sementara**) | `dev` | `exec` TIDAK PERNAH dari branch ini; dihapus saat cutover |
| push langsung ke `main` atau `dev` | tidak ada | tidak memicu deploy (keputusan pemilik 2026-11-06, spek §11/§13.2: hanya PR yang di-merge) |
| Manual (Actions -> Deploy Server -> Run workflow) | pilihan `dev`/`exec` | `exec` hanya dari `main`; `dev` dari `main`, `dev`, atau `feat/migrasi-cloudflare`; ref lain ditolak oleh job `meta` sebelum checkout dan sebelum rahasia dibaca |

Perubahan hanya di `docs/**`, `**/*.md`, `gas/**`, `bridge/**` tidak memicu deploy (tidak masuk ke image).

### Mengapa masih ada pemicu `push` (sementara) dan `pull_request_target` baru berlaku setelah cutover

GitHub hanya menjalankan (dan menampilkan tombol) `workflow_dispatch` dan `pull_request_target` bila berkas workflow ada di **branch default** (`main`), yang dibekukan sampai cutover (spek §13 butir 1). Teramati pada `deploy.yml` (di bawah): nol run `pull_request_target` selama berkas hanya ada di `dev`. Jadi **sebelum cutover satu-satunya jalur otomatis ke staging adalah `push` ke `feat/migrasi-cloudflare`**; `pull_request_target` dan `workflow_dispatch` ikut ditulis agar aktif sendiri begitu berkas ada di `main` (PR `dev` -> `main` saat cutover). Dokumentasi GitHub (Events that trigger workflows, diperiksa 2026-11-06): `push` berlaku untuk workflow yang belum di-merge ke branch default. Yang tidak diverifikasi: perilaku tepat tombol Run workflow pada branch non-default, bahwa berkas yang dipakai run `push` adalah versi pada commit yang di-push (tersirat, tak disebut eksplisit; pengalaman `deploy.yml` konsisten), dan perilaku `paths-ignore` pada `pull_request_target` (dibandingkan terhadap berkas yang diubah PR).

### Saat cutover (T34)

1. Hapus pemicu `push` seluruhnya dari `deploy-server.yml` DAN `feat/migrasi-cloudflare` dari `case` di job `meta` (cabang `push` dan `workflow_dispatch`); `scripts/ci-workflows.test.ts` menegakkan daftar pemicu dan branch, jadi perbarui tesnya bersamaan.
2. Dalam PR yang sama: hapus `deploy.yml` (GAS) dan, pada environment `dev`, ganti aturan *Deployment branches* menjadi hanya `dev` dan `main`.
3. Merge PR ke `main` otomatis men-deploy production (`exec`). *Required reviewers* pada environment `exec` tetap **disarankan** (bukan wajib; keputusan pemilik 2026-11-06) bila ingin persetujuan manual.
4. Sebelum PR cutover di-merge: pastikan perubahan `deploy/compose.yml`, `deploy/deploy.sh`, `deploy/mariadb/qc.cnf`, dan variabel `.env` baru sudah dipasang manual di VPS (lihat "Perubahan berkas deploy" di bawah).

### Yang HARUS dibuat pemilik di GitHub (workflow tidak dapat mengaturnya sendiri)

Repositori -> Settings -> Environments:

1. **Environment `dev`**: *Deployment branches and tags* -> *Selected branches* -> `feat/migrasi-cloudflare`, lalu tambahkan `dev` dan `main` (run `pull_request_target` berjalan pada ref branch tujuan PR, jadi aturan ini menilai `dev`/`main`, bukan `refs/pull/N/merge`).
2. **Environment `exec`**: *Selected branches* -> hanya `main`. *Required reviewers* **disarankan** untuk production (tidak diwajibkan pemilik).
3. **Secret environment** (BUKAN secret repositori; buat di KEDUA environment dengan nilai milik masing-masing):

| Nama | Isi |
|---|---|
| `DEPLOY_SSH_KEY` | kunci PRIVAT SSH khusus deploy (ed25519) untuk environment itu, hasil langkah 9 `docs/deploy-vps.md` (satu pasang per environment; publiknya dipasang di `authorized_keys` VPS sebagai `restrict,command="/root/apps/qc-app/deploy.sh --only <env>" ssh-ed25519 AAAA...`; `restrict` sudah mencakup no-pty, no-port-forwarding, no-agent-forwarding, no-X11-forwarding, dan no-user-rc, jadi opsi `no-*` terpisah tak perlu) |
| `DEPLOY_HOST_KEY` | baris `known_hosts` host VPS, mis. `[<host>]:<port> ssh-ed25519 AAAA...` dari `ssh-keyscan -p <port> -t ed25519 <host>`; bandingkan sidik jarinya dengan `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` di VPS SEBELUM menyimpan (kunci host dipatok: koneksi ke host lain ditolak, tanpa `StrictHostKeyChecking=no`) |
| `DEPLOY_HOST` | alamat VPS (IP atau nama) |
| `DEPLOY_PORT` | port SSH VPS (non-standar) |
| `DEPLOY_USER` | `root` (akses lewat kunci `command=` terbatas, dikonfirmasi pemilik 2026-11-06) |

4. **Variabel environment** (Variables, bukan Secrets): `APP_URL` = `https://qc-dev.rhd.my.id` (environment `dev`) dan `https://qc.rhd.my.id` (environment `exec`), tanpa garis miring penutup. Dipakai uji asap `GET <APP_URL>/api/ping`.
5. **Token baca GHCR di VPS** (bukan di GitHub): paket `qc-app` dibuat privat bila repositori privat. Pilihan: (a) **PAT classic dengan scope `read:packages`** milik pemilik, `docker login ghcr.io -u <pengguna>` sekali di VPS (tersimpan di `/root/.docker/config.json`, izin 600): paket tetap privat, tetapi token berumur panjang di VPS dan terkait akun pemilik, jadi buat khusus untuk ini dan atur kedaluwarsa; (b) **jadikan paket publik** (Package settings -> Change visibility): tanpa token di VPS, tetapi isi image (kode aplikasi; rahasia tak ada di image) dapat diunduh siapa pun. Rekomendasi: (a). Image tidak memuat rahasia (tes `server/src/deploy-files.test.ts`).
6. Tidak ada rahasia lain di GitHub: `GITHUB_TOKEN` otomatis (izin `packages: write` hanya di job `image`); rahasia aplikasi (`.env`, kunci service account) hanya di VPS.
7. **sshd di VPS**: periksa `PermitRootLogin prohibit-password` (atau `forced-commands-only`) di `/etc/ssh/sshd_config`; kunci deploy hanya boleh menjalankan `deploy.sh`, bukan shell root.

### Perubahan berkas deploy (salin manual di VPS SEBELUM push yang men-deploy)

CI hanya mengganti tag image (`QC_IMAGE_TAG`): berkas di folder VPS (`/root/apps/qc-app/<env>/compose.yml`, `deploy.sh`, `mariadb/qc.cnf`, `.env`) TIDAK ikut ter-deploy dari repositori. Bila sebuah komit mengubah `deploy/compose.yml`, `deploy/deploy.sh`, `deploy/mariadb/qc.cnf`, atau menambah variabel `.env` baru (mis. variabel wajib baru di `server/src/config.ts` + `compose.yml` + `.env.example`), **salin/isi manual di VPS sebelum push yang men-deploy komit itu** (langkah 4-5 `docs/deploy-vps.md`). Bila terlupa, image baru gagal `loadConfig` atau `compose config` di VPS dan deploy berakhir kode 1 (dikembalikan) atau 2 (tidak ada yang diubah): aman, tetapi memakan satu siklus deploy.

### Migrasi basis data dan pengembalian

Migrasi diterapkan otomatis saat server start (gerbang `prepareDatabase`, sebelum `Bun.serve`). Pengembalian otomatis (`deploy.sh`) hanya mengganti image ke tag sebelumnya; **pengembalian TIDAK membatalkan migrasi**. Karena itu migrasi wajib kompatibel mundur dengan image sebelumnya: pola expand -> kontrak (tambah kolom/tabel dulu; hapus atau ganti nama kolom hanya di rilis berikutnya, setelah image yang tak lagi memakainya stabil). Migrasi destruktif yang membuat image lama rusak menjadikan pengembalian "sehat" di `/api/ping` tetapi galat di rute nyata, atau berakhir kode 4.

### Kesehatan database saat deploy

Butir spek "uji asap ... (dan kesehatan database)" dipenuhi oleh gerbang migrasi saat start: kontainer yang `healthy` berarti basis data terjangkau saat start dan migrasi sudah diterapkan. `/api/ping` sengaja tidak memeriksa basis data (endpoint publik tanpa batas); ia tidak mendeteksi basis data yang hilang SETELAH start.

### Urutan uji pertama (setelah pemilik mengatur di atas)

1. Pastikan VPS siap (`docs/deploy-vps.md`, termasuk kunci SSH deploy langkah 9). Khusus staging yang kini memakai image lokal: **hapus atau komentari `QC_IMAGE`** di `.env` staging (`deploy.sh` menolak dengan kode 2 bila `QC_IMAGE` bukan `ghcr.io/...`; tanpanya compose memakai `ghcr.io/<pemilik>/qc-app`), dan jalankan `docker login ghcr.io` (lihat butir 5 di atas) agar `compose pull` berhasil. Catatan: `QC_IMAGE_TAG=local-<sha>` lama menunjuk `ghcr.io/...:local-<sha>` yang tak ada, jadi **deploy GHCR pertama tidak punya target pengembalian**: bila `pull` gagal, `.env` dipulihkan dan kontainer lokal yang berjalan tidak tersentuh (kode 1); bila gagal sesudah `up -d` (tak sehat, ping gagal), pengembalian ke tag `local-<sha>` tak mungkin dan skrip berakhir kode 4: pulihkan manual (kembalikan `QC_IMAGE=qc-app` dan tag lokal, `docker compose up -d`).
2. Dispatch tidak tersedia sebelum cutover; cukup push ke `feat/migrasi-cloudflare` (atau komit kosong: `git commit --allow-empty -m "ci: uji deploy staging"`). Perhatikan tab Actions: `meta` -> `check` -> `image` -> `deploy`.
3. Bila `image` gagal di `buildx`, perbaiki Dockerfile (build BuildKit di Actions belum pernah dijalankan; yang terbukti hanya pembangun klasik di VPS).
4. Bila `deploy` gagal "Secret environment ... belum diisi" atau "Host key verification failed", periksa daftar di atas. Kode keluar skrip VPS: 0 sukses, 1 gagal dan dikembalikan ke tag sebelumnya, 4 gagal dan pengembalian juga gagal (periksa VPS manual), 2 ditolak (input, `QC_IMAGE` non-GHCR) atau `.env`/`compose.yml` tidak valid (`compose config` gagal; tidak ada yang diubah), 3 deploy lain sedang berjalan. Keluaran `docker compose` TIDAK muncul di log Actions (dapat memuat potongan rahasia dari `.env`): lihat `/root/apps/qc-app/<env>/.deploy.log` di VPS (izin 600, ditimpa tiap deploy).
5. Uji pemulihan sekali di staging **setelah deploy GHCR kedua sukses** (baru saat itu ada tag GHCR sebelumnya yang dapat dikembalikan): dorong komit yang memecahkan `/api/ping` dan pastikan job gagal dan VPS kembali ke tag lama.

### Keamanan workflow (ditegakkan `scripts/ci-workflows.test.ts`)

- `pull_request_target` (menerima rahasia walau PR dari fork) hanya `types: [closed]` untuk `dev`/`main`, dan hanya setelah PR **di-merge**: job `meta` punya `if` merged dan skripnya menolak selain `merged == true`. Yang dibangun dan di-checkout HANYA commit dari output `sha` job `meta` (= `merge_commit_sha`, kode yang sudah masuk ke branch tujuan; divalidasi 40 heksa); tak ada `pull_request.head`, `head_ref`, atau `refs/pull/` di mana pun. Tanpa `pull_request` biasa. PR fork yang belum di-merge tidak pernah mendapat rahasia maupun menjalankan kodenya. Jangan menambah langkah yang meng-checkout head PR. Push langsung ke `main`/`dev` tidak memicu deploy; `push` hanya untuk `feat/migrasi-cloudflare` (sementara).
- PR yang ditutup tanpa merge dilewati dan memakai grup `concurrency` sendiri (tidak menggantikan run deploy yang menunggu).
- Semua aksi pihak ketiga pada `deploy-server.yml`, `test.yml`, dan aksi lokal dipatok ke SHA commit (tag mayor di komentar; diambil 2026-11-06). Perbarui dengan sengaja, bukan otomatis. (`deploy.yml` GAS lama dikecualikan: dihapus di T34.)
- `permissions` minimal: `contents: read` di tingkat atas; hanya job `image` yang `packages: write`; job `deploy` `permissions: {}` dan tanpa checkout.
- Tidak ada `${{ }}` di dalam skrip `run`: nilai lewat `env`, sehingga tak ada injeksi ekspresi.
- Antrean serial per environment (`concurrency` `deploy-server-<env>`, tanpa membatalkan yang berjalan; GitHub hanya menyimpan satu run menunggu, yang lebih lama dibatalkan). Pengaman kedua: `deploy.sh` memakai kunci per lingkungan (kode 3).
- Kunci host dipatok; kunci privat ditulis ke runner dengan izin 600 dan dihapus di langkah `always()`.
- Tag yang boleh diminta ke VPS hanya SHA commit 40 heksa huruf kecil (`deploy.sh` menolak `latest` dan sejenisnya); keluaran `docker compose` tak diteruskan ke log Actions (lihat di atas); `.env`/`compose.yml` rusak berhenti di `compose config` tanpa mengubah apa pun.
- Uji asap publik yang gagal (mis. DNS/Cloudflare) menggagalkan job TANPA mengembalikan VPS otomatis: kesehatan aplikasi sudah diperiksa `deploy.sh` di VPS (kembali ke tag sebelumnya bila gagal); kegagalan publik dapat bersumber dari Cloudflare/DNS, bukan aplikasi.

### TIDAK terverifikasi sampai pemilik memasang secret dan menjalankannya

`deploy-server.yml` dan `.github/actions/mariadb` belum pernah dijalankan di GitHub: hanya diuji lokal (`scripts/ci-workflows.test.ts`: mengurai YAML, menegakkan aturan, menjalankan skrip `meta` dengan bash). Belum terbukti: `docker run` MariaDB + `qc.cnf` di runner, `bun run check` penuh di runner (tanpa tunnel), build BuildKit Dockerfile (job `image` di `test.yml` dan `deploy-server.yml`), dorong ke GHCR dan visibilitas paket, SSH dengan kunci host dipatok ke VPS, ekspresi `concurrency`/`environment`, pemicu `pull_request_target` (hanya aktif setelah berkas workflow ada di `main`) dan grup `concurrency` untuk PR tanpa merge, dan uji asap.

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

- Aktifkan branch protection pada `main` dan `dev`: wajib PR dan wajib check `test` lulus, supaya deploy hanya terjadi dari kode yang teruji (deploy server kini hanya dipicu oleh PR yang di-merge ke branch itu).
- *Required reviewers* pada environment `exec` (persetujuan manual sebelum production); pemilik tidak mewajibkannya (2026-11-06).
