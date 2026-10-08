import { requireConfig_ } from '@gas/core/config';
import { normalizeEmail_ } from '@gas/core/email';
import { platform_ } from '@gas/core/platform';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** 6 jam (maksimum CacheService) agar link login di halaman yang lama terbuka tetap berlaku. */
export const LOGIN_STATE_TTL_SECONDS = 21600;

export type ExchangeResult = { ok: true; email: string } | { ok: false; reason: string };

function toQueryString_(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function createLoginUrl_(): string {
  const platform = platform_();
  const state = platform.uuid();
  platform.cachePut(`oauth:state:${state}`, '1', LOGIN_STATE_TTL_SECONDS);
  return `${GOOGLE_AUTH_URL}?${toQueryString_({
    client_id: requireConfig_('OAUTH_CLIENT_ID'),
    redirect_uri: requireConfig_('OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  })}`;
}

export function consumeLoginState_(state: unknown): boolean {
  if (typeof state !== 'string' || state === '') return false;
  const platform = platform_();
  const key = `oauth:state:${state}`;
  if (platform.cacheGet(key) === null) return false;
  platform.cacheRemove(key);
  return true;
}

export function readIdTokenEmail_(
  idToken: string,
  clientId: string,
  nowMs: number,
): ExchangeResult {
  const payloadPart = idToken.split('.')[1];
  if (!payloadPart) return { ok: false, reason: 'id_token tidak berformat JWT' };
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(platform_().base64UrlDecode(payloadPart)) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'payload id_token tidak bisa dibaca' };
  }
  if (!GOOGLE_ISSUERS.includes(String(claims.iss))) return { ok: false, reason: 'iss tidak valid' };
  if (claims.aud !== clientId) return { ok: false, reason: 'aud tidak cocok' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) {
    return { ok: false, reason: 'id_token kedaluwarsa' };
  }
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    return { ok: false, reason: 'email belum terverifikasi' };
  }
  if (typeof claims.email !== 'string' || claims.email.trim() === '') {
    return { ok: false, reason: 'email kosong' };
  }
  return { ok: true, email: normalizeEmail_(claims.email) };
}

/** id_token diterima langsung dari endpoint token Google lewat TLS, sehingga tanda tangannya tidak perlu diverifikasi ulang. */
export function exchangeCodeForEmail_(code: string): ExchangeResult {
  const platform = platform_();
  const clientId = requireConfig_('OAUTH_CLIENT_ID');
  const response = platform.httpPostForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: requireConfig_('OAUTH_CLIENT_SECRET'),
    redirect_uri: requireConfig_('OAUTH_REDIRECT_URI'),
    grant_type: 'authorization_code',
  });
  if (response.status !== 200) {
    return { ok: false, reason: `endpoint token menjawab ${response.status}` };
  }
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    return { ok: false, reason: 'respons token bukan JSON' };
  }
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== 'string') return { ok: false, reason: 'id_token tidak ada' };
  return readIdTokenEmail_(idToken, clientId, platform.now());
}
