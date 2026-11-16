import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/api-error';

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INTERNAL' && failureCount < 1;
}

export interface GlobalErrorDeps {
  onUnauthenticated: () => void;
  notify: (message: string) => void;
}

export function handleGlobalError(error: unknown, deps: GlobalErrorDeps): void {
  if (!(error instanceof ApiError)) return;
  if (error.code === 'UNAUTHENTICATED') deps.onUnauthenticated();
  else if (error.code === 'FORBIDDEN') deps.notify('Anda tidak memiliki akses untuk aksi ini.');
}

let unauthenticatedHandler: () => void = () => undefined;

/** Dipasang di main.tsx setelah router dibuat (menghindari import melingkar). */
export function setUnauthenticatedHandler(handler: () => void): void {
  unauthenticatedHandler = handler;
}

/**
 * Melaporkan 401 dari panggilan `api()` di luar react-query (mis. pengurasan antrean centang) agar penangan global
 * (bersihkan sesi + ke /login) tetap berjalan.
 */
export function reportUnauthenticated(): void {
  unauthenticatedHandler();
}

const globalDeps: GlobalErrorDeps = {
  onUnauthenticated: () => unauthenticatedHandler(),
  notify: (message) => toast.error(message),
};

/**
 * Selang muat ulang otomatis bawaan semua query aktif (yang sedang dipakai komponen). Query yang butuh selang lain
 * (lonceng notifikasi, polling job) menimpanya lewat `refetchInterval` sendiri.
 */
export const DEFAULT_REFETCH_INTERVAL_MS = 30_000;

export const defaultQueryOptions = {
  retry: shouldRetry,
  staleTime: 60_000,
  // Saat tab kembali terlihat, query yang sudah basi (> staleTime) langsung dimuat ulang tanpa menunggu tick berikutnya.
  refetchOnWindowFocus: true,
  refetchInterval: DEFAULT_REFETCH_INTERVAL_MS,
  // Eksplisit: berhenti saat tab tersembunyi/di latar agar tidak membebani server tanpa ada yang melihat.
  refetchIntervalInBackground: false,
} as const;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => handleGlobalError(error, globalDeps) }),
  mutationCache: new MutationCache({ onError: (error) => handleGlobalError(error, globalDeps) }),
  defaultOptions: {
    queries: defaultQueryOptions,
    mutations: { retry: false },
  },
});
