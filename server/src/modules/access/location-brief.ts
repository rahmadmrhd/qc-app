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

export const LOCATION_BRIEF_SQL = 'SELECT id, code, name, status FROM locations';

export function toLocationBrief(row: LocationBriefRow): LocationBrief {
  return { id: row.id, code: row.code, name: row.name, active: row.status === 'active' };
}
