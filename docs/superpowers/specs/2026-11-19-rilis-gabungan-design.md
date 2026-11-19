# Rilis gabungan server + desktop dalam satu PR dan satu workflow (rancangan)

Status: **disetujui pemilik produk** (2026-11-19: pilihan "satu PR gabungan", lalu "gabungkan `release.yml` dan `release-desktop.yml`").
Turunan rilis semver (`2026-11-17-rilis-semver-design.md`) dan rilis desktop (`2026-11-17-rilis-desktop-auto-update-design.md`).

## 1. Maksud
Pemilik ingin dapat merilis **server dan desktop bersamaan lewat SATU PR rilis** (pilihan pemilik 2026-11-19, dari tiga opsi: satu perintah dua
PR, satu PR gabungan, atau tombol di Actions) dan menanyakan mengapa `release.yml` dan `release-desktop.yml` terpisah. Jawabannya: keduanya
memang tak perlu terpisah. Pemilik memutuskan 2026-11-19 **menggabungkannya menjadi satu `release.yml`** yang memilih jalur menurut cabang rilis
yang di-merge. Alur cabang tunggal lama (`release/server-vX.Y.Z`, `release/desktop-vA.B.C`) tetap sah; rilis gabungan adalah bentuk ketiga.

Anti-tujuan: melemahkan pagar identitas, mengubah isi rilis per komponen (tag, Release, CHANGELOG tetap per komponen), atau membuat satu komponen
yang sudah selesai dibatalkan karena komponen lain gagal.

## 2. Pendekatan yang dipertimbangkan
Soal PR:

| Pendekatan | Keterangan | Putusan |
|---|---|---|
| A. Satu perintah, dua PR | `release:prepare both` menyiapkan dua cabang; dua merge berurutan | tidak dipilih pemilik |
| **B. Satu PR gabungan** | satu cabang, satu commit rilis, satu merge | **dipilih** |
| C. Tombol "Rilis bersama" di Actions | orkestrasi baru di atas dua alur | tidak dipilih pemilik |

Soal workflow (setelah B dipilih):

| Pendekatan | Keterangan | Putusan |
|---|---|---|
| B1. Dua workflow yang sama-sama mengenali cabang gabungan | dua `meta` (dua pagar identitas yang harus dijaga sama), dua `sync-dev`, tak ada urutan antar komponen | tidak dipilih pemilik |
| **B2. Satu `release.yml`** | satu `meta`, satu `ci`, jalur server dan jalur desktop sebagai job bersyarat, satu `sync-dev` | **dipilih** |

Keunggulan B dibanding A: satu commit rilis (tidak ada konflik `bun.lock` antar dua PR), satu merge ke `main`, satu sinkron `main` -> `dev`.
Keunggulan B2 dibanding B1: satu pagar identitas untuk semua bentuk cabang, satu pemeriksaan kode (`ci`), satu sinkron, dan urutan antar
komponen dapat ditegakkan. `deploy-server.yml` dan `deploy-tag.yml` TIDAK ikut digabung (pemicu, izin, dan tujuannya berbeda: deploy dari PR
ke `dev`/`main`, dan deploy versi lama dari tag).

## 3. Rancangan
1. **Nama cabang**: `release/gabungan-server-vX.Y.Z-desktop-vA.B.C` (versi tiap komponen persis semver tanpa awalan nol). Cabang tunggal lama
   tetap sah.
2. **`release:prepare both <bump-server> <bump-desktop>`** (`scripts/release-prepare.ts`): prasyarat server (saklar `RELEASE_FLOW=tag`, penunjuk
   staging) berlaku karena server termasuk; fragmen WAJIB ada untuk kedua komponen (tanpa fragmen = ditolak, bukan dilewati diam-diam). Satu cabang
   dari `origin/dev`, satu commit `chore(rilis): server vX + desktop vA` yang memuat kedua `package.json`, kedua `CHANGELOG.md`, kedua
   `changelog.d`, dan `bun.lock`. Satu PR ke `main` dengan badan dua bagian. `--dry-run` berlaku. `release:prepare desktop` tetap tak butuh `RELEASE_FLOW`.
3. **Pagar identitas** (`scripts/release-identity.ts`): `checkIdentity` menerima tiga bentuk cabang; untuk SETIAP komponen yang disebut cabang,
   `<komponen>/package.json` pada commit merge harus bersama versi cabang; selebihnya sama (bukan fork, base `main`, merge commit dua induk).
   Cabang gabungan (menyertakan server) HANYA sah bila `RELEASE_FLOW=tag`, juga untuk pemulihan satu komponen (ditambahkan 2026-11-19 setelah review: tanpa ini desktop dapat terbit sebelum server live, karena production di-deploy `deploy-server.yml` secara paralel). Konsekuensinya pemulihan desktop dari PR gabungan terblokir selama saklar bukan `tag` (batasan yang diketahui). `ONLY` yang tak dikenal menggagalkan (`parseOnly`), bukan dianggap kosong. Alasan penolakan tetap generik. `releaseOutputs` menerapkan saklar `RELEASE_FLOW`: versi server dikosongkan bila bukan `tag` (desktop tak
   bergantung). `releaseComponents` memberi komponen yang dimuat cabang (untuk `guard`, terlepas dari komponen yang dirilis run itu).
4. **`release.yml` terpadu**: `meta` membaca PR lewat API dan menjalankan pagar identitas; keluarannya `server_version`, `desktop_version`, `components`.
   Jalur server (`guard` -> `image` -> `deploy` -> `publish-server`) berjalan bila `server_version` terisi; jalur desktop (`build-desktop` ->
   `publish-desktop`) bila `desktop_version` terisi; `ci` SATU kali (hanya server: selektif sejak deploy production; desktop ikut: pemeriksaan
   PENUH dengan `desktop-check`); satu `sync-dev` setelah semua komponen yang dirilis selesai (`komponen` `server`|`desktop`|`gabungan`, input
   `version-desktop` untuk gabungan); `withdraw` (penarikan desktop) tetap berdiri sendiri.
5. **Urutan: server dulu**. `publish-desktop` baru berjalan setelah server production live (`deploy` sukses, atau production sudah menjalankan commit
   itu); `build-desktop` berjalan paralel dengan jalur server agar waktu total tak bertambah. Alasan: aplikasi baru tak boleh sampai ke pengguna
   sebelum server yang dipakainya. Konsekuensinya: kegagalan server menahan penerbitan desktop (dipulihkan per komponen, butir 7).
6. **Concurrency**: rilis server dan gabungan (saat `RELEASE_FLOW=tag`) masuk grup `deploy-server-production` (satu pipeline production sekaligus,
   bersama `deploy-server.yml`); rilis desktop saja dan penarikan masuk `release-desktop`; run tanpa pekerjaan masuk `lewati-<run>`. Akibatnya
   penerbitan desktop dari rilis gabungan tidak diserialkan dengan rilis desktop saja yang kebetulan berjalan bersamaan; diterima (satu pemilik,
   skrip penerbit idempoten).
7. **Kegagalan sebagian dan pemulihan**: `guard` memeriksa SEBELUM image/deploy bahwa tag `server-v…` dan (gabungan) `desktop-v…` tak ada pada commit lain
   dan CHANGELOG kedua komponen memuat bagiannya, jadi bentrokan tag tak menyisakan production ter-deploy tanpa tag. Bila satu jalur gagal di
   tengah, jalankan ulang lewat `workflow_dispatch` dengan `komponen` (`server` atau `desktop`) + `versi`: PR dicari dari komponen dan versi (cabang tunggal
   atau gabungan; cabang tunggal dicari lewat `--head`, gabungan lewat 500 PR terakhir yang di-merge), hanya komponen itu yang dirilis ulang (`only`), `guard` memakai
   keadaan terbaru. PR gabungan dipulihkan satu komponen per run. Pemulihan `desktop` TIDAK memeriksa lagi bahwa server sudah live. Penarikan desktop tetap
   `tarik`. Masukan `workflow_dispatch` yang salah kombinasi (mis. `tarik` bersama `versi`, atau `komponen` tanpa `versi`) gagal keras di `meta`.
8. **Tag, Release, CHANGELOG** tetap per komponen (`server-vX`, `desktop-vA`); installer desktop dilampirkan ke Release desktop (keputusan 2026-11-18).

## 4. Risiko dan hal yang harus diverifikasi
- Menyentuh pagar `pull_request_target` yang menerima rahasia: tes identitas baru (cabang gabungan sah, versi salah satu tak cocok, nama mirip
  `release/gabungan-` tapi cacat, fork, squash, `only`) dan review keamanan terfokus pada diff ini.
- Rahasia desktop (environment `desktop-release`, hanya ref `main`) kini berada dalam workflow yang sama dengan jalur server. Pemisahan dijaga per
  job (tes `release.yml`): jalur server tanpa rahasia apa pun; `build-desktop` hanya token katalog; kunci tanda tangan dan kunci Drive hanya
  `publish-desktop` dan `withdraw`.
- **Celah yang sudah ada sebelum penggabungan (tidak diperbaiki di sini)**: `refs/deployed/staging` hanya maju saat staging benar-benar ter-deploy,
  sedangkan PR ke `dev` yang hanya mengubah `desktop/` atau dokumentasi tidak men-deploy. `guard` lalu menganggap perubahan kode desktop itu
  "belum berjalan di staging" dan menolak rilis server/gabungan. Rilis gabungan hampir selalu membawa perubahan desktop, jadi celah ini lebih
  sering terkena. Pemulihan operasional: deploy staging manual dari `dev` sebelum merge PR rilis. Perbaikan permanen (guard hanya menghitung
  berkas yang memengaruhi image, memakai klasifikasi `ci-changes`) mengubah semantik guard dan menunggu keputusan pemilik.
- **Satu `ci` dipakai bersama pada rilis gabungan (DIPUTUSKAN pemilik 2026-11-19)**: kegagalan uji kemas desktop (`desktop-check`)
  menahan `image`/`deploy`/`publish-server` walau server tak berubah. Alternatif yang ditolak: memisahkan `ci` server (selektif) dari `ci` desktop (penuh),
  yang menjalankan pemeriksaan server dua kali. Alasan: sederhana dan fail-safe, dan pemilik dapat memilih per rilis antara cabang tunggal (server saja
  atau desktop saja, tanpa saling menahan) dan cabang gabungan; perilaku tercatat di `docs/ci-cd.md`.
- Rilis server dan gabungan memegang grup concurrency production selama build Windows dan penerbitan desktop (hingga ±75 menit): dispatch production
  dan deploy lain mengantre, dan run gabungan yang menunggu dapat tergeser (dipulihkan lewat `workflow_dispatch`). Konsekuensi rancangan, diterima.
- PR rilis server yang tak sah (squash, versi salah) kini membuat `meta` merah walau `RELEASE_FLOW` bukan `tag` (dulu `meta` dilewati total): pagar identitas
  selalu berjalan untuk cabang `release/…`; disengaja sebagai sinyal keamanan.
- Uji nyata di GitHub baru mungkin setelah workflow ada di `main` (aturan `pull_request_target`); tes lokal hanya menegakkan struktur dan skrip murni.

## 5. Di luar cakupan
Tombol "Rilis bersama" di Actions, pemulihan gabungan dalam satu run `workflow_dispatch`, penggabungan `deploy-server.yml`/`deploy-tag.yml`, dan
komponen ketiga.

## 6. Keputusan pemilik produk
1. (2026-11-19) Rilis bersama lewat **satu PR gabungan** (bukan dua PR, bukan tombol Actions).
2. (2026-11-19) **`release.yml` dan `release-desktop.yml` digabung menjadi satu `release.yml`**; `deploy-server.yml` dan `deploy-tag.yml` tetap terpisah.
3. (2026-11-19) **Tetap satu `ci`** pada rilis gabungan, dan bentuk rilis (tunggal atau gabungan) dipilih per rilis oleh pemilik lewat nama cabang
   yang disiapkan `release:prepare`; kedua alur tetap didukung berdampingan.
4. Keputusan pelaksana yang menunggu tinjauan pemilik: urutan server-dulu pada rilis gabungan (butir 5 bagian 3), pemulihan per komponen (butir 7),
   dan celah staging-ref (bagian 4).
