# Versi API per kelompok, UI dasar yang lebih baru menang, dan paksa pembaruan klien

Status: **Disetujui pemilik 2026-11-20 (desain); implementasi dipecah: rencana `2026-11-20-versi-api-ui-dasar.md` untuk fase 1, 2, 4 dan rencana terpisah untuk fase 3.** Keputusan pemilik ada di bagian 3; penyimpangan rencana dari spek dicatat di bagian 11. Fase 1, 2, dan 4 sudah dibangun (lihat bagian 11); fase 3 (deprecated dan paksa pembaruan) belum.

## 1. Maksud dan alasan
Server dan klien dirilis di waktu yang berbeda: desktop memuat UI dasar dari installer (dan UI terbaru dari server), tab web
bisa tertinggal berhari-hari, dan antrean offline mengirim permintaan yang dibentuk beberapa jam sebelumnya. Hari ini satu-satunya
"versi API" adalah awalan `/api/v1` yang tak pernah berubah, dan desktop memilih UI murni dari apa yang disajikan server. Akibatnya:
- UI dasar yang lebih baru dari server tidak bisa dipakai dengan aman (UI bisa memanggil rute yang belum ada di server);
- tidak ada cara resmi mengubah kontrak secara merusak tanpa mematahkan klien lama;
- klien lama tidak punya jalan keluar yang pasti: tak ada tanda "versi ini akan dihapus" dan tak ada pemaksaan pembaruan.

Tujuannya: UI yang lebih baru boleh dipakai walau server belum men-deploy kontrak barunya (turun ke versi lama), kontrak berubah
secara bertahap dan terkendali, dan klien yang terlalu lama dipaksa memperbarui.

## 2. Cakupan
Di dalam: versi API per kelompok rute (`API_ROUTES`), pengumuman kemampuan server, pemilihan versi di klien, aturan pemilihan UI
dasar vs bundel unduhan di desktop, penandaan deprecated dan penghapusan, serta paksa pembaruan (web dan desktop).
Di luar: rute di luar `API_ROUTES` (`/api/public/*`, `/api/desktop/*`, `/auth/*`, aliran notifikasi): tidak diberi versi, tetapi
tetap wajib kompatibel mundur secara manual (expand → kontrak) seperti sekarang; migrasi basis data (sudah punya aturan expand →
contract sendiri); isi perubahan kontrak pertama (belum ada rute v2 yang direncanakan).

## 3. Keputusan pemilik (2026-11-20)
Seluruh butir di bawah disetujui pemilik produk pada 2026-11-20 dan menggantikan perilaku lama yang bertentangan.
1. **UI dasar yang lebih baru menang** atas bundel UI unduhan; server bukan lagi satu-satunya sumber UI yang dipercaya. Alasan:
   installer yang dibangun dari web terbaru seharusnya memakai web itu, bukan bundel server yang lebih lama.
2. **Kontrak API harus selalu kompatibel mundur.** Perubahan besar menaikkan versi API tanpa langsung mematikan versi
   sebelumnya.
3. **Kenaikan versi bersifat parsial**, per bagian (mis. satu fitur sudah v2 sementara yang lain masih v1), bukan serentak.
4. **Fallback ke API lama:** klien yang membawa kontrak baru memakai versi lama bila server belum men-deploy versi barunya.
5. **Pensiun versi lama:** ditandai **deprecated** lebih dulu, dihapus di **rilis berikutnya**; klien yang masih memakai versi
   lama **dipaksa memperbarui**.
6. **Country Lock tetap jalan** saat klien dipaksa memperbarui (alat lapangan yang bekerja offline dan tanpa API); hanya layar
   yang bergantung pada API yang ditahan.
7. **Satuan versi = kelompok rute di server; syarat fitur disusun di sisi UI** (jawaban pemilik atas usulan perancang): server
   mengumumkan versi per kelompok id (`qrcodes`, `serials`, ...); UI memiliki tabel kecil "fitur X butuh kelompok A ≥ n dan B ≥ m".

## 4. Kondisi sekarang (fakta kode, 2026-11-20)
- `shared/api.ts`: satu tabel `API_ROUTES` (123 id dalam 28 kelompok menurut awalan sebelum titik, dihitung dari berkas); `REST_BASE = '/api/v1'`
  (`server/src/http/rest.ts`); path relatif terhadap `/api/v1`. `ApiContract` (`shared/contract.ts`) memetakan id → input/output.
- `GET /api/ping` mengembalikan `{ ok, version, build }` (`server/src/core/build-info.ts`; `version` = semver server, kini `0.0.0`).
  Jalur itu ada di daftar izin proksi desktop dan tak butuh sesi.
- Manifest UI (`countrylock/src/ui-manifest.ts`): `uiVersion` berupa **hash SHA-256** (tidak berurutan), `minBridge`, `files`,
  `createdAt`. Seluruh `server/dist` (termasuk `ui-manifest.json`) disalin ke installer sebagai `resources/ui-baseline`
  (`desktop/electron-builder.yml`), jadi UI dasar punya manifest sendiri.
- `desktop/src/main/ui/ui-bundle.ts`: `activeRoot = bundel aktif ?? baselineDir` (baris 419); bundel unduhan dibuang hanya bila ID
  kunci atau `BRIDGE_VERSION` berubah (baris 200-210); tak ada perbandingan dengan UI dasar.
- Antrean offline PWA kedaluwarsa dalam 24 jam; Background Sync (`web/public/sync-sw.js`) mengirim permintaan dalam bentuk saat
  dibuat. Pembaruan web lewat `web/src/app/pwa/update.ts`; dialog pembaruan desktop punya tombol "Nanti"
  (`desktop/src/main/update/app-updater.ts`). Country Lock berada di luar layout `_app`, tanpa login.

## 5. Pendekatan yang dipertimbangkan
| Pendekatan | Keterangan | Putusan |
|---|---|---|
| A. Satu angka level API | server umumkan satu `apiLevel`; UI menyembunyikan fitur di atas level | Ditolak: granularitas kasar, bertentangan dengan keputusan 3 |
| B. Flag kemampuan per fitur | daftar kemampuan dirawat tangan | Ditolak sebagai satu-satunya: mudah ketinggalan, tak berkaitan dengan struktur rute |
| C. Coba v2, jatuh ke v1 bila gagal | tanpa handshake | Ditolak: 404 ambigu (tak ada vs tak berhak), latensi, logika tersebar |
| **D. Versi per kelompok + tabel syarat fitur di UI** | server umumkan versi per kelompok id, UI menyusun syarat per fitur | **Dipilih** (keputusan 7) |

## 6. Rancangan

### 6.1 Versi per kelompok dan pengumuman server
- Kelompok = awalan id sebelum titik (`apiGroup(id)`). Berkas baru `shared/api-versions.ts` (murni) memuat
  `API_GROUP_VERSIONS: Record<ApiGroup, { latest: number; deprecated: readonly number[] }>` untuk SEMUA kelompok (awalnya
  `{ latest: 1, deprecated: [] }`) dan `RETIRED_ROUTES` (lihat 6.7). Tes menjaga setiap kelompok di `API_ROUTES` terdaftar di sini.
- `/api/ping` menambah `apis: Record<ApiGroup, { latest: number; deprecated: number[] }>` dan `minClient` (6.8). Penambahan
  field bersifat aditif: pemeriksa kesehatan memakai status 2xx saja.

### 6.2 Rute berversi
- `ApiRouteDef` mendapat `version?: number` (bawaan 1). Rute berversi 2 memakai id `<id>@2` (mis. `qrcodes.save@2`) dan path yang
  sama relatif terhadap `/api/v<versi>`; `REST_BASE` menjadi fungsi `restBase(version)`. `ApiContract` memuat kedua id dengan tipe
  input/output masing-masing, sehingga typecheck menolak memakai bentuk data yang salah (tanpa cabang `if (version)` di handler).
- Kelompok yang naik ke v2 hanya mendapat salinan v2 untuk **rute yang berubah**; rute lain tetap hanya v1 dan terus dipakai.
  Pengumuman `latest: 2` berarti "kelompok ini memiliki rute v2 yang boleh dipakai".
- OpenAPI (`/api/openapi.json`) memuat semua versi dengan jalur lengkapnya.

### 6.3 Adaptor di server
Logika bisnis tetap satu di layanan modul. Handler v1 menjadi adaptor tipis (ubah input v1 → panggil layanan → ubah hasil ke bentuk
v1) dan handler v2 memanggil layanan langsung. Aturan kerja: tidak ada logika baru di handler berversi lama.

### 6.4 Pemilihan versi di klien
- `api(id, input)` tidak berubah bagi pemanggil. Resolver (`web/src/lib/api/`) memilih, untuk id dasar itu, versi tertinggi yang
  ada di `API_ROUTES` dan tidak melebihi `apis[group].latest` yang diumumkan server; versi 1 adalah dasar bawah.
- Peta `apis` dimuat dari `/api/ping` saat boot dan disegarkan setiap ping berhasil; salinan terakhir disimpan (tanpa data
  sensitif) agar klien offline tetap memilih versi yang sama. Belum termuat = anggap semua v1.
- Bila bentuk v1 dan v2 berbeda, lapisan penyesuai kecil per modul (`web/src/modules/<modul>/compat.ts`) mengubah respons v1 menjadi
  model v2, sehingga layar hanya melihat satu bentuk. Fitur yang tak punya padanan lama disembunyikan (6.5).

### 6.5 Tabel syarat fitur di UI
`web/src/lib/api/features.ts` memuat `FEATURE_REQUIRES: Record<string, Partial<Record<ApiGroup, number>>>`, mis. `'manualBook@2':
{ qrcodes: 2, stickers: 2 }`, dan `useFeature(name)` yang menghitung dari peta `apis`. Fitur tak tersedia: tombol/menu disembunyikan
atau dinonaktifkan dengan keterangan "Server belum mendukung ini"; grup lain tetap jalan. Tes menjaga setiap kelompok yang disebut
ada di `API_GROUP_VERSIONS` dan versinya tidak melebihi `latest`.

### 6.6 UI dasar yang lebih baru menang (desktop)
- Penanda urutan: `createdAt` manifest (usulan perancang; `uiVersion` hash tak berurutan, dan nomor run CI berbeda per workflow).
- Saat peluncuran, `ui-bundle.ts` membaca `ui-baseline/ui-manifest.json`; bila `createdAt` UI dasar > `createdAt` bundel aktif,
  bundel unduhan dan `ready`-nya dibuang (kembali ke UI dasar) dan versinya ditandai sudah dikalahkan. Saat mengunduh, manifest
  server dengan `createdAt` ≤ UI dasar tidak diterapkan (hasil `none`, alasan "UI dasar lebih baru").
- UI dasar bukan berkas yang diverifikasi tanda tangan (ia bagian installer yang sudah dipercaya, seperti kode).
- Mengapa aman: UI yang lebih baru dari server tetap berfungsi karena keputusan 2-4 (fallback ke versi lama, fitur baru disembunyikan).
  Syarat `minBridge` tetap berlaku untuk bundel unduhan; UI dasar selalu cocok dengan jembatan installernya.

### 6.7 Deprecated dan penghapusan
- Deprecated: versi kelompok dicatat di `deprecated` pada `API_GROUP_VERSIONS`, diumumkan di `/api/ping`, dan rute versi itu
  menambah header `Deprecation: true` pada responsnya. Klien yang memakai versi deprecated menampilkan spanduk "Aplikasi perlu
  diperbarui" (klien baru tak pernah memilih versi deprecated bila ada yang lebih baru).
- Penghapusan: paling cepat di rilis server berikutnya setelah rilis yang menandainya (keputusan 5). Id yang dihapus dari
  `API_ROUTES` WAJIB dicatat di `RETIRED_ROUTES` (`{ id, removedIn: 'server-vX.Y.Z' }`); permintaan ke rute itu dijawab `426` problem+json
  kode `CLIENT_OUTDATED` (bukan 404 polos), yang diperlakukan klien sebagai perintah memperbarui (6.8).
- Pagar: `shared/api-contract.snapshot.json` = potret kontrak rilis server terakhir (id, verb, path, query, versi, status deprecated),
  dibuat ulang oleh `release:prepare server`. Tes: setiap id di potret harus ada di kontrak sekarang ATAU ada di `RETIRED_ROUTES`
  dan berstatus deprecated di potret tersebut. Menghapus rute yang belum ditandai membuat tes gagal.
- Kompatibilitas **bentuk data** tidak dapat dibuktikan mesin (validator ditulis tangan). Aturan kerja: perubahan field yang merusak
  WAJIB menambah rute versi baru dan fixture permintaan/respons versi lama tetap diuji (`<modul>/<rute>.v1.contract.test.ts`).

### 6.8 Paksa pembaruan
- `/api/ping` memuat `minClient: { desktop: string }` (semver installer minimum). Nilainya konstanta server yang dinaikkan
  bersamaan dengan penghapusan versi API yang masih dipakai installer lama (langkah di prosedur rilis).
- Desktop: bila `app.getVersion()` < `minClient.desktop`, rute yang butuh API (grup `_app`) diganti layar penahan "Perlu pembaruan"
  dengan satu tombol yang menjalankan alur pembaruan yang ada (unduh lalu mulai ulang; tanpa "Nanti"). **`/country-lock` tidak
  ditahan** (keputusan 6), begitu pula draf lokal; hanya kirim ke server yang menunggu.
- Web: respons `426 CLIENT_OUTDATED` atau versi yang dipakai shell lama ada di `deprecated` memicu pemuatan ulang paksa lewat
  `recoverStaleShell`/`update.ts` yang ada, setelah pemeriksaan "ada ketikan belum tersimpan" (`unsaved-changes`) yang sudah ada.
- Antrean offline: entri yang ditolak `426` dibuang ke jalur "ditolak" yang sudah ada dengan alasan yang jelas, bukan dicoba ulang.

## 7. Dampak
- Kode: `shared/api.ts`, `shared/contract.ts`, `shared/api-versions.ts` (baru), `server/src/http/rest.ts`, `openapi.ts`, `app.ts`
  (ping), `server/src/core/build-info.ts`, klien `web/src/lib/api/` (resolver, `features.ts`), gerbang di shell `_app`,
  `desktop/src/main/ui/ui-bundle.ts`, alur pembaruan `desktop/src/main/update/`, `scripts/release-prepare.ts` (potret kontrak).
- Dokumen yang ikut diubah saat dikerjakan: `CLAUDE.md` (UI hibrid, "Menambah rute REST", kebijakan versi), `docs/adding-a-module.md`
  (mengubah kontrak yang merusak), `docs/ci-cd.md` (potret kontrak di `release:prepare`), spek rilis desktop (paksa pembaruan) dan fragmen changelog.

## 8. Pengujian
Unit: resolver versi (peta ping, offline, belum termuat), `useFeature`, aturan UI dasar vs bundel (tes `ui-bundle`), pembuatan potret
dan tes superset, `RETIRED_ROUTES` menjawab 426, layar penahan tidak menyentuh `/country-lock`. Integrasi server: rute v1 dan v2
berdampingan lewat `restClient`. Uji perangkat nyata: pembaruan paksa installer (checklist E2E desktop bagian K) dan tab web lama.

## 9. Urutan pengerjaan (tiap fase dapat dirilis sendiri)
1. **Fondasi tanpa perubahan perilaku:** `api-versions.ts`, `version` pada `ApiRouteDef`, peta `apis` di ping (semua v1), resolver klien
   (selalu v1), potret kontrak + tes superset.
2. **UI dasar menang:** perubahan `ui-bundle.ts` dan tesnya.
3. **Deprecated dan paksa pembaruan:** `deprecated`, header, `RETIRED_ROUTES` + 426, `minClient`, layar penahan desktop, pemuatan paksa web.
4. **Kebijakan kerja:** pembaruan `CLAUDE.md` dan `docs/adding-a-module.md`. Rute v2 pertama baru dibuat saat ada perubahan merusak nyata.

## 10. Pertanyaan terbuka dan risiko
1. **Penanda urutan UI** (`createdAt`): rebuild commit lama yang lebih belakangan terlihat "lebih baru". Dampaknya kecil karena
   keputusan 2-4 membuat UI lebih baru selalu aman, tetapi UI dasar bisa menang atas bundel server yang sebenarnya lebih baru secara kode.
2. **Jeda minimum deprecated → hapus:** "rilis berikutnya" bisa hanya beberapa jam setelah rilis sebelumnya (hotfix), padahal antrean
   offline hidup 24 jam. Usulan perancang: `release:prepare server` menolak penghapusan bila potret yang menandai deprecated
   berumur < 24 jam (nilai bisa diperpanjang oleh pemilik).
3. **Sumber `minClient`:** konstanta di kode (usulan) atau variabel lingkungan; konstanta menjaga perubahan lewat PR yang bisa ditinjau.
4. **Peta `apis` saat desktop offline:** salinan terakhir tersimpan (usulan, `localStorage`/IndexedDB); klien baru yang belum pernah
   online memakai v1.
5. Rute di luar `API_ROUTES` (`/api/desktop/*`, `/auth/*`, publik) belum punya mekanisme versi; tetap lewat aturan kompatibel mundur manual.

## 11. Catatan implementasi (2026-11-20)
Bagian ini mencatat apa yang sudah dibangun dan di mana penyimpangannya dari rancangan di bagian 6-9. Keputusan di bagian 3
tetap berlaku; penyimpangan di bawah ini adalah keputusan teknis (pemilik produk menyetujui arah desain, bukan detail kode).

Yang sudah dibangun:
- Fase 1 (fondasi tanpa perubahan perilaku): `shared/api-versions.ts` (`parseApiId`, `apiGroup`, `API_GROUP_VERSIONS` untuk
  28 kelompok, `RETIRED_ROUTES` kosong, `announcedApis`, `parseServerApis`, `pickApiId`, `apiVersionsInUse`); server memasang
  jalur `/api/v<n>` per versi yang dipakai rute (`registerRest` menerima `version`, `isRestPath` mengenali `/api/v\d+`); `/api/ping`
  menambah `apis`; klien memilih id lewat `web/src/lib/api/versions.ts` (`startApiVersions`, `refreshServerApis`, `pickApi`,
  salinan di `localStorage` `qc.api.apis`); potret kontrak `shared/api-contract.snapshot.json` (`shared/api-snapshot.ts`,
  `bun run api:snapshot` dan `--check`) dengan tes superset.
- Fase 2 (UI dasar menang): `desktop/src/main/ui/ui-bundle.ts` membuang bundel unduhan yang `createdAt`-nya <= UI dasar, dan
  manifest server yang tak lebih baru dari UI dasar tidak diterapkan. Proksi desktop (`desktop/src/main/api-proxy.ts`,
  `PROXY_ALLOW`) mengizinkan `/api/v<n>/`.
- Fase 4 (kebijakan kerja): `CLAUDE.md` dan `docs/adding-a-module.md` (bagian "Mengubah kontrak yang merusak").

Yang belum dibangun: `deprecated` (header `Deprecation`, spanduk), `RETIRED_ROUTES` yang menjawab 426 `CLIENT_OUTDATED`,
`minClient` di `/api/ping`, layar penahan desktop, pemuatan paksa web, dan integrasi potret ke `release:prepare` (semuanya fase 3).

Penyimpangan dari rancangan:
1. Tidak ada field `version?` di `ApiRouteDef` (bagian 6.2). Versi diturunkan dari akhiran id `<idDasar>@<n>` (`parseApiId`),
   satu sumber kebenaran; tak ada field terpisah yang bisa tak sejalan dengan id.
2. `api(id, input)` tetap menerima id persis dan belum memanggil `pickApi` (bagian 6.4). Pemilihan versi lewat `pickApi()`
   dipanggil lapisan compat modul (`web/src/modules/<modul>/compat.ts`) sebelum `toRequestParts`. Ini wajib dipasang pada rute
   v2 pertama; selama semua id masih v1, perilakunya identik.
3. Catatan `createdAt` per versi UI disimpan di `state.json` (`created`). Versi tanpa catatan dianggap TIDAK lebih baru dari UI
   dasar (dibuang), sehingga state lama aman. Bila `ui-manifest.json` UI dasar tak ada atau rusak, perilaku lama dipertahankan
   (tanpa penentuan urutan).
4. OpenAPI: path item rute versi >= 2 memakai `servers` `/api/vN` (`serversFor`). Bila jalur yang sama dipakai versi lain, kunci
   path item versi >= 2 diberi akhiran `?v=N` supaya operasi v1 tidak tertimpa (`buildOpenApi`).
5. Integrasi potret kontrak ke `release:prepare` dipindah ke fase 3. Sementara potret diperbarui manual lewat
   `bun run api:snapshot` (dan dicek lewat `bun run api:snapshot --check`).
6. Di luar rancangan, untuk konsistensi: `server/src/app.ts` memeriksa `isServerPath` SEBELUM `staticDir`, sehingga `/api/v2/*`
   yang tak dikenal menjawab 404 (bukan 500 saat tanpa `c.env`). `ui-bundle.ts` mengosongkan ETag saat peluncuran bila tak ada
   bundel yang dipegang, agar pemeriksaan pertama tidak menjawab 304 atas manifest yang bundelnya sudah dibuang.

Keputusan pemilik yang dicatat di sini: bagian 3 (2026-11-20). Pertanyaan terbuka bagian 10 belum diputuskan, kecuali yang
tercakup oleh bagian 3.
