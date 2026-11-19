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
  /** Detail galat internal (bisa memuat jalur lokal): hanya untuk log proses utama, TIDAK pernah masuk snapshot. */
  logError?(scope: string, error: unknown): void;
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
  /**
   * Antre inject satu perangkat (`ready` atau `failed` = Retry). Pada perangkat `waiting` yang kredensialnya sudah habis,
   * aksi yang sama berarti "coba ulang kredensial dari awal" (pemicu Retry manual di spek). Ditolak saat diblokir atau
   * antrean dihentikan operator.
   */
  injectDevice(mac: string): void;
  /** Perangkat antre kembali `ready`; yang sedang `injecting` diminta batal (menjadi `failed` "Dibatalkan"). */
  cancelDevice(mac: string): void;
  /**
   * Menyapu perangkat `ready` sekali dan mencabut penghentian antrean. Yang sudah di-inject di sesi ini atau serialnya
   * sudah terdaftar di draft dilewati (inject manual per perangkat tetap boleh).
   */
  injectAll(): void;
  /** Menghentikan antrean: yang `queued` dibatalkan, yang `injecting` dibiarkan selesai. */
  stopQueue(): void;
  /** Seperti `stopQueue` lalu membatalkan juga yang `injecting`. */
  cancelAll(): void;
  /** Satu-satunya jalan mengubah konfigurasi router (tombol eksplisit); tidak pernah dipanggil otomatis. */
  prepareBridge(): Promise<{ ok: boolean; message: string }>;
  /**
   * Masih ada inject yang berjalan atau antre, TERMASUK inject yang sedang diselesaikan setelah `stop()` (stop membatalkan
   * secara sinkron, tetapi inject baru benar-benar selesai saat port menyelesaikan diri).
   */
  isBusy(): boolean;
  /** Peristiwa inject sukses yang belum di-ack (bertahan setelah berhenti dan muat ulang renderer). */
  pendingEvents(): InjectedEvent[];
  ackInjected(ids: string[]): void;
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
/** Jeda minimum antar emisi snapshot (leading + trailing): progres SSH sering datang beruntun. */
export const EMIT_MIN_INTERVAL_MS = 150;
/** Jeda sebelum perangkat yang gagal diverifikasi leasenya (jalur Auto Inject) diantre lagi. */
const AUTO_RETRY_MS = 3000;
/** Sandi lebih pendek dari ini tidak disamarkan di teks (akan merusak angka/IP di baris log). */
const MIN_MASK_LENGTH = 4;

const MSG_NO_PING = 'Tidak merespon ping';
const MSG_DENIED = 'Permission denied!!!';
const MSG_INCOMPLETE = 'Info perangkat tidak lengkap';
const MSG_INFO_UNAVAILABLE = 'Info perangkat tidak terbaca';
const MSG_IP_CHANGED = 'IP berubah, memeriksa ulang';
const MSG_RECORD_FAILED =
  'Inject selesai tetapi hasil gagal dicatat (tekan Retry untuk mencatat ulang)';

type InfoResult = Awaited<ReturnType<MultiPorts['readInfo']>>;

interface InjectJob {
  ctl: AbortController;
  phase: 'queued' | 'injecting';
  cancelled: boolean;
  /** Diantre Auto Inject (bukan aksi operator). */
  auto: boolean;
}

interface LeaseRead {
  seq: number;
  /** `null` = galat baca. */
  leases: Lease[] | null;
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
  /** Satu pembacaan lease segar pada satu waktu; pemindaian dan verifikasi inject bergabung ke yang sedang berjalan. */
  reading: Promise<LeaseRead> | null;
  scanError: string | null;
  queueStopped: boolean;
  /** Perangkat yang dikembalikan `ready` oleh blokir draft (nilai = diantre manual?): diantre lagi saat blokir dicabut. */
  heldByBlock: Map<string, boolean>;
  /** Perangkat ter-inject yang peristiwanya gagal ditulis: Retry menulis ulang, TIDAK meng-inject ulang. */
  unwritten: Map<string, InjectedEvent>;
  /** Perangkat dengan percobaan ulang Auto Inject terjadwal (satu per perangkat). */
  autoRetry: Set<string>;
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

const detachers = new WeakMap<AbortController, () => void>();

/**
 * Controller anak: batal bersama induknya. Listener di induk dilepas saat anak batal sendiri atau `release(anak)`
 * dipanggil (loop/job selesai), jadi tidak menumpuk di signal induk yang berumur panjang.
 */
function child(parent: AbortSignal): AbortController {
  const ctl = new AbortController();
  if (parent.aborted) {
    ctl.abort();
    return ctl;
  }
  const onAbort = (): void => ctl.abort();
  const detach = (): void => parent.removeEventListener('abort', onAbort);
  parent.addEventListener('abort', onAbort, { once: true });
  ctl.signal.addEventListener('abort', detach, { once: true });
  detachers.set(ctl, detach);
  return ctl;
}

/** Melepas anak dari induknya tanpa membatalkannya. */
function detachChild(ctl: AbortController): void {
  detachers.get(ctl)?.();
  detachers.delete(ctl);
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
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  let trailingPending = false;
  let emitCtl = new AbortController();
  /** Run yang sudah dihentikan tetapi inject/tugasnya belum selesai (lihat `isBusy`). */
  const draining = new Set<Run>();

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
    lastEmitAt = ports.now();
    for (const cb of [...listeners]) cb(snap);
  }

  /**
   * Digabung per rantai microtask dan ditahan paling cepat `EMIT_MIN_INTERVAL_MS` antar emisi (leading + trailing: emisi
   * pertama langsung, perubahan sesudahnya digabung menjadi satu emisi akhir). Timer trailing memakai `ports.sleep` dengan
   * signal sendiri yang dibatalkan `stop()`, jadi tak ada timer tersisa saat berhenti; engine berhenti memancar langsung.
   */
  function scheduleEmit(): void {
    if (emitScheduled || trailingPending) return;
    const wait = run ? lastEmitAt + EMIT_MIN_INTERVAL_MS - ports.now() : 0;
    if (wait > 0) {
      trailingPending = true;
      const ctl = emitCtl;
      ports.sleep(wait, ctl.signal).then(
        () => {
          if (emitCtl !== ctl) return;
          trailingPending = false;
          flushEmit();
        },
        () => {
          if (emitCtl === ctl) trailingPending = false;
        },
      );
      return;
    }
    emitScheduled = true;
    void Promise.resolve().then(() => {
      emitScheduled = false;
      flushEmit();
    });
  }

  function cancelTrailingEmit(): void {
    emitCtl.abort();
    emitCtl = new AbortController();
    trailingPending = false;
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

  /** Pesan penolakan antrean dibersihkan begitu penyebabnya dicabut (blokir dilepas, antrean dinyalakan lagi). */
  function clearNoticeIfHold(): void {
    if (notice.startsWith('Inject ditahan') || notice.startsWith('Antrian sedang dihentikan')) {
      notice = '';
      scheduleEmit();
    }
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
      r.heldByBlock.delete(mac);
      r.unwritten.delete(mac);
      r.autoRetry.delete(mac);
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
      track(r, deviceLoop(r, d, ctl));
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

  /**
   * Satu pembacaan lease segar pada satu waktu (spek Risiko: satu pemindaian pada satu waktu): panggilan yang datang saat
   * pembacaan sedang berjalan bergabung ke yang itu. Hasil diterapkan ke registri SEKALI, di sini. Menolak `AbortError`
   * bila engine berhenti.
   */
  function readLeasesShared(r: Run): Promise<LeaseRead> {
    if (r.reading) return r.reading;
    const p = (async (): Promise<LeaseRead> => {
      const seq = ++r.readSeq;
      let leases: Lease[] | null;
      try {
        leases = await raceAbort(ports.readLeases(), r.ctl.signal);
      } catch (e) {
        if (isAbortError(e)) throw e;
        leases = null;
      }
      if (run === r) {
        if (leases === null) {
          r.scanError = 'Gagal membaca DHCP lease dari router';
          scheduleEmit();
        } else {
          r.scanError = null;
          applyLeases(r, leases, seq);
        }
      }
      return { seq, leases };
    })().finally(() => {
      r.reading = null;
    });
    r.reading = p;
    return p;
  }

  async function scanOnce(r: Run): Promise<void> {
    try {
      await readLeasesShared(r);
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }
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

  async function deviceLoop(r: Run, d: DeviceRecord, ctl: AbortController): Promise<void> {
    const signal = ctl.signal;
    try {
      while (live(r, d, signal)) {
        const wait = await deviceStep(r, d, signal);
        await ports.sleep(wait, signal);
      }
    } catch (e) {
      if (!isAbortError(e)) throw e;
    } finally {
      detachChild(ctl);
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
    // Pembacaan ulang berkala (tiap 800 ms) hanya memicu emisi bila ada yang benar-benar berubah.
    let changed = false;
    if (res.model && res.model !== d.model) {
      d.model = res.model;
      changed = true;
    }
    if (res.serial && res.serial !== d.serial) {
      d.serial = res.serial;
      changed = true;
    }
    if (res.country && res.country !== d.country) {
      d.country = res.country;
      changed = true;
    }
    if (changed) scheduleEmit();
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

  function maybeAutoInject(r: Run, d: DeviceRecord): void {
    if (autoEligible(r, d)) queueDevice(r, d, false);
  }

  // --- Antrean dan eksekusi inject (L4.5) -----------------------------------------------------

  function backToReady(d: DeviceRecord, message: string): void {
    setStatus(d, 'ready', message);
    log(d, message);
  }

  /**
   * Memasukkan perangkat ke antrean. `manual` = aksi operator (menulis pesan bila ditolak; Auto Inject diam).
   * Mengembalikan `true` bila job dibuat.
   */
  function queueDevice(r: Run, d: DeviceRecord, manual: boolean): boolean {
    if (d.status !== 'ready' && d.status !== 'failed') return false;
    if (r.jobs.has(d.mac)) return false;
    if (blockedReason !== null) {
      if (manual) setNotice(`Inject ditahan: ${blockedReason}`);
      return false;
    }
    if (r.queueStopped) {
      if (manual) setNotice('Antrian sedang dihentikan operator');
      return false;
    }
    if (manual && d.alreadyRegistered) {
      log(d, 'SN sudah terdaftar di draft; inject manual dilanjutkan');
    }
    r.heldByBlock.delete(d.mac);
    const job: InjectJob = {
      ctl: child(r.ctl.signal),
      phase: 'queued',
      cancelled: false,
      auto: !manual,
    };
    r.jobs.set(d.mac, job);
    setStatus(d, 'queued', 'Antri');
    log(d, 'Masuk antrean inject');
    track(r, runInject(r, d, job));
    return true;
  }

  /** Job masih relevan: engine sama, record sama, tak dibatalkan. */
  function jobAlive(r: Run, d: DeviceRecord, job: InjectJob): boolean {
    return run === r && r.devices.get(d.mac) === d && !job.cancelled && !job.ctl.signal.aborted;
  }

  /**
   * Mencocokkan IP perangkat dengan lease TERBARU (Review Focus 1: dua MAC bertukar IP tidak boleh membuat inject
   * salah sasaran). Keputusan diambil dari daftar lease segar itu sendiri, bukan dari hasil rekonsiliasi (yang dapat
   * dibuang karena usang). Hasil pembacaan tetap diterapkan agar status perangkat konsisten.
   */
  async function verifyLease(
    r: Run,
    d: DeviceRecord,
    ip: string,
  ): Promise<'ok' | 'moved' | 'unknown'> {
    // Bergabung ke pembacaan yang sedang berjalan (satu sesi SSH untuk semua inject yang menunggu verifikasi).
    const { leases } = await readLeasesShared(r);
    if (leases === null) return 'unknown';
    const usable = leases.filter((l) => !(r.cfg.excludeIp !== '' && l.ip === r.cfg.excludeIp));
    const mine = usable.find((l) => l.mac === d.mac);
    if (!mine || mine.ip !== ip) return 'moved';
    if (usable.some((l) => l.ip === ip && l.mac !== d.mac)) return 'moved';
    return 'ok';
  }

  async function runInject(r: Run, d: DeviceRecord, job: InjectJob): Promise<void> {
    const mac = d.mac;
    const ip = d.ip;
    let release: (() => void) | null = null;
    try {
      try {
        release = await r.scheduler.acquire(job.ctl.signal);
      } catch (e) {
        if (isAbortError(e)) return; // status sudah diatur pembatal
        throw e;
      }
      if (!jobAlive(r, d, job) || d.status !== 'queued') return;
      if (blockedReason !== null) {
        holdForBlock(r, d, job);
        return;
      }

      let check: 'ok' | 'moved' | 'unknown';
      try {
        // Pembacaan bersama tak boleh membuat job ini menunggu setelah dibatalkan (port nyata tak selalu menghormati abort).
        check = await raceAbort(verifyLease(r, d, ip), job.ctl.signal);
      } catch (e) {
        if (isAbortError(e)) return;
        throw e;
      }
      if (!jobAlive(r, d, job) || d.status !== 'queued') return;
      if (check === 'moved') {
        // Registri sudah mengatur status bila lease berubah/hilang; sisanya (mis. IP kembar) kembali memeriksa ulang.
        setStatus(d, 'waiting', MSG_IP_CHANGED);
        log(d, MSG_IP_CHANGED);
        return;
      }
      if (check === 'unknown') {
        backToReady(d, 'Gagal memeriksa lease, coba lagi');
        // Auto Inject tak akan menyapu perangkat ini lagi sendiri: coba lagi setelah jeda (satu percobaan terjadwal).
        if (job.auto) scheduleAutoRetry(r, d);
        return;
      }
      if (blockedReason !== null) {
        holdForBlock(r, d, job);
        return;
      }

      job.phase = 'injecting';
      setStatus(d, 'injecting', 'Inject...');
      log(d, `=== Mulai inject (${ip}) ===`);
      const cred = credentialAt(d.credentialIndex, r.cfg.base, queue) ?? r.cfg.base;
      let result: Awaited<ReturnType<MultiPorts['inject']>>;
      try {
        result = await ports.inject(
          { id: ports.newId(), ip, cred, firmwareCode: r.cfg.firmwareCode },
          job.ctl.signal,
          (message) => {
            if (r.devices.get(mac) !== d || d.status !== 'injecting') return;
            d.message = mask(message);
            log(d, message);
          },
        );
      } catch (e) {
        const cancelled = isAbortError(e) || job.cancelled || job.ctl.signal.aborted;
        result = {
          ok: false,
          stage: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? 'Dibatalkan' : e instanceof Error ? e.message : 'Inject gagal',
        };
      }
      finishInject(r, d, job, result);
    } finally {
      if (r.jobs.get(mac) === job) r.jobs.delete(mac);
      detachChild(job.ctl);
      release?.();
    }
  }

  /** Perangkat kembali `ready` karena blokir draft; diantre lagi (dengan asal yang sama) saat blokir dicabut. */
  function holdForBlock(r: Run, d: DeviceRecord, job: InjectJob): void {
    r.heldByBlock.set(d.mac, !job.auto);
    backToReady(d, `Ditahan: ${blockedReason ?? 'draft'}`);
  }

  function scheduleAutoRetry(r: Run, d: DeviceRecord): void {
    if (r.autoRetry.has(d.mac)) return;
    r.autoRetry.add(d.mac);
    track(
      r,
      (async () => {
        try {
          await ports.sleep(AUTO_RETRY_MS, r.ctl.signal);
        } finally {
          r.autoRetry.delete(d.mac);
        }
        if (live(r, d)) maybeAutoInject(r, d);
      })(),
    );
  }

  function finishInject(
    r: Run,
    d: DeviceRecord,
    job: InjectJob,
    result: Awaited<ReturnType<MultiPorts['inject']>>,
  ): void {
    if (result.ok && result.stage === 'completed') {
      const event: InjectedEvent = {
        eventId: ports.newId(),
        mac: d.mac,
        serial: d.serial,
        model: d.model,
        injectedAt: new Date(ports.now()).toISOString(),
        target: { ...r.cfg.target },
      };
      // Sesi menandai perangkat ini sebelum apa pun: inject ulang otomatis tak boleh terjadi walau pencatatan gagal.
      r.sessionMacs.add(d.mac);
      r.sessionSerials.add(serialKey(d.serial));
      d.injectedThisSession = true;
      // Ditulis SEBELUM status `success` terlihat, jadi renderer tak pernah melihat "Selesai" tanpa peristiwanya.
      if (!recordEvent(r, d, event)) return;
      setStatus(d, 'success', 'Selesai');
      log(d, '=== Selesai ===');
      return;
    }
    if (result.stage === 'cancelled' || job.cancelled) {
      setStatus(d, 'failed', 'Dibatalkan');
      log(d, '=== Dibatalkan oleh operator ===');
      return;
    }
    setStatus(d, 'failed', result.message || 'Inject gagal');
    log(d, `=== Gagal: ${d.message} ===`);
  }

  /**
   * Menulis peristiwa ke penyimpanan. Gagal = `failed` dengan pesan generik (detail, yang bisa memuat jalur lokal, hanya
   * ke `ports.logError`) dan peristiwa ditahan di engine: Retry menulis ulang, bukan meng-inject ulang perangkat yang
   * sudah ter-inject.
   */
  function recordEvent(r: Run, d: DeviceRecord, event: InjectedEvent): boolean {
    try {
      ports.events.add(event);
      r.unwritten.delete(d.mac);
      return true;
    } catch (e) {
      ports.logError?.('multi.events.add', e);
      r.unwritten.set(d.mac, event);
      setStatus(d, 'failed', MSG_RECORD_FAILED);
      log(d, d.message);
      return false;
    }
  }

  /** Antre → `ready` (segera, tanpa menunggu job); injecting → minta batal (hasil dari port). */
  function cancelJob(r: Run, d: DeviceRecord, readyMessage: string): void {
    const job = r.jobs.get(d.mac);
    if (!job) return;
    if (job.phase === 'queued') {
      abortJob(job);
      // Dilepas segera (bukan menunggu job menyelesaikan diri) agar perangkat dapat diantre lagi seketika.
      if (r.jobs.get(d.mac) === job) r.jobs.delete(d.mac);
      if (d.status === 'queued') backToReady(d, readyMessage);
    } else {
      abortJob(job);
      log(d, 'Pembatalan diminta...');
    }
  }

  function autoSweep(r: Run): void {
    for (const d of [...r.devices.values()]) maybeAutoInject(r, d);
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
        reading: null,
        scanError: null,
        queueStopped: false,
        heldByBlock: new Map(),
        unwritten: new Map(),
        autoRetry: new Set(),
      };
      run = r;
      lastEmitAt = Number.NEGATIVE_INFINITY;
      scheduleEmit();
      track(r, scanLoop(r));
    },

    async stop() {
      const r = run;
      if (!r) return;
      run = null;
      notice = '';
      draining.add(r);
      r.ctl.abort();
      cancelTrailingEmit();
      flushEmit();
      try {
        while (r.tasks.size > 0) await Promise.allSettled([...r.tasks]);
      } finally {
        draining.delete(r);
      }
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
      if (on && run) {
        // Menyalakan Auto Inject mencabut penghentian antrean (L4.5) dan menyapu perangkat yang sudah `ready`.
        run.queueStopped = false;
        clearNoticeIfHold();
        autoSweep(run);
      }
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
      const r = run;
      if (r && reason !== null) {
        // Tak ada slot baru: yang masih antre kembali `ready`; yang sudah `injecting` dibiarkan selesai.
        for (const d of [...r.devices.values()]) {
          const job = r.jobs.get(d.mac);
          if (job && job.phase === 'queued') {
            r.heldByBlock.set(d.mac, !job.auto);
            cancelJob(r, d, `Ditahan: ${reason}`);
          }
        }
      } else if (r) {
        clearNoticeIfHold();
        // Perangkat yang dikembalikan blokir (antrean manual) diantre lagi; yang tak pernah diantre tidak disentuh.
        const held = [...r.heldByBlock];
        r.heldByBlock.clear();
        for (const [mac, manual] of held) {
          const d = r.devices.get(mac);
          if (d && d.status === 'ready') queueDevice(r, d, manual);
        }
        autoSweep(r);
      }
      scheduleEmit();
    },

    injectDevice(mac) {
      const r = run;
      const d = r?.devices.get(mac);
      if (!r || !d) return;
      const unwritten = r.unwritten.get(mac);
      if (unwritten && (d.status === 'failed' || d.status === 'ready')) {
        // Perangkat sudah ter-inject; hanya pencatatan hasilnya yang gagal: tulis ulang, jangan inject lagi.
        log(d, 'Mencatat ulang hasil inject');
        if (recordEvent(r, d, unwritten)) {
          setStatus(d, 'success', 'Selesai');
          log(d, '=== Selesai ===');
        }
        return;
      }
      if (d.status === 'waiting' && d.credentialsExhausted) {
        // Retry manual: kredensial dicoba lagi dari awal.
        d.credentialIndex = 0;
        d.credentialsExhausted = false;
        setStatus(d, 'waiting', MSG_WAITING);
        log(d, 'Coba ulang kredensial');
        return;
      }
      queueDevice(r, d, true);
    },

    cancelDevice(mac) {
      const r = run;
      const d = r?.devices.get(mac);
      if (!r || !d) return;
      r.heldByBlock.delete(mac);
      cancelJob(r, d, 'Dibatalkan (masih antri)');
    },

    injectAll() {
      const r = run;
      if (!r) return;
      r.queueStopped = false;
      clearNoticeIfHold();
      if (blockedReason !== null) {
        setNotice(`Inject ditahan: ${blockedReason}`);
        return;
      }
      for (const d of [...r.devices.values()]) {
        // Dilewati: perangkat yang sudah di-inject pada sesi ini (mis. muncul lagi setelah dicabut) dan yang serialnya
        // sudah terdaftar di draft (keputusan pemilik 2026-11-19; inject manual per perangkat tetap boleh).
        if (d.status === 'ready' && !d.injectedThisSession && !d.alreadyRegistered) {
          queueDevice(r, d, true);
        }
      }
    },

    stopQueue() {
      const r = run;
      if (!r) return;
      r.queueStopped = true;
      r.heldByBlock.clear();
      for (const d of [...r.devices.values()]) {
        const job = r.jobs.get(d.mac);
        if (job && job.phase === 'queued') cancelJob(r, d, 'Dibatalkan (masih antri)');
      }
      scheduleEmit();
    },

    cancelAll() {
      const r = run;
      if (!r) return;
      r.queueStopped = true;
      r.heldByBlock.clear();
      for (const d of [...r.devices.values()]) cancelJob(r, d, 'Dibatalkan (masih antri)');
      scheduleEmit();
    },

    async prepareBridge() {
      let result: { ok: boolean; message: string };
      try {
        result = await ports.ensureBridgePorts();
      } catch (e) {
        result = {
          ok: false,
          message: `Gagal menyiapkan bridge router: ${e instanceof Error ? e.message : 'galat tak dikenal'}`,
        };
      }
      const out = { ok: result.ok, message: mask(result.message) };
      setNotice(out.message);
      return out;
    },

    isBusy() {
      if (draining.size > 0) return true;
      if (!run) return false;
      for (const d of run.devices.values()) {
        if (d.status === 'queued' || d.status === 'injecting') return true;
      }
      return false;
    },

    pendingEvents() {
      return ports.events.list();
    },

    ackInjected(ids) {
      ports.events.ack(ids);
    },

    snapshot,

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };

  return engine;
}
