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

Berkas ini tidak masuk git; `server/.env.example` adalah contoh tanpa rahasia. Variabel wajib: `DATABASE_URL`, `SESSION_SECRET`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `SYNC_API_TOKEN`, `BRIDGE_URL`, `BRIDGE_SECRET`, `ADMIN_EMAIL`. Opsional: `APP_ORIGIN`, `DEV_LOGIN_EMAIL` (hanya dev), `PORT` (8788), `HOST` (127.0.0.1), `TRUSTED_PROXY` (`loopback`), `DB_POOL_SIZE` (8), `STATIC_DIR` (`server/dist`). Server menolak jalan dan menyebut SEMUA variabel yang hilang/tidak valid (tanpa mencetak nilainya).

## Yang dilakukan tiap skrip

- `bun run dev:server` (`server/src/main.ts` dengan `--watch`): memuat konfigurasi, memeriksa MariaDB (gagal cepat dengan petunjuk terowongan), menjalankan Hono + runner job + penjadwal. `SIGINT`/`SIGTERM` menutup server, runner, lalu pool koneksi.
- `bun run db:seed` (`server/scripts/seed-dev.ts`): menerapkan migrasi lalu mengosongkan dan mengisi data contoh dalam satu transaksi: pengguna admin (`DEV_LOGIN_EMAIL`) + `wh@dev.test` + `qc@dev.test`, 3 peran, 2 lokasi (Jakarta, Bandung), 3 merk, 10 item, 3 customer, 6 task serah terima (Baru, Dikerjakan, Selesai, Dibatalkan, dengan centang dan komentar). Aman dijalankan ulang. **Skrip menolak skema selain `qc_dev`** dan semua argumen selain `--email=<email>`.
- `bun run dev` (`scripts/dev.ts`): pemeriksaan di atas lalu `dev:server` + `dev:web`.

## Login pengembangan

`GET /auth/dev-login` aktif **hanya bila** `DEV_LOGIN_EMAIL` terisi **dan** host permintaan `localhost`/`127.0.0.1`; selain itu 404. Jangan isi variabel ini di produksi. Email harus terdaftar dan aktif (atau sama dengan `ADMIN_EMAIL`). Cookie sesi di `http://localhost` dikirim tanpa atribut `Secure`; di origin lain tetap `Secure`.

## Tes

`bun run test` (di `server/` atau dari root lewat `bun run check`) membagi berkas tes ke 4 proses `bun test` paralel (`QC_TEST_SHARDS`, maks. 4); tiap proses memakai skema `qc_test_<waktu>_<acak>` sementara yang dikloning dari templat `qc_test_template` dan dihapus setelah berkas selesai. Butuh terowongan hidup dan `server/.env.test` (`QC_TEST_DB_URL`, lihat `.env.test.example`); tanpa itu runner berhenti dengan pesan `bun run db:tunnel`. Satu berkas/folder: `bun run test src/modules/sync`. Semua keluaran proses yang lulus diringkas; proses yang gagal dicetak penuh (`QC_TEST_VERBOSE=1` mencetak semua).

## Batasan

- Jembatan Google (`BRIDGE_URL`) tidak tersedia secara lokal: unggah berkas, ekspor, dan fitur QR yang memakai Drive akan gagal dengan `UNAVAILABLE`.
- `http://localhost:8788` melayani build web dari `server/dist` (jalankan `bun run build`); untuk pengembangan UI pakai `http://localhost:3000` (Vite, hot reload).
- Uji API tanpa UI: `curl -b cookie -H "X-Requested-With: qc" -d '{"method":"auth.me","payload":null}' http://localhost:8788/api/rpc`.
