# Versi API Fase 3 (deprecated, 426 `CLIENT_OUTDATED`, `minClient`, layar penahan, pagar rilis): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bila kelak ada perubahan kontrak API yang merusak, server dapat menandai versi sebagai deprecated, menghapus rute lama dengan jawaban `426 CLIENT_OUTDATED`, dan memaksa klien (web dan desktop) memperbarui, tanpa merusak Country Lock, draf lokal, atau antrean offline. Mekanismenya dikirim SEBELUM ada rute yang dihapus, karena klien yang sudah tersebar tak bisa diajari belakangan.

**Architecture:** Fungsi murni di `shared/api-versions.ts` (pencocok rute terhapus, deteksi versi deprecated yang terpakai, parser `minClient`) dipakai server (`registerRest`, `/api/ping`), web (penyimpanan peta server, penyimpan tingkat "perlu perbarui", spanduk, pemuatan ulang paksa), dan desktop (kanal jembatan `app.*`, layar penahan). Pagar rilis: `release:prepare server` membandingkan potret kontrak rilis sebelumnya dengan kontrak sekarang dan menolak penghapusan yang belum berumur 24 jam sejak rilis yang menandai deprecated.

**Tech Stack:** TypeScript, Bun (`bun:test` untuk `shared/`, `server/`, `scripts/`), Hono, Vitest (`web/`, `desktop/`), Electron 45 + `electron-updater`, zod, Biome.

**Spec:** `docs/superpowers/specs/2026-11-20-versi-api-fase3-design.md` (bagian 2 cakupan 1-6, 5a pilihan perancang, 5b keputusan pemilik); induk `2026-11-20-versi-api-ui-dasar-paksa-update-design.md` (6.7, 6.8) dan `2026-11-17-changelog-dan-unduh-desktop-web-design.md` 5.3.

**Prasyarat:** PR "halaman daftar unduhan desktop" (`docs/superpowers/plans/2026-11-20-halaman-unduh-desktop.md`) sudah ter-merge ke `dev`: rencana ini memakai `MIN_CLIENT` dari `shared/api-versions.ts` dan menautkan layar penahan ke halaman `/desktop`-nya. Cabang kerja: `git fetch origin && git switch -c feat/versi-api-fase3 origin/dev`. Satu PR besar (keputusan pemilik 2026-11-20), komit per fase: server (Task 1-2), web (Task 3, 4, 6), desktop (Task 5), rilis (Task 7), dokumen (Task 8).

## Global Constraints
- `shared/` murni: tanpa `URL`, `fetch`, `atob`, `Buffer`, atau API DOM/Node di kode non-tes; import internal relatif.
- Perilaku v1 hari ini TIDAK berubah: tak ada rute yang dihapus, `RETIRED_ROUTES` tetap `[]`, `API_GROUP_VERSIONS` tetap `latest: 1, deprecated: []` untuk semua kelompok. Semua mekanisme baru diuji dengan tabel/kebijakan sintetis (seperti `server/src/http/rest-version-handler.test.ts`), bukan dengan menghapus rute nyata.
- `MIN_CLIENT.desktop` tetap `'0.0.0'` (satu-satunya sumber nilai; `/api/ping` hanya menyalin konstanta itu). Anti-tujuan: nilai yang memaksa installer terpasang memperbarui secara tak sengaja, karena itu ada tes yang menjamin `compareVersions(MIN_CLIENT.desktop, <versi di desktop/package.json>) <= 0`.
- Kode galat baru `CLIENT_OUTDATED`, status HTTP 426, problem+json seperti galat lain; keputusan klien memakai `code` (bukan status): 426 polos tanpa badan problem (mis. dari proksi) TIDAK dianggap `CLIENT_OUTDATED`.
- Rute terhapus dijawab `426` SEBELUM `authorize`, tanpa sesi (spek 5a butir 1); cakupan hanya rute di `API_ROUTES` pada awalan `/api/v<n>`. `/auth/*`, `/api/public/*`, `/api/desktop/*`, dan aliran notifikasi tidak ikut (spek 5a butir 4).
- Header `Deprecation: true` pada SEMUA respons (sukses maupun galat) rute berversi yang tercantum di `deprecated` kelompoknya.
- Klien lama (tanpa field `minClient` di ping) dan server lama (ping tanpa field itu) tetap jalan: field hilang/rusak = tidak ada yang menahan, tidak melempar.
- Penyimpanan peta `apis` SUDAH ada di `web/src/lib/api/versions.ts` (kunci `localStorage` `qc.api.apis`; spek 5a butir 5 menyebut `qc.api.versions`, nama yang dipakai kode menang). Rencana ini memakai ulang modul itu, tidak membuat penyimpanan baru.
- Layar penahan desktop: tombol utama "Perbarui sekarang" (tanpa "Nanti"; dapat ditekan lagi); bila gagal, teks galat + tautan ke halaman `/desktop` di peramban sistem lewat kanal jembatan (renderer tak pernah menyebut URL). `/country-lock` (rute di luar layout `_app`) dan draf lokal TIDAK ditahan.
- Pemuatan ulang paksa web memakai alur `update.ts` yang ada (`isSafeToReload`): ketikan belum tersimpan menunda pemuatan ulang dan spanduk tetap tampil; versi deprecated saja = spanduk tanpa memuat ulang.
- Antrean offline: entri yang ditolak `426` dibuang ke jalur "ditolak" dengan alasan jelas di penguras halaman DAN `web/public/sync-sw.js` (klasifikasi ada di dua tempat, dijaga `outbox-parity.test.ts`: ubah keduanya).
- Kanal jembatan baru: ikuti resep `CLAUDE.md` (tambah di `BRIDGE_CHANNELS` dan `BRIDGE_ARGS`, handler di `ipc.ts`, preload, `web/src/modules/countrylock/fake-bridge.ts`); `BRIDGE_VERSION` naik ke 10, `UI_MIN_BRIDGE_VERSION` TIDAK naik; renderer tak pernah menerima token, alamat server, atau jalur berkas.
- Teks UI/komentar/pesan Indonesia santai; fragmen changelog `tipe(area): ringkasan` (maks. 200 karakter) di `server/changelog.d/` dan `desktop/changelog.d/` (nama `20261120-<nn>-<slug>.md`; perubahan `shared/` mewajibkan keduanya).
- Tes server butuh terowongan hidup (`bun run db:tunnel`); `bun run check` gagal tanpanya. Push/PR mengikuti aturan global proyek (cek status PR dulu).

## Review Focus
1. Ping tanpa `minClient` / dengan `minClient` rusak (`null`, string, versi tak semver) dan versi desktop tak terbaca (jembatan lama, galat): layar penahan TIDAK muncul, tak melempar (Task 3 dan 6).
2. `/country-lock` tetap terbuka dan draf Catat Serial Number tidak hilang saat layar penahan aktif; layar hanya menggantikan isi layout `_app` (Task 6).
3. `426` datang saat ada ketikan belum tersimpan: halaman TIDAK dimuat ulang, spanduk tampil; setelah aman, tombol memuat ulang berfungsi (Task 3).
4. Entri antrean offline `check`, `comment`, dan `create` yang menerima `426`: dibuang dengan alasan jelas di halaman DAN service worker, entri lain di antrean tetap terkirim; 426 polos tanpa problem+json tetap menahan antrean (bukan buang) (Task 4).
5. Rute di `RETIRED_ROUTES` dengan parameter jalur (`/brands/{id}`) dan verba berbeda (GET vs PUT): hanya kombinasi verba+jalur yang tepat dijawab 426, jalur lain tetap 404; `426` juga sampai tanpa sesi dan tanpa header CSRF yang benar tidak membocorkan lebih dari 403 CSRF seperti rute lain (Task 2).
6. Penghapusan rute < 24 jam sejak tag rilis sebelumnya, tanpa tag sebelumnya (rilis pertama), dan potret tag yang hilang/rusak: `release:prepare server` menolak yang pertama, melewati yang kedua, dan menolak yang ketiga dengan pesan jelas (Task 7).

---

### Task 1: Fungsi murni `shared/` (kode galat, pencocok rute terhapus, deprecated terpakai, `minClient`, pagar potret)

**Files:**
- Modify: `shared/contract.ts` (`ERROR_CODES` + `'CLIENT_OUTDATED'`)
- Modify: `shared/api-versions.ts` (fungsi baru)
- Modify: `shared/api-snapshot.ts` (`removalProblems`)
- Modify: `server/src/http/problem.ts`, `server/src/core/router.ts`, `web/src/lib/api/api-error.ts` (peta `Record<ErrorCode, ...>` wajib lengkap: typecheck gagal bila lupa)
- Test: `shared/api-versions.test.ts`, `shared/api-snapshot.test.ts`

**Interfaces:**
- Produces (dipakai Task 2-7):
  - `ERROR_CODES` memuat `'CLIENT_OUTDATED'`; status 426 di tiga peta di atas; judul problem (`TITLE_BY_CODE`) `'Klien perlu diperbarui'`.
  - `matchRetiredRoute(retired: readonly RetiredRoute[], verb: string, version: number, path: string): RetiredRoute | null` — `path` relatif terhadap awalan versi (`/brands/abc`, tanpa query); cocok bila `route.verb === verb`, `parseApiId(route.id).version === version`, dan templat `route.path` cocok segmen per segmen (`{nama}` = satu segmen tak kosong, selain itu sama persis); `path` berakhiran `/` atau berisi `//` = `null`.
  - `deprecatedGroupsInUse(ids: readonly string[], apis: ServerApis | null): string[]` — kelompok (urut abjad, tanpa ganda) yang versi pilihan `pickApiId` untuk SEMUA atau sebagian id dasarnya berada di `deprecated` server: yakni klien ini hanya mengenal versi yang sudah deprecated. `apis` `null` = `[]`.
  - `interface MinClient { desktop: string }`; `parseMinClient(value: unknown): MinClient | null` (objek dengan `desktop` string semver `X.Y.Z` tanpa nol di depan; selain itu `null`); `isBelowMinClient(installed: string, min: MinClient | null): boolean` (`false` bila `min` `null`, `installed` bukan semver sah, atau `installed >= min.desktop`; memakai `compareVersions` dari `./desktop-release`).
  - `removalProblems(input: { previous: readonly SnapshotEntry[]; current: readonly SnapshotEntry[]; retired: readonly RetiredRoute[]; previousTagAgeMs: number | null; minAgeMs: number }): string[]` di `shared/api-snapshot.ts`: pelanggaran `compareContract(previous, current, retired)` DITAMBAH satu pelanggaran bila ada id di `previous` yang tak ada di `current` dan `previousTagAgeMs !== null && previousTagAgeMs < minAgeMs` (pesan memuat "24 jam" bila `minAgeMs` = 24 jam: `Rute <id> baru berstatus deprecated kurang dari 24 jam (rilis sebelumnya baru terbit <n> jam lalu)`). `previousTagAgeMs === null` (tak ada rilis sebelumnya) tidak menambah pelanggaran.
  - Konstanta `REMOVAL_MIN_AGE_MS = 24 * 60 * 60 * 1000` di `shared/api-snapshot.ts`.
- Consumes: `compareContract`, `SnapshotEntry`, `RetiredRoute`, `ServerApis`, `pickApiId`, `parseApiId`, `compareVersions` (sudah ada).

- [ ] **Step 1: Tulis tes yang gagal**
  - `api-versions.test.ts`: `ERROR_CODES` memuat `CLIENT_OUTDATED`. `matchRetiredRoute` (daftar sintetis `[{ id: 'brands.rename', verb: 'PUT', path: '/brands/{id}', removedIn: 'server-v1.4.0' }, { id: 'a.b@2', verb: 'GET', path: '/x', removedIn: 'server-v1.4.0' }]`): `('PUT', 1, '/brands/abc')` cocok; `('GET', 1, '/brands/abc')` null; `('PUT', 1, '/brands/abc/extra')` null; `('PUT', 1, '/brands/')` null; `('PUT', 1, '/brands//')` null; `('PUT', 2, '/brands/abc')` null (versi beda); `('GET', 2, '/x')` cocok untuk id `a.b@2`; daftar kosong -> null. `deprecatedGroupsInUse` (ids sintetis `['a.b', 'a.b@2', 'c.d']`): `apis` null -> `[]`; `{ a: { latest: 2, deprecated: [1] }, c: { latest: 1, deprecated: [] } }` -> `[]` (klien mengenal @2, memilih @2); `{ a: { latest: 2, deprecated: [1, 2] } }` -> `['a']`; klien hanya mengenal v1 (`ids = ['a.b', 'c.d']`) dan `{ a: { latest: 2, deprecated: [1] } }` -> `['a']`; kelompok tak ada di `apis` -> tidak dihitung. `parseMinClient`: `{ desktop: '1.2.3' }` sah; `null`, `'x'`, `[]`, `{}`, `{ desktop: 3 }`, `{ desktop: '1.2' }`, `{ desktop: '01.2.3' }` -> `null`. `isBelowMinClient('1.2.0', { desktop: '1.10.0' })` true; `('1.10.0', { desktop: '1.2.0' })` false; sama persis false; `('x', min)` false; `(v, null)` false.
  - `api-snapshot.test.ts`: `removalProblems` dengan potret sebelumnya `[{ id: 'a.b', verb: 'GET', path: '/a', deprecated: true }]`, kontrak sekarang kosong, `retired` memuat `a.b`: tag berumur 25 jam -> `[]`; 23 jam -> satu pelanggaran bermuatan `24 jam`; `previousTagAgeMs: null` -> `[]`; tanpa `deprecated: true` di potret lama -> pelanggaran `compareContract` yang ada tetap muncul (tidak hilang karena umur cukup); tak ada id yang dihapus -> tak ada pelanggaran umur walau tag baru 1 jam.
  - `shared/api-versions.test.ts` (atau tes `scripts/`): `compareVersions(MIN_CLIENT.desktop, desktopPackageVersion) <= 0` dengan `desktopPackageVersion` dibaca dari `../desktop/package.json` (impor JSON/`Bun.file`); `MIN_CLIENT.desktop` lolos `parseMinClient({ desktop: MIN_CLIENT.desktop })`.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun test shared` — Expected: FAIL (fungsi belum ada).
- [ ] **Step 3: Implementasikan** semua item Interfaces. `deprecatedGroupsInUse`: untuk tiap `base` unik di `ids` (hasil `parseApiId(id).base`), `chosen = parseApiId(pickApiId(base, ids, apis)).version`; bila `apis[apiGroup(base)]?.deprecated` memuat `chosen`, kelompoknya masuk. Tambah `'CLIENT_OUTDATED'` ke tiga peta (426; judul `Klien perlu diperbarui`).
- [ ] **Step 4: Jalankan tes shared dan typecheck**
  Run: `bun test shared` lalu `bun run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add shared server/src web/src/lib/api/api-error.ts
  git commit -m "feat(api): fungsi murni fase 3 (CLIENT_OUTDATED, rute terhapus, minClient, pagar potret)"
  ```

### Task 2: Server: 426 untuk rute terhapus, header `Deprecation`, `minClient` di ping

**Files:**
- Modify: `server/src/http/rest.ts` (`RestPolicy`, header, fallback 426)
- Modify: `server/src/app.ts` (ping memuat `minClient`)
- Create: `server/changelog.d/20261120-02-versi-api-fase3.md`, `desktop/changelog.d/20261120-02-versi-api-fase3.md`
- Test: `server/src/http/rest-fase3.test.ts`, `server/src/server.test.ts` (kasus ping)

**Interfaces:**
- Produces:
  - `interface RestPolicy { groups: Record<string, GroupVersions>; retired: readonly RetiredRoute[] }` di `rest.ts`; `registerRest(app, routes, version = 1, table = API_ROUTES, policy: RestPolicy = { groups: API_GROUP_VERSIONS, retired: RETIRED_ROUTES })`.
  - Fallback `app.all('*', ...)` di `registerRest`: `matchRetiredRoute(policy.retired, c.req.method, version, <path setelah restBase(version), tanpa query>)` cocok -> `problemResponse(toProblem(appError('CLIENT_OUTDATED', 'Versi aplikasi ini sudah tidak didukung. Muat ulang atau perbarui aplikasi.'), newRequestId()))` (status 426); selain itu `restNotFound()` seperti sekarang.
  - Header `Deprecation: true` ditambahkan di `handlerFor` pada respons sukses, 304, unduhan, dan problem bila `policy.groups[apiGroup(id)]?.deprecated` memuat `parseApiId(id).version`.
  - `/api/ping` menjadi `{ ok: true, ...buildInfo, apis: announcedApis(), minClient: { ...MIN_CLIENT } }`.
  - Perlu juga: `ErrorCode` baru harus lolos `appError` (kode di `ERROR_CODES`) dan `httpStatusOf` di `app.ts` (jalur non-REST) tak rusak (peta Task 1 sudah lengkap).
- Consumes: `matchRetiredRoute`, `MIN_CLIENT` (plan halaman unduh), `GroupVersions`, `RetiredRoute`.

- [ ] **Step 1: Tulis tes yang gagal** di `rest-fase3.test.ts` (pola `rest-version-handler.test.ts`: tabel sintetis, `registerRest(sub, routes, 1, TABLE, POLICY)`, `createTestEnv`, cookie sesi dari `signSessionToken`):
  - Kebijakan sintetis `retired: [{ id: 'a.gone', verb: 'PUT', path: '/gone/{id}', removedIn: 'server-v1.4.0' }]`: `PUT /api/v1/gone/abc` dengan header CSRF, tanpa sesi -> status 426, `content-type` problem+json, badan `{ code: 'CLIENT_OUTDATED', status: 426 }`, handler tak jalan; `GET /api/v1/gone/abc` -> 404; `PUT /api/v1/gone/abc/x` -> 404; `PUT /api/v1/lain` -> 404; `PUT /api/v1/gone/abc` TANPA header CSRF -> 403 (`csrfGuard` mendahului, perilaku sama seperti rute lain).
  - Kebijakan `groups: { a: { latest: 2, deprecated: [1] } }` dengan tabel `{ 'a.read': { verb: 'GET', path: '/read' } }`: respons sukses (sesi sah), 401 tanpa sesi, dan 404 jalur tak dikenal pada rute v1 memuat header `deprecation: true`; kelompok yang tak deprecated TIDAK memuat header itu.
  - `server.test.ts`: `GET /api/ping` memuat `minClient` sama dengan `MIN_CLIENT` dan `apis` seperti sebelumnya.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd server test src/http/rest-fase3.test.ts src/server.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** `RestPolicy` dan semua item Interfaces. Header dipasang lewat satu fungsi pembantu yang dipakai jalur sukses dan galat di `handlerFor`; `registerRest` meneruskan `policy` ke `handlerFor`. Jalur setelah awalan versi diturunkan dari `new URL(c.req.url).pathname` dikurangi `restBase(version)`. Tambahkan komentar Indonesia singkat yang menjelaskan "dijawab sebelum authorize karena rute tak terdaftar" . Fragmen changelog: server `feat(api): rute yang sudah dihapus dijawab 426 dan ping memuat minClient`; desktop `feat(pembaruan): layar Perlu pembaruan bila versi aplikasi di bawah minClient server`.
- [ ] **Step 4: Jalankan tes server terkait, pastikan lulus**
  Run: `bun run --cwd server test src/http src/server.test.ts src/app.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add server shared desktop/changelog.d
  git commit -m "feat(api): 426 untuk rute terhapus, header Deprecation, dan minClient di ping"
  ```

### Task 3: Web: penyimpan tingkat "perlu perbarui", spanduk deprecated, pemuatan ulang paksa

**Files:**
- Create: `web/src/app/pwa/client-outdated.ts` (penyimpan kecil tanpa impor lain)
- Create: `web/src/app/pwa/api-deprecated-banner.tsx`
- Modify: `web/src/lib/api/client.ts` (laporkan 426), `web/src/lib/api/versions.ts` (parse `minClient`, hitung deprecated), `web/src/app/pwa/update.ts` (reaksi), `web/src/app/shell/app-shell.tsx` (pasang spanduk)
- Test: `web/src/app/pwa/client-outdated.test.ts`, `web/src/app/pwa/api-deprecated-banner.test.tsx`, `web/src/lib/api/client.test.ts`, `web/src/lib/api/versions.test.ts`, `web/src/app/pwa/update.test.ts`

**Interfaces:**
- Produces:
  - `type OutdatedLevel = 'none' | 'deprecated' | 'outdated'`; `getOutdatedLevel(): OutdatedLevel`; `raiseOutdatedLevel(level: OutdatedLevel): void` (hanya naik: `none` < `deprecated` < `outdated`; memberi tahu pendengar hanya bila berubah); `subscribeOutdated(listener: () => void): () => void`; `useOutdatedLevel(): OutdatedLevel` (`useSyncExternalStore`); `resetOutdatedForTests(): void`.
  - `versions.ts`: `getServerMinClient(): MinClient | null` (memori + salinan `localStorage` kunci `qc.api.minClient`, dibungkus try/catch seperti peta `apis`; nilai rusak diabaikan); `refreshServerApis` kini juga membaca `body.minClient` lewat `parseMinClient`, menyimpannya, lalu memanggil `raiseOutdatedLevel('deprecated')` bila `deprecatedGroupsInUse(Object.keys(API_ROUTES), getServerApis()).length > 0`. Server lama (tanpa field) = `minClient` tak berubah.
  - `client.ts`: pada respons non-2xx yang menghasilkan `ApiError` ber-`code === 'CLIENT_OUTDATED'` (hanya dari badan problem+json sah) memanggil `raiseOutdatedLevel('outdated')` sebelum melempar. `errorFromResponse` memetakan 426 polos tanpa problem ke `INTERNAL` seperti status tak dikenal lain (tak berubah).
  - `update.ts`: `notifyClientOutdated(): void` (`markUrgent(); setNeedRefresh(true); runCheck(); maybeAutoReload();`; tanpa efek bila offline seperti `notifyChunkLoadFailure`); `startPwaUpdates` berlangganan `subscribeOutdated` dan memanggil `notifyClientOutdated()` saat level menjadi `outdated` (pembersih berlangganan ikut fungsi pembersih yang dikembalikan). Spanduk pembaruan yang ada (`UpdateBanner`) menampilkan `visible` karena `urgent`; ketikan belum tersimpan menunda lewat `isSafeToReload` yang sudah ada.
  - `ApiDeprecatedBanner` (tanpa props): tampil bila `useOutdatedLevel() === 'deprecated'` dan BUKAN desktop (`isDesktop()` false): teks "Aplikasi ini perlu diperbarui biar tetap bisa dipakai." + tombol "Muat ulang" (memanggil `reload` dari `usePwaUpdate()`); `role="status"`; dipasang di `app-shell.tsx` berdekatan dengan `UpdateBanner`.
- Consumes: `parseMinClient`, `deprecatedGroupsInUse`, `MinClient` (Task 1); `CLIENT_OUTDATED` (Task 1).

- [ ] **Step 1: Tulis tes yang gagal**
  - `client-outdated.test.ts`: awal `none`; `raise('deprecated')` -> `deprecated`; `raise('none')` setelahnya tetap `deprecated`; `raise('outdated')` -> `outdated`; `raise('deprecated')` setelah `outdated` tetap `outdated`; pendengar dipanggil sekali per perubahan nyata, tidak pada pemanggilan yang tak mengubah.
  - `client.test.ts`: respons 426 `application/problem+json` `{ code: 'CLIENT_OUTDATED', detail: 'x' }` -> `ApiError` ber-`code` `CLIENT_OUTDATED`, `status` 426, dan level menjadi `outdated`; 426 dengan badan HTML polos -> `ApiError` `INTERNAL` dan level tetap `none`.
  - `versions.test.ts`: `refreshServerApis` dengan ping `{ apis: { a: { latest: 2, deprecated: [1, 2] } }, minClient: { desktop: '1.2.0' } }` menyimpan `getServerMinClient()` = `{ desktop: '1.2.0' }` dan menaikkan level ke `deprecated` bila klien hanya mengenal versi deprecated itu (gunakan kelompok nyata dari `API_ROUTES`, mis. `desktop: { latest: 2, deprecated: [1, 2] }`... atau suntikkan daftar id lewat parameter opsional bila fungsi dibuat dapat diuji; pilih yang paling sederhana dan konsisten dengan `pickApi`); ping tanpa `minClient` tidak menghapus nilai tersimpan; `minClient` rusak (`{ desktop: 3 }`) diabaikan tanpa melempar; `localStorage` melempar tetap tak melempar.
  - `update.test.ts`: setelah `startPwaUpdates` dengan registrasi palsu, `raiseOutdatedLevel('outdated')` membuat `usePwaUpdate().visible` benar dan `needRefresh` benar; bila `isSafeToReload()` salah (formulir kotor, ikuti cara tes yang ada menyalakannya) `location.reload` TIDAK dipanggil dan spanduk tetap tampil; bila aman, pemuatan ulang otomatis terjadi sekali (pembatas `autoTried` yang ada); pembersih menghentikan langganan.
  - `api-deprecated-banner.test.tsx`: tidak tampil pada `none`/`outdated`; tampil pada `deprecated`; tidak tampil bila `isDesktop()` benar; klik "Muat ulang" memanggil `reload`.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd web test src/app/pwa src/lib/api` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** semua item Interfaces. Pasang `ApiDeprecatedBanner` di `app-shell.tsx` tanpa mengubah perilaku spanduk lain.
- [ ] **Step 4: Jalankan tes web, pastikan lulus**
  Run: `bun run --cwd web test src/app src/lib/api` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add web/src
  git commit -m "feat(web): spanduk deprecated dan pemuatan ulang paksa untuk 426 CLIENT_OUTDATED"
  ```

### Task 4: Antrean offline menolak entri berstatus 426 (halaman dan service worker)

**Files:**
- Modify: `web/src/modules/handover/lib/outbox-flush.ts` (`REJECTION_CODES`)
- Modify: `web/public/sync-sw.js` (`ERROR_CODES`, `REJECTION_CODES`)
- Test: `web/src/modules/handover/lib/outbox-flush.test.ts` (atau berkas tes penguras yang ada), `web/src/modules/handover/lib/outbox-parity.test.ts`

**Interfaces:**
- Produces: `CLIENT_OUTDATED` termasuk `REJECTION_CODES` di kedua tempat; daftar `ERROR_CODES` di `sync-sw.js` memuat `'CLIENT_OUTDATED'` (sudah dijaga `outbox-parity.test.ts` terhadap `ERROR_CODES` dari `@shared/contract`). Alasan penolakan = pesan problem server apa adanya (jalur `describe`/`describeError` yang ada).
- Consumes: kode `CLIENT_OUTDATED` (Task 1).

- [ ] **Step 1: Tulis tes yang gagal**
  - Penguras halaman: tiga entri sintetis (`check`, `comment`, `create`) dikirim bergantian ke `send` palsu yang melempar `new ApiError('CLIENT_OUTDATED', 'Versi aplikasi ini sudah tidak didukung', 'r1', undefined, { status: 426 })` -> masing-masing masuk `result.rejected` dengan `reason` memuat teks itu, entri dihapus dari antrean (`removeOutboxEntries`), `stoppedBy` tetap `'none'`, dan entri berikutnya tetap diproses (entri keempat yang sukses ikut terkirim).
  - `outbox-parity.test.ts`: tambah kasus paritas: respons 426 problem+json `CLIENT_OUTDATED` untuk entri `comment` menghasilkan penolakan yang sama (alasan sama) di penguras halaman dan di service worker (`sendEntry` lewat sandbox `load`), dan entri service worker ditandai `state: 'rejected'`; 426 dengan badan HTML polos di KEDUANYA = entri tetap (`hold`/`server-error`) dan tidak dibuang.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd web test src/modules/handover/lib` — Expected: FAIL.
- [ ] **Step 3: Implementasikan**: tambah `'CLIENT_OUTDATED'` pada `REJECTION_CODES` di `outbox-flush.ts` dan `sync-sw.js` dan pada `ERROR_CODES` di `sync-sw.js`; perbarui komentar paritas satu kalimat.
- [ ] **Step 4: Jalankan tes, pastikan lulus**
  Run: `bun run --cwd web test src/modules/handover/lib src/app/outbox` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add web
  git commit -m "feat(web): antrean offline membuang entri yang ditolak 426 dengan alasan jelas"
  ```

### Task 5: Desktop proses utama: kanal jembatan `app.version|update|openDownloads` dan `updateNow`

**Files:**
- Modify: `countrylock/src/bridge-channels.ts` (`BRIDGE_VERSION = 10`, `APP_BRIDGE_VERSION = 10`, kanal `appVersion`, `appUpdate`, `appOpenDownloads`)
- Modify: `countrylock/src/bridge-contract.ts` (tipe `QcBridge.app`, `UpdateNowResult`, `BRIDGE_ARGS.appVersion|appUpdate|appOpenDownloads` = `z.tuple([])`)
- Modify: `desktop/src/main/update/app-updater.ts` (`updateNow`), `desktop/src/main/update/start-app-update.ts` (mengembalikan pengendali; tak berubah selain tipe bila perlu), `desktop/src/main/ipc.ts` (handler + dependensi `app`), `desktop/src/preload/index.ts`, `desktop/src/main/index.ts` (merangkai: simpan pengendali updater, `openDownloads` = `shell.openExternal` ke `<serverUrl>/desktop`)
- Modify: `web/src/modules/countrylock/fake-bridge.ts`
- Test: `desktop/src/main/update/app-updater.test.ts`, `desktop/src/main/ipc.test.ts` (kasus kanal baru), `countrylock/src/bridge-contract.test.ts` (atau tes kontrak yang ada), tes preload/paritas kanal yang ada bila ada

**Interfaces:**
- Produces:
  - `type UpdateNowResult = { status: 'restarting' | 'up-to-date' | 'busy' | 'unavailable' | 'failed'; message: string }` (`message` selalu pesan terkontrol berbahasa Indonesia, tak pernah galat mentah).
  - `QcBridge.app: { version(): Promise<string>; update(): Promise<UpdateNowResult>; openDownloads(): Promise<void> }` (jembatan v10; renderer memeriksa `bridge.version >= APP_BRIDGE_VERSION` sebelum memakainya).
  - `AppUpdater.updateNow(): Promise<UpdateNowResult>`: bila `running` -> `busy` ("Pembaruan sedang berjalan"); bila `isBusy()` (inject berjalan) -> `busy` ("Inject sedang berjalan, tunggu selesai dulu"); `checkForUpdates()` tanpa pembaruan -> `up-to-date`; ada pembaruan -> `downloadUpdate()`, catat `downloaded`, set `autoInstallOnAppQuit = true`, lalu `quitAndInstall(true, true)` TANPA dialog dan kembalikan `restarting`; galat apa pun -> `failed` ("Pembaruan gagal diunduh") + `log` ringkas (maks. 200 karakter, seperti `checkNow`). Tidak pernah memicu dialog "Perbarui sekarang/Nanti".
  - Pengendali `ipc.ts` `deps.app: { version(): string; update(): Promise<UpdateNowResult>; openDownloads(): Promise<void> }`; bila updater tidak berjalan (tidak terkemas, tanpa kunci rilis, `--smoke`) `update()` mengembalikan `{ status: 'unavailable', message: 'Pembaruan otomatis tidak aktif di instalasi ini' }`; `openDownloads` membuka `<serverUrl dari settings>/desktop` lewat `shell.openExternal` (alamat dari `settings`, tak pernah dari renderer; kegagalan membuka = galat terkontrol "Tidak dapat membuka peramban sistem").
- Consumes: `AppUpdater`, `createAppUpdater`, `normalizeServerUrl` (sudah ada).

- [ ] **Step 1: Tulis tes yang gagal**
  - `app-updater.test.ts` (updater palsu yang sudah ada di tes itu): (a) `updateNow` tanpa pembaruan -> `up-to-date`, tak ada dialog, `quitAndInstall` tak dipanggil; (b) ada pembaruan -> `downloadUpdate` dipanggil, `quitAndInstall(true, true)` dipanggil SETELAH unduhan, tak ada dialog sama sekali, hasil `restarting`; (c) `isBusy()` benar -> `busy`, tak ada `checkForUpdates`; (d) `checkForUpdates` melempar `new Error('rahasia-xyz')` -> `failed` dan `message` TIDAK memuat `rahasia-xyz`; (e) `downloadUpdate` melempar -> `failed`, `quitAndInstall` tak dipanggil; (f) `updateNow` saat `checkNow` sedang berjalan -> `busy`.
  - `ipc.test.ts`: `app.version` mengembalikan string versi dari dependensi; `app.update` meneruskan hasil; `app.openDownloads` memanggil dependensi; argumen tak kosong pada ketiga kanal ditolak (validasi zod, pola kanal tanpa argumen lain); pengirim tak tepercaya ditolak (pola tes yang ada).
  - Tes kontrak jembatan: `BRIDGE_VERSION` = 10, `APP_BRIDGE_VERSION` = 10, `UI_MIN_BRIDGE_VERSION` TIDAK berubah (nilai lama), tiga kanal baru terdaftar di `BRIDGE_CHANNELS` dan `BRIDGE_ARGS`, dan preload mengekspos `app.version|update|openDownloads` (ikuti tes paritas preload/kanal yang ada; bila tak ada, tambah kasus di tes yang memeriksa daftar kanal).
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd desktop test` dan `bun run --cwd countrylock test` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** semua item Interfaces mengikuti resep kanal baru di `CLAUDE.md`. `index.ts`: tangkap hasil `startAppUpdate` (sudah mengembalikan `AppUpdater`) ke variabel yang dibaca `registerIpc`; dependensi `app.version = () => app.getVersion()`. `fake-bridge.ts`: `app.version` mengembalikan `'0.0.0'`, `app.update` mengembalikan `{ status: 'unavailable', message: ... }`, `app.openDownloads` no-op.
- [ ] **Step 4: Jalankan tes dan typecheck, pastikan lulus**
  Run: `bun run --cwd desktop test && bun run --cwd desktop typecheck && bun run --cwd countrylock test && bun run --cwd web typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add countrylock desktop web/src/modules/countrylock/fake-bridge.ts
  git commit -m "feat(desktop): kanal jembatan app.version/update/openDownloads dan updateNow tanpa dialog"
  ```

### Task 6: Web: layar penahan "Perlu pembaruan" di desktop

**Files:**
- Create: `web/src/app/shell/desktop-update-gate.tsx` (komponen) dan `web/src/app/shell/use-desktop-block.ts` (logika penahan)
- Modify: `web/src/app/shell/app-shell.tsx` atau `web/src/routes/_app.tsx` (bungkus isi layout; pilih satu yang menjaga `/country-lock` di luar penahan: rute itu sudah di luar layout `_app`)
- Test: `web/src/app/shell/desktop-update-gate.test.tsx`, `web/src/app/shell/use-desktop-block.test.ts`

**Interfaces:**
- Produces:
  - `useDesktopBlock(): { blocked: boolean; installed: string | null }`: `blocked` benar hanya di desktop (`isDesktop()`) dengan jembatan `app` tersedia (`getBridge()` ada dan `bridge.version >= APP_BRIDGE_VERSION`) dan (`useOutdatedLevel() === 'outdated'` ATAU `isBelowMinClient(installed, getServerMinClient())`); `installed` dibaca sekali lewat `bridge.app.version()` (galat = `null` = tidak menahan oleh jalur `minClient`, jalur `outdated` tetap berlaku); di peramban atau jembatan lama selalu `false`. Peta/`minClient` berubah (ping segar) memicu hitung ulang (`subscribeOutdated` + sinyal dari `versions.ts`; tambahkan pendengar sederhana `subscribeServerMinClient` bila perlu).
  - `DesktopUpdateGate({ children })`: bila `blocked` tidak menampilkan `children`, menampilkan layar penuh "Perlu pembaruan" ("Versi aplikasi ini sudah terlalu lama untuk server. Perbarui dulu supaya semua fitur jalan lagi. Country Lock tetap bisa dipakai." + tautan "Buka Country Lock" ke `/country-lock`), tombol utama "Perbarui sekarang" (memanggil `bridge.app.update()`, menonaktifkan tombol saat berjalan, hasil `restarting` menampilkan "Memasang pembaruan, aplikasi akan mulai ulang...", `busy`/`up-to-date`/`unavailable`/`failed` menampilkan `message`-nya); setelah hasil BUKAN `restarting`, tampil tautan "Unduh manual" yang memanggil `bridge.app.openDownloads()` (galatnya ditampilkan sebagai teks, tidak melempar). Tanpa tombol "Nanti".
- Consumes: `getBridge`, `isDesktop` (`web/src/lib/platform.ts`), `useOutdatedLevel` (Task 3), `getServerMinClient`, `isBelowMinClient` (Task 1/3), `APP_BRIDGE_VERSION`, `UpdateNowResult` (Task 5).

- [ ] **Step 1: Tulis tes yang gagal**
  - `use-desktop-block.test.ts`: peramban (tanpa `window.qcBridge`) -> `blocked` false walau level `outdated`; desktop dengan jembatan v10, versi terpasang `1.0.0`, `minClient` `{ desktop: '1.2.0' }` -> true; `1.2.0` -> false; `minClient` null -> false; `app.version()` menolak -> false untuk jalur `minClient`, tetap true bila level `outdated`; jembatan v9 (tanpa `app`) -> false; level `outdated` + jembatan v10 -> true meski `minClient` null.
  - `desktop-update-gate.test.tsx`: tidak blocked -> `children` tampil; blocked -> `children` TIDAK dirender (tes memakai anak penanda yang tak muncul), teks "Perlu pembaruan" dan tombol "Perbarui sekarang" tampil, tidak ada tombol "Nanti"; klik tombol memanggil `app.update` sekali dan menonaktifkan tombol selama menunggu; hasil `failed` menampilkan `message` dan tautan "Unduh manual" yang memanggil `app.openDownloads`; hasil `restarting` menampilkan teks memasang; `openDownloads` menolak -> pesan galat tampil, tak melempar; tautan "Buka Country Lock" menuju `/country-lock`.
  - Tes rute/layout (pola `app-shell-desktop.test.tsx`): pada kondisi blocked, `AppShell`/layout `_app` menampilkan layar penahan, sedangkan `routes/country-lock.test.tsx` yang ada tetap lulus tanpa perubahan (rute itu tak ikut tertahan).
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd web test src/app/shell` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** komponen dan hook; teks UI santai. Pasang penahan di tempat yang membungkus isi layout `_app` saja (navigasi/header boleh tetap tampil atau tidak; pilih tampilan layar penuh yang menggantikan isi, dan jelaskan pilihan di komentar).
- [ ] **Step 4: Jalankan tes dan typecheck web, pastikan lulus**
  Run: `bun run --cwd web test src/app src/routes && bun run --cwd web typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add web/src
  git commit -m "feat(web): layar Perlu pembaruan di desktop tanpa menahan Country Lock"
  ```

### Task 7: Pagar rilis: `release:prepare server` membuat ulang potret dan menolak penghapusan < 24 jam

**Files:**
- Create: `scripts/api-removal-check.ts` (CLI kecil yang dijalankan di pohon cabang rilis)
- Modify: `scripts/release-prepare.ts` (langkah potret + pagar umur)
- Modify: `scripts/changelog-check.ts` (`isMetadataOf`: potret kontrak = metadata rilis SERVER), dan bila perlu `scripts/release-guard.ts`
- Test: `scripts/release-prepare.test.ts`, `scripts/api-removal-check.test.ts`, `scripts/changelog-check.test.ts`, `scripts/release-guard.test.ts`, `shared/api-snapshot.test.ts` (tes pagar `RETIRED_ROUTES`)

**Interfaces:**
- Produces:
  - `isMetadataOf(path, 'server')` juga benar untuk `shared/api-contract.snapshot.json` (untuk `desktop` tetap salah). Alasannya: komit rilis hanya boleh berisi metadata (`isReleaseChange`, `evaluateGuard`/`unverifiedFiles`), dan potret kontrak kini ikut komit rilis server.
  - `scripts/api-removal-check.ts <berkas-potret-sebelumnya> <umur-ms|none>`: membaca JSON potret (`SnapshotEntry[]`), memanggil `removalProblems({ previous, current: contractSnapshot(), retired: RETIRED_ROUTES, previousTagAgeMs, minAgeMs: REMOVAL_MIN_AGE_MS })` dan mencetak tiap pelanggaran ke stderr; kode keluar 1 bila ada, 0 bila tidak. Dijalankan di pohon cabang rilis (yaitu isi `origin/dev`), jadi kontrak dan `RETIRED_ROUTES` yang dibandingkan adalah milik `origin/dev`, bukan milik cabang tempat skrip dipanggil. Pembaca berkas dan penghitung umur dipisah menjadi fungsi murni yang dapat diuji (`runRemovalCheck(argv, readFile): number`).
  - Di `prepareRelease`, hanya bila komponen mencakup `server` (mode `tag`, sudah dijaga pemeriksaan `RELEASE_FLOW` yang ada): (1) pada bagian prasyarat baca-saja, tentukan tag server terbaru (hasil `git tag --list` yang sudah dihitung untuk versi); bila ada, baca `git show <tag>:shared/api-contract.snapshot.json` (gagal = galat berhenti, pesan menyebut potret tag tak terbaca) dan umur tag dari `git log -1 --format=%cI <tag>` terhadap `now` (tak dapat dibaca = galat berhenti); tak ada tag = `none`; (2) pada tahap perubahan, SESUDAH `git switch ... origin/dev` dan sebelum mengubah `package.json`: tulis potret tag ke berkas sementara di luar pohon kerja (mis. `os.tmpdir()`), jalankan `bun run scripts/api-removal-check.ts <berkas> <umur-ms|none>` (kode keluar bukan 0 = lempar galat berisi keluarannya; blok `catch` yang ada sudah membatalkan cabang), lalu `bun run api:snapshot` (menulis ulang `shared/api-contract.snapshot.json` dari kontrak `origin/dev`); (3) `shared/api-contract.snapshot.json` ditambahkan ke `addPaths` (hanya saat `server` dirilis) agar ikut komit rilis.
  - `--dry-run`: semua pembacaan (tag, potret, umur) tetap berjalan dan, bila pelanggaran umur dapat dihitung tanpa pohon cabang, dilaporkan; perintah pengubah hanya dicetak (daftar `planned` memuat dua langkah baru). Pagar yang butuh pohon `origin/dev` boleh baru berjalan pada eksekusi nyata; catat itu di komentar.
- Consumes: `removalProblems`, `REMOVAL_MIN_AGE_MS`, `contractSnapshot`, `RETIRED_ROUTES` (Task 1 dan yang sudah ada), fake `Shell` dan `CliDeps` di `release-prepare.test.ts`.

- [ ] **Step 1: Tulis tes yang gagal**
  - `changelog-check.test.ts`/`release-guard.test.ts`: `isReleaseChange(['server/package.json', 'bun.lock', 'server/CHANGELOG.md', 'shared/api-contract.snapshot.json'], 'server')` benar; sama untuk `'desktop'` salah; `unverifiedFiles(['shared/api-contract.snapshot.json'], ['server'])` kosong dan `unverifiedFiles(['shared/api-contract.snapshot.json'], ['desktop'])` memuatnya; berkas `shared/contract.ts` tetap tak terverifikasi (tak ikut melonggar).
  - `api-removal-check.test.ts` (`runRemovalCheck` dengan `readFile` palsu): potret sebelumnya memuat `{ id: 'a.old', deprecated: true }`, kontrak sekarang (disuntik lewat parameter bila fungsi dibuat dapat disuntik, selain itu lewat tabel sintetis) tanpa `a.old` dan tercatat di `retired`: umur `30 jam` = 0; `5 jam` = 1 dan stderr memuat `24 jam`; `none` = 0; berkas tak ada/JSON rusak = 1 dengan pesan jelas.
  - `release-prepare.test.ts` (fake `Shell` yang ada): (a) rilis server dengan tag sebelumnya: `git show <tag>:shared/api-contract.snapshot.json` dan `git log -1 --format=%cI <tag>` dipanggil, `bun run scripts/api-removal-check.ts` dijalankan setelah `git switch` dan SEBELUM perubahan `package.json`, lalu `bun run api:snapshot`, dan `shared/api-contract.snapshot.json` ada di argumen `git add`; (b) `api-removal-check` mengembalikan kode 1 -> rilis dibatalkan (cabang lokal dibuang oleh `catch` yang ada, tak ada push) dan galat memuat keluarannya; (c) tidak ada tag server sebelumnya -> `none` dikirim dan potret tag tak dibaca; (d) `git show <tag>:...` gagal -> galat berhenti sebelum membuat cabang apa pun; (e) rilis desktop saja tidak memanggil satu pun perintah potret dan tak menambahkan berkas potret ke `git add`; (f) `--dry-run` tidak menjalankan perintah pengubah (`git switch`, `api:snapshot`, `git add`, `git push`) tetapi mencetak langkah barunya.
  - `shared/api-snapshot.test.ts`: tes pagar `RETIRED_ROUTES` pada data nyata: setiap entri memiliki `removedIn` cocok `^server-v\d+\.\d+\.\d+$`, id tak ada di `API_ROUTES`, dan verb+templat jalurnya tak sama dengan operasi hidup mana pun (tabel kosong lolos); dan kasus sintetis yang membuktikan pemeriksaan itu menolak entri yang menutupi rute hidup.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun test scripts shared/api-snapshot.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** semua item Interfaces; pesan galat Indonesia santai yang menyebut jalan keluar (tunggu sampai rilis sebelumnya berumur 24 jam, atau kembalikan rute dari `RETIRED_ROUTES`).
- [ ] **Step 4: Jalankan tes skrip, pastikan lulus**
  Run: `bun test scripts shared` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add scripts shared
  git commit -m "feat(rilis): release:prepare server membuat ulang potret kontrak dan menolak penghapusan < 24 jam"
  ```

### Task 8: Dokumentasi, pembaruan spek, dan butir uji manual

**Files:**
- Modify: `CLAUDE.md` (bagian "Kebijakan versi API": hapus butir "Belum dibangun" dan gantikan dengan ringkasan mekanisme yang kini ada: 426 `CLIENT_OUTDATED`, `Deprecation`, `minClient`, `RETIRED_ROUTES`, layar penahan, kanal `app.*`, pagar `release:prepare`; sebut juga bahwa rute yang dihapus WAJIB lewat urutan deprecated -> rilis -> hapus >= 24 jam)
- Modify: `docs/adding-a-module.md` (resep "menghapus/menaikkan versi rute": urutan deprecated lalu hapus, `RETIRED_ROUTES`, kapan menaikkan `MIN_CLIENT`)
- Modify: `docs/ci-cd.md` (langkah potret dan pagar 24 jam pada `release:prepare server`; potret kontrak kini metadata rilis server; mode `langsung` dijaga manual)
- Modify: `docs/superpowers/specs/2026-11-17-rilis-semver-design.md` (daftar metadata rilis server memuat `shared/api-contract.snapshot.json`, tanggal 2026-11-20, atas persetujuan pemilik produk lewat keputusan membuka fase 3)
- Modify: `docs/e2e-checklist-desktop.md` (bagian K: butir manual layar penahan: naikkan `minClient` di staging dengan build uji, layar muncul, "Perbarui sekarang" memasang, kegagalan memunculkan tautan unduh, Country Lock tetap terbuka; tab web lama menerima 426 dan memuat ulang)
- Modify: `docs/superpowers/specs/2026-11-20-versi-api-fase3-design.md` (catat DIBANGUN; deviasi: kunci `localStorage` `qc.api.apis` (bukan `qc.api.versions`) dan tiga kanal `app.version|update|openDownloads` (spek 5a butir 2 menyebut hanya `app.version`; dua lainnya dibutuhkan agar tombol "Perbarui sekarang" dan tautan unduh dapat berjalan, sesuai keputusan pemilik 5b butir 1 dan 3); tutup pertanyaan terbuka induk 10.2 sampai 10.4 dengan keputusan 2026-11-20 yang menyetujuinya, mencantumkan pemilik produk dan tanggal absolut)
- Modify: `docs/superpowers/specs/2026-11-20-versi-api-ui-dasar-paksa-update-design.md` (tandai fase 3 dibangun, rujuk spek fase 3)

- [ ] **Step 1: Tulis pembaruan dokumen** persis seperti butir di atas (komentar Indonesia santai, tanggal absolut `2026-11-20`; sesuai aturan `CLAUDE.md` pemilik: keputusan di luar/berbeda dari spek dicatat pada spek terkait dengan apa yang diputuskan, tanggal, alasan singkat, dan bahwa pemilik produk yang menyetujui).
- [ ] **Step 2: Verifikasi akhir**
  Run: `bun run check` (terowongan hidup) lalu `bun run --cwd desktop test && bun run --cwd desktop typecheck && bun run --cwd countrylock test` — Expected: PASS semua.
- [ ] **Step 3: Commit**
  ```bash
  git add CLAUDE.md docs
  git commit -m "docs: fase 3 versi API (426, minClient, layar penahan, pagar rilis)"
  ```
