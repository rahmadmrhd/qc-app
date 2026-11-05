import { resolve } from 'node:path';
import type { TrustedProxy } from '@server/http/proxy';

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
  bridgeUrl: string;
  bridgeSecret: string;
  adminEmail: string;
  /** Origin publik aplikasi (redirect OAuth); kosong = origin permintaan. */
  appOrigin: string | undefined;
  /** Hanya pengembangan lokal: email untuk `/auth/dev-login`. Jangan diisi di produksi. */
  devLoginEmail: string | undefined;
  /** Alamat yang didengarkan. Bawaan loopback (di belakang nginx); di dalam kontainer isi `0.0.0.0`. */
  host: string;
  port: number;
  trustedProxy: TrustedProxy;
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
  'BRIDGE_URL',
  'BRIDGE_SECRET',
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
  const bridgeUrl = get('BRIDGE_URL');
  if (bridgeUrl !== '' && !hasProtocol(bridgeUrl, ['http:', 'https:'])) {
    problems.push('BRIDGE_URL harus berupa URL http(s)');
  }
  const appOrigin = get('APP_ORIGIN');
  if (appOrigin !== '' && !hasProtocol(appOrigin, ['http:', 'https:'])) {
    problems.push('APP_ORIGIN harus berupa origin http(s), mis. https://qc.example.com');
  }

  const portRaw = get('PORT');
  const port = portRaw === '' ? DEFAULT_PORT : integerIn(portRaw, 1, 65535);
  if (port === null) problems.push('PORT harus bilangan bulat 1-65535');

  const poolRaw = get('DB_POOL_SIZE');
  const dbPoolSize = poolRaw === '' ? DEFAULT_DB_POOL_SIZE : integerIn(poolRaw, 1, 30);
  if (dbPoolSize === null) problems.push('DB_POOL_SIZE harus bilangan bulat 1-30');

  const proxyRaw = get('TRUSTED_PROXY') || 'loopback';
  if (proxyRaw !== 'loopback' && proxyRaw !== 'any') {
    problems.push("TRUSTED_PROXY harus 'loopback' atau 'any'");
  }

  if (problems.length > 0 || port === null || dbPoolSize === null) throw new ConfigError(problems);
  const staticDir = get('STATIC_DIR');
  return {
    databaseUrl,
    dbPoolSize,
    sessionSecret,
    oauthClientId: get('OAUTH_CLIENT_ID'),
    oauthClientSecret: get('OAUTH_CLIENT_SECRET'),
    syncApiToken: get('SYNC_API_TOKEN'),
    bridgeUrl,
    bridgeSecret: get('BRIDGE_SECRET'),
    adminEmail: get('ADMIN_EMAIL'),
    appOrigin: appOrigin === '' ? undefined : appOrigin,
    devLoginEmail: get('DEV_LOGIN_EMAIL') === '' ? undefined : get('DEV_LOGIN_EMAIL'),
    host: get('HOST') || DEFAULT_HOST,
    port,
    trustedProxy: proxyRaw as TrustedProxy,
    staticDir: staticDir === '' ? resolve(import.meta.dir, '../dist') : resolve(staticDir),
  };
}
