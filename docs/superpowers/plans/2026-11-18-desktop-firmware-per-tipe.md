# Rencana: firmware per Tipe (desktop Country Lock)

Spek: `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §6.6 (butir "Kode firmware per Tipe") dan §15 butir 11. Keputusan pemilik 2026-11-18: isian berupa pilihan dari daftar tetap per merk; memilih Tipe di katalog offline mengisi dan mengunci Merk + Firmware di form inject.

## Langkah (cabang `feat/desktop-firmware`)

1. **Daftar tetap** `shared/firmware.ts` (`FIRMWARE_BY_BRAND`, `firmwareBrandOf`, `firmwareOptionsFor`, `isValidFirmware`) + tes keselarasan dengan `config.QC` contoh (`countrylock/src/firmware-parity.test.ts`).
2. **Basis data**: migrasi `0023_firmware_item.sql` (`items.firmware`, expand-only, kompatibel mundur dengan image sebelumnya).
3. **Server**: `ItemRecord/ItemRow`, `toItemDto`, snapshot audit, `itemContentEquals`, validator bentuk (`readOptionalFirmware`) dan aturan merk/Country lock di `resolveItemFirmware`; `SaveItemInput.firmware` opsional.
4. **Katalog**: `CatalogItemDto.firmware` opsional (server lama tetap terbaca), query `i.firmware`.
5. **Web item**: skema form, `Select` Firmware (hanya saat Country lock; dikosongkan saat merk berganti atau Country lock dimatikan), badge di detail, label audit.
6. **Desktop (web)**: `lib/type-firmware.ts` (`resolveTypeApplication`, `tipeOptionsFor`). Bentuk awal (tombol "Pakai untuk inject" + "Lepas kunci") DIGANTI 2026-11-18 oleh dropdown Tipe di form inject sesuai aplikasi lama: lihat `docs/superpowers/plans/2026-11-18-desktop-dropdown-tipe.md`.
7. **Dokumen**: spek §6.6/§15, `CLAUDE.md`, checklist E2E I8-I10.

## Tidak berubah
Jembatan (`BRIDGE_VERSION` tetap 5), rute REST baru tidak ada, `UI_MIN_BRIDGE_VERSION` tetap.

## Belum dikerjakan
Batas ukuran cache foto katalog (Tipe otomatis dari model perangkat tidak akan dibuat: aplikasi lama tak punya); paket konfigurasi/editor/sinkron router.
