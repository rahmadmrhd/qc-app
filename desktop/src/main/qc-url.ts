// Tautan dalam aplikasi lewat protokol OS `qc://`. Hanya dua bentuk yang sah; apa pun selain itu
// ditolak agar tautan dari luar tak dapat mengarahkan ke rute lain atau menyuntikkan nilai:
//   qc://country-lock               -> { route: '/country-lock' }
//   qc://auth?code=<kode>&state=<s> -> { route: null, auth: { code, state } } (login desktop)

export interface QcUrl {
  route: string | null;
  auth?: { code: string; state: string };
}

/** Kode login = base64url(JSON) + "." + HMAC (server membatasi 1024 karakter). */
const AUTH_CODE = /^[A-Za-z0-9_.-]{1,1024}$/;
const AUTH_STATE = /^[A-Za-z0-9_-]{8,128}$/;

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
  const keys = [...parsed.searchParams.keys()];
  if (keys.length !== 2 || !keys.includes('code') || !keys.includes('state')) return null;
  const code = parsed.searchParams.getAll('code');
  const state = parsed.searchParams.getAll('state');
  if (code.length !== 1 || state.length !== 1) return null;
  const [c] = code;
  const [s] = state;
  if (c === undefined || s === undefined) return null;
  if (!AUTH_CODE.test(c) || !AUTH_STATE.test(s)) return null;
  return { route: null, auth: { code: c, state: s } };
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
