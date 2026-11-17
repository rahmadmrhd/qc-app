# Rilis semver, rencana 1 dari 3: fondasi (versi, changelog, siapkan rilis)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server punya nomor versi yang terlihat di `/api/ping`, changelog ditulis sebagai fragmen yang dijaga CI, dan pemilik dapat menyiapkan PR rilis dengan satu perintah.

**Architecture:** Logika murni di `scripts/` (diuji `bun:test`, tanpa GitHub), dibungkus CLI tipis; satu workflow PR baru (`changelog.yml`) menegakkan fragmen; versi dibaca dari `server/package.json` dan SHA build dari env `GIT_SHA` (satu-satunya pembacaan env tetap di `config.ts`).

**Tech Stack:** Bun 1.4.2, TypeScript, `bun:test`, GitHub Actions, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-17-rilis-semver-design.md` (bagian 5.1-5.3; format `CHANGELOG.md` ditetapkan di `docs/superpowers/specs/2026-11-17-changelog-dan-unduh-desktop-web-design.md` bagian 4). Rencana 2 (pipeline rilis) dan 3 (deploy lewat tag) menyusul dan bergantung pada rencana ini.

## Global Constraints
- Bun `1.4.2`; seluruh teks komentar, pesan galat, dan dokumen berbahasa Indonesia; kode identifier tetap Inggris/Indonesia seperti sekitarnya.
- Aksi pihak ketiga di workflow dipatok SHA commit (salin SHA dari `ci.yml`); tanpa `${{ }}` di dalam `run` (nilai lewat `env`); `permissions` minimal; dijaga `scripts/ci-workflows.test.ts`.
- Pembacaan `process.env` hanya di `server/src/config.ts` dan `main.ts` (aturan CLAUDE.md); variabel baru `config.ts` wajib ada di `deploy/compose.yml` dan `deploy/.env.example` ATAU dikecualikan di `server/src/deploy-files.test.ts` (alasan tertulis).
- Format changelog: `## [X.Y.Z] - YYYY-MM-DD` (WIB), `### Ditambah|Diubah|Diperbaiki|Internal`, terbaru di atas; jenis fragmen: `ditambah|diubah|diperbaiki|internal`.
- Nama fragmen `^\d{8}-[a-z0-9]+(-[a-z0-9]+)*\.md$`; tag git `server-vX.Y.Z`, cabang rilis `release/server-vX.Y.Z`.
- `bun run check` hijau sebelum tiap commit (butuh `bun run db:tunnel` hidup); pesan commit diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Tidak ada push/merge tanpa izin pemilik.

## Review Focus
- Fragmen dengan baris `jenis:` salah ketik, berkas kosong, atau berisi dua paragraf: ditolak dengan pesan yang menyebut NAMA BERKAS (bukan hanya "tidak valid").
- `compile` dijalankan dua kali untuk versi yang sama, atau tanpa fragmen: gagal tanpa mengubah/menghapus apa pun (tidak ada keadaan setengah jadi).
- Versi `1.10.0` harus lebih besar dari `1.9.0` (bukan perbandingan string) pada `nextVersion` dan pemeriksaan "versi harus naik".
- `release:prepare` dijalankan dari pohon kerja kotor, saat `origin/main` bukan leluhur `origin/dev`, atau saat staging belum memuat ujung `dev`: berhenti sebelum membuat cabang.
- PR yang hanya mengubah dokumentasi/CI tidak diwajibkan punya fragmen; PR rilis (hanya berkas metadata) tidak diwajibkan; label `tanpa-changelog` melewatkan, dan nama cabang tidak pernah dipakai untuk melewatkan.

---

### Task 1: Versi server dan `/api/ping`

**Files:**
- Modify: `server/package.json` (tambah `"version": "0.0.0"`), `bun.lock` (hasil `bun install --lockfile-only`), `server/src/config.ts`, `server/src/core/env.ts`, `server/src/app.ts`, `server/src/server.ts` (atau tempat `envFromConfig` berada), `Dockerfile`, `.github/workflows/deploy-server.yml`
- Create: `server/src/core/build-info.ts`
- Test: `server/src/app.test.ts`, `server/src/config.test.ts`, `server/src/deploy-files.test.ts`, `scripts/ci-workflows.test.ts`

**Interfaces:**
- Produces: `buildInfo(env: Pick<Env, 'BUILD_SHA'>): { version: string; build: string }` di `server/src/core/build-info.ts` (`version` dari `server/package.json`, `build` = `env.BUILD_SHA` atau `'unknown'`); `Config.buildSha: string`; `Env.BUILD_SHA?: string`; `GET /api/ping` -> `{ ok: true, version, build }`.
- Keputusan (Ruling, dicatat di ledger): versi awal berkas `0.0.0` = belum pernah dirilis; rilis pertama memakai versi eksplisit `1.0.0` (Task 4). Ini menerjemahkan "versi awal server 1.0.0" pada spek tanpa membuat rilis pertama melompat ke 1.0.1.

- [ ] **Step 1: Tes gagal.** `app.test.ts`: `GET /api/ping` menjawab 200 dengan `ok === true`, `version` cocok `^\d+\.\d+\.\d+` dan sama dengan `server/package.json`, `build === 'unknown'` tanpa `BUILD_SHA`, dan `build === <sha>` bila `env.BUILD_SHA` diberikan. `config.test.ts`: `GIT_SHA` 40 heksa (atau 7-40) menjadi `buildSha`; kosong atau tak valid (`zzz`, ada spasi) menjadi `'unknown'`. `deploy-files.test.ts`: `Dockerfile` memuat `ARG GIT_SHA` dan `ENV GIT_SHA`; `GIT_SHA` ada di `NOT_IN_COMPOSE` (diisi image, bukan operator). `ci-workflows.test.ts`: langkah build-push `deploy-server.yml` meneruskan `GIT_SHA=${{ needs.meta.outputs.sha }}` di `build-args`.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/app.test.ts src/config.test.ts src/deploy-files.test.ts` dan `bun test scripts/ci-workflows.test.ts`. Expected: gagal pada kasus baru.
- [ ] **Step 3: Implementasi** `buildInfo` dan jalur `GIT_SHA` -> `Config.buildSha` -> `Env.BUILD_SHA` -> `/api/ping`; `ARG GIT_SHA=unknown` + `ENV GIT_SHA=$GIT_SHA` di tahap `runtime` Dockerfile (setelah `COPY`, supaya perubahan SHA tidak membatalkan cache lapisan di atasnya); `build-args` di `deploy-server.yml` menambah `GIT_SHA`. Naikkan `server/package.json` ke `0.0.0` dan jalankan `bun install --lockfile-only`.
- [ ] **Step 4: Jalankan ulang tes Step 2.** Expected: lulus. Lalu `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(server): versi dan build di /api/ping`.

### Task 2: `scripts/changelog.ts` (validate, compile, extract)

**Files:**
- Create: `scripts/changelog.ts`, `scripts/changelog.test.ts`, `server/changelog.d/.gitkeep`, `desktop/changelog.d/.gitkeep`, `server/CHANGELOG.md` (hanya `# Changelog server` dan satu baris pengantar), `desktop/CHANGELOG.md` (sama untuk desktop)
- Modify: `package.json` (skrip `"changelog": "bun run scripts/changelog.ts"`), `.dockerignore` (pengecualian `!server/CHANGELOG.md`), `Dockerfile` (`COPY server/CHANGELOG.md server/`), `scripts/ci-changes.ts` (+ tes: `server/changelog.d/` dan `desktop/changelog.d/` hanya menyalakan `code`, ditaruh SEBELUM aturan `server/`/`desktop/`)

**Interfaces:**
- Produces (semua murni, tanpa akses berkas): `FRAGMENT_KINDS`, `type FragmentKind`; `parseFragment(name: string, text: string): { name: string; kind: FragmentKind; text: string }` (melempar `ChangelogError` yang pesannya memuat `name`); `compileRelease(input: { title: string; existing: string; version: string; date: string; fragments: Fragment[] }): string` (mengembalikan isi `CHANGELOG.md` baru); `extractSection(changelog: string, version: string): string | null`; `compareSemver(a: string, b: string): number`; `isSemver(v: string): boolean`.
- CLI: `bun run changelog validate <komponen>` (periksa semua fragmen komponen, keluar 1 bila ada masalah), `compile <komponen> <versi> <tanggal>` (menulis `CHANGELOG.md` lalu menghapus fragmen; HANYA setelah penulisan berhasil), `extract <komponen> <versi>` (cetak satu bagian ke stdout; tak ada = keluar 1). `komponen` = `server|desktop`.

- [ ] **Step 1: Tes gagal** (`changelog.test.ts`), nama tes dan asersi: `parseFragment` menerima `jenis: ditambah\nTeks.`; menolak nama tanpa tanggal, baris pertama bukan `jenis: ...`, jenis tak dikenal, badan kosong, badan dua paragraf (baris kosong di tengah), CR, badan > 500 karakter, masing-masing dengan pesan memuat nama berkas. `compileRelease` menghasilkan persis format spek (urutan jenis Ditambah, Diubah, Diperbaiki, Internal; butir diurut menurut nama fragmen; jenis kosong tak ditulis; bagian baru tepat di bawah judul dan di atas versi lama); menolak versi yang sudah ada, versi bukan semver, tanggal bukan `YYYY-MM-DD`, dan nol fragmen; `extractSection('1.2.0')` mengembalikan blok itu saja (termasuk `Internal`), `null` bila tak ada, dan `1.2.0` tidak cocok dengan `1.2.01` atau `11.2.0`. `compareSemver('1.10.0','1.9.0') > 0`. CLI `compile` tidak menghapus fragmen bila penulisan gagal (uji dengan folder hanya-baca atau fungsi tulis yang melempar yang disuntikkan).
- [ ] **Step 2: Jalankan** `bun test scripts/changelog.test.ts`. Expected: gagal (modul belum ada).
- [ ] **Step 3: Implementasi** fungsi murni lebih dulu, CLI kemudian (CLI menerima `fs` yang disuntik untuk tes); `Dockerfile`/`.dockerignore`/`ci-changes` seperti di atas.
- [ ] **Step 4: Jalankan** `bun test scripts/changelog.test.ts scripts/ci-changes.test.ts`, `bun run --cwd server test src/deploy-files.test.ts`. Expected: lulus.
- [ ] **Step 5: Commit** `feat(rilis): perkakas changelog berbasis fragmen`.

### Task 3: Gerbang fragmen di PR (`changelog.yml`)

**Files:**
- Create: `scripts/changelog-check.ts`, `scripts/changelog-check.test.ts`, `.github/workflows/changelog.yml`
- Modify: `scripts/ci-workflows.test.ts`, `docs/ci-cd.md` (bagian gerbang fragmen; dijaga tes dokumen yang ada bila memeriksa nama workflow)

**Interfaces:**
- Produces: `requiredComponents(files: string[]): Component[]` dengan `Component = 'server' | 'desktop'` (server: `server/`, `web/`, `shared/`, `countrylock/`; desktop: `desktop/`, `shared/`, `countrylock/`, sesuai spek 5.2 (web memakai `countrylock/`, desktop memakai `shared/`); jalur fragmen, `*/CHANGELOG.md`, `docs/`, `.github/`, `scripts/`, `*.md`, dan berkas akar tidak dihitung); `isReleaseChange(files: string[], component?: Component): boolean` (semua berkas ada di daftar metadata komponen: `<komponen>/package.json`, `bun.lock`, `<komponen>/CHANGELOG.md`, `<komponen>/changelog.d/**`; tanpa `component` = metadata kedua komponen; rencana 2 memakainya dengan `'server'`); `checkChangelog(input: { files: string[]; addedFragments: string[]; labels: string[] }): { ok: boolean; missing: Component[] }`.
- Workflow `changelog` (job `fragmen`): pemicu `pull_request` types `opened, reopened, synchronize, labeled, unlabeled`, `permissions: contents: read, pull-requests: read`, `concurrency` per PR dengan `cancel-in-progress`, mengambil berkas PR lewat `gh api --paginate pulls/<n>/files` (berkas `removed` tidak dihitung sebagai fragmen), menjalankan `checkChangelog` lalu `changelog validate` untuk komponen yang punya fragmen. Label dibaca dari `toJSON(github.event.pull_request.labels.*.name)` lewat `env`.
- Ruling: spek 5.2 menulis pemicu `labeled/unlabeled` ditambah ke `test.yml`; di sini dipisah ke workflow sendiri agar pemasangan label tak mengulang seluruh CI (server 8 shard + web 4 shard). Perubahan ini dicatat pada spek saat rencana ini dieksekusi dan dilaporkan ke pemilik.

- [ ] **Step 1: Tes gagal.** `changelog-check.test.ts`: `web/src/x.ts` -> `['server']`; `shared/a.ts` dan `countrylock/a.ts` -> `['server','desktop']`; `desktop/a.ts` -> `['desktop']`; `docs/a.md`, `.github/workflows/x.yml`, `scripts/x.ts`, `README.md` -> `[]`; berkas fragmen saja -> `[]`; `isReleaseChange` benar untuk set metadata penuh dan salah bila ada satu berkas lain; `checkChangelog` gagal bila server berubah tanpa fragmen baru dan tanpa label `tanpa-changelog`, lulus dengan label itu, lulus dengan fragmen server, dan PR rilis lulus tanpa fragmen. Nama cabang tidak menjadi masukan sama sekali (asersi: tanda tangan fungsi tidak menerimanya). `ci-workflows.test.ts`: `changelog.yml` memicu hanya `pull_request` (bukan `pull_request_target`), izin hanya `contents: read` dan `pull-requests: read`, tanpa `${{ }}` di `run`, aksi dipatok SHA.
- [ ] **Step 2: Jalankan** `bun test scripts/changelog-check.test.ts scripts/ci-workflows.test.ts`. Expected: gagal.
- [ ] **Step 3: Implementasi** fungsi, CLI `scripts/changelog-check.ts` (membaca berkas dari stdin, label dari env `LABELS` JSON, keluar 1 dengan pesan Indonesia yang menyebut folder fragmen dan label pelewat), workflow, dan dokumen.
- [ ] **Step 4: Jalankan ulang tes Step 2.** Expected: lulus. Tambahkan satu fragmen contoh `server/changelog.d/20261117-rilis-semver-fondasi.md` (`jenis: internal`) untuk PR ini sendiri.
- [ ] **Step 5: Commit** `feat(ci): gerbang fragmen changelog di PR`.

### Task 4: `release:prepare` (siapkan PR rilis lokal)

**Files:**
- Create: `scripts/release-prepare.ts`, `scripts/release-prepare.test.ts`
- Modify: `package.json` (skrip `"release:prepare": "bun run scripts/release-prepare.ts"`), `docs/ci-cd.md` (cara memakainya), `CLAUDE.md` (satu butir)

**Interfaces:**
- Consumes: `compileRelease`, `extractSection`, `compareSemver`, `isSemver` (Task 2).
- Produces: `nextVersion(current: string, bump: string, latest: string | null): string` (`bump` = `patch|minor|major` atau versi eksplisit `X.Y.Z`; eksplisit harus > `latest` dan > `current`; selain itu galat); `type Shell = { run(cmd: string[], opts?: { cwd?: string }): Promise<{ code: number; out: string }> }`; `prepareRelease(input: { component: 'server' | 'desktop'; bump: string; shell: Shell; now: Date; dryRun?: boolean }): Promise<{ branch: string; version: string; prUrl: string | null }>` (pembacaan/penulisan berkas lewat fungsi yang disuntik di `Shell`-adjacent `Files` agar dapat diuji).
- Urutan `prepareRelease` (tiap langkah berhenti dengan pesan jelas SEBELUM membuat cabang bila prasyarat gagal): pohon kerja bersih; `git fetch origin --tags`; `origin/main` adalah leluhur `origin/dev`; untuk `server`: `refs/deployed/staging` (ref diambil lewat `git fetch origin refs/deployed/*:refs/remotes/deployed/*`) memuat ujung `origin/dev` (staging sudah menjalankan semua kode yang akan dirilis); versi baru dihitung dari `<komponen>/package.json` dan tag terakhir `<komponen>-v*`; tag/cabang `release/<komponen>-vX.Y.Z` belum ada di origin; potong cabang dari `origin/dev`; ubah `version` di `package.json` komponen; `bun install --lockfile-only`; `compileRelease` dengan tanggal WIB (`Asia/Jakarta`); commit `chore(rilis): <komponen> vX.Y.Z` hanya berisi berkas metadata (cek `git diff --name-only` terhadap daftar metadata, kalau ada berkas lain berhenti); `git push origin <cabang>`; `gh pr create --base main` dengan badan = `extractSection` (seluruh bagian, termasuk `Internal`) dan akhiran atribusi. `dryRun: true` (CLI `--dry-run`) hanya menjalankan pemeriksaan baca-saja (fetch, status, perbandingan) dan MENCETAK perintah pengubah yang akan dijalankan tanpa menjalankannya.

- [ ] **Step 1: Tes gagal** dengan `Shell` palsu yang merekam perintah: `nextVersion('0.0.0','1.0.0',null) === '1.0.0'`; `nextVersion('1.9.0','minor','server-v1.9.0')` memberi `1.10.0`; eksplisit `1.0.0` ditolak bila tag terakhir `server-v1.2.0`; `patch`/`minor`/`major` benar termasuk reset angka bawah; pohon kotor, `main` bukan leluhur `dev`, staging belum memuat ujung `dev`, dan cabang sudah ada = galat dan TIDAK ada perintah `git switch -c`/`push` yang dijalankan (asersi pada rekaman); jalur sukses menjalankan perintah dengan urutan benar dan commit hanya berisi berkas metadata; tanggal WIB benar di sekitar tengah malam UTC (mis. 2026-11-17T17:30Z menjadi `2026-11-18`).
- [ ] **Step 2: Jalankan** `bun test scripts/release-prepare.test.ts`. Expected: gagal.
- [ ] **Step 3: Implementasi** fungsi murni dan orkestrasi di atas `Shell`; CLI membuat `Shell` nyata dari `Bun.spawn` dan mencetak ringkasan serta tautan PR.
- [ ] **Step 4: Jalankan** `bun test scripts/release-prepare.test.ts`, lalu `bun run check`. Expected: lulus.
- [ ] **Step 5: Uji kering manual** (tanpa push): jalankan CLI dengan `--dry-run` (cetak rencana, tidak menjalankan perintah yang mengubah apa pun) pada repo ini dan lampirkan keluarannya di ledger.
- [ ] **Step 6: Commit** `feat(rilis): skrip siapkan PR rilis`.
