// Manifest UI bertanda tangan (spek desktop §3.4): daftar berkas build web dengan hash, versi UI, dan versi jembatan
// minimum. Dipakai skrip build/tanda tangan (Bun) dan desktop (Node); hanya `node:crypto`, tanpa impor dari web.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

/**
 * Versi jembatan minimum yang dibutuhkan UI yang dibangun dari repo ini. Dinaikkan HANYA bila UI memakai fungsi
 * jembatan baru (`BRIDGE_VERSION` di `bridge-channels.ts`); aplikasi dengan jembatan lebih rendah tidak menerapkan bundel.
 */
export const UI_MIN_BRIDGE_VERSION = 2;

export interface UiManifestFile {
  /** Jalur relatif terhadap akar `server/dist`, pemisah `/`, tanpa awalan `/`. */
  path: string;
  /** SHA-256 isi berkas, heksadesimal huruf kecil (64 karakter). */
  sha256: string;
  size: number;
}

export interface UiManifest {
  /** SHA-256 gabungan jalur+hash semua berkas: berubah bila ada satu berkas berubah. */
  uiVersion: string;
  minBridge: number;
  /** Urut abjad menurut `path`. */
  files: UiManifestFile[];
  /** Epoch milidetik saat manifest dibuat. */
  createdAt: number;
}

/** Nama berkas keluaran di akar bundel; keduanya dikecualikan dari daftar `files`. */
export const UI_MANIFEST_FILE = 'ui-manifest.json';
export const UI_MANIFEST_SIGNATURE_FILE = 'ui-manifest.sig';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Garis miring terbalik, NUL, dan karakter kendali (U+0000..U+001F, U+007F) tak boleh ada di jalur. */
function hasForbiddenChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x5c || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Jalur berkas bundel yang aman: relatif, pemisah `/`, tanpa segmen kosong/`.`/`..`, tanpa `\`, NUL, atau karakter
 * kendali (mencegah keluar dari folder bundel saat berkas ditulis desktop).
 */
export function isSafeUiPath(path: unknown): path is string {
  if (typeof path !== 'string' || path === '' || path.length > 512) return false;
  if (path.startsWith('/') || hasForbiddenChar(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Mengurai dan memvalidasi isi manifest (JSON). `null` bila bukan JSON, bentuknya salah, `path` tak aman atau ganda,
 * hash/ukuran tidak sah, atau daftar tidak urut abjad.
 */
export function parseUiManifest(json: string): UiManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { uiVersion, minBridge, files, createdAt } = record;
  if (typeof uiVersion !== 'string' || !SHA256_PATTERN.test(uiVersion)) return null;
  if (typeof minBridge !== 'number' || !Number.isInteger(minBridge) || minBridge < 1) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  if (!Array.isArray(files) || files.length === 0) return null;
  const parsed: UiManifestFile[] = [];
  for (const entry of files) {
    if (typeof entry !== 'object' || entry === null) return null;
    const file = entry as Record<string, unknown>;
    if (!isSafeUiPath(file.path)) return null;
    if (typeof file.sha256 !== 'string' || !SHA256_PATTERN.test(file.sha256)) return null;
    if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0) {
      return null;
    }
    const previous = parsed[parsed.length - 1];
    if (previous && previous.path >= file.path) return null; // tidak urut atau ganda
    parsed.push({ path: file.path, sha256: file.sha256, size: file.size });
  }
  return { uiVersion, minBridge, files: parsed, createdAt };
}

function decodeBase64Url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  return Buffer.from(text, 'base64url');
}

/** Tanda tangan Ed25519 (base64url) atas BYTE persis `manifestJson` (UTF-8); kunci privat PEM PKCS8. */
export function signUiManifest(manifestJson: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Kunci tanda tangan harus Ed25519');
  return sign(null, Buffer.from(manifestJson, 'utf8'), key).toString('base64url');
}

/** Kunci publik PEM (SPKI) pasangan kunci privat PEM. */
export function publicKeyPemOf(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

/**
 * Memverifikasi tanda tangan Ed25519 (base64url) atas BYTE persis `manifestJson`; kunci publik PEM (SPKI).
 * Tidak pernah melempar: masukan rusak (tanda tangan bukan base64url/panjang salah, kunci tak sah, bukan Ed25519) = false.
 */
export function verifyUiManifest(
  manifestJson: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const signatureBytes = decodeBase64Url(signature);
    if (signatureBytes?.length !== 64) return false;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return verify(null, Buffer.from(manifestJson, 'utf8'), key, signatureBytes);
  } catch {
    return false;
  }
}
