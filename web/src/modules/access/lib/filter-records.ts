/** Penyaring daftar sederhana (kode/nama/status) di klien untuk Lokasi dan Business Unit. */
export interface CodeNameRecord {
  code: string;
  name: string;
  status: 'active' | 'inactive';
}

export interface CodeNameFilter {
  q: string;
  status: 'active' | 'inactive' | 'all';
}

export function filterCodeNameRecords<T extends CodeNameRecord>(
  rows: readonly T[],
  filter: CodeNameFilter,
): T[] {
  const query = filter.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.status !== 'all' && row.status !== filter.status) return false;
    if (!query) return true;
    return row.code.toLowerCase().includes(query) || row.name.toLowerCase().includes(query);
  });
}
