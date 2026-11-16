// Penerima callback login desktop di loopback (RFC 8252 §7.3): sebelum membuka peramban, aplikasi membuka port
// acak di 127.0.0.1; setelah login Google server mengarahkan peramban ke
// `http://127.0.0.1:<port>/callback?code&state`. Tidak butuh pendaftaran skema `qc://` di OS dan tidak memunculkan
// dialog "Buka aplikasi ini?". Hanya menerima SATU bentuk permintaan (GET /callback dengan tepat `code` dan
// `state` berformat sah, Host tepat 127.0.0.1:<port>); semuanya 404. URL membawa kode login, jadi tak pernah
// dicatat dan responsnya `no-store`/`no-referrer` dengan CSP ketat. Kode itu sendiri tak berguna tanpa `verifier`
// PKCE yang hanya ada di memori aplikasi.

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseAuthParams } from '../qc-url';

export interface Loopback {
  port: number;
  close(): void;
}

export interface LoopbackOptions {
  /** Menangani callback sah; `true` bila login berhasil (menentukan halaman yang ditampilkan). */
  onCallback(code: string, state: string): Promise<boolean>;
  /** Server menutup diri setelah ini bila belum ditutup (selaras dengan masa login). */
  timeoutMs: number;
}

const HOST = '127.0.0.1';
const PATH = '/callback';

function page(title: string, message: string, nonce: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:16px system-ui,sans-serif;background:#161616;color:#eee;display:grid;place-items:center;height:100vh;margin:0}main{max-width:26rem;padding:1.5rem;text-align:center}h1{font-size:1.15rem}p{color:#aaa}</style></head>
<body><main><h1>${title}</h1><p>${message}</p></main>
<script nonce="${nonce}">setTimeout(function(){window.close()},400)</script></body></html>`;
}

function send(response: ServerResponse, status: number, body: string, nonce?: string): void {
  response.writeHead(status, {
    'Content-Type': nonce ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': nonce
      ? `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`
      : "default-src 'none'",
    Connection: 'close',
  });
  response.end(body);
}

export async function startLoopback(options: LoopbackOptions): Promise<Loopback> {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const address = server.address() as AddressInfo | null;
    // Host harus tepat 127.0.0.1:<port>: menolak permintaan lewat nama lain (DNS rebinding).
    const hostOk = address !== null && request.headers.host === `${HOST}:${address.port}`;
    let auth: { code: string; state: string } | null = null;
    if (hostOk && address !== null && request.method === 'GET') {
      try {
        const url = new URL(request.url ?? '', `http://${HOST}:${address.port}`);
        if (url.pathname === PATH && url.hash === '') auth = parseAuthParams(url.searchParams);
      } catch {
        auth = null;
      }
    }
    if (!auth) {
      send(response, 404, 'Not Found');
      return;
    }
    const nonce = randomBytes(16).toString('base64');
    options
      .onCallback(auth.code, auth.state)
      .then((ok) => {
        const title = ok ? 'Login berhasil' : 'Login gagal';
        const message = ok
          ? 'Anda bisa menutup jendela ini dan kembali ke QC App.'
          : 'Tutup jendela ini lalu coba masuk lagi dari QC App.';
        send(response, 200, page(title, message, nonce), nonce);
      })
      .catch(() => send(response, 500, 'Terjadi kesalahan'));
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    server.close();
    // Beri waktu respons yang sedang berjalan selesai, lalu putuskan sisa koneksi.
    setTimeout(() => server.closeAllConnections(), 1_000).unref();
  };

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve());
  });
  timer = setTimeout(close, options.timeoutMs);
  timer.unref();
  const { port } = server.address() as AddressInfo;
  return { port, close };
}
