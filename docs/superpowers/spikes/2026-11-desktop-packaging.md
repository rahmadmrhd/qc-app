# Spike pengemasan QC App Desktop (Task 6)

Tanggal: 2026-11-12. Mesin: Windows 11 x64, Bun 1.4.2, Node 26.12 (pengembang). Tujuan: membuktikan
bahwa workspace `desktop/` dapat dikemas menjadi aplikasi Electron + installer NSIS dan bahwa
runtime yang DIKIRIM (bukan runtime pengembang) memuat `ssh2` dan `node:sqlite`.

## Hasil

| Pertanyaan | Hasil |
|---|---|
| Versi terpasang | Electron 45.0.0, electron-builder 26.18.0, ssh2 1.17.0 (sesuai pin Global Constraints) |
| Node di dalam Electron 45.0.0 | **24.22.0** (`process.versions.node` dari hasil kemas) |
| `ssh2` termuat dari hasil kemas | ya (JS murni; `cpu-features` opsional tidak ada, ssh2 jatuh ke implementasi JS) |
| **`node:sqlite` tersedia di Electron** | **ya**: `DatabaseSync(':memory:')` membuat tabel, menyisipkan, dan membaca baris di hasil kemas. Alternatif `better-sqlite3` TIDAK diperlukan; Task 12 memakai `node:sqlite` |
| `bun run --cwd desktop pack` | berhasil (~18 dtk setelah Electron ter-cache), `desktop/dist-app/win-unpacked/QC App.exe` |
| `bun run --cwd desktop verify-pack` | lolos: `{"node":"24.22.0","electron":"45.0.0","ssh2":true,"sqlite":true}` |
| `bun run --cwd desktop dist` (NSIS) | berhasil (~100 dtk pada eksekusi pertama karena mengunduh 7zip dan NSIS): `QC App Setup 0.1.0.exe` |

Ukuran (UI dasar = `bun run build:web`, 3,1 MB di `server/dist`):

| Artefak | Ukuran |
|---|---|
| `win-unpacked` (seluruhnya) | 361 MB (`QC App.exe` = 239 MB: runtime Electron/Chromium; UI dasar 3,1 MB) |
| `app.asar` (kode aplikasi + ssh2 dan dependensinya) | 0,65 MB |
| Installer NSIS | 117 MB (122.617.044 byte) |

`oneClick: false` dan `perMachine: false` (pemasangan per pengguna tanpa hak admin) memakai bentuk
NSIS standar; menjalankan installer dan uninstaller TIDAK diuji di sini (hanya dibangun).

## Cara kerja dan bentuk kemas

- `scripts/build.ts` membundel `src/main/index.ts` dengan `Bun.build` (target `node`, format ESM
  karena `package.json` memakai `"type": "module"`; `external`: `electron`, `ssh2`, `node:sqlite`).
  Preload (ada sejak Task 14) dibundel sebagai CommonJS `.cjs` agar jalan di renderer ter-sandbox.
- `electron-builder.yml`: `files` hanya `dist/**` dan `package.json`; `npmRebuild: false` (tidak ada
  modul native); `extraResources` menyalin `../server/dist` ke `resources/ui-baseline`.
- Entri main sementara hanya menangani `--smoke` (mencetak satu baris JSON lalu `app.exit(0)`).
  Task 14 menggantikannya.
- `verify-pack` menghapus `ELECTRON_RUN_AS_NODE` dari lingkungan, menjalankan exe, dan juga
  memeriksa `resources/ui-baseline/index.html`.

## Masalah dan catatan monorepo

1. **Hoisting.** Bun memakai penaut terisolasi (`node_modules/.bun`), dan `ssh2` berada di
   `desktop/node_modules`. electron-builder mendeteksi `bun` dan lockfile di akar workspace,
   lalu membangun pohon dependensi dengan penelusuran `node_modules` (log: "bun does not support any
   CLI for dependency tree extraction, utilizing file traversal collector"). Hasilnya benar: `app.asar`
   memuat `ssh2` dan dependensinya (`asn1`, `bcrypt-pbkdf`, `safer-buffer`, `tweetnacl`, plus `nan`
   opsional). Tidak ada paket workspace lain yang terbawa. Peringatan "missing optional
   dependencies cpu-features" tidak berbahaya.
2. **Skrip pascapasang Electron tidak dijalankan `bun install`** (Bun tidak mempercayai skrip
   dependensi kecuali dicantumkan di `trustedDependencies`), sehingga `desktop/node_modules/electron/dist`
   kosong sampai `node desktop/node_modules/electron/install.js` dijalankan. Itu hanya diperlukan untuk
   menjalankan `electron .` secara lokal; `pack`/`dist` mengunduh zip Electron sendiri lewat
   electron-builder dan tidak terpengaruh. Akar `package.json` sengaja TIDAK diberi
   `trustedDependencies` (mengubah `bun install` untuk semua sesi dan CI); putuskan terpisah bila perlu.
3. **Node uji berbeda dari Node yang dikirim.** Tes `desktop/` berjalan di Node pengembang (26.x) lewat
   vitest; Electron 45 membawa Node 24.22. Karena itu `verify-pack` (smoke pada hasil kemas) adalah
   bukti runtime sebenarnya, bukan hasil `vitest`.
4. **Tanpa ikon dan tanpa tanda tangan.** electron-builder memakai ikon Electron bawaan dan melewati
   penandatanganan (tidak ada sertifikat; spek 3.3). Penyuntingan sumber daya exe (rcedit) berjalan
   tanpa masalah pada mesin ini.
5. **Log build**: `bun.lock` bertambah untuk workspace baru (Electron, electron-builder, ssh2, vitest,
   zod, dan dependensinya); beberapa entri yang sebelumnya terangkat ke akar (mis. `@types/node`)
   tersusun ulang oleh Bun.
