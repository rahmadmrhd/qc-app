// Hook renderer mode Multi-Device (spek 2026-11-19 §3, §4, §5): mesinnya hidup di proses utama, jadi hook ini hanya
// berlangganan snapshot, mengirim perintah, mendorong keadaan draft (alasan blokir + serial terdaftar) ke mesin, dan
// MENJADI SATU-SATUNYA yang mencatat peristiwa `injected` Multi ke draft lewat `useDraftRows.addInjected`.
// Sandi tidak pernah lewat sini: snapshot tak memuatnya dan kredensial dasar dibaca proses utama dari paket skrip.

import { DRAFT_MAX_ROWS, MULTI_BRIDGE_VERSION } from '@countrylock/bridge-channels';
import type {
  InjectedEvent,
  MultiCredentialDto,
  MultiSnapshot,
  MultiStartDto,
  QcBridge,
} from '@countrylock/bridge-contract';
import { normalizeSerial } from '@shared/serials';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeLine } from './lib/safe-text';
import { blockerOf } from './use-country-lock';
import type { DraftRows } from './use-draft-rows';

export interface MultiActions {
  scan(): void;
  setConcurrency(n: number): void;
  setAutoInject(on: boolean): void;
  injectDevice(mac: string): void;
  cancelDevice(mac: string): void;
  injectAll(): void;
  stopQueue(): void;
  cancelAll(): void;
  addCredential(cred: MultiCredentialDto): void;
  prepareBridge(): Promise<void>;
  openWeb(mac: string): void;
}

export interface MultiState {
  supported: boolean;
  snapshot: MultiSnapshot | null;
  error: string | null;
  /**
   * MAC perangkat yang sudah selesai di-inject tetapi peristiwanya BELUM tercatat ke draft (draft penuh/rusak, atau gagal
   * menulis): peristiwanya tetap di proses utama (belum di-ack) dan tabel menandai barisnya.
   */
  unrecorded: ReadonlySet<string>;
}

export interface UseMulti extends MultiState {
  start(cfg: MultiStartDto): Promise<void>;
  stop(): Promise<void>;
  actions: MultiActions;
}

/** Batas panjang alasan blokir yang diterima kanal `multiSetBlocked` (skema kontrak). */
const BLOCK_REASON_MAX = 200;
/** Batas panjang satu serial yang diterima kanal `multiSetRegistered` (skema kontrak). */
const SERIAL_MAX = 64;

/**
 * `clientId` baris draft dari id peristiwa (UUID/acak dari proses utama): sama setiap peristiwa dikirim ulang, jadi
 * pencatatan idempoten walau serialnya sudah diubah di tabel. Memenuhi pola `clientId` Serial Number (8-100, huruf/angka/-).
 */
export function multiClientId(eventId: string): string {
  return `multi-evt-${eventId.replace(/[^A-Za-z0-9-]/g, '-')}`.slice(0, 100);
}

/** Pesan galat dari proses utama: awalan "Error invoking remote method ..." milik Electron dibuang. */
function errorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  const marker = ': Error: ';
  const at = message.lastIndexOf(marker);
  const text = (at >= 0 ? message.slice(at + marker.length) : message).trim();
  return text === '' ? 'Terjadi galat pada mode Multi' : safeLine(text, []);
}

export function useMulti(bridge: QcBridge, draft: DraftRows): UseMulti {
  const supported =
    bridge.version >= MULTI_BRIDGE_VERSION &&
    typeof bridge.multi === 'object' &&
    bridge.multi !== null;
  const [snapshot, setSnapshot] = useState<MultiSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unrecorded, setUnrecorded] = useState<ReadonlySet<string>>(new Set());

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const aliveRef = useRef(true);
  const processingRef = useRef(false);
  const againRef = useRef(false);

  // --- Snapshot ---------------------------------------------------------------------------
  useEffect(() => {
    aliveRef.current = true;
    if (!supported) {
      setSnapshot(null);
      return;
    }
    const stop = bridge.multi.onChange((next) => {
      if (aliveRef.current) setSnapshot(next);
    });
    void bridge.multi
      .snapshot()
      .then((initial) => {
        // Snapshot dari `onChange` yang lebih baru tak boleh tertimpa pembacaan awal yang terlambat.
        if (aliveRef.current) setSnapshot((current) => current ?? initial);
      })
      .catch((cause) => {
        if (aliveRef.current) setError(errorText(cause));
      });
    return () => {
      aliveRef.current = false;
      stop();
    };
  }, [bridge, supported]);

  // --- Dorong keadaan draft ke mesin (alasan blokir lebih dulu, lalu serial terdaftar) -------
  const blocker = blockerOf(draft);
  const blockReason = blocker === null ? null : safeLine(blocker, []).slice(0, BLOCK_REASON_MAX);
  const registeredKey = useMemo(() => {
    const serials: string[] = [];
    for (const row of draft.rows) {
      const serial = normalizeSerial(row.serial);
      // Mesin menolak SELURUH daftar bila ada satu entri tak sah: saring di sini.
      if (serial === '' || serial.length > SERIAL_MAX || safeLine(serial, []) !== serial) continue;
      serials.push(serial);
      if (serials.length >= DRAFT_MAX_ROWS) break;
    }
    return serials.join('\n');
  }, [draft.rows]);

  const pushDraftState = useCallback(async () => {
    await bridge.multi.setBlocked(blockReason);
    await bridge.multi.setRegistered(registeredKey === '' ? [] : registeredKey.split('\n'));
  }, [bridge, blockReason, registeredKey]);
  const pushDraftStateRef = useRef(pushDraftState);
  pushDraftStateRef.current = pushDraftState;

  useEffect(() => {
    if (!supported) return;
    void pushDraftState().catch((cause) => {
      if (aliveRef.current) setError(errorText(cause));
    });
  }, [supported, pushDraftState]);

  // --- Peristiwa injected -> draft ----------------------------------------------------------
  const processEvents = useCallback(async () => {
    if (!supported) return;
    if (processingRef.current) {
      againRef.current = true;
      return;
    }
    processingRef.current = true;
    try {
      do {
        againRef.current = false;
        let events: InjectedEvent[];
        try {
          events = await bridge.multi.pendingEvents();
        } catch (cause) {
          if (aliveRef.current) setError(errorText(cause));
          break;
        }
        // Draft rusak/belum siap: peristiwa dibiarkan di proses utama (dicoba lagi saat draft siap), barisnya ditandai.
        if (draftRef.current.status !== 'ready') {
          if (aliveRef.current) setUnrecorded(new Set(events.map((event) => event.mac)));
          break;
        }
        const acked: string[] = [];
        const pending = new Set<string>();
        for (const event of events) {
          try {
            const result = await draftRef.current.addInjected({
              serial: event.serial,
              itemId: event.target.itemId,
              itemLabel: event.target.itemLabel,
              buId: event.target.buId,
              buLabel: event.target.buLabel,
              locationId: event.target.locationId,
              locationLabel: event.target.locationLabel,
              clientId: multiClientId(event.eventId),
              injectedAt: event.injectedAt,
            });
            // `duplicate` = baris sudah ada (kiriman ulang): aman di-ack. `full` = belum tercatat: tetap di proses utama.
            if (result === 'full') pending.add(event.mac);
            else acked.push(event.eventId);
          } catch {
            // Gagal mencatat: tidak di-ack, dicoba lagi pada pemicu berikutnya.
            pending.add(event.mac);
          }
        }
        if (aliveRef.current) setUnrecorded(pending);
        if (acked.length > 0) {
          try {
            await bridge.multi.ackInjected(acked);
          } catch (cause) {
            if (aliveRef.current) setError(errorText(cause));
          }
        }
      } while (againRef.current && aliveRef.current);
    } finally {
      processingRef.current = false;
    }
  }, [bridge, supported]);

  // Pemicu: saat dipasang, tiap snapshot berubah (peristiwa baru dari inject sukses), draft siap, dan draft kembali longgar.
  const draftStatus = draft.status;
  const draftFull = draft.isFull;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot`, `draftStatus`, dan `draftFull` adalah pemicu murni.
  useEffect(() => {
    if (supported && draftStatus !== 'loading') void processEvents();
  }, [supported, processEvents, snapshot, draftStatus, draftFull]);

  // --- Perintah -----------------------------------------------------------------------------
  const run = useCallback(async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
      if (aliveRef.current) setError(null);
    } catch (cause) {
      if (aliveRef.current) setError(errorText(cause));
    }
  }, []);

  const start = useCallback(
    async (cfg: MultiStartDto): Promise<void> => {
      if (!supported) return;
      await run(async () => {
        // Himpunan serial terdaftar dan alasan blokir dikirim SEBELUM mulai agar Auto Inject tak jalan terhadap data basi.
        await pushDraftStateRef.current();
        await bridge.multi.start(cfg);
      });
    },
    [bridge, supported, run],
  );

  const stop = useCallback(async (): Promise<void> => {
    if (!supported) return;
    await run(() => bridge.multi.stop());
  }, [bridge, supported, run]);

  const actions = useMemo<MultiActions>(() => {
    const fire = (work: () => Promise<unknown>) => {
      if (supported) void run(work);
    };
    return {
      scan: () => fire(() => bridge.multi.scan()),
      setConcurrency: (n) => fire(() => bridge.multi.setConcurrency(n)),
      setAutoInject: (on) => fire(() => bridge.multi.setAutoInject(on)),
      injectDevice: (mac) => fire(() => bridge.multi.injectDevice(mac)),
      cancelDevice: (mac) => fire(() => bridge.multi.cancelDevice(mac)),
      injectAll: () => fire(() => bridge.multi.injectAll()),
      stopQueue: () => fire(() => bridge.multi.stopQueue()),
      cancelAll: () => fire(() => bridge.multi.cancelAll()),
      addCredential: (cred) => fire(() => bridge.multi.addCredential(cred)),
      openWeb: (mac) => fire(() => bridge.multi.openWeb(mac)),
      prepareBridge: async () => {
        if (!supported) return;
        try {
          const result = await bridge.multi.prepareBridge();
          if (!aliveRef.current) return;
          // Keberhasilan dilaporkan mesin lewat `snapshot.message`; hanya kegagalan yang menjadi galat di sini.
          setError(result.ok ? null : safeLine(result.message, []));
        } catch (cause) {
          if (aliveRef.current) setError(errorText(cause));
        }
      },
    };
  }, [bridge, supported, run]);

  return { supported, snapshot, error, unrecorded, start, stop, actions };
}
