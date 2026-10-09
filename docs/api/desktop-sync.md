# Kontrak API Sinkronisasi QC App ⇄ QC Desktop

| | |
|---|---|
| **Versi API** | 1 |
| **Status** | Draf — menunggu persetujuan PRD (`docs/prd/2026-10-09-qc-item-serah-terima.md`, bagian 4.8) |
| **Pengguna** | QC Desktop (di balik VPN, terhubung ke MySQL). QC App web tidak pernah berbicara ke MySQL. |
| **Dibangun di** | Fase B2 (kerangka + sumber daya `items`); sumber daya stok menyusul |

Dokumen ini adalah kontrak antara dua proyek terpisah. Perubahan yang tidak kompatibel menaikkan `v`.

---

## 1. Transport dan autentikasi

- **Endpoint:** `POST <URL /exec QC App>` (mis. `https://script.google.com/macros/s/<deploymentId>/exec`).
- **Body:** JSON (`Content-Type: text/plain;charset=utf-8` atau `application/json`). Token **hanya** di body, jangan pernah di URL (URL tercatat di log).
- **Redirect:** Apps Script menjawab `POST` dengan `302` ke alamat `script.googleusercontent.com`. Ikuti redirect itu dengan `GET` **tanpa mengirim ulang body** (perilaku bawaan `axios`, `node-fetch`, `HttpClient`, `requests`). Jangan mengulang `POST` ke alamat redirect.
- **Token:** Script Property `SYNC_API_TOKEN` (≥ 32 karakter acak). Satu token bersama untuk Desktop. Memutar token = mengganti properti lalu mengganti konfigurasi Desktop.
- **Pembatas percobaan salah:** 10 token salah dalam 10 menit membuat semua permintaan ditolak 10 menit.
- **Batas ukuran:** body ≤ 5 MB; satu panggilan harus selesai < 5 menit (batas Apps Script 6 menit); gunakan paginasi.

### Amplop permintaan
```json
{ "v": 1, "method": "sync.items.push", "token": "<SYNC_API_TOKEN>", "payload": { } }
```

### Amplop balasan (sama dengan RPC web)
```json
{ "ok": true, "data": { } }
```
```json
{ "ok": false, "error": { "code": "VALIDATION", "message": "Input tidak valid", "requestId": "a1b2c3d4", "fields": { "items": "Maksimal 200 item" } } }
```

| `error.code` | Arti |
|---|---|
| `UNAUTHENTICATED` | token salah, hilang, atau sedang dibatasi (pesan tidak membedakan alasannya) |
| `VALIDATION` | amplop atau payload salah bentuk (kesalahan per item ada di hasil per item, lihat bawah) |
| `NOT_FOUND` | `method` tidak dikenal, atau berkas tidak ada |
| `INTERNAL` | galat server; sertakan `requestId` saat melapor |

`CONFLICT` **tidak** muncul sebagai galat tingkat atas; ia hanya muncul sebagai status per item.

---

## 2. Metode umum

### `sync.ping`
Menguji token dan koneksi.
```json
{ "v": 1, "method": "sync.ping", "token": "…", "payload": null }
```
```json
{ "ok": true, "data": { "apiVersion": 1, "serverTime": "2026-10-10T03:00:00.000Z", "resources": ["items"] } }
```

### `sync.file.get`
Mengambil isi gambar bertoken. Hanya berkas yang berada di **folder gambar aplikasi** (`DRIVE_FOLDER_ID`); id lain → `NOT_FOUND`.
```json
{ "v": 1, "method": "sync.file.get", "token": "…", "payload": { "driveId": "1iipMYHrqe62YysVgZOJ_R0nJBHptnx45" } }
```
```json
{ "ok": true, "data": { "driveId": "1iipMYHrqe62YysVgZOJ_R0nJBHptnx45", "mime": "image/webp", "base64": "UklGR…" } }
```
Ukuran berkas ≤ 8 MB (lebih besar → `VALIDATION`). Cache hasilnya di Desktop berdasarkan `driveId` (isi berkas untuk id yang sama tidak berubah).

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

**Tidak disinkronkan:** nama lain/alias (khusus QC App).

### 3.2 `sync.items.pull`

```json
{ "v": 1, "method": "sync.items.pull", "token": "…",
  "payload": { "sinceRev": 120, "limit": 100, "include": ["detail", "stickers", "accessories"] } }
```

| Field | Aturan |
|---|---|
| `sinceRev` | integer ≥ 0; hanya item dengan `rev` > nilai ini. Mulai dari `0`. |
| `limit` | 1–500 (default 100). Dibatasi 200 bila `include` memuat `detail`. |
| `include` | opsional; subset dari `detail`, `stickers`, `accessories`. Field yang tidak diminta tidak dikirim. `images`, `id`, `uid`, `merk`, `tipe`, `isCountryLock`, `active`, `rev` selalu dikirim. |

```json
{ "ok": true, "data": { "items": [ { "...item..." } ], "nextRev": 128, "hasMore": false } }
```
Simpan `nextRev` sebagai kursor. Bila `hasMore` benar, panggil lagi dengan `sinceRev = nextRev`. Urutan hasil menurut `rev` naik. Item yang tidak berubah di sisi sinkron tidak muncul (perubahan `alias` tidak menaikkan `rev`).

### 3.3 `sync.items.push`

```json
{ "v": 1, "method": "sync.items.push", "token": "…",
  "payload": {
    "overwrite": false,
    "items": [
      { "id": "12", "merk": "Ubiquiti", "tipe": "ES 24 250W", "isCountryLock": false,
        "images": ["1iipMYHrqe62YysVgZOJ_R0nJBHptnx45"],
        "detail": "## Spesifikasi\n- Port: 24x GbE\n",
        "stickers": [ { "name": "Label SNI", "note": "Belakang bodi", "image": null } ],
        "accessories": [ { "name": "Kabel daya", "qty": 1 } ],
        "baseRev": 120 },
      { "id": "13", "merk": "Ubiquiti", "tipe": "ES 24 Lite", "isCountryLock": "false" }
    ] } }
```

**Semantik field (berlaku untuk `images`, `detail`, `stickers`, `accessories`, `active`):**

| Di payload | Efek |
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

**Batas:** ≤ 200 item per panggilan, ≤ 100 bila ada yang memuat `detail`; total body ≤ 5 MB.

**Balasan** — satu hasil per item, urutan sama dengan permintaan; kegagalan satu item tidak membatalkan yang lain:
```json
{ "ok": true, "data": { "results": [
  { "index": 0, "status": "updated",   "uid": "b1c7e0a4-…", "rev": 129 },
  { "index": 1, "status": "unchanged", "uid": "c20f91d2-…", "rev": 77 },
  { "index": 2, "status": "created",   "uid": "e4a9…",      "rev": 130 }
] } }
```

| `status` | Arti |
|---|---|
| `created` | item baru dibuat |
| `updated` | ada field yang berubah; `rev` baru |
| `unchanged` | nilai sama dengan yang tersimpan; tidak ada perubahan |
| `conflict` | ditolak; `current` memuat item terkini (selalu dengan `detail`, `stickers`, `accessories`) |
| `invalid` | ditolak karena isi tidak sah; `fields` berisi pesan per field |

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
- Untuk membaca isi gambar gunakan `sync.file.get`.

### 3.6 Migrasi awal dari MySQL dan spreadsheet lama
1. Isi Script Property `DRIVE_FOLDER_ID` dengan id folder gambar lama **sebelum** menjalankan `setup`.
2. Desktop mendorong seluruh isi MySQL dengan `sync.items.push` secara bertahap (≤ 200 item/panggilan). Item tanpa `uid`, `id` = id MySQL.
3. Desktop lalu menarik (`sync.items.pull` dari `sinceRev: 0`) untuk memeriksa hasilnya dan menyimpan kursor.
4. Setelah semua cocok, proyek GAS lama (`?action=insert|update|sync|delete`) dipensiunkan dan Desktop memakai kontrak ini.

### 3.7 Pemetaan dari protokol lama

| Protokol lama (`?action=`) | Kontrak baru |
|---|---|
| `insert` | `sync.items.push` (item baru) |
| `update` (hanya kolom A–D; gambar tidak ikut) | `sync.items.push` (semua field sinkron ikut) |
| `sync` (hapus semua lalu tulis ulang) | `sync.items.push` seluruh item; yang tidak disebut **tidak** dihapus |
| `delete` | `sync.items.push` dengan `"active": false` |
| Tanpa autentikasi | token wajib |

---

## 4. Sumber daya stok (rencana; belum dibangun)

Dokumen ini hanya menetapkan konvensi agar sumber daya stok memakai kerangka yang sama:
- Master: **Desktop** (logika pengurangan otomatis tetap di Desktop). QC App hanya menampilkan, tanpa mengubah.
- Metode: `sync.stockStickers.push`/`.pull`, `sync.stockManuals.push`/`.pull`.
- Bentuk dorongan: **snapshot absolut yang idempoten**, bukan selisih: `{ "key": "<kode>", "qty": 120, "asOf": "2026-10-10T03:00:00.000Z" }`. Nilai dengan `asOf` lebih lama dari yang tersimpan diabaikan (`unchanged`), sehingga permintaan yang terulang atau terbalik urutan aman.
- Spesifikasi lengkap ditulis di PRD modul Monitoring Stok.

---

## 5. Menambah sumber daya baru (untuk pengembang QC App)
1. Daftarkan di tabel rute sinkron (`gas/src/modules/sync/routes.ts`) dengan `validate` dan `handler`; handler menerima `{ actor: 'sync:desktop', requestId }`, tidak pernah `UserContext`.
2. Deklarasikan: kunci pencocokan, field sinkron, master (`dua arah`/`desktop`), aturan konflik, batas ukuran.
3. Pakai penghitung revisi per sumber daya (`sync_state`) bila perlu paginasi lewat `rev`.
4. Tambahkan bagian baru di dokumen ini dan tes kesesuaian (`gas/src/modules/sync/*.test.ts`).
