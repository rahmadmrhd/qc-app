# Observability: cara membaca log Worker

Workers Logs aktif di produksi (akun "QC") dan staging (akun terpisah) lewat `observability` di `worker/wrangler.jsonc`. Paket gratis: **200.000 log/hari, retensi 3 hari** (sumber: dokumentasi Workers Logs). Kuota ini terpisah dari kuota D1.

## Dua jenis log per permintaan

1. **Invocation log** (otomatis dari Cloudflare): satu per permintaan ke Worker, memuat URL, status HTTP, `cpuTime`, `wallTime`, outcome (`ok`, `exceededCpu`, `exception`). Ini sumber angka CPU yang dipakai gerbang CPU.
2. **Baris aplikasi** (`worker/src/core/log.ts`): satu objek per RPC dan per sinkron. Field:

| Field | Arti |
|---|---|
| `evt` | `rpc` (`POST /api/rpc`, aplikasi web) atau `sync` (`POST /sync`, QC Desktop) |
| `requestId` | 8 karakter; sama dengan yang tampil di pesan galat pengguna ("requestId a1b2c3d4") |
| `method` | nama RPC, mis. `handovers.setCheck`; di `sync` hanya diisi setelah token sah (galat autentikasi = `?`) |
| `ok` | `true` atau `false` |
| `code` | kode galat bila `ok = false`: `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNAVAILABLE`, `INTERNAL` |
| `ms` | waktu dinding (bukan CPU; mencakup menunggu D1/jembatan) |
| `userId` | id internal pengguna (bukan email); kosong bila belum login |

Tidak pernah dicatat: email, token sesi, `SYNC_API_TOKEN`, isi payload, isi catatan atau komentar.

Level: sukses = `log`; galat wajar dari pemakaian (izin, validasi, konflik, kuota habis) = `warn`; `INTERNAL` = `error` (disertai baris `error` kedua berisi stack, kunci pencarian yang sama: `requestId`).

## Membaca di dashboard

Dashboard Cloudflare → pilih akun → **Workers & Pages** → Worker (`app` untuk produksi, `app-staging` untuk staging) → **Observability** (atau tab *Logs*). Gunakan *Query builder*:

| Pertanyaan | Filter |
|---|---|
| Laporan pengguna dengan `requestId` | `requestId = a1b2c3d4` |
| Semua galat server | `evt = rpc` dan `code = INTERNAL` (atau level `error`) |
| Siapa yang ditolak izin | `code = FORBIDDEN` (kelompokkan menurut `userId`, `method`) |
| RPC lambat | `ms > 500`, kelompokkan menurut `method` |
| Kuota D1 habis | `code = UNAVAILABLE` (pesan "Kuota harian basis data habis") atau cari teks `exceeded D1's free tier` |
| Aktivitas QC Desktop | `evt = sync` |
| Request yang melewati batas CPU | invocation log dengan outcome `exceededCpu` |

## Membaca langsung dari terminal

```bash
cd worker && bunx wrangler tail --env staging --format json
```

Produksi: jalankan tanpa `--env` (akun "QC"). Untuk menyaring: `--status error` (hanya galat), `--search <teks>` (mis. `--search INTERNAL`), `--method POST`. Catatan jaringan: bila DNS lokal membajak `*.workers.dev`, jalankan dengan `NODE_OPTIONS="--require <path>/worker/scripts/doh-preload.cjs"` (dipakai skrip gerbang CPU).

## Yang perlu dipantau setelah cutover (Fase 7)

- Lonjakan `code = INTERNAL` atau outcome `exceededCpu` atau `exception` setelah deploy.
- `UNAVAILABLE` karena kuota D1 (lihat `docs/superpowers/spikes/2026-10-cpu-gate.md`, kuota per akun).
- `ms` rute yang naik terus (tanda kueri D1 yang makin banyak memindai baris).
- Volume log mendekati 200.000/hari: turunkan `head_sampling_rate` (mis. 0.5) di `wrangler.jsonc` atau hapus baris sukses (`ok = true`) dari `core/log.ts`.
