/**
 * Pembatas konkurensi (semafor) dengan antrean FIFO. Dipakai dashboard untuk membatasi widget yang berjalan
 * bersamaan SELURUH proses, bukan per permintaan (keputusan pemilik 2026-11-23), dan disiapkan agar laporan terjadwal
 * memakai batas yang sama. Slot SELALU dilepas lewat `finally`, jadi tugas yang gagal tidak menyumbat antrean.
 */
export interface Limiter {
  /** Menunggu giliran (FIFO), menjalankan `task`, lalu melepas slot walau `task` gagal. */
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1)
    throw new Error('Batas konkurensi harus bilangan bulat >= 1');
  let active = 0;
  const queue: (() => void)[] = [];

  function release(): void {
    const next = queue.shift();
    // Slot dioper langsung ke penunggu terdepan (active tak berkurang), menjaga urutan FIFO.
    if (next) next();
    else active -= 1;
  }

  async function acquire(): Promise<void> {
    if (active < max) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => queue.push(resolve));
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}
