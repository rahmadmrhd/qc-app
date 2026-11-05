# Menambah modul baru

Contoh: modul `item` (Data Item). Modul sudah terdaftar di `MODULES` (`shared/permissions.ts`); untuk modul yang benar-benar baru, tambahkan key dan label di sana terlebih dahulu.

## 1. Kontrak — `shared/rpc.ts` dan `shared/api.ts`
Tambahkan DTO, input, dan entri `WorkerRpcContract` (`shared/rpc.ts`), mis. `'item.list': { input: null; output: ItemDto[] }`, lalu entri `API_ROUTES` di `shared/api.ts` (verba HTTP, jalur `/api/v1/...`, field query, `ifMatch`/`etag` untuk rute berversi, `create` untuk 201+`Location`). Satu tabel itu dipakai klien, server, dan OpenAPI; `shared/api.test.ts` gagal bila id kontrak dan tabel tidak sejalan.

## 2. Backend — `server/src/modules/item/`
- `repo.ts` — kueri MariaDB lewat adaptor `Db` (`prepare(sql).bind(...)`, `batch`, `transaction`); migrasi skema di `server/migrations/NNNN_nama.sql`.
- `validate.ts` — `validateXxx(raw)` yang mengembalikan input bertipe atau melempar `VALIDATION`.
- `service.ts` — logika bisnis; penulisan berbasis baca-lalu-tulis dijaga CAS di dalam `batch()` atau `SELECT ... FOR UPDATE` (lihat "Aturan server" di `CLAUDE.md`); catat audit bila perlu. Versi usang dilempar lewat `staleError(message)` agar menjadi 412 pada rute berETag.
- `routes.ts` — tabel `RouteTable` per modul dengan `permission: { module: 'item', level: 'view' | 'edit' | 'manage' }`; daftarkan di `server/src/routes.ts` (`getRoutes()`).
- Test di samping berkas (`*.test.ts`, `rest.test.ts`) memakai MariaDB sungguhan lewat `createTestEnv`, `restClient`, dan `restRpc` (`server/test-support`).

## 3. Frontend — `web/src/modules/item/`
- `queries.ts` — `queryOptions` + mutation (invalidate key modul).
- `schemas.ts` — skema zod form.
- `components/` — form & tabel.
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
3. **Frontend**: baca dengan `useActiveLocations().selectedIds`; form tulis memakai `LocationField` (`web/src/modules/location/location-field.tsx`); menu memakai `permission: { module, level, scope: 'location' }` pada `NAV_GROUPS`; guard route memakai `requirePermission` (memeriksa minimal satu lokasi).
4. **Tabel**: tampilkan kolom **Lokasi** bila `selectedIds.length > 1` (PRD FR-C5); dengan satu lokasi terpilih kolom itu tidak perlu.
5. **Tes**: tambahkan kasus lokasi terlarang, tak dikenal, dan nonaktif untuk method baru.
6. **Izin alternatif**: bila method boleh diakses oleh salah satu dari beberapa izin (mis. WH atau QC), pakai `permission: { anyOf: [ ... ] }`. Semua alternatif harus sama lingkupnya (semua global atau semua `scope: 'location'`); tiap lokasi yang diminta cukup memenuhi satu alternatif, dan satu lokasi yang gagal menolak seluruh permintaan.
7. **Baris yang diubah lewat id**: rute tulis menerima `locationId` **dan** `id`; router memeriksa izin di `locationId`, lalu servis wajib memeriksa bahwa lokasi baris yang ada sama dengan `locationId` (bila tidak, `NOT_FOUND`) sehingga izin di satu lokasi tidak dapat dipakai untuk mengubah baris lokasi lain (contoh: `loadHandoverForWrite_`).
8. **Saran toleran di klien**: pakai `suggestMatches`/`similarNames` (`shared/suggest.ts`) atas daftar yang sudah dimuat; ambil daftar lewat rute modul itu sendiri (izin modul), bukan rute modul lain yang mungkin tidak boleh diakses user.
9. **Menu dan guard dengan izin "salah satu dari"**: `NavItem.permission` boleh berupa daftar; guard route memakai `requireAnyPermission` (`web/src/modules/auth/permissions.ts`).

## Gambar dan Markdown

- **Unggah**: frontend memakai `useUploadImage()` (`web/src/modules/files/use-upload-image.ts`): gambar dikecilkan (maks. 1600 px, ≤ 1 MB, JPEG/PNG/WebP), diunggah lewat rute REST `files.upload`, dan mengembalikan id berkas. Berkas lahir **tanpa pemilik**; tiap user dibatasi 50 berkas belum terpakai (`MAX_UNATTACHED_UPLOADS`), jadi tautkan lewat `attachFiles_` saat entitas disimpan.
- **Memiliki berkas**: saat entitas (mis. item) disimpan, panggil `attachFiles_(ids, 'item', itemId)` (`gas/src/modules/files/service.ts`) **di dalam lock yang sama** dengan penyimpanan entitas. Berkas yang sudah dimiliki entitas lain ditolak `CONFLICT`. Jenis pemilik baru ditambahkan ke `FileOwnerType` di `shared/files.ts`.
- **Tampil**: `useFileUrl(id)` (cache lama, data URL). Server hanya membaca berkas yang tercatat di sheet `files`; klien tidak pernah mengirim Drive id.
- **Markdown**: tampilkan dengan `MarkdownView` dan edit dengan `MarkdownEditor` (`web/src/modules/markdown/`). Gambar ditulis `![alt](qcfile:<id>)`. HTML mentah tidak dirender dan hanya tautan `http`/`https`/`mailto` yang aktif. Validasi panjang (`MARKDOWN_MAX_LENGTH` = 20.000) tetap dilakukan di skema form dan di validator server.
- **Drive** hanya diakses lewat `platform_()` (`driveCreateFolder`, `driveCreateFile`, `driveReadFile`); jangan memanggil `DriveApp` langsung.

## Sumber daya sinkron
Bila modul perlu disinkronkan dengan QC Desktop, ikuti bagian 5 `docs/api/desktop-sync.md`. Handler sinkron tidak menerima `UserContext`; penulisan memakai fungsi domain yang sama dengan rute REST web (mis. `writeItem_`) agar keunikan, audit, dan `sync_rev` konsisten.
