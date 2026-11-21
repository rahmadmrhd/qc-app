import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import {
  KEYBOARD_FALLBACK_MS,
  KEYBOARD_SETTLE_MS,
  useFocusIntoView,
  useVisualViewport,
  viewportVars,
} from './use-visual-viewport';

type Listener = () => void;

function mockVisualViewport(initial: { height: number; offsetTop: number }) {
  const listeners = new Map<string, Set<Listener>>();
  const viewport = {
    ...initial,
    addEventListener: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
  };
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  return {
    resize(height: number, offsetTop = 0) {
      viewport.height = height;
      viewport.offsetTop = offsetTop;
      for (const listener of listeners.get('resize') ?? []) listener();
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport');
  vi.useRealTimers();
  document.documentElement.removeAttribute('style');
});

test('viewportVars: tinggi papan ketik = layar dikurangi viewport visual dan geser atas', () => {
  expect(viewportVars(800, { height: 500, offsetTop: 0 })).toEqual({
    vvh: '500px',
    vvTop: '0px',
    kb: '300px',
  });
  expect(viewportVars(800, { height: 500, offsetTop: 40 }).kb).toBe('260px');
  expect(viewportVars(800, { height: 800, offsetTop: 0 }).kb).toBe('0px');
});

test('useVisualViewport menulis --vvh, --vv-top, --kb ke <html> dan membersihkannya', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const viewport = mockVisualViewport({ height: 800, offsetTop: 0 });
  const { unmount } = renderHook(() => useVisualViewport());
  const root = document.documentElement;
  expect(root.style.getPropertyValue('--vvh')).toBe('800px');
  act(() => {
    viewport.resize(480, 10);
    vi.advanceTimersByTime(20);
  });
  expect(root.style.getPropertyValue('--vvh')).toBe('480px');
  expect(root.style.getPropertyValue('--vv-top')).toBe('10px');
  expect(root.style.getPropertyValue('--kb')).toBe('310px');
  unmount();
  expect(root.style.getPropertyValue('--vvh')).toBe('');
});

test('useFocusIntoView: di ponsel menggulirkan field fokus ke tengah setelah viewport reda', () => {
  vi.useFakeTimers();
  const media = mockMatchMedia(false);
  const viewport = mockVisualViewport({ height: 800, offsetTop: 0 });
  const scroll = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = scroll;
  renderHook(() => useFocusIntoView());
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  act(() => {
    viewport.resize(500);
    vi.advanceTimersByTime(KEYBOARD_SETTLE_MS - 10);
    viewport.resize(480);
    vi.advanceTimersByTime(KEYBOARD_SETTLE_MS - 10);
  });
  expect(scroll).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(20);
  });
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  input.remove();
  media.restore();
});

test('useFocusIntoView: tanpa resize viewport tetap menggulir lewat batas cadangan; >= 768 px tidak aktif', () => {
  vi.useFakeTimers();
  const media = mockMatchMedia(false);
  const scroll = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = scroll;
  renderHook(() => useFocusIntoView());
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  act(() => {
    vi.advanceTimersByTime(KEYBOARD_FALLBACK_MS + 5);
  });
  expect(scroll).toHaveBeenCalledTimes(1);
  media.set(true);
  input.blur();
  input.focus();
  act(() => {
    vi.advanceTimersByTime(KEYBOARD_FALLBACK_MS + 5);
  });
  expect(scroll).toHaveBeenCalledTimes(1);
  input.remove();
  media.restore();
});
