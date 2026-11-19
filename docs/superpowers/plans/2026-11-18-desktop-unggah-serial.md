# Desktop Fase 5: unggah antrean pending ke Daftar Serial Number

Tanggal: 2026-11-18. Spek: `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §6.6 dan §9 (Fase 5). Pemilik produk menyetujui rancangan ini ("Ya, mulai Fase 5").

## Latar

Tombol "Unggah ke server" di daftar pending dinonaktifkan sejak Fase 1 karena modul Serial Number belum ada. Modul itu sudah rilis (tahap 5a/5b) dengan `serials.saveBatch` (sumber `countrylock`, `clientId` idempoten per baris). PR #115/#116 menambah BU dan Lokasi ke pending dan wajib terisi sebelum inject, jadi bahan unggah hampir lengkap; yang kurang: id item dan kunci idempoten.

## Perubahan

1. **Jembatan v7** (`countrylock/`): `PENDING_UPLOAD_BRIDGE_VERSION = 7`; `PendingEntry` dan `PendingEntrySchema` (ketat) memuat `itemId` dan `clientId` opsional. `UI_MIN_BRIDGE_VERSION` tidak berubah: UI hanya mengirim field itu dan hanya mengaktifkan unggah pada jembatan >= 7.
2. **Desktop** (`pending-store.ts`): kolom `item_id` dan `client_id` lewat `ALTER TABLE` idempoten.
3. **Web**:
   - `use-country-lock.ts`: saat inject sukses, pending mencatat `itemId` (id Tipe terpilih) dan `clientId` (`newClientId()`); aksi `refreshPending` dan `removePending`.
   - `lib/upload.ts` (murni): `uploadBlocker`, `toSerialRow`, `chunkRows`, `outcomesBySerial`, `summarize`, `newClientId`.
   - `use-upload-pending.ts`: unggah berpotongan 100, penjaga re-entry, hanya baris `created` yang dihapus dari antrean, galat panggilan menghentikan unggah.
   - `pending-list.tsx`: tombol "Unggah ke server (N)", ringkasan hasil, kolom Keterangan memuat alasan, tombol Hapus per baris dengan konfirmasi.
   - `country-lock-page.tsx`: prop `signedIn` dan `saveBatch` (bawaan sesi aplikasi dan `serials.saveBatch`; untuk tes).
4. Dokumen: spek §6.6/§9, `CLAUDE.md`, checklist E2E (I19-I22).

## Keputusan perancang yang disetujui bersama rancangan

- Tanpa kanal jembatan baru: unggah memakai klien API biasa lewat proksi Bearer (token tak pernah ke renderer).
- `sample: false`, `note: ''`, stiker tidak dikirim (bawaan server).
- Duplikat/ditolak/gagal tetap di antrean (spek §6.6), sehingga perlu tombol Hapus manual.
- Entri lama tanpa Tipe/BU/Lokasi/`clientId` tidak ditebak; ditandai "hapus lalu inject ulang".

## Tes

`lib/upload.test.ts`, `components/pending-upload.test.tsx` (tanpa login, jembatan lama, entri lama, hasil campuran, galat panggilan lalu coba lagi, klik ganda, Hapus), `catalog-use.test.tsx` (`itemId`/`clientId` tercatat; tidak pada jembatan lama), `bridge-contract.test.ts`, `pending-store.test.ts`.

## Belum dikerjakan

- **Foto bukti dari desktop**: item wajib foto ditolak server. Foto bukti butuh kamera/unggah foto di desktop; terbuka.
- Pemilihan stiker yang ditempel (bawaan server dipakai).
- Opsi "sample" dan catatan per baris.
