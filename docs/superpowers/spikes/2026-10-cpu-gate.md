# Gerbang CPU staging (Task 4.5) — catatan hasil

Skrip: `worker/scripts/load-cpu.ts` (`seed | run [--only=<awalan>] | cleanup`), `cpuTime` dari `wrangler tail`, kriteria p99 ≤ 8 ms per rute dengan ≥ 100 sampel. Worker `app-staging`, colo SIN, paket gratis, data proyeksi 2 tahun (±2.000 item, 2.100 task, 12.000 audit).

## Run 1 (2026-10-25 pagi, sebelum optimasi, 30–60 sampel)

Gagal hampir semua rute; yang konsisten di atas 8 ms (p50 / maks): `sync.items.push` 25 item 140/247, `handovers.saveBatch` 30×5.000 61/162, `handovers.board` 10–19/25–46, `sync.items.pull` 12–15/25–28, `brands.save` ganti nama 15/31, `items.save` 9/21. `wrangler d1 insights` menunjukkan pemindaian seluruh tabel item (cek alias `instr`, hitung item per merk) sebagai pemakan kuota baris-dibaca terbesar.

## Optimasi (commit `1898e72`, `b362cc7`, `8721250`, `56477bc`)

Tabel `item_alias_keys` dan kolom `brands.item_count` (migrasi 0009), cache isolate ≤ 10 dtk (akses, lokasi, merk, customer), round trip D1 berkurang, kanonisasi checklist O(n), cache isi berkas di R2 (opsional, R2 belum aktif). Galat kuota D1 kini `UNAVAILABLE` dengan pesan jelas (RPC) dan tetap `INTERNAL` di `/sync`.

## Run 2 (2026-10-25 sore, rute baca saja, 100 sampel, setelah deploy `beaa69af`)

| Rute | p50 | p99 | maks |
|---|---|---|---|
| `GET /api/ping` (tanpa kerja) | 0 | 10 | 10 |
| `auth.me`, `GET /api/boot` | 2 | 11–15 | 14–15 |
| `items.list`, `items.get`, `brands.list`, `customers.list` | 2–3 | 13–18 | 14–25 |
| `access.*.list`, `access.audit.list*` | 2–3 | 9–24 | 12–26 |
| `handovers.get`, `handovers.options`, `qrcodes.*` | 2–3 | 13–17 | 14–20 |
| `handovers.board` new / in_progress / done / cancelled | 19 / 13 / 14 / 10 | 55 / 29 / 46 / 35 | 63 / 34 / 46 / 40 |
| `sync.items.pull:200+detail` | 13 | 40 | 68 |
| `sync.items.pull:500`, `sync.brands.pull:500` | 2 | 7 | 13 |

Temuan:
1. **Lantai derau p99.** Rute tanpa kerja (`/api/ping`) sudah p99 10 ms; rute baca ringan p50 2–3 ms tetapi p99 9–24 ms karena lonjakan isolate. Dengan kriteria p99 ≤ 8 ms, rute yang secara praktis aman tetap gagal. Kriteria perlu diputuskan ulang oleh pemilik.
2. **`handovers.board` tetap mahal di edge** (p50 10–19 ms) walau proksi lokal turun; biaya utamanya membangun dan menyerialkan `HandoverDto` penuh (catatan ≤ 5.000 karakter, centang, komentar) untuk 20 task per halaman.
3. **`sync.items.pull` dengan detail** p50 13 ms untuk 200 item.
4. **Kuota baris-dibaca D1 adalah per AKUN, bukan per database.** Run 1 + Run 2 menghabiskan 5 juta baris hari itu; panggilan terakhir gagal `D1_ERROR: Your account has exceeded D1's free tier daily row read limit` sampai 00:00 UTC (07:00 WIB). Setelah cutover, uji beban staging di akun yang sama akan menghentikan produksi.
5. Rute tulis belum diukur ulang (menunggu kuota; perkiraan satu run penuh ±67 rb baris ditulis, kuota 100 rb/hari).
