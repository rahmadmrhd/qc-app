/**
 * Nama dasar indeks unik: membuang akhiran `_live` (indeks unik yang menyertakan `deleted_at`, soft delete). Kode yang
 * memetakan galat duplikat atau membandingkan `DbError.key` memakai nama dasar agar tetap benar baik pada skema expand
 * (indeks lama dan `_live` berdampingan) maupun setelah migrasi contract (hanya `_live`).
 */
export function baseIndexName(name: string): string {
  return name.endsWith('_live') ? name.slice(0, -'_live'.length) : name;
}
