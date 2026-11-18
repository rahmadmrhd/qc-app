import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useIsDesktop } from './use-is-desktop';

type Listener = () => void;

function mockMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const media = {
    matches: initial,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  const matchMedia = vi.fn(() => media);
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true });
  return {
    matchMedia,
    set(next: boolean) {
      media.matches = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

test('tanpa matchMedia dianggap lebar', () => {
  const { result } = renderHook(() => useIsDesktop());
  expect(result.current).toBe(true);
});

test('memakai query min-width 768px dan bereaksi pada perubahan', () => {
  const media = mockMatchMedia(false);
  const { result } = renderHook(() => useIsDesktop());
  expect(media.matchMedia).toHaveBeenCalledWith('(min-width: 768px)');
  expect(result.current).toBe(false);
  act(() => media.set(true));
  expect(result.current).toBe(true);
  act(() => media.set(false));
  expect(result.current).toBe(false);
});

test('pendengar dilepas saat unmount', () => {
  const media = mockMatchMedia(true);
  const { unmount } = renderHook(() => useIsDesktop());
  expect(media.listenerCount()).toBe(1);
  unmount();
  expect(media.listenerCount()).toBe(0);
});
