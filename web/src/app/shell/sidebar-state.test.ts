import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readSidebarState, SIDEBAR_STORAGE_KEY, writeSidebarState } from './sidebar-state';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

test('kosong = bawaan terbuka tanpa submenu', () => {
  expect(readSidebarState()).toEqual({ open: true, expanded: [] });
});

test('JSON rusak = bawaan', () => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, '{bad');
  expect(readSidebarState()).toEqual({ open: true, expanded: [] });
});

test('nilai tersimpan dibaca', () => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, '{"open":false,"expanded":["item"]}');
  expect(readSidebarState()).toEqual({ open: false, expanded: ['item'] });
});

test('galat penyimpanan = bawaan, tulis tak melempar', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readSidebarState()).toEqual({ open: true, expanded: [] });
  expect(() => writeSidebarState({ open: false, expanded: [] })).not.toThrow();
});

test('tulis lalu baca = sama', () => {
  writeSidebarState({ open: false, expanded: ['item', 'sticker'] });
  expect(readSidebarState()).toEqual({ open: false, expanded: ['item', 'sticker'] });
});
