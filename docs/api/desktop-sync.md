# Kontrak API Sinkronisasi QC App ⇄ QC Desktop

| | |
|---|---|
| **Versi API** | 2 (REST) |
| **Status** | Dibangun (T25 migrasi VPS); menggantikan versi 1 (amplop RPC `POST /exec`/`POST /sync`) |
| **Pengguna** | QC Desktop (di balik VPN, terhubung ke MySQL). QC App web tidak pernah berbicara ke MySQL. |
| **Sumber daya** | `brands`, `items`, berkas gambar; sumber daya stok menyusul |

Dokumen ini adalah kontrak antara dua proyek terpisah. Perubahan yang tidak kompatibel menaikkan versi API (`apiVersion` pada `GET /sync/ping`).

> **Catatan keputusan (REST, 2026-11-05/06, disetujui pemilik produk).** Seluruh API, termasuk sinkron QC Desktop, dikonversi ke REST pada migrasi ke VPS (spek `docs/superpowers/specs/2026-11-05-migrasi-vps-docker-rest-design.md`, §2 butir 6 dan §19 butir 7). Alasan: kontrak ini belum dipakai klien mana pun, jadi tidak ada jalur kompatibilitas yang perlu dijaga. Versi 1 (amplop `{ v, method, token, payload }` ke satu endpoint, token di badan, redirect Apps Script, batas peninggalan CPU edge 5 item per push) **dihapus seluruhnya**; `POST /sync` kini menjawab 404.

---

## 1. Transport dan autentikasi

- **Alamat dasar:** `https://<host QC App>/api/v1` (semua rute di bawah relatif terhadapnya). Dokumen OpenAPI (butuh sesi login web): `GET /api/openapi.json`, memuat keenam rute dengan skema keamanan `syncBearer`.
- **Autentikasi:** HANYA header `Authorization: Bearer <SYNC_API_TOKEN>`. Token **tidak pernah** di badan atau URL (URL tercatat di log); cookie sesi web **tidak** diterima di rute ini dan tidak diperlukan header `X-Requested-With`. Bila header Bearer dan cookie sama-sama dikirim, hanya Bearer yang dipakai.
- **Token:** variabel lingkungan server `SYNC_API_TOKEN` (≥ 32 karakter acak). Satu token bersama untuk Desktop. Memutar token = mengganti variabel di server lalu konfigurasi Desktop. Skema `Bearer` tak peka huruf besar/kecil; tokennya peka.
- **Semua kegagalan sebelum autentikasi lolos** (header tidak ada, bukan skema Bearer, token salah, IP sedang diblokir pembatas, token server belum dikonfigurasi atau < 32 karakter) menghasilkan jawaban yang **sama persis**: `401` `application/problem+json` dengan `detail` "Token tidak valid" dan header `WWW-Authenticate: Bearer`. Sebabnya tidak dapat dibedakan dari luar. Badan permintaan **tidak dibaca** sebelum token sah, dan `422` serta `404` (berkas tidak ada, atau rute/verba tak dikenal di bawah `/sync/*`) hanya muncul setelah token sah: tanpa token, rute yang tidak ada pun dijawab 401 yang sama dan ikut dihitung pembatas.
- **Pembatas percobaan salah:** 10 token salah dalam 10 menit memblokir **IP klien** itu selama 10 menit (permintaan bertoken benar dari IP itu pun ditolak 401 seragam); IP lain tidak terpengaruh. IP klien = alamat peer TCP; `CF-Connecting-IP` hanya dipercaya bila peer proksi tepercaya (nginx di host yang sama); IPv6 dihitung per /64. Pembatas tidak menghitung permintaan sukses. Tunggu 10 menit setelah terblokir; jangan mengulang dalam lingkaran cepat.
- **Batas ukuran:** badan push ≤ 5 MB (melebihi → `413`, dibaca setelah token sah); berkas ≤ 8 MB; gunakan paginasi pada pull.
- **Cache:** semua jawaban JSON `Cache-Control: no-store`. Tidak ada `ETag`/`If-Match` pada item dan merk: pull berbasis `sinceRev` dan deteksi konflik berbasis `baseRev` di badan push (§3.3). Hanya unduhan berkas yang memakai `ETag` (§2).

### Bentuk jawaban

Sukses = `200` dengan **badan JSON apa adanya** (tanpa amplop `{ ok, data }`). Hasil per item/merk pada push tetap berada di badan `200` (BUKAN `207`) dengan status per entri (§3.3).

Galat = `application/problem+json` (RFC 9457) dengan ekstensi `code`, `requestId`, dan `fields`:

```json
{ "type": "urn:qc:problem:validation", "title": "Input tidak valid", "status": 422,
  "detail": "Input tidak valid", "code": "VALIDATION", "requestId": "a1b2c3d4",
  "fields": { "items": "Maksimal 50 item" } }
```

| Status | `code` | Arti |
|---|---|---|
| `401` | `UNAUTHENTICATED` | token salah/hilang/diblokir/belum dikonfigurasi (tidak dibedakan), `detail` selalu "Token tidak valid" |
| `400` | `VALIDATION` | badan push bukan JSON yang valid |
| `404` | `NOT_FOUND` | rute tidak dikenal, atau berkas tidak ada / di luar folder gambar aplikasi |
| `413` | `VALIDATION` | badan push > 5 MB, atau berkas > 8 MB |
| `422` | `VALIDATION` | query/badan tingkat permintaan salah bentuk; `fields` berisi pesan per field (kesalahan per item ada di hasil per item, lihat §3.3) |
| `500` | `INTERNAL` | galat server; sertakan `requestId` saat melapor |
| `503` | `UNAVAILABLE` | basis data/layanan sedang tak terjangkau; header `Retry-After: 5`; boleh dicoba ulang |

`CONFLICT` **tidak** muncul sebagai galat tingkat atas; ia hanya muncul sebagai status per item.

---

## 2. Rute umum

| Rute | Fungsi |
|---|---|
| `GET /sync/ping` | uji token dan koneksi |
| `GET /sync/files/{id}` | unduh isi gambar |

```bash
curl -s -H "Authorization: Bearer $SYNC_API_TOKEN" https://qc.example.com/api/v1/sync/ping
```
```json
{ "apiVersion": 2, "serverTime": "2026-10-10T03:00:00.000Z", "resources": ["brands", "items"] }
```

### `GET /sync/files/{id}`
Mengambil isi gambar. `{id}` = id berkas Drive. Hanya berkas yang berada di **folder gambar aplikasi**; id lain (termasuk berkas Drive di folder lain) → `404`.

```bash
curl -s -D - -H "Authorization: Bearer $SYNC_API_TOKEN" \
  -o foto.webp https://qc.example.com/api/v1/sync/files/1iipMYHrqe62YysVgZOJ_R0nJBHptnx45
```

- Badan = **byte mentah** berkas (tanpa base64, tanpa JSON), `Content-Type` sesuai berkas (mis. `image/webp`).
- `ETag: "<id>"` dan `Cache-Control: private, max-age=31536000, immutable`: isi berkas untuk id yang sama tidak berubah, jadi Desktop cukup menyimpan hasilnya menurut id. `If-None-Match: "<id>"` dijawab `304` tanpa badan.
- Ukuran berkas ≤ 8 MB (lebih besar → `413`, `code` `VALIDATION`).

---

## 3. Sumber daya `items`

Master: **dua arah**. Kunci pencocokan: `uid` → `id` → merk+tipe ternormalisasi.

### 3.1 Bentuk item

```json
{
  "uid": "b1c7e0a4-3f52-4d0e-9a51-6c0b2f7d8e11",
  "id": "12",
  "merk": "Ubiquiti",
  "tipe": "ES 24 250W",
  "isCountryLock": false,
  "images": ["1iipMYHrqe62YysVgZOJ_R0nJBHptnx45", "11qSnW737cp555xm8HmQABgZuYbgBGZeq"],
  "detail": "## Spesifikasi\n- Port: 24x GbE\n- PoE: 250 W\n\n![Posisi stiker](drive:1vGFY6r6Sql7Voy1Hsmev3Onr8R7I8i2e)\n",
  "stickers": [
    { "name": "Label SNI", "note": "Bagian belakang bodi, sudut kanan bawah", "image": "1AaFJVMyuZys4imyy8zLP4VW-uJLsbE8p" },
    { "name": "Label garansi", "note": "", "image": null }
  ],
  "accessories": [
    { "name": "Kabel daya", "qty": 1 },
    { "name": "Rack mount kit", "qty": 2 }
  ],
  "active": true,
  "rev": 128
}
```

| Field | Tipe | Aturan | Arah |
|---|---|---|---|
| `uid` | string \| null | id QC App (UUID). `null` pada push untuk item baru dari MySQL. | pull: selalu ada |
| `id` | string \| null | id MySQL (angka sebagai teks). `null` bila item lahir di QC App dan belum dipetakan. Unik. | dua arah |
| `merk` | string | wajib, 1–60 karakter | dua arah |
| `tipe` | string | wajib, 1–100 karakter | dua arah |
| `isCountryLock` | boolean | **boolean**. Push juga menerima `"true"`/`"false"`; balasan selalu boolean. | dua arah |
| `images` | string[] | id Drive, maks. 10, urutan = urutan galeri. Tiap id harus berada di folder aplikasi. | dua arah |
| `detail` | string | Markdown, maks. 20.000 karakter (aturan 3.4) | dua arah |
| `stickers` | objek[] | maks. 30. `name` 1–100, `note` ≤ 300, `image` id Drive atau `null` | dua arah |
| `accessories` | objek[] | maks. 30. `name` 1–100, `qty` bilangan bulat 1–999 | dua arah |
| `active` | boolean | `false` = nonaktif (pengganti "hapus"). Default `true` pada item baru. | dua arah |
| `rev` | integer | revisi sinkron; hanya-baca. | pull |

**Tidak disinkronkan:** nama lain/alias (khusus QC App). **Bentuk kabel item dan merk tidak berubah dari versi 1.**

### 3.2 `GET /sync/items`

```bash
curl -s -H "Authorization: Bearer $SYNC_API_TOKEN" \
  "https://qc.example.com/api/v1/sync/items?sinceRev=120&limit=100&include=detail,stickers,accessories"
```

| Query | Aturan |
|---|---|
| `sinceRev` | integer ≥ 0 (default 0); hanya item dengan `rev` > nilai ini. Mulai dari `0`. |
| `limit` | 1–500 (default 100); di atas 500 ditolak `422`. Bila `include` memuat `detail`, nilai yang lebih besar dari **200** dipotong diam-diam menjadi **200** (bukan ditolak). QC Desktop HARUS mengikuti `nextRev`/`hasMore` sampai `hasMore: false` dan tidak boleh mengandalkan jumlah item atau jumlah halaman. |
| `include` | opsional; daftar dipisah koma, subset dari `detail`, `stickers`, `accessories`. Field yang tidak diminta tidak dikirim. `images`, `id`, `uid`, `merk`, `tipe`, `isCountryLock`, `active`, `rev` selalu dikirim. Nama lain ditolak `422`. |

Query yang tidak dikenal diabaikan; nilai bukan angka pada `sinceRev`/`limit` ditolak `422` (`fields.sinceRev`/`fields.limit`).

```json
{ "items": [ { "...item..." } ], "nextRev": 128, "hasMore": false }
```
Simpan `nextRev` sebagai kursor. Bila `hasMore` benar, panggil lagi dengan `sinceRev = nextRev`. Urutan hasil menurut `rev` naik. Item yang tidak berubah di sisi sinkron tidak muncul (perubahan `alias` tidak menaikkan `rev`).

Item dan merk hasil impor awal membawa `rev` dari impor (kursor yang sudah dipegang Desktop tetap valid; revisi baru selalu melampauinya). `merk` selalu nama merk terkini; mengganti nama merk menaikkan `rev` semua item merk itu.

### 3.3 `POST /sync/items/push`

```bash
curl -s -X POST -H "Authorization: Bearer $SYNC_API_TOKEN" -H "Content-Type: application/json" \
  --data @push.json https://qc.example.com/api/v1/sync/items/push
```
```json
{ "overwrite": false,
  "items": [
    { "id": "12", "merk": "Ubiquiti", "tipe": "ES 24 250W", "isCountryLock": false,
      "images": ["1iipMYHrqe62YysVgZOJ_R0nJBHptnx45"],
      "detail": "## Spesifikasi\n- Port: 24x GbE\n",
      "stickers": [ { "name": "Label SNI", "note": "Belakang bodi", "image": null } ],
      "accessories": [ { "name": "Kabel daya", "qty": 1 } ],
      "baseRev": 120 },
    { "id": "13", "merk": "Ubiquiti", "tipe": "ES 24 Lite", "isCountryLock": "false" }
  ] }
```

**Semantik field (berlaku untuk `images`, `detail`, `stickers`, `accessories`, `active`):**

| Di badan | Efek |
|---|---|
| field **tidak ada** | tidak diubah |
| daftar / teks **ada** (termasuk `[]` dan `""`) | **mengganti** nilai tersimpan seluruhnya |
| `merk`, `tipe`, `isCountryLock` | wajib pada item **baru**; opsional pada item yang sudah ada |

**Pencocokan item:** (1) `uid` bila ada; (2) `id` (MySQL); (3) merk+tipe ternormalisasi (huruf kecil, tanda baca dibuang, spasi dirapikan).
- Bila `uid` dan `id` dikirim bersamaan, server **memetakan** `id` ke item itu (cara Desktop melaporkan id MySQL untuk item yang lahir di QC App).
- Tidak ada yang cocok → item **dibuat**.
- Pencocokan mengarah ke dua item berbeda, atau item sudah terpetakan ke `id` MySQL lain → `conflict`.

**Konflik (dua arah):** bila `baseRev` ada dan lebih lama dari `rev` sekarang, serta **nilai field yang dikirim berbeda** dari yang tersimpan, hasilnya `conflict` dan tidak ada yang berubah untuk item itu. Bila nilai yang dikirim sama persis, hasilnya `unchanged`. Tanpa `baseRev`, item yang sudah ada diperlakukan sebagai konflik bila nilainya berbeda, kecuali `overwrite: true`.
- Alur yang disarankan: **pull dulu, lalu push dengan `baseRev` = `rev` item yang terakhir ditarik.**
- `overwrite: true` (per permintaan) mengabaikan pemeriksaan konflik dan menimpa field yang dikirim.
- Tidak ada `ETag`/`If-Match` untuk item: `baseRev` di badan adalah satu-satunya prasyarat konflik, dan hasilnya selalu per item.

**Batas:** ≤ **50 item per panggilan**; ≤ **25** bila ada entri yang memuat `detail`; di atas itu ditolak `422` (`fields.items`: "Maksimal 50 item" atau "Maksimal 25 item"). Badan ≤ 5 MB. Daftar kosong, `items` bukan daftar, atau `overwrite` bukan boolean → `422`. `sync.brands.push` (§3b) ≤ 50.

**Catatan perilaku:**
- Pemetaan id MySQL saja (nilai sama) → `updated` **tanpa** kenaikan `rev` dan tanpa audit.
- Nama merk dibandingkan menurut kunci ternormalisasi (huruf besar/kecil tidak dianggap beda).
- Pesan `fields` memakai nama field kabel (`merk`, `tipe`, `images`, ...).
- Field di luar kontrak (mis. salah ketik `merek`) ditolak: entri `invalid` dengan `fields.<nama>` = "Field tidak dikenal". Entri push hanya boleh memuat `uid`, `id`, `merk`, `tipe`, `isCountryLock`, `images`, `detail`, `stickers`, `accessories`, `active`, `baseRev` (merk: `uid`, `id`, `name`, `active`, `baseRev`).
- Pembuatan, perubahan, dan konflik dicatat di audit atas nama `sync:desktop` (aksi `item.create`, `item.update`, `item.activate`/`item.deactivate`, `item.sync.conflict`).
- `id` MySQL boleh dikirim sebagai angka; `isCountryLock` dan `active` boleh berupa teks `"true"`/`"false"`.

**Balasan** (`200`) — satu hasil per item, urutan sama dengan permintaan; kegagalan satu item tidak membatalkan yang lain:
```json
{ "results": [
  { "index": 0, "status": "updated",   "uid": "b1c7e0a4-…", "rev": 129 },
  { "index": 1, "status": "unchanged", "uid": "c20f91d2-…", "rev": 77 },
  { "index": 2, "status": "created",   "uid": "e4a9…",      "rev": 130 }
] }
```

| `status` | Arti |
|---|---|
| `created` | item baru dibuat |
| `updated` | ada field yang berubah; `rev` baru |
| `unchanged` | nilai sama dengan yang tersimpan; tidak ada perubahan |
| `conflict` | ditolak; `current` memuat item terkini (selalu dengan `detail`, `stickers`, `accessories`) |
| `invalid` | ditolak karena isi tidak sah; `fields` berisi pesan per field. Jangan dicoba ulang tanpa mengubah isi |
| `error` | galat server sementara: entri **belum diproses**; `fields._` berisi pesan. Boleh dicoba ulang apa adanya |

```json
{ "index": 3, "status": "conflict", "uid": "d3…", "rev": 131,
  "current": { "uid": "d3…", "id": "14", "merk": "Ubiquiti", "tipe": "ES 25 500W", "isCountryLock": true,
               "images": [], "detail": "…", "stickers": [], "accessories": [], "active": true, "rev": 131 } }
{ "index": 4, "status": "invalid",
  "fields": { "detail": "Maksimal 20000 karakter", "images": "Berkas 1abc… tidak ada di folder aplikasi",
              "isCountryLock": "Harus true atau false" } }
```

### 3.4 Aturan Markdown `detail`
- `\r\n` dinormalisasi menjadi `\n` sebelum dibandingkan dan disimpan.
- **Gambar di dalam Markdown** hanya boleh `![alt](drive:<idDrive>)` pada kabel; server menerjemahkannya ke rujukan internal dan sebaliknya. Id harus berada di folder aplikasi. `https://…`, `data:`, dan `qcfile:` pada push ditolak (`invalid`).
- Tautan `http`, `https`, `mailto` diperbolehkan. HTML mentah disimpan apa adanya tetapi tidak pernah dirender oleh QC App; **Desktop wajib tidak merender HTML mentah dari field ini**.
- Kolom MySQL yang cocok: **`MEDIUMTEXT`** (`utf8mb4`), karena 20.000 karakter bisa sampai ±80 KB.

### 3.5 Gambar (`images`, `stickers[].image`, `drive:` di Markdown)
- Semua id adalah **id berkas Drive di folder aplikasi**. Saat push, server memeriksa tiap id: bila berkas belum tercatat, ia didaftarkan (MIME dan ukuran dibaca dari Drive); bila tidak berada di folder aplikasi → item `invalid`.
- Menghapus id dari `images` hanya melepas gambar dari item; berkas Drive **tidak** dihapus.
- Satu berkas Drive boleh dipakai banyak item (QC App membuat satu baris `files` per item; foto yang dilepas satu item bebas dipakai item lain).
- Untuk membaca isi gambar gunakan `GET /sync/files/{id}` (§2).

### 3.6 Migrasi awal dari MySQL dan spreadsheet lama
1. Folder gambar aplikasi dikonfigurasi di server (pengaturan `DRIVE_FOLDER_ID`) **sebelum** Desktop mendorong item yang membawa gambar.
2. Desktop mendorong seluruh isi MySQL dengan `POST /sync/items/push` secara bertahap (≤ 50 item/panggilan, ≤ 25 bila membawa `detail`). Item tanpa `uid`, `id` = id MySQL.
3. Desktop lalu menarik (`GET /sync/items` dari `sinceRev=0`) untuk memeriksa hasilnya dan menyimpan kursor.
4. Setelah semua cocok, proyek GAS lama (`?action=insert|update|sync|delete`) dipensiunkan dan Desktop memakai kontrak ini.

### 3.7 Pemetaan dari protokol lama

| Protokol lama (`?action=`) | Kontrak versi 2 |
|---|---|
| `insert` | `POST /sync/items/push` (item baru) |
| `update` (hanya kolom A–D; gambar tidak ikut) | `POST /sync/items/push` (semua field sinkron ikut) |
| `sync` (hapus semua lalu tulis ulang) | `POST /sync/items/push` seluruh item; yang tidak disebut **tidak** dihapus |
| `delete` | `POST /sync/items/push` dengan `"active": false` |
| Tanpa autentikasi | `Authorization: Bearer <token>` wajib |

---

## 3b. Sumber daya `brands` (merk)

Master: **dua arah**, polanya sama dengan `items` (`rev`, hasil per entri, konflik `baseRev`/`overwrite`, `active: false` untuk nonaktif, tanpa hapus). Kunci pencocokan: `uid` → `id` → nama ternormalisasi.

```json
{ "uid": "6f1f…", "id": "3", "name": "Ubiquiti", "active": true, "rev": 12 }
```

| Field | Aturan |
|---|---|
| `uid` | id QC App (UUID); `null` pada push untuk merk baru dari MySQL |
| `id` | id MySQL (teks); `null` bila belum dipetakan; unik |
| `name` | wajib, 1–60 karakter, unik (ternormalisasi: "ubiquiti" = "Ubiquiti") |
| `active` | boolean |
| `rev` | hanya-baca (pull) |

Rute: `GET /sync/brands?sinceRev=&limit=` (halaman: `{ "brands": [...], "nextRev": n, "hasMore": bool }`; `limit` 1–500) dan `POST /sync/brands/push` (`{ "brands": [...], "baseRev"?, "overwrite"? }`, ≤ 50 merk; badan 5 MB), bentuk balasan push identik dengan `items`. **Mengganti nama merk di salah satu sisi** berlaku ke semua item merk itu; `items.merk` pada pull selalu nama merk terkini. `GET /sync/brands` tidak mengenal `include` (query itu diabaikan).

**Hubungan dengan item:** item membawa `merk` (nama). Pada `POST /sync/items/push`, merk dicocokkan menurut nama ternormalisasi; bila belum ada, QC App membuatnya otomatis (sama seperti saat mengetik di form). Push merk sebaiknya dikirim **sebelum** item agar `id` MySQL merk terpetakan.

## 4. Sumber daya stok (rencana; belum dibangun)

Dokumen ini hanya menetapkan konvensi agar sumber daya stok memakai kerangka yang sama:
- Master: **Desktop** (logika pengurangan otomatis tetap di Desktop). QC App hanya menampilkan, tanpa mengubah.
- Rute: `GET`/`POST /sync/stock-stickers…` dan `GET`/`POST /sync/stock-manuals…` (nama final ditetapkan di PRD modul Monitoring Stok).
- Bentuk dorongan: **snapshot absolut yang idempoten**, bukan selisih: `{ "key": "<kode>", "qty": 120, "asOf": "2026-10-10T03:00:00.000Z" }`. Nilai dengan `asOf` lebih lama dari yang tersimpan diabaikan (`unchanged`), sehingga permintaan yang terulang atau terbalik urutan aman.
- Spesifikasi lengkap ditulis di PRD modul Monitoring Stok.

---

## 5. Menambah sumber daya baru (untuk pengembang QC App)
1. Tambahkan id dan rute di `SYNC_API_ROUTES` (`shared/api.ts`; verba, jalur, query bertipe) dan nama sumber daya di `SYNC_RESOURCES` (`shared/sync.ts`); daftarkan handler di tabel `syncRoutes()` (`server/src/modules/sync/routes.ts`) lewat `syncRoute({ validate, handler })`. Handler menerima `{ env, actor: 'sync:desktop', requestId }`, tidak pernah `UserContext`. Registrasi rute, OpenAPI (`syncBearer`), otentikasi Bearer, pembatas, dan problem+json datang dari `server/src/modules/sync/rest.ts` tanpa kode tambahan; `shared/sync-api.test.ts` dan `server/src/modules/sync/sync.test.ts` menjaga tabel dan handler sejalan.
2. Deklarasikan: kunci pencocokan, field sinkron, master (`dua arah`/`desktop`), aturan konflik, batas ukuran.
3. Paginasi lewat `rev`: simpan `sync_rev` per baris, naikkan dengan `nextSyncRev` (dalam transaksi/CAS yang sama dengan penulisan) setiap field sinkron berubah, lalu tarik dengan `validateSyncPull` dan `paginateByRev`.
4. Push per entri: validasi tingkat permintaan dengan `validateSyncPush`, konflik dengan `baseRev`, galat entri menjadi hasil `invalid`/`error` per entri. Pakai fungsi domain yang sama dengan REST web (mis. `saveItem`).
5. Tambahkan bagian baru di dokumen ini dan tes kesesuaian (`server/src/modules/sync/*.test.ts`).

---

## 6. Riwayat versi

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1 | 2026-10 (Fase B2) | Amplop RPC `{ v, method, token, payload }` ke satu endpoint (`POST /exec` Apps Script, lalu `POST /sync`); token di badan; batas peninggalan CPU edge (pull dengan detail 50, push 5 item) sempat dipakai di endpoint Worker. |
| 2 | 2026-11-05/06 | REST `/api/v1/sync/*` dengan `Authorization: Bearer`; galat problem+json; jawaban tanpa amplop; berkas sebagai byte mentah; semua kegagalan otentikasi seragam 401; batas push/pull dikembalikan ke nilai dokumen (pull dengan detail 200, push 50/25). Disetujui pemilik produk; alasan: kontrak belum dipakai klien mana pun. Bentuk item/merk dan semantik `rev`/`baseRev`/`overwrite` tidak berubah. |
