import type { HandoverStatus } from '@shared/handover';
import { BOARD_KEY, type BoardColumnData } from './board-cache';
import { BOARD_STATUSES } from './group-board';

/** Batas data papan yang disimpan di perangkat (Fase 3 Tahap B). */
export const BOARD_STORE_LIMITS = { tasksPerColumn: 50, detailTasks: 100, columns: 40 } as const;

/**
 * Memotong cache satu kolom ke paling banyak `max` item pada batas halaman UTUH: halaman dipertahankan dari depan
 * selama jumlah item kumulatif <= `max` (halaman pertama selalu disimpan). `nextCursor` halaman terakhir yang tersisa
 * tidak diubah, jadi "muat lagi" tetap berfungsi. Tanpa pemotongan = objek yang sama.
 */
export function limitColumnData(data: BoardColumnData, max: number): BoardColumnData {
  let kept = 0;
  let count = 0;
  for (const page of data.pages) {
    if (kept > 0 && count + page.items.length > max) break;
    count += page.items.length;
    kept += 1;
  }
  if (kept === data.pages.length) return data;
  return { pages: data.pages.slice(0, kept), pageParams: data.pageParams.slice(0, kept) };
}

export type BoardQueryRef =
  | { kind: 'column'; locationIds: string[]; status: HandoverStatus }
  | { kind: 'task'; id: string; locationIds: string[] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Mengenali kunci kolom papan (`['handovers','board', lokasi, status]`) dan detail task (`['handovers','one', id, lokasi]`). */
export function parseBoardQueryKey(key: readonly unknown[]): BoardQueryRef | null {
  if (key[0] !== BOARD_KEY[0]) return null;
  if (key[1] === BOARD_KEY[1]) {
    const [, , locationIds, status] = key;
    if (key.length !== 4 || !isStringArray(locationIds)) return null;
    const known = BOARD_STATUSES.find((entry) => entry === status);
    return known ? { kind: 'column', locationIds, status: known } : null;
  }
  if (key[1] === 'one') {
    const [, , id, locationIds] = key;
    if (key.length !== 4 || typeof id !== 'string' || !isStringArray(locationIds)) return null;
    return { kind: 'task', id, locationIds };
  }
  return null;
}

export function isBoardQueryKey(key: readonly unknown[]): boolean {
  return parseBoardQueryKey(key) !== null;
}
