# Desktop: dropdown Tipe di form inject (sesuai aplikasi lama)

Tanggal: 2026-11-18. Spek: `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §6.6 butir (4) dan §15 butir 11. Pemilik produk menyetujui setelah perbandingan dengan aplikasi asli (`rahmadmrhd/CountryLock`, `Country Lock/Page/CountryLock.xaml.cs`).

## Latar

Aplikasi lama: Merk -> **dropdown Tipe** (hanya Tipe `IsCountryLock` milik merk itu, `UpdateListTipe`) -> Firmware. Memilih Tipe berfirmware mengisi dan mengunci Firmware (`TipeBox_SelectionChanged`); inject mencatat Merk + Tipe + serial di antrean pending. Versi PR #106 memakai tombol "Pakai untuk inject" di panel katalog yang mengunci Merk + Firmware, dan kolom `tipe` di pending selalu kosong (`use-country-lock.ts`).

## Perubahan (web saja; server, kontrak, jembatan, dan migrasi tidak berubah)

1. `lib/type-firmware.ts`: `tipeOptionsFor(items, brand)` (Tipe milik merk, urut model).
2. `use-country-lock.ts`: state `tipe` (`TipeSelection`), aksi `selectTipe(item | null)` (mengisi Firmware bila berlaku, selain itu `null`), Tipe dibuang saat merk atau paket berganti, `tipe` dicatat ke `pending.add` (nilai saat inject dimulai).
3. `country-lock-page.tsx`: `Select` Tipe (clearable) di antara Merk dan Firmware, hanya bila katalog aktif; Firmware dikunci bila Tipe punya firmware valid; alasan tampil bila tidak; Merk tidak lagi dikunci; "Lepas kunci" dihapus. Satu `useCatalog` dipakai bersama panel.
4. `catalog-panel.tsx`: dipecah menjadi `CatalogPanelView` (menerima katalog + `focusId`, instruksi Tipe terpilih tampil otomatis) dan `CatalogPanel` (pembungkus mandiri, API lama tetap); tombol "Pakai untuk inject" dihapus.
5. Dokumen: spek §6.6/§15, `CLAUDE.md`, checklist E2E (I8, I9, I11), rencana firmware.

## Tes

`catalog-use.test.tsx` ditulis ulang (daftar Tipe per merk, kunci Firmware, alasan, ganti merk membuang Tipe, pending memuat `tipe`, build tanpa katalog); `type-firmware.test.ts` (+`tipeOptionsFor`).

## Tidak dikerjakan

Pemilihan Tipe otomatis dari model perangkat terbaca (aplikasi lama tak punya; baris terkait dikomentari di sumbernya).
