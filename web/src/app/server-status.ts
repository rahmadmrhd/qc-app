import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api/api-error';
import { isBoardQueryKey } from '@/modules/handover/lib/board-snapshot';
import { isPersistedQueryKey } from './query-persist';

export interface ServerStatus {
  /** Waktu (ms) data terakhir yang masih ditampilkan; null = server normal. */
  unavailableSince: number | null;
}

const NORMAL: ServerStatus = { unavailableSince: null };
let status: ServerStatus = NORMAL;
const listeners = new Set<() => void>();

function publish(since: number | null) {
  if (since === status.unavailableSince) return;
  status = since === null ? NORMAL : { unavailableSince: since };
  for (const listener of [...listeners]) listener();
}

/** `hh:mm` (jam peramban) dengan titik dua; `id-ID` memakai titik, jadi dirakit dari bagiannya. */
export function formatClock(ms: number): string {
  const parts = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** Query whitelist (atau papan/detail task Serah Terima, yang disimpan di IndexedDB) yang punya data tetapi refetch terakhirnya gagal UNAVAILABLE; waktunya = dataUpdatedAt terbaru. */
function scan(queryClient: QueryClient): number | null {
  let since: number | null = null;
  for (const query of queryClient.getQueryCache().findAll()) {
    const { error, data, dataUpdatedAt } = query.state;
    if (
      (isPersistedQueryKey(query.queryKey) || isBoardQueryKey(query.queryKey)) &&
      data !== undefined &&
      error instanceof ApiError &&
      error.code === 'UNAVAILABLE'
    ) {
      since = since === null ? dataUpdatedAt : Math.max(since, dataUpdatedAt);
    }
  }
  return since;
}

/**
 * Memantau QueryCache/MutationCache untuk spanduk "data terakhir" (FR-P16). Menyala hanya dari kegagalan nyata;
 * padam oleh sukses non-manual (query atau mutasi). `setQueryData` (patch optimistis, simpan lokal) juga memancarkan
 * `success` tetapi bertanda `manual`, jadi tidak dianggap bukti server pulih.
 */
export function startServerStatus(queryClient: QueryClient): () => void {
  const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') {
      if (status.unavailableSince !== null) publish(scan(queryClient));
      return;
    }
    if (event.type !== 'updated') return;
    const action = event.action;
    if (action.type === 'error') {
      publish(scan(queryClient));
    } else if (action.type === 'success') {
      if (action.manual) {
        // Hanya berpengaruh bila yang ditulis adalah query yang sedang gagal (galatnya ikut terhapus).
        if (status.unavailableSince !== null) publish(scan(queryClient));
      } else {
        publish(null);
      }
    }
  });
  const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') publish(null);
  });
  return () => {
    unsubscribeQueries();
    unsubscribeMutations();
    publish(null);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getServerStatus(): ServerStatus {
  return status;
}

export function useServerStatus(): ServerStatus {
  return useSyncExternalStore(subscribe, getServerStatus, getServerStatus);
}

export function resetServerStatusForTests(): void {
  publish(null);
}
