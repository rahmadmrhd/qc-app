// Tautan dalam aplikasi lewat protokol OS `qc://`. Hanya dua bentuk yang sah; apa pun selain itu
// ditolak agar tautan dari luar tak dapat mengarahkan ke rute lain atau menyuntikkan nilai:
//   qc://country-lock               -> { route: '/country-lock' }
//   qc://auth?code=<kode>&state=<s> -> { route: null, auth: { code, state } } (login desktop, cadangan;
//   sejak 2026-11-16 jalur utamanya callback loopback `auth/loopback.ts`)

export interface QcUrl {
  route: string | null;
  auth?: { code: string; state: string };
}

/** Kode login = base64url(JSON) + "." + HMAC (server membatasi 1024 karakter). */
const AUTH_CODE = /^[A-Za-z0-9_.-]{1,1024}$/;
const AUTH_STATE = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * `code` dan `state` dari query login: tepat dua kunci (`code`, `state`), masing-masing satu nilai berformat sah.
 * Dipakai bersama oleh `qc://auth` dan callback loopback `http://127.0.0.1:<port>/callback`.
 */
export function parseAuthParams(params: URLSearchParams): { code: string; state: string } | null {
  const keys = [...params.keys()];
  if (keys.length !== 2 || !keys.includes('code') || !keys.includes('state')) return null;
  const code = params.getAll('code');
  const state = params.getAll('state');
  if (code.length !== 1 || state.length !== 1) return null;
  const [c] = code;
  const [s] = state;
  if (c === undefined || s === undefined) return null;
  if (!AUTH_CODE.test(c) || !AUTH_STATE.test(s)) return null;
  return { code: c, state: s };
}

function parseAuth(parsed: URL): QcUrl | null {
  if (parsed.pathname !== '' && parsed.pathname !== '/') return null;
  if (
    parsed.hash !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== ''
  ) {
    return null;
  }
  const auth = parseAuthParams(parsed.searchParams);
  return auth ? { route: null, auth } : null;
}

export function parseQcUrl(url: string): QcUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'qc:') return null;
  if (parsed.hostname === 'auth') return parseAuth(parsed);
  if (parsed.hostname !== 'country-lock') return null;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return null;
  if (parsed.search !== '' || parsed.hash !== '') return null;
  if (parsed.username !== '' || parsed.password !== '' || parsed.port !== '') return null;
  return { route: '/country-lock' };
}
