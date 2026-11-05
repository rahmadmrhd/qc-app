import { describe, expect, test } from 'bun:test';
import { ConfigError, DEFAULT_DB_POOL_SIZE, DEFAULT_PORT, loadConfig } from './config';

const VALID: Record<string, string> = {
  DATABASE_URL: 'mysql://qc_dev:rahasia-db@127.0.0.1:33063/qc_dev',
  SESSION_SECRET: 'rahasia-sesi-yang-cukup-panjang',
  OAUTH_CLIENT_ID: 'client-id',
  OAUTH_CLIENT_SECRET: 'client-secret-rahasia',
  SYNC_API_TOKEN: 'token-sinkron-rahasia',
  BRIDGE_URL: 'https://script.google.com/macros/s/ABC/exec',
  BRIDGE_SECRET: 'rahasia-jembatan',
  ADMIN_EMAIL: 'admin@example.com',
};

function errorOf(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('loadConfig seharusnya melempar');
}

describe('loadConfig', () => {
  test('nilai bawaan: port 8788, loopback tepercaya, host loopback, pool 8, berkas statis server/dist', () => {
    const config = loadConfig(VALID);
    expect(config).toMatchObject({
      databaseUrl: VALID.DATABASE_URL,
      port: DEFAULT_PORT,
      host: '127.0.0.1',
      trustedProxy: 'loopback',
      dbPoolSize: DEFAULT_DB_POOL_SIZE,
      appOrigin: undefined,
      devLoginEmail: undefined,
    });
    expect(DEFAULT_PORT).toBe(8788);
    expect(config.staticDir.replaceAll('\\', '/')).toMatch(/\/server\/dist$/);
  });

  test('nilai opsional dibaca dan dipangkas', () => {
    const config = loadConfig({
      ...VALID,
      PORT: '9000',
      HOST: '0.0.0.0',
      TRUSTED_PROXY: 'any',
      DB_POOL_SIZE: '5',
      APP_ORIGIN: ' https://qc.example.com ',
      DEV_LOGIN_EMAIL: 'dev@example.test',
    });
    expect(config).toMatchObject({
      port: 9000,
      host: '0.0.0.0',
      trustedProxy: 'any',
      dbPoolSize: 5,
      appOrigin: 'https://qc.example.com',
      devLoginEmail: 'dev@example.test',
    });
  });

  test('semua variabel wajib yang hilang disebut sekaligus', () => {
    const error = errorOf({});
    for (const name of Object.keys(VALID)) expect(error.message).toContain(name);
    expect(error.problems).toHaveLength(1);
  });

  test('hanya yang hilang yang disebut; nilai yang diisi tidak pernah bocor ke pesan', () => {
    const { DATABASE_URL: _db, BRIDGE_SECRET: _bridge, ...rest } = VALID;
    const error = errorOf(rest);
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('BRIDGE_SECRET');
    expect(error.message).not.toContain('SESSION_SECRET');
    for (const value of Object.values(rest)) expect(error.message).not.toContain(value);
  });

  test('nilai tidak valid disebut dengan nama variabel saja, tanpa nilainya', () => {
    const error = errorOf({
      ...VALID,
      DATABASE_URL: 'bukan-url-rahasia-xyz',
      SESSION_SECRET: 'pendek-xyz',
      BRIDGE_URL: 'ftp://rahasia-xyz',
      APP_ORIGIN: 'rahasia-xyz',
      PORT: '70000',
      DB_POOL_SIZE: 'banyak',
      TRUSTED_PROXY: 'semua-xyz',
    });
    for (const name of [
      'DATABASE_URL',
      'SESSION_SECRET',
      'BRIDGE_URL',
      'APP_ORIGIN',
      'PORT',
      'DB_POOL_SIZE',
      'TRUSTED_PROXY',
    ]) {
      expect(error.message).toContain(name);
    }
    expect(error.message).not.toContain('xyz');
  });

  test('variabel kosong/spasi dianggap hilang', () => {
    expect(errorOf({ ...VALID, ADMIN_EMAIL: '   ' }).message).toContain('ADMIN_EMAIL');
  });
});
