import type { HandoverDto } from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import {
  clearDeviceDb,
  type DeviceRecord,
  deleteRecords,
  readAllRecords,
  writeRecords,
} from '@/lib/device-db';
import { getSession } from '@/modules/auth/session';
import type { BoardColumnData } from '@/modules/handover/lib/board-cache';
import {
  BOARD_STORE_LIMITS,
  isBoardQueryKey,
  limitColumnData,
  parseBoardQueryKey,
} from '@/modules/handover/lib/board-snapshot';
import { handoverKeys } from '@/modules/handover/queries';

/** Versi bentuk rekaman; rekaman berversi lain dibuang saat pemulihan. */
export const BOARD_STORE_VERSION = 1;
/** Batas baca IndexedDB sebelum router dibuat; hasil yang terlambat tidak diterapkan. */
export const BOARD_RESTORE_TIMEOUT_MS = 1500;
/** Penundaan penggabungan tulis setelah sukses query. */
export const BOARD_SAVE_DELAY_MS = 1500;

interface ColumnRecord extends DeviceRecord {
  data: BoardColumnData;
}
interface TaskRecord extends DeviceRecord {
  locationIds: string[];
  dto: HandoverDto;
}

interface Pending {
  queryKey: readonly unknown[];
  data: unknown;
  savedAt: number;
}

// Keadaan modul: `generation` naik tiap `clearBoardStore` (keluar eksplisit) sehingga tulis yang sedang berjalan
// atau terjadwal milik sesi lama tidak pernah menulis sesudahnya. `pending` dibagi semua instance.
let generation = 0;
const pending = new Map<string, Pending>();

const columnKey = (owner: string, locationIds: readonly string[], status: string) =>
  `${owner}|${[...locationIds].sort().join(',')}|${status}`;
const taskKey = (owner: string, id: string) => `${owner}|${id}`;

/** Sisa kunci rekaman setelah awalan `owner|` (pemilik dibandingkan lewat kolom `owner`, bukan awalan saja). */
function keyRest(record: DeviceRecord): string | null {
  const prefix = `${record.owner}|`;
  return record.key.startsWith(prefix) ? record.key.slice(prefix.length) : null;
}

function isOwnedAndCurrent(record: DeviceRecord, owner: string): boolean {
  return record.owner === owner && record.v === BOARD_STORE_VERSION;
}

/**
 * Memasang papan dan detail task tersimpan ke cache SEBELUM router dibuat (hanya untuk sesi yang sah; `owner` =
 * email hasil GET /api/v1/me). Rekaman milik pemilik lain atau berversi lain dibuang. Dipasang manual dengan
 * `updatedAt` = `savedAt` asli, jadi label "data terakhir" jujur dan penyimpan tidak menulis ulang dengan waktu baru.
 * Dibalap dengan batas waktu; tidak pernah menolak.
 */
export async function restoreBoardCache(
  queryClient: QueryClient,
  owner: string,
  options: { timeoutMs?: number } = {},
): Promise<number> {
  try {
    const startedAt = generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), options.timeoutMs ?? BOARD_RESTORE_TIMEOUT_MS);
    });
    const read = Promise.all([readAllRecords('columns'), readAllRecords('tasks')]);
    const result = await Promise.race([read, timeout]);
    clearTimeout(timer);
    if (!result || startedAt !== generation) return 0;
    const [columns, tasks] = result;

    const staleColumns = columns.filter((r) => !isOwnedAndCurrent(r, owner)).map((r) => r.key);
    const staleTasks = tasks.filter((r) => !isOwnedAndCurrent(r, owner)).map((r) => r.key);
    void deleteRecords('columns', staleColumns);
    void deleteRecords('tasks', staleTasks);

    let restored = 0;
    for (const record of columns as ColumnRecord[]) {
      if (!isOwnedAndCurrent(record, owner)) continue;
      const rest = keyRest(record);
      const cut = rest?.lastIndexOf('|') ?? -1;
      if (rest === null || cut < 0 || !record.data) continue;
      const ref = parseBoardQueryKey([
        ...handoverKeys.boards,
        rest.slice(0, cut) === '' ? [] : rest.slice(0, cut).split(','),
        rest.slice(cut + 1),
      ]);
      if (ref?.kind !== 'column') continue;
      const key = handoverKeys.column(ref.locationIds, ref.status);
      if (queryClient.getQueryData(key) !== undefined) continue;
      queryClient.setQueryData(key, record.data, { updatedAt: record.savedAt });
      restored++;
    }
    for (const record of tasks as TaskRecord[]) {
      if (!isOwnedAndCurrent(record, owner)) continue;
      const id = keyRest(record);
      if (!id || !record.dto || !Array.isArray(record.locationIds)) continue;
      const key = handoverKeys.one(id, record.locationIds);
      if (queryClient.getQueryData(key) !== undefined) continue;
      queryClient.setQueryData(key, record.dto, { updatedAt: record.savedAt });
      restored++;
    }
    return restored;
  } catch {
    return 0;
  }
}

async function flushPending(): Promise<void> {
  const batch = [...pending.values()];
  pending.clear();
  const owner = getSession().email;
  if (!owner || batch.length === 0) return;
  const mine = generation;
  const guard = () => generation === mine && getSession().email === owner;

  const columns: ColumnRecord[] = [];
  const tasks: TaskRecord[] = [];
  for (const entry of batch) {
    const ref = parseBoardQueryKey(entry.queryKey);
    if (!ref || entry.data === undefined) continue;
    if (ref.kind === 'column') {
      columns.push({
        key: columnKey(owner, ref.locationIds, ref.status),
        owner,
        v: BOARD_STORE_VERSION,
        savedAt: entry.savedAt,
        data: limitColumnData(entry.data as BoardColumnData, BOARD_STORE_LIMITS.tasksPerColumn),
      });
    } else {
      tasks.push({
        key: taskKey(owner, ref.id),
        owner,
        v: BOARD_STORE_VERSION,
        savedAt: entry.savedAt,
        locationIds: ref.locationIds,
        dto: entry.data as HandoverDto,
      });
    }
  }
  try {
    if (columns.length > 0) {
      await writeRecords('columns', columns, BOARD_STORE_LIMITS.columns, guard);
    }
    if (tasks.length > 0) {
      await writeRecords('tasks', tasks, BOARD_STORE_LIMITS.detailTasks, guard);
    }
  } catch {
    // writeRecords tidak pernah menolak; jaga-jaga agar penyimpan tak pernah melempar.
  }
}

/**
 * Menyimpan papan dan detail task ke IndexedDB dari sukses query non-`manual` (ditunda dan digabung; juga saat tab
 * disembunyikan/ditutup). Penulisan pemulihan dan patch optimistis bersifat manual, jadi tidak pernah ditulis ulang.
 */
export function startBoardPersistence(queryClient: QueryClient): {
  flush(): Promise<void>;
  stop(): void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = () => {
    clearTimer();
    return flushPending();
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const { action, query } = event;
    if (action.type !== 'success' || action.manual) return;
    if (!isBoardQueryKey(query.queryKey)) return;
    pending.set(JSON.stringify(query.queryKey), {
      queryKey: query.queryKey,
      data: query.state.data,
      savedAt: query.state.dataUpdatedAt,
    });
    if (timer === null) timer = setTimeout(() => void flush(), BOARD_SAVE_DELAY_MS);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  const onPageHide = () => void flush();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  return {
    flush,
    stop() {
      unsubscribe();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      clearTimer();
    },
  };
}

/** Keluar eksplisit: tulis yang berjalan atau tertunda dibatalkan (generation naik), lalu toko dikosongkan. */
export async function clearBoardStore(): Promise<void> {
  generation += 1;
  pending.clear();
  try {
    await clearDeviceDb();
  } catch {
    // Tidak pernah menolak: keluar tak boleh terhambat.
  }
}

export function resetBoardPersistForTests(): void {
  generation = 0;
  pending.clear();
}
