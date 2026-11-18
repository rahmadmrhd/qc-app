# Rilis bernomor versi (server dan web, desktop, source) — rancangan bagian 1 dan 2

Tanggal: 2026-11-17. Status: USULAN (revisi 2 setelah builder check), menunggu persetujuan pemilik produk. Belum ada kode.
Cakupan dokumen ini: **bagian 1 (fondasi rilis + changelog)** dan **bagian 2 (deploy lewat tag)**. Bagian 3-5 ada di 2.2.

## 1. Maksud dan alasan

Pemilik produk ingin manajemen versi untuk server (termasuk web), aplikasi desktop, dan source code, agar sewaktu-waktu dapat
**upgrade atau downgrade** bila ada masalah, dan agar deploy staging/production dapat dipicu dari versi tertentu. Changelog per
komponen harus ada di setiap rilis, dan nantinya terbaca oleh pengguna web ("apa yang baru di aplikasi yang saya pakai").

Masalah di alur sekarang (`docs/ci-cd.md`):
- Production di-build ulang dari commit merge ke `main`, yaitu commit lain dari yang diuji di staging; **kode** yang berjalan di
  production tidak dijamin sama dengan yang lulus di staging.
- Image hanya bertag SHA 40 heksa; tidak ada nomor versi, tidak ada catatan perubahan, tidak ada tag git selain `gas-legacy`.
- `deploy.sh` hanya menerima SHA, jadi "naik/turun ke versi X" tidak punya padanan.

## 2. Cakupan

### 2.1 Di dalam dokumen ini
1. Tag semver, GitHub Release (arsip sumber otomatis), changelog sebagai berkas fragmen, workflow rilis, promosi `dev` -> `main`.
2. Deploy lewat tag (`workflow_dispatch`) ke staging/production, dengan pagar downgrade skema basis data.

### 2.2 Di luar dokumen ini (dibahas terpisah, urutan: 3 -> 4 -> 5)
3. Bundling backend (`bun build --target=bun`) agar image tak membawa sumber TypeScript dan `node_modules`.
4. Rilis desktop (installer x64+arm64, penandatanganan) dan pembaruan otomatis aplikasi desktop.
5. Halaman unduh di web (repo privat: server menyajikan artefak) dan tampilan changelog di web ("Apa yang baru").

Rancangan ini tidak menutup pintu bagian 3-5: tag `desktop-vX.Y.Z` memakai mekanisme berkas fragmen yang sama; changelog
dibawa image sehingga web dapat membacanya tanpa token GitHub.

## 3. Keputusan pemilik (2026-11-17)
- Tag terpisah per komponen: `server-vX.Y.Z` (server dan web; web disajikan dari image server, jadi versinya sama) dan
  `desktop-vX.Y.Z`. "Source code" = arsip sumber yang dibuat GitHub pada setiap Release; tidak ada tag ketiga.
- Changelog **ditulis tangan** per PR, ramah pengguna (bukan dihasilkan dari pesan commit).
- Rilis dimulai dengan **PR rilis** (bukan tag manual, bukan otomatis penuh).
- **Kode diuji sekali di staging; rilis tidak menguji ulang** (diganti pemeriksaan 5.4). Image production tetap dibangun sekali
  lagi saat rilis dari kode identik, karena nomor versi dan changelog tertanam di image (pemilik menerima ini).
- PR rilis dibuka dari `release/server-vX.Y.Z` (dipotong dari ujung `dev`) ke `main`; merge-nya adalah promosi `dev` -> `main`
  sekaligus pemicu rilis. `dev` disinkronkan sesudahnya.
- **Merge ke `main` tidak lagi men-deploy production** secara otomatis; production hanya lewat rilis atau deploy tag.
  **Berlaku hanya setelah saklar `RELEASE_FLOW=tag` dinyalakan** (keputusan pemilik 2026-11-18, lihat butir berikut).
- **Masa pra-resmi: saklar mode rilis** (keputusan pemilik 2026-11-18, mengubah butir di atas): produk masih dalam pembangunan
  dan belum punya versi resmi, jadi pemilik tidak mau menaikkan versi untuk setiap update production. Dipasang variabel
  repositori `RELEASE_FLOW` (Settings > Variables). **Kosong atau `langsung` (bawaan)**: perilaku sekarang tetap berjalan, merge
  ke `main` men-deploy production, versi tetap `0.0.0` (`/api/ping` melaporkan `version` `0.0.0` dan `build` = SHA), tanpa tag
  dan tanpa Release. **`tag`**: alur rilis semver aktif (PR rilis, `release.yml`, deploy tag) dan merge ke `main` tidak lagi
  men-deploy. Pemilik menyalakan `tag` sendiri kapan produk dinilai layak punya versi resmi; fragmen changelog yang
  menumpuk selama masa pra-resmi dirangkum rilis pertama (`1.0.0`). Saklar dibaca saat workflow berjalan, sehingga PR
  "bootstrap" boleh di-merge kapan saja tanpa mengubah perilaku sampai variabel dinyalakan.
- Deploy lewat tag **memblokir downgrade yang melewati migrasi basis data** kecuali dicentang eksplisit; migrasi bertanda
  contract selalu memblokir (pilihan A).
- **Pagar downgrade juga dipasang di sisi VPS** (`deploy/deploy.sh`, keputusan pemilik 2026-11-17 setelah ditawarkan): pagar CI
  (5.5) hanya umpan balik cepat berdasarkan `refs/deployed/<env>` yang bisa basi, sedangkan pagar VPS membandingkan keadaan
  basis data yang sebenarnya dengan isi image yang akan dipasang (5.5.1). Konsekuensi yang diterima pemilik: `deploy.sh` berubah
  dan tidak dibawa CI, jadi harus disalin manual ke VPS (staging dan production) sebelum PR yang menambah `deploy-tag.yml` di-merge.

## 4. Pendekatan yang dipertimbangkan
| Pertanyaan | Pilihan | Ditolak karena |
|---|---|---|
| Memulai rilis | **R2 PR rilis (dipilih)** | R1 tag manual: tanpa tinjauan, versi di `package.json` bisa lupa diselaraskan. R3 otomatis penuh: memaksa pesan commit disiplin dan menaikkan versi pada setiap merge. |
| Sumber changelog | **A fragmen tulisan tangan (dipilih)** | B dari pesan commit: bahasa teknis, tak ramah pengguna web. |
| Image production | **Dibangun saat rilis dari commit merge** (versi dan changelog tertanam) | Retag image staging: image itu tak memuat nomor versi/changelog 1.4.0. Suntik versi saat deploy: mengubah `deploy.sh`/`compose.yml` yang tak dibawa CI. |
| Uji ulang di staging sebelum rilis | **Tidak ada; diganti dua pemeriksaan (5.4)** | Mengulang pengujian atas kode yang sama (hanya metadata yang beda). |

## 5. Rancangan

### 5.0 Batasan paket GitHub (fakta, diperiksa 2026-11-17)
Repositori privat di paket gratis: **branch protection dan ruleset (termasuk perlindungan tag) tidak tersedia** (API 403 "Upgrade
to GitHub Pro or make public"); status check wajib `test` juga tak dapat ditegakkan GitHub. Metode merge yang diizinkan: merge
commit, squash, rebase. Konsekuensi: semua pagar ada **di dalam workflow** (provenance tag, pemeriksaan jenis merge, guard);
*Required reviewers* pada environment mungkin juga tak tersedia (belum diverifikasi). Rancangan tidak boleh bergantung padanya.

### 5.1 Versi dan tag
- Sumber kebenaran versi: `server/package.json` `version` (field baru) dan `desktop/package.json` `version` (sudah ada, 0.1.0).
  Tag git **harus sama** dengan berkas pada commit yang ditandai; workflow menolak bila berbeda.
- **`bun.lock` mencatat versi workspace**: menaikkan `version` mengubah `bun.lock`, dan `bun install --frozen-lockfile` (CI dan
  Dockerfile) gagal bila tak diselaraskan. Maka `release:prepare` menjalankan `bun install --lockfile-only` dan menyertakan
  `bun.lock` di commit rilis; daftar berkas metadata (5.4) memuatnya.
- Versi awal server: `1.0.0` (production sudah live sejak 2026-11-07). Desktop: pertama kali dirilis dari `0.1.0`. [keputusan perancang]
- Server melaporkan `version` (dari `server/package.json`) dan `build` (SHA dari build-arg `GIT_SHA`) lewat `GET /api/ping`
  (pemeriksa kesehatan hanya memakai status 2xx, jadi penambahan field aman). Di antara dua rilis versi tetap versi terakhir;
  `build` membedakan. Tampilan di web: bagian 5.
- Tanggal di changelog memakai WIB (`Asia/Jakarta`) saat `release:prepare` dijalankan.

### 5.2 Changelog: berkas fragmen
- Folder `server/changelog.d/` dan `desktop/changelog.d/`. Satu berkas per perubahan, nama `<yyyymmdd>-<slug>.md` (nomor PR belum
  ada saat fragmen ditulis, jadi tidak dipakai; bentrok nama diselesaikan penulis dengan slug lain).
  Baris pertama `jenis: ditambah|diubah|diperbaiki|internal`, sisanya teks satu paragraf berbahasa Indonesia santai, ditulis
  untuk pengguna (jangan sebut nama berkas atau fungsi). `internal` = hanya tampil di GitHub Release dan tidak di web.
- `server/CHANGELOG.md` dan `desktop/CHANGELOG.md` memuat bagian per versi (Keep a Changelog). `scripts/changelog.ts` (murni,
  diuji) punya tiga perintah: `validate` (bentuk fragmen), `compile <komponen> <versi> <tanggal>` (menggabung fragmen menjadi
  bagian versi di `CHANGELOG.md`, lalu menghapus fragmennya), `extract <komponen> <versi>` (mengambil satu bagian, untuk isi
  Release dan untuk berkas yang dibawa image).
- **Masuk ke image**: `.dockerignore` mengecualikan `**/*.md`; tambahkan pengecualian untuk `server/CHANGELOG.md` dan
  `server/changelog.d/**`, dan `COPY` di Dockerfile. Bentuk berkas yang dibaca server ditetapkan di bagian 5
  (`2026-11-17-changelog-dan-unduh-desktop-web-design.md`, bagian 4): `## [X.Y.Z] - YYYY-MM-DD` dengan `### Ditambah|Diubah|Diperbaiki|Internal`;
  `compile` menghasilkan persis bentuk itu dan parser web membuang `Internal`.
- CI pada PR: bila `server/**`, `web/**`, atau `shared/**` berubah harus ada fragmen di `server/changelog.d/`; bila `desktop/**`
  berubah, di `desktop/changelog.d/`. Label `tanpa-changelog` melewatkan; `test.yml` menambah pemicu `labeled`/`unlabeled`.
  **PR rilis dikenali dari isi, bukan nama cabang** (diff-nya hanya berkas metadata), agar nama cabang tak dapat dipakai untuk
  melewati pemeriksaan.
- Penugasan komponen: `web/` dan `server/` -> `server`; `shared/` -> **`server` dan `desktop`** (desktop mengimpor
  `@shared/desktop-catalog` di `dev`); `countrylock/` -> `desktop` dan `server` (web memakainya).

### 5.3 "Siapkan rilis" (dijalankan pemilik, secara lokal)
`bun run release:prepare server <patch|minor|major>` (skrip `scripts/release-prepare.ts`, memakai kredensial pemilik):
1. Memeriksa: pohon bersih; ujung `dev` lokal = `origin/dev`; **`origin/main` adalah leluhur `dev`** (sinkron rilis sebelumnya
   sudah masuk; bila tidak, berhenti, karena versi dan fragmen akan dihitung dari keadaan basi); dan **guard 5.4(a)** terhadap
   ujung `dev` (dijalankan sebagai uji awal supaya kegagalan terlihat SEBELUM PR dibuka).
2. Memotong `release/server-vX.Y.Z` dari ujung `dev`; menaikkan `version`; `bun install --lockfile-only`; `changelog compile`;
   satu commit (hanya berkas metadata: `server/package.json`, `bun.lock`, `server/CHANGELOG.md`, fragmen yang dihapus).
3. Mendorong cabang dan membuka PR ke `main` lewat `gh` (dibuat dengan kredensial pemilik, jadi `test.yml` berjalan normal;
   PR yang dibuat `GITHUB_TOKEN` tidak memicu workflow `pull_request`, sehingga workflow "Siapkan rilis" otomatis tidak dipilih).
   `test.yml` tetap menjalankan seluruh CI pada PR rilis (berkas PR memuat semua perubahan `dev` sejak `main`); itu diterima
   sebagai gerbang tambahan sebelum `main`.
[keputusan perancang; dapat dibungkus workflow bila kelak ada GitHub App.]

### 5.4 `release.yml` (setelah PR rilis di-merge ke `main`)
Pemicu `pull_request_target` (closed, merged, base `main`), hanya untuk cabang `release/server-v<semver>`. Pagar identitas:
`head.repo.full_name == github.repository` (menolak fork); nama cabang lolos regex ketat dan **sama dengan `version` di commit
merge**; **PR dimerge dengan merge commit** (`merge_commit_sha` punya tepat dua induk; squash/rebase ditolak). Checkout hanya
`merge_commit_sha`. Grup `concurrency` = grup production di `deploy-server.yml` (satu pipeline production pada satu waktu).
Jalur: `meta` -> `guard` -> `ci` (selektif, `ci.yml`) -> `image` -> `deploy` (production) -> `mark-deployed` -> `publish` -> `sync-dev`.
- **guard (pengganti uji ulang)**: bandingkan **`refs/deployed/staging...<merge_commit_sha>`**: (a) status `ahead` dan SEMUA berkas
  yang berubah ada di daftar metadata (`server/package.json`, `bun.lock`, `server/CHANGELOG.md`, `server/changelog.d/**`);
  status `identical` (rilis tanpa perubahan kode sejak staging) juga lulus, dan perbandingan yang terpotong pada 300 berkas
  (batas API `compare`, tanpa penanda) ditolak, gagal tertutup (dicatat 2026-11-18, pass perbaikan bagian 2);
  (b) `server/CHANGELOG.md` punya bagian versi itu. Memakai commit merge (bukan head cabang) menangkap kode di `main` yang tak
  pernah melalui staging (hotfix, PR langsung). Karena `refs/deployed/staging` hanya ditulis setelah deploy staging sukses,
  kode yang dirilis identik dengan yang sudah lulus di staging.
- **Bila guard gagal** (mis. `dev` maju setelah rilis disiapkan, atau ref staging bergeser oleh dispatch/deploy tag): run
  berhenti sebelum build, tanpa deploy dan tanpa tag. `main` sudah memuat commit itu, tetapi `main` tak lagi men-deploy dan
  isinya kode yang sudah teruji, jadi tak berbahaya. Pemulihan: biarkan `dev` stabil, ulangi deploy staging, lalu jalankan
  ulang `release.yml` lewat `workflow_dispatch` (input `versi` = versi cabang yang sudah di-merge; guard dijalankan lagi dengan
  keadaan terbaru). Guard juga dijalankan sebagai langkah `release:prepare` dan sebagai check informatif pada PR rilis.
- **image**: dibangun dari commit merge, **tanpa cache** (kebijakan production), tag SHA dan `server-vX.Y.Z`; build-arg
  `GIT_SHA`; `CHANGELOG.md`/fragmen terbaru tertanam di image. Kunci tanda tangan UI desktop tetap hanya di job ini.
- **deploy**: `deploy.sh deploy production <sha>` seperti sekarang (rollback otomatis bila gagal).
- **publish** (hanya sesudah deploy sukses): membuat tag `server-vX.Y.Z` pada SHA itu dan GitHub Release (`changelog extract`
  sebagai isi; arsip sumber otomatis). Tag dibuat workflow dengan `GITHUB_TOKEN` (izin `contents: write` hanya di job ini);
  karena tag tak memicu workflow lain, semua pekerjaan rilis memang berada di run yang sama.
- **sync-dev**: mencoba menggabung `main` ke `dev` langsung lewat API merge (tanpa PR; deploy staging tak perlu dipicu: isinya
  hanya metadata). Bila konflik, hanya peringatan (lihat catatan 2026-11-18 di bawah; semula membuka PR `main` -> `dev`). Guard `release:prepare` berikutnya mengizinkan `dev` yang
  selisihnya dari `refs/deployed/staging` hanya berkas metadata.
  **Diubah 2026-11-18 (keputusan pemilik)**: asumsi awal "branch protection tak ada" gugur (repo ternyata publik dan ruleset
  `dev*` mewajibkan PR + check `test`; app GitHub Actions bawaan tidak dapat menjadi bypass actor di repo akun personal).
  Job `sync-dev` kini memakai **deploy key** repo (akses tulis, id 170298444) yang menjadi bypass actor pada ruleset `Branch dev`
  (`refs/heads/dev*`) SAJA; ruleset `Branch main` tanpa bypass. Kunci privat = secret `SYNC_DEPLOY_KEY` di environment `sync-dev`
  (hanya ref `main`), dibaca hanya oleh langkah merge dan dihapus di langkah akhir. Pendekatan GitHub App `qc-app-sync` dicoba lebih
  dulu tetapi ditolak GitHub (422: bypass actor Integration harus bagian dari sumber ruleset atau organisasi pemilik, tidak ada di
  akun personal); pemilik memilih deploy key (risiko diterima: kunci berumur panjang tanpa kedaluwarsa, dimitigasi oleh environment
  `sync-dev` hanya ref `main`, bypass terbatas ke `dev*`, dan rotasi manual). `GITHUB_TOKEN` job ini cukup `contents: read`; setelan
  "Allow GitHub Actions to create pull requests" tidak diperlukan. Konflik sungguhan TIDAK membuka PR: hanya peringatan, PR
  `main` -> `dev` dibuat manual. Host key GitHub dipatok di workflow (bukan `ssh-keyscan`).
- `deploy-server.yml`: jalur `pull_request_target` ke `main` -> production **dilewati bila `vars.RELEASE_FLOW == 'tag'`** (pemicu
  tetap ada; job `meta` yang memutuskan dari variabel, bukan dihapus dari berkas); jalur ke `dev` -> staging dan
  `workflow_dispatch` tetap. Dispatch production dari `main` tetap ada sebagai jalan darurat. `release.yml` hanya berjalan bila
  `vars.RELEASE_FLOW == 'tag'` (job pertama `meta` berhenti dengan jelas bila tidak), jadi tak pernah ada deploy ganda:
  `langsung` = hanya `deploy-server.yml`, `tag` = hanya `release.yml`. Dengan saklar ini **urutan bootstrap tak lagi kritis**
  (keduanya boleh di-merge kapan saja; perilaku berpindah saat variabel diubah). `release:prepare` menolak jalan bila
  `gh variable get RELEASE_FLOW` bukan `tag` (PR rilis yang di-merge saat mode `langsung` akan men-deploy tanpa tag).

### 5.5 Deploy lewat tag (`deploy-tag.yml`, `workflow_dispatch`)
Input: `tag` (`server-vX.Y.Z`), `environment` (staging|production), `izinkan_downgrade_skema` (boolean, bawaan false).
Grup `concurrency` = grup environment itu di `deploy-server.yml`.
1. **Provenance tag** (tag dapat dibuat siapa pun berizin tulis karena ruleset tak tersedia, 5.0): validasi `tag` dengan regex;
   ubah ke SHA; SHA harus **leluhur `main`**; `version` di `server/package.json` pada SHA itu harus sama dengan tag; **GitHub
   Release untuk tag itu harus ada dan dibuat oleh `github-actions[bot]`** (workflow `publish`); image `qc-app:<sha>` ada di GHCR.
2. **Pagar downgrade**: `A` = nama berkas di `server/migrations` pada SHA yang sedang aktif di environment itu (`refs/deployed/<env>`);
   `B` = pada SHA target. Bila `A \ B` tak kosong (target lebih rendah dari skema yang sudah diterapkan): (i) bila ada berkas
   di `A \ B` yang memuat penanda `-- qc:contract` pada baris pertamanya -> **ditolak selalu**; (ii) selain itu ditolak kecuali
   `izinkan_downgrade_skema=true`. Upgrade (`B \ A` tak kosong atau sama) lolos. Ini pemeriksaan **terbaik yang mungkin dari CI**:
   `refs/deployed/<env>` dapat basi (mis. `deploy.sh` keluar kode 5, atau deploy manual di VPS) dan penanda hanya menangkap
   migrasi yang diberi tanda, sehingga pagar yang berwenang ada di sisi VPS (5.5.1); pagar CI tetap dipertahankan agar penolakan
   datang cepat, sebelum SSH.
3. Production dari dispatch hanya boleh dijalankan dari `main` (aturan `meta` yang ada).
4. `deploy.sh deploy <env> <sha>` (ditambah kata ` allow-schema-downgrade` hanya bila `izinkan_downgrade_skema=true`) lalu
   `mark-deployed`. Tanpa build, tanpa `ci`. Kode keluar 6 (5.5.1) dipetakan ke pesan "downgrade skema ditolak" pada langkah
   deploy `deploy-tag.yml` dan `deploy-server.yml`.

#### 5.5.1 Pagar downgrade di VPS (`deploy/deploy.sh`)
- **Perintah SSH**: `deploy <staging|production> <sha-40-heksa>` atau dengan ekor ` allow-schema-downgrade`. `REQUEST_PATTERN`
  menjadi `^deploy (staging|production) ([0-9a-f]{40})( allow-schema-downgrade)?$` dan batas panjang masukan naik dari 80 ke 96
  karakter (bentuk terpanjang 81). Selain dua bentuk itu tetap ditolak seperti sekarang (kode 2, tanpa efek); kata izin tak pernah
  diekspansi shell atau dicetak balik. Pemanggil lama tanpa kata izin tidak berubah perilakunya.
- **Tempat**: fungsi `schema_guard` dipanggil sesudah `compose pull qc-app` berhasil dan SEBELUM salinan `.env` dibuang dan
  `up -d`. Bila menolak: `.env` dipulihkan apa adanya (`restore_env`), kontainer yang berjalan tak tersentuh, keluar kode **6**
  ("downgrade skema ditolak", kode baru; 0-5 tak berubah). Jalur rollback otomatis ke `PREV_TAG` TIDAK melewati pagar ini
  (itu jalur pemulihan, bukan permintaan pemilik).
- **Cara kerja** (hanya bila kontainer DB berjalan; deploy pertama dilewati, sama seperti `db_preflight`, memakai kredensial
  `.env` yang sama lewat `MYSQL_PWD` di lingkungan, tak pernah argv/log):
  1. `A` = `SELECT name FROM schema_migrations` lewat `docker exec` ke kontainer DB.
  2. `B` = `docker run --rm --network none --entrypoint ls <repo>:<tag> /app/server/migrations`, hanya nama `*.sql`
     (repositori diturunkan dengan logika yang sama seperti `cleanup_images`, dipisah menjadi fungsi bersama).
  3. `D = A \ B` (migrasi yang sudah diterapkan tetapi tak ada di image target). Bila `D` kosong (upgrade atau sama): lolos.
  4. Setiap nama di `D` divalidasi `^[0-9]{4}_[a-z0-9_]+\.sql$` sebelum dipakai di argumen apa pun; nama lain = tolak.
  5. Penanda contract: baris pertama tiap berkas di `D` dibaca dari image yang SEDANG berjalan (`PREV_TAG`, karena image target
     tak memilikinya). Berkas memuat `-- qc:contract`, atau tak terbaca/tak ada di image berjalan = anggap contract: **ditolak
     selalu**, juga bila kata izin ada.
  6. Selain itu, `D` tak kosong ditolak kecuali kata izin ada; dengan kata izin, deploy lanjut dan `log` mencatat jumlah dan
     nama migrasi yang dilewati (peringatan, bukan galat).
- **Gagal tertutup**: DB berjalan tetapi `schema_migrations` tak terbaca, atau daftar migrasi image gagal dibaca = kode 6
  (bukan lolos diam-diam); kata izin tidak melonggarkan ini.
- **Penyebaran**: CI menambah kata izin hanya saat `izinkan_downgrade_skema=true`. `deploy.sh` lama menolak bentuk tiga kata
  dengan kode 2, jadi sebelum VPS diperbarui permintaan berizin gagal dengan aman, sedangkan deploy biasa tak terpengaruh.
  Urutan: salin `deploy.sh` baru ke staging dan production, baru merge PR `deploy-tag.yml`; dicatat di `docs/ci-cd.md` dan
  `docs/deploy-vps.md` (bagian 14).
- Konvensi migrasi: migrasi yang menghapus/mengganti nama kolom atau tabel WAJIB berbaris pertama `-- qc:contract`; tes di
  `scripts/` memeriksa migrasi yang memuat `DROP`/`RENAME` tanpa penanda itu. Keputusan 2026-11-18 (implementasi bagian 3): migrasi
  lama yang destruktif (0002, 0003, 0012) TIDAK dikecualikan lewat daftar, melainkan diberi baris pertama `-- qc:contract`
  (hanya komentar; `schema_migrations` hanya menyimpan nama, jadi aman bagi basis data yang sudah menerapkannya), karena pagar
  di VPS membaca penanda dari berkas migrasi di image dan tak dapat melihat daftar pengecualian di repositori.
- Catatan implementasi `deploy-tag.yml` (2026-11-18): job `verify` me-checkout `github.sha` (ujung ref yang di-dispatch; `main`
  untuk production) hanya untuk menjalankan skrip keputusan murni (`scripts/deploy-tag-check.ts`), bukan kode tag; langkah yang
  memegang token hanya memanggil API dan langkah skrip tak diberi token.
- Catatan: image yang dirilis untuk production ditandatangani kunci environment `production`; bila kunci `staging` berbeda,
  deploy tag ke staging menyajikan manifest UI yang tak cocok dengan desktop staging (pembaruan UI desktop staging nonaktif
  sampai deploy `dev` berikutnya). Diterima.

### 5.6 Keamanan
- Aturan `pull_request_target` yang ada berlaku: tanpa `${{ }}` di `run`, checkout hanya `merge_commit_sha`, `permissions` minimal
  per job. `contents: write` (tag, Release, ref) hanya di job `publish` dan `mark-deployed`; penulisan ke `dev` (merge) oleh `sync-dev` memakai deploy key, bukan `GITHUB_TOKEN` (lihat 5.4, diubah 2026-11-18).
- Karena ruleset tag tak tersedia (5.0): siapa pun berizin tulis dapat mendorong tag `server-v*`; pagar provenance 5.5(1) mencegah
  tag palsu men-deploy sesuatu. Tag palsu tetap dapat mengotori daftar tag (diterima; tidak berefek ke deploy).
- *Required reviewers* pada environment `production` dicatat sebagai opsi bila paket mendukung.
- Rahasia tak berubah: kunci SSH/host tetap secret environment; tidak ada PAT baru.

### 5.7 Tes
- `scripts/changelog.test.ts` (validate/compile/extract, kasus tepi: fragmen kosong, jenis tak dikenal, versi sudah ada).
- `scripts/ci-workflows.test.ts` diperluas: pemicu dan izin `release.yml`/`deploy-tag.yml`, pagar identitas, skrip `guard`,
  provenance tag, dan pagar downgrade dijalankan dengan `gh` palsu (pola yang sama dengan tes `since-deploy`).
- Tes migrasi `-- qc:contract`; tes `GET /api/ping` memuat `version` dan `build`; tes `bun.lock` selaras setelah `release:prepare`.
- `server/src/deploy-script.test.ts` diperluas (docker palsu yang sudah ada menjawab `exec` ke DB dan `run ... ls/head`): upgrade
  dan sama = lolos; downgrade tanpa kata izin = kode 6, `.env` dipulihkan, tanpa `up -d`; dengan kata izin = lolos dan tercatat;
  migrasi contract ditolak walau berizin; berkas tak terbaca dianggap contract; `schema_migrations`/daftar image gagal dibaca =
  kode 6; DB tak berjalan = dilewati; nama migrasi tak valid ditolak; bentuk perintah (kata izin sah, ekor lain/ganda/huruf besar
  ditolak, panjang 81 diterima); kata sandi DB tak muncul di argumen/log/stdout; `--dry-run` menyebut pagar; rollback otomatis
  tak memanggil pagar.

## 6. Risiko dan pertanyaan terbuka
- **Menunggu persetujuan**: seluruh dokumen ini.
- ~~Pagar downgrade di sisi VPS~~ **diputuskan 2026-11-17 (pemilik: "Ya, tambahkan")**, rancangannya 5.5.1. Risiko tersisa: kode
  keluar baru 6 harus dikenali pemanggil lain (dokumentasi `deploy.sh`, `docs/deploy-vps.md`); pagar hanya melihat nama berkas
  migrasi, bukan isi data, jadi downgrade berizin atas migrasi data tetap tanggung jawab pemilik.
- `release.yml` baru aktif setelah ada di `main` (aturan GitHub: workflow `pull_request_target` dari branch default); rilis pertama
  melewati satu PR "bootstrap" biasa yang menambah `release.yml` dan syarat saklar pada `deploy-server.yml` (5.4); rilis pertama
  baru dilakukan setelah pemilik menyalakan `RELEASE_FLOW=tag`. ~~Pertanyaan terbuka: apakah merge ke main tanpa rilis diizinkan~~
  **diputuskan 2026-11-18**: selama mode `langsung`, merge ke `main` men-deploy production seperti sekarang tanpa versi.
- Pembangunan production tanpa cache membuat rilis beberapa menit lebih lama (diterima). Image production dapat berbeda dari
  image staging pada lapisan non-kode (mis. paket `apk` yang diambil ulang); kodenya identik.
- Penanda `-- qc:contract` tak menangkap migrasi data (mis. 0017 yang memetakan status); daftar pengecualian dan disiplin penulis.
- Belum diputuskan: bentuk tampilan changelog di web dan versi di header (bagian 5 di 2.2); bundling backend (bagian 3).
