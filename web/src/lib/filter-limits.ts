/**
 * Batas nilai pada satu filter jamak (revisi tampilan lanjutan 2026-11-22, B2b): server menolak lebih dari ini
 * (`FILTER_LIST_MAX` di `server/src/core/validate.ts`; kedua angka harus sama). Skema search param dan field pilihan
 * (`maxSelected` pada `LinkMultiField`/`MultiSelect`) memakai konstanta ini, sehingga memilih nilai ke-21 dicegah di UI
 * (opsi dinonaktifkan + pesan) dan URL tak pernah memuat larik yang akan dibuang skema.
 */
export const FILTER_LIST_MAX = 20;
