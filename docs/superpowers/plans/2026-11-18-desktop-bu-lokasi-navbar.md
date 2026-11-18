# Desktop: BU + Lokasi offline, tombol sinkron di navbar, tanpa panel katalog

Tanggal: 2026-11-18. Spek: `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §6.6 dan §15 butir 14. Permintaan pemilik produk setelah uji PR #111.

## Permintaan

1. Hilangkan bagian "Katalog Tipe".
2. Tambah field Business Unit dan Lokasi di form inject; datanya disimpan lokal seperti Tipe agar Country Lock berjalan offline.
3. Pindahkan tombol Sinkronkan ke navbar beserta informasi waktu sinkron terakhir.
4. Password pada dialog kredensial tidak perlu disembunyikan (kredensial bawaan pabrik perangkat baru).

## Keputusan perancang yang menunggu koreksi pemilik

- ~~BU dan Lokasi opsional~~ **Diputuskan pemilik 2026-11-18: semua field form wajib terisi sebelum inject** (Merk, Tipe, Firmware, BU, Lokasi; juga Auto Inject). Konsekuensi: katalog belum tersinkron = inject tak dapat jalan pada build ber-katalog.
- BU yang ditawarkan **dibatasi ke BU milik Tipe terpilih** (serial Serial Number wajib ber-BU milik item); tanpa Tipe = semua BU aktif.
- Pilihan terakhir **diingat** per komputer (`localStorage`).
- Tombol sinkron tampil di **semua halaman** desktop (header `AppShell`), bukan hanya Country Lock.
- Instruksi stiker **tidak lagi tampil** di desktop (panel dihapus); datanya tetap disinkronkan.

## Perubahan

1. **Kontrak katalog** (`shared/desktop-catalog.ts`): `businessUnits?` dan `locations?` (opsional: server/cache lama tetap sah), pemeriksa bentuk. **Server** (`server/src/modules/desktop/catalog.ts`): BU aktif dan lokasi aktif, urut kode.
2. **Jembatan v6** (`countrylock/`): `PENDING_TARGET_BRIDGE_VERSION = 6`; `PendingEntry` dan `PendingEntrySchema` (ketat) memuat `buId`/`buLabel`/`locationId`/`locationLabel` opsional. `UI_MIN_BRIDGE_VERSION` tidak berubah: UI hanya menampilkan dan mengirim field itu pada jembatan >= 6.
3. **Desktop** (`pending-store.ts`): empat kolom baru lewat `ALTER TABLE ... ADD COLUMN` (idempoten, berkas lama tetap terbaca).
4. **Web**: `use-inject-target.ts` (pilihan, pembatasan BU menurut Tipe, auto-isi, ingatan), `LinkField` Business Unit dan Lokasi di `country-lock-page.tsx`, kolom BU dan Lokasi di `pending-list.tsx`, `useCatalogStatus` + `catalog-sync-button.tsx` di `AppShell` dan header ringan `/country-lock`, `catalog-panel.tsx` (dan tesnya) dihapus, `type="text"` pada password di `credential-dialog.tsx`.
5. Dokumen: spek §6.6 dan §15 butir 14, `CLAUDE.md`, checklist E2E (I1-I8 disesuaikan, I12-I16 baru).

## Tes

`shared/desktop-catalog.test.ts` (+BU/lokasi), `server/src/modules/desktop/catalog.test.ts` (+BU/lokasi aktif), `countrylock/src/bridge-contract.test.ts`, `desktop/src/main/store/pending-store.test.ts` (persistensi dan migrasi berkas lama), `catalog-use.test.tsx` (BU/lokasi: pilihan, pembatasan, auto-isi, ingatan, jembatan v5), `catalog-sync-button.test.tsx` (baru), `country-lock-page.test.tsx` (password terlihat).

## Perlu diketahui

- Server yang belum men-deploy perubahan ini tidak mengirim `businessUnits`/`locations`: dropdown BU/Lokasi tampil kosong dan nonaktif ("Belum tersinkron") sampai server di-deploy dan katalog disinkron ulang.
- Dropdown Tipe diubah dari `Select` ke `LinkField` (aturan field relasi di `CLAUDE.md`) atas permintaan pemilik 2026-11-18.
- `StickerInstructionsView` `imageSource` dan `catalogImageUrl` kini tanpa pemakai di aplikasi (dibiarkan: dipakai lagi bila instruksi ditampilkan di tempat lain).
