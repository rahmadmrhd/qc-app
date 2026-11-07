# QC App

Aplikasi web internal Quality Control. Frontend React + TanStack + shadcn/ui. Backend baru: server Bun + Hono + MariaDB (`server/`), dikembangkan lokal terhadap MariaDB dev di VPS lewat terowongan SSH. Production berjalan di VPS (`docs/deploy-vps.md`, `docs/ci-cd.md`). Aplikasi Google Apps Script + Google Sheets yang lama sudah dipensiunkan (T35); kodenya hanya ada di tag `gas-legacy`.

## Prasyarat
- [Bun](https://bun.sh) versi terbaru
- Git
- Akses SSH ke VPS lewat alias `rhd_vps_ipv4` (terowongan ke MariaDB dev/tes)

## Mulai
```bash
bun install
cp server/.env.example server/.env   # isi DATABASE_URL (kata sandi qc_dev: lihat docs/dev-server.md)
bun run db:tunnel                    # terminal terpisah, biarkan terbuka
bun run db:seed                      # sekali: migrasi + data contoh ke skema qc_dev
bun run dev                          # server :8788 + Vite :3000
```
Buka http://localhost:3000 dan tekan "Masuk sebagai pengguna dev". Tema terang/gelap dapat diganti dari tombol di header. Rincian: `docs/dev-server.md`.

## Perintah
| Perintah | Fungsi |
|---|---|
| `bun run dev` | server Bun (:8788) + Vite (:3000, proxy `/api /auth /sync`) |
| `bun run db:tunnel` | terowongan SSH ke MariaDB dev/tes di VPS |
| `bun run db:seed` | migrasi + data contoh ke skema `qc_dev` |
| `bun run check` | typecheck, lint, test (butuh tunnel; tes server dibagi ke 4 proses paralel) |
| `bun run build` | build web ke `server/dist` (dilayani server Bun) |

## Dokumentasi
- Pengembangan lokal server (tunnel, `.env`, seed, tes): `docs/dev-server.md`
- Membaca log server: `docs/observability.md`
- Menambah modul: `docs/adding-a-module.md`
- Setup Google Cloud (service account untuk Drive/Sheets): `docs/setup-google.md`
- Checklist uji manual: `docs/e2e-checklist.md`
- PRD: `docs/prd/`
