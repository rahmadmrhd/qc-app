import { afterEach, expect, test, vi } from 'vitest';
import { isMobileDevice } from './device';

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

function stubMedia(matches: boolean) {
  const spy = vi.fn(() => ({ matches }) as MediaQueryList);
  window.matchMedia = spy as unknown as typeof window.matchMedia;
  return spy;
}

test('pointer kasar (ponsel/tablet sentuh) = mobile; kueri yang dipakai (pointer: coarse)', () => {
  const spy = stubMedia(true);
  expect(isMobileDevice()).toBe(true);
  expect(spy).toHaveBeenCalledWith('(pointer: coarse)');
});

test('pointer halus (desktop dengan mouse) bukan mobile', () => {
  stubMedia(false);
  expect(isMobileDevice()).toBe(false);
});

test('tanpa matchMedia (jsdom/peramban lama) tidak crash dan dianggap bukan mobile', () => {
  // biome-ignore lint/suspicious/noExplicitAny: menghapus API untuk uji
  (window as any).matchMedia = undefined;
  expect(isMobileDevice()).toBe(false);
});

test('matchMedia yang melempar tidak membuat crash', () => {
  window.matchMedia = (() => {
    throw new Error('rusak');
  }) as unknown as typeof window.matchMedia;
  expect(isMobileDevice()).toBe(false);
});
