# Spike CPU dan batas paket gratis (Task 0.3)

Status: **TERTUNDA, menunggu pemilik.** Pengukuran di Cloudflare belum bisa dijalankan karena akun QC belum punya subdomain `workers.dev`.

## Penghalang

Deploy ke akun QC gagal pada langkah sesudah unggah: `GET /workers/workers/<nama>` menjawab "This Worker does not exist" (kode 10007), dan memasang konsumen Queue dijawab eksplisit: "You need a workers.dev subdomain in order to proceed ... Opening the Workers landing page for the first time will create a workers.dev subdomain automatically" (kode 10063). Wrangler juga gagal mendaftarkan subdomain otomatis (nama "spike" tidak tersedia). Pendaftaran subdomain adalah pengaturan akun yang bersifat publik dan tahan lama, jadi tidak dilakukan agen.

**Tindakan pemilik:** buka dashboard Cloudflare akun QC, menu Workers & Pages (membuka halaman landing pertama kali membuat subdomain), atau daftarkan nama subdomain pilihan di `https://dash.cloudflare.com/2256d27ce4dcdcb9ade777cc2650fd81/workers/onboarding`. Ini juga prasyarat Task 1.7 dan staging (`GET /api/ping`, konsumen Queue).

## Yang sudah disiapkan (siap dijalankan ulang)

- `worker/spike/cpu-probe.ts` + `wrangler.jsonc` (Worker `qc-app-spike-cpu`): cron tiap menit memasukkan pesan ke Queue; konsumen Queue (satu pesan per invokasi) menjalankan skenario `baseline`, `json-parse` (700 KB), `forward-b64` (540 KB tanpa decode), `atob` (540 KB, pembanding), `d1-batch` (10 kueri), dan `burn` dengan beban 10 ... 5000 unit untuk mencari titik konsumen dihentikan (start tanpa done di tabel `qlog`). Rute HTTP `/probe/*` tersedia bila ingin mengukur lewat `fetch`.
- Pembuatan payload: `bun worker/spike/gen-payloads.ts` dan `gen-seed.ts` (keluaran tidak di-commit).
- Langkah: buat D1 + Queue `qc-app-spike-cpu` (akun QC), isi `database_id` di `wrangler.jsonc`, `d1 execute --remote --file seed.sql`, `wrangler deploy --var KEY:<acak>`, jalankan `wrangler tail --format json` ≥ 3 menit, ambil `cpuTime` per skenario (p50/p99), lalu hapus Worker, Queue, D1.
- Pelajaran: timer Workers tidak maju di loop sinkron, sehingga beban CPU dinyatakan dalam iterasi, bukan milidetik.
- Semua sumber daya spike yang sempat dibuat (Worker `qc-app-spike-cpu`, `qc-app-spike-cpu-min`, D1 dan Queue `qc-app-spike-cpu`) sudah dihapus dari akun QC.

## Bukti sementara (BUKAN pengukuran Cloudflare)

Dokumentasi Cloudflare (dibaca 2026-10-25):
- Workers Limits: CPU per permintaan HTTP **10 ms** dan per Cron **10 ms** pada paket gratis. Tabel itu tidak mencantumkan CPU untuk konsumen Queue.
- Queues Limits: konsumen default **30 detik** CPU (dapat diatur lewat `limits.cpu_ms`, sampai 5 menit); halaman menyatakan batas berlaku untuk paket Free dan Paid (retensi pesan satu-satunya pengecualian). Namun `limits.cpu_ms` pada paket gratis belum tentu dihormati; tetap perlu bukti empiris.

Pembanding lokal (`worker/spike/local-bench.ts`, Bun/V8 di laptop pengembang, p50; BUKAN angka edge): `JSON.parse` 700 KB ≈ 3,1 ms; penyambungan string base64 540 KB ≈ 0 ms; `atob` 540 KB ≈ 0,2 ms. Artinya `JSON.parse` 700 KB sendiri sudah memakan sepertiga anggaran 10 ms, mendukung aturan Spek §5 (tidak mem-parse badan besar). `atob` native tidak semahal perkiraan Spek; larangan decode tetap beralasan (memori/alokasi) tetapi perlu diukur di edge.

## Keputusan

Belum ada. Hasil p50/p99 dan jawaban "apakah konsumen Queue di paket gratis dibatasi 10 ms CPU" akan diisi setelah subdomain tersedia. Sesuai Task 0.3 Step 3, Fase 3 jangan dimulai sebelum pertanyaan itu terjawab.
