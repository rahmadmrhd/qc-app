# QC App — panduan untuk agen

Aplikasi Quality Control: backend Google Apps Script (GAS) + Google Sheets, frontend React single-file yang disajikan GAS.
PRD: `docs/prd/`. Rencana implementasi: `docs/superpowers/plans/`.

## Perintah
- `bun run dev` — FE lokal dengan mock backend (router & layanan GAS asli berjalan in-memory di browser).
- `bun run check` — typecheck + Biome + semua test. Wajib hijau sebelum commit.
- `bun run build` — `gas/dist` (JS per file + `index.html` single-file) lalu `verify-dist`.
- `bun run push` / `bun run deploy` — push ke Apps Script / perbarui deployment tetap (`gas/deployment.json`).
- Bun terpasang di `~/.bun/bin`; bila `bun` tidak ditemukan di shell, tambahkan ke PATH.

## Struktur
- `shared/` — kontrak FE↔GAS (`rpc.ts`) dan model permission. Murni, tanpa API GAS/DOM, import internal relatif.
- `gas/src/` — backend. `main.ts` (doGet, api, setup), `routes.ts`, `core/`, `modules/<modul>/{repo,context,validate,service,routes}.ts`.
- `gas/test-support/` — memory platform & fixture (dipakai test dan mock FE; tidak di-build).
- `web/src/` — `modules/<modul>/` (queries, schemas, components), `routes/` (tipis), `app/` (shell, router, boot), `lib/rpc/`, `modules/theme/` (terang/gelap/sistem).
- `web/src/modules/location/` — lokasi aktif (konteks, pemilih header multi-select) dan `LocationField` untuk form tulis modul berlokasi.
- `web/src/modules/files/` — kecilkan/unggah/tampil gambar (RPC `files.*`); `web/src/modules/markdown/` — render Markdown aman dan editor dengan sisip gambar. Drive hanya lewat `platform_()`.
- `gas/src/modules/sync/` — jalur sinkronisasi QC Desktop (`doPost`): token bersama + pembatas, tabel rute sinkron `getSyncRoutes_` (terpisah dari `getRoutes_`), `sync_state`/`nextRev_` (penghitung revisi; pemanggil memegang lock), sumber daya `brands` dan `items`. Kontrak: `docs/api/desktop-sync.md`. Perubahan field sinkron item/merk WAJIB menaikkan `sync_rev` (lihat `itemSyncSignature_`).
- `web/src/modules/brand/` — halaman Merk (master merk; nama merk dipakai item lewat `brand_id`). Backend: `gas/src/modules/brand/`. Izin memakai modul `item`.
- `web/src/modules/customer/` dan `gas/src/modules/customer/` — master customer (dibuat inline saat task disimpan; halaman hanya ganti nama/status). `web/src/modules/handover/` dan `gas/src/modules/handover/` — Serah Terima WH→QC dan pengerjaan QC; rute `handovers.*` berlokasi (`anyOf` WH/QC untuk baca; `locationId` + `id` untuk tulis, lokasi baris diperiksa ulang). Fungsi murni: `shared/handover.ts` (status turunan, nomor `ST-YYYYMMDD-NNN`) dan `shared/suggest.ts` (saran toleran typo/urutan kata, nama mirip).
- `web/src/modules/item/` — Data Item (daftar, form, detail); detail Markdown dan gambar memakai `modules/markdown` dan `modules/files`. Backend: `gas/src/modules/item/`; fungsi murni (kunci pencarian, hash, rujukan berkas) di `shared/items.ts`.

## Aturan kode GAS (ditegakkan `scripts/build-gas.ts`)
- File di-transpile per file dan `import`/`export` dihapus: semua file berbagi SATU global scope.
- Semua fungsi top-level di `gas/src` WAJIB berakhiran `_` (agar tidak bisa dipanggil via `google.script.run`), kecuali `doGet`, `api`, `setup`.
- Pengecualian terdokumentasi: fungsi murni di `shared/` tidak berakhiran `_` (tidak menyentuh data/API GAS; lihat PRD NFR-2).
- Nama top-level unik di seluruh `gas/src` + `shared/`. Dilarang: `export default`, re-export, import alias/namespace/dynamic, class, enum.
- Tidak ada kode top-level yang memakai global file lain saat load — bungkus dalam fungsi (lihat `getRoutes_`).
- Akses API GAS hanya lewat `platform_()`; implementasi asli di `core/gas-platform.ts`.
- Tulis ke sheet di dalam `platform_().withLock(...)`; teks disimpan lewat `core/db` (aman dari formula injection).
- Jangan pakai API JS yang runtime V8 Apps Script belum tentu dukung (mis. `Object.hasOwn`); aturan Biome `noPrototypeBuiltins` sengaja dimatikan.
- Karakter khusus (mis. U+2028) ditulis lewat `String.fromCharCode`, bukan literal/escape di regex.
- Jangan pernah mengedit `gas/dist/` manual.

## Aturan frontend
- Komponen UI dari shadcn (`web/src/components/ui`, dikecualikan dari lint). Tambah lewat `bunx --bun shadcn@latest add <komponen>` dari folder `web/`. shadcn 4 memakai paket `cn` (shadcn-ui/cn), bukan `clsx`+`tailwind-merge`.
- Server state: TanStack Query; form: TanStack Form + zod; filter/halaman: search params Router. Tanpa library state global.
- Tema: `modules/theme` (kelas `dark` di `<html>`); skrip anti-kedip di `web/index.html` harus selaras dengan `theme.ts`.
- Jangan menaruh kode mock di build produksi (dicek `scripts/verify-dist.ts`).

## Menambah method RPC
1. Tambah entri di `RpcContract` (`shared/rpc.ts`).
2. Validator + handler di `gas/src/modules/<modul>/`, daftarkan di `<modul>/routes.ts` dengan `permission` yang tepat.
3. `getRoutes_` bertipe `RouteTable` — typecheck gagal bila method belum terdaftar.
4. FE: `queryOptions`/mutation di `web/src/modules/<modul>/queries.ts`.
5. Modul berlokasi: tandai `scope: 'location'` pada izin rute dan pakai `ctx.locationIds` (lihat `docs/adding-a-module.md`). Izin "salah satu dari": pakai `anyOf` (lihat `docs/adding-a-module.md`).

Resep modul baru: `docs/adding-a-module.md`.

## Tooling agen
- `.mcp.json`: `clasp mcp` (push/deploy/log) dan `shadcn mcp` (cari & tambah komponen).
- Skill TanStack: `bunx @tanstack/intent@latest list` menampilkan skill yang ada di dependency (router-core, router-plugin, dll.); muat dengan `bunx @tanstack/intent@latest load <paket>#<skill>`. Untuk menulis blok panduan otomatis, jalankan `bunx @tanstack/intent@latest install` di terminal interaktif (butuh konfirmasi izin).
- Matikan telemetri CLI TanStack: `TANSTACK_CLI_TELEMETRY_DISABLED=1`.
