import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  isIosBrowser,
  isStandalone,
  resetInstallForTests,
  startInstallCapture,
  useInstall,
} from './install';

let stopCapture: (() => void) | undefined;
let standalone = false;

function setUserAgent(userAgent: string, platform = 'Win32', maxTouchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function firePrompt() {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt });
  window.dispatchEvent(event);
  return { prompt, event };
}

beforeEach(() => {
  resetInstallForTests();
  standalone = false;
  window.matchMedia = vi.fn(
    (query: string) =>
      ({ matches: standalone && query === '(display-mode: standalone)' }) as MediaQueryList,
  );
  setUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130');
  stopCapture = startInstallCapture();
});
afterEach(() => {
  stopCapture?.();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'standalone');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

test('tanpa peristiwa di Android/desktop: unavailable', () => {
  const { result } = renderHook(() => useInstall());
  expect(result.current.state).toBe('unavailable');
});

test('peristiwa yang tiba SEBELUM useInstall terpasang tetap tersedia dan dicegah munculnya infobar', () => {
  const { event } = firePrompt();
  expect(event.defaultPrevented).toBe(true);
  const { result } = renderHook(() => useInstall());
  expect(result.current.state).toBe('prompt');
});

test('peristiwa yang tiba sesudah terpasang memperbarui status', () => {
  const { result } = renderHook(() => useInstall());
  expect(result.current.state).toBe('unavailable');
  act(() => {
    firePrompt();
  });
  expect(result.current.state).toBe('prompt');
});

test('appinstalled mengembalikan ke unavailable', () => {
  firePrompt();
  const { result } = renderHook(() => useInstall());
  expect(result.current.state).toBe('prompt');
  act(() => {
    window.dispatchEvent(new Event('appinstalled'));
  });
  expect(result.current.state).toBe('unavailable');
});

test('sudah standalone: unavailable meskipun ada peristiwa', () => {
  standalone = true;
  firePrompt();
  const { result } = renderHook(() => useInstall());
  expect(result.current.state).toBe('unavailable');
});

test('iOS Safari belum standalone tanpa peristiwa: ios-manual', () => {
  setUserAgent(IPHONE_UA, 'iPhone', 5);
  const { result } = renderHook(() => useInstall());
  expect(result.current.state).toBe('ios-manual');
});

test('iOS yang sudah standalone (media query atau navigator.standalone): unavailable', () => {
  setUserAgent(IPHONE_UA, 'iPhone', 5);
  standalone = true;
  expect(renderHook(() => useInstall()).result.current.state).toBe('unavailable');
  standalone = false;
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  expect(renderHook(() => useInstall()).result.current.state).toBe('unavailable');
});

test('install() memanggil prompt() sekali lalu mengosongkan peristiwa', async () => {
  const { prompt } = firePrompt();
  const { result } = renderHook(() => useInstall());
  await act(async () => {
    await result.current.install();
  });
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(result.current.state).toBe('unavailable');
  await act(async () => {
    await result.current.install();
  });
  expect(prompt).toHaveBeenCalledTimes(1);
});

test('pembersih melepas pendengar', () => {
  stopCapture?.();
  stopCapture = undefined;
  firePrompt();
  expect(renderHook(() => useInstall()).result.current.state).toBe('unavailable');
});

test('isIosBrowser: iPhone/iPad/iPod dan iPadOS yang menyamar sebagai Mac', () => {
  expect(isIosBrowser({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
  expect(isIosBrowser({ userAgent: 'iPad', platform: 'iPad', maxTouchPoints: 5 })).toBe(true);
  expect(isIosBrowser({ userAgent: 'iPod', platform: 'iPod', maxTouchPoints: 5 })).toBe(true);
  expect(
    isIosBrowser({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 }),
  ).toBe(true);
  expect(
    isIosBrowser({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 0 }),
  ).toBe(false);
  expect(
    isIosBrowser({ userAgent: 'Android Chrome', platform: 'Linux armv8l', maxTouchPoints: 5 }),
  ).toBe(false);
});

test('isStandalone membaca display-mode dan navigator.standalone', () => {
  const win = (matches: boolean, nav: object = {}) =>
    ({ matchMedia: () => ({ matches }), navigator: nav }) as unknown as Window;
  expect(isStandalone(win(true))).toBe(true);
  expect(isStandalone(win(false, { standalone: true }))).toBe(true);
  expect(isStandalone(win(false))).toBe(false);
  expect(isStandalone({ navigator: {} } as unknown as Window)).toBe(false);
});
