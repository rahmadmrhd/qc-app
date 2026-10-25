# Pengembangan lokal Worker (D1 lokal)

Menjalankan backend Cloudflare Worker + D1 di komputer sendiri, tanpa menyentuh akun Cloudflare, D1 remote, atau Google.
`bun run dev` yang lama (mock backend di peramban) tetap ada dan tidak berubah.

## Cepat mulai

```bash
bun run db:seed        # migrasi + data contoh ke D1 LOKAL
bun run dev:worker     # wrangler dev di http://localhost:8787
```

Lalu buka `http://localhost:8787/auth/dev-login` (menerbitkan cookie sesi untuk `DEV_LOGIN_EMAIL`) dan kembali ke `/`.

Pertama kali, `dev:worker` membuat `worker/.dev.vars` dari `worker/.dev.vars.example` (rahasia sesi acak). Ubah
`DEV_LOGIN_EMAIL` (dan `ADMIN_EMAIL`) menjadi email Anda **sebelum** `bun run db:seed`; skrip seed membuat pengguna admin dengan
email itu. Argumen `--email=<email>` menimpa nilai berkas.

## Yang dilakukan tiap skrip

- `bun run dev:worker` (`worker/scripts/dev.ts`): menyiapkan `worker/.dev.vars` dan direktori aset `worker/dist` bila belum ada,
  menerapkan migrasi ke D1 lokal (`wrangler d1 migrations apply DB --local`), lalu `wrangler dev --local`. Status D1 lokal ada di
  `worker/.wrangler/state` (tidak masuk git; hapus folder itu untuk mengulang dari nol).
- `bun run db:seed` (`worker/scripts/seed-dev.ts`): menerapkan migrasi lalu mengosongkan dan mengisi data contoh: pengguna admin
  (email dev) + `wh@dev.test` + `qc@dev.test`, 3 peran, 2 lokasi (Jakarta, Bandung), 3 merk, 10 item, 3 customer, 6 task serah
  terima (Baru, Dikerjakan, Selesai, Dibatalkan, dengan centang dan komentar). Aman dijalankan ulang (data contoh direset).
  **Skrip ini menolak `--remote`** (juga `-r` dan `--preview`) dan selalu memakai `--local`.

## Login pengembangan

`GET /auth/dev-login` aktif **hanya bila** variabel `DEV_LOGIN_EMAIL` ada **dan** host permintaan `localhost`/`127.0.0.1`;
selain itu 404. Variabel ini hanya boleh berada di `worker/.dev.vars` (tidak pernah di `wrangler.jsonc`, secret, atau CI;
sebuah tes memastikan `wrangler.jsonc` tidak memuatnya). Email harus terdaftar dan aktif (atau sama dengan `ADMIN_EMAIL`).

Cookie sesi di `http://localhost` dikirim **tanpa** atribut `Secure` (sebagian peramban menolak cookie Secure pada http);
di semua origin lain (termasuk http selain localhost) atribut `Secure` tetap dipasang.

## Batasan

- Jembatan Google (`BRIDGE_URL`) tidak tersedia secara lokal: unggah berkas, ekspor, dan fitur QR yang memakai Drive akan
  gagal dengan `UNAVAILABLE`. Gunakan staging untuk menguji jembatan.
- Frontend di `http://localhost:8787` dilayani dari `worker/dist` (hasil build web). Selama jalur web belum mengubah build,
  uji API lewat `curl`, mis. `curl -b cookie -H "X-Requested-With: qc" -d '{"method":"auth.me","payload":null}' http://localhost:8787/api/rpc`.
