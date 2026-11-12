# QC App Desktop: Seluruh Halaman Web, Login Bearer, dan UI Hibrid (Fase 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikasi desktop membawa SEMUA halaman web QC: UI dasar dibundel (jalan offline, Country Lock tetap tanpa login), login Bearer lewat browser sistem, dan UI terbaru diunduh, diverifikasi tanda tangannya, lalu dipakai tanpa pasang ulang.

**Architecture:** Renderer tetap memuat UI dari `app://qc/` (origin lokal, satu-satunya yang memegang jembatan SSH). Permintaan `app://qc/api/*` dan `app://qc/auth/*` diteruskan proses utama ke server (alamat dari Pengaturan, bawaan production) dengan header `Authorization: Bearer`, sehingga kode klien web tak berubah dan tak butuh CORS; token hanya hidup di proses utama (dienkripsi `safeStorage`). Server mendapat jalur login desktop (PKCE, kode sekali pakai) dan manifest UI bertanda tangan; desktop mengelola bundel UI (unduh, verifikasi, ganti atomik, pemulihan).

**Tech Stack:** Hono + Web Crypto (server), Electron 45 `protocol.handle`/`safeStorage`/`net.fetch` (desktop), Ed25519 (`node:crypto` di desktop dan skrip, Web Crypto di server tak perlu menandatangani), React/TanStack (web), vitest/bun:test.

**Spec:** `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §3.3 dan §3.4 (keputusan pemilik 2026-11-12 dicatat di sana); rencana Fase 0–1: `docs/superpowers/plans/2026-11-06-qc-desktop-country-lock-fase-0-1.md` (Task 1–18; rencana ini menyisip setelah Task 17 dan menggantikan sebagian Task 16).

## Global Constraints

- Keputusan pemilik 2026-11-12: desktop **hibrid** (cangkang dasar dibundel + login Bearer + UI terbaru diunduh saat web berubah); alamat server bawaan **`https://qc.rhd.my.id`** (production), dapat diubah di Pengaturan aplikasi (layar pengaturannya menyusul; Fase ini cukup menyimpan nilai di `settings.json` desktop). Hal Country Lock yang butuh konfirmasi pemilik dilewati dulu (lihat ledger: CONTROL_CHARACTER, Ubiquiti+`connectVia: Server`, keyboard-interactive, dll.).
- Renderer hanya memuat aset lokal lewat `app://`; halaman dari server TIDAK pernah memegang `window.qcBridge`. Token Bearer tidak pernah dikirim ke renderer, tidak masuk log, dan disimpan terenkripsi (`safeStorage`; bila tak tersedia, token tidak disimpan di disk dan hanya di memori).
- Server tetap `application/problem+json`, CSRF `X-Requested-With: qc` untuk semua metode tulis (proxy meneruskan header itu apa adanya), tanpa CORS baru. Variabel `.env` baru wajib ditambah di `server/src/config.ts`, `deploy/compose.yml`, `deploy/.env.example`, `server/.env.example` (dijaga `deploy-files.test.ts`). Tidak ada migrasi baru (kode sekali pakai memakai tabel `rate_limits`).
- Token desktop: payload sesi dengan `typ: 'desktop'`, TTL 30 hari [Pilihan perancang, tinjau pemilik]; hanya diterima lewat header Bearer; cookie web tidak menerima `typ: 'desktop'` dan Bearer tidak menerima token tanpa `typ`. Pencabutan = nonaktifkan akun (diperiksa tiap permintaan oleh `authorize`) atau ganti `SESSION_SECRET`.
- Kode login: ditandatangani HMAC, TTL 2 menit, terikat PKCE (`S256`), sekali pakai (penanda di `rate_limits`, kunci `dcode:<sha256 kode>`, kedaluwarsa sendiri).
- Manifest UI: `{ uiVersion, minBridge, files: [{ path, sha256, size }], createdAt }`, ditandatangani Ed25519 (kunci publik tertanam di aplikasi; kunci privat hanya di CI/pemilik, spek §3.4, §15 butir 12). Bundel dengan `minBridge` > `BRIDGE_VERSION` aplikasi tidak diterapkan. UI baru tidak diterapkan di tengah inject yang berjalan.
- Tes server (butuh terowongan DB yang sudah hidup; jangan memulai/mematikannya): `QC_TEST_SHARDS=1 bun run --cwd server test <jalur>`. Tes desktop vitest/Node, tes countrylock bun:test, tes web vitest+jsdom. `bun run check` penuh hanya di akhir.
- Kode: Biome (kutip tunggal, titik koma, lebar 100), TypeScript strict + `noUncheckedIndexedAccess`; komentar dan galat berbahasa Indonesia; titik singgung dengan sesi lain (`package.json` akar, `bun.lock`, `web/vite.config.ts`, `server/src/app.ts`, `server/src/http/rest.ts`) diubah seminimal mungkin.

## Review Focus

1. Token Bearer tanpa `typ`, dengan `typ` lain, atau kedaluwarsa, dan cookie yang berisi token desktop: semuanya `UNAUTHENTICATED` (H1).
2. Kode login dipakai dua kali, `verifier` salah, kode kedaluwarsa, akun sudah dinonaktifkan sebelum penukaran: ditolak tanpa membocorkan penyebab (H2).
3. Proxy `app://` diminta jalur di luar daftar izin (`/api/v1/*`, `/api/ping`, `/auth/logout`), dengan `..`, atau header `Cookie`/`Authorization` dari renderer: ditolak atau dibuang; `Set-Cookie` dari server tidak diteruskan; server mati = 503 problem+json, bukan crash (H3).
4. `qc://auth?...` dengan `state` tak cocok, tanpa login yang sedang berjalan, atau dikirim dua kali: diabaikan (H4).
5. Manifest dengan tanda tangan salah, hash berkas tak cocok, `path` berisi `..`, `minBridge` lebih tinggi, atau unduhan terputus di tengah: bundel aktif tidak berubah; dua kali gagal dimuat kembali ke bundel sebelumnya lalu dasar (H7).

---

### Task H0: Catatan keputusan pada spek dan rencana lama (dokumen)

**Files:** Modify `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` (§3.3, §3.4, §15 butir 12), `docs/superpowers/plans/2026-11-06-qc-desktop-country-lock-fase-0-1.md` (paragraf "Keadaan akhir Fase 1", Task 16).

- [ ] **Step 1:** Catat di spek §3.3 keputusan pemilik 2026-11-12 (hibrid, Bearer, server bawaan production, pembaruan UI), rincian yang dipilih perancang (proxy lewat proses utama, token `typ: 'desktop'` 30 hari, PKCE + kode sekali pakai, tanpa CORS, tanpa migrasi), dan bahwa pembaruan UI memerlukan kunci tanda tangan yang diserahkan pemilik (butir 12 tetap terbuka sampai kunci ada). Ubah kalimat spek yang bertentangan ("ditunda ke Fase 2") agar menunjuk rencana ini.
- [ ] **Step 2:** Di rencana lama: ganti paragraf "Keadaan akhir Fase 1 yang jujur" dengan rujukan ke rencana ini, dan di Task 16 tandai bagian `DesktopLoginNotice`, `loadMeUnlessDesktop`, dan "lewati `loadMe()` bila desktop" sebagai digantikan Task H5.
- [ ] **Step 3: Commit** — `git add docs && git commit -m "docs(desktop): catat keputusan hibrid, login Bearer, dan pembaruan UI"`

### Task H1: Server: token desktop dan penerimaan Bearer

**Files:** Modify `server/src/core/session.ts`, `server/src/http/rest.ts` (titik baca token, ~baris 175), `server/src/http/openapi.ts` (~baris 199), `server/src/modules/auth/rest.test.ts` atau berkas tes baru `server/src/core/session-desktop.test.ts`.

**Interfaces:**
- Produces: `const DESKTOP_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000`; `signDesktopToken(env: Env, email: string, now: number): Promise<string>` (payload `SessionPayload & { typ: 'desktop' }`); `verifyDesktopToken(env: Env, token: unknown, now: number): Promise<SessionPayload | null>`; `bearerTokenOf(request: Request): string | null` di `core/router.ts` (hanya skema `Bearer`, tepat satu spasi, tanpa spasi tambahan); `verifySessionToken` ditolak untuk payload ber-`typ`.
- Consumes: `signValue`/`verifyValue`, `authorize(env, token, ...)` (isi tak diubah: token yang diberikan pemanggil sudah tervalidasi).

- [ ] **Step 1: Tes gagal.** `bearer token desktop valid memberi akses ke GET /api/v1/me`; `token desktop ditolak sebagai cookie qc_session`; `token sesi cookie (tanpa typ) ditolak sebagai Bearer`; `Bearer kedaluwarsa, rusak, dan header tanpa skema Bearer = 401 UNAUTHENTICATED`; `akun dinonaktifkan membuat Bearer lama 401`; `bila Authorization dan cookie sama-sama ada, Bearer yang dipakai` (cookie sah + Bearer rusak = 401, tidak jatuh ke cookie).
- [ ] **Step 2:** Jalankan tes berskup → gagal.
- [ ] **Step 3:** Implementasi sesuai tanda tangan; `rest.ts` dan `openapi.ts` memakai `bearerTokenOf(request)` lalu, hanya bila header Authorization tidak ada, cookie.
- [ ] **Step 4:** Tes berskup lulus + `bun run --cwd server typecheck`.
- [ ] **Step 5: Commit** — `feat(server): token desktop dan penerimaan Bearer`

### Task H2: Server: alur login desktop (PKCE) dan penukaran kode

**Files:** Modify `server/src/modules/auth/routes.ts`, `server/src/http/security.ts` (nama cookie `DESKTOP_COOKIE = 'qc_desktop'`); Create `server/src/modules/auth/desktop.ts`, `server/src/modules/auth/desktop.test.ts`.

**Interfaces:**
- Produces: `GET /auth/desktop/start?challenge=<b64url sha256>&state=<8-128 karakter [A-Za-z0-9_-]>` (validasi ketat; set cookie `qc_desktop` bertanda tangan `{challenge,state,exp+10m}` Path `/auth`, lalu 302 ke `/auth/login`); cabang di `/auth/callback`: bila cookie `qc_desktop` valid dan login berhasil, JANGAN set cookie sesi web; 302 ke `qc://auth?code=<kode>&state=<state>` (kode = `signValue({typ:'dcode', email, challenge, nonce, exp: now+2m})`); `POST /auth/desktop/token` badan JSON `{ code: string; verifier: string }` → `200 { token, expiresAt, email }` atau `400`/`401` seragam `UNAUTHENTICATED` "Kode tidak valid atau kedaluwarsa"; fungsi `consumeDesktopCode(env, code, verifier, now): Promise<{ email: string } | null>` di `desktop.ts` (S256(verifier) = challenge, penanda `rate_limits` `dcode:<sha256 kode>` lewat `INSERT` yang gagal duplikat = sudah dipakai, akun masih aktif lewat `loadUserContext`).
- Consumes: `signDesktopToken` (H1), `createLogin`/`verifyLoginState` (yang ada), `isDriveId`-style validator regex sendiri untuk `challenge`/`state`/`verifier` (43-128 karakter `[A-Za-z0-9._~-]`).

- [ ] **Step 1: Tes gagal** (nama tes sesuai Review Focus 2): `start menolak challenge/state tak sah`; `alur penuh dengan Google palsu (pola auth.test.ts) berakhir di qc://auth?code&state tanpa cookie qc_session`; `penukaran berhasil menghasilkan token desktop yang lolos GET /api/v1/me`; `kode kedua kali ditolak`; `verifier salah ditolak dan TIDAK menghabiskan kode`; `kode kedaluwarsa ditolak`; `akun nonaktif ditolak`; `state pada qc://auth sama dengan state dari start`; `login web biasa (tanpa cookie qc_desktop) tidak berubah`.
- [ ] **Step 2:** tes berskup → gagal.
- [ ] **Step 3:** Implementasi; `/auth/desktop/token` kena `csrfGuard` yang ada (klien mengirim `X-Requested-With: qc`); pesan galat generik, penyebab hanya di log server.
- [ ] **Step 4:** tes berskup + typecheck lulus; jalankan juga `server/src/modules/auth` penuh.
- [ ] **Step 5: Commit** — `feat(server): alur login desktop PKCE dan penukaran kode sekali pakai`

### Task H3: Desktop: penyimpanan token, pengaturan server, dan proxy `app://qc/api|auth`

**Files:** Create `desktop/src/main/auth/token-store.ts`, `desktop/src/main/api-proxy.ts`, tes `token-store.test.ts`, `api-proxy.test.ts`; Modify `desktop/src/main/settings.ts` (field `serverUrl`, bawaan `https://qc.rhd.my.id`; validasi https atau `http://localhost|127.0.0.1` untuk pengembangan), `desktop/src/main/app-protocol.ts` (jalur `/api/` dan `/auth/` diserahkan ke proxy).

**Interfaces:**
- Produces: `interface TokenStore { get(): { token: string; email: string; expiresAt: number } | null; set(v): void; clear(): void }` dan `createTokenStore(file: string, crypto: { encrypt(s: string): Buffer; decrypt(b: Buffer): string } | null): TokenStore` (`crypto` = `safeStorage`; `null` = hanya memori); `function createApiProxy(deps: { settings: () => Settings; tokens: TokenStore; fetchImpl?: typeof fetch; onUnauthenticated(): void }): (request: Request) => Promise<Response>`; daftar izin `PROXY_ALLOW = [/^\/api\/v1\//, /^\/api\/ping$/, /^\/auth\/logout$/]`.
- Aturan: bangun URL tujuan dari `serverUrl` + path tervalidasi (tanpa `..`, tanpa `//`); buang `Cookie`, `Authorization`, `Host`, `Origin`, `Referer` dari permintaan renderer; tambah `Authorization: Bearer <token>` bila ada; teruskan metode, badan (`duplex: 'half'`), `If-Match`, `Content-Type`, `X-Requested-With`; respons: buang `Set-Cookie`; 401 dari server → `tokens.clear()` + `onUnauthenticated()`; `/auth/logout` → `tokens.clear()` lalu `{ ok: true }` tanpa memanggil server; galat jaringan → 503 `application/problem+json` `{ code: 'UNAVAILABLE' }`; `redirect: 'manual'` (3xx tidak diikuti).

- [ ] **Step 1: Tes gagal** (server HTTP lokal palsu): tes sesuai Review Focus 3 (jalur di luar izin = 403 problem+json, `..` ditolak, header dibuang, `Set-Cookie` tak diteruskan, Bearer ditambahkan, 401 menghapus token, server mati = 503, unggah multipart 5 MB dan unduhan biner utuh, `If-Match` diteruskan); `token-store`: bertahan setelah dibuka ulang, terenkripsi di disk (berkas tak memuat token polos), `crypto: null` tidak menulis disk, berkas rusak = kosong.
- [ ] **Step 2:** `bun run --cwd desktop test src/main/auth src/main/api-proxy.test.ts` → gagal.
- [ ] **Step 3:** Implementasi; proxy didaftarkan di `protocol.handle('app', ...)` untuk awalan `/api/` dan `/auth/`; jalur lain tetap penyaji berkas.
- [ ] **Step 4:** tes + typecheck lulus.
- [ ] **Step 5: Commit** — `feat(desktop): penyimpanan token, pengaturan server, dan proxy API lewat app://`

### Task H4: Desktop: alur login lewat browser sistem dan kontrak jembatan `auth`

**Files:** Create `desktop/src/main/auth/login-flow.ts`, `login-flow.test.ts`; Modify `countrylock/src/bridge-contract.ts` (`BRIDGE_VERSION = 2`, `MIN_BRIDGE_VERSION` tetap 1; `QcBridge.auth`), `countrylock/src/bridge-channels.ts`, `desktop/src/main/ipc.ts`, `desktop/src/preload/index.ts`, `desktop/src/main/index.ts` (penanganan `qc://auth?...` pada `second-instance`, `open-url`, dan argumen awal), tes terkait.

**Interfaces:**
- Produces: `interface AuthStatus { signedIn: boolean; email: string | null; serverUrl: string }`; `QcBridge.auth: { status(): Promise<AuthStatus>; login(): Promise<void> /* membuka browser sistem */; logout(): Promise<void>; onChange(cb: (s: AuthStatus) => void): () => void }`; `createLoginFlow(deps: { settings; tokens: TokenStore; openExternal(url: string): Promise<void>; fetchImpl?; random?(n: number): Uint8Array; now?(): number; onChange(s: AuthStatus): void }): { start(): Promise<void>; handleCallback(url: string): Promise<boolean> }`; `parseQcUrl` (T14) diperluas: `qc://auth?code=&state=` → `{ route: null, auth: { code, state } }`, tetap menolak selain itu.
- Aturan: `start()` membangkitkan `verifier` (43 karakter acak, hanya di memori) dan `state`, membuka `${serverUrl}/auth/desktop/start?challenge=...&state=...` lewat `shell.openExternal` (hanya https atau localhost); hanya SATU login berjalan (baru menggantikan lama); `handleCallback` menolak bila `state` tak cocok, tak ada login berjalan, atau lebih dari 10 menit; sukses = POST `/auth/desktop/token` (header `X-Requested-With: qc`) lalu `tokens.set`, login dibersihkan (callback kedua diabaikan); semua jalur memanggil `onChange`.

- [ ] **Step 1: Tes gagal** (Review Focus 4 + alur sukses dengan server palsu): `start membuka URL dengan challenge S256 dari verifier`; `callback sah menukar kode dan menyimpan token`; `state tak cocok / tanpa login berjalan / kedua kali = diabaikan`; `verifier tak pernah muncul di URL`; `login baru menggantikan yang lama`; `qc://auth ditolak bila query kelebihan atau kode di luar pola`; tes IPC: `auth.login/logout/status` tervalidasi dan semua kanal terdaftar.
- [ ] **Step 2:** tes berskup desktop dan countrylock → gagal.
- [ ] **Step 3:** Implementasi sesuai tanda tangan; `second-instance` mengirim argumen `qc://auth?...` ke `handleCallback` lalu memfokuskan jendela.
- [ ] **Step 4:** tes + typecheck lulus (countrylock dan desktop, serta `web` bila tipe jembatan berubah).
- [ ] **Step 5: Commit** — `feat(desktop): login lewat browser sistem dan jembatan auth`

### Task H5: Web: login desktop, boot normal, dan Country Lock di sidebar

**Files:** Modify `web/src/lib/platform.ts` (T16), `web/src/app/boot.ts` dan `boot.test.ts`, `web/src/main.tsx` (tetap `loadMe()` di desktop; setel pemanggilan agar tak bergantung `isDesktop`), `web/src/modules/auth/components/login-panel.tsx`, `web/src/modules/auth/use-logout.ts`, `web/src/modules/auth/session.ts`, komponen sidebar aplikasi (menu "Country Lock" hanya bila `isDesktop()`), `web/src/routes/country-lock.tsx`; hapus/ubah `desktop-login-notice.tsx` dan `loadMeUnlessDesktop` bila sudah dibuat di T16; rute `/country-lock` tetap di luar penjaga sesi.

**Interfaces:**
- Consumes: `getBridge()`/`isDesktop()` (T16), `QcBridge.auth` (H4).
- Produces: di desktop `LoginPanel` memanggil `bridge.auth.login()` (bukan tautan `/auth/login`), menampilkan "Lanjutkan login di browser…" sampai `auth.onChange` melaporkan `signedIn` lalu memuat ulang `me`; `use-logout` di desktop memanggil `bridge.auth.logout()` lalu alur logout biasa; layanan service worker PWA TIDAK didaftarkan bila `isDesktop()` (fungsi penjaga `shouldRegisterServiceWorker(): boolean` di `platform.ts`, dipanggil registrasi mana pun yang ada atau ditambah sesi PWA).

**Catatan dari sesi PWA Fase 1 (cabang `claude/pwa-fase-1-f3b5ad`, belum digabung):** registrasi service worker ada di `web/src/main.tsx` dalam `start()`: `if (import.meta.env.PROD) { startPwaUpdates({ register: registerSW }) }`; bila cabang itu sudah ada di basis saat task ini dikerjakan, ubah syaratnya menjadi `import.meta.env.PROD && shouldRegisterServiceWorker()` dan jaga juga `startInstallCapture()` (baris pertama `start()`); bila belum, cukup sediakan `shouldRegisterServiceWorker()` dan catat penjaga ini sebagai pekerjaan saat penggabungan (laporkan). Spanduk pembaruan dan butir "Pasang aplikasi" aman di desktop. Cabang itu menambah `sw.js`, `workbox-*.js`, `manifest.webmanifest`, dan `icons/` ke `server/dist`: tidak dipakai bundel desktop, boleh ikut manifest UI.

- [ ] **Step 1: Tes gagal.** `desktop: panel login memanggil bridge.auth.login dan tidak mengarahkan ke /auth/login`; `desktop: setelah onChange signedIn, me dimuat ulang`; `desktop: loadMe tetap dipanggil (tidak dilewati)`; `logout di desktop memanggil bridge.auth.logout`; `di browser perilaku lama tidak berubah`; `menu Country Lock muncul hanya di desktop`; `shouldRegisterServiceWorker false di desktop`.
- [ ] **Step 2:** `bun run --cwd web test src/lib/platform.test.ts src/app/boot.test.ts src/modules/auth` → gagal.
- [ ] **Step 3:** Implementasi; server tidak sampai (`UNAVAILABLE`) menampilkan keadaan "tidak dapat terhubung" pada halaman login desktop dengan tautan ke Country Lock.
- [ ] **Step 4:** tes lulus + `bun run --cwd web typecheck` + `bun run build` (lolos `verify-dist`).
- [ ] **Step 5: Commit** — `feat(web): login desktop lewat jembatan, boot normal, dan menu Country Lock`

### Task H6: Manifest UI bertanda tangan (skrip build + rute publik)

**Files:** Create `scripts/build-ui-manifest.ts`, `scripts/sign-ui-manifest.ts`, `scripts/gen-ui-signing-key.ts`, `scripts/ui-manifest.test.ts`, `server/src/modules/desktop/routes.ts` + `routes.test.ts`; Modify `server/src/app.ts` (pasang rute), `server/src/http/static.ts` (awalan `/api` sudah server), `Dockerfile` (langkah tanda tangan opsional memakai secret BuildKit `ui_signing_key`, `required=false`; tanpa secret langkah dilewati dengan pesan), `docs/ci-cd.md` (cara memasang secret oleh pemilik), `.gitignore` bila perlu.

**Interfaces:**
- Produces: `buildUiManifest(distDir: string, opts: { uiVersion: string; minBridge: number; now: number }): UiManifest` (murni selain baca berkas; `uiVersion` = sha256 gabungan hash berkas, `files` = semua berkas di `server/dist` KECUALI `ui-manifest*`, `path` dinormalisasi `/`, urut abjad); `signUiManifest(manifestJson: string, privateKeyPem: string): string` (Ed25519, base64url tanda tangan atas BYTE persis `ui-manifest.json`); `verifyUiManifest(manifestJson: string, signature: string, publicKeyPem: string): boolean` (di `countrylock`? tidak: di `desktop`, H7); berkas keluaran `server/dist/ui-manifest.json` dan `ui-manifest.sig`; `GET /api/desktop/ui-manifest` (tanpa login, `Cache-Control: no-cache`, `ETag` dari hash manifest, 404 bila `.sig` tak ada; mengembalikan `{ manifest: <objek>, signature }`); berkas UI diunduh lewat jalur statis yang ada (`/assets/*`, `/index.html`).
- `minBridge` dibaca dari `countrylock/src/bridge-contract.ts` (`MIN_BRIDGE_VERSION_FOR_UI` = `BRIDGE_VERSION` saat build; konstanta baru yang dinaikkan bila UI memakai fungsi jembatan baru).

- [ ] **Step 1: Tes gagal.** `manifest memuat semua berkas dengan sha256 dan ukuran benar, tanpa dirinya sendiri`; `uiVersion berubah bila satu berkas berubah, stabil bila tidak`; `tanda tangan valid lolos verifikasi, satu bit berbeda gagal`; `rute 404 tanpa .sig, 200 dengan ETag dan 304 pada If-None-Match`; `rute tak membutuhkan login dan tak membocorkan galat internal`.
- [ ] **Step 2:** tes berskup → gagal.
- [ ] **Step 3:** Implementasi; `gen-ui-signing-key.ts` mencetak pasangan kunci PEM ke berkas yang ditunjuk (tidak ke log) dan petunjuk menyimpannya (jangan dikomit).
- [ ] **Step 4:** tes + typecheck; `bun run build` menghasilkan `ui-manifest.json` bila dipanggil lewat skrip build (skrip `build` akar memanggil `build-ui-manifest` setelah `verify-dist`; `verify-dist` tetap lolos dengan berkas tambahan).
- [ ] **Step 5: Commit** — `feat(server): manifest UI bertanda tangan untuk pembaruan desktop`

### Task H7: Desktop: pengelola bundel UI (unduh, verifikasi, ganti atomik, pemulihan)

**Files:** Create `desktop/src/main/ui/ui-bundle.ts`, `ui-bundle.test.ts`, `desktop/src/main/ui/public-key.ts` (kunci publik tertanam; kunci uji untuk tes dari `test-support`); Modify `desktop/src/main/app-protocol.ts` (root berkas = bundel aktif bila ada, selain itu `ui-baseline`), `desktop/src/main/index.ts` (pemeriksaan saat dibuka, saat fokus, dan tiap ≤ 1 jam; tidak menerapkan bila ada inject berjalan), `ipc.ts`/jembatan (`ui.onUpdateReady(cb)`, `ui.reload()`; `BRIDGE_VERSION` tetap 2 atau 3 bila perlu, jangan dinaikkan tanpa alasan), tes terkait.

**Interfaces:**
- Produces: `createUiBundleManager(deps: { dir: string; baselineDir: string; serverUrl: () => string; publicKeyPem: string; bridgeVersion: number; isBusy: () => boolean; fetchImpl?; now?(): number }): { activeRoot(): string; checkForUpdate(): Promise<UpdateResult>; markLoadFailed(): void; markLoadOk(): void }`; `type UpdateResult = { status: 'none' | 'ready' | 'rejected' | 'busy' | 'error'; reason?: string; uiVersion?: string }`; struktur disk `dir/versions/<uiVersion>/…`, `dir/state.json` `{ active, previous, bad: string[] }` (ditulis atomik: berkas sementara + rename); unduh ke `dir/staging/<uiVersion>` lalu verifikasi tanda tangan manifest, `path` aman, ukuran dan `sha256` tiap berkas, `minBridge <= bridgeVersion`, sebelum `rename` ke `versions/`; versi `bad` tidak diunduh ulang; penjaga: dua `markLoadFailed` berturut-turut → aktifkan `previous`, lalu dasar; hanya 3 versi terbaru disimpan.

- [ ] **Step 1: Tes gagal** (server palsu + kunci uji, Review Focus 5): `tanda tangan salah ditolak`, `hash berkas tak cocok ditolak dan staging dibersihkan`, `path berisi .. atau absolut ditolak`, `minBridge lebih tinggi ditolak dengan reason`, `unduhan terputus di tengah tidak mengubah aktif`, `sukses = ready lalu activeRoot menunjuk bundel baru hanya setelah penerapan (peluncuran berikutnya/ui.reload), bukan di tengah`, `isBusy true = status busy tanpa mengganti`, `dua markLoadFailed kembali ke previous lalu dasar dan menandai bad`, `versi bad tidak diunduh ulang`, `tanpa manifest/404 (belum ada tanda tangan di server) = none tanpa galat`, `ETag dipakai (If-None-Match)`.
- [ ] **Step 2:** tes berskup → gagal.
- [ ] **Step 3:** Implementasi sesuai tanda tangan; verifikasi Ed25519 lewat `node:crypto` (`crypto.verify(null, data, publicKey, signature)`); kunci publik tertanam diisi sementara dengan penanda yang menonaktifkan pembaruan (`UI_PUBLIC_KEY_PEM = null` → `checkForUpdate` selalu `none`) sampai pemilik menyerahkan kunci (butir 12); tes memakai kunci uji.
- [ ] **Step 4:** tes + typecheck lulus; uji tangan: `bun run build:web && bun run --cwd desktop pack`, `--smoke-ui` tetap lolos dari UI dasar.
- [ ] **Step 5: Commit** — `feat(desktop): pengelola bundel UI bertanda tangan dengan pemulihan`

### Task H8: Integrasi, dokumen, dan serah terima kunci

**Files:** Modify `docs/e2e-checklist-desktop.md`, `CLAUDE.md` (bagian ringkas desktop: login Bearer, proxy `app://`, manifest UI, perintah, "jangan menaruh token di renderer"), `docs/ci-cd.md`; Create `docs/desktop-ui-signing.md` (langkah pemilik: `bun scripts/gen-ui-signing-key.ts`, menyimpan kunci privat di GitHub secret, mengisi `public-key.ts`, memasang secret di build image, memutar kunci).

- [ ] **Step 1:** Tambah ke daftar uji manual: login lewat browser sistem dan kembali ke aplikasi, semua halaman web terbuka dan bisa dipakai, logout, server mati (Country Lock tetap jalan, halaman lain "tidak dapat terhubung"), pembaruan UI setelah deploy web (spanduk muat ulang), penolakan bundel rusak, `qc://auth` ganda.
- [ ] **Step 2:** `bun run typecheck`, `bun run lint`, tes berskup semua workspace yang disentuh; `bun run check` penuh bila terowongan hidup (satu kali, di akhir).
- [ ] **Step 3: Commit** — `docs(desktop): daftar uji, panduan agen, dan serah terima kunci penandatanganan`
