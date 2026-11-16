// Token bersama pembaca katalog Tipe offline (`DESKTOP_CATALOG_TOKEN` di server; spek desktop §6.6).
// DISUNTIKKAN saat build desktop dari env `CATALOG_TOKEN` (`scripts/build.ts` lewat `define` Bun.build), bukan ditulis di
// source atau log. Token ikut terdistribusi di installer dan dapat diekstrak: ia hanya menghalangi pengambilan sembarangan
// dari server, bukan kontrol akses (isi katalog dinilai tidak sensitif). Tanpa suntikan (build dev, tes) nilainya `null`:
// katalog dinonaktifkan dan Country Lock tetap jalan dengan Tipe dipilih manual.

declare const __CATALOG_TOKEN__: string | null | undefined;

export const CATALOG_TOKEN: string | null =
  typeof __CATALOG_TOKEN__ === 'string' && __CATALOG_TOKEN__.length > 0 ? __CATALOG_TOKEN__ : null;
