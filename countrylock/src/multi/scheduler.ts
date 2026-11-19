// Penjadwal slot inject (legacy L4.5, tanpa cacat "semafor diganti"): slot dibagi lewat penghitung `running < limit`,
// FIFO, dan mengubah `limit` tidak pernah mengganti objek penjadwal atau memutus yang sedang berjalan. Murni.

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 32;

export function clampConcurrency(n: number): number {
  if (!Number.isFinite(n)) return MIN_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.trunc(n)));
}

/** Galat pembatalan berbentuk `AbortError` tanpa bergantung pada `DOMException`. */
export function abortError(message = 'Dibatalkan'): Error {
  const e = new Error(message);
  e.name = 'AbortError';
  return e;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export interface Scheduler {
  /** Menunggu slot; hasilnya fungsi `release` (aman dipanggil berkali-kali). `signal` batal saat menunggu = `AbortError`. */
  acquire(signal?: AbortSignal): Promise<() => void>;
  setLimit(n: number): void;
  readonly limit: number;
  readonly running: number;
  readonly waiting: number;
}

interface Waiter {
  resolve(release: () => void): void;
  reject(e: unknown): void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | null;
}

export function createScheduler(initialLimit: number): Scheduler {
  let limit = clampConcurrency(initialLimit);
  let running = 0;
  const waiters: Waiter[] = [];

  function makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      running -= 1;
      pump();
    };
  }

  function pump(): void {
    while (running < limit && waiters.length > 0) {
      const w = waiters.shift() as Waiter;
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      running += 1;
      w.resolve(makeRelease());
    }
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise<() => void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject, signal, onAbort: null };
        if (signal) {
          waiter.onAbort = () => {
            const i = waiters.indexOf(waiter);
            if (i >= 0) waiters.splice(i, 1);
            reject(abortError());
          };
          signal.addEventListener('abort', waiter.onAbort, { once: true });
        }
        waiters.push(waiter);
        pump();
      });
    },
    setLimit(n) {
      limit = clampConcurrency(n);
      pump();
    },
    get limit() {
      return limit;
    },
    get running() {
      return running;
    },
    get waiting() {
      return waiters.length;
    },
  };
}
