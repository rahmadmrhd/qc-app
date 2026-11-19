// Engine Multi-Device (spek 2026-11-19 §1, legacy L4.3 sampai L4.6). Murni dari sisi lingkungan: semua I/O lewat
// `MultiPorts` yang disuntik (jam, sleep, lease, ping, info, inject, penyimpanan peristiwa), jadi dapat dijalankan di
// Electron main dan diuji dengan jam serta port palsu (`fakes.ts`). Tanpa API Node/DOM.
//
// Invarian penting:
// - Identitas perangkat = MAC. Objek `DeviceRecord` di peta engine berumur panjang (hasil `reconcileLeases` digabung
//   ke objek yang sama); tiap `await` diikuti pemeriksaan "masih record yang sama, IP sama, status yang saya set".
// - Setiap cabang loop berakhir di `ports.sleep` (tidak ada putaran rapat), dan semua loop berhenti lewat satu AbortSignal.
// - Kredensial dicoba paling banyak sekali per sesi IP; habis = `waiting` "Permission denied!!!" tanpa panggilan
//   `readInfo` lagi sampai ada pemicu (kredensial baru, IP berubah, perangkat muncul lagi).
// - Sandi hanya ada di `base`/antrean engine; tidak pernah masuk snapshot, log, atau pesan (disamarkan sebagai pertahanan ganda).

import { addCredential as addToQueue, credentialAt, nextCredentialIndex } from './credentials';
import { normalizeMac } from './lease';
import { type DeviceRecord, MSG_WAITING, reconcileLeases } from './registry';
import {
  abortError,
  clampConcurrency,
  createScheduler,
  isAbortError,
  type Scheduler,
} from './scheduler';
import { countDevices, type MultiSnapshot, toDeviceDto } from './snapshot';
import type { Credential, DeviceStatus, InjectedEvent, Lease, MultiTarget } from './types';

export interface MultiPorts {
  now(): number;
  /** Menolak `AbortError` bila dibatalkan. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** `null` = galat baca (engine tidak merekonsiliasi pada galat, supaya gangguan sesaat tak memutus semua perangkat). */
  readLeases(): Promise<Lease[] | null>;
  ping(ip: string): Promise<boolean>;
  readInfo(
    ip: string,
    cred: Credential,
  ): Promise<
    | { ok: true; model: string; serial: string; country: string }
    | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' }
  >;
  inject(
    req: { id: string; ip: string; cred: Credential; firmwareCode: string },
    signal: AbortSignal,
    onProgress: (message: string) => void,
  ): Promise<{ ok: boolean; stage: 'completed' | 'failed' | 'cancelled'; message: string }>;
  ensureBridgePorts(): Promise<{ ok: boolean; message: string }>;
  events: { add(e: InjectedEvent): void; list(): InjectedEvent[]; ack(ids: string[]): void };
  newId(): string;
}

export interface MultiStartConfig {
  firmwareCode: string;
  concurrency: number;
  excludeIp: string;
  autoInject: boolean;
  target: MultiTarget;
  base: Credential;
}

export interface MultiEngine {
  start(cfg: MultiStartConfig): void;
  stop(): Promise<void>;
  /** Pemindaian lease sekarang (Scan manual); bila sudah ada yang berjalan, menunggu yang itu. */
  scan(): Promise<void>;
  setConcurrency(n: number): void;
  setAutoInject(on: boolean): void;
  addCredential(c: Credential): void;
  /** Serial yang sudah ada di draft (didorong renderer tiap draft berubah). */
  setRegistered(serials: string[]): void;
  /** Alasan inject ditahan (draft penuh/rusak/belum termuat) atau `null`. */
  setBlocked(reason: string | null): void;
  snapshot(): MultiSnapshot;
  onChange(cb: (s: MultiSnapshot) => void): () => void;
}

// --- Konstanta waktu (spek) ----------------------------------------------------------------

const GRACE_MS = 60_000;
const SCAN_IDLE_MS = 1000;
const SCAN_WITH_DEVICES_MS = 3000;
const SCAN_INJECTING_MS = 5000;
const LOOP_FAST_MS = 500;
const LOOP_STABLE_MS = 800;
const MAX_LOG_LINES = 100;
/** Sandi lebih pendek dari ini tidak disamarkan di teks (akan merusak angka/IP di baris log). */
const MIN_MASK_LENGTH = 4;

const MSG_NO_PING = 'Tidak merespon ping';
const MSG_DENIED = 'Permission denied!!!';
const MSG_INCOMPLETE = 'Info perangkat tidak lengkap';
const MSG_INFO_UNAVAILABLE = 'Info perangkat tidak terbaca';
const MSG_IP_CHANGED = 'IP berubah, memeriksa ulang';

type InfoResult = Awaited<ReturnType<MultiPorts['readInfo']>>;

interface InjectJob {
  ctl: AbortController;
  phase: 'queued' | 'injecting';
  cancelled: boolean;
}

interface Run {
  ctl: AbortController;
  cfg: MultiStartConfig;
  scheduler: Scheduler;
  devices: Map<string, DeviceRecord>;
  loops: Map<string, AbortController>;
  jobs: Map<string, InjectJob>;
  tasks: Set<Promise<void>>;
  /** MAC dan serial yang sukses selama sesi ini (mencegah inject ulang otomatis; hilang saat berhenti). */
  sessionMacs: Set<string>;
  sessionSerials: Set<string>;
  readSeq: number;
  appliedSeq: number;
  scanning: Promise<void> | null;
  scanError: string | null;
  queueStopped: boolean;
}

/** Kunci pembanding serial: MAC-like tanpa pemisah dan huruf besar; lainnya sekadar huruf besar. */
function serialKey(serial: string): string {
  const mac = normalizeMac(serial);
  return mac ? mac.replace(/:/g, '') : serial.trim().toUpperCase();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function clockText(ms: number): string {
  const t = new Date(ms);
  return `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
}

/** Controller anak: batal bersama induknya. */
function child(parent: AbortSignal): AbortController {
  const ctl = new AbortController();
  if (parent.aborted) ctl.abort();
  else parent.addEventListener('abort', () => ctl.abort(), { once: true });
  return ctl;
}

/** Menunggu `p`, tetapi berhenti menunggu begitu `signal` batal (port nyata tak selalu menghormati pembatalan). */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export function createMultiEngine(ports: MultiPorts): MultiEngine {
  // Keadaan yang bertahan antar start/stop selama umur engine.
  let concurrency = 4;
  let autoInject = false;
  let blockedReason: string | null = null;
  let notice = '';
  let queue: Credential[] = [];
  let baseCred: Credential | null = null;
  let registered = new Set<string>();
  let run: Run | null = null;

  const listeners = new Set<(s: MultiSnapshot) => void>();
  let lastJson = '';
  let emitScheduled = false;

  // --- Emisi snapshot ------------------------------------------------------------------------

  function snapshot(): MultiSnapshot {
    const devices = run ? [...run.devices.values()] : [];
    return {
      running: run !== null,
      blockedReason,
      queueStopped: run?.queueStopped ?? false,
      autoInject,
      concurrency: run ? run.scheduler.limit : concurrency,
      devices: devices.map(toDeviceDto),
      counts: countDevices(devices),
      credentialCount: queue.length,
      message: run?.scanError ?? notice,
    };
  }

  function flushEmit(): void {
    if (listeners.size === 0) return;
    const snap = snapshot();
    const json = JSON.stringify(snap);
    if (json === lastJson) return;
    lastJson = json;
    for (const cb of [...listeners]) cb(snap);
  }

  /** Digabung per rantai microtask; sengaja bukan timer agar tidak ada timer tersisa saat berhenti. */
  function scheduleEmit(): void {
    if (emitScheduled) return;
    emitScheduled = true;
    void Promise.resolve().then(() => {
      emitScheduled = false;
      flushEmit();
    });
  }

  // --- Util perangkat ------------------------------------------------------------------------

  /** Menyamarkan sandi yang dikenal (pertahanan ganda; port sudah menyamarkan). */
  function mask(text: string): string {
    let out = text;
    const secrets = [...(baseCred ? [baseCred.password] : []), ...queue.map((c) => c.password)];
    for (const secret of secrets) {
      if (secret.length >= MIN_MASK_LENGTH) out = out.split(secret).join('***');
    }
    return out;
  }

  function log(d: DeviceRecord, text: string): void {
    d.log.push(`[${clockText(ports.now())}] ${mask(text)}`);
    if (d.log.length > MAX_LOG_LINES) d.log.splice(0, d.log.length - MAX_LOG_LINES);
    scheduleEmit();
  }

  function setStatus(d: DeviceRecord, status: DeviceStatus, message: string): void {
    d.status = status;
    d.message = mask(message);
    scheduleEmit();
  }

  function setNotice(text: string): void {
    notice = mask(text);
    scheduleEmit();
  }

  function live(r: Run, d: DeviceRecord, signal?: AbortSignal): boolean {
    return run === r && r.devices.get(d.mac) === d && !(signal?.aborted ?? r.ctl.signal.aborted);
  }

  function track(r: Run, p: Promise<void>): void {
    const t: Promise<void> = p
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (run === r) setNotice(`Galat internal: ${e instanceof Error ? e.message : String(e)}`);
      })
      .then(() => {
        r.tasks.delete(t);
      });
    r.tasks.add(t);
  }

  async function safePing(ip: string, signal: AbortSignal): Promise<boolean> {
    try {
      return await raceAbort(ports.ping(ip), signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      return false;
    }
  }

  async function safeReadInfo(
    ip: string,
    cred: Credential,
    signal: AbortSignal,
  ): Promise<InfoResult> {
    try {
      return await raceAbort(ports.readInfo(ip, cred), signal);
    } catch (e) {
      if (isAbortError(e)) throw e;
      return { ok: false, error: 'UNAVAILABLE' };
    }
  }

  // --- Pemindaian lease ----------------------------------------------------------------------

  function abortJob(job: InjectJob): void {
    job.cancelled = true;
    job.ctl.abort();
  }

  /**
   * Menerapkan hasil lease ke registri. `seq` = urutan pemanggilan `readLeases`; hasil yang lebih lama dari yang sudah
   * diterapkan dibuang (pemindaian lambat tak boleh menimpa pembacaan yang lebih baru).
   */
  function applyLeases(r: Run, leases: readonly Lease[], seq: number): void {
    if (seq < r.appliedSeq) return;
    r.appliedSeq = seq;
    const before = new Map<string, DeviceStatus>();
    for (const [mac, d] of r.devices) before.set(mac, d.status);
    const res = reconcileLeases([...r.devices.values()], leases, ports.now(), {
      excludeIp: r.cfg.excludeIp,
      graceMs: GRACE_MS,
    });
    const next = new Map<string, DeviceRecord>();
    for (const rec of res.devices) {
      const existing = r.devices.get(rec.mac);
      if (existing) {
        Object.assign(existing, rec);
        next.set(rec.mac, existing);
      } else {
        next.set(rec.mac, rec);
      }
    }
    r.devices = next;

    for (const mac of res.removed) {
      r.loops.get(mac)?.abort();
      r.loops.delete(mac);
      const job = r.jobs.get(mac);
      if (job) abortJob(job);
    }
    for (const mac of res.added) {
      const d = next.get(mac);
      if (!d) continue;
      if (r.sessionMacs.has(mac)) d.injectedThisSession = true;
      log(d, `Perangkat terdeteksi (${d.ip})`);
      const ctl = child(r.ctl.signal);
      r.loops.set(mac, ctl);
      track(r, deviceLoop(r, d, ctl.signal));
    }
    for (const mac of res.ipChanged) {
      const d = next.get(mac);
      if (!d) continue;
      if (d.status === 'waiting') d.message = MSG_IP_CHANGED;
      log(d, `IP berubah menjadi ${d.ip}`);
    }
    for (const d of next.values()) {
      const prev = before.get(d.mac);
      if (prev !== undefined && prev !== 'disconnected' && d.status === 'disconnected') {
        d.pingable = false;
        log(d, d.message);
      } else if (prev === 'disconnected' && d.status !== 'disconnected') {
        log(d, 'Terhubung kembali');
      }
      // Job yang masih antre untuk perangkat yang tak lagi `queued` (IP berubah, terputus) dibatalkan; status sudah
      // diatur registri, jadi jalur batal job tidak boleh menimpanya.
      const job = r.jobs.get(d.mac);
      if (job && job.phase === 'queued' && d.status !== 'queued') abortJob(job);
    }
    scheduleEmit();
  }

  function scanOnce(r: Run): Promise<void> {
    if (r.scanning) return r.scanning;
    const p = (async () => {
      const seq = ++r.readSeq;
      let leases: Lease[] | null;
      try {
        leases = await raceAbort(ports.readLeases(), r.ctl.signal);
      } catch (e) {
        if (isAbortError(e)) return;
        leases = null;
      }
      if (run !== r) return;
      if (leases === null) {
        r.scanError = 'Gagal membaca DHCP lease dari router';
        scheduleEmit();
        return;
      }
      r.scanError = null;
      applyLeases(r, leases, seq);
    })().finally(() => {
      r.scanning = null;
    });
    r.scanning = p;
    return p;
  }

  function scanInterval(r: Run): number {
    let injecting = false;
    for (const d of r.devices.values()) {
      if (d.status === 'injecting') injecting = true;
    }
    if (injecting) return SCAN_INJECTING_MS;
    return r.devices.size > 0 ? SCAN_WITH_DEVICES_MS : SCAN_IDLE_MS;
  }

  async function scanLoop(r: Run): Promise<void> {
    while (!r.ctl.signal.aborted) {
      await scanOnce(r);
      await ports.sleep(scanInterval(r), r.ctl.signal);
    }
  }

  // --- Loop per perangkat (L4.4) -------------------------------------------------------------

  async function deviceLoop(r: Run, d: DeviceRecord, signal: AbortSignal): Promise<void> {
    try {
      while (live(r, d, signal)) {
        const wait = await deviceStep(r, d, signal);
        await ports.sleep(wait, signal);
      }
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }
  }

  /** Satu putaran loop; mengembalikan lama jeda berikutnya. */
  async function deviceStep(r: Run, d: DeviceRecord, signal: AbortSignal): Promise<number> {
    const st = d.status;
    if (
      st === 'pinging' ||
      st === 'fetching_info' ||
      st === 'queued' ||
      st === 'injecting' ||
      st === 'disconnected'
    ) {
      return LOOP_FAST_MS;
    }
    const ip = d.ip;
    const exhausted = st === 'waiting' && d.credentialsExhausted;
    let expected: DeviceStatus = st;
    // Percobaan ulang atas kegagalan yang sudah ditandai (tak merespon, info tak lengkap/tak terbaca) dijalankan
    // "diam" tanpa mengedipkan status tiap putaran; `pinging`/`fetching_info` hanya tampil pada percobaan pertama.
    const retrying =
      st === 'waiting' &&
      (d.message === MSG_NO_PING ||
        d.message === MSG_INCOMPLETE ||
        d.message === MSG_INFO_UNAVAILABLE);
    const quietFetch =
      st === 'waiting' && (d.message === MSG_INCOMPLETE || d.message === MSG_INFO_UNAVAILABLE);
    if (st === 'waiting' && !exhausted && !retrying) {
      setStatus(d, 'pinging', 'Ping...');
      expected = 'pinging';
    }
    const ok = await safePing(ip, signal);
    if (!live(r, d, signal) || d.ip !== ip || d.status !== expected) return LOOP_FAST_MS;
    if (d.pingable !== ok) {
      d.pingable = ok;
      scheduleEmit();
    }

    if (!ok) {
      // `success` tetap `success` (perangkat reboot setelah inject; menurunkannya membuka jalan inject ulang).
      if (expected === 'pinging' || st === 'ready' || st === 'failed') {
        setStatus(d, 'waiting', MSG_NO_PING);
        log(d, MSG_NO_PING);
      }
      return LOOP_FAST_MS;
    }

    switch (d.status) {
      case 'success':
        await refreshInfo(r, d, ip, signal);
        return LOOP_STABLE_MS;
      case 'ready':
      case 'failed':
        return LOOP_STABLE_MS;
      default:
        if (exhausted) return LOOP_FAST_MS;
        await processDevice(r, d, ip, signal, quietFetch);
        return LOOP_FAST_MS;
    }
  }

  async function refreshInfo(
    r: Run,
    d: DeviceRecord,
    ip: string,
    signal: AbortSignal,
  ): Promise<void> {
    const cred = credentialAt(d.credentialIndex, r.cfg.base, queue);
    if (!cred) return;
    const res = await safeReadInfo(ip, cred, signal);
    if (!live(r, d, signal) || d.ip !== ip || d.status !== 'success' || !res.ok) return;
    if (res.model) d.model = res.model;
    if (res.serial) d.serial = res.serial;
    if (res.country) d.country = res.country;
    scheduleEmit();
  }

  /** Dari `waiting`: baca info dengan kredensial berurutan, lalu `ready` (dan Auto Inject bila memenuhi syarat). */
  async function processDevice(
    r: Run,
    d: DeviceRecord,
    ip: string,
    signal: AbortSignal,
    quiet: boolean,
  ): Promise<void> {
    const expected: DeviceStatus = quiet ? 'waiting' : 'fetching_info';
    if (!quiet) setStatus(d, 'fetching_info', 'Cek info...');
    for (;;) {
      const cred = credentialAt(d.credentialIndex, r.cfg.base, queue);
      if (!cred) {
        markExhausted(d);
        return;
      }
      const res = await safeReadInfo(ip, cred, signal);
      if (!live(r, d, signal) || d.ip !== ip || d.status !== expected) return;

      if (res.ok) {
        const model = res.model.trim();
        const serial = res.serial.trim();
        if (serial === '' || model === '') {
          setWaiting(d, MSG_INCOMPLETE);
          return;
        }
        d.model = model;
        d.serial = serial;
        d.country = res.country;
        d.credentialsExhausted = false;
        const key = serialKey(serial);
        d.alreadyRegistered = registered.has(key);
        if (r.sessionSerials.has(key)) d.injectedThisSession = true;
        setStatus(d, 'ready', readyMessage(d));
        log(d, d.message);
        maybeAutoInject(r, d);
        return;
      }
      if (res.error === 'PERMISSION_DENIED') {
        const next = nextCredentialIndex(d.credentialIndex, queue.length);
        if (next === null) {
          markExhausted(d);
          return;
        }
        d.credentialIndex = next;
        continue;
      }
      setWaiting(d, MSG_INFO_UNAVAILABLE);
      return;
    }
  }

  /** `waiting` dengan alasan; baris log hanya ditulis saat alasan berubah (percobaan ulang tak membanjiri log). */
  function setWaiting(d: DeviceRecord, message: string): void {
    const changed = d.message !== message;
    setStatus(d, 'waiting', message);
    if (changed) log(d, message);
  }

  function markExhausted(d: DeviceRecord): void {
    d.credentialsExhausted = true;
    setStatus(d, 'waiting', MSG_DENIED);
    log(d, MSG_DENIED);
  }

  function readyMessage(d: DeviceRecord): string {
    return d.alreadyRegistered ? 'Siap inject (SN sudah terdaftar)' : 'Siap inject';
  }

  /** Auto Inject hanya untuk perangkat yang belum terdaftar dan belum di-inject pada sesi ini. */
  function autoEligible(r: Run, d: DeviceRecord): boolean {
    return (
      autoInject &&
      blockedReason === null &&
      !r.queueStopped &&
      d.status === 'ready' &&
      !d.alreadyRegistered &&
      !d.injectedThisSession
    );
  }

  function maybeAutoInject(_r: Run, _d: DeviceRecord): void {
    // Antrean inject ditambahkan di Task 5.
  }

  // --- API ----------------------------------------------------------------------------------

  const engine: MultiEngine = {
    start(cfg) {
      if (run) return;
      baseCred = cfg.base;
      concurrency = clampConcurrency(cfg.concurrency);
      autoInject = cfg.autoInject;
      notice = '';
      const ctl = new AbortController();
      const r: Run = {
        ctl,
        cfg: { ...cfg, base: { ...cfg.base }, target: { ...cfg.target } },
        scheduler: createScheduler(concurrency),
        devices: new Map(),
        loops: new Map(),
        jobs: new Map(),
        tasks: new Set(),
        sessionMacs: new Set(),
        sessionSerials: new Set(),
        readSeq: 0,
        appliedSeq: 0,
        scanning: null,
        scanError: null,
        queueStopped: false,
      };
      run = r;
      scheduleEmit();
      track(r, scanLoop(r));
    },

    async stop() {
      const r = run;
      if (!r) return;
      run = null;
      notice = '';
      r.ctl.abort();
      flushEmit();
      while (r.tasks.size > 0) await Promise.allSettled([...r.tasks]);
      flushEmit();
    },

    scan() {
      return run ? scanOnce(run) : Promise.resolve();
    },

    setConcurrency(n) {
      concurrency = clampConcurrency(n);
      run?.scheduler.setLimit(concurrency);
      scheduleEmit();
    },

    setAutoInject(on) {
      autoInject = on;
      scheduleEmit();
    },

    addCredential(c) {
      const next = addToQueue(queue, c);
      if (next === queue) return;
      queue = next;
      // Perangkat yang kredensialnya habis dicoba SATU kali lagi, hanya dengan kredensial baru (bukan yang terakhir gagal).
      if (run) {
        for (const d of run.devices.values()) {
          if (d.status === 'waiting' && d.credentialsExhausted) {
            d.credentialIndex =
              nextCredentialIndex(d.credentialIndex, queue.length) ?? d.credentialIndex;
            d.credentialsExhausted = false;
            d.message = MSG_WAITING;
          }
        }
      }
      scheduleEmit();
    },

    setRegistered(serials) {
      registered = new Set(serials.map(serialKey));
      if (run) {
        for (const d of run.devices.values()) {
          if (d.serial === '') continue;
          const was = d.alreadyRegistered;
          d.alreadyRegistered = registered.has(serialKey(d.serial));
          if (d.status === 'ready' && was !== d.alreadyRegistered) d.message = readyMessage(d);
        }
      }
      scheduleEmit();
    },

    setBlocked(reason) {
      blockedReason = reason;
      scheduleEmit();
    },

    snapshot,

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };

  // Dipakai Task 5 (aksi inject); dirujuk agar tidak dianggap tak terpakai.
  void autoEligible;
  return engine;
}
