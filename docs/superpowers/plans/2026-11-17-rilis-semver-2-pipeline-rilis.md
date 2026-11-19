# Rilis semver, rencana 2 dari 3: pipeline rilis server (`release.yml`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge PR `release/server-vX.Y.Z` ke `main` otomatis menjalankan guard, build production tanpa cache, deploy production, membuat tag + GitHub Release, dan menyinkronkan `main` ke `dev`; merge ke `main` tidak lagi men-deploy production.

**Architecture:** Build image dan deploy dipindah dari `deploy-server.yml` ke dua workflow yang dapat dipanggil (`server-image.yml`, `server-deploy.yml`) supaya `deploy-server.yml`, `release.yml` (rencana ini), dan `deploy-tag.yml` (rencana 3) memakai langkah keamanan yang SAMA tanpa salinan. Keputusan logika (identitas, guard) ditaruh di skrip murni yang diuji tanpa GitHub.

**Tech Stack:** GitHub Actions (`workflow_call`, `pull_request_target`, `workflow_dispatch`), `gh` CLI, Bun 1.4.2, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-17-rilis-semver-design.md` (5.4, 5.6, 5.7). Bergantung pada rencana 1 (`2026-11-17-rilis-semver-1-fondasi.md`: `scripts/changelog.ts`, `isReleaseChange`, `/api/ping` versi, `GIT_SHA`).

## Global Constraints
- Semua Global Constraints rencana 1 berlaku (aksi dipatok SHA, tanpa `${{ }}` di `run`, izin minimal, `bun run check` hijau, atribusi commit).
- `pull_request_target` selalu berjalan dari workflow di `main`: `release.yml` baru efektif setelah ada di `main`; perubahan `deploy-server.yml` baru efektif untuk event PR setelah ada di `main`. `workflow_dispatch` memakai file di ref yang dipilih, jadi hasil refaktor dapat diuji dari `dev` sebelum dipromosikan.
- Checkout hanya `merge_commit_sha`; tidak pernah head/ref PR. `contents: write` hanya di job `mark-deployed`, `publish`, `sync-dev`; `pull-requests: write` hanya di `sync-dev`.
- Production selalu tanpa cache registry (`no-cache`); staging membaca cache `buildcache-<env>`. Tag image: SHA commit, ditambah `server-vX.Y.Z` pada rilis.
- Satu pipeline production pada satu waktu: grup `concurrency` `deploy-server-production` dipakai `deploy-server.yml` (dispatch production), `release.yml`, dan `deploy-tag.yml`; `cancel-in-progress: false`.
- Kode keluar `deploy.sh` 0-5 dipetakan ke pesan yang sama seperti sekarang; kode 6 (rencana 3) sudah ditangani di sini sebagai "downgrade skema ditolak".

## Review Focus
- PR rilis di-squash/rebase atau berasal dari fork atau cabang bernama `release/server-v1.2.3` tetapi `version` di commit merge berbeda: `meta` menolak dan tidak ada job lain berjalan.
- `dev` maju setelah rilis disiapkan (staging memuat commit di luar metadata): guard gagal, tidak ada build/deploy/tag, pesan menyebut cara pulih (`workflow_dispatch` `versi`).
- Deploy production sukses tetapi pembuatan tag/Release gagal di tengah: menjalankan ulang `workflow_dispatch` tidak men-deploy ulang secara membabi buta dan tidak membuat tag ganda; tag yang sudah ada pada SHA sama dilewati, pada SHA lain menggagalkan.
- Merge `main` -> `dev` konflik (409): PR `main` -> `dev` dibuka, workflow tidak gagal; tanpa izin membuat PR: peringatan jelas, bukan galat samar.
- Setelah refaktor, tidak satu pun jaminan lama `deploy-server.yml` hilang (kunci UI hanya di job image, tanpa checkout di job deploy, no-cache production, cache staging, `mark-deployed` hanya setelah sukses).

---

### Task 1: Ekstrak `server-image.yml` dan `server-deploy.yml` (refaktor tanpa perubahan perilaku)

**Files:**
- Create: `.github/workflows/server-image.yml`, `.github/workflows/server-deploy.yml`
- Modify: `.github/workflows/deploy-server.yml` (job `image`, `deploy`, `mark-deployed` menjadi pemanggil), `scripts/ci-workflows.test.ts`, `docs/ci-cd.md`

**Interfaces:**
- Produces: `server-image.yml` (`workflow_call`): inputs `target` (staging|production), `sha` (40 heksa), `extra-tags` (string, tag tambahan dipisah baris, bawaan kosong); output `tag` (= `sha`). Isi job = langkah-langkah job `image` sekarang tanpa perubahan (kebijakan cache, kunci UI, `GIT_SHA` dari rencana 1), ditambah `tags` untuk `extra-tags` yang divalidasi `^server-v\d+\.\d+\.\d+$` di langkah sendiri.
- `server-deploy.yml` (`workflow_call`): inputs `target`, `sha`, `allow-schema-downgrade` (boolean, bawaan false, dipakai rencana 3; di sini hanya diteruskan sebagai kata ` allow-schema-downgrade` pada perintah SSH bila true); job `deploy` (SSH, tanpa checkout) lalu `mark-deployed`. Izin per job seperti sekarang (`permissions: {}` untuk `deploy`; `contents: write` hanya `mark-deployed`).
- Pemanggil: job `image` dan `deploy` di `deploy-server.yml` memakai `uses:` dengan `secrets: inherit`; job pemanggil memberi izin sebanyak yang dibutuhkan job terpanggil (`packages: write` untuk image; `contents: write` untuk mark-deployed).

- [ ] **Step 1: Pindahkan tes dulu.** Di `ci-workflows.test.ts`, ubah penunjuk berkas pada tes yang memeriksa langkah job `image`/`deploy`/`mark-deployed` agar membaca `server-image.yml` dan `server-deploy.yml`, tanpa melemahkan asersi apa pun; tambah asersi: `deploy-server.yml` job `image` dan `deploy` hanya `uses` kedua workflow itu (tanpa `steps`), `server-image.yml`/`server-deploy.yml` hanya memicu `workflow_call`, `deploy` terpanggil tak punya langkah `actions/checkout`, `environment: ${{ inputs.target }}` ada di job image dan deploy, dan `extra-tags` divalidasi regex sebelum dipakai.
- [ ] **Step 2: Jalankan** `bun test scripts/ci-workflows.test.ts`. Expected: gagal (berkas baru belum ada).
- [ ] **Step 3: Implementasi** pemindahan langkah apa adanya; ganti `needs.meta.outputs.*` dengan `inputs.*`; pertahankan semua komentar penjelas yang relevan.
- [ ] **Step 4: Jalankan** `bun test scripts/ci-workflows.test.ts` dan `bun run lint`. Expected: lulus.
- [ ] **Step 5: Verifikasi nyata (butuh izin pemilik, mengubah staging):** setelah cabang di-push, jalankan `deploy-server.yml` lewat `workflow_dispatch` dari cabang ini dengan target `staging` dan pastikan seluruh job hijau dan `/api/ping` memuat `version`. Catat hasilnya di ledger; bila gagal, perbaiki sebelum lanjut.
- [ ] **Step 6: Commit** `refactor(ci): image dan deploy server jadi workflow dapat dipanggil`.

### Task 2: Skrip keputusan rilis (`release-identity`, `release-guard`)

**Files:**
- Create: `scripts/release-identity.ts`, `scripts/release-identity.test.ts`, `scripts/release-guard.ts`, `scripts/release-guard.test.ts`

**Interfaces:**
- Consumes: `isReleaseChange` dan `compareSemver`/`extractSection` (rencana 1).
- Produces: `checkIdentity(input: { baseRepo: string; headRepo: string; headRef: string; baseRef: string; parents: number; versionAtMerge: string }): { ok: true; component: 'server'; version: string } | { ok: false; reason: string }` (menolak: bukan `main`, fork, cabang tak cocok `^release/server-v(\d+\.\d+\.\d+)$`, `parents !== 2`, versi berkas ≠ versi cabang; `reason` berbahasa Indonesia dan tidak memuat nilai masukan mentah selain versi); `evaluateGuard(input: { compareStatus: string; files: string[]; changelogHasVersion: boolean }): { ok: boolean; reason: string }` (lulus hanya bila status `ahead`, `isReleaseChange(files, 'server')`, dan bagian CHANGELOG ada; daftar berkas kosong dengan status `identical` juga lulus). CLI tipis untuk keduanya membaca JSON dari env dan keluar 1 dengan `::error::`.

- [ ] **Step 1: Tes gagal** untuk semua cabang keputusan di atas, termasuk: `1.2.3` vs berkas `1.2.4` ditolak, fork ditolak, squash (`parents: 1`) ditolak, nama cabang `release/server-v1.2.3-evil` dan `release/server-v01.2.3` ditolak, guard menolak `diverged`/`behind`, menolak satu berkas non-metadata di antara berkas metadata, menolak berkas `desktop/package.json` pada rilis server, dan menolak CHANGELOG tanpa bagian versi.
- [ ] **Step 2: Jalankan** `bun test scripts/release-identity.test.ts scripts/release-guard.test.ts`. Expected: gagal.
- [ ] **Step 3: Implementasi** fungsi dan CLI.
- [ ] **Step 4: Jalankan ulang tes.** Expected: lulus.
- [ ] **Step 5: Commit** `feat(rilis): keputusan identitas dan guard rilis`.

### Task 3: `release.yml`, `workflow_dispatch` pemulihan, dan pencabutan pemicu production di `deploy-server.yml`

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `.github/workflows/deploy-server.yml` (pemicu `branches: [dev]` saja untuk `pull_request_target`; hapus cabang `main` pada `meta` dan ekspresi `concurrency`; dispatch tetap), `scripts/ci-workflows.test.ts`, `docs/ci-cd.md`

**Interfaces:**
- Consumes: `server-image.yml`, `server-deploy.yml` (Task 1), `checkIdentity`/`evaluateGuard` (Task 2), `scripts/changelog.ts extract` (rencana 1).
- Pemicu: `pull_request_target` (`closed`, `branches: [main]`) dan `workflow_dispatch` (input `versi`, `X.Y.Z`, hanya dari ref `refs/heads/main`). Pada dispatch, `meta` mencari PR yang di-merge untuk `release/server-v<versi>` ke `main` (`gh pr list --head ... --state merged --json number,mergeCommit`), lalu menjalankan pagar identitas yang sama.
- Job: `meta` (identitas; output `sha`, `version`) -> `guard` (`gh api git/ref/deployed/staging` lalu `compare/<ref>...<sha>`, `evaluateGuard`; berhenti dengan pesan pemulihan) -> `ci` (`ci.yml`, tanpa `since-deploy` = semua) -> `image` (`server-image.yml`, target production, `extra-tags` = `server-v<versi>`) -> `deploy` (`server-deploy.yml`, production) -> `publish` (checkout `sha`; bila tag `server-v<versi>` ada pada SHA sama = lewati pembuatan; pada SHA lain = gagal; selain itu `gh release create` dengan `--target <sha>`, judul `Server v<versi>`, badan dari `changelog extract server <versi>`) -> `sync-dev` (`POST repos/R/merges` base `dev` head `main`; 409 = `gh pr create --base dev --head main`; gagal membuat PR = peringatan dengan petunjuk setelan "Allow GitHub Actions to create pull requests").
- `concurrency`: grup `deploy-server-production`, `cancel-in-progress: false`.

- [ ] **Step 1: Tes gagal** (`ci-workflows.test.ts`): pemicu dan izin tiap job persis seperti Global Constraints; `meta` memakai `release-identity` dan tidak pernah men-checkout; `publish`/`sync-dev`/`mark-deployed` satu-satunya `contents: write`; `pull-requests: write` hanya `sync-dev`; checkout hanya `sha` keluaran `meta`; tanpa `${{ }}` di `run`; `deploy-server.yml` tidak lagi memiliki `main` pada `pull_request_target` maupun pemetaan `main` -> production di `meta`, dispatch production tetap hanya dari main; `release.yml` dispatch hanya dari main.
- [ ] **Step 2: Jalankan** `bun test scripts/ci-workflows.test.ts`. Expected: gagal.
- [ ] **Step 3: Implementasi** workflow dan perubahan `deploy-server.yml` DALAM SATU KOMMIT yang sama. **Penyesuaian keputusan pemilik 2026-11-18 (spek bagian 3 dan 5.4): saklar `vars.RELEASE_FLOW`**: `deploy-server.yml` tetap memuat pemicu `main` tetapi job `meta` melewati production bila `RELEASE_FLOW == 'tag'`; `release.yml` hanya berjalan bila `RELEASE_FLOW == 'tag'`; bawaan (kosong/`langsung`) = perilaku sekarang; `release:prepare` menolak bila `gh variable get RELEASE_FLOW` bukan `tag`; tes `ci-workflows.test.ts` menjaga kedua syarat itu dan bahwa tak pernah keduanya aktif sekaligus; perbarui `docs/ci-cd.md` (alur rilis, pemulihan, setelan repo yang dibutuhkan, tidak ada lagi deploy otomatis dari `main`).
- [ ] **Step 4: Jalankan** `bun test scripts/ci-workflows.test.ts scripts/release-identity.test.ts scripts/release-guard.test.ts` dan `bun run check`. Expected: lulus.
- [ ] **Step 5: Commit** `feat(rilis): pipeline rilis server dari PR rilis`.

### Task 4: Dokumentasi dan uji tanpa dampak

**Files:**
- Modify: `CLAUDE.md` (ringkas: tidak ada deploy otomatis dari `main`, rilis lewat `release:prepare`), `docs/ci-cd.md` (checklist pemilik: setelan "Allow GitHub Actions to create pull requests", environment `production` mengizinkan ref `main`, label `tanpa-changelog`), `docs/e2e-checklist.md` (rilis percobaan)

- [ ] **Step 1: Tulis** bagian dokumen di atas dan perbarui daftar rahasia/variabel di `docs/ci-cd.md` (dijaga `ci-workflows.test.ts`).
- [ ] **Step 2: Jalankan** `bun test scripts/ci-workflows.test.ts` dan `bun run lint`. Expected: lulus.
- [ ] **Step 3: Commit** `docs(rilis): alur rilis server di ci-cd dan CLAUDE.md`.
- [ ] **Step 4 (milik pemilik, bukan agen):** setelah promosi `dev` -> `main` pertama, rilis percobaan `bun run release:prepare server 1.0.0` dan amati satu putaran penuh; temuan dicatat sebagai pekerjaan susulan.

## Ditunda (tidak ada di rencana ini, sengaja)
- Spek 5.4 menyebut guard juga sebagai "check informatif pada PR rilis". Rencana ini hanya menjalankan guard di `release.yml` dan sebagai pemeriksaan awal `release:prepare` (rencana 1); check informatif di PR rilis ditunda sampai rilis percobaan pertama menunjukkan apakah dibutuhkan.
