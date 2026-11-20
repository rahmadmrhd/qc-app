import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { removeTempDirSync } from '../../test-support/safe-rm';
import { createSettingsStore, DEFAULT_SERVER_URL, normalizeServerUrl } from './settings';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qc-settings-'));
});
afterEach(() => {
  removeTempDirSync(dir);
});

describe('createSettingsStore', () => {
  test('nilai bawaan packageDir null, set lalu get bertahan setelah buka ulang', () => {
    const file = join(dir, 'sub', 'settings.json');
    const store = createSettingsStore(file);
    expect(store.get()).toEqual({ packageDir: null, serverUrl: DEFAULT_SERVER_URL });
    store.set({ packageDir: 'D:\\Paket' });
    expect(store.get().packageDir).toBe('D:\\Paket');
    expect(createSettingsStore(file).get().packageDir).toBe('D:\\Paket');
  });

  test('berkas rusak kembali ke nilai bawaan tanpa melempar', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{ rusak');
    expect(createSettingsStore(file).get()).toEqual({
      packageDir: null,
      serverUrl: DEFAULT_SERVER_URL,
    });
    writeFileSync(file, JSON.stringify({ packageDir: 42 }));
    expect(createSettingsStore(file).get()).toEqual({
      packageDir: null,
      serverUrl: DEFAULT_SERVER_URL,
    });
  });

  test('penulisan atomik: tidak ada berkas sementara tersisa dan get mengembalikan salinan', () => {
    const file = join(dir, 'settings.json');
    const store = createSettingsStore(file);
    store.set({ packageDir: 'A' });
    store.set({ packageDir: null });
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(dir)).toEqual(['settings.json']);
    const snapshot = store.get();
    snapshot.packageDir = 'diubah dari luar';
    expect(store.get().packageDir).toBeNull();
  });
});

describe('serverUrl', () => {
  test('bawaan https://qc.rhd.my.id; nilai sah bertahan setelah buka ulang', () => {
    const file = join(dir, 'settings.json');
    const store = createSettingsStore(file);
    expect(store.get().serverUrl).toBe('https://qc.rhd.my.id');
    store.set({ serverUrl: 'https://qc-dev.rhd.my.id/' });
    expect(store.get().serverUrl).toBe('https://qc-dev.rhd.my.id');
    expect(createSettingsStore(file).get().serverUrl).toBe('https://qc-dev.rhd.my.id');
    store.set({ packageDir: 'D:Paket' });
    expect(store.get().serverUrl).toBe('https://qc-dev.rhd.my.id');
  });

  test('https atau http hanya localhost/127.0.0.1; selain itu jatuh ke bawaan', () => {
    expect(normalizeServerUrl('https://qc.example.com')).toBe('https://qc.example.com');
    expect(normalizeServerUrl('http://localhost:8788')).toBe('http://localhost:8788');
    expect(normalizeServerUrl('http://127.0.0.1:8788/')).toBe('http://127.0.0.1:8788');
    for (const bad of [
      'http://qc.rhd.my.id',
      'http://192.168.1.5:8788',
      'http://localhost.evil.com',
      'ftp://qc.rhd.my.id',
      'file:///C:/x',
      'javascript:alert(1)',
      'https://user:pw@qc.rhd.my.id',
      'https://qc.rhd.my.id/jalur',
      'https://qc.rhd.my.id/?x=1',
      'https://qc.rhd.my.id/#a',
      'qc.rhd.my.id',
      '',
      42,
      null,
    ]) {
      expect(normalizeServerUrl(bad), String(bad)).toBeNull();
    }
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ serverUrl: 'http://evil.example.com' }));
    expect(createSettingsStore(file).get().serverUrl).toBe(DEFAULT_SERVER_URL);
    const store = createSettingsStore(join(dir, 'lain.json'));
    store.set({ serverUrl: 'http://evil.example.com' });
    expect(store.get().serverUrl).toBe(DEFAULT_SERVER_URL);
  });
});
