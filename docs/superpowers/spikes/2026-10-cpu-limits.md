# Spike CPU dan batas paket gratis (Task 0.3)

Diukur 2026-10-25 di edge Cloudflare (colo SIN), akun QC, paket gratis, Worker sementara `qc-app-spike-cpu` (kini dihapus bersama D1 dan Queue-nya). `cpuTime` dari `wrangler tail --format json` (resolusi bulat 1 ms). Pengukuran pertama tertunda karena akun belum punya subdomain `workers.dev`; sesudah `qc-225.workers.dev` terdaftar, spike diulang.

## Jawaban inti

1. **Konsumen Queues di paket gratis TIDAK dibatasi 10 ms CPU.** Konsumen menjalankan beban CPU ~115 ms (p50) sampai selesai pada 169 dari 170 percobaan; di ~220 ms selesai 152/170 (89%); di ~0,8 s 84/170; di ~4 s tidak ada yang selesai. Batas nyata ada, tetapi puluhan kali di atas 10 ms. Rancangan Queues (Spek §9b) **layak**; keputusan pemilik tidak diperlukan.
2. **Queues + cron berjalan.** Cron `* * * * *` berjalan tiap menit (2+ jam), `sendBatch` ke Queue berhasil, konsumen (satu pesan per invokasi) memproses.
3. Peringatan kuota: spike sempat mengirim 245 pesan/menit dan kena `Queue sendBatch failed: Too Many Requests` (kuota 10.000 operasi/hari, ±3 operasi/pesan, terbukti ditegakkan). Rancangan produksi (pesan hanya saat ada pekerjaan) jauh di bawah itu.
4. Batas 10 ms untuk HTTP juga **tidak ditegakkan keras** di edge ini (lihat tabel), tetapi dokumentasi tetap menyebut 10 ms dan kelonggaran ini tidak terjamin. **Keputusan: anggaran 10 ms per permintaan (gerbang p99 ≤ 8 ms) tetap berlaku**; kelonggaran tidak dipakai.

## cpuTime skenario nyata (HTTP, N = 40 tiap skenario, `wrangler tail`)

| Skenario | cpuTime p50 | p99 | maks |
|---|---|---|---|
| baseline (respons kosong) | 0 ms | 3 ms | 3 ms |
| `JSON.parse` 700 KB (termasuk baca badan) | **2 ms** | **4 ms** | 4 ms |
| Teruskan base64 540 KB tanpa decode (baca badan + sambung amplop) | **0 ms** | **2 ms** | 2 ms |
| `atob` 540 KB (pembanding) | **1 ms** | **2 ms** | 2 ms |
| `D1.batch()` 10 kueri (3 tulis + 7 baca berindeks, 2.000 baris) | **1 ms** | **2 ms** | 2 ms |
| Cron (kirim 245 pesan dalam 3 `sendBatch`) | 0 ms | 1 ms | 1 ms |

Pembacaan: semuanya jauh di bawah 8 ms. `JSON.parse` 700 KB adalah yang termahal (~2 ms, lebih murah dari 3 ms di laptop). `atob` 540 KB hanya ~1 ms lebih mahal daripada meneruskan teks, jadi larangan decode di Spek tetap benar sebagai kebijakan (hemat memori/CPU, tak ada keuntungan) tetapi bukan penyelamat 10 ms. Resolusi 1 ms membuat p99 kasar.

## Penegakan batas CPU (beban buatan, unit = 100 ribu iterasi)

HTTP (`wrangler tail`, N = 20): 

| Beban | cpuTime p50 | maks | hasil |
|---|---|---|---|
| 5 unit | 6 ms | 17 | 20/20 ok |
| 10 unit | 9 ms | 26 | 20/20 ok |
| 40 unit | 39 ms | 127 | 20/20 ok |
| 100 unit | 115 ms | 219 | 18 ok, 2 `exceededCpu` |
| 300 unit | 222 ms | 619 | 8 ok, 1 `exceededCpu` (9 tercatat) |

Konsumen Queue (pesan dengan beban sama, tabel `qlog` D1, 170 pesan per beban; cpuTime konsumen tak tertangkap karena kuota Queue habis sebelum tail dipasang, tetapi 1 unit ≈ 1,1 ms dari kalibrasi HTTP):

| Beban (≈ CPU) | selesai |
|---|---|
| 10 unit (~9 ms) | 170/170 |
| 30 unit (~30 ms) | 170/170 |
| 100 unit (~115 ms) | 169/170 |
| 300 unit (~220 ms) | 152/170 |
| 1000 unit (~0,8 s) | 84/170 |
| 5000 unit (~4 s) | 0/170 |

## Catatan lingkungan (bukan bagian rancangan)

- DNS lokal mesin pengembang ini mengembalikan IP salah untuk `*.workers.dev` (akibatnya `wrangler tail` dan `curl` ke workers.dev timeout). Solusi: resolusi lewat DoH dan `curl --resolve` / pra-muat `dns.lookup` di Node. Tidak dimasukkan ke repo.
- Hapus Worker konsumen Queue butuh `wrangler queues consumer remove` dulu (kode 10064/11005).
- Timer Workers tidak maju di loop sinkron: beban buatan dinyatakan dalam iterasi.
- Instrumen ada di `worker/spike/` (`cpu-probe.ts`, `run-probes.ts`, `gen-*.ts`, `local-bench.ts`); jangan biarkan cron-nya berjalan lama (menghabiskan kuota Queue).

## Keputusan

- Queues dipakai di paket gratis untuk ekspor/pembersihan (Spek §9b, §10); Fase 3 boleh berjalan. Tetap rancang tiap pesan ≤ 10 ms CPU dan idempoten, karena konsumen tidak aman tanpa batas (dihentikan sekitar ratusan ms) dan kuota 10.000 operasi/hari nyata.
- Gerbang 10 ms/p99 ≤ 8 ms tidak berubah. Perkiraan anggaran: `JSON.parse` 700 KB ≈ 2 ms, D1.batch 10 kueri ≈ 1 ms, meneruskan base64 540 KB ≈ 0 ms.
- Spek §2b "CPU konsumen Queues": jawabannya tidak dibatasi 10 ms pada paket gratis (teramati ≥ 100 ms), tidak ada dokumen yang menjaminnya.
