import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';
import type { Db } from './core/db';
import { envFromConfig } from './server';

const PRODUCTION: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://qc_production:rahasia-db@qc-db:3306/qc_production',
  SESSION_SECRET: 'rahasia-sesi-yang-cukup-panjang',
  OAUTH_CLIENT_ID: 'client-id',
  OAUTH_CLIENT_SECRET: 'client-secret-rahasia',
  SYNC_API_TOKEN: 'token-sinkron-rahasia',
  ADMIN_EMAIL: 'admin@example.com',
  APP_ORIGIN: 'https://qc.example.com',
  GOOGLE_SA_KEY_FILE: '/run/secrets/google-sa.json',
  GOOGLE_ROOT_FOLDER_ID: 'folder-induk-1234567890',
  GOOGLE_SPREADSHEET_ID: 'spreadsheet-1234567890',
};

const backupEnabled = (extra: Record<string, string> = {}) =>
  envFromConfig(loadConfig({ ...PRODUCTION, ...extra }), {} as Db).BACKUP_ENABLED;

describe('sakelar cadangan terjadwal (BACKUP_ENABLED)', () => {
  test('produksi dengan Google terkonfigurasi: hidup secara bawaan, mati hanya bila diset false', () => {
    expect(backupEnabled()).toBe(true);
    expect(backupEnabled({ BACKUP_ENABLED: 'true' })).toBe(true);
    expect(backupEnabled({ BACKUP_ENABLED: 'false' })).toBe(false);
  });

  test('Google tak terkonfigurasi: tetap mati walau BACKUP_ENABLED=true', () => {
    const config = loadConfig({
      DATABASE_URL: 'mysql://qc_dev:rahasia-db@127.0.0.1:33063/qc_dev',
      SESSION_SECRET: 'rahasia-sesi-yang-cukup-panjang',
      OAUTH_CLIENT_ID: 'client-id',
      OAUTH_CLIENT_SECRET: 'client-secret-rahasia',
      SYNC_API_TOKEN: 'token-sinkron-rahasia',
      ADMIN_EMAIL: 'admin@example.com',
      BACKUP_ENABLED: 'true',
    });
    expect(envFromConfig(config, {} as Db).BACKUP_ENABLED).toBe(false);
  });
});
