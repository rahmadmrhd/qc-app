import { afterEach, expect, test, vi } from 'vitest';
import { restoreHashFromTop, syncTopUrl, TOP_LOCATION_TIMEOUT_MS } from './gas-location';

function fakeWindow(options: { topHash?: string; ownHash?: string; respond?: boolean }) {
  const replace = vi.fn();
  const win = {
    location: { hash: options.ownHash ?? '' },
    google: {
      script: {
        url: {
          getLocation: (
            callback: (location: { hash: string; parameter: object; parameters: object }) => void,
          ) => {
            if (options.respond !== false) {
              callback({ hash: options.topHash ?? '', parameter: {}, parameters: {} });
            }
          },
        },
        history: { replace, push: vi.fn() },
      },
    },
  };
  return { win: win as unknown as Window, replace };
}

afterEach(() => vi.useRealTimers());

test('hash dari URL atas dipulihkan ke iframe saat iframe belum punya hash', async () => {
  const { win } = fakeWindow({ topHash: '/access/users' });
  await restoreHashFromTop(win);
  expect(win.location.hash).toBe('/access/users');
});

test('hash iframe yang sudah ada tidak ditimpa', async () => {
  const { win } = fakeWindow({ topHash: '/access/users', ownHash: '#/forbidden' });
  await restoreHashFromTop(win);
  expect(win.location.hash).toBe('#/forbidden');
});

test('di luar GAS atau bila callback tidak pernah datang, tetap selesai', async () => {
  await expect(
    restoreHashFromTop({ location: { hash: '' } } as unknown as Window),
  ).resolves.toBeUndefined();
  vi.useFakeTimers();
  const { win } = fakeWindow({ respond: false });
  const pending = restoreHashFromTop(win);
  vi.advanceTimersByTime(TOP_LOCATION_TIMEOUT_MS);
  await expect(pending).resolves.toBeUndefined();
});

test('syncTopUrl menyalin hash ke URL atas dan membersihkan query ?code&state', () => {
  const { win, replace } = fakeWindow({});
  syncTopUrl('#/access/roles', win);
  expect(replace).toHaveBeenCalledWith(null, {}, '/access/roles');
});
