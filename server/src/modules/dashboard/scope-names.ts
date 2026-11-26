/**
 * Nama BU dan lokasi dari cakupan beku tautan, UNTUK DITAMPILKAN (spek soft delete bagian 5: record terhapus tetap
 * tampil di tempat ia dirujuk, nama + penanda terhapus). Berbeda dari pilihan filter, yang memperlakukan record terhapus
 * seolah tak ada. Hak dihitung pemanggil: fungsi ini hanya memetakan id yang sudah sah ke nama; id yang barisnya tak
 * ada lagi dilewati. Nama + penanda disusun paralel (`names[i]` ↔ `deleted[i]`).
 */
import type { Env } from '@server/core/env';
import { formatBuLabel } from '@shared/business-units';

export interface ScopeNames {
  names: string[];
  deleted: boolean[];
}

const marks = (values: readonly unknown[]) => values.map(() => '?').join(', ');

interface NameRow {
  id: string;
  name: string;
  gone: number | string;
}

/** Urutan = urutan `ids` (cakupan beku), atau menurut nama lalu id bila `byName` (kepala halaman publik). */
function arrange(ids: readonly string[], rows: readonly NameRow[], byName: boolean): ScopeNames {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const found = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  if (byName) {
    found.sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1));
  }
  return {
    names: found.map((row) => row.name),
    deleted: found.map((row) => Number(row.gone) === 1),
  };
}

export async function buScopeNames(
  env: Env,
  ids: readonly string[],
  byName = false,
): Promise<ScopeNames> {
  if (ids.length === 0) return { names: [], deleted: [] };
  const rows = await env.DB.prepare(
    `SELECT b.id, b.code, b.name, CASE WHEN b.deleted_at = '' THEN 0 ELSE 1 END AS gone FROM business_units b WHERE b.id IN (${marks(ids)})`,
  )
    .bind(...ids)
    .all<NameRow & { code: string }>();
  const labeled = rows.results.map((row) => ({ ...row, name: formatBuLabel(row) }));
  return arrange(ids, labeled, byName);
}

export async function locationScopeNames(
  env: Env,
  ids: readonly string[],
  byName = false,
): Promise<ScopeNames> {
  if (ids.length === 0) return { names: [], deleted: [] };
  const rows = await env.DB.prepare(
    `SELECT l.id, l.name, CASE WHEN l.deleted_at = '' THEN 0 ELSE 1 END AS gone FROM locations l WHERE l.id IN (${marks(ids)})`,
  )
    .bind(...ids)
    .all<NameRow>();
  return arrange(ids, rows.results, byName);
}
