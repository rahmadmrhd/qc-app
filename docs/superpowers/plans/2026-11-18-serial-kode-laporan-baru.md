# Kode laporan baru `LP/<BU>/YYMM-iiii`: rencana implementasi

> **Untuk pelaksana:** gunakan superpowers:subagent-driven-development (disarankan) atau superpowers:executing-plans. Langkah memakai kotak centang `- [ ]`.

**Tujuan:** nomor laporan serial berganti dari `LP-YYYYMMDD-NNN` menjadi `LP/<kode BU>/YYMM-iiii` (mis. `LP/SBY/2611-0042`); nomor lama tidak diubah.

**Arsitektur:** fungsi murni pembentuk nomor di `shared/serials.ts`; pemesanan nomor (`reserveCaseNumber`) berkunci penghitung CAS per (BU, bulan) di tabel `counters`; kolom `serial_cases.number` diperlebar. Pemanggil (`act.ts`, `report.ts`) meneruskan kode BU serial dan periode WIB. Web hanya menampilkan string nomor, jadi perubahan web terbatas pada teks panduan dan tes.

**Tech stack:** TypeScript, Bun + Hono + MariaDB (`server/`), Vitest (`web/`, `shared/`), tes server lewat tunnel (`bun run db:tunnel`).

**Spek:** `docs/superpowers/specs/2026-11-18-serial-unik-sistem-design.md` §5.5 (keputusan pemilik 2026-11-18).

## Batasan global

- Format: `LP/` + kode BU + `/` + `YYMM` (tahun dua digit + bulan dua digit, **WIB**) + `-` + urutan 4 digit berhuruf nol di depan; lebih dari 9999 memanjang. Urutan **per (BU, bulan)** mulai `0001`.
- Kode BU tidak dapat diubah (`business-unit-service.ts`), pola `^[A-Z0-9-]+$`; nomor lama (`LP-YYYYMMDD-NNN`) tetap valid, tidak dinomori ulang.
- Tidak ada API runtime/DOM di `shared/`. Migrasi expand-only dan idempoten (`IF NOT EXISTS`/pelebaran kolom). Teks UI berbahasa Indonesia santai. Pesan commit Indonesia, akhiri dengan `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Nomor tidak dipakai di jalur URL (rute memakai UUID/token); pemisah kursor daftar Laporan tetap `|` (nomor baru tidak mengandung `|`).

## Fokus review

1. Kode BU ber-angka dan tanda hubung (mis. `UM-1`) pada awalan pencarian `MAX`; `-` vs `.` sebagai batas rentang awalan.
2. Pergantian bulan di sekitar tengah malam WIB (hari dibuat WIB, bukan UTC); urutan kembali ke `0001` pada bulan baru dan per BU berbeda tidak saling memengaruhi.
3. Dua laporan serentak pada (BU, bulan) yang sama: satu nomor tidak pernah ganda (`runWithCaseNumber`).
4. Urutan di atas 9999 dan penghitung yang hilang tetapi nomor sudah ada (lanjut dari `MAX`).
5. Daftar Laporan memuat dua format sekaligus: urutan `created_at DESC, number DESC`, kursor, dan pencarian `LP/SBY/2611` serta `LP-2026` sama-sama bekerja.

---

### Tugas 1: Fungsi murni nomor dan migrasi pelebaran kolom

**Berkas:**
- Ubah: `shared/serials.ts` (dekat `serialCaseNumber`, baris ~140), `shared/serials.test.ts`
- Buat: `server/migrations/0025_nomor_laporan_baru.sql`
- Tes: `shared/serials.test.ts`, `server/src/core/migrate.test.ts` (bila memeriksa daftar migrasi/hash)

**Antarmuka:**
- Menghasilkan (dipakai Tugas 2): `serialCaseNumber(buCode: string, period: string, sequence: number): string`; `caseNumberPeriod(isoDate: string): string`.

- [ ] **Langkah 1: tes gagal** di `shared/serials.test.ts`: `serialCaseNumber('SBY','2611',42) === 'LP/SBY/2611-0042'`; `serialCaseNumber('UM-1','2611',1) === 'LP/UM-1/2611-0001'`; `serialCaseNumber('SBY','2611',10000) === 'LP/SBY/2611-10000'`; `caseNumberPeriod('2026-11-18') === '2611'`; `caseNumberPeriod('2027-01-05') === '2701'`.
- [ ] **Langkah 2: jalankan, pastikan gagal** (`cd shared && bunx vitest run serials`).
- [ ] **Langkah 3: implementasi** kedua fungsi di `shared/serials.ts`; ganti `serialCaseNumber(dateKey, sequence)` lama (tanda tangan berubah, jangan sisakan versi lama); perbarui komentar dokumentasi di atasnya.
- [ ] **Langkah 4: migrasi** `0025_nomor_laporan_baru.sql`: `ALTER TABLE serial_cases MODIFY COLUMN number VARCHAR(64) NOT NULL` (indeks unik `serial_cases_number` tetap). Idempoten bila diulang. Pastikan tes migrasi/hash templat tetap hijau.
- [ ] **Langkah 5: jalankan tes** `shared` dan `server/src/core/migrate*.test.ts`; hasil hijau.
- [ ] **Langkah 6: commit** `feat(serial): fungsi nomor laporan baru dan pelebaran kolom number`.

### Tugas 2: Pemesanan nomor per (BU, bulan) dan pemanggilnya

**Berkas:**
- Ubah: `server/src/modules/serial/case-repo.ts` (`reserveCaseNumber`, komentar kepala berkas), `server/src/modules/serial/act.ts` (~baris 270), `server/src/modules/serial/report.ts` (~baris 99-108)
- Tes: `case-repo.test.ts`, `act-flow.test.ts`, `report.test.ts`, `case-list.test.ts`, `history.test.ts`, `alert.test.ts`, `public-routes.test.ts`, `e2e-laporan.test.ts`, `laporan-migration.test.ts`, `update.test.ts`, `act-service.test.ts`, `proof/attach.test.ts`, `server/src/core/migrate-0015.test.ts` (semua yang memuat `LP-`; perbarui ekspektasi)

**Antarmuka:**
- Mengonsumsi: `serialCaseNumber`, `caseNumberPeriod` (Tugas 1).
- Menghasilkan: `reserveCaseNumber(env: Env, buCode: string, period: string): Promise<CaseReservation>` (kunci penghitung `lp:<buCode>:<period>`).

- [ ] **Langkah 1: tes gagal** di `case-repo.test.ts`: (a) nomor pertama untuk (SBY, 2611) = `LP/SBY/2611-0001`, berikutnya `...-0002`; (b) BU lain (JKT) pada bulan sama mulai `...-0001`; (c) bulan berikutnya mulai lagi `0001`; (d) tanpa baris penghitung tetapi ada nomor `LP/SBY/2611-0007` di `serial_cases` → nomor berikut `0008`; (e) nomor lama `LP-20261118-003` tidak memengaruhi urutan baru; (f) dua `reserveCaseNumber` serentak dengan `Promise.all` lewat `runWithCaseNumber` tidak menghasilkan nomor ganda; (g) kode BU `UM-1` bekerja pada pencarian `MAX`.
- [ ] **Langkah 2: jalankan, pastikan gagal** (`bun run --cwd server test src/modules/serial/case-repo.test.ts`).
- [ ] **Langkah 3: implementasi** `reserveCaseNumber(env, buCode, period)`: kunci `lp:${buCode}:${period}`; cadangan `MAX(CAST(SUBSTR(number, LENGTH(prefix) + 1) AS UNSIGNED))` dengan `prefix = 'LP/' + buCode + '/' + period + '-'`, rentang `number >= prefix AND number < 'LP/' + buCode + '/' + period + '.'` (`.` tepat setelah `-` pada ASCII); sisanya (CAS, `expected`) tetap. Perbarui komentar kepala berkas.
- [ ] **Langkah 4: pemanggil**: `act.ts` meneruskan kode BU serial (`row.bu_code`, sudah dibaca) dan `caseNumberPeriod(today)`; `report.ts` membaca kode BU target (`SELECT code FROM business_units WHERE id = ?`, BU sudah tervalidasi) lalu `caseNumberPeriod(today)`. `today` tetap tanggal WIB hari dibuat.
- [ ] **Langkah 5: perbarui semua tes yang memuat `LP-`** menjadi format baru; tambahkan tes kampuh: daftar Laporan memuat satu kasus lama dan satu kasus baru (urutan `created_at DESC`), pencarian `LP/SBY/2611` dan `LP-2026` masing-masing menemukan kasusnya; kursor halaman tetap bekerja (nomor mengandung `/`, bukan `|`).
- [ ] **Langkah 6: jalankan** `bun run --cwd server test src/modules/serial` (per berkas bila tunnel tidak stabil), `bun run typecheck`, `bunx biome check server/src shared`; hijau.
- [ ] **Langkah 7: commit** `feat(serial): nomor laporan LP/<BU>/YYMM-iiii dipesan per BU dan bulan`.

### Tugas 3: Web, panduan, dan dokumen

**Berkas:**
- Ubah: `web/src/modules/guide/catalog/serial.ts` (baris ~102, 104, 191, 252), `shared/guides.ts` (versi panduan bila konten langkah berubah), komentar di `shared/contract.ts` (~1504, 1515, 1762), `shared/serial-public.ts` (21, 31), `web/src/modules/serial/components/{timeline-tabs.tsx,public-report-page.tsx}` (komentar), tes web yang memuat `LP-`: `act-dialog`, `case-list-page`, `public-report-page`, `report-page`, `serial-detail-page`, `serial-list-page`
- Ubah dokumen: `CLAUDE.md` (butir Serial 5b yang menyebut format), `docs/superpowers/specs/2026-11-12-serial-number-design.md` (butir 11, 40(a), 54, ~baris 134), `docs/superpowers/specs/2026-11-14-serial-laporan-rusak-design.md` (58, 68), `docs/e2e-checklist.md` bila menyebut format

- [ ] **Langkah 1: perbarui teks panduan** dan contoh nomor menjadi format baru; naikkan versi panduan `serial-catat`/yang terkait hanya bila teks langkah berubah (jaga paritas `shared/guides.ts` dan tes katalog).
- [ ] **Langkah 2: perbarui fixture dan ekspektasi tes web** ke format baru (nomor hanya string; tidak ada logika baru).
- [ ] **Langkah 3: dokumen**: ganti penjelasan format di `CLAUDE.md` dan spek terkait; tambah catatan "nomor lama tetap valid" dan rujuk keputusan pemilik 2026-11-18.
- [ ] **Langkah 4: jalankan** `cd web && bunx vitest run src/modules/serial src/modules/guide src/routes`, `bun run build`, `bunx biome check`; hijau.
- [ ] **Langkah 5: commit** `feat(serial): teks panduan, tes web, dan dokumen mengikuti format nomor laporan baru`.
