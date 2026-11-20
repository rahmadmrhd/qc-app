import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runBusy } from '@/app/pwa/busy';
import { errorText } from './error-text';
import type { FileSource, LibraryItem, QueuedFile } from './types';

export type UploadPhase = 'waiting' | 'preparing' | 'uploading' | 'processing' | 'failed';

export interface UploadEntry {
  key: string;
  /** Pemilik entri (mis. id baris/field): satu hook melayani banyak pemilik sekaligus. */
  owner: string;
  file: File;
  name: string;
  phase: UploadPhase;
  /** 0..1 untuk tahap berpersen; null = tanpa persen. */
  fraction: number | null;
  error: string | null;
}

export interface OwnerUploads {
  entries: readonly UploadEntry[];
  /** Ada entri yang belum gagal (menunggu atau berjalan). */
  busy: boolean;
  hasFailed: boolean;
  add(files: readonly QueuedFile[]): void;
  /** Mengulang entri `failed`; entri lain diabaikan. */
  retry(key: string): void;
  /** Membuang entri; yang sedang berjalan dibatalkan. */
  remove(key: string): void;
}

export interface BackgroundUploads {
  entries: readonly UploadEntry[];
  busy: boolean;
  hasFailed: boolean;
  forOwner(owner: string): OwnerUploads;
  /** Membatalkan dan membuang semua entri milik `owner`. */
  cancelOwner(owner: string): void;
}

export interface BackgroundUploadsOptions {
  source: FileSource;
  /** Bawaan 3. */
  concurrency?: number;
  /**
   * Dipanggil per hasil sukses. Mengembalikan `false` = hasil ditolak (mis. field penuh) dan dibuang lewat
   * `source.onDiscard`; selain itu entri dibuang dari daftar karena hasilnya sudah diklaim pemanggil.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: pemanggil boleh tak mengembalikan apa pun (= diterima)
  onUploaded(owner: string, item: LibraryItem): boolean | void;
}

const DEFAULT_CONCURRENCY = 3;

const NO_ENTRIES: readonly UploadEntry[] = [];

/**
 * Antrean unggah latar bersama (tanpa UI): berkas yang masuk langsung diunggah (maks. `concurrency` serentak) tanpa
 * menunggu dialog ditutup. Seluruh jalannya antrean dihitung sebagai penulisan berjalan (`runBusy`). Saat dilepas
 * (unmount) semua unggahan dibatalkan dan hasil yang tiba sesudahnya dibuang lewat `source.onDiscard`.
 */
export function useBackgroundUploads(options: BackgroundUploadsOptions): BackgroundUploads {
  const { concurrency = DEFAULT_CONCURRENCY } = options;
  const [entries, setEntries] = useState<readonly UploadEntry[]>(NO_ENTRIES);
  // Cermin sinkron `entries`: penjadwal berjalan async dan harus melihat keadaan terkini.
  const entriesRef = useRef<readonly UploadEntry[]>(NO_ENTRIES);
  const controllers = useRef(new Map<string, AbortController>());
  const counter = useRef(0);
  const alive = useRef(true);
  const active = useRef(0);
  // Penutup `runBusy` selama masih ada pekerjaan (menunggu atau berjalan).
  const releaseBusy = useRef<(() => void) | null>(null);

  const sourceRef = useRef(options.source);
  sourceRef.current = options.source;
  const onUploadedRef = useRef(options.onUploaded);
  onUploadedRef.current = options.onUploaded;
  const concurrencyRef = useRef(concurrency);
  concurrencyRef.current = concurrency;

  const commit = useCallback((next: readonly UploadEntry[]) => {
    entriesRef.current = next;
    if (alive.current) setEntries(next);
  }, []);

  const patch = useCallback(
    (key: string, changes: Partial<UploadEntry>) => {
      if (!entriesRef.current.some((entry) => entry.key === key)) return;
      commit(entriesRef.current.map((e) => (e.key === key ? { ...e, ...changes } : e)));
    },
    [commit],
  );

  const discard = useCallback((item: LibraryItem) => {
    void Promise.resolve(sourceRef.current.onDiscard?.([item])).catch(() => undefined);
  }, []);

  const settleBusy = useCallback(() => {
    if (active.current > 0) return;
    if (entriesRef.current.some((entry) => entry.phase === 'waiting')) return;
    releaseBusy.current?.();
    releaseBusy.current = null;
  }, []);

  const ensureBusy = useCallback(() => {
    if (releaseBusy.current) return;
    let release: () => void = () => undefined;
    releaseBusy.current = () => release();
    void runBusy(() => new Promise<void>((resolve) => (release = resolve)));
  }, []);

  const pumpRef = useRef<() => void>(() => undefined);

  const runEntry = useCallback(
    async (entry: UploadEntry) => {
      const controller = new AbortController();
      controllers.current.set(entry.key, controller);
      active.current += 1;
      patch(entry.key, { phase: 'uploading', fraction: null, error: null });
      try {
        const result = await sourceRef.current.upload(entry.file, entry.name, {
          signal: controller.signal,
          onProgress: (phase, fraction) => {
            if (controller.signal.aborted) return;
            patch(entry.key, { phase, fraction });
          },
        });
        const stillWanted =
          alive.current &&
          !controller.signal.aborted &&
          entriesRef.current.some((e) => e.key === entry.key);
        if (!stillWanted) {
          discard(result);
        } else if (onUploadedRef.current(entry.owner, result) === false) {
          discard(result);
          commit(entriesRef.current.filter((e) => e.key !== entry.key));
        } else {
          commit(entriesRef.current.filter((e) => e.key !== entry.key));
        }
      } catch (error) {
        // Dibatalkan (dibuang pengguna atau dilepas): entrinya sudah tidak ada atau memang tak perlu dilaporkan.
        if (!controller.signal.aborted) {
          patch(entry.key, {
            phase: 'failed',
            fraction: null,
            error: errorText(error, 'Gagal mengunggah'),
          });
        }
      } finally {
        controllers.current.delete(entry.key);
        active.current -= 1;
        pumpRef.current();
        settleBusy();
      }
    },
    [patch, commit, discard, settleBusy],
  );

  pumpRef.current = () => {
    if (!alive.current) return;
    while (active.current < Math.max(1, concurrencyRef.current)) {
      const next = entriesRef.current.find(
        (entry) => entry.phase === 'waiting' && !controllers.current.has(entry.key),
      );
      if (!next) return;
      void runEntry(next);
    }
  };

  const add = useCallback(
    (owner: string, files: readonly QueuedFile[]) => {
      if (files.length === 0) return;
      const created: UploadEntry[] = files.map((queued) => {
        counter.current += 1;
        return {
          key: `u${counter.current}`,
          owner,
          file: queued.file,
          name: queued.name,
          phase: 'waiting',
          fraction: null,
          error: null,
        };
      });
      commit([...entriesRef.current, ...created]);
      ensureBusy();
      pumpRef.current();
    },
    [commit, ensureBusy],
  );

  const retry = useCallback(
    (key: string) => {
      const entry = entriesRef.current.find((e) => e.key === key);
      if (entry?.phase !== 'failed') return;
      patch(key, { phase: 'waiting', fraction: null, error: null });
      ensureBusy();
      pumpRef.current();
    },
    [patch, ensureBusy],
  );

  const removeKeys = useCallback(
    (match: (entry: UploadEntry) => boolean) => {
      const doomed = entriesRef.current.filter(match);
      if (doomed.length === 0) return;
      commit(entriesRef.current.filter((entry) => !match(entry)));
      for (const entry of doomed) controllers.current.get(entry.key)?.abort();
      settleBusy();
    },
    [commit, settleBusy],
  );

  const remove = useCallback((key: string) => removeKeys((e) => e.key === key), [removeKeys]);
  const cancelOwner = useCallback(
    (owner: string) => removeKeys((e) => e.owner === owner),
    [removeKeys],
  );

  // Dilepas: batalkan semua; hasil yang tiba sesudahnya dibuang (`alive` false). Strict Mode memasang ulang.
  useEffect(() => {
    alive.current = true;
    const running = controllers.current;
    return () => {
      alive.current = false;
      for (const controller of running.values()) controller.abort();
      releaseBusy.current?.();
      releaseBusy.current = null;
    };
  }, []);

  const forOwner = useCallback(
    (owner: string): OwnerUploads => {
      const own = entries.filter((entry) => entry.owner === owner);
      return {
        entries: own,
        busy: own.some((entry) => entry.phase !== 'failed'),
        hasFailed: own.some((entry) => entry.phase === 'failed'),
        add: (files) => add(owner, files),
        retry,
        remove,
      };
    },
    [entries, add, retry, remove],
  );

  return useMemo(
    () => ({
      entries,
      busy: entries.some((entry) => entry.phase !== 'failed'),
      hasFailed: entries.some((entry) => entry.phase === 'failed'),
      forOwner,
      cancelOwner,
    }),
    [entries, forOwner, cancelOwner],
  );
}
