import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readSidebarState, SIDEBAR_STORAGE_KEY, writeSidebarState } from './sidebar-state';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

test('kosong = bawaan terbuka', () => {
  expect(readSidebarState()).toEqual({ open: true });
});

test('JSON rusak = bawaan', () => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, '{bad');
  expect(readSidebarState()).toEqual({ open: true });
});

test('nilai tersimpan dibaca; submenu tersimpan lama (expanded) diabaikan', () => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, '{"open":false,"expanded":["item"]}');
  expect(readSidebarState()).toEqual({ open: false });
});

test('galat penyimpanan = bawaan, tulis tak melempar', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readSidebarState()).toEqual({ open: true });
  expect(() => writeSidebarState({ open: false })).not.toThrow();
});

test('tulis lalu baca = sama, tanpa menyimpan submenu', () => {
  writeSidebarState({ open: false });
  expect(readSidebarState()).toEqual({ open: false });
  expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"open":false}');
});
