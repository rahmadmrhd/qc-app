# Serial unik se-sistem dan cek ulang lintas BU: rencana implementasi

> **Untuk pelaksana:** gunakan superpowers:subagent-driven-development (disarankan) atau superpowers:executing-plans. Langkah memakai kotak centang `- [ ]`. Kerjakan **setelah** rencana `2026-11-18-serial-kode-laporan-baru.md` ter-merge (keduanya menyentuh `case-repo.ts`/`act.ts`).

**Tujuan:** satu Serial Number = satu catatan di seluruh sistem; mencatat serial yang sudah ada lewat Catat menjadi cek ulang lolos (boleh pindah BU menurut aturan "BU saat ini + BU yang belum pernah"); riwayat BU disimpan di tabel penghubung.

**Arsitektur:** tabel `serial_business_units` (riwayat BU) + `serials.bu_id` = BU saat ini; indeks unik `serials_serial` dibuat bersyarat oleh migrasi; satu fragmen SQL bersama untuk visibilitas baca lewat riwayat; jalur `saveBatch` bercabang ke cek ulang bila serial sudah ada; aksi `recheck`/`recheck_pass` menerima `buId?`; web menambah baris "Cek ulang" di draft dari rute `serials.lookupMany`.

**Tech stack:** Bun + Hono + MariaDB (`server/`, tes lewat tunnel `bun run db:tunnel`), `shared/`, React + TanStack + Vitest (`web/`).

**Spek:** `docs/superpowers/specs/2026-11-18-serial-unik-sistem-design.md` (disetujui pemilik 2026-11-18). Pelaksana membaca spek dan `CLAUDE.md` akar (aturan server CAS/batch, `LinkField`, dialog, tanpa `<select>`).

## Batasan global

- Aturan BU target cek ulang: `BU target ∈ {BU saat ini} ∪ {BU tanpa baris di serial_business_units}` dan `canWriteBu(user, BU target)`; BU yang pernah dilewati dan sudah ditinggalkan ditolak. Pindah BU **hanya** pada hasil lolos (`recheck` lolos dan `recheck_pass`); `recheck_fail` dan `recheck` gagal menolak `buId`.
- Serial dengan laporan aktif (`open_case_id <> ''`): baris Catat `invalid` ("Serial ini sedang ada laporan aktif; selesaikan lewat halaman laporannya."); Rusak: `invalid` ("Unit ini sudah dinyatakan rusak."). Jalur cek ulang **tidak** menerapkan syarat item aktif/terlihat; item baris harus sama dengan item catatan.
- Field baris pada cek ulang: `testDate` hanya menjadi `occurredOn` (tidak menimpa `serials.test_date`); `locationId` baris menjadi lokasi cek ulang dan `serials.location_id` ikut pindah; `note` baris = pesan kejadian `recheck`; `sample` diabaikan; stiker bawaan **tidak tercentang**; stiker tercentang +1 dan memotong stok di lokasi (jalur `stickerRaise`, stiker berlaku menurut BU target).
- Baca: `s.bu_id IN (readable) OR s.id IN (SELECT serial_id FROM serial_business_units WHERE bu_id IN (readable))`; tulis dan tindak hanya BU saat ini. Kebocoran lintas BU hanya: item, BU saat ini, status (`lookupMany`, `elsewhere.buCode`).
- Migrasi expand-only, idempoten, kompatibel mundur dengan image sebelumnya; indeks lama `serials_bu_serial` dipertahankan (dihapus di rilis berikutnya). Tidak membaca `process.env` di luar `config.ts`. `shared/` murni. Teks UI Indonesia santai. Pesan commit Indonesia, akhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tes server per berkas bila tunnel tidak stabil; tes konkurensi memakai `Promise.all` atas permintaan nyata (jangan dilemahkan).

## Fokus review

1. Dua pencatat BU berbeda memasukkan serial baru yang sama serentak: tepat satu `created`, satu lagi `rechecked` atau `duplicate`, tanpa potongan stok ganda.
2. Kembali ke BU yang pernah ditinggalkan (A→B→A) ditolak; BU yang belum pernah dipakai diterima; bawaan field BU = BU saat ini.
3. Laporan aktif atau Rusak menolak entri di **semua** BU, termasuk BU saat ini.
4. Image lama yang menulis serial tanpa baris penghubung (rollback) tidak membuat serial tak terlihat setelah maju lagi (backfill saat boot + fragmen baca dua jalan).
5. Visibilitas baca lewat riwayat tidak pernah memberi hak tulis atau tindak; kirim ulang baris Catat (jaringan putus) tidak menggandakan kejadian dan stok.

---

### Tugas 1: Kontrak, aturan murni BU target

**Berkas:** Ubah `shared/serials.ts`, `shared/contract.ts` (~1558 hasil simpan, ~1666-1680 input aksi, `SerialLookupOutput`, tambah id `serials.lookupMany`), `shared/api.ts`, `shared/api.test.ts`, `shared/serials.test.ts`.

**Antarmuka (dipakai tugas lain):**
- `recheckBuCandidates(input: { currentBuId: string; involvedBuIds: readonly string[]; writableBuIds: readonly string[] }): string[]` = `writableBuIds` yang sama dengan `currentBuId` atau tidak ada di `involvedBuIds`.
- Hasil simpan baris: tambah nilai `'rechecked'` (dengan `serialId` di baris hasil).
- `SerialExistingDto { serial: string; id: string; itemId: string; itemLabel: string; buId: string; buCode: string; status: SerialStatus; hasOpenCase: boolean; proofRequired: boolean; proofMin: number; recheckBuIds: string[] }`; `SerialLookupManyInput { serials: string[] }` (maks. 200, `SERIAL_LIMITS`), `SerialLookupManyOutput { found: SerialExistingDto[] }`; rute `serials.lookupMany` GET? gunakan `POST /serials/lookup-many` (badan JSON).
- `SerialLookupOutput` menambah `elsewhere: { buCode: string } | null`.
- `SerialDto` (hasil `serials.get`) menambah `buHistory: { buId: string; buCode: string; firstAt: string; leftAt: string }[]` (`leftAt` kosong = BU saat ini), diisi dari `serial_business_units` di Tugas 3.
- Input aksi `recheck` (hasil lolos) dan `recheck_pass`: `buId?: string`.

- [ ] Tes gagal untuk `recheckBuCandidates` (A→B: dari B kandidat B dan BU belum pernah, bukan A; BU tak tertulis dikeluarkan; kosong bila tak ada), jalankan, implementasi, lulus.
- [ ] Tambah tipe kontrak dan entri `API_ROUTES`; perbarui `shared/api.test.ts` (input contoh untuk `serials.lookupMany`); `bun run typecheck` akan menunjuk rute server yang belum terdaftar (Tugas 4 mengisinya).
- [ ] Commit `feat(serial): kontrak cek ulang lintas BU dan aturan BU target`.

### Tugas 2: Migrasi, tabel riwayat BU, backfill, indeks unik

**Berkas:** Buat `server/migrations/0026_serial_unik_sistem.sql`, `server/src/modules/serial/bu-history.ts`, `bu-history.test.ts`; ubah `server/src/server.ts` (panggil backfill + ensure setelah migrasi, seperti `backfillPostelStickers`), `server/src/modules/serial/service.ts`/`report.ts` (peta `SERIAL_CONFLICTS`/`mapDuplicateError`: tambah `serials_serial`, pertahankan `serials_bu_serial`), `server/src/core/migrate.test.ts`.

**Antarmuka:**
- `backfillSerialBusinessUnits(env: Env): Promise<void>` (idempoten: `INSERT IGNORE ... SELECT id, bu_id, created_at, '' FROM serials s WHERE NOT EXISTS (...)`).
- `ensureSerialUniqueIndex(env: Env): Promise<'created' | 'exists' | 'duplicates'>` (membuat `serials_serial` unik pada `serial` bila belum ada dan tidak ada serial ganda; bila ada ganda: log peringatan dan kembalikan `'duplicates'`, **tidak** menggagalkan start).
- `involvedBuIds(db: Preparer, serialId: string): Promise<string[]>`.
- `moveBuStatements(env: Env, input: { serialId: string; fromBuId: string; toBuId: string; now: string }): DbStatement[]` (ke dalam `batch()` yang sama dengan kejadian: `UPDATE serials SET bu_id`, tandai `left_at` baris lama, `INSERT` baris baru; PK ganda berarti BU itu pernah terlibat, jadi batch gagal dan pemanggil menilai ulang).
- `readableSerialSql(alias: string, buCount: number): string` memakai dua jalan (lihat batasan global); pemanggil mengikat daftar BU dua kali.

- [ ] Migrasi: tabel `serial_business_units(serial_id VARCHAR(100), bu_id VARCHAR(100), first_at VARCHAR(40), left_at VARCHAR(40) NOT NULL DEFAULT '', PRIMARY KEY(serial_id, bu_id), KEY serial_bu_by_bu(bu_id, serial_id))`, backfill, kolom `serial_events.client_id VARCHAR(100) NULL` + indeks unik (kecuali kolom pengenal serupa sudah ada: periksa skema 0012/0015/0017 lebih dulu), dan indeks unik `serials_serial` **bersyarat** (dibuat oleh `ensureSerialUniqueIndex` saat boot dan pada templat tes, BUKAN oleh migrasi: pemeriksa dump pemulihan menolak `PREPARE`/`SET @var`; direvisi 2026-11-19).
- [ ] Tes: backfill idempoten; `ensureSerialUniqueIndex` pada DB tanpa ganda membuat indeks, pada DB dengan serial ganda lintas BU mengembalikan `'duplicates'` tanpa galat dan tanpa mengubah data; `moveBuStatements` menolak (gagal) kembali ke BU yang pernah terlibat; `readableSerialSql` menemukan serial yang hanya punya baris penghubung (tanpa baris untuk BU saat ini) dan serial yang hanya punya `bu_id`.
- [ ] Jalankan `bun run --cwd server test src/core src/modules/serial/bu-history.test.ts`; commit `feat(serial): tabel riwayat BU, backfill, dan indeks unik bersyarat`.

### Tugas 3: Visibilitas baca dan filter lewat riwayat BU

**Berkas:** Ubah `server/src/modules/serial/repo.ts` (`listSerialRows` ~279-283), `access.ts` (tambah `canReadSerial(db, user, serialId, currentBuId): Promise<boolean>`), `service.ts` (`serials.get` ~662, daftar ~696-731), `history.ts` (31, 75), `server/src/modules/files/service.ts` (~146-153) dan `routes.ts` (44), `serial/proof/service.ts` (`serialBuOf` ~66-81); tes yang bersesuaian. `canManageProof`, aksi, ubah, dan notifikasi tetap menurut BU saat ini.

- [ ] Tes gagal: serial A→B: pengguna BU A masih melihat di daftar, detail, linimasa, dan berkas bukti (baca), tetapi `serials.update`/`serials.act` pada BU saat ini B ditolak untuknya; filter `bu=A` menampilkan serial itu, filter `bu=B` juga; pengguna BU C tidak melihat; ukuran halaman dan kursor tetap benar.
- [ ] Implementasi: ganti `s.bu_id IN (...)` dengan `readableSerialSql`; filter BU = `s.id IN (SELECT serial_id FROM serial_business_units WHERE bu_id = ?)`; `get`/`history`/berkas memakai `canReadSerial` (baris penghubung atau `bu_id`). Ukur waktu kueri daftar pada data staging berisi >200 ribu serial; bila lambat, tambah indeks yang diperlukan (catat hasilnya di PR).
- [ ] Commit `feat(serial): serial terlihat oleh BU yang pernah memegangnya (baca saja)`.

### Tugas 4: `saveBatch` bercabang ke cek ulang, `lookupMany`, idempotensi

**Berkas:** Ubah `server/src/modules/serial/service.ts` (`createSerialOnce` ~324-500, `saveSerialBatch`), `validate.ts` (baris Catat tetap; tidak ada field baru), `routes.ts` (daftarkan `serials.lookupMany`, izin `serial: edit`), `act.ts` (ekspor pembantu `stickerRaise`/`planProofAttach` bila perlu); buat `server/src/modules/serial/recheck-entry.ts` dan `recheck-entry.test.ts`; ubah tes `rest.test.ts`, `record-batch.test.ts`.

**Antarmuka:**
- `planRecheckFromRow(env: Env, user: UserContext, existing: SerialRow, row: SaveRow, memo: SerialLookupMemo): Promise<{ ok: true; statements: DbStatement[]; serialId: string } | { ok: false; message: string }>`: menerapkan semua aturan batasan global (laporan aktif, Rusak, item sama, BU target, foto wajib, stiker, pindah BU via `moveBuStatements`, kejadian `recheck` dengan `data.bu = { fromId, fromCode, toId, toCode }` hanya bila BU berubah, `client_id` kejadian = `row.clientId` untuk idempotensi, CAS `updated_at`).
- `lookupSerialsMany(env, user, input: SerialLookupManyInput): Promise<SerialLookupManyOutput>` (pengungkapan minimal; `recheckBuIds = recheckBuCandidates({ currentBuId, involvedBuIds, writableBuIds(user) })`).

- [ ] Tes gagal (`recheck-entry.test.ts`/`rest.test.ts`): (a) serial baru tetap `created`; (b) serial ada, BU sama: `rechecked`, event `recheck`, stok terpotong **hanya** stiker yang dicentang, `serials.test_date` tak berubah, `location_id` pindah ke lokasi baris; (c) BU belum pernah: `rechecked` dan pindah BU (baris penghubung baru, `left_at` lama terisi, event memuat `data.bu`); (d) BU yang pernah ditinggalkan: `invalid`; (e) laporan aktif di BU mana pun: `invalid` pesan laporan aktif; (f) Rusak: `invalid`; (g) item beda: `invalid` menyebut item catatan; (h) item wajib foto tanpa foto cukup: `invalid`; (i) pengguna tanpa hak di BU target: `invalid` generik; (j) kirim ulang baris yang sama (clientId sama): `idempotent` tanpa kejadian/stok ganda; (k) `Promise.all` dua BU dengan serial baru sama: tepat satu `created`; (l) CAS usang: baris dinilai ulang dari awal; (m) `lookupMany` mengembalikan item/BU/status/`hasOpenCase`/`recheckBuIds` dan tidak memuat data lain.
- [ ] Implementasi cabang: di `createSerialOnce`, sebelum insert, cari serial global (`SELECT ... FROM serials WHERE serial = ?`); ada → `planRecheckFromRow`; tak ada → alur sekarang. Duplikat DB (`serials_serial`) saat membuat serentak: baca ulang; bila kini ada, jalankan cabang cek ulang sekali, selain itu `duplicate`.
- [ ] Jalankan `src/modules/serial` (per berkas), typecheck, biome; commit `feat(serial): mencatat serial yang sudah ada menjadi cek ulang, serials.lookupMany`.

### Tugas 5: Aksi `recheck` dan `recheck_pass` memindah BU

**Berkas:** Ubah `server/src/modules/serial/act.ts` (~480-540), `validate.ts` (~673-690: terima `buId` hanya untuk `recheck` lolos dan `recheck_pass`; `recheck_fail`/`recheck` gagal menolak `VALIDATION` pada `buId`), `shared/serial-flow.ts` bila perlu; tes `act-flow.test.ts`, `act-service.test.ts`.

- [ ] Tes gagal: `recheck` lolos dengan `buId` kandidat memindah BU (kejadian `data.bu`, baris penghubung); `recheck_pass` pada laporan aktif menutup laporan **dan** memindah BU, `serial_cases.bu_id` tetap BU saat dibuka; `buId` terlarang (pernah ditinggalkan, tanpa hak tulis) ditolak; `recheck_fail` dengan `buId` ditolak; tanpa `buId` perilaku lama tetap.
- [ ] Implementasi memakai `recheckBuCandidates`, `involvedBuIds`, `moveBuStatements` dalam `batch()` aksi yang sama; hak: pelaku sudah berhak menindak (BU saat ini) **dan** `canWriteBu(target)`.
- [ ] Commit `feat(serial): cek ulang lolos dapat memindahkan BU`.

### Tugas 6: Lapor Rusak, `lookup`, dan ubah serial

**Berkas:** Ubah `server/src/modules/serial/report.ts` (`lookupSerials` ~44-72, `reportNewSerial` ~102-107, peta duplikat ~194), `service.ts` (`updateOnce` pemetaan duplikat nomor serial), tes `report.test.ts`, `update.test.ts`.

- [ ] Tes gagal: `lookup` untuk serial yang ada di BU di luar hak tulis mengembalikan `matches: []` dan `elsewhere: { buCode }`; serial yang tidak ada mengembalikan `elsewhere: null`; `reportNew` pada serial yang sudah ada (BU mana pun) = `CONFLICT` generik "Serial sudah terdaftar"; mengubah nomor serial menjadi nomor yang sudah ada di BU lain = duplikat.
- [ ] Implementasi cek duplikat global di `reportNewSerial` dan `lookupSerials`; commit `feat(serial): Lapor Rusak dan ubah serial mengikuti keunikan global`.

### Tugas 7: Web, draft Catat dengan baris Cek ulang

**Berkas:** Ubah `web/src/modules/serial/queries.ts`, `keys.ts`, `lib/draft.ts`, `lib/draft-store.ts`, `components/record-page.tsx`, `staging-table.tsx`, `staging-cards.tsx`, `row-edit-dialog.tsx`, `item-bu-field.tsx` (opsi BU terbatas), `lib/import-verify.ts`; tes yang bersesuaian.

**Antarmuka:** `serialLookupManyQueryOptions(serials: string[])` / fungsi muat; `StagingRow.existing?: { id, itemId, itemLabel, buId, buCode, status, hasOpenCase, recheckBuIds, proofMin }`; hasil baris `'rechecked'` dihitung "n dicek ulang".

- [ ] Tes gagal: menambah serial yang sudah ada memicu `lookupMany` (dikumpulkan per kelompok) dan baris tampil dengan lencana "Cek ulang"; item dikunci ke item catatan; field BU (`LinkField`) hanya memuat `recheckBuIds` dengan bawaan BU saat ini (kosong bila di luar hak); stiker bawaan tidak tercentang; baris dengan `hasOpenCase` atau Rusak tampil bermasalah dan tidak dapat disimpan; hasil `rechecked` menambah ringkasan "n dicek ulang"; duplikat dalam draft tetap menurut serial saja.
- [ ] Implementasi; jaga aturan frontend (`LinkField`, tanpa `<select>`, dialog header/footer tetap, teks santai). Impor `.qcsn` memverifikasi serial yang sudah ada lewat `lookupMany` (baris menjadi Cek ulang atau bermasalah).
- [ ] Jalankan `cd web && bunx vitest run src/modules/serial`, typecheck, biome, `bun run build`; commit `feat(serial): baris Cek ulang di draft Catat`.

### Tugas 8: Web, dialog aksi, detail, linimasa, Lapor Rusak

**Berkas:** Ubah `act-dialog.tsx` (field BU `LinkField` hanya untuk hasil lolos pada `recheck` dan `recheck_pass`, bawaan BU saat ini, pilihan dari `recheckBuIds` untuk pengguna), `serial-detail-page.tsx` ("Pernah di: A, C"), `timeline.tsx`/`timeline-tabs.tsx` ("Pindah BU: A → B" dari `data.bu`), `report-page.tsx` dan `report-form.tsx` (peringatan "Serial ini ada di BU <kode> dan Anda tidak punya akses untuk melaporkannya." dari `elsewhere`; buang pemilih BU hasil `lookup`), `serial-filters.tsx` (teks bantu "termasuk serial yang pernah di BU ini"); data `buHistory` sudah dari Tugas 1 dan 3.

- [ ] Tes gagal: dialog Cek ulang lolos memuat field BU dan mengirim `buId`; Cek ulang gagal tidak; detail menampilkan "Pernah di"; linimasa menampilkan perpindahan; Lapor Rusak menampilkan peringatan dan menonaktifkan kirim saat `elsewhere`; filter BU.
- [ ] Implementasi dan jalankan tes web; commit `feat(serial): dialog cek ulang dengan BU, riwayat BU di detail, peringatan Lapor Rusak`.

### Tugas 9: Skrip penyatuan serial ganda

**Berkas:** Buat `server/scripts/merge-duplicate-serials.ts`, `server/scripts/merge-duplicate-serials.test.ts` (atau di `server/src/modules/serial/` mengikuti pola skrip pemulihan `restore-backup`); dokumentasi singkat di `docs/` yang relevan.

- [ ] Tes gagal (DB tes): mode uji coba bawaan mencetak rencana tanpa menulis; mode terap menyatukan serial ganda lintas BU dengan pemenang = laporan aktif, lalu Rusak, lalu terbaru; kejadian kalah dipindahkan ke pemenang dengan `seq` disusun ulang menurut waktu dan kejadian `note` "Digabung dari BU X", kasus, `serial_stickers` (jumlah dijumlahkan), entri stok, foto bukti, dan notifikasi diarahkan ke pemenang; catatan kalah dihapus dalam satu transaksi per serial; BU kalah masuk `serial_business_units` dengan `left_at` terisi; setelah itu `ensureSerialUniqueIndex` mengembalikan `'created'`.
- [ ] Implementasi dengan CSV laporan di folder yang diabaikan git (berisi serial: jangan di-commit); commit `feat(serial): skrip penyatuan serial ganda lintas BU`.

### Tugas 10: Selaraskan skrip migrasi data lama

**Berkas:** Ubah `server/scripts/legacy-qc/plan.ts`, `server/scripts/migrate-legacy-qc.ts` dan tes terkait; dokumen `docs/superpowers/specs/2026-11-17-migrasi-data-qc-lama-pemetaan.md` §2.5.

- [ ] Tes gagal: serial yang sama pada dua BU lama dilipat menjadi satu serial (terbaru menang; yang lama menjadi riwayat; BU lamanya masuk `serial_business_units` dengan `left_at`); setiap serial yang ditulis punya baris penghubung untuk BU saat ini; hasil lolos `ensureSerialUniqueIndex`.
- [ ] Implementasi; perbarui aturan "tabrakan keunikan" di pemetaan (unik global, bukan per BU); commit `feat(migrasi): skrip migrasi data lama melipat serial lintas BU`. Urutan rilis dikunci: tugas 1-8 sampai produksi sebelum skrip ini dijalankan di produksi.

### Tugas 11: Dokumen, panduan, dan peluncuran

**Berkas:** `CLAUDE.md` (butir Serial: keunikan global, riwayat BU, cek ulang lintas BU, `serials.lookupMany`, `serials.buOptions` bila belum), `docs/superpowers/specs/2026-11-12-serial-number-design.md` (§2 butir 4, §3, `serials_bu_serial`, §10), `docs/e2e-checklist.md`, `docs/ci-cd.md` (catatan migrasi 0026 dan urutan rilis), panduan interaktif `serial-catat` (langkah cek ulang; versi naik bila konten berubah).

- [ ] Perbarui dokumen dan panduan; jalankan `bun run check` (butuh tunnel) atau per bagian; buat laporan hasil ukur performa daftar BU (Tugas 3) di PR; commit `docs(serial): serial unik se-sistem dan cek ulang lintas BU`.
