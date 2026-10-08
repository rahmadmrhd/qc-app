const NONCE_STORAGE_KEY = 'qc.login-nonce';

export function newLoginNonce(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function writeLoginNonce(nonce: string): void {
  try {
    localStorage.setItem(NONCE_STORAGE_KEY, nonce);
  } catch {
    // Storage diblokir — login tetap berjalan, tetapi tanpa pengikatan nonce sesi ditolak.
  }
}

export function readLoginNonce(): string | null {
  try {
    return localStorage.getItem(NONCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Menempelkan nonce browser ke parameter `state` agar callback hanya sah di browser yang memulai login. */
export function withNonce(loginUrl: string, nonce: string): string {
  const url = new URL(loginUrl);
  url.searchParams.set('state', `${url.searchParams.get('state') ?? ''}.${nonce}`);
  return url.toString();
}
