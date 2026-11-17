# CI Selektif dan Tes 8 Shard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tes server berjalan di 8 job matrix, dan workflow PR/deploy hanya mengerjakan bagian monorepo yang berubah (server, web, desktop), termasuk pemeriksaan build desktop Windows x64 + arm64.

**Architecture:** Skrip murni `scripts/ci-changes.ts` mengubah daftar berkas PR menjadi boolean; workflow yang dapat dipanggil `ci.yml` memakainya untuk memilih job (lint, scripts, server matrix 8, web, desktop) dan dipanggil oleh `test.yml` dan `deploy-server.yml`; image dibangun hanya bila isi image berubah, dengan cache lapisan Docker lewat GHCR sehingga tahap `web-build` tidak diulang saat hanya server berubah.

**Tech Stack:** GitHub Actions (workflow_call, composite action, matrix), Bun 1.4.2 (`bun test`), Vitest (desktop), electron-builder 26, Docker BuildKit (cache registry), Biome.

**Spec:** `docs/superpowers/specs/2026-11-17-ci-selektif-shard-design.md`

## Global Constraints

- Aksi pihak ketiga dipatok ke SHA commit 40 heksa dengan tag mayor di komentar (tes `ci-workflows.test.ts`). `actions/cache` v4.2.4 = `0400d5f644dc74513175e3cd8d07132dd4860809`; aksi lain memakai SHA yang sudah ada di `test.yml`/`deploy-server.yml` (checkout `11d5960a326750d5838078e36cf38b85af677262`, setup-bun `0c5077e51419868618aeaa5fe8019c62421857d6`, buildx `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f`, login `c94ce9fb468520275223c153574b00df6fe4bcc9`, build-push `10e90e3645eae34f1e60eeb005ba3a3d33f178e8`).
- Versi Bun `1.4.2` di workflow harus sama dengan `ARG BUN_VERSION` di `Dockerfile` (dijaga tes).
- Tanpa `${{ }}` di dalam `run:`; nilai lewat `env:`.
- `permissions` tingkat atas `contents: read` di setiap workflow; hanya job `image` (deploy) yang `packages: write`; `pull-requests: read` hanya pada job yang membutuhkannya.
- Checkout selalu `persist-credentials: false`; di `deploy-server.yml` hanya commit dari `needs.meta.outputs.sha`, tak pernah head PR.
- `UI_SIGNING_KEY`/`UI_PUBLIC_KEY_PEM` hanya di `deploy-server.yml` job `image`; tidak boleh ada di `ci.yml`, `test.yml`, aksi lokal.
- Nama check wajib branch protection: job `test` di `test.yml` (workflow `Test`) dipertahankan.
- Shard: tepat 8 (`QC_TEST_SHARD=<1..8>/8`). Perilaku lokal `bun run test` (3 proses, tunnel, maks. 4) tidak berubah.
- Hanya Windows x64 + Windows arm64 untuk build desktop (tanpa Linux); `desktop/electron-builder.yml` tidak diubah.
- Teks komentar/dokumentasi berbahasa Indonesia mengikuti gaya repo.
- Commit: akhiri dengan `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Masukan/kondisi yang tersirat spek tetapi mudah terlewat, dan tes yang mengikatnya (ditambahkan di task pemilik):
1. PR docs-only: semua job dilewati, gerbang `test` tetap hijau (Task 2 `classify` docs-only semua false; Task 5 gerbang menganggap `skipped` lulus).
2. Berkas di-rename lintas folder (`desktop/a.ts` → `server/a.ts`): kedua jalur harus ikut (Task 4 langkah `gh api` memakai `previous_filename`; tes teks workflow).
3. Daftar berkas kosong, lebih dari 2.900 berkas, atau panggilan API gagal: semua true, bukan semua false (Task 2).
4. Jumlah berkas tes lebih sedikit dari 8 sehingga ada shard kosong: keluar 0, bukan galat (Task 1).
5. Jalur berformat Windows (`web\src\a.ts`) atau berakhiran CR: dinormalkan (Task 2).
6. Hasil job `cancelled`/`failure` pada gerbang tidak boleh dianggap lulus (Task 5 tes isi skrip gerbang).

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `server/scripts/partition.ts` (baru) + `partition.test.ts` | Pembagian berkas tes ke N kelompok dan parser `QC_TEST_SHARD`; murni |
| `server/scripts/test.ts` (ubah) | Memakai modul di atas; mode shard |
| `scripts/ci-changes.ts` (baru) + `ci-changes.test.ts` | Klasifikasi daftar berkas → boolean; CLI stdin → `GITHUB_OUTPUT` |
| `desktop/scripts/verify-pack-args.ts` (baru) + `.test.ts`, `verify-pack.ts` (ubah), `desktop/package.json` (ubah) | Argumen `--arch`, pemeriksaan arm64 statis, skrip `pack:all` |
| `.github/actions/setup/action.yml` (baru) | setup-bun + cache + `bun install` (+ filter) |
| `.github/workflows/ci.yml` (baru) | Job `changes`, `lint`, `scripts`, `server` (matrix 8), `web`, `desktop` |
| `.github/workflows/test.yml` (ubah) | Memanggil `ci.yml`, job `image` uji, gerbang `test` |
| `.github/workflows/deploy-server.yml` (ubah) | Memanggil `ci.yml`, `image`/`deploy` bersyarat, cache registry |
| `scripts/ci-workflows.test.ts` (ubah) | Menyesuaikan dan menambah penjaga |
| `docs/ci-cd.md`, `CLAUDE.md` (ubah) | Mendokumentasikan alur, keputusan, dan rencana rilis terpisah |

---

### Task 1: Mode shard pada runner tes server

**Files:**
- Create: `server/scripts/partition.ts`
- Create: `server/scripts/partition.test.ts`
- Modify: `server/scripts/test.ts` (fungsi `partition`, `main`; baris ~69-80 dan ~155-177)

**Interfaces:**
- Produces:
  - `interface FileWeight { file: string; size: number }`
  - `function partitionFiles(items: FileWeight[], count: number): string[][]` — tepat `count` kelompok (kelompok kosong dipertahankan agar indeks stabil); berkas terbesar dulu ke kelompok dengan beban terkecil; tiap kelompok diurutkan alfabetis; hasil deterministik untuk masukan sama (tie-break: nama berkas).
  - `function parseShard(value: string | undefined): { index: number; total: number } | null` — `undefined`/`''` → `null`; bentuk `^\d+/\d+$` dengan `1 <= index <= total <= 64`; selain itu `throw new Error` berpesan Indonesia.
- Tes ini berada di `server/scripts/` sehingga ikut ditemukan runner (`TEST_ROOTS` memuat `scripts`).

- [ ] **Step 1: Tulis tes gagal `server/scripts/partition.test.ts`**
  - `partitionFiles` — "mengembalikan tepat count kelompok", "tiap berkas tepat di satu kelompok dan gabungan = masukan" (mis. 20 berkas ukuran acak tetap, count 8), "deterministik: masukan sama (urutan masukan diacak) menghasilkan kelompok sama", "berkas lebih sedikit dari count menyisakan kelompok kosong tetapi tetap count kelompok", "beban seimbang: selisih beban terbesar-terkecil <= ukuran berkas terbesar".
  - `parseShard` — `undefined` dan `''` → `null`; `'3/8'` → `{ index: 3, total: 8 }`; menolak (`toThrow`): `'0/8'`, `'9/8'`, `'3'`, `'a/8'`, `'3/0'`, `'1/65'`, `'3/8x'`, `' 3/8'`.

- [ ] **Step 2: Jalankan dan pastikan gagal**
  Run: `bun test server/scripts/partition.test.ts` (tanpa preload agar tak butuh DB)
  Expected: FAIL (modul belum ada).

- [ ] **Step 3: Implementasi `partition.ts`**
  Pindahkan logika `partition` dari `test.ts` menjadi `partitionFiles` (menerima `FileWeight[]`, bukan membaca disk); tambahkan `parseShard`. Murni, tanpa impor `bun`/`node:fs`.

- [ ] **Step 4: Ubah `test.ts` memakai modul itu dan menambah mode shard**
  - Mode lokal (tanpa `QC_TEST_SHARD`): perilaku identik (panggil `partitionFiles` dengan bobot dari `statSync`, buang kelompok kosong).
  - Mode shard (`parseShard(process.env.QC_TEST_SHARD)` bukan `null`): tolak bila ada argumen posisional/target (`console.error` + kode 1); `partitionFiles(semua berkas, total)` lalu ambil kelompok `index - 1`; bila kosong cetak `Shard i/n kosong: tidak ada berkas.` dan keluar 0 tanpa memeriksa DB; selain itu jalankan kelompok itu dengan jumlah proses `QC_TEST_SHARDS` (bawaan **1** pada mode shard, tetap dibatasi `MAX_SHARDS`) dan cetak `Shard i/n: <k> dari <semua> berkas`. Galat `parseShard` → `console.error` + kode 1.

- [ ] **Step 5: Jalankan tes dan lint**
  Run: `bun test server/scripts/partition.test.ts` → PASS; `bunx biome check server/scripts`; `bun run --cwd server typecheck`.
  Verifikasi manual tanpa DB: `QC_TEST_SHARD=9/8 bun run server/scripts/test.ts` → kode 1 dengan pesan; `QC_TEST_SHARD=1/8 bun run server/scripts/test.ts src/app.ts` → kode 1 (target ditolak).

- [ ] **Step 6: Commit** `feat(server): mode shard QC_TEST_SHARD pada runner tes`

---

### Task 2: Skrip deteksi perubahan `scripts/ci-changes.ts`

**Files:**
- Create: `scripts/ci-changes.ts`
- Create: `scripts/ci-changes.test.ts`

**Interfaces:**
- Produces:
  - `interface Changes { code: boolean; server_tests: boolean; web_tests: boolean; shared_tests: boolean; desktop_tests: boolean; desktop_pack: boolean; image: boolean }`
  - `const ALL_CHANGES: Changes` (semua `true`)
  - `const MAX_FILES = 2900`
  - `function classify(files: string[] | null): Changes` — `null`, daftar kosong (setelah normalisasi), atau `length > MAX_FILES` → `ALL_CHANGES`.
  - `function formatOutputs(changes: Changes): string` — baris `key=true|false` berakhir `\n`, urutan kunci seperti `Changes`.
  - CLI: `if (import.meta.main)` membaca stdin (satu jalur per baris), memanggil `classify`, menulis `formatOutputs` ke berkas `process.env.GITHUB_OUTPUT` bila ada, dan selalu mencetaknya ke stdout.
- Normalisasi jalur: buang `\r`, ganti `\` dengan `/`, buang awalan `./`, buang baris kosong/spasi; deduplikasi.

Aturan (dari spek §5.2), diterapkan per jalur; hasil = OR atas semua jalur:
- Dokumentasi (tidak menyalakan apa pun): `docs/**`, `**/*.md`, `.superpowers/**`, `.claude/**`.
- `server/**` → `code`, `server_tests`, `image`.
- `shared/**` → `code`, `server_tests`, `web_tests`, `shared_tests`, `desktop_pack`, `image`.
- `web/**` → `code`, `web_tests`, `desktop_pack`, `image`.
- `countrylock/**` → `code`, `web_tests`, `desktop_tests`, `desktop_pack`, `image`.
- `desktop/**` → `code`, `desktop_tests`, `desktop_pack` (bukan `image`).
- `deploy/**` → `code`, `server_tests`.
- Selain itu (infra/tak dikenal) → `ALL_CHANGES`.

- [ ] **Step 1: Tulis tes gagal `scripts/ci-changes.test.ts`** dengan satu tes per baris berikut (assert pada objek `classify` penuh):
  - "docs saja (`docs/x.md`, `README.md`, `.superpowers/a`, `.claude/b`) → semua false".
  - "server saja → code, server_tests, image; lainnya false".
  - "web saja → code, web_tests, desktop_pack, image".
  - "desktop saja → code, desktop_tests, desktop_pack; image false; server_tests false".
  - "shared → server_tests, web_tests, shared_tests, desktop_pack, image; desktop_tests false".
  - "countrylock → web_tests, desktop_tests, desktop_pack, image; server_tests false".
  - "deploy saja → code dan server_tests; image false".
  - "campuran web + desktop → gabungan (OR)".
  - infra → `ALL_CHANGES` untuk `.github/workflows/x.yml`, `bun.lock`, `package.json`, `scripts/a.ts`, `biome.json`, `tsconfig.base.json`, `Dockerfile`, `folder-baru/a.ts`.
  - "daftar kosong, `null`, dan baris kosong semua → ALL_CHANGES".
  - "lebih dari MAX_FILES jalur → ALL_CHANGES" (2901 jalur di `docs/`).
  - "jalur Windows `web\\src\\a.ts` dan CRLF `web/src/a.ts\\r` diperlakukan sebagai web".
  - "rename lintas folder: masukan `desktop/a.ts` dan `server/a.ts` (nama lama dan baru) → gabungan desktop+server".
  - "formatOutputs: tujuh baris, kunci berurut, `true`/`false` huruf kecil".
  - "CLI: `bun run scripts/ci-changes.ts` dengan stdin `web/a.ts\\n` dan `GITHUB_OUTPUT` ke berkas sementara menulis `image=true`" (pakai `Bun.spawn`).
  - "peta mencakup semua workspace: setiap entri `workspaces` di `package.json` akar (`shared`, `web`, `server`, `countrylock`, `desktop`) menghasilkan `code: true` untuk jalur `<ws>/x.ts`" (menjaga workspace baru tak diam-diam dianggap dokumen; workspace baru jatuh ke infra = semua true).

- [ ] **Step 2: Jalankan, pastikan gagal.** Run: `bun test scripts/ci-changes.test.ts` → FAIL.
- [ ] **Step 3: Implementasi `scripts/ci-changes.ts`** sesuai Interfaces (tabel awalan jalur sebagai data, bukan rantai `if`).
- [ ] **Step 4: Jalankan tes dan lint.** Run: `bun test scripts/ci-changes.test.ts` → PASS; `bunx biome check scripts/ci-changes.ts scripts/ci-changes.test.ts`.
- [ ] **Step 5: Commit** `feat(ci): skrip deteksi perubahan ci-changes`

---

### Task 3: Build desktop arm64 + pemeriksaan hasil kemas per arsitektur

**Files:**
- Create: `desktop/scripts/verify-pack-args.ts`
- Create: `desktop/scripts/verify-pack-args.test.ts`
- Modify: `desktop/scripts/verify-pack.ts`
- Modify: `desktop/package.json` (skrip `pack:all`)

**Interfaces:**
- Produces (`verify-pack-args.ts`, murni):
  - `type PackArch = 'x64' | 'arm64'`
  - `function parseArch(argv: string[]): PackArch` — membaca `--arch <x64|arm64>` (juga `--arch=x64`); tanpa argumen = `'x64'`; nilai lain → `throw new Error`.
  - `function unpackedDirName(arch: PackArch): string` — `'win-unpacked'` untuk x64, `'win-arm64-unpacked'` untuk arm64 (nama keluaran electron-builder `--dir`).
  - `function canRun(arch: PackArch, hostArch: string): boolean` — `true` bila `arch === 'x64'`, atau `hostArch === 'arm64'` (hanya host arm yang dapat menjalankan exe arm64).
- `verify-pack.ts`: memakai tiga fungsi itu. Bila `canRun` benar: perilaku lama (asap `--smoke` + cek `ui-baseline`). Bila salah: pemeriksaan statis saja (exe `QC App.exe` ada, `resources/ui-baseline/index.html` ada, `resources/app.asar` ada) dan cetak `verify-pack arm64: hanya pemeriksaan statis (host x64 tak dapat menjalankan exe arm64)` lalu `verify-pack LOLOS`.
- `desktop/package.json`: skrip baru `"pack:all": "bun run build && electron-builder --dir --win --x64 --arm64 --config electron-builder.yml"`; skrip `pack` yang ada tidak diubah.

- [ ] **Step 1: Tulis tes gagal `desktop/scripts/verify-pack-args.test.ts`** (Vitest; `desktop/vitest.config.ts` sudah memuat `scripts/**/*.test.ts`): `parseArch([])` = `'x64'`; `parseArch(['--arch','arm64'])` dan `['--arch=arm64']` = `'arm64'`; `parseArch(['--arch','ia32'])` dan `['--arch']` melempar; `unpackedDirName('x64')` = `'win-unpacked'`, `'arm64'` = `'win-arm64-unpacked'`; `canRun('x64','x64')`, `canRun('x64','arm64')`, `canRun('arm64','arm64')` true dan `canRun('arm64','x64')` false.
- [ ] **Step 2: Jalankan, pastikan gagal.** Run: `bun run --cwd desktop test scripts/verify-pack-args` → FAIL.
- [ ] **Step 3: Implementasi `verify-pack-args.ts` dan ubah `verify-pack.ts`** (jalur unpacked memakai `unpackedDirName(parseArch(process.argv.slice(2)))`; `hostArch = process.arch`). Tambahkan skrip `pack:all`.
- [ ] **Step 4: Jalankan tes, typecheck, lint.** Run: `bun run --cwd desktop test scripts/verify-pack-args` → PASS; `bun run --cwd desktop typecheck`; `bunx biome check desktop`.
- [ ] **Step 5: Verifikasi nyata (mesin Windows x64 pengembang; boleh dilewati bila tak ada akses unduh Electron arm64, catat di laporan):**
  `bun run build:web`, lalu `bun run --cwd desktop pack:all`, lalu `bun run --cwd desktop verify-pack --arch x64` (Expected: `verify-pack LOLOS` dengan asap) dan `bun run --cwd desktop verify-pack --arch arm64` (Expected: `LOLOS` dengan pesan pemeriksaan statis). Bila `win-arm64-unpacked` tak terbentuk atau nama berbeda, sesuaikan `unpackedDirName` dan tesnya, lalu laporkan.
- [ ] **Step 6: Commit** `feat(desktop): pack:all dan verify-pack per arsitektur (x64 asap, arm64 statis)`

---

### Task 4: Aksi `setup` dan workflow `ci.yml`

**Files:**
- Create: `.github/actions/setup/action.yml`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Aksi `setup`: composite; `inputs.filter` (string, bawaan `''`). Langkah: `oven-sh/setup-bun` (`bun-version: 1.4.2`), `actions/cache` (path `~/.bun/install/cache`, key `bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}`, restore-keys `bun-${{ runner.os }}-`), lalu `bun install --frozen-lockfile` dengan `--filter "$FILTER"` bila `FILTER` (env dari `inputs.filter`) tak kosong; `shell: bash`.
- `ci.yml`: `on.workflow_call.inputs`: `ref` (string, bawaan `''`), `pr` (string, bawaan `''`); `outputs.image` = `${{ jobs.changes.outputs.image }}`; `permissions: contents: read` tingkat atas. Job:
  - `changes` (ubuntu-latest, `permissions: contents: read, pull-requests: read`, timeout 5): checkout (`ref: ${{ inputs.ref }}`, `persist-credentials: false`), `oven-sh/setup-bun`, langkah `Deteksi` dengan `env` `GH_TOKEN: ${{ github.token }}`, `REPO: ${{ github.repository }}`, `PR: ${{ inputs.pr }}`. Skrip: `set -uo pipefail`; bila `PR` cocok `^[0-9]+$` jalankan `gh api --paginate "repos/$REPO/pulls/$PR/files" --jq '.[] | .filename, (.previous_filename // empty)'` dan simpan ke variabel (gagal → variabel kosong, cetak `::warning::`); selain itu variabel kosong; lalu `printf '%s\n' "$files" | bun run scripts/ci-changes.ts`. Outputs job = ketujuh kunci `Changes`.
  - `lint` (ubuntu, `if: needs.changes.outputs.code == 'true'`, timeout 15): setup tanpa filter; `bun run typecheck`; `bun run lint`.
  - `scripts` (ubuntu, `if: code`, timeout 15): setup tanpa filter; `bun run scripts/test-scripts.ts`; `bun run --cwd shared test`; `bun run --cwd countrylock test`.
  - `server` (ubuntu, `if: server_tests`, timeout 30): `strategy: { fail-fast: false, matrix: { shard: [1,2,3,4,5,6,7,8] } }`; `env: QC_TEST_DB_URL: mysql://root:ci-only@127.0.0.1:3306/` dan `QC_TEST_SHARD: ${{ matrix.shard }}/8`; langkah: checkout, `./.github/actions/mariadb`, `./.github/actions/setup` dengan `filter: '!@qc/desktop'`, `bun run --cwd server test`. `name: server ${{ matrix.shard }}/8`.
  - `web` (ubuntu, `if: web_tests`, timeout 20): setup `filter: '!@qc/desktop'`; `bun run --cwd web test`.
  - `desktop` (`runs-on: windows-latest`, `defaults.run.shell: bash`, `if: desktop_tests || desktop_pack`, timeout 30): setup tanpa filter; langkah `Tes desktop` (`if: desktop_tests`) `bun run --cwd desktop test`; `Build web` (`if: desktop_pack`) `bun run build:web`; `Kemas x64 dan arm64` (`if: desktop_pack`) `bun run --cwd desktop pack:all`; `Verifikasi x64` dan `Verifikasi arm64` (`if: desktop_pack`) `bun run --cwd desktop verify-pack --arch x64|arm64`.
  - Semua `needs: changes`. Tanpa rujukan `secrets.` apa pun.

- [ ] **Step 1: Tulis tes gagal di `scripts/ci-workflows.test.ts`** (blok `describe('ci.yml: ...')` baru, memakai `parse`/`rawOf` yang ada):
  - pemicu hanya `workflow_call`; input `ref` dan `pr` ada; `permissions` = `{ contents: 'read' }`.
  - hanya job `changes` yang punya `pull-requests: read`; tak ada izin `write` di mana pun.
  - semua checkout: `persist-credentials: false` dan `with.ref` = `${{ inputs.ref }}`.
  - matrix job `server`: `fail-fast: false`, `shard` = `[1..8]`, `env.QC_TEST_SHARD` = `${{ matrix.shard }}/8`, memakai `./.github/actions/mariadb`, `QC_TEST_DB_URL` ke `root:ci-only`.
  - tak ada `secrets.` selain `github.token`/`GITHUB_TOKEN`; tak ada `UI_SIGNING_KEY`/`UI_PUBLIC_KEY_PEM` (sudah dijaga tes lama untuk berkas selain deploy).
  - tak ada `${{` di `run`; langkah `Deteksi` memuat `previous_filename` dan `scripts/ci-changes.ts`.
  - job `desktop` `runs-on: windows-latest` dan memuat `pack:all`, `--arch x64`, `--arch arm64`.
  - semua job selain `changes` bergantung pada `changes`.
  - aksi `setup`: `bun-version` sama dengan `Dockerfile`; semua `uses:` pihak ketiga di `action.yml` itu dipatok SHA (perluas tes "aksi dipatok SHA" agar memindai `.github/actions/setup/action.yml`).
  Tambahkan juga: skrip `Deteksi` dijalankan dengan `gh` palsu di PATH (berkas `gh` sementara yang mencetak `desktop/a.ts` dan `server/a.ts`) dan `GITHUB_OUTPUT` sementara → `image=true`, `desktop_pack=true`; dan dengan `gh` yang gagal (exit 1) → semua `true` (fail-safe).
- [ ] **Step 2: Jalankan, pastikan gagal.** Run: `bun test scripts/ci-workflows.test.ts` → FAIL pada blok baru.
- [ ] **Step 3: Tulis `.github/actions/setup/action.yml` dan `.github/workflows/ci.yml`** sesuai Interfaces (komentar penjelasan Indonesia di kepala berkas, termasuk alasan: gerbang `test` ada di pemanggil, matrix 8 vs proses).
- [ ] **Step 4: Perbarui tes umum yang merujuk berkas lama** agar blok baru dan lama konsisten (tes "versi bun di workflow sama dengan Dockerfile" memeriksa `setup/action.yml`; tes `test.yml` diperbarui di Task 5). Jalankan `bun test scripts/ci-workflows.test.ts` → blok `ci.yml` PASS (kegagalan `test.yml`/deploy yang tersisa diperbaiki di Task 5-6).
- [ ] **Step 5: Lint YAML via tes dan Biome** (`bunx biome check .github` bila Biome memeriksa YAML; jika tidak, cukup tes yang mengurai YAML dengan `Bun.YAML.parse`).
- [ ] **Step 6: Commit** `feat(ci): workflow ci.yml terpilih per perubahan dengan matrix 8 shard`

---

### Task 5: `test.yml` memanggil `ci.yml`, job image, dan gerbang `test`

**Files:**
- Modify: `.github/workflows/test.yml`
- Modify: `scripts/ci-workflows.test.ts` (blok `describe('test.yml dan aksi MariaDB')` dan tes umum yang menyebut `test.yml`)

**Interfaces:**
- Consumes: `ci.yml` (input `pr`, output `image`) dari Task 4.
- `test.yml` baru (pemicu, `concurrency`, `permissions: contents: read` tidak berubah):
  - `ci`: `permissions: { contents: read, pull-requests: read }`, `uses: ./.github/workflows/ci.yml`, `with.pr: ${{ github.event.pull_request.number }}`.
  - `image` (ubuntu, `needs: ci`, `if: needs.ci.outputs.image == 'true'`, `permissions: { contents: read, packages: read }`, timeout 20): checkout, buildx, `docker/login-action` ke `ghcr.io` (`github.actor`, `secrets.GITHUB_TOKEN`), langkah `Nama image` (sama dengan deploy: `ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/qc-app` ke output), `docker/build-push-action` `push: false`, `provenance: false`, `cache-from` dua baris `type=registry,ref=<image>:buildcache-staging` dan `...:buildcache-production`, tanpa `cache-to`.
  - `test` (gerbang; ubuntu, `needs: [ci, image]`, `if: always()`, timeout 2, tanpa checkout): `env` `CI_RESULT: ${{ needs.ci.result }}`, `IMAGE_RESULT: ${{ needs.image.result }}`; skrip: untuk tiap hasil, `success|skipped` lulus, selain itu cetak `::error::` dan keluar 1.
- Job `Build` lama (`bun run build` di job test) dihapus: build web sudah terjadi di Dockerfile (job `image`).

- [ ] **Step 1: Perbarui/tambah tes di `scripts/ci-workflows.test.ts` (gagal dulu):**
  - ganti tes `test.yml memakai aksi MariaDB bersama...` dengan: pemicu tetap `pull_request` (opened, reopened, synchronize); job `ci` memanggil `./.github/workflows/ci.yml`; `ci.yml` memakai aksi MariaDB dan `QC_TEST_DB_URL` ke `root:ci-only`, tanpa `db:tunnel`.
  - tes versi bun: periksa `.github/actions/setup/action.yml` (bukan `test.yml`/deploy teks).
  - gerbang: job `test` ada di `test.yml`, `if: always()`, `needs` memuat `ci` dan `image`; jalankan skrip gerbangnya dengan kombinasi `CI_RESULT`/`IMAGE_RESULT`: (`success`,`skipped`) → 0, (`success`,`success`) → 0, (`failure`,`skipped`) → 1, (`cancelled`,`success`) → 1, (`success`,`failure`) → 1, (`skipped`,`skipped`) → 0.
  - job `image` di test.yml: tidak ada `cache-to`, `push: false`, `permissions` tanpa `write`; larangan kunci tanda tangan (tes lama) tetap lulus.
- [ ] **Step 2: Jalankan, pastikan gagal.** Run: `bun test scripts/ci-workflows.test.ts` → FAIL.
- [ ] **Step 3: Tulis ulang `test.yml`** sesuai Interfaces; perbarui komentar kepala (jelaskan bahwa gerbang `test` menjaga nama check wajib).
- [ ] **Step 4: Jalankan tes.** Run: `bun test scripts/ci-workflows.test.ts` → PASS untuk `ci.yml`, `test.yml`; kegagalan sisa hanya yang menyangkut deploy (Task 6).
- [ ] **Step 5: Commit** `feat(ci): test.yml memanggil ci.yml dengan gerbang test`

---

### Task 6: `deploy-server.yml` — ci selektif, image bersyarat, cache registry

**Files:**
- Modify: `.github/workflows/deploy-server.yml`
- Modify: `scripts/ci-workflows.test.ts` (blok `deploy-server.yml: keamanan` dan terkait)

**Interfaces:**
- Consumes: `ci.yml` (`ref`, `pr`; output `image`).
- Perubahan:
  - Ganti job `check` dengan `ci`: `needs: meta`, `permissions: { contents: read, pull-requests: read }`, `uses: ./.github/workflows/ci.yml`, `with.ref: ${{ needs.meta.outputs.sha }}`, `with.pr: ${{ github.event.pull_request.number }}` (kosong untuk dispatch).
  - `image`: `needs: [meta, ci]`, `if: needs.ci.outputs.image == 'true'`; tambahkan `cache-from` dua tag registry dan `cache-to: type=registry,ref=<image>:buildcache-${{ needs.meta.outputs.target }},mode=max,image-manifest=true,oci-mediatypes=true` untuk SEMUA event (hapus ekspresi `workflow_dispatch` dan `type=gha`). Komentar lama tentang "token pull_request_target tak boleh menulis cache GHA" diganti penjelasan cache registry (token job `image` berizin `packages: write`).
  - `deploy`: `needs: [meta, ci, image]` dan `if: needs.image.result == 'success'`.
  - Tidak ada perubahan pada `meta`, `paths-ignore`, `concurrency`, environment, langkah kunci UI, atau langkah SSH.
- Catatan perilaku (dokumentasikan di komentar): PR berisi `desktop/**`/docs saja → `ci.outputs.image=false` → `image` dan `deploy` dilewati (run hijau). `workflow_dispatch` → `pr` kosong → semua job jalan.

- [ ] **Step 1: Perbarui tes (gagal dulu):**
  - tes cache GHA diganti: `cache-to` memuat `type=registry`, `mode=max`, `buildcache-${{ needs.meta.outputs.target }}`; `cache-from` memuat kedua tag; tak ada `type=gha`.
  - "semua job lain bergantung pada meta": `ci` memakai `needs: meta`; `image` memuat `meta` dan `ci`; `deploy` memuat `meta`, `ci`, `image`.
  - `ci`: `uses` = `./.github/workflows/ci.yml`, `with.ref` = `${{ needs.meta.outputs.sha }}`, tak ada `secrets: inherit`.
  - izin: hanya `image` ber-`packages: write`; `ci` hanya `pull-requests: read` tambahan; `deploy.permissions` tetap `{}`.
  - checkout di `deploy-server.yml` (kini hanya di `image`) tetap `ref` dari `meta`; checkout di `ci.yml` memakai `inputs.ref` (sudah dites Task 4).
  - `image.if` = `needs.ci.outputs.image == 'true'` dan `deploy.if` = `needs.image.result == 'success'`.
  - tes "secret/variabel yang dipakai workflow semuanya tercatat" tetap (tak ada secret baru).
- [ ] **Step 2: Jalankan, pastikan gagal.** Run: `bun test scripts/ci-workflows.test.ts` → FAIL pada tes yang diubah.
- [ ] **Step 3: Ubah `deploy-server.yml`** sesuai Interfaces; perbarui komentar kepala (alur `meta → ci → image → deploy`).
- [ ] **Step 4: Jalankan seluruh tes skrip.** Run: `bun run scripts/test-scripts.ts` → PASS penuh.
- [ ] **Step 5: Commit** `feat(ci): deploy selektif dengan cache lapisan registry`

---

### Task 7: Dokumentasi dan catatan keputusan

**Files:**
- Modify: `docs/ci-cd.md`
- Modify: `CLAUDE.md` (bagian Perintah `bun run check` dan bullet "CI/CD server")
- Modify: `docs/superpowers/specs/2026-11-17-ci-selektif-shard-design.md` (status → "disetujui 2026-11-17"; koreksi bila implementasi menyimpang)

- [ ] **Step 1: `docs/ci-cd.md`:** perbarui daftar workflow dan alur (`meta → ci → image → deploy`); tambahkan bagian "CI selektif dan shard" yang memuat: tabel keluaran `ci-changes` (salin dari spek §5.2), matrix 8 job (`QC_TEST_SHARD`), gerbang `test`, aksi `setup`, cache registry `buildcache-<environment>` (dan catatan: paket `qc-app` di GHCR perlu mengizinkan repo ini menulis; tag cache tak disentuh `QC_KEEP_IMAGES`), build desktop (x64 asap penuh, arm64 hanya kemas silang + pemeriksaan statis karena runner arm tak tersedia di repo privat), perilaku "PR desktop/docs saja tidak men-deploy", dan bagian "Rencana rilis terpisah" (tag `server-v<semver>`/`desktop-v<semver>`; desktop dirilis hanya untuk `desktop/**`, `countrylock/**`, atau endpoint desktop server; bukan `web/`/`shared/`). Hapus kalimat lama tentang cache GHA dan "check" yang usang. Tambahkan catatan "TIDAK terverifikasi sampai run pertama di GitHub" untuk: cache registry, kemas silang arm64, nama check `test`.
- [ ] **Step 2: Catat keputusan pemilik 2026-11-17** di `docs/ci-cd.md` dan spek (build desktop Windows x64+arm64 tanpa Linux; rilis dipisah; matrix job; pemilik produk menyetujui) sesuai aturan pencatatan keputusan.
- [ ] **Step 3: `CLAUDE.md`:** pada `bun run check` tambahkan kalimat bahwa di CI tes server dibagi 8 job matrix lewat `QC_TEST_SHARD=i/8` (lokal tak berubah); pada bullet CI/CD server ganti rantai `meta → check → image → deploy` menjadi `meta → ci → image → deploy`, sebut `ci.yml`, `scripts/ci-changes.ts`, dan bahwa mengubah `ci.yml`/`test.yml`/aksi `setup` berarti mengubah `scripts/ci-workflows.test.ts` dan `docs/ci-cd.md`.
- [ ] **Step 4: Verifikasi.** Run: `bun test scripts/ci-workflows.test.ts` (tes "tercatat di docs/ci-cd.md") → PASS; `bunx biome check .` bersih.
- [ ] **Step 5: Commit** `docs(ci): dokumentasi CI selektif, shard, dan rencana rilis terpisah`

---

### Task 8: Verifikasi akhir dan serah-terima review

- [ ] **Step 1:** `bun run typecheck`, `bun run lint`, `bun run scripts/test-scripts.ts`, `bun run --cwd shared test`, `bun run --cwd countrylock test`, `bun run --cwd desktop test`, `bun run --cwd web test` → semua hijau. Tes server memerlukan tunnel (`bun run db:tunnel`); bila hidup jalankan `bun run --cwd server test` untuk memastikan mode lokal tak berubah, bila tidak catat sebagai tidak terverifikasi.
- [ ] **Step 2:** Simulasi pemetaan pada riwayat nyata: untuk 5 PR/commit terakhir jalankan `git diff --name-only <base>..<head> | bun run scripts/ci-changes.ts` dan periksa keluaran masuk akal; lampirkan ringkasan di laporan.
- [ ] **Step 3:** Review independen (agent baru, tanpa konteks implementer) atas diff + spek, mencakup (a) kesesuaian spek dan regresi, (b) **security review memakai skill `security-audit`** terfokus pada perubahan workflow (izin, `pull_request_target`, rahasia, injeksi ekspresi, token `pull-requests: read`, cache poisoning pada cache registry bersama antar environment). Temuan ditangani sesuai "Menangani temuan review" pada CLAUDE.md global.
- [ ] **Step 4:** Laporkan terpisah: dikerjakan; menunggu konfirmasi; sengaja tidak dikerjakan; dan daftar hal yang hanya terbukti pada run pertama di GitHub.

---

## Self-Review (spek → task)

- §5.1 shard → Task 1. §5.2 deteksi → Task 2. §5.3 `ci.yml` + aksi `setup` + gerbang di pemanggil → Task 4-5. §5.4 desktop x64/arm64 → Task 3-4. §5.5 `test.yml`/`deploy-server.yml`/cache/izin → Task 5-6. §5.6 rilis terpisah dan §6 keputusan → Task 7. §7 risiko → Task 7 (dokumentasi) dan Task 8 (review keamanan).
- Konsistensi nama: `partitionFiles`/`parseShard` (Task 1), `classify`/`ALL_CHANGES`/`formatOutputs` (Task 2), `parseArch`/`unpackedDirName`/`canRun` (Task 3), output `image` dan input `ref`/`pr` (Task 4 → 5, 6), `pack:all` (Task 3 → 4).
