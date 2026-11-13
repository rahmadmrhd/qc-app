import type { PushConfigDto } from '@shared/contract';
import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  release: null as null | (() => void),
  subscribe: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('./subscribe', () => ({
  getPushRegistration: () => Promise.resolve({ pushManager: {} }),
  subscribeThisDevice: (...args: unknown[]) => state.subscribe(...args),
}));

import { syncThisDevice } from './sync';

const config: PushConfigDto = { enabled: true, publicKey: 'K', userEnabled: true };

beforeEach(() => {
  state.subscribe.mockReset();
});

test('pemanggilan bersamaan berbagi satu alur; setelah selesai alur baru dapat dimulai', async () => {
  let finish: (value: 'subscribed') => void = () => undefined;
  state.subscribe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve as (value: 'subscribed') => void;
      }),
  );
  const first = syncThisDevice(config);
  const second = syncThisDevice(config);
  await vi.waitFor(() => expect(state.subscribe).toHaveBeenCalledTimes(1));
  finish('subscribed');
  expect(await first).toBe('subscribed');
  expect(await second).toBe('subscribed');
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  state.subscribe.mockResolvedValueOnce('subscribed');
  await syncThisDevice(config);
  expect(state.subscribe).toHaveBeenCalledTimes(2);
});

test('galat tidak membuat alur macet: pemanggilan berikutnya jalan lagi', async () => {
  state.subscribe.mockRejectedValueOnce(new Error('ditolak'));
  await expect(syncThisDevice(config)).rejects.toThrow('ditolak');
  state.subscribe.mockResolvedValueOnce('subscribed');
  expect(await syncThisDevice(config)).toBe('subscribed');
});
