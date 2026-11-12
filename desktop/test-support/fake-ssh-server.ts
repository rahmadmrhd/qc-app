// Server SSH palsu untuk tes (bukan produk): meniru cukup banyak perilaku shell interaktif
// BusyBox/dropbear dan RouterOS agar eksekutor inject dan harness spike dapat dites tanpa
// perangkat nyata. Asumsi tiruan dapat meleset dari perangkat sungguhan (spek §11); spike T9
// di perangkat nyata yang menentukan.

import { generateKeyPairSync } from 'node:crypto';
import { Server, type SFTPWrapper, utils } from 'ssh2';

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
  /** RouterOS: keluaran `/system device-mode print` dan apakah `/import` diblokir (spike T9). */
  deviceMode?: { mode: string; importBlocked?: boolean };
  /** Simulasi konsol yang menggambar ulang ketikan: echo tiap baris tampil dua kali. */
  echoTwice?: boolean;
  /** Teks yang dikirim segera setelah shell dibuka (banner/prompt; perangkat nyata selalu punya). */
  banner?: string;
  /** Tunda pembukaan shell (ms): perangkat yang lambat menyiapkan pty/banner. */
  shellOpenDelayMs?: number;
  /**
   * Bungkus echo baris SKRIP (bukan penanda) dengan `\r\n` tiap N karakter, seperti terminal lebar
   * terbatas; menguji penyamaran sandi yang terbelah baris.
   */
  wrapEchoAt?: number;
  /** BusyBox: sumber berkas untuk `scp <u>@<h>:<jauh> <lokal>`; undefined = berkas tak ada. */
  scpSource?(remotePath: string): Buffer | undefined;
}

export interface FakeSshServer {
  port: number;
  /** Blob kunci publik host (format kawat SSH) dalam base64, seperti isi known_hosts. */
  hostKeyBase64: string;
  /** Berkas yang diunggah lewat SFTP (kunci = jalur SFTP, mis. `/temp/x.rsc`). */
  files: Map<string, Buffer>;
  /** Berkas lokal shell BusyBox hasil `scp` (kunci = jalur lokal). */
  localFiles: Map<string, Buffer>;
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

interface ExecContext {
  shell: FakeShell;
  localFiles: Map<string, Buffer>;
  scpSource: FakeSshServerOptions['scpSource'];
}

/** Eksekusi satu baris pada shell tiruan; mengembalikan keluaran (tanpa echo ketikan). */
async function execute(ctx: ExecContext, line: string): Promise<string> {
  // `sleep <ms>`: perintah lama yang menahan shell; tipikal `scp`/`fwupdate` pada perangkat nyata.
  const sleep = /^sleep (\d+)$/.exec(line);
  if (sleep) {
    await delay(Number(sleep[1]));
    return '';
  }
  // RouterOS: `:delay 2s` / `:delay 500ms` menahan skrip (sintaks perangkat nyata).
  const routerDelay = ctx.shell === 'routeros' ? /^:delay (\d+)(ms|s)?$/.exec(line) : null;
  if (routerDelay) {
    await delay(Number(routerDelay[1]) * (routerDelay[2] === 'ms' ? 1 : 1000));
    return '';
  }
  if (ctx.shell === 'busybox') {
    const echo = /^echo (.*)$/.exec(line);
    if (echo) return `${echo[1]}\r\n`;
    const scp = /^scp \S+@\S+:(\S+) (\S+)$/.exec(line);
    if (scp) {
      const data = ctx.scpSource?.(scp[1] as string);
      if (!data) return `scp: ${scp[1]}: No such file or directory\r\n`;
      ctx.localFiles.set(scp[2] as string, data);
      return '';
    }
    const wc = /^wc -c < (\S+)$/.exec(line);
    if (wc) {
      const data = ctx.localFiles.get(wc[1] as string);
      return data ? `${data.length}\r\n` : `sh: can't open '${wc[1]}'\r\n`;
    }
    const rm = /^rm -f (\S+)$/.exec(line);
    if (rm) ctx.localFiles.delete(rm[1] as string);
    return '';
  }
  const put = /^:put (.*)$/.exec(line);
  if (put) return `${put[1]}\r\n`;
  if (line.startsWith(':') || line.startsWith('/')) return '';
  const word = line.split(/\s+/)[0] ?? '';
  return `bad command name ${word} (line 1 column 1)\r\n`;
}

/** Perintah satu-kali (exec-channel) RouterOS yang dipakai harness spike. */
function execRouterOs(
  opts: FakeSshServerOptions,
  files: Map<string, Buffer>,
  command: string,
): string {
  if (command === '/system device-mode print') {
    return opts.deviceMode
      ? `  mode: ${opts.deviceMode.mode}\r\n`
      : 'bad command name device-mode (line 1 column 9)\r\n';
  }
  const imported = /^\/import file-name=(\S+)$/.exec(command);
  if (imported) {
    if (opts.deviceMode?.importBlocked) {
      return 'failure: import is not allowed by device-mode\r\n';
    }
    return files.has(`/${imported[1]}`)
      ? 'Script file loaded and executed successfully\r\n'
      : 'failure: no such file\r\n';
  }
  return `bad command name ${command.split(/\s+/)[0] ?? ''} (line 1 column 1)\r\n`;
}

/** SFTP dalam memori: cukup untuk put (open/write/close), rename, stat, dan hapus. */
function serveSftp(sftp: SFTPWrapper, files: Map<string, Buffer>): void {
  const { OPEN_MODE, STATUS_CODE } = utils.sftp;
  const handles = new Map<string, string>();
  let counter = 0;
  const attrsOf = (data: Buffer) => ({
    mode: 0o100644,
    uid: 0,
    gid: 0,
    size: data.length,
    atime: 0,
    mtime: 0,
  });

  sftp.on('OPEN', (reqid, filename, flags) => {
    if ((flags & OPEN_MODE.WRITE) !== 0) {
      if ((flags & OPEN_MODE.TRUNC) !== 0 || !files.has(filename)) {
        files.set(filename, Buffer.alloc(0));
      }
    } else if (!files.has(filename)) {
      sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      return;
    }
    counter += 1;
    handles.set(String(counter), filename);
    sftp.handle(reqid, Buffer.from(String(counter)));
  });
  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const path = handles.get(handle.toString());
    if (path === undefined) {
      sftp.status(reqid, STATUS_CODE.FAILURE);
      return;
    }
    const current = files.get(path) ?? Buffer.alloc(0);
    const next = Buffer.alloc(Math.max(current.length, offset + data.length));
    current.copy(next);
    data.copy(next, offset);
    files.set(path, next);
    sftp.status(reqid, STATUS_CODE.OK);
  });
  sftp.on('READ', (reqid, handle, offset, length) => {
    const path = handles.get(handle.toString());
    const data = path === undefined ? undefined : files.get(path);
    if (!data || offset >= data.length) {
      sftp.status(reqid, STATUS_CODE.EOF);
      return;
    }
    sftp.data(reqid, data.subarray(offset, offset + length));
  });
  sftp.on('CLOSE', (reqid, handle) => {
    handles.delete(handle.toString());
    sftp.status(reqid, STATUS_CODE.OK);
  });
  const stat = (reqid: number, path: string) => {
    const data = files.get(path);
    if (data) sftp.attrs(reqid, attrsOf(data));
    else sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
  };
  sftp.on('STAT', stat);
  sftp.on('LSTAT', stat);
  sftp.on('FSTAT', (reqid, handle) => stat(reqid, handles.get(handle.toString()) ?? ''));
  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    const data = files.get(oldPath);
    if (!data) {
      sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      return;
    }
    // SFTP v3 baku: rename ke nama yang sudah ada gagal (bukan menimpa).
    if (files.has(newPath)) {
      sftp.status(reqid, STATUS_CODE.FAILURE);
      return;
    }
    files.delete(oldPath);
    files.set(newPath, data);
    sftp.status(reqid, STATUS_CODE.OK);
  });
  sftp.on('REMOVE', (reqid, path) => {
    sftp.status(reqid, files.delete(path) ? STATUS_CODE.OK : STATUS_CODE.NO_SUCH_FILE);
  });
  sftp.on('REALPATH', (reqid, path) => {
    sftp.name(reqid, [{ filename: path, longname: path, attrs: attrsOf(Buffer.alloc(0)) }]);
  });
}

export function startFakeSshServer(opts: FakeSshServerOptions): Promise<FakeSshServer> {
  const hostKey = hostKeyFor(opts.hostKeyType ?? 'rsa');
  const files = new Map<string, Buffer>();
  const localFiles = new Map<string, Buffer>();
  const execContext: ExecContext = { shell: opts.shell, localFiles, scpSource: opts.scpSource };
  const connections = new Set<{ end(): void }>();

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
          const open = () => runShell(accept(), () => conn.end());
          if (opts.shellOpenDelayMs) setTimeout(open, opts.shellOpenDelayMs);
          else open();
        });
        session.on('exec', (accept, _reject, info) => {
          const stream = accept();
          stream.write(execRouterOs(opts, files, info.command));
          stream.exit(0);
          stream.end();
        });
        session.on('sftp', (accept) => serveSftp(accept(), files));
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
    if (opts.banner) send(opts.banner);
    if (opts.dropAfterLine === 0) {
      dropNow();
      return;
    }
    const echoOf = (line: string): string => {
      const width = opts.wrapEchoAt;
      if (!width || SENTINEL_LINE.test(line)) return `${line}\r\n`;
      const chunks: string[] = [];
      for (let at = 0; at < line.length; at += width) chunks.push(line.slice(at, at + width));
      return `${chunks.join('\r\n')}\r\n`;
    };

    let inbuf = '';
    let scriptLines = 0;
    const queue: string[] = [];
    let draining = false;

    const drain = async () => {
      if (draining) return;
      draining = true;
      while (!dead && queue.length > 0) {
        const line = queue.shift() as string;
        send(await execute(execContext, line));
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
        send(echoOf(line));
        if (opts.echoTwice) send(echoOf(line));
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
        files,
        localFiles,
        close: () =>
          new Promise<void>((done) => {
            for (const conn of connections) conn.end();
            server.close(() => done());
          }),
      });
    });
  });
}
