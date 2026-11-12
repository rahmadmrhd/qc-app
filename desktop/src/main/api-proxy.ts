// Proxy `app://qc/api/*` dan `app://qc/auth/*` ke server QC (dijalankan proses utama). Renderer
// memanggil origin lokalnya sendiri (same-origin, tanpa CORS, CSP `connect-src 'self'` cukup);
// token Bearer ditambahkan DI SINI dan tak pernah dilihat renderer. Hanya jalur di `PROXY_ALLOW`
// yang diteruskan; header sensitif dari renderer dibuang, `Set-Cookie` server tidak diteruskan.

import type { TokenStore } from './auth/token-store';
import type { Settings } from './settings';

export const PROXY_ALLOW: readonly RegExp[] = [/^\/api\/v1\//, /^\/api\/ping$/, /^\/auth\/logout$/];

/** Permintaan ke awalan ini ditangani proxy (diizinkan atau ditolak 403), bukan penyaji berkas. */
export function isProxyRoute(pathname: string): boolean {
  return /^\/(api|auth)(\/|$)/.test(pathname);
}

/** Header permintaan yang boleh diteruskan; selebihnya (Cookie, Authorization, Host, ...) dibuang. */
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'if-match',
  'if-none-match',
  'range',
  'x-requested-with',
];

/** Header respons yang tak boleh diteruskan: kuki dan yang berkaitan dengan pengodean badan. */
const DROP_RESPONSE_HEADERS = [
  'set-cookie',
  'set-cookie2',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
];

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiProxyDeps {
  settings: () => Settings;
  tokens: TokenStore;
  /** `net.fetch` Electron di aplikasi; `fetch` global di tes. */
  fetchImpl?: typeof fetch;
  /** Dipanggil saat sesi berakhir (401 dari server atau keluar). */
  onUnauthenticated(): void;
}

function problem(status: number, code: string, title: string, detail: string): Response {
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title,
      status,
      detail,
      code,
      requestId: 'desktop-proxy',
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/problem+json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

const forbidden = (detail: string): Response => problem(403, 'FORBIDDEN', 'Akses ditolak', detail);

/** Jalur aman: bukan `..`/`.`/segmen kosong (`//`), tanpa `\`, NUL, atau karakter kontrol, juga setelah didekode. */
function isCleanPath(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  for (const candidate of [pathname, decoded]) {
    if (candidate.includes('\\') || candidate.includes('//')) return false;
    for (let i = 0; i < candidate.length; i += 1) {
      const code = candidate.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) return false;
    }
    const segments = candidate.split('/').slice(1);
    // Segmen terakhir boleh kosong (garis miring penutup); selebihnya tidak.
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i] ?? '';
      if (segment === '..' || segment === '.') return false;
      if (segment === '' && i < segments.length - 1) return false;
    }
  }
  return true;
}

export function createApiProxy(deps: ApiProxyDeps): (request: Request) => Promise<Response> {
  const doFetch = deps.fetchImpl ?? fetch;

  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return forbidden('Alamat tidak sah');
    }
    if (url.protocol !== 'app:' || url.hostname !== 'qc') return forbidden('Asal tidak sah');

    const method = request.method.toUpperCase();
    if (!METHODS.has(method)) {
      return problem(405, 'VALIDATION', 'Metode tidak diizinkan', 'Metode tidak didukung');
    }
    if (!isCleanPath(url.pathname) || !PROXY_ALLOW.some((rule) => rule.test(url.pathname))) {
      return forbidden('Jalur tidak diizinkan');
    }

    // Keluar: hapus token lokal tanpa menghubungi server (token desktop tak punya sisi server).
    if (url.pathname === '/auth/logout') {
      deps.tokens.clear();
      deps.onUnauthenticated();
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const target = `${deps.settings().serverUrl}${url.pathname}${url.search}`;
    const headers = new Headers();
    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const stored = deps.tokens.get();
    if (stored) headers.set('Authorization', `Bearer ${stored.token}`);

    const hasBody = method !== 'GET' && method !== 'HEAD' && request.body !== null;
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      redirect: 'manual',
      signal: request.signal,
    };
    if (hasBody) {
      init.body = request.body;
      init.duplex = 'half';
    }

    let upstream: Response;
    try {
      upstream = await doFetch(target, init);
    } catch {
      // Server mati/tak terjangkau (atau dibatalkan): bukan crash; pesan tanpa alamat/token.
      return problem(
        503,
        'UNAVAILABLE',
        'Layanan tidak tersedia',
        'Server QC tidak dapat dihubungi',
      );
    }

    if (upstream.status === 401 && stored) {
      deps.tokens.clear();
      deps.onUnauthenticated();
    }

    const responseHeaders = new Headers(upstream.headers);
    for (const name of DROP_RESPONSE_HEADERS) responseHeaders.delete(name);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  };
}
