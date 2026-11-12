import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRenderProbe } from './render-probe';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(results: Array<boolean | Error>) {
  const calls: number[] = [];
  const events: string[] = [];
  let index = 0;
  const probe = createRenderProbe({
    check: async () => {
      calls.push(Date.now());
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      if (result instanceof Error) throw result;
      return result === true;
    },
    onOk: () => events.push('ok'),
    onFailed: () => events.push('failed'),
    intervalMs: 500,
    timeoutMs: 10_000,
  });
  return { probe, calls, events };
}

describe('createRenderProbe (R2-I2)', () => {
  test('akar terisi pada pemeriksaan pertama = onOk sekali, tanpa pemeriksaan lanjutan', async () => {
    const { probe, calls, events } = setup([true]);
    probe.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['ok']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(events).toEqual(['ok']);
    expect(calls.length).toBe(1);
  });

  test('akar terisi di tengah jalan = onOk; pemeriksaan tiap 500 ms', async () => {
    const { probe, calls, events } = setup([false, false, false, true]);
    probe.start();
    await vi.advanceTimersByTimeAsync(1400);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toEqual(['ok']);
    expect(calls.length).toBe(4);
    expect((calls[1] ?? 0) - (calls[0] ?? 0)).toBe(500);
  });

  test('tak pernah terisi sampai batas 10 dtk = onFailed sekali (bukan onOk), lalu berhenti', async () => {
    const { probe, calls, events } = setup([false]);
    probe.start();
    await vi.advanceTimersByTimeAsync(9_900);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toEqual(['failed']);
    const total = calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events).toEqual(['failed']);
    expect(calls.length).toBe(total);
  });

  test('pemeriksaan yang melempar (mis. konteks halaman hilang) dihitung belum terisi', async () => {
    const { probe, events } = setup([new Error('konteks hilang'), new Error('x'), true]);
    probe.start();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(events).toEqual(['ok']);
  });

  test('terisi tepat di pemeriksaan terakhir tetap onOk (bukan gagal)', async () => {
    const results: boolean[] = new Array(20).fill(false);
    results.push(true);
    const { probe, events } = setup(results);
    probe.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).toEqual(['ok']);
  });

  test('cancel menghentikan pemeriksaan tanpa memanggil apa pun', async () => {
    const { probe, calls, events } = setup([false]);
    probe.start();
    await vi.advanceTimersByTimeAsync(600);
    probe.cancel();
    const total = calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events).toEqual([]);
    expect(calls.length).toBe(total);
  });

  test('start ulang (navigasi baru) membatalkan pemeriksaan lama: hanya satu hasil', async () => {
    const { probe, events } = setup([false, false, true]);
    probe.start();
    await vi.advanceTimersByTimeAsync(300);
    probe.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events).toEqual(['ok']);
  });

  test('hasil check yang tiba setelah cancel diabaikan', async () => {
    let resolveCheck: (value: boolean) => void = () => {};
    const events: string[] = [];
    const probe = createRenderProbe({
      check: () =>
        new Promise<boolean>((resolve) => {
          resolveCheck = resolve;
        }),
      onOk: () => events.push('ok'),
      onFailed: () => events.push('failed'),
      intervalMs: 500,
      timeoutMs: 10_000,
    });
    probe.start();
    await vi.advanceTimersByTimeAsync(0);
    probe.cancel();
    resolveCheck(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(events).toEqual([]);
  });
});
