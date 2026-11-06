import { resolve } from 'node:path';
import { isDriveId } from '@server/core/google/settings';
import { DEFAULT_TRUSTED_PROXY, parseTrustedProxy, type TrustedProxy } from '@server/http/proxy';

/** Konfigurasi proses server, dibaca dari variabel lingkungan (Bun memuat `server/.env` saat dijalankan dari `server/`). */
export interface Config {
  /** `mysql://pengguna:kata-sandi@host:port/skema`. */
  databaseUrl: string;
  /** Jumlah koneksi maksimum pool MariaDB (VPS bersama: `max_connections` 40). */
  dbPoolSize: number;
  sessionSecret: string;
  oauthClientId: string;
  oauthClientSecret: string;
  syncApiToken: string;
  /** Jalur berkas kunci service account Google (JSON); '' = belum dikonfigurasi (wajib di produksi). Isi kunci TIDAK pernah dari env. */
  googleSaKeyFile: string;
  /** Folder induk Drive; '' = belum dikonfigurasi (wajib di produksi). */
  googleRootFolderId: string;
  /** Spreadsheet data tunggal (ekspor/impor Sheets). */
  googleSpreadsheetId: string;
  /** Folder fungsi di Drive (opsional; kosong = dibuat di bawah induk dan dicatat di tabel settings). */
  itemImagesFolderId: string;
  qrFolderId: string;
  qrDocFolderId: string;
  backupFolderId: string;
  /** Folder tambahan di luar induk yang diizinkan klien Google. */
  allowedFolderIds: string[];
  adminEmail: string;
  /** Origin publik aplikasi: dasar redirect OAuth dan atribut `Secure` cookie (BUKAN header Host). Wajib https di produksi. */
  appOrigin: string | undefined;
  /** `NODE_ENV=production`. */
  production: boolean;
  /** Hanya pengembangan lokal: email untuk `/auth/dev-login`. Jangan diisi di produksi. */
  devLoginEmail: string | undefined;
  /** Alamat yang didengarkan. Bawaan loopback (di belakang nginx); di dalam kontainer isi `0.0.0.0`. */
  host: string;
  port: number;
  /** Daftar CIDR peer yang `CF-Connecting-IP`-nya dipercaya (`TRUSTED_PROXY`; bawaan loopback). */
  trustedProxy: TrustedProxy;
  /** Teks `TRUSTED_PROXY` yang berlaku (untuk log awal; `trustedProxy` memuat bilangan besar yang tak dapat di-JSON-kan). */
  trustedProxyText: string;
  /** Direktori berkas statis web (hasil `bun run build`). */
  staticDir: string;
}

export const DEFAULT_PORT = 8788;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_DB_POOL_SIZE = 8;
const SESSION_SECRET_MIN_LENGTH = 16;

/** Galat konfigurasi: memuat NAMA variabel yang bermasalah saja, tidak pernah nilainya. */
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Konfigurasi tidak valid: ${problems.join('; ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const REQUIRED = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'OAUTH_CLIENT_ID',
  'OAUTH_CLIENT_SECRET',
  'SYNC_API_TOKEN',
  'ADMIN_EMAIL',
] as const;

function integerIn(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

function hasProtocol(raw: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/** True bila `origin` adalah origin http lokal (localhost atau 127.0.0.1, port bebas); selain itu false. */
export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

/**
 * Membaca dan memvalidasi konfigurasi. Melempar `ConfigError` yang menyebut SEMUA variabel wajib yang hilang
 * dan semua nilai yang tidak valid sekaligus (tanpa membocorkan nilai apa pun).
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const problems: string[] = [];
  const get = (name: string): string => env[name]?.trim() ?? '';

  const missing = REQUIRED.filter((name) => get(name) === '');
  if (missing.length > 0) problems.push(`variabel wajib belum diisi: ${missing.join(', ')}`);

  const databaseUrl = get('DATABASE_URL');
  if (databaseUrl !== '' && !hasProtocol(databaseUrl, ['mysql:'])) {
    problems.push('DATABASE_URL harus berbentuk mysql://pengguna:kata-sandi@host:port/skema');
  }
  const sessionSecret = get('SESSION_SECRET');
  if (sessionSecret !== '' && sessionSecret.length < SESSION_SECRET_MIN_LENGTH) {
    problems.push(`SESSION_SECRET minimal ${SESSION_SECRET_MIN_LENGTH} karakter`);
  }
  // Id Drive masuk ke jalur URL API Google: hanya pola id yang sah (huruf, angka, _ dan -); nilai tak pernah dicantumkan.
  const googleIds = [
    'GOOGLE_ROOT_FOLDER_ID',
    'GOOGLE_SPREADSHEET_ID',
    'ITEM_IMAGES_FOLDER_ID',
    'QR_FOLDER_ID',
    'QR_DOC_FOLDER_ID',
    'BACKUP_FOLDER_ID',
  ] as const;
  for (const name of googleIds) {
    if (get(name) !== '' && !isDriveId(get(name))) {
      problems.push(
        `${name} bukan id Google Drive yang valid (huruf, angka, _ dan -; 10-100 karakter)`,
      );
    }
  }
  const allowedFolderIds = get('ALLOWED_FOLDER_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  if (allowedFolderIds.some((id) => !isDriveId(id))) {
    problems.push('ALLOWED_FOLDER_IDS harus daftar id Google Drive yang valid, dipisah koma');
  }
  const appOrigin = get('APP_ORIGIN');
  if (appOrigin !== '' && !hasProtocol(appOrigin, ['http:', 'https:'])) {
    problems.push('APP_ORIGIN harus berupa origin http(s), mis. https://qc.example.com');
  }

  const production = get('NODE_ENV') === 'production';
  if (production) {
    const missingGoogle = ['GOOGLE_SA_KEY_FILE', 'GOOGLE_ROOT_FOLDER_ID'].filter(
      (name) => get(name) === '',
    );
    if (missingGoogle.length > 0) {
      problems.push(
        `variabel Google wajib diisi bila NODE_ENV=production: ${missingGoogle.join(', ')}`,
      );
    }
    if (appOrigin === '') {
      problems.push('APP_ORIGIN wajib diisi bila NODE_ENV=production');
    } else if (!appOrigin.startsWith('https://')) {
      problems.push('APP_ORIGIN harus https bila NODE_ENV=production');
    }
  }
  // Login dev tanpa OAuth hanya untuk mesin pengembang: tidak di produksi dan hanya bila origin aplikasi lokal.
  if (get('DEV_LOGIN_EMAIL') !== '' && (production || !isLocalOrigin(appOrigin))) {
    problems.push(
      'DEV_LOGIN_EMAIL hanya untuk pengembangan lokal: kosongkan di produksi dan syaratkan APP_ORIGIN http://localhost atau http://127.0.0.1',
    );
  }

  const portRaw = get('PORT');
  const port = portRaw === '' ? DEFAULT_PORT : integerIn(portRaw, 1, 65535);
  if (port === null) problems.push('PORT harus bilangan bulat 1-65535');

  const poolRaw = get('DB_POOL_SIZE');
  const dbPoolSize = poolRaw === '' ? DEFAULT_DB_POOL_SIZE : integerIn(poolRaw, 1, 30);
  if (dbPoolSize === null) problems.push('DB_POOL_SIZE harus bilangan bulat 1-30');

  const trustedProxyText = get('TRUSTED_PROXY') || DEFAULT_TRUSTED_PROXY;
  const trustedProxy = parseTrustedProxy(trustedProxyText);
  if (trustedProxy === null) {
    problems.push(
      'TRUSTED_PROXY harus daftar CIDR IPv4/IPv6 yang valid, dipisah koma, tiap entri berprefiks dan tanpa bit tuan rumah di luar prefiks',
    );
  }

  if (problems.length > 0 || port === null || dbPoolSize === null || trustedProxy === null) {
    throw new ConfigError(problems);
  }
  const staticDir = get('STATIC_DIR');
  return {
    databaseUrl,
    dbPoolSize,
    sessionSecret,
    oauthClientId: get('OAUTH_CLIENT_ID'),
    oauthClientSecret: get('OAUTH_CLIENT_SECRET'),
    syncApiToken: get('SYNC_API_TOKEN'),
    googleSaKeyFile: get('GOOGLE_SA_KEY_FILE'),
    googleRootFolderId: get('GOOGLE_ROOT_FOLDER_ID'),
    googleSpreadsheetId: get('GOOGLE_SPREADSHEET_ID'),
    itemImagesFolderId: get('ITEM_IMAGES_FOLDER_ID'),
    qrFolderId: get('QR_FOLDER_ID'),
    qrDocFolderId: get('QR_DOC_FOLDER_ID'),
    backupFolderId: get('BACKUP_FOLDER_ID'),
    allowedFolderIds,
    adminEmail: get('ADMIN_EMAIL'),
    appOrigin: appOrigin === '' ? undefined : appOrigin,
    production,
    devLoginEmail: get('DEV_LOGIN_EMAIL') === '' ? undefined : get('DEV_LOGIN_EMAIL'),
    host: get('HOST') || DEFAULT_HOST,
    port,
    trustedProxy,
    trustedProxyText,
    staticDir: staticDir === '' ? resolve(import.meta.dir, '../dist') : resolve(staticDir),
  };
}
