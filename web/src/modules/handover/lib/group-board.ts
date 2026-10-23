import type { HandoverStatus } from '@shared/handover';
import type { HandoverDto } from '@shared/rpc';

export const BOARD_STATUSES: readonly HandoverStatus[] = [
  'new',
  'in_progress',
  'done',
  'cancelled',
];

const newestFirst = (a: HandoverDto, b: HandoverDto) =>
  b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number);

/** Mengelompokkan task ke empat kolom status; tiap kolom terbaru dahulu. Tidak ada task yang dibuang. */
export function groupBoard(items: readonly HandoverDto[]): Record<HandoverStatus, HandoverDto[]> {
  const columns: Record<HandoverStatus, HandoverDto[]> = {
    new: [],
    in_progress: [],
    done: [],
    cancelled: [],
  };
  for (const item of items) (columns[item.status] ?? columns.new).push(item);
  for (const status of BOARD_STATUSES) columns[status].sort(newestFirst);
  return columns;
}

/** Filter daftar kartu (ponsel); `all` mengembalikan semua task, terbaru dahulu. */
export function filterByStatus(
  items: readonly HandoverDto[],
  status: HandoverStatus | 'all',
): HandoverDto[] {
  return items.filter((item) => status === 'all' || item.status === status).sort(newestFirst);
}
