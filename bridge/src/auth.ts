import { bridgePlatform_ } from './platform';

/** Batas badan permintaan (karakter), keputusan spike Task 0.2 (Ruling). */
export const BRIDGE_MAX_BODY_CHARS = 1048576;
/** Jendela `ts` (milidetik) di kedua arah. */
export const BRIDGE_TS_WINDOW_MS = 120000;
/** Kegagalan autentikasi dalam satu jendela sebelum jembatan memblokir semua permintaan. */
export const BRIDGE_FAIL_LIMIT = 10;
export const BRIDGE_BLOCK_SECONDS = 600;
export const BRIDGE_SECRET_MIN_LENGTH = 32;

const BRIDGE_BLOCK_KEY = 'bridge:blocked';
const BRIDGE_FAIL_KEY = 'bridge:fails';
const BRIDGE_REPLAY_PREFIX = 'bridge:sig:';

export interface BridgeEnvelope {
  action: string;
  ts: number;
  sig: string;
  payload: unknown;
}

export type BridgeVerifyResult = { ok: true; envelope: BridgeEnvelope } | { ok: false };

/** String yang ditandatangani: `action.ts.payloadJson` (payloadJson = JSON.stringify(payload) tanpa spasi). */
export function bridgeSigningString_(action: string, ts: number, payloadJson: string): string {
  return `${action}.${ts}.${payloadJson}`;
}

/** Perbandingan waktu-konstan (seluruh panjang terlama selalu ditelusuri). */
export function bridgeConstantTimeEqual_(a: string, b: string): boolean {
  let diff = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function parseEnvelope_(rawBody: unknown): BridgeEnvelope | null {
  if (typeof rawBody !== 'string' || rawBody === '' || rawBody.length > BRIDGE_MAX_BODY_CHARS) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.action !== 'string' ||
    typeof record.ts !== 'number' ||
    !Number.isFinite(record.ts) ||
    typeof record.sig !== 'string'
  ) {
    return null;
  }
  return { action: record.action, ts: record.ts, sig: record.sig, payload: record.payload };
}

/**
 * Memverifikasi tanda tangan dan jendela waktu. Tidak menyentuh cache (pembatas/replay diurus pemanggil).
 * Semua kegagalan menghasilkan `{ ok: false }` tanpa sebab.
 */
export function verifyBridgeRequest_(
  rawBody: unknown,
  secret: string,
  nowMs: number,
): BridgeVerifyResult {
  const envelope = parseEnvelope_(rawBody);
  if (envelope === null || secret.length < BRIDGE_SECRET_MIN_LENGTH) return { ok: false };
  if (Math.abs(nowMs - envelope.ts) > BRIDGE_TS_WINDOW_MS) return { ok: false };
  const payloadJson = JSON.stringify(envelope.payload === undefined ? {} : envelope.payload);
  const expected = bridgePlatform_().hmacSha256Hex(
    bridgeSigningString_(envelope.action, envelope.ts, payloadJson),
    secret,
  );
  if (!bridgeConstantTimeEqual_(envelope.sig.toLowerCase(), expected)) return { ok: false };
  return { ok: true, envelope };
}

export function isBridgeBlocked_(): boolean {
  return bridgePlatform_().cacheGet(BRIDGE_BLOCK_KEY) !== null;
}

/** Mencatat satu kegagalan autentikasi (best-effort; kegagalan mencatat tidak mengubah balasan). */
export function recordBridgeFailure_(): void {
  const platform = bridgePlatform_();
  try {
    const now = platform.now();
    const windowMs = BRIDGE_BLOCK_SECONDS * 1000;
    const [startText, countText] = (platform.cacheGet(BRIDGE_FAIL_KEY) ?? '').split(':');
    const start = Number(startText);
    const inWindow =
      startText !== undefined &&
      startText !== '' &&
      Number.isFinite(start) &&
      now - start < windowMs;
    const windowStart = inWindow ? start : now;
    const count = (inWindow ? Number(countText) || 0 : 0) + 1;
    if (count >= BRIDGE_FAIL_LIMIT) {
      platform.cachePut(BRIDGE_BLOCK_KEY, '1', BRIDGE_BLOCK_SECONDS);
      platform.cachePut(BRIDGE_FAIL_KEY, `${windowStart}:0`, 1);
    } else {
      const remaining = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
      platform.cachePut(BRIDGE_FAIL_KEY, `${windowStart}:${count}`, remaining);
    }
  } catch {
    // diabaikan: lihat komentar fungsi
  }
}

/**
 * Menolak permintaan bertanda tangan sah yang diulang. Mengembalikan false bila tanda tangan sudah
 * pernah dipakai dalam jendela waktu (kedua arah) + cadangan.
 */
export function claimBridgeSignature_(sig: string): boolean {
  const platform = bridgePlatform_();
  const key = `${BRIDGE_REPLAY_PREFIX}${sig.toLowerCase()}`;
  if (platform.cacheGet(key) !== null) return false;
  platform.cachePut(key, '1', Math.ceil((BRIDGE_TS_WINDOW_MS * 2) / 1000) + 60);
  return true;
}
