import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RpcError } from '@/lib/rpc/rpc-error';

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return error instanceof RpcError && error.code === 'INTERNAL' && failureCount < 1;
}

export interface GlobalErrorDeps {
  onUnauthenticated: () => void;
  notify: (message: string) => void;
}

export function handleGlobalError(error: unknown, deps: GlobalErrorDeps): void {
  if (!(error instanceof RpcError)) return;
  if (error.code === 'UNAUTHENTICATED') deps.onUnauthenticated();
  else if (error.code === 'FORBIDDEN') deps.notify('Anda tidak memiliki akses untuk aksi ini.');
}

let unauthenticatedHandler: () => void = () => undefined;

/** Dipasang di main.tsx setelah router dibuat (menghindari import melingkar). */
export function setUnauthenticatedHandler(handler: () => void): void {
  unauthenticatedHandler = handler;
}

const globalDeps: GlobalErrorDeps = {
  onUnauthenticated: () => unauthenticatedHandler(),
  notify: (message) => toast.error(message),
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => handleGlobalError(error, globalDeps) }),
  mutationCache: new MutationCache({ onError: (error) => handleGlobalError(error, globalDeps) }),
  defaultOptions: {
    queries: { retry: shouldRetry, staleTime: 60_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
