// Ping ICMP lewat `ping.exe` (Node tak punya soket raw). `ping.exe` Windows berkode keluar 0 walau
// tujuan tak terjangkau dan keluarannya berbahasa lokal, jadi sukses HANYA bila ada `TTL=`.

import { execFile } from 'node:child_process';
import { isValidHost } from '@countrylock/host';
import type { PingKind } from '@countrylock/inject-plan';

export type PingRunner = (host: string, timeoutMs: number) => Promise<string>;

/** Menjalankan `ping.exe -n 1 -w <ms> <host>`; mengembalikan stdout (kode keluar diabaikan). */
const defaultRunner: PingRunner = (host, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      'ping.exe',
      ['-n', '1', '-w', String(timeoutMs), host],
      { windowsHide: true, timeout: timeoutMs + 3000, encoding: 'utf8' },
      (error, stdout) => {
        // Kode keluar != 0 tetap membawa keluaran yang dapat diklasifikasi; hanya kegagalan
        // menjalankan proses (ENOENT, timeout proses) yang menjadi galat.
        if (error && typeof (error as NodeJS.ErrnoException).code !== 'number') {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });

const UNREACHABLE =
  /unreachable|tidak\s+(?:dapat\s+|bisa\s+)?(?:dijangkau|terjangkau|dicapai)|general failure|kegagalan umum/i;
const TIMEOUT = /timed out|waktu\s+permintaan\s+habis|request timeout/i;
const UNRESOLVED = /could not find host|tidak dapat menemukan host|transmit failed/i;

export function classifyPing(output: string): PingKind {
  if (/TTL=/i.test(output)) return 'success';
  if (UNREACHABLE.test(output)) return 'unreachable';
  if (UNRESOLVED.test(output)) return 'error';
  if (TIMEOUT.test(output)) return 'timeout';
  // Status lain diperlakukan sebagai timeout (jeda 200 ms, inventaris §1.3).
  return 'timeout';
}

export async function pingOnce(
  host: string,
  timeoutMs: number,
  run: PingRunner = defaultRunner,
): Promise<{ ok: boolean; kind: PingKind }> {
  // Host dari renderer/konfigurasi tak tepercaya: tolak sebelum menyentuh proses.
  if (!isValidHost(host)) return { ok: false, kind: 'error' };
  try {
    const kind = classifyPing(await run(host, timeoutMs));
    return { ok: kind === 'success', kind };
  } catch {
    return { ok: false, kind: 'error' };
  }
}
