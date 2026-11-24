import { decodeText, encodeBytes } from '@server/core/base64url';
import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { signValue, verifyValue } from '@server/core/session';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Cookie state OAuth berlaku 10 menit. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type ExchangeResult = { ok: true; email: string } | { ok: false; reason: string };

interface StatePayload {
  state: string;
  exp: number;
}

/**
 * Origin aplikasi untuk redirect URI: HANYA dari `APP_ORIGIN` (konfigurasi). Origin permintaan tidak dipakai: di
 * belakang reverse proxy header Host/skema tidak dapat dipercaya.
 */
export function appOrigin(env: Env, _request?: Request): string {
  const configured = env.APP_ORIGIN?.trim().replace(/\/+$/, '');
  if (!configured) throw appError('UNAVAILABLE', 'APP_ORIGIN belum dikonfigurasi di server');
  return configured;
}

export function redirectUri(env: Env, request: Request): string {
  return `${appOrigin(env, request)}/auth/callback`;
}

function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function randomState(): string {
  return encodeBytes(crypto.getRandomValues(new Uint8Array(24)));
}

/** URL login Google beserta nilai cookie bertanda tangan yang mengikat `state` ke peramban ini. */
export async function createLogin(
  env: Env,
  request: Request,
): Promise<{ url: string; stateCookie: string }> {
  const state = randomState();
  const payload: StatePayload = { state, exp: nowOf(env) + OAUTH_STATE_TTL_MS };
  const url = `${GOOGLE_AUTH_URL}?${toQueryString({
    client_id: env.OAUTH_CLIENT_ID,
    redirect_uri: redirectUri(env, request),
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  })}`;
  return { url, stateCookie: await signValue(env, payload) };
}

/** Perbandingan waktu-konstan untuk string pendek. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `state` pada callback harus sama dengan yang ada di cookie bertanda tangan dan belum kedaluwarsa. */
export async function verifyLoginState(
  env: Env,
  cookieValue: string | undefined,
  state: string | undefined,
): Promise<boolean> {
  if (!cookieValue || !state) return false;
  const payload = (await verifyValue(env, cookieValue)) as Partial<StatePayload> | null;
  if (!payload || typeof payload.state !== 'string' || typeof payload.exp !== 'number') {
    return false;
  }
  if (payload.exp <= nowOf(env)) return false;
  return safeEqual(payload.state, state);
}

export function readIdTokenEmail(idToken: string, clientId: string, nowMs: number): ExchangeResult {
  const payloadPart = idToken.split('.')[1];
  if (!payloadPart) return { ok: false, reason: 'id_token tidak berformat JWT' };
  const text = decodeText(payloadPart);
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(text ?? '') as Record<string, unknown>;
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
  return { ok: true, email: normalizeEmail(claims.email) };
}

/** Batas waktu penukaran kode ke endpoint token Google (termasuk badan respons). */
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

/** id_token diterima langsung dari endpoint token Google lewat TLS, jadi tanda tangannya tidak diverifikasi ulang. */
export async function exchangeCodeForEmail(
  env: Env,
  request: Request,
  code: string,
): Promise<ExchangeResult> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: toQueryString({
        code,
        client_id: env.OAUTH_CLIENT_ID,
        client_secret: env.OAUTH_CLIENT_SECRET,
        redirect_uri: redirectUri(env, request),
        grant_type: 'authorization_code',
      }),
      // Endpoint token yang menggantung tak boleh menahan permintaan login selamanya (mencakup pembacaan badan).
      signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'endpoint token tidak terjangkau' };
  }
  if (response.status !== 200) {
    return { ok: false, reason: `endpoint token menjawab ${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'respons token bukan JSON' };
  }
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== 'string') return { ok: false, reason: 'id_token tidak ada' };
  return readIdTokenEmail(idToken, env.OAUTH_CLIENT_ID, nowOf(env));
}
