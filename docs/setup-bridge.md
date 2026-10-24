# Setup jembatan Apps Script (`bridge/`)

Jembatan adalah proyek Apps Script **terpisah** dari aplikasi lama (`gas/`) yang hanya melayani Drive dan Sheets untuk Worker Cloudflare (Spek 8.1). Deployment `/exec` aplikasi lama TIDAK disentuh. Satu proyek jembatan per lingkungan (staging dan production), masing-masing dengan rahasia dan daftar folder sendiri.

Hasil uji kelayakan: `docs/superpowers/spikes/2026-10-bridge-roundtrip.md`.

## 1. Perintah (semuanya LOKAL; tidak ada yang mendorong ke Google)
- `bun run build:bridge` — transpile `bridge/src` ke `bridge/dist` dengan pagar yang sama seperti `gas/src` (satu global scope, fungsi berakhiran `_` kecuali `doPost`/`doGet`, API terlarang ditolak, nama global unik, berkas dimuat maju dan mundur). Ikut dalam `bun run build`.
- `bun run --cwd bridge test` dan `bun run check` — tes jembatan memakai platform memori (`bridge/test-support`).
- `bun run scripts/push-bridge.ts <staging|production>` dan `bun run scripts/deploy-bridge.ts <staging|production>` — HANYA dijalankan pemilik (butuh `clasp login` dengan akun pemilik jembatan). Agen tidak menjalankannya.

## 2. Membuat proyek (sekali per lingkungan, oleh pemilik)
1. `cd bridge && bunx @google/clasp create-script --type standalone --title "qc-bridge-<env>" --rootDir dist` (atau buat di editor Apps Script lalu salin script id). Catatan: `clasp create-script` menimpa `appsscript.json` lokal; pulihkan dari git (`git checkout bridge/appsscript.json`) sebelum `push`.
2. Salin `bridge/.clasp.example.json` menjadi `bridge/.clasp.<env>.json` dan isi `scriptId`.
3. `bun run build:bridge` lalu `bun run scripts/push-bridge.ts <env>`.
4. Di editor Apps Script: **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*. Setujui izin (Drive, Sheets, request eksternal). Salin URL `/exec` ke `BRIDGE_URL` Worker dan simpan `deploymentId` di `bridge/deployment.<env>.json` (`{"deploymentId": "..."}`) agar `deploy-bridge.ts` dapat memperbarui URL yang sama.
5. Setelah kode berubah: `push-bridge` lalu `deploy-bridge` (URL tetap).

## 3. Script Properties (Project Settings → Script properties)
| Key | Isi |
|---|---|
| `BRIDGE_SECRET` | Rahasia acak >= 32 karakter (mis. `openssl rand -hex 32`). Nilai yang sama diset di Worker: `wrangler secret put BRIDGE_SECRET`. JANGAN masuk repo, URL, atau log. |
| `ALLOWED_FOLDER_IDS` | Id folder Drive yang boleh disentuh jembatan, dipisah koma (folder gambar `DRIVE_FOLDER_ID`, folder ekspor QR `QR_FOLDER_ID`, folder dokumen QR `QR_DOC_FOLDER_ID`). Permintaan ke folder lain, atau berkas yang induknya bukan folder ini, ditolak. |
| `SPREADSHEET_ID` | Id Spreadsheet database aplikasi lama (sumber `sheets.dump`). |
| `EXPORT_SPREADSHEET_ID` | Opsional. Spreadsheet tujuan `sheets.export`; bila kosong memakai `SPREADSHEET_ID`. Sheet ekspor SELALU berawalan `export_` sehingga tidak menimpa sheet sumber. |

`drive.createFolder` membuat folder di akar Drive pemilik; id yang dihasilkan harus ditambahkan ke `ALLOWED_FOLDER_IDS` sebelum bisa dipakai. Memutar rahasia = ganti properti di jembatan dan secret di Worker bersamaan.

## 4. Protokol (untuk `BridgeClient` Task 3.2)
`POST <BRIDGE_URL>` dengan badan teks (`Content-Type: text/plain`) berupa JSON:

```json
{ "action": "drive.readFile", "ts": 1792876408048, "sig": "<hex>", "payload": { "fileId": "...", "folderId": "..." } }
```

- `ts` = epoch milidetik pengirim; diterima bila selisih dengan jam jembatan <= 2 menit (kedua arah).
- `sig` = HMAC-SHA256 heksadesimal huruf kecil, kunci `BRIDGE_SECRET`, atas string `` `${action}.${ts}.${payloadJson}` `` dengan `payloadJson = JSON.stringify(payload)` (tanpa spasi; jembatan menghitung ulang dari `JSON.parse` lalu `JSON.stringify`, jadi pengirim WAJIB menyusun payload lewat `JSON.stringify` dengan urutan kunci yang sama dengan yang ditandatangani). Payload besar disusun Worker dengan penyambungan string: `JSON.stringify(metadata)` tanpa `}` penutup + `,"base64":"` + base64 + `"}`; tanda tangan dihitung atas string yang sama.
- Setiap `sig` hanya berlaku SEKALI (jembatan menyimpan tanda tangan terpakai selama ±5 menit). Percobaan ulang jaringan WAJIB menandatangani ulang dengan `ts` baru.
- Badan maksimal 1.048.576 karakter. Respons Apps Script berupa 302 ke `script.googleusercontent.com`; `fetch` mengikutinya otomatis (Spike Task 0.2) — hitung 2 subrequest per panggilan.
- Balasan: `{ "ok": true, "data": ... }` atau `{ "ok": false, "error": "<KODE>", "message"?: "..." }`. Kode: `UNAUTHENTICATED` (seragam untuk tanda tangan salah, `ts` di luar jendela, tanda tangan diulang, badan terlalu besar/rusak, jembatan sedang memblokir, aksi di luar allowlist, folder tidak terdaftar, atau berkas bukan anak folder yang disebut), `VALIDATION`, `NOT_FOUND`, `INTERNAL` (detail hanya di log Apps Script). Sepuluh kegagalan autentikasi dalam 10 menit memblokir SEMUA permintaan selama 10 menit (pola `sync/auth`).

| Aksi | `payload` | `data` |
|---|---|---|
| `drive.createFolder` | `{ name }` | `{ id }` |
| `drive.createFile` | `{ folderId, name, mime, base64 }` | `{ id }` |
| `drive.readFile` | `{ fileId, folderId }` | `{ mime, base64 }` atau `null` (tak ada) |
| `drive.fileInfo` | `{ fileId, folderId }` | `{ mime, size }` atau `null` (tak ada/di sampah) |
| `drive.folderExists` | `{ folderId }` | `{ exists }` |
| `drive.trashFile` | `{ fileId }` | `null` (sukses juga bila tak ada) |
| `drive.externalFileInfo` | `{ fileId, resourceKey? }` | `{ name, mime, size }` atau `null` |
| `drive.readExternalFile` | `{ fileId, resourceKey? }` | `{ mime, base64 }` atau `null` |
| `drive.copyFile` | `{ fileId, folderId, name, resourceKey? }` | `{ id }` |
| `drive.renameFile` | `{ fileId, name }` | `null` (`NOT_FOUND` bila tak ada) |
| `drive.shareAnyoneWithLink` | `{ fileId }` | `null` (`NOT_FOUND` bila tak ada) |
| `drive.revokeSharing` | `{ fileId }` | `null` (sukses juga bila tak ada) |
| `drive.replaceFileContent` | `{ fileId, mime, base64 }` | `null` (`NOT_FOUND` bila tak ada) |
| `sheets.dump` | `{ sheets?: string[] }` | `{ tables: { <sheet>: string[][] } }` (baris pertama = header; sheet `export_*` tidak ikut; tanggal -> ISO UTC, semua sel teks) |
| `sheets.export` | `{ sheet, columns, rows, mode }` | `{ written }` |

Catatan `sheets.export`: `sheet` wajib cocok `^export_[a-z0-9_]{1,60}$`; `mode: "replace"` menimpa sheet (header + baris) dan membuatnya bila belum ada, `"append"` menambah baris (sheet harus sudah ada); maks. 2.000 baris, 60 kolom, 50.000 karakter per sel; semua sel ditulis sebagai TEKS (`@`). Bentuk potongan Worker: `SheetsExportChunk` di `worker/src/core/bridge-client.ts`; pembaca potongan D1: `worker/src/modules/jobs/sheets-export.ts`.

Catatan keamanan: URL web app publik di internet, jadi satu-satunya penjaga adalah HMAC + `ts` + allowlist + folder terdaftar + pembatas. Penolakan setelah tanda tangan sah (folder/induk/aksi) tidak dihitung sebagai percobaan salah. `drive.readExternalFile`/`externalFileInfo`/`copyFile` (sumber) dapat membaca berkas Drive mana pun milik pemilik jembatan bagi pemegang rahasia (dibutuhkan fitur klon PDF QR) — jaga `BRIDGE_SECRET`.
