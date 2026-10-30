# Gerbang CPU staging (Task 4.5) — catatan hasil

Skrip: `worker/scripts/load-cpu.ts` (`seed | run [--only=<awalan>] | cleanup`), `cpuTime` dari `wrangler tail`, kriteria p95 ≤ 8 ms per rute; tiap rute dipanggil 100x dan lulus bila ≥ 90 panggilan terukur (keputusan pemilik 2026-10-30; semula ≥ 100 sampel; p95 dihitung dari yang terukur dan jumlah terukur dicetak). Worker `app-staging`, colo SIN, paket gratis, data proyeksi 2 tahun (±2.000 item, 2.100 task, 12.000 audit).

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

## Investigasi p95 rute ringan (2026-10-26, proksi lokal; edge belum diukur ulang)

- **Bundle Worker** (`wrangler deploy --dry-run --env staging`): 390,9 KB (tanpa minify, 672 panggilan `__name` dari `keep_names`) -> 374,1 KB setelah Hono memakai `hono/tiny`; dengan `--minify` 194,7 KB. Tidak ada SQL migrasi ter-embed (`core/migrate.ts` hanya dipakai tes). Terbesar: hono ±88 KB, qrcode 61, sync 61, handover 60, access 38, item 36, jobs 32, shared/qrcode 27.
- **Inisialisasi tingkat modul** hanya ±2 ms (pendaftaran rute Hono 0,65 ms, `__name` 0,64 ms); biaya mulai dingin didominasi kompilasi 390 KB JS (±11 ms di Node), bukan kode kita. Tidak ada inisialisasi mahal yang bisa ditunda. Impor dinamis tidak mengurangi kompilasi karena wrangler membundel semuanya jadi satu berkas.
- **Penyebab paling mungkin p95 9-13 ms pada rute ringan:** cache isolate (TTL 10 dtk) kedaluwarsa. Gerbang memanggil lewat `curl` per permintaan (±0,5-1 dtk per panggilan), sehingga ±5-10% panggilan jatuh pada miss konteks akses (batch 3 pernyataan) dan miss daftar lokasi (round trip kedua). Perbaikan: satu miss kini satu round trip (konteks akses mengisi cache lokasi), kunci HMAC sesi diimpor sekali per isolate.
- **Rekomendasi (di luar wewenang kode):** `keep_names = false` dan `minify = true` di `worker/wrangler.jsonc`.

## Run 4 (2026-10-26, staging akun terpisah, Worker di-minify, `hono/tiny`, satu sesi tail untuk semua rute)

Versi `443e26aa` (minify, observability aktif, saveBatch maks 10, push maks 5, board 3 task). 100 sampel per rute. **Run terpotong di rute tulis: kuota tulis D1 harian akun staging (100 rb baris) habis** (seed 57 rb + run 3 + run sebelumnya), jadi 743 panggilan tulis gagal dengan `UNAVAILABLE` (RPC, HTTP 503) atau `INTERNAL` dengan pesan kuota (`/sync`). Ini sekaligus bukti pemetaan galat kuota bekerja. Rute tulis yang gagal HARUS diulang setelah kuota reset (00:00 UTC = 07.00 WIB), dengan seed lebih kecil atau `--only=<awalan>` per kelompok.

Rute baca dan tulis yang terukur penuh (p95 ≤ 8 ms = lulus):

| Rute | p50 | p95 | p99 | maks | Hasil |
|---|---|---|---|---|---|
| `/api/ping` | 0 | 1 | 2 | 3 | lulus |
| `auth.me` | 1 | 5 | 11 | 13 | lulus |
| `items.list` (+`:cursor`, `:query`), `items.get`, `brands.list`, `customers.list` | 2–3 | 5–8 | 6–13 | 9–50 | lulus |
| `handovers.get`, `handovers.options` | 2 | 6–8 | 8–9 | 10–11 | lulus |
| `access.audit.list` (4 varian), `access.users.list`, `access.roles.list`, `access.locations.list` | 2 | 6–7 | 8–11 | 8–12 | lulus |
| `qrcodes.list`, `qrcodes.getDefaults`, `sync.ping`, `sync.brands.pull:500` | 1–2 | 4–8 | 5–10 | 5–14 | lulus |
| `handovers.board:done` | 4 | 8 | 11 | 12 | lulus (batas) |
| `items.setStatus`, `handovers.setCheck`, `handovers.setDone` | 2 | 7–8 | 9–12 | 10–12 | lulus |
| `GET /api/boot` | 1 | 10 | 12 | 14 | **gagal tipis** |
| `handovers.board:new` / `in_progress` / `cancelled` | 4 / 4 / 3 | 10 / 9 / 9 | 14 / 14 / 10 | 14 / 14 / 11 | **gagal tipis** |
| `sync.items.pull:50+detail` | 5 | 10 | 12 | 14 | **gagal tipis** |
| `access.users.save`, `handovers.comment:general` | 3–4 | 9 | 10 | 10–11 | **gagal tipis** |
| `items.save` | 6 | 17 | 18 | 21 | **gagal** |
| `sync.items.pull:500` | 10 | 20 | 26 | 27 | **gagal** |

Tidak terukur karena kuota (ulang setelah reset): `handovers.comment:anchored` (65 dari 100 terukur), `handovers.cancel`, `handovers.reopen`, `handovers.save:update`, `handovers.save:create`, `handovers.saveBatch:10x5000`, `sync.items.push:5+detail`, `brands.save` ganti nama.

Pembacaan:
1. **Rute baca kini hampir seluruhnya lulus p95 ≤ 8 ms** (dibanding run 3: p95 9–13). Minify (bundle 391 → 177 KB), cache lokasi satu round trip, dan kunci HMAC sesi sekali per isolate efektif. `GET /api/boot` dan board kolom Baru/Dikerjakan/Dibatalkan masih p95 9–10 (tipis di atas batas), `items.save` p95 17 dan `sync.items.pull:500` p95 20 masih jelas di atas.
2. Run ini TIDAK membuktikan lulusnya gerbang: rute tulis penting belum terukur. Gerbang dinyatakan belum selesai.
3. **Perkiraan baris tulis di skrip terlalu rendah** (heuristik 34.800 untuk satu run; kuota habis jauh sebelum itu bersama seed). Anggaran `--max-writes` harus diperkecil atau seed dikurangi (mis. tanpa 400 task Baru khusus tulis) bila run dilakukan di hari yang sama dengan seed.

## Optimasi sesudah run 4 (2026-10-26, proksi lokal; edge BELUM diukur ulang)

Pengukuran: `createTestEnv()` + `buildLoadSql()`, tiap rute lewat `app.request`, cache isolate hangat; "JS" = waktu dinding dikurangi waktu SQLite (SQLite lokal setara kerja D1, bukan CPU Worker). Pola di edge: pull 500 item lokal total 2,4 ms ≈ p50 10 ms edge (×3,5-4); rute dengan banyak round trip D1 (`items.save` lokal 0,3 ms, edge p50 6) lebih mahal daripada proksi lokal, jadi jumlah round trip dan pernyataan D1 diperlakukan sebagai biaya tersendiri.

| Rute | Round trip sebelum → sesudah | Total lokal p50 (ms) | JS lokal p50 (ms) |
|---|---|---|---|
| `sync.items.pull:500` | 3 → 2 (1 + autentikasi sinkron) | 2,40 → 0,81 | 1,32 → 0,07 |
| `sync.items.pull:50+detail` | 3 → 2 | 0,58 → 1,46 (SQLite lebih banyak kerja) | 0,36 → 0,10 |
| `items.save` | 3 → 2 (dan 4 → 2 bila ada gambar) | 0,31 → 0,16 | 0,24 → 0,10 |
| `handovers.board:*` | 2 → 1 | 0,29-0,57 → 0,21-0,52 | 0,15-0,33 → 0,06-0,14 |
| `GET /api/boot`, `auth.me` | 0 → 0 | 0,22 → 0,05 | 0,22 → 0,05 |
| `access.users.save` | 3 → 3 | 0,29 → 0,12 | 0,23 → 0,08 |
| `handovers.comment:general` | 2 → 2 | 0,20 → 0,10 | 0,15 → 0,06 |

Perubahan: (1) `sync.items.pull` membangun objek kabel di SQLite (`json_object`, join `brands`, `json_each` untuk gambar/stiker/kelengkapan) dan mengirim teks JSON apa adanya (`PreEncodedJson`): tanpa `toItem`/`paginateByRev`/pemetaan/serialisasi per baris dan tanpa kueri merk terpisah; (2) `items.save` membaca item, keunikan nama (dua kueri untuk semua kunci) dan berkas dalam satu `batch()`, membandingkan field sinkron tanpa `JSON.stringify`, menghitung hash detail audit sekali, `normalizeKey` jalur cepat ASCII; (3) `handovers.board` memasang komentar lewat subkueri pada kueri luar atas halaman ber-LIMIT dan menaruh COUNT di batch yang sama; (4) token sesi yang sudah terverifikasi disimpan per isolate (tanpa HMAC/decode/`JSON.parse` ulang) dan daftar lokasi `auth.me` dimemo per konteks akses. Kontrak RPC/sync, DTO, kode galat dan migrasi tidak berubah. Biaya: pull kini membaca baris `brands` per item lewat join (rows read halaman 500 item naik dari ±500 menjadi ±1.000-1.500; kuota 5 juta/hari).

## Run 5 (2026-10-26, setelah optimasi tahap 3: versi `1c2075fc`) — TIDAK SAH, kuota baca habis

Rute baca yang diubah (`/api/boot`, `auth.me`, board, `sync.items.pull`, `items.*`) diukur ulang segera setelah deploy, tetapi **hampir semua panggilan gagal `UNAVAILABLE` ("Kuota harian basis data habis")**: kuota BACA D1 akun staging sudah terlampaui (`wrangler d1 info`: 9,66 juta baris dibaca dan 159.784 baris ditulis dalam 24 jam; kuota 5 juta/100 rb per hari UTC, reset 00:00 UTC = 07.00 WIB). Angka CPU di run ini (p95 2–8 ms) berasal dari panggilan yang berhenti lebih awal sehingga **tidak boleh dipakai**.

Pelajaran:
1. **Satu run gerbang penuh menghabiskan jutaan baris dibaca**, bukan karena kode produksi, tetapi karena kasus uji yang memang memindai: `access.audit.list:query` (`instr(lower(target))` pada ±12.000 baris audit × 100 panggilan) dan `items.list:query` (`instr(key)`), ditambah halaman `sync.items.pull:500` (kini ±1.000–1.500 baris dibaca per halaman karena join merk). Beberapa run berurutan dalam sehari melewati 5 juta.
2. Rencana run berikutnya (setelah reset): satu run per hari paling banyak; kurangi sampel kasus yang memindai (atau jalankan terpisah dengan `--only=`), dan jangan seed ulang (seed menulis ±57 rb baris).
3. Pemakaian nyata 8–10 pengguna jauh lebih rendah (perkiraan 0,5–1,5 juta baris/hari), tetapi dua pencarian yang memindai di atas (kata kunci audit, kata kunci item) tetap candidat perbaikan jika dipakai sering (kolom kunci berindeks atau pencarian awalan; mengubah perilaku, perlu keputusan pemilik).

## Run 6 (2026-10-30, staging akun terpisah, kuota segar, versi `1c2075fc`, satu sesi tail, 42 rute)

Run penuh pertama yang sah untuk rute tulis. Kriteria p95 ≤ 8 ms. **35 dari 43 baris lulus.**

Lulus (p50 / p95 ms): `/api/ping` 0/2; `auth.me` 1/3; `items.list` (+`:cursor`, `:query`) 2/5–6; `items.get` 2/8; `customers.list` 1/7; `handovers.board:*` 1–2/5–7 (kolom Baru p95 7); `handovers.get`, `options` 1–2/4–5; `access.audit.list` (4 varian), `users/roles/locations.list` 1–2/4–5; `qrcodes.*` 2/4–5; `sync.ping`, `sync.items.pull:50+detail`, `sync.items.pull:500`, `sync.brands.pull:500` 1–2/3–6; `access.users.save` 2/7; `items.setStatus` 2/6; `handovers.setCheck`, `setDone`, `comment:general`, `comment:anchored`, `cancel`, `reopen` 2–3/5–8.

Belum lulus:

| Rute | p50 | p95 | p99 | maks | Catatan |
|---|---|---|---|---|---|
| `GET /api/boot` | 0 | 10 | 18 | 18 | 99 dari 100 sampel terukur |
| `items.save` | 3 | 11 | 14 | 16 | |
| `handovers.save:update` | 3 | 10 | 14 | 20 | |
| `handovers.save:create` | 5 | 11 | 13 | 13 | 99 sampel |
| `handovers.saveBatch:10x5000` | 8 | 18 | 34 | 34 | 93 sampel |
| `sync.items.push:5+detail` | 4 | 15 | 19 | 24 | |
| `brands.save` ganti nama ±50 item | 4 | 9 | 12 | 12 | |
| `brands.list` | 1 | 4 | 7 | 7 | lulus CPU; hanya 99 sampel terukur |

Pembacaan:
1. **Semua rute baca dan semua tulis ringan kini lulus.** Dibanding run 3/4 (p95 9–13 untuk rute ringan; board p50 10–19 di run 1): minify, cache, kueri satu round trip, dan JSON disusun SQLite efektif.
2. **Sisa kegagalan semuanya rute tulis berat**: `items.save`, `handovers.save`, `saveBatch`, `sync.items.push`, `brands.save` (p95 9–18). Penyebab: batch tulis 5–7 pernyataan (CAS, `sync_state`, UPDATE/INSERT, indeks, audit) yang tidak bisa dikurangi tanpa melemahkan atomisitas atau CAS. Kriteria "SAMPEL KURANG" pada tiga baris terjadi karena `wrangler tail` kehilangan 1–7 peristiwa dari 100, bukan karena CPU; angka CPU-nya tetap valid.
3. **Satu run penuh memakai ±4,06 juta baris dibaca (±81% kuota harian akun)**, terutama dari kasus yang memindai (kata kunci audit dan item, pull 500). Maksimal satu run penuh per hari per akun staging; pakai `--only=` untuk rute tertentu.
4. Tulis hari ini hanya ±14 rb baris (seed tidak diulang).

## Optimasi sesudah Run 6 (2026-10-30, proksi lokal; edge BELUM diukur ulang)

Persetujuan pemilik 2026-10-30: p95 tetap <= 8 ms untuk SEMUA rute (rute tulis tidak dilonggarkan); CAS boleh digabung ke `UPDATE`; batas `saveBatch` (turun hingga 5) dan push (turun hingga 2) hanya bila masih perlu; ambang gerbang >= 90 dari 100 terukur.

Pengukuran seperti bagian sebelumnya (`createTestEnv()`, `buildLoadSql()`, cache isolate hangat; "JS" = waktu dinding dikurangi waktu SQLite; median beberapa putaran, mesin berderau). Tabel: round trip / pernyataan D1 per permintaan, sebelum -> sesudah, dan proksi CPU lokal p50 (ms).

| Rute | Round trip | Pernyataan | Lokal total p50 (JS p50) | x3,5 (perkiraan edge) | Run 6 edge p50 / p95 |
|---|---|---|---|---|---|
| `items.save` | 2 -> 2 | 7 -> 5 | 0,47 -> 0,5 (0,4) | ~1,8 | 3 / 11 |
| `handovers.save:update` | 2 -> 2 | 5 -> 4 | 0,50 -> 0,35 (0,3) | ~1,3 | 3 / 10 |
| `handovers.save:create` | 2 -> 2 | 5 -> 4 | 0,61 -> 0,45 (0,4) | ~1,6 | 5 / 11 |
| `handovers.saveBatch` 10 task | 2 -> 2 | 23 -> 5 | 3,9 -> 3,1-4,5 (2,7-4,0) | ~13 | 8 / 18 |
| `handovers.saveBatch` 5 task (batas baru) | 2 | 4 | 1,7-2,5 (1,5-2,2) | ~6-9 | - |
| `sync.items.push` 5 entri | 14 -> 7 | 40 -> 19 | 1,9 -> 1,2-1,5 (0,7-0,9) | ~5 | 4 / 15 |
| `brands.save` ganti nama ~50 item | 4 -> 2 | 58 -> 11 | 2,7 -> 1,3-1,8 (0,4-0,6) | ~4,5 | 4 / 9 |
| `GET /api/boot` (cache hangat) | 0 | 0 | 0,05 | ~0,2 | 0 / 10 |
| Miss cache (dingin) `items.save` | 4 -> 3 | - | - | - | - |
| Miss cache (dingin) `GET /api/boot` | 1 -> 1 | 3 -> 1 | - | - | - |

Perubahan:
1. **CAS digabung ke `UPDATE`/`INSERT`** (`worker/src/core/cas.ts`): `updated_at`/`version` item dan task, penghitung nomor task (`INSERT ... ON CONFLICT DO UPDATE SET value = CASE ...`), dan guard batas komentar (di kolom `id`). Basi = `integer overflow` membatalkan seluruh `batch()`; kode galat, semantik konflik, penomoran, dan audit tidak berubah. Tes: `cas.test.ts` plus konkurensi baru (penghitung nomor dua penulis, simpan vs batal, komentar vs batal, ubah status vs simpan item, CAS basi membatalkan baris nama lain).
2. **Pernyataan per baris menjadi banyak-baris**: `saveBatch` memakai `INSERT` banyak-baris untuk task (5/pernyataan), customer baru (14), dan audit (16): 23 -> 5 pernyataan.
3. **Ganti nama merk** dua tahap di batch yang sama (review 2026-10-30): satu `UPDATE` memberi semua item merk kunci sementara unik (`char(1) || id`), lalu `UPDATE ... FROM json_each` per 500 item memasang kunci akhir dan revisi (`seq - (N-1-i)`), sehingga tabrakan SEMENTARA antar item merk yang sama tidak ditolak indeks unik `items.key`. Penjaga di batch yang sama (`integer overflow`, `saveBrand` mengulang hingga 3x): jumlah item merk = yang dibaca, dan tidak ada item merk yang masih berkunci sementara (item baru, pindah merk, atau tipe berubah di antara baca dan tulis); `UPDATE` tahap 2 juga mensyaratkan tipe sama dan `+items.brand_id` (tanpa indeks, agar planner mencari baris lewat PRIMARY KEY, bukan memindai `json_each` per item: O(N^2), 28 ms/200 item). Bentrok sungguhan dengan merk+tipe item merk lain (indeks unik) atau nama lain (penjaga alias) tetap CONFLICT dengan pesan yang sama; pemeriksaan bentrok pindah ke batch tulis (atomik) dan dua pembacaan awal digabung: 4 -> 2 round trip, 58 -> 11 pernyataan. Penyempurnaan review ke-2: kunci sementara memakai `rowid` (bukan `id`, yang bisa bertabrakan di bawah NOCASE), penjaga jumlah dikirim juga untuk merk tanpa item, tipe dibandingkan per byte (`hex(model)`) agar teks Unicode tak utuh tetap cocok, dan sebab kegagalan penjaga ditentukan dari pemeriksaan alias langsung (bukan perbandingan himpunan, yang rentan ABA); potongan 500 item membawa ±75 KB (ASCII) hingga ±550 KB (terburuk) per parameter JSON, di bawah batas 2 MB nilai D1; pernyataan dan CPU proksi tidak berubah (11 pernyataan, 2 round trip, 1,2-1,4 ms lokal). Baris ditulis D1 per ganti nama naik ±2x (tiap item ditulis dua kali; kasus gerbang menaikkan perkiraannya). Sintaks `UPDATE ... FROM json_each`, `RETURNING`, dan CAS-overflow diverifikasi di SQLite workerd lokal (`wrangler d1 execute --local`).
4. **Push sinkron**: pembacaan keunikan nama dilewati bila merk+tipe dan nama lain item tidak berubah (kasus umum), merk dimuat dalam batch prefetch yang sama, probe Drive dilewati tanpa id Drive, revisi dibaca lewat `RETURNING sync_rev`: 14 -> 7 round trip. `items.save`: dua kueri keunikan jadi satu `UNION ALL`.
5. **Miss cache**: konteks akses (users/roles/locations) satu pernyataan (`UNION ALL`); cache `brands`/`customers` yang dibaca rute dimuat bersama konteks lewat `RouteDef.warm` (satu miss, bukan 2-3 round trip berurutan). TTL tidak berubah (10 dtk).
6. `hot-path.test.ts` kini juga menjaga jumlah pernyataan per rute tulis.

Analisis dan keputusan:
- **Batas `saveBatch` diturunkan 10 -> 5** (keputusan pemilik 2026-10-30, lihat spek §5): proksi lokal 10 task masih ~3,7 ms (x3,5 = ~13 ms) karena biayanya JS sebanding jumlah task (parse checklist, snapshot audit, DTO balasan ~19 KB per task), bukan jumlah pernyataan. Dengan 5 task proksinya ~1,9 ms (~6,6 ms). Kasus gerbang kini `handovers.saveBatch:5x5000`.
- **Batas push TIDAK diturunkan** (tetap 5): sesudah optimasi proksinya ~1,4 ms (x3,5 = ~5 ms); per entri hanya ±1 ms p95 di edge (p95 `items.save` satu tulis sudah 11, push 5 entri 15), jadi menurunkannya ke 2 tidak akan menembus 8 ms bila p95 tulis tunggal belum lulus.
- **Peringatan kalibrasi**: aturan x3,5 meremehkan rute ringan (Run 6: `items.save` lokal 0,47 -> edge p50 3, p95 11). Round trip dan pernyataan ternyata murah (push 14 round trip/40 pernyataan p50 4 ms; `items.save` 2 round trip p50 3 ms), sedangkan p95 rute tulis 9-18 ms mengikuti ekor yang tidak terlihat lokal: panggilan awal pada kode yang belum "panas" (kompilasi lazy/JIT) dan miss cache. Dengan 100 panggilan, p95 = panggilan ke-6 terburuk, jadi ~5 panggilan pertama pada kode dingin menentukan hasil. Karena itu jumlah kode yang dilalui rute (bukan data) paling berpengaruh, dan hanya Run 7 yang bisa memastikan. Rute yang paling mungkin masih > 8 ms: `items.save`, `handovers.save:create`/`update`, `handovers.saveBatch` (5 task), `sync.items.push`, `GET /api/boot` (p95 10 walau 0 round trip pada cache hangat; DUGAAN: kasus ini berjalan tepat setelah `/api/ping` sehingga jalur autentikasi masih dingin, karena `auth.me` lewat RPC yang kode jalurnya sama dan berjalan sesudahnya p95 3; perlu dibuktikan di Run 7, mis. dengan panggilan pemanasan berotentikasi sebelum pengukuran).
