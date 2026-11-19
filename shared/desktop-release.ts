// Kontrak rilis aplikasi desktop (spek desktop 5.2, rencana bagian 4): manifest bertanda tangan `release-<versi>.json`
// yang dibuat CI, disajikan server (tanpa kunci, hanya meneruskan byte-nya), dan diverifikasi aplikasi dengan kunci publik
// tertanam. Murni (tanpa API runtime/DOM): dipakai server, skrip rilis, dan desktop.

export const RELEASE_SCHEMA = 1;
export const RELEASE_ARCHS = ['x64', 'arm64'] as const;
export type ReleaseArch = (typeof RELEASE_ARCHS)[number];

export interface ReleaseFile {
  name: string;
  arch: ReleaseArch;
  size: number;
  /** SHA-512 isi berkas, base64 (konvensi `electron-updater`): 88 karakter. */
  sha512: string;
}

export interface DesktopReleaseManifest {
  schema: 1;
  version: string;
  /** ISO 8601 UTC. */
  publishedAt: string;
  files: ReleaseFile[];
  /** Bagian versi ini dari `desktop/CHANGELOG.md` (teks untuk pengguna, tanpa tautan PR/commit). */
  changelog: string;
}

export const RELEASE_LIMITS = {
  fileMaxBytes: 500 * 1024 * 1024,
  changelogMaxChars: 20_000,
} as const;

const VERSION = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`;
const VERSION_PATTERN = new RegExp(`^${VERSION}$`);
const INSTALLER_PATTERN = new RegExp(String.raw`^QC-App-Setup-(${VERSION})-(x64|arm64)\.exe$`);
const MANIFEST_PATTERN = new RegExp(String.raw`^release-(${VERSION})\.json$`);
const SIGNATURE_PATTERN = new RegExp(String.raw`^release-(${VERSION})\.sig$`);
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export const installerName = (version: string, arch: ReleaseArch): string =>
  `QC-App-Setup-${version}-${arch}.exe`;
export const manifestFileName = (version: string): string => `release-${version}.json`;
export const signatureFileName = (version: string): string => `release-${version}.sig`;

export type ReleaseFileName =
  | { kind: 'installer'; version: string; arch: ReleaseArch }
  | { kind: 'manifest'; version: string }
  | { kind: 'signature'; version: string };

/** Mengenali nama berkas di folder rilis; bentuk lain (termasuk yang berpemisah jalur atau baris baru) = `null`. */
export function isReleaseFileName(name: string): ReleaseFileName | null {
  const installer = INSTALLER_PATTERN.exec(name);
  if (installer) {
    return {
      kind: 'installer',
      version: installer[1] as string,
      arch: installer[5] as ReleaseArch,
    };
  }
  const manifest = MANIFEST_PATTERN.exec(name);
  if (manifest) return { kind: 'manifest', version: manifest[1] as string };
  const signature = SIGNATURE_PATTERN.exec(name);
  if (signature) return { kind: 'signature', version: signature[1] as string };
  return null;
}

/** Perbandingan numerik `X.Y.Z` (`1.10.0` > `1.9.0`); masukan yang bukan `X.Y.Z` tak boleh sampai sini. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** Versi tertinggi di antara yang berbentuk `X.Y.Z` (lainnya diabaikan); tak ada = `null`. */
export function latestVersion(versions: string[]): string | null {
  let best: string | null = null;
  for (const version of versions) {
    if (!VERSION_PATTERN.test(version)) continue;
    if (best === null || compareVersions(version, best) > 0) best = version;
  }
  return best;
}

const MANIFEST_KEYS = ['schema', 'version', 'publishedAt', 'files', 'changelog'];
const FILE_KEYS = ['name', 'arch', 'size', 'sha512'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

/**
 * Mengurai dan memvalidasi `release-<versi>.json`. `null` bila bukan JSON kanonik (`JSON.stringify(JSON.parse(json))`
 * harus sama persis dengan masukan, DENGAN urutan kunci kanonik `schema, version, publishedAt, files, changelog` dan
 * `name, arch, size, sha512` per berkas: tanda tangan dihitung atas byte kanonik ini), bentuknya salah, atau ada nilai tak sah.
 */
export function parseReleaseManifest(json: string): DesktopReleaseManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(value) || JSON.stringify(value) !== json || !hasOnlyKeys(value, MANIFEST_KEYS)) {
    return null;
  }
  const { schema, version, publishedAt, files, changelog } = value;
  if (schema !== RELEASE_SCHEMA) return null;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return null;
  if (
    typeof publishedAt !== 'string' ||
    !ISO_UTC.test(publishedAt) ||
    Number.isNaN(Date.parse(publishedAt))
  ) {
    return null;
  }
  if (typeof changelog !== 'string' || changelog.length > RELEASE_LIMITS.changelogMaxChars) {
    return null;
  }
  if (!Array.isArray(files) || files.length === 0 || files.length > RELEASE_ARCHS.length) {
    return null;
  }
  const parsed: ReleaseFile[] = [];
  const seen = new Set<string>();
  for (const entry of files) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, FILE_KEYS)) return null;
    const { name, arch, size, sha512 } = entry;
    if (typeof arch !== 'string' || !(RELEASE_ARCHS as readonly string[]).includes(arch)) {
      return null;
    }
    if (seen.has(arch) || name !== installerName(version, arch as ReleaseArch)) return null;
    seen.add(arch);
    if (
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > RELEASE_LIMITS.fileMaxBytes
    ) {
      return null;
    }
    if (typeof sha512 !== 'string' || !SHA512_BASE64.test(sha512)) return null;
    parsed.push({ name: name as string, arch: arch as ReleaseArch, size, sha512 });
  }
  const result: DesktopReleaseManifest = {
    schema: RELEASE_SCHEMA,
    version,
    publishedAt,
    files: parsed,
    changelog,
  };
  // Server mengirim objek hasil urai ini dan klien membangun ulang teks yang ditandatangani lewat `JSON.stringify`:
  // urutan kunci selain urutan di atas membuat teks klien berbeda dari yang ditandatangani (semua klien menolak diam-diam).
  return JSON.stringify(result) === json ? result : null;
}
