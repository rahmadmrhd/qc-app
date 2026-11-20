/** Ringkasan lokasi untuk cache memori isolate; dipakai bersama pemuat konteks akses dan daftar lokasi. */
export interface LocationBrief {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface LocationBriefRow {
  id: string;
  code: string;
  name: string;
  status: string;
}

/**
 * Lokasi terhapus (soft delete) dibaca `inactive`, sama dengan lokasi nonaktif hari ini (dan dengan `context.ts`): hilang
 * dari `me.locations` dan semua pemakai `listLocationBriefs`, tetapi tetap ada sebagai ringkasan untuk menampilkan nama.
 */
export const LOCATION_BRIEF_SQL =
  "SELECT id, code, name, CASE WHEN deleted_at = '' THEN status ELSE 'inactive' END AS status FROM locations";

export function toLocationBrief(row: LocationBriefRow): LocationBrief {
  return { id: row.id, code: row.code, name: row.name, active: row.status === 'active' };
}
