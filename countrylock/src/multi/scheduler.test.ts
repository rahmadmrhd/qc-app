import { describe, expect, test } from 'bun:test';
import { createScheduler } from './scheduler';

/** Beri kesempatan microtask berjalan. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createScheduler', () => {
  test('limit 2: dua acquire langsung, ketiga menunggu sampai ada release', async () => {
    const s = createScheduler(2);
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    expect(s.running).toBe(2);
    let third = false;
    const p3 = s.acquire().then((rel) => {
      third = true;
      return rel;
    });
    await tick();
    expect(third).toBe(false);
    expect(s.waiting).toBe(1);
    r1();
    const r3 = await p3;
    expect(third).toBe(true);
    expect(s.running).toBe(2);
    expect(s.waiting).toBe(0);
    r2();
    r3();
    expect(s.running).toBe(0);
  });

  test('release dua kali aman (tidak menghitung dua kali)', async () => {
    const s = createScheduler(2);
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    r1();
    r1();
    expect(s.running).toBe(1);
    r2();
    expect(s.running).toBe(0);
  });

  test('FIFO', async () => {
    const s = createScheduler(1);
    const first = await s.acquire();
    const order: number[] = [];
    const ps = [1, 2, 3].map((n) =>
      s.acquire().then((rel) => {
        order.push(n);
        rel();
      }),
    );
    first();
    await Promise.all(ps);
    expect(order).toEqual([1, 2, 3]);
  });

  test('setLimit turun saat berjalan: tidak memutus yang berjalan, tidak memberi slot baru sampai running < limit', async () => {
    const s = createScheduler(2);
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    s.setLimit(1);
    expect(s.limit).toBe(1);
    expect(s.running).toBe(2);
    let granted = false;
    const p = s.acquire().then((rel) => {
      granted = true;
      return rel;
    });
    r1();
    await tick();
    expect(granted).toBe(false); // running 1, limit 1
    r2();
    const rel = await p;
    expect(granted).toBe(true);
    rel();
  });

  test('setLimit naik melepas waiter sampai penuh', async () => {
    const s = createScheduler(1);
    const first = await s.acquire();
    const granted: number[] = [];
    const ps = [1, 2, 3, 4].map((n) =>
      s.acquire().then((rel) => {
        granted.push(n);
        return rel;
      }),
    );
    await tick();
    expect(granted).toEqual([]);
    s.setLimit(3);
    await tick();
    expect(granted).toEqual([1, 2]); // running: first + 2 = 3
    expect(s.running).toBe(3);
    expect(s.waiting).toBe(2);
    first();
    await tick();
    expect(granted).toEqual([1, 2, 3]);
    void ps;
  });

  test('limit dijepit 1 sampai 32 (awal dan setLimit)', () => {
    expect(createScheduler(0).limit).toBe(1);
    expect(createScheduler(99).limit).toBe(32);
    expect(createScheduler(Number.NaN).limit).toBe(1);
    const s = createScheduler(4);
    s.setLimit(0);
    expect(s.limit).toBe(1);
    s.setLimit(99);
    expect(s.limit).toBe(32);
    s.setLimit(7.9);
    expect(s.limit).toBe(7);
  });

  test('acquire dengan signal dibatalkan saat menunggu: menolak AbortError dan tidak menghabiskan slot', async () => {
    const s = createScheduler(1);
    const first = await s.acquire();
    const ctl = new AbortController();
    const p = s.acquire(ctl.signal);
    await tick();
    expect(s.waiting).toBe(1);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.waiting).toBe(0);
    expect(s.running).toBe(1);
    first();
    expect(s.running).toBe(0);
    const again = await s.acquire(); // slot masih bisa diambil
    expect(s.running).toBe(1);
    again();
  });

  test('signal yang sudah batal sebelum acquire langsung ditolak tanpa mengambil slot', async () => {
    const s = createScheduler(2);
    const ctl = new AbortController();
    ctl.abort();
    await expect(s.acquire(ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.running).toBe(0);
  });

  test('abort setelah slot diberikan tidak berpengaruh', async () => {
    const s = createScheduler(1);
    const ctl = new AbortController();
    const rel = await s.acquire(ctl.signal);
    ctl.abort();
    expect(s.running).toBe(1);
    rel();
    expect(s.running).toBe(0);
  });
});
