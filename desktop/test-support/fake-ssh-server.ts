// Server SSH palsu untuk tes (bukan produk): meniru cukup banyak perilaku shell interaktif
// BusyBox/dropbear dan RouterOS agar eksekutor inject dapat dites tanpa perangkat nyata.
// Asumsi tiruan dapat meleset dari perangkat sungguhan (spek §11); spike T9 yang menentukan.

import { generateKeyPairSync } from 'node:crypto';
import { Server, utils } from 'ssh2';

export type FakeShell = 'busybox' | 'routeros';
export type FakeHostKeyType = 'rsa' | 'ed25519';

export interface FakeSshServerOptions {
  username: string;
  password: string;
  shell: FakeShell;
  /** Dipanggil untuk tiap baris masukan yang DITERIMA (termasuk baris penanda), saat diterima. */
  onLine?(line: string): void;
  /**
   * Putuskan koneksi tepat setelah baris skrip ke-N diterima (baris penanda tidak dihitung;
   * echo baris itu sudah terkirim). 0 = putus segera setelah shell dibuka, tanpa keluaran apa pun.
   */
  dropAfterLine?: number;
  /** Jenis kunci host (bawaan 'rsa'). */
  hostKeyType?: FakeHostKeyType;
}

export interface FakeSshServer {
  port: number;
  /** Blob kunci publik host (format kawat SSH) dalam base64, seperti isi known_hosts. */
  hostKeyBase64: string;
  close(): Promise<void>;
}

interface HostKey {
  pem: string;
  base64: string;
}

// Kunci dibangkitkan saat tes berjalan (tidak ada kunci di repo) dan dipakai ulang per proses.
const hostKeys = new Map<FakeHostKeyType, HostKey>();

function hostKeyFor(type: FakeHostKeyType): HostKey {
  const cached = hostKeys.get(type);
  if (cached) return cached;
  const pem =
    type === 'rsa'
      ? generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }).privateKey
      : // ssh2 hanya membaca ed25519 berformat OpenSSH, yang tak dapat diekspor oleh node:crypto.
        utils.generateKeyPairSync('ed25519').private;
  const parsed = utils.parseKey(pem);
  if (parsed instanceof Error) throw parsed;
  const key = (Array.isArray(parsed) ? parsed[0] : parsed) as { getPublicSSH(): Buffer };
  const entry = { pem, base64: key.getPublicSSH().toString('base64') };
  hostKeys.set(type, entry);
  return entry;
}

const SENTINEL_LINE = /^(echo|:put) __QC_INJECT_[0-9a-f]{8}__$/;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Eksekusi satu baris pada shell tiruan; mengembalikan keluaran (tanpa echo ketikan). */
async function execute(shell: FakeShell, line: string): Promise<string> {
  // `sleep <ms>`: perintah lama yang menahan shell; tipikal `scp`/`fwupdate` pada perangkat nyata.
  const sleep = /^sleep (\d+)$/.exec(line);
  if (sleep) {
    await delay(Number(sleep[1]));
    return '';
  }
  if (shell === 'busybox') {
    const echo = /^echo (.*)$/.exec(line);
    return echo ? `${echo[1]}\r\n` : '';
  }
  const put = /^:put (.*)$/.exec(line);
  if (put) return `${put[1]}\r\n`;
  if (line.startsWith(':') || line.startsWith('/')) return '';
  const word = line.split(/\s+/)[0] ?? '';
  return `bad command name ${word} (line 1 column 1)\r\n`;
}

export function startFakeSshServer(opts: FakeSshServerOptions): Promise<FakeSshServer> {
  const hostKey = hostKeyFor(opts.hostKeyType ?? 'rsa');
  const connections = new Set<{ end(): void; destroy?(): void }>();

  const server = new Server({ hostKeys: [hostKey.pem] }, (conn) => {
    connections.add(conn);
    conn.on('error', () => {});
    conn.on('close', () => connections.delete(conn));
    conn.on('authentication', (ctx) => {
      if (
        ctx.method === 'password' &&
        ctx.username === opts.username &&
        ctx.password === opts.password
      ) {
        ctx.accept();
      } else {
        ctx.reject(['password']);
      }
    });
    conn.on('ready', () => {
      conn.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('pty', (accept) => accept?.());
        session.on('shell', (accept) => {
          const stream = accept();
          runShell(stream, () => conn.end());
        });
      });
    });
  });

  function runShell(
    stream: NodeJS.ReadWriteStream & { end(): void; writable: boolean },
    hangUp: () => void,
  ): void {
    let dead = false;
    const die = () => {
      dead = true;
    };
    stream.on('close', die);
    stream.on('error', die);
    const send = (text: string) => {
      if (!dead && text) stream.write(text);
    };
    const dropNow = () => {
      dead = true;
      stream.end();
      hangUp();
    };
    if (opts.dropAfterLine === 0) {
      dropNow();
      return;
    }

    let inbuf = '';
    let scriptLines = 0;
    const queue: string[] = [];
    let draining = false;

    const drain = async () => {
      if (draining) return;
      draining = true;
      while (!dead && queue.length > 0) {
        const line = queue.shift() as string;
        send(await execute(opts.shell, line));
      }
      draining = false;
    };

    stream.on('data', (chunk: Buffer) => {
      inbuf += chunk.toString('utf8');
      for (;;) {
        const match = /[\r\n]/.exec(inbuf);
        if (!match || dead) break;
        const line = inbuf.slice(0, match.index);
        inbuf = inbuf.slice(match.index + 1);
        if (line.trim() === '') continue;
        // Echo pty: ketikan tampil segera, sebelum perintah dieksekusi.
        send(`${line}\r\n`);
        opts.onLine?.(line);
        if (!SENTINEL_LINE.test(line)) {
          scriptLines += 1;
          if (opts.dropAfterLine === scriptLines) {
            dropNow();
            return;
          }
        }
        queue.push(line);
      }
      void drain();
    });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('server palsu tidak mendapat port'));
        return;
      }
      resolve({
        port: address.port,
        hostKeyBase64: hostKey.base64,
        close: () =>
          new Promise<void>((done) => {
            for (const conn of connections) conn.end();
            server.close(() => done());
          }),
      });
    });
  });
}
