import { afterEach, expect, test, vi } from 'vitest';
import {
  applyTheme,
  parseTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeStoredTheme,
} from './theme';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test('parseTheme hanya menerima light, dark, system; selain itu jatuh ke system', () => {
  expect(parseTheme('light')).toBe('light');
  expect(parseTheme('dark')).toBe('dark');
  expect(parseTheme('system')).toBe('system');
  for (const value of ['', 'DARK', 'biru', null, undefined, 42]) {
    expect(parseTheme(value)).toBe('system');
  }
});

test('resolveTheme mengikuti preferensi sistem hanya untuk pilihan system', () => {
  expect(resolveTheme('system', true)).toBe('dark');
  expect(resolveTheme('system', false)).toBe('light');
  expect(resolveTheme('light', true)).toBe('light');
  expect(resolveTheme('dark', false)).toBe('dark');
});

test('applyTheme mengatur class dark dan color-scheme pada elemen root', () => {
  const root = document.createElement('html');
  applyTheme('dark', root);
  expect(root.classList.contains('dark')).toBe(true);
  expect(root.style.colorScheme).toBe('dark');
  applyTheme('light', root);
  expect(root.classList.contains('dark')).toBe(false);
  expect(root.style.colorScheme).toBe('light');
});

test('tema tersimpan dan terbaca kembali', () => {
  expect(readStoredTheme()).toBe('system');
  writeStoredTheme('dark');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  expect(readStoredTheme()).toBe('dark');
});

test('storage yang diblokir tidak membuat aplikasi crash', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readStoredTheme()).toBe('system');
  expect(() => writeStoredTheme('dark')).not.toThrow();
});
