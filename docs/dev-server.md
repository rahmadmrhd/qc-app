# Pengembangan lokal server (Bun + MariaDB dev lewat terowongan)

Backend berjalan di komputer sendiri (server Bun/Hono, :8788) dan memakai MariaDB dev di VPS lewat terowongan SSH. Tidak ada Docker di mesin lokal. Frontend dev (Vite, :3000) memakai server ini lewat proxy `/api`, `/auth`, `/sync`.

## Cepat mulai

```bash
# 1. sekali: salin konfigurasi dan isi DATABASE_URL (kata sandi qc_dev ada di /opt/qc/dev/.env di VPS, kunci QC_DB_PASSWORD)
cp server/.env.example server/.env

# 2. di terminal terpisah (biarkan terbuka): terowongan SSH ke MariaDB dev (127.0.0.1:33063)
bun run db:tunnel

# 3. sekali: migrasi + data contoh ke skema qc_dev
bun run db:seed

# 4. server (:8788) dan Vite (:3000) bersamaan
bun run dev
```

Buka `http://localhost:3000`, pada halaman login tekan **Masuk sebagai pengguna dev** (`/auth/dev-login` lewat proxy menerbitkan cookie sesi untuk `DEV_LOGIN_EMAIL` di origin :3000). `bun run dev` memeriksa terowongan lebih dulu dan memberi petunjuk bila belum jalan. Dua terminal terpisah: `bun run dev:server` dan `bun run dev:web`. Port server lain: set `SERVER_DEV_URL` untuk Vite dan `PORT` di `server/.env`.

## Konfigurasi (`server/.env`)

Berkas ini tidak masuk git; `server/.env.example` adalah contoh tanpa rahasia. Variabel wajib: `DATABASE_URL`, `SESSION_SECRET`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SYNC_API_TOKEN`, `BRIDGE_URL`, `BRIDGE_SECRET`, `ADMIN_EMAIL`. Opsional: `APP_ORIGIN` (wajib https di produksi), `DEV_LOGIN_EMAIL` (hanya dev), `PORT` (8788), `HOST` (127.0.0.1), `TRUSTED_PROXY` (`loopback`), `DB_POOL_SIZE` (8), `STATIC_DIR` (`server/dist`). Server menolak jalan dan menyebut SEMUA variabel yang hilang/tidak valid (tanpa mencetak nilainya).

## Yang dilakukan tiap skrip

- `bun run dev:server` (`server/src/main.ts` dengan `--watch`): memuat konfigurasi, memeriksa MariaDB (gagal cepat dengan petunjuk terowongan), menjalankan Hono + runner job + penjadwal. `SIGINT`/`SIGTERM` menutup server, runner, lalu pool koneksi.
- `bun run db:seed` (`server/scripts/seed-dev.ts`): menerapkan migrasi lalu mengosongkan dan mengisi data contoh dalam satu transaksi: pengguna admin (`DEV_LOGIN_EMAIL`) + `wh@dev.test` + `qc@dev.test`, 3 peran, 2 lokasi (Jakarta, Bandung), 3 merk, 10 item, 3 customer, 6 task serah terima (Baru, Dikerjakan, Selesai, Dibatalkan, dengan centang dan komentar). Aman dijalankan ulang. **Skrip menolak skema selain `qc_dev`** dan semua argumen selain `--email=<email>`.
- `bun run dev` (`scripts/dev.ts`): pemeriksaan di atas lalu `dev:server` + `dev:web`.

## Login pengembangan

`GET /auth/dev-login` aktif **hanya bila** `DEV_LOGIN_EMAIL` terisi, host permintaan `localhost`/`127.0.0.1`, **dan** peer TCP-nya loopback tanpa header `CF-Connecting-IP` (bukan lewat reverse proxy); selain itu 404. `loadConfig` menolak start bila `DEV_LOGIN_EMAIL` terisi dengan `NODE_ENV=production` atau `APP_ORIGIN` bukan `http://localhost`/`http://127.0.0.1`. Jangan isi variabel ini di produksi. Email harus terdaftar dan aktif (atau sama dengan `ADMIN_EMAIL`). Atribut `Secure` cookie dan origin redirect OAuth diturunkan dari `APP_ORIGIN` (bukan header Host): tanpa `Secure` hanya bila `APP_ORIGIN` adalah `http://localhost`/`http://127.0.0.1`; selain itu `Secure`. `APP_ORIGIN` wajib https saat `NODE_ENV=production`.

## Tes

`bun run test` (di `server/` atau dari root lewat `bun run check`) membagi berkas tes ke 3 proses (bawaan; 4 menimbulkan timeout acak lewat tunnel) `bun test` paralel (`QC_TEST_SHARDS`, maks. 4); tiap proses memakai SATU skema `qc_test_<waktu>_<acak>` sementara (dikloning dari templat `qc_test_template`, dipakai semua berkas di proses itu, dihapus saat proses selesai). Butuh terowongan hidup dan `server/.env.test` (`QC_TEST_DB_URL`, lihat `.env.test.example`); tanpa itu, atau bila tunnel setengah-terbuka (TCP terbuka tetapi `SELECT 1` tak dijawab dalam 5 dtk), runner berhenti dengan pesan `bun run db:tunnel`. Hak pengguna `qc_dev`/`qc_test` (hanya atas skema `qc_dev` dan pola `qc_test_%`) terekam di `deploy/mariadb/grants-dev.sql`. Satu berkas/folder: `bun run test src/modules/sync`. Pengukuran 2026-11-05 (3 proses, 48 berkas server, 716 tes): ±7-8 menit per putaran. Dari empat putaran `bun run check` berturut-turut: satu hijau penuh; dua gagal karena SSH ke VPS direset peer di tengah putaran (`ssh keluar (kode 255)` pada keluaran `db:tunnel`, tunnel membuka ulang dalam 2 dtk tetapi koneksi tes yang sedang berjalan putus: `ECONNREFUSED`/`Connection lost`); satu gagal pada asersi latensi `createTestEnv <= 400 ms` (713 ms) yang lulus bila berkas itu dijalankan sendiri. Jadi penyebab dominan kegagalan acak adalah putusnya tunnel, bukan jumlah proses; mengurangi proses memperpanjang putaran tanpa mengurangi paparan. Putaran yang gagal karena tunnel: jalankan ulang berkas yang gagal sendiri (`bun run test <berkas>`). `QC_TEST_SHARDS` tetap menimpa. Semua keluaran proses yang lulus diringkas; proses yang gagal dicetak penuh (`QC_TEST_VERBOSE=1` mencetak semua).

## Batasan

- Jembatan Google (`BRIDGE_URL`) tidak tersedia secara lokal: unggah berkas, ekspor, dan fitur QR yang memakai Drive akan gagal dengan `UNAVAILABLE`.
- `http://localhost:8788` melayani build web dari `server/dist` (jalankan `bun run build`); untuk pengembangan UI pakai `http://localhost:3000` (Vite, hot reload).
- Uji API tanpa UI: `curl -b cookie -H "X-Requested-With: qc" http://localhost:8788/api/v1/me` (kabel web = REST `/api/v1`; daftar lengkap rute: `GET /api/openapi.json`, butuh sesi).
