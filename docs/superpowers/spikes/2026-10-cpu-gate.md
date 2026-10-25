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

## Run 3 (2026-10-26, staging di akun terpisah, setelah optimasi + board 3 task + pull detail 50)

Worker `app-staging` di akun staging baru (`https://app-staging.qc-worker.workers.dev`, versi `77c35e2a`), data proyeksi 2 tahun, 100 sampel per rute, semua rute (baca dan tulis). Kriteria: p95 ≤ 8 ms (keputusan pemilik).

| Kelompok | p50 | p95 | p99 | maks | Hasil p95 ≤ 8 |
|---|---|---|---|---|---|
| `/api/ping` (tanpa kerja) | 0 | 1 | 1 | 3 | lulus |
| Rute baca ringan (`auth.me`, `boot`, `items.list`, `*.list`, `get`, `options`, audit, qrcodes) | 1–3 | 4–11 | 9–17 | 10–24 | 12 dari 26 lulus; sisanya p95 9–11 |
| `handovers.board:*` (3 task/halaman) | 2–3 | 6–13 | 13–18 | 14–19 | 1 dari 4 lulus (p95 11–13 untuk Baru, Dikerjakan, Selesai) |
| Tulis ringan (`setCheck`, `setDone`, `cancel`, `reopen`, `comment`, `items.setStatus`, `users.save`) | 2–3 | 9–13 | 11–16 | 15–22 | tidak (p95 9–13) |
| `items.save`, `handovers.save:*` | 4–5 | 14–15 | 16–17 | 17–19 | tidak |
| `brands.save` ganti nama ±50 item | 5 | 13 | 15 | 17 | tidak |
| `sync.items.pull:50+detail` | 4 | 11 | 14 | 15 | tidak |
| `sync.items.pull:500` | 9 | 20 | 24 | 25 | tidak |
| `sync.brands.pull:500`, `sync.ping` | 1 | 5–7 | 6–9 | 8–12 | lulus |
| `handovers.saveBatch:30x5000` | **16** | **34** | 42 | 45 | **tidak, jauh** |
| `sync.items.push:25+detail` | **59** | **100** | 118 | 118 | **tidak, jauh** (1 dari 100 sampel tak terukur) |

Pembacaan:
1. **p50 hampir semua rute 1–5 ms**; yang jauh di atas hanya `saveBatch` (p50 16), `sync.items.pull:500` (p50 9), dan `sync.items.push` (p50 59). Dibanding Run 1 (board p50 10–19, saveBatch 61, push 140): board turun ±6×, saveBatch ±4×, push ±2,4×.
2. **p95 rute ringan 9–11 ms walau p50 1–3 ms.** Rute tanpa kerja p95 1 ms pada run ini, jadi lonjakan p95 bukan lantai derau isolate saja: kemungkinan penyebabnya biaya sisa per round trip D1 dan permulaan isolate dingin. Kriteria p95 ≤ 8 ms hanya lulus untuk sebagian rute; keputusan pemilik diperlukan (lihat laporan sesi).
3. Spike CPU (`2026-10-cpu-limits.md`) menunjukkan batas 10 ms tidak ditegakkan keras (kegagalan `exceededCpu` baru muncul pada beban ≥ ±100 ms), jadi risiko galat 1102 pada p95 9–15 ms rendah, tetapi tidak dijamin dokumentasi.
4. Kuota tulis D1 dipakai ±22 rb baris pada run tulis (anggaran 40 rb).
