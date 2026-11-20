# Redesain Fase 4c: Akses + Customer — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Pengguna, Role, Lokasi, Business Unit, Customer memakai kit CRUD dengan View, Form Dialog (bertab bila perlu), aksi massal atomik, dan soft delete; Log Audit dan Status Push pindah ke `ListPage`/`DataTable` dan entri audit baru menaut ke View entitasnya.

**Architecture:** Pola fase 3/4a. Rute status akses hari ini menulis tanpa CAS setelah `loadAccessTables`; perencana baru memakai muatan tabel akses yang sama untuk satu `batch()` per permintaan (penjaga usang mengikuti rute tunggal: tanpa `updatedAt`, spek §8 butir 6). Customer memakai `runCas` yang ada. Audit mendapat kolom `target_id` (expand-only) yang diisi penulis audit model ber-View; DTO menurunkan `targetRef`.

**Tech Stack:** seperti fase sebelumnya.

> **Disesuaikan 2026-11-21 setelah merge origin/dev (commit merge 9976b97d).** Perubahan terhadap versi 2026-11-20: (1) Stok Stiker tidak lagi halaman `/sticker/stock` (digabung ke `/sticker`; keputusan pemilik 2026-11-20, spek redesain §5 butir 30): tautan "Stok" di View Lokasi diganti; (2) Kebijakan versi API ditambahkan ke Global Constraints, dan awalan jalur batch dikoreksi agar mengikuti `API_ROUTES` yang ada (`/users/...`, `/roles/...`, `/locations/...`, `/business-units/...`, bukan `/access/...`); (3) aturan Lampiran berkas dicatat (fase ini tanpa lampiran: tidak ada `<input type="file">` baru); (4) fase 3 sudah selesai, pola yang dibangunnya dirujuk ("pakai yang ada"). Tidak ada asumsi baru yang menunggu pemilik kecuali spek redesain §9 butir 3 (hapus keras → lunak pada `access.roles.delete` tetap v1).

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§6.5-6.9, §8 butir 1, 5, 6, 7, 8), `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§4.2, §4.3, §5 butir 2, 3, 7, 8). Inventaris: `.superpowers/sdd/fase-4-inventaris.md` bagian 0.6 dan 4c.

## Global Constraints

- Hapus/Pulihkan = `access: manage` (akses) dan `item: manage` (Customer); Pengguna/Lokasi/BU/Customer wajib Nonaktif dulu; Role hanya bila tidak dipakai PENGGUNA HIDUP mana pun (keputusan pemilik soft delete 15d) (penjaga "Role masih dipakai oleh N user" dipertahankan; pengguna terhapus tidak menghalangi); dipulihkan sebagai Nonaktif (Role tanpa status).
- Akun sendiri tidak dapat dinonaktifkan/dihapus; penjaga "Kelola global" yang ada berlaku juga untuk hapus dan batch (seluruh batch ditolak, pesan generik).
- Hak (keputusan pemilik soft delete 9; sudah di fase 2b `ACCESS_SQL`): pengguna dan role terhapus tidak memberi hak; lokasi terhapus berperilaku seperti lokasi nonaktif hari ini; BU terhapus TETAP memberi hak seperti BU nonaktif hari ini (item/serial BU itu tetap terbuka dan dapat diubah) dan syarat tulis "SEMUA BU item" mengabaikannya. Semua record terhapus tidak ditawarkan di pilihan (`LinkField`, `LocationPicker` header, `LocationField`) tetapi tetap tampil dengan `DeletedBadge` di tempat ia dirujuk (penugasan pengguna, serial, item, task). Penerima surel (stok, Postel, Serial rusak) adalah alamat bebas dan tidak berubah walau penggunanya dihapus (keputusan pemilik 15b).
- Dialog konfirmasi hapus BU/Lokasi/Role menampilkan jumlah pemakaian yang sudah ada di DTO (Item, User) — spek soft delete §5 butir 2.
- `customers.save` lewat Serah Terima (`resolveCustomerByName`) mengabaikan customer terhapus (membuat customer baru bila nama sama); saran customer tidak menawarkan yang terhapus.
- Customer diubah lewat Form Dialog (ubah nama inline dihapus; spek §8 butir 7); tetap tanpa "Tambah" (dibuat otomatis lewat Serah Terima).
- Email pengguna terhapus TIDAK dipakai akun baru: `users_email` tetap unik penuh; untuk memakai email itu lagi, pulihkan akun lama (keputusan pemilik soft delete 10).
- Rujukan tersimpan dipertahankan (T1): `access.users.save` menerima role/lokasi/BU penugasan yang TIDAK berubah walau terhapus (atau nonaktif); yang baru harus hidup. Hapus ulang = sukses tanpa audit (T2); `deleted_at` ISO UTC, `deleted_by` email (T10); hitungan pemakaian di dialog konfirmasi = record hidup (T6).
- Tambah (keputusan pemilik 18): `LinkField` lokasi, role, dan BU pada form pengguna mendapat baris "Tambah" (dialog lokasi/role/BU) bila berhak. Lokasi punya View, sehingga `LinkField` lokasi pada penugasan pengguna dan `SerialLocationField` mendapat Buka bila berhak; `LocationField` (form tulis modul berlokasi) tetap tanpa Tambah/Buka.
- Aksi massal bertahap lewat `runChunkedBatch` (keputusan pemilik 19); luring = toast galat (T21); aksi baris di ponsel = menu "⋯" (keputusan pemilik 22; tes berpatokan lebar ≥ 768 px); setelah Hapus dari View: navigasi ke indeks induk + toast "Dihapus" (T22). Log Audit menaut ke View lewat `audit_log.target_id` (keputusan pemilik 20).
- Log Audit tidak disaring soft delete; aksi `*.delete`/`*.restore` baru punya label dan masuk filter aksi.
- Pakai yang ada dari fase 3 (diverifikasi di kode 2026-11-21; jangan dibangun ulang): server `runRecordBatch`/`runSingleRecord` (`server/src/core/record-batch.ts`; opsi `verify` untuk pemeriksaan lintas record, mis. memulihkan beberapa lokasi/BU berkode sama sekaligus) dan pola `planItemStatus|Remove|Restore`/`planBrand*`; `validateIdBatch`/`validateStatusBatch` (`server/src/core/validate.ts`), `mapLiveDuplicate`, `versionGuardStmt`/`stampStmt` (`core/soft-delete.ts`); web `useBulkAction({ subject })`, `useAfterDelete`, `DeletedBadge`/`DeletedBanner`/`ConfirmDeleteDialog`, `statusFilterOptions`, `LinkCell`, `RowActions`, `runChunkedBatch`; dialog "Tambah" bersarang dari form pengguna (lokasi, role, BU) mengikuti pola dialog-di-luar-`<form>` (`ItemCreateHost` di `AppShell` atau dialog saudara seperti `brand-form-dialog.tsx`), bukan dibangun ulang.
- Kebijakan versi API (CLAUDE.md "Kebijakan versi API"; spek redesain §5 butir 32): kontrak kompatibel mundur; fase ini hanya MENAMBAH id (`*.get`, `*.setStatusBatch`, `*.remove`, `*.removeBatch`, `*.restore`, `*.restoreBatch` untuk pengguna/lokasi/BU/Customer; `access.roles.get|removeBatch|restore|restoreBatch`), kunci query opsional `status`, dan field DTO opsional (`deleted?`, `deletedRoleIds`, `targetRef?`). Id lama TIDAK dihapus atau diubah: `access.users.setStatus`, `access.locations.setStatus`, `access.businessUnits.setStatus`, `customers.setStatus`, dan `customers.rename` (`PUT /customers/{id}`; tetap dipakai Form Dialog Customer, hanya UI "ubah nama inline"-nya yang diganti) tetap; `access.roles.delete` (`DELETE /roles/{id}`, keluaran `{ id }`) tetap dengan bentuk itu dan hanya semantiknya yang beralih ke hapus lunak (asumsi sementara spek redesain §9 butir 3). Awalan jalur mengikuti `API_ROUTES` yang ada: `/users`, `/roles`, `/locations`, `/business-units`, `/customers` (BUKAN `/access/...`; id berawalan `access.` hanya nama kelompok); mis. `GET /users/{id}`, `POST /users/batch/status|delete`, `POST /users/{id}/restore`, `POST /users/batch/restore`. Rute statis (`/users/batch/...`) didaftarkan sebelum `/{id}`. Potret `shared/api-contract.snapshot.json` TIDAK diperbarui di fase ini (hanya `bun run api:snapshot` saat rilis); tes kompatibilitas potret hijau. Migrasi `0028` (kolom `target_id`) bukan perubahan kontrak API.
- Lampiran berkas (CLAUDE.md "Lampiran berkas wajib `FileDialog`"; spek redesain §5 butir 31): fase ini tidak memiliki lampiran berkas; bila ada penyesuaian yang menyentuh unggahan (mis. gambar di editor Markdown), pakai komponen `FileDialog`/`useBackgroundUploads` yang ada, dan jangan membuat `<input type="file">` baru (`scripts/no-native-file-input.test.ts`).
- Wajib hijau: `bun run check`.

## Review Focus

1. Menghapus role yang hanya dipakai pengguna terhapus → boleh; dipakai satu pengguna hidup → ditolak. (Task 1)
2. Batch Nonaktifkan pengguna berisi akun pemanggil → seluruh batch ditolak, tak ada yang berubah. (Task 1)
3. Lokasi terhapus tidak muncul di pemilih lokasi header pengguna yang dulu ditugaskan ke sana, dan izin berlokasi ke lokasi itu hilang; BU terhapus tetap memberi hak (item BU itu tetap dapat dibuka/diubah) tetapi tak muncul di pilihan/filter. (Task 2)
4. Task Serah Terima lama dengan customer terhapus tetap menampilkan nama customer; menyimpan task baru dengan nama yang sama membuat customer baru (bukan menghidupkan yang terhapus). (Task 3)
5. Entri audit lama (tanpa `target_id`) tetap tampil sebagai teks tanpa tautan; entri baru menaut ke View hanya bila pengguna berhak membuka View itu. (Task 3, 6)
6. Email pengguna terhapus dipakai pendaftaran pengguna baru → ditolak generik (indeks `users_email` penuh); memulihkan akun lama berhasil. (Task 1)
7. Menyimpan pengguna yang penugasannya memuat role/lokasi/BU terhapus tanpa mengubahnya berhasil; menambah yang terhapus ditolak. (Task 1)

## Pembagian kelas beban

Sonnet: Task 1-6. Haiku: Task 7. Berurutan.

---

### Task 1: Server Pengguna + Role

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/access/{service,repo,validate,routes}.ts`, pembaca `users`/`roles` (`notification/emit.ts`, `notification/push-service.ts`, `notification/recipients.ts`, `sticker/guide-repo.ts` sebagai penampil, `serial/alert.ts` `canManageSerialSettings`), `soft-delete-pending.ts`
- Test: `server/src/modules/access/soft-delete-users-roles.test.ts` (Create), `access/rest.test.ts`

**Interfaces:**
- Produces: `access.users.get` (`GET /access/users/{id}`, `access: view`), `access.users.setStatusBatch`, `access.users.remove`, `access.users.removeBatch`, `access.users.restore`, `access.users.restoreBatch`; `access.roles.get`, `access.roles.delete` (jalur tetap) menjadi soft delete, `access.roles.removeBatch`, `access.roles.restore`, `access.roles.restoreBatch`. Jalur mengikuti pola `/users/batch/status|delete|restore` dan `/users/{id}/restore`, `GET /users/{id}` (sama untuk `/roles`; dikoreksi 2026-11-21: sebelumnya tertulis `/access/users/...`, padahal `API_ROUTES` memakai `/users`, `/roles`, `/locations`, `/business-units`). `access.users.list`/`access.roles.list` menerima `status?: ListStatusFilter`; DTO `deleted?`; `UserDto.roleRefs` atau penanda per role yang terhapus agar form menampilkan "Terhapus" (nama field: `deletedRoleIds: string[]`). Audit `user.delete|restore`, `role.delete|restore`. Hapus role diizinkan bila tak dipakai PENGGUNA HIDUP (keputusan pemilik 15d).
- [ ] **Step 1: Tes gagal**: batch status tiga pengguna; akun pemanggil di batch → seluruhnya `FORBIDDEN`/`CONFLICT` generik; hapus pengguna Aktif → "Nonaktifkan pengguna dulu sebelum dihapus"; pengguna terhapus tidak menerima notifikasi/push; penerima surel (stok, Postel, Serial rusak) adalah alamat bebas dan tetap menerima walau penggunanya dihapus (keputusan pemilik 15b); email pengguna terhapus dipakai pengguna baru → `CONFLICT` pesan generik (`users_email` tetap unik penuh; keputusan pemilik soft delete 10), memulihkan akun lama berhasil; role dipakai pengguna hidup → "Role masih dipakai oleh 1 user"; dipakai hanya pengguna terhapus → terhapus; `UserDto.deletedRoleIds` memuat role terhapus milik pengguna; `canManageSerialSettings` tak menghitung role terhapus; rujukan tersimpan (T1): `access.users.save` dengan penugasan role/lokasi/BU terhapus tanpa mengubahnya → sukses, menambah yang terhapus → `VALIDATION`; hapus ulang → sukses tanpa audit.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/access src/modules/notification src/modules/serial src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): View, batch, hapus, dan pulihkan pengguna dan role`.

### Task 2: Server Lokasi + Business Unit

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/access/{location-service,business-unit-service,repo,validate,routes,location-brief}.ts`, pembaca `locations`/`business_units` (daftar inventaris 0.5: `desktop/catalog.ts`, `serial/*`, `brand/repo.ts`, `item/repo.ts`, `sticker/{repo,instruction-service}.ts`), `soft-delete-pending.ts`
- Test: `server/src/modules/access/soft-delete-locations-bus.test.ts` (Create), `access/rest.test.ts`

**Interfaces:**
- Produces: `access.locations.get|setStatusBatch|remove|removeBatch|restore|restoreBatch`, `access.businessUnits.get|setStatusBatch|remove|removeBatch|restore|restoreBatch` (pola jalur Task 1); `list` menerima `status`; DTO `deleted?`. Audit `location.delete|restore`, `businessUnit.delete|restore`. Penampil rujukan (kode/nama BU dan lokasi pada serial, item, laporan, surel, halaman publik) tetap membaca record terhapus dan diberi `deleted` bila DTO-nya memuat objek BU/lokasi. BU terhapus TETAP berada di `UserContext.businessUnits` (hak tidak berubah) tetapi dibuang dari pilihan/filter; jalur tulis (`item`, `serial`) menghitung "level pada SEMUA BU item" tanpa BU terhapus (keputusan pemilik soft delete 9). `serials.locationOptions`/`LocationPicker` tak menawarkan lokasi terhapus. Rujukan tersimpan dipertahankan (T1): `serials.update`/`items.save` menerima BU/lokasi yang TIDAK berubah walau terhapus.
- [ ] **Step 1: Tes gagal**: hapus lokasi Nonaktif → hilang dari `me.locations`, `ctx.locationIds`, `serials.locationOptions`, `serials.serviceLocations`, katalog desktop; serial di lokasi itu tetap menampilkan nama lokasi (perilaku sama dengan lokasi nonaktif; tes membandingkan keduanya); hapus BU Nonaktif → hak TETAP seperti BU nonaktif hari ini (item/serial milik BU itu tetap dapat dibuka dan diubah; tes membandingkan dengan BU nonaktif), BU itu hilang dari semua pilihan/filter (`LinkField` item/merk/serial), dan tulis item ber-BU {terhapus, hidup} cukup level pada BU hidup (keputusan pemilik soft delete 9); batch status lokasi + satu id asing → `NOT_FOUND`; pulihkan → Nonaktif.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/access src/modules/serial src/modules/item src/modules/brand src/modules/sticker src/modules/desktop src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): View, batch, hapus, dan pulihkan lokasi dan business unit`.

### Task 3: Server Customer + tautan audit

**Files:**
- Create: `server/migrations/0028_audit_target_id.sql` (expand-only: `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_id VARCHAR(100) NOT NULL DEFAULT ''`; nomor bebas berikutnya bila 0028 sudah terpakai), `server/src/modules/customer/soft-delete.test.ts`, `server/src/core/audit-target.test.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/core/audit.ts`, `server/src/modules/customer/{service,repo,validate,routes}.ts`, `server/src/modules/handover/service.ts` (`resolveCustomerByName` jalur simpan), `shared/suggest.ts` pemakai, pemanggil `writeAudit` untuk model ber-View (item, brand, customer, sticker, stickerType, qrcode, qrcode preset, postel, user, role, location, businessUnit, serial, handover), `server/src/modules/access/audit-routes` (atau tempat `access.audit.list`)
- Produces:
  - Customer (jalur mengikuti `/customers`: `GET /customers/{id}`, `POST /customers/batch/status|delete|restore`, `DELETE /customers/{id}`, `POST /customers/{id}/restore`; `customers.rename` dan `customers.setStatus` yang ada tidak berubah): `customers.get|setStatusBatch|remove|removeBatch|restore|restoreBatch` (`item: view` untuk `get`, `item: manage` untuk lainnya), `customers.list` menerima `status`, `CustomerDto.deleted?`; audit `customer.delete|restore`.
  - Audit: `AuditInput.targetId?: string`; `AuditEntryDto.targetRef?: { kind: AuditTargetKind; id: string }` dengan `AuditTargetKind = 'item' | 'brand' | 'customer' | 'sticker' | 'stickerType' | 'qrDesign' | 'qrPreset' | 'postel' | 'user' | 'role' | 'location' | 'businessUnit' | 'serial' | 'handover'`, diturunkan dari awalan `action` lewat satu peta di `shared/audit.ts` (`auditTargetKind(action)`); kosong = tanpa `targetRef`. Keputusan pemilik 2026-11-20 (redesain §5 butir 20): hanya entri baru yang tertaut; entri lama tetap teks.
- [ ] **Step 1: Tes gagal**: customer terhapus tak muncul di `customers.list` default dan saran; `handovers.save` dengan nama customer terhapus membuat customer baru; task lama tetap menampilkan nama; hapus customer Aktif → "Nonaktifkan customer dulu sebelum dihapus"; `writeAudit` dengan `targetId` menyimpannya; `access.audit.list` mengembalikan `targetRef` untuk entri `brand.update` ber-`targetId` dan tanpa `targetRef` untuk entri lama; setiap aksi audit model ber-View yang ditulis tes modul membawa `targetId` (tes menelusuri berkas service: setiap `writeAudit(` untuk aksi berawalan peta `auditTargetKind` memuat `targetId`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/customer src/modules/handover src/core src/modules/access` → PASS, lalu `bun run --cwd server test` penuh (pemanggil audit tersebar).
- [ ] **Step 5:** Commit `feat(server): soft delete customer dan tautan entitas pada log audit`.

### Task 4: Web Pengguna + Role

**Files:**
- Modify: `web/src/routes/_app/access/{users,roles}.tsx` (menjadi `users/index.tsx`, `roles/index.tsx` bila router butuh), `web/src/modules/access/components/{users-table,user-form,roles-table,role-form,permission-badges}.tsx`, `web/src/modules/access/queries.ts`, `web/src/lib/link-access.ts`
- Create: `web/src/routes/_app/access/users/$userId.tsx`, `web/src/routes/_app/access/roles/$roleId.tsx`, `web/src/modules/access/components/{user-view,role-view,user-form-dialog,role-form-dialog}.tsx`
- Test: tes komponen yang ada + `user-view.test.tsx`, `role-view.test.tsx`

**Interfaces:**
- Pengguna daftar: [checkbox `access: manage`][Aksi: Ubah (dialog), status, Hapus/Pulihkan][Email `LinkCell` → View + badge Akun bersama][Nama][Penugasan (badge lokasi tautan : role tautan)][Penugasan BU][Status]; filter cari + Status. View: tab Detail (identitas), Penugasan lokasi, Penugasan BU; aksi dialog Ubah.
- `UserFormDialog` = `FormDialogShell` + `FormTabs` (Identitas, Penugasan lokasi, Penugasan BU); `LinkField` lokasi/role/BU mendapat "Tambah" (dialog lokasi/role/BU) dan "Buka" bila berhak (fungsi baru `locationLinkAccess`, `roleLinkAccess` di `link-access.ts`); role/lokasi/BU terhapus pada penugasan tampil sebagai chip "Terhapus" dan dipertahankan saat simpan tanpa diubah (T1; yang baru harus hidup). Tambah/Buka mengikuti keputusan pemilik 18: `locationLinkAccess`/`roleLinkAccess` memberi `canCreate` dan `openHref`; `SerialLocationField` (modul Serial) ikut mendapat Buka bila berhak, `LocationField` tetap tanpa Tambah/Buka. `FormDialogShell size="lg"` dengan `FormTabs` tanpa menimpa `stickyTop` (bawaan menempel tepat di bawah header dialog lewat `--dialog-header-height`, keputusan 28; override `stickyTop="0px"` pada versi 2026-11-20 dicabut 2026-11-21 karena menimpa judul dialog); pada dialog Tambah bertumpuk Escape menutup yang teratas saja (T20).
- Role daftar: [checkbox][Aksi: Ubah, Hapus/Pulihkan][Nama `LinkCell`][Akses badge][User (jumlah)]; View: tab Izin (matriks baca), Pengguna (dari cache daftar pengguna, `LinkCell`).
- [ ] **Step 1: Tes gagal**: email → View; batch Nonaktifkan memanggil `access.users.setStatusBatch`; form pengguna bertab, galat email → tab Identitas; "Tambah lokasi" dari baris penugasan membuka dialog lokasi di luar form dan memilih hasilnya; View role menampilkan pengguna pemakainya bertaut; "Tambah role" dari penugasan membuka dialog role; Buka lokasi menaut ke `/access/locations/$locationId` bila `access: view`; Hapus dari View → daftar induk + toast "Dihapus"; aksi baris di ponsel = menu "⋯".
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/access src/lib src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Pengguna dan Role di kit dengan View dan aksi massal`.

### Task 5: Web Lokasi, Business Unit, Log Audit, Status Push

**Files:**
- Modify: `web/src/routes/_app/access/{locations,audit,push}.tsx`, `web/src/routes/_app/access/business-units/*`, `web/src/modules/access/components/{locations-table,location-form,business-units-table,business-unit-form-dialog,business-unit-detail-view,audit-table}.tsx`, `web/src/modules/push/components/push-status-page.tsx`, `web/src/modules/access/lib/audit-labels.ts` (atau tempat `auditActionLabel`)
- Create: `web/src/routes/_app/access/locations/$locationId.tsx`, `web/src/modules/access/components/location-view.tsx`, `web/src/modules/access/lib/audit-link.ts`
- Test: tes komponen terkait + `location-view.test.tsx`, `audit-link.test.ts`

**Interfaces:**
- Lokasi dan BU daftar: [checkbox][Aksi: Ubah, status, Hapus/Pulihkan][Kode `LinkCell` → View][Nama][Item/User jumlah bila ada][Status]; konfirmasi hapus menyebut pemakaian ("Dipakai 12 item, 3 pengguna"; dihitung dari record hidup, T6). View lokasi: Identitas + "Data terkait" tautan (Serial di lokasi ini `/serial?locationId=`; Stok ke `/sticker`, halaman Stiker gabungan katalog + stok, disesuaikan 2026-11-21 setelah merge origin/dev: `/sticker/stock` kini hanya redirect; halaman itu tidak punya filter lokasi di URL, stok mengikuti pemilih lokasi di header, jadi tautan tanpa `locationId` dan hanya tampil bila pengguna dapat membuka halaman itu: `sticker: view` ATAU `stickerstock: view`); aside `ViewMeta` tanpa angka hitungan, "Dibuat" hanya bila DTO punya `createdBy` (T12); setelah Hapus → `/access/locations` + toast "Dihapus" (T22). View BU dipindah ke `ViewPage` (spek §8 butir 8), data dari `access.businessUnits.get`.
- Log Audit: `ListPage` + `DataTable` tanpa checkbox; kolom Waktu, Pelaku, Aksi badge, Target (`LinkCell` lewat `auditTargetHref(entry, me)` bila `targetRef` ada dan pengguna dapat membaca model itu, selain itu teks), aksi kiri `ActionButton compact` "Lihat detail" (Sheet diff tetap); filter cari + Aksi (label baru untuk `*.delete`/`*.restore`); "Muat lebih banyak" tetap.
- Status Push: `ListPage` + `DataTable` tanpa checkbox; Nama `LinkCell` → View pengguna.
- [ ] **Step 1: Tes gagal**: kode lokasi → View; konfirmasi hapus BU menampilkan jumlah item; target audit `brand.update` dengan `targetRef` menaut ke `/item/brands/<id>` bagi pembaca item dan teks bagi yang tidak; filter aksi memuat "Hapus merk" dan "Pulihkan merk".
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/access src/modules/push src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Lokasi, Business Unit, Log Audit, dan Status Push di kit`.

### Task 6: Web Customer

**Files:**
- Modify: `web/src/routes/_app/customer.tsx` (menjadi `customer/index.tsx`), `web/src/modules/customer/components/customers-manager.tsx`, `web/src/modules/customer/queries.ts`, `web/src/modules/handover/components/*` yang menampilkan nama customer (kartu, detail task) → `LinkCell`/tautan ke View customer bila `item: view`
- Create: `web/src/routes/_app/customer/$customerId.tsx`, `web/src/modules/customer/components/{customer-view,customer-form-dialog}.tsx`
- Test: `customers-manager.test.tsx`, `customer-view.test.tsx`

**Interfaces:**
- Daftar: [checkbox `item: manage`][Aksi: Ubah (dialog satu field Nama; tetap memanggil `customers.rename`, id yang ada tidak dihapus), status, Hapus/Pulihkan][Customer `LinkCell` → View][Status]; filter cari + Status. View: Identitas + tautan "Lihat task Serah Terima customer ini" (ke papan dengan pencarian nama). Ubah nama inline dihapus.
- [ ] **Step 1: Tes gagal**: nama → View; Ubah membuka dialog; batch Hapus memanggil `customers.removeBatch`; nama customer di detail task menaut ke View customer hanya bagi `item: view` (izin tak diubah; keputusan pemilik 15c), selain itu teks biasa.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/customer src/modules/handover src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Customer di kit dengan View dan form dialog`.

### Task 7 (Haiku): Dokumentasi, changelog, verifikasi

**Files:**
- Modify: `CLAUDE.md` (Akses: rute `get`/batch/hapus/pulihkan, `deletedRoleIds`; Customer: View + dialog, hapus/pulihkan; audit `target_id`/`targetRef`/`auditTargetKind`; migrasi `0028`; hak BU/lokasi terhapus (BU tetap memberi hak, lokasi = nonaktif); email pengguna terhapus tak dipakai ulang; SUNTING, bukan hanya menambah, pernyataan CLAUDE.md yang bertentangan, mis. "Tambah lokasi/role dari form lain tidak dibuat"; periksa `docs/e2e-checklist*.md` dan teks langkah panduan, T23), `docs/ci-cd.md` (pengecualian rollback: setelah rilis rollback image TIDAK aman, perbaiki ke depan; catat juga bahwa `target_id` diabaikan image lama)
- Create: `server/changelog.d/20261120-akses-customer-hapus.md` (`jenis: ditambah`; paragraf: halaman detail pengguna, role, lokasi, dan customer; pilih banyak untuk diaktifkan/dinonaktifkan/dihapus/dipulihkan; Log Audit menaut ke data yang diubah)
- [ ] **Step 1:** Tulis. **Step 2:** `bun run check` → hijau. **Step 3:** Commit `docs: Akses dan Customer di kit + soft delete`.
