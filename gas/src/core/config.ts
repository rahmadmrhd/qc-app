import { normalizeEmail_ } from './email';
import { platform_ } from './platform';

export type ConfigKey =
  | 'SPREADSHEET_ID'
  | 'OAUTH_CLIENT_ID'
  | 'OAUTH_CLIENT_SECRET'
  | 'OAUTH_REDIRECT_URI'
  | 'SESSION_SECRET'
  | 'ADMIN_EMAIL';

export const REQUIRED_CONFIG_KEYS: readonly ConfigKey[] = [
  'SPREADSHEET_ID',
  'OAUTH_CLIENT_ID',
  'OAUTH_CLIENT_SECRET',
  'OAUTH_REDIRECT_URI',
  'SESSION_SECRET',
  'ADMIN_EMAIL',
];

export function requireConfig_(key: ConfigKey): string {
  const value = platform_().getProperty(key)?.trim();
  if (!value) throw new Error(`Script Property ${key} belum diset`);
  return value;
}

export function missingConfigKeys_(): ConfigKey[] {
  return REQUIRED_CONFIG_KEYS.filter((key) => !platform_().getProperty(key)?.trim());
}

export function adminEmail_(): string {
  return normalizeEmail_(platform_().getProperty('ADMIN_EMAIL') ?? '');
}
