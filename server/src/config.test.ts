import { describe, expect, test } from 'bun:test';
import { ConfigError, DEFAULT_DB_POOL_SIZE, DEFAULT_PORT, loadConfig } from './config';
import { DEFAULT_TRUSTED_PROXY, isTrustedPeer, parseTrustedProxy } from './http/proxy';

const VALID: Record<string, string> = {
  DATABASE_URL: 'mysql://qc_dev:rahasia-db@127.0.0.1:33063/qc_dev',
  SESSION_SECRET: 'rahasia-sesi-yang-cukup-panjang',
  OAUTH_CLIENT_ID: 'client-id',
  OAUTH_CLIENT_SECRET: 'client-secret-rahasia',
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
      dbPoolSize: DEFAULT_DB_POOL_SIZE,
      appOrigin: undefined,
      devLoginEmail: undefined,
    });
    expect(DEFAULT_PORT).toBe(8788);
    expect(config.staticDir.replaceAll('\\', '/')).toMatch(/\/server\/dist$/);
  });

  test('(I5) TRUSTED_PROXY: bawaan loopback; daftar CIDR diurai ketat', () => {
    const byDefault = loadConfig(VALID);
    expect(byDefault.trustedProxy).toEqual(parseTrustedProxy(DEFAULT_TRUSTED_PROXY) ?? []);
    expect(isTrustedPeer('127.0.0.1', byDefault.trustedProxy)).toBe(true);
    expect(isTrustedPeer('::1', byDefault.trustedProxy)).toBe(true);
    expect(isTrustedPeer('172.30.0.1', byDefault.trustedProxy)).toBe(false);

    const docker = loadConfig({ ...VALID, TRUSTED_PROXY: '127.0.0.1/32,172.30.0.0/24' });
    expect(isTrustedPeer('172.30.0.1', docker.trustedProxy)).toBe(true);
    expect(isTrustedPeer('172.31.0.1', docker.trustedProxy)).toBe(false);

    // kosong/spasi = tidak diisi = bawaan loopback (bukan daftar kosong yang diam-diam menolak semua proxy)
    expect(loadConfig({ ...VALID, TRUSTED_PROXY: '  ' }).trustedProxy).toEqual(
      byDefault.trustedProxy,
    );
  });

  test('(I5) TRUSTED_PROXY rusak membuat loadConfig gagal keras, tanpa membocorkan nilainya', () => {
    for (const bad of [
      'loopback', // kata kunci lama
      'any',
      '172.30.0.0', // tanpa prefiks
      '172.30.0.0/33',
      '10.0.0.5/24',
      '127.0.0.1/32,',
      '127.0.0.1/32,rusak-xyz',
    ]) {
      const error = errorOf({ ...VALID, TRUSTED_PROXY: bad });
      expect(error.problems).toHaveLength(1);
      expect(error.message).toContain('TRUSTED_PROXY');
      expect(error.message).toContain('CIDR');
      expect(error.message).not.toContain('xyz');
      expect(error.message).not.toContain(bad);
    }
  });

  test('nilai opsional dibaca dan dipangkas', () => {
    const config = loadConfig({
      ...VALID,
      PORT: '9000',
      HOST: '0.0.0.0',
      TRUSTED_PROXY: '127.0.0.1/32, 172.30.0.0/24',
      DB_POOL_SIZE: '5',
      APP_ORIGIN: ' https://qc.example.com ',
    });
    expect(config).toMatchObject({
      port: 9000,
      host: '0.0.0.0',
      dbPoolSize: 5,
      appOrigin: 'https://qc.example.com',
      devLoginEmail: undefined,
    });
  });

  test('semua variabel wajib yang hilang disebut sekaligus', () => {
    const error = errorOf({});
    for (const name of Object.keys(VALID)) expect(error.message).toContain(name);
    expect(error.problems).toHaveLength(1);
  });

  test('hanya yang hilang yang disebut; nilai yang diisi tidak pernah bocor ke pesan', () => {
    const { DATABASE_URL: _db, OAUTH_CLIENT_ID: _oauth, ...rest } = VALID;
    const error = errorOf(rest);
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('OAUTH_CLIENT_ID');
    expect(error.message).not.toContain('SESSION_SECRET');
    for (const value of Object.values(rest)) expect(error.message).not.toContain(value);
  });

  test('nilai tidak valid disebut dengan nama variabel saja, tanpa nilainya', () => {
    const error = errorOf({
      ...VALID,
      DATABASE_URL: 'bukan-url-rahasia-xyz',
      SESSION_SECRET: 'pendek-xyz',
      GOOGLE_ROOT_FOLDER_ID: '../rahasia-xyz',
      APP_ORIGIN: 'rahasia-xyz',
      PORT: '70000',
      DB_POOL_SIZE: 'banyak',
      TRUSTED_PROXY: 'semua-xyz',
    });
    for (const name of [
      'DATABASE_URL',
      'SESSION_SECRET',
      'GOOGLE_ROOT_FOLDER_ID',
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

  test('(I3) NODE_ENV=production mewajibkan APP_ORIGIN https', () => {
    const prod = {
      ...VALID,
      NODE_ENV: 'production',
      GOOGLE_SA_KEY_FILE: '/run/secrets/google-sa.json',
      GOOGLE_ROOT_FOLDER_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123',
    };
    expect(errorOf(prod).message).toContain('APP_ORIGIN');
    expect(errorOf({ ...prod, APP_ORIGIN: 'http://qc.example.com' }).message).toContain('https');
    expect(loadConfig({ ...prod, APP_ORIGIN: 'https://qc.example.com' }).appOrigin).toBe(
      'https://qc.example.com',
    );
    expect(loadConfig({ ...prod, APP_ORIGIN: 'https://qc.example.com' }).production).toBe(true);
    // non-produksi tanpa APP_ORIGIN tetap boleh (dev)
    expect(loadConfig(VALID).production).toBe(false);
  });

  test('(I3) DEV_LOGIN_EMAIL + konfigurasi produksi/non-lokal ditolak (ConfigError tanpa membocorkan nilai)', () => {
    const dev = { ...VALID, DEV_LOGIN_EMAIL: 'rahasia-dev@example.test' };
    for (const env of [
      { ...dev, NODE_ENV: 'production', APP_ORIGIN: 'https://qc.example.com' },
      { ...dev, APP_ORIGIN: 'https://qc.example.com' },
      { ...dev, APP_ORIGIN: 'http://qc.example.com' },
      { ...dev, APP_ORIGIN: 'http://localhost.evil.example' },
      dev, // tanpa APP_ORIGIN
    ]) {
      const error = errorOf(env);
      expect(error.message).toContain('DEV_LOGIN_EMAIL');
      expect(error.message).not.toContain('rahasia-dev');
    }
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost']) {
      expect(loadConfig({ ...dev, APP_ORIGIN: origin }).devLoginEmail).toBe(
        'rahasia-dev@example.test',
      );
    }
  });

  describe('klien Google langsung (service account, T30a)', () => {
    const PROD = { ...VALID, NODE_ENV: 'production', APP_ORIGIN: 'https://qc.example.com' };
    const GOOGLE = {
      GOOGLE_SA_KEY_FILE: '/run/secrets/google-sa.json',
      GOOGLE_ROOT_FOLDER_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123',
    };

    test('di luar produksi semuanya opsional: kosong = belum dikonfigurasi (dev tanpa Google)', () => {
      expect(loadConfig(VALID)).toMatchObject({
        googleSaKeyFile: '',
        googleRootFolderId: '',
        googleSpreadsheetId: '',
        attachmentsFolderId: '',
        qrFolderId: '',
        qrDocFolderId: '',
        backupFolderId: '',
        allowedFolderIds: [],
      });
    });

    test('BRIDGE_URL/BRIDGE_SECRET tidak lagi wajib dan tidak dibaca', () => {
      const config = loadConfig({
        ...VALID,
        BRIDGE_URL: 'ftp://dibuang',
        BRIDGE_SECRET: 'dibuang-xyz',
      });
      expect(JSON.stringify({ ...config, trustedProxy: null })).not.toContain('dibuang');
      expect('bridgeUrl' in config || 'bridgeSecret' in config).toBe(false);
    });

    test('nilai dibaca, dipangkas, dan ALLOWED_FOLDER_IDS dipecah per koma', () => {
      const config = loadConfig({
        ...VALID,
        ...GOOGLE,
        GOOGLE_SPREADSHEET_ID: ' 1SpreadsheetIdAbCdEfGhIj ',
        ATTACHMENTS_FOLDER_ID: 'IMAGESFOLDER001',
        QR_FOLDER_ID: 'QRFOLDERID00001',
        QR_DOC_FOLDER_ID: 'QRDOCFOLDER0001',
        BACKUP_FOLDER_ID: 'BACKUPFOLDER001',
        ALLOWED_FOLDER_IDS: 'EXTRAFOLDER0001, EXTRAFOLDER0002 ,',
      });
      expect(config).toMatchObject({
        googleSaKeyFile: GOOGLE.GOOGLE_SA_KEY_FILE,
        googleRootFolderId: GOOGLE.GOOGLE_ROOT_FOLDER_ID,
        googleSpreadsheetId: '1SpreadsheetIdAbCdEfGhIj',
        attachmentsFolderId: 'IMAGESFOLDER001',
        qrFolderId: 'QRFOLDERID00001',
        qrDocFolderId: 'QRDOCFOLDER0001',
        backupFolderId: 'BACKUPFOLDER001',
        allowedFolderIds: ['EXTRAFOLDER0001', 'EXTRAFOLDER0002'],
      });
    });

    test('id folder/spreadsheet yang bukan id Drive ditolak dengan nama variabel saja, tanpa nilainya', () => {
      const error = errorOf({
        ...VALID,
        GOOGLE_ROOT_FOLDER_ID: '../rahasia-xyz',
        GOOGLE_SPREADSHEET_ID: 'pendek',
        ATTACHMENTS_FOLDER_ID: 'a/b/c-rahasia-xyz',
        QR_FOLDER_ID: 'x',
        QR_DOC_FOLDER_ID: 'y',
        BACKUP_FOLDER_ID: 'z',
        ALLOWED_FOLDER_IDS: 'OKFOLDERID0001,rusak rahasia-xyz',
      });
      for (const name of [
        'GOOGLE_ROOT_FOLDER_ID',
        'GOOGLE_SPREADSHEET_ID',
        'ATTACHMENTS_FOLDER_ID',
        'QR_FOLDER_ID',
        'QR_DOC_FOLDER_ID',
        'BACKUP_FOLDER_ID',
        'ALLOWED_FOLDER_IDS',
      ]) {
        expect(error.message).toContain(name);
      }
      expect(error.message).not.toContain('xyz');
    });

    test('produksi mewajibkan GOOGLE_SA_KEY_FILE dan GOOGLE_ROOT_FOLDER_ID (nama saja di pesan)', () => {
      const error = errorOf(PROD);
      expect(error.message).toContain('GOOGLE_SA_KEY_FILE');
      expect(error.message).toContain('GOOGLE_ROOT_FOLDER_ID');
      expect(
        errorOf({ ...PROD, GOOGLE_ROOT_FOLDER_ID: GOOGLE.GOOGLE_ROOT_FOLDER_ID }).message,
      ).toContain('GOOGLE_SA_KEY_FILE');
      expect(loadConfig({ ...PROD, ...GOOGLE }).googleSaKeyFile).toBe(GOOGLE.GOOGLE_SA_KEY_FILE);
    });

    test('kunci service account hanya dari BERKAS: isi kunci di env tidak pernah dibaca atau disimpan', () => {
      const secret = '-----BEGIN PRIVATE KEY-----RAHASIA-xyz';
      const config = loadConfig({
        ...VALID,
        GOOGLE_SA_KEY: secret,
        GOOGLE_SA_KEY_JSON: secret,
        GOOGLE_PRIVATE_KEY: secret,
      });
      expect(JSON.stringify({ ...config, trustedProxy: null })).not.toContain('RAHASIA');
    });
  });
});

describe('loadConfig: cadangan dan peringatan (T30/T32)', () => {
  const SMTP = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'qc@example.test',
    SMTP_PASS: 'sandi-aplikasi-rahasia',
    SMTP_FROM: 'QC App <qc@example.test>',
    ALERT_TO: 'pemilik@example.test, lain@example.test',
  };

  test('bawaan: tanpa SMTP, tanpa penerima, ambang kuota 80, folder lokal dev di folder sementara OS', () => {
    const config = loadConfig(VALID);
    expect(config.smtp).toBeNull();
    expect(config.alertTo).toEqual([]);
    expect(config.quotaAlertPercent).toBe(80);
    expect(config.backupLocalDir.replaceAll('\\', '/')).toMatch(/qc-backups$/);
  });

  test('produksi: folder lokal bawaan /var/backups/qc; BACKUP_LOCAL_DIR menimpa', () => {
    const prod = {
      ...VALID,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://qc.example.com',
      GOOGLE_SA_KEY_FILE: '/run/secrets/google-sa.json',
      GOOGLE_ROOT_FOLDER_ID: 'abcdefghij1234567890',
    };
    expect(loadConfig(prod).backupLocalDir).toBe('/var/backups/qc');
    expect(loadConfig({ ...prod, BACKUP_LOCAL_DIR: '/data/cadangan' }).backupLocalDir).toBe(
      '/data/cadangan',
    );
  });

  test('SMTP lengkap dirakit; penerima dipisah koma dan dipangkas', () => {
    const config = loadConfig({ ...VALID, ...SMTP });
    expect(config.smtp).toEqual({
      host: 'smtp.example.test',
      port: 465,
      secure: true,
      user: 'qc@example.test',
      pass: 'sandi-aplikasi-rahasia',
      from: 'QC App <qc@example.test>',
    });
    expect(config.alertTo).toEqual(['pemilik@example.test', 'lain@example.test']);
  });

  test('SMTP_FROM kosong memakai SMTP_USER; port kosong = 587', () => {
    const config = loadConfig({ ...VALID, ...SMTP, SMTP_FROM: '', SMTP_PORT: '' });
    expect(config.smtp?.from).toBe('qc@example.test');
    expect(config.smtp?.port).toBe(587);
  });

  test('penanda ISI_OLEH_PEMILIK / nilai rusak TIDAK menggagalkan start: peringatan dinonaktifkan', () => {
    expect(loadConfig({ ...VALID, ...SMTP, ALERT_TO: 'ISI_OLEH_PEMILIK' }).smtp).toBeNull();
    expect(loadConfig({ ...VALID, ...SMTP, SMTP_PORT: 'ISI_OLEH_PEMILIK' }).smtp).toBeNull();
    expect(loadConfig({ ...VALID, ...SMTP, SMTP_HOST: '' }).smtp).toBeNull();
    expect(loadConfig({ ...VALID, ...SMTP, SMTP_PORT: '99999' }).smtp).toBeNull();
  });

  test('BACKUP_ENABLED: kosong/true = hidup (bawaan aman), false = mati, nilai lain ConfigError', () => {
    expect(loadConfig({ ...VALID }).backupEnabled).toBe(true);
    expect(loadConfig({ ...VALID, BACKUP_ENABLED: '' }).backupEnabled).toBe(true);
    expect(loadConfig({ ...VALID, BACKUP_ENABLED: 'true' }).backupEnabled).toBe(true);
    expect(loadConfig({ ...VALID, BACKUP_ENABLED: 'false' }).backupEnabled).toBe(false);
    expect(loadConfig({ ...VALID, BACKUP_ENABLED: 'FALSE' }).backupEnabled).toBe(false);
    for (const bad of ['0', 'no', 'off', 'ya']) {
      expect(errorOf({ ...VALID, BACKUP_ENABLED: bad }).message).toContain('BACKUP_ENABLED');
    }
  });

  test('QUOTA_ALERT_PERCENT: 1-99 atau ConfigError dengan nama variabel saja', () => {
    expect(loadConfig({ ...VALID, QUOTA_ALERT_PERCENT: '70' }).quotaAlertPercent).toBe(70);
    for (const bad of ['0', '100', 'banyak', '8.5']) {
      const error = errorOf({ ...VALID, QUOTA_ALERT_PERCENT: bad });
      expect(error.message).toContain('QUOTA_ALERT_PERCENT');
      expect(error.message).not.toContain(bad === 'banyak' ? 'banyak' : '\u0000');
    }
  });

  test('SMTP_PASS tidak pernah muncul di pesan galat konfigurasi', () => {
    const error = errorOf({ ...VALID, ...SMTP, SESSION_SECRET: '' });
    expect(error.message).not.toContain('sandi-aplikasi-rahasia');
  });
});
