// Eksekutor inject SSH (spek §6.3; perilaku lama: inventaris §3).
//
// Skrip dikirim lewat SHELL INTERAKTIF (bukan exec-channel: pada perangkat nyata exec-channel tidak
// mempertahankan state antar baris), SATU baris per kiriman. Tiap baris diikuti perintah penanda
// (`echo <token>` atau `:put <token>`), dan baris berikutnya baru dikirim setelah token muncul DUA
// kali: kemunculan pertama = echo ketikan pty, kedua = keluaran penanda sungguhan (baris sebelumnya
// tuntas). Keluaran tidak didekode ANSI.

import { randomBytes } from 'node:crypto';
import { isPermissionDenied } from '@countrylock/device-info';
import { Client, type ClientChannel } from 'ssh2';

export type SentinelStrategy = 'echo' | 'put';
/**
 * Kebijakan koneksi putus di tengah skrip. `legacy`: putus SETELAH ada keluaran = sukses (perangkat
 * reboot; perilaku aplikasi lama, berisiko sukses palsu bila putus di baris awal). `last-line-only`:
 * hanya putus saat baris TERAKHIR sedang berjalan yang dianggap sukses.
 */
export type DropPolicy = 'legacy' | 'last-line-only';
export type InjectStage =
  | 'connecting'
  | 'sending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface InjectProgress {
  stage: InjectStage;
  message: string;
}

export interface InjectOptions {
  host: string;
  /** Bawaan 22. */
  port?: number;
  username: string;
  password: string;
  script: string;
  sentinel: SentinelStrategy;
  dropPolicy?: DropPolicy;
  /** Nilai rahasia tambahan (mis. kata sandi lain dalam skrip) yang disamarkan di progres. */
  secrets?: readonly string[];
  timeouts?: Partial<{ connectMs: number; perLineMs: number; overallMs: number }>;
  onProgress(p: InjectProgress): void;
  signal?: AbortSignal;
}

export type InjectReason =
  | 'completed'
  | 'dropped-after-output'
  | 'timeout'
  | 'dropped'
  | 'auth'
  | 'connect'
  | 'cancelled'
  | 'error';

export interface InjectOutcome {
  ok: boolean;
  reason: InjectReason;
}

const DEFAULT_TIMEOUTS = { connectMs: 10_000, perLineMs: 120_000, overallMs: 300_000 };
/** Selang baca/periksa (inventaris §3.2); data yang datang membangunkan loop lebih cepat. */
const POLL_MS = 100;
const SENTINEL_ANY = /__QC_INJECT_[0-9a-f]{8}__/;

export function sentinelCommand(strategy: SentinelStrategy, token: string): string {
  return strategy === 'put' ? `:put ${token}` : `echo ${token}`;
}

/** Ganti tiap kemunculan rahasia dengan `****` (yang terpanjang lebih dahulu; rahasia kosong diabaikan). */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  const ordered = [...new Set(secrets.filter((s) => s.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  let out = text;
  for (const secret of ordered) out = out.split(secret).join('****');
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Seperti `runInject`, tetapi mengembalikan juga alasan hasil (dipakai harness spike T9). */
export async function runInjectDetailed(opts: InjectOptions): Promise<InjectOutcome> {
  const limits = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
  const dropPolicy: DropPolicy = opts.dropPolicy ?? 'legacy';
  const secrets = [opts.password, ...(opts.secrets ?? [])];

  const emit = (stage: InjectStage, message: string): void => {
    try {
      opts.onProgress({ stage, message: maskSecrets(message, secrets) });
    } catch {
      // Pemanggil progres tidak boleh menjatuhkan sesi.
    }
  };

  // Keadaan bersama untuk pendengar peristiwa dan loop utama.
  let cancelled = false;
  let connected = false;
  let closed = false;
  let lastError = null as (Error & { level?: string }) | null;
  let receivedAnyOutput = false;
  let wake: (() => void) | null = null;
  const nudge = (): void => {
    const fn = wake;
    wake = null;
    fn?.();
  };

  const client = new Client();
  // Pendengar 'error' wajib ada sepanjang hidup klien; tanpa itu galat soket menjatuhkan proses.
  client.on('error', (error: Error & { level?: string }) => {
    lastError = error;
    closed = true;
    nudge();
  });
  client.on('close', () => {
    closed = true;
    nudge();
  });
  client.on('end', () => {
    closed = true;
    nudge();
  });
  client.on('ready', () => {
    connected = true;
    nudge();
  });
  // Perangkat tertentu hanya menawarkan keyboard-interactive; jawab dengan kata sandi yang sama.
  client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
    finish(prompts.map(() => opts.password));
  });

  // Pembatalan hanya menyalakan bendera (tidak pernah dilempar atau diteruskan ke promise lain),
  // supaya tidak ada pengecualian yang lolos ke luar (inventaris §3.4).
  const onAbort = (): void => {
    cancelled = true;
    nudge();
  };
  if (opts.signal?.aborted) cancelled = true;
  else opts.signal?.addEventListener('abort', onAbort, { once: true });

  type Wait = 'ok' | 'timeout' | 'cancelled';
  const waitUntil = async (condition: () => boolean, deadline: number): Promise<Wait> => {
    for (;;) {
      if (condition()) return 'ok';
      if (cancelled) return 'cancelled';
      const remaining = deadline - Date.now();
      if (remaining <= 0) return 'timeout';
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(POLL_MS, remaining));
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
    }
  };

  const finish = (ok: boolean, reason: InjectReason, stage: InjectStage, message: string) => {
    emit(stage, message);
    return { ok, reason } satisfies InjectOutcome;
  };
  const cancelledOutcome = () => finish(false, 'cancelled', 'cancelled', 'Dibatalkan.');
  const failureMessage = (fallback: string): string => {
    const err = lastError;
    if (!err) return fallback;
    if (err.level === 'client-authentication' || isPermissionDenied(err.message)) {
      return 'Gagal: Permission denied!!!';
    }
    return `Gagal: ${err.message}`;
  };

  let stream: ClientChannel | null = null;
  try {
    if (cancelled) return cancelledOutcome();

    // 1. Menghubungkan. Host key diterima otomatis (jaringan lokal; spek §6.3), jadi tanpa hostVerifier.
    emit('connecting', `Menghubungkan ke ${opts.host}...`);
    client.connect({
      host: opts.host,
      port: opts.port ?? 22,
      username: opts.username,
      password: opts.password,
      tryKeyboard: true,
      readyTimeout: limits.connectMs,
    });
    const connectWait = await waitUntil(
      () => connected || closed,
      Date.now() + limits.connectMs + 1_000,
    );
    if (connectWait === 'cancelled') return cancelledOutcome();
    if (connectWait === 'timeout') {
      return finish(false, 'connect', 'failed', 'Gagal: timeout menghubungkan ke perangkat.');
    }
    if (!connected) {
      const auth =
        lastError?.level === 'client-authentication' ||
        isPermissionDenied(lastError?.message ?? '');
      return finish(
        false,
        auth ? 'auth' : 'connect',
        'failed',
        failureMessage('Gagal: tidak dapat terhubung ke perangkat.'),
      );
    }

    if (cancelled) return cancelledOutcome();
    emit('sending', 'Mengirim script...');

    // 2. Shell interaktif: pty 200x50 (inventaris §3.1).
    const opened = await new Promise<ClientChannel | Error>((resolve) => {
      client.shell({ term: 'qc-inject', cols: 200, rows: 50, width: 800, height: 600 }, (err, ch) =>
        resolve(err ?? ch),
      );
    });
    if (opened instanceof Error) {
      return finish(false, 'error', 'failed', `Gagal: ${opened.message}`);
    }
    stream = opened;

    // 3. Pembacaan: hitung kemunculan token langkah berjalan dan teruskan baris lain sebagai log.
    const decoder = new TextDecoder('utf-8');
    let token = '';
    let hits = 0;
    let carry = '';
    let lineBuffer = '';

    const forward = (rawLine: string): void => {
      const line = rawLine.trim();
      if (line === '' || SENTINEL_ANY.test(line)) return;
      emit('running', line);
    };
    stream.on('data', (chunk: Buffer) => {
      receivedAnyOutput = true;
      const text = decoder.decode(chunk, { stream: true });
      if (token) {
        // `carry` (token.length - 1 karakter terakhir) menangkap token yang terbelah antar potongan
        // tanpa menghitung dua kali: token utuh tidak muat di dalam carry.
        const scan = carry + text;
        let at = scan.indexOf(token);
        while (at !== -1) {
          hits += 1;
          at = scan.indexOf(token, at + token.length);
        }
        carry = scan.slice(Math.max(0, scan.length - (token.length - 1)));
      }
      lineBuffer += text;
      const parts = lineBuffer.split(/[\r\n]/);
      lineBuffer = parts.pop() ?? '';
      for (const part of parts) forward(part);
      nudge();
    });
    stream.on('close', () => {
      closed = true;
      nudge();
    });
    stream.on('error', (error: Error) => {
      lastError = lastError ?? error;
      closed = true;
      nudge();
    });

    const lines = opts.script
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const overallDeadline = Date.now() + limits.overallMs;

    const writeLine = (text: string): boolean => {
      if (closed || !stream?.writable) return false;
      try {
        stream.write(`${text}\r`);
        return true;
      } catch {
        return false;
      }
    };

    // Putus di tengah skrip (reboot/fwupdate memutus sesi): putuskan sukses atau gagal menurut kebijakan.
    const dropped = (lineIndex: number, written: boolean): InjectOutcome => {
      const isLast = lineIndex === lines.length - 1;
      const treatAsDone = receivedAnyOutput && (dropPolicy === 'legacy' || (isLast && written));
      if (treatAsDone) {
        return finish(
          true,
          'dropped-after-output',
          'completed',
          'Selesai (koneksi terputus - kemungkinan perangkat reboot).',
        );
      }
      return finish(
        false,
        'dropped',
        'failed',
        lastError ? failureMessage('') : 'Gagal: koneksi terputus sebelum skrip selesai.',
      );
    };

    for (let i = 0; i < lines.length; i += 1) {
      if (cancelled) return cancelledOutcome();
      if (closed) return dropped(i, false);

      token = `__QC_INJECT_${randomBytes(4).toString('hex')}__`;
      hits = 0;
      carry = '';
      const line = lines[i] as string;
      if (!writeLine(line) || !writeLine(sentinelCommand(opts.sentinel, token))) {
        return dropped(i, false);
      }

      const deadline = Math.min(Date.now() + limits.perLineMs, overallDeadline);
      const waited = await waitUntil(() => hits >= 2 || closed, deadline);
      if (waited === 'cancelled') return cancelledOutcome();
      if (waited === 'timeout') {
        return finish(
          false,
          'timeout',
          'failed',
          'Gagal: timeout menunggu penyelesaian baris script.',
        );
      }
      if (hits < 2) return dropped(i, true);
    }

    return finish(true, 'completed', 'completed', 'Selesai.');
  } catch (error) {
    // Pembatalan tidak pernah sampai di sini sebagai pengecualian; ini hanya galat tak terduga.
    return finish(false, 'error', 'failed', `Gagal: ${errorMessage(error)}`);
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    try {
      if (connected) client.end();
      else client.destroy();
    } catch {
      // Sudah tertutup.
    }
  }
}

/** Mengembalikan true bila skrip dianggap sukses; tidak pernah melempar (termasuk saat dibatalkan). */
export async function runInject(opts: InjectOptions): Promise<boolean> {
  return (await runInjectDetailed(opts)).ok;
}
