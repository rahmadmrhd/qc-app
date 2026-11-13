# Serial Number tahap 5b (alur tidak lolos dan servis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alur tidak lolos dan servis untuk Serial Number: kasus bernomor `LP-YYYYMMDD-NNN` (`serial_cases`), pencatatan langsung berstatus `failed`, semua aksi tabel §5.3 (laporan, perbaikan QC, kirim/terima ke dan dari servis, diagnosis, rusak, cek ulang lolos/gagal, catatan servis), modul izin `serialservice` yang batasnya ditentukan STATUS serial, gambar pada pesan kejadian (pemilik berkas `serial`, mengikuti BU serial), email "rusak" lewat antrean job dengan halaman pengaturan penerima, `serials.history` per serial berfilter dan berpaginasi (tab linimasa), filter posisi di daftar, dan UI aksi di halaman detail.

**Architecture:** Mesin transisi murni satu sumber di `shared/serial-flow.ts` (dipakai server untuk menegakkan dan web untuk menampilkan aksi yang tersedia). Server: `server/src/modules/serial/` mendapat `act.ts` (aksi dipindah dari `service.ts`), `case-repo.ts` (kasus dan nomor LP dengan penghitung CAS di tabel `counters`), `history.ts`, `alert.ts` (pengaturan `SERIAL_ALERT`), `alert-job.ts` (handler job `serial_alert`), `alert-listener.ts` (pendengar bus event yang menyusun `insertJobStmt` ke dalam `batch()` aksi, jadi enqueue atomik dengan aksi). Berkas: pemilik baru `serial` di `server/src/modules/files/service.ts`. Satu migrasi `0013_serial_cases.sql` (expand-only). Web: `web/src/modules/serial/` (komposer aksi, linimasa bertab, baris tahap, panel pengiriman, halaman pengaturan).

**Tech Stack:** Bun, Hono, MariaDB 11.8 (adaptor `Db`), TypeScript, React + TanStack (Router, Query, Form), Tiptap, vitest (web), `bun:test` (server, shared), `nodemailer` lewat `core/mail.ts`.

**Spec:** `docs/superpowers/specs/2026-11-12-serial-number-design.md` (§2, §3, §4.3, §4.6, §4.7, §5.3, §5.4, §6, §9, §12 butir 5b, §13). Rencana sebelumnya (templat dan kode yang disentuh): `docs/superpowers/plans/2026-11-12-serial-number-5a.md`. Mockup acuan (tidak di repo): `D:/Project/qc/.superpowers/brainstorm/163436-1794489056/content/{detail-serial-timeline,pengiriman-servis}.html`. **Cabang kerja:** `feat/serial-number-5b` dari `dev` `e9eba63`; PR ke `dev` (tanpa auto-merge).

**Pertanyaan terbuka:** `.superpowers/sdd/2026-11-13-serial-5b/open-questions.md` (OQ-1 sampai OQ-20). Task yang bergantung ditandai **[diblokir OQ-n]**; isinya memakai **default sementara** (rekomendasi perancang) yang WAJIB diganti bila jawaban pemilik berbeda. Pengendali mengumpulkan jawaban sebelum dispatch task itu. Rencana ini tidak memutuskan diam-diam.

**Di luar 5b:** layar Cek ulang/Terima massal (`serials.actBatch`, `/serial/recheck`, `/serial/receive`) dan pemindai kamera (5c; kamera sedang di cabang `serial-camera`). Hapus serial dan pembukaan kembali `broken` (§11 butir 1 dan 4, tetap tidak ada).

## Global Constraints

- **Gaya bahasa (keputusan pemilik 2026-11-13):** SEMUA teks UI, pesan galat (server dan web), dan isi/subjek surel yang dibuat 5b berbahasa Indonesia **santai tapi jelas**, tidak kaku/full baku. Serapan asing lazim boleh dan disukai (default, batch, scan, input, filter, draft, stok, item, lokasi). Judul dan nama fitur memakai **"Serial Number"** lengkap ("SN" hanya di ruang sempit seperti kolom tabel atau chip). Hindari terjemahan paksa. Contoh gaya: "Catat Serial Number", "Default" (bukan "Bawaan rombongan"). Glosarium akhir datang dari sapuan teks di cabang kamera: task web dan task surel memakai istilah yang ada di `dev` setelah PR kamera masuk; bila belum masuk, konsisten dengan contoh di atas. Tiap task web dan task surel punya langkah **pemeriksaan teks** (tes yang menegaskan teks persis + tinjau daftar string baru terhadap aturan ini).
- **Jangan menyunting berkas yang diubah cabang kamera** sebelum PR kamera masuk `dev`: `web/src/modules/serial/components/{record-page,serial-filters,serial-scan-input}.tsx`, `serial-list-page.test.tsx`, `web/src/modules/serial/lib/list-filter.ts` (+tes), `web/src/modules/access/lib/use-url-synced-text.ts`, `web/src/app/pwa/*`, `CLAUDE.md` (bagian serial), spek serial (bagian yang diubah kamera). Task W5 dan W6 menyentuh `record-page.tsx`/`serial-filters.tsx`/`list-filter.ts`: **dikerjakan setelah PR kamera ter-merge** (rebase dulu). Spek dan `CLAUDE.md` disunting hanya di T-docs, setelah rebase.
- Tanpa stored procedure; nilai SELALU di-bind (`?`); kolom `key`/`before`/`after` berbacktick; `SUM`/`COUNT` dibungkus `Number()`.
- Setiap aksi menulis `serials` (CAS `updated_at`, `updateSerialStmt`) + `serial_events` + efek kasus + efek stok + lampiran berkas + job surel dalam **SATU `batch()`**. Tidak ada `enqueueJob` sesudah commit.
- Kegagalan penjaga pada batch yang memuat penghitung LP: `batchGuarded` memetakan SEMUA kegagalan penjaga menjadi stale. Aturan 5b: pada kegagalan penjaga/duplikat `PRIMARY`/`serial_cases_number`, **baca ulang `updated_at` serial**: bila sama dengan `expectedUpdatedAt`, ulangi (maks. 10 percobaan, `CASE_NUMBER_ATTEMPTS`, pola `CREATE_TASKS_ATTEMPTS`); bila berbeda, stale (412). Berlaku untuk `report_failure`, `recheck` hasil gagal, dan baris `saveBatch` berstatus `failed`.
- Migrasi expand-only, idempoten (`IF NOT EXISTS`), id `VARCHAR(100)`, waktu `VARCHAR(30)` ISO, tanggal `VARCHAR(10)` `YYYY-MM-DD`, kolasi `utf8mb4_nopad_bin`, kolom teks `NOT NULL DEFAULT ''` (DTO memetakan `''` → `null`; spek §4.3 menyebut `closed_on`/`outcome` "nullable": mengikuti konvensi proyek, lihat OQ-14). Nomor berkas: `0013`.
- Izin: pembaca = `serial: view` ATAU `serialservice: view` pada BU serial (di luar = `NOT_FOUND`). Penulis per aksi = modul yang ditentukan baris tabel transisi pada level `edit` di BU serial (`canActOnAllBus(user.businessUnits, module, 'edit', [buId])`). `serial: edit` tidak pernah menjalankan aksi servis; `serialservice: edit` hanya menindak serial berstatus `at_service`/`service_repair` (§3 butir 14), tidak dapat mencatat (`saveBatch`), mengubah (`update*`), atau menaikkan stiker.
- Isi galat bocor: pesan duplikat/serial tak ditemukan generik (pola 5a); surel tanpa rahasia, tanpa pesan Markdown kejadian, tanpa email pengguna.
- Pesan kejadian: maks. `SERIAL_LIMITS.messageMax` (5.000), tolak `hasBidiControls` (§3 butir 25). `damage` maks. 200 karakter, satu baris (tolak `hasControlChars`). Catatan pengiriman maks. 200, satu baris (tolak `hasControlChars`).
- `shared/` murni (tanpa API runtime/DOM, tanpa `zod`, import relatif).
- Web: relasi = `LinkField`/`LinkMultiField` (tanpa Tambah/Buka untuk lokasi, BU, item, stiker); enum = `Select`; **tanpa `<select>`/`<option>`**; dialog dirender di luar `<form>` induk, header/footer tetap (jangan menambah `max-h`/`overflow` pada `*DialogContent`); tes memilih opsi lewat `pickLink`/`pickSelect`. Data serial TIDAK masuk whitelist `query-persist`.
- Rute JSON baru wajib masuk `WORST` (`server/src/http/body.test.ts`), `EXAMPLES` (`shared/api.test.ts`), `ALL_API_IDS` (`server/src/routes.ts`); rute statis `/serials/...` didaftarkan SEBELUM `/serials/{id}` di `API_ROUTES`.
- Tes server butuh `bun run db:tunnel`. Selama task, tes server dijalankan **per berkas** (`bun run --cwd server test src/modules/serial/<berkas>.test.ts`); `bun run check` penuh hanya di akhir bagian server (T11) dan di akhir bagian web (W8). Tes server baru di BERKAS BARU (`rest.test.ts` sudah 550 baris).
- Tidak ada variabel `.env` baru (SMTP memakai `SMTP_*` yang ada).
- Commit per task, pesan Indonesia (`feat(serial): …`), trailer attribution sesi.

## Tabel transisi (sumber tunggal, `shared/serial-flow.ts`)

`state = { status, custody }`. Kolom "Custody" adalah prasyarat custody; "Modul" = modul izin level `edit` yang dibutuhkan pada BU serial; "Tim" = `actor_team` kejadian. Baris bertanda † bergantung OQ (default sementara tercantum).

| # | Aksi (`action`) | Varian (`leg`/`result`) | Dari status | Custody | Ke status | Ke custody | Efek kasus | Field wajib | Modul | Tim |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `report_failure` | | `good` | `qc` † OQ-6 | `failed` | `qc` | buka (`damage`) | `damage` | serial | qc |
| 2 | `identify_damage` | | `failed`, `qc_repair` | `qc` | tetap | tetap | ubah `damage` | `damage` | serial | qc |
| 3 | `attempt_repair` | | `failed` | `qc` | `qc_repair` | `qc` | — | — | serial | qc |
| 4 | `send` | `to_service` | `failed`, `qc_repair` | `qc` | `at_service` | `transit` | — | `toLocationId` | serial | qc |
| 5 | `receive` | `at_service` | `at_service` | `transit` | tetap | `service` | — | — | serialservice | service |
| 6 | `service_diagnosis` | | `at_service` | `service` † OQ-5 | `service_repair` | `service` | ubah `damage` | `damage` | serialservice | service |
| 7 | `declare_broken` | | `at_service`, `service_repair` | `service` † OQ-5 | `broken` | tetap | tutup `broken` + surel | — | serialservice | service |
| 8 | `send` | `to_qc` | `service_repair` | `service` | `recheck` | `transit` | — | `toLocationId` † OQ-4 | serialservice | service |
| 9 | `receive` | `at_qc` | `recheck` | `transit` | tetap | `qc` | — | — | serial | qc |
| 10 | `recheck_pass` | | `recheck`, `qc_repair` | `qc` † OQ-5 | `good` | `qc` | tutup `good` | — (opsional `locationId`, `stickers`) | serial | qc |
| 11 | `recheck_fail` | | `recheck` | `qc` † OQ-5 | `failed` | `qc` | tetap terbuka (opsional ubah `damage`) | — (opsional `locationId`, `stickers`, `damage`) | serial | qc |
| 12 | `recheck` | `pass` | `good` | `qc` | `good` | `qc` | — | — (opsional `locationId`, `stickers`) | serial | qc |
| 13 | `recheck` | `fail` † OQ-7 | `good` | `qc` | `failed` | `qc` | buka (`damage`) + kejadian `report_failure` | `damage` | serial | qc |
| 14 | `send` | `between` | `good` | `qc` | `good` | `transit` | — | `toLocationId` | serial | qc |
| 15 | `receive` | `between` | `good` | `transit` | `good` | `qc` | — | — | serial | qc |
| 16 | `note` | | semua (termasuk `broken`) | apa pun | tetap | tetap | — | `message` tidak kosong | serial | qc † OQ-9 |
| 17 | `note` | | `at_service`, `service_repair` | apa pun | tetap | tetap | — | `message` tidak kosong | serialservice | service |

Aturan tambahan (bukan baris): `leg`/`result` TIDAK dikirim klien untuk `send`/`receive` (diturunkan server dari status: `failed|qc_repair` → `to_service`, `service_repair` → `to_qc`, `good` → `between`); `recheck` mengirim `result` (`'pass'` bila tidak ada, kompatibel 5a). `send`: `toLocationId` aktif dan ≠ `location_id` sekarang; menyetel `transit_from_location_id = location_id`, `transit_to_location_id = toLocationId`, `transit_on = occurredOn`; `location_id` TIDAK berubah. `receive`: `location_id = transit_to_location_id` (tanpa pilihan lain), kosongkan `transit_*`. Kenaikan stiker hanya pada baris 10-13 (§3 butir 13; aturan 5a: tidak turun, `inactive` tak boleh naik, `deprecated` boleh, potong selisih di `locationId` cek ulang). Pengguna yang memegang kedua modul memenuhi baris mana pun yang modulnya ia punya; baris 16/17 sama aksinya: pilih baris 17 (tim `service`) bila status `at_service|service_repair` DAN ia punya `serialservice: edit`, selain itu baris 16 (default sementara OQ-9). `broken` final: hanya baris 16.

**Urutan galat `serials.act`** (route permission `anyOf` `serial: edit` / `serialservice: edit`):

| Urutan | Kondisi | Jawaban |
|---|---|---|
| 1 | bentuk masukan salah (aksi tak dikenal, field wajib kosong, field tak diizinkan untuk aksi itu mis. `stickers` pada `send`, tanggal masa depan, pesan terlalu panjang/bidi, `damage` > 200) | `VALIDATION` (field) |
| 2 | serial tak ada atau BU di luar `readableBuIds` | `NOT_FOUND` "Serial Number tidak ditemukan" |
| 3 | `updated_at` ≠ `expectedUpdatedAt` | stale (412 bila `If-Match`) |
| 4 | `resolveAction` tidak menemukan baris untuk (aksi, status, custody) | `CONFLICT` |
| 5 | ada baris, tapi pengguna tak punya modul baris itu level `edit` di BU serial | `FORBIDDEN` |
| 6 | rujukan tak sah (lokasi tujuan nonaktif/sama, stiker tak berlaku/turun/nonaktif, berkas tak dikenal) | `VALIDATION` |

Perubahan perilaku 5a (default sementara OQ-20): pengguna `serial: edit` di BU A + `serial: view` di BU B yang beraksi pada serial BU B kini `FORBIDDEN` (dulu `NOT_FOUND`); pengguna tanpa baca BU B tetap `NOT_FOUND`. Tes 5a yang mengujinya disesuaikan HANYA bila pengujinya memberi akses baca BU B.

## Review Focus

1. **Matriks izin per baris tabel** (termasuk pengguna dengan kedua modul, BU berbeda per modul, `serial: edit` mencoba aksi servis, `serialservice` mencoba pada `recheck`/`good`/`failed`, mencatat/mengubah/menaikkan stiker): tiap baris punya tes positif dan negatif (T1 murni; T5/T6 lewat REST).
2. **Gambar serial bocor lintas BU atau ke pemegang `item: view` saja**: `readFile` saat ini hanya memeriksa pemilik `item` pada cabang `itemBuIds !== null`, jadi pemilik baru tanpa cek eksplisit terbaca oleh siapa pun yang punya `item: view` (T4).
3. **412 palsu saat dua kasus dibuka serentak** (penghitung LP dan CAS serial sama-sama `CAS_FAIL_SQL`): `Promise.all` `report_failure` pada dua serial BERBEDA di hari yang sama → keduanya sukses dengan nomor berbeda; serial SAMA dua kali → satu sukses, satu stale (T3, T5, T7).
4. **Surel rusak**: tepat satu job per `declare_broken`; aksi yang batal (stale/konflik) tidak meninggalkan job; SMTP gagal tidak menggagalkan aksi (job diulang lalu `failed`); isi tanpa rahasia/pesan Markdown; penerima dinonaktifkan/kosong/`MAILER` tak ada → job selesai `skipped` tanpa kirim (T5b, T9).
5. **Atomisitas multi-efek**: `status`, `custody`, `transit_*`, `open_case_id`, `serial_cases` (`closed_on`/`outcome`/`damage`), kejadian, entri stok, klaim berkas, dan job tidak pernah tak sinkron. Uji dengan menyuntik galat pada pernyataan TERAKHIR batch (mis. stiker dihapus di tengah) → tidak ada perubahan apa pun (T5, T6, T7).

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/serial-flow.ts` (+`.test.ts`) | Tabel transisi, `resolveAction`, `availableActions`, `sendLegOf` |
| `shared/serials.ts` | Konstanta 5b (`damageMax`, `shipmentNoteMax`, `messageImagesMax`, `historyLimit*`), `serialCaseNumber`, `SERIAL_HISTORY_GROUPS` |
| `shared/serial-file.ts` | `.qcsn` status `failed` + `damage` [diblokir OQ-8] |
| `shared/contract.ts`, `shared/api.ts`, `shared/files.ts` | DTO, rute, `FileOwnerType` `serial`, `JobKind` `serial_alert` |
| `server/migrations/0013_serial_cases.sql` | `serial_cases`, `serials.transit_on`, indeks |
| `server/src/modules/serial/case-repo.ts` | Kasus, nomor LP (penghitung CAS), pernyataan kasus |
| `server/src/modules/serial/act.ts` | `actOnSerial` (dipindah dari `service.ts`) + aksi 5b |
| `server/src/modules/serial/history.ts` | `serials.history` |
| `server/src/modules/serial/{alert,alert-job,alert-listener}.ts` | Pengaturan `SERIAL_ALERT`, job `serial_alert`, pendengar bus |
| `server/src/modules/files/{service,routes}.ts` | Pemilik `serial` |
| `web/src/modules/serial/` | Komposer aksi, linimasa bertab, baris tahap, panel posisi, halaman pengaturan, status `failed` di pencatatan |

---

# BAGIAN A: shared + server (satu agen Sonnet, satu agen Haiku untuk task mekanis)

### Task 1: Mesin transisi `shared/serial-flow.ts` dan konstanta 5b [Sonnet]

**Files:** Create `shared/serial-flow.ts`, `shared/serial-flow.test.ts`; Modify `shared/serials.ts` (+`shared/serials.test.ts`).

**Interfaces — Produces:**
```ts
// shared/serials.ts (tambahan)
SERIAL_LIMITS: + damageMax: 200, shipmentNoteMax: 200, messageImagesMax: 10 /* [OQ-11] */, historyDefaultLimit: 50, historyMaxLimit: 100
export const SERIAL_ACTIONS = ['note','recheck','report_failure','identify_damage','attempt_repair','send','receive','service_diagnosis','declare_broken','recheck_pass','recheck_fail'] as const;
export type SerialAction = (typeof SERIAL_ACTIONS)[number];
export type SerialTeam = 'qc' | 'service';
export function serialCaseNumber(dateKey: string /* YYYYMMDD */, sequence: number): string; // 'LP-20261120-001' [OQ-3]
export const SERIAL_HISTORY_GROUPS: { checks: readonly SerialEventType[]; changes: readonly SerialEventType[] };
//   checks = recorded, recheck, recheck_pass, recheck_fail; changes = data_changed
// shared/serial-flow.ts
export type SendLeg = 'to_service' | 'at_service' | 'to_qc' | 'at_qc' | 'between';
export type CaseEffect = 'open' | 'update_damage' | 'close_good' | 'close_broken' | null;
export interface FlowRow { action: SerialAction; leg?: SendLeg; result?: 'pass'|'fail'; from: readonly SerialStatus[]; custody: readonly SerialCustody[] | 'any'; toStatus: SerialStatus | 'same'; toCustody: SerialCustody | 'same'; caseEffect: CaseEffect; required: readonly ('damage'|'toLocationId'|'message')[]; allowStickers: boolean; module: 'serial' | 'serialservice'; team: SerialTeam }
export const SERIAL_FLOW: readonly FlowRow[];   // tepat 17 baris tabel di atas, urutan sama
export interface ActorModules { serial: boolean; serialservice: boolean } // level edit di BU serial
export function resolveAction(action: SerialAction, state: { status: SerialStatus; custody: SerialCustody }, actor: ActorModules, result?: 'pass'|'fail'): { row: FlowRow } | { error: 'state' | 'permission' };
export function availableActions(state: { status: SerialStatus; custody: SerialCustody }, actor: ActorModules): FlowRow[]; // urut seperti SERIAL_FLOW, tanpa duplikat aksi
```
`resolveAction`: cari baris yang cocok (aksi, `result` bila `recheck`, status ∈ `from`, custody cocok). Tidak ada → `'state'`. Ada tetapi tak satu pun baris cocok yang modulnya dimiliki actor → `'permission'`. Beberapa cocok (baris 16/17) → pilih yang modulnya dimiliki, utamakan `serialservice` bila status `at_service|service_repair` (OQ-9).

- [ ] **Step 1: Tes (table-driven):** satu kasus positif per baris (status, custody, actor → `toStatus`, `toCustody`, `caseEffect`, `team`, `leg`); untuk SETIAP pasangan (aksi × 7 status × 3 custody) di luar tabel → `'state'`; `serial`-saja pada baris 5/6/7/8 → `'permission'`; `serialservice`-saja pada 1/2/3/4/9-15 → `'permission'`; `serialservice` `note` pada `good`/`failed`/`recheck`/`broken` → `'permission'`; pemegang kedua modul pada `at_service` `note` → tim `service`, pada `failed` → tim `qc`; `broken` hanya `note`; `availableActions` untuk `good`/`qc`/serial-saja = `note, recheck, report_failure, send`; `serialCaseNumber('20261120', 1)` = `'LP-20261120-001'`, `(…, 1000)` = `'LP-20261120-1000'`.
- [ ] **Step 2:** `bun test shared/serial-flow.test.ts shared/serials.test.ts` → FAIL.
- [ ] **Step 3:** implementasi (tabel sebagai data; tanpa rantai `if` per aksi).
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(serial): mesin transisi alur tidak lolos dan servis di shared`.

---

### Task 2: Tipe kontrak dan berkas (tanpa id rute baru) [Haiku]

**Files:** Modify `shared/contract.ts`, `shared/files.ts`; perbaiki fixture yang gagal typecheck.

**Interfaces — Produces:**
```ts
// shared/files.ts
export type FileOwnerType = 'item' | 'qrlogo' | 'sticker' | 'stickerguide' | 'postel' | 'serial';
// shared/contract.ts
export type JobKind = 'qr_export' | 'sheets_export' | 'cleanup_qr' | 'db_backup' | 'serial_alert';
export interface SerialCaseDto { id: string; number: string; openedOn: string; closedOn: string | null; damage: string; outcome: 'good' | 'broken' | null }
export interface SerialEventDto { /* 5a */ caseId: string | null }                 // aditif
export interface SerialSummaryDto { /* 5a */ transitToLocationId: string | null; transitToLocationName: string | null; transitOn: string | null; openCaseNumber: string | null } // aditif
export interface SerialDto { /* 5a */ transitFromLocationId: string | null; transitFromLocationName: string | null; openCase: SerialCaseDto | null; cases: SerialCaseDto[] } // aditif; cases = semua kasus serial, terbaru dulu
export type SerialActInput =
  | { id; expectedUpdatedAt; occurredOn; message; action: 'note' | 'attempt_repair' | 'receive' | 'declare_broken' }
  | { …; action: 'report_failure' | 'identify_damage' | 'service_diagnosis'; damage: string }
  | { …; action: 'send'; toLocationId: string; shipmentNote: string }
  | { …; action: 'recheck'; result?: 'pass' | 'fail'; damage?: string; locationId?: string; stickers?: SerialStickerPick[] }
  | { …; action: 'recheck_pass' | 'recheck_fail'; damage?: string /* hanya recheck_fail */; locationId?: string; stickers?: SerialStickerPick[] };
export interface SerialRowInput { /* 5a */ status: 'good' | 'failed'; damage?: string }   // damage wajib bila failed
export interface SerialListInput { /* 5a */ custody?: SerialCustody }
export interface SerialHistoryInput { id: string; group?: 'all' | 'checks' | 'changes'; caseId?: string; cursor?: string; limit?: number }
export interface SerialHistoryOutput { events: SerialEventDto[]; nextCursor: string | null; counts: { all: number; checks: number; changes: number; byCase: Record<string, number> } }
export interface SerialAlertSettings { enabled: boolean; recipients: string[] }
export interface SerialSettingsDto { alert: SerialAlertSettings; updatedAt: string; smtpConfigured: boolean }
export interface SaveSerialSettingsInput { expectedUpdatedAt: string; alert: SerialAlertSettings }
```
(`…` = `id: string; expectedUpdatedAt: string; occurredOn: string; message: string`.) Server mengisi field aditif DTO dengan `null`/`[]` sampai task pemiliknya (T5/T8) agar typecheck lolos. `handlerOf` di `server/src/modules/jobs/consumer.ts` ditambah `case 'serial_alert'` yang sementara melempar `appError('INTERNAL', …)` (diganti di T9).

- [ ] **Step 1:** ubah tipe; `bun run typecheck` → daftar galat. **Step 2:** perbaiki semua pemakai (DTO pembangun di `service.ts` mengisi field baru default; `validate.ts` `validateSerialAct` tetap hanya menerima `note|recheck` sampai T5; `parseSerialRow` tetap menolak selain `good` sampai T7). **Step 3:** `bun run typecheck` bersih; `bun test shared` PASS. **Step 4: Commit** `feat(serial): tipe kontrak tahap 5b`.

---

### Task 3: Migrasi `0013_serial_cases.sql` [Sonnet]

**Files:** Create `server/migrations/0013_serial_cases.sql`, `server/src/core/migrate-0013.test.ts` (pola tes 0012 yang terpisah; JANGAN menyentuh tes yang dibatasi sampai 0011 di `migrate.test.ts:186`); Modify `server/src/core/migrate.test.ts` hanya `EXPECTED_TABLES` dan daftar nama migrasi.

- [ ] **Step 1: Tes:** tabel `serial_cases` ada; kolom `serials.transit_on` ada dengan default `''`; indeks `serial_cases_number` unik (sisip nomor sama dua kali → `DbError` duplicate dengan `key = 'serial_cases_number'`); menjalankan migrasi dua kali tidak gagal; INSERT `serials` gaya 5a (tanpa `transit_on`) tetap berhasil (kompatibel mundur).
- [ ] **Step 2:** FAIL. **Step 3: DDL** (kolasi dan mesin seperti 0012):
```sql
CREATE TABLE IF NOT EXISTS serial_cases (
  id VARCHAR(100) NOT NULL, number VARCHAR(32) NOT NULL, serial_id VARCHAR(100) NOT NULL, bu_id VARCHAR(100) NOT NULL,
  opened_on VARCHAR(10) NOT NULL DEFAULT '', closed_on VARCHAR(10) NOT NULL DEFAULT '',
  damage VARCHAR(200) NOT NULL DEFAULT '', outcome VARCHAR(16) NOT NULL DEFAULT '',
  created_at VARCHAR(30) NOT NULL DEFAULT '', created_by VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id), UNIQUE KEY serial_cases_number (number), KEY serial_cases_serial (serial_id), KEY serial_cases_bu_opened (bu_id, opened_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
ALTER TABLE serials ADD COLUMN IF NOT EXISTS transit_on VARCHAR(10) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS serials_custody ON serials (custody);
CREATE INDEX IF NOT EXISTS serial_events_case ON serial_events (serial_id, case_id, seq);
```
Bila OQ-12 (`source`) dijawab "simpan di kolom": tambah `ALTER TABLE serials ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual'` di sini (default sementara: TIDAK ada kolom; `source` masuk `data` kejadian `recorded`, lihat T7).
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(serial): migrasi kasus tidak lolos`.

---

### Task 4: Pemilik berkas `serial` (gambar pada pesan) [Sonnet] [diblokir OQ-2, OQ-11]

**Files:** Modify `server/src/modules/files/service.ts` (`FileViewer`, `readFile`, `planAttachFiles`), `server/src/modules/files/routes.ts`; Create `server/src/modules/files/serial-owner.test.ts`.

**Interfaces:**
```ts
export interface FileViewer { /* … */ serialBuIds?: readonly string[] } // BU yang boleh dibaca modul serial (readableBuIds)
```
Aturan:
- `readFile`: bila `record.ownerType === 'serial'`, SEBELUM cabang `itemBuIds`: baca `SELECT bu_id FROM serials WHERE id = ?` (ownerId); terbaca HANYA bila `serialBuIds` memuat BU itu; selain itu `NOT_FOUND` (galat sama dengan berkas tak ada). Pemilik `serial` TIDAK pernah terbaca lewat izin `item`, `sticker`, atau `qrcode`.
- `planAttachFiles`: `file.ownerType === 'serial' && ownerType !== 'serial'` → `VALIDATION` "Ada berkas yang tidak dikenal" (seperti `item`/`postel`).
- `files.upload` `anyOf` + `{serial: edit}`, `{serialservice: edit}`; `files.get` `anyOf` + `{serial: view}`, `{serialservice: view}`; handler `files.get` mengisi `serialBuIds: readableBuIds(ctx.user)` (`serial/access.ts`). Pesan batas unggahan tertunda untuk pengguna serial memakai teks default (`uploadFile` tidak diubah).

- [ ] **Step 1: Tes:** berkas milik serial BU A terbaca oleh `serial: view` A dan `serialservice: view` A; TIDAK terbaca oleh `serial: view` B, oleh `item: manage` semua BU tanpa izin serial, oleh `sticker: view`; berkas serial dikirim ke `items.save`/logo QR/stiker → `VALIDATION`; pengguna `serialservice: edit` saja boleh `files.upload`; pengguna tanpa izin apa pun → `FORBIDDEN`.
- [ ] **Step 2:** `bun run --cwd server test src/modules/files/serial-owner.test.ts` → FAIL. **Step 3:** implementasi. **Step 4:** PASS; jalankan juga `src/modules/files/files.test.ts` dan `src/modules/files/rest.test.ts`. **Step 5: Commit** `feat(files): pemilik berkas serial mengikuti BU serial`.

---

### Task 5a: Repo kasus dan nomor LP [Sonnet] [diblokir OQ-3]

**Files:** Create `server/src/modules/serial/case-repo.ts`, `server/src/modules/serial/case-repo.test.ts`; Modify `server/src/modules/serial/repo.ts`.

**Interfaces — Produces:**
```ts
// case-repo.ts
export interface CaseReservation { number: string; statements: DbStatement[] }
export async function reserveCaseNumber(env: Env, dateKey: string): Promise<CaseReservation>; // pola reserveNumbers (handover/service.ts:378), kunci counters `lp:YYYYMMDD`, cadangan MAX dari serial_cases
export function insertCaseStmt(db: Preparer, c: { id; number; serialId; buId; openedOn; damage; now; actorEmail }): DbStatement;
export function updateCaseDamageStmt(db: Preparer, caseId: string, damage: string, now: string): DbStatement;
export function closeCaseStmt(db: Preparer, caseId: string, outcome: 'good' | 'broken', closedOn: string, now: string): DbStatement; // WHERE closed_on = '' (penjaga: tutup dua kali = CAS_FAIL)
export async function loadCases(db: Preparer, serialId: string): Promise<SerialCaseRow[]>;      // terbaru dulu
export async function runWithCaseNumber<T>(env: Env, serialId: string, expectedUpdatedAt: string | null, attempt: () => Promise<T>, staleMessage: string): Promise<T>;
// repo.ts (perubahan tanda tangan)
NewEvent: + caseId: string ('' = tanpa kasus); insertEventStmt dan insertNextEventStmt menulis case_id dari argumen
NewSerial: + status: 'good' | 'failed'; + openCaseId: string            // insertSerialStmt tak lagi hard-code 'good'
SerialColumn: + 'open_case_id' | 'transit_from_location_id' | 'transit_to_location_id' | 'transit_on'
SerialRow: + transit_from_location_id, transit_to_location_id, transit_on, transit_from_name, transit_to_name, open_case_number
```
`runWithCaseNumber`: jalankan `attempt`; pada `isGuardFailure`, staleError hasil `batchGuarded`, atau `DbError` duplicate `PRIMARY`/`serial_cases_number`: bila `expectedUpdatedAt === null` (serial baru) ulangi; selain itu baca `updated_at` serial: sama → ulangi, beda → `staleError(staleMessage)`; maks. 10 percobaan lalu `staleError`. Tanggal nomor = hari ini WIB saat simpan (default sementara OQ-3), `opened_on` = `occurredOn`.

- [ ] **Step 1: Tes:** dua `reserveCaseNumber` + batch serentak (`Promise.all`) pada hari yang sama → nomor `-001` dan `-002`; tanpa baris `counters` mulai dari MAX nomor yang ada; `closeCaseStmt` kedua kalinya membatalkan batch; `insertNextEventStmt` menulis `case_id`; event 5a (`caseId: ''`) tak berubah.
- [ ] **Step 2:** FAIL. **Step 3:** implementasi. **Step 4:** PASS + `bun run --cwd server test src/modules/serial/act.test.ts` dan `rest.test.ts` tetap hijau. **Step 5: Commit** `feat(serial): repo kasus dan nomor LP`.

---

### Task 5b: `serials.act` aksi QC dan kasus [Sonnet] [diblokir OQ-5, OQ-6, OQ-7]

**Files:** Create `server/src/modules/serial/act.ts` (pindahkan `actOnSerial` dan helper kenaikan stiker dari `service.ts` TANPA mengubah perilaku sebagai commit pertama), `server/src/modules/serial/act-flow.test.ts`; Modify `validate.ts` (`validateSerialAct` = union T2), `routes.ts` (`serials.act` permission `anyOf` `serial: edit` / `serialservice: edit`), `access.ts` (`modulesOn(user, buId): ActorModules`), `server/src/core/events.ts` (`EventPayloads['serial.declared_broken']: { serialId; caseId; eventId; now }`), `server/src/http/body.test.ts` (`WORST` `serials.act` = `recheck_fail` dengan 20 stiker, pesan 5.000 karakter 4-byte, `damage` 200).

**Interfaces — Produces:**
```ts
export async function actOnSerial(env: Env, input: SerialActInput, user: UserContext): Promise<SerialDto>;
// helper internal yang dipakai baris 10-13:
async function stickerRaiseStatements(env, row: SerialRow, eventId, locationId, picks, user, now): Promise<{ statements: DbStatement[]; changes: SerialChangeDto[]; raised: … }>;
```
Alur per aksi (setelah urutan galat di atas): `resolveAction` → kumpulkan `set` serial (status/custody/transit/`open_case_id`/`location_id`), kejadian (tipe = aksi; `case_id` = kasus terbuka atau baru; `actor_team` = baris), `changes` berlabel (`status` "Lolos → Tidak lolos", `custody`, `damage`, `location`, `stickers`), `data` (`caseNumber`, `damage`, `result`, `leg`, `fromLocationName`, `toLocationName`, `shipmentNote`, `daysInTransit` pada `receive` = selisih hari `transit_on` → `occurredOn`), efek kasus (`insertCaseStmt` + `reserveCaseNumber` untuk `open`; `updateCaseDamageStmt`; `closeCaseStmt` + `open_case_id = ''`), klaim berkas `planAttachFiles(env, extractFileRefs(message), 'serial', serialId, undefined, user.email)` (lebih dari `messageImagesMax` → `VALIDATION`), lalu SATU `batchGuarded` di dalam `runWithCaseNumber` bila ada `open`. Baris 13 menulis DUA kejadian berurutan: `recheck` (`data.result = 'fail'`) lalu `report_failure` (membawa `case_id` baru). Task ini mencakup baris 1-4, 9-16 (QC). Baris 5-8 dan 17 di T6 (`resolveAction` sudah menolaknya `CONFLICT`/`FORBIDDEN` dengan benar sejak T1, jadi T6 hanya menambah efeknya).

- [ ] **Step 1 (commit pemindahan):** pindahkan `actOnSerial` ke `act.ts`; `act.test.ts` 5a PASS tanpa perubahan. Commit `refactor(serial): pindahkan aksi serial ke act.ts`.
- [ ] **Step 2: Tes `act-flow.test.ts`:** `report_failure` membuka kasus `LP-<hari ini>-001`, status `failed`, `openCase` terisi, kejadian ber-`caseId`; tanpa `damage` → `VALIDATION`; `identify_damage` mengubah `damage` dengan chip dari→ke; `attempt_repair` → `qc_repair`; `send` ke servis: `custody transit`, `transitTo*` terisi, `location_id` tetap, lokasi tujuan = lokasi sekarang → `VALIDATION`, lokasi nonaktif → `VALIDATION`; `receive` QC dari `recheck`/`transit` → `custody qc`, `location_id` = tujuan; `recheck_pass` dari `qc_repair` menutup kasus `outcome good`, `closed_on` = `occurredOn`, `open_case_id` kosong; `recheck_fail` kasus tetap terbuka; kenaikan stiker pada `recheck_pass` memotong stok di lokasi cek ulang; `recheck` `result:'fail'` → dua kejadian, kasus baru, status `failed`; `send`/`receive` antar lokasi pada `good`; `note` pada `broken` OK, aksi lain pada `broken` → `CONFLICT`; aksi tak sah status → `CONFLICT`; `serial: edit` mencoba `service_diagnosis` → `FORBIDDEN`; pengguna `serial: edit` A + `serial: view` B pada serial B → `FORBIDDEN`; tanpa baca → `NOT_FOUND`; gambar `qcfile:` di pesan diklaim pemilik `serial`; gambar milik item → `VALIDATION`; 11 gambar → `VALIDATION`; `Promise.all` `report_failure` dua serial berbeda → dua sukses, nomor beda; serial sama → satu sukses satu 412; **atomisitas**: stiker yang dihapus di tengah membuat `recheck_pass` gagal → status, kasus, kejadian, stok tidak berubah.
- [ ] **Step 3:** FAIL → implementasi → PASS (`act-flow.test.ts`, `act.test.ts`, `rest.test.ts`, `src/http/body.test.ts`).
- [ ] **Step 4: Pemeriksaan teks** pesan galat baru (gaya santai-jelas; mis. "Isi dulu kerusakannya", "Lokasi tujuan harus beda dengan lokasi sekarang", "Aksi ini bukan bagian tim kamu"). **Step 5: Commit** `feat(serial): aksi tidak lolos, kasus, dan pengiriman oleh QC`.

---

### Task 6: `serials.act` aksi servis [Sonnet] [diblokir OQ-4, OQ-5, OQ-9, OQ-10]

**Files:** Modify `server/src/modules/serial/act.ts`; Create `server/src/modules/serial/act-service.test.ts`; Modify `server/src/modules/serial/routes.ts` + `shared/api.ts` HANYA bila OQ-4 dijawab "buka `serials.locationOptions` bagi servis" (default sementara: permission `serials.locationOptions` → `anyOf` `serial: edit` / `serialservice: edit`; ini mengubah §3 butir 19, jadi wajib jawaban pemilik dan catatan keputusan di spek pada T-docs).

Baris 5-8 dan 17. `declare_broken`: tutup kasus `outcome broken`, status `broken`, lalu `statementsFor(env, 'serial.declared_broken', { serialId, caseId, eventId, now })` di batch yang sama (tanpa pendengar = tanpa job; pendengar dipasang T9).

- [ ] **Step 1: Tes:** `serialservice: edit` BU A: `receive` (`at_service`/`transit`) → `custody service`, `location_id` = tujuan, `data.daysInTransit`; `service_diagnosis` → `service_repair` + `damage` diperbarui; `declare_broken` dari `at_service`/`service_repair` → `broken`, kasus `outcome broken`, kejadian tim `service`, `statementsFor` dipanggil sekali (spy pendengar uji lewat `onEvent`); `send` ke QC → `recheck`/`transit`; `note` pada `service_repair` → tim `service`; `serialservice` pada `good`/`failed`/`recheck` (semua aksi termasuk `note`) → `FORBIDDEN`; `serialservice` BU B pada serial A → `NOT_FOUND`; `serialservice` mencoba `serials.saveBatch`, `serials.update`, `serials.updateBatch`, `serials.stickerOptions` → `FORBIDDEN`; pengguna dengan kedua modul menjalankan baris QC dan servis sesuai baris; `service_diagnosis` sebelum `receive` (custody `transit`) → `CONFLICT` (default OQ-5).
- [ ] **Step 2:** FAIL → implementasi → PASS (`act-service.test.ts`, `act-flow.test.ts`). **Step 3:** pemeriksaan teks. **Step 4: Commit** `feat(serial): aksi tim servis`.

---

### Task 7: Pencatatan langsung `failed` dan `.qcsn` [Sonnet] [diblokir OQ-8, OQ-12]

**Files:** Modify `server/src/modules/serial/{validate,service}.ts` (`parseSerialRow`, `createSerialOnce`), `shared/serial-file.ts` (+`.test.ts`), `server/src/http/body.test.ts` (`WORST` `serials.saveBatch`: 200 baris `failed` dengan `damage` 200 karakter 4-byte, tetap ≤ 2 MB); Create `server/src/modules/serial/record-failed.test.ts`.

Aturan: `status: 'failed'` wajib `damage` (≤200, satu baris) → baris `invalid` "Isi dulu kerusakannya"; `damage` pada `good` diabaikan. Batch baris `failed` = serial (`status failed`, `open_case_id`) + stiker + kejadian `recorded` (seq 1, `data.status: 'failed'`) + kejadian `report_failure` (seq 2, `case_id`, `occurred_on` = hari ini WIB) + `insertCaseStmt` (`opened_on` = hari ini) + penghitung LP + pemotongan stok (tidak bergantung status, §2 butir 8), dibungkus `runWithCaseNumber(…, expectedUpdatedAt: null, …)`. Idempotensi `clientId` tidak berubah: kirim ulang baris yang sudah tercatat = `created` id lama, TANPA kasus/nomor baru. `.qcsn`: `QcsnRow.status: 'good' | 'failed'`, `damage?: string` (wajib bila `failed`, ≤200, tanpa karakter kontrol) — default sementara OQ-8 (kunci baru opsional; pembaca 5a menolak baris `failed` sebagai `problems`, tidak menggagalkan berkas). `source` [OQ-12, default sementara]: `SerialRowInput.source?: 'manual'|'countrylock'` diterima (enum, lainnya `invalid`) dan disimpan di `data.source` kejadian `recorded`; tanpa kolom.

- [ ] **Step 1: Tes:** baris `failed` → `created`, `serials.status failed`, satu kasus `LP-…`, dua kejadian, stok dipotong; tanpa `damage` → `invalid`; retry `clientId` → `created` id sama, tetap satu kasus; 5 baris `failed` serentak (`Promise.all` permintaan terpisah) → 5 nomor unik; `serialservice` → `FORBIDDEN`; `.qcsn` baris `failed` dengan `damage` valid → `rows`, tanpa `damage` → `problems`; `damage` berisi `\u202e` → `problems`; `source: 'countrylock'` tersimpan di `data.source`.
- [ ] **Step 2:** FAIL → implementasi → PASS (`record-failed.test.ts`, `rest.test.ts`, `bun test shared/serial-file.test.ts`, `src/http/body.test.ts`). **Step 3: Commit** `feat(serial): catat serial langsung tidak lolos`.

---

### Task 8: `serials.get` (kasus, posisi), `serials.list` (filter posisi), `serials.history` [Sonnet] [diblokir OQ-15, OQ-16]

**Files:** Create `server/src/modules/serial/history.ts`, `server/src/modules/serial/history.test.ts`; Modify `repo.ts` (`listSerialRows` filter `custody`, kolom transit/kasus di `SERIAL_COLUMNS` lewat `LEFT JOIN locations lf/lt`, `LEFT JOIN serial_cases c ON c.id = s.open_case_id`), `service.ts` (`toSummary`/`toDto`/`toEvent` mengisi field aditif), `validate.ts`, `routes.ts`, `shared/contract.ts` (`ApiContract` `'serials.history'`), `shared/api.ts` (`GET /serials/{id}/history` query `group, caseId, cursor, limit`; `serials.list` query + `custody`), `shared/api.test.ts` (`EXAMPLES`), `server/src/routes.ts` (`ALL_API_IDS`).

Aturan `serials.history`: izin `anyOf` pembaca; `assertSerialVisible`; urut `seq DESC`; kursor = `seq` terakhir (bilangan, kejadian `seq < cursor`); `group: 'checks'|'changes'` menyaring `type IN SERIAL_HISTORY_GROUPS[...]`; `caseId` menyaring `case_id` (kasus milik serial lain → hasil kosong, bukan galat); `limit` default 50, maks 100; `counts` dihitung dengan SATU kueri agregat (`COUNT(*)`, `SUM(type IN …)`, `GROUP BY case_id`). Filter "pengguna" daftar tetap `createdBy` (default sementara OQ-16).

- [ ] **Step 1: Tes:** `get` memuat `openCase`, `cases` (terbaru dulu), `transit*`, `caseId` kejadian; `list` `custody=transit` hanya serial dalam pengiriman, dengan `transitOn`; `history` 3 halaman ukuran 2 tanpa celah/ganda; `group=checks` hanya 4 jenis; `caseId` hanya kejadian kasus itu; `counts` benar; BU lain `NOT_FOUND`; `serialservice: view` boleh membaca; `limit 101` ditolak/dipotong 100 (ikuti pola `serials.list` 5a).
- [ ] **Step 2:** FAIL → implementasi → PASS (`history.test.ts`, `read.test.ts`, `bun test shared/api.test.ts`). **Step 3: Commit** `feat(serial): riwayat berfilter, kasus, dan posisi di detail dan daftar`.

---

### Task 9: Pengaturan surel dan job `serial_alert` [Sonnet] [diblokir OQ-1, OQ-13]

**Files:** Create `server/src/modules/serial/{alert,alert-job,alert-listener}.ts`, `server/src/modules/serial/alert.test.ts`; Modify `server/src/modules/jobs/consumer.ts` (`handlerOf` → `serialAlertHandler`), `server/src/modules/serial/act.ts` (impor efek-samping `./alert-listener`), `routes.ts`, `shared/contract.ts` (`'serialSettings.get'`, `'serialSettings.save'`), `shared/api.ts` (`GET /serial-settings` `etag: 'updatedAt'`; `PUT /serial-settings` `ifMatch: 'expectedUpdatedAt'`, `etag: 'updatedAt'`), `shared/api.test.ts`, `server/src/routes.ts`, `body.test.ts` (`WORST` `serialSettings.save`: 20 penerima 254 karakter).

**Interfaces — Produces:**
```ts
export const SETTING_SERIAL_ALERT = 'SERIAL_ALERT';
export async function readSerialAlert(env: Env): Promise<{ alert: SerialAlertSettings; updatedAt: string; raw: string }>; // pembacaan longgar (pola readPostelAlert)
export async function getSerialSettings(env: Env): Promise<SerialSettingsDto>;
export async function saveSerialSettings(env: Env, input: SaveSerialSettingsInput, user: UserContext): Promise<SerialSettingsDto>; // CAS pola savePostelSettings; audit `serial.settings` target `settings:SERIAL_ALERT`
export function serialAlertJobStmt(env: Env, input: SerialAlertJobInput): DbStatement;   // insertJobStmt kind 'serial_alert', createdBy JOB_SYSTEM_ACTOR
export interface SerialAlertJobInput { serialId: string; caseId: string; eventId: string }
export const serialAlertHandler: JobHandler;     // satu langkah
export function serialBrokenMail(snapshot: { serial; buName; itemLabel; damage; caseNumber; occurredOn; link }): { subject: string; text: string };
```
Izin `serialSettings.get|save`: [OQ-1, default sementara] `serial: manage` lewat penugasan "Semua BU" (dicek handler: `user.businessUnits` punya entri `null` ber-level manage, atau super admin); rute memakai `{ module: 'serial', level: 'manage' }` + cek handler (selain itu `FORBIDDEN`). `enabled` default `false`; `recipients` maks. 20, tiap entri `isPostelRecipient`, unik (tanpa beda huruf). Handler job: baca pengaturan SAAT KIRIM; nonaktif/tanpa penerima/`env.MAILER` tak ada → selesai `{ result: 'skipped' }`; muat snapshot dari DB berdasar id (serial, nama BU, label item, `damage` kasus, nomor kasus, `occurred_on` kejadian, tautan `APP_ORIGIN/serial/<id>`), bersihkan tiap nilai dengan `stripControlChars`; buang penerima tersimpan yang tak lolos `isPostelRecipient`; kirim satu surel ke semua penerima; galat kirim dilempar (runner mengulang 3x lalu `failed`; aksi pengguna tidak terpengaruh). Format [OQ-13, default sementara] subjek `Serial Number rusak: <serial> (<kode BU>)`; badan teks polos: Serial Number, BU, item, kerusakan, nomor kasus, tanggal, tautan; TANPA pesan Markdown kejadian, nama/email pelaku, atau angka stok.

- [ ] **Step 1: Tes (`alert.test.ts`, `MAILER` disuntik seperti Postel):** `declare_broken` membuat tepat satu job `serial_alert` dalam batch yang sama; `declare_broken` yang stale (412) tidak membuat job; menjalankan `runPendingJobs` mengirim satu surel dengan subjek/badan persis; pengaturan nonaktif → `skipped`, tanpa kirim; `MAILER` melempar → job diulang lalu `failed`, serial tetap `broken`; badan tidak memuat pesan kejadian, email pelaku, atau `SMTP_PASS`; `damage` dengan karakter kontrol dibersihkan; simpan pengaturan: 21 penerima → `VALIDATION`, `a@b.c, d@e.f` dalam satu entri → `VALIDATION`, If-Match usang → 412; `serial: manage` hanya di satu BU → `FORBIDDEN` (default OQ-1); `serial: edit` → `FORBIDDEN`.
- [ ] **Step 2:** FAIL → implementasi → PASS (`alert.test.ts`, `src/jobs/runner.test.ts`, `src/modules/jobs/jobs.test.ts`). **Step 3: Pemeriksaan teks surel** (santai-jelas, "Serial Number" lengkap di subjek). **Step 4: Commit** `feat(serial): surel Serial Number rusak lewat antrean job`.

---

### Task 10: Registri dan uji kesepakatan [Haiku]

**Files:** `shared/api.test.ts`, `server/src/http/body.test.ts`, `server/src/routes.ts`, `server/src/modules/serial/events-append-only.test.ts` (tambahkan `serial_cases`: hanya `UPDATE` lewat `case-repo.ts`, tanpa `DELETE` di kode; `serial_events` tetap tanpa UPDATE/DELETE).

- [ ] **Step 1:** pastikan setiap id baru ada di `ALL_API_IDS`, `EXAMPLES`, `WORST`; tes statis append-only mencakup `case-repo.ts`. **Step 2:** `bun test shared/api.test.ts`; `bun run --cwd server test src/http/body.test.ts src/modules/serial/events-append-only.test.ts` PASS. **Step 3: Commit** `test(serial): registri rute dan penjaga riwayat 5b`.

### Task 11: Verifikasi bagian server [pengendali]

- [ ] `bun run check` PASS penuh (tunnel hidup). Bila gagal, kembalikan ke agen task pemilik berkas.

---

# BAGIAN B: web (agen Sonnet berbeda, SETELAH bagian A ter-commit; W5-W6 setelah PR kamera masuk `dev`)

### Task W1: Dasar web: query, izin, label, editor dengan gambar [Sonnet] [diblokir OQ-2]

**Files:** Modify `web/src/modules/serial/{queries,keys}.ts`, `web/src/modules/auth/permissions.ts`, `web/src/modules/serial/lib/labels.ts`, `web/src/modules/markdown/{wysiwyg-editor,wysiwyg-toolbar}.tsx` (+tes).

**Interfaces — Produces:**
```ts
export function serialActorModules(me: MeDto, buId: string): ActorModules; // edit pada serial/serialservice di BU itu
export function canManageSerialSettings(me: MeDto): boolean;          // cermin aturan server T9 (OQ-1)
export const serialHistoryInfiniteQueryOptions: (input: Omit<SerialHistoryInput,'cursor'>) => …; // useInfiniteQuery, kursor seq
export const serialSettingsQueryOptions; export function useSaveSerialSettings();
// labels.ts: ACTION_LABEL: Record<SerialAction,string>, LEG_LABEL, HISTORY_GROUP_LABEL, STEP_ORDER (baris tahap)
// wysiwyg-editor: mode 'message' kini mendukung gambar (FileImageExtension + unggah), hanya 'message' yang dipakai serial
```
`useActSerial` menerima union T2, menempel `SerialDto` hasil ke cache detail dan me-`markStale` daftar + riwayat serial itu. Mode `message` hanya dipakai `act-composer.tsx` (diperiksa: `grep` hanya satu pemakai), jadi gambar diaktifkan di mode itu tanpa mode keempat.

- [ ] **Step 1: Tes:** mode `message` menampilkan tombol gambar dan tempel gambar memicu unggah; mode `note`/`item` tidak berubah; `serialActorModules` untuk campuran BU; label lengkap untuk semua `SerialAction` (tes `Object.keys`). **Step 2:** FAIL → implementasi → PASS (`bunx vitest run web/src/modules/markdown web/src/modules/serial/queries.test.tsx web/src/modules/auth`). **Step 3: Pemeriksaan teks** label (santai-jelas; "Serial Number" di judul). **Step 4: Commit** `feat(serial): dasar web alur tidak lolos`.

---

### Task W2: Detail: kepala kasus, baris tahap, panel posisi, linimasa bertab [Sonnet]

**Files:** Create `web/src/modules/serial/components/{serial-stepper,custody-panel,timeline-tabs}.tsx` (+tes); Modify `serial-detail-page.tsx`, `timeline.tsx`.

Perilaku (mockup `detail-serial-timeline.html`, `pengiriman-servis.html`): kepala menampilkan status, posisi (`CUSTODY_LABEL` + lokasi), lencana kasus `LP-… (terbuka)`; baris tahap `Lolos → Tidak lolos → Perbaikan QC → Di servis → Perbaikan servis → Cek ulang → Lolos / Rusak` dengan tahap sekarang disorot; panel posisi bila `custody = transit`: dari → ke, catatan pengiriman, "N hari belum diterima" (dari `transitOn` ke hari ini WIB); tab "Semua (n)", satu tab per kasus "LP-… (n)", "Pengecekan (n)", "Perubahan data (n)" memakai `counts` dan `serialHistoryInfiniteQueryOptions` dengan tombol "Muat yang lebih lama"; kartu kejadian per jenis menampilkan `data` (nomor kasus dibuka/ditutup, kerusakan, leg pengiriman, lama di perjalanan, hasil cek ulang) dan gambar di pesan lewat `MarkdownView`. `lastPassDate` tetap.

- [ ] **Step 1: Tes:** tahap aktif benar untuk tiap status; panel transit dengan "3 hari belum diterima" (jam tes dipatok); klik tab kasus mengirim `caseId`; "Muat yang lebih lama" mengirim `cursor`; kartu `declare_broken` menampilkan "Kasus LP-… ditutup: rusak". **Step 2:** FAIL → implementasi → PASS (`bunx vitest run web/src/modules/serial/components/serial-detail-page`). **Step 3: Pemeriksaan teks.** **Step 4: Commit** `feat(serial): detail dengan kasus, posisi, dan linimasa bertab`.

---

### Task W3: Komposer aksi [Sonnet] [diblokir OQ-4, OQ-7, OQ-11]

**Files:** Modify `web/src/modules/serial/components/act-composer.tsx`; Create `web/src/modules/serial/components/act-fields.tsx` (+tes).

Perilaku: daftar aksi `Select` = `availableActions(state, serialActorModules(me, serial.buId))` (tanpa daftar keras di komponen); field per baris: `damage` (input satu baris, maks 200, wajib sesuai baris), lokasi tujuan `LinkField` (sumber `serials.locationOptions`; tanpa Tambah/Buka) + catatan pengiriman (maks 200) untuk `send`, hasil Lolos/Tidak lolos (`Select`) untuk `recheck`, lokasi + pencacah stiker (logika 5a) untuk baris 10-13, editor `message` dengan gambar (maks `messageImagesMax`, pesan bila lebih); `receive` menampilkan tujuan yang sudah ditetapkan (tanpa pilihan); `declare_broken` meminta konfirmasi `AlertDialog` ("Serial Number ini akan ditandai rusak dan email dikirim ke penerima"); 412 → muat ulang (pola 5a); pengguna tanpa aksi tersedia (mis. `serial: view`) tidak melihat komposer.

- [ ] **Step 1: Tes:** `serial: edit` pada `good`/`qc` melihat Catatan, Cek ulang, Laporkan tidak lolos, Kirim; `serialservice` pada `at_service`/`transit` hanya Terima dan Catatan; laporan tanpa kerusakan tidak terkirim (pesan field); `send` mengirim `toLocationId` + `shipmentNote`; `recheck` Tidak lolos memunculkan kerusakan wajib; konfirmasi rusak; tidak ada elemen `select`/`option`. **Step 2:** FAIL → implementasi → PASS. **Step 3: Pemeriksaan teks.** **Step 4: Commit** `feat(serial): komposer aksi alur tidak lolos dan servis`.

---

### Task W4: Halaman Pengaturan Serial Number [Haiku] [diblokir OQ-1]

**Files:** Create `web/src/modules/serial/components/serial-settings-page.tsx` (+tes, pola `web/src/modules/sticker/components/postel-alert-settings.tsx`), `web/src/routes/_app/serial/settings.tsx` (tipis, gerbang `canManageSerialSettings`); Modify `web/src/app/navigation.ts` (item "Pengaturan" di grup "Serial Number", tampil hanya bila `canManageSerialSettings`), `navigation.test.ts`.

- [ ] **Step 1: Tes:** sakelar aktif, tambah/hapus penerima (validasi `isPostelRecipient`, maks 20), simpan mengirim `expectedUpdatedAt`, 412 menampilkan pesan dan memuat ulang, peringatan SMTP belum diatur saat `smtpConfigured: false`, navigasi tersembunyi bagi `serial: edit`. **Step 2:** FAIL → implementasi → PASS. **Step 3: Pemeriksaan teks** (judul "Pengaturan Serial Number"). **Step 4: Commit** `feat(serial): halaman pengaturan email Serial Number rusak`.

---

### Task W5: Catat Serial Number: status Tidak lolos [Sonnet] [setelah PR kamera; diblokir OQ-8]

**Files:** Modify `web/src/modules/serial/lib/{draft,qcsn,import-verify}.ts` (+tes), `web/src/modules/serial/components/{record-page,staging-table,bulk-edit-bar,row-detail-dialog}.tsx` (+tes). Rebase ke `dev` setelah PR kamera; jangan menyentuh berkas kamera lainnya.

Perilaku: `StagingRow` + `status: 'good'|'failed'`, `damage: string`; `Defaults` + status/kerusakan (default Lolos); ubah massal status/kerusakan; kolom status di tabel; baris `failed` tanpa kerusakan ditandai dan Simpan ditahan sampai diisi; `toRowInput` mengirim `damage` hanya bila `failed`; ekspor/impor `.qcsn` membawa `status`/`damage`; draf lama (tanpa `status`) dipulihkan sebagai `good`.

- [ ] **Step 1: Tes:** ubah massal tiga baris menjadi Tidak lolos + kerusakan; simpan mengirim `status:'failed', damage`; baris tanpa kerusakan menahan simpan; impor `.qcsn` baris `failed` mengisi kerusakan; draf lama dipulihkan. **Step 2:** FAIL → implementasi → PASS. **Step 3: Pemeriksaan teks.** **Step 4: Commit** `feat(serial): catat Serial Number langsung tidak lolos`.

### Task W6: Daftar: kolom posisi dan filter BU/posisi/pengguna [Sonnet] [setelah PR kamera; diblokir OQ-16]

**Files:** Modify `web/src/modules/serial/components/{serial-list-page,serial-filters}.tsx`, `web/src/modules/serial/lib/list-filter.ts` (+tes). Rebase dulu.

Perilaku: kolom posisi menampilkan "Dalam pengiriman · N hari" dan nomor kasus terbuka; filter posisi (`Select` enum `SERIAL_CUSTODIES`), BU (`LinkField` dari `me.businessUnits` yang terbaca, `localFilter`), pengguna (default sementara OQ-16: hanya "Dicatat oleh saya" sebagai sakelar yang mengisi `createdBy = me.email`, karena tidak ada rute opsi pengguna bagi pembaca).

- [ ] **Step 1: Tes:** filter posisi masuk URL dan dikirim; BU `LinkField` hanya BU terbaca; sakelar "Dicatat oleh saya". **Step 2:** FAIL → implementasi → PASS. **Step 3: Pemeriksaan teks.** **Step 4: Commit** `feat(serial): filter posisi, BU, dan pencatat di daftar Serial Number`.

### Task W7: Dokumentasi [Haiku] (setelah rebase pada PR kamera)

**Files:** spek `docs/superpowers/specs/2026-11-12-serial-number-design.md` (status "dibangun (tahap 5b)"; jawaban OQ dicatat sebagai keputusan pemilik bertanggal dengan kriteria yang bertentangan diubah, sesuai aturan pengguna; §4.3 kolom `NOT NULL DEFAULT ''`; §3 butir 19 bila OQ-4 mengubahnya), `CLAUDE.md` (ringkas: `serial-flow.ts`, `serial_cases`/LP, `serialservice` dibatasi status, pemilik berkas `serial`, job `serial_alert`, `SERIAL_ALERT`, `serials.history`), `docs/ci-cd.md` (rollback: image 5a di atas skema 0013 aman untuk tabel/kolom; job `serial_alert` yang masih antre akan gagal di image 5a (`handlerOf` tanpa kasus → TypeError → `failed`), jadi surel rusak hilang; image 5a membaca berkas pemilik `serial` lewat izin `item: view` karena cek pemiliknya belum ada → hindari rollback ke 5a setelah ada gambar serial, atau perbaiki ke depan), `docs/adding-a-module.md` bila ada pelajaran. Tidak ada variabel `.env` baru (jadi `deploy/compose.yml`/`deploy/.env.example` tidak berubah; `deploy-files.test.ts` tetap hijau).

- [ ] Commit `docs(serial): dokumentasi tahap 5b`.

### Task W8: Verifikasi akhir [pengendali]

- [ ] `bun run check` PASS penuh; `bun run build` PASS (`verify-dist` ≤ 600 KB gzip per potongan). Uji manual di `bun run dev` HANYA bila pengguna mengizinkan (server dev milik pengguna; jangan stop/restart): lapor tidak lolos → kirim ke servis → (akun servis) terima, diagnosis, kirim balik → terima QC → cek ulang lolos; satu alur sampai rusak dengan `MAILER` dev; unggah gambar di pesan.
