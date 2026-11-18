# Pemetaan migrasi data: database QC lama (`qcspectrum`) → database QC saat ini

Status: **Pemetaan disetujui sebagian oleh pemilik produk pada 2026-11-17 (butir bertanda ✔ di §3); belum ada data yang dimigrasi.**
Sumber: dump `qcspectrum_2026-11-17_230717.sql` (MySQL 5.7.34, 16 tabel/tampilan, 28 MB, dibuat 2026-11-17 23:08 WIB).
Tujuan: skema MariaDB 11.8 di `server/migrations/0001`–`0022` (cabang `origin/dev`, commit `de2a1adb`).

## 1. Ringkasan isi dump

| Tabel lama | Baris | Peran |
|---|---:|---|
| `businessUnit` | 5 | master BU (+ penanda `-1 All`, `0 None`) |
| `location` | 4 | master lokasi (+ `-1 All`, `0 None`) |
| `users` | 12 | akun (username + hash sandi + izin teks `Kunci=True;`) |
| `typeItem` | 290 | master tipe (merk + nama + `isCountryLock` + `firmware` + daftar stiker teks) |
| `dataqc` | 210.245 | catatan serial hasil QC |
| `historyDataqc` | 221.071 | riwayat per serial (`Added`, `Re-added`, `Update on:Tipe=…`/`Test Date=…`) |
| `historyTypeItem` | 314 | riwayat perubahan tipe |
| `manualBook` / `manualBook_group` / `manualBook_location` | 49 / 57 / 98 | master Manual Book, kaitan tipe→manual book, stok+minimum per lokasi |
| `historyManualBook` | 59.077 | riwayat stok manual book (58.869 pemotongan otomatis trigger) |
| `stickerStock` / `historySticker` | 10 / 5.231 | stok 5 stiker × 2 lokasi, riwayatnya (tidak dimigrasi) |
| `files` / `tipeAttachment` | 98 / 194 | id berkas Google Drive + kaitan lampiran ke tipe |
| `*_view`, trigger, routine | – | tidak berisi data |

## 2. Pemetaan per tabel

Legenda keputusan: ✅ jelas, tanpa keputusan · ❓ butuh keputusan pemilik (lihat §3) · ⛔ tidak dimigrasi.

### 2.1 `businessUnit` → `business_units` ✔ (keputusan pemilik 2026-11-17)
- **Tabel BU lama TIDAK diikuti.** Daftar BU yang berlaku hanya **Spectrum, Teakwave, IJW**; dua baris lama dengan nama sama (`1 Spectrum Surabaya`, `3 Spectrum Jakarta`) adalah **satu BU "Spectrum"** yang berbeda lokasi.
- Pemetaan BU: lama `1`→Spectrum, `3`→Spectrum, `2`→Teakwave. BU lama `0 None` (2.658 baris) ditentukan **menurut merk tipe**: Alta & Ubiquiti→Spectrum, Mikrotik→Teakwave, VSOL & Voltech→IJW. `-1 All` tidak dipakai.
- BU dicocokkan **menurut nama** pada tujuan; yang belum ada dibuat (`code` usulan `SPC`, `TKW`, `IJW`, dapat diubah).

### 2.2 `location` → `locations` ✅❓
- `1 Surabaya`, `2 Jakarta` → `locations` (cocokkan nama; bila belum ada, dibuat). `-1`/`0` tidak dibuat.
- Fakta: lokasi selalu sepasang dengan BU: Surabaya↔Spectrum Surabaya, Jakarta↔Teakwave dan Spectrum Jakarta.
- Kode lokasi (`code`, unik; usulan `SBY`, `JKT`) dipakai hanya bila lokasi belum ada di tujuan.

### 2.3 `users` → `users` ❓
- Skema baru mengidentifikasi akun lewat **email + login Google**; sumber hanya punya `username` dan hash sandi (tak dapat dipakai). Peran lama berupa teks (`CanReadData=…`) dan `userType` angka.
- 12 baris: 2 baris sistem (`GUEST`, `System`) ⛔; 10 akun orang, 6 aktif (rahmadmrhd, Fauzan10, desmon, zarkasi, muherdi, Rizkyputra) dan 4 nonaktif.
- Usulan: **tidak membuat akun**. Nama pengguna lama hanya dipakai sebagai `actor_name` pada riwayat. Akun dibuat admin lewat Pengaturan Akses setelah email diketahui.

### 2.4 `typeItem` → `brands` + `items` (+ `item_business_units`) ✅❓
- `merk` (5 nilai: Ubiquiti 194, Mikrotik 56, VSOL 31, Alta 5, Voltech 4) → `brands` (cocok nama, `key = normalizeKey`; buat bila belum ada).
- Tiap baris → `items`: `brand_id`, `model = name`, `key = itemKey(merk, name)`, `is_country_lock` = `'true'|'false'`, `status` = `deleted=1` → `inactive`, selain itu `active`, `created_at` = waktu baris `Added to Database` di `historyTypeItem` (bila ada, jika tidak waktu migrasi). Nama lama unik se-tabel, jadi tidak ada tabrakan `key` di sumber; tabrakan dengan item yang sudah ada di tujuan dicek dan dilaporkan.
- Anomali: item `Test` (id 198, `isCountryLock=2`, dihapus) → `inactive`, `false`.
- `firmware` (236 kosong; 54 terisi: `M`, `5Ghz`, `WA`, …) → **kolom `items.firmware`** (migrasi `0023`, ada sejak 2026-11-18; keputusan pemilik 2026-11-18). Dibawa hanya bila item Country Lock DAN kodenya ada di daftar merk (`shared/firmware.ts`, `isValidFirmware`: aturan yang sama dengan validator `items.save`). Pada dump 2026-11-17 ke-54 nilai lolos (semua Country Lock Mikrotik dan Ubiquiti, tak ada kode asing). Nilai yang tak memenuhi syarat tidak dibuang: masuk `detail_md` item baru sebagai "Firmware (aplikasi lama)" dan dilaporkan sebagai peringatan. Tipe lama yang dilebur memberi firmware bila tipe induk kosong. Item yang sudah ada di tujuan: firmware hanya DIISI bila item itu Country Lock dan firmwarenya masih kosong; yang sudah berisi tidak pernah ditimpa (CSV `item.csv` kolom `aksi_firmware`: `new`, `fill`, `keep`, `skip`, `none`).
- `stickers` (teks `QC=True;CountryLock=…`) → kolom `items.stickers` lama tidak dibaca lagi. Aturan stiker baru dihitung dari jenis stiker + penanda instruksi (butuh foto pustaka). **Tidak dimigrasi per item**; lihat §2.7.
- `item_business_units` ✔ (keputusan pemilik 2026-11-17): BU merk adalah **default**: Alta & Ubiquiti→Spectrum, Mikrotik→Teakwave, VSOL & Voltech→IJW; `brand_default_business_units` diisi dengan aturan yang sama. BU item = default merk **ditambah** BU tempat serial item itu tercatat (tafsiran agar `activeItemInBu` terpenuhi; serial tidak dipindah BU). Tipe yang belum pernah dipakai serial (42) hanya mendapat BU default merk.

### 2.5 `dataqc` → `serials` ✅❓ (inti migrasi)
Pemetaan kolom: `date`→`test_date`; `idTypeItem`→`item_id`; `serialNumber`→`serial` (dinormalkan `normalizeSerial`: huruf besar, pangkas spasi, MAC `:`/`-`/`.`→12 heks); `sample`→`sample`; `note`→`note`; `last_businessUnit`→`bu_id`; `last_location`→`location_id` dan `recorded_location_id`; `status='good'`, `custody='qc'`; `client_id` = UUID deterministik dari `id` lama (idempotensi: migrasi dapat diulang tanpa menggandakan); `created_at`/`created_by` dari riwayat `Added`.

Temuan yang perlu aturan:
1. **Tabrakan keunikan.** Lama: unik `(serial, tipe)`. Baru: unik `(BU, serial)`. Dengan pemetaan BU baru (hanya baris `deleted=0`): 209.183 baris → **208.075 serial**, **1.107 grup bentrok** (1.106 berisi 2 baris, 1 berisi 3 = `INTERRUPTED`), 1.108 baris dilipat; 25 grup bertipe sama (selisih spasi), sisanya beda tipe (kemungkinan salah tipe lalu dicatat ulang); 2 grup timbul karena Spectrum Surabaya+Jakarta digabung. ✔ **Aturan: baris terbaru (tanggal lalu id terbesar) menang menjadi serial; baris lama dilipat ke riwayat serial itu** (kejadian `note` "Data lama digabung" + `data_changed` item bila tipe berbeda).
2. **BU `0 None`: 2.658 baris** ✔: BU menurut merk (lihat §2.1); lokasi `0` → **Surabaya** (keputusan pemilik 2026-11-17).
3. **Baris terhapus lunak (`deleted=1`): 1.062** ✔ dilewati dan dilaporkan di CSV (56 di antaranya serialnya juga punya baris aktif; riwayatnya ikut dilipat sebagai `note`).
4. **Serial sampah** ✔ dilewati dan dilaporkan di CSV: 88.373 non-MAC itu normal (nomor seri vendor); yang mencurigakan hanya ±15: `INTERRUPTED`(3), `UT`, `*`, `Q`, `12`, `10`, `AC8BA`, `ASFFKLDSFSD`, dan 9 baris berspasi (mis. `[11.14, 24/10/2025] RIZKYHARIADI: 0CEA14C49B9F`, `: D8B370CCD21F`). Daftar final dicetak di CSV sebelum tulis.
5. 231 serial berubah karena normalisasi (spasi ekor); 0 melebihi 64 karakter atau berkarakter kontrol; 29 baris memakai tipe yang `deleted` (tetap diimpor, tipenya `inactive`).
6. Kolom `note` 2.313 baris berisi `Jakarta` (dibawa apa adanya).
7. `serial_stickers`: sumber tak mencatat stiker per serial → **tidak diisi**; pemotongan stok lama sudah tercermin di `stickerStock` (jangan dihitung ulang). Kejadian `recorded` ditulis dengan `data.stickers=[]`.

### 2.6 `historyDataqc` → `serial_events` ✅❓
- Satu serial = satu urutan `seq` mulai 1 menurut `timestamp` lalu urutan sumber.
  - `Added to Database` → `recorded` (`occurred_on` tanggal WIB, `actor_name` = nama lengkap dari `users`, `data={stickers:[],locationId,locationName,source:'legacy'}`).
  - `Re-added to Database` (3.861) → `note` (pesan "Dicatat ulang (data lama)").
  - `Update on:Tipe=A->B` (4.474 bidang) → `data_changed` dengan `changes=[{field:'item',from:A,to:B}]`.
  - `Update on:Test Date=a->b` (2.497) → `data_changed` `{field:'testDate'}`. (Format tanggal sumber `dd/mm/yyyy`; dikonversi ISO.)
- Baris riwayat tanpa serial tujuan (serial dilewati/digabung pada butir 2.5) → digabung ke serial pemenang sebagai `note` agar jejak tidak hilang. Tak ada riwayat yatim di sumber (0).
- Zona waktu `timestamp` sumber diasumsikan WIB (UTC+7) → disimpan UTC ISO. ❓ (konfirmasi).
- `historyTypeItem` (314; 155 `Added`, 159 `Update on:…`) **tidak dimigrasi**: hanya `created_at` item diambil dari baris `Added to Database`-nya. Bentuk audit item tidak ditiru agar tidak menciptakan jejak audit yang menyesatkan; dump tetap menjadi arsipnya.

### 2.7 Stiker: `stickerStock`, `historySticker` ✔ tidak dimigrasi (keputusan pemilik 2026-11-17)
- Stok stiker lama (10 baris, nilai negatif besar) dan riwayatnya (5.231 baris) **tidak dimigrasi**. Stok di sistem baru dimulai dari opname/stok masuk oleh pengguna.
- Konsekuensi: serial yang diimpor **tidak** memotong stok (jalur impor tidak memicu `serial.recorded`; `serial_stickers` kosong; `sticker_stock_entries` tidak ditulis). Peta stiker lama→baru tidak diperlukan lagi.

### 2.8 Manual Book: `manualBook`, `manualBook_group`, `manualBook_location`, `historyManualBook` ✔ tidak dimigrasi (keputusan pemilik 2026-11-17, opsi C)
- Manual Book baru = stiker jenis sistem `manual_book` yang lahir lewat ekspor QR berkonfigurasi; sumber lama tak punya desain QR. Ke empat tabel ini **tidak dimigrasi**; Manual Book dibuat ulang lewat fitur QR. Tidak ada stok, riwayat, maupun tautan item yang dibawa.
- Konsekuensi: nilai Manual Book lama (49 buku, stok 98 baris, 57 kaitan tipe→buku) hanya tersisa di dump ini; simpan dump sebagai arsip.

### 2.9 `files`, `tipeAttachment` ⛔❓
- 98 berkas = **id Google Drive di akun lama** (PDF/gambar panduan per tipe). Tabel `files` baru butuh berkas di folder Drive yang dikelola service account + pemilik/tipe; berkas lama tidak dapat disalin tanpa akses ke Drive lama.
- Usulan: tidak menyalin berkas; tautan `https://drive.google.com/file/d/<id>` ditambahkan ke `items.detail_md` ("Lampiran lama") untuk 194 kaitan. ❓

### 2.10 Tidak dimigrasi ⛔
`dataqc_view`, `manualBook_view`, `typeItem_view`, `users_view` (turunan), trigger `dataqc` (diganti bus event `serial.recorded`), `users.password`, `GUEST`/`System`.

## 3. Keputusan pemilik produk

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 ✔ | Basis data tujuan | Latihan di skema sementara qc_dev (tunnel), lalu staging, lalu produksi (2026-11-17). Akses saya hanya ke dev; staging/produksi dijalankan pemilik. |
| 2 ✔ | BU | Tabel BU lama tidak diikuti: Spectrum, Teakwave, IJW (lihat §2.1). Cocokkan menurut nama pada tujuan. |
| 3 ✔ | Serial BU None dan lokasi | BU menurut merk; lokasi Surabaya. |
| 4 ✔ | Tabrakan (BU, serial) | Terbaru menang, lama dilipat ke riwayat. |
| 5 ✔ | Baris `deleted=1` dan serial sampah | Dilewati, dilaporkan di CSV. |
| 6 ✔ | Manual Book | Tidak dimigrasi (opsi C). |
| 7 default | Pengguna | Tidak dibuat (tanpa email); nama lama hanya di `actor_name`. Belum disanggah pemilik. |
| 8 default | Lampiran Drive lama | Tautan ditambahkan ke `detail_md` item; berkas tidak disalin. |
| 9 ✔ | `firmware` dan `historyTypeItem` | **Diubah 2026-11-18 (permintaan pemilik produk: "bawa juga isi firmware", karena kolom `items.firmware` kini ada)**: `firmware` ke kolom `items.firmware` (syarat Country Lock + kode sah; sisanya ke `detail_md` + peringatan); item tujuan yang sudah ada diisi hanya bila firmwarenya masih kosong, tak pernah ditimpa. Sebelumnya: ke `detail_md`, item yang ada tidak diubah. `historyTypeItem` tidak dimigrasi (hanya `created_at` item). |
| 10 default | Zona waktu riwayat | WIB (UTC+7). |
| 11 ✔ | Stiker lama dan stoknya | Tidak dimigrasi (2026-11-17); tidak butuh peta stiker. |
| 12 ✔ | BU serial vs BU merk | Serial tetap di BU entrinya; BU merk = default; item ditautkan ke default merk + BU pemakainya (§3a). |

Butir 7-10 memakai bawaan yang direkomendasikan; ubah bila tidak sesuai sebelum skrip dijalankan ke staging.

## 3a. BU serial vs BU merk (butir 12) ✔
BU merk hanya default. Serial **tetap di BU pada entri aslinya** (BU lama dipetakan sesuai §2.1; BU None menurut merk). ±120.479 serial berada di BU yang bukan BU merk itemnya (Spectrum/VSOL 39.979, Teakwave/Ubiquiti 38.293, Spectrum/Mikrotik 27.920, Teakwave/VSOL 8.498, Spectrum/Voltech 5.243, Teakwave/Voltech 546); agar aplikasi konsisten (`activeItemInBu`), item ditautkan juga ke BU tempat serialnya tercatat (§2.4).

## 4. Alat dan hasil latihan (2026-11-18)

Alat: `server/scripts/migrate-legacy-qc.ts` (+ `server/scripts/legacy-qc/`: `dump.ts` pembaca dump, `plan.ts` perencana murni, `apply.ts` pencocokan tujuan + penulisan, tes `*.test.ts`).

```bash
# dry-run (bawaan; hanya SELECT ke tujuan): ringkasan + CSV di --report-dir
DATABASE_URL=mysql://... bun run --cwd server scripts/migrate-legacy-qc.ts --dump qcspectrum.sql --report-dir ./laporan
# tulis (wajib menyebut nama skema tujuan persis)
DATABASE_URL=mysql://... bun run --cwd server scripts/migrate-legacy-qc.ts --dump qcspectrum.sql --apply --confirm-database <skema>
```

Aturan tujuan TIDAK kosong: BU/lokasi dicocokkan menurut nama; merk menurut `key`; item menurut `items.key` lalu `item_alias_keys` (nama lain tujuan; satu ruang kunci dengan merk+tipe); yang sudah ada **tidak diubah** (hanya tautan item-BU yang kurang ditambah); `(BU, serial)` yang sudah ada di tujuan dilaporkan di `bentrok-tujuan.csv` dan tidak ditulis; kode BU/lokasi baru yang bentrok = hambatan, penerapan dibatalkan sebelum menulis apa pun. Id turunan UUIDv5 dari id lama, jadi putaran ulang aman (`client_id` serial). Opsi `--item-bu brand|brand+serials` (bawaan `brand+serials`, tafsiran §2.4).

Hasil latihan pada skema sementara `qc_test_legacy_rehearsal` (MariaDB dev, tujuan kosong, sudah dihapus): 3 BU, 2 lokasi, 5 merk, 286 item, 486 tautan item-BU, **208.058 serial**, **219.994 kejadian** (208.058 `recorded`, 4.965 `note`, 6.971 `data_changed`) dalam ±10 menit lewat tunnel; 0 serial tanpa `recorded` seq 1, 0 serial tanpa tautan item-BU, `item_count` cocok, tanpa entri stok/`serial_stickers`; putaran kedua = 0 ditulis, 208.058 sudah dimigrasi. Dilewati 1.081 (1.062 terhapus lunak + 19 serial sampah), dilipat 1.106, dilebur 4 tipe lama berkunci sama (US-8-150W, US-16-XG, USW-Pro-24-POE, U7 Pro-XG).

Pembatalan (bila perlu): serial migrasi ditandai `serial_events.data_json.source = 'legacy'` pada kejadian `recorded`:
```sql
DELETE e FROM serial_events e JOIN serials s ON s.id = e.serial_id
  JOIN serial_events r ON r.serial_id = s.id AND r.seq = 1 AND JSON_VALUE(r.data_json, '$.source') = 'legacy';
-- lalu hapus serials yang tak punya kejadian lagi; item/merk/BU/lokasi baru dikenali dari audit_log action 'legacy.migration' dan updated_by 'migrasi-qc-lama'.
```

## 5. Urutan eksekusi berikutnya
1. Pemilik membuka akses ke staging (terowongan atau dari VPS), menjalankan **dry-run** dan meninjau CSV (`dilewati`, `dilipat`, `item`, `bentrok-tujuan`).
2. Konfirmasi ulang aturan BU item (`brand+serials`) sebelum `--apply` ke staging; uji lewat aplikasi (daftar, detail, ubah item).
3. Cadangan database, lalu `--apply` ke produksi dengan `--confirm-database`.
4. Setelah disetujui, pindahkan keputusan di §3 ke log keputusan spek terkait (butir Serial Number) dan PRD.
