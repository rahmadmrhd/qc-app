# Rilis Desktop dan Auto-Update (rilis semver bagian 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rilis aplikasi desktop berversi (`desktop-vX.Y.Z`, installer Windows x64+arm64) yang disimpan di Google Drive, disajikan server QC, dan diperbarui otomatis oleh aplikasi lewat manifest bertanda tangan Ed25519.

**Architecture:** CI membangun installer, menandatangani `release-<versi>.json`, dan mengunggahnya ke folder Drive khusus (installer, json, terakhir sig). Server hanya membaca folder itu dan menyajikan `GET /api/desktop/app-manifest` dan `/api/desktop/app-file/<versi>/<nama>` (tanpa kunci, tanpa token GitHub). Aplikasi memakai provider kustom `electron-updater` yang memverifikasi tanda tangan dengan kunci publik tertanam sebelum menyerahkan `UpdateInfo`.

**Tech Stack:** Bun 1.4.2 + Hono (server), Electron 45 + `electron-updater` 6.8.11 (dipatok; versi terbaru per 2026-11-18), vitest (desktop), `bun:test` (server, scripts), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-17-rilis-desktop-auto-update-design.md` (revisi 2, 2026-11-18). Bagian 1-3 seri: `2026-11-17-rilis-semver-design.md`.

## Global Constraints

- Tag `desktop-vX.Y.Z`; versi di `desktop/package.json`; PR rilis `release/desktop-vX.Y.Z` -> `main` (merge commit, dua induk). `release:prepare desktop` sudah ada (bagian 1) dan tidak diubah.
- Installer: `QC-App-Setup-<versi>-<arch>.exe`, `arch` = `x64` | `arm64`; tanpa Authenticode.
- Tanpa identitas repo: manifest, dialog, galat, dan log aplikasi/server TIDAK memuat `github.com`, pemilik, atau nama repo; changelog dalam manifest tanpa tautan PR/commit. Pembaruan dan unduhan TIDAK bergantung pada GitHub dan server TIDAK memegang token GitHub (spek 3.1).
- Secret `DESKTOP_RELEASE_SIGNING_KEY` (privat Ed25519) dan `DESKTOP_DRIVE_PUBLISHER_KEY` (SA penerbit) pada environment `desktop-release` (hanya ref `main`); variable `DESKTOP_RELEASE_PUBLIC_KEY_PEM` dan `DESKTOP_RELEASES_FOLDER_ID`. Kunci tanda tangan rilis TERPISAH dari kunci manifest UI.
- Server: `DESKTOP_RELEASES_FOLDER_ID` ditambah ke `config.ts`, `deploy/compose.yml`, `deploy/.env.example`, `server/.env.example` (dijaga `server/src/deploy-files.test.ts`); kosong = rute 404. Semua penolakan = 404 problem+json generik.
- Aplikasi: cek saat start (tertunda) dan tiap 6 jam; `autoDownload=false`; hanya naik (versi > terpasang); tidak pernah memasang saat inject Country Lock berjalan; aktif hanya bila `app.isPackaged`, bukan `--smoke`/`--smoke-ui`, dan `serverUrl` valid; tanpa kanal jembatan baru (`BRIDGE_VERSION` tetap).
- Retensi: biner 10 versi terbaru per arsitektur; `release-<v>.json`/`.sig` tak dihapus. Penarikan = hapus `.sig` versi itu.
- Workflow: aksi pihak ketiga dipatok SHA, tanpa `${{ }}` di `run`, `permissions` minimal, `contents: write` hanya `publish`; `scripts/ci-workflows.test.ts` diperluas.
- Semua tes: `bun run --cwd desktop test` (vitest), `bun run --cwd server test src/modules/desktop` (butuh `bun run db:tunnel`), `bun test scripts shared`; sebelum commit akhir `bun run check`.

## Keputusan perancang rencana (perlu disetujui saat review rencana)

1. **Tata letak Drive DATAR, bukan subfolder per versi** (mengubah spek 5.2): penjaga folder klien Google hanya mengizinkan folder tercantum atau anak langsung `GOOGLE_ROOT_FOLDER_ID`, sehingga subfolder versi menuntut perubahan penjaga. Satu folder berisi `QC-App-Setup-<v>-<arch>.exe`, `release-<v>.json`, `release-<v>.sig`. Spek 5.2 diperbarui di Task 10.
2. **Pembatas laju unduhan installer per IP** pada `app-file` (tambahan di luar spek; rute publik berbadan ~100 MB): dapat dibuang bila tak diinginkan.
3. **`sha512` di manifest berbentuk base64** (konvensi `electron-updater`).
4. **"Tidak ada pembaruan"** (manifest tak sah, 404, versi tak lebih baru) dikembalikan provider sebagai `UpdateInfo` dengan versi terpasang, alasan hanya di log tanpa identitas repo; dialog hanya muncul untuk pembaruan sah.
5. **Urutan `publish` dibalik dari spek 5.6**: unggah ke Drive DULU, baru tag + GitHub Release (Release tanpa unggahan sukses = keadaan yatim; tag/Release idempoten sehingga aman diulang lewat `workflow_dispatch`).

## Review Focus

- Versi `1.10.0` harus mengalahkan `1.9.0` (perbandingan numerik, server DAN aplikasi); versi bukan `X.Y.Z` diabaikan.
- Berkas `release-<v>.sig` tanpa `.json`/installer (rilis setengah unggah atau tarik sebagian) = versi tak terlihat atau 404, bukan 500.
- Nama berkas jahat di `app-file` (`..`, `%2f`, `\`, nama tak tercantum di manifest) = 404 seragam.
- Server menyajikan BYTE `release-<v>.json` persis (tanda tangan atas teks kanonik); manifest tak kanonik ditolak.
- Pembaruan tak pernah dipasang/diminta restart saat inject berjalan; "Nanti" tidak memunculkan dialog berulang pada sesi yang sama untuk versi yang sama.

---

### Task 1: Spike dan ketergantungan `electron-updater`

**Files:**
- Modify: `desktop/package.json` (dependencies: `"electron-updater": "6.8.11"` dipatok), `bun.lock`, `desktop/scripts/build.ts` (tambah `electron-updater` ke `external`)
- Create: `desktop/src/main/update/updater-contract.test.ts`

**Interfaces:**
- Produces: bukti bahwa API berikut tersedia di versi terpasang: kelas `Provider` (ekspor `electron-updater`), `getLatestVersion(): Promise<UpdateInfo>`, `resolveFiles(info): Array<ResolvedUpdateFileInfo>`, dan `autoUpdater.setFeedURL({ provider: 'custom', updateProvider: <kelas> })`.

- [ ] **Step 1: Tulis tes kontrak** `updater-contract.test.ts` (vitest, Node): mengimpor `electron-updater`; menegaskan `typeof Provider === 'function'`, prototipe memuat `getLatestVersion` dan `resolveFiles` (atau `Provider` abstrak yang dapat diturunkan: turunan uji dengan kedua metode dapat dibuat), `NsisUpdater.prototype.setFeedURL` ada, dan `AppUpdater.prototype` memuat `downloadUpdate`, `quitAndInstall`, properti `autoDownload`/`disableDifferentialDownload` dapat diatur. Jalankan: `bun run --cwd desktop test src/main/update/updater-contract.test.ts`. Expected: FAIL (paket belum terpasang).
- [ ] **Step 2: Pasang** `electron-updater@6.8.11` (`bun add --cwd desktop --exact electron-updater@6.8.11`), tambahkan ke `external` di `build.ts`. Jalankan tes lagi. Expected: PASS.
- [ ] **Step 3: Verifikasi tanpa `app-update.yml`**: dalam tes yang sama, buat `NsisUpdater`-turunan/`autoUpdater` dengan `setFeedURL` custom (provider palsu) di Node dan panggil `checkForUpdates()` dengan `app` yang di-mock bila perlu; ia harus memanggil `getLatestVersion` provider palsu tanpa membaca berkas `app-update.yml`. Bila `electron-updater` menolak berjalan di luar Electron, catat batasannya di komentar tes dan uji bagian yang dapat diuji (pembuatan provider + `resolveFiles`); pemasangan senyap NSIS x64/arm64 diuji manual (Task 10, checklist).
- [ ] **Step 4: Keputusan**: bila kontrak provider kustom TIDAK tersedia (kelas/metode hilang, `setFeedURL` custom tak didukung), BERHENTI dan laporkan ke pemilik: spek 4.2 jatuh ke pengunduh buatan sendiri dan rencana ini perlu ditulis ulang untuk Task 5-6.
- [ ] **Step 5: Commit** `feat(desktop): electron-updater 6.8.11 dan tes kontrak provider kustom`.

### Task 2: Kontrak rilis bersama (`shared/desktop-release.ts`)

**Files:**
- Create: `shared/desktop-release.ts`, `shared/desktop-release.test.ts`

**Interfaces:**
- Produces (dipakai server, skrip rilis, desktop):
  - `RELEASE_SCHEMA = 1`, `RELEASE_ARCHS = ['x64','arm64'] as const`, `type ReleaseArch`.
  - `interface ReleaseFile { name: string; arch: ReleaseArch; size: number; sha512: string }`; `interface DesktopReleaseManifest { schema: 1; version: string; publishedAt: string; files: ReleaseFile[]; changelog: string }`.
  - `installerName(version, arch): string` (`QC-App-Setup-<v>-<arch>.exe`), `manifestFileName(version)` (`release-<v>.json`), `signatureFileName(version)` (`release-<v>.sig`).
  - `parseReleaseManifest(json: string): DesktopReleaseManifest | null` (kanonik: `JSON.stringify(JSON.parse(json)) === json`; `schema === 1`; `version` `X.Y.Z`; `publishedAt` ISO; tiap `files[]` bernama persis `installerName(version, arch)`, tanpa arch ganda, `size` 1..500 MB bilangan bulat, `sha512` base64 88 karakter; `changelog` <= 20.000 karakter; kunci tak dikenal = ditolak).
  - `compareVersions(a, b): number` (numerik `X.Y.Z`), `latestVersion(versions: string[]): string | null` (mengabaikan yang bukan `X.Y.Z`).
  - `isReleaseFileName(name: string): { kind: 'installer'|'manifest'|'signature'; version: string; arch?: ReleaseArch } | null` (pola ketat, dipakai server mengurai daftar folder).

- [ ] **Step 1: Tes (RED)** `shared/desktop-release.test.ts`: `compareVersions('1.10.0','1.9.0') > 0`; `latestVersion(['1.9.0','1.10.0','x','2.0'])` = `'1.10.0'`; `parseReleaseManifest` menerima manifest sah, menolak: non-kanonik (spasi/urutan kunci berbeda), `schema` 2, nama berkas `..\\x.exe`, arch ganda, `sha512` 87 karakter, `size` 0, kunci ekstra, `version` `01.0.0`; `isReleaseFileName` mengenali ketiga jenis dan menolak `QC-App-Setup-1.0.0-ia32.exe`, `release-1.0.0.json.bak`, nama bertitik ganda/`/`.
- [ ] **Step 2:** `bun test shared/desktop-release.test.ts` -> FAIL (modul belum ada).
- [ ] **Step 3: Implementasikan** modul murni (tanpa API runtime/DOM; aturan `shared/`).
- [ ] **Step 4:** tes -> PASS; `bunx biome check shared`.
- [ ] **Step 5: Commit** `feat(rilis): kontrak manifest rilis desktop (shared)`.

### Task 3: Konfigurasi server dan penjaga folder Drive

**Files:**
- Modify: `server/src/config.ts` (+ `desktopReleasesFolderId: get('DESKTOP_RELEASES_FOLDER_ID')`, masuk daftar `googleIds`), `server/src/core/google/settings.ts` (`DESKTOP_RELEASES_FOLDER_ID: string`), `server/src/core/google/drive.ts` (masuk himpunan `explicit`), `server/src/server.ts` (`envFromConfig`), `server/src/core/env.ts` bila tipe `Env` mewarisi `GoogleSettings` otomatis (periksa), `deploy/compose.yml`, `deploy/.env.example`, `server/.env.example`
- Test: `server/src/config.test.ts`, `server/src/deploy-files.test.ts` (sudah menjaga compose/env), tes drive (`server/src/core/google/*.test.ts`)

**Interfaces:**
- Produces: `Env.DESKTOP_RELEASES_FOLDER_ID: string` (kosong = fitur nonaktif); folder itu lolos `isAllowedFolder`.

- [ ] **Step 1: Tes (RED)**: `loadConfig` menolak `DESKTOP_RELEASES_FOLDER_ID` bukan id Drive (pesan tanpa nilainya) dan menerima kosong; tes klien Drive: `listFolder`/`downloadFile` pada folder itu lolos penjaga tanpa panggilan verifikasi induk; `deploy-files.test.ts` gagal sampai compose dan `.env.example` memuat variabel.
- [ ] **Step 2:** jalankan ketiganya -> FAIL.
- [ ] **Step 3:** tambahkan variabel di semua tempat di atas (compose: `DESKTOP_RELEASES_FOLDER_ID: ${DESKTOP_RELEASES_FOLDER_ID:-}`).
- [ ] **Step 4:** tes -> PASS (`bun run --cwd server test src/config.test.ts src/deploy-files.test.ts src/core/google`).
- [ ] **Step 5: Commit** `feat(server): konfigurasi folder rilis desktop`.

### Task 4: Pembaca rilis dan rute server

**Files:**
- Create: `server/src/modules/desktop/app-release.ts`, `server/src/modules/desktop/app-release.test.ts`
- Modify: `server/src/modules/desktop/routes.ts` (rute `/app-manifest`, `/app-file/*`), `server/src/modules/desktop/routes.test.ts`

**Interfaces:**
- Consumes: Task 2 (`isReleaseFileName`, `parseReleaseManifest`, `latestVersion`, `compareVersions`), `BridgeClient.listFolder/readFile/downloadFile` (`server/src/core/bridge-client.ts`), `Env.DESKTOP_RELEASES_FOLDER_ID`.
- Produces: `interface ServedRelease { version: string; manifestJson: string; manifest: object; signature: string; etag: string; files: Map<string, { id: string; size: number }> }`; `createReleaseReader(deps: { client: BridgeClient; folderId: string; now: () => number; ttlMs?: number }): { latest(arch: ReleaseArch): Promise<ServedRelease | null>; file(version: string, name: string): Promise<{ id: string; size: number } | null> }`.
- Rute: `GET /api/desktop/app-manifest?arch=x64|arm64` -> `{ manifest, signature }` (+ `ETag`/304, `Cache-Control: no-cache`); `GET /api/desktop/app-file/<versi>/<nama>` -> stream `application/octet-stream`, `no-transform`, `Content-Length`.

- [ ] **Step 1: Tes pembaca (RED)** dengan klien Drive palsu (`server/test-support/fake-bridge.ts`; tambahkan dukungan `listFolder` bila belum memadai): versi tertinggi yang punya `.sig` + `.json` kanonik + installer arch yang diminta; `1.10.0` mengalahkan `1.9.0`; `.sig` tanpa `.json` = versi tak terlihat (jatuh ke versi di bawahnya); manifest non-kanonik/`.sig` bukan 86 karakter base64url = diabaikan; installer yang tercantum tapi tak ada di folder = versi diabaikan; hasil dimemo sampai `ttlMs` (panggilan `listFolder` tak bertambah), folder kosong = `null`; `file(version, name)` hanya untuk nama yang tercantum di manifest versi yang terlihat.
- [ ] **Step 2: Tes rute (RED)** di `routes.test.ts`: `app-manifest` memberi bentuk `{ manifest, signature }` dan 304 pada ETag sama; `arch` tak dikenal/tanpa arch = 404; folder tak dikonfigurasi = 404; `app-file` menyajikan byte persis, nama `..`/`%2f`/`\`/tak tercantum/`.sig` versi tak terlihat = 404 seragam (isi problem tak membocorkan penyebab); pembatas laju: lebih dari N unduhan per IP per jam = 429 problem+json (pola `catalogLimiterKey` di berkas yang sama, kunci `desktop-app-file:<limiterAddress(ip)>`, N = 20).
- [ ] **Step 3:** `bun run --cwd server test src/modules/desktop` -> FAIL.
- [ ] **Step 4: Implementasikan** pembaca (memo per proses, TTL 5 menit; mengurai daftar folder berhalaman dengan `isReleaseFileName`; membaca `.json` dan `.sig` lewat `readFile` dengan batas ukuran seperti `MAX_MANIFEST_BYTES`/`MAX_SIGNATURE_FILE_BYTES` di `routes.ts`; ETag = sha256(json + `\n` + sig) seperti `ui-manifest`) dan dua rute (stream dari `downloadFile`; tidak mencatat nama berkas/IP di log selain peringatan generik).
- [ ] **Step 5:** tes -> PASS; `bunx biome check server/src/modules/desktop`.
- [ ] **Step 6: Commit** `feat(server): penyajian rilis desktop (manifest dan installer dari Drive)`.

### Task 5: Verifikasi rilis dan provider kustom di desktop

**Files:**
- Create: `desktop/src/main/update/release-verify.ts`, `desktop/src/main/update/release-public-key.ts`, `desktop/src/main/update/app-update-provider.ts` + `*.test.ts` untuk ketiganya (kunci publik: tes seperti `public-key.test.ts`)
- Modify: `desktop/scripts/ui-public-key.ts` (ekstrak `resolvePublicKey(env, name, required)` generik; `resolveUiPublicKey` tetap sebagai pembungkus, tes lama tetap hijau), `desktop/scripts/build.ts` (`define` `__RELEASE_PUBLIC_KEY_PEM__` dari env `DESKTOP_RELEASE_PUBLIC_KEY_PEM`; flag `--require-release-key`), `desktop/package.json` (`dist` memakai kedua flag)

**Interfaces:**
- Consumes: Task 2 (`parseReleaseManifest`, `compareVersions`, `installerName`), `verifyUiManifest`/`normalizePublicKeyInput` dari `@countrylock/ui-manifest` (primitif Ed25519 generik, dipakai apa adanya).
- Produces: `RELEASE_PUBLIC_KEY_PEM: string | null`;
  `evaluateRelease(input: { manifestJson: string; signature: string; publicKeyPem: string; installedVersion: string; arch: ReleaseArch }): { kind: 'available'; manifest: DesktopReleaseManifest; file: ReleaseFile } | { kind: 'none'; reason: string }` (tak sah tanda tangan, schema, versi <= terpasang, arch tanpa berkas = `none`);
  `class QcUpdateProvider extends Provider<UpdateInfo>` dengan opsi `{ serverUrl: string; publicKeyPem: string; installedVersion: string; arch: ReleaseArch; fetchImpl: typeof fetch; log: (message: string) => void; runtime: ... }` (bentuk `runtime` mengikuti konstruktor `Provider` hasil Task 1). `getLatestVersion()`: GET `${serverUrl}/api/desktop/app-manifest?arch=<arch>` (tanpa cookie/Bearer), melewatkan hasil ke `evaluateRelease`; `none` => `UpdateInfo` berversi terpasang (keputusan 4); `available` => `UpdateInfo` dengan `files[0].url = ${serverUrl}/api/desktop/app-file/<versi>/<nama>`, `sha512`, `size`, `releaseNotes` = changelog. `resolveFiles` mengembalikan URL yang sama.

- [ ] **Step 1: Tes (RED)**: `evaluateRelease`: tanda tangan benar/salah (pasangan kunci uji dibangkitkan di tes), versi sama/lebih rendah/`1.10.0` vs `1.9.0`, arch tanpa berkas, `schema` tak dikenal; provider dengan `fetchImpl` palsu: 404/JSON rusak/tanda tangan tak sah = `UpdateInfo` versi terpasang dan `log` dipanggil tanpa memuat string `github`; sah = URL `serverUrl` yang benar; manifest berisi nama berkas bergaris miring tak pernah menghasilkan URL.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/update scripts` -> FAIL.
- [ ] **Step 3: Implementasikan** ketiga modul + suntikan kunci (tanpa env = `null`; `--require-release-key` gagal bila kosong, pesan tanpa isi kunci).
- [ ] **Step 4:** tes -> PASS; `bun run --cwd desktop typecheck`.
- [ ] **Step 5: Commit** `feat(desktop): verifikasi rilis bertanda tangan dan provider pembaruan kustom`.

### Task 6: Pengendali pembaruan dan wiring aplikasi

**Files:**
- Create: `desktop/src/main/update/app-updater.ts`, `desktop/src/main/update/app-updater.test.ts`
- Modify: `desktop/src/main/index.ts` (dipasang setelah `bundles`/`catalog`, memakai `ipcHandle?.isInjecting()`), `desktop/src/main/smoke.ts` + `smoke.test.ts` + `desktop/scripts/verify-pack.ts` (laporan `--smoke` memuat `updater: true` bila `electron-updater` termuat; `verify-pack` menegaskannya)

**Interfaces:**
- Consumes: Task 5 (`QcUpdateProvider`, `RELEASE_PUBLIC_KEY_PEM`), `normalizeServerUrl` (`settings.ts`).
- Produces: `shouldRunAppUpdater(input: { isPackaged: boolean; smoke: boolean; smokeUi: boolean; serverUrl: string; publicKeyPem: string | null }): boolean`; `createAppUpdater(deps: { updater: AppUpdaterLike; dialog: { showMessageBox(options): Promise<{ response: number }> }; isBusy: () => boolean; now: () => number; setTimer: (fn, ms) => unknown; log: (m: string) => void })` -> `{ start(): void; checkNow(): Promise<void>; stop(): void }`, dengan `AppUpdaterLike` = subset `autoUpdater` yang dipakai (`checkForUpdates`, `downloadUpdate`, `quitAndInstall`, `on`, `autoDownload`, `autoInstallOnAppQuit`, `disableDifferentialDownload`).

- [ ] **Step 1: Tes (RED)** `app-updater.test.ts` dengan fake: `shouldRunAppUpdater` salah bila tak dikemas/smoke/serverUrl tak sah/kunci `null`; `start()` menunda cek pertama lalu mengulang tiap 6 jam; `autoDownload=false` dan `disableDifferentialDownload=true`; pembaruan sah menampilkan dialog dengan versi dan ringkasan changelog (dipotong), "Nanti" tidak menampilkan dialog lagi untuk versi yang sama pada sesi itu dan tidak mengunduh; "Perbarui sekarang" mengunduh lalu menawarkan restart; restart dan `quitAndInstall` DITUNDA saat `isBusy()` true (tetap `autoInstallOnAppQuit = true`); tak ada pembaruan = tanpa dialog; galat `checkForUpdates` tidak melempar keluar dan dicatat tanpa identitas repo.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/update/app-updater.test.ts src/main/smoke.test.ts` -> FAIL.
- [ ] **Step 3: Implementasikan** pengendali + wiring di `index.ts` (`autoUpdater.setFeedURL({ provider: 'custom', updateProvider: QcUpdateProvider, ...opsi })`; hanya saat `shouldRunAppUpdater`; interval mengikuti pola `setInterval(...).unref()` pada `runCheck`) dan tambahan smoke.
- [ ] **Step 4:** tes -> PASS; `bun run --cwd desktop typecheck`; `bun run --cwd desktop test` penuh.
- [ ] **Step 5: Commit** `feat(desktop): pembaruan otomatis (cek berkala, dialog, pasang saat keluar)`.

### Task 7: Pengemasan x64 + arm64

**Files:**
- Modify: `desktop/electron-builder.yml` (target `nsis` `arch: [x64, arm64]`, `artifactName: QC-App-Setup-${version}-${arch}.${ext}`, `publish: null`), `desktop/package.json` (`pack` menambah `--x64` agar pengemasan lokal tetap x64; `pack:all` dan `dist` tanpa perubahan arti), `desktop/scripts/verify-pack-args.test.ts` bila perlu

- [ ] **Step 1: Tes (RED)**: tes konfigurasi (vitest, `desktop/scripts/`): membaca `electron-builder.yml` (`Bun.YAML`/`yaml` yang sudah dipakai tes lain) dan menegaskan kedua arch, `artifactName` persis, `publish` kosong, dan skrip `pack` memuat `--x64`.
- [ ] **Step 2:** FAIL -> ubah konfigurasi -> PASS.
- [ ] **Step 3:** `bun run build:web && bun run --cwd desktop pack:all && bun run --cwd desktop verify-pack --arch x64` (pemeriksaan nyata; arm64 `--arch arm64` statis). Expected: hijau, `QC App.exe --smoke` melaporkan `updater: true`.
- [ ] **Step 4: Commit** `feat(desktop): installer NSIS x64 dan arm64 bernama tetap`.

### Task 8: Skrip rilis (identitas, kunci, manifest, publikasi Drive)

**Files:**
- Modify: `scripts/release-identity.ts` + `.test.ts` (parametrisasi komponen: masukan `component: 'server'|'desktop'`, env `COMPONENT`, regex `release/<component>-v(.+)`, hasil memuat `component`; perilaku server tak berubah), `scripts/gen-ui-signing-key.ts` (sufiks kunci menjadi parameter: skrip baru `scripts/gen-release-signing-key.ts` memanggilnya dengan `.release-signing-key.pem`), `.gitignore` (`*.release-signing-key.pem`)
- Create: `scripts/desktop-release.ts`, `scripts/desktop-release.test.ts`, `scripts/publish-desktop-release.ts` (pembungkus CLI tipis), `scripts/gen-release-signing-key.ts`

**Interfaces:**
- Consumes: Task 2; `signUiManifest`/`verifyUiManifest`/`normalizePublicKeyInput`; `BridgeClient`/`createGoogleClient` (`server/src/core/google/client.ts`).
- Produces (`scripts/desktop-release.ts`, murni kecuali yang menerima `client`):
  `buildReleaseManifest(input: { version: string; publishedAt: string; files: Array<{ name: string; arch: ReleaseArch; bytes: Uint8Array }> ; changelog: string }): { json: string; manifest: DesktopReleaseManifest }` (sha512 base64, kanonik);
  `signRelease(json: string, privateKeyFile: string, publicKey: string): string` (gagal bila pasangan tak cocok, kunci tak pernah masuk pesan galat);
  `publishRelease(client: BridgeClient, folderId: string, release: { version: string; files: Array<{ name: string; bytes: Uint8Array | Blob; mime: string }>; json: string; signature: string }): Promise<void>` (urutan: hapus `.sig` lama -> unggah installer -> `.json` -> `.sig` terakhir; timpa menurut nama = `listFolder({name})` + `deleteFile` + `uploadFile`; verifikasi MD5 dari Drive terhadap hash lokal);
  `withdrawRelease(client, folderId, version)` (hapus `.sig`); `pruneInstallers(client, folderId, keep = 10)` (per arsitektur; hanya installer).

- [ ] **Step 1: Tes (RED)**: identitas desktop (cabang `release/desktop-v1.2.3` lolos, `release/server-v1.2.3` ditolak untuk komponen desktop dan sebaliknya, versi `desktop/package.json` harus sama, perilaku server lama tetap hijau); `buildReleaseManifest` lolos `parseReleaseManifest`; `signRelease` menolak pasangan kunci salah dan tak membocorkan isi kunci pada galat; `publishRelease` dengan fake bridge: urutan unggah (`.sig` PALING AKHIR, `.sig` lama terhapus lebih dulu), idempoten bila diulang, gagal di tengah tidak meninggalkan `.sig` baru, MD5 tak cocok = galat; `pruneInstallers` mempertahankan 10 terbaru per arch menurut `compareVersions` (1.10.0 > 1.9.0) dan tak menyentuh `.json`/`.sig`; `withdrawRelease` menghapus hanya `.sig`.
- [ ] **Step 2:** `bun test scripts/desktop-release.test.ts scripts/release-identity.test.ts` -> FAIL.
- [ ] **Step 3: Implementasikan** modul + CLI (`publish-desktop-release.ts`: argumen `--version --dir --folder-id`; kunci SA dari BERKAS lewat `GOOGLE_SA_KEY_FILE`, kunci tanda tangan dari berkas; mengisi `GoogleSettings` minimal dengan `ALLOWED_FOLDER_IDS=[folderId]`).
- [ ] **Step 4:** tes -> PASS; `bunx biome check scripts`.
- [ ] **Step 5: Commit** `feat(rilis): skrip manifest, tanda tangan, dan publikasi rilis desktop`.

### Task 9: Workflow rilis desktop

**Files:**
- Create: `.github/workflows/sync-dev.yml` (workflow `workflow_call`: input `sha`, `version`, `komponen`; isi = job `sync-dev` yang kini ada di `release.yml`, pesan merge memuat komponen), `.github/workflows/release-desktop.yml`
- Modify: `.github/workflows/release.yml` (job `sync-dev` memanggil `./.github/workflows/sync-dev.yml`), `scripts/ci-workflows.test.ts` (tes `sync-dev` pindah ke blok `sync-dev.yml`; blok baru `release-desktop.yml`; tes `release.yml` yang menyebut isi job `sync-dev` disesuaikan)

**Interfaces:**
- Consumes: `scripts/release-identity.ts` (Task 8), `bun run changelog extract desktop <versi>`, `scripts/desktop-release.ts` (Task 8), `ci.yml` (`ref`, `desktop-check: true`).
- Produces: workflow `release-desktop.yml`: pemicu `pull_request_target` (closed, `main`) + `workflow_dispatch` (input `versi` untuk pemulihan; input `tarik` bernilai versi untuk penarikan, memanggil `withdrawRelease`); job `meta` (pola `release.yml`: cabang `release/desktop-v*`, baca `desktop/package.json` pada commit merge; PR lain dilewati), `ci` (`ci.yml` pada SHA merge, `desktop-check: true`), `build` (windows-latest, environment `desktop-release`, `bun run build:desktop` dengan `UI_PUBLIC_KEY_PEM`, `DESKTOP_RELEASE_PUBLIC_KEY_PEM`; `verify-pack` x64; hitung hash, tulis dan tandatangani `release-<v>.json`; unggah artefak ke job berikut), `publish` (ubuntu, `contents: write`: tag `desktop-vX.Y.Z` + GitHub Release privat/arsip berisi installer dan changelog, unggah ke Drive lewat `publish-desktop-release.ts`, `pruneInstallers`), `sync-dev` (memanggil `sync-dev.yml`). Concurrency grup `release-desktop`, tanpa membatalkan.

- [ ] **Step 1: Tes (RED)** di `ci-workflows.test.ts` untuk `release-desktop.yml`: pemicu dan cabang; `meta` melewati PR bukan-desktop; urutan job `meta -> ci -> build -> publish -> sync-dev`; `contents: write` HANYA `publish`; environment `desktop-release` pada `build` dan `publish`; secret hanya `DESKTOP_RELEASE_SIGNING_KEY` (build) dan `DESKTOP_DRIVE_PUBLISHER_KEY` + `GITHUB_TOKEN` (publish); tanpa `${{ }}` di `run`; aksi dipatok SHA; checkout hanya SHA merge hasil `meta`; kunci ditulis ke berkas sementara dan dihapus `if: always()`; unggah Drive SETELAH tag/Release tidak boleh membuat Release tanpa unggahan sukses (urutan: unggah Drive dulu, lalu tag + Release); `ci` memakai `desktop-check: true`; untuk `sync-dev.yml`: semua tes `sync-dev` lama (deploy key, host key dipatok, konflik = peringatan) kini menunjuk berkas ini, dan `release.yml` hanya memanggilnya.
- [ ] **Step 2:** `bun test scripts/ci-workflows.test.ts` -> FAIL.
- [ ] **Step 3: Implementasikan** kedua workflow dan ubah `release.yml`; `bash -n` pada setiap langkah `run` kedua workflow (ekstrak dari YAML dengan `Bun.YAML.parse`); `bunx biome check .github scripts`.
- [ ] **Step 4:** `bun test scripts/ci-workflows.test.ts` -> PASS; `bun run scripts/test-scripts.ts`.
- [ ] **Step 5: Commit** `feat(ci): workflow rilis desktop dan sync-dev bersama`.

### Task 10: Dokumentasi, fragmen, dan checklist

**Files:**
- Create: `docs/desktop-release-signing.md` (kunci rilis, environment `desktop-release`, SA penerbit, folder Drive, variable/secret, langkah pemilik, rotasi), `server/changelog.d/20261118-rilis-desktop-penyajian.md` dan `desktop/changelog.d/20261118-pembaruan-otomatis.md` (baris pertama `jenis: ditambah`, satu paragraf untuk pengguna)
- Modify: `docs/ci-cd.md` (alur rilis desktop, penarikan, retensi), `docs/setup-google.md` (SA penerbit + folder), `CLAUDE.md` (ringkas: rilis desktop, rute `app-manifest`/`app-file`, kunci rilis; hapus kalimat "belum ada pembaruan biner"), `docs/e2e-checklist-desktop.md` (uji perangkat nyata: pasang versi N, rilis N+1, dialog, pembaruan senyap x64 dan arm64, "Nanti", penarikan, SmartScreen, repo dijadikan privat tetap berfungsi), `docs/superpowers/specs/2026-11-17-rilis-desktop-auto-update-design.md` (status: disetujui; 5.2 tata letak datar menurut keputusan perancang 1; 5.4/5.6 sesuai nama berkas; catat keputusan perancang 2-4)

- [ ] **Step 1:** tulis dokumen dan fragmen; `bun run changelog validate server && bun run changelog validate desktop`.
- [ ] **Step 2: Suite penuh**: `bun run check` (butuh tunnel). Expected: hijau.
- [ ] **Step 3: Commit** `docs(rilis): dokumentasi rilis desktop, fragmen changelog, dan checklist`.

---

## Di luar rencana ini

Rilis pertama `1.0.0` (PR `release/desktop-v1.0.0`), pembuatan kunci/SA/folder/environment oleh pemilik (`docs/desktop-release-signing.md`), uji nyata pembaruan di perangkat Windows x64 dan arm64, Authenticode, halaman unduh dan daftar versi di web (bagian 5; memakai `release-<v>.json` yang sama).
