import { describe, expect, test } from 'bun:test';
import { createLimiter } from './limiter';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createLimiter', () => {
  test('maksimum bersamaan tak terlampaui pada 30 tugas serentak (Promise.all)', async () => {
    const limiter = createLimiter(6);
    let running = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        limiter.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await sleep(5);
          running -= 1;
          return index;
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: 30 }, (_, index) => index));
    expect(peak).toBe(6);
    expect(limiter.active).toBe(0);
    expect(limiter.waiting).toBe(0);
  });

  test('antrean FIFO: tugas dimulai menurut urutan masuk', async () => {
    const limiter = createLimiter(2);
    const started: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        limiter.run(async () => {
          started.push(index);
          await sleep(3);
        }),
      ),
    );
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('slot dilepas saat tugas melempar galat dan tugas berikutnya tetap jalan', async () => {
    const limiter = createLimiter(1);
    const failing = limiter.run(async () => {
      throw new Error('boom');
    });
    const next = limiter.run(async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    expect(await next).toBe('ok');
    expect(limiter.active).toBe(0);
  });

  test('slot dilepas saat tugas ditolak sinkron (fungsi melempar sebelum mengembalikan promise)', async () => {
    const limiter = createLimiter(1);
    const bad = limiter.run(() => {
      throw new Error('sinkron');
    });
    await expect(bad).rejects.toThrow('sinkron');
    expect(await limiter.run(async () => 1)).toBe(1);
    expect(limiter.active).toBe(0);
  });

  test('menolak batas bukan bilangan bulat positif', () => {
    expect(() => createLimiter(0)).toThrow();
    expect(() => createLimiter(1.5)).toThrow();
  });
});
