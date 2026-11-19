// Pengambilan host key router untuk placeholder {sshKey} (spek §6.3): blob kunci dari jabat tangan
// ssh2 dalam base64 persis isi known_hosts dropbear Ubiquiti (`<ip> ssh-rsa <base64>`).

import { Client } from 'ssh2';

export interface HostKey {
  /** Nama jenis kunci dari blob, mis. `ssh-rsa`. */
  type: string;
  /** Blob kunci publik (format kawat SSH) dalam base64. */
  base64: string;
}

export type HostKeyErrorCode = 'NOT_RSA' | 'UNREACHABLE' | 'AUTH';

export class HostKeyError extends Error {
  readonly code: HostKeyErrorCode;
  /** Jenis kunci yang ditemukan; terisi pada `NOT_RSA`. */
  readonly hostKeyType?: string;

  constructor(code: HostKeyErrorCode, message: string, hostKeyType?: string) {
    super(message);
    this.name = 'HostKeyError';
    this.code = code;
    if (hostKeyType !== undefined) this.hostKeyType = hostKeyType;
  }
}

export interface HostKeyOptions {
  host: string;
  port?: number;
  username: string;
  password: string;
  timeoutMs?: number;
  /** Membatalkan pengambilan (inject Multi yang dibatalkan tak boleh menunggu router). */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Jenis kunci dari awal blob (uint32 panjang + string nama). */
function blobType(blob: Buffer): string {
  if (blob.length < 4) return '';
  const length = blob.readUInt32BE(0);
  return blob.toString('ascii', 4, 4 + length);
}

/**
 * Menyambung, mencatat host key dari jabat tangan, mengautentikasi, lalu memutus sambungan.
 * Tanpa pemeriksaan RSA (dipakai harness spike untuk melaporkan jenis kunci apa adanya).
 */
export function probeHostKey(opts: HostKeyOptions): Promise<HostKey> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<HostKey>((resolve, reject) => {
    const client = new Client();
    let captured: Buffer | null = null;
    let settled = false;

    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        client.destroy();
      } catch {
        // Sudah tertutup.
      }
      action();
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new HostKeyError('UNREACHABLE', `Host ${opts.host} tidak menjawab dalam batas waktu`),
          ),
        ),
      timeoutMs,
    );
    const onAbort = (): void => settle(() => reject(new HostKeyError('UNREACHABLE', 'Dibatalkan')));
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    if (settled) return;

    client.on('ready', () => {
      settle(() => {
        if (!captured) {
          reject(new HostKeyError('UNREACHABLE', 'Host key tidak diterima dari jabat tangan'));
          return;
        }
        resolve({ type: blobType(captured), base64: captured.toString('base64') });
      });
    });
    client.on('error', (error: Error & { level?: string }) => {
      settle(() => {
        if (error.level === 'client-authentication') {
          reject(new HostKeyError('AUTH', 'Kredensial router ditolak'));
        } else {
          reject(
            new HostKeyError(
              'UNREACHABLE',
              `Tidak dapat terhubung ke ${opts.host}: ${error.message}`,
            ),
          );
        }
      });
    });
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => opts.password));
    });

    try {
      client.connect({
        host: opts.host,
        port: opts.port ?? 22,
        username: opts.username,
        password: opts.password,
        tryKeyboard: true,
        readyTimeout: timeoutMs,
        // Dropbear Ubiquiti mencatat kunci RSA: minta RSA lebih dulu bila router menawarkan beberapa.
        algorithms: {
          serverHostKey: [
            'rsa-sha2-512',
            'rsa-sha2-256',
            'ssh-rsa',
            'ssh-ed25519',
            'ecdsa-sha2-nistp256',
            'ecdsa-sha2-nistp384',
            'ecdsa-sha2-nistp521',
          ],
        },
        // Hanya menangkap: host key tetap diterima otomatis (jaringan lokal; spek §6.3).
        hostVerifier: (key: Buffer) => {
          captured = key;
          return true;
        },
      });
    } catch (error) {
      settle(() =>
        reject(
          new HostKeyError(
            'UNREACHABLE',
            error instanceof Error ? error.message : 'Gagal memulai sambungan',
          ),
        ),
      );
    }
  });
}

/** Host key RSA router; kunci non-RSA ditolak karena known_hosts dropbear memakai `ssh-rsa`. */
export async function fetchHostKey(opts: HostKeyOptions): Promise<HostKey> {
  const key = await probeHostKey(opts);
  if (key.type !== 'ssh-rsa') {
    throw new HostKeyError(
      'NOT_RSA',
      `Router memakai host key ${key.type || 'tak dikenal'}, bukan RSA`,
      key.type,
    );
  }
  return key;
}
