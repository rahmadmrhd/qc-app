# Menambah modul baru

Contoh: modul `item` (Data Item). Modul sudah terdaftar di `MODULES` (`shared/permissions.ts`); untuk modul yang benar-benar baru, tambahkan key dan label di sana terlebih dahulu.

## 1. Kontrak — `shared/rpc.ts`
Tambahkan DTO, input, dan entri `RpcContract`, mis. `'item.list': { input: null; output: ItemDto[] }`.

## 2. Backend — `gas/src/modules/item/`
- `repo.ts` — `ITEMS_TABLE: TableSchema`, fungsi baca/tulis memakai `readTable_`/`insertRow_`/`updateRow_`.
- `validate.ts` — `validateXxx_(raw)` memakai `readObject_`.
- `service.ts` — logika bisnis; semua penulisan di dalam `platform_().withLock(...)`, catat `appendAudit_` bila perlu.
- `routes.ts` — `itemRoutes_(): Pick<RouteTable, ...>` dengan `permission: { module: 'item', level: 'view' | 'edit' | 'manage' }`.
- Daftarkan di `gas/src/routes.ts`: `{ ...authRoutes_(), ...accessRoutes_(), ...itemRoutes_() }`.
- Bila modul punya sheet, tambahkan tabelnya ke `runSetup_` (`gas/src/setup.ts`).
- Ingat: semua fungsi top-level berakhiran `_`, nama unik global.
- Test di samping file (`*.test.ts`) memakai `createMemoryPlatform` dan fixture.

## 3. Frontend — `web/src/modules/item/`
- `queries.ts` — `queryOptions` + mutation (invalidate key modul).
- `schemas.ts` — skema zod form.
- `components/` — form & tabel.
- Route di `web/src/routes/_app/item/*.tsx` dengan `beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view')`.
- Tambahkan menu di `NAV_GROUPS` (`web/src/app/navigation.ts`) dan link di `MODULE_LINKS` (`web/src/app/module-links.ts`).
- Data contoh untuk dev di `web/src/lib/rpc/mock-backend.ts`.

## 4. Selesai bila
`bun run check` hijau, `bun run build` lolos verify-dist, dan alur utama dicoba di `bun run dev` (terang dan gelap) serta di deployment.

## Modul berlokasi (izin per lokasi)

Modul `item`, `handover`, dan `stock` bersifat berlokasi (`LOCATION_MODULES` di `shared/assignments.ts`); `access` global. Untuk modul berlokasi:

1. **Rute GAS** wajib menandai `scope: 'location'`:

   ```ts
   'item.list': {
     permission: { module: 'item', level: 'view', scope: 'location' },
     validate: validateListItems_,   // input memuat `locationIds: string[]`
     handler: (input, ctx) => listItems_(ctx.locationIds),
   },
   'item.save': {
     permission: { module: 'item', level: 'edit', scope: 'location' },
     validate: validateSaveItem_,    // input memuat `locationId: string`
     handler: (input, ctx) => saveItem_(input, ctx.locationIds[0]),
   },
   ```

   Router memeriksa tiap lokasi (ada, aktif, level cukup); satu gagal menolak seluruh permintaan dengan `FORBIDDEN`. **Gunakan `ctx.locationIds`, bukan input mentah.** Lupa `scope: 'location'` membuat izin diperiksa secara global.
2. **Data**: setiap baris punya kolom `location_id`; baca difilter ke `ctx.locationIds`, ubah/hapus memeriksa lokasi baris yang ada (izin ditegakkan lagi di lokasi baris itu).
3. **Frontend**: baca dengan `useActiveLocations().selectedIds`; form tulis memakai `LocationField` (`web/src/modules/location/location-field.tsx`); menu memakai `permission: { module, level, scope: 'location' }` pada `NAV_GROUPS`; guard route memakai `requirePermission` (memeriksa minimal satu lokasi).
4. **Tabel**: tampilkan kolom **Lokasi** bila `selectedIds.length > 1` (PRD FR-C5); dengan satu lokasi terpilih kolom itu tidak perlu.
5. **Tes**: tambahkan kasus lokasi terlarang, tak dikenal, dan nonaktif untuk method baru.
