// Protokol `app://qc/...`: menyajikan UI web dari folder lokal (baseline terkemas atau
// `server/dist` saat pengembangan). Tanpa Electron di sini agar dapat diuji di Node: hanya
// pemetaan jalur (anti path traversal), CSP, dan penangan `Request -> Response`.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'qc';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Susun CSP; `scriptHashes` = hash sha256 skrip inline resmi (mis. skrip tema di index.html). */
export function buildAppCsp(scriptHashes: readonly string[] = []): string {
  const scriptSrc = ["'self'", ...scriptHashes.map((h) => `'sha256-${h}'`)].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Gaya inline dipakai React/Tailwind (atribut style); skrip inline tetap dilarang.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** CSP dasar tanpa skrip inline apa pun (tanpa `unsafe-eval`, tanpa `unsafe-inline` pada skrip). */
export const APP_CSP = buildAppCsp();

/** Hash sha256 (base64) tiap `<script>` inline tanpa `src` pada HTML. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1] ?? '';
    if (body.trim() === '') continue;
    hashes.push(createHash('sha256').update(body, 'utf8').digest('base64'));
  }
  return hashes;
}

/** Hanya `app://qc/...` yang boleh menjadi tujuan navigasi jendela. */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_SCHEME}:` && parsed.hostname === APP_HOST;
  } catch {
    return false;
  }
}

/**
 * Memetakan `app://qc/<jalur>` ke berkas di bawah `root`. Jalur di luar `root`, host/skema lain,
 * dan jalur yang mencurigakan (`..`, `\`, `:`, NUL) menghasilkan `null`. Rute tanpa ekstensi
 * (rute SPA) dipetakan ke `index.html`.
 */
export function resolveAppFile(root: string, requestUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\\') || pathname.includes('\0')) return null;

  const segments = pathname.split('/').filter((s) => s !== '');
  for (const segment of segments) {
    if (segment === '..' || segment === '.' || segment.includes(':')) return null;
  }

  const last = segments[segments.length - 1];
  const hasExtension = last !== undefined && extname(last) !== '';
  const rootAbs = resolve(root);
  const target = hasExtension ? resolve(rootAbs, ...segments) : resolve(rootAbs, 'index.html');

  const rel = relative(rootAbs, target);
  if (
    rel === '' ||
    rel.startsWith('..') ||
    rel.startsWith(sep) ||
    resolve(rootAbs, rel) !== target
  ) {
    return null;
  }
  return target;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function baseHeaders(contentType: string, csp: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

/** Penangan `protocol.handle('app', ...)`: jalur tak sah 403, berkas tak ada 404. */
export function createAppHandler(root: string): (request: Request) => Promise<Response> {
  return async (request) => {
    const file = resolveAppFile(root, request.url);
    if (file === null) {
      return new Response('Terlarang', {
        status: 403,
        headers: baseHeaders('text/plain', APP_CSP),
      });
    }
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      return new Response('Tidak ditemukan', {
        status: 404,
        headers: baseHeaders('text/plain', APP_CSP),
      });
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const csp = type.startsWith('text/html')
      ? buildAppCsp(inlineScriptHashes(data.toString('utf8')))
      : APP_CSP;
    return new Response(new Uint8Array(data), { status: 200, headers: baseHeaders(type, csp) });
  };
}
