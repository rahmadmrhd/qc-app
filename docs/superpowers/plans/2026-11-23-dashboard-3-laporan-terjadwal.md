# Dashboard 3 — Laporan terjadwal lewat surel: rencana implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna ber-`dashboard: manage` membuat banyak laporan terjadwal; tiap laporan mengirim surel bertubuh dashboard (kartu angka, grafik sederhana, daftar perhatian) dengan tombol "Buka dashboard lengkap" ke tautan publik yang periodenya sama dengan isi surel.

**Architecture:** Tabel `dashboard_reports` + loop latar 5 menit (`startDashboardReportLoop`) yang klaim-CAS periode, menghitung widget dengan mesin Rencana 1 pada cakupan beku ∩ hak pemilik, menerbitkan satu baris tautan (`dashboard_shares.report_id`), merender HTML/teks dari `EmailWidgetData` (pemetaan berdaftar putih) dan mengirim satu surel `bcc`. Pengirim `core/mail.ts` diperluas dengan `html` dan `bcc`.

**Tech Stack:** Bun + Hono + MariaDB, `nodemailer` (sudah ada), React/TanStack (halaman kelola).

**Spec:** `docs/superpowers/specs/2026-11-23-dashboard-design.md` (bagian 7a, K6, 8.2, 10, 11). **Prasyarat:** Rencana 1 dan 2 selesai.

## Global Constraints

- Jadwal: **harian**, **mingguan** (Senin=1 … Minggu=7), **bulanan** (tanggal 1-28 atau akhir bulan), pada **jam WIB** 0-23; pemeriksa jadwal bangun **tiap 5 menit** (loop tersendiri, BUKAN `schedulerTick` per jam); surel terkirim paling lambat sekitar 5 menit dari jam jadwal.
- Periode relatif dan hari penuh (berakhir kemarin): `yesterday`, `last7`, `last30`, `lastWeek` (Senin-Minggu), `lastMonth`; perbandingan delta memakai periode sebelumnya yang sama panjang.
- Jatuh tempo: aktif, hari terjadwal (WIB) hari ini, jam sekarang >= jam jadwal, dan `last_run_key` != kunci periode berjalan (harian `YYYY-MM-DD`, mingguan `YYYY-Www` ISO, bulanan `YYYY-MM`). Hari terjadwal yang terlewat tidak dikirim susulan (tanpa status khusus).
- Laporan baru, dilanjutkan, atau jadwal/periodenya diubah: `last_run_key` diisi kunci periode berjalan bila slot periode itu sudah lewat (tidak langsung terkirim).
- `skipped` (pemilik nonaktif/terhapus, pemilik tak lagi `dashboard: manage`, tak ada widget tersisa) TIDAK mengisi `last_run_key` dan dievaluasi ulang di hari terjadwal yang sama. Klaim CAS `last_run_key` SEBELUM kirim, dipulihkan bila gagal.
- Batas: **12 widget** per laporan, **20 laporan** per pemilik, **20 penerima** (satu alamat polos, validator `isPostelRecipient`, huruf kecil, duplikat dibuang, minimal 1), nama maks. **120** karakter (dibersihkan `stripControlChars`), `link_days` 1-365 (pilihan UI 7/14/30/90, bawaan **14**), kirim uji **5 per jam per pemilik**.
- Surel: satu pesan, penerima di `bcc`, `to` = alamat pengirim; HTML lebar 600 px, tabel + gaya inline, tanpa `<script>`/`<img>`/`<link>`/URL luar selain tombol; **<= 90 KB**; teks polos selalu ikut; list **5 baris**; subjek `[QC] <nama laporan>, <periode>` (kirim uji diawali `[UJI] `); semua teks data di-escape dan dibersihkan karakter kontrol/bidi; tanpa pelacak, tanpa tautan berhenti berlangganan.
- Surel hanya dibuat dari `EmailWidgetData` (`toEmailDto` = `toPublicDto` + `previous` dan `total`); delta periode lalu hanya di surel, tidak di halaman publik.
- Tautan terbitan laporan: satu baris `dashboard_shares` per pengiriman (`report_id` terisi, rentang tetap = periode surel, `expires_at` = kirim + `link_days`, `created_by` = pemilik), dibuat sebelum merender dan **dihapus bila pengiriman gagal**; penyapu per jam menghapus yang kedaluwarsa > 30 hari; menghapus laporan mencabut tautannya.
- Izin: semua rute `dashboard: manage`; pemegang `manage` lain hanya melihat metadata (tanpa alamat penerima, pratinjau, atau tautan); hanya pemilik atau super admin yang mengubah, menjeda, mengirim uji, pratinjau, melihat tautan, atau menghapus.
- Migrasi `0033_dashboard_reports.sql` expand-only dan idempoten (terpisah dari `0032` agar basis data dev yang sudah menerapkan `0032` tetap menerimanya). Hapus laporan = hapus baris (bukan soft delete). Audit `dashboard.report_create|update|delete|pause|resume|send_test` (target `dashboard_report:<id>`, tanpa isi surel/token). Tanpa `.env` baru; berjalan hanya bila `Env.MAILER` ada.
- Aturan sesi/UI/tes sama dengan Rencana 1-2 (commit hanya setelah izin pengguna; tunnel DB; kit halaman; `LinkField`/`Select`; teks santai).

## Review Focus

1. Dua pemeriksaan serentak atau server yang dimulai ulang di tengah jam jadwal tidak boleh mengirim dobel, dan kegagalan SMTP tidak boleh meninggalkan baris tautan yatim atau klaim yang menahan percobaan ulang (Tugas 5).
2. Nama customer/stiker/laporan berisi `<script>`, tanda kutip, atau karakter bidi tidak boleh merusak atau menyusupkan markup ke surel (Tugas 4).
3. Laporan yang dibuat setelah slot jadwal periode itu lewat tidak langsung terkirim ke penerima eksternal (Tugas 2-3).
4. Pemegang `manage` lain tidak boleh membaca alamat penerima, pratinjau, atau tautan terbitan laporan orang lain (Tugas 3, 5).
5. Surel tidak boleh dipotong klien (>= ~102 KB) pada beban terbesar (12 widget, list 5 baris, seri 31 kolom) (Tugas 4).

## File Structure

- Modify `server/src/core/mail.ts` (+ `mail.test.ts`, penyuntik surel palsu di `server/test-support/`).
- Create `shared/dashboard-report.ts` (+ tes); modify `shared/dashboard-public.ts` (`toEmailDto`, `EmailWidgetData`), `shared/contract.ts`, `shared/api.ts`, `shared/api-versions.ts`, `shared/audit.ts`, `shared/api-contract.snapshot.json`.
- Create `server/migrations/0033_dashboard_reports.sql`, `server/src/modules/dashboard/report/{repo,service,validate,routes,render,run,sweep}.ts` (+ tes).
- Modify `server/src/modules/dashboard/share-service.ts` (ekstrak `freezeContent`), `server/src/modules/dashboard/public-view.ts` (ekstrak `computeShareWidgets`), `server/src/jobs/runner.ts`, `server/src/server.ts`, `server/src/routes.ts`, `server/src/http/body.test.ts`.
- Create `web/src/modules/dashboard/report/**`, `web/src/routes/_app/dashboard/laporan/{index,new}.tsx`, `.../laporan/$reportId/{index,edit}.tsx`; modify `web/src/app/navigation.ts` (butir Dashboard menjadi grup), `scripts/page-frame.test.ts` bila perlu.
- Create `docs/dashboard-email-checklist.md`; modify `CLAUDE.md`, `server/changelog.d/20261123-dashboard.md`, spek bagian 7.1/7a.1 (nama migrasi).

---

### Task 1: Pengirim surel mendukung `html` dan `bcc`

**Files:**
- Modify: `server/src/core/mail.ts`; penyuntik surel palsu yang dipakai tes (cari `MAILER` di `server/test-support/`)
- Test: `server/src/core/mail.test.ts`

**Interfaces:**
- Produces: `MailMessage { to: string[]; bcc?: string[]; subject: string; text: string; html?: string }`; `MailTransport.sendMail(message: { from: string; to: string; bcc?: string; subject: string; text: string; html?: string })`. Perilaku: `bcc` digabung koma; `html` diteruskan; bila `to` kosong dan `bcc` ada, `to` diisi alamat dari `settings.from` (bentuk `Nama <alamat>` → `alamat`; tanpa tanda kurung → seluruhnya). Pemanggil lama (hanya `text`) tak berubah. Penyuntik palsu tes menyimpan `bcc` dan `html` pada pesan yang tercatat.

- [ ] **Step 1: Tulis tes yang gagal**: pesan dengan `html` dan `bcc:['a@x.id','b@y.id']` mencapai transport dengan `bcc: 'a@x.id, b@y.id'` dan `html`; `to:[]` + bcc dengan `from='QC App <noreply@qc.rhd.my.id>'` → `to: 'noreply@qc.rhd.my.id'`; `from` polos → apa adanya; pesan hanya-teks lama menghasilkan objek tanpa properti `html`/`bcc`; pembersihan galat (`redactSecrets`) tetap menyembunyikan `SMTP_PASS`.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/core/mail.test.ts` → FAIL. **Step 3: Implementasi**; perbarui penyuntik palsu. **Step 4: Jalankan** tes mail + seluruh tes yang memakai `MAILER` (`bun run --cwd server test src/modules/sticker src/modules/postel src/modules/serial`) → PASS.
- [ ] **Step 5: Commit** `feat(mail): dukungan html dan bcc pada pengirim surel`.

---

### Task 2: Fungsi jadwal dan periode (`shared/dashboard-report.ts`)

**Files:**
- Create: `shared/dashboard-report.ts`
- Test: `shared/dashboard-report.test.ts`

**Interfaces:**
- Consumes: `DashboardRange`, `DashboardFilterInput`, `WidgetId`, `ShareWidgetScope`, `ShareScope`, `DashboardShareDto` (Rencana 1-2).
- Produces:
  - `type ReportFrequency = 'daily'|'weekly'|'monthly'`; `interface ReportSchedule { frequency: ReportFrequency; hour: number; weekday: number; monthDay: number }` (`weekday` 1-7 Senin=1; `monthDay` 1-28, `0` = akhir bulan); `type ReportPeriod = 'yesterday'|'last7'|'last30'|'lastWeek'|'lastMonth'`; `REPORT_PERIOD_LABELS: Record<ReportPeriod,string>`.
  - `REPORT_LIMITS = { widgetsMax: 12, perOwner: 20, recipientsMax: 20, nameMax: 120, linkDaysMax: 365, linkDaysDefault: 14, testPerHour: 5 } as const`.
  - `interface WibNow { date: string; hour: number; weekday: number }`; `wibNow(ms: number): WibNow`.
  - `validateSchedule(s: ReportSchedule): string | null`; `periodRange(period: ReportPeriod, todayWib: string): DashboardRange`; `periodKey(s: ReportSchedule, now: WibNow): string`; `isScheduledDay(s, now): boolean`; `isDue(s, now, lastRunKey: string): boolean`; `initialRunKey(s, now): string` (kunci periode berjalan bila slot periode itu sudah lewat atau sama dengan jam sekarang, selain itu `''`); `nextRunAt(s, nowMs, lastRunKey: string): string` (ISO UTC kejadian berikutnya, untuk label "berikutnya"); `scheduleLabel(s): string` ("Setiap hari 08.00 WIB", "Senin 08.00 WIB", "Tanggal 1 pukul 08.00 WIB", "Akhir bulan 08.00 WIB").
  - DTO kontrak: `interface ReportScope { buIds: string[]; locationIds: string[]; locationFiltered: boolean; widgets: ShareWidgetScope[]; offers: string[] }`; `interface DashboardReportDto { id: string; name: string; owner: string; enabled: boolean; schedule: ReportSchedule; period: ReportPeriod; scope: ReportScope; recipients: string[]; recipientCount: number; linkDays: number; lastStatus: ''|'ok'|'skipped'|'error'; lastNote: string; lastRunAt: string; nextRunAt: string; createdAt: string; updatedAt: string; canEdit: boolean; links?: DashboardShareDto[] }`; `interface DashboardReportListDto { reports: DashboardReportDto[]; smtpConfigured: boolean; limit: number }`; `interface SaveDashboardReportInput { id?: string; name: string; schedule: ReportSchedule; period: ReportPeriod; filter: DashboardFilterInput; locationFiltered?: boolean; widgets: ShareWidgetScope[]; offers: string[]; recipients: string[]; linkDays: number; enabled?: boolean; expectedUpdatedAt?: string }`.

- [ ] **Step 1: Tulis tes yang gagal** (tabel kasus)
  - `periodRange` untuk `todayWib='2026-11-23'` (Senin): `yesterday` = 22-22 Nov; `last7` = 16-22 Nov; `last30` = 24 Okt-22 Nov; `lastWeek` = 16-22 Nov (Senin-Minggu minggu lalu); `lastMonth` = 1-31 Okt; pada `todayWib='2026-01-01'`: `lastMonth` = 1-31 Des 2025, `lastWeek` melintas tahun benar.
  - `periodKey` mingguan memakai minggu ISO (mis. 2026-01-01 Kamis → `2026-W01`; 2025-12-29 → `2026-W01`); bulanan `2026-11`; harian tanggal.
  - `isScheduledDay`: mingguan hanya pada `weekday` yang cocok; bulanan `monthDay=0` pada 28 Feb 2027 (hari terakhir), 29 Feb 2028, 30 Apr, 31 Jan; `monthDay=15` hanya tanggal 15.
  - `isDue`: sebelum jam jadwal false, tepat jam jadwal true, `lastRunKey` sama dengan kunci periode → false; hari tak terjadwal → false.
  - **Review Focus 3:** `initialRunKey` untuk jadwal "Senin 08.00" pada Senin 10.00 mengembalikan kunci minggu itu (slot lewat → tak terkirim); pada Senin 07.00 mengembalikan `''`; pada Selasa → kunci minggu itu; harian pada pukul sama dengan jam jadwal → kunci hari ini.
  - `validateSchedule`: `hour` 24 atau -1 tak sah; `weekday` 0/8; `monthDay` 29 tak sah; `0` sah.
  - `nextRunAt` untuk harian 08.00 setelah terkirim hari ini → besok 08.00 WIB (dalam UTC `01:00`); untuk mingguan melewati akhir pekan; label sesuai contoh.
- [ ] **Step 2: Jalankan** `bun run --cwd shared test dashboard-report.test.ts` → FAIL. **Step 3: Implementasi** murni (aritmetika `Date.UTC`, WIB = UTC+7). **Step 4: Jalankan** → PASS; `bun run --cwd shared typecheck`.
- [ ] **Step 5: Commit** `feat(dashboard): fungsi jadwal dan periode laporan`.

---

### Task 3: Tabel, layanan, dan rute CRUD laporan

**Files:**
- Create: `server/migrations/0033_dashboard_reports.sql`, `server/src/modules/dashboard/report/{repo,service,validate,routes}.ts`
- Modify: `server/src/modules/dashboard/share-service.ts` (ekstrak `freezeContent`), `shared/contract.ts`, `shared/api.ts`, `shared/api-versions.ts`, `shared/audit.ts` (`ActivityKind` + `dashboardReport`; pemuat log: gerbang = pemegang `manage`), `server/src/routes.ts`, `server/src/http/body.test.ts`, `shared/api-contract.snapshot.json`
- Test: `server/src/modules/dashboard/report/{service,rest}.test.ts`

**Interfaces:**
- Consumes: Tugas 2; `freezeScope` (Rencana 2 Tugas 4); `isPostelRecipient`, `stripControlChars`; penulis audit modul lain.
- Produces:
  - `freezeContent(user: UserContext, input: { filter: DashboardFilterInput; locationFiltered?: boolean; widgets: ShareWidgetScope[]; offers: string[] }, nowMs: number): ReportScope` di `share-service.ts` (logika yang sudah ada di `freezeScope`, dipindah; `freezeScope` memanggilnya; tes Rencana 2 tetap hijau).
  - `interface ReportRow { id: string; name: string; owner: string; enabled: number; schedule: string; period: string; scope: string; recipients: string; link_days: number; last_run_key: string; last_run_at: string; last_status: string; last_note: string; created_at: string; updated_at: string; version: number }`; skema `dashboard_reports` mengikuti kolom itu (`enabled TINYINT`, JSON sebagai `LONGTEXT`, kunci `(owner)`, kolasi `utf8mb4_nopad_bin`).
  - Rute (semua `dashboard: manage`): `dashboardReports.list` (`GET /dashboard-reports` → `DashboardReportListDto`), `dashboardReports.get` (`GET /dashboard-reports/{id}` → `DashboardReportDto`, `etag: 'updatedAt'`), `dashboardReports.save` (`PUT /dashboard-reports/{id}`, `create: POST /dashboard-reports` 201, `ifMatch: 'expectedUpdatedAt'`, `etag`), `dashboardReports.setEnabled` (`POST /dashboard-reports/{id}/enabled` masukan `{ id: string; enabled: boolean }`), `dashboardReports.remove` (`DELETE /dashboard-reports/{id}` → `{ ok: true }`).
  - Perilaku: pemilik = pembuat; `canEdit` = pemilik atau super admin; non-pemilik menerima `recipients: []` (hanya `recipientCount`) dan tanpa `links`; `save` membekukan cakupan lewat `freezeContent` saat disimpan; `initialRunKey` dihitung saat dibuat, dilanjutkan (`setEnabled` true), atau bila `schedule`/`period` berubah; CAS `updated_at` (galat usang lewat `staleError`); `smtpConfigured = env.MAILER !== undefined`; `remove` menghapus baris dan mencabut tautan terbitannya (`UPDATE dashboard_shares SET revoked_at ... WHERE report_id = ?`) dalam satu `batch()`.

- [ ] **Step 1: Tulis tes yang gagal**
  - Validasi: 13 widget, nama kosong/> 120, penerima kosong atau > 20, alamat tak polos (`"A <a@x.id>"`, `a@x.id, b@y.id`), jadwal tak sah, `linkDays` 0/366, widget di luar hak → semua `VALIDATION`; penerima dinormalisasi huruf kecil dan duplikat dibuang; nama dibersihkan dari karakter kontrol.
  - Batas 20 laporan per pemilik → `CONFLICT` pada yang ke-21.
  - **Review Focus 3:** laporan mingguan "Senin 08.00" dibuat Senin 10.00 → `last_run_key` = kunci minggu itu; dibuat Senin 07.00 → `''`; `setEnabled(true)` pada laporan yang dijeda lewat slot → kunci diisi; mengubah `schedule` memicu hitung ulang; mengubah nama saja tidak.
  - **Review Focus 4:** pemegang `manage` lain: `get`/`list` mengembalikan metadata, `recipients` kosong, `canEdit` false; `save`/`setEnabled`/`remove` oleh non-pemilik → `FORBIDDEN`; super admin boleh; pengguna tanpa `manage` → `FORBIDDEN` pada semua rute.
  - CAS: `save` dengan `expectedUpdatedAt` usang → 412.
  - `remove` mencabut tautan terbitan (baris `dashboard_shares` ber-`report_id` jadi `revoked`) dan menghapus baris laporan; audit tercatat tanpa alamat penerima.
  - `list.smtpConfigured` false tanpa `MAILER`; `limit` = 20.
  - `body.test.ts`: `dashboardReports.save` masuk tabel batas muatan.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/dashboard/report` → FAIL. **Step 3: Implementasi** (+ ekstraksi `freezeContent`). **Step 4: Jalankan** `bun run api:snapshot`, tes `src/modules/dashboard`, `bun run --cwd shared test`, `bun run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): tabel dan rute laporan terjadwal`.

---

### Task 4: Pemeta surel dan perender HTML/teks

**Files:**
- Modify: `shared/dashboard-public.ts`
- Create: `server/src/modules/dashboard/report/render.ts`
- Test: `shared/dashboard-public.test.ts` (tambah), `server/src/modules/dashboard/report/render.test.ts`

**Interfaces:**
- Produces:
  - `EMAIL_LIST_ROW_MAX = 5`; `type EmailWidgetData = NumberData | PartsData | SeriesData | ListData`; `toEmailDto(id: WidgetId, data: WidgetData): EmailWidgetData` = `toPublicDto` + `previous` dipertahankan pada number, list dipotong `EMAIL_LIST_ROW_MAX` dengan `total` tetap.
  - `interface EmailReportInput { reportName: string; periodLabel: string; scopeLabel: string; scheduleLabel: string; ownerName: string; widgets: { meta: WidgetMeta; data: EmailWidgetData }[]; ctaUrl: string; linkExpiresLabel: string; test?: boolean }`; `interface RenderedEmail { subject: string; html: string; text: string }`; `EMAIL_HTML_MAX_BYTES = 90 * 1024`; `renderReportEmail(input: EmailReportInput): RenderedEmail`.
  - Pemetaan visual (spek 7a.3): number → kartu angka + delta ("naik N% dari periode lalu"/"turun"/"tetap"; tanpa persen bila `previous = 0`); donut/pie → batang bertumpuk + legenda berlabel (maks. 6 irisan + "Lainnya", lebar irisan dibulatkan agar jumlah 100%); line/bar deret → kolom (maks. 31 batang, tinggi proporsional, sumbu label pendek); barH → batang horizontal berlabel nilai; barGroup → kolom dua warna + legenda; list → tabel + "Menampilkan N dari M". Warna tetap berkontras AA di latar putih (konstanta di `render.ts`); nilai selalu tertulis. Bila HTML > 90 KB render ulang kompak (list 3 baris, seri maks. 14 kolom).
  - Kepala: nama laporan, jadwal, periode, cakupan; kaki: nama laporan, pemilik, "hubungi pemilik untuk berhenti atau mengubah isinya". Tombol "Buka dashboard lengkap" (`<a>` bergaya tombol) dengan catatan masa berlaku. Teks polos: ringkasan angka per widget, daftar, tautan di baris sendiri.

- [ ] **Step 1: Tulis tes yang gagal**
  - `toEmailDto`: number mempertahankan `previous`; list 12 baris → 5 dengan `total` 12; kolom list hanya `listColumns`.
  - **Review Focus 2:** nama laporan/customer berisi `<script>alert(1)</script>`, `"onload="x`, dan `‮` (bidi) → di HTML muncul sebagai teks ter-escape tanpa tag, tanpa karakter bidi/kontrol; subjek dibersihkan dan dibatasi (nama 120).
  - Struktur: HTML tak memuat `<script`, `<img`, `<link`, `<iframe`, `javascript:`; tepat SATU `href=` (tombol) bernilai `ctaUrl`; tak ada `http` selain `ctaUrl`; semua gaya inline (tanpa `<style>` yang bergantung kelas); lebar tabel utama 600.
  - **Review Focus 5:** fixture 12 widget terbesar (30 kolom seri, list 5 baris dengan teks panjang 200 karakter) → `html` <= 90 KB (ukuran byte UTF-8); fixture yang sengaja melebihi memicu render kompak dan tetap <= 90 KB.
  - Fixture per visual: number naik/turun/nol/`previous` 0; stacked bar jumlah lebar = 100 dan 7 irisan menjadi 6 + "Lainnya"; kolom seri kosong → "Belum ada data"; list kosong → pesan; "Menampilkan 5 dari 12".
  - Teks polos memuat `ctaUrl` di baris sendiri dan nilai angka tiap widget; subjek `[QC] <nama>, <periode>` dan diawali `[UJI] ` bila `test`.
- [ ] **Step 2: Jalankan** `bun run --cwd shared test dashboard-public.test.ts` dan `bun run --cwd server test src/modules/dashboard/report/render.test.ts` → FAIL. **Step 3: Implementasi** (fungsi murni tanpa I/O; helper escape tunggal). **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): perender surel laporan`.

---

### Task 5: Eksekusi laporan, loop jadwal, penyapu, kirim uji, dan pratinjau

**Files:**
- Create: `server/src/modules/dashboard/report/{run,sweep}.ts`
- Modify: `server/src/modules/dashboard/public-view.ts` (ekstrak `computeShareWidgets`), `server/src/modules/dashboard/report/{service,routes}.ts`, `server/src/jobs/runner.ts`, `server/src/server.ts`, `shared/contract.ts`, `shared/api.ts`, `server/src/http/body.test.ts`, `shared/api-contract.snapshot.json`
- Test: `server/src/modules/dashboard/report/{run,sweep,test-send}.test.ts`, `server/src/modules/dashboard/report/loop.test.ts`

**Interfaces:**
- Consumes: Tugas 1-4; `signShareToken`, `shareUrl`, `insertShareStmt`, `hitLimit` (Rencana 2); `loadUserContext`; `redactSecrets`.
- Produces:
  - `computeShareWidgets(env: Env, scope: ShareScope, createdBy: string, viewer: PublicQueryInput, nowMs: number): Promise<{ sharer: UserContext; resolved: ResolvedScope; results: WidgetResult[]; widgetIds: WidgetId[] } | null>` di `public-view.ts` (inti `loadPublicDashboard`; perilaku dan tes Rencana 2 tak berubah).
  - `type RunMode = 'scheduled' | 'test' | 'preview'`; `runReport(env: Env, report: ReportRow, nowMs: number, mode: RunMode): Promise<{ status: 'ok'|'skipped'|'error'; note: string; email?: RenderedEmail }>`; `checkDashboardReports(env: Env, nowMs?: number): Promise<{ sent: number; skipped: number; failed: number }>`; `sweepReportShares(env: Env, nowMs?: number): Promise<number>` (menghapus baris `dashboard_shares` ber-`report_id` yang `expires_at` < sekarang − 30 hari; mengembalikan jumlah terhapus).
  - `startDashboardReportLoop(env: Env, options?: { intervalMs?: number }): () => Promise<void>` di `runner.ts` (bawaan 5 menit, memakai mesin `startLoop` yang sama dengan `startNotificationLoop`, tak tumpang tindih, mengembalikan fungsi penghenti), dipanggil `createServer` hanya bila `env.MAILER` ada dan dihentikan di `stop()`; `sweepReportShares` ditambahkan ke daftar langkah per jam `schedulerTick`.
  - Rute tambahan (kontrak + `API_ROUTES`): `dashboardReports.sendTest` (`POST /dashboard-reports/{id}/send-test` → `{ ok: true }`), `dashboardReports.preview` (`GET /dashboard-reports/{id}/preview` → `{ subject: string; html: string }`); `dashboardReports.get` untuk pemilik/super admin kini mengisi `links` (maks. 10 tautan terbitan terbaru, dengan `url`).

Alur `scheduled`: (1) `env.MAILER` ada, laporan `enabled`, `isDue(...)` benar; (2) pra-periksa tanpa klaim: pemilik aktif lewat `loadUserContext`, memegang `dashboard: manage`, ada widget yang masih diizinkan → bila gagal: `last_status='skipped'` + catatan (tanpa mengubah `last_run_key`); (3) klaim CAS `last_run_key` (gagal klaim = keluar tanpa kirim); (4) `range = periodRange(period, today)`; sisipkan baris tautan terbitan (cakupan beku + rentang tetap + `expires_at`); (5) `computeShareWidgets` dengan `viewer = {}`, petakan `toEmailDto`, render, `MAILER.send({ to: [], bcc: recipients, ... })`; (6) sukses: `last_status='ok'`, `last_run_at`; gagal: hapus baris tautan, pulihkan klaim, `last_status='error'` dengan catatan `redactSecrets`. `test`: kirim hanya ke surel pemilik (subjek `[UJI] `), tanpa mengubah `last_run_key`, dibatasi `hitLimit(env, 'dashboard-report-test:<owner>', 5, 3_600_000)`; `preview`: tanpa surel dan tanpa tautan (tombol memakai `APP_ORIGIN/dashboard-publik/contoh`); `sendTest` dan `preview` hanya pemilik atau super admin.

- [ ] **Step 1: Tulis tes yang gagal** (`createTestEnv` dengan surel palsu dan jam terkendali `env.clock`; widget dari data `seed*` Rencana 1)
  - Jatuh tempo: harian 08.00 — pada 07.55 tak terkirim; 08.00 terkirim sekali; panggilan kedua di 08.05 tak mengirim lagi; hari berikutnya terkirim lagi; mingguan hanya pada hari terjadwal; laporan dijeda tak terkirim; `env.MAILER` tak ada → tidak berbuat apa pun.
  - **Review Focus 1:** `Promise.all([checkDashboardReports(env), checkDashboardReports(env)])` → tepat 1 surel; SMTP palsu gagal → `last_status='error'`, baris tautan terbitan dihapus, `last_run_key` kembali ke sebelumnya, pemeriksaan berikutnya di hari yang sama mengirim sukses dan menyisakan tepat 1 baris tautan; server "dimulai ulang" (pemeriksaan baru setelah sukses) tak mengirim dobel; hari terjadwal terlewat (pemeriksaan pertama esok hari) tak mengirim susulan.
  - `skipped`: pemilik nonaktif; pemilik kehilangan `dashboard: manage`; semua widget kehilangan izin → `last_status='skipped'` dengan catatan yang sesuai, **`last_run_key` tak berubah**, dan begitu syaratnya pulih (pemilik diaktifkan lagi di hari yang sama) pemeriksaan berikutnya mengirim.
  - Isi dan tautan: surel dikirim dengan `to` = alamat pengirim dan `bcc` = penerima (penerima tak muncul di `to`); baris `dashboard_shares` ber-`report_id` dengan rentang tetap = `periodRange` laporan dan `expires_at` = sekarang + `link_days`; `ctaUrl` di HTML lolos `verifyShareToken`; membuka tautan itu lewat `loadPublicDashboard` menampilkan cakupan dan periode yang sama dengan surel; delta ada di surel tetapi tidak di DTO publik.
  - **Review Focus 4:** `sendTest`/`preview` oleh pemegang `manage` non-pemilik → `FORBIDDEN`; oleh super admin berhasil; `sendTest` hanya ke surel pemilik, ke-6 dalam sejam ditolak; `preview` tak membuat baris tautan.
  - `sweepReportShares`: baris terbitan kedaluwarsa > 30 hari terhapus, 29 hari tidak, tautan biasa (`report_id=''`) tak tersentuh.
  - `loop.test.ts`: `startDashboardReportLoop(env, { intervalMs: 20 })` mengirim laporan yang jatuh tempo dan penghentinya menunggu putaran berjalan (pola `flush.test.ts`).
  - `body.test.ts`: `dashboardReports.sendTest` tak butuh badan besar (masuk tabel).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/dashboard/report` → FAIL. **Step 3: Implementasi.** **Step 4: Jalankan** `bun run api:snapshot`, tes `src/modules/dashboard`, `bun run --cwd server test src/jobs`, `bun run typecheck` → PASS; `src/core/soft-delete-guard.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): pengiriman laporan terjadwal, loop, dan kirim uji`.

---

### Task 6: Halaman kelola laporan di web

**Files:**
- Create: `web/src/modules/dashboard/report/{queries.ts}`, `web/src/modules/dashboard/report/components/{reports-page,report-form,report-form-page,report-view,report-preview,schedule-fields}.tsx`, `web/src/routes/_app/dashboard/laporan/{index,new}.tsx`, `web/src/routes/_app/dashboard/laporan/$reportId/{index,edit}.tsx`
- Modify: `web/src/app/navigation.ts` (butir Dashboard menjadi grup: **Ringkasan** `/dashboard` (izin widget mana pun) dan **Laporan terjadwal** `/dashboard/laporan` (`dashboard: manage`); `excludes` agar menu menyala benar), tes navigasi yang menghitung butir
- Test: `web/src/modules/dashboard/report/components/*.test.tsx`

**Interfaces:**
- Consumes: `ScopeEditor` (Rencana 2 Tugas 7), kontrak Tugas 3 dan 5.
- Produces:
  - `reportsQueryOptions()`, `reportQueryOptions(id)`, `useSaveReport()`, `useSetReportEnabled()`, `useRemoveReport()`, `useSendTestReport()`, `reportPreviewQueryOptions(id)` di `queries.ts` (tak masuk `query-persist`).
  - `ReportsPage` (`ListPage` + `DataTable`): kolom nama (`LinkCell` ke View), jadwal (`scheduleLabel`), periode, jumlah penerima, status terakhir (`Badge` dengan teks), berikutnya; aksi baris Ubah / Jeda-Lanjutkan / Kirim uji / Hapus hanya bila `canEdit`; aksi massal Jeda dan Lanjutkan lewat `useBulkAction` (memanggil `setEnabled` satu per satu, maks. 20 laporan); `Alert` peringatan "SMTP belum diatur" bila `!smtpConfigured`; tombol "Buat laporan" disembunyikan di batas 20 (dengan keterangan).
  - `ReportForm`/`ReportFormPage` (`FormPage` bertab): **Dasar** (nama, jadwal lewat `ScheduleFields`, periode `Select`), **Isi** (`ScopeEditor`), **Penerima** (daftar alamat, tambah/hapus; peringatan "Isi laporan dihitung dari hak Anda dan terkirim ke semua alamat ini, termasuk di luar perusahaan"), **Tautan** (`link_days` 7/14/30/90, bawaan 14). `AlertDialog` konfirmasi saat menyimpan perubahan penerima atau widget.
  - `ReportView` (`ViewPage`): ringkasan konfigurasi, panel "Pratinjau surel" (`iframe` dengan `sandbox=""` dan `srcdoc`, hanya bila `canEdit`), daftar tautan terbitan (hanya bila `canEdit`), `ActivityLog kind="dashboardReport"`; aksi header menurut bobot (Ubah, Kirim uji primary; Jeda/Lanjutkan, Hapus di menu "Aksi lainnya").
  - Rute memakai `staticData` `crumb` untuk `new`, `edit`, `$reportId`; navigasi lewat `useStackNavigation`.

- [ ] **Step 1: Tulis tes yang gagal**
  - Daftar: non-pemilik tak melihat aksi Ubah/Jeda/Kirim uji/Hapus; peringatan SMTP muncul bila `smtpConfigured=false`; status ditampilkan dengan teks; aksi massal Jeda memanggil `setEnabled` per id; di batas 20 tombol Buat dinonaktifkan dengan alasan.
  - Form: validasi inline (nama, penerima kosong, alamat tak sah, > 12 widget, > 20 penerima); peringatan penerima eksternal tampil; menyimpan dengan perubahan penerima/widget menampilkan konfirmasi dulu; `ScopeEditor` hanya menawarkan widget yang diizinkan; payload `save` membawa `filter` dan `offers` dari editor dan `expectedUpdatedAt` saat mengubah.
  - View: `iframe` pratinjau memakai `sandbox=""` tanpa token apa pun; pratinjau dan tautan terbitan tidak dirender bagi non-pemilik; log aktivitas terpasang.
  - Navigasi: grup Dashboard memuat "Laporan terjadwal" hanya bagi `dashboard: manage`; butir menyala benar pada `/dashboard/laporan/...`.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/dashboard/report src/app/navigation.test.ts` → FAIL. **Step 3: Implementasi** (jangan menulis `routeTree.gen.ts` tangan). **Step 4: Jalankan** `bun run --cwd web test`, `bun run --cwd web typecheck`, `bun run scripts/test-scripts.ts` (`page-frame`, `route-meta-coverage`, `mobile-navigation-guard`, `no-native-select`) → PASS.
- [ ] **Step 5: Commit** `feat(dashboard): halaman kelola laporan terjadwal`.

---

### Task 7: Dokumentasi, daftar periksa surel, dan verifikasi akhir

**Files:**
- Create: `docs/dashboard-email-checklist.md` (daftar periksa manual: Gmail web dan aplikasi, Outlook desktop, Apple Mail termasuk mode gelap; surel tak terpotong, tombol terlihat dan dapat diklik, tautan membuka dashboard publik dengan periode yang sama, teks polos terbaca, kirim uji sampai ke pemilik)
- Modify: `server/changelog.d/20261123-dashboard.md` (tambah `feat(dashboard): laporan terjadwal lewat surel dengan banyak laporan dan tautan dashboard lengkap`), `CLAUDE.md` (bagian Dashboard: model laporan, loop 5 menit, klaim CAS, tautan terbitan, hak pemilik, `core/mail.ts` `html`/`bcc`, modul `report/`), `docs/superpowers/specs/2026-11-23-dashboard-design.md` (bagian 7.1 dan 7a.1: nama migrasi menjadi `0032_dashboard.sql` untuk `dashboard_shares` dan `0033_dashboard_reports.sql` untuk laporan)

- [ ] **Step 1:** Perbarui dokumen. **Step 2: Verifikasi penuh**: `bun run check` (tunnel hidup) hijau; `bun run build` hijau.
- [ ] **Step 3: Verifikasi manual**: dengan SMTP uji (atau penangkap surel lokal) buat laporan harian, jalankan "Kirim uji", periksa surel mengikuti `docs/dashboard-email-checklist.md`, klik tombol dan pastikan dashboard publik menampilkan periode dan cakupan yang sama; jeda/lanjutkan; hapus laporan lalu pastikan tautan lama tak berlaku.
- [ ] **Step 4: Commit** `docs(dashboard): catat laporan terjadwal dan daftar periksa surel`.
