# Observability: cara membaca log server

Server Bun menulis log terstruktur ke **stdout/stderr**: satu objek per peristiwa (`console.log/warn/error`, Bun mencetaknya sebagai satu entri). Saat pengembangan keluarannya tampil di terminal `bun run dev`. Setelah server dijalankan sebagai kontainer (tahap deploy; belum ada saat dokumen ini ditulis), log dibaca lewat `docker logs`. Tidak ada layanan log eksternal.

## Baris aplikasi

Sumber: `server/src/core/log.ts`, satu objek per permintaan REST dan per sinkron:

| Field | Arti |
|---|---|
| `evt` | `rest` (`/api/v1/*`, aplikasi web; `method` = id rute pada tabel `shared/api.ts`) atau `sync` (`POST /sync`, QC Desktop) |
| `requestId` | 8 karakter; sama dengan yang tampil di pesan galat pengguna ("requestId a1b2c3d4") |
| `method` | id rute, mis. `handovers.setCheck`; di `sync` hanya diisi setelah token sah (galat autentikasi = `?`) |
| `ok` | `true` atau `false` |
| `code` | kode galat bila `ok = false`: `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNAVAILABLE`, `INTERNAL` |
| `ms` | waktu dinding permintaan (mencakup menunggu MariaDB/jembatan) |
| `userId` | id internal pengguna (bukan email); kosong bila belum login |

Tidak pernah dicatat: email, token sesi, `SYNC_API_TOKEN`, isi payload, isi catatan atau komentar.

Level: sukses = `log` (stdout); galat wajar dari pemakaian (izin, validasi, konflik, basis data tak terjangkau) = `warn`; `INTERNAL` = `error` (disertai baris `error` kedua berisi stack, kunci pencarian yang sama: `requestId`). Peristiwa proses (`evt: start`, `evt: shutdown`) dicetak `main.ts` saat server naik/turun; runner job dan penjadwal mencatat putaran yang gagal lewat `console.error`.

## Membaca

```bash
# pengembangan: lihat terminal `bun run dev` (atau `bun run dev:server > server.log`) lalu cari di berkasnya
# kontainer (setelah tahap deploy): docker logs --since 1h <nama-kontainer-aplikasi>
```

Bun mencetak objek log sebagai blok beberapa baris; cari dengan `grep -B3 -A8 <teks>`:

| Pertanyaan | Cari |
|---|---|
| Laporan pengguna dengan `requestId` | `requestId: "a1b2c3d4"` (baris `rest` dan, bila `INTERNAL`, baris stack) |
| Semua galat server | `code: "INTERNAL"` atau baris level `error` |
| Siapa yang ditolak izin | `code: "FORBIDDEN"` (lihat `userId`, `method`) |
| Rute lambat | `ms` di atas 500 untuk `method` yang sama |
| Basis data tak terjangkau | `code: "UNAVAILABLE"` dan pesan "Basis data sedang tidak dapat dihubungi" |
| Aktivitas QC Desktop | `evt: "sync"` |

## Yang perlu dipantau

- Lonjakan `code = INTERNAL` setelah deploy.
- `UNAVAILABLE` berulang: MariaDB mati atau jaringan ke basis data bermasalah.
- `ms` rute yang naik terus (kueri makin lambat atau pool koneksi penuh).
- Runner job: pesan `runner job: putaran gagal` atau `penjadwal: putaran gagal` berulang.
