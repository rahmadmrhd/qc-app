# QC App Desktop + Country Lock: Rencana Implementasi Fase 0–1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikasi desktop "QC App" (Electron) yang memuat UI web QC dan menjalankan Country Lock mode tunggal (ping, baca info, inject skrip lewat SSH) secara offline, dengan paket dibaca dari folder lokal dan hasil inject disimpan di antrean lokal yang tahan crash.

**Architecture:** Logika murni Country Lock di workspace baru `countrylock/` (netral runtime, dites Bun). Proses utama Electron di workspace baru `desktop/` (SSH, ping, SQLite, protokol `app://` dan `qc://`, dites di Node). UI tetap satu: halaman Country Lock ditambahkan ke `web/` dan memakai jembatan `window.qcBridge` bila berjalan di desktop. Spike risiko (paket installer dan perangkat nyata) berada di depan pekerjaan yang bergantung padanya.

**Tech Stack:** Bun (alat kerja), Electron 45.0.0 (Node 24.x), TypeScript strict, ssh2, `node:sqlite`, electron-builder (NSIS win-x64), vitest, zod, React + TanStack (web yang ada).

**Spec:** `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` (rujukan perilaku lama: `docs/superpowers/specs/2026-11-06-countrylock-legacy-behavior.md`).

**Di luar rencana ini (rencana terpisah, menunggu Task 24–25 migrasi dan hasil spike):** Fase 2 (modul server paket, editor Monaco, unduhan paket/UI bertanda tangan, sinkron router `.rsc`/`/temp`, katalog Tipe offline, login Bearer, field `firmware` pada item), Fase 3 Multi-Device, Fase 4 OCR, Fase 5 unggah hasil, dan tombol Terminal manual ke router jump (bentuknya diserahkan ke builder oleh spek §6.8; ditunda ke rencana Fase 2). **Keadaan akhir Fase 1 yang jujur:** desktop hanya mengaktifkan Country Lock (paket dari folder lokal, firmware dipilih manual karena katalog Tipe belum ada); rute web lain di desktop menampilkan pemberitahuan "login desktop tersedia di rilis berikutnya"; tombol unggah dinonaktifkan. Fase 1 tidak boleh dinilai terhadap tujuan "seluruh web dengan login" (G1 penuh tercapai di Fase 2).

## Global Constraints

- Electron **45.0.0** (terbit 2026-10-21, ≥ 14 hari; membawa Node 24.x). Naikkan ke patch 45.x hanya bila sudah berumur ≥ 14 hari. Windows 10/11 **x64** saja; installer NSIS, pemasangan per pengguna tanpa hak admin.
- Pin dependensi baru ≥ 14 hari: `electron-builder` 26.18.0, `ssh2` 1.17.0, `@types/ssh2` ^1.15.0, `@types/node` ^24, `vitest` ^5.0.3, `zod` ^4.6.5 (versi vitest dan zod sama dengan `web/package.json`).
- `contextIsolation` aktif, `nodeIntegration` mati; renderer hanya memuat aset lokal lewat `app://`; jembatan lewat `contextBridge` dengan argumen divalidasi zod.
- Placeholder skrip tepat tujuh: `{ipTarget} {usernameTarget} {passwordTarget} {ipServer} {usernameServer} {passwordServer} {sshKey}`; `{ipServer}` dari konfigurasi (fallback `server.ip`), `{sshKey}` dari host key router saat jabat tangan SSH (tidak ada peta `sshKeys`).
- Timeout inject: koneksi 10 dtk, per baris 2 menit, total 5 menit. Ping ICMP 1000 ms; interval berikutnya 800 ms (sukses), 500 ms (host tak terjangkau dan galat), 200 ms (timeout/status lain).
- Eksekusi inject lewat shell interaktif satu baris per kiriman dengan penanda; koneksi putus **setelah ada output** dianggap sukses (perilaku lama); kata sandi disamarkan di log dan di progres.
- Router jump selalu diperlakukan sebagai Mikrotik (sintaks RouterOS), apa pun merk target.
- Serial = kunci idempotensi, dinormalisasi `trim` + huruf besar; dicatat **sesudah inject sukses**; serial yang sudah tercatat tidak di-auto-inject lagi.
- Country Lock tidak memerlukan login maupun server; tidak ada kredensial produksi di repo atau installer; fixture hanya dari berkas pemilik (`~/Desktop/Country Lock2`), tanpa `AF5XHD - Copy.txt`, `plink.exe`, `putty.exe`.
- Kode: Biome (kutip tunggal, titik koma, lebar 100), TypeScript `strict` + `noUncheckedIndexedAccess`; tes `countrylock/` memakai `bun:test`, tes `desktop/` memakai vitest di Node (bukan `bun test`: runtime tes harus sama dengan runtime yang dikirim), tes `web/` memakai vitest + jsdom.
- Verifikasi per langkah memakai perintah berskup (`bun run --cwd <workspace> test`, `... typecheck`). `bun run check` (butuh tunnel DB) hanya di titik commit akhir tiap fase.
- Berkas di `shared/` tidak disentuh (build GAS menyapu seluruh `shared/**/*.ts`; lihat spek §3.1). `bun run build:gas` harus tetap lolos di akhir.
- Langkah "Commit" dijalankan **hanya bila pemilik mengizinkan commit** pada sesi eksekusi; tanpa izin, lewati dan lanjutkan.

## Review Focus

Masukan yang tersirat spek tetapi tidak dilatih tes task mana pun secara bawaan; tiap baris sudah punya tes di task pemiliknya.

1. Kata sandi/nilai berisi `"`, `$`, spasi, atau `{`: skrip Mikrotik (nilai di dalam `"..."` vs tanpa kutip) dan Ubiquiti (shell tanpa kutip) tidak boleh rusak atau terkutip ganda → T1.
2. Koneksi putus segera setelah baris pertama: perilaku lama menganggapnya sukses (risiko sukses palsu); diikat tes pada kedua kebijakan putus → T7.
3. `ping.exe` Windows berkode keluar 0 walau "Destination host unreachable", dan keluarannya berbahasa lokal (mis. "Balasan dari"): sukses hanya bila `TTL=` ada → T10.
4. Peluncuran pertama tanpa paket (folder belum diatur/rusak): halaman Country Lock menampilkan keadaan "belum ada paket" dan tidak crash → T11, T17.
5. `config.QC` tanpa node `mikrotik` (hanya Ubiquiti) atau dengan `sshKeys` rusak dan kunci tak dikenal (`manualCredentialInput`): tetap terurai dan kunci tak dikenal tetap ada → T2.

---

## FASE 0: Fondasi dan spike

### Task 1: Workspace `countrylock/` + render skrip (paritas emas)

**Files:**
- Create: `countrylock/package.json` (`@qc/countrylock`, scripts `test: bun test`, `typecheck: tsc -p tsconfig.json`), `countrylock/tsconfig.json` (extends `../tsconfig.base.json`, `types: ["bun"]`), `countrylock/src/script-template.ts`, `countrylock/src/script-template.test.ts`, `countrylock/test-support/legacy-oracle.ts`
- Create (fixture): `countrylock/fixtures/country-lock2/{config.QC,MIKROTIK/*.txt,UBIQUITI/*.txt}` disalin dari `C:\Users\Rahmad Maulana\Desktop\Country Lock2` kecuali `AF5XHD - Copy.txt`, `plink.exe`, `putty.exe`
- Modify: `package.json` (root; tambah `"countrylock"` dan `"desktop"` ke `workspaces`; tambah ke skrip `typecheck` dan `test`), `tsconfig.json` (root; `paths` `@countrylock/*` → `./countrylock/src/*`), `web/tsconfig.json` dan `web/vite.config.ts` (alias `@countrylock`), `.gitignore` (`desktop/dist/`, `desktop/dist-app/`)

**Interfaces:**
- Produces: `type Brand = 'mikrotik' | 'ubiquiti'`; `interface ScriptValues` (tujuh kunci string); `function renderScript(raw: string, values: Partial<ScriptValues>, brand: Brand): string`; `class ScriptRenderError extends Error { code: 'UNSAFE_BARE_VALUE' }`; `const PLACEHOLDERS: readonly (keyof ScriptValues)[]`. Oracle uji: `legacyRender(raw, values): string` (replace literal berurutan, nilai null → string kosong, persis `ScriptTemplate.Render` lama).

- [ ] **Step 1: Tes gagal.** `script-template.test.ts`: (a) `test('paritas emas: 17 skrip nyata dirender sama dengan oracle lama untuk nilai aman')` dengan nilai `ipTarget 192.168.88.1, usernameTarget admin, passwordTarget pw123, ipServer 192.168.1.1, usernameServer admin, passwordServer srvpw, sshKey AAAAB3Nza+/=` → `renderScript(raw, v, brand)` `toBe` `legacyRender(raw, v)` untuk tiap fixture (merk dari folder); (b) `test('mikrotik: nilai berisi " $ dan ? di dalam kutip di-escape')` dengan `passwordTarget = 'a"b$c?d\\e'` pada `user="{usernameTarget}" password="{passwordTarget}"` menghasilkan `password="a\\"b\\$c\\?d\\\\e"`; (c) `test('mikrotik: nilai tak aman tanpa kutip melempar UNSAFE_BARE_VALUE')` (`{usernameTarget}` berisi spasi pada `user={usernameTarget}`); (d) `test('ubiquiti: nilai aman tak berubah, nilai tak aman tanpa kutip dibungkus kutip tunggal')` (`{usernameServer}@{ipServer}` dengan `usernameServer = "a b"` → `'a b'@192.168.1.1`); (e) `test('placeholder tak dikenal dibiarkan, nilai undefined menjadi string kosong')`.
- [ ] **Step 2:** `bun run --cwd countrylock test` → gagal ("renderScript tidak terdefinisi"). Sebelumnya salin fixture dan jalankan `bun install` di root.
- [ ] **Step 3: Implementasi `renderScript` di `countrylock/src/script-template.ts`.** Pindai per baris sambil melacak keadaan kutip ganda (backslash melepas karakter berikutnya). Nilai "aman" = cocok `/^[A-Za-z0-9._@:\/+=-]*$/` → disisipkan apa adanya (menjamin paritas). Tak aman: Mikrotik di dalam kutip → escape `\ " $ ?` dengan backslash, tanpa kutip → lempar `ScriptRenderError('UNSAFE_BARE_VALUE')`; Ubiquiti di dalam kutip ganda → escape `\ " $ \``, tanpa kutip → bungkus kutip tunggal (`'` → `'\''`). Tulis juga `legacy-oracle.ts`.
- [ ] **Step 4:** `bun run --cwd countrylock test` dan `bun run --cwd countrylock typecheck` → lulus; `bun run build:gas` tetap lulus.
- [ ] **Step 5: Commit** — `git add countrylock package.json tsconfig.json web/tsconfig.json web/vite.config.ts .gitignore bun.lock` ; `git commit -m "feat(countrylock): workspace countrylock + render skrip dengan paritas emas"`

### Task 2: Parser `config.QC`

**Files:**
- Create: `countrylock/src/config.ts`, `countrylock/src/config.test.ts`

**Interfaces:**
- Consumes: `Brand` (T1).
- Produces: `interface FirmwareEntry { code: string; label: string; file: string }`; `interface ModeConfig { ip: string; ipServer: string; connectVia: 'Target' | 'Server'; interfaceBridge: string }`; `interface ServerConfig { ip: string; username: string; password: string; interfaceComp: string; interfaceList: string[]; interfaceBridge: string }`; `interface BrandConfig { brand: Brand; label: string; folder: string; username: string; password: string; web: string; firmware: FirmwareEntry[]; single: ModeConfig; multi: ModeConfig }`; `interface CountryLockConfig { server: ServerConfig; brands: Partial<Record<Brand, BrandConfig>>; raw: unknown }`; `function parseConfig(json: string): { config: CountryLockConfig; warnings: string[] }`; `class ConfigError extends Error`; `function bridgeInterfaces(server: ServerConfig): string[]`.

- [ ] **Step 1: Tes gagal.** `config.test.ts`: `test('config.QC nyata terurai: 9 firmware Ubiquiti, 8 Mikrotik, server.ip 192.168.88.2')`; `test('sshKeys diabaikan dengan peringatan dan kunci tak dikenal manualCredentialInput tetap ada di raw')`; `test('tanpa node mikrotik tetap terurai dan brands.mikrotik tak ada')`; `test('server.ip kosong melempar ConfigError')`; `test('multi jatuh ke single bila kosong; ipServer ke server.ip; interfaceBridge ke server lalu "bridge1"')`; `test('bridgeInterfaces membuang interfaceComp dan duplikat')` (`['ether1','ether2','ether3']` dengan comp `ether5` → tiga item; comp `ether1` → `['ether2','ether3']`); `test('JSON rusak melempar ConfigError')`.
- [ ] **Step 2:** `bun run --cwd countrylock test src/config.test.ts` → gagal.
- [ ] **Step 3: Implementasi `parseConfig` di `countrylock/src/config.ts`.** Parser tulisan tangan yang toleran (bukan zod): baca `server`, `mikrotik`, `ubiquiti`, `version` diabaikan; `firmware` objek kode → `{label (bawaan = kode), file}`; `mode.single`/`mode.multi` dengan aturan fallback di atas; `interfaceList` boleh array atau string koma. Hanya `server.ip` yang wajib; node merk yang tak ada dilewati; `raw` = objek hasil `JSON.parse` utuh.
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add countrylock/src/config.ts countrylock/src/config.test.ts` ; `git commit -m "feat(countrylock): parser config.QC toleran dengan fallback mode"`

### Task 3: Parser keluaran perangkat + peta negara Ubiquiti

**Files:**
- Create: `countrylock/src/device-info.ts`, `countrylock/src/ubnt-countries.ts`, `countrylock/src/device-info.test.ts`

**Interfaces:**
- Produces: `interface DeviceInfo { model: string; serial: string; country: string }`; `function parseMikrotikRouterboard(out: string): { serial: string; model: string }`; `function parseMikrotikCountry(out: string): string`; `function parseUbiquitiBoardInfo(out: string): { serial: string; model: string }`; `function parseUbiquitiCountry(out: string): string`; `function parseUbiquitiSerialLine(out: string): string` (keluaran `grep board.hwaddr`); `function isPermissionDenied(message: string): boolean`; `const UBNT_COUNTRIES: Readonly<Record<number, string>>` (disalin dari lampiran inventaris §2.3).

- [ ] **Step 1: Tes gagal.** `device-info.test.ts`: `test('mikrotik: serial huruf besar dan model dipotong di spasi pertama')` (masukan `serial-number: abc123 \n model: hAP ac2`, hasil `ABC123` dan `hAP`); `test('mikrotik: country= diambil sampai ";" setelah spasi dibuang')` (`country=indonesia;` → `indonesia`; tanpa wlan1 → `''`); `test('ubiquiti: board.hwaddr huruf besar, model dari board.name bila board.model tak ada, "-" menjadi spasi')`; `test('ubiquiti: countrycode=360 → Indonesia, kode asing → Unknown, teks bukan angka → string kosong tanpa melempar')`; `test('UBNT_COUNTRIES memuat 360 Indonesia dan 511 Compliance Test')`; `test('isPermissionDenied: "Permission denied" atau "username" tak peka huruf')`.
- [ ] **Step 2:** `bun run --cwd countrylock test src/device-info.test.ts` → gagal.
- [ ] **Step 3: Implementasi** mengikuti aturan lampiran inventaris §2.2 (`Getbetween`: teks setelah awalan sampai kemunculan pertama akhir, di-trim; tanpa akhir → sisa teks; tanpa awalan → kosong). Satu implementasi saja (bukan empat salinan seperti aplikasi lama). Daftar negara disalin verbatim.
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add countrylock/src && git commit -m "feat(countrylock): parser info perangkat dan peta negara Ubiquiti"`

### Task 4: Rencana inject, interval ping, rotasi bridge

**Files:**
- Create: `countrylock/src/inject-plan.ts`, `countrylock/src/inject-plan.test.ts`

**Interfaces:**
- Consumes: `CountryLockConfig`, `BrandConfig` (T2); `renderScript`, `Brand` (T1).
- Produces: `interface ConnectTarget { host: string; username: string; password: string }`; `interface InjectPlan { connect: ConnectTarget; script: string; scriptKey: string }`; `class PlanError extends Error { code: 'FIRMWARE_UNKNOWN' | 'SCRIPT_MISSING' | 'BRAND_MISSING' }`; `function scriptKey(brand: BrandConfig, file: string): string` (`${folder}/${file}`); `function planInject(input: { config: CountryLockConfig; brand: Brand; mode: 'single' | 'multi'; firmwareCode: string; scripts: ReadonlyMap<string, string>; target: { ip: string; username: string; password: string }; sshKey: string }): InjectPlan`; `type PingKind = 'success' | 'unreachable' | 'timeout' | 'error'`; `function nextPingDelayMs(kind: PingKind): number`; `function nextBridgeIndex(current: number, interfaceCount: number, injectSucceeded: boolean): number`.

- [ ] **Step 1: Tes gagal.** `inject-plan.test.ts` (fixture T1 sebagai paket): `test('mikrotik single AC: connectVia Server → sambung ke server.ip dengan kredensial server; skrip memuat address=192.168.88.1')`; `test('ubiquiti single WA: connectVia Target → sambung ke IP target; skrip memuat "192.168.1.1 ssh-rsa" dan kunci')`; `test('multi mengabaikan connectVia: selalu ke IP target')`; `test('firmware tak dikenal melempar FIRMWARE_UNKNOWN; skrip tak ada di peta melempar SCRIPT_MISSING; merk tanpa node melempar BRAND_MISSING')`; `test('nextPingDelayMs: success 800, unreachable 500, error 500, timeout 200')`; `test('nextBridgeIndex: naik hanya bila sukses, kembali ke 0 setelah indeks terakhir, tetap saat gagal')`.
- [ ] **Step 2:** `bun run --cwd countrylock test src/inject-plan.test.ts` → gagal.
- [ ] **Step 3: Implementasi.** Mode `single` + `connectVia === 'Server'` → `connect = {server.ip, server.username, server.password}`; selain itu `connect = target`. `ipServer` dari `brand.<mode>.ipServer`. Skrip dirender dengan `renderScript` untuk merk tersebut.
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add countrylock/src && git commit -m "feat(countrylock): rencana inject, kebijakan ping, rotasi bridge"`

### Task 5: Aturan antrean pending

**Files:**
- Create: `countrylock/src/pending.ts`, `countrylock/src/pending.test.ts`

**Interfaces:**
- Consumes: `Brand` (T1).
- Produces: `interface PendingEntry { serial: string; brand: Brand | 'none'; tipe: string; date: string; timestamp: string; reinjectedAt?: string }`; `type AddResult = 'success' | 'duplicated'`; `function normalizeSerial(raw: string): string` (trim + huruf besar, hanya itu); `function addPending(list: readonly PendingEntry[], entry: PendingEntry): { list: PendingEntry[]; result: AddResult }`; `function isRegistered(list: readonly PendingEntry[], serial: string): boolean`.

- [ ] **Step 1: Tes gagal.** `pending.test.ts`: `test('normalizeSerial: trim dan huruf besar; format bertitik dua tidak digabung dengan tanpa titik dua')` (`' 58d61f '` → `58D61F`; `58:D6` ≠ `58D6`); `test('serial baru ditambahkan dengan result success')`; `test('serial ganda tidak menimpa entri pertama, menambah reinjectedAt, result duplicated, panjang daftar tetap')`; `test('isRegistered memakai serial ternormalisasi')`.
- [ ] **Step 2:** `bun run --cwd countrylock test src/pending.test.ts` → gagal.
- [ ] **Step 3: Implementasi** fungsi murni di atas (daftar tidak dimutasi).
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add countrylock/src && git commit -m "feat(countrylock): aturan antrean pending dan normalisasi serial"`

### Task 6: Workspace `desktop/` + spike pengemasan (installer NSIS dan smoke)

**Files:**
- Create: `desktop/package.json` (`@qc/desktop`, `main: dist/main/index.js`, dependensi `ssh2` 1.17.0, dev: `electron` 45.0.0, `electron-builder` 26.18.0, `@types/ssh2`, `@types/node`, `vitest`, `zod`; skrip `build`, `pack`, `dist`, `verify-pack`, `spike`, `test: vitest run`, `typecheck`), `desktop/tsconfig.json`, `desktop/vitest.config.ts` (environment `node`), `desktop/electron-builder.yml` (win x64, `nsis` `oneClick: false`, `perMachine: false`, `extraResources` dari `../server/dist` ke `ui-baseline`), `desktop/scripts/build.ts` (bundel proses utama dan preload dengan `Bun.build`, target node, `external: ['electron', 'ssh2']`), `desktop/src/main/smoke.ts`, `desktop/scripts/verify-pack.ts`, `docs/superpowers/spikes/2026-11-desktop-packaging.md`

**Interfaces:**
- Produces: eksekutabel hasil kemas menerima argumen `--smoke` dan mencetak satu baris JSON `{ node: string, electron: string, ssh2: boolean, sqlite: boolean }` lalu keluar 0; `verify-pack.ts` menjalankannya dan gagal bila `node` tidak diawali `24.`, atau `ssh2`/`sqlite` bernilai false.

- [ ] **Step 1: Tes gagal.** `desktop/src/main/smoke.test.ts`: `test('collectSmokeReport mengembalikan versi node/electron dan memuat ssh2 serta node:sqlite')` memanggil `collectSmokeReport(): Promise<SmokeReport>` (ekspor `smoke.ts`; di Node uji hasilnya `ssh2 === true` dan `sqlite === true`).
- [ ] **Step 2:** `bun install` di root, lalu `bun run --cwd desktop test` → gagal.
- [ ] **Step 3: Implementasi `collectSmokeReport`, `scripts/build.ts`, `electron-builder.yml`.** Kemas dengan `bun run --cwd desktop pack` (`electron-builder --dir`), UI baseline dari `bun run build:web`. Catat hasil, ukuran, dan masalah hoisting monorepo di dokumen spike.
- [ ] **Step 4:** `bun run --cwd desktop test` lulus; `bun run --cwd desktop pack` menghasilkan `desktop/dist-app/win-unpacked/QC App.exe`; `bun run --cwd desktop verify-pack` mencetak JSON yang lolos. Bila `node:sqlite` tidak tersedia di Electron, catat di dokumen spike dan **berhenti untuk keputusan** (alternatif: `better-sqlite3` dengan `electron-rebuild`; Task 12 mengikuti).
- [ ] **Step 5: Commit** — `git add desktop docs/superpowers/spikes bun.lock && git commit -m "feat(desktop): workspace desktop dan spike pengemasan NSIS"`

### Task 7: Eksekutor inject SSH + server SSH palsu

**Files:**
- Create: `desktop/src/main/ssh/inject-session.ts`, `desktop/src/main/ssh/strategy.ts`, `desktop/src/main/ssh/inject-session.test.ts`, `desktop/test-support/fake-ssh-server.ts`

**Interfaces:**
- Consumes: `ssh2` (`Client`, `Server`).
- Produces: `type SentinelStrategy = 'echo' | 'put'`; `type DropPolicy = 'legacy' | 'last-line-only'`; `type InjectStage = 'connecting' | 'sending' | 'running' | 'completed' | 'failed' | 'cancelled'`; `interface InjectProgress { stage: InjectStage; message: string }`; `interface InjectOptions { host: string; username: string; password: string; script: string; sentinel: SentinelStrategy; dropPolicy?: DropPolicy; secrets?: readonly string[]; timeouts?: Partial<{ connectMs: number; perLineMs: number; overallMs: number }>; onProgress(p: InjectProgress): void; signal?: AbortSignal }`; `function runInject(opts: InjectOptions): Promise<boolean>` (tidak pernah melempar untuk pembatalan); `function sentinelCommand(strategy: SentinelStrategy, token: string): string` (`echo <t>` atau `:put <t>`); `function maskSecrets(text: string, secrets: readonly string[]): string` (ganti `****`); `const SENTINEL_BY_BRAND: Record<Brand, SentinelStrategy>` di `strategy.ts` (`mikrotik: 'put'`, `ubiquiti: 'echo'`, ditandai "menunggu hasil spike T9"); fake server: `startFakeSshServer(opts: { username: string; password: string; shell: 'busybox' | 'routeros'; onLine?(line: string): void; dropAfterLine?: number }): Promise<{ port: number; hostKeyBase64: string; close(): Promise<void> }>` (`busybox` menjalankan `echo`; `routeros` menolak `echo` dengan galat "bad command name" dan menjalankan `:put`).

- [ ] **Step 1: Tes gagal.** `inject-session.test.ts` (vitest Node, server palsu): `test('baris dikirim satu per satu; baris berikutnya hanya setelah penanda muncul dua kali')` (urutan `onLine` tak pernah mendahului penyelesaian baris sebelumnya); `test('busybox + echo: skrip tiga baris selesai true dan tahap completed')`; `test('routeros + echo gagal timeout per baris; routeros + put selesai')` (dengan `perLineMs` kecil); `test('baris kosong dilewati')`; `test('perLineMs habis → false dan tahap failed')`; `test('legacy: koneksi putus setelah ada output → true; putus tanpa output → false')`; `test('last-line-only: putus pada baris sebelum terakhir → false; putus pada baris terakhir → true')`; `test('signal abort → false, tahap cancelled, tanpa pengecualian lolos')`; `test('kata sandi tidak muncul di pesan progres (maskSecrets)')`.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/ssh` → gagal.
- [ ] **Step 3: Implementasi `runInject` di `inject-session.ts`.** `ssh2.Client.shell` dengan pty 200×50; per baris tulis baris lalu `sentinelCommand(...)`, tunggu token muncul dua kali (kemunculan pertama = echo ketikan); baca setiap 100 ms; tanpa dekode ANSI. Kebijakan putus mengikuti `dropPolicy` (bawaan `legacy`). Token acak `__QC_INJECT_<8 hex>__`. `AbortSignal` diperiksa tiap iterasi tanpa meneruskannya ke promise yang bisa melempar ke luar. Tulis `fake-ssh-server.ts` dengan `ssh2.Server` dan kunci host RSA dibuat di tes.
- [ ] **Step 4:** `bun run --cwd desktop test src/main/ssh` lulus; `bun run --cwd desktop typecheck`.
- [ ] **Step 5: Commit** — `git add desktop && git commit -m "feat(desktop): eksekutor inject SSH dengan strategi penanda dan server palsu"`

### Task 8: Pengambilan host key router

**Files:**
- Create: `desktop/src/main/ssh/host-key.ts`, `desktop/src/main/ssh/host-key.test.ts`

**Interfaces:**
- Consumes: `startFakeSshServer` (T7).
- Produces: `interface HostKey { type: string; base64: string }`; `function fetchHostKey(opts: { host: string; port?: number; username: string; password: string; timeoutMs?: number }): Promise<HostKey>`; `class HostKeyError extends Error { code: 'NOT_RSA' | 'UNREACHABLE' | 'AUTH' }`.

- [ ] **Step 1: Tes gagal.** `host-key.test.ts`: `test('mengembalikan ssh-rsa dan base64 yang sama dengan kunci server palsu')` (cocok `hostKeyBase64` dari T7; panjang blob RSA konsisten); `test('kunci non-RSA melempar NOT_RSA')` (server palsu berkunci ed25519); `test('host tak terjangkau melempar UNREACHABLE dalam timeout')`; `test('kredensial salah melempar AUTH')`.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/ssh/host-key.test.ts` → gagal.
- [ ] **Step 3: Implementasi** memakai `hostVerifier` ssh2 untuk menangkap blob kunci (base64 blob = isi `known_hosts` dropbear: `<ip> ssh-rsa <base64>`), memutus sambungan setelah jabat tangan.
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add desktop && git commit -m "feat(desktop): ambil host key router untuk placeholder sshKey"`

### Task 9: Harness spike perangkat nyata + gerbang (dijalankan pemilik)

**Files:**
- Create: `desktop/spike/hardware-spike.ts`, `desktop/spike/hardware-spike.test.ts`, `docs/superpowers/spikes/2026-11-hardware-spike.md`

**Interfaces:**
- Consumes: `runInject`, `SentinelStrategy` (T7), `fetchHostKey` (T8).
- Produces: CLI `bun run --cwd desktop spike -- --router <ip> --router-user <u> [--ubnt <ip> --ubnt-user <u>]` (kata sandi dari variabel lingkungan `SPIKE_ROUTER_PASSWORD`, `SPIKE_UBNT_PASSWORD`, tidak pernah dari argumen) yang menulis `spike-report-<tanggal>.json` tanpa kata sandi; `function runChecks(env: SpikeEnv): Promise<SpikeReport>` dan `interface SpikeReport { router: { sentinelEcho: 'ok' | 'timeout' | 'error'; sentinelPut: 'ok' | 'timeout' | 'error'; sftpPut: boolean; sftpRename: boolean; sftpStat: boolean; hostKeyType: string; importBlocked: boolean | 'unknown'; deviceMode: string }; ubiquiti?: { sentinelEcho: 'ok' | 'timeout' | 'error'; scpFromRouter: boolean } }`.

- [ ] **Step 1: Tes gagal.** `hardware-spike.test.ts` (server palsu `routeros`): `test('runChecks melaporkan sentinelEcho timeout dan sentinelPut ok pada router berperilaku RouterOS')`; `test('laporan tidak memuat kata sandi')`.
- [ ] **Step 2:** `bun run --cwd desktop test spike` → gagal.
- [ ] **Step 3: Implementasi harness.** Cek: penanda `echo` vs `:put` di router; SFTP `put`, `rename`, `stat` pada `/temp/` memakai berkas uji 1 KB bernama `qc-spike.tmp` yang dihapus kembali; jenis host key; `/system device-mode print` untuk melihat apakah `:import` dibatasi, lalu `/import` skrip `.rsc` kosong bernama `qc-spike.rsc`; pada Ubiquiti: penanda `echo` dan `scp` dari router. Semua tulis-uji dibersihkan. Tulis lembar hasil kosong di dokumen spike untuk ditempel pemilik.
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add desktop docs/superpowers/spikes && git commit -m "feat(desktop): harness spike perangkat nyata"`
- [ ] **Step 6: GERBANG (manual, pemilik).** Pemilik menjalankan CLI pada router jump dan satu perangkat Ubiquiti nyata, menempelkan laporan ke dokumen spike. Jika `sentinelPut` ≠ `ok`, atau `sftpPut`/`sftpRename` gagal, atau `importBlocked === true`: **berhenti dan perbarui spek** dengan persetujuan pemilik sebelum Task 18. Jika lolos, ubah `SENTINEL_BY_BRAND` sesuai hasil.

---

## FASE 1: Shell desktop dan Country Lock mode tunggal

### Task 10: Layanan ping dan baca info perangkat

**Files:**
- Create: `desktop/src/main/device/ping.ts`, `desktop/src/main/device/info.ts`, `desktop/src/main/device/ping.test.ts`, `desktop/src/main/device/info.test.ts`

**Interfaces:**
- Consumes: `parse*`, `isPermissionDenied`, `DeviceInfo`, `PingKind` dari `@countrylock/*` (T3, T4); `startFakeSshServer` (T7).
- Produces: `function pingOnce(host: string, timeoutMs: number, run?: (host: string, timeoutMs: number) => Promise<string>): Promise<{ ok: boolean; kind: PingKind }>`; `function readDeviceInfo(brand: Brand, conn: ConnectTarget): Promise<{ ok: true; info: DeviceInfo } | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' }>`; `function readSerial(brand: Brand, conn: ConnectTarget): Promise<string>`; `function readRouterInfo(conn: ConnectTarget): Promise<{ ok: true; serial: string; model: string } | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' }>` (selalu sintaks Mikrotik).

- [ ] **Step 1: Tes gagal.** `ping.test.ts`: `test('TTL= ada → success, berbahasa Inggris maupun Indonesia')`; `test('"Destination host unreachable" dengan kode keluar 0 → unreachable, bukan success')`; `test('"Request timed out"/"Waktu permintaan habis" → timeout')`; `test('ping gagal dijalankan → error')`. `info.test.ts` (server palsu dengan `exec` terpetakan perintah → keluaran): `test('ubiquiti: serial dari board.hwaddr dan info penuh dari board.info plus countrycode')`; `test('mikrotik: info dari /system routerboard print dan :put [/interface wireless get wlan1]')`; `test('"Permission denied" pada auth → PERMISSION_DENIED; host mati → UNAVAILABLE')`; `test('readRouterInfo memakai perintah RouterOS untuk perangkat Ubiquiti sekalipun')`.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/device` → gagal.
- [ ] **Step 3: Implementasi.** `pingOnce` menjalankan `ping.exe -n 1 -w <ms> <host>` (`windowsHide`), sukses hanya bila keluaran memuat `TTL=`; perintah SSH sesuai spek §6.2 lewat `ssh2` `exec` dengan timeout 5 dtk (serial 2 dtk) dan keepalive.
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add desktop && git commit -m "feat(desktop): layanan ping dan baca info perangkat"`

### Task 11: Sumber paket folder lokal + pengaturan

**Files:**
- Create: `desktop/src/main/package/local-folder.ts`, `desktop/src/main/package/local-folder.test.ts`, `desktop/src/main/settings.ts`, `desktop/src/main/settings.test.ts`

**Interfaces:**
- Consumes: `parseConfig`, `CountryLockConfig`, `scriptKey` (T2, T4).
- Produces: `interface LoadedPackage { dir: string; config: CountryLockConfig; scripts: Record<string, string>; missing: string[]; warnings: string[] }`; `function loadLocalPackage(dir: string): Promise<LoadedPackage>` (membaca `config.QC` dan hanya skrip yang dirujuk entri `firmware`; berkas rujukan yang tak ada dicatat di `missing`, tidak melempar); `class PackageError extends Error { code: 'NO_CONFIG' | 'BAD_CONFIG' }`; `interface Settings { packageDir: string | null }`; `function createSettingsStore(file: string): { get(): Settings; set(next: Partial<Settings>): void }` (JSON, tulis atomik lewat berkas sementara + rename).

- [ ] **Step 1: Tes gagal.** `local-folder.test.ts`: `test('folder fixture Country Lock2: 17 skrip dimuat, AF5XHD - Copy.txt tidak dimuat')`; `test('skrip yang dirujuk tapi tak ada masuk missing')`; `test('folder tanpa config.QC melempar NO_CONFIG; config rusak melempar BAD_CONFIG')`. `settings.test.ts`: `test('nilai bawaan packageDir null, set lalu get bertahan setelah buka ulang')`; `test('berkas rusak kembali ke nilai bawaan tanpa melempar')`.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/package src/main/settings.test.ts` → gagal.
- [ ] **Step 3: Implementasi** sesuai tanda tangan.
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add desktop && git commit -m "feat(desktop): sumber paket folder lokal dan pengaturan"`

### Task 12: Penyimpanan antrean pending (SQLite)

**Files:**
- Create: `desktop/src/main/store/pending-store.ts`, `desktop/src/main/store/pending-store.test.ts`

**Interfaces:**
- Consumes: `PendingEntry`, `AddResult`, `addPending`, `normalizeSerial` (T5).
- Produces: `function openPendingStore(file: string): PendingStore`; `interface PendingStore { list(): PendingEntry[]; add(entry: PendingEntry): AddResult; remove(serial: string): void; close(): void }` (tabel `pending` dengan `serial` kunci utama; mode WAL; implementasi `node:sqlite` `DatabaseSync`, atau `better-sqlite3` bila T6 memutuskan).

- [ ] **Step 1: Tes gagal.** `pending-store.test.ts` (berkas sementara): `test('entri bertahan setelah ditutup dan dibuka lagi')`; `test('serial ganda tidak menimpa, reinjectedAt terisi, result duplicated')`; `test('serial dinormalisasi: " ab12 " dan "AB12" satu entri')`; `test('dua puluh add serentak (Promise.all) menghasilkan 20 entri berbeda tanpa galat')`; `test('remove menghapus entri; remove serial tak ada tidak melempar')`; `test('berkas rusak melempar galat jelas dan tidak menghapus berkas')`.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/store` → gagal.
- [ ] **Step 3: Implementasi** sesuai tanda tangan; aturan duplikat memakai `addPending` agar sama dengan aturan murni.
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add desktop && git commit -m "feat(desktop): penyimpanan pending SQLite tahan crash"`

### Task 13: Kontrak jembatan, IPC, dan preload

**Files:**
- Create: `countrylock/src/bridge-contract.ts`, `countrylock/src/bridge-contract.test.ts`, `desktop/src/main/ipc.ts`, `desktop/src/main/ipc.test.ts`, `desktop/src/preload/index.ts`
- Modify: `countrylock/package.json` (dependensi `zod`)

**Interfaces:**
- Consumes: layanan T7, T8, T10, T11, T12; `planInject` (T4).
- Produces: `const BRIDGE_VERSION = 1`; `const MIN_BRIDGE_VERSION = 1`; `interface PingResult { ok: boolean; kind: PingKind }`; `interface DeviceRequest { brand: Brand; host: string; username: string; password: string }`; `interface InjectRequest { id: string; brand: Brand; firmwareCode: string; target: { ip: string; username: string; password: string } }`; `interface InjectResult { ok: boolean; stage: 'completed' | 'failed' | 'cancelled'; message: string }`; `interface QcBridge { version: number; package: { load(): Promise<PackageDto | null>; chooseDir(): Promise<PackageDto | null> }; device: { ping(host: string): Promise<PingResult>; readInfo(req: DeviceRequest): Promise<DeviceInfoResult>; readRouterInfo(req: DeviceRequest): Promise<RouterInfoResult> }; inject: { run(req: InjectRequest): Promise<InjectResult>; cancel(id: string): Promise<void>; onProgress(cb: (e: { id: string } & InjectProgressDto) => void): () => void }; pending: { list(): Promise<PendingEntry[]>; add(entry: PendingEntry): Promise<AddResult>; remove(serial: string): Promise<void> } }`; `interface PackageDto { dir: string; config: CountryLockConfig; missing: string[]; warnings: string[] }` (skrip tidak dikirim ke renderer); `type DeviceInfoResult = { ok: true; info: DeviceInfo } | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' }`; `type RouterInfoResult = { ok: true; serial: string; model: string } | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' }`; `interface InjectProgressDto { stage: 'connecting' | 'sending' | 'running' | 'completed' | 'failed' | 'cancelled'; message: string }` (didefinisikan di `countrylock`, tidak mengimpor `desktop`); `const BRIDGE_CHANNELS: Record<string, string>` (nama kanal `qc:<grup>:<aksi>`); skema zod `DeviceRequestSchema`, `InjectRequestSchema`, `PendingEntrySchema`; `function registerIpc(deps: IpcDeps): void` di `ipc.ts`.

- [ ] **Step 1: Tes gagal.** `bridge-contract.test.ts`: `test('host hanya IPv4 atau nama host sah; "a;b" dan string kosong ditolak')`; `test('InjectRequestSchema menolak id kosong dan firmwareCode kosong')`. `ipc.test.ts`: `test('setiap kanal di BRIDGE_CHANNELS punya handler terdaftar dan sebaliknya')`; `test('handler menolak argumen tak valid sebelum menyentuh layanan')`; `test('inject.run mengambil host key router, merencanakan inject, menjalankan eksekutor dengan SENTINEL_BY_BRAND dan menyamarkan kata sandi')` (layanan palsu); `test('inject.cancel menghentikan inject yang sedang berjalan')`.
- [ ] **Step 2:** `bun run --cwd countrylock test src/bridge-contract.test.ts && bun run --cwd desktop test src/main/ipc.test.ts` → gagal.
- [ ] **Step 3: Implementasi.** `registerIpc` memasang `ipcMain.handle` per kanal dengan validasi zod. `inject.run`: muat paket aktif, `fetchHostKey` ke `server.ip`, `planInject({ ..., sshKey: hostKey.base64 })`, `runInject` dengan `secrets` = kata sandi target dan server; progres dikirim ke renderer lewat `webContents.send`. `preload/index.ts` mengekspos `window.qcBridge` lewat `contextBridge.exposeInMainWorld`.
- [ ] **Step 4:** kedua tes lulus + typecheck keduanya.
- [ ] **Step 5: Commit** — `git add countrylock desktop bun.lock && git commit -m "feat(desktop): kontrak jembatan, IPC tervalidasi, dan preload"`

### Task 14: Shell Electron (`app://`, `qc://`, instans tunggal)

**Files:**
- Create: `desktop/src/main/index.ts`, `desktop/src/main/window.ts`, `desktop/src/main/app-protocol.ts`, `desktop/src/main/app-protocol.test.ts`, `desktop/src/main/qc-url.ts`, `desktop/src/main/qc-url.test.ts`

**Interfaces:**
- Consumes: `registerIpc` (T13), pengaturan (T11), `openPendingStore` (T12).
- Produces: `function resolveAppFile(root: string, requestUrl: string): string | null` (memetakan `app://qc/<path>` ke berkas di bawah `root`; jalur di luar `root` → `null`; rute tanpa berkas dan tanpa ekstensi → `index.html`); `const APP_CSP: string` (memuat `default-src 'self'`); `function parseQcUrl(url: string): { route: string } | null` (hanya `qc://country-lock` → `{ route: '/country-lock' }`, selain itu `null`); jendela dibuat dengan `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; argumen `--smoke-ui` memuat `app://qc/country-lock`, mengevaluasi `window.qcBridge?.version`, mencetak JSON, lalu keluar.

- [ ] **Step 1: Tes gagal.** `app-protocol.test.ts`: `test('app://qc/assets/x.js dipetakan ke root/assets/x.js')`; `test('traversal "../" dan jalur absolut menghasilkan null')`; `test('rute SPA tanpa ekstensi memberi index.html')`; `test('APP_CSP memuat default-src self dan tidak mengizinkan unsafe-eval')`. `qc-url.test.ts`: `test('qc://country-lock → /country-lock')`; `test('skema atau host lain dan jalur tambahan ditolak')`.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/app-protocol.test.ts src/main/qc-url.test.ts` → gagal.
- [ ] **Step 3: Implementasi.** `protocol.registerSchemesAsPrivileged` untuk `app` (standard, secure, supportFetchAPI); `protocol.handle('app', ...)` menyajikan UI baseline (`process.resourcesPath/ui-baseline`, atau `server/dist` saat pengembangan) dengan header CSP; `app.setAsDefaultProtocolClient('qc')`; `app.requestSingleInstanceLock()` dan `second-instance` mengarahkan jendela ke rute dari `parseQcUrl`; jendela awal memuat `app://qc/country-lock`.
- [ ] **Step 4:** tes lulus; `bun run build:web && bun run --cwd desktop pack` lalu `QC App.exe --smoke-ui` mencetak `{ "bridgeVersion": 1 }`.
- [ ] **Step 5: Commit** — `git add desktop && git commit -m "feat(desktop): shell Electron dengan app://, qc://, dan instans tunggal"`

### Task 15: Mesin sesi mode tunggal (murni)

**Files:**
- Create: `countrylock/src/session-machine.ts`, `countrylock/src/session-machine.test.ts`

**Interfaces:**
- Consumes: `Brand`, `PendingEntry`, `nextBridgeIndex`, `isRegistered` (T1, T4, T5).
- Produces: `interface SessionState { brand: Brand | null; firmwareCode: string | null; devicePingable: boolean; routerPingable: boolean; serial: string; injecting: boolean; autoInject: boolean; bridgeIndex: number; lastOutcome: 'none' | 'success' | 'failed' | 'cancelled' }`; `type SessionEvent = { type: 'select'; brand: Brand; firmwareCode: string | null } | { type: 'ping-device'; ok: boolean; serial: string } | { type: 'ping-router'; ok: boolean } | { type: 'inject-start' } | { type: 'inject-done'; outcome: 'success' | 'failed' | 'cancelled' } | { type: 'toggle-auto'; on: boolean } | { type: 'reset' }`; `const INITIAL_SESSION: SessionState`; `function reduceSession(state: SessionState, event: SessionEvent, ctx: { interfaceCount: number }): SessionState`; `function canInject(state: SessionState): boolean` (merk, firmware, serial ada, tidak sedang inject); `function shouldAutoInject(state: SessionState, pending: readonly PendingEntry[]): boolean` (auto aktif, `canInject`, dan serial belum terdaftar).

- [ ] **Step 1: Tes gagal.** `session-machine.test.ts`: `test('inject-start kedua saat injecting diabaikan (penjaga re-entry)')`; `test('inject-done success menaikkan bridgeIndex dan mengosongkan serial; failed/cancelled tidak menaikkan dan melepas penjaga')`; `test('ping-router hidup kembali setelah mati mengembalikan bridgeIndex ke 0')`; `test('shouldAutoInject false bila serial sudah terdaftar atau auto mati')`; `test('ping-device turun mengosongkan serial')`; `test('reset menonaktifkan auto dan mengosongkan keadaan')`; `test('canInject false tanpa firmware atau serial')`.
- [ ] **Step 2:** `bun run --cwd countrylock test src/session-machine.test.ts` → gagal.
- [ ] **Step 3: Implementasi** reducer murni (tanpa efek samping).
- [ ] **Step 4:** tes lulus + typecheck.
- [ ] **Step 5: Commit** — `git add countrylock/src && git commit -m "feat(countrylock): mesin sesi mode tunggal"`

### Task 16: Web: deteksi platform, rute `/country-lock`, dan pemberitahuan login desktop

**Files:**
- Create: `web/src/lib/platform.ts`, `web/src/lib/platform.test.ts`, `web/src/routes/country-lock.tsx`, `web/src/modules/countrylock/components/desktop-login-notice.tsx`, `web/src/modules/countrylock/components/open-in-desktop.tsx`, `web/src/modules/countrylock/components/open-in-desktop.test.tsx`
- Modify: `web/src/main.tsx` (lewati `loadMe()` bila desktop), `web/src/routes/login.tsx` (tampilkan `DesktopLoginNotice` bila desktop), `web/src/app/boot.ts` (+ `loadMeUnlessDesktop`), `web/src/app/boot.test.ts`

**Interfaces:**
- Consumes: `QcBridge`, `MIN_BRIDGE_VERSION` (`@countrylock/bridge-contract`, T13).
- Produces: `function getBridge(): QcBridge | null` (`window.qcBridge`, `null` bila tak ada atau `version < MIN_BRIDGE_VERSION`); `function isDesktop(): boolean`; `function loadMeUnlessDesktop(call?: ApiCall): Promise<MeDto | null>`; komponen `OpenInDesktop` (tautan `qc://country-lock` dan teks "Unduhan tersedia setelah rilis"); `DesktopLoginNotice` ("Login desktop tersedia di rilis berikutnya; hanya Country Lock aktif" dengan tautan ke `/country-lock`).

- [ ] **Step 1: Tes gagal.** `platform.test.ts`: `test('tanpa window.qcBridge → null dan isDesktop false')`; `test('versi di bawah minimum → null')`; `test('versi cukup → bridge dikembalikan')`. `boot.test.ts`: `test('loadMeUnlessDesktop di desktop tidak memanggil API dan mengembalikan null')`. `open-in-desktop.test.tsx`: `test('di browser menampilkan tautan qc://country-lock dan teks unduhan belum tersedia')`.
- [ ] **Step 2:** `bun run --cwd web test src/lib/platform.test.ts src/app/boot.test.ts src/modules/countrylock` → gagal.
- [ ] **Step 3: Implementasi.** Rute `/country-lock` berada di luar `_app` (tanpa penjaga sesi; pembungkus ringan dengan pengalih tema dan tautan "Masuk"); menyatukannya ke `AppShell` adalah pekerjaan Fase 2. `routes/country-lock.tsx` merender `CountryLockPage` (T17) bila `getBridge()` ada, selain itu `OpenInDesktop`. Jalankan generator rute TanStack (`routeTree.gen.ts` diperbarui oleh Vite/`tsr`).
- [ ] **Step 4:** tes lulus + `bun run --cwd web typecheck`.
- [ ] **Step 5: Commit** — `git add web && git commit -m "feat(web): deteksi platform, rute country-lock, dan pemberitahuan login desktop"`

### Task 17: Web: halaman Country Lock mode tunggal

**Files:**
- Create: `web/src/modules/countrylock/use-country-lock.ts`, `web/src/modules/countrylock/components/country-lock-page.tsx`, `web/src/modules/countrylock/components/inject-progress-dialog.tsx`, `web/src/modules/countrylock/components/credential-dialog.tsx`, `web/src/modules/countrylock/components/pending-list.tsx`, `web/src/modules/countrylock/components/country-lock-page.test.tsx`, `web/src/modules/countrylock/fake-bridge.ts`

**Interfaces:**
- Consumes: `getBridge` (T16), `reduceSession`, `canInject`, `shouldAutoInject`, `nextPingDelayMs`, `INITIAL_SESSION` (T4, T15), `QcBridge` (T13), komponen shadcn yang ada (`@/components/ui/*`).
- Produces: `function useCountryLock(bridge: QcBridge): { state: SessionState; pkg: PackageDto | null; info: DeviceInfo | null; log: string[]; pending: PendingEntry[]; actions: { select(brand: Brand, firmwareCode: string | null): void; inject(): void; cancel(): void; toggleAuto(on: boolean): void; submitCredentials(u: string, p: string): void; chooseDir(): void } }`; `function createFakeBridge(overrides?: Partial<QcBridge>): QcBridge` (untuk tes; berada di folder modul, tidak di build produksi karena hanya diimpor tes — pastikan `verify-dist` tetap lolos).

- [ ] **Step 1: Tes gagal.** `country-lock-page.test.tsx` (vitest + Testing Library + jembatan palsu): `test('tanpa paket menampilkan keadaan belum ada paket dan tombol pilih folder')`; `test('tombol Inject nonaktif sebelum firmware dipilih dan serial terbaca')`; `test('Auto Inject meminta konfirmasi hanya saat dinyalakan')`; `test('inject sukses: dialog progres menutup otomatis 1 dtk setelah sukses dan mencatat pending')`; `test('inject gagal: dialog tetap terbuka dengan pesan galat')`; `test('Permission denied membuka dialog kredensial berisi kredensial bawaan merk')`; `test('kata sandi tidak tampil di log dan dialog progres')`; `test('tombol unggah nonaktif dengan penjelasan')`; `test('loop ping berhenti saat komponen di-unmount')`.
- [ ] **Step 2:** `bun run --cwd web test src/modules/countrylock` → gagal.
- [ ] **Step 3: Implementasi.** Hook memutar loop ping perangkat dan router dengan `nextPingDelayMs`, membaca info saat ping berubah, menjaga `reduceSession`, dan mencatat pending lewat `bridge.pending.add` hanya setelah `inject.run` mengembalikan `ok`. Konfirmasi Auto Inject memakai teks lama persis ("Harap berhati-hati saat menggunakan \"Auto Inject\". Pastikan kembali tipe dan firmware cocok dengan perangkat yang akan di Country Lock. Yakin untuk lanjut?"). Tombol Cancel merah saat berjalan lalu Close abu saat selesai; progres bar indeterminate; log baca-saja.
- [ ] **Step 4:** tes lulus + `bun run --cwd web typecheck`; `bun run build` (web) lolos `verify-dist` (tanpa kode mock di build).
- [ ] **Step 5: Commit** — `git add web && git commit -m "feat(web): halaman Country Lock mode tunggal dengan jembatan desktop"`

### Task 18: Integrasi akhir, installer, dan uji perangkat nyata

**Files:**
- Create: `docs/e2e-checklist-desktop.md`
- Modify: `package.json` (root; skrip `build:desktop` = `bun run build:web && bun run --cwd desktop dist`), `CLAUDE.md` (bagian ringkas workspace `countrylock/` dan `desktop/`, perintah, dan catatan "jangan taruh logika Country Lock di `shared/`")

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: `desktop/dist-app/QC App Setup <versi>.exe` (NSIS x64, per pengguna); daftar uji manual pemilik.

- [ ] **Step 1: Daftar uji manual.** `docs/e2e-checklist-desktop.md` memuat langkah dan hasil yang diharapkan: pasang installer di laptop bersih (tanpa Node); buka aplikasi tanpa server dan tanpa login; atur folder paket (`Country Lock2`); pilih merk dan firmware; ping perangkat dan router; baca info; inject Ubiquiti dan Mikrotik nyata dan bandingkan hasil dengan aplikasi WPF lama (negara terkunci ke Indonesia setelah reboot, berpasangan); serial ganda tidak di-auto-inject; tutup paksa aplikasi lalu buka lagi, pending tetap ada; pemberitahuan login desktop di rute lain; `qc://country-lock` dari browser membuka aplikasi.
- [ ] **Step 2:** `bun run build:desktop` menghasilkan installer; pasang di mesin uji dan jalankan `--smoke` serta `--smoke-ui` dari hasil pasang.
- [ ] **Step 3:** `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build:gas` (semua lolos; `bun run check` butuh tunnel hidup).
- [ ] **Step 4: GERBANG (manual, pemilik).** Pemilik menjalankan daftar uji di atas pada perangkat nyata dan mengisi hasilnya. Temuan yang menyimpang dari spek menunggu keputusan pemilik sebelum rencana Fase 2 ditulis.
- [ ] **Step 5: Commit** — `git add docs CLAUDE.md package.json && git commit -m "docs(desktop): daftar uji manual, skrip build desktop, dan panduan agen"`
