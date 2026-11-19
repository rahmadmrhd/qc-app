# Rilis semver, rencana 3 dari 3: deploy lewat tag dan pagar downgrade skema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pemilik dapat men-deploy (naik atau turun) versi server tertentu ke staging atau production lewat `workflow_dispatch` dengan tag `server-vX.Y.Z`, dan downgrade yang melewati migrasi basis data ditolak, baik oleh CI maupun oleh `deploy.sh` di VPS.

**Architecture:** `deploy.sh` mendapat fungsi `schema_guard` (membandingkan `schema_migrations` yang sebenarnya dengan migrasi di image target; kode keluar baru 6), perintah SSH menerima ekor opsional ` allow-schema-downgrade`. `deploy-tag.yml` memeriksa asal tag (provenance) dan melakukan pagar downgrade dini dari git, lalu memanggil `server-deploy.yml` (rencana 2) tanpa build.

**Tech Stack:** Bash (`deploy/deploy.sh`), GitHub Actions, `gh` CLI, Bun 1.4.2, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-11-17-rilis-semver-design.md` (5.5, 5.5.1, 5.6, 5.7). Bergantung pada rencana 1 dan 2.

## Global Constraints
- Semua Global Constraints rencana 1 dan 2 berlaku.
- **`deploy/deploy.sh` tidak dibawa CI**: salin manual ke staging dan production di VPS SEBELUM PR yang menambah `deploy-tag.yml` di-merge (keputusan pemilik 2026-11-17). Perubahan ini menyentuh jalur deploy produksi: eksekusi tugas 1 hanya setelah pemilik memberi izin eksplisit untuk menyalin; agen tidak pernah menyalin ke VPS.
- `REQUEST_PATTERN` menjadi `^deploy (staging|production) ([0-9a-f]{40})( allow-schema-downgrade)?$`, batas panjang 96; kata izin tak pernah dicetak balik atau diekspansi; kode keluar 0-5 tidak berubah, 6 = downgrade skema ditolak.
- Kata sandi DB hanya lewat env `MYSQL_PWD` (tak pernah argv/log); keluaran compose dan docker tetap ke `$DEPLOY_LOG`, tidak ke pemanggil.
- Nama migrasi yang dipakai di argumen docker harus lolos `^[0-9]{4}_[a-z0-9_]+\.sql$`.
- Tag deploy: regex `^server-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`; production hanya dari ref `refs/heads/main`.

## Review Focus
- DB berjalan tetapi `schema_migrations` tidak terbaca, atau daftar migrasi image gagal dibaca: kode 6 (gagal tertutup), kata izin tidak melonggarkan.
- Migrasi di selisih downgrade yang berkasnya tak ada di image yang sedang berjalan atau berbaris pertama `-- qc:contract`: ditolak walau berizin.
- Penolakan pagar memulihkan `.env` persis (izin 600), tidak menjalankan `up -d`, dan melepas kunci; rollback otomatis tidak memanggil pagar.
- Catatan provenance (review bagian 2, 2026-11-18): Release buatan `github-actions[bot]` BUKAN bukti kuat sendirian, karena penulis berizin tulis dapat memicu workflow lain yang membuat Release dengan token yang sama; syarat lain di bawah (SHA leluhur `main`, `version` berkas = tag) tetap wajib dan menjadi pagar utama.
- Tag palsu (dibuat siapa pun berizin tulis): tanpa Release buatan `github-actions[bot]`, atau SHA bukan leluhur `main`, atau `version` berkas ≠ tag: `deploy-tag.yml` menolak sebelum SSH.
- Perintah SSH bentuk lama tetap bekerja tanpa perubahan (kompatibel mundur); bentuk dengan ekor lain, ganda, atau huruf besar ditolak kode 2; panjang 81 diterima, 97 ditolak.

---

### Task 1: Pagar downgrade skema di `deploy.sh`

**Files:**
- Modify: `deploy/deploy.sh`, `server/src/deploy-script.test.ts`, `docs/deploy-vps.md` (bagian 14: urutan penyalinan dan kode keluar 6), `docs/ci-cd.md`

**Interfaces:**
- Produces (di `deploy.sh`): variabel `ALLOW_DOWNGRADE` (0/1) dari ekor perintah; fungsi `image_repo` (turunan dari logika repositori di `cleanup_images`, dipakai bersama oleh keduanya); fungsi `db_sql` (satu tempat kredensial DB/`MYSQL_PWD`, dipakai bersama `db_preflight`); `schema_guard` dipanggil SESUDAH `compose pull qc-app` berhasil dan SEBELUM `rm -f "$ENV_BACKUP"`; bila menolak: `restore_env` lalu `die 6 <pesan>`.
- Urutan keputusan `schema_guard`: DB tidak berjalan -> lewati (log); `A` = nama dari `SELECT name FROM schema_migrations ORDER BY name` (gagal baca = die 6); `B` = keluaran `docker run --rm --network none --entrypoint ls <repo>:<TAG> /app/server/migrations` disaring `*.sql` (gagal = die 6); `D = A \ B`; kosong = lolos; ada nama di `D` yang tak lolos regex = die 6; untuk tiap nama di `D`: baris pertama dibaca dari image `<repo>:$PREV_TAG` (`docker run --rm --network none --entrypoint head <img> -n1 /app/server/migrations/<nama>`); tak terbaca, `PREV_TAG` kosong, atau memuat `-- qc:contract` = die 6 (selalu); selain itu `D` tak kosong tanpa `ALLOW_DOWNGRADE=1` = die 6, dengan izin = lanjut dan `log` mencatat jumlah serta nama.
- Fake docker di tes: `docker exec ... -e 'SELECT name FROM schema_migrations ...'` menjawab isi berkas keadaan `applied`; `docker run ... ls` menjawab berkas keadaan `image_migrations_<tag>`; `docker run ... head ...` menjawab berkas keadaan `firstline_<nama>`; berkas keadaan `*_fail` memaksa kegagalan.

- [ ] **Step 1: Tes gagal** di `deploy-script.test.ts` (grup baru `deploy.sh: pagar downgrade skema`): upgrade (B ⊇ A) lolos; sama lolos; downgrade tanpa kata izin = kode 6, `.env` identik dengan sebelum deploy, tidak ada `compose up`, kunci terlepas; dengan kata izin = lolos dan log menyebut nama migrasi yang dilewati; migrasi `-- qc:contract` ditolak walau berizin; berkas tak terbaca di image berjalan ditolak walau berizin; `PREV_TAG` kosong ditolak walau berizin; `schema_migrations` gagal dibaca = kode 6; daftar image gagal = kode 6; kontainer DB tidak berjalan = dilewati dan deploy lanjut; nama migrasi tak valid (`../x.sql`, `0001_A.sql`) ditolak; format perintah: kata izin sah diterima, `allow-schema-downgrade allow-schema-downgrade`, `ALLOW-SCHEMA-DOWNGRADE`, ekor lain, dan panjang 97 ditolak kode 2, panjang 81 (`deploy production <sha> allow-schema-downgrade`) diterima; kata sandi DB tak muncul di argumen docker (kecuali `-e MYSQL_PWD` tanpa nilai), log, maupun stdout; `--dry-run` menyebut pagar; rollback otomatis (versi baru tak sehat) tidak memanggil `schema_guard` (tidak ada `docker run ... ls` tambahan).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/deploy-script.test.ts`. Expected: gagal pada kasus baru, kasus lama tetap lulus.
- [ ] **Step 3: Implementasi** di `deploy.sh` mengikuti Interfaces; perbarui komentar kepala (kode keluar 6, bentuk perintah, penjelasan pagar) dan teks `--dry-run`.
- [ ] **Step 4: Jalankan ulang** `bun run --cwd server test src/deploy-script.test.ts` dan `bash -n deploy/deploy.sh`. Expected: semua lulus.
- [ ] **Step 5: Commit** `feat(deploy): pagar downgrade skema di deploy.sh`.
- [ ] **Step 6 (milik pemilik, bukan agen):** salin `deploy/deploy.sh` ke VPS (staging dan production), lalu `bash deploy.sh --dry-run` dengan `SSH_ORIGINAL_COMMAND` contoh untuk memastikan skrip valid; catat di ledger bahwa penyalinan sudah dilakukan SEBELUM Task 3 di-merge.

### Task 2: Konvensi migrasi `-- qc:contract`

**Files:**
- Create: `scripts/migration-contract.ts`, `scripts/migration-contract.test.ts`
- Modify: `server/migrations/0002_hapus_sync_rev.sql`, `0003_hapus_external_id.sql`, `0012_serial_number.sql` (hanya menambah baris pertama `-- qc:contract`), `docs/adding-a-module.md` atau `CLAUDE.md` (aturan migrasi: penanda wajib)

**Interfaces:**
- Produces: `isDestructive(sql: string): boolean` (mengenali `DROP COLUMN|TABLE|INDEX|CONSTRAINT|FOREIGN KEY`, `RENAME COLUMN|TABLE|TO`, `CHANGE COLUMN`, tanpa memperhatikan huruf, dan mengabaikan baris komentar `--`); `hasContractMarker(sql: string): boolean` (baris PERTAMA persis `-- qc:contract`, boleh diikuti spasi); `listContractMigrations(names: string[], read: (n: string) => string): string[]`. Satu fungsi dipakai tes dan `scripts/deploy-tag-check.ts` (Task 3).
- Ruling: tiga migrasi lama yang destruktif diberi penanda (hanya komentar) daripada memakai daftar pengecualian, karena pagar VPS membaca penanda dari berkas migrasi dan tidak dapat melihat daftar pengecualian di repo; `schema_migrations` hanya menyimpan nama, jadi menambah komentar aman bagi basis data yang sudah menerapkannya.

- [ ] **Step 1: Tes gagal:** semua berkas `server/migrations/*.sql` yang `isDestructive` harus `hasContractMarker`; tes mandiri atas `isDestructive` (huruf kecil/besar, komentar yang memuat kata `DROP` tidak dihitung, `DROP TABLE IF EXISTS` dihitung); `hasContractMarker` salah bila penanda tidak di baris pertama atau ada spasi di depan.
- [ ] **Step 2: Jalankan** `bun test scripts/migration-contract.test.ts`. Expected: gagal untuk 0002, 0003, 0012.
- [ ] **Step 3: Implementasi** fungsi dan tambah baris pertama pada tiga migrasi; periksa `bun run --cwd server test` untuk tes migrasi/templat (hash migrasi menyegarkan templat otomatis).
- [ ] **Step 4: Jalankan** `bun test scripts/migration-contract.test.ts` dan tes server terkait migrasi. Expected: lulus.
- [ ] **Step 5: Commit** `feat(migrasi): penanda qc:contract untuk migrasi destruktif`.

### Task 3: `deploy-tag.yml` dan pemeriksaan provenance/downgrade dini

**Files:**
- Create: `scripts/deploy-tag-check.ts`, `scripts/deploy-tag-check.test.ts`, `.github/workflows/deploy-tag.yml`
- Modify: `scripts/ci-workflows.test.ts`, `docs/ci-cd.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `server-deploy.yml` (rencana 2), `hasContractMarker`/`isDestructive` (Task 2).
- Produces: `parseTag(tag: string): { version: string } | null`; `checkProvenance(input: { tag: string; tagSha: string; mainRelation: string; versionAtSha: string; releaseAuthor: string | null; releaseDraft: boolean; imageExists: boolean }): { ok: boolean; reason: string }` (lulus hanya bila `mainRelation` ∈ {`behind`,`identical`} (SHA leluhur `main`), `versionAtSha === versi tag`, Release ada, bukan draf, dibuat oleh `github-actions[bot]`, image ada); `checkDowngrade(input: { applied: string[]; target: string[]; firstLines: Record<string, string>; allow: boolean }): { ok: boolean; reason: string; skipped: string[] }` (`applied` = migrasi di SHA yang sedang aktif di environment (`refs/deployed/<env>`), `target` = di SHA target; selisih `applied \ target` kosong = lolos; ada berpenanda contract = tolak selalu; selain itu tolak kecuali `allow`).
- Workflow `deploy-tag.yml`: `workflow_dispatch` inputs `tag`, `environment` (staging|production), `izinkan_downgrade_skema` (boolean, bawaan false); job `meta` (validasi ref: production hanya `refs/heads/main`, staging dari main/dev; regex tag; `tag` -> SHA lewat `gh api git/ref/tags/<tag>` dan dereferensi tag beranotasi), `verify` (provenance + downgrade dini memakai `gh api` ke `contents`/`compare`; image dicek dengan `docker buildx imagetools inspect` setelah login GHCR `packages: read`; tidak ada checkout kode), `deploy` (`uses: server-deploy.yml` dengan `allow-schema-downgrade` = input). Grup `concurrency` `deploy-server-<environment>` (production = grup yang sama dengan `release.yml`), `cancel-in-progress: false`.

- [ ] **Step 1: Tes gagal** (`deploy-tag-check.test.ts`): tag valid/tidak (`server-v1.2.3` ya; `server-v01.2.3`, `server-v1.2`, `v1.2.3`, `server-v1.2.3-rc1`, spasi, huruf besar tidak); provenance menolak untuk setiap syarat yang gagal satu per satu (SHA bukan leluhur `main`: status `diverged`/`ahead`, versi berbeda, Release tak ada, draf, pembuat bukan bot, image tak ada); downgrade: upgrade/sama lolos, downgrade biasa ditolak tanpa izin dan lolos dengan izin (mengembalikan nama yang dilewati), downgrade ber-`-- qc:contract` ditolak walau berizin, berkas tanpa baris pertama terbaca dianggap contract. `ci-workflows.test.ts`: `deploy-tag.yml` hanya memicu `workflow_dispatch`, tanpa checkout, production hanya dari main, tanpa `${{ }}` di `run`, `deploy` memakai `server-deploy.yml`, izin minimal per job, grup `concurrency` benar.
- [ ] **Step 2: Jalankan** `bun test scripts/deploy-tag-check.test.ts scripts/ci-workflows.test.ts`. Expected: gagal.
- [ ] **Step 3: Implementasi** fungsi, CLI tipis (JSON dari env, keluar 1 dengan `::error::`), dan workflow.
- [ ] **Step 4: Jalankan** kedua berkas tes lalu `bun run check`. Expected: lulus.
- [ ] **Step 5: Commit** `feat(ci): deploy versi tertentu lewat tag`.

### Task 4: Dokumentasi dan prasyarat pemilik

**Files:**
- Modify: `docs/ci-cd.md` (cara menjalankan deploy-tag, tabel kode keluar `deploy.sh` termasuk 6, kapan memakai `izinkan_downgrade_skema`, keterbatasan pagar: hanya nama berkas migrasi), `docs/deploy-vps.md` (penyalinan `deploy.sh`), `docs/e2e-checklist.md` (skenario downgrade ditolak/berizin di staging)

- [ ] **Step 1: Tulis** dokumen di atas; tambahkan daftar prasyarat pemilik: `deploy.sh` baru sudah disalin ke VPS, environment `production` mengizinkan ref `main`.
- [ ] **Step 2: Jalankan** `bun test scripts/ci-workflows.test.ts` dan `bun run lint`. Expected: lulus.
- [ ] **Step 3: Commit** `docs(deploy): deploy lewat tag dan pagar downgrade`.
- [ ] **Step 4 (milik pemilik, bukan agen):** uji di staging: deploy tag yang lebih baru (lolos), tag lebih lama melewati migrasi tanpa izin (ditolak kode 6), dengan izin (lolos), lalu kembalikan ke versi semula.
