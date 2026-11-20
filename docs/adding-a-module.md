# Menambah modul baru

Contoh: modul `item` (Data Item). Modul sudah terdaftar di `MODULES` (`shared/permissions.ts`); untuk modul yang benar-benar baru, tambahkan key dan label di sana terlebih dahulu.

## 1. Kontrak — `shared/contract.ts` dan `shared/api.ts`
Tambahkan DTO, input, dan entri `ApiContract` (`shared/contract.ts`), mis. `'item.list': { input: null; output: ItemDto[] }`, lalu entri `API_ROUTES` di `shared/api.ts` (verba HTTP, jalur `/api/v1/...`, field query, `ifMatch`/`etag` untuk rute berversi, `create` untuk 201+`Location`). Satu tabel itu dipakai klien, server, dan OpenAPI; `shared/api.test.ts` gagal bila id kontrak dan tabel tidak sejalan.

## 2. Backend — `server/src/modules/item/`
- `repo.ts` — kueri MariaDB lewat adaptor `Db` (`prepare(sql).bind(...)`, `batch`, `transaction`); migrasi skema di `server/migrations/NNNN_nama.sql`.
- `validate.ts` — `validateXxx(raw)` yang mengembalikan input bertipe atau melempar `VALIDATION`.
- `service.ts` — logika bisnis; penulisan berbasis baca-lalu-tulis dijaga CAS di dalam `batch()` atau `SELECT ... FOR UPDATE` (lihat "Aturan server" di `CLAUDE.md`); catat audit bila perlu. Versi usang dilempar lewat `staleError(message)` agar menjadi 412 pada rute berETag.
- `routes.ts` — tabel `RouteTable` per modul dengan `permission: { module: 'item', level: 'view' | 'edit' | 'manage' }`; daftarkan di `server/src/routes.ts` (`getRoutes()`).
- Test di samping berkas (`*.test.ts`, `rest.test.ts`) memakai MariaDB sungguhan lewat `createTestEnv`, `restClient`, dan `restCall` (`server/test-support`).

## 3. Frontend — `web/src/modules/item/`
- `queries.ts` — `queryOptions` + mutation (invalidate key modul).
- `schemas.ts` — skema zod form.
- `components/` — form & tabel. Pakai kit CRUD (`web/src/components/page/`, `data-table/`, `grid/`, `kanban/`; aturan lengkap di CLAUDE.md, bagian "Kit CRUD"): daftar `ListPage` + `FilterBar`, View `ViewPage`, form `FormPage` (halaman) atau `FormDialogShell` (dialog), tabel `DataTable`, aksi massal lewat `runChunkedBatch`. Jangan membuat kerangka halaman sendiri.
- Route di `web/src/routes/_app/item/*.tsx` dengan `beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view')`.
- Tambahkan menu di `NAV_GROUPS` (`web/src/app/navigation.ts`) dan link di `MODULE_LINKS` (`web/src/app/module-links.ts`).
- Data contoh untuk dev ada di seed (`server/scripts/seed-dev.ts`, `bun run db:seed`); klien memanggil rute lewat `api(id, input)` (`web/src/lib/api`).

## 4. Selesai bila
`bun run check` hijau, `bun run build` lolos verify-dist, dan alur utama dicoba di `bun run dev` (terang dan gelap) serta di deployment.

## Modul berlokasi (izin per lokasi)

Modul `handover`, `qc`, dan `stock` bersifat berlokasi (`LOCATION_MODULES` di `shared/assignments.ts`). `access` global dan hanya dari penugasan "Semua lokasi"; `item` global bersama (levelnya tertinggi dari **semua** penugasan berlaku, `SHARED_MODULES`). Untuk modul berlokasi:

1. **Rute server** wajib menandai `scope: 'location'`:

   ```ts
   'handover.list': {
     permission: { module: 'handover', level: 'view', scope: 'location' },
     validate: validateListHandovers_,   // input memuat `locationIds: string[]`
     handler: (input, ctx) => listHandovers_(ctx.locationIds),
   },
   'handover.save': {
     permission: { module: 'handover', level: 'edit', scope: 'location' },
     validate: validateSaveHandover_,    // input memuat `locationId: string`
     handler: (input, ctx) => saveHandover_(input, ctx.locationIds[0]),
   },
   ```

   Router memeriksa tiap lokasi (ada, aktif, level cukup); satu gagal menolak seluruh permintaan dengan `FORBIDDEN`. **Gunakan `ctx.locationIds`, bukan input mentah.** Lupa `scope: 'location'` membuat izin diperiksa secara global.
2. **Data**: setiap baris punya kolom `location_id`; baca difilter ke `ctx.locationIds`, ubah/hapus memeriksa lokasi baris yang ada (izin ditegakkan lagi di lokasi baris itu).
3. **Frontend**: baca dengan `useActiveLocations().selectedIds`; form tulis memakai `LocationField` (`web/src/modules/location/location-field.tsx`, berbasis `LinkField`); menu memakai `permission: { module, level, scope: 'location' }` pada `NAV_GROUPS`; guard route memakai `requirePermission` (memeriksa minimal satu lokasi).
4. **Tabel**: tampilkan kolom **Lokasi** bila `selectedIds.length > 1` (PRD FR-C5); dengan satu lokasi terpilih kolom itu tidak perlu.
5. **Tes**: tambahkan kasus lokasi terlarang, tak dikenal, dan nonaktif untuk method baru.
6. **Izin alternatif**: bila method boleh diakses oleh salah satu dari beberapa izin (mis. WH atau QC), pakai `permission: { anyOf: [ ... ] }`. Semua alternatif harus sama lingkupnya (semua global atau semua `scope: 'location'`); tiap lokasi yang diminta cukup memenuhi satu alternatif, dan satu lokasi yang gagal menolak seluruh permintaan.
7. **Baris yang diubah lewat id**: rute tulis menerima `locationId` **dan** `id`; router memeriksa izin di `locationId`, lalu servis wajib memeriksa bahwa lokasi baris yang ada sama dengan `locationId` (bila tidak, `NOT_FOUND`) sehingga izin di satu lokasi tidak dapat dipakai untuk mengubah baris lokasi lain (contoh: `loadHandoverForWrite_`).
8. **Saran toleran di klien**: pakai `suggestMatches`/`similarNames` (`shared/suggest.ts`) atas daftar yang sudah dimuat; ambil daftar lewat rute modul itu sendiri (izin modul), bukan rute modul lain yang mungkin tidak boleh diakses user.
9. **Menu dan guard dengan izin "salah satu dari"**: `NavItem.permission` boleh berupa daftar; guard route memakai `requireAnyPermission` (`web/src/modules/auth/permissions.ts`).

### Katalog global + stok berlokasi (contoh: stiker)

Satu fitur boleh memakai dua modul: katalog `sticker` (global, `SHARED_MODULES`, levelnya dari semua penugasan) dan stok `stickerstock` (berlokasi, `LOCATION_MODULES`). Rute stok memakai `scope: 'location'`; rute katalog tidak. Bila sebuah angka dihitung dari semua lokasi (mis. "menipis" = total semua lokasi), hitung di server dari seluruh baris, lalu tampilkan hanya rincian lokasi yang boleh dilihat user; angka lokasi lain tidak boleh bocor. Lihat `server/src/modules/sticker/stock-service.ts` dan `docs/superpowers/specs/2026-11-09-stiker-katalog-stok-design.md`.

## Gambar dan Markdown

- **Unggah**: frontend memakai `useUploadImage()` (`web/src/modules/files/use-upload-image.ts`): gambar dikecilkan (maks. 1600 px, ≤ 1 MB, JPEG/PNG/WebP), diunggah lewat rute REST `files.upload`, dan mengembalikan id berkas. Berkas lahir **tanpa pemilik**; tiap user dibatasi 50 berkas belum terpakai (`MAX_UNATTACHED_UPLOADS`), jadi tautkan lewat `planAttachFiles` saat entitas disimpan.
- **Memiliki berkas**: saat entitas (mis. item) disimpan, panggil `planAttachFiles(env, ids, 'item', itemId)` (`server/src/modules/files/service.ts`) dan gabungkan pernyataan yang dikembalikannya ke `batch()` penyimpanan entitas (satu transaksi atomik; `attachFiles` hanya untuk pemakaian terpisah). Berkas yang sudah dimiliki entitas lain ditolak `CONFLICT`. Jenis pemilik baru ditambahkan ke `FileOwnerType` di `shared/files.ts`.
- **Tampil**: `useFileUrl(id)` (`web/src/modules/files/queries.ts`) memuat byte lewat `files.get` (di-cache lama di TanStack Query) dan membuat URL objek Blob di `useEffect` (di-revoke saat komponen lepas atau data berganti; aman StrictMode). Server hanya membaca berkas yang tercatat di tabel `files`; klien tidak pernah mengirim Drive id.
- **Markdown**: tampilkan dengan `MarkdownView` dan edit dengan `MarkdownEditor` (`web/src/modules/markdown/`). Gambar ditulis `![alt](qcfile:<id>)`. HTML mentah tidak dirender dan hanya tautan `http`/`https`/`mailto` yang aktif. Validasi panjang (`MARKDOWN_MAX_LENGTH` = 20.000) tetap dilakukan di skema form dan di validator server.
- **Drive/Sheets** hanya diakses lewat klien Google (`getBridge(env)` = `env.BRIDGE`, antarmuka `BridgeClient` di `server/src/core/bridge-client.ts`; implementasi service account di `server/src/core/google/`, lihat `docs/setup-google.md`); jangan memanggil API Google langsung dari modul. Isi berkas dibaca lewat `cachedFileContent` (izin diperiksa SEBELUM cache).

## Field relasi di form (`LinkField`)

Field form yang merujuk record model lain (merk, BU, jenis, role, lokasi pada penugasan, dst.) memakai `LinkField` (satu pilihan) atau `LinkMultiField` (banyak pilihan) dari `web/src/components/link-field.tsx`, bukan `Select`, checkbox daftar, atau teks bebas (spek BU, keputusan 24-25); filter relasi di halaman daftar juga `LinkField`. Resep:
1. **Opsi**: daftar kecil yang sudah dimuat disaring lokal menurut teks pencarian (`normalizeKey`); daftar besar memakai `onSearchChange` + `hasMore`. Hanya record aktif yang ditawarkan; record nonaktif yang sudah terpasang tetap tampil lewat `labelOf`.
2. **Tambah** (`onCreate`): hanya bila ada dialog tambah dan user berhak. Dialog dirender di luar `<form>` induk, menghentikan penjalaran submit, dan record baru langsung terpilih (simpan salinan lokal sampai daftar dimuat ulang).
3. **Buka** (`openHref`): hanya bila ada halaman lihat record dan user berhak; tanpa halaman lihat, tidak ada Buka (jangan membuat rute baru hanya untuk ini).
4. **Izin Tambah/Buka**: fungsi di `web/src/lib/link-access.ts` (UX saja; penegakan di server).
5. **Pengecualian**: enum/daftar tetap (pakai `Select`/`MultiSelect` dari `web/src/components/select.tsx`, bukan `<select>` bawaan), pemilih visual (gambar/logo), dan field teks bebas yang memang membuat record saat disimpan (`CustomerCombobox`). Daftar record yang seluruhnya sudah dimuat (mis. jenis stiker pada filter) memakai `LinkField` dengan `localFilter`/`highlight`.
6. **Tes**: `pickLink` dan `linkOptionNames` (alias `pickSelect`/`selectOptionNames` untuk `Select`) di `web/src/test/link-field.ts`; uji juga bahwa Tambah/Buka hilang tanpa izin.

## Modul ber-BU (izin per Business Unit)

Modul ber-BU diizinkan per Business Unit, bukan per lokasi. Daftarnya `BU_MODULES` di `shared/business-units.ts`; saat ini `item`, `serial`, dan `serialservice` (Serial Number 5a). Izinnya dihitung dari penugasan BU user (`users.bu_assignments`, `null` = Semua BU), bukan dari penugasan lokasi. Spek: `docs/superpowers/specs/2026-11-08-business-unit-design.md`.

Yang sudah otomatis ikut setelah modul masuk `BU_MODULES`:
- `resolveBuAccess` menghitung level per BU (`UserContext.businessUnits`; `MeDto.businessUnits` untuk klien).
- `buIdsWithLevel` dan `canActOnAllBus` memeriksa level; `globalBuLevel` memberi level global untuk halaman non-BU (Merk, Customer).

Yang harus dikerjakan modul sendiri:
1. **Relasi**: tabel penghubung `<entitas>_business_units` (`<entitas>_id`, `bu_id`, kunci utama gabungan, indeks `bu_id`), ditulis dalam `batch()` bersama entitasnya dengan penjaga CAS yang ada.
2. **Filter baca di SQL**: setiap jalur baca (daftar, jumlah, pencarian, detail, berkas) memakai `EXISTS` pada tabel penghubung dengan himpunan `visibleBuIds` (level ≥ `view`). Himpunan kosong berarti tidak ada hasil, tanpa menjalankan kueri (lihat `server/src/modules/item/`).
3. **Di luar hak = `NOT_FOUND`**, bukan `FORBIDDEN`, agar keberadaan data tidak bocor (`assertItemVisible` sebagai pola).
4. **Jalur tulis**: butuh level pada SEMUA BU entitas (`canActOnAllBus`). BU yang ditambah harus aktif dan user harus berhak `edit` di BU itu; BU nonaktif yang sudah melekat tetap dihitung.
5. **Konflik keunikan**: pesan generik, tanpa menyebut BU, merk, atau nilai entitas lain.
6. **Rute**: izin tetap `permission: { module, level }` tanpa `scope: 'location'`; penegakan BU ada di service.
7. **Tes**: jalur baca dan tulis untuk user BU lain, user tanpa penugasan BU, pelepasan dan penambahan BU, serta konkurensi `Promise.all` untuk ubah himpunan BU.

**Peringatan:** role yang sudah berisi izin modul itu, bila dipasang pada penugasan BU, langsung berlaku di BU-BU tersebut setelah modul masuk `BU_MODULES`. Tinjau role dan penugasan BU yang ada sebelum menambah modul.

**Pelajaran dari Serial Number 5b (dua modul ber-BU untuk dua tim, alur berstatus):**
- Bila izin bergantung pada keadaan data, simpan aturannya di SATU tabel murni di `shared/` (`serial-flow.ts`: aksi, status asal, posisi, modul pelaku, efek) dan biarkan server (`resolveAction`), web (`availableActions`), dan tes membacanya; jangan menyebar `if` izin di komponen atau handler. Rute memakai `anyOf` kasar (`serial` ATAU `serialservice`), penegakan per baris tabel ada di service.
- Bedakan galat: keadaan yang tak cocok = `CONFLICT`, ada barisnya tetapi bukan milik modul pelaku = `FORBIDDEN`, data di luar hak baca = `NOT_FOUND`.
- Pengaturan GLOBAL yang hidup di modul ber-BU (mis. penerima email `SERIAL_ALERT`) tidak boleh diubah pemegang `manage` satu BU saja: periksa `canActOnAllBus` atas SEMUA BU (atau super admin) dan cerminkan di web hanya sebagai penyembunyi tampilan (`canManageSerialSettings`); server tetap otoritatif.
- Jenis berkas baru (pemilik `serial`) mengikuti BU entitasnya: periksa visibilitas SEBELUM cabang lain di `readFile`, dan tambahkan modul barunya ke `anyOf` rute `files.upload`/`files.get`.

**Peringatan (5a):** modul ber-BU baru WAJIB masuk `BU_MODULES`. Loop override global di `resolveAccess` (`shared/assignments.ts`) menghitung `global[module]` dari `globalBuLevel` lewat `for (const module of BU_MODULES)`, jadi tidak ada daftar terpisah di `assignments.ts` yang perlu diubah.

## Rute publik bertoken (tanpa sesi)
Contoh: halaman laporan rusak Serial Number (`/laporan/<token>`, 2026-11-14). Kernel REST (`http/rest.ts`) mewajibkan sesi sebelum membaca apa pun, jadi rute tanpa sesi TIDAK masuk `API_ROUTES`: pakai sub-aplikasi Hono sendiri di `/api/public` (`server/src/modules/<modul>/public-routes.ts`, dipasang di `app.ts` sebelum fallback statis; otomatis di luar OpenAPI). Resepnya:
- Token bertanda tangan HMAC dengan kunci TURUNAN `SESSION_SECRET` (label tujuan khusus, supaya tak dapat dipakai membuat sesi; tanpa variabel `.env` baru), berkedaluwarsa, dibandingkan tetap-waktu; semua kegagalan (salah, kedaluwarsa, data tak ada, berkas bukan milik) = satu 404 problem+json yang sama.
- Batas laju kegagalan per IP lewat `rate_limits` + `limiterAddress`; `Cache-Control: no-store` dan `Referrer-Policy: no-referrer`; DTO publik daftar putih (tanpa surel, stok, atau data mentah); jangan mencatat token di log. Token tetap muncul di log akses nginx, jadi tautan harus hanya-baca.
- PELAJARAN: token yang memuat titik (`v1.<id>.<exp>.<sig>`) dianggap "berkas" oleh `server/src/http/static.ts` (segmen terakhir bertitik = 404) dan oleh denylist service worker `web/src/app/pwa/server-paths.ts`, sehingga tautan 404 di produksi dan di PWA terpasang. Awalan rute kliennya harus dikecualikan di KEDUA tempat (kini `/laporan/`; tes `static.test.ts` dan `scripts/pwa-server-paths.test.ts` menjaga keduanya sejalan), atau pilih format token tanpa titik.
- Halaman webnya route di luar layout `_app` (tanpa guard login); bila pengguna login dan berizin, DTO membawa penanda (mis. `viewerCanOpen`) agar klien mengalihkan ke halaman biasa. Token tidak pernah menambah izin.

## Soft delete (model yang punya Hapus)
Model baru yang punya Hapus/Pulihkan (spek `docs/superpowers/specs/2026-11-20-soft-delete-design.md`) wajib:
1. Masuk `SOFT_DELETE_TABLES` (`server/src/core/soft-delete.ts`).
2. Migrasi baru (expand-only, idempoten): kolom `deleted_at VARCHAR(30) NOT NULL DEFAULT ''` dan `deleted_by VARCHAR(254) NOT NULL DEFAULT ''`, serta indeks unik `<nama>_live` yang memuat `deleted_at` di samping indeks lama. Contoh: `server/migrations/0027_soft_delete.sql`. Jangan menyunting migrasi yang sudah diterapkan.
3. Setiap `FROM`/`JOIN` ke tabel itu di repo memakai `liveWhere(alias)`. Tes penjaga `server/src/core/soft-delete-guard.test.ts` gagal bila ada yang tak disaring dan tak terdaftar di `SOFT_DELETE_PENDING`/`SOFT_DELETE_EXEMPT` (`soft-delete-pending.ts`).
4. Pemetaan galat duplikat memakai `mapDuplicateError` (yang sudah sadar `_live`), dan pembanding `DbError.key` memakai `baseIndexName` (`server/src/core/index-names.ts`).
5. Hapus dan pulihkan lewat `softDeleteStmt`/`restoreStmt` (anak ikut induk: `softDeleteWithChildren`/`restoreWithChildren`), bukan `DELETE`.

## Sumber daya sinkron
Tidak ada lagi. Sinkron QC Desktop (`/api/v1/sync/*`) dihapus pada 2026-11-08; QC Desktop baru (Electron) dirancang di `docs/superpowers/plans/2026-11-06-qc-desktop-country-lock-fase-0-1.md`. Modul baru cukup mengikuti resep REST di atas.
