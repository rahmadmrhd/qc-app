# Versi API per Kelompok dan UI Dasar yang Lebih Baru Menang: Rencana Implementasi (fase 1, 2, dan kebijakan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server mengumumkan versi API per kelompok rute dan klien memilih versi dari pengumuman itu (tanpa mengubah satu pun perilaku v1 hari ini), serta desktop memakai UI dasar installer bila lebih baru daripada bundel UI unduhan.

**Architecture:** Fungsi murni di `shared/api-versions.ts` (parser id berversi `<id>@<n>`, peta versi per kelompok, pemilih id) dipakai server (jalur `/api/v<n>`, `/api/ping`), klien web (resolver + penyimpanan peta), dan desktop (proksi izin jalur). Pagar kompatibilitas = potret kontrak (`shared/api-contract.snapshot.json`) + tes superset. Pemilihan UI di desktop dibandingkan lewat `createdAt` manifest.

**Tech Stack:** TypeScript, Bun (`bun:test` untuk `shared/`, `server/`, `scripts/`), Hono, Vitest (`web/`, `desktop/`), Biome.

**Spec:** `docs/superpowers/specs/2026-11-20-versi-api-ui-dasar-paksa-update-design.md` (keputusan pemilik 2026-11-20). **Cakupan rencana ini: bagian 6.1, 6.2, 6.4 (resolver, tanpa `compat.ts` per modul karena belum ada rute v2), 6.6, potret kontrak dari 6.7, urutan fase 1, 2, dan 4.** Fase 3 (`deprecated` di klien, header `Deprecation`, 426 `CLIENT_OUTDATED`, `minClient`, layar penahan, pemuatan paksa web, tabel `FEATURE_REQUIRES` bagian 6.5, integrasi potret ke `release:prepare`) SENGAJA tidak ada di sini: ia butuh riset jalur pembaruan desktop/kanal jembatan dan lebih aman disusun setelah fondasi ini mendarat; ia menjadi rencana terpisah.

## Global Constraints
- `shared/` murni: tanpa `URL`, `URLSearchParams`, `fetch`, `atob`, atau API DOM/Node di kode non-tes; import internal relatif.
- Perilaku v1 TIDAK berubah: jalur `/api/v1/...`, bentuk respons, dan nama export `REST_BASE` (server) serta `API_BASE` (klien, `= '/api/v1'`) tetap; `API_BASE` dipakai `proof-source.ts`, `guide-source.ts`, dan tes paritas `outbox-parity`/`sync-sw` (skrip `web/public/sync-sw.js` memakai `/api/v1` tetap).
- Id berversi: `<idDasar>@<n>` dengan `n` bilangan bulat >= 2 tanpa nol di depan; id dasar (v1) WAJIB ada. Versi diturunkan dari akhiran id (satu sumber); tidak ada field `version` di `ApiRouteDef`.
- Kelompok = awalan id dasar sebelum titik pertama (28 kelompok hari ini: access, auth, brands, businessUnits, customers, desktop, exports, files, guides, handovers, items, jobs, notifications, postelFiles, postelSettings, postels, push, qrcodes, serialCases, serialProofs, serialServiceSettings, serialSettings, serials, stickerGuides, stickerSettings, stickerStock, stickerTypes, stickers).
- Teks UI/komentar/pesan Indonesia santai (aturan proyek); fragmen changelog format `tipe(area): ringkasan` (maks. 200 karakter); perubahan `shared/` mewajibkan fragmen di `server/changelog.d/` DAN `desktop/changelog.d/`.
- Tes server butuh terowongan hidup (`bun run db:tunnel`); `bun run check` gagal tanpanya.
- Kerjakan di cabang baru dari `origin/dev`: `git fetch origin && git switch -c feat/versi-api-per-kelompok origin/dev` (berkas spek dan rencana yang belum terlacak ikut). Push/PR mengikuti aturan global proyek (cek status PR dulu).

## Review Focus
1. Peta `apis` dari server rusak, kosong, atau berisi tipe salah: klien tidak boleh melempar galat; jatuh ke v1 (Task 1 dan 5).
2. Klien mengenal `@3` tetapi server hanya mengumumkan `latest: 2` (atau sebaliknya): pilih tertinggi yang tidak melebihi `latest` server (Task 1).
3. Jalur `/api/v2/*`: galat dan penolakan CSRF harus berbentuk problem+json seperti v1 (`isRestPath`), dan proksi desktop harus mengizinkannya (Task 2 dan 4).
4. Bundel unduhan tanpa catatan `createdAt` (state lama) atau ETag yang membuat server menjawab 304 setelah bundel dibuang: tidak boleh membuat UI macet di versi lama (Task 7).
5. UI dasar tanpa `ui-manifest.json` atau berisi JSON rusak: perilaku lama tetap, tanpa crash (Task 7).

---

### Task 1: `shared/api-versions.ts` (id berversi, peta kelompok, pemilih)

**Files:**
- Create: `shared/api-versions.ts`
- Test: `shared/api-versions.test.ts`

**Interfaces:**
- Produces (dipakai Task 2-7):
  - `restBase(version: number): string` -> `/api/v<version>`.
  - `parseApiId(id: string): { base: string; version: number }`; akhiran valid hanya `/^@([2-9]|[1-9]\d+)$/`; selain itu `{ base: id, version: 1 }`.
  - `apiGroup(id: string): string` (awalan id dasar sebelum titik pertama).
  - `interface GroupVersions { latest: number; deprecated: readonly number[] }`; `API_GROUP_VERSIONS: Record<string, GroupVersions>` (28 kelompok, semua `{ latest: 1, deprecated: [] }`).
  - `interface RetiredRoute { id: string; verb: ApiVerb; path: string; removedIn: string }` (`ApiVerb` diimpor sebagai tipe dari `./api`); `RETIRED_ROUTES: readonly RetiredRoute[] = []`.
  - `type ServerApis = Record<string, { latest: number; deprecated: number[] }>`; `announcedApis(): ServerApis` (salinan dari `API_GROUP_VERSIONS`); `parseServerApis(value: unknown): ServerApis | null`.
  - `pickApiId(base: string, ids: readonly string[], apis: ServerApis | null): string`.
  - `apiVersionsInUse(ids: readonly string[]): number[]` (versi unik terurut naik, selalu memuat 1).

- [ ] **Step 1: Tulis tes yang gagal** di `shared/api-versions.test.ts` (`bun:test`), memakai `API_ROUTES` dari `./api`:
  - `parseApiId('qrcodes.save')` = `{ base: 'qrcodes.save', version: 1 }`; `'qrcodes.save@2'` = `{ base: 'qrcodes.save', version: 2 }`; `'x@12'` versi 12; `'x@1'`, `'x@02'`, `'x@a'`, `'x@'` dianggap id biasa (versi 1, `base` = id utuh).
  - `apiGroup('qrcodes.save@2')` = `'qrcodes'`; `apiGroup('access.users.list')` = `'access'`.
  - Invarian tabel: himpunan `apiGroup` seluruh `Object.keys(API_ROUTES)` sama persis dengan `Object.keys(API_GROUP_VERSIONS)`; setiap id ber-`@n` punya id dasarnya di `API_ROUTES`; `latest` tiap kelompok >= versi tertinggi id kelompok itu; tiap anggota `deprecated` < `latest`.
  - `pickApiId` (daftar id palsu `['a.b', 'a.b@2', 'a.b@3', 'c.d']`): `apis` `null` -> `'a.b'`; `{a:{latest:1,deprecated:[]}}` -> `'a.b'`; `latest:2` -> `'a.b@2'`; `latest:3` -> `'a.b@3'`; `latest:5` (klien hanya sampai @3) -> `'a.b@3'`; `latest:3, deprecated:[3]` -> `'a.b@2'`; semua kandidat deprecated (`latest:3, deprecated:[1,2,3]`) -> `'a.b@3'` (tertinggi yang diizinkan, tidak melempar); kelompok tak ada di `apis` -> versi 1; id dasar tak ada di daftar -> melempar `Error` bermuatan nama id.
  - `parseServerApis`: `null`, `'x'`, `[]`, `{}` -> `null`; `{ a: { latest: 2, deprecated: [1] } }` kembali apa adanya; entri `latest` bukan bilangan bulat >= 1 (`0`, `1.5`, `'2'`) dibuang, entri lain tetap; `deprecated` bukan array bilangan bulat valid diganti `[]`; semua entri tak valid -> `null`.
  - `announcedApis()` memuat 28 kelompok dengan `{ latest: 1, deprecated: [] }` dan mengembalikan salinan (mengubahnya tak mengubah `API_GROUP_VERSIONS`).
  - `apiVersionsInUse(['a', 'a@2', 'b@4'])` = `[1, 2, 4]`; `apiVersionsInUse([])` = `[1]`.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun test shared/api-versions.test.ts` — Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasikan `shared/api-versions.ts`** dengan tanda tangan di atas. `pickApiId`: kandidat = id dengan `parseApiId(id).base === base`; bila kosong lempar `Error`; `latest` = `apis?.[apiGroup(base)]?.latest ?? 1`; pilih versi tertinggi yang `<= latest` dan tidak ada di `deprecated`; bila tak ada yang lolos, pilih tertinggi yang `<= latest` (jika pun tak ada, id dasar). Komentar kode berbahasa Indonesia santai.
- [ ] **Step 4: Jalankan tes, pastikan lulus**
  Run: `bun test shared/api-versions.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** (spek dan rencana ikut di commit pertama, terpisah):
  ```bash
  git add docs/superpowers/specs/2026-11-20-versi-api-ui-dasar-paksa-update-design.md docs/superpowers/plans/2026-11-20-versi-api-ui-dasar.md
  git commit -m "docs(api): spek dan rencana versi API per kelompok"
  git add shared/api-versions.ts shared/api-versions.test.ts
  git commit -m "feat(api): id berversi, peta versi per kelompok, dan pemilih id di shared"
  ```

---

### Task 2: Server menyajikan jalur berversi

**Files:**
- Modify: `server/src/http/rest.ts` (`REST_BASE`, `listOperations`, `registerRest`, header `Location` baris ~219, `locationOf`), `server/src/http/security.ts` (`isRestPath`), `server/src/http/openapi.ts` (`servers` per path item), `server/src/app.ts` (pemasangan per versi)
- Test: `server/src/http/rest-version.test.ts`

**Interfaces:**
- Consumes: Task 1 (`restBase`, `parseApiId`, `apiVersionsInUse`).
- Produces: `listOperations(version?: number, table?: Record<string, ApiRouteDef>): Operation[]` (bawaan `1` dan `API_ROUTES`; hanya id yang `parseApiId(id).version === version`; urutan statis-sebelum-berparameter tetap); `registerRest(app, routes, version?: number)` (bawaan 1); `REST_BASE` tetap diekspor (= `restBase(1)`); `isRestPath(path)` benar untuk `/api/v<n>` dan turunannya; `serversFor(version: number): { url: string }[] | undefined` di `openapi.ts` (`undefined` untuk v1).

- [ ] **Step 1: Tulis tes yang gagal** `server/src/http/rest-version.test.ts` (`bun:test`):
  - `listOperations()` tanpa argumen sama panjang dan urutan dengan hasil sebelum perubahan (hitung ulang dari `API_ROUTES`: jumlah id ditambah jumlah `create`).
  - `listOperations(2, tabelPalsu)` dengan `tabelPalsu = { 'a.b': {verb:'GET', path:'/b'}, 'a.b@2': {verb:'GET', path:'/b'}, 'a.c@2': {verb:'POST', path:'/c/{id}'} }` mengembalikan hanya dua operasi `@2`; `listOperations(1, tabelPalsu)` hanya `a.b`; `listOperations(3, tabelPalsu)` kosong.
  - `isRestPath`: `'/api/v1'`, `'/api/v1/x'`, `'/api/v2/x'`, `'/api/v10/x'` benar; `'/api/v1x/y'`, `'/api/vx'`, `'/api/ping'`, `'/api/desktop/x'`, `'/api'` salah.
  - `serversFor(1)` = `undefined`; `serversFor(2)` = `[{ url: '/api/v2' }]`.
  - Aplikasi (`app.request`, tanpa Env): `POST /api/v2/apa-saja` tanpa header `X-Requested-With` -> 403 dengan `content-type` memuat `application/problem+json`; `GET /api/v2/apa-saja` -> 404 dan `content-type` tidak memuat `text/html`.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd server test src/http/rest-version.test.ts` — Expected: FAIL (fungsi/parameter belum ada, `isRestPath` salah untuk v2).
- [ ] **Step 3: Implementasikan.** `rest.ts`: `REST_BASE = restBase(1)`; `listOperations` memfilter menurut versi dan menerima tabel; `registerRest` meneruskan `version`; `Location` memakai `restBase(parseApiId(id).version)` (ubah `locationOf` agar menerima versi). `security.ts`: `isRestPath` = `/^\/api\/v\d+(\/|$)/`. `openapi.ts`: tiap path item milik id ber-`@n` (n >= 2) diberi `servers: serversFor(n)`; `servers` dokumen tetap `/api/v1`; `buildOpenApi` menerima `table` opsional bawaan `API_ROUTES` tanpa mengubah keluaran hari ini. `app.ts`: ganti blok REST tunggal dengan perulangan `for (const v of apiVersionsInUse(Object.keys(API_ROUTES)))` yang membuat `Hono`, `registerRest(sub, routes, v)`, lalu `app.route(restBase(v), sub)`; aliran SSE tetap dipasang tepat sebelum pemasangan v1.
- [ ] **Step 4: Jalankan tes, pastikan lulus, dan tes REST/OpenAPI yang ada tidak berubah**
  Run: `bun run --cwd server test src/http` — Expected: PASS semua (termasuk `rest.test.ts`, tes OpenAPI yang ada).
- [ ] **Step 5: Commit**
  ```bash
  git add server/src/http server/src/app.ts
  git commit -m "feat(api): server menyajikan jalur /api/v<n> per versi rute"
  ```

---

### Task 3: `/api/ping` mengumumkan peta versi

**Files:**
- Modify: `server/src/app.ts` (handler `/api/ping`)
- Test: `server/src/app.test.ts`

**Interfaces:**
- Consumes: Task 1 (`announcedApis`, `ServerApis`).
- Produces: respons `/api/ping` bertambah field `apis: ServerApis` (field lama `ok`, `version`, `build` tetap).

- [ ] **Step 1: Tulis tes yang gagal** di `server/src/app.test.ts`: `GET /api/ping` -> `body.apis` ada; kuncinya sama dengan `Object.keys(API_GROUP_VERSIONS)`; `body.apis.qrcodes` sama dengan `{ latest: 1, deprecated: [] }`; `ok`, `version`, `build` tidak berubah (tes yang ada tetap lulus).
- [ ] **Step 2: Jalankan, pastikan gagal**
  Run: `bun run --cwd server test src/app.test.ts` — Expected: FAIL (`apis` undefined).
- [ ] **Step 3: Implementasikan** `c.json({ ok: true, ...buildInfo(c.env), apis: announcedApis() })`.
- [ ] **Step 4: Jalankan, pastikan lulus**
  Run: `bun run --cwd server test src/app.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add server/src/app.ts server/src/app.test.ts
  git commit -m "feat(api): /api/ping mengumumkan versi API per kelompok"
  ```

---

### Task 4: Proksi desktop mengizinkan `/api/v<n>/`

**Files:**
- Modify: `desktop/src/main/api-proxy.ts` (`PROXY_ALLOW`, baris 9)
- Test: `desktop/src/main/api-proxy.test.ts`

**Interfaces:**
- Consumes: —. Produces: `PROXY_ALLOW` memuat `/^\/api\/v\d+\//` menggantikan `/^\/api\/v1\//`.

- [ ] **Step 1: Tulis tes yang gagal** mengikuti pola tes daftar izin yang sudah ada di `api-proxy.test.ts`: jalur `/api/v1/me` dan `/api/v2/qrcodes/abc` diizinkan; `/api/v1x/me`, `/api/vx/me`, `/api/v2` (tanpa garis miring akhir), `/api/desktop/catalog`, dan `/auth/login` tetap ditolak.
- [ ] **Step 2: Jalankan, pastikan gagal**
  Run: `bun run --cwd desktop test src/main/api-proxy.test.ts` — Expected: FAIL pada kasus `/api/v2/...`.
- [ ] **Step 3: Implementasikan** perubahan regex `PROXY_ALLOW`; perbarui komentar daftar izin.
- [ ] **Step 4: Jalankan, pastikan lulus**
  Run: `bun run --cwd desktop test src/main/api-proxy.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add desktop/src/main/api-proxy.ts desktop/src/main/api-proxy.test.ts
  git commit -m "feat(api): proksi desktop mengizinkan jalur API semua versi"
  ```

---

### Task 5: Klien web memakai versi di URL dan menyimpan peta server

**Files:**
- Modify: `web/src/lib/api/client.ts` (`API_BASE`, `urlOf`), `web/src/main.tsx` (satu panggilan di awal boot, sebelum `loadMeForBoot`)
- Create: `web/src/lib/api/versions.ts`
- Test: `web/src/lib/api/versions.test.ts`, `web/src/lib/api/client.test.ts`

**Interfaces:**
- Consumes: Task 1 (`restBase`, `parseApiId`, `parseServerApis`, `pickApiId`, `ServerApis`).
- Produces:
  - `client.ts`: `API_BASE = restBase(1)` (nilai tetap `/api/v1`); fungsi murni terekspor `requestUrl(baseUrl: string, id: string, parts: RequestParts): string` (menggantikan `urlOf`; memakai `restBase(parseApiId(id).version)`).
  - `versions.ts`: `getServerApis(): ServerApis | null`; `setServerApis(value: unknown): void` (lewat `parseServerApis`; nilai tak valid diabaikan, nilai valid disimpan di memori dan `localStorage` kunci `qc.api.apis`, semua akses `localStorage` dibungkus try/catch); `refreshServerApis(fetchImpl?: typeof fetch): Promise<void>` (GET `/api/ping`, `cache: 'no-store'`, galat jaringan/respons buruk ditelan); `pickApi(base: ApiId): ApiId` (= `pickApiId(base, Object.keys(API_ROUTES), getServerApis())` sebagai `ApiId`); `startApiVersions(): void` (membaca salinan tersimpan sekali, memanggil `refreshServerApis` saat mulai, saat event `online`, dan saat tab kembali terlihat paling sering sekali per 5 menit); `resetServerApisForTests(): void`.

- [ ] **Step 1: Tulis tes yang gagal.** `versions.test.ts` (vitest, `localStorage` jsdom): peta tersimpan terbaca setelah `startApiVersions()`/pemuatan awal; `refreshServerApis` dengan `fetchImpl` palsu yang mengembalikan `{ apis: { qrcodes: { latest: 2, deprecated: [] } } }` menggantikan peta dan menyimpannya; respons non-2xx, JSON rusak, `apis` hilang, atau `fetch` yang melempar membiarkan peta lama utuh dan tidak melempar; `setServerApis('sampah')` tidak mengubah apa pun; `pickApi('qrcodes.list')` mengembalikan `'qrcodes.list'` (tabel nyata hanya v1) dengan peta apa pun; `localStorage` yang melempar saat dibaca/ditulis tidak membuat fungsi apa pun melempar. `client.test.ts`: `requestUrl('', 'brands.list', parts)` menghasilkan `/api/v1/...` persis seperti sebelumnya (tes yang ada tetap lulus); `requestUrl('', 'qrcodes.save@2' as ApiId, { verb:'PUT', path:'/qrcodes/x', query:{}, ... })` menghasilkan `/api/v2/qrcodes/x`.
- [ ] **Step 2: Jalankan, pastikan gagal**
  Run: `bun run --cwd web test src/lib/api` — Expected: FAIL (modul/fungsi belum ada).
- [ ] **Step 3: Implementasikan** `versions.ts` dan ubah `client.ts` (`urlOf` -> `requestUrl`, dipanggil dengan `id`); panggil `startApiVersions()` di `main.tsx` tepat sebelum `await loadMeForBoot()` (jalur boot normal dan offline sama-sama tercakup).
- [ ] **Step 4: Jalankan, pastikan lulus, dan tes paritas tak berubah**
  Run: `bun run --cwd web test src/lib/api src/modules/handover/lib/outbox-parity.test.ts src/modules/handover/lib/sync-sw.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add web/src/lib/api web/src/main.tsx
  git commit -m "feat(api): klien web memilih versi dari peta server dan memakainya di URL"
  ```

---

### Task 6: Potret kontrak dan tes superset

**Files:**
- Create: `shared/api-snapshot.ts`, `scripts/api-snapshot.ts`, `shared/api-contract.snapshot.json` (dibuat skrip)
- Modify: `package.json` (skrip `api:snapshot`)
- Test: `shared/api-snapshot.test.ts`

**Interfaces:**
- Consumes: Task 1 (`RETIRED_ROUTES`, `RetiredRoute`).
- Produces: `interface SnapshotEntry { id: string; verb: ApiVerb; path: string; query?: Record<string, QueryKind>; create?: { verb: ApiVerb; path: string } }`; `contractSnapshot(table?: Record<string, ApiRouteDef>): SnapshotEntry[]` (urut menurut `id`, bawaan `API_ROUTES`); `compareContract(previous: readonly SnapshotEntry[], current: readonly SnapshotEntry[], retired: readonly RetiredRoute[]): string[]` (daftar pelanggaran berbahasa Indonesia; kosong = lolos). Skrip `bun run api:snapshot` menulis berkas JSON; `bun run api:snapshot --check` mencetak pelanggaran terhadap berkas dan keluar dengan kode 1 bila ada.

- [ ] **Step 1: Tulis tes yang gagal** `shared/api-snapshot.test.ts`: `contractSnapshot` urut menurut id dan memuat `query`/`create` hanya bila ada; `compareContract` lolos (`[]`) untuk potret yang sama dan bila rute hanya ditambah; melaporkan pelanggaran (satu pesan memuat id) bila id hilang tanpa masuk `retired`, bila `verb` atau `path` berubah, bila kunci `query` hilang atau jenisnya berubah, atau bila `create` hilang/berubah; id hilang yang ada di `retired` lolos; DAN satu tes yang membaca `shared/api-contract.snapshot.json` (via `node:fs` dan `new URL(..., import.meta.url)`) lalu menegaskan `compareContract(berkas, contractSnapshot(), RETIRED_ROUTES)` kosong.
- [ ] **Step 2: Jalankan, pastikan gagal**
  Run: `bun test shared/api-snapshot.test.ts` — Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasikan** `shared/api-snapshot.ts`, skrip `scripts/api-snapshot.ts` (tulis `JSON.stringify(entries, null, 2) + '\n'`), tambah `"api:snapshot": "bun run scripts/api-snapshot.ts"` ke `package.json`, lalu jalankan `bun run api:snapshot` untuk membuat potret awal (= kontrak hari ini).
- [ ] **Step 4: Jalankan tes dan lint**
  Run: `bun test shared/api-snapshot.test.ts && bun run lint` — Expected: PASS; bila Biome mengeluhkan format JSON, jalankan `bunx biome format --write shared/api-contract.snapshot.json` lalu ulangi `bun run api:snapshot --check` (harus tetap tanpa pelanggaran).
- [ ] **Step 5: Commit**
  ```bash
  git add shared/api-snapshot.ts shared/api-snapshot.test.ts shared/api-contract.snapshot.json scripts/api-snapshot.ts package.json
  git commit -m "feat(api): potret kontrak dan tes superset kompatibilitas mundur"
  ```

---

### Task 7: Desktop memakai UI dasar yang lebih baru

**Files:**
- Modify: `desktop/src/main/ui/ui-bundle.ts`
- Test: `desktop/src/main/ui/ui-bundle.test.ts`

**Interfaces:**
- Consumes: `parseUiManifest` dari `@countrylock/ui-manifest` (sudah diimpor).
- Produces: perilaku `createUiBundleManager`: (a) `State` bertambah `created: Record<string, number>` (versi -> `createdAt` manifest; diisi tiap manifest diterima di `check()`, baik jalur `usable(uiVersion)` maupun setelah unduhan; `readState` membersihkan: kunci harus HEX64, nilai bilangan terhingga; `prune()` membuang catatan versi yang tak disimpan); (b) fungsi dalam modul `readBaselineCreatedAt(baselineDir: string): number | null` (membaca `ui-manifest.json` di `baselineDir` lewat `parseUiManifest`; berkas hilang atau tak valid -> `null`); (c) saat pembuatan manager, setelah blok reset kunci/jembatan dan sebelum `let current`: bila `baselineAt !== null`, tiap versi `active`/`previous`/`ready` yang catatan `created`-nya bukan angka atau `<= baselineAt` dibuang (jadi `null`); bila ada yang dibuang: `state.etag = null`, `state.failures = 0`, `prune()`, `persist()`; (d) di `check()`, setelah cek `minBridge` dan sebelum cek `bad`: bila `baselineAt !== null && manifest.createdAt <= baselineAt` kembalikan `{ status: 'none', reason: 'UI dasar lebih baru dari bundel server', uiVersion }` setelah `remember(newEtag)`, tanpa mengunduh apa pun.

- [ ] **Step 1: Tulis tes yang gagal** di `ui-bundle.test.ts`, memakai helper `build()` dan pola server uji yang sudah ada; tambah helper untuk menulis `ui-manifest.json` ke folder dasar (isi = `JSON.stringify(build(...).manifest)` dengan `createdAt` yang dikendalikan lewat `tweak`):
  1. State berisi bundel aktif ber-`createdAt` lebih lama dari UI dasar -> setelah `createUiBundleManager`, `activeRoot()` = `baselineDir`, `state.json` tak lagi memuat `active`, dan `etag` kosong.
  2. Bundel aktif lebih baru dari UI dasar -> `activeRoot()` tetap folder versinya.
  3. `state.json` lama tanpa `created` (bundel aktif ada, UI dasar punya manifest) -> bundel dibuang (kembali ke dasar).
  4. UI dasar tanpa `ui-manifest.json`, atau berisi sampah -> perilaku lama (bundel aktif dipertahankan, termasuk tanpa `created`).
  5. `check()` dengan manifest server `createdAt` <= UI dasar -> `status: 'none'`, alasan memuat "UI dasar lebih baru", dan tak ada berkas bundel yang diminta/diunduh; dengan `createdAt` > UI dasar -> `status: 'ready'` seperti biasa dan catatan `created[uiVersion]` tersimpan di `state.json`.
  6. Setelah kasus 1, `check()` dengan server yang menyajikan bundel lebih baru dari UI dasar mengunduh ulang (tidak macet pada 304).
- [ ] **Step 2: Jalankan, pastikan gagal**
  Run: `bun run --cwd desktop test src/main/ui/ui-bundle.test.ts` — Expected: FAIL pada kasus baru; tes lama tetap lulus.
- [ ] **Step 3: Implementasikan** sesuai antarmuka di atas; perbarui komentar kepala berkas dengan aturan "UI dasar yang lebih baru menang" (keputusan pemilik 2026-11-20).
- [ ] **Step 4: Jalankan semua tes desktop dan typecheck**
  Run: `bun run --cwd desktop test && bun run --cwd desktop typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add desktop/src/main/ui/ui-bundle.ts desktop/src/main/ui/ui-bundle.test.ts
  git commit -m "feat(ui): desktop memakai UI dasar yang lebih baru dari bundel unduhan"
  ```

---

### Task 8: Dokumen kebijakan, changelog, dan status spek

**Files:**
- Modify: `CLAUDE.md`, `docs/adding-a-module.md`, `docs/superpowers/specs/2026-11-20-versi-api-ui-dasar-paksa-update-design.md`
- Create: `server/changelog.d/20261120-versi-api-per-kelompok.md`, `desktop/changelog.d/20261120-ui-dasar-lebih-baru.md`

**Interfaces:** — (dokumen).

- [ ] **Step 1: Perbarui `CLAUDE.md`.** (a) Bullet "UI hibrid + manifest bertanda tangan": tambahkan bahwa UI dasar yang `createdAt`-nya lebih baru daripada bundel unduhan dipakai lebih dulu dan bundel lebih lama dari UI dasar tidak diterapkan (keputusan pemilik 2026-11-20; `ui-bundle.ts`). (b) Bagian "Menambah rute REST": tambahkan butir kebijakan versi: kontrak selalu kompatibel mundur; perubahan merusak = id baru `<id>@<n>` (`shared/api-versions.ts`) berdampingan dengan v1, kelompok dinaikkan di `API_GROUP_VERSIONS.latest`, handler lama menjadi adaptor ke layanan yang sama, potret `bun run api:snapshot` diperbarui saat rilis server; rute yang dipakai antrean offline/`sync-sw.js` tidak boleh dinaikkan sebelum skrip itu diajari versi; `deprecated`, penghapusan lewat `RETIRED_ROUTES`/426, dan paksa pembaruan DIRANCANG tetapi BELUM dibangun (spek 2026-11-20 fase 3).
- [ ] **Step 2: Tambah bagian "Mengubah kontrak yang merusak" di `docs/adding-a-module.md`**: langkah (tambah id `@2` di `ApiContract` dan `API_ROUTES`, naikkan `latest`, validator/handler baru + adaptor v1, fixture tes v1, jalankan `bun run api:snapshot --check`), dan larangan menghapus id tanpa melewati proses deprecated.
- [ ] **Step 3: Perbarui spek.** Status menjadi "Disetujui pemilik 2026-11-20 (desain); implementasi dipecah: rencana `2026-11-20-versi-api-ui-dasar.md` untuk fase 1, 2, 4 dan rencana terpisah untuk fase 3". Catat penyimpangan rencana dari spek: (i) tidak ada field `version?` di `ApiRouteDef`, versi diturunkan dari akhiran id; (ii) `api()` tetap menerima id persis, pemilihan versi lewat `pickApi()` yang dipanggil lapisan compat modul; (iii) catatan `createdAt` per versi disimpan di `state.json` dan versi tanpa catatan dianggap tidak lebih baru dari UI dasar; (iv) OpenAPI memakai `servers` per path item untuk v >= 2; (v) integrasi potret ke `release:prepare` dipindah ke fase 3 (sementara diperbarui manual lewat `bun run api:snapshot`).
- [ ] **Step 4: Tulis dua fragmen changelog.** Server: `feat(api): server mengumumkan versi API per kelompok di /api/ping sebagai dasar perubahan kontrak bertahap`. Desktop: `fix(ui): UI dasar yang lebih baru dari bundel unduhan sekarang dipakai lebih dulu`. Lalu validasi.
  Run: `bun run changelog validate server && bun run changelog validate desktop` — Expected: lolos tanpa galat.
- [ ] **Step 5: Verifikasi akhir seluruh repo** (terowongan harus hidup).
  Run: `bun run check` — Expected: typecheck, Biome, dan semua tes hijau.
- [ ] **Step 6: Commit**
  ```bash
  git add CLAUDE.md docs server/changelog.d desktop/changelog.d
  git commit -m "docs(api): kebijakan versi API, fragmen changelog, dan status spek"
  ```
