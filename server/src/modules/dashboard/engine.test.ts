import { beforeEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { WidgetData, WidgetId } from '@shared/dashboard';
import { createTtlCache } from './cache';
import { runWidgets, WIDGET_CONCURRENCY, widgetConcurrencyFor } from './engine';
import { createLimiter } from './limiter';
import type { WidgetCtx, WidgetImpl } from './registry';
import { resolveScope } from './scope';

setDefaultTimeout(60_000);

let env: TestEnv;

const NOW = Date.UTC(2026, 10, 23, 5, 0, 0);
const IDS: WidgetId[] = [
  'hs.created',
  'hs.active',
  'hs.status',
  'hs.trend',
  'hs.byLocation',
  'hs.byCustomer',
  'hs.avgDuration',
  'sn.status',
  'sn.status',
];

const scope = resolveScope(
  {
    email: 'u@gmail.com',
    name: 'U',
    userId: 'u1',
    isSuperAdmin: false,
    permissions: {} as never,
    locations: {},
    businessUnits: {},
    sharedAccount: false,
    deletedBuIds: [],
  },
  { from: '2026-11-17', to: '2026-11-23' },
  NOW,
);

function impls(
  run: (id: WidgetId, ctx: WidgetCtx) => Promise<WidgetData>,
): Map<WidgetId, WidgetImpl> {
  return new Map(IDS.map((id) => [id, { id, run: (ctx: WidgetCtx) => run(id, ctx) }]));
}

const ok = (value = 1): WidgetData => ({ kind: 'number', value });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
});

describe('runWidgets', () => {
  test('batas konkurensi mengikuti ukuran pool: min(6, max(1, pool - 4)) dan menyisakan 4 koneksi', () => {
    expect(WIDGET_CONCURRENCY).toBe(6);
    expect(widgetConcurrencyFor(10)).toBe(6);
    expect(widgetConcurrencyFor(30)).toBe(6);
    expect(widgetConcurrencyFor(9)).toBe(5);
    expect(widgetConcurrencyFor(8)).toBe(4);
    expect(widgetConcurrencyFor(6)).toBe(2);
    expect(widgetConcurrencyFor(5)).toBe(1);
    expect(widgetConcurrencyFor(2)).toBe(1);
    expect(widgetConcurrencyFor(1)).toBe(1);
    // Ukuran pool tak diketahui = bawaan 10.
    expect(widgetConcurrencyFor(undefined)).toBe(6);
  });

  /** Env dengan ukuran pool yang dinyatakan (pool sungguhan tak berubah; hanya yang dibaca engine). */
  const withPool = (poolSize: number): TestEnv =>
    ({ ...env, DB: Object.assign(Object.create(env.DB), { poolSize }) }) as TestEnv;

  async function peakOf(target: TestEnv, requests: number): Promise<number> {
    let running = 0;
    let peak = 0;
    const map = impls(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(15);
      running -= 1;
      return ok();
    });
    // Beberapa permintaan serentak (mis. tiga grup/tab), tiap permintaan 9 widget dengan cakupan berbeda (tanpa cache).
    const calls = Array.from({ length: requests }, (_, index) =>
      runWidgets(
        target,
        { ...scope, buIds: [`bu${index}`] },
        IDS.map((id) => ({ id })),
        map,
      ),
    );
    const all = await Promise.all(calls);
    expect(all.every((results) => results.every((result) => result.status === 'ok'))).toBe(true);
    return peak;
  }

  test('semafor per proses: pool 10 = paling banyak 6 widget bersamaan, lintas permintaan serentak', async () => {
    expect(await peakOf(withPool(10), 3)).toBe(6);
  });

  test('pool kecil memperkecil batas: pool 8 = 4, pool 5 = 1 widget bersamaan', async () => {
    expect(await peakOf(withPool(8), 3)).toBe(4);
    expect(await peakOf(withPool(5), 2)).toBe(1);
  });

  test('widget dijalankan menurut urutan permintaan (FIFO) saat antre', async () => {
    const started: WidgetId[] = [];
    let running = 0;
    let peak = 0;
    const map = impls(async (id) => {
      started.push(id);
      running += 1;
      peak = Math.max(peak, running);
      await sleep(3);
      running -= 1;
      return ok();
    });
    await runWidgets(
      env,
      scope,
      IDS.map((id) => ({ id })),
      map,
      { limiter: createLimiter(2) },
    );
    expect(started).toEqual(IDS);
    expect(peak).toBe(2);
  });

  test('batas waktu dihitung setelah slot diperoleh: yang menunggu antrean tidak menjadi galat palsu', async () => {
    const map = impls(async () => {
      await sleep(30);
      return ok();
    });
    // Slot 1: widget kedua menunggu 30 ms lalu berjalan 30 ms (total 60 ms) dengan batas 50 ms per widget.
    const results = await runWidgets(env, scope, [{ id: 'hs.created' }, { id: 'hs.active' }], map, {
      timeoutMs: 50,
      limiter: createLimiter(1),
    });
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok']);
  });

  /** Menunggu sampai `check()` benar tanpa bergantung pada lama waktu (hanya memberi giliran ke event loop). */
  async function until(check: () => boolean): Promise<void> {
    while (!check()) await sleep(1);
  }

  test('slot TETAP terpakai selama kueri yang timeout belum selesai; dilepas setelah ia selesai (tanpa kebocoran)', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let slowSettled = false;
    const started: WidgetId[] = [];
    try {
      const limiter = createLimiter(1);
      let calls = 0;
      const map = impls(async (id) => {
        started.push(id);
        if (id === 'hs.created') {
          calls += 1;
          await gate;
          slowSettled = true;
          return ok(calls);
        }
        // Widget berikutnya hanya boleh mulai setelah kueri lambat benar-benar selesai.
        expect(slowSettled).toBe(true);
        return ok();
      });
      const request = [{ id: 'hs.created' as const }, { id: 'hs.active' as const }];
      const running = runWidgets(env, scope, request, map, { timeoutMs: 20, limiter });
      // Sinyal deterministik: galat timeout widget pertama sudah dicatat (klien mendapat galat generik).
      await until(() => spy.mock.calls.length > 0);
      expect(started).toEqual(['hs.created']);
      expect(limiter.active).toBe(1);
      expect(limiter.waiting).toBe(1);
      release();
      const results = await running;
      expect(results[0]).toEqual({
        id: 'hs.created',
        status: 'error',
        message: 'Widget tidak dapat dimuat',
      });
      expect(results[1]?.status).toBe('ok');
      expect(started).toEqual(['hs.created', 'hs.active']);
      expect(limiter.active).toBe(0);
      expect(limiter.waiting).toBe(0);
      // Hasil yang datang terlambat tidak di-cache: permintaan yang sama menjalankan widgetnya lagi.
      await runWidgets(env, scope, [{ id: 'hs.created' }], map, { timeoutMs: 1_000, limiter });
      expect(calls).toBe(2);
    } finally {
      release();
      spy.mockRestore();
    }
  });

  test('slot dilepas juga saat kueri yang timeout akhirnya gagal, dan saat widget gagal biasa', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    let fail: () => void = () => {};
    const gate = new Promise<void>((_, reject) => {
      fail = () => reject(new Error('koneksi putus'));
    });
    gate.catch(() => {});
    try {
      const limiter = createLimiter(1);
      const started: WidgetId[] = [];
      const map = impls(async (id) => {
        started.push(id);
        if (id === 'hs.created') await gate;
        if (id === 'hs.active') throw new Error('boom');
        return ok();
      });
      const running = runWidgets(
        env,
        scope,
        [{ id: 'hs.created' }, { id: 'hs.active' }, { id: 'hs.status' }],
        map,
        { timeoutMs: 20, limiter },
      );
      await until(() => spy.mock.calls.length > 0);
      expect(started).toEqual(['hs.created']);
      expect(limiter.active).toBe(1);
      fail();
      const results = await running;
      expect(results.map((result) => result.status)).toEqual(['error', 'error', 'ok']);
      expect(started).toEqual(['hs.created', 'hs.active', 'hs.status']);
      expect(limiter.active).toBe(0);
      expect(limiter.waiting).toBe(0);
    } finally {
      fail();
      spy.mockRestore();
    }
  });

  test('hasil mengikuti urutan permintaan', async () => {
    const map = impls(async (id) => ok(IDS.indexOf(id)));
    const results = await runWidgets(env, scope, [{ id: 'sn.status' }, { id: 'hs.created' }], map);
    expect(results.map((result) => result.id)).toEqual(['sn.status', 'hs.created']);
  });

  test('satu widget melempar: error generik, widget lain tetap ok dan tanpa bocor pesan', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const map = impls(async (id) => {
        if (id === 'hs.active') throw new Error("SQL rahasia: Unknown column 'x' ... nilai 123");
        return ok();
      });
      const results = await runWidgets(
        env,
        scope,
        [{ id: 'hs.created' }, { id: 'hs.active' }, { id: 'hs.status' }],
        map,
      );
      expect(results[0]?.status).toBe('ok');
      expect(results[2]?.status).toBe('ok');
      expect(results[1]).toEqual({
        id: 'hs.active',
        status: 'error',
        message: 'Widget tidak dapat dimuat',
      });
      expect(JSON.stringify(results)).not.toContain('rahasia');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('widget melebihi batas waktu menjadi error, yang lain ok', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const map = impls(async (id) => {
        if (id === 'hs.active') await sleep(500);
        return ok();
      });
      const results = await runWidgets(
        env,
        scope,
        [{ id: 'hs.created' }, { id: 'hs.active' }],
        map,
        { timeoutMs: 40 },
      );
      expect(results[0]?.status).toBe('ok');
      expect(results[1]).toEqual({
        id: 'hs.active',
        status: 'error',
        message: 'Widget tidak dapat dimuat',
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('id tanpa implementasi menjadi error generik', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const results = await runWidgets(env, scope, [{ id: 'st.postel' }], new Map());
      expect(results[0]).toEqual({
        id: 'st.postel',
        status: 'error',
        message: 'Widget tidak dapat dimuat',
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('widget menerima filter dan cakupan yang sama', async () => {
    let seen: WidgetCtx | null = null;
    const map = impls(async (_id, ctx) => {
      seen = ctx;
      return ok();
    });
    await runWidgets(env, scope, [{ id: 'hs.created', filters: { status: ['done'] } }], map);
    expect((seen as WidgetCtx | null)?.filters).toEqual({ status: ['done'] });
    expect((seen as WidgetCtx | null)?.scope).toBe(scope);
  });

  test('cache 30 dtk: permintaan sama tidak dijalankan ulang, setelah 31 dtk dijalankan ulang', async () => {
    let calls = 0;
    const map = impls(async () => {
      calls += 1;
      return ok(calls);
    });
    const request = [{ id: 'hs.created' as const, filters: { status: ['done', 'new'] } }];
    const first = await runWidgets(env, scope, request, map);
    expect(calls).toBe(1);
    env.clock.advance(29_000);
    const second = await runWidgets(env, scope, request, map);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    // Urutan nilai filter tidak mengubah kunci cache.
    await runWidgets(env, scope, [{ id: 'hs.created', filters: { status: ['new', 'done'] } }], map);
    expect(calls).toBe(1);
    env.clock.advance(2_000);
    const third = await runWidgets(env, scope, request, map);
    expect(calls).toBe(2);
    expect(third).not.toEqual(first);
  });

  test('filter berbeda atau cakupan berbeda tidak berbagi cache; galat tidak di-cache', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      let calls = 0;
      let fail = true;
      const map = impls(async () => {
        calls += 1;
        if (fail) throw new Error('boom');
        return ok();
      });
      const request = [{ id: 'hs.created' as const }];
      await runWidgets(env, scope, request, map);
      fail = false;
      const results = await runWidgets(env, scope, request, map);
      expect(results[0]?.status).toBe('ok');
      expect(calls).toBe(2);
      await runWidgets(env, scope, [{ id: 'hs.created', filters: { status: ['done'] } }], map);
      expect(calls).toBe(3);
      await runWidgets(env, { ...scope, buIds: ['lain'] }, request, map);
      expect(calls).toBe(4);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createTtlCache', () => {
  test('kedaluwarsa menurut jam yang disuntik dan membuang entri lama saat penuh', () => {
    let now = 0;
    const cache = createTtlCache<number>(1000, () => now, 2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    now = 999;
    expect(cache.get('a')).toBe(1);
    now = 1001;
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    expect(cache.size()).toBeLessThanOrEqual(2);
    expect(cache.get('d')).toBe(4);
  });
});
