# CI selektif dan tes terbagi 8 shard — desain

Tanggal: 2026-11-17. Status: disetujui pemilik produk 2026-11-17 dan diimplementasikan (rencana `docs/superpowers/plans/2026-11-17-ci-selektif-shard.md`).
Penyimpangan dari usulan awal saat implementasi: uji bangun image PR dipindah ke `ci.yml` (lihat 5.5).

## 1. Maksud dan alasan

Repo ini monorepo (FE `web/`, BE `server/`, `desktop/`, ditambah `shared/` dan `countrylock/`). Saat ini setiap PR dan setiap
deploy menjalankan semuanya: typecheck, Biome, semua tes (termasuk tes server terhadap MariaDB), build web, build image.
Pemilik produk ingin workflow **lebih cepat dan hanya mengerjakan apa yang berubah**:

- tes server selesai lebih cepat dengan 8 shard;
- hanya FE berubah: build web + image, tanpa tes server;
- hanya BE berubah: tanpa membangun ulang aset FE;
- hanya desktop berubah: build desktop saja, tanpa deploy server;
- nanti rilis image dan rilis desktop dipisah dengan versi masing-masing (workflow rilis di luar lingkup ini, tetapi
  desain ini tidak boleh menghalanginya).

## 2. Temuan yang membentuk desain (dari kode saat ini)

1. `server/scripts/test.ts` sudah membagi berkas ke proses paralel (bawaan 3, maks. 4 karena `max_connections` VPS 40).
   Di runner GitHub (repo privat, 2 vCPU, MariaDB lokal) tes terikat CPU, jadi menambah proses di satu mesin tidak
   membantu. Yang membantu: banyak runner.
2. `cache-to` build image hanya ditulis oleh `workflow_dispatch` (token `pull_request_target` ditolak menulis cache GHA).
   Akibatnya deploy dari merge PR hampir selalu membangun ulang web, walau hanya server yang berubah.
3. `desktop/src` dan `desktop/scripts` **tidak mengimpor `shared/`**. Kontrak desktop ke server adalah endpoint tulisan
   tangan (`/auth/desktop/*`, `/api/desktop/ui-manifest`, `/api/desktop/ui-file`, aliran notifikasi) dan kontrak jembatan
   di `countrylock/`. UI web datang dari image server (atau manifest bertanda tangan), jadi UI dan server selalu cocok;
   `minBridge` di manifest melindungi desktop lama dari UI yang butuh jembatan baru.
4. Desktop hanya mendukung Windows x64 (`electron-builder.yml`; kode memakai `ping.exe`, registri `HKCU`, PowerShell).
   `verify-pack` menjalankan `QC App.exe --smoke`.
5. Image server hanya menyalin `desktop/package.json` (lapisan manifest); isi `desktop/` lain tidak masuk image.
6. Tes penjaga `scripts/ci-workflows.test.ts` menegakkan keamanan workflow (SHA aksi, checkout hanya `merge_commit_sha`
   dari `meta`, izin minimal, tanpa `${{ }}` di `run`). Perubahan harus tetap lolos dan tes itu ikut diperbarui.

## 3. Tujuan, bukan-tujuan, anti-tujuan

Tujuan: waktu tunggu PR dan deploy turun; pekerjaan sesuai bagian yang berubah; aturan keamanan workflow tak melemah.

Bukan-tujuan: workflow rilis (tag `server-v…`/`desktop-v…`), build Linux/macOS, installer arm64 (NSIS), penambahan modul
native, mengubah `bun run check` lokal.

Anti-tujuan (dianggap gagal walau "hijau"): perubahan yang seharusnya diuji dilewati diam-diam (false negative pada
deteksi); status check wajib di branch protection hilang atau berganti nama; rahasia `UI_SIGNING_KEY`/kunci SSH bocor ke
job yang menjalankan kode PR.

## 4. Pendekatan yang dipertimbangkan

**Shard tes**
- A. Banyak proses di satu runner. Ditolak: terikat CPU 2 vCPU, dan 8 proses x 8 koneksi melebihi `max_connections` 40.
- B. **Matrix 8 job, tiap job satu runner + MariaDB sendiri (dipilih).** Hampir linear; biaya: `checkout` + cache `bun` +
  start MariaDB terulang 8 kali (diperkirakan puluhan detik per job, belum diukur).

**Deteksi perubahan**
- A. `paths:` per workflow. Ditolak: tidak bisa membedakan "FE saja" dari "BE saja" dalam satu run, dan `paths`
  tidak berlaku bersih untuk `pull_request_target`.
- B. Aksi pihak ketiga (paths-filter). Ditolak: menambah dependensi pada pipeline yang memegang rahasia.
- C. **Skrip kecil `scripts/ci-changes.ts` (dipilih)**: daftar berkas PR dari API → keluaran boolean. Murni, dapat diuji
  dengan `bun test`, dan dipakai ulang oleh workflow rilis nanti.

**Menghindari build ulang FE saat BE saja berubah**
- A. Sakelar manual (lewati `bun run build`). Ditolak: image tetap butuh `server/dist`; harus mengambil dari image lama.
- B. **Cache lapisan Docker yang dibagi lewat registry GHCR (dipilih).** Tahap `web-build` hanya jalan ulang bila isi
  `web/`, `shared/`, `countrylock/`, `scripts/`, atau manifest berubah; kebenarannya diturunkan dari isi, bukan dari
  tebakan jalur. Cache registry boleh ditulis job ber-izin `packages: write` pada event apa pun.

**Struktur workflow**
- A. Gandakan job di `test.yml` dan `deploy-server.yml`. Ditolak: dua matrix yang harus dijaga sama.
- B. **Workflow yang dapat dipanggil `ci.yml` (`workflow_call`) dipakai keduanya (dipilih).**

## 5. Desain

### 5.1 Runner tes server — mode shard
`server/scripts/test.ts` menerima `QC_TEST_SHARD=<i>/<n>` (1 ≤ i ≤ n). Mode ini memakai `partition()` yang sudah ada
dengan `count = n`, lalu hanya menjalankan daftar ke-i dalam satu proses (`QC_TEST_SHARDS` bawaan 1 di mode ini). Tanpa
variabel itu perilaku lokal tidak berubah (3 proses, tunnel, maks. 4). Tes baru untuk fungsi pembagi: tiap berkas tepat
di satu shard, gabungan semua shard = seluruh berkas, input tak valid ditolak. Pembagian murni dipindah ke modul kecil yang
dapat diuji (`server/scripts/partition.ts`).

### 5.2 Deteksi perubahan — `scripts/ci-changes.ts`
Masukan: daftar jalur berkas (satu per baris). Keluaran (`key=true|false` ke `GITHUB_OUTPUT`):

| Keluaran | Benar bila ada perubahan di |
|---|---|
| `code` | apa pun selain `docs/**`, `**/*.md`, `.superpowers/**` |
| `server_tests` | `server/**`, `shared/**`, `deploy/**` (tes `deploy-files`/`deploy-script` ada di server), atau infra |
| `web_tests` | `web/**`, `shared/**`, `countrylock/**`, atau infra |
| `shared_tests` | `shared/**` atau infra |
| `desktop_tests` | `desktop/**`, `countrylock/**`, atau infra |
| `desktop_pack` | `desktop/**`, `countrylock/**`, `web/**`, `shared/**`, atau infra (installer membawa UI dasar dari build web) |
| `image` | `server/**`, `shared/**`, `web/**`, `countrylock/**`, `scripts/**`, `Dockerfile`, `.dockerignore`, `package.json`, `bun.lock`, `tsconfig.base.json`, dan `desktop/package.json` saja (Dockerfile menyalinnya; keputusan pemilik 2026-11-17) |

Pengecualian dokumentasi (keputusan pemilik 2026-11-17): `docs/ci-cd.md` dibaca tes `scripts/ci-workflows.test.ts`, jadi
mengubahnya menyalakan `code` (lint + tes `scripts`, tanpa tes server/image); dokumen lain tetap tak menyalakan apa pun.

"Infra" = **setiap jalur yang tidak cocok dengan aturan tabel di atas dan bukan dokumentasi** (`docs/**`, `**/*.md`,
`.superpowers/**`, `.claude/**`), mis. `.github/**`, `package.json`, `bun.lock`, `biome.json`, `tsconfig*.json`, `scripts/**`,
berkas akar baru, atau folder baru: **semua keluaran menjadi true** (konservatif; lebih baik menjalankan berlebih daripada
melewatkan). Jalur berkas yang di-rename memakai nama lama DAN baru. Daftar berkas kosong, lebih dari
2.900 berkas (mendekati batas API 3.000), atau galat API: semua true. `workflow_dispatch`: semua true.
Typecheck, Biome, dan tes `scripts/` selalu jalan bila `code` benar (murah dan lintas-workspace).
`desktop/**` saja → `image=false`: tidak ada deploy server.

Sumber daftar berkas lewat `gh api --paginate` dengan `GITHUB_TOKEN` (`pull-requests: read` di job `changes` saja), tanpa
men-checkout head PR; keamanan `pull_request_target` tak berubah:
- `test.yml` (PR): `GET /repos/{repo}/pulls/{n}/files`.
- `deploy-server.yml` pada PR yang di-merge (keputusan pemilik 2026-11-17): `GET /repos/{repo}/compare/{base}...{sha}`, dengan
  `base` = commit di ref `refs/deployed/<environment>` (input `since-deploy` = nama environment). Alasan: pemilihan dari
  berkas PR pemicu saja membuat perubahan terlewat bila run sebelumnya dilewati (`skip-deploy`), dibuang antrean
  `concurrency`, atau gagal, karena image berikutnya tak memuatnya. Semua true bila: ref belum ada/tak terbaca, perbandingan
  gagal, status perbandingan bukan `ahead` (tiga-titik dihitung dari merge-base, jadi dasar yang bukan leluhur menghasilkan
  daftar terlalu kecil), atau 300 berkas atau lebih (batas API compare: berkas hanya di halaman pertama, maks. 300, terpotong
  diam-diam; terverifikasi dari dokumentasi GitHub dan temuan review independen 2026-11-17). Satu panggilan tanpa
  `--paginate`. Ref ditulis job `mark-deployed` (5.5) hanya setelah deploy sukses.
- `workflow_dispatch`: tanpa keduanya = semua true.

### 5.3 `ci.yml` (`workflow_call`)
Input: `ref` (commit yang diperiksa; kosong = checkout bawaan), `pr` (nomor PR; kosong = semua true), `since-deploy`
(nama environment untuk membandingkan dengan `refs/deployed/<env>`; menggantikan `pr` bila terisi; 5.2), `build-image`,
`desktop-check`. Output: `image`.
Job: `changes` → `typecheck-lint` → `shared-scripts` (tes `shared/` + `scripts/`) → `server` (matrix `shard: 1..8`,
`fail-fast: false`, MariaDB lokal lewat aksi `./.github/actions/mariadb`) → `web` (tes web) → `desktop` (lihat 5.4).
**Gerbang `test` ada di `test.yml` (pemanggil), bukan di `ci.yml`**: nama check job dari workflow yang dipanggil menjadi
`<job pemanggil> / <job dipanggil>`, sehingga gerbang di dalamnya akan mengganti nama check wajib `test`. Job `test` di
`test.yml` (`needs: [ci, image]`, `if: always()`) sukses bila semua `needs` berstatus success atau skipped, gagal untuk
failure/cancelled. Setiap job menginstal dependensi lewat aksi lokal `./.github/actions/setup` (setup-bun, cache
`~/.bun/install/cache` dengan kunci hash `bun.lock`, `bun install --frozen-lockfile`; job server/web memakai
`--filter '!@qc/desktop'` agar Electron tak diunduh, seperti Dockerfile).
`bun run build` terpisah di job test dihapus: build web sudah dijalankan Dockerfile (`image`), jadi tidak diulang.

### 5.4 Job desktop (hanya pemeriksaan build; tidak ada artefak)
Runner `windows-latest`. Langkah: instal dependensi → `bun run --cwd desktop test` (vitest) → `bun run build:web`
→ `bun run --cwd desktop pack` untuk x64 dan arm64 (`electron-builder --dir --win --x64 --arm64`) →
`verify-pack`. Yang dijalankan:
- **x64**: asap penuh (`QC App.exe --smoke`) + cek `ui-baseline`.
- **arm64**: **hanya build dan pemeriksaan statis** (exe ada, `ui-baseline/index.html` ada), tanpa menjalankan. Runner Windows
  arm64 (`windows-11-arm`) setahu saya hanya gratis untuk repo publik; repo ini privat, jadi arm64 dikemas silang dari
  x64 dan tidak dapat diasapkan. Bila runner arm tersedia kelak, mengaktifkan asap arm64 cukup mengganti `runs-on` pada satu
  baris matrix. `verify-pack.ts` mendapat argumen `--arch x64|arm64` (arm64 melewati `spawn`).
`electron-builder.yml` tidak diubah (NSIS tetap x64); arm64 installer menunggu workflow rilis. Dijalankan hanya bila
`desktop_pack` benar. `UI_PUBLIC_KEY_PEM` tidak dipakai (bukan build rilis).

### 5.5 `test.yml` dan `deploy-server.yml`
- `test.yml` (PR): satu job `ci` yang memanggil `ci.yml` (`ref` kosong, `pr` = nomor PR, `build-image: true`) dan gerbang `test`.
  **Uji bangun image (tanpa dorong) ada di `ci.yml` sebagai job `image-check`** (input `build-image`, hanya bila `image` benar,
  `cache-from` registry, tanpa `cache-to`), BUKAN job terpisah di `test.yml`: output workflow yang dipanggil baru tersedia
  setelah seluruh `ci.yml` selesai, jadi job pemanggil yang menunggunya akan berjalan serial setelah tes (PR lebih lambat
  dari sebelumnya). Konsekuensi: pemanggil wajib memberi `packages: read` walau `build-image` false (GitHub memvalidasi izin
  job di workflow yang dipanggil).
- `deploy-server.yml`: `meta` tetap; job `check` diganti `ci` (memanggil `ci.yml` dengan `ref = sha` dari `meta`,
  `since-deploy` = environment target pada PR yang di-merge, kosong untuk dispatch). Job `image` dan `deploy` berjalan hanya
  bila `image` benar (otomatis dilewati bila sejak deploy terakhir hanya desktop/docs yang berubah). `paths-ignore`
  dipertahankan sebagai penyaring awal. `cache-to`: registry `ghcr.io/<owner>/qc-app:buildcache-<environment>` (`mode=max`)
  untuk **semua event**. Pengaturan lama (cache GHA hanya ditulis dispatch) dihapus; tes penjaga diperbarui.
  **Kebijakan baca cache** (langkah `cache`, keputusan pemilik 2026-11-17): staging `cache-from` kedua tag; **production
  `no-cache: true` dan tanpa `cache-from`**. Alasan: penulis branch dapat meracuni tag `buildcache-*`, dan production tak
  boleh memakai lapisan yang tak dihasilkannya. `no-cache` penuh (bukan hanya `web-build`) karena lapisan `RUN` lain juga
  berakhir di image runtime; biaya: build production lebih lambat. Risiko peracunan pada staging diterima (dicatat).
- Job `mark-deployed` (`needs: [meta, deploy]`, `if: needs.deploy.result == 'success'`): menulis `refs/deployed/<env>` =
  commit yang dibangun (`gh api` PATCH, POST bila belum ada; `TARGET`/`SHA` divalidasi sebelum dipakai). Ref git dipilih,
  bukan tag/release, agar tak muncul di daftar rilis dan tak bentrok dengan tag semver rilis terpisah (5.6). Gagal menulis =
  peringatan, bukan kegagalan.
- Izin: `contents: read` tingkat atas tidak berubah; pemanggil `ci` menambah `pull-requests: read` pada job itu saja;
  `packages: write` tetap hanya di job `image`; `contents: write` hanya di job `mark-deployed` (tanpa checkout, aksi
  pihak ketiga, atau rahasia).

### 5.6 Rilis terpisah (hanya dicatat, tidak dibangun sekarang)
Tag `server-v<semver>` → image + rilis GitHub; `desktop-v<semver>` → installer (versi dari `desktop/package.json`).
Keluaran `image` dan `desktop_pack` dari `ci-changes.ts` dipakai ulang untuk menentukan apa yang perlu dirilis.
Rilis desktop dipicu `desktop/**`, `countrylock/**`, atau perubahan endpoint desktop di server; **bukan** perubahan `web/`
atau `shared/` (UI web sampai ke desktop lewat manifest).

### 5.4a Pemeriksaan desktop hanya di PR
`ci.yml` memuat job `desktop` di belakang input `desktop-check` (bawaan false; hanya `test.yml` yang menyalakannya).
`deploy-server.yml` tak menjalankannya: pemeriksaan desktop bukan gerbang deploy server, dan kegagalan unduhan Electron/kemas
tak boleh menahan deploy (keputusan pemilik 2026-11-17). Pemeriksaan = build + `electron-builder --dir` tanpa installer
dan tanpa artefak; pembuatan installer menunggu workflow rilis.

## 6. Keputusan pemilik (2026-11-17)
- Aturan deteksi: `docs/ci-cd.md` menyalakan `code`; `desktop/package.json` memicu `image` (5.2).
- Job desktop hanya di PR, tidak di deploy (5.4a); pemeriksaan = `--dir` x64+arm64 tanpa installer.
- Build desktop di CI hanya pemeriksaan build; **Windows x64 + Windows arm64**, tanpa Linux.
- Rilis image dan desktop dipisah (tag berawalan berbeda, versi sendiri).
- Matrix job untuk shard (8). Bukan 8 proses di satu mesin.
- Deploy tertinggal: pemeriksaan pada PR yang di-merge dipilih dari perubahan sejak deploy terakhir environment itu, dilacak
  lewat ref git `refs/deployed/<env>` yang ditulis job `mark-deployed` (5.2, 5.5). Bukan tag atau release.
- Cache registry: production tanpa cache (`no-cache`); staging membaca kedua tag (5.5). Diterapkan sebagai `no-cache` penuh
  (lebih luas daripada pilihan literal "tanpa cache web-build") karena lapisan `RUN` lain juga masuk image runtime; pemilik
  dapat menyempitkannya bila build production terasa terlalu lambat.

## 7. Risiko dan pertanyaan terbuka
- **Pemilihan salah (false negative):** diredam oleh aturan konservatif "infra → semua", dan tes unit `ci-changes.ts` untuk
  tiap baris tabel 5.2. Risiko sisa: jalur impor lintas-workspace baru yang tidak ada di tabel (mis. `server` mengimpor
  `desktop/`). Tes `ci-changes.test.ts` memeriksa peta terhadap `workspaces` di `package.json` akar.
- **Asap arm64 tidak ada** (5.4); build arm64 hasil kemas silang dapat berbeda dari build arm asli. Diterima untuk tahap ini.
- **Cache registry** menambah paket `qc-app` di GHCR (tag `buildcache-*`); `QC_KEEP_IMAGES`/pembersihan image lama di VPS
  tidak menyentuhnya. Perlu memastikan paket GHCR mengizinkan repo menulisnya (default untuk paket yang dibuat repo ini).
  **Peracunan cache**: penulis branch dapat menimpa tag `buildcache-*`; production kebal (tanpa cache), staging tidak.
- **`refs/deployed/<env>`** diizinkan ditulis `GITHUB_TOKEN` dengan `contents: write` (hanya job `mark-deployed`); belum
  terverifikasi sampai run pertama. Bila perlu dipulihkan manual: `git push -f origin <sha>:refs/deployed/<env>`.
  Namespace ini tak dilindungi branch protection: siapa pun berizin tulis dapat menimpanya dan menyempitkan pemeriksaan
  pasca-merge, tetapi tak dapat men-deploy kode yang lolos gerbang PR (image selalu dari `merge_commit_sha`); risiko
  sisa diterima.
- **Biaya menit:** matrix 8 job menambah total menit (overhead per job); waktu tunggu turun. Angka belum diukur;
  diukur dari run pertama setelah merge dan dicatat di `docs/ci-cd.md`.
- **Gerbang `test`:** status check wajib di GitHub menunjuk nama job; perlu dipastikan pemilik tidak mewajibkan nama job
  lama selain `test`.

## 8. Diserahkan ke pelaksana
Nama berkas/langkah tepat, versi cache `bun`, nama output, pesan galat `ci-changes.ts`, dan penambahan baris di
`docs/ci-cd.md`/`CLAUDE.md` (bagian Perintah dan CI/CD) yang mencatat keputusan di atas.
