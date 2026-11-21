import type { HandoverDto } from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import {
  clearBoardStores,
  type DeviceRecord,
  deleteRecords,
  readAllRecords,
  writeRecords,
} from '@/lib/device-db';
import { getSession } from '@/modules/auth/session';
import type { BoardColumnData } from '@/modules/handover/lib/board-cache';
import { setBoardTaskForgetter } from '@/modules/handover/lib/board-forget';
import {
  BOARD_STORE_LIMITS,
  hasDeletedTask,
  isBoardQueryKey,
  limitColumnData,
  parseBoardQueryKey,
  withoutTask,
} from '@/modules/handover/lib/board-snapshot';
import { handoverKeys } from '@/modules/handover/queries';

/** Versi bentuk rekaman; rekaman berversi lain dibuang saat pemulihan. */
export const BOARD_STORE_VERSION = 1;
/** Batas baca IndexedDB sebelum router dibuat; hasil yang terlambat tidak diterapkan. */
export const BOARD_RESTORE_TIMEOUT_MS = 1500;
/** Batas menunggu pembersihan toko saat keluar; lewat dari ini keluar tetap dilanjutkan (tanpa galat). */
export const BOARD_CLEAR_TIMEOUT_MS = 1500;
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Pemeriksaan bentuk ringan data kolom tersimpan; rekaman rusak dibuang, bukan dipasang (UI bisa melempar). */
function isColumnData(data: unknown): data is BoardColumnData {
  if (!isObject(data) || !Array.isArray(data.pages) || !Array.isArray(data.pageParams))
    return false;
  if (data.pages.length !== data.pageParams.length) return false;
  return data.pages.every(
    (page) =>
      isObject(page) &&
      Array.isArray(page.items) &&
      page.items.every(isHandoverShape) &&
      typeof page.total === 'number' &&
      (page.nextCursor === null || typeof page.nextCursor === 'string'),
  );
}

/** Bentuk minimum task yang dibaca UI (kartu papan dan detail); dipakai bersama oleh kolom dan detail. */
function isHandoverShape(value: unknown): value is HandoverDto {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.locationId === 'string' &&
    Array.isArray(value.checklist) &&
    Array.isArray(value.comments)
  );
}

function isTaskDto(dto: unknown, id: string): dto is HandoverDto {
  return isHandoverShape(dto) && dto.id === id;
}

interface RestorePlan {
  columns: { ref: { locationIds: string[]; status: HandoverStatus }; record: ColumnRecord }[];
  tasks: { id: string; record: TaskRecord }[];
}

/** Memilah rekaman: yang sah dipasang, sisanya (pemilik lain, versi lain, bentuk rusak) dibuang dari toko. */
function planRestore(owner: string, columns: DeviceRecord[], tasks: DeviceRecord[]): RestorePlan {
  const plan: RestorePlan = { columns: [], tasks: [] };
  const junkColumns: string[] = [];
  const junkTasks: string[] = [];
  for (const record of columns as ColumnRecord[]) {
    const rest = isOwnedAndCurrent(record, owner) ? keyRest(record) : null;
    const cut = rest?.lastIndexOf('|') ?? -1;
    const ref =
      rest !== null && cut >= 0
        ? parseBoardQueryKey([
            ...handoverKeys.boards,
            rest.slice(0, cut) === '' ? [] : rest.slice(0, cut).split(','),
            rest.slice(cut + 1),
          ])
        : null;
    if (ref?.kind === 'column' && isColumnData(record.data) && !hasDeletedTask(record.data)) {
      plan.columns.push({ ref: { locationIds: ref.locationIds, status: ref.status }, record });
    } else {
      junkColumns.push(record.key);
    }
  }
  for (const record of tasks as TaskRecord[]) {
    const id = isOwnedAndCurrent(record, owner) ? keyRest(record) : null;
    if (
      id &&
      Array.isArray(record.locationIds) &&
      record.locationIds.every((l) => typeof l === 'string') &&
      isTaskDto(record.dto, id) &&
      record.dto.deleted === undefined
    ) {
      plan.tasks.push({ id, record });
    } else {
      junkTasks.push(record.key);
    }
  }
  void deleteRecords('columns', junkColumns);
  void deleteRecords('tasks', junkTasks);
  return plan;
}

/**
 * Memasang papan dan detail task tersimpan ke cache SEBELUM router dibuat (hanya untuk sesi yang sah; `owner` =
 * email hasil GET /api/v1/me). Rekaman milik pemilik lain, berversi lain, atau berbentuk rusak dibuang. Dipasang manual
 * dengan `updatedAt` = `savedAt` asli, jadi label "data terakhir" jujur dan penyimpan tidak menulis ulang dengan waktu
 * baru. Dibalap dengan batas waktu: bila terlambat, data TIDAK dipasang tetapi pembacaan selesai di latar dan
 * pembuangan rekaman yang tak sah tetap berjalan. Tidak pernah menolak.
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
    const read = Promise.all([readAllRecords('columns'), readAllRecords('tasks')]).then(
      ([columns, tasks]) => planRestore(owner, columns, tasks),
    );
    const plan = await Promise.race([read, timeout]);
    clearTimeout(timer);
    if (!plan || startedAt !== generation) return 0;

    let restored = 0;
    for (const { ref, record } of plan.columns) {
      const key = handoverKeys.column(ref.locationIds, ref.status);
      if (queryClient.getQueryData(key) !== undefined) continue;
      queryClient.setQueryData(key, record.data, { updatedAt: record.savedAt });
      restored++;
    }
    for (const { id, record } of plan.tasks) {
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

/**
 * Membuang task `id` dari toko perangkat milik `owner`: rekaman detailnya dihapus dan butirnya dicabut dari setiap
 * rekaman kolom yang memuatnya (total berkurang satu). Dipakai saat task dihapus (soft delete) atau ditolak server;
 * menulis hanya bila `guard` masih berlaku (keluar atau ganti akun di sela-sela membatalkannya).
 */
async function forgetStoredTask(owner: string, id: string, guard: () => boolean): Promise<void> {
  if (!guard()) return;
  await deleteRecords('tasks', [taskKey(owner, id)]);
  const stored = (await readAllRecords('columns')) as ColumnRecord[];
  const changed: ColumnRecord[] = [];
  for (const record of stored) {
    if (!isOwnedAndCurrent(record, owner) || !isColumnData(record.data)) continue;
    const next = withoutTask(record.data, id);
    if (next !== record.data) changed.push({ ...record, data: next });
  }
  if (changed.length > 0) {
    await writeRecords('columns', changed, BOARD_STORE_LIMITS.columns, guard);
  }
}

/** Tulis tertunda yang masih memuat task `id` dibersihkan agar tak menulis ulang task yang sudah dihapus. */
function dropFromPending(id: string): void {
  for (const [key, entry] of pending) {
    const ref = parseBoardQueryKey(entry.queryKey);
    if (ref?.kind === 'task' && ref.id === id) {
      pending.delete(key);
    } else if (ref?.kind === 'column' && entry.data !== undefined) {
      entry.data = withoutTask(entry.data as BoardColumnData, id);
    }
  }
}

async function forgetBoardTaskNow(id: string): Promise<void> {
  dropFromPending(id);
  const owner = getSession().email;
  if (!owner) return;
  const mine = generation;
  await forgetStoredTask(owner, id, () => generation === mine && getSession().email === owner);
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
  const forgetIds = new Set<string>();
  for (const entry of batch) {
    const ref = parseBoardQueryKey(entry.queryKey);
    if (!ref || entry.data === undefined) continue;
    if (ref.kind === 'task' && (entry.data as HandoverDto).deleted !== undefined) {
      // Task terhapus (dibuka pemegang hak Pulihkan) tak pernah disimpan; rekaman lamanya ikut dibuang.
      forgetIds.add(ref.id);
      continue;
    }
    if (ref.kind === 'column') {
      if (hasDeletedTask(entry.data as BoardColumnData)) continue;
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
    for (const id of forgetIds) await forgetStoredTask(owner, id, guard);
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
  setBoardTaskForgetter(forgetBoardTaskNow);
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const { action, query } = event;
    if (action.type === 'error') {
      // Penolakan server atas detail (task tak ada, sudah dihapus, atau akses dicabut) otoritatif: buang dari perangkat.
      const ref = parseBoardQueryKey(query.queryKey);
      const error = action.error;
      if (
        ref?.kind === 'task' &&
        error instanceof ApiError &&
        (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')
      ) {
        void forgetBoardTaskNow(ref.id).catch(() => undefined);
      }
      return;
    }
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
      setBoardTaskForgetter(null);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      clearTimer();
    },
  };
}

/**
 * Tab lain keluar (siaran `qc-session`): tulis yang berjalan atau tertunda dibatalkan tanpa menyentuh toko (generation
 * naik); pemanggil juga menghentikan penyimpan lewat `stop()`.
 */
export function discardBoardWrites(): void {
  generation += 1;
  pending.clear();
}

/** Keluar eksplisit: tulis yang berjalan atau tertunda dibatalkan (generation naik), lalu toko dikosongkan. */
export async function clearBoardStore(): Promise<void> {
  generation += 1;
  pending.clear();
  try {
    await clearBoardStores();
  } catch {
    // Tidak pernah menolak: keluar tak boleh terhambat.
  }
}

/**
 * `clearBoardStore` dengan batas waktu: IndexedDB yang macet tak boleh menggantung keluar (layar pengguna lama tetap
 * tampil). Timeout bukan galat; tulis lama tetap tertahan oleh `generation` yang sudah naik.
 */
export async function clearBoardStoreWithin(timeoutMs = BOARD_CLEAR_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([clearBoardStore(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function resetBoardPersistForTests(): void {
  generation = 0;
  pending.clear();
}
