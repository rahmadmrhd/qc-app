# Redesain Fase 4c: Akses + Customer — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Alur putaran mengikuti CLAUDE.md global pemilik.

**Goal:** Pengguna, Role, Lokasi, Business Unit, Customer memakai kit CRUD dengan View, Form Dialog (bertab bila perlu), aksi massal atomik, dan soft delete; Log Audit dan Status Push pindah ke `ListPage`/`DataTable` dan entri audit baru menaut ke View entitasnya.

**Architecture:** Pola fase 3/4a. Rute status akses hari ini menulis tanpa CAS setelah `loadAccessTables`; perencana baru memakai muatan tabel akses yang sama untuk satu `batch()` per permintaan (penjaga usang mengikuti rute tunggal: tanpa `updatedAt`, spek §8 butir 6). Customer memakai `runCas` yang ada. Audit mendapat kolom `target_id` (expand-only) yang diisi penulis audit model ber-View; DTO menurunkan `targetRef`.

**Tech Stack:** seperti fase sebelumnya.

**Spec:** `docs/superpowers/specs/2026-11-20-redesain-tampilan-design.md` (§6.5-6.9, §8 butir 1, 5, 6, 7, 8), `docs/superpowers/specs/2026-11-20-soft-delete-design.md` (§4.2, §4.3, §5 butir 2, 3, 7, 8). Inventaris: `.superpowers/sdd/fase-4-inventaris.md` bagian 0.6 dan 4c.

## Global Constraints

- Hapus/Pulihkan = `access: manage` (akses) dan `item: manage` (Customer); Pengguna/Lokasi/BU/Customer wajib Nonaktif dulu; Role hanya bila tidak dipakai PENGGUNA HIDUP mana pun (penjaga "Role masih dipakai oleh N user" dipertahankan; pengguna terhapus tidak menghalangi); dipulihkan sebagai Nonaktif (Role tanpa status).
- Akun sendiri tidak dapat dinonaktifkan/dihapus; penjaga "Kelola global" yang ada berlaku juga untuk hapus dan batch (seluruh batch ditolak, pesan generik).
- Record akses terhapus tidak memberi hak (sudah di fase 2b `ACCESS_SQL`), tidak ditawarkan di pilihan (`LinkField`, `LocationPicker` header, `LocationField`, penerima surel), tetapi tetap tampil dengan `DeletedBadge` di tempat ia dirujuk (penugasan pengguna, serial, item, task).
- Dialog konfirmasi hapus BU/Lokasi/Role menampilkan jumlah pemakaian yang sudah ada di DTO (Item, User) — spek soft delete §5 butir 2.
- `customers.save` lewat Serah Terima (`resolveCustomerByName`) mengabaikan customer terhapus (membuat customer baru bila nama sama); saran customer tidak menawarkan yang terhapus.
- Customer diubah lewat Form Dialog (ubah nama inline dihapus; spek §8 butir 7); tetap tanpa "Tambah" (dibuat otomatis lewat Serah Terima).
- Log Audit tidak disaring soft delete; aksi `*.delete`/`*.restore` baru punya label dan masuk filter aksi.
- Wajib hijau: `bun run check`.

## Review Focus

1. Menghapus role yang hanya dipakai pengguna terhapus → boleh; dipakai satu pengguna hidup → ditolak. (Task 1)
2. Batch Nonaktifkan pengguna berisi akun pemanggil → seluruh batch ditolak, tak ada yang berubah. (Task 1)
3. Lokasi terhapus tidak muncul di pemilih lokasi header pengguna yang dulu ditugaskan ke sana, dan izin berlokasi ke lokasi itu hilang. (Task 2)
4. Task Serah Terima lama dengan customer terhapus tetap menampilkan nama customer; menyimpan task baru dengan nama yang sama membuat customer baru (bukan menghidupkan yang terhapus). (Task 3)
5. Entri audit lama (tanpa `target_id`) tetap tampil sebagai teks tanpa tautan; entri baru menaut ke View hanya bila pengguna berhak membuka View itu. (Task 3, 6)

## Pembagian kelas beban

Sonnet: Task 1-6. Haiku: Task 7. Berurutan.

---

### Task 1: Server Pengguna + Role

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/access/{service,repo,validate,routes}.ts`, pembaca `users`/`roles` (`notification/emit.ts`, `notification/push-service.ts`, `notification/recipients.ts`, `sticker/guide-repo.ts` sebagai penampil, `serial/alert.ts` `canManageSerialSettings`), `soft-delete-pending.ts`
- Test: `server/src/modules/access/soft-delete-users-roles.test.ts` (Create), `access/rest.test.ts`

**Interfaces:**
- Produces: `access.users.get` (`GET /access/users/{id}`, `access: view`), `access.users.setStatusBatch`, `access.users.remove`, `access.users.removeBatch`, `access.users.restore`, `access.users.restoreBatch`; `access.roles.get`, `access.roles.delete` (jalur tetap) menjadi soft delete, `access.roles.removeBatch`, `access.roles.restore`, `access.roles.restoreBatch`. Jalur mengikuti pola `/access/users/batch/status|delete|restore` dan `/access/users/{id}/restore` (sama untuk roles). `access.users.list`/`access.roles.list` menerima `status?: ListStatusFilter`; DTO `deleted?`; `UserDto.roleRefs` atau penanda per role yang terhapus agar form menampilkan "Terhapus" (nama field: `deletedRoleIds: string[]`). Audit `user.delete|restore`, `role.delete|restore`.
- [ ] **Step 1: Tes gagal**: batch status tiga pengguna; akun pemanggil di batch → seluruhnya `FORBIDDEN`/`CONFLICT` generik; hapus pengguna Aktif → "Nonaktifkan pengguna dulu sebelum dihapus"; pengguna terhapus tidak menerima notifikasi/push dan tak muncul di penerima surel; email terhapus dipakai pengguna baru → `CONFLICT` sampai rilis contract (indeks lama `users_email` masih ada; tes menegaskan pesan generik); role dipakai pengguna hidup → "Role masih dipakai oleh 1 user"; dipakai hanya pengguna terhapus → terhapus; `UserDto.deletedRoleIds` memuat role terhapus milik pengguna; `canManageSerialSettings` tak menghitung role terhapus.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/access src/modules/notification src/modules/serial src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): View, batch, hapus, dan pulihkan pengguna dan role`.

### Task 2: Server Lokasi + Business Unit

**Files:**
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/modules/access/{location-service,business-unit-service,repo,validate,routes,location-brief}.ts`, pembaca `locations`/`business_units` (daftar inventaris 0.5: `desktop/catalog.ts`, `serial/*`, `brand/repo.ts`, `item/repo.ts`, `sticker/{repo,instruction-service}.ts`), `soft-delete-pending.ts`
- Test: `server/src/modules/access/soft-delete-locations-bus.test.ts` (Create), `access/rest.test.ts`

**Interfaces:**
- Produces: `access.locations.get|setStatusBatch|remove|removeBatch|restore|restoreBatch`, `access.businessUnits.get|setStatusBatch|remove|removeBatch|restore|restoreBatch` (pola jalur Task 1); `list` menerima `status`; DTO `deleted?`. Audit `location.delete|restore`, `businessUnit.delete|restore`. Penampil rujukan (kode/nama BU dan lokasi pada serial, item, laporan, surel, halaman publik) tetap membaca record terhapus dan diberi `deleted` bila DTO-nya memuat objek BU/lokasi.
- [ ] **Step 1: Tes gagal**: hapus lokasi Nonaktif → hilang dari `me.locations`, `ctx.locationIds`, `serials.locationOptions`, `serials.serviceLocations`, katalog desktop; serial di lokasi itu tetap menampilkan nama lokasi; hapus BU Nonaktif → item ber-BU itu saja jadi tak terlihat (sama seperti BU nonaktif hari ini; tes menegaskan perilaku sama dengan nonaktif), BU tak ditawarkan di `LinkField` item/merk/serial; batch status lokasi + satu id asing → `NOT_FOUND`; pulihkan → Nonaktif.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd server test src/modules/access src/modules/serial src/modules/item src/modules/brand src/modules/sticker src/modules/desktop src/core` → PASS.
- [ ] **Step 5:** Commit `feat(server): View, batch, hapus, dan pulihkan lokasi dan business unit`.

### Task 3: Server Customer + tautan audit

**Files:**
- Create: `server/migrations/0028_audit_target_id.sql` (expand-only: `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_id VARCHAR(100) NOT NULL DEFAULT ''`; nomor bebas berikutnya bila 0028 sudah terpakai), `server/src/modules/customer/soft-delete.test.ts`, `server/src/core/audit-target.test.ts`
- Modify: `shared/contract.ts`, `shared/api.ts`, `server/src/core/audit.ts`, `server/src/modules/customer/{service,repo,validate,routes}.ts`, `server/src/modules/handover/service.ts` (`resolveCustomerByName` jalur simpan), `shared/suggest.ts` pemakai, pemanggil `writeAudit` untuk model ber-View (item, brand, customer, sticker, stickerType, qrcode, qrcode preset, postel, user, role, location, businessUnit, serial, handover), `server/src/modules/access/audit-routes` (atau tempat `access.audit.list`)
- Produces:
  - Customer: `customers.get|setStatusBatch|remove|removeBatch|restore|restoreBatch` (`item: view` untuk `get`, `item: manage` untuk lainnya), `customers.list` menerima `status`, `CustomerDto.deleted?`; audit `customer.delete|restore`.
  - Audit: `AuditInput.targetId?: string`; `AuditEntryDto.targetRef?: { kind: AuditTargetKind; id: string }` dengan `AuditTargetKind = 'item' | 'brand' | 'customer' | 'sticker' | 'stickerType' | 'qrDesign' | 'qrPreset' | 'postel' | 'user' | 'role' | 'location' | 'businessUnit' | 'serial' | 'handover'`, diturunkan dari awalan `action` lewat satu peta di `shared/audit.ts` (`auditTargetKind(action)`); kosong = tanpa `targetRef`.
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
- `UserFormDialog` = `FormDialogShell` + `FormTabs` (Identitas, Penugasan lokasi, Penugasan BU); `LinkField` lokasi/role/BU mendapat "Tambah" (dialog lokasi/role/BU) dan "Buka" bila berhak (fungsi baru `locationLinkAccess`, `roleLinkAccess` di `link-access.ts`); role terhapus pada penugasan tampil sebagai chip "Terhapus".
- Role daftar: [checkbox][Aksi: Ubah, Hapus/Pulihkan][Nama `LinkCell`][Akses badge][User (jumlah)]; View: tab Izin (matriks baca), Pengguna (dari cache daftar pengguna, `LinkCell`).
- [ ] **Step 1: Tes gagal**: email → View; batch Nonaktifkan memanggil `access.users.setStatusBatch`; form pengguna bertab, galat email → tab Identitas; "Tambah lokasi" dari baris penugasan membuka dialog lokasi di luar form dan memilih hasilnya; View role menampilkan pengguna pemakainya bertaut.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/access src/lib src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Pengguna dan Role di kit dengan View dan aksi massal`.

### Task 5: Web Lokasi, Business Unit, Log Audit, Status Push

**Files:**
- Modify: `web/src/routes/_app/access/{locations,audit,push}.tsx`, `web/src/routes/_app/access/business-units/*`, `web/src/modules/access/components/{locations-table,location-form,business-units-table,business-unit-form-dialog,business-unit-detail-view,audit-table}.tsx`, `web/src/modules/push/components/push-status-page.tsx`, `web/src/modules/access/lib/audit-labels.ts` (atau tempat `auditActionLabel`)
- Create: `web/src/routes/_app/access/locations/$locationId.tsx`, `web/src/modules/access/components/location-view.tsx`, `web/src/modules/access/lib/audit-link.ts`
- Test: tes komponen terkait + `location-view.test.tsx`, `audit-link.test.ts`

**Interfaces:**
- Lokasi dan BU daftar: [checkbox][Aksi: Ubah, status, Hapus/Pulihkan][Kode `LinkCell` → View][Nama][Item/User jumlah bila ada][Status]; konfirmasi hapus menyebut pemakaian ("Dipakai 12 item, 3 pengguna"). View lokasi: Identitas + "Data terkait" tautan (Serial di lokasi ini `/serial?locationId=`, Stok `/sticker/stock`). View BU dipindah ke `ViewPage` (spek §8 butir 8), data dari `access.businessUnits.get`.
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
- Daftar: [checkbox `item: manage`][Aksi: Ubah (dialog satu field Nama), status, Hapus/Pulihkan][Customer `LinkCell` → View][Status]; filter cari + Status. View: Identitas + tautan "Lihat task Serah Terima customer ini" (ke papan dengan pencarian nama). Ubah nama inline dihapus.
- [ ] **Step 1: Tes gagal**: nama → View; Ubah membuka dialog; batch Hapus memanggil `customers.removeBatch`; nama customer di detail task menaut ke View customer.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** `bun run --cwd web test src/modules/customer src/modules/handover src/routes` → PASS.
- [ ] **Step 5:** Commit `feat(web): Customer di kit dengan View dan form dialog`.

### Task 7 (Haiku): Dokumentasi, changelog, verifikasi

**Files:**
- Modify: `CLAUDE.md` (Akses: rute `get`/batch/hapus/pulihkan, `deletedRoleIds`; Customer: View + dialog, hapus/pulihkan; audit `target_id`/`targetRef`/`auditTargetKind`; migrasi `0028`), `docs/ci-cd.md` (pengecualian rollback: tidak ada baru — model berstatus wajib Nonaktif; catat bahwa `target_id` diabaikan image lama)
- Create: `server/changelog.d/20261120-akses-customer-hapus.md` (`jenis: ditambah`; paragraf: halaman detail pengguna, role, lokasi, dan customer; pilih banyak untuk diaktifkan/dinonaktifkan/dihapus/dipulihkan; Log Audit menaut ke data yang diubah)
- [ ] **Step 1:** Tulis. **Step 2:** `bun run check` → hijau. **Step 3:** Commit `docs: Akses dan Customer di kit + soft delete`.
