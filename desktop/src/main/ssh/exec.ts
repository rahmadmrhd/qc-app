// Menjalankan perintah satu-kali (exec-channel) lewat ssh2 dengan satu batas waktu total.
// Dipakai untuk membaca serial/info perangkat (spek §6.2); skrip inject memakai shell interaktif.

import { isPermissionDenied } from '@countrylock/device-info';
import type { ConnectTarget } from '@countrylock/inject-plan';
import { Client } from 'ssh2';

export type SshTarget = ConnectTarget & { port?: number };
export type SshFailure = 'PERMISSION_DENIED' | 'UNAVAILABLE';

export class SshExecError extends Error {
  readonly kind: SshFailure;
  constructor(kind: SshFailure, message: string) {
    super(message);
    this.name = 'SshExecError';
    this.kind = kind;
  }
}

function classify(error: unknown): SshExecError {
  if (error instanceof SshExecError) return error;
  const err = error as Error & { level?: string };
  const message = err?.message ?? String(error);
  // Galat kredensial (inventaris §2.2): "Permission denied" atau "username"; selain itu info tak tersedia.
  if (err?.level === 'client-authentication' || isPermissionDenied(message)) {
    return new SshExecError('PERMISSION_DENIED', 'Permission denied!!!');
  }
  return new SshExecError('UNAVAILABLE', message);
}

function execOne(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.on('close', () => resolve(output));
    });
  });
}

/** Menyambung lalu menjalankan `commands` berurutan; satu `timeoutMs` untuk seluruh operasi. */
export function execCommands(
  target: SshTarget,
  commands: readonly string[],
  opts: { timeoutMs: number; keepaliveMs?: number },
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client.destroy();
      } catch {
        // Sudah tertutup.
      }
      action();
    };
    const timer = setTimeout(
      () => settle(() => reject(new SshExecError('UNAVAILABLE', 'Perangkat tidak menjawab'))),
      opts.timeoutMs,
    );
    client.on('error', (error: Error) => settle(() => reject(classify(error))));
    client.on('close', () =>
      settle(() => reject(new SshExecError('UNAVAILABLE', 'Koneksi terputus'))),
    );
    client.on('ready', () => {
      void (async () => {
        try {
          const outputs: string[] = [];
          for (const command of commands) outputs.push(await execOne(client, command));
          settle(() => resolve(outputs));
        } catch (error) {
          settle(() => reject(classify(error)));
        }
      })();
    });
    try {
      client.connect({
        host: target.host,
        port: target.port ?? 22,
        username: target.username,
        password: target.password,
        readyTimeout: opts.timeoutMs,
        ...(opts.keepaliveMs ? { keepaliveInterval: opts.keepaliveMs } : {}),
      });
    } catch (error) {
      settle(() => reject(classify(error)));
    }
  });
}
