# Halaman Daftar Unduhan Desktop (`/desktop`): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna web yang sudah masuk dapat membuka `/desktop`, melihat daftar versi aplikasi desktop yang masih didukung server, dan mengunduh installer yang cocok dengan OS/arsitektur perangkatnya (lengkap checksum SHA-512 dan catatan rilis per versi).

**Architecture:** Rute REST `desktop.releases` (sesi, tanpa izin modul) membaca SEMUA rilis yang terlihat lewat `ReleaseReader.list()` (pembaca Drive yang sudah ada), menyaring versi `>= MIN_CLIENT.desktop`, dan mengubah manifest menjadi `DesktopReleasesDto`. Halaman web `/desktop` hanya menampilkan DTO itu; deteksi OS/arsitektur murni di klien. Butir navigasi "Aplikasi Desktop" memakai bendera `webOnly` baru (kebalikan `desktopOnly`).

**Tech Stack:** TypeScript, Bun (`bun:test` untuk `shared/`, `server/`), Hono, React + TanStack Router/Query, Vitest + Testing Library (`web/`), Biome.

**Spec:** `docs/superpowers/specs/2026-11-17-changelog-dan-unduh-desktop-web-design.md` bagian 5.1 (rute `desktop.releases`) dan 5.3 (halaman Desktop), sebagaimana diubah 2026-11-20 (hanya versi yang didukung server tampil). Konteks: `docs/superpowers/specs/2026-11-20-versi-api-fase3-design.md` bagian 5b butir 3 (halaman ini dibangun terpisah dan lebih dulu; fase 3 memakainya sebagai tujuan tautan layar penahan).

**Cakupan rencana ini:** rute `desktop.releases`, halaman `/desktop`, navigasi `webOnly`, konstanta `MIN_CLIENT`. **Tidak termasuk** (bagian lain spek 5, dikerjakan terpisah bila diminta): rute `app.changelog`, halaman `/changelog` ("Pembaruan"), parser `shared/changelog.ts`, penanda "ada yang baru", label versi di sidebar.

## Global Constraints
- `shared/` murni: tanpa `URL`, `fetch`, `atob`, `Buffer`, atau API DOM/Node di kode non-tes; import internal relatif.
- `MIN_CLIENT` = `{ desktop: '0.0.0' }` (nilai awal; tidak menyaring apa pun hari ini). Sumbernya konstanta di kode, bukan variabel lingkungan. Fase 3 menambah `minClient` ke `/api/ping` dari konstanta yang SAMA; jangan menduplikasi nilainya.
- `DesktopReleasesDto`/`DesktopReleaseDto` persis seperti spek 5.1: `DesktopReleaseDto = { version, publishedAt, changelog, files: [{ arch: 'x64'|'arm64', name, size, sha512, url }] }`; `url` = `/api/desktop/app-file/<versi>/<nama>` (rute publik yang sudah ada); `enabled=false` bila `DESKTOP_RELEASES_FOLDER_ID` kosong/tak sah; maksimum 50 rilis, terbaru di atas.
- Manifest menyimpan `sha512` sebagai base64 (88 karakter, `==` di akhir; `shared/desktop-release.ts`), sedangkan `Get-FileHash -Algorithm SHA512` mengeluarkan HEKSADESIMAL. DTO membawa heksadesimal huruf kecil 128 karakter (spek 5.1 menulis "heksadesimal 128"); konversi dilakukan di server, bukan di `shared/`.
- Rute `desktop.releases` TANPA izin modul (cukup sesi aktif, seperti `guides.list`), tidak berlokasi, bukan modul ber-BU. Respons JSON tidak di-cache (aturan kernel REST).
- Server TIDAK PERNAH menyebut GitHub dan tak memverifikasi tanda tangan (spek rilis desktop 4); galat Drive tidak boleh bocor ke klien: pembaca gagal = `enabled: true, releases: []`.
- Butir navigasi hanya tampil di peramban (`webOnly`), tanpa izin; tak muncul di aplikasi desktop karena `api-proxy` tak meneruskan `/api/desktop/*` dan navigasi desktop dikunci ke `app://qc`.
- Teks UI Indonesia santai ("Serial Number" ditulis lengkap bila muncul); teks bantuan tetap persis dari spek 5.3.
- Perubahan `shared/` mewajibkan fragmen di `server/changelog.d/` DAN `desktop/changelog.d/` (satu baris `tipe(area): ringkasan`, maks. 200 karakter; nama `<yyyymmdd>-<nn>-<slug>.md`, pakai tanggal `20261120`).
- Tes server butuh terowongan hidup (`bun run db:tunnel`); `bun run check` gagal tanpanya.
- Kerjakan di cabang baru dari `origin/dev`: `git fetch origin && git switch -c feat/halaman-unduh-desktop origin/dev`. Push/PR mengikuti aturan global proyek (cek status PR dulu). Satu PR; fase 3 baru dimulai setelah PR ini ter-merge.

## Review Focus
1. Manifest/rilis rusak, tak lengkap (installer hilang, ukuran tak cocok), atau `.sig` dihapus (rilis ditarik): rilis itu TIDAK muncul dan tak menggagalkan daftar versi lain (Task 1 dan 2).
2. Folder Drive tak terbaca (galat jaringan/kuota): jawaban tetap 200 berbentuk valid tanpa membocorkan pesan galat; halaman tidak menampilkan "belum tersedia" palsu bila `enabled=true` tetapi kosong (Task 2 dan 4).
3. Versi di bawah `MIN_CLIENT.desktop` tidak muncul; `1.10.0` > `1.9.0` (bukan perbandingan string); `MIN_CLIENT` `0.0.0` tidak menyaring apa pun (Task 2).
4. Pengguna Windows ARM, Windows x64, macOS/Linux/ponsel, dan peramban tanpa `userAgentData`: tombol utama hanya muncul bila installer yang cocok ada; OS lain tetap melihat daftar (Task 3 dan 4).
5. Tombol "Salin" checksum saat `navigator.clipboard` tak ada atau menolak: tidak melempar, memberi umpan balik galat (Task 4).

---

### Task 1: `ReleaseReader.list()` dan pemisahan pembuat pembaca

**Files:**
- Modify: `server/src/modules/desktop/app-release.ts` (tambah `list` pada `ReleaseReader` dan `createReleaseReader`)
- Create: `server/src/modules/desktop/release-reader.ts` (pindahan `releaseReaderOf`)
- Modify: `server/src/modules/desktop/routes.ts` (hapus definisi lokal `releaseReaders`/`releaseReaderOf`, impor dari berkas baru)
- Test: `server/src/modules/desktop/app-release.test.ts` (tambah kasus `list`)

**Interfaces:**
- Produces:
  - `ReleaseReader.list(): Promise<ServedRelease[]>` — semua versi yang TERLIHAT dan utuh (manifest + `.sig` ada, bentuk sah, semua installer tercantum ada dengan ukuran sama), urut versi menurun (`compareVersions`). Versi yang tak lolos dilewati satu-satu; galat Drive (listing/baca berkas) tetap DILEMPAR seperti `latest`.
  - `releaseReaderOf(env: AppBindings['Bindings']): ReleaseReader | null` di `release-reader.ts` (isi sama persis dengan fungsi lokal sekarang, termasuk `WeakMap` per klien Google dan syarat `isDriveId(folderId)`).
- Consumes: `isDriveId`, `getBridge`, `nowOf`, `AppBindings` (impor yang sama dengan yang dipakai `routes.ts` hari ini).

- [ ] **Step 1: Tulis tes yang gagal** di `app-release.test.ts` (ikuti fixture berkas yang ada di sana; gunakan klien Drive palsu `env.BRIDGE`):
  - `list` dengan tiga versi `1.0.0`, `1.2.0`, `1.10.0` (semua lengkap) mengembalikan versi `['1.10.0', '1.2.0', '1.0.0']`.
  - Versi `1.1.0` tanpa `.sig` tidak ikut; versi `1.3.0` yang manifest-nya memuat installer yang tak ada di folder tidak ikut; versi `1.4.0` dengan manifest JSON rusak tidak ikut; ketiganya tidak membuat `list` melempar dan versi lain tetap muncul.
  - Folder kosong -> `[]`.
  - `env.BRIDGE.failNext('listFolder', new Error('x'))` -> `list()` menolak (galat tidak ditelan).
  - Pemanggilan kedua dalam masa memo tidak membaca ulang berkas manifest (jumlah panggilan `readFile` tidak naik; ikuti cara tes `latest` yang ada memeriksa memo bila ada, bila tidak cukup periksa hasil sama).
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd server test src/modules/desktop/app-release.test.ts` — Expected: FAIL (`list` belum ada).
- [ ] **Step 3: Implementasikan** `list` di `createReleaseReader`: ambil `readIndex()`, urutkan kunci `versions` menurun dengan `compareVersions`, panggil `resolve(version)` (sudah memo per versi dan sudah mengembalikan `null` untuk rilis tak sah), kumpulkan yang bukan `null`. Perbarui antarmuka `ReleaseReader` dan komentar kepala berkas satu kalimat. Pindahkan `releaseReaders`/`releaseReaderOf` dari `routes.ts` ke `release-reader.ts` (ekspor), impor di `routes.ts`; tidak mengubah perilaku `app-manifest`/`app-file`.
- [ ] **Step 4: Jalankan tes desktop, pastikan lulus**
  Run: `bun run --cwd server test src/modules/desktop` — Expected: PASS (termasuk `app-routes.test.ts` yang tak boleh berubah perilakunya).
- [ ] **Step 5: Commit**
  ```bash
  git add server/src/modules/desktop
  git commit -m "feat(desktop): pembaca rilis dapat mendaftar semua versi yang terlihat"
  ```

### Task 2: Kontrak, konstanta `MIN_CLIENT`, dan rute `desktop.releases`

**Files:**
- Modify: `shared/api-versions.ts` (tambah `MIN_CLIENT`)
- Modify: `shared/contract.ts` (DTO + id `desktop.releases` di `ApiContract`)
- Modify: `shared/api.ts` (entri `API_ROUTES`)
- Modify: `server/src/routes.ts` (`ALL_API_IDS`)
- Modify: `server/src/modules/desktop/api.ts` (rute baru)
- Create: `server/src/modules/desktop/releases-dto.ts` (fungsi murni manifest -> DTO)
- Modify: `shared/api-contract.snapshot.json` (lewat `bun run api:snapshot`)
- Create: `server/changelog.d/20261120-01-halaman-unduh-desktop.md`, `desktop/changelog.d/20261120-01-halaman-unduh-desktop.md`
- Test: `server/src/modules/desktop/releases-dto.test.ts`, `server/src/modules/desktop/rest.test.ts`, `shared/api-versions.test.ts`

**Interfaces:**
- Produces:
  - `MIN_CLIENT: { readonly desktop: string }` = `{ desktop: '0.0.0' }` di `shared/api-versions.ts`.
  - `interface DesktopReleaseFileDto { arch: 'x64' | 'arm64'; name: string; size: number; sha512: string; url: string }`, `interface DesktopReleaseDto { version: string; publishedAt: string; changelog: string; files: DesktopReleaseFileDto[] }`, `interface DesktopReleasesDto { enabled: boolean; releases: DesktopReleaseDto[] }` di `shared/contract.ts`; `'desktop.releases': { input: null; output: DesktopReleasesDto }`.
  - `API_ROUTES['desktop.releases'] = { verb: 'GET', path: '/desktop/releases' }`.
  - `toReleaseDto(release: ServedRelease): DesktopReleaseDto` di `releases-dto.ts`: `url` = `/api/desktop/app-file/${encodeURIComponent(version)}/${encodeURIComponent(name)}`; `sha512` base64 -> heksadesimal huruf kecil 128 karakter (`Buffer.from(base64, 'base64').toString('hex')`); `files` urut x64 lalu arm64.
  - Handler `desktop.releases` (tanpa `permission`, `validate` menerima `null`/`undefined`): `reader = releaseReaderOf(env)`; `null` -> `{ enabled: false, releases: [] }`; selain itu `list()` (galat ditelan dengan satu `console.warn('Daftar unduhan desktop: folder rilis tak terbaca')` tanpa pesan galat asli, hasil `[]`), saring `compareVersions(version, MIN_CLIENT.desktop) >= 0`, ambil 50 pertama, `enabled: true`.
- Consumes: `ReleaseReader.list`, `releaseReaderOf` (Task 1); `compareVersions` (`shared/desktop-release.ts`).

- [ ] **Step 1: Tulis tes yang gagal**
  - `releases-dto.test.ts`: untuk `ServedRelease` sampel (sha512 `'A'.repeat(86) + '=='`) `toReleaseDto` menghasilkan `sha512` heksadesimal 128 karakter huruf kecil (`/^[0-9a-f]{128}$/`) yang sama dengan hasil `Buffer` independen; `url` x64 persis `/api/desktop/app-file/1.2.0/QC-App-Setup-1.2.0-x64.exe`; `files` memuat `arch`, `name`, `size`, `url`; `changelog` dan `publishedAt` diteruskan apa adanya.
  - `rest.test.ts` (klien `restCall`/`restClient` dari `@server-test`; fixture Drive seperti `app-routes.test.ts`): (1) tanpa sesi -> 401; (2) `DESKTOP_RELEASES_FOLDER_ID` kosong -> `{ enabled: false, releases: [] }`; (3) dua versi sah -> `enabled: true`, urut menurun, tiap berkas ber-`url` sesuai; (4) versi tanpa `.sig` tidak muncul; (5) `env.BRIDGE.failNext('listFolder', new Error('drive-rahasia-xyz'))` -> status 200, `releases: []`, dan isi respons TIDAK memuat `drive-rahasia-xyz`; (6) pengguna tanpa izin modul apa pun (sesi sah, akun minim) tetap 200.
  - `shared/api-versions.test.ts`: `MIN_CLIENT.desktop` cocok `^\d+\.\d+\.\d+$`.
  - Penyaringan `MIN_CLIENT`: ekspor fungsi murni `filterSupported(releases, minDesktop)` dari `releases-dto.ts` (`ServedRelease[]`, string -> `ServedRelease[]`) dan uji langsung: `minDesktop = '1.2.0'` menyaring `1.1.9` dan mempertahankan `1.2.0`, `1.10.0`; `'0.0.0'` tak menyaring apa pun. Handler memakainya dengan `MIN_CLIENT.desktop`.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd server test src/modules/desktop` — Expected: FAIL (id/rute/modul belum ada).
- [ ] **Step 3: Implementasikan** semua item Interfaces. Daftarkan `desktop.releases` di `desktopApiRoutes()` (perbarui tipe `DesktopMethod` menjadi gabungan dua id) dan di `ALL_API_IDS`; kelompok `desktop` sudah ada di `API_GROUP_VERSIONS`. Jalankan `bun run api:snapshot` dan komit hasilnya. Fragmen changelog: server `feat(desktop): daftar unduhan aplikasi desktop dari server`, desktop `feat(desktop): daftar versi yang didukung dapat dilihat di halaman unduhan web`.
- [ ] **Step 4: Jalankan tes terkait, pastikan lulus**
  Run: `bun test shared && bun run --cwd server test src/modules/desktop && bun run api:snapshot -- --check` (bila `--check` bukan opsi skrip, ganti dengan perintah cek potret yang dipakai `bun run check`; lihat `scripts/api-snapshot.ts`) — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add shared server desktop/changelog.d
  git commit -m "feat(desktop): rute REST daftar rilis aplikasi desktop"
  ```

### Task 3: Deteksi OS/arsitektur dan bendera navigasi `webOnly`

**Files:**
- Create: `web/src/modules/desktop-download/lib/detect-platform.ts`
- Modify: `web/src/app/navigation.ts` (`webOnly` pada `NavItem`, penyaringan di `visibleNavGroups`, butir "Aplikasi Desktop" di grup Umum)
- Test: `web/src/modules/desktop-download/lib/detect-platform.test.ts`, `web/src/app/navigation-desktop.test.ts` (tambah kasus)

**Interfaces:**
- Produces:
  - `type DetectedPlatform = { os: 'windows'; arch: 'x64' | 'arm64' } | { os: 'other' }`.
  - `detectPlatform(nav: { userAgent?: string; platform?: string; userAgentData?: { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string; platform?: string }> } }): Promise<DetectedPlatform>` — fungsi murni yang menerima objek mirip `navigator` (tes tidak menyentuh global). Aturan: Windows bila `userAgentData.platform` atau UA/`platform` memuat "Win" (huruf besar-kecil diabaikan); arsitektur dari `getHighEntropyValues(['architecture','bitness'])` (`'arm'` -> `arm64`, selain itu `x64`); tanpa `userAgentData`: UA memuat `ARM64`/`aarch64` -> `arm64`, selain itu `x64`; `getHighEntropyValues` melempar/menolak -> jatuh ke aturan UA; OS selain Windows (macOS, Linux, Android, iOS) -> `{ os: 'other' }`.
  - `NavItem.webOnly?: boolean` (komentar: "Hanya tampil di peramban (jembatan `window.qcBridge` tak ada); kebalikan `desktopOnly`"), dan butir `{ label: 'Aplikasi Desktop', to: '/desktop', icon: <ikon unduh dari lucide-react, mis. Download>, webOnly: true }` di grup `Umum` setelah Country Lock.
- Consumes: `visibleNavGroups(groups, me, activeLocationIds, desktop)` yang sudah ada.

- [ ] **Step 1: Tulis tes yang gagal**
  - `detect-platform.test.ts`: UA Windows 10 biasa tanpa `userAgentData` -> `{ windows, x64 }`; UA memuat `Windows NT 10.0; ARM64` -> `arm64`; `userAgentData.platform = 'Windows'` + `getHighEntropyValues` -> `{ architecture: 'arm', bitness: '64' }` -> `arm64`, `{ architecture: 'x86', bitness: '64' }` -> `x64`; `getHighEntropyValues` menolak -> jatuh ke UA (hasil tetap tepat, tidak melempar); UA macOS, Linux, Android, iPhone -> `{ os: 'other' }`; objek kosong `{}` -> `{ os: 'other' }`.
  - `navigation-desktop.test.ts`: dengan `desktop=true` butir `/desktop` TIDAK ada di hasil `visibleNavGroups`; dengan `desktop=false` ada dan tampil untuk `me` tanpa izin apa pun; butir `desktopOnly` yang sudah ada tetap perilakunya.
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd web test src/modules/desktop-download src/app/navigation-desktop.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** `detectPlatform` dan bendera `webOnly` (`if (item.webOnly && desktop) return false;` sejajar dengan baris `desktopOnly` di `visibleNavGroups`). Tidak ada izin pada butir baru. Pastikan `app-sidebar.tsx` tak butuh perubahan (ia memakai `visibleNavGroups`).
- [ ] **Step 4: Jalankan tes, pastikan lulus**
  Run: `bun run --cwd web test src/modules/desktop-download src/app/navigation` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add web/src/modules/desktop-download web/src/app/navigation.ts web/src/app/navigation-desktop.test.ts
  git commit -m "feat(web): deteksi OS dan butir navigasi Aplikasi Desktop hanya di peramban"
  ```

### Task 4: Halaman `/desktop`

**Files:**
- Create: `web/src/routes/_app/desktop.tsx` (rute tipis)
- Create: `web/src/modules/desktop-download/queries.ts`
- Create: `web/src/modules/desktop-download/components/desktop-downloads-page.tsx`
- Create: `web/src/modules/desktop-download/lib/format.ts`
- Test: `web/src/modules/desktop-download/components/desktop-downloads-page.test.tsx`, `web/src/modules/desktop-download/lib/format.test.ts`

**Interfaces:**
- Produces:
  - `desktopReleasesQueryOptions()` (`queryKey: ['desktop', 'releases']`, `queryFn: () => api('desktop.releases', null)`); tidak masuk whitelist `query-persist`.
  - `formatBytes(size: number): string` (`1536000` -> `1,5 MB`, koma desimal Indonesia, satuan B/KB/MB/GB), `formatPublishedDate(iso: string): string` (tanggal Indonesia, mis. `18 November 2026`, zona WIB).
  - Komponen `DesktopDownloadsPage({ platform }: { platform: DetectedPlatform })` (props agar tes menyuntik platform; rute memanggil `detectPlatform(navigator)` lewat `useEffect`/`useState` lalu mengoper hasilnya; sebelum terdeteksi dianggap `other`).
- Consumes: `DesktopReleasesDto` (Task 2), `detectPlatform`/`DetectedPlatform` (Task 3).
- Tampilan (spek 5.3 yang diubah): judul "Aplikasi Desktop"; bila `enabled=false` -> pesan "Unduhan belum tersedia" (tanpa daftar); bila `enabled=true` dan `releases` kosong -> "Belum ada versi yang tersedia untuk diunduh"; selain itu kartu utama (versi terbaru, tanggal, tombol unduh `<a href={file.url} download>` untuk berkas dengan `arch` sama dengan platform terdeteksi; platform `other` atau installer arsitektur itu tak ada -> kalimat "Aplikasi desktop baru tersedia untuk Windows" tanpa tombol, daftar tetap tampil); bagian "Versi yang didukung": baris per versi (nomor, tanggal, tautan x64 dan arm64 berukuran, `<details>` "Rincian" berisi `changelog` sebagai TEKS BIASA dengan `whitespace-pre-wrap` (bukan Markdown/HTML), checksum SHA-512 per berkas dengan tombol "Salin"); versi selain yang terbaru diberi catatan "Pasang versi lama hanya bila perlu"; teks bantuan tetap persis dari spek: "Windows mungkin menampilkan peringatan 'penerbit tak dikenal': pilih *Info lebih lanjut* lalu *Tetap jalankan*." dan satu baris perintah `Get-FileHash -Algorithm SHA512 <berkas>`.

- [ ] **Step 1: Tulis tes yang gagal**
  - `format.test.ts`: `formatBytes(0)`, `formatBytes(1023)`, `formatBytes(1536000)` (`1,5 MB`), `formatBytes(105_906_176)` (`101 MB`); `formatPublishedDate('2026-11-18T10:00:00.000Z')` memuat `18 November 2026`.
  - `desktop-downloads-page.test.tsx` (Testing Library, `api` di-mock seperti tes modul lain; ikuti pola `catalog-sync-button.test.tsx` untuk pembungkus Query): (1) `enabled=false` -> teks "Unduhan belum tersedia", tak ada tautan unduh; (2) `enabled=true`, `releases: []` -> "Belum ada versi yang tersedia untuk diunduh"; (3) platform `windows/x64` dengan dua rilis -> tombol utama menuju `url` x64 rilis TERBARU, tampil dua baris di "Versi yang didukung", baris kedua memuat "Pasang versi lama hanya bila perlu" dan baris pertama tidak; (4) platform `windows/arm64` -> tombol utama menuju `url` arm64; (5) platform `other` -> kalimat "Aplikasi desktop baru tersedia untuk Windows", TANPA tombol utama, tautan di daftar tetap ada; (6) rilis terbaru hanya punya installer x64 dan platform `windows/arm64` -> tanpa tombol utama, kalimat yang sama; (7) `changelog` berisi `<script>alert(1)</script>` ditampilkan sebagai teks (tidak ada elemen `script`, teks muncul literal); (8) klik "Salin" memanggil `navigator.clipboard.writeText` dengan heksadesimal berkas itu dan menampilkan konfirmasi "Tersalin"; bila `navigator.clipboard` tak ada atau `writeText` menolak -> tidak melempar dan menampilkan pesan "Tidak bisa menyalin, salin manual" (toast `sonner` atau teks inline; pilih satu dan uji yang dipilih).
- [ ] **Step 2: Jalankan tes, pastikan gagal**
  Run: `bun run --cwd web test src/modules/desktop-download` — Expected: FAIL.
- [ ] **Step 3: Implementasikan** modul dan rute. Rute `createFileRoute('/_app/desktop')` tanpa `beforeLoad` izin; `loader: ({ context }) => context.queryClient.ensureQueryData(desktopReleasesQueryOptions())`; galat server memakai pola penanganan galat halaman yang ada (`describeError`). Pakai komponen shadcn yang sudah ada (`Card`, `Button`, `Badge`; jangan menambah komponen baru bila ada padanannya). Setelah menambah berkas rute, jalankan `bun run --cwd web build` atau `bunx tsr generate` agar `routeTree.gen.ts` (tak terlacak git) termuat bagi typecheck.
- [ ] **Step 4: Jalankan tes web dan typecheck, pastikan lulus**
  Run: `bun run --cwd web test src/modules/desktop-download` lalu `bun run check` (dengan terowongan hidup) — Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add web/src/routes/_app/desktop.tsx web/src/modules/desktop-download
  git commit -m "feat(web): halaman Aplikasi Desktop dengan daftar unduhan versi yang didukung"
  ```

### Task 5: Dokumentasi dan pembaruan spek

**Files:**
- Modify: `CLAUDE.md` (satu butir ringkas di bagian Struktur, dekat butir "Rilis dan pembaruan otomatis aplikasi desktop": rute `desktop.releases`, `MIN_CLIENT`, halaman `/desktop`, bendera `webOnly`)
- Modify: `docs/e2e-checklist-desktop.md` (butir manual: buka `/desktop` di peramban staging, unduh installer sesuai OS, bandingkan SHA-512 dengan `Get-FileHash`, butir tak muncul di dalam aplikasi desktop)
- Modify: `docs/superpowers/specs/2026-11-17-changelog-dan-unduh-desktop-web-design.md` (tandai 5.3 dan rute `desktop.releases` 5.1 sebagai DIBANGUN; catat deviasi: `sha512` di DTO heksadesimal hasil konversi server dari base64 manifest, `MIN_CLIENT` di `shared/api-versions.ts`, bagian `/changelog` belum dibangun)
- Modify: `docs/superpowers/specs/2026-11-20-versi-api-fase3-design.md` (bagian 5b butir 3: catat bahwa halaman `/desktop` sudah ada, rujuk PR-nya setelah dibuat)

- [ ] **Step 1: Tulis pembaruan dokumen** persis seperti butir di atas (tanpa tes; komentar Indonesia santai, tanggal absolut `2026-11-20`).
- [ ] **Step 2: Verifikasi akhir**
  Run: `bun run check` (terowongan hidup) — Expected: PASS (typecheck + Biome + semua tes).
- [ ] **Step 3: Commit**
  ```bash
  git add CLAUDE.md docs
  git commit -m "docs: halaman unduhan desktop dan keputusan 2026-11-20"
  ```
