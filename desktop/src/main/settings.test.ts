import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createSettingsStore } from './settings';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qc-settings-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createSettingsStore', () => {
  test('nilai bawaan packageDir null, set lalu get bertahan setelah buka ulang', () => {
    const file = join(dir, 'sub', 'settings.json');
    const store = createSettingsStore(file);
    expect(store.get()).toEqual({ packageDir: null });
    store.set({ packageDir: 'D:\\Paket' });
    expect(store.get().packageDir).toBe('D:\\Paket');
    expect(createSettingsStore(file).get().packageDir).toBe('D:\\Paket');
  });

  test('berkas rusak kembali ke nilai bawaan tanpa melempar', () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{ rusak');
    expect(createSettingsStore(file).get()).toEqual({ packageDir: null });
    writeFileSync(file, JSON.stringify({ packageDir: 42 }));
    expect(createSettingsStore(file).get()).toEqual({ packageDir: null });
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
