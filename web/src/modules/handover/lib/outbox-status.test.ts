import { beforeEach, expect, test, vi } from 'vitest';
import {
  beginSending,
  isItemSending,
  resetSendingForTests,
  sendingVersion,
  subscribeSending,
} from './outbox-status';

beforeEach(() => resetSendingForTests());

test('beginSending menandai butir dan end() membersihkannya', () => {
  expect(isItemSending('t', 0)).toBe(false);
  const end = beginSending('t', 0);
  expect(isItemSending('t', 0)).toBe(true);
  end();
  expect(isItemSending('t', 0)).toBe(false);
});

test('dua tanda pada butir yang sama dihitung', () => {
  const end1 = beginSending('t', 0);
  const end2 = beginSending('t', 0);
  expect(isItemSending('t', 1)).toBe(false);
  expect(isItemSending('u', 0)).toBe(false);
  end1();
  expect(isItemSending('t', 0)).toBe(true);
  expect(isItemSending('t', 1)).toBe(false);
  expect(isItemSending('u', 0)).toBe(false);
  end2();
  expect(isItemSending('t', 0)).toBe(false);
  expect(isItemSending('t', 1)).toBe(false);
  expect(isItemSending('u', 0)).toBe(false);
});

test('end() dipanggil dua kali hanya mengurangi satu', () => {
  const end1 = beginSending('t', 0);
  const end2 = beginSending('t', 0);
  end1();
  end1();
  expect(isItemSending('t', 0)).toBe(true);
  end2();
  expect(isItemSending('t', 0)).toBe(false);
});

test('subscribeSending dipanggil saat tanda berubah dan sendingVersion naik', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeSending(listener);
  const v0 = sendingVersion();
  const end = beginSending('t', 0);
  expect(listener).toHaveBeenCalledTimes(1);
  const v1 = sendingVersion();
  expect(v1).toBeGreaterThan(v0);
  end();
  expect(listener).toHaveBeenCalledTimes(2);
  expect(sendingVersion()).toBeGreaterThan(v1);
  unsubscribe();
  beginSending('t', 1);
  expect(listener).toHaveBeenCalledTimes(2);
});
