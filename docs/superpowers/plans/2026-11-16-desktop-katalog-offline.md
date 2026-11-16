# Rencana: Katalog Tipe offline desktop

Spek: `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` §6.6 dan §9 (Fase 2, potongan pertama). Keputusan pemilik 2026-11-16: cakupan katalog offline saja (field `firmware`, paket konfigurasi, editor, dan sinkron router menyusul), akses baca lewat token bersama tanpa login, katalog memuat semua item aktif `isCountryLock` tanpa saringan BU.

## Langkah (semuanya dikerjakan di cabang `feat/desktop-katalog-offline`)

1. **Kontrak** `shared/desktop-catalog.ts`: DTO, `parseDesktopCatalog`, `CATALOG_FILE_ID`, `catalogFileIds`.
2. **Server**: `DESKTOP_CATALOG_TOKEN` (config, env, compose, `.env.example`); `server/src/modules/desktop/catalog.ts` (penyusun potret deterministik + memo 30 dtk); rute `GET /api/desktop/catalog` dan `/catalog/files/<id>` di `desktopApp` (token waktu-konstan, 404 seragam, batas gagal per IP, `no-store`, berkas hanya yang dirujuk).
3. **Desktop**: `catalog-store` (cache atomik di `userData/catalog`), `catalog-sync` (ETag, unduh berkas utuh dulu, katalog lama dipertahankan saat gagal), injeksi token saat build (`CATALOG_TOKEN`), pemicu buka/fokus/tiap jam.
4. **Jembatan v5**: kanal `catalog.get|refresh|status|onChange`, gambar via `app://qc/catalog-files/<id>`; `MIN_BRIDGE_VERSION` tetap 2.
5. **Web**: `use-catalog.ts` dan `CatalogPanel` di halaman Country Lock; `StickerInstructionsView` menerima `imageSource`.
6. **Dokumen**: `CLAUDE.md`, `docs/e2e-checklist-desktop.md` bagian I, `docs/deploy-vps.md`.

## Prasyarat rilis

- Isi `DESKTOP_CATALOG_TOKEN` di `.env` VPS (staging/production) SEBELUM push yang men-deploy.
- Bangun desktop dengan `CATALOG_TOKEN` bernilai sama.

## Belum dikerjakan

Field `firmware` per item dan pemilihan Tipe/firmware otomatis saat inject; batas ukuran cache foto; paket konfigurasi, editor, sinkron router.
