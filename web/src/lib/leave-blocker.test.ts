import { expect, test, vi } from 'vitest';
import { isSameLocation, leaveBlocker } from './leave-blocker';

test('lokasi sama (jalur + search) bukan meninggalkan halaman', () => {
  expect(
    isSameLocation({ pathname: '/a', search: { x: 1 } }, { pathname: '/a', search: { x: 1 } }),
  ).toBe(true);
  expect(isSameLocation({ pathname: '/a' }, { pathname: '/b' })).toBe(false);
  expect(
    isSameLocation({ pathname: '/a', search: { x: 1 } }, { pathname: '/a', search: { x: 2 } }),
  ).toBe(false);
});

test('leaveBlocker tidak memanggil penjaga untuk lokasi sama; selain itu meneruskannya', () => {
  const inner = vi.fn(() => true);
  const guard = leaveBlocker(inner);
  expect(guard({ current: { pathname: '/a' }, next: { pathname: '/a' } })).toBe(false);
  expect(inner).not.toHaveBeenCalled();
  expect(guard({ current: { pathname: '/a' }, next: { pathname: '/b' } })).toBe(true);
  expect(inner).toHaveBeenCalledTimes(1);
});
