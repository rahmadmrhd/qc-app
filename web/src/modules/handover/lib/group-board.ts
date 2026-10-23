import type { HandoverStatus } from '@shared/handover';
import type { HandoverDto } from '@shared/rpc';

export const BOARD_STATUSES: readonly HandoverStatus[] = [
  'new',
  'in_progress',
  'done',
  'cancelled',
];

const STATUS_RANK: Record<HandoverStatus, number> = {
  new: 0,
  in_progress: 1,
  done: 2,
  cancelled: 3,
};

/** Rasio butir tercentang (0 bila tanpa butir). */
function progressOf(item: HandoverDto): number {
  const total = item.checklist.length;
  return total === 0 ? 0 : item.checklist.filter((entry) => entry.checked).length / total;
}

/**
 * Urutan daftar: yang belum selesai di atas. Peringkat status Baru → Dikerjakan → Selesai → Dibatalkan; di dalam
 * status terbaru dahulu (`updatedAt` menurun); pada Dikerjakan, progres lebih kecil di atas lalu terbaru.
 * Tidak mengubah masukan.
 */
export function sortBoard(items: readonly HandoverDto[]): HandoverDto[] {
  return [...items].sort((a, b) => {
    const rank = (STATUS_RANK[a.status] ?? 0) - (STATUS_RANK[b.status] ?? 0);
    if (rank !== 0) return rank;
    if (a.status === 'in_progress') {
      const progress = progressOf(a) - progressOf(b);
      if (progress !== 0) return progress;
    }
    return b.updatedAt.localeCompare(a.updatedAt) || b.number.localeCompare(a.number);
  });
}

/** Mengelompokkan task ke empat kolom status berurutan `sortBoard`. Tidak ada task yang dibuang. */
export function groupBoard(items: readonly HandoverDto[]): Record<HandoverStatus, HandoverDto[]> {
  const columns: Record<HandoverStatus, HandoverDto[]> = {
    new: [],
    in_progress: [],
    done: [],
    cancelled: [],
  };
  for (const item of sortBoard(items)) (columns[item.status] ?? columns.new).push(item);
  return columns;
}

/** Filter daftar kartu (ponsel); `all` mengembalikan semua task berurutan `sortBoard`. */
export function filterByStatus(
  items: readonly HandoverDto[],
  status: HandoverStatus | 'all',
): HandoverDto[] {
  return sortBoard(items).filter((item) => status === 'all' || item.status === status);
}
