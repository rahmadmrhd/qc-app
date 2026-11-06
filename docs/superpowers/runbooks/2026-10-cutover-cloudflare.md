# Runbook cutover: Apps Script + Sheets → Cloudflare Worker + D1

| | |
|---|---|
| **Rencana** | `docs/superpowers/plans/2026-10-25-migrasi-cloudflare-worker-d1.md` Task 5.3 dan 6.1 |
| **Spek** | `docs/superpowers/specs/2026-10-25-migrasi-cloudflare-worker-d1-design.md` §13 Fase 5–7 |
| **Status** | Draf. Belum pernah dijalankan; gladi (Fase 0 di bawah) wajib mulus dua kali berturut-turut sebelum hari-H |
| **Lingkungan** | Staging: akun Cloudflare `0c513cf2ea5fc5f24a06c6725e224400`, Worker `app-staging`, D1 `qc-app-staging`. Produksi: akun "QC" `2256d27ce4dcdcb9ade777cc2650fd81`, Worker `app` (`https://app.qc-225.workers.dev`), D1 `qc-app-production` |

Tanda: **[pemilik]** hanya bisa dikerjakan pemilik (rahasia, pengaturan akun, persetujuan Google, koordinasi orang lain). **[agen]** boleh dikerjakan agen atas permintaan pemilik. **[bersama]** agen menjalankan, pemilik mengamati dan memutuskan.

Aturan umum: jangan menempel rahasia ke obrolan atau repo; catat waktu mulai dan selesai tiap langkah di tabel catatan paling bawah; bila ada langkah gagal sebelum langkah 5 (pengguna dialihkan), jalan mundur = tidak ada yang berubah bagi pengguna.

---

## Fase 0 — Gladi di staging (ulangi sampai mulus dua kali berturut-turut)

Tujuan: membuktikan impor, verifikasi, dan E2E dengan salinan data nyata, serta mengukur waktu tempuh.

Prasyarat gladi:
1. **[pemilik]** Jembatan staging diotorisasi dan `BRIDGE_SECRET`, `ALLOWED_FOLDER_IDS`, `SPREADSHEET_ID` diisi (`docs/setup-bridge.md` §6, langkah pemilik 1–3). Uji: `bun run scripts/bridge-smoke.ts brands` mencetak jumlah baris. Status terakhir diperiksa 2026-10-26: HTTP 403 (belum diotorisasi).
2. **[pemilik]** `BRIDGE_URL` dan `BRIDGE_SECRET` dipasang di Worker staging: `cd worker && bunx wrangler secret put BRIDGE_SECRET --env staging`, lalu `BRIDGE_URL`.
3. **[pemilik]** Redirect OAuth `https://app-staging.qc-worker.workers.dev/auth/callback` didaftarkan di Google Cloud Console, serta `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `ADMIN_EMAIL`, `APP_ORIGIN` dipasang sebagai secret/variabel Worker staging.
4. Kuota harian: D1 gratis 5 juta baris dibaca dan 100 ribu baris ditulis per **akun**; impor + E2E di staging memakai akun staging, jadi aman bagi produksi.

Langkah gladi:

| # | Langkah | Perintah / cara | Pelaksana |
|---|---|---|---|
| G1 | Ambil dump Sheets produksi (hanya baca) | Panggil `sheets.dump` lewat jembatan, simpan `data` ke `dump.json` (di luar repo) | agen (setelah prasyarat 1) |
| G2 | Kosongkan data staging, terapkan migrasi | `cd worker && bunx wrangler d1 migrations apply DB --env staging --remote` | agen |
| G3 | Hasilkan SQL impor dengan validasi | `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json --reset` | agen |
| G4 | Bila kode keluar 1: baca `report.json`, perbaiki di Sheets atau tulis `excludes.json`, ulangi dari G1 | `docs/setup-bridge.md` §5 langkah 2 | pemilik memutuskan |
| G5 | Terapkan ke D1 staging | `cd worker && bunx wrangler d1 execute DB --env staging --remote --file ../import.sql` | agen |
| G6 | Verifikasi | `bun run scripts/migrate/verify-import.ts --dump dump.json --d1 qc-app-staging --remote [--exclude excludes.json]` (kode keluar 0 = lulus) | agen |
| G7 | Jalankan `docs/e2e-checklist.md` penuh di `https://app-staging.qc-worker.workers.dev` terhadap data nyata | manual | pemilik |
| G8 | Uji sinkron Desktop ke staging dengan token uji | `POST https://app-staging.qc-worker.workers.dev/sync` (kontrak `docs/api/desktop-sync.md`) | pemilik/pemelihara Desktop |
| G9 | Catat waktu tiap langkah dan temuan di `docs/superpowers/spikes/2026-10-gladi-migrasi.md`; ulangi sampai dua kali mulus | | agen |

Syarat lulus gladi: `verify-import` lulus; E2E hijau; CPU gate (`docs/superpowers/spikes/2026-10-cpu-gate.md`) memenuhi kriteria p95 ≤ 8 ms atau pemilik menerima pengecualiannya secara tertulis.

---

## T-7 hari — syarat siap (semua harus ya)

- [ ] Gerbang CPU (Task 4.5) selesai di staging dan keputusannya dicatat.
- [ ] Gladi (di atas) mulus dua kali berturut-turut.
- [ ] Bendera `READ_ONLY` sudah ter-deploy ke aplikasi lama (`/exec`) lewat alur CI normal (Task 5.4); diuji: dengan `READ_ONLY=1` RPC tulis ditolak `UNAVAILABLE`, baca tetap jalan (`docs/setup-google.md` §7e).
- [ ] **[pemilik]** Pemelihara QC Desktop sudah dihubungi, tahu URL baru (`https://app.qc-225.workers.dev/sync`), dan siap mengganti URL pada hari-H (§15 nomor 3 spek).
- [ ] **[pemilik]** Redirect OAuth `https://app.qc-225.workers.dev/auth/callback` terdaftar di Google Cloud Console; secret produksi terpasang (`SESSION_SECRET`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SYNC_API_TOKEN`, `BRIDGE_URL`, `BRIDGE_SECRET`, `ADMIN_EMAIL`, `APP_ORIGIN`) dengan `wrangler secret put --env` tanpa `--env staging`, di akun QC.
- [ ] **[pemilik]** Jembatan **produksi** (deployment terpisah dari staging, versi dari `main`) diotorisasi dan diuji `bridge-smoke`.
- [ ] Worker produksi ter-deploy (merge ke `main` memicu `deploy-worker.yml`) dengan D1 produksi **kosong namun termigrasi** (`wrangler d1 migrations apply DB --remote` pada akun QC); `GET https://app.qc-225.workers.dev/api/ping` menjawab `{"ok":true}`.
- [ ] R2 (cache berkas, opsional): bila ingin dipakai, **[pemilik]** aktifkan R2 di dashboard, buat bucket, buka komentar blok `r2_buckets` di `worker/wrangler.jsonc` (lihat komentar di berkas). Tanpa R2 perilaku tetap benar.
- [ ] Jendela pemeliharaan diumumkan ke pengguna (tanggal, jam, lama perkiraan dari catatan gladi).
- [ ] Rencana jalan mundur dibaca bersama (bagian bawah).

---

## Hari-H

| # | Langkah | Detail | Pelaksana |
|---|---|---|---|
| 1 | Umumkan jendela dimulai; minta QC Desktop **berhenti sinkron** | | pemilik |
| 2 | Bekukan aplikasi lama | Set Script Property `READ_ONLY=1` di proyek Apps Script aplikasi lama; tunggu RPC tulis terakhir selesai (±1 menit); uji satu tulis ditolak | pemilik |
| 3 | Dump final dan impor ke D1 **produksi** | `sheets.dump` (jembatan produksi) → `import-sheets.ts` **tanpa `--reset`** (D1 produksi harus kosong) → `wrangler d1 execute DB --remote --file import.sql` (akun QC) → `verify-import.ts --d1 qc-app-production --remote`. **Verifikasi HARUS lulus.** | bersama |
| 3b | Bila verifikasi gagal | Kosongkan properti `READ_ONLY`, batalkan, analisis. Pengguna tidak terdampak (aplikasi lama utuh). Jangan lanjut | pemilik |
| 4 | Smoke test produksi | Login Google, daftar item dan board, buat task + centang + Selesai, unggah gambar item, ekspor QR (job `done`), `/sync` dengan token Desktop uji | pemilik |
| 5 | Alihkan pengguna | Umumkan URL `https://app.qc-225.workers.dev`; ganti URL QC Desktop ke `…/sync` dan nyalakan sinkron; pantau 1 jam: galat 1102/429, CPU, kuota D1, antrean (`wrangler tail app`, dashboard Workers) | pemilik + agen |
| 6 | Aplikasi lama dan Sheets dibiarkan **utuh dan baca-saja** | Catat waktu mulai–selesai di tabel bawah | pemilik |

Kuota hari-H: impor ke D1 produksi menulis ±sebesar jumlah baris data (+ indeks). Pastikan perkiraan baris tertulis (cek `report.json`) jauh di bawah 100.000 baris/hari; bila mendekati, pecah impor per tabel lintas hari atau pertimbangkan paket berbayar sementara.

---

## Jalan mundur

- **Sebelum ada tulis penting baru di D1 produksi** (langkah 1–5): kosongkan properti `READ_ONLY` di aplikasi lama, kembalikan URL QC Desktop ke `/exec` lama, umumkan URL lama. Data baru di D1 diabaikan.
- **Setelah ada tulis penting baru di D1:** ekspor D1 ke Spreadsheet (RPC `exports.sheets`, administrator; hasil di sheet `export_*`) lalu **pemilik memutuskan manual** data mana yang dipakai. Hindari kondisi ini dengan smoke test ketat dan pemantauan awal. Time Travel D1 (`wrangler d1 time-travel restore`) dapat mengembalikan D1 produksi ke bookmark sebelum cutover bila data D1 yang salah.

## Setelah cutover (Fase 7)

1. Pantau 2–4 minggu: galat 1102/429, kuota D1 (baris dibaca/ditulis), operasi Queues; ekspor terjadwal ke Sheets berjalan. Catat di `docs/superpowers/spikes/2026-11-stabilisasi.md`.
2. Setelah stabil dan tanpa kebutuhan jalan mundur: bersihkan kode `gas/` dan pendukungnya sesuai rencana Task 7.2 (keputusan pemilik: hapus tanpa persetujuan terpisah; `bridge/` dan skrip migrasi dipertahankan), perbarui `CLAUDE.md`, `docs/ci-cd.md`, `docs/setup-google.md`, `docs/api/desktop-sync.md` (URL), `docs/adding-a-module.md`, PRD NFR.

## Catatan waktu (diisi saat gladi dan hari-H)

| Langkah | Gladi 1 | Gladi 2 | Hari-H |
|---|---|---|---|
| Dump Sheets | | | |
| Hasilkan SQL | | | |
| Impor D1 | | | |
| Verifikasi | | | |
| Smoke test | | | |
| Total jendela tulis beku | | | |
