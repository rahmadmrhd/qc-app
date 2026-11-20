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
  /**
   * Ada entri yang belum selesai ATAU gagal (spek 5.2, anti-tujuan 2): nilai yang dipakai host untuk menahan Simpan.
   * Entri gagal menahan sampai diulang atau dibuang.
   */
  blocking: boolean;
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
  /** Lihat `OwnerUploads.blocking`. */
  blocking: boolean;
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

/** Selang minimum antar pembaruan persen per entri; perubahan fase dan nilai akhir tidak ditunda. */
const PROGRESS_INTERVAL_MS = 100;

interface ProgressSlot {
  lastAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  pending: { phase: UploadPhase; fraction: number | null } | null;
}

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
  // Pembaruan persen digabung per entri (maks. satu setState per `PROGRESS_INTERVAL_MS`).
  const progress = useRef(new Map<string, ProgressSlot>());

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

  const dropProgress = useCallback((key: string) => {
    const slot = progress.current.get(key);
    if (slot?.timer) clearTimeout(slot.timer);
    progress.current.delete(key);
  }, []);

  /** Persen sering (tiap event XHR): gabungkan; fase baru dan nilai akhir (1 atau tanpa persen) segera. */
  const reportProgress = useCallback(
    (key: string, phase: UploadPhase, fraction: number | null) => {
      const current = entriesRef.current.find((entry) => entry.key === key);
      if (!current) return;
      const slot = progress.current.get(key) ?? { lastAt: 0, timer: null, pending: null };
      const immediate = current.phase !== phase || fraction === null || fraction >= 1;
      const now = Date.now();
      if (immediate || now - slot.lastAt >= PROGRESS_INTERVAL_MS) {
        if (slot.timer) clearTimeout(slot.timer);
        progress.current.set(key, { lastAt: now, timer: null, pending: null });
        patch(key, { phase, fraction });
        return;
      }
      slot.pending = { phase, fraction };
      if (!slot.timer) {
        slot.timer = setTimeout(
          () => {
            const latest = progress.current.get(key);
            if (!latest) return;
            const next = latest.pending;
            latest.timer = null;
            latest.pending = null;
            latest.lastAt = Date.now();
            if (next) patch(key, next);
          },
          PROGRESS_INTERVAL_MS - (now - slot.lastAt),
        );
      }
      progress.current.set(key, slot);
    },
    [patch],
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
            reportProgress(entry.key, phase, fraction);
          },
        });
        dropProgress(entry.key);
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
        dropProgress(entry.key);
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
    [patch, commit, discard, settleBusy, reportProgress, dropProgress],
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
      dropProgress(key);
      patch(key, { phase: 'waiting', fraction: null, error: null });
      ensureBusy();
      pumpRef.current();
    },
    [patch, ensureBusy, dropProgress],
  );

  const removeKeys = useCallback(
    (match: (entry: UploadEntry) => boolean) => {
      const doomed = entriesRef.current.filter(match);
      if (doomed.length === 0) return;
      commit(entriesRef.current.filter((entry) => !match(entry)));
      for (const entry of doomed) {
        controllers.current.get(entry.key)?.abort();
        dropProgress(entry.key);
      }
      settleBusy();
    },
    [commit, settleBusy, dropProgress],
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
    const slots = progress.current;
    return () => {
      alive.current = false;
      for (const slot of slots.values()) if (slot.timer) clearTimeout(slot.timer);
      slots.clear();
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
        blocking: own.length > 0,
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
      blocking: entries.length > 0,
      forOwner,
      cancelOwner,
    }),
    [entries, forOwner, cancelOwner],
  );
}
