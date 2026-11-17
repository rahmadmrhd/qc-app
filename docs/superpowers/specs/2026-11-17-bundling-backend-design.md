# Bundling backend server (bagian 3 dari seri rilis semver)

Status: **menunggu persetujuan pemilik** (revisi 1, 2026-11-17). Bagian dari seri: 1 fondasi rilis + changelog dan 2 deploy lewat tag
(`2026-11-17-rilis-semver-design.md`), 3 dokumen ini, 4 rilis desktop + auto-update, 5 halaman unduh + changelog di web.

## 1. Maksud dan alasan
Pemilik bertanya apakah kode backend di image server dapat "di-build seperti FE". Hari ini image menyalin sumber TypeScript
(`server/src`, `shared`), `node_modules` produksi, lalu menjalankan `bun src/main.ts`. Tujuan bagian ini: image membawa **satu
artefak hasil build** yang identik dengan yang diuji, tanpa sumber dan tanpa `node_modules`, sehingga:
- nomor versi dan hash commit dapat **ditanam saat build** (kebutuhan bagian 1: `/api/ping` memuat `version` dan `build`; `package.json`
  tidak lagi ikut di image, jadi tak ada tempat lain untuk membacanya);
- dependensi runtime terkunci di dalam artefak (tidak ada langkah `install` yang bisa berbeda antar build);
- permukaan image lebih kecil (tanpa sumber, tanpa paket yang tak dipakai, tanpa skrip pasca-pasang).

## 2. Cakupan
Di dalam: bundel server (`server/src/main.ts`) dan CLI pemulihan (`scripts/restore-backup.ts`), perubahan Dockerfile, dua titik
`import.meta.dir`, tes dan dokumentasi terkait. Di luar: web (sudah di-build Vite), desktop (bagian 4), mekanisme versi/changelog (bagian 1).

## 3. Hasil uji coba (spike, 2026-11-17, di folder sementara, tanpa mengubah kode produk)
Bun 1.4.2 (versi yang dipatok Dockerfile):
| Percobaan | Hasil |
|---|---|
| `bun build src/main.ts --target=bun` (paket dibundel) | 392 modul, 2,64 MB, 0,3 dtk, tanpa peringatan; hono, mysql2, nodemailer ikut; alias `@shared/*`/`@server/*` terurai lewat tsconfig |
| `--packages=external` | 0,87 MB tetapi tetap butuh `node_modules` di image: tidak mencapai tujuan |
| `--minify` | 1,80 MB: penghematan kecil, jejak galat dan log lebih sulit dibaca |
| Bundel dijalankan tanpa env | memuat dan berhenti dengan pesan validasi konfigurasi yang sama seperti dari sumber |
| Bundel dijalankan ke MariaDB dev (port lain) dengan folder migrasi di tempat yang diharapkan | koneksi mysql2, migrasi, dan `GET /api/ping` = `{"ok":true}` |
| Bundel dijalankan tanpa folder migrasi di tempat itu | **gagal**: `ENOENT scandir .../migrations` |
| `bun build scripts/restore-backup.ts` | 2,56 MB, berhasil |

Temuan penting: di dalam bundel `import.meta.dir` tetap dinilai saat jalan dan berarti **folder berkas bundel**, bukan folder
berkas sumber aslinya. Hanya dua pemakaian di `server/src` (selain tes): `config.ts:312` (folder statis, sudah dapat ditimpa env
`STATIC_DIR`) dan `core/migrate.ts:11` (folder migrasi, belum dapat ditimpa). Dengan tata letak image yang baru, tanpa perbaikan,
jalur migrasi akan menunjuk folder yang salah. Hal yang BELUM diuji: jalur kirim email (nodemailer), jejak galat dengan source map,
waktu start dibanding sumber, ukuran image sesungguhnya (tak ada `docker` di mesin pengembang; diukur di CI/VPS).

## 4. Pendekatan yang dipertimbangkan
| Pilihan | Keterangan | Putusan |
|---|---|---|
| **A. Bundel `bun build --target=bun`, dijalankan `bun server.js`** | satu berkas JS + folder migrasi + folder statis; semua paket dibundel | **dipilih** |
| B. `bun build --compile` (biner mandiri) | satu biner; tetapi `HEALTHCHECK` memakai `bun -e` dan CLI pemulihan dijalankan lewat `bun <berkas>` di kontainer, keduanya butuh runtime Bun terpisah; biner lebih besar | ditolak: mengubah cara operasional tanpa manfaat yang dibutuhkan |
| C. Tetap menyalin sumber + `node_modules` | keadaan sekarang | ditolak: tidak ada tempat menanam versi, dua jalur kode (diuji vs dijalankan) tetap ada |

## 5. Rancangan

### 5.1 Tata letak image baru
```
/app/server/server.js          bundel (hasil bun build server/src/main.ts)
/app/server/server.js.map      source map (eksternal)
/app/server/migrations/*.sql   tetap dari disk (migrator membacanya sebagai berkas)
/app/server/dist/              web hasil build (tak berubah)
/app/scripts/restore-backup.js bundel CLI pemulihan
```
Tidak ada lagi: `node_modules`, `server/src`, `shared`, `package.json`, `tsconfig*`, langkah `find ... -delete` berkas tes.
`ENTRYPOINT ["bun", "server.js"]` (WORKDIR `/app/server` tetap). `HEALTHCHECK`, pengguna `bun`, volume, dan `apk add mariadb-client`
tak berubah.

### 5.2 Dockerfile
Tahap `prod-deps` diganti tahap `server-build` (turunan `manifests`): `bun install --frozen-lockfile --filter @qc/server`, salin
`shared`, `server/src`, `server/tsconfig.json`, `scripts/restore-backup.ts`, `tsconfig.base.json`, lalu dua `bun build`:
- `bun build server/src/main.ts --target=bun --outfile /out/server.js --sourcemap=external --define ...` (nilai versi/hash dari
  `ARG QC_VERSION` dan `ARG GIT_SHA`, bagian 1; tanpa argumen = `dev`/`unknown`).
- `bun build scripts/restore-backup.ts --target=bun --outfile /out/restore-backup.js`.
Tahap `runtime` menyalin `/out`, `server/migrations`, dan `server/dist` dari `web-build`. Tahap `web-build` dan `server-build`
tak saling bergantung sehingga BuildKit membangunnya paralel. Tanpa `--minify`.

### 5.3 Perbaikan jalur (inti risiko)
- `config.ts` menambah `migrationsDir` dari env `MIGRATIONS_DIR` (bawaan `resolve(import.meta.dir, '../migrations')`, benar untuk
  pengembangan dan tes dari sumber). `prepareDatabase` (`boot.ts`) memberikannya ke `loadMigrations(dir)`; parameter `dir` sudah ada.
- Dockerfile mengisi `ENV MIGRATIONS_DIR=/app/server/migrations` dan `ENV STATIC_DIR=/app/server/dist` (yang kedua sudah didukung).
  Dengan begitu tak ada logika yang bergantung pada letak berkas bundel.
- `server/src/deploy-files.test.ts`: `MIGRATIONS_DIR` masuk daftar pengecualian "memakai bawaan image/kode" (seperti `STATIC_DIR`),
  jadi tak wajib di `compose.yml` dan `.env.example`.
- Penjaga baru (tes di `scripts/`): `import.meta.dir`/`import.meta.url`/`__dirname` di `server/src` dan `shared` (bukan tes) hanya
  boleh di daftar putih (`config.ts`, `migrate.ts`); pemakaian baru harus lewat konfigurasi.

### 5.4 Pemulihan cadangan
Perintah operasional berubah dari `bun /app/scripts/restore-backup.ts ...` menjadi `bun /app/scripts/restore-backup.js ...`.
Diperbarui di `docs/setup-google.md` (S8), komentar kepala `scripts/restore-backup.ts`, dan `docs/deploy-vps.md` bila ada rujukan.

### 5.5 Versi dan changelog (hubungan dengan bagian 1)
`QC_VERSION` dan `GIT_SHA` masuk sebagai konstanta build (`--define`), dibaca satu modul kecil (`server/src/core/build-info.ts`,
bawaan `dev`/`unknown` bila tak didefinisikan sehingga sumber tetap jalan). `GET /api/ping` memuat keduanya (bagian 1). Changelog
yang dikompilasi (bagian 1/5) disalin sebagai berkas data ke image (`/app/server/CHANGELOG.md`, jalurnya lewat konfigurasi), bukan
ke dalam bundel.

### 5.6 Tes dan verifikasi
- `scripts/verify-server-bundle.ts` (bagian `bun run build`, dipanggil juga Dockerfile): bundel ada, tak memuat `require`/`import`
  paket eksternal yang tak terurai, ukuran ≤ batas (mulai 4 MB, jadi alarm bila sebuah dependensi membengkak).
- `server/src/bundle.test.ts`: membangun bundel ke folder sementara dan menjalankannya terhadap skema MariaDB sementara harness
  (env `MIGRATIONS_DIR`/`STATIC_DIR` diisi), menunggu `GET /api/ping` 200, lalu mematikannya; satu kasus kirim email lewat transport
  JSON nodemailer pada bundel (menutup celah "belum diuji" di bagian 3); satu kasus jejak galat memuat nama berkas sumber
  (source map bekerja). Bila source map tak terbaca Bun, tes ini yang menangkapnya dan keputusan dikembalikan ke pemilik.
- `deploy-files.test.ts` dan tes Dockerfile yang ada disesuaikan dengan tata letak baru (tidak ada `server/src` di runtime).
- `scripts/ci-changes.ts`: tak perlu berubah (`Dockerfile`, `server/**`, `shared/**` sudah menjalankan image).
- Lulus uji sesungguhnya = deploy staging pertama (healthcheck + `/api/ping` + uji nginx yang sudah ada); gagal = rollback otomatis `deploy.sh`.

## 6. Risiko dan pertanyaan terbuka
- **Perilaku runtime berbeda dari sumber**: `import.meta.dir` (ditangani 5.3), pemakaian `Bun.file` relatif, impor dinamis. Tes
  bundel 5.6 dan penjaga `import.meta` adalah pengaman; sisanya terlihat di staging sebelum production.
- **Jejak galat**: bergantung source map eksternal terbaca Bun; diverifikasi tes, bukan diasumsikan.
- **Rollback ke image lama (sebelum bundling)** tetap bisa: image lama berdiri sendiri dan tak membaca berkas image baru. Sebaliknya
  `restore-backup` berubah ekstensi (5.4): operator harus memakai jalur yang cocok dengan versi image yang berjalan.
- **Manfaat ukuran tidak diukur**: `node_modules` produksi server kecil (diperkirakan puluhan MB di image); manfaat utama adalah satu
  artefak teruji + penanaman versi, bukan penghematan ruang. Ukuran dan waktu start dicatat saat implementasi sebagai pembanding.
- Dependensi dalam bundel tak lagi terlihat sebagai `node_modules`; pemindaian kerentanan harus mengacu `bun.lock` (tak berubah),
  bukan isi image.
- Keputusan saya (bukan pilihan pemilik, dapat diubah): tanpa `--minify`; `.map` ikut di image; nama keluaran `server.js`/`restore-backup.js`.
