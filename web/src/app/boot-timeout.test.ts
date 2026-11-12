import type { MeDto } from '@shared/contract';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DESKTOP_BOOT_ME_TIMEOUT_MS, loadMeForBoot, loadMeState } from './boot';

const me = { email: 'a@x.com', name: 'A' } as MeDto;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
});

/** Panggilan API yang tidak pernah menjawab (server menjatuhkan paket). */
const hanging = () => vi.fn(() => new Promise<never>(() => undefined));

test('batas waktu 8 dtk di desktop: me tak menjawab = server tak terjangkau (bukan layar kosong)', async () => {
  expect(DESKTOP_BOOT_ME_TIMEOUT_MS).toBe(8000);
  (window as unknown as { qcBridge?: unknown }).qcBridge = { version: 3 };
  const call = hanging();
  const pending = loadMeForBoot(call as never);

  await vi.advanceTimersByTimeAsync(7_999);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toEqual({ me: null, unreachable: true });
  expect(call).toHaveBeenCalledWith('auth.me', null);
});

test('di desktop jawaban tepat waktu tetap dipakai dan pewaktu dibersihkan', async () => {
  (window as unknown as { qcBridge?: unknown }).qcBridge = { version: 3 };
  const call = vi.fn(async () => me);
  await expect(loadMeForBoot(call as never)).resolves.toEqual({ me, unreachable: false });
  expect(vi.getTimerCount()).toBe(0);
});

test('di peramban tanpa batas waktu: perilaku lama tidak berubah', async () => {
  const call = hanging();
  let settled = false;
  void loadMeForBoot(call as never).then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(settled).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

test('loadMeState menerima timeoutMs eksplisit', async () => {
  const pending = loadMeState(hanging() as never, { timeoutMs: 50 });
  await vi.advanceTimersByTimeAsync(50);
  await expect(pending).resolves.toEqual({ me: null, unreachable: true });
});
