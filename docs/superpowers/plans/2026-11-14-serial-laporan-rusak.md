# Serial Number: alur laporan rusak yang dipangkas (bagian 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Pola eksekusi pemilik** (CLAUDE.md global, menggantikan review per task): satu implementer Sonnet untuk Bagian A dan satu untuk Bagian B (dilanjutkan lewat `SendMessage`, bukan agen baru per task), TANPA review per task; setelah semua task selesai SATU review akhir independen (Opus; kesesuaian spek + regresi + security review skill `security-audit` terfokus pada diff dan permukaan yang disentuh), lalu putaran perbaikan oleh implementer yang sama. Implementer tidak men-spawn subagen.

**Goal:** Memangkas alur laporan rusak (status Dilaporkan tunggal, dialog update, Lapor Rusak, halaman Laporan, lokasi servis terkonfigurasi, stiker cek ulang berupa centang) dan menambah surel rusak berisi catatan penuh dengan tautan bertanda tangan ke halaman publik hanya-baca.

**Architecture:** Tabel transisi `shared/serial-flow.ts` ditulis ulang dengan status baru dan SATU migrasi data memetakan status lama; `serials.act` tetap pintu semua aksi (aksi `service_diagnosis` kini membawa `stage`), ditambah rute baru `serials.lookup`/`reportNew`/`serviceLocations`, `serialServiceSettings.*`, `serialCases.list`. Halaman publik dilayani sub-aplikasi Hono TERPISAH (`/api/public/serial-reports/...`, di luar `API_ROUTES`) dengan token HMAC; web memakai dialog per aksi menggantikan `act-composer`.

**Tech Stack:** Bun + Hono + MariaDB (mysql2, `Db` adaptor, CAS di `batch()`), React + TanStack (Query/Router/Form), zod, vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-11-14-serial-laporan-rusak-design.md` (rancangan ini) dan spek induk `docs/superpowers/specs/2026-11-12-serial-number-design.md` + `CLAUDE.md` akar. Baca ketiganya.

## Global Constraints
- Worktree `D:/Project/qc-wt/serial-laporan`, cabang `feat/serial-laporan-rusak`. JANGAN `bun run dev`, jangan sentuh server dev pengguna (port 3000/8788), jangan push (pengendali yang push). Commit kecil per task, pesan Indonesia, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tes server butuh tunnel DB (`bun run db:tunnel`, lambat): jalankan per berkas/folder `bun run --cwd server test src/modules/serial/<berkas>`; vitest web per berkas `cd web && bunx vitest run <jalur>`; `bun run typecheck` dan `bunx biome check --write <berkas>` di akhir tiap task besar; `bun run build` (verify-dist, tiap potongan JS <= 600 KB gzip) di akhir Bagian B.
- `shared/` murni (tanpa API runtime/DOM), import relatif. Rute REST baru: id di `ApiContract` + entri `API_ROUTES` + validator/handler + `rest.test.ts` + tambah ke `EXAMPLES` di `shared/api.test.ts` + tabel `server/src/http/body.test.ts` (rute JSON baru wajib). Rute statis (`/serials/lookup`, `/serials/service-locations`, `/serials/report`) didaftarkan SEBELUM `/serials/{id}`.
- Migrasi: `server/migrations/0017_laporan_rusak.sql`, idempoten (`IF NOT EXISTS`, UPDATE aman diulang), tanpa DDL non-idempoten; pengecualian expand-only dicatat di komentar (keputusan pemilik 2026-11-14: baru di staging, perbaiki ke depan, tanpa rollback). Kolom teks `NOT NULL DEFAULT ''`; kolasi `utf8mb4_nopad_bin`.
- CAS: syarat tulis di `batch()` (`batchGuarded`, `CAS_FAIL_SQL`), jangan baca-lalu-tulis tanpa penjaga. Galat usang = `staleError(...)`. Pesan galat dan teks UI santai tapi jelas, "Serial Number" lengkap pada judul, "SN" hanya di ruang sempit (spek induk butir 32 dan memori pemilik).
- Web: field relasi `LinkField`/`LinkMultiField`; dilarang `<select>`/`NativeSelect`; dialog: header/footer tetap, badan menggulir (`ui/dialog`); daftar Dialog "Tambah" di luar `<form>`; tes memilih opsi lewat `pickLink`/`pickSelect`.
- Izin: rute `serial` ber-BU memakai level global dan handler memeriksa BU (`access.ts`); serial/BU di luar hak = `NOT_FOUND`; pesan konflik tak boleh membocorkan BU/item lain.
- Status baru (nilai DB): `good`, `reported`, `at_service`, `diagnosis`, `service_repair`, `recheck`, `broken`. Kustodi: `qc`, `transit`, `service`.

## Keputusan rencana (pilihan perancang, di luar yang tertulis di rancangan)
- Kontrak tetap dua aksi (`service_diagnosis` ber-`stage` dan `declare_broken`) agar jenis kejadian dan job surel tetap terpisah; dialog Diagnosis menyatukannya (rancangan §4.4).
- Field `shipmentNote` (catatan pengiriman) dihapus: catatan dialog (`message`) menggantikannya. **Dibatalkan 2026-11-15 (keputusan pemilik produk)**: field dipulihkan (opsional, satu baris, maks. 200, hanya `send`); lihat rancangan bagian 1 §2 butir 11c dan spek induk butir 58.
- Rute publik di sub-aplikasi Hono sendiri (`/api/public`), bukan `API_ROUTES`, karena kernel REST mewajibkan sesi sebelum membaca apa pun (rancangan §8 menyerahkan ini kepada pembangun).
- Event bertipe lama (`identify_damage`, `attempt_repair`, `send` leg `between`) tetap dirender dari data lama; tidak ada penulisnya lagi.

## Review Focus
1. Dua `Lapor rusak` serentak pada serial yang sama: tepat satu laporan aktif (T-A6/A8 tes `Promise.all`).
2. Token: benar, salah tanda tangan, kedaluwarsa tepat H+30 (batas hari), token laporan lain, berkas milik laporan/serial lain, tanpa sesi vs sesi berizin vs sesi tak berizin (T-A10/A11).
3. Diagnosis atau cek ulang dari `transit` dengan tanggal sebelum tanggal kirim ditolak, dan stok stiker terpotong di lokasi SESUDAH terima otomatis (T-A6/A7).
4. Konfigurasi lokasi servis: kosong, satu, banyak, lokasi nonaktif, lokasi di luar daftar dikirim klien (T-A5/A6).
5. Migrasi diulang dua kali sama hasilnya; serial `good` berkustodi `transit` dan laporan lama tanpa kejadian kirim (T-A4).

---

## Bagian A: shared + server (implementer Sonnet #1)

### Task A1: Konstanta dan fungsi murni
**Files:** Modify `shared/serials.ts`, test `shared/serials.test.ts`; Create `shared/markdown-plain.ts` + `shared/markdown-plain.test.ts` (hanya bila `grep -ri "plain" shared/` tidak menemukan pengubah Markdown→teks yang sudah ada; bila ada, pakai itu).
**Interfaces (Produces):**
- `SERIAL_STATUSES = ['good','reported','at_service','diagnosis','service_repair','recheck','broken'] as const`; `SERIAL_STATUS_LABELS`: Lolos, Dilaporkan, Di servis, Diagnosis, Sedang diperbaiki, Menunggu cek ulang, Rusak.
- `SERIAL_ACTIONS = ['note','recheck','report_failure','send','receive','service_diagnosis','declare_broken','recheck_pass','recheck_fail']` (identify_damage dan attempt_repair dihapus). `SERIAL_EVENT_TYPES` TETAP memuat jenis lama (render riwayat lama).
- `SERVICE_DIAGNOSIS_STAGES = ['diagnosis','repairing','done'] as const`, `type ServiceDiagnosisStage`.
- `SERIAL_LIMITS`: hapus `damageMax` dan `shipmentNoteMax`; tambah `publicLinkDays: 30`, `reportSummaryMax: 120`.
- `reportLinkExpiresAt(closedOn: string): number` = epoch ms akhir hari (23:59:59.999 WIB, UTC+7) `closedOn` + `publicLinkDays` hari.
- `markdownToPlain(markdown: string): { text: string; imageCount: number }`: heading/penekanan/daftar menjadi teks yang terbaca, tautan `[a](b)` menjadi `a (b)`, gambar (`![..](file:..)` atau bentuk rujukan berkas proyek, lihat `extractFileRefs` di `shared/items.ts`) dibuang dan dihitung.
- [ ] Step 1: tes `reportLinkExpiresAt('2026-11-14')` = `Date.UTC(2026,11,14,16,59,59,999)`; `markdownToPlain` (heading, daftar, tautan, 2 gambar → `imageCount 2`, teks tanpa karakter kontrol).
- [ ] Step 2: implementasi; Step 3: `cd shared && bun test serials markdown-plain` (atau runner proyek: `bun run test` pada folder shared) hijau; Step 4: commit.

### Task A2: Tabel transisi baru
**Files:** Rewrite `shared/serial-flow.ts`, test `shared/serial-flow.test.ts` (sesuaikan semua yang lama).
**Interfaces:** `FlowRow` ditambah `stage?: ServiceDiagnosisStage`; `SendLeg = 'to_service' | 'at_service' | 'at_qc'`; `CaseEffect = 'open' | 'close_good' | 'close_broken' | null`; `FlowField = 'message' | 'toLocationId'`; `SERVICE_STATUSES = ['at_service','diagnosis','service_repair']`; `resolveAction`, `availableActions`, `sendLegOf` bertanda tangan sama (`resolveAction(action, state, actor, result?, stage?)`; `stage` dibaca hanya untuk `service_diagnosis`, baris tanpa `stage` cocok untuk apa pun).
Tabel (action; from; custody → toStatus/toCustody; caseEffect; required; modul):
1 `report_failure`; good; qc → reported/qc; open; message; serial
2 `send` to_service; reported; qc → at_service/transit; null; message; serial (`toLocationId` opsional: validasi di server)
3 `receive` at_service; at_service; transit → same/service; null; –; serialservice
4 `service_diagnosis` stage diagnosis; at_service,diagnosis,service_repair; transit,service → diagnosis/service; null; –; serialservice
5 stage repairing; sama → service_repair/service
6 stage done; sama → recheck/transit; null
7 `declare_broken`; at_service,diagnosis,service_repair; transit,service → broken/service; close_broken; message; serialservice
8 `receive` at_qc; recheck; transit → same/qc; null; –; serial
9 `recheck_pass`; reported,recheck; qc,transit → good/qc; close_good; –; serial; allowStickers
10 `recheck_fail`; reported,recheck; qc,transit → reported/qc; null; message; serial; allowStickers
11 `recheck` pass; good; qc → good/qc; null; allowStickers; serial
12 `recheck` fail; good; qc → reported/qc; open; message; allowStickers; serial
13 `note`; semua status; any; message; serial
14 `note`; at_service,diagnosis,service_repair; any; message; serialservice
- [ ] Step 1: tes (nama): `semua baris punya jalur dari status asal`, `resolveAction state/permission/stage`, `availableActions: good+serial = report_failure,note,recheck`; `reported = send,recheck_pass,recheck_fail,note`; `at_service transit + serialservice = receive,service_diagnosis,declare_broken,note`; `QC tidak melihat aksi servis (FORBIDDEN)`; `broken hanya note`.
- [ ] Step 2: tulis ulang tabel; Step 3: tes shared hijau; Step 4: commit.

### Task A3: Kontrak, tabel REST, berkas `.qcsn`
**Files:** Modify `shared/contract.ts`, `shared/api.ts`, `shared/api.test.ts` (`EXAMPLES`), `shared/serial-file.ts` (+ test), `server/src/http/body.test.ts`.
**Interfaces (Produces, tulis persis):**
```ts
export type SerialActInput =
  | (SerialActBase & { action: 'note' | 'declare_broken' | 'report_failure' })
  | (SerialActBase & { action: 'send' | 'receive'; toLocationId?: string })
  | (SerialActBase & { action: 'service_diagnosis'; stage: ServiceDiagnosisStage })
  | (SerialActBase & { action: 'recheck'; result?: 'pass' | 'fail'; stickerIds?: string[] })
  | (SerialActBase & { action: 'recheck_pass' | 'recheck_fail'; stickerIds?: string[] });
```
`SerialCaseDto`: hapus `damage`. `SerialRowInput`: hapus `status`/`damage` (hanya lulus). Baru: `SerialLookupInput {serial}` → `SerialLookupOutput {matches: SerialLookupMatchDto[]}` (`SerialLookupMatchDto {id; buId; buCode; itemLabel; serial; status; custody; locationName; openCaseId: string|null; openCaseNumber: string|null; updatedAt}`); `SerialReportNewInput {serial; itemId; buId; locationId; message; occurredOn}` → `SerialDto`; `serials.serviceLocations` (null → `SerialLocationOptionsDto`); `SerialServiceSettingsDto {locationIds: string[]; updatedAt: string}`, `SaveSerialServiceSettingsInput {expectedUpdatedAt: string; locationIds: string[]}`; `SerialCaseListInput {status?: 'active'|'closed'; buId?: string; query?: string; cursor?: string; limit?: number}` → `SerialCaseListOutput {items: SerialCaseRowDto[]; nextCursor: string|null}` (`SerialCaseRowDto {id; number; serialId; serial; buId; buCode; itemLabel; status: SerialStatus; custody; openedOn; closedOn: string|null; outcome: 'good'|'broken'|null; daysInStatus: number; reporter: string; summary: string}`). Publik (bukan `ApiContract`, tipe saja di `shared/serial-public.ts`, berkas baru): `SerialPublicReportDto {number; openedOn; closedOn: string|null; outcome; expiresOn: string; viewerCanOpen: boolean; serialId: string; unit: {serial; itemLabel; buCode; buName; locationName; testDate; sample: boolean; status: SerialStatus}; events: SerialPublicEventDto[]}`, `SerialPublicEventDto {seq; type; occurredOn; actorName; actorTeam; message; changes: SerialChangeDto[]}`.
Id/rute: `serials.lookup` GET `/serials/lookup` (query `serial: 'string'`), `serials.reportNew` POST `/serials/report` status 200, `serials.serviceLocations` GET `/serials/service-locations`, `serialServiceSettings.get` GET `/serial-service-settings` etag `updatedAt`, `serialServiceSettings.save` PUT `/serial-service-settings` ifMatch `expectedUpdatedAt`, `serialCases.list` GET `/serial-cases` (query `status`,`buId`,`query`: string; `cursor`: string; `limit`: number).
`.qcsn`: baris `status` selain `good` ditolak sebagai bermasalah; kunci `damage` dihapus dari pembaca/penulis.
- [ ] Step 1: tes `api.test.ts` (EXAMPLES semua id baru, tabel sejalan kontrak), `serial-file.test.ts` (baris `failed` bermasalah), `body.test.ts` (rute JSON baru dengan muatan sah terbesar); Step 2: implementasi; Step 3: `bun run typecheck` akan MERAH di server/web (dipulihkan task berikutnya): jalankan hanya tes shared (`shared/api.test.ts`, `shared/serial-file.test.ts`) hijau; Step 4: commit.

### Task A4: Migrasi data
**Files:** Create `server/migrations/0017_laporan_rusak.sql`, test `server/src/modules/serial/laporan-migration.test.ts`.
Isi migrasi (idempoten): (1) `UPDATE serials SET status='reported' WHERE status IN ('failed','qc_repair')`; (2) serial `good` berkustodi `transit`: `custody='qc'`, `location_id` = `transit_to_location_id` bila terisi, kosongkan `transit_*`; (3) `ALTER TABLE serial_cases ADD COLUMN IF NOT EXISTS origin_location_id` (tipe sama dengan `location_id` di `0012`/`0015`, `NOT NULL DEFAULT ''`); (4) isi `origin_location_id` untuk laporan yang punya kejadian `send` dari `JSON_VALUE(data_json,'$.fromLocationId')` (kejadian `send` terawal laporan itu) bila masih kosong. Kejadian lama tidak diubah.
- [ ] Step 1: tes (benih baris lama lewat SQL mentah di `createTestEnv`, jalankan statement data dari berkas migrasi dua kali): `failed`/`qc_repair` jadi `reported`; `good`+`transit` jadi `qc` di lokasi tujuan; `at_service`/`service_repair`/`recheck`/`broken` tak berubah; hasil identik pada pengulangan; `origin_location_id` terisi dari kejadian kirim, laporan tanpa kejadian kirim tetap `''`.
- [ ] Step 2: tulis migrasi; Step 3: `bun run --cwd server test src/modules/serial/laporan-migration.test.ts` dan `src/core/migrate` hijau (hash templat otomatis); Step 4: commit.

### Task A5: Konfigurasi lokasi servis
**Files:** Modify `server/src/modules/serial/alert.ts` (atau Create `service-locations.ts` bila `alert.ts` menjadi >200 baris), `routes.ts`, `validate.ts`, `service.ts` (`locationOptions` tetap); tests `service-locations.test.ts`, `rest.test.ts` (tambahan).
**Interfaces (Produces):** `effectiveServiceLocations(env: Env): Promise<SerialLocationOptionDto[]>` — lokasi aktif tercantum di pengaturan (kunci `settings` baru `SERIAL_SERVICE_LOCATIONS`, JSON `{locationIds: string[]}`, ETag `updatedAt` sendiri); daftar kosong ATAU tak satu pun aktif = semua lokasi aktif (urut kode). `getServiceSettings`/`saveServiceSettings` (hak `canManageSerialSettings` yang sudah ada di `alert.ts`; ETag usang = `staleError`). Rute `serialServiceSettings.get|save` (`permission: {module:'serial', level:'manage'}` + pemeriksaan "semua BU" seperti `serialSettings`); `serials.serviceLocations` (`serial: edit`, mengembalikan `effectiveServiceLocations`, TIDAK memuat daftar penerima surel). `serials.locationOptions` dikembalikan hanya `serial: edit`.
- [ ] Step 1: tes: kosong → semua aktif; satu → hanya itu; lokasi nonaktif diabaikan, semua nonaktif → semua aktif; simpan dengan ETag usang = 412; non-manager = FORBIDDEN; `serials.serviceLocations` oleh `serialservice` saja = FORBIDDEN; respons tak memuat `recipients`; `serials.locationOptions` oleh `serialservice` = FORBIDDEN.
- [ ] Step 2-4: implementasi, tes hijau, commit.

### Task A6: `serials.act` — lapor, kirim, terima, diagnosis, rusak
**Files:** Modify `server/src/modules/serial/act.ts`, `validate.ts` (`validateSerialAct`), `case-repo.ts` (hapus `updateCaseDamageStmt` dan `damage` dari `insertCaseStmt`/`SerialCaseRow`; tambah `origin_location_id`: `setCaseOriginStmt(db, caseId, locationId, now)`), `service.ts` (`toCase`/DTO tanpa `damage`, `SERIAL_CONFLICTS` bila perlu); tests `act-flow.test.ts` (perbarui), `act-service.test.ts` (baru jika perlu).
**Perilaku wajib:** (1) `report_failure`: catatan wajib (`message` tak kosong setelah pangkas, VALIDATION `message`), membuka laporan (`openNewCase`), satu laporan aktif dijaga `open_case_id` dan CAS; (2) `send`: `toLocationId` opsional; daftar `effectiveServiceLocations`; satu lokasi ⇒ dipakai otomatis dan `toLocationId` yang dikirim harus sama atau kosong; banyak ⇒ wajib dan harus termasuk daftar (VALIDATION `toLocationId`); pemeriksaan "beda lokasi" DICABUT; simpan lokasi QC asal ke laporan (`setCaseOriginStmt`, lokasi unit saat kirim); `transit_*` diisi; (3) `receive` at_service: seperti 5b (tanggal tidak < `transit_on`; lokasi unit = tujuan); (4) `service_diagnosis`/`declare_broken` dari kustodi `transit`: TERIMA OTOMATIS = tulis kejadian `receive` (leg `at_service`, data sama dengan Terima biasa, tanggal = `occurredOn` yang juga divalidasi tidak < `transit_on`) lalu kejadian aksi, satu `batch()`; `stage` menentukan baris (`resolveAction(..., stage)`); `done` ⇒ `recheck`/`transit`, `transit_from` = lokasi servis, `transit_to` = lokasi QC asal laporan (`origin_location_id`; bila kosong atau nonaktif pakai lokasi serial saat dilaporkan; kasus tak ada asal ⇒ lokasi unit sekarang); (5) `receive` at_qc: lokasi unit = lokasi QC asal; bila asal nonaktif, `toLocationId` WAJIB (VALIDATION `toLocationId`, lokasi aktif lain) (`toLocationId?` pada aksi `receive` sudah ada di kontrak A3); (6) `declare_broken`: `message` wajib, tutup laporan `outcome='broken'`, pendengar `serial.declared_broken` tetap; (7) pesan menolak karakter pengatur arah (aturan 5b tetap); (8) galat urutan seperti 5b (bentuk → NOT_FOUND → stale → CONFLICT → FORBIDDEN → VALIDATION).
- [ ] Step 1: tes (nama): `lapor tanpa catatan ditolak`; `lapor dua kali serentak: satu laporan aktif, yang kalah CONFLICT/412`; `kirim dari Surabaya ke servis Surabaya sah`; `kirim banyak lokasi tanpa pilihan ditolak, lokasi di luar daftar ditolak`; `kirim satu lokasi otomatis`; `diagnosis langsung dari transit menulis dua kejadian receive+service_diagnosis`; `diagnosis dari transit dengan tanggal sebelum kirim ditolak occurredOn`; `stage done membuat status recheck custody transit tujuan lokasi QC asal`; `terima QC memulihkan lokasi asal; asal nonaktif butuh toLocationId`; `declare_broken tanpa catatan ditolak; menutup laporan dan memasang job surel`; `QC melihat FORBIDDEN pada aksi servis`; `catatan pada serial broken diterima (caseId kosong)`.
- [ ] Step 2: implementasi; Step 3: `bun run --cwd server test src/modules/serial/act-flow.test.ts` (+ berkas baru) hijau; Step 4: commit.

### Task A7: Cek ulang dengan stiker centang dan `saveBatch` hanya lulus
**Files:** Modify `act.ts` (`stickerRaise`), `validate.ts`, `service.ts` (`saveSerialBatch` hapus status/damage; baris lama `failed` = `invalid`), `applicable.ts` bila perlu; tests `act-recheck.test.ts`, `service.test.ts`/`rest.test.ts` perbarui.
**Perilaku:** `stickerIds` (maks. `SERIAL_LIMITS.picksMax`, tanpa duplikat) — tiap id menambah 1 pada `serial_stickers` (stiker belum ada: harus berlaku bagi item pada BU serial, qty awal 1; `inactive` ditolak VALIDATION `stickerIds`; `deprecated` boleh; usang serentak = `staleError` seperti 5b `retried`) dan memotong stok 1 lewat pendengar `serial.stickers_added` di lokasi unit SESUDAH terima otomatis; `locationId` dihapus dari aksi cek ulang; `recheck_fail` dan `recheck` hasil gagal: `message` wajib; kejadian `recheck` dari `good` hasil gagal tetap dua kejadian (`recheck` lalu `report_failure`); `recheck_pass` dari `reported`/`recheck` menutup laporan (`close_good`); `recheck_*` dari `transit` didahului `receive` otomatis (tanggal sama, aturan tidak < `transit_on`).
- [ ] Step 1: tes: `centang menambah satu dan memotong satu stok di lokasi`; `stiker baru yang berlaku bisa dicentang`; `stiker tidak berlaku ditolak`; `inactive ditolak, deprecated boleh`; `cek ulang dari transit: receive otomatis lalu stok di lokasi tujuan`; `recheck_fail tanpa catatan ditolak`; `saveBatch menolak status failed/damage lama, hanya good tersimpan`.
- [ ] Step 2-4: implementasi, tes hijau, commit.

### Task A8: Lookup dan Lapor Rusak serial baru
**Files:** Create `server/src/modules/serial/report.ts`, `report.test.ts`; Modify `routes.ts`, `validate.ts`.
**Interfaces:** `lookupSerials(env, user, input: SerialLookupInput): Promise<SerialLookupOutput>` (normalisasi `normalizeSerial`; hanya BU yang boleh ditulis pengguna (`writableBuIds`); `NOT_FOUND`-aman: BU lain tak muncul); `reportNewSerial(env, input: SerialReportNewInput, user): Promise<SerialDto>` — membuat serial `reported` (kejadian `recorded` lalu `report_failure`, `tanggal uji = occurredOn`, `sample=false`, tanpa stiker/stok, satu `batch()`, nomor LP via `runWithCaseNumber`), `message` wajib, item harus memuat BU, lokasi aktif, serial sudah ada di BU itu = `CONFLICT` generik "Serial Number sudah terdaftar, cari dulu lewat kolom Serial Number" (tanpa menyebut BU lain). Rute: `serials.lookup` dan `serials.reportNew` (`serial: edit`).
- [ ] Step 1: tes: lookup menemukan serial BU sendiri (status, `openCaseNumber`), tidak menemukan BU tak berhak, BU ganda menghasilkan dua baris; `reportNew` sukses (status `reported`, satu laporan, dua kejadian), serial sudah ada ditolak, item di luar BU ditolak, `reportNew` serentak untuk serial sama: satu sukses; serial `broken` atau punya laporan aktif muncul di lookup dengan `status`/`openCaseNumber` (UI yang menolak; `act` tetap CONFLICT).
- [ ] Step 2-4: implementasi, tes, commit.

### Task A9: Daftar laporan (`serialCases.list`)
**Files:** Create `server/src/modules/serial/case-list.ts`, `case-list.test.ts`; Modify `routes.ts`, `validate.ts`, `case-repo.ts`.
**Interfaces:** `listSerialCases(env, user, input: SerialCaseListInput): Promise<SerialCaseListOutput>`. BU = `readableBuIds(user)` (pembacaan tidak dibatasi status, termasuk `serialservice`); `status`: `active` = `closed_on=''`, `closed` = terisi; `query` awalan nomor LP atau serial; `buId` menyempit; urut terbaru dulu (`created_at DESC, number DESC`), kursor = `created_at|number`; `daysInStatus` = hari kalender dari kejadian terakhir yang mengubah status sampai hari ini WIB; `summary` = baris pertama non-kosong pesan kejadian `report_failure` laporan itu, maks. `reportSummaryMax` (teks Markdown dibersihkan dengan `markdownToPlain`); `reporter` = `created_by` laporan. Izin rute: `READ_PERMISSION`.
- [ ] Step 1: tes: filter aktif/selesai, BU di luar hak tak muncul, `serialservice` murni melihat semua laporan BU-nya, kursor, ringkasan 120 karakter, hari dalam status.
- [ ] Step 2-4: implementasi, tes, commit.

### Task A10: Token tautan dan isi surel rusak
**Files:** Create `server/src/modules/serial/public-link.ts`, `public-link.test.ts`; Modify `alert-job.ts`, `alert-listener.ts` bila payload berubah, `server/src/core/env.ts` bila tak ada akses ke rahasia sesi; tests `alert-job.test.ts` (ganti OQ-13).
**Interfaces:** `signReportToken(secret: string, caseId: string, expiresAtMs: number): Promise<string>` dan `verifyReportToken(secret: string, token: string, nowMs: number): Promise<{ caseId: string } | null>`; token `v1.<caseId>.<expSeconds>.<base64url(sig)>`, `sig = HMAC-SHA256(derivedKey, "v1.<caseId>.<expSeconds>")`, `derivedKey = HMAC-SHA256(secret, "qc:serial-report-link:v1")` (Web Crypto; kunci TIDAK dipakai membuat sesi), perbandingan tetap-waktu (`crypto.subtle.verify`), semua kegagalan = `null` tanpa membedakan sebab. `serialBrokenMail(snapshot)` baru (teks polos): subjek `Serial Number rusak: <serial> (<tipe item>, <kode BU>)` (`tipe item` = `items.model`); badan: serial, item (merk+tipe), BU, nomor LP, lokasi unit, tanggal dilaporkan dan dinyatakan rusak, nama pelaku yang menyatakan rusak, catatan penuh (`markdownToPlain(...).text`; bila `imageCount>0` tambah "(N gambar, lihat di tautan)"), tautan `${APP_ORIGIN}/laporan/<token>` dan "berlaku sampai <tanggal>"; semua nilai lewat `stripControlChars`; TANPA angka stok dan alamat surel pengguna. Token dibuat saat job berjalan (`reportLinkExpiresAt(closed_on)`; kedaluwarsa deterministik jadi kirim ulang aman); tanpa `APP_ORIGIN` atau rahasia sesi ⇒ tanpa tautan.
- [ ] Step 1: tes `public-link`: round trip, tanda tangan diubah 1 karakter = null, `caseId` ditukar = null, kedaluwarsa tepat `expiresAtMs` (belum) dan +1 ms (sudah), format salah/terlalu panjang = null, kunci beda = null; tes `alert-job`: subjek memuat tipe, badan memuat catatan penuh dan nama pelaku, tak memuat surel pelaku/stok, catatan Markdown jadi teks, `imageCount` dijelaskan, kontrol karakter dibersihkan, tautan ada hanya bila `APP_ORIGIN`+rahasia.
- [ ] Step 2-4: implementasi, `bun run --cwd server test src/modules/serial/public-link.test.ts src/modules/serial/alert-job.test.ts` hijau, commit.

### Task A11: Halaman publik (rute bertoken)
**Files:** Create `server/src/modules/serial/public-routes.ts`, `public-routes.test.ts`; Modify `server/src/app.ts` (mount `app.route('/api/public', publicSerialApp)` SEBELUM catch-all statis, di luar `registerRest`; tidak masuk OpenAPI), `server/src/http/security.ts` bila header perlu, `shared/serial-public.ts` (dari A3).
**Perilaku:** `GET /api/public/serial-reports/:token` → `SerialPublicReportDto`; `GET /api/public/serial-reports/:token/files/:fileId` → byte gambar. Urutan: batas laju per IP (`rate_limits` + `limiterAddress`, kegagalan token dihitung; terlampaui = 429 problem+json), `verifyReportToken(env.SESSION_SECRET, token, now)` → `null` = 404 `problem+json` yang SAMA untuk salah/kedaluwarsa/laporan tak ada; muat laporan (`loadCase`) dan serial; linimasa = kejadian dengan `case_id` laporan itu (urut `seq` naik) lewat DTO daftar putih (tanpa `data` mentah, tanpa surel, tanpa stok); `unit` dari serial/item/BU/lokasi; `viewerCanOpen` = ada sesi sah di permintaan DAN `readableBuIds(user)` memuat BU serial (sesi dibaca dengan util sesi yang ada, kegagalan sesi = `false`, tidak pernah galat); berkas: `fileId` harus dirujuk (`extractFileRefs`) oleh pesan kejadian laporan itu, `ownerType='serial'` dan `ownerId` = serial itu, lalu isi dibaca lewat `readFile` dengan `FileViewer` ber-`serialBuIds: [buId]`; selain itu 404 yang sama. Header: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; token tidak pernah dicatat di log (periksa middleware log akses).
- [ ] Step 1: tes: token benar → 200 dengan linimasa sesuai lingkup (kejadian laporan lain, `recorded` awal, catatan sesudah Rusak TIDAK ada); DTO tak memuat `email`/`stock`/`data` mentah (cek kunci); token salah/kedaluwarsa/laporan lain/ rusak = 404 identik; setelah N kegagalan dari satu IP → 429; berkas: milik pesan laporan → 200; berkas serial yang sama tapi di luar laporan, berkas serial lain, id acak = 404; sesi berizin → `viewerCanOpen:true`, sesi tanpa izin/tanpa sesi = `false`; header respons ada; tes tidak memakai sesi untuk lolos token.
- [ ] Step 2-4: implementasi, tes hijau, commit.

### Task A12: Verifikasi Bagian A
- [ ] `bun run typecheck` (server+shared hijau; web boleh merah hanya pada berkas yang disentuh Bagian B), `bunx biome check --write` pada berkas tersentuh, tes server per modul: `src/modules/serial`, `src/http/body.test.ts`, `src/modules/auth`, `src/core/migrate`; tulis `.superpowers/sdd/2026-11-14-serial-laporan/part-a-report.md` (laporan: status, commit, ringkasan tes, concern); commit.

---

## Bagian B: web (implementer Sonnet #2; Bagian A sudah selesai)

### Task B1: Dasar web dan Tambah Serial Number tanpa status
**Files:** Modify `web/src/modules/serial/queries.ts` (query/mutation untuk `serials.lookup|reportNew|serviceLocations`, `serialServiceSettings.*`, `serialCases.list`), `web/src/app/navigation.ts` (+ `navigation.test.ts`: grup Serial Number memuat Daftar, Lapor Rusak, Laporan, Pengaturan bagi yang berhak), `web/src/modules/serial/components/{record-page,staging-table,row-detail-dialog}.tsx` (+ tes): hapus kolom/aksi status, "Catat langsung Tidak lolos", dan field kerusakan; `.qcsn` hanya lulus; Create route stub `web/src/routes/_app/serial/report.tsx`, `reports.tsx` (butuh `canWriteSerials`/pembaca), `web/src/modules/auth/permissions.ts` bila perlu.
- [ ] Step 1: tes `navigation.test.ts` dan perbarui `record-page*.test.tsx`/`staging-table.test.tsx` (tidak ada kontrol status; kirim `saveBatch` tanpa `status`/`damage`); Step 2: implementasi; Step 3: `cd web && bunx vitest run src/app/navigation.test.ts src/modules/serial/components/record-page.test.tsx src/modules/serial/components/staging-table.test.tsx` hijau + `bun run typecheck`; Step 4: commit.

### Task B2: Dialog update, baris tombol di Riwayat, badge Terbaru
**Files:** Create `web/src/modules/serial/components/act-dialog.tsx` (+ `act-dialog.test.tsx`), `act-buttons.tsx`; Modify `serial-detail-page.tsx`, `timeline.tsx`, `timeline-tabs.tsx`, `act-fields.tsx` (sesuaikan), `custody-panel.tsx`, `serial-stepper.tsx` (status baru), hapus `act-composer.tsx` dan tesnya setelah tak dipakai.
**Perilaku:** `<ActButtons state actor onPick>` memakai `availableActions` (sumber sama dengan server) dan merender satu tombol per aksi di baris yang sama dengan label "Riwayat"; satu dialog per aksi dengan catatan Markdown (editor + gambar pesan maks. 10 seperti `act-composer` lama), tanggal kejadian (bawaan hari ini, `max` hari ini; Terima/aksi dari `transit`: `min` = `transitOn`), dan isian khas: Kirim ke servis (`LinkField` lokasi hanya bila `serials.serviceLocations` > 1; satu lokasi = tanpa field), Diagnosis (`Select` Diagnosis/Sedang diperbaiki/Selesai/Rusak → memanggil `service_diagnosis` dengan `stage` atau `declare_broken`; "Rusak" mewajibkan catatan dan menampilkan peringatan surel), Cek ulang (`Select` hasil + daftar centang stiker `StickerChecklist` mode tambah-satu: awalnya kosong, `stickerOptions` + stiker serial; stiker `inactive` dinonaktifkan), Lapor rusak (catatan wajib), Terima (QC: field lokasi hanya bila lokasi asal nonaktif). Galat server per field (`occurredOn`, `message`, `toLocationId`, `stickerIds`) ditampilkan di field. Badge "Terbaru" di entri paling atas (seq tertinggi) pada tab Semua. Teks UI sesuai status baru (`SERIAL_STATUS_LABELS`).
- [ ] Step 1: tes `act-dialog.test.tsx`: tombol sesuai status (`good`→Lapor rusak, Cek ulang, Catatan; `reported`→Kirim ke servis, Cek ulang; di servis: Terima, Diagnosis), dialog Kirim tanpa field lokasi bila satu lokasi dan dengan `LinkField` bila banyak, Diagnosis "Selesai" mengirim `{action:'service_diagnosis', stage:'done'}`, "Rusak" mengirim `declare_broken` dan menuntut catatan, Cek ulang mengirim `stickerIds` dari centang (awal kosong), `min` tanggal pada Terima/transit, badge "Terbaru" tepat satu; Step 2-4: implementasi, tes per berkas, `bun run typecheck`, commit.

### Task B3: Halaman Lapor Rusak
**Files:** Create `web/src/modules/serial/components/report-form.tsx`, `report-page.tsx` (+ tes), Modify `web/src/routes/_app/serial/report.tsx`, `serial-detail-page.tsx` (tombol Lapor rusak memakai dialog B2 yang sama, bukan duplikasi), memakai `SerialScanInput`/`CameraScanButton` yang ada.
**Perilaku:** ketik/pindai Serial Number → `serials.lookup`; ditemukan `good`: ringkasan + catatan wajib → `serials.act` `report_failure`; punya laporan aktif: pesan "Serial ini sudah punya laporan aktif" + tautan ke `/serial/<id>` (nomor LP); `broken`: "Unit ini sudah dinyatakan rusak"; banyak BU: pilih (`LinkField`); tidak ditemukan: form item (`LinkField`, BU dari item, pilih bila >1), lokasi (`LinkField` memakai `SerialLocationField`), catatan wajib → `serials.reportNew`; sukses ⇒ ke detail serial dengan toast.
- [ ] Step 1: tes: tiap cabang di atas, galat `CONFLICT` serentak menampilkan pesan jelas; Step 2-4: implementasi, tes, typecheck, commit.

### Task B4: Halaman Laporan
**Files:** Create `web/src/modules/serial/components/case-list-page.tsx` (+ tes); Modify `web/src/routes/_app/serial/reports.tsx`.
Daftar laporan (kolom: nomor LP, serial, item, status chip, lama di status, pelapor, ringkasan), filter status (aktif/selesai, `Select`), BU (`LinkField` `localFilter`), pencarian, muat berikutnya berkursor; baris menuju `/serial/<serialId>` pada tab laporan itu (query tab `case=<id>` sesuai `timeline-tabs`). Teks kosong santai.
- [ ] Step 1: tes: render, filter mengirim query benar, kursor, klik baris menavigasi; Step 2-4: implementasi, tes, commit.

### Task B5: Pengaturan lokasi servis
**Files:** Modify `serial-settings-view.tsx`/`serial-settings-page.tsx` (+ tes `serial-settings-view.test.tsx`).
Bagian "Lokasi tim servis": `LinkMultiField` lokasi aktif (daftar dari `serials.locationOptions` atau rute lokasi yang sudah dipakai pengaturan; tanpa Tambah/Buka), keterangan "Kosong = semua lokasi dianggap lokasi servis", simpan dengan ETag (`serialServiceSettings.save`), galat usang ditampilkan; hanya bagi `canManageSerialSettings`.
- [ ] Step 1: tes: muat, ubah, simpan, usang; Step 2-4: implementasi, tes, commit.

### Task B6: Halaman publik tautan
**Files:** Create `web/src/routes/laporan.$token.tsx` (di LUAR layout `_app`, tanpa login), `web/src/modules/serial/components/public-report-page.tsx` (+ tes), `web/src/modules/serial/lib/public-api.ts` (`fetch` biasa ke `/api/public/serial-reports/<token>`, `cache: 'no-store'`).
**Perilaku:** memuat DTO publik; `viewerCanOpen` ⇒ langsung ke `/serial/<serialId>`; 404/429 ⇒ halaman "Tautan tidak berlaku atau sudah kedaluwarsa" (satu pesan untuk semua); tampilan hanya baca: nomor LP, status/hasil, detail unit, "berlaku sampai <expiresOn>", linimasa (`Timeline` read-only: komponen yang ada dengan resolver gambar yang memetakan rujukan berkas ke `/api/public/serial-reports/<token>/files/<id>`; periksa `web/src/modules/markdown` untuk titik penyisipan resolver), tanpa tombol aksi; tidak mengirim token ke luar (tidak ada tautan eksternal bocor lewat Referer: `rel="noreferrer"` pada tautan luar).
- [ ] Step 1: tes: tampil lengkap, redirect saat `viewerCanOpen`, pesan seragam 404/429, tanpa tombol aksi, gambar memakai URL publik; Step 2-4: implementasi, tes, typecheck, `bun run build` (laporkan ukuran potongan), commit.

### Task B7: Verifikasi Bagian B
- [ ] Vitest per folder `web/src/modules/serial`, `web/src/app`, `web/src/routes`; `bun run typecheck`; `bun run build` (`verify-dist`); Biome; tulis `.superpowers/sdd/2026-11-14-serial-laporan/part-b-report.md`; commit.

---

## Bagian C: dokumen dan penutup

### Task C1: Spek, CLAUDE.md, ci-cd
**Files:** Modify `docs/superpowers/specs/2026-11-12-serial-number-design.md`, `CLAUDE.md`, `docs/ci-cd.md`, `docs/adding-a-module.md` (bila ada pelajaran).
- [ ] Spek induk: butir 40 diubah menjadi KEPUTUSAN PEMILIK 2026-11-14 (15 default disetujui) dengan butir yang digantikan dinyatakan jelas ((b),(c),(d),(i),(p); OQ-4 dan OQ-5 dicabut) dan kriteria penerimaan yang bertentangan DIUBAH (bukan catatan samping); butir baru 43 dan seterusnya untuk keputusan rancangan §2 dan §3 (tiap butir: apa, tanggal absolut 2026-11-14, alasan, pemilik produk menyetujui); §4.3, §4.6, §5.2, §5.3, §9, §12 (5c memakai kontrak stiker centang) disesuaikan; tutup pertanyaan terbuka terkait.
- [ ] `CLAUDE.md` bullet Serial Number: status baru, `serial-flow.ts`, aksi `service_diagnosis` ber-`stage`, `serialCases.list`, `serials.lookup|reportNew|serviceLocations`, konfigurasi lokasi servis (`SERIAL_SERVICE_LOCATIONS`), rute publik bertoken di luar `API_ROUTES` (`/api/public`, token HMAC turunan `SESSION_SECRET`, H+30), kolom `serial_cases.origin_location_id`.
- [ ] `docs/ci-cd.md`: migrasi 0017 (pemetaan status; image 5b lama tak mengenal `reported`/`diagnosis`, perbaiki ke depan, tanpa rollback); tautan publik bergantung `SESSION_SECRET` (mengganti rahasia mencabut semua tautan dan sesi); tim servis perlu `serialservice`; admin mengisi lokasi servis (kosong = semua lokasi aktif).
- [ ] Commit.

### Task C2: Pemeriksaan akhir
- [ ] Jalankan penuh: typecheck, Biome, tes web (folder serial/app/routes), tes server per modul serial + `body` + `auth` + `migrate`, `bun run build`; rangkum di `.superpowers/sdd/2026-11-14-serial-laporan/final-report.md`. Tidak ada push; serahkan ke review akhir.

## Self-Review (spek → task)
- §2 butir 1-9 → C1 (dokumen), A5-A11 (perilaku). §4.1 tabel → A2, A6, A7; terima otomatis → A6/A7; lokasi QC asal → A4 (kolom), A6. §4.2 stiker → A7, B2. §4.3 Lapor Rusak → A8, B3. §4.4 dialog/badge → B2. §4.5 Laporan → A9, B4. §4.6 lokasi servis → A5, B5. §4.7 surel → A10. §4.8 tautan/halaman publik → A10, A11, B6. §4.9 migrasi → A4. §5 dokumen → C1. §5a lingkup linimasa → A11 (tes lingkup), B6.
- Ketergantungan nama: `ServiceDiagnosisStage` (A1) dipakai A2/A3/A6/B2; `effectiveServiceLocations` (A5) dipakai A6; `setCaseOriginStmt` (A6) dipakai A6; `markdownToPlain` (A1) dipakai A9/A10; `reportLinkExpiresAt` (A1) dipakai A10; `SerialPublicReportDto` (A3) dipakai A11/B6.
