import { requireConfig_ } from './config';
import { platform_ } from './platform';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  email: string;
  iat: number;
  exp: number;
}

export function signSessionToken_(email: string): string {
  const platform = platform_();
  const now = platform.now();
  const payload: SessionPayload = { email, iat: now, exp: now + SESSION_TTL_MS };
  const body = platform.base64UrlEncode(JSON.stringify(payload));
  return `${body}.${platform.hmacSha256Base64Url(body, requireConfig_('SESSION_SECRET'))}`;
}

export function verifySessionToken_(token: unknown): SessionPayload | null {
  if (typeof token !== 'string') return null;
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;
  const platform = platform_();
  const expected = platform.hmacSha256Base64Url(body, requireConfig_('SESSION_SECRET'));
  if (!safeEqual_(signature, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(platform.base64UrlDecode(body));
  } catch {
    return null;
  }
  if (!isSessionPayload_(payload) || payload.exp <= platform.now()) return null;
  return payload;
}

function isSessionPayload_(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.email === 'string' &&
    record.email !== '' &&
    typeof record.iat === 'number' &&
    typeof record.exp === 'number'
  );
}

/** Perbandingan waktu-konstan agar tanda tangan tidak bisa ditebak lewat timing. */
function safeEqual_(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
