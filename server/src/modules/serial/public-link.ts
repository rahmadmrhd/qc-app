/**
 * Tautan bertanda tangan ke halaman publik laporan rusak (rancangan 2026-11-14 §4.8). Token tanpa keadaan di basis data:
 * `v1.<caseId>.<expSeconds>.<base64url(sig)>`, `sig = HMAC-SHA256(derivedKey, "v1.<caseId>.<expSeconds>")` dan
 * `derivedKey = HMAC-SHA256(secret, "qc:serial-report-link:v1")`. Kunci turunan sengaja terpisah dari kunci sesi agar
 * token tidak dapat dipakai (atau dipalsukan) sebagai sesi. Semua kegagalan verifikasi menghasilkan `null` tanpa
 * membedakan sebab.
 */
const KEY_LABEL = 'qc:serial-report-link:v1';
const VERSION = 'v1';
const TOKEN_MAX_LENGTH = 300;
const CASE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const EXP_PATTERN = /^\d{1,12}$/;
const SIG_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const padded = text.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(
  raw: ArrayBuffer | Uint8Array,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function derivedKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const base = await hmacKey(encoder.encode(secret), 'sign');
  const derived = await crypto.subtle.sign('HMAC', base, encoder.encode(KEY_LABEL));
  return hmacKey(derived, usage);
}

/** Membuat token untuk laporan `caseId` yang berlaku sampai `expiresAtMs` (dibulatkan ke detik penuh ke atas). */
export async function signReportToken(
  secret: string,
  caseId: string,
  expiresAtMs: number,
): Promise<string> {
  const expSeconds = Math.ceil(expiresAtMs / 1000);
  const payload = `${VERSION}.${caseId}.${expSeconds}`;
  const key = await derivedKey(secret, 'sign');
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `${payload}.${toBase64Url(sig)}`;
}

/** `{ caseId }` bila token sah dan belum kedaluwarsa pada `nowMs`; selain itu `null`. */
export async function verifyReportToken(
  secret: string,
  token: string,
  nowMs: number,
): Promise<{ caseId: string } | null> {
  if (secret === '' || token.length > TOKEN_MAX_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, caseId, exp, sig] = parts as [string, string, string, string];
  if (version !== VERSION) return null;
  if (!CASE_ID_PATTERN.test(caseId) || !EXP_PATTERN.test(exp) || !SIG_PATTERN.test(sig)) {
    return null;
  }
  const sigBytes = fromBase64Url(sig);
  if (!sigBytes) return null;
  const key = await derivedKey(secret, 'verify');
  // `crypto.subtle.verify` membandingkan tanda tangan dalam waktu tetap.
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    encoder.encode(`${version}.${caseId}.${exp}`),
  );
  if (!valid) return null;
  // Batas inklusif: tepat pada detik kedaluwarsa masih berlaku, 1 ms sesudahnya sudah tidak.
  if (nowMs > Number(exp) * 1000) return null;
  return { caseId };
}
