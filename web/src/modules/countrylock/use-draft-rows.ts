import type { QcBridge } from '@countrylock/bridge-contract';
import type { PendingEntry } from '@countrylock/pending';
import { normalizeSerial, SERIAL_LIMITS } from '@shared/serials';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StagingRow } from '@/modules/serial/lib/draft';
import { parseDraftRows } from '@/modules/serial/lib/draft-store';
import { newClientId } from './lib/client-id';
import { buildInjectedRow, type InjectedRowInput } from './lib/injected-row';
import { mergePending } from './lib/pending-migration';

/** Pesan galat dari proses utama: awalan "Error invoking remote method ..." milik Electron dibuang. */
function errorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  const marker = ': Error: ';
  const at = message.lastIndexOf(marker);
  const text = at >= 0 ? message.slice(at + marker.length) : message;
  return text === '' ? 'Draft tidak dapat dimuat' : text;
}

/** Jeda simpan untuk perubahan tabel (sama dengan draft web). Hasil inject disimpan seketika. */
export const AUTOSAVE_DELAY_MS = 500;

export type AddInjectedResult = 'added' | 'duplicate' | 'full';

export interface DraftRows {
  status: 'loading' | 'ready' | 'error';
  /** Alasan draft tak termuat (`status: 'error'`); inject diblokir dan draft tersimpan tidak ditimpa. */
  error: string | null;
  rows: StagingRow[];
  /** Penyimpanan terakhir gagal. */
  saveFailed: boolean;
  /** Draft sudah memuat batas baris (`SERIAL_LIMITS.tableRows`): inject baru diblokir. */
  isFull: boolean;
  /** Serial (bentuk web: MAC tanpa pemisah) sudah ada di draft. */
  isRegistered(serial: string): boolean;
  /** Mengganti seluruh tabel (dipakai `RecordPage` mode terkontrol); tersimpan tertunda. */
  replace(next: StagingRow[]): void;
  /** Menambah baris hasil inject lalu menyimpannya seketika; serial yang sudah ada tidak digandakan. */
  addInjected(input: InjectedRowInput): Promise<AddInjectedResult>;
}

/**
 * Pemilik tunggal draft Catat Serial Number di aplikasi desktop (snapshot SQLite lewat `bridge.draft`). Satu pemilik
 * menjaga hasil inject tak saling menimpa dengan penyimpanan tabel. Saat dimuat, entri pending lama dipindahkan ke draft
 * (sekali; gagal di tengah diulang aman karena serial/`clientId` ganda dilewati).
 */
export function useDraftRows(bridge: QcBridge): DraftRows {
  const [status, setStatus] = useState<DraftRows['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<StagingRow[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);

  const rowsRef = useRef<StagingRow[]>([]);
  const readyRef = useRef(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const setNow = useCallback((next: StagingRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  /** Menyimpan snapshot terkini; penyimpanan berurutan. `true` bila berhasil. Tak menulis sebelum draft termuat. */
  const persist = useCallback((): Promise<boolean> => {
    if (!readyRef.current) return Promise.resolve(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dirtyRef.current = false;
    const snapshot = rowsRef.current;
    const run = chainRef.current.then(async () => {
      try {
        await bridge.draft.save(snapshot);
        if (mountedRef.current) setSaveFailed(false);
        return true;
      } catch {
        if (mountedRef.current) setSaveFailed(true);
        return false;
      }
    });
    chainRef.current = run;
    return run;
  }, [bridge]);

  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    void (async () => {
      let loaded: StagingRow[];
      try {
        loaded = parseDraftRows(await bridge.draft.load());
      } catch (cause) {
        if (!alive) return;
        setError(errorText(cause));
        setStatus('error');
        return;
      }
      let next = loaded;
      let absorbed: PendingEntry[] = [];
      try {
        const merged = mergePending(loaded, await bridge.pending.list(), newClientId);
        next = merged.rows;
        absorbed = merged.absorbed;
      } catch {
        // Pending tak terbaca: dilewati, dicoba lagi pada pemuatan berikutnya.
      }
      if (!alive) return;
      setNow(next);
      readyRef.current = true;
      setStatus('ready');
      if (absorbed.length === 0) return;
      // Entri pending baru dihapus setelah snapshot draft tersimpan; gagal = pending tetap dan diulang aman nanti.
      if (!(await persist())) return;
      for (const entry of absorbed) {
        try {
          await bridge.pending.remove(entry.serial);
        } catch {
          // Tersisa di pending: dilewati karena serialnya sudah ada di draft.
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [bridge, persist, setNow]);

  // Keluar dari halaman: perubahan yang belum tersimpan (jeda 500 ms) disimpan seketika.
  useEffect(
    () => () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current && readyRef.current) {
        dirtyRef.current = false;
        void bridge.draft.save(rowsRef.current).catch(() => undefined);
      }
    },
    [bridge],
  );

  const replace = useCallback(
    (next: StagingRow[]) => {
      if (!readyRef.current) return;
      setNow(next);
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    },
    [persist, setNow],
  );

  const isRegistered = useCallback((serial: string) => {
    const key = normalizeSerial(serial);
    return rowsRef.current.some((row) => row.serial === key);
  }, []);

  const addInjected = useCallback(
    async (input: InjectedRowInput): Promise<AddInjectedResult> => {
      if (!readyRef.current) throw new Error('Draft belum siap');
      const current = rowsRef.current;
      if (isRegistered(input.serial)) return 'duplicate';
      if (current.length >= SERIAL_LIMITS.tableRows) return 'full';
      const row = buildInjectedRow(input, { clientId: newClientId(), now: new Date() });
      setNow([...current, row]);
      await persist();
      return 'added';
    },
    [isRegistered, persist, setNow],
  );

  return {
    status,
    error,
    rows,
    saveFailed,
    isFull: rows.length >= SERIAL_LIMITS.tableRows,
    isRegistered,
    replace,
    addInjected,
  };
}
