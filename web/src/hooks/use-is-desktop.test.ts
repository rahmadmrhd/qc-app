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

test('K2: lebar <main> menentukan (sidebar tersemat memperkecil ruang isi walau viewport >= 768)', () => {
  mockMatchMedia(true); // viewport lebar
  let width = 600;
  const main = document.createElement('main');
  Object.defineProperty(main, 'clientWidth', { get: () => width, configurable: true });
  document.body.append(main);
  let notify: () => void = () => undefined;
  class FakeObserver {
    constructor(callback: () => void) {
      notify = callback;
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeObserver);
  const { result } = renderHook(() => useIsDesktop());
  expect(result.current).toBe(false);
  width = 800;
  act(() => notify());
  expect(result.current).toBe(true);
  main.remove();
  vi.unstubAllGlobals();
});

test('K2: <main> tanpa lebar terukur (jsdom) memakai lebar viewport', () => {
  mockMatchMedia(false);
  const main = document.createElement('main');
  document.body.append(main);
  const { result } = renderHook(() => useIsDesktop());
  expect(result.current).toBe(false);
  main.remove();
});

test('scrollbar klasik 17 px pada viewport 768: <main> 703 tetap dianggap lebar (invarian B12)', () => {
  mockMatchMedia(true);
  const main = document.createElement('main');
  Object.defineProperty(main, 'clientWidth', { get: () => 703, configurable: true });
  document.body.append(main);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const savedWidth = window.innerWidth;
  window.innerWidth = 768;
  Object.defineProperty(document.documentElement, 'clientWidth', { get: () => 751, configurable: true });
  const { result } = renderHook(() => useIsDesktop());
  expect(result.current).toBe(true);
  // Tanpa scrollbar (overlay) 703 memang sempit: ambang tetap 704.
  Object.defineProperty(document.documentElement, 'clientWidth', { get: () => 768, configurable: true });
  const { result: noBar } = renderHook(() => useIsDesktop());
  expect(noBar.current).toBe(false);
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  window.innerWidth = savedWidth;
  main.remove();
  vi.unstubAllGlobals();
});
