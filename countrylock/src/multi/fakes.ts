// Port palsu + jam terkendali untuk tes engine Multi. Waktu hanya maju lewat `advance`; `sleep` tidak memakai timer nyata,
// jadi tes deterministik dan tak ada timer tersisa bila engine berhenti dengan benar.

import type { MultiPorts } from './engine';
import { abortError } from './scheduler';
import type { Credential, InjectedEvent, Lease } from './types';

export type FakeInfo =
  | { ok: true; model: string; serial: string; country: string }
  | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' };

export interface FakeInjectCall {
  id: string;
  ip: string;
  cred: Credential;
  firmwareCode: string;
  signal: AbortSignal;
  progress(message: string): void;
  finish(result: {
    ok: boolean;
    stage: 'completed' | 'failed' | 'cancelled';
    message: string;
  }): void;
  settled: boolean;
}

interface Sleeper {
  wake: number;
  resolve(): void;
  reject(e: unknown): void;
  signal: AbortSignal;
  onAbort: () => void;
}

export const serialOfIp = (ip: string): string => `SN${ip.replace(/\./g, '')}`;

export function createFakePorts() {
  let time = 1_700_000_000_000;
  let idCounter = 0;
  const sleepers: Sleeper[] = [];

  const state = {
    /** `null` = galat baca lease. */
    leases: [] as Lease[] | null,
    readLeaseThrows: false,
    /** Lama ping/readInfo (ms jam palsu); 0 = langsung. */
    pingDelay: 0,
    infoDelay: 0,
    ping: (_ip: string): boolean => true,
    info: (ip: string, _cred: Credential): FakeInfo => ({
      ok: true,
      model: 'NanoStation',
      serial: serialOfIp(ip),
      country: 'ID',
    }),
    /** 'manual' = tes menyelesaikan lewat `finishInject`; 'auto' = langsung sukses. */
    injectMode: 'manual' as 'manual' | 'auto',
    injectThrows: null as Error | null,
    bridgeResult: { ok: true, message: 'Bridge siap' } as { ok: boolean; message: string },
  };

  const calls = {
    readLeases: 0,
    ping: [] as string[],
    readInfo: [] as { ip: string; cred: Credential }[],
    inject: [] as FakeInjectCall[],
    ensureBridgePorts: 0,
  };

  const events: InjectedEvent[] = [];

  /** Memberi kesempatan semua rantai microtask selesai (engine tak memakai timer nyata). */
  async function settle(): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  async function advance(ms: number): Promise<void> {
    const target = time + ms;
    await settle();
    for (;;) {
      let next: Sleeper | undefined;
      for (const s of sleepers) {
        if (s.wake <= target && (next === undefined || s.wake < next.wake)) next = s;
      }
      if (!next) break;
      sleepers.splice(sleepers.indexOf(next), 1);
      next.signal.removeEventListener('abort', next.onAbort);
      time = Math.max(time, next.wake);
      next.resolve();
      await settle();
    }
    time = target;
    await settle();
  }

  const ports: MultiPorts = {
    now: () => time,
    sleep(ms, signal) {
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise<void>((resolve, reject) => {
        const sleeper: Sleeper = {
          wake: time + ms,
          resolve,
          reject,
          signal,
          onAbort: () => {
            const i = sleepers.indexOf(sleeper);
            if (i >= 0) sleepers.splice(i, 1);
            reject(abortError());
          },
        };
        signal.addEventListener('abort', sleeper.onAbort, { once: true });
        sleepers.push(sleeper);
      });
    },
    async readLeases() {
      calls.readLeases += 1;
      if (state.readLeaseThrows) throw new Error('ssh putus');
      return state.leases === null ? null : state.leases.map((l) => ({ ...l }));
    },
    async ping(ip) {
      calls.ping.push(ip);
      if (state.pingDelay > 0) await ports.sleep(state.pingDelay, new AbortController().signal);
      return state.ping(ip);
    },
    async readInfo(ip, cred) {
      calls.readInfo.push({ ip, cred });
      if (state.infoDelay > 0) await ports.sleep(state.infoDelay, new AbortController().signal);
      return state.info(ip, cred);
    },
    inject(req, signal, onProgress) {
      return new Promise((resolve) => {
        if (state.injectThrows) {
          resolve(Promise.reject(state.injectThrows));
          return;
        }
        const call: FakeInjectCall = {
          id: req.id,
          ip: req.ip,
          cred: req.cred,
          firmwareCode: req.firmwareCode,
          signal,
          progress: onProgress,
          settled: false,
          finish(result) {
            if (call.settled) return;
            call.settled = true;
            resolve(result);
          },
        };
        calls.inject.push(call);
        signal.addEventListener(
          'abort',
          () => call.finish({ ok: false, stage: 'cancelled', message: 'Dibatalkan' }),
          { once: true },
        );
        if (signal.aborted) call.finish({ ok: false, stage: 'cancelled', message: 'Dibatalkan' });
        else if (state.injectMode === 'auto') {
          call.finish({ ok: true, stage: 'completed', message: 'Selesai' });
        }
      });
    },
    async ensureBridgePorts() {
      calls.ensureBridgePorts += 1;
      return state.bridgeResult;
    },
    events: {
      add: (e) => {
        events.push(e);
      },
      list: () => [...events],
      ack: (ids) => {
        for (const id of ids) {
          const i = events.findIndex((e) => e.eventId === id);
          if (i >= 0) events.splice(i, 1);
        }
      },
    },
    newId: () => `id-${++idCounter}`,
  };

  return {
    ports,
    state,
    calls,
    events,
    advance,
    settle,
    get time() {
      return time;
    },
    get pendingSleeps() {
      return sleepers.length;
    },
    /** Panggilan inject yang masih menunggu untuk `ip`. */
    pendingInject(ip: string): FakeInjectCall | undefined {
      return calls.inject.find((c) => c.ip === ip && !c.settled);
    },
    finishInject(
      ip: string,
      result: { ok: boolean; stage: 'completed' | 'failed' | 'cancelled'; message: string } = {
        ok: true,
        stage: 'completed',
        message: 'Selesai',
      },
    ): void {
      const call = calls.inject.find((c) => c.ip === ip && !c.settled);
      if (!call) throw new Error(`tidak ada inject yang menunggu untuk ${ip}`);
      call.finish(result);
    },
  };
}

export type FakePorts = ReturnType<typeof createFakePorts>;
