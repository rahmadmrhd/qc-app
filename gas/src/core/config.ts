import { normalizeEmail_ } from './email';
import { platform_ } from './platform';

export type ConfigKey =
  | 'SPREADSHEET_ID'
  | 'OAUTH_CLIENT_ID'
  | 'OAUTH_CLIENT_SECRET'
  | 'OAUTH_REDIRECT_URI'
  | 'SESSION_SECRET'
  | 'ADMIN_EMAIL'
  | 'SYNC_API_TOKEN'
  | 'READ_ONLY';

/** OAUTH_REDIRECT_URI tidak wajib: bila kosong, `redirectUri_()` memakai URL web app saat runtime. */
export const REQUIRED_CONFIG_KEYS: readonly ConfigKey[] = [
  'SPREADSHEET_ID',
  'OAUTH_CLIENT_ID',
  'OAUTH_CLIENT_SECRET',
  'SESSION_SECRET',
  'ADMIN_EMAIL',
];

export function requireConfig_(key: ConfigKey): string {
  const value = platform_().getProperty(key)?.trim();
  if (!value) throw new Error(`Script Property ${key} belum diset`);
  return value;
}

/**
 * Redirect URI OAuth: properti OAUTH_REDIRECT_URI bila diisi (override), jika tidak URL web app yang
 * sedang berjalan, sehingga /dev dan /exec otomatis memakai URL masing-masing. Kedua URL harus
 * terdaftar di Authorized redirect URIs pada Google Cloud.
 */
export function redirectUri_(): string {
  const platform = platform_();
  const override = platform.getProperty('OAUTH_REDIRECT_URI')?.trim();
  if (override) return override;
  const runtime = platform.scriptUrl().trim();
  if (runtime) return runtime;
  throw new Error(
    'OAUTH_REDIRECT_URI tidak bisa ditentukan: isi Script Property OAUTH_REDIRECT_URI atau deploy sebagai web app',
  );
}

export function missingConfigKeys_(): ConfigKey[] {
  return REQUIRED_CONFIG_KEYS.filter((key) => !platform_().getProperty(key)?.trim());
}

export function adminEmail_(): string {
  return normalizeEmail_(platform_().getProperty('ADMIN_EMAIL') ?? '');
}

/** Token sinkron QC Desktop; kosong bila belum diset (sinkronisasi nonaktif). */
export function syncToken_(): string {
  return platform_().getProperty('SYNC_API_TOKEN')?.trim() ?? '';
}

/** `READ_ONLY=1`: jendela migrasi; semua RPC tulis dan sinkron tulis ditolak (lihat `core/read-only`). */
export function isReadOnly_(): boolean {
  return platform_().getProperty('READ_ONLY')?.trim() === '1';
}
