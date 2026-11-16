// Klien aliran notifikasi (SSE) di proses utama: Web Push tidak tersedia di Electron, jadi desktop membuka
// `GET <server>/api/v1/notifications/stream` dengan token Bearer dan meneruskan tiap notifikasi ke OS.
// Token tidak pernah keluar dari proses utama (sama seperti proxy API). Sambung ulang otomatis dengan jeda
// bertahap, `Last-Event-ID` agar tunggakan singkat tak hilang, dan pengawas idle (server mengirim detak jantung
// tiap ~5 dtk; tanpa byte sama sekali = koneksi basi). 401 = token tak lagi sah: berhenti dan lapor.

import { parseStreamNotice, type StreamNotice } from './notice';
import { createSseParser } from './sse';

export interface NotificationStreamDeps {
  serverUrl(): string;
  /** Token Bearer saat ini; `null` = tidak masuk (aliran berhenti). */
  token(): string | null;
  fetchImpl: typeof fetch;
  onNotice(notice: StreamNotice): void;
  /** Server menolak token (401): pemanggil membersihkan token yang sama bila masih berlaku. */
  onUnauthorized(token: string): void;
  retryMinMs?: number;
  retryMaxMs?: number;
  idleTimeoutMs?: number;
}

export interface NotificationStream {
  /** Memulai bila belum jalan dan ada token; aman dipanggil berulang. */
  start(): void;
  /** Menghentikan aliran dan membatalkan sambung ulang. */
  stop(): void;
  isRunning(): boolean;
}

export const STREAM_PATH = '/api/v1/notifications/stream';
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;
/** Detak jantung server 5 dtk; empat kali terlewat = putus. */
const IDLE_TIMEOUT_MS = 20_000;
/** Id kejadian sah dari server = `<waktu ISO>|<id>`; selain itu tak dipakai untuk sambung ulang. */
const EVENT_ID = /^[0-9TZ:.+-]{10,40}\|[A-Za-z0-9_-]{1,64}$/;

export function createNotificationStream(deps: NotificationStreamDeps): NotificationStream {
  const retryMin = deps.retryMinMs ?? RETRY_MIN_MS;
  const retryMax = deps.retryMaxMs ?? RETRY_MAX_MS;
  const idleTimeout = deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  let generation = 0;
  let running = false;
  let controller: AbortController | null = null;
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  let lastEventId: string | null = null;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      wake = resolve;
      sleepTimer = setTimeout(resolve, ms);
    });

  async function connectOnce(gen: number, token: string): Promise<'unauthorized' | 'ended'> {
    const abort = new AbortController();
    controller = abort;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = (): void => {
      clearTimeout(idle);
      idle = setTimeout(() => abort.abort(), idleTimeout);
    };
    try {
      armIdle();
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
      };
      if (lastEventId) headers['last-event-id'] = lastEventId;
      const response = await deps.fetchImpl(`${deps.serverUrl()}${STREAM_PATH}`, {
        headers,
        signal: abort.signal,
        redirect: 'manual',
        cache: 'no-store',
      });
      if (response.status === 401) return 'unauthorized';
      if (response.status !== 200 || !response.body) return 'ended';
      const parser = createSseParser();
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (gen !== generation) return 'ended';
        if (chunk.done) return 'ended';
        armIdle();
        for (const frame of parser.push(decoder.decode(chunk.value, { stream: true }))) {
          if (frame.event !== 'notification') continue;
          const notice = parseStreamNotice(frame.data);
          if (!notice) continue;
          if (frame.id && EVENT_ID.test(frame.id)) lastEventId = frame.id;
          try {
            deps.onNotice(notice);
          } catch {
            // Penampil notifikasi tak boleh memutus aliran.
          }
        }
      }
    } catch {
      return 'ended';
    } finally {
      clearTimeout(idle);
      if (controller === abort) controller = null;
      abort.abort();
    }
  }

  async function loop(gen: number): Promise<void> {
    let delay = retryMin;
    while (gen === generation) {
      const token = deps.token();
      if (!token) break;
      const startedAt = Date.now();
      const result = await connectOnce(gen, token);
      if (gen !== generation) break;
      if (result === 'unauthorized') {
        deps.onUnauthorized(token);
        break;
      }
      // Koneksi yang sempat sehat (>= 30 dtk) mengulang dari jeda terpendek; yang langsung gagal berlipat ganda.
      delay = Date.now() - startedAt >= 30_000 ? retryMin : Math.min(delay * 2, retryMax);
      await sleep(delay);
    }
    if (gen === generation) running = false;
  }

  return {
    start() {
      if (running || !deps.token()) return;
      running = true;
      generation += 1;
      void loop(generation);
    },
    stop() {
      generation += 1;
      running = false;
      controller?.abort();
      controller = null;
      if (sleepTimer) clearTimeout(sleepTimer);
      sleepTimer = null;
      wake?.();
      wake = null;
      lastEventId = null;
    },
    isRunning: () => running,
  };
}
