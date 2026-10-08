# PRD — QC App: Fondasi & Sistem Akses (Sub-project 1)

| | |
|---|---|
| **Status** | Draft — menunggu review |
| **Tanggal** | 2026-10-08 |
| **Pemilik** | rahmadm.rhd@gmail.com |
| **Apps Script ID** | `1JyiAAtAAytBWzuWp5rZgCVQrXCXb7lrEYtbcH1OPDvylQSUGVtArrX_U` |
| **Akun pemilik/deployer** | qcspectrum123@gmail.com |

---

## 1. Ringkasan

QC App adalah aplikasi web internal untuk kebutuhan Quality Control, dibangun di atas Google Apps Script (GAS) sebagai backend dan Google Spreadsheet sebagai database, dengan frontend React yang di-build menjadi satu file HTML dan disajikan oleh GAS.

Dokumen ini mencakup **Sub-project 1: Fondasi & Sistem Akses** — kerangka project, pipeline build/deploy, lapisan komunikasi FE↔GAS, login dengan akun Google, serta pengelolaan user, role, dan permission per modul. Modul domain (Data Item, Serah Terima QC–WH, Monitoring Stok) masing-masing akan punya PRD sendiri dan dibangun di atas fondasi ini.

## 2. Latar Belakang & Tujuan

### 2.1 Kebutuhan produk keseluruhan
1. **Serah terima QC–WH** — alur handover barang antara QC dan Warehouse.
2. **Monitoring stok yang belum di-QC.**
3. **Data Item + lampiran gambar** sebagai panduan penempelan stiker.
4. **Sistem permission** — identitas dari akun Google yang login; hak akses diatur per modul.

### 2.2 Roadmap sub-project
| # | Sub-project | Status |
|---|---|---|
| 1 | **Fondasi & Sistem Akses** (dokumen ini) | Draft |
| 2 | Data Item + lampiran gambar | Belum dimulai |
| 3 | Serah Terima QC–WH | Belum dimulai |
| 4 | Monitoring Stok belum QC | Belum dimulai |

Urutan 2–4 dapat disesuaikan; Data Item kemungkinan menjadi master data bagi modul lain.

### 2.3 Tujuan Sub-project 1
- **G1.** Developer dapat mengembangkan FE secara lokal (tanpa GAS) dan melakukan build + push + deploy ke GAS dengan satu perintah.
- **G2.** Hanya email yang terdaftar (whitelist) yang dapat masuk; spreadsheet database tetap privat milik akun pemilik.
- **G3.** Admin dapat mengelola user, role, dan level akses per modul tanpa menyentuh spreadsheet secara langsung.
- **G4.** Setiap pemanggilan backend ditegakkan permission-nya di server — tidak ada endpoint yang lolos pemeriksaan.
- **G5.** Menambah modul baru cukup mengikuti resep yang terdokumentasi, tanpa mengubah fondasi.

### 2.4 Non-goals
- Halaman dan logika modul Data Item, Serah Terima, dan Monitoring Stok.
- Upload / penyimpanan gambar (bagian dari PRD Data Item).
- Notifikasi (email/chat), laporan, ekspor.
- Dukungan offline.

## 3. Pengguna & Peran

| Persona | Deskripsi | Kebutuhan utama di sub-project ini |
|---|---|---|
| **Super Admin** | Email yang diset di Script Property `ADMIN_EMAIL`. | Selalu bisa masuk dan mengelola akses, termasuk saat sheet user masih kosong. |
| **Admin Akses** | User dengan level `manage` pada modul `access`. | Menambah/menonaktifkan user, membuat role, mengatur level per modul. |
| **Staf (QC / WH / Supervisor)** | User terdaftar dengan satu atau lebih role. | Login dengan akun Google, melihat menu sesuai haknya. |
| **Pengunjung tidak terdaftar** | Siapa pun dengan URL aplikasi. | Mendapat pesan jelas bahwa emailnya belum terdaftar. |

Pengguna memakai **akun Gmail pribadi atau campuran domain** (bukan satu domain Workspace).

## 4. Kebutuhan Fungsional

### 4.1 Autentikasi
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-A1 | User login dengan tombol "Masuk dengan Google". | Klik tombol membuka halaman pemilihan akun Google di jendela utama; setelah memilih akun, user kembali ke aplikasi dalam keadaan login. |
| FR-A2 | Hanya email whitelist berstatus `active` (atau `ADMIN_EMAIL`) yang diterima. | Email lain melihat halaman "Email Anda belum terdaftar, hubungi admin" beserta email yang dipakai; tidak ada data yang dimuat. |
| FR-A3 | Session bertahan 7 hari. | Membuka ulang aplikasi dalam 7 hari tidak meminta login ulang; setelahnya diarahkan ke halaman login. |
| FR-A4 | Logout. | Tombol logout menghapus session di perangkat itu dan kembali ke halaman login. |
| FR-A5 | Pencabutan akses berlaku cepat. | User yang dinonaktifkan atau diubah role-nya terkena dampak paling lambat 5 menit, dan langsung bila perubahan dilakukan lewat UI admin (cache di-invalidate). |
| FR-A6 | URL bersih & deep link. | Parameter `code`/`state` hilang dari address bar setelah login; refresh atau membuka bookmark mempertahankan halaman yang sedang dibuka. |

### 4.2 Permission
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-P1 | Level akses per modul: `none` < `view` < `edit` < `manage`. | Daftar modul awal: `access`, `item`, `handover`, `stock`. |
| FR-P2 | User dapat memiliki banyak role; level efektif = level tertinggi di antara role-nya. | Contoh: role A `item:view` + role B `item:manage` ⇒ `item:manage`. |
| FR-P3 | `ADMIN_EMAIL` selalu `manage` di semua modul. | Berlaku walau sheet `users` kosong atau terhapus. |
| FR-P4 | Server menolak aksi di bawah level yang dibutuhkan. | Panggilan RPC langsung dengan level kurang mengembalikan error `FORBIDDEN`. |
| FR-P5 | UI menyesuaikan dengan permission. | Menu, halaman, dan tombol aksi yang tidak diizinkan disembunyikan/dinonaktifkan; membuka URL halaman terlarang menampilkan halaman 403. |

Makna rinci tiap level per modul (mis. apa arti `manage` di Serah Terima) ditetapkan di PRD modul masing-masing. Pedoman umum: `view` = membaca, `edit` = menambah/mengubah, `manage` = menghapus, menyetujui, dan pengaturan modul.

### 4.3 Pengelolaan Akses (modul `access`)
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-M1 | Daftar user. | Tabel email, nama, role, status; dapat dicari dan difilter status. Butuh `access:view`. |
| FR-M2 | Tambah / ubah user. | Form: email (valid, unik, disimpan lowercase), nama, multi-role, status. Butuh `access:manage`. |
| FR-M3 | Nonaktifkan / aktifkan user. | Tidak ada hapus permanen. Admin tidak dapat menonaktifkan dirinya sendiri. |
| FR-M4 | Daftar role. | Nama, deskripsi, ringkasan level per modul, jumlah user. |
| FR-M5 | Tambah / ubah role. | Form nama (unik), deskripsi, dan matriks modul × level. |
| FR-M6 | Hapus role. | Ditolak (`CONFLICT`) bila role masih dipakai user. |
| FR-M7 | Audit log. | Setiap perubahan user/role tercatat: waktu, pelaku, aksi, target, detail perubahan. |

### 4.4 Shell Aplikasi
| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-S1 | Layout utama. | Sidebar (menu sesuai akses), header berisi nama/email user dan logout, responsif di layar ponsel. |
| FR-S2 | Beranda. | Kartu modul yang dapat diakses user; modul yang belum dibangun ditandai "Segera hadir". |
| FR-S3 | Halaman status. | Login, belum terdaftar, 403, 404, dan error umum (menampilkan `requestId` untuk dilaporkan). |
| FR-S4 | Tema tampilan. | Pengguna dapat memilih Terang, Gelap, atau Ikuti sistem dari tombol di header (dan halaman login); pilihan tersimpan di perangkat, diterapkan sebelum render pertama (tanpa kedipan), dan notifikasi (toast) mengikuti tema. |

## 5. Kebutuhan Non-Fungsional

| ID | Kategori | Kebutuhan |
|---|---|---|
| NFR-1 | Keamanan | Web app di-deploy **Execute as: Me**, **Access: Anyone**. Spreadsheet dan Drive tidak di-share ke user. Secret (client secret, session secret) hanya di Script Properties, tidak pernah dikirim ke klien. |
| NFR-2 | Keamanan | Hanya `doGet` dan `api` yang dapat dipanggil dari klien; fungsi lain berakhiran `_`. Error tak terduga tidak membocorkan stack trace ke klien. |
| NFR-3 | Keamanan | Login memakai parameter `state` sekali-pakai (anti-CSRF); `id_token` divalidasi `iss`, `aud`, `exp`, `email_verified`. |
| NFR-4 | Integritas data | Operasi tulis memakai `LockService` agar aman terhadap penyimpanan bersamaan. |
| NFR-5 | Performa | Muat awal aplikasi ≤ 4 detik pada koneksi kantor; panggilan RPC baca tipikal ≤ 3 detik. Konteks user di-cache untuk menghindari pembacaan sheet berulang. |
| NFR-6 | Kuota | Beroperasi dalam kuota akun Gmail consumer (eksekusi ≤ 6 menit, UrlFetch 20.000/hari). |
| NFR-7 | Kompatibilitas | Chrome, Edge, Safari versi terbaru, desktop dan ponsel. |
| NFR-8 | Maintainability | TypeScript strict di FE dan GAS; kontrak FE↔GAS bertipe tunggal di `shared/`. |

## 6. Arsitektur & Keputusan Teknis

### 6.1 Stack
- **Runtime/paket:** Bun versi terbaru (workspaces).
- **Frontend:** React, TypeScript, Vite, TanStack Router (**hash history**), TanStack Query, TanStack Form, zod, shadcn/ui, Tailwind CSS v4, `vite-plugin-singlefile`. Diinisialisasi dengan TanStack CLI.
- **Backend:** Google Apps Script (V8), TypeScript, tanpa dependency npm di runtime.
- **Deploy:** clasp 3.x.
- **State global klien:** tidak memakai library state global. Server state di TanStack Query, form state di TanStack Form, filter/halaman di search params Router. Bila kelak dibutuhkan, **TanStack Store** menjadi pilihan pertama (sudah terpasang lewat TanStack Form); Zustand dipertimbangkan hanya bila butuh middleware `persist`/`devtools`.
- **TanStack DB:** tidak dipakai di fondasi. Dicatat sebagai **kandidat evaluasi untuk modul Data Item dan Monitoring Stok** (memuat sheet sekali, filter/join instan di klien, optimistic mutation).

### 6.2 Struktur folder
```
qc/
├─ package.json            # Bun workspaces + skrip orkestrasi
├─ shared/                 # kontrak FE↔GAS, tanpa dependency npm
│  ├─ rpc.ts               # RpcContract, RpcResult, ErrorCode
│  └─ permissions.ts       # MODULES, LEVELS
├─ gas/
│  ├─ appsscript.json      # manifest sumber
│  ├─ .clasp.json          # scriptId, rootDir: "dist"
│  ├─ src/                 # TS source (tidak di-push)
│  │  ├─ main.ts           # doGet, api — satu-satunya global publik
│  │  ├─ core/             # router RPC, session, db repository, config, errors, adapter API GAS
│  │  └─ modules/
│  │     ├─ auth/
│  │     └─ access/
│  └─ dist/                # hasil build — SATU-SATUNYA yang di-push (gitignored)
│     ├─ appsscript.json, *.js
│     └─ index.html        # hasil build FE
├─ web/
│  └─ src/
│     ├─ routes/           # file-route TanStack (tipis, mendelegasikan ke modules)
│     ├─ app/              # router, QueryClient, layout shell
│     ├─ lib/rpc/          # transport gas & mock
│     ├─ components/ui/    # shadcn
│     └─ modules/{auth,access}/
└─ docs/
```

### 6.3 Pipeline build & deploy
| Perintah | Fungsi |
|---|---|
| `bun run dev` | Vite dev server dengan transport **mock** (login palsu, pilih user/role). |
| `bun run build:web` | Build FE menjadi `gas/dist/index.html` (JS/CSS/aset di-inline). |
| `bun run build:gas` | Transpilasi **per file** `gas/src/**` dan `shared/**` ke `gas/dist/`, menghapus `import`/`export` (GAS berbagi satu global scope), menyalin `appsscript.json`. Gagal bila ada nama global duplikat. |
| `bun run check` | `tsc --noEmit` semua workspace + Biome + seluruh test. |
| `bun run push` | build + `clasp push`. |
| `bun run deploy` | push + `clasp deploy -i <deploymentId>` — **deployment ID tetap** agar URL `/exec` (redirect URI OAuth) tidak berubah. |

Konsekuensi build per file: nama top-level harus unik antar file; tidak boleh ada kode top-level yang bergantung pada urutan load file (registry dibangun lazy di dalam fungsi).

### 6.4 Lapisan RPC
- Kontrak tunggal `RpcContract` di `shared/rpc.ts`: peta `method → { input, output }`.
- Pintu masuk tunggal GAS: `api(method: string, payloadJson: string, token: string): string`. Payload & respons berupa string JSON; tanggal sebagai ISO string.
- Respons: `{ ok: true, data } | { ok: false, error: { code, message, requestId } }`.
- `ErrorCode`: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `INTERNAL`.
- Setiap route mendeklarasikan `{ module, level, handler }` atau `{ public: true, handler }`. Router: verifikasi token → muat konteks user (cache) → cek level → validasi input → handler → bungkus hasil.
- FE: `rpc(method, input)` bertipe penuh, melempar `RpcError`. Transport dipilih saat build (`gas` / `mock`). Tiap modul menyediakan factory `queryOptions` dan hook mutation.
- Penanganan global di QueryClient: `UNAUTHENTICATED` → hapus token, ke `/login`; `FORBIDDEN` → halaman/toast 403; retry 1× hanya untuk `INTERNAL`/jaringan.
- Validasi form di FE dengan zod; server memvalidasi ulang.

### 6.5 Autentikasi (OAuth Authorization Code, sisi server)
1. `doGet(e)` tanpa `code`: buat `state` acak (CacheService, 6 jam — agar link login di halaman yang lama terbuka tetap berlaku), render `index.html` dengan `window.__BOOT__ = { loginUrl }` yang disisipkan lewat penggantian placeholder `<!--BOOT-->` (bukan template `<? ?>`), JSON di-escape.
2. Tombol login: `<a href={loginUrl} target="_top">`, scope `openid email`, `prompt=select_account`.
3. Callback `/exec?code&state`: validasi & hapus `state` → tukar `code` di `oauth2.googleapis.com/token` → validasi `id_token` → cek whitelist → sisipkan `__BOOT__ = { sessionToken }` atau `{ authError: 'NOT_WHITELISTED' | 'LOGIN_FAILED' }`.
4. FE menyimpan token di `localStorage`, membersihkan URL via `google.script.history.replace`.
5. **Session token:** `base64url(payload).base64url(HMAC-SHA256(payload, SESSION_SECRET))`, payload `{ email, iat, exp }`, berlaku 7 hari, stateless. Setiap request membaca ulang status & role user (cache ±5 menit, di-invalidate saat admin mengubah data). Paksa logout semua user: ganti `SESSION_SECRET`.
6. Deep link: hash route di iframe disinkronkan ke URL atas via `google.script.history` dan `google.script.url.getLocation`.

### 6.6 Data model (spreadsheet `SPREADSHEET_ID`)
Baris 1 = header; pemetaan kolom berdasarkan nama header. Sheet dibuat otomatis (idempotent) bila belum ada.

| Sheet | Kolom |
|---|---|
| `users` | `id`, `email` (lowercase, unik), `name`, `status` (`active`/`inactive`), `role_ids` (JSON array), `created_at`, `updated_at`, `updated_by` |
| `roles` | `id`, `name` (unik), `description`, `permissions` (JSON, mis. `{"item":"edit"}`), `created_at`, `updated_at`, `updated_by` |
| `audit_log` | `ts`, `actor`, `action`, `target`, `detail` (JSON) |

Relasi disimpan sebagai kolom JSON (bukan sheet relasi) agar tidak perlu join antar-sheet dan setiap simpan cukup menulis satu baris.

### 6.7 Manifest GAS (`appsscript.json`)
- `runtimeVersion: "V8"`, `timeZone: "Asia/Jakarta"`.
- `webapp: { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" }`.
- `oauthScopes` eksplisit minimal: spreadsheets, `script.external_request` (UrlFetch). Scope Drive ditambahkan saat modul Data Item.

## 7. Konfigurasi & Operasional

**Script Properties:**
| Key | Isi |
|---|---|
| `SPREADSHEET_ID` | ID spreadsheet database |
| `OAUTH_CLIENT_ID` | Client ID OAuth (tipe Web) |
| `OAUTH_CLIENT_SECRET` | Client secret OAuth |
| `OAUTH_REDIRECT_URI` | URL `/exec` deployment tetap |
| `SESSION_SECRET` | String acak ≥ 32 byte |
| `ADMIN_EMAIL` | Email super admin |

**Google Cloud (sekali setup):** OAuth consent screen *External*, status *In production*, scope `openid email` (tidak memerlukan verifikasi Google); OAuth Client tipe *Web application* dengan redirect URI = URL `/exec`.

**Prasyarat mesin developer:** Bun (belum terpasang saat PRD ditulis), clasp 3.x (terpasang, sudah login), Git.

## 8. Kualitas & Pengujian

- **GAS & shared (`bun test`):** API GAS diakses lewat adapter tipis sehingga bisa diganti fake. Diuji: sign/verify token (termasuk kedaluwarsa & dimanipulasi), resolusi level multi-role & super admin, router RPC (route tak dikenal, belum login, level kurang, validasi, error tak terduga → `INTERNAL`), validasi `id_token` & `state`, pemetaan baris↔objek, aturan bisnis akses.
- **Skrip build GAS (`bun test`):** output bebas `import`/`export`, deteksi global duplikat, manifest tersalin.
- **FE (Vitest + Testing Library):** client `rpc` & pemetaan error, `can()` & guard route, form user/role, penanganan global `UNAUTHENTICATED`/`FORBIDDEN`.
- **Quality gate:** `bun run check` wajib hijau sebelum push.
- **E2E manual di deployment** (checklist di dokumentasi): login sukses, email non-whitelist, user nonaktif, akses per level, panggilan `api` langsung dengan level kurang → `FORBIDDEN`, refresh/deep link.

## 9. Tooling Agen & Dokumentasi

- `.mcp.json` project: **clasp MCP**, **shadcn MCP**.
- **TanStack Intent** untuk memasang skill resmi TanStack (Router, Query, Form) ke project.
- `CLAUDE.md` project: konvensi modul, aturan global GAS, cara menambah method RPC, perintah build/push/deploy, larangan mengedit `gas/dist` manual.
- Dokumentasi: `README.md`, `docs/setup-google.md` (checklist GCP, Script Properties, deploy pertama), `docs/adding-a-module.md` (resep modul baru).
- Perintah persis tiap tool diverifikasi saat implementasi; bila tidak tersedia, dicari padanannya dan dilaporkan.

## 10. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Deployment ID berubah → redirect URI OAuth tidak cocok | Login gagal total | Selalu deploy ke deployment ID tetap (`bun run deploy`); didokumentasikan. |
| `localStorage` di iframe sandbox dibersihkan browser (mis. kebijakan Safari) | User harus login ulang lebih sering | Dapat diterima; login hanya satu klik. |
| Ukuran single-file HTML membengkak | Muat awal lambat | Pantau ukuran build; code-splitting tidak tersedia di single-file, jadi jaga dependency tetap ramping. |
| Nama global bentrok antar file GAS | Perilaku runtime salah | Build gagal saat mendeteksi duplikat. |
| Pembacaan sheet lambat seiring data bertambah | Respons RPC lambat | Cache konteks user; evaluasi TanStack DB & strategi cache per modul. |
| Spreadsheet diedit manual oleh pemilik | Data tidak valid | Pemetaan berdasarkan header; validasi saat membaca; audit log untuk perubahan via aplikasi. |

## 11. Definition of Done

- [ ] `bun run dev` menjalankan aplikasi lokal dengan login mock dan seluruh UI akses.
- [ ] `bun run check` hijau.
- [ ] `bun run deploy` menghasilkan web app yang berfungsi di URL `/exec` tetap.
- [ ] Seluruh kriteria penerimaan FR-A*, FR-P*, FR-M*, FR-S* terpenuhi pada checklist E2E manual.
- [ ] `docs/setup-google.md` cukup untuk men-setup ulang dari nol oleh orang lain.
- [ ] `docs/adding-a-module.md` siap dipakai untuk Sub-project 2.

## 12. Pertanyaan Terbuka

1. Apakah spreadsheet database sudah ada (dan apakah script ini *bound* ke spreadsheet tersebut), atau perlu dibuat baru?
2. Siapa email `ADMIN_EMAIL` — `qcspectrum123@gmail.com` atau email lain?
3. Apakah masa berlaku session 7 hari sesuai kebijakan internal?
4. Apakah nama tampilan aplikasi (judul tab, header) cukup "QC App", atau ada nama lain?
