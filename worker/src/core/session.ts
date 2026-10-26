import { decodeBytes, decodeText, encodeBytes, encodeText } from './base64url';
import type { Env } from './env';

export const SESSION_COOKIE = 'qc_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  email: string;
  iat: number;
  exp: number;
}

/**
 * Kunci HMAC diimpor sekali per rahasia dan kegunaan dalam isolate (`importKey` tiap permintaan memakan CPU
 * yang tidak perlu); `CryptoKey` tidak terikat permintaan. Dibatasi agar rahasia lama (rotasi, tes) tidak menumpuk.
 */
const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(env: Env, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const id = `${usage}:${env.SESSION_SECRET}`;
  const known = hmacKeys.get(id);
  if (known) return known;
  if (hmacKeys.size >= 8) hmacKeys.clear();
  const imported = crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
  hmacKeys.set(id, imported);
  imported.catch(() => hmacKeys.delete(id));
  return imported;
}

/** `base64url(JSON).base64url(HMAC-SHA256)`; dipakai token sesi dan cookie state OAuth. */
export async function signValue(env: Env, value: unknown): Promise<string> {
  const body = encodeText(JSON.stringify(value));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env, 'sign'),
    new TextEncoder().encode(body),
  );
  return `${body}.${encodeBytes(new Uint8Array(signature))}`;
}

/** Verifikasi tanda tangan (waktu-konstan lewat `crypto.subtle.verify`); `null` bila tidak sah. */
export async function verifyValue(env: Env, token: unknown): Promise<unknown | null> {
  if (typeof token !== 'string') return null;
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;
  const signatureBytes = decodeBytes(signature);
  if (!signatureBytes) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(env, 'verify'),
    signatureBytes,
    new TextEncoder().encode(body),
  );
  if (!valid) return null;
  const text = decodeText(body);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function signSessionToken(env: Env, email: string, now: number): Promise<string> {
  const payload: SessionPayload = { email, iat: now, exp: now + SESSION_TTL_MS };
  return signValue(env, payload);
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.email === 'string' &&
    record.email !== '' &&
    typeof record.iat === 'number' &&
    typeof record.exp === 'number'
  );
}

export async function verifySessionToken(
  env: Env,
  token: unknown,
  now: number,
): Promise<SessionPayload | null> {
  const payload = await verifyValue(env, token);
  if (!isSessionPayload(payload) || payload.exp <= now) return null;
  return payload;
}
