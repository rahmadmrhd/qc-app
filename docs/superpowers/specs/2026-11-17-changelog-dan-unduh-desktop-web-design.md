# Changelog dan halaman unduh desktop di web (bagian 5 dari seri rilis semver)

Status: **menunggu persetujuan pemilik** (revisi 1, 2026-11-17). Seri: 1 fondasi rilis + changelog dan 2 deploy lewat tag
(`2026-11-17-rilis-semver-design.md`), 3 bundling backend (`2026-11-17-bundling-backend-design.md`), 4 rilis desktop + auto-update
(`2026-11-17-rilis-desktop-auto-update-design.md`), **5 dokumen ini**. Dokumen ini menetapkan hal yang bagian 1 dan 4 serahkan
ke sini: bentuk berkas yang dibaca server, tampilan changelog, dan halaman unduh.

## 1. Maksud dan alasan
Pemilik minta (2026-11-17): pengguna tahu **apa yang berubah di web yang sedang mereka pakai**, dan pengguna dapat mengunduh
aplikasi desktop yang sesuai OS-nya, per versi, lengkap dengan changelog, padahal repositori privat. Bagian 1 sudah menetapkan
changelog ditulis tangan per PR dan masuk ke image; bagian 4 menetapkan penyimpanan dan manifest installer. Dokumen ini
membuat keduanya terbaca pengguna.

## 2. Cakupan
Di dalam: format `CHANGELOG.md` dan parsernya, dua rute REST baru, halaman `/changelog` ("Pembaruan") dan `/desktop` ("Aplikasi Desktop"),
penanda "ada yang baru", versi di antarmuka, tes. Di luar: pembuatan changelog/rilis (bagian 1), penyimpanan dan penandatanganan
installer (bagian 4), panduan interaktif baru (halaman informasi sederhana; tidak perlu tur), notifikasi push untuk rilis.

## 3. Pendekatan yang dipertimbangkan
| Pertanyaan | Pilihan | Ditolak karena |
|---|---|---|
| Sumber changelog web | **`server/CHANGELOG.md` yang dibawa image, diurai server** | Memanggil GitHub API: butuh token repo privat di server (bagian 4, 4.1). Menanam ke bundel web: setiap rilis membangun ulang web |
| Dari mana web tahu versinya | **Runtime, dari server** (rute 5.2) | Konstanta build web: `ARG` versi membatalkan cache lapisan web tiap rilis, tanpa manfaat berarti |
| Penanda "ada yang baru" | **Versi terakhir dilihat di `localStorage` per email per perangkat** | Tabel basis data per akun: migrasi dan perubahan skema untuk fitur kecil; akun bersama (kasus nyata di sini, lihat Panduan Interaktif) tetap bermasalah |
| Daftar rilis desktop | **Dibaca server dari Drive (folder bagian 4) dan disajikan REST bersesi** | Halaman membaca Drive langsung (tak mungkin: kunci di server) |

## 4. Format `CHANGELOG.md` (ditetapkan di sini untuk bagian 1)
```
## [1.4.0] - 2026-11-17
### Ditambah
- Kalimat untuk pengguna.
### Diubah
- ...
### Diperbaiki
- ...
### Internal
- Hanya tampil di GitHub Release.
```
- Tiap versi satu bagian `## [X.Y.Z] - YYYY-MM-DD` (tanggal WIB), terbaru di atas. Bagian jenis kosong tidak ditulis; `### Internal` ditulis
  bila ada fragmen `internal`. `scripts/changelog.ts compile` menghasilkannya persis begini.
- Parser murni `shared/changelog.ts`: `parseChangelog(markdown): ChangelogRelease[]` dan tipe `ChangelogRelease = { version, date,
  groups: { added: string[]; changed: string[]; fixed: string[] } }` (**`Internal` dibuang**, tak pernah sampai ke pengguna). Toleran:
  baris tak dikenal diabaikan, versi/tanggal tak valid melewatkan bagian itu (bukan menggagalkan seluruh berkas), tiap butir dipotong
  300 karakter, karakter kontrol dan pengatur arah teks dibuang (`stripControlChars`). Urutan hasil: semver menurun.
- Bagian desktop memakai parser dan bentuk `groups` yang sama; `release.json` (bagian 4, 5.2) menyimpan `changelog` sebagai
  `ChangelogRelease['groups']`, bukan Markdown, sehingga server dan web tak perlu mengurai Markdown lagi.
- Teks butir **selalu dirender sebagai teks biasa** (bukan Markdown/HTML), jadi isi changelog tak dapat menyisipkan tautan atau markup.

## 5. Rancangan

### 5.1 Server
- Konfigurasi `CHANGELOG_FILE` (bawaan `resolve(import.meta.dir, '../CHANGELOG.md')`, Dockerfile mengisi `/app/server/CHANGELOG.md`;
  mengikuti pola `MIGRATIONS_DIR` bagian 3). Dibaca dan diurai sekali secara malas, hasil di memori; berkas hilang atau rusak =
  daftar kosong (bukan galat; fitur tetap hidup tanpa isi).
- Modul `server/src/modules/changelog/`: rute `app.changelog` (REST `GET /api/v1/app/changelog`, **tanpa izin modul**, cukup sesi
  seperti lonceng/panduan). Jawaban `AppChangelogDto = { version, build, releases: ChangelogRelease[] }` (maks. 50 rilis terbaru);
  `version`/`build` dari `build-info` (bagian 3, 5.5).
- Rute `desktop.releases` (REST `GET /api/v1/desktop/releases`, tanpa izin modul, sesi): memakai pembaca rilis Drive bagian 4
  (`desktop/releases-store.ts`, cache memori menit). Jawaban `DesktopReleasesDto = { enabled, releases: DesktopReleaseDto[] }`;
  `DesktopReleaseDto = { version, publishedAt, changelog, files: [{ arch: 'x64'|'arm64', name, size, sha512, url }] }`, `url` =
  `/api/desktop/app-file/<versi>/<nama>` (rute publik bagian 4). `enabled=false` bila `DESKTOP_RELEASES_FOLDER_ID` kosong. Maks. 50.
- Validasi ketat atas data dari Drive (setengah tepercaya): `schema`, semver, `publishedAt` ISO, nama berkas harus cocok
  `^QC-App-Setup-<versi>-(x64|arm64)\.exe$` dan sama dengan versi folder, ukuran bilangan bulat positif, `sha512` heksadesimal 128;
  rilis yang tak lolos dilewati. Server **tidak** memverifikasi tanda tangan (tak memegang kunci publik); verifikasi ada di aplikasi
  desktop saat memperbarui (bagian 4). Konsekuensi diterima: pemasangan pertama manual bergantung pada server + TLS (5.4 memberi checksum).
- Kontrak: id di `ApiContract` dan entri `API_ROUTES` (resep "Menambah rute REST"), tes REST dengan klien Drive palsu dan berkas
  changelog sampel; OpenAPI otomatis.

### 5.2 Web: "Pembaruan" (`/changelog`)
- Rute `/_app/changelog` (tanpa izin modul), modul `web/src/modules/changelog/`, `queryOptions` `app.changelog`.
- Tampilan: judul "Pembaruan", daftar versi terbaru di atas; tiap versi = nomor, tanggal (format Indonesia), tanda "Versi Anda" pada
  versi berjalan, tiga bagian bertanda ("Baru", "Diubah", "Diperbaiki") berisi butir teks. Tampil 10 versi, tombol "Tampilkan lebih banyak".
  Kosong = pesan "Belum ada catatan pembaruan". Teks UI santai, "Serial Number" ditulis lengkap (preferensi pemilik).
- Titik masuk: butir "Yang baru" di menu profil (`user-menu.tsx`) dan label versi kecil (`v1.4.0`, tooltip berisi `build`) di kaki
  sidebar; tidak menambah grup navigasi baru.
- **Penanda baru**: `localStorage` `qc.changelog.seen:<email-ternormalisasi>` berisi versi terakhir dilihat (dibungkus try/catch;
  gagal = tanpa penanda). Pertama kali (belum ada nilai) disimpan **diam-diam** = versi sekarang, supaya pengguna baru tak
  dibanjiri riwayat. Bila versi berjalan lebih tinggi dari yang tersimpan: titik penanda pada tombol menu profil dan butir "Yang baru",
  plus **satu toast** per versi per perangkat ("Ada pembaruan v1.4.0" + tombol "Lihat"). Membuka `/changelog` menyimpan versi sekarang.
  Membandingkan versi memakai fungsi semver murni di `shared/changelog.ts` (tanpa string compare).
- Berlaku juga di aplikasi desktop (rute REST sudah lewat `api-proxy`); tanpa kanal jembatan baru.
- Offline/server tak terjangkau: halaman memakai pola galat yang ada (`describeError`); label versi disembunyikan bila belum ada data.

### 5.3 Web: "Aplikasi Desktop" (`/desktop`)
- Rute `/_app/desktop`, butir navigasi "Aplikasi Desktop" di grup Umum, tanpa izin modul, **hanya di peramban** (bendera `webOnly` baru
  pada `NavItem`, kebalikan `desktopOnly`; di dalam aplikasi desktop tautan unduh tak berfungsi karena `api-proxy` tidak menerusi
  `/api/desktop/*` dan navigasi dikunci ke `app://qc`).
- Tampilan: kartu utama berisi versi terbaru, tanggal, dan **tombol unduh sesuai OS/arsitektur terdeteksi** (Windows x64/arm64 lewat
  `navigator.userAgentData` dengan cadangan UA; OS lain = kalimat "Aplikasi desktop baru tersedia untuk Windows", tanpa tombol, dan daftar
  tetap tampil); di bawahnya "Semua versi": baris per versi (nomor, tanggal, tautan x64 dan arm64 dengan ukuran, "Rincian" yang melipat
  changelog versi itu, checksum SHA-512 dengan tombol salin). Versi lama diberi catatan "Pasang versi lama hanya bila perlu".
- Teks bantuan tetap (selama belum ada tanda tangan Authenticode, bagian 4, pertanyaan terbuka): "Windows mungkin menampilkan peringatan
  'penerbit tak dikenal': pilih *Info lebih lanjut* lalu *Tetap jalankan*." dan satu baris perintah PowerShell `Get-FileHash -Algorithm SHA512 <berkas>` untuk memeriksa checksum.
  `enabled=false` = pesan "Unduhan belum tersedia".
- Penegasan: halaman ini bersesi, tetapi `url` berkas mengarah ke rute publik (bagian 4); halaman adalah pintu masuk yang mudah ditemukan,
  bukan kontrol akses.

### 5.4 Tes
- `shared/changelog.test.ts`: parsing normal, `Internal` dibuang, bagian rusak dilewati tanpa menggagalkan sisanya, pemotongan 300 karakter,
  karakter kontrol, urutan semver, perbandingan versi (`1.10.0` > `1.9.0`, praprilis).
- Rute server: `app.changelog` (sesi wajib, berkas hilang = kosong, batas 50), `desktop.releases` (validasi ketat, nama tak cocok dilewati,
  `enabled=false`, cache); `api.test.ts` menjaga tabel dan kontrak sejalan.
- Web: halaman Pembaruan (render, "Versi Anda", tampilkan lebih banyak), logika penanda (pertama kali diam, naik versi menandai, membuka
  halaman menandai, `localStorage` melempar galat tetap aman, akun berbeda terpisah), halaman Desktop (deteksi OS/arsitektur, tombol tepat,
  OS tak didukung, kosong/`enabled=false`, salin checksum), navigasi `webOnly` tersembunyi di desktop (`navigation-desktop.test.ts`).

### 5.5 Dokumentasi
`docs/ci-cd.md` (rujukan alur rilis → tampilan web), `CLAUDE.md` (ringkas modul changelog dan halaman desktop), `docs/e2e-checklist.md`
(lihat versi/penanda setelah deploy staging; unduh installer dari halaman).

## 6. Risiko dan pertanyaan terbuka
- **Menunggu persetujuan pemilik**: seluruh dokumen. Keputusan perancang yang dapat diubah: halaman Desktop terbuka bagi semua pengguna
  bersesi (bukan hanya pemegang izin Country Lock); penanda "baru" per perangkat (bukan per akun); `webOnly` di desktop; maks. 50 rilis.
- **Penanda per perangkat**: pengguna dengan beberapa perangkat melihat titik di tiap perangkat, dan akun bersama berbagi satu nilai per
  perangkat. Diterima demi tanpa migrasi.
- **Versi yang ditampilkan mengikuti server, bukan berkas UI yang tertahan di cache**: UI basi tetap menampilkan versi server baru sampai
  banner pembaruan PWA dipakai. Tak berbahaya; diterima.
- **Isi changelog bergantung disiplin penulis fragmen** (bagian 1: CI mewajibkan fragmen). Parser toleran, tetapi tak dapat memperbaiki kalimat jelek.
- **Checksum di halaman bukan pengganti tanda tangan**: pemasangan pertama dipercaya lewat TLS + server; pembaruan sesudahnya terverifikasi
  tanda tangan. Menutup celah ini butuh Authenticode (bagian 4, pertanyaan terbuka).
- Tidak ada perubahan skema basis data, tidak ada variabel `.env` baru selain `CHANGELOG_FILE` (bawaan image, dikecualikan di `deploy-files.test.ts`
  seperti `MIGRATIONS_DIR`) dan `DESKTOP_RELEASES_FOLDER_ID` (bagian 4).
