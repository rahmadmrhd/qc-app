# Desktop: Catat Serial Number memakai komponen web bersama

Tanggal: 2026-11-18. Menggantikan rancangan antrean pending + tombol "Unggah ke server" (Fase 5, PR #120) di halaman Country Lock desktop. Spek induk: `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` (§6.6, §9 Fase 5). Spek Serial Number: `docs/superpowers/specs/2026-11-12-serial-number-design.md`.

## Maksud

Pemilik produk ingin hasil inject Country Lock dicatat ke Daftar Serial Number lewat **komponen Catat Serial Number yang sama dengan web** (`RecordPage`), bukan daftar pending tersendiri. Alasannya: satu mekanisme dan satu tampilan (draft tabel, ubah baris, ubah massal, foto bukti, stiker, sample, catatan) di web dan desktop, tanpa dua UI yang harus dijaga sama. Keputusan pemilik 2026-11-18: pakai ulang komponen yang ada, draft desktop disimpan di SQLite (opsi B: "agar mekanismenya selaras"), kolom Serial dikunci untuk serial hasil inject, dan serial manual tetap dapat ditambah seperti di halaman Catat Serial Number web.

## Tujuan

- Halaman Country Lock di desktop menampilkan ringkasan draft yang belum diunggah; `RecordPage` (Default, scan/tempel, tabel draft, Simpan) dibuka dalam dialog dari tombol "Catat Serial Number" (diubah 2026-11-19 atas permintaan pemilik; semula ditanam di bawah form inject). Dialog menutup sendiri saat semua baris tersimpan (`onAllSaved`); menutupnya tidak membuang draft, karena draft dimiliki `useDraftRows` di halaman.
- Inject yang sukses menambah satu baris draft (`source: 'countrylock'`) dengan Item (Tipe), BU, dan Lokasi dari form inject, tanggal uji hari itu, `clientId` baru. Field Serial baris itu **terkunci**.
- Pengguna dapat menambah serial manual (Default + scan/tempel/kamera) dan mengubah/menghapus baris seperti di web.
- Draft bertahan di SQLite desktop, juga saat belum login atau offline; inject tetap jalan tanpa login dan tanpa server.
- Foto bukti, pilihan stiker, sample, dan catatan per baris tersedia (menutup butir "belum dikerjakan" Fase 5).

## Bukan tujuan

- Katalog offline TIDAK diperluas ke semua item. Dropdown Tipe di form inject tetap hanya item Country Lock (butuh Merk dan Firmware). Daftar **Item** di form Catat (baris manual, ubah baris, ubah massal) memuat **semua item** yang boleh dilihat pengguna lewat server (`serials.itemOptions`), sama dengan web. Konsekuensi: baris manual hanya dapat ditambah saat online dan login.
- Draft web tidak berubah (tetap `localStorage` per email).
- Tidak ada isolasi draft per akun di desktop (draft per perangkat, seperti antrean pending sebelumnya).
- Tidak ada foto bukti offline (unggah foto butuh server).

## Anti-tujuan

Dua tampilan atau dua jalur simpan yang menyimpang; kehilangan serial hasil inject karena dua penulis menimpa draft; serial hasil inject yang dapat diedit di tabel sehingga tak lagi cocok dengan perangkat yang di-inject.

## Pendekatan yang dipertimbangkan

- **A (ditolak pemilik):** pending SQLite tetap menjadi penampung offline lalu dipindah ke draft `localStorage` saat login. Perubahan kecil, tetapi ada dua penyimpanan.
- **B (dipilih pemilik):** draft Catat disimpan di SQLite desktop; pending tidak dipakai lagi UI. Satu sumber kebenaran; draft desktop dan web memakai antarmuka yang sama dengan penyimpanan berbeda.
- Jembatan per-baris (`draft.add/update/remove`) dipertimbangkan dan ditolak: `RecordPage` memutasi tabel lewat satu titik (`setAllRows`) sehingga snapshot utuh paling sederhana dan sama dengan perilaku `localStorage`.

## Rancangan

### Penyimpanan draft dan jembatan v8

- Proses utama: tabel `serial_draft` di berkas SQLite yang sama dengan pending (satu baris, `id = 1`, kolom `json`, `updated_at`; dibuat idempoten; tulis dalam transaksi). Pending dibiarkan (kompatibilitas, migrasi).
- Kanal jembatan baru `draft.load()` (mengembalikan array JSON) dan `draft.save(rows)` (mengganti seluruh snapshot). Tambah di `BRIDGE_CHANNELS`/`BRIDGE_ARGS` (`countrylock/`), handler di `ipc.ts`, preload, dan `web/src/modules/countrylock/fake-bridge.ts`. Argumen divalidasi zod: array maks. `SERIAL_LIMITS.tableRows` (1000) objek, ukuran JSON total dibatasi (8 MB); proses utama hanya menyimpan, bentuk baris disanitasi renderer saat dibaca.
- `BRIDGE_VERSION` 7 -> 8 (`DRAFT_BRIDGE_VERSION`). `UI_MIN_BRIDGE_VERSION` dinaikkan ke 8 karena UI baru memakai kanal itu: desktop lama tetap memakai UI dasar terkemasnya.
- Pembaca baris tersimpan dipakai bersama: `readRow` di `web/src/modules/serial/lib/draft-store.ts` diekspor sebagai pembaca array (`parseDraftRows`) sehingga `localStorage` dan SQLite menyaring data dengan aturan yang sama.

### Pemilik tunggal draft di renderer

- Hook `useDraftRows(bridge)` di modul countrylock memuat draft sekali (async) lalu menjadi satu-satunya pemilik tabel di halaman Country Lock: ia menyimpan snapshot ke SQLite (tunda 500 ms seperti web, dan simpan seketika saat inject menambah baris), dan mengekspos `rows`, `replace(next)`, `addInjected(entry)`.
- `RecordPage` mendapat prop opsional `draft?: { rows; replace(next) }`. Tanpa prop = perilaku web sekarang (state internal + `localStorage`). Dengan prop: `rows` berasal dari induk, `setAllRows` memanggil `replace`, penulisan `localStorage` dimatikan, dan `onDirtyChange`/`onAllSaved` opsional. Prop `hideTitle` menyembunyikan judul "Catat Serial Number" (halaman sudah berjudul Country Lock).
- Inject sukses: `use-country-lock.ts` tidak lagi memanggil `pending.add`; ia membentuk baris draft (`buildInjectedRow`) dan memanggil `addInjected`. Serial yang sudah ada di draft (normalisasi `normalizeSerial` shared) tidak digandakan: baris lama dipertahankan dan toast "Serial ... sudah ada di draft" tampil. `shouldAutoInject`/`isRegistered` (countrylock) dilonggarkan menerima daftar apa pun yang punya `serial`, sehingga Auto Inject tak mengulang serial yang sudah ada di draft.
- Isi baris hasil inject: `source: 'countrylock'`, `serial` (hasil baca perangkat), `itemId`/`itemLabel` (Tipe: `id` dan `model`), `buId`/`buLabel` dan `locationId`/`locationLabel` (label `<kode> - <nama>` seperti sekarang), `testDate` = tanggal WIB hari itu (`todayWib`), `sample: false`, `note: ''`, `stickers: null` (diselesaikan saat Simpan), `capturedAt` = waktu inject, `clientId` UUID baru. `proofMin` dilengkapi `RecordPage` dari server saat dibuka dan online (`fetchProofMins`); server tetap menegakkan aturan.
- Tanpa penjagaan versi di UI: `UI_MIN_BRIDGE_VERSION` 8 sudah memastikan UI baru tak pernah berjalan di jembatan lama.
- Prop `draft` wajib menutup SEMUA jalur tulis/hapus draft di `RecordPage` (autosave dan simpan saat unmount, `saveDraft`/`clearDraft` setelah Simpan penuh dan setelah simpan di luar halaman, tombol "Kosongkan draft", `resumeDraftWrites`), sehingga mode `draft` tak pernah menyentuh `localStorage`.
- `shouldAutoInject`/`isRegistered` di `countrylock/` TIDAK dipakai lagi oleh UI (dibiarkan untuk tesnya): Auto Inject memakai `draft.isRegistered`, yang mencocokkan serial dalam bentuk web (MAC `aa:bb:..` menjadi heksadesimal polos) seperti baris draft, sedangkan `normalizeSerial` di `countrylock/` sengaja tidak menyamakan format itu.

### Kunci kolom Serial

- Baris `source === 'countrylock'`: sel Serial di `StagingTable` hanya-baca (tanpa mode ubah), dan field serial di `RowEditDialog` dinonaktifkan dengan keterangan "Serial dari perangkat, tidak dapat diubah". Berlaku juga di web untuk baris `countrylock` dari impor `.qcsn` (keputusan perancang: seragam; serial itu berasal dari perangkat).
- Ubah massal tidak menyentuh serial (sudah begitu). Hapus baris tetap diizinkan.

### Tata letak dan akses

- Rute `country-lock.tsx` meneruskan `canRecord` ke `CountryLockPage`: `withShell` (data pengguna termuat) DAN izin `serial: edit` (`canWriteSerials`). Tanpa itu, halaman menampilkan **ringkasan draft hanya-baca** (daftar serial, Tipe, BU, Lokasi) dengan pesan "Masuk dulu" atau "Akun ini tidak punya izin mencatat Serial Number"; draft tetap tersimpan di SQLite dan muncul penuh setelah login.
- Kontainer halaman melebar (`max-w-7xl`) agar tabel draft muat; kartu form inject tetap selebar semula.
- Tidak ada penjaga keluar halaman (draft sudah tersimpan di SQLite).

### Migrasi data pending lama

Saat pertama kali `useDraftRows` memuat (jembatan >= 8): entri `pending` yang ada diubah menjadi baris draft (`source: 'countrylock'`; `clientId` dipakai ulang bila ada, selain itu baru; entri tanpa Item/BU/Lokasi menjadi baris dengan `unresolved` sehingga pengguna memilih ulang di tabel; entri duplikat serial dilewati), draft disimpan, baru kemudian entri pending itu dihapus lewat `pending.remove`. Gagal di tengah = pending tetap ada dan migrasi diulang aman (dedupe serial). `reinjectedAt` lama tidak dibawa.

### Yang dihapus

`pending-list.tsx`, `use-upload-pending.ts`, `lib/upload.ts` beserta tesnya, dan semua pemakaian `PENDING_UPLOAD_BRIDGE_VERSION` oleh UI (konstanta dan kanal `pending.*` tetap ada di jembatan untuk kompatibilitas dan migrasi). Tes `pending-upload.test.tsx` diganti tes Catat-di-desktop.

### Foto bukti dari desktop

Memakai `ProofPhotoDialog`/`ProofCameraDialog`/`StrictScanDialog` apa adanya (kamera lewat `getUserMedia`). Unggahan multipart lewat proksi `app://qc/api/*` (proksi meneruskan body sebagai stream; harus dibuktikan di Electron nyata, lihat Risiko).

## Batasan dan risiko

- **Foto multipart lewat proksi belum terbukti**: diuji di Electron nyata (login + unggah foto) sebelum klaim selesai; bila gagal, perbaikan di `api-proxy.ts` (daftar izin sudah memuat `/api/v1/*`).
- **Draft per perangkat**: foto bukti draft milik akun A ditolak server bila akun B yang menyimpan; ditangani aturan yang ada (`isProofRejection`: foto dibuang dari baris, pesan tampil).
- **Satu instans jendela**: tak ada penguncian antar proses penulis draft (aplikasi instans tunggal).
- Item wajib foto yang di-inject hanya lolos Simpan setelah fotonya dilampirkan di tabel (server menolak sebaliknya).
- `UI_MIN_BRIDGE_VERSION` 8: desktop yang belum diperbarui tidak menerima UI baru ini (UI dasarnya tetap berjalan).

## Keputusan perancang (dapat dikoreksi)

1. Penyimpanan snapshot tunggal (satu baris JSON) dan bukan satu tabel berkolom per field: mengikuti `localStorage` web dan menghindari migrasi skema tiap `StagingRow` berubah.
2. Inject berulang pada serial yang sudah ada tidak menandai `reinjectedAt`; hanya toast.
3. `testDate` baris inject = tanggal WIB hari itu (bukan tanggal lokal komputer) agar sama dengan Default web.
4. Hanya-baca serial juga berlaku bagi baris `countrylock` hasil impor `.qcsn` di web.
5. Ringkasan hanya-baca saat belum login / tanpa izin, bukan menyembunyikan draft.
6. **Logout tidak membuang draft desktop** (baris maupun rujukan foto): hasil inject adalah data perangkat dan tak boleh hilang karena keluar akun. `clearAllDrafts()` dan `draftWritesSuspended` hanya menyangkut `localStorage` web dan tak menyentuh penyimpanan SQLite. Foto bukti milik akun lain ditangani aturan penolakan server yang ada (`isProofRejection`).
7. **Draft penuh (1000 baris) memblokir inject sebelum mulai**: tombol Inject dan Auto Inject nonaktif dengan alasan "Draft penuh (maks. 1000 baris): simpan atau hapus beberapa baris dulu". Serial hasil inject tak pernah dibuang diam-diam.
8. **Catat dirender setelah draft termuat**; selama memuat tampil keterangan "Memuat draft...". Bila `draft.load` gagal (berkas rusak), tampil galat dan inject diblokir (draft tak boleh ditimpa snapshot kosong); pengguna diberi tahu lokasi berkas.
9. **Baris inject tidak melewati verifikasi impor**: BU/Lokasi dari katalog (BU milik Tipe) dipakai apa adanya; bila akun tak punya `serial: edit` pada BU itu, server menolak saat Simpan dan pesannya tampil per baris di kolom Hasil (perilaku tabel yang ada).
10. **Migrasi entri pending tanpa Item** menjadi baris dengan `unresolved: ['item']` (satu pilihan Item+BU di dialog); tanpa Lokasi saja: `['location']`. Baris dengan BU kosong tertahan oleh pemeriksaan kelengkapan Simpan yang ada.

## Pengujian

- `countrylock/`: kontrak jembatan v8 (`draft.load/save`, batas argumen), `isRegistered` longgar.
- `desktop/`: `serial-draft-store.test.ts` (simpan/muat/ganti snapshot, batas ukuran, berkas pending lama tetap terbaca), kanal IPC.
- `web/`: `useDraftRows` (muat, simpan tunda, tambah hasil inject, dedupe, migrasi pending), `RecordPage` mode `draft` (tanpa `localStorage`, Serial terkunci di tabel dan dialog), halaman Country Lock (Catat tampil bila `canRecord`, ringkasan bila tidak, inject menambah baris, Auto Inject tak mengulang serial di draft, Item = semua item), tes web `.qcsn` countrylock terkunci.
- Elektron nyata: inject -> baris muncul terkunci; tambah manual; foto bukti; Simpan ke staging; draft bertahan setelah aplikasi ditutup dan dibuka lagi.

## Dokumen yang diubah saat implementasi

Spek desktop §6.6/§9/§15 (menggantikan butir Fase 5 pending + Hapus), `CLAUDE.md` (bullet "Unggah antrean pending"), `docs/e2e-checklist-desktop.md` (I19-I22 diganti), rencana implementasi `docs/superpowers/plans/2026-11-18-desktop-catat-serial-bersama.md`.
