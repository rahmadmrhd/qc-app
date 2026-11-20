import { useCallback, useRef, useState } from 'react';
import { runBusy } from '@/app/pwa/busy';
import { baseName, checkFile } from './accept';
import { errorText } from './error-text';
import type { FileLibrarySource, LibraryItem, RejectedFile } from './types';

export type QueueStatus = 'waiting' | 'uploading' | 'done' | 'failed';

export interface QueueEntry {
  key: string;
  file: File;
  name: string;
  status: QueueStatus;
  error: string | null;
  result: LibraryItem | null;
}

export interface UploadQueueOptions {
  source: FileLibrarySource;
  accept: readonly string[];
  maxBytes: number;
  /** Maksimum berkas dalam satu antrean (satu unggahan). */
  maxFiles: number;
  concurrency?: number;
}

export interface UploadQueue {
  entries: QueueEntry[];
  rejected: RejectedFile[];
  add(files: File[]): void;
  /** Menambah penolakan yang sudah ditentukan pemanggil (mis. oleh drop zone). */
  addRejected(items: RejectedFile[]): void;
  rename(key: string, name: string): void;
  remove(key: string): void;
  /** Menandai entri gagal agar menunggu lagi; pengunggahan sebenarnya oleh `start()`. */
  retry(key: string): void;
  /**
   * Mengunggah entri `waiting`/`failed` dan mengembalikan SEMUA hasil sukses (termasuk yang sudah sukses
   * sebelumnya, tanpa mengunggah ulang). Idempoten: panggilan serentak berbagi satu janji.
   */
  start(): Promise<LibraryItem[]>;
  clearRejected(): void;
  /** Keadaan terkini (tidak basi seperti `entries` di dalam closure async). */
  snapshot(): QueueEntry[];
  /** Kosongkan antrean dan daftar ditolak. */
  reset(): void;
}

export function useUploadQueue(options: UploadQueueOptions): UploadQueue {
  const { source, accept, maxBytes, maxFiles, concurrency = 3 } = options;
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  // Cermin sinkron `entries`: `start()` berjalan async dan harus melihat keadaan terkini.
  const entriesRef = useRef<QueueEntry[]>([]);
  const inflight = useRef<Promise<LibraryItem[]> | null>(null);
  const counter = useRef(0);
  // Pemanggil `useUploadQueue` menyuntik `source`; ref menjaga `start` tetap stabil.
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const commit = useCallback((next: QueueEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const patch = useCallback(
    (key: string, changes: Partial<QueueEntry>) => {
      commit(entriesRef.current.map((e) => (e.key === key ? { ...e, ...changes } : e)));
    },
    [commit],
  );

  const addRejected = useCallback((items: RejectedFile[]) => {
    if (items.length > 0) setRejected((current) => [...current, ...items]);
  }, []);

  const add = useCallback(
    (files: File[]) => {
      const refused: RejectedFile[] = [];
      const accepted: QueueEntry[] = [];
      let room = Math.max(0, maxFiles - entriesRef.current.length);
      for (const file of files) {
        const reason = checkFile(file, { accept, maxBytes });
        if (reason !== null) {
          refused.push({ name: file.name, reason });
        } else if (room <= 0) {
          refused.push({ name: file.name, reason: `Maksimal ${maxFiles} berkas per unggahan` });
        } else {
          room -= 1;
          counter.current += 1;
          accepted.push({
            key: `q${counter.current}`,
            file,
            name: baseName(file.name, sourceRef.current.nameMax),
            status: 'waiting',
            error: null,
            result: null,
          });
        }
      }
      if (accepted.length > 0) commit([...entriesRef.current, ...accepted]);
      addRejected(refused);
    },
    [accept, maxBytes, maxFiles, commit, addRejected],
  );

  const rename = useCallback(
    (key: string, name: string) => {
      const trimmed = name.trim();
      const entry = entriesRef.current.find((e) => e.key === key);
      if (!entry || trimmed === '' || entry.status === 'uploading' || entry.status === 'done')
        return;
      patch(key, { name: trimmed });
    },
    [patch],
  );

  const remove = useCallback(
    (key: string) => {
      const entry = entriesRef.current.find((e) => e.key === key);
      // Entri yang sedang diunggah tidak dibuang: hasilnya sudah di jalan ke server.
      if (!entry || entry.status === 'uploading') return;
      commit(entriesRef.current.filter((e) => e.key !== key));
    },
    [commit],
  );

  const retry = useCallback(
    (key: string) => {
      const entry = entriesRef.current.find((e) => e.key === key);
      if (entry?.status === 'failed') patch(key, { status: 'waiting', error: null });
    },
    [patch],
  );

  const run = useCallback(async (): Promise<LibraryItem[]> => {
    const queue = entriesRef.current.filter((e) => e.status === 'waiting' || e.status === 'failed');
    let next = 0;
    async function worker() {
      while (next < queue.length) {
        const entry = queue[next];
        next += 1;
        if (!entry) continue;
        // Entri bisa saja diganti nama/dibuang sejak antrean dibuat: baca ulang yang terkini.
        const current = entriesRef.current.find((e) => e.key === entry.key);
        if (!current) continue;
        patch(entry.key, { status: 'uploading', error: null });
        try {
          const result = await sourceRef.current.upload(current.file, current.name);
          patch(entry.key, { status: 'done', result, error: null });
        } catch (error) {
          patch(entry.key, { status: 'failed', error: errorText(error, 'Gagal mengunggah') });
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, () => worker()),
    );
    return entriesRef.current.flatMap((e) => (e.status === 'done' && e.result ? [e.result] : []));
  }, [concurrency, patch]);

  const start = useCallback((): Promise<LibraryItem[]> => {
    if (inflight.current) return inflight.current;
    // Seluruh antrean (termasuk celah antar berkas) = penulisan berjalan: muat ulang otomatis PWA tak boleh memotongnya.
    const promise = runBusy(run).finally(() => {
      inflight.current = null;
    });
    inflight.current = promise;
    return promise;
  }, [run]);

  const reset = useCallback(() => {
    commit([]);
    setRejected([]);
  }, [commit]);

  return {
    entries,
    rejected,
    add,
    addRejected,
    rename,
    remove,
    retry,
    start,
    clearRejected: useCallback(() => setRejected([]), []),
    snapshot: useCallback(() => entriesRef.current, []),
    reset,
  };
}
